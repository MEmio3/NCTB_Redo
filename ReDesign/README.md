# পাঠ্যপুস্তক — NCTB textbook shelf & reader

Two pages. Nothing else.

| Page | What it is |
|---|---|
| `index.html` | **The shelf.** Pick a class → year → your books. Covers, not filters. |
| `reader.html` | **The reader.** Full-page PDF reading with highlighter, pen, notes and bookmarks that stay on your device. |

No build step, no framework, no accounts.

On Windows, double-click **`start.bat`** — it finds Python, starts the server
and opens a browser. It also handles the two things that otherwise look like
the command is broken: it says so plainly when the site is *already* running,
and when port 8899 is held by something else it names the process instead of
failing with `WinError 10048`.

Or run it directly, from the repository root:

```bash
python ReDesign/tools/serve.py
```

...or from inside `ReDesign/`, which is where you probably are:

```bash
python tools/serve.py
```

Then open **<http://localhost:8899/>** — the shelf. A server is required (not
`file://`) because the pages use ES modules.

`serve.py` serves the **ReDesign folder** as the web root and adds the one
`/api/drive` endpoint that lets Google Drive books open inline, matching what
the deployed site gets. Two reasons not to substitute a plain static server:

- Live Server or `python -m http.server` have no `/api/drive`, so every Drive
  book silently falls back to Google's viewer, where annotation is off.
- Serving the *repository* root puts an older, unrelated `index.html` (the
  "NCTB Endpoints" API reference) at `/`, which looks like the site reverted.

---

## The shelf

A student's path is *my class → this year → my subject*, so the page is laid
out in exactly that order:

1. **Pick a class** — large targets, book counts, nothing else on screen.
2. **Year and stream** narrow it, and the year defaults to the newest edition
   that class actually has rather than every edition ever printed.
3. **The books** — real covers from Drive thumbnails; the cover *is* the card.

Search short-circuits all of it for anyone who knows the title, in Bangla or
English, and scrolls the results into view — they sit below a full-height hero,
so leaving the page where it was meant hunting for them by hand. State lives in
the URL (`?class=6&year=2026&level=secondary`).

Almost every book here carries a **Bengali** title, so an English query used to
match almost nothing: "Bangla" returned six books, every one of them
*Bangladesh and Global Studies* — the only English title containing the word —
and not one of the বাংলা readers the search was for. `SUBJECT_WORDS` in
`shelf.js` folds English names for the common subjects into each book's search
text at load, which takes that query to 416 results with আমার বাংলা বই first.
Add a pair there when a subject is missing.

The catalogue is stored as collection *pages*, which is not how anyone looks
for a book, so `shelf.js` flattens it into individual books once at load and
de-duplicates on the underlying file.

Each book carries a `grades` **list**, not one class. A secondary textbook is
published for "নবম-দশম" — classes 9 and 10 together — and taking only the first
ordinal in the title filed all 33 such collections under class 10, leaving
class 9 showing 88 books instead of 731. Filter on membership, never on
equality with `grade` (which is just the lowest, for sorting).

## The reader

Default is **one page, sized to fit the screen**. Fit-page takes the smaller
of the width and height ratios; fit-*width* — which is all a naive
implementation does — always overflows a portrait page and turns reading into
scrolling.

- **Turn pages**: click either side of the page, arrow keys, space
  (shift+space back), PageUp/Dn, Home/End.
- **Three ways to read**:
  | | | |
  |---|---|---|
  | `1` | Single page | one sheet, sized to fit |
  | `2` | Vertical scroll | continuous, for skimming |
  | `3` | Horizontal scroll | a strip swept sideways, snapping page to page |
- **Arrow keys follow the axis the mode moves in.** Single page: all four turn,
  unless the page is zoomed past the window, when they pan it instead — being
  unable to reach the bottom of a zoomed page is worse than lacking a shortcut.
  Vertical scroll: up/down scroll, left/right jump a page. Horizontal: both
  jump a page, because that mode snaps mandatorily and a part-scroll springs
  back. The scroller is a `div`, so the browser only scrolls it with the arrows
  when it happens to hold focus; the reader drives it explicitly instead.
- **Held keys are rate-limited.** Auto-repeat delivers ~30 keydowns a second
  and turning on each threw the reader 25 pages in well under a second. Repeats
  turn at most one page per 340 ms (~3/sec) and scroll in shorter, more
  frequent steps; a deliberate tap is gated at 110 ms, short enough that no
  real press is ever swallowed.
- **Page turn style** `X` — *curl* peels the corner, showing the back of the
  sheet as it turns (the default, see below); *slide* is a quieter lateral
  shift.
- **Fullscreen** `F` — the bars retract and come back on pointer move.
- **Fit** cycles page → width → actual (`0` resets); zoom is separate (`+`/`-`).
- **Tools**: move `V`, highlight `H`, pen `P`, box `R`, note `N`, text `T`,
  erase `E`, bookmark `B`, undo `Ctrl+Z`.

> **The bottom bar is currently parked.** `SHOW_BOTTOM_BAR` in
> `assets/js/reader.js` is `false` while the reading experience is being worked
> on, which hides the pager, scrubber, annotation toolbar and zoom buttons. The
> markup and every handler are untouched — set it back to `true` to restore the
> bar whole. Until then those functions are keyboard-only: the shortcuts above
> plus `+`/`-` for zoom.
>
> **Fit is the exception** and now lives in the top bar, beside the view modes.
> Parking the bottom bar took the only fit control with it, which left no way
> to change how a page is sized — the one setting a reader reaches for most.

### The page curl

`assets/js/curl.js`. One sheet turns; the next page was underneath all along
and the turn uncovers it. Three layers in the page's own pixel space: the
outgoing page clipped to what is still flat, and a copy of it clipped to the
peeled corner and **reflected across the fold** — the reflection is the point,
since it is what shows the back of the sheet, mirrored and quarter-turned, the
way a real page reads when you hold it over.

The fold is the line `n·p = d` sweeping corner to corner (`n = (1,1)` forward,
`(-1,1)` back). Each side is derived by clipping the page rect against that
half-plane — a triangle at the corners, a pentagon through the middle — rather
than special-casing the phases. `curlFrame()` is pure, so the whole sweep can
be checked a frame at a time without running an animation: at every `t` the two
clipped areas sum exactly to the page, and the fold matrix has determinant −1.

Three things are easy to get wrong here and all three look like "the shading is
a bit off" rather than like bugs:

- `transform-origin` **must** be `0 0`. The matrix is derived in page
  coordinates; CSS otherwise applies it about the element's centre and the
  sheet lands in the wrong half of the page.
- `clip-path` is applied *after* `filter`, so a shadow on the element that
  carries the clip is clipped away by it. The flap and the clipped sheet are
  therefore two elements.
- Gradients are anchored to the element box while the fold travels across it,
  so a fixed-stop gradient drifts off the fold within a few frames. The crease
  stops are placed relative to `--fold`, set per frame.

**Turning back is the same motion run backwards, not a mirrored one.** A book
has no separate gesture for going back: the sheet you just turned lifts off the
left-hand stack and settles onto the right along the identical arc. So the
backward turn replays the forward fold from finished to flat, and the sheet
that moves is the page *coming back* — the page being left simply lies there
until it is covered. Peeling the current page away to the left instead, which
is what a mirrored animation does, is a motion no book makes, and it looked it.

That flap copies the returning page's face, so a rendered page makes a better
one — but the turn is never hostage to the render. It waits at most 140 ms for
`warmNeighbours` to have the page ready, then moves regardless, and the page
being left is removed in a `finally` so a failed turn cannot leave two pages
stacked in the deck for good.

A real sheet curves. Doing that honestly needs WebGL; a straight fold is exact
rather than approximate, and at turn speed what sells it is not the curvature
but seeing the reverse of the sheet, the shadow it drops on the page beneath,
and the crease travelling with the fold.

Each page is scaled against **its own** dimensions, not the current page's.
NCTB scans are not uniformly sized, and one shared ratio leaves the odd taller
sheet clipped — obvious in the horizontal strip.

Two layout constraints hold the shell together and should not be removed:
`.reader` needs `grid-template-columns: minmax(0, 1fr)` and `.frame` needs
`min-width: 0`. A grid item's automatic minimum size is its content, so
without them a 122-page horizontal strip stretches the whole app to ~59,000px
and every measurement downstream collapses.

Marks are stored in normalised page coordinates (0..1 on both axes) and drawn
through an SVG overlay with `viewBox="0 0 1 1"`, so zoom and resize cost
nothing. That overlay needs an explicit `width/height: 100%`: an `<svg>` takes
an intrinsic aspect ratio from its viewBox, so `inset: 0` alone leaves it
square and every y-coordinate lands in the wrong place.

Scrolling lives on an inner element rather than the stage, so an enlarged page
can be panned while the click-to-turn zones stay pinned.

Everything a reader makes lives in IndexedDB (`nctb-atlas`): `docs` (position),
`marks` (annotations), `files` (the PDF bytes, so a book opened once reopens
offline). Nothing is uploaded; there is no server to upload to.

---

## Where the books come from

| Host | Browser can read bytes? |
|---|---|
| `objectstorage…oraclecloud15.com` | **Yes** — `access-control-allow-origin: *` |
| `drive.google.com` | **No, by design** — see below |
| `drive.egovcloud.gov.bd` | No — real PDF, but no CORS header |

`drive.usercontent.google.com` *looks* like the fix: to `curl` it returns 206
with `access-control-allow-origin: *`. It is a decoy. Replay the same request
with browser metadata (`Sec-Fetch-Mode: cors`, a `Referer`) and it becomes
`403 text/html` with no CORS header. Google serves the permissive header only
to clients that are not browsers. **Never conclude a Google host is CORS-open
from `curl` alone.**

So the fix ships with the site: a ~40-line function that fetches server-side
and re-emits with usable CORS, forwarding `Range` so streaming still works.

| Host | File | Setup |
|---|---|---|
| Cloudflare Pages | `functions/api/drive.js` | none |
| Vercel | `api/drive.js` | none |
| Netlify | `netlify/functions/drive.js` | one redirect in `netlify.toml` |

Deploy to any of them and Drive books open inline. **Nobody configures
anything** — a student should never meet the words "API key".

`serve.py` sends `Cache-Control: no-store` for everything except `books/`.
Without it a browser caches ES modules heuristically, an edit appears not to
apply, and — the part that really costs time — a stale module keeps throwing
errors from code that no longer exists, which reads as a phantom bug.

### You must run `serve.py`, not a plain static server

Live Server, `python -m http.server` and GitHub Pages have no `/api/drive`, so
**every Drive book silently falls back to Google's viewer** — where annotation
is off and Drive refuses its own larger files with "too large to preview".
That message looks like this app failing; it is not. The reader now names the
cause on screen and in the console instead of degrading quietly.

### Three upstream failures the endpoint handles

1. **The large-file interstitial.** Past a certain size Google interposes a
   virus-scan confirmation page. `confirm=t` is the token that page would have
   submitted, so it is sent up front.
2. **Rate limiting.** Google answers *HTML with a 200* — "Too many users have
   viewed or downloaded this file recently" — for popular files. Relayed
   as-is that reaches pdf.js as a corrupt PDF, so the endpoint detects
   `text/html` and returns **502** instead, letting the reader move on.
3. **Alternates.** `?u=<url>` relays an allow-listed government mirror
   (`drive.egovcloud.gov.bd`, NCTB's Object Storage); anything off the
   allow-list gets a 400, so this is never an open proxy. Shelf links carry
   **every other file NCTB lists for the same book** as `alts=` — the mirror
   plus any sibling Drive copy — and the reader works down the list. One link
   is a single point of failure; three usually are not.

   eGov links in the catalogue are share *pages*, not files. Only the
   `/download` form returns bytes, so `mirrorURL()` normalises before relaying
   — otherwise the proxy dutifully fetches an HTML page.

**Bandwidth note.** `disableAutoFetch` is off, so pdf.js pulls the rest of the
book in the background after page one. That is a deliberate trade: with it on,
every page turn waited on the network and the reader felt broken. First-page
latency is unchanged; **Keep offline** then costs almost nothing.

Some books simply cannot be rescued — if Google has rate-limited every copy
NCTB lists and there is no mirror, the reader falls back to Drive's viewer and
says so. Google's limit clears within about 24 hours.

The probe of `./api/drive` is only an optimisation. The endpoint is **always**
tried for the actual book, because a stale "no" cached in `sessionStorage`
would otherwise disable Drive for the whole tab.

On a host with no functions (GitHub Pages) the probe fails quietly and Drive
books fall back to Drive's own viewer, with two numbered buttons to unlock
annotation. Whoever published the site can also open **Storage → সাইট সেটআপ**
and supply an API key or proxy; nothing in the reading path mentions it.

Streaming uses `disableAutoFetch`, so only the pages actually read are
fetched — glancing at page one of a 30 MB textbook does not cost 30 MB.
**অফলাইনে রাখুন** is the explicit opt-in that stores the whole file.

---

## Downloading the books

`tools/fetch_books.py` fetches books and files them under `books/`:

```
books/<year>/class-<NN>/<level>/<subject>.pdf
books/covers/<hash>.jpg      cover art, rendered from page 1
books/manifest.json          the local library database
books/failed.json            what to retry, written only when something fails
```

The catalogue reaches back to **2017**, but only the recent years are stored
here — see *Which years live on disk* below.

```bash
python ReDesign/tools/fetch_books.py --sync            # the served years, minus what you have
python ReDesign/tools/fetch_books.py --retry-failed    # only what failed last time
python ReDesign/tools/fetch_books.py --reindex         # rebuild the manifest, fetch nothing
python ReDesign/tools/fetch_books.py --covers          # (re)render cover art, fetch nothing

python ReDesign/tools/fetch_books.py --class 1-10      # a range
python ReDesign/tools/fetch_books.py --class 1,3,5     # a list
python ReDesign/tools/fetch_books.py --year 2025-2026  # years take a range or list too
python ReDesign/tools/fetch_books.py --year 2026 --class 6
python ReDesign/tools/fetch_books.py --sync --estimate # size it first
```

**`--sync` is the one to run.** Run it, interrupt it, run it again, run it next
month when NCTB publishes a new year. It reports `N books in scope · M already
downloaded` and stops early when there is nothing left. `--dry-run` shows the
same delta without fetching.

### Which years live on disk

Two tiers, and the split is deliberate:

| Year | Served from | Why |
|---|---|---|
| **2026, 2025** | `books/` on this origin | What students actually read. Opens instantly, never touches Google, cannot be rate-limited. |
| 2024 and older | NCTB, via `/api/drive` | Still fully readable — just fetched on demand rather than stored. Keeping them all would cost ~200 GB. |

`SERVED_YEARS` in `fetch_books.py` defines the first tier, and a plain `--sync`
covers exactly those years. Older years are one flag away:

```bash
python ReDesign/tools/fetch_books.py --year 2024   # add an older year
python ReDesign/tools/fetch_books.py --sync --all  # the entire catalogue, ~200 GB
```

The shelf reflects this without being told: it marks a year pill with a dot
once ~all of that year's catalogue entries are on disk, and warns when a
selected year will stream instead. Widen `SERVED_YEARS`, download the year, and
the dot appears on its own. Nothing needs editing in two places.

### Covers come from the books, not from Google

The shelf used to show Drive's thumbnail for each book. Drive rate-limits
thumbnails the same way it rate-limits files, and a limited id returns *nothing*
— which is why popular books sat as grey tiles even after the PDF was
downloaded here.

Page one of a book we hold **is** its cover, so the fetcher renders it (PyMuPDF,
~0.2 s a book) into `books/covers/` and records the path in the manifest. The
shelf prefers that and keeps the Drive thumbnail only as a fallback — the same
local-first order used for the books themselves. All **594** downloaded books
have one; the whole set is **30 MB**.

This happens automatically on download. `--covers` backfills books fetched
before the feature existed, and is safe to re-run — existing covers are kept.

If PyMuPDF is missing the render is skipped rather than failing, and those books
fall back to Drive. To enable it: `pip install pymupdf`.

### Size — read this before `--sync`

These scans are **much** bigger than they look. Across the 594 books actually
downloaded: **30.8 GB**, mean **52 MB**, median **45 MB**, with a tail to
**485 MB**. A small sample badly understates this — do not extrapolate from
twenty books.

| Scope | Books | Roughly |
|---|---:|---:|
| `--sync` (2026 + 2025) | 584 | **~31 GB** — measured, not projected |
| `--year 2024` | 267 | ~14 GB |
| `--class 1-10` | 2,517 | ~130 GB |
| `--sync --all` (2017-2026) | 3,167 | ~165 GB |

The tool **refuses to start a run it cannot finish**: it projects from the
average size of what you already hold, compares against free space, and stops
with suggestions rather than filling the disk halfway through. `--yes`
overrides, `--out D:/books` sends it elsewhere.

- **Resumes.** Files already on disk are skipped, so an interrupted run picks
  up where it stopped. `--force` re-fetches.
- **Mirror first, Google last.** The reader prefers Drive because it is fast
  for one book; the fetcher does the opposite. Pulling thousands of files is
  exactly what makes Google start refusing, so anything with a government
  mirror is taken from the mirror and Google is never asked — leaving its
  quota for the books that have no alternative.
- **Backs off when throttled.** A quota response slows every worker, not just
  the one that hit it, and the delay winds back down over a clean stretch.
  Hammering through a refusal only deepens it.
- **Remembers what failed** in `books/failed.json`, so `--retry-failed`
  re-attempts only those. Entries disappear as they succeed.
- **Never writes a file that is not really a PDF.** Google's rate-limit page
  is HTML with a *200* status; saved as `.pdf` it would be worse than nothing.
- **Stable filenames.** A book is identified by its Drive file id, not by
  whichever mirror happens to be preferred, so changing the source order does
  not rename files and re-download the archive.
- **Some names collide on purpose.** NCTB lists two different `প্রাথমিক গণিত`
  files in one class (the book comes in two parts), so ties get a short tag
  derived from the source — stable across runs, unlike a counter.
- **A book can belong to two classes.** Secondary textbooks are published as
  "নবম-দশম শ্রেণির" — one book for classes 9 *and* 10 — so `--class 9` and
  `--class 10` both select them, and they land in `books/<year>/class-09-10/`.
- Anything the catalogue could not classify lands in `books/unsorted/` rather
  than being dropped.

### manifest.json is the database

Not a file list — everything the site needs to decide *which* copy to serve,
without consulting the catalogue or the network:

```jsonc
{
  "generated": "2026-09-02T03:01:11",
  "count": 165,
  "bytes": 11830000000,
  "years":  [2026, 2024],            // what is actually held
  "byYear":  { "2026": 162, "2024": 3 },
  "byClass": { "1": 22, "2": 18, ... },
  "latestByClass": { "1": 2026, ... }, // newest edition held per class
  "books": [{
    "id": "drive:1UX9fbOB…",          // stable, survives mirror changes
    "title": "English for Today",
    "year": 2026, "grades": [1], "level": "primary",
    "version": "bangla", "kind": "textbook",
    "file": "2026/class-01/primary/English-for-Today.pdf",
    "bytes": 14738438,
    "sha256": "973530b8…",            // integrity, and dedup across editions
    "downloadedAt": "2026-09-02T02:06:27",
    "via": "egov",                    // which mirror actually served it
    "path": "/pages/static-pages/695b9ade…",  // the NCTB page it came from
    "driveId": "1UX9fbOB…", "urls": [...]
  }]
}
```

`latestByClass` is the "know when to use what" part: it names the newest year
**actually held** for each class, which during a changeover is often last
year's edition rather than the one being printed. The shelf marks every book
it holds locally with a green dot.

**The site uses them automatically.** `books/` sits inside the web root and the
reader checks `manifest.json` before any network route, so a downloaded book
opens instantly, offline, and makes **zero** requests to Google — not even the
`/api/drive` capability probe, which is skipped when a local copy exists. That
is the fix for "too many users have viewed or downloaded this file recently":
once a book is in `books/`, Google's quota stops being able to affect it.

Nothing to configure — if the folder is empty the reader carries on as before.
If a run was interrupted or filtered differently, `--reindex` re-derives the
manifest from whatever is actually on disk.

## Data

`data/library.json` is generated — do not hand-edit:

```bash
python ReDesign/tools/build_library.py
```

It re-decodes the `rt-renderer` base64 blocks in the 355 crawled pages and
walks the CKEditor table structure to recover the **subject label** for each
link, which the repo's `nested_content_links.json` never captured (its
extraction also missed 76 pages, including all of 2026).

One trap: the portal's titles use precomposed য় (U+09DF), ড় (U+09DC) and
ঢ় (U+09DD), while the same characters typed as literals decompose to base +
nukta. Canonically equivalent, not equal — every Bengali match fails silently
until both sides go through NFC. The same normalisation runs in `shelf.js`
before searching.

---

## Files

```
ReDesign/
  index.html          the shelf
  reader.html         the reader
  assets/
    css/  tokens.css  app.css  shelf.css  reader.css
    js/   core.js  sources.js  bridge.js  store.js  annotate.js
          shelf.js  reader.js
    vendor/ pdf.min.js  pdf.worker.min.js  pdf-lib.min.js
  data/   library.json
  books/  downloaded PDFs + manifest.json (created by fetch_books.py)
  functions/api/drive.js · api/drive.js · netlify/functions/drive.js
  tools/  build_library.py  fetch_books.py  serve.py  cors-worker.js
```

`tokens.css` holds two rules worth keeping: **one accent** (amber means *your
marks*) and **the books supply the colour** — chrome stays paper, ink and
hairline so cover art is the brightest thing on screen. Light is the default;
dark is night reading, not the brand.

In `app.css`:

```css
[hidden] { display: none !important; }
```

Every panel is toggled with the `hidden` attribute, which only carries the UA
stylesheet's `display: none` — outranked by any author rule like
`.tools { display: flex }`. Without it the attribute is decorative. Assert
visibility with `getComputedStyle(el).display`, never `el.hidden`, which stays
correct while the element keeps rendering.

---

Books are the property of the National Curriculum and Textbook Board. This is
an independent reader built from a public crawl of nctb.gov.bd (15 August
2026); it indexes the links NCTB publishes and never rehosts a file.
