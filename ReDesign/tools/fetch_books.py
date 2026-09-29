#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download NCTB textbooks and sort them into books/.

Reads the generated catalogue (data/library.json) and fetches every book to a
tidy tree:

    books/<year>/class-<NN>/<level>/<subject>.pdf

Anything the catalogue could not classify lands in books/unsorted/ rather than
being dropped. A manifest.json is written alongside so the site can prefer a
local copy over the network.

Why a script and not a browser download: Google refuses cross-origin reads of
Drive files from a browser but serves them fine to a plain HTTP client, and it
rate-limits popular files with an HTML page rather than an error status. Both
are handled here, and every book has its mirrors tried in turn.

    # start small — one class, one year
    python ReDesign/tools/fetch_books.py --year 2026 --class 6

    # what would the whole thing cost?
    python ReDesign/tools/fetch_books.py --all --estimate

    # everything (large: see --estimate first)
    python ReDesign/tools/fetch_books.py --all

Re-running skips files already on disk, so an interrupted run resumes.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import hashlib
import io
import json
import shutil
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # ReDesign/
CATALOGUE = os.path.join(ROOT, "data", "library.json")
DEFAULT_OUT = os.path.join(ROOT, "books")

DRIVE = "https://drive.usercontent.google.com/download"
# The years the site serves off its own disk. Everything older still opens —
# the reader falls through to NCTB's hosts — so this is a storage decision, not
# a coverage one. Keep it in step with the shelf, which marks a year as held
# once ~all of its catalogue entries are downloaded (assets/js/sources.js).
SERVED_YEARS = (2026, 2025)
SERVED_LABEL = " and ".join(str(y) for y in sorted(SERVED_YEARS))

UA = "Mozilla/5.0 (compatible; nctb-shelf/1.0; +local archival of public textbooks)"
TIMEOUT = 180

LEVEL_DIR = {
    "pre-primary": "pre-primary",
    "primary": "primary",
    "ebtedayi": "ebtedayi",
    "secondary": "secondary",
    "dakhil": "dakhil",
    "higher-secondary": "higher-secondary",
    "vocational": "vocational",
}

# Windows consoles default to cp1252, which cannot encode an arrow — let alone
# a Bengali book title — and a print() that raises takes the process with it.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):          # already wrapped, or not a tty
        pass

_print_lock = threading.Lock()


def say(*parts):
    with _print_lock:
        print(*parts, flush=True)


# ---------------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------------

# Keep Bengali and Latin letters, digits, space, dash. Drop the rest — Windows
# rejects <>:"/\|?* and a stray one anywhere kills the whole write.
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_SPACES = re.compile(r"\s+")


def safe_name(text: str, fallback: str = "book") -> str:
    name = unicodedata.normalize("NFC", text or "").strip()
    name = _UNSAFE.sub(" ", name)
    name = _SPACES.sub(" ", name).strip(" .")
    name = name.replace(" ", "-")
    # Windows path components cap at 255; leave room for a suffix and .pdf
    return (name[:110] or fallback)


def class_dir(book: dict) -> str | None:
    """`class-06`, or `class-09-10` for a book published for both."""
    grades = sorted(book.get("grades") or ([book["grade"]] if book.get("grade") else []))
    if not grades:
        return None
    if len(grades) == 1:
        return f"class-{grades[0]:02d}"
    return f"class-{grades[0]:02d}-{grades[-1]:02d}"


def folder_for(book: dict) -> tuple[str, ...]:
    year = str(book["year"]) if book.get("year") else None
    grade = class_dir(book)
    level = LEVEL_DIR.get(book.get("level") or "", None)

    if year and (grade or level):
        return (year, grade or "all-classes", level or "general")
    if year:
        return (year, "unsorted")
    return ("unsorted",)


def identity(sources: list[tuple[str, str]]) -> str:
    """A stable id for a book, independent of which mirror we prefer today.

    Keying on `sources[0]` looked fine until the preferred order changed and
    every identity moved with it — re-downloading files and orphaning the ones
    already on disk. The Drive file id is the one handle that does not move.
    """
    for kind, url in sources:
        if kind == "drive":
            m = re.search(r"[?&]id=([\w-]{10,})", url)
            if m:
                return f"drive:{m.group(1)}"
    return sorted(u for _, u in sources)[0]


def source_token(sources: list[tuple[str, str]]) -> str:
    """A short tag from that identity — used only to break name ties."""
    return re.sub(r"\W", "", identity(sources))[-6:] or "alt"


def assign_paths(books: list[dict], out_dir: str) -> None:
    """Give every book a destination, disambiguating same-named siblings.

    NCTB lists e.g. two different 'প্রাথমিক গণিত' files under the same class and
    level (the book comes in two parts). Left alone they collide and the second
    silently overwrites the first, so ties get a short tag from their source —
    derived, not counted, so the name stays the same on the next run.
    """
    groups: dict[tuple, list[dict]] = {}
    for b in books:
        key = folder_for(b) + (safe_name(b["title"]),)
        groups.setdefault(key, []).append(b)

    for key, group in groups.items():
        *folder, stem = key
        for b in group:
            name = stem if len(group) == 1 else f"{stem}-{source_token(b['sources'])}"
            b["dest"] = os.path.join(out_dir, *folder, name + ".pdf")


def destination(out_dir: str, book: dict) -> str:
    return book.get("dest") or os.path.join(
        out_dir, *folder_for(book), safe_name(book["title"]) + ".pdf")


# ---------------------------------------------------------------------------
# Catalogue -> flat list of books
# ---------------------------------------------------------------------------

def source_order(links: list[dict]) -> list[tuple[str, str]]:
    """(kind, url) worth trying, best first.

    Deliberately different from the reader's order, which puts Drive second
    because it is fast for a single book. Bulk-fetching thousands of files is
    exactly what makes Google start answering "Too many users have viewed or
    downloaded this file recently", so anything with a government mirror is
    taken from the mirror and Google is never asked. That leaves its quota for
    the books that have no alternative.
    """
    out: list[tuple[str, str]] = []
    for l in links:
        if l["source"] == "oracle":
            out.append(("oracle", l["url"]))
    for l in links:
        if l["source"] == "egov":
            u = l["url"].rstrip("/")
            out.append(("egov", u if u.endswith("/download") else u + "/download"))
    for l in links:
        if l["source"] == "drive" and l.get("fileId"):
            out.append(("drive", f"{DRIVE}?id={l['fileId']}&export=download&confirm=t"))
    return out


def parse_spec(spec: str, what: str) -> set[int]:
    """Accept a single number, a comma list, or a range: 6 · 1,3,5 · 1-10."""
    out: set[int] = set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, _, hi = part.partition("-")
            try:
                lo_i, hi_i = int(lo), int(hi)
            except ValueError:
                raise ValueError(f"bad {what} range: {part!r}")
            if lo_i > hi_i:
                lo_i, hi_i = hi_i, lo_i
            out.update(range(lo_i, hi_i + 1))
        else:
            try:
                out.add(int(part))
            except ValueError:
                raise ValueError(f"bad {what}: {part!r}")
    return out


def parse_classes(spec: str) -> set[int]:
    return parse_spec(spec, "class")


def parse_years(spec: str) -> set[int]:
    return parse_spec(spec, "year")


def load_books(args) -> list[dict]:
    with open(CATALOGUE, encoding="utf-8") as fh:
        data = json.load(fh)

    seen: dict[str, dict] = {}
    for c in data["collections"]:
        if args.years and c.get("year") not in args.years:
            continue
        if args.grades:
            # A "নবম-দশম" book belongs to classes 9 and 10 alike, so match on
            # membership rather than on the single primary grade.
            tagged = set(c.get("grades") or ([c["grade"]] if c.get("grade") else []))
            if not (tagged & args.grades):
                continue
        if args.level and c.get("level") != args.level:
            continue

        for item in c["items"]:
            sources = source_order(item["links"])
            if not sources:
                continue
            key = identity(sources)
            if key in seen:
                continue
            seen[key] = {
                "title": item["label"],
                "year": c.get("year"),
                "grade": c.get("grade"),
                "grades": c.get("grades") or ([c["grade"]] if c.get("grade") else []),
                "level": c.get("level"),
                "version": c.get("version"),
                "kind": c.get("kind"),
                "path": c.get("path"),
                "sources": sources,
            }

    books = list(seen.values())
    books.sort(key=lambda b: (-(b["year"] or 0), b["grade"] or 99, b["title"]))
    if args.limit:
        books = books[: args.limit]
    assign_paths(books, args.out)
    return books


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

class Skip(Exception):
    """Nothing to do — the file is already on disk."""


def on_disk_facts(path: str, out_dir: str) -> dict:
    """Size and mtime for a file we did not just download."""
    return {
        "file": rel(path, out_dir),
        "bytes": os.path.getsize(path),
        "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%S",
                                      time.localtime(os.path.getmtime(path))),
    }


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def already_have(out_dir: str, book: dict) -> bool:
    dest = destination(out_dir, book)
    if os.path.exists(dest) and os.path.getsize(dest) > 1024:
        return True
    # Some entries are ZIPs of several books. Those unpack into a folder named
    # for the entry, so the .pdf the name predicts never exists — without this
    # every sync would fetch and re-extract the archive again.
    folder = os.path.splitext(dest)[0]
    if os.path.isdir(folder):
        return any(f.lower().endswith(".pdf") for f in os.listdir(folder))
    return False


class Throttled(ValueError):
    """Upstream is rate-limiting us, not refusing this particular file."""


class Throttle:
    """Slows the whole run down when Google starts refusing.

    Hammering on through a quota response just deepens it, and every worker
    hits the same wall at once. One shared gate means a single book's refusal
    calms all of them, and a clean stretch winds the delay back down.
    """

    def __init__(self, base: float):
        self.base = base
        self.extra = 0.0
        self.hits = 0
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            pause = self.base + self.extra
        time.sleep(pause)

    def refused(self) -> float:
        with self._lock:
            self.hits += 1
            self.extra = min(30.0, (self.extra or 1.0) * 1.8)
            return self.extra

    def ok(self) -> None:
        with self._lock:
            if self.extra:
                self.extra = max(0.0, self.extra * 0.5)
                if self.extra < 0.3:
                    self.extra = 0.0


def fetch_one(url: str) -> tuple[str, bytes]:
    """Return ("pdf" | "zip", bytes), or raise with the reason.

    Not everything NCTB links is a single PDF: the pre-primary story books, for
    instance, arrive as one ZIP of ten. Rejecting those outright quietly lost
    real content, so the payload kind is reported and the caller unpacks.
    """
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        ctype = (resp.headers.get("Content-Type") or "").lower()
        body = resp.read()

    if body.startswith(b"%PDF"):
        return "pdf", body
    if body.startswith(b"PK\x03\x04"):
        return "zip", body

    # Google answers 200 text/html when a file is rate-limited, and an HTML
    # blob written as .pdf is worse than no file at all.
    if ctype.startswith("text/html"):
        if b"Quota exceeded" in body[:4000] or b"Too many users" in body[:4000]:
            raise Throttled("rate-limited")
        raise ValueError("got a web page, not a file")
    raise ValueError("neither PDF nor ZIP")


def download(book: dict, out_dir: str, force: bool, throttle: Throttle) -> dict:
    dest = destination(out_dir, book)
    if not force and os.path.exists(dest) and os.path.getsize(dest) > 1024:
        raise Skip(dest)

    errors = []
    for kind, url in book["sources"]:
        throttle.wait()
        try:
            payload, body = fetch_one(url)
        except Throttled:
            pause = throttle.refused()
            errors.append(f"{kind}: rate-limited")
            say(f"    upstream throttling — easing off to +{pause:.1f}s between requests")
            continue
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as err:
            errors.append(f"{kind}: {str(err)[:60]}")
            continue

        throttle.ok()
        now = time.strftime("%Y-%m-%dT%H:%M:%S")

        if payload == "zip":
            parts = unpack_zip(body, dest)
            if not parts:
                errors.append(f"{kind}: zip held no PDFs")
                continue
            return {"parts": parts, "via": kind, "downloadedAt": now,
                    "bytes": sum(p["bytes"] for p in parts)}

        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".part"
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, dest)          # never leave a half file at the real name
        return {
            "parts": [{"path": dest, "bytes": len(body), "label": None,
                       "sha256": hashlib.sha256(body).hexdigest()}],
            "bytes": len(body),
            "via": kind,
            "downloadedAt": now,
        }

    raise RuntimeError("; ".join(errors) or "no usable source")


def unpack_zip(body: bytes, dest: str) -> list[dict]:
    """Write every PDF inside an archive into a folder named for the book.

    NCTB ships some collections — the pre-primary story books — as a single
    ZIP. Stored as one opaque file nobody could read it, so each PDF becomes a
    book of its own, named from its entry inside the archive.
    """
    folder = os.path.splitext(dest)[0]
    parts: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        for info in zf.infolist():
            if info.is_dir() or not info.filename.lower().endswith(".pdf"):
                continue
            data = zf.read(info)
            if not data.startswith(b"%PDF"):
                continue
            label = safe_name(os.path.splitext(os.path.basename(info.filename))[0])
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, label + ".pdf")
            tmp = path + ".part"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
            parts.append({"path": path, "bytes": len(data), "label": label,
                          "sha256": hashlib.sha256(data).hexdigest()})
    return parts


def head_size(url: str) -> int | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-1"})
        with urllib.request.urlopen(req, timeout=45) as resp:
            rng = resp.headers.get("Content-Range") or ""
            if "/" in rng:
                return int(rng.rsplit("/", 1)[1])
            return int(resp.headers.get("Content-Length") or 0) or None
    except Exception:
        return None


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def estimate(books: list[dict], sample: int = 12) -> None:
    say(f"Sampling {min(sample, len(books))} of {len(books)} books for an average size…\n")
    sizes = []
    for book in books[:sample]:
        size = head_size(book["sources"][0][1])
        mark = human(size) if size else "unknown"
        say(f"  {mark:>10}  {book['title'][:52]}")
        if size:
            sizes.append(size)
    if not sizes:
        say("\nCould not measure any of them — try again later.")
        return
    avg = sum(sizes) / len(sizes)
    say(f"\n  average   {human(avg)}")
    say(f"  books     {len(books)}")
    say(f"  projected {human(avg * len(books))} on disk")
    say("\nNarrow it with --year / --class / --level if that is more than you want.")


def run(books: list[dict], args) -> None:
    out_dir = args.out
    done = skipped = failed = 0
    total_bytes = 0
    manifest = []
    failures: list[dict] = []
    throttle = Throttle(args.delay)
    started = time.time()

    def work(book):
        return book, download(book, out_dir, args.force, throttle)

    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {pool.submit(work, b): b for b in books}
        for i, fut in enumerate(futures.as_completed(pending), 1):
            book = pending[fut]
            label = book["title"][:46]
            try:
                _, result = fut.result()
            except Skip as err:
                skipped += 1
                row = {**meta_of(book), **on_disk_facts(str(err), out_dir)}
                row["cover"] = render_cover(str(err), out_dir, row["id"])
                manifest.append(row)
                say(f"[{i}/{len(books)}] ·  have    {label}")
                continue
            except Exception as err:                     # noqa: BLE001
                failed += 1
                reason = str(err)
                failures.append({**meta_of(book),
                                 "dest": rel(destination(out_dir, book), out_dir),
                                 "reason": reason[:200],
                                 "when": time.strftime("%Y-%m-%d %H:%M")})
                say(f"[{i}/{len(books)}] x  failed  {label}  ({reason[:70]})")
                continue

            done += 1
            total_bytes += result["bytes"]
            base = meta_of(book)
            for part in result["parts"]:
                # An archive becomes several books, each with its own entry so
                # the shelf can list and the reader can open them individually.
                row = {**base,
                       "file": rel(part["path"], out_dir),
                       "bytes": part["bytes"],
                       "sha256": part["sha256"],
                       "via": result["via"],
                       "downloadedAt": result["downloadedAt"]}
                if part["label"]:
                    row["id"] = f"{base['id']}#{part['label']}"
                    row["title"] = f"{base['title']} — {part['label'].replace('-', ' ')}"
                    row["partOf"] = base["id"]
                # Rendered now, while the file is certainly on disk and warm in
                # the page cache, so the shelf never has to ask Google for art.
                row["cover"] = render_cover(part["path"], out_dir, row["id"])
                manifest.append(row)

            extra = f" ({len(result['parts'])} files)" if len(result["parts"]) > 1 else ""
            say(f"[{i}/{len(books)}] +  {human(result['bytes']):>9}  {label}{extra}")

    write_manifest(out_dir, manifest)
    write_failures(out_dir, failures, retried=[identity(b["sources"]) for b in books])
    mins = (time.time() - started) / 60
    say(f"\ndownloaded {done} · already had {skipped} · failed {failed}")
    say(f"{human(total_bytes)} in {mins:.1f} min  ->  {out_dir}")
    if throttle.hits:
        say(f"upstream throttled us {throttle.hits} time(s) along the way")
    if failed:
        limited = sum(1 for f in failures if "rate-limited" in f["reason"])
        if limited:
            say(f"\n{limited} of {failed} were Google rate-limiting a popular file. "
                "That clears within about a day.")
        say("Run again with --retry-failed to re-attempt only those; everything "
            "already downloaded is left alone.")


FAILED_FILE = "failed.json"


def write_failures(out_dir: str, failures: list[dict], retried: list[str]) -> None:
    """Record what did not come down, so the next run can target just those.

    Anything retried successfully this time is dropped from the list, so the
    file shrinks as the archive fills rather than accumulating stale entries.
    """
    target = os.path.join(out_dir, FAILED_FILE)
    kept: dict[str, dict] = {}
    if os.path.exists(target):
        try:
            with open(target, encoding="utf-8") as fh:
                for row in json.load(fh).get("failed", []):
                    kept[row["source"]] = row
        except Exception:                                # noqa: BLE001
            pass

    for src in retried:
        kept.pop(src, None)                              # attempted — verdict below
    for row in failures:
        kept[row["source"]] = row

    os.makedirs(out_dir, exist_ok=True)
    if not kept:
        if os.path.exists(target):
            os.remove(target)
        return
    with open(target, "w", encoding="utf-8") as fh:
        json.dump({"generated": time.strftime("%Y-%m-%d %H:%M"),
                   "count": len(kept),
                   "failed": list(kept.values())}, fh, ensure_ascii=False, indent=1)
    say(f"failures  {target}  ({len(kept)} to retry)")


def existing_checksums(out_dir: str) -> dict[str, str]:
    """file -> sha256 from a previous manifest, so a reindex need not re-hash."""
    target = os.path.join(out_dir, "manifest.json")
    if not os.path.exists(target):
        return {}
    try:
        with open(target, encoding="utf-8") as fh:
            return {r["file"]: r["sha256"]
                    for r in json.load(fh).get("books", []) if r.get("sha256")}
    except Exception:                                    # noqa: BLE001
        return {}


def load_failures(out_dir: str) -> set[str]:
    target = os.path.join(out_dir, FAILED_FILE)
    if not os.path.exists(target):
        return set()
    try:
        with open(target, encoding="utf-8") as fh:
            return {row["source"] for row in json.load(fh).get("failed", [])}
    except Exception:                                    # noqa: BLE001
        return set()


def meta_of(book: dict) -> dict:
    """One row of the local library database.

    Everything the site needs to decide *which* copy to serve lives here, so a
    reader never has to consult the catalogue or the network: the academic year
    and every class the book serves, the stream, the language version, and the
    NCTB page it came from.
    """
    ident = identity(book["sources"])
    m = re.search(r"^drive:([\w-]+)$", ident)
    return {
        "id": ident,
        "title": book["title"],
        "year": book["year"],
        "grade": book["grade"],
        "grades": book.get("grades") or ([book["grade"]] if book.get("grade") else []),
        "level": book["level"],
        "version": book.get("version"),
        "kind": book.get("kind"),
        "path": book.get("path"),
        "source": ident,
        # The site matches on these, so record them rather than making the
        # browser reconstruct a Google URL byte-for-byte.
        "driveId": m.group(1) if m else None,
        "urls": [u for _, u in book["sources"]],
    }


def rel(path: str, out_dir: str) -> str:
    return os.path.relpath(path, out_dir).replace(os.sep, "/")


# ---------------------------------------------------------------------------
# Covers
# ---------------------------------------------------------------------------
#
# The shelf used to show Google's Drive thumbnail for every book. That is the
# one part of the page still asking Google for something on every visit, and it
# fails exactly the way the files themselves used to: a popular id gets rate-
# limited and answers nothing, leaving a grey tile. Since we now hold the PDF,
# page one *is* the cover — rendered once, at download time, and served from
# here like everything else.

COVER_DIR = "covers"
COVER_WIDTH = 400


def cover_name(book_id: str) -> str:
    """A filesystem-safe, stable name for a book id.

    Ids look like `drive:1AbC-dEf` or `url:https://…`, neither of which is a
    usable filename, and part ids carry a `#`. Hashing keeps it short and
    collision-free without having to sanitise every id shape.
    """
    return hashlib.sha1(book_id.encode("utf-8")).hexdigest()[:16] + ".jpg"


def render_cover(pdf_path: str, out_dir: str, book_id: str) -> str | None:
    """Render page 1 to a JPEG. Returns the manifest-relative path, or None.

    A missing or unreadable PDF is not an error worth stopping for — the shelf
    simply falls back to Drive's thumbnail for that one book.
    """
    try:
        import fitz                                       # PyMuPDF
    except ImportError:
        return None

    dest = os.path.join(out_dir, COVER_DIR, cover_name(book_id))
    if os.path.exists(dest) and os.path.getsize(dest) > 512:
        return rel(dest, out_dir)

    try:
        with fitz.open(pdf_path) as doc:
            if not doc.page_count:
                return None
            page = doc.load_page(0)
            # Scale from the page's own width so every cover lands at the same
            # pixel width regardless of the paper size the book was set in.
            zoom = COVER_WIDTH / max(page.rect.width, 1)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            # Encode in memory: pix.save() picks its format from the file
            # extension, so writing to a ".part" temp makes it fail outright.
            data = pix.tobytes("jpg", jpg_quality=82)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".part"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, dest)
    except Exception:                                     # noqa: BLE001
        return None
    return rel(dest, out_dir)


def write_manifest(out_dir: str, entries: list[dict]) -> None:
    os.makedirs(out_dir, exist_ok=True)
    # Merge with anything a previous, differently-filtered run recorded.
    target = os.path.join(out_dir, "manifest.json")
    merged: dict[str, dict] = {}
    if os.path.exists(target):
        try:
            with open(target, encoding="utf-8") as fh:
                for row in json.load(fh).get("books", []):
                    merged[row["file"]] = row
        except Exception:                                # noqa: BLE001
            pass
    for row in entries:
        merged[row["file"]] = row

    books = sorted(merged.values(),
                   key=lambda r: (-(r.get("year") or 0), r.get("grade") or 99, r["title"]))

    payload = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "count": len(books),
        **summarise(books),
        "books": books,
    }
    with open(target, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    say(f"manifest  {target}  ({len(books)} books, {human(payload['bytes'])})")


def check_space(args, books: list[dict]) -> bool:
    """Refuse to start a run that cannot finish.

    NCTB scans are far bigger than they look — the median is ~45 MB but the
    tail runs to half a gigabyte, so the mean is ~73 MB and the full catalogue
    is a couple of hundred gigabytes. Filling the disk halfway through helps
    nobody, so project from what has actually been downloaded and stop here.
    """
    known = [b.get("bytes") for b in load_manifest_rows(args.out) if b.get("bytes")]
    avg = (sum(known) / len(known)) if known else 40e6
    need = avg * len(books)

    try:
        free = shutil.disk_usage(os.path.abspath(args.out) if os.path.exists(args.out)
                                 else os.path.dirname(os.path.abspath(args.out))).free
    except OSError:
        return True                                   # cannot tell; do not block

    say(f"~{human(need)} needed (average {human(avg)} a book) · {human(free)} free")
    if need < free * 0.9:
        return True

    say("")
    say("Not enough room. Narrow the run, for example:")
    say("   --year 2026                 this year only")
    say("   --year 2026 --class 1-10    this year, school classes")
    say("Or point somewhere larger:  --out D:/books")
    if args.yes:
        say("")
        say("--yes given: continuing anyway.")
        return True
    say("")
    say("Re-run with --yes to override this check.")
    return False


def load_manifest_rows(out_dir: str) -> list[dict]:
    target = os.path.join(out_dir, "manifest.json")
    if not os.path.exists(target):
        return []
    try:
        with open(target, encoding="utf-8") as fh:
            return json.load(fh).get("books", [])
    except Exception:                                 # noqa: BLE001
        return []


def summarise(books: list[dict]) -> dict:
    """The part that lets the site decide *which* edition to serve.

    `latestByClass` answers "what is the current book for class 7" without
    scanning everything, and without assuming this year's edition has been
    published — it names the newest year actually held, which during the
    changeover is often last year's.
    """
    by_year: dict[str, int] = {}
    by_class: dict[str, int] = {}
    latest: dict[str, int] = {}
    total = 0

    for b in books:
        total += b.get("bytes") or 0
        year = b.get("year")
        if year:
            by_year[str(year)] = by_year.get(str(year), 0) + 1
        for g in b.get("grades") or []:
            key = str(g)
            by_class[key] = by_class.get(key, 0) + 1
            if year and year > latest.get(key, 0):
                latest[key] = year

    return {
        "bytes": total,
        "years": sorted((int(y) for y in by_year), reverse=True),
        "byYear": dict(sorted(by_year.items(), key=lambda kv: -int(kv[0]))),
        "byClass": dict(sorted(by_class.items(), key=lambda kv: int(kv[0]))),
        "latestByClass": dict(sorted(latest.items(), key=lambda kv: int(kv[0]))),
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Download NCTB textbooks into books/, sorted by year, class and level.")
    ap.add_argument("--year", metavar="SPEC",
                    help="academic year; also a range or list: 2026, 2025-2026, 2024,2022")
    ap.add_argument("--class", dest="classes", metavar="SPEC",
                    help="class 1-12; also a range or list: 1-10, 1,3,5")
    ap.add_argument("--level", choices=sorted(LEVEL_DIR), help="stream")
    ap.add_argument("--all", action="store_true", help="no filter — the entire catalogue")
    ap.add_argument("--sync", action="store_true",
                    help=f"fetch what is missing from the years served locally "
                         f"({SERVED_LABEL}); add --all for the whole catalogue")
    ap.add_argument("--retry-failed", dest="retry_failed", action="store_true",
                    help="re-attempt only what failed on a previous run")
    ap.add_argument("--reindex", action="store_true",
                    help="rebuild manifest.json from what is already on disk, downloading nothing")
    ap.add_argument("--covers", action="store_true",
                    help="render a cover from page 1 of every downloaded book, downloading nothing")
    ap.add_argument("--limit", type=int, help="stop after N books")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"target folder (default: {DEFAULT_OUT})")
    ap.add_argument("--workers", type=int, default=3, help="parallel downloads (default 3)")
    ap.add_argument("--delay", type=float, default=0.4, help="seconds between requests")
    ap.add_argument("--force", action="store_true", help="re-download files already present")
    ap.add_argument("--yes", action="store_true",
                    help="proceed even if the run looks larger than the free space")
    ap.add_argument("--estimate", action="store_true", help="measure a sample and project the size")
    ap.add_argument("--dry-run", action="store_true", help="list what would be fetched, and where")
    args = ap.parse_args()

    try:
        args.grades = parse_classes(args.classes) if args.classes else set()
        args.years = parse_years(args.year) if args.year else set()
    except ValueError as err:
        ap.error(str(err))

    # A plain --sync means "keep the shelf current", not "mirror every edition
    # NCTB ever printed" — that is roughly 220 GB, and the site only serves the
    # recent years from disk anyway. Older years still open, straight from NCTB.
    # Read --all before --sync implies it, or the two become indistinguishable.
    narrow = args.sync and not (args.all or args.years or args.grades or args.level)

    if args.sync or args.reindex:
        args.all = True

    if narrow:
        args.years = set(SERVED_YEARS)
        say(f"Syncing {SERVED_LABEL} — the years this site serves locally.")
        say("Add --year 2024 for an older year, or --all for the entire catalogue.")
        say("")

    if not (args.year or args.grades or args.level or args.all
            or args.limit or args.retry_failed or args.reindex or args.covers):
        ap.error("pick a filter (--year / --class / --level / --limit), "
                 "or --sync to fetch everything still missing")

    if not os.path.exists(CATALOGUE):
        say(f"No catalogue at {CATALOGUE}\nRun: python ReDesign/tools/build_library.py")
        return 1

    if args.reindex:
        # The manifest is what lets the site serve a local copy, and a run that
        # was interrupted — or filtered differently — leaves files on disk that
        # it never recorded. This re-derives it from the folder itself.
        books = load_books(args)
        present = [b for b in books if already_have(args.out, b)]
        say(f"{len(present)} of {len(books)} catalogue books found on disk")

        known = existing_checksums(args.out)
        rows = []
        for i, b in enumerate(present, 1):
            dest = destination(args.out, b)
            row = {**meta_of(b), **on_disk_facts(dest, args.out)}
            # Hashing 12 MB apiece adds up over thousands of files, so only
            # checksum what has not been checksummed before.
            digest = known.get(row["file"])
            if not digest:
                say(f"  hashing {i}/{len(present)}  {b['title'][:44]}")
                digest = sha256_of(dest)
            row["sha256"] = digest
            rows.append(row)

        write_manifest(args.out, rows)
        return 0

    if args.covers:
        # Driven from the manifest rather than the catalogue: it is the record
        # of what is actually on disk, and it already lists the PDFs unpacked
        # out of archives, which the catalogue knows nothing about.
        rows = load_manifest_rows(args.out)
        if not rows:
            say("No manifest yet — download something first, or run --reindex.")
            return 1

        made = kept = missed = 0
        for i, row in enumerate(rows, 1):
            pdf = os.path.join(args.out, row["file"].replace("/", os.sep))
            had = row.get("cover")
            # Rows written before ids existed fall back to the file path, which
            # is unique per row and just as stable a key.
            row["cover"] = render_cover(pdf, args.out, row.get("id") or row["file"])
            if not row["cover"]:
                missed += 1
            elif had:
                kept += 1
            else:
                made += 1
                if made % 25 == 0:
                    say(f"  {i}/{len(rows)}  {row['title'][:44]}")

        write_manifest(args.out, rows)
        say(f"\ncovers: {made} rendered · {kept} already there · {missed} unavailable")
        if missed:
            say("Those fall back to the Drive thumbnail on the shelf.")
        return 0

    if args.retry_failed:
        # Retrying spans the whole catalogue: a book that failed under one
        # filter should be reachable again without repeating that filter.
        args.all = True
        args.level = None
        args.years = set()
        args.grades = set()

    books = load_books(args)

    if args.retry_failed:
        wanted = load_failures(args.out)
        if not wanted:
            say("No recorded failures — nothing to retry.")
            return 0
        books = [b for b in books if identity(b["sources"]) in wanted]
        if not books:
            say("The recorded failures no longer match the catalogue. "
                "Rebuild it with build_library.py.")
            return 1

    if not books:
        say("Nothing matches those filters.")
        return 1

    # Report what is missing rather than counting to 2,819 and skipping most of
    # it — and stop early when there is genuinely nothing to fetch.
    # --dry-run is included: "what would this fetch" means the books actually
    # missing, not the whole scope. --force is the flag that means everything.
    if not (args.force or args.estimate):
        missing = [b for b in books if not already_have(args.out, b)]
        have = len(books) - len(missing)
        if have:
            say(f"{len(books)} books in scope · {have} already downloaded")
        if not missing:
            say("Everything in scope is already on disk. Nothing to do.")
            if not args.dry_run:
                write_manifest(args.out, [
                    {**meta_of(b), "file": rel(destination(args.out, b), args.out)}
                    for b in books])
            return 0
        books = missing

    # Checked here, after the already-downloaded ones have been filtered out,
    # so the projection is for what this run would actually add.
    if not check_space(args, books):
        return 1

    say(f"{len(books)} books to fetch\n")

    if args.estimate:
        estimate(books)
        return 0

    if args.dry_run:
        for b in books:
            say(f"  {rel(destination(args.out, b), args.out)}")
        say(f"\n{len(books)} files would be written under {args.out}")
        return 0

    run(books, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
