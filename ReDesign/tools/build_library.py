#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build ReDesign/data/library.json from the crawl artifacts.

Re-decodes every `<rt-renderer encoded-content="...">` block in the 355 crawled
pages (see API_Documentation.md section 16) and pulls out subject-labelled
download links. The existing nested_content_links.json only kept bare hrefs, so
the subject names ("আমার বাংলা বই", "English for Today", ...) are recovered here
by walking the CKEditor table structure the content editors actually used.

Run from the repository root:  python ReDesign/tools/build_library.py
"""

import base64
import glob
import html
import json
import os
import re
import sys
import unicodedata
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "ReDesign", "data", "library.json")

BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


def nfc(s):
    """Canonicalise Bengali text before any substring match.

    The portal's titles use precomposed য় (U+09DF), ড় (U+09DC) and ঢ় (U+09DD)
    while source literals typed here decompose to base + nukta. Those are
    canonically equivalent but not equal, so every keyword below silently
    failed to match until both sides were normalised. NFC settles on the
    decomposed spelling for this range (the precomposed forms are composition
    exclusions), which is all we need — both sides just have to agree.
    """
    return unicodedata.normalize("NFC", s or "")

# Bengali ordinals -> grade number. Longest forms first so "একাদশ" never
# matches inside "দ্বাদশ" handling and "প্রথম" is not shadowed by anything.
GRADES = [
    ("দ্বাদশ", 12), ("একাদশ", 11), ("১২শ", 12), ("১১শ", 11),
    ("দশম", 10), ("১০ম", 10),
    ("নবম", 9), ("৯ম", 9),
    ("অষ্টম", 8), ("৮ম", 8),
    ("সপ্তম", 7), ("৭ম", 7),
    ("ষষ্ঠ", 6), ("৬ষ্ঠ", 6),
    ("পঞ্চম", 5), ("৫ম", 5),
    ("চতুর্থ", 4), ("৪র্থ", 4),
    ("তৃতীয়", 3), ("৩য়", 3),
    ("দ্বিতীয়", 2), ("২য়", 2),
    ("প্রথম", 1), ("১ম", 1),
]

# Order matters: "প্রাক-প্রাথমিক" and "উচ্চ মাধ্যমিক" must win over their
# substrings "প্রাথমিক" / "মাধ্যমিক".
LEVELS = [
    ("প্রাক-প্রাথমিক", "pre-primary", "Pre-primary"),
    ("প্রাক প্রাথমিক", "pre-primary", "Pre-primary"),
    ("উচ্চ মাধ্যমিক", "higher-secondary", "Higher secondary"),
    ("ইবতেদায়ি", "ebtedayi", "Ebtedayi"),
    ("ইবতেদায়ী", "ebtedayi", "Ebtedayi"),
    ("দাখিল", "dakhil", "Dakhil"),
    ("কারিগরি", "vocational", "Vocational"),
    ("ভোকেশনাল", "vocational", "Vocational"),
    ("ট্রেড", "vocational", "Vocational"),
    ("প্রাথমিক", "primary", "Primary"),
    ("মাধ্যমিক", "secondary", "Secondary"),
]

KINDS = [
    ("শিক্ষক সহায়িকা", "teacher-guide", "Teacher guide"),
    ("শিক্ষক প্রশিক্ষণ", "teacher-guide", "Teacher guide"),
    ("শিক্ষক ডায়েরি", "teacher-guide", "Teacher guide"),
    ("পাঠ্যপুস্তক", "textbook", "Textbook"),
    ("পাঠ্যপুস্তকের", "textbook", "Textbook"),
    ("শিক্ষাক্রম", "curriculum", "Curriculum"),
    ("মূল্যায়ন", "assessment", "Assessment"),
    ("প্রতিবেদন", "report", "Report"),
    ("নির্দেশিকা", "guideline", "Guideline"),
    ("ফরম", "form", "Form"),
    ("দরপত্র", "tender", "Tender"),
    ("বিজ্ঞপ্তি", "notice", "Notice"),
]

TAG_RE = re.compile(r"<[^>]+>")
ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr\s*>", re.S | re.I)
CELL_RE = re.compile(r"<t[dh]\b[^>]*>(.*?)</t[dh]\s*>", re.S | re.I)
ANCHOR_RE = re.compile(r"<a\b[^>]*?href\s*=\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a\s*>", re.S | re.I)
ENCODED_RE = re.compile(r'encoded-content="([^"]*)"')

# Cells that only carry a serial number or the word "download" are structural,
# never a subject name.
SERIAL_RE = re.compile(r"^[\d০-৯]+\s*[।.)\-]?$")
NOISE = ("ডাউনলোড", "download", "লিংক", "link", "ক্রমিক", "নং")


def text_of(fragment):
    """Strip tags and normalise whitespace/entities out of an HTML fragment."""
    txt = TAG_RE.sub(" ", fragment)
    txt = html.unescape(txt).replace("\xa0", " ")
    return re.sub(r"\s+", " ", txt).strip()


def is_label(txt):
    if not txt or SERIAL_RE.match(txt):
        return False
    low = txt.lower()
    if any(n in low for n in NOISE):
        return False
    return len(txt) > 1


def classify_link(url):
    """Map a raw href to a source kind plus, for Drive, its file id."""
    u = url.strip()
    low = u.lower()
    if "drive.google.com" in low:
        m = re.search(r"/file/d/([\w-]{10,})", u) or re.search(r"[?&]id=([\w-]{10,})", u)
        return {"url": u, "source": "drive", "fileId": m.group(1) if m else None}
    if "docs.google.com" in low:
        return {"url": u, "source": "gdocs", "fileId": None}
    if "drive.egovcloud.gov.bd" in low:
        return {"url": u, "source": "egov", "fileId": None}
    if "objectstorage" in low and "oraclecloud" in low:
        # Only these carry `access-control-allow-origin: *`, so only these can
        # stream straight into pdf.js without the user handing us the file.
        return {"url": u, "source": "oracle", "fileId": None}
    if u.startswith("/pages/") or "nctb.gov.bd" in low:
        # In-body navigation to another portal page, not a downloadable file.
        return {"url": u, "source": "internal", "fileId": None}
    return {"url": u, "source": "other", "fileId": None}


def extract_items(doc):
    """Pull (label -> links) pairs out of one decoded content body.

    The editors laid these out as tables where a subject cell is followed by one
    or more cells of download links, sometimes twice per row (Bangla version and
    English version columns). We walk cells left to right, remembering the last
    text-only cell as the label for any link cells that follow it.
    """
    items = []
    order = {}
    seen_urls = set()

    def add(label, url):
        if url in seen_urls:
            return
        seen_urls.add(url)
        key = label or "Download"
        if key not in order:
            order[key] = len(items)
            items.append({"label": key, "links": []})
        items[order[key]]["links"].append(classify_link(url))

    consumed = 0
    for row in ROW_RE.finditer(doc):
        consumed += 1
        label = None
        for cell in CELL_RE.finditer(row.group(1)):
            body = cell.group(1)
            hrefs = ANCHOR_RE.findall(body)
            if hrefs:
                for href, inner in hrefs:
                    add(label or text_of(inner), href)
            else:
                txt = text_of(body)
                if is_label(txt):
                    label = txt

    if not consumed:
        # Not a table: paragraphs/lists of links. Fall back to anchor text.
        for href, inner in ANCHOR_RE.findall(doc):
            add(text_of(inner), href)
    else:
        # Catch anchors that sat outside the table entirely.
        table_span = "".join(m.group(0) for m in ROW_RE.finditer(doc))
        for href, inner in ANCHOR_RE.findall(doc):
            if href not in seen_urls and href not in table_span:
                add(text_of(inner), href)

    for it in items:
        it["links"] = [l for l in it["links"] if not l["url"].strip().startswith("#")]
    return [it for it in items if it["links"]]


GRADE_LEVELS = {
    "primary": ("Primary", range(1, 6)),
    "secondary": ("Secondary", range(6, 11)),
    "higher-secondary": ("Higher secondary", range(11, 13)),
}


def classify_page(title):
    t = nfc(title)
    years = sorted({int(y) for y in re.findall(r"(?:19|20)\d{2}", t.translate(BN_DIGITS))
                    if 1990 <= int(y) <= 2100})
    # A title may name more than one class. Secondary textbooks are published
    # as "নবম-দশম শ্রেণির" — one book serving classes 9 and 10 — and taking only
    # the first match filed all of them under 10, leaving class 9 looking almost
    # empty. Collect every class mentioned; `grade` stays the lowest, for
    # sorting and for the folder a download lands in.
    grades = sorted({n for word, n in GRADES if nfc(word) in t})
    grade = grades[0] if grades else None
    level = next(((s, lab) for word, s, lab in LEVELS if nfc(word) in t), (None, None))
    kind = next(((s, lab) for word, s, lab in KINDS if nfc(word) in t), ("document", "Document"))
    english = any(nfc(v) in t for v in ("ইংরেজি ভার্সন", "ইংরেজী ভার্সন", "English Version"))

    # A grade implies a level even when the title never names one ("২০২৬
    # শিক্ষাবর্ষের শিক্ষক সহায়িকা- ১ম শ্রেণি" is primary by definition).
    if level[0] is None and grade is not None:
        for slug, (label, span) in GRADE_LEVELS.items():
            if grade in span:
                level = (slug, label)
                break

    return {
        "year": years[-1] if years else None,
        "grade": grade,
        "grades": grades,
        "level": level[0],
        "levelLabel": level[1],
        "kind": kind[0],
        "kindLabel": kind[1],
        "version": "english" if english else "bangla",
    }


def load_titles():
    titles = {}
    with open(os.path.join(ROOT, "nested_routes_catalog.json"), encoding="utf-8") as fh:
        for rec in json.load(fh):
            titles[rec["path"]] = {
                "title": (rec.get("title") or "").strip(),
                "depth": rec.get("depth", 0),
                "parents": rec.get("parents", []),
                "children": rec.get("children", 0),
            }
    return titles


def load_pages():
    """Map crawled HTML files to their route path via the catalog's object ids."""
    files = {}
    for path in glob.glob(os.path.join(ROOT, "crawl", "nested*", "*.html")):
        base = os.path.basename(path)[:-5]
        key = base.split("_")[-1] if base.startswith("_pages") else base
        files.setdefault(key, path)
    return files


def main():
    titles = load_titles()
    files = load_pages()
    records = []
    missing = 0

    for path, meta in titles.items():
        ident = path.rstrip("/").split("/")[-1]
        objid = ident.split("-")[-1]
        src = files.get(ident) or files.get(objid)
        if not src:
            missing += 1
            continue

        raw = open(src, encoding="utf-8", errors="replace").read()
        items = []
        for enc in ENCODED_RE.findall(raw):
            enc = html.unescape(enc).strip()
            if not enc:
                continue
            try:
                doc = base64.b64decode(enc).decode("utf-8", errors="replace")
            except Exception:
                continue
            items.extend(extract_items(doc))
        if not items:
            continue

        # Merge duplicate labels produced by multi-block pages.
        merged, seen = [], {}
        for it in items:
            if it["label"] in seen:
                known = {l["url"] for l in merged[seen[it["label"]]]["links"]}
                merged[seen[it["label"]]]["links"].extend(
                    l for l in it["links"] if l["url"] not in known)
            else:
                seen[it["label"]] = len(merged)
                merged.append(it)

        # Split in-body navigation out of the download list so link counts and
        # the reader only ever see real files.
        related = []
        for it in merged:
            keep = []
            for l in it["links"]:
                (related if l["source"] == "internal" else keep).append(l)
            it["links"] = keep
        merged = [it for it in merged if it["links"]]
        if not merged:
            continue

        rec = {
            "path": path,
            "title": nfc(meta["title"]),
            "items": [{"label": nfc(it["label"]), "links": it["links"]} for it in merged],
            "related": sorted({l["url"] for l in related}),
        }
        rec.update(classify_page(meta["title"]))
        rec["linkCount"] = sum(len(i["links"]) for i in merged)
        rec["sources"] = sorted({l["source"] for i in merged for l in i["links"]})
        # First Drive id on the page doubles as the collection's cover image.
        rec["cover"] = next((l["fileId"] for i in merged for l in i["links"]
                             if l["source"] == "drive" and l["fileId"]), None)
        records.append(rec)

    records.sort(key=lambda r: (-(r["year"] or 0), r["grade"] or 99, r["title"]))

    stats = {
        "pages": len(records),
        "links": sum(r["linkCount"] for r in records),
        "titles": sum(len(r["items"]) for r in records),
        "bySource": dict(Counter(l["source"] for r in records
                                 for i in r["items"] for l in i["links"])),
        "byKind": dict(Counter(r["kind"] for r in records)),
        "years": sorted({r["year"] for r in records if r["year"]}),
        "grades": sorted({g for r in records for g in (r.get("grades") or [])}),
        "levels": sorted({r["level"] for r in records if r["level"]}),
        "generated": "2026-08-16",
        "note": "Decoded from rt-renderer blocks in the 2026-08-15 recursive crawl of nctb.gov.bd.",
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"stats": stats, "collections": records}, fh, ensure_ascii=False, separators=(",", ":"))

    print("pages with links :", stats["pages"])
    print("titles           :", stats["titles"])
    print("links            :", stats["links"])
    print("no crawl file    :", missing)
    print("by source        :", stats["bySource"])
    print("by kind          :", stats["byKind"])
    print("years            :", stats["years"])
    print("bytes            :", os.path.getsize(OUT))


if __name__ == "__main__":
    sys.exit(main())
