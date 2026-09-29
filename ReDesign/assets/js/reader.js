/* ==========================================================================
   NCTB Reader

   Three view modes over one page model:

     single   one page, sized to fit the stage — the default, because a
              textbook page you cannot see whole is not readable
     scroll   continuous vertical, for skimming
     hscroll  continuous horizontal, swept sideways and snapped per page

   In single mode only the current page exists in the DOM, and turning swaps it
   with a transition — a slide, or a flip in which the sheet itself pivots on
   its spine and sweeps away to uncover the page beneath. The scrolling modes
   mount every page and let the scroller move.

   Sources, in order: bytes cached in IndexedDB, a stream over HTTP range
   requests, or a file the reader hands us. Drive needs the bundled
   /api/drive endpoint (see bridge.js) and falls back to its own viewer.
   ========================================================================== */

import { $, $$, esc, debounce, toast, reduceMotion, bindTheme } from './core.js';
import { previewURL, driveDownloadURL, altURL, loadLocalIndex, localCopy } from './sources.js';
import { getBridge, setBridge, bridgeActive, driveStreamURL, driveCandidates, testBridge, detectAuto } from './bridge.js';
import { createAnnotator, paintMarks, PALETTE } from './annotate.js';
import { curlPage } from './curl.js';
import * as store from './store.js';

const pdfjs = window.pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = './assets/vendor/pdf.worker.min.js';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const FITS = ['page', 'width', 'actual'];
const FIT_LABEL = { page: 'Fit page', width: 'Fit width', actual: 'Actual size' };
const VIEWS = ['single', 'scroll', 'hscroll'];

/** Views where every page is mounted and the scroller does the moving. */
const SCROLLING = new Set(['scroll', 'hscroll']);

// The bottom bar (pager, scrubber, annotation tools, zoom) is parked while the
// reading experience itself is being worked on. Its markup and every handler
// are untouched, so flipping this back to true restores it whole. Keyboard
// still reaches all of it: h/p/r/n/t/e pick tools, +/-/0 zoom, B bookmarks.
const SHOW_BOTTOM_BAR = false;


const app = {
  doc: null,
  pdf: null,
  meta: [],          // { num, page, w, h } for every page, filled once
  mounted: new Map(),// num -> { box, canvas, task }
  marks: [],
  view: 'single',
  fit: 'page',
  zoom: 1,
  scale: 1,
  current: 1,
  tool: 'pan',
  turnStyle: 'flip',
  color: PALETTE[0].value,
  undoStack: [],
  editing: null,
  // The page a programmatic scroll is heading for, or null. While it is set,
  // the scroll observer does not get to decide what the current page is.
  seeking: null,
};

/* ==========================================================================
   Chrome
   ========================================================================== */

function setMode(mode) {
  document.body.dataset.mode = mode;
  $('#landing').hidden = mode !== 'empty';
  $('#preview-mode').hidden = mode !== 'preview';
  $('#bottombar').hidden = !SHOW_BOTTOM_BAR || mode !== 'doc';
  $('#deck').hidden = mode !== 'doc';
  $$('.turn').forEach((t) => { t.hidden = mode !== 'doc'; });

  // View modes, fullscreen and the rail's page list only mean anything when we
  // are rendering the PDF ourselves. In Drive's viewer they are dead controls,
  // so hide them rather than leave buttons that visibly do nothing.
  const own = mode === 'doc';
  $('#view-modes').hidden = !own;
  $('#fit-cycle').hidden = !own;
  $('#fullscreen').hidden = !own;
  $('#toggle-rail').hidden = !own;
  if (!own) $('#rail').dataset.open = 'false';
}

function loading(text) {
  const el = $('#stage-loading');
  if (!text) { el.hidden = true; return; }
  $('#loading-text').textContent = text;
  el.hidden = false;
}

let saveTimer;
function savedFlash(text = 'Saved') {
  const el = $('#save-state');
  el.hidden = false;
  $('#save-text').textContent = text;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { $('#save-text').textContent = 'Saved'; }, 1400);
}

function setTitle(title, sub) {
  $('#doc-title').textContent = title || 'Reader';
  $('#doc-sub').textContent = sub || '';
  document.title = title ? `${title} — Reader` : 'Reader — The Shelf';
}

const bytes = (n) =>
  n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB`
  : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB`
  : n >= 1024 ? `${Math.round(n / 1024)} KB`
  : `${n} B`;

/* ==========================================================================
   Opening
   ========================================================================== */

function intent() {
  const p = new URLSearchParams(location.search);
  return {
    docId: p.get('doc'), drive: p.get('drive'), url: p.get('url'),
    alts: p.get('alts'), title: p.get('title'), from: p.get('from'),
  };
}

async function boot() {
  const want = intent();

  buildSwatches();
  bindChrome();
  bindBridge();
  bindDragDrop();
  bindKeys();

  // A downloaded copy beats every network route, so know about it first.
  await loadLocalIndex();

  // Probing /api/drive costs a round trip to Google. Skip it entirely when the
  // book is already on disk — which, once the archive is filled, is the normal
  // case and the whole reason for keeping one.
  const haveLocally = Boolean(localCopy({ driveId: want.drive, url: want.url }));
  if (!haveLocally) {
    if (want.drive) await detectAuto(); else detectAuto();
  }
  await renderStorage();

  if (want.docId) {
    const doc = await store.getDoc(want.docId);
    if (doc) return openKnown(doc);
    toast('That book is no longer in this browser', 'bad');
  }
  if (want.drive) {
    const id = `drive:${want.drive}`;
    const existing = await store.getDoc(id);
    return openKnown(await store.putDoc({
      id, driveId: want.drive,
      title: want.title || existing?.title || 'Book',
      origin: 'drive', sourcePath: want.from || existing?.sourcePath || null,
      alts: want.alts || existing?.alts || null,
    }));
  }
  if (want.url) {
    const id = await store.docId({ url: want.url });
    return openKnown(await store.putDoc({
      id, url: want.url,
      title: want.title || decodeURIComponent(want.url.split('/').pop() || 'Document'),
      origin: 'url', sourcePath: want.from || null,
      alts: want.alts || null,
    }));
  }

  setMode('empty');
  renderRecent();
}

async function openKnown(doc) {
  app.doc = doc;
  setTitle(doc.title, '');

  const cached = await store.getFile(doc.id);
  if (cached) return openBytes(await cached.arrayBuffer(), doc, { cache: false });

  // Try every route this deployment might have before giving up on reading it
  // properly. Drive's own viewer is a last resort — it cannot be annotated and
  // it refuses files over its own preview limit.
  const urls = [];

  // books/ is filled by tools/fetch_books.py. When the book is already on this
  // machine it opens instantly, offline, with no Google involved at all.
  const local = localCopy({ driveId: doc.driveId, url: doc.url });
  if (local) urls.push(local);

  urls.push(...(doc.driveId ? driveCandidates(doc.driveId) : (doc.url ? [doc.url] : [])));
  // Every other file NCTB lists for this same book: the government mirror and
  // any sibling Drive copy. Google rate-limits popular files, so one link on
  // its own is a single point of failure.
  (doc.alts || '').split('|').filter(Boolean)
    .map(altURL).filter(Boolean)
    .forEach((u) => urls.push(u));

  for (const url of urls) {
    if (await openStream(url, doc)) return;
  }
  // Distinguish "this server cannot serve Drive at all" from "this one book
  // would not open" — they need completely different things from the reader.
  if (doc.driveId) return openPreview(doc, bridgeActive() ? 'failed' : 'no-endpoint');

  setMode('empty');
  renderRecent();
  toast('That book could not be opened — drop the PDF here', 'bad', 5000);
}

/**
 * Stream the document over HTTP range requests.
 *
 * `disableAutoFetch` is deliberately OFF. With it on, pdf.js fetches only the
 * ranges each page needs, which opens page one quickly but then makes every
 * single page turn wait on the network — the book feels broken. Letting it
 * pull the remainder in the background costs bandwidth once and makes turning
 * instant, which is the whole point of a reader.
 */
async function openStream(url, doc) {
  loading('Opening…');
  let settled = false;
  try {
    const task = pdfjs.getDocument({
      url, disableAutoFetch: false, disableStream: false, rangeChunkSize: 1 << 18,
    });
    task.onProgress = ({ loaded, total }) => {
      // Background fetching continues long after the document is usable, and
      // its progress events would otherwise re-raise the overlay over a page
      // the reader is already reading — the "loading forever" spinner.
      if (settled) return;
      const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
      loading(pct === null ? 'Opening…' : `Opening… ${pct}%`);
    };

    const pdf = await task.promise;
    settled = true;
    await attachPdf(pdf, doc);
    return true;
  } catch (err) {
    settled = true;
    console.warn('[reader] stream failed:', err);
    loading(null);
    return false;
  }
}

function openPreview(doc, reason = 'failed') {
  loading(null);
  setMode('preview');
  $('#preview-frame').src = previewURL(doc.driveId);
  $('#preview-download').href = driveDownloadURL(doc.driveId);
  $('#marks-empty').innerHTML = `
    <p>Highlighting needs the file.</p>
    <p class="muted">Use the two buttons above: get the file, then open it here.
    Your highlights and notes then stay with this book every visit.</p>`;

  // Drive's viewer refuses files past its own preview ceiling and answers with
  // "too large to preview", which reads as our failure rather than theirs. Be
  // specific about whose limit this is and what actually fixes it.
  const note = $('#preview-note-text');
  if (reason === 'no-endpoint') {
    note.innerHTML = `
      <b>This server can't open Drive books.</b>
      It has no <code>/api/drive</code> endpoint, so the book is falling back to
      Google Drive's viewer — where highlighting is off and Drive refuses its own
      larger files. Serve the site with <code>python ReDesign/tools/serve.py</code>,
      or deploy it to Cloudflare Pages, Vercel or Netlify, and books open here
      properly. The two buttons work either way.`;
    console.warn(
      '[reader] No /api/drive on this origin, so Drive books cannot stream.\n'
      + 'Run:  python ReDesign/tools/serve.py     (serves the site AND the endpoint)\n'
      + 'A plain static server — Live Server, python -m http.server — cannot do this,\n'
      + 'because Google refuses cross-origin reads of Drive files from a browser.');
  } else {
    note.innerHTML = `
      <b>This book wouldn't stream, so it's in Google Drive's viewer.</b>
      Highlighting is off here, and Drive refuses to preview its larger files at
      all. Either way the two buttons work: get the file, then open it here.`;
  }
}

async function openBytes(buffer, doc, { cache = true, name = '', blobType = 'application/pdf' } = {}) {
  loading('Reading…');
  try {
    const forCache = cache ? buffer.slice(0) : null;
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    if (forCache) {
      if (await store.putFile(doc.id, new Blob([forCache], { type: blobType }), name)) {
        store.persist().catch(() => {});
      }
    }
    await attachPdf(pdf, doc, name);
  } catch (err) {
    loading(null);
    console.error('[reader] could not read the PDF:', err);
    toast('That file could not be read as a PDF', 'bad');
    setMode('empty');
    renderRecent();
  }
}

async function openFile(file) {
  if (!file) return;
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    toast('That is not a PDF', 'bad');
    return;
  }
  const buf = await file.arrayBuffer();
  let doc = app.doc;
  if (doc) {
    doc = await store.patchDoc(doc.id, { fileName: file.name, size: file.size }) || doc;
  } else {
    const id = await store.docId({ bytes: buf.slice(0) });
    doc = await store.putDoc({
      id, title: file.name.replace(/\.pdf$/i, ''), origin: 'file',
      fileName: file.name, size: file.size,
    });
  }
  await openBytes(buf, doc, { cache: true, name: file.name, blobType: file.type || 'application/pdf' });
  toast('Saved to this browser — it will open instantly next time', 'ok', 4000);
}

/** Shared setup once a PDF exists, however it arrived. */
async function attachPdf(pdf, doc, name = '') {
  app.pdf = pdf;
  const updated = await store.patchDoc(doc.id, {
    pageCount: pdf.numPages, fileName: name || doc.fileName || '',
  }) || doc;
  app.doc = updated;
  app.marks = await store.listMarks(doc.id);

  // Page sizes up front so scale maths never waits on a fetch mid-turn.
  app.meta = await Promise.all(
    Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1).then((page) => {
      const v = page.getViewport({ scale: 1 });
      return { num: i + 1, page, w: v.width, h: v.height };
    })),
  );

  setMode('doc');
  setTitle(updated.title, `${pdf.numPages} pages`);
  $('#page-total').textContent = `/ ${pdf.numPages}`;
  $('#page-num').max = pdf.numPages;
  $('#scrubber').max = pdf.numPages;

  annotator.setMarks(app.marks);
  renderMarkList();
  renderThumbs();
  await renderStorage();

  app.current = Math.min(updated.lastPage || 1, pdf.numPages);
  applyView();
  loading(null);
}

async function keepOffline() {
  if (!app.doc || !app.pdf) return;
  const btn = $('#keep-offline');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const data = await app.pdf.getData();
    const ok = await store.putFile(app.doc.id, new Blob([data], { type: 'application/pdf' }), app.doc.fileName || '');
    toast(ok ? 'Saved for offline reading' : 'Not enough room to store it', ok ? 'ok' : 'bad', 3000);
    if (ok) store.persist().catch(() => {});
  } catch (err) {
    console.error('[reader] keep offline failed:', err);
    toast('It could not be saved offline', 'bad');
  } finally {
    btn.textContent = label;
    btn.disabled = false;
    await renderStorage();
  }
}

/* ==========================================================================
   Scale
   ========================================================================== */

/** Space a page may occupy, minus the deck's own padding and any gap. */
function available() {
  const view = $('#scroller');
  const pad = 32;
  return {
    w: Math.max(160, view.clientWidth - pad * 2),
    h: Math.max(160, view.clientHeight - pad * 2),
  };
}

/**
 * Fit-page is the default and the whole point: it takes the *smaller* of the
 * width and height ratios so an entire page is visible. Fit-width — which is
 * all the previous build did — overflows the viewport vertically on any
 * portrait page, which is why reading meant scrolling.
 */
/**
 * Scale for one specific page.
 *
 * Fit-page is measured against that page's own dimensions, not the current
 * page's. NCTB scans are not uniformly sized, and scaling every sheet by one
 * page's ratio leaves the odd taller one overflowing — visible in the
 * horizontal strip as pages clipped top and bottom.
 */
function scaleFor(meta) {
  if (!meta) return 1;
  const { w, h } = available();
  let fit;
  if (app.fit === 'width') fit = w / meta.w;
  else if (app.fit === 'actual') fit = 1;
  else fit = Math.min(w / meta.w, h / meta.h);
  return Math.max(0.05, fit * app.zoom);
}

/** Scale of the page being read — drives the zoom label and warm-up cache. */
function computeScale() {
  return scaleFor(app.meta[app.current - 1] || app.meta[0]);
}

function fitLabel() {
  const pct = Math.round(app.scale * 100);
  return app.zoom === 1 ? FIT_LABEL[app.fit] : `${pct}%`;
}

/* ==========================================================================
   Mounting pages
   ========================================================================== */

/** Which page numbers the current view shows. */
function visiblePages() {
  const n = app.pdf?.numPages || 0;
  if (!n) return [];
  if (SCROLLING.has(app.view)) return app.meta.map((m) => m.num);
  return [app.current];
}

function buildPageBox(meta) {
  const box = document.createElement('div');
  box.className = 'page';
  box.dataset.page = String(meta.num);

  const skel = document.createElement('div');
  skel.className = 'page-skeleton';
  const canvas = document.createElement('canvas');
  const tag = document.createElement('span');
  tag.className = 'page-no';
  tag.textContent = meta.num;

  box.append(skel, canvas, tag);
  sizeBox(box, meta);
  annotator.attach(box, meta.num);
  return { box, canvas, skel, task: null, rendered: false };
}

function sizeBox(box, meta) {
  const scale = scaleFor(meta);
  box.style.width = `${Math.round(meta.w * scale)}px`;
  box.style.height = `${Math.round(meta.h * scale)}px`;
}

async function renderInto(entry, meta) {
  if (entry.rendered || entry.task) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = meta.page.getViewport({ scale: scaleFor(meta) * dpr });
  entry.canvas.width = Math.round(viewport.width);
  entry.canvas.height = Math.round(viewport.height);

  const task = meta.page.render({
    canvasContext: entry.canvas.getContext('2d', { alpha: false }),
    viewport,
  });
  entry.task = task;
  try {
    await task.promise;
    entry.rendered = true;
    entry.skel.style.display = 'none';
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') console.warn('[reader] render failed', meta.num, err);
  } finally {
    entry.task = null;
  }
}

function unmount(num) {
  const entry = app.mounted.get(num);
  if (!entry) return;
  entry.task?.cancel();
  annotator.detach(num);
  entry.box.remove();
  app.mounted.delete(num);
}

/** Rebuild the deck for the current view/page, with an optional turn animation. */
function applyView(direction = null) {
  if (!app.pdf) return;
  app.scale = computeScale();

  const deck = $('#deck');
  const wanted = visiblePages();
  const wantedSet = new Set(wanted);
  const outgoing = [...app.mounted.keys()].filter((n) => !wantedSet.has(n));
  const animate = direction && !reduceMotion() && !SCROLLING.has(app.view);

  // Turning back is the forward turn played backwards, and the sheet that
  // moves is the one coming *back* — so the page being left just lies there,
  // flat, until the returning sheet has settled on top of it. Held here and
  // retired by the animation rather than up front with the others.
  const curlBack = animate && app.turnStyle === 'flip' && direction === 'prev';
  let underneath = null;

  // Retire pages that are leaving. Hold the element directly rather than
  // going back through the map — the entry is unregistered immediately, so a
  // deferred lookup by page number would find nothing and leave the node behind.
  outgoing.forEach((num) => {
    const entry = app.mounted.get(num);
    app.mounted.delete(num);
    annotator.detach(num);
    entry.task?.cancel();

    if (!animate) { entry.box.remove(); return; }

    if (curlBack) { underneath = entry.box; return; }

    // Forward: the sheet being left is the one that moves. The curl wraps it,
    // drives the sweep on rAF and hands it back when the turn is done.
    if (app.turnStyle === 'flip') {
      entry.box.dataset.leaving = 'true';
      curlPage(entry.box, entry.canvas, direction).then(() => entry.box.remove());
      return;
    }

    entry.box.dataset.leaving = 'true';
    entry.box.dataset.anim = direction === 'next' ? 'out-next' : 'out-prev';
    const drop = () => entry.box.remove();
    entry.box.addEventListener('animationend', drop, { once: true });
    // animationend never arrives in a background tab, so always back it up.
    setTimeout(drop, 700);
  });

  // Mount and size what should be on screen.
  wanted.forEach((num) => {
    const meta = app.meta[num - 1];
    let entry = app.mounted.get(num);
    if (!entry) {
      entry = buildPageBox(meta);
      if (animate && !curlBack) {
        entry.box.dataset.anim = direction === 'next' ? 'in-next' : 'in-prev';
      }
      app.mounted.set(num, entry);
      deck.append(entry.box);
    } else {
      sizeBox(entry.box, meta);
      if (entry.rendered) { entry.rendered = false; entry.skel.style.display = ''; }
    }
    const painted = renderInto(entry, meta);

    if (curlBack) {
      // Taken out of flow for the wait: the deck lays pages out in a row, so
      // an in-flow returning page would sit *beside* the one it is supposed to
      // come back on top of until the curl wraps it.
      entry.box.classList.add('is-returning');
      // The flap copies this page's face, so a rendered page makes a better
      // one — but the turn must not be hostage to the render. warmNeighbours
      // usually has the previous page ready in a few ms; when it does not (a
      // big scan, a cold cache) the sheet moves anyway with a plainer back,
      // rather than the animation hanging and the old page sitting there.
      const ready = Promise.race([painted, new Promise((r) => setTimeout(r, 140))]);
      ready
        .then(() => {
          entry.box.classList.remove('is-returning');
          return curlPage(entry.box, entry.canvas, 'next', { reverse: true });
        })
        // finally, not then: the page being left has to go even if the turn
        // above failed, or it stays stacked under the new one for good.
        .finally(() => { underneath?.remove(); underneath = null; });
    }
  });

  // Keep DOM order matching page order.
  wanted.forEach((num) => {
    const entry = app.mounted.get(num);
    if (entry) deck.append(entry.box);
  });

  // A newly turned-to page starts at its top rather than inheriting the
  // scroll offset of whatever was panned before it.
  if (!SCROLLING.has(app.view)) $('#scroller').scrollTo({ top: 0, left: 0 });

  annotator.redrawAll();
  syncPager();
  warmNeighbours();
}

/**
 * Decode the pages either side of the current one while the reader is looking
 * at this one. pdf.js caches a page's fonts and images after a render, so the
 * next turn paints from memory instead of decoding a scanned A4 from scratch.
 */
let warmTimer;
function warmNeighbours() {
  if (SCROLLING.has(app.view) || !app.pdf) return;
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    [app.current + 1, app.current - 1]
      .filter((n) => n >= 1 && n <= app.pdf.numPages && !app.mounted.has(n))
      .forEach((n) => {
        const meta = app.meta[n - 1];
        const scale = scaleFor(meta);
        if (!meta || meta.warmedAt === scale) return;
        meta.warmedAt = scale;
        const canvas = document.createElement('canvas');
        const viewport = meta.page.getViewport({ scale });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        meta.page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport })
          .promise.catch(() => {});
      });
  }, 220);
}

function syncPager() {
  const n = app.pdf?.numPages || 0;
  $('#page-num').value = app.current;
  $('#scrubber').value = app.current;
  $('#fit-cycle').textContent = fitLabel();
  $('#turn-prev').disabled = app.current <= 1;
  $('#turn-next').disabled = app.current >= n;
  $('#prev-page').disabled = app.current <= 1;
  $('#next-page').disabled = app.current >= n;
  $$('.thumb').forEach((t) =>
    t.setAttribute('data-current', String(Number(t.dataset.page) === app.current)));
  persistPosition();
}

const persistPosition = debounce(() => {
  if (app.doc) store.patchDoc(app.doc.id, { lastPage: app.current }).catch(() => {});
}, 700);

/* ==========================================================================
   Navigation
   ========================================================================== */

/** Bring a page into view in whichever axis the current mode scrolls. */
function scrollToPage(num, behavior = 'smooth') {
  const entry = app.mounted.get(num);
  const scroller = $('#scroller');
  if (!entry) return;
  if (app.view === 'hscroll') {
    // Centre it, so a page narrower than the strip is not glued to one edge.
    const left = entry.box.offsetLeft - (scroller.clientWidth - entry.box.offsetWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, left), behavior });
  } else {
    scroller.scrollTo({ top: Math.max(0, entry.box.offsetTop - 16), behavior });
  }
}

function goTo(num, { animate = true } = {}) {
  const n = app.pdf?.numPages || 1;
  const target = Math.min(Math.max(1, Math.round(Number(num) || 1)), n);
  if (target === app.current) return;
  const direction = animate ? (target > app.current ? 'next' : 'prev') : null;
  app.current = target;

  if (SCROLLING.has(app.view)) {
    beginSeek(target);
    scrollToPage(target, reduceMotion() ? 'auto' : 'smooth');
    syncPager();
    return;
  }
  applyView(direction);
}

/* --------------------------------------------------------------------------
   Seeking

   A programmatic smooth scroll takes a few hundred ms, and for all of it the
   page being left still fills most of the viewport. The scroll observer must
   stay quiet until we arrive, or it reports the old page as current and the
   next turn starts from the wrong place.
   -------------------------------------------------------------------------- */

let seekTimer;
function beginSeek(target) {
  app.seeking = target;
  clearTimeout(seekTimer);
  // `scrollend` clears this properly; the timer is the fallback for browsers
  // without it, and for a scroll that never starts because we were already
  // there (in which case no scroll event ever fires).
  seekTimer = setTimeout(endSeek, 700);
}

function endSeek() {
  clearTimeout(seekTimer);
  app.seeking = null;
}

/**
 * Turn a page, at a pace a person can follow.
 *
 * Holding an arrow key produces ~30 keydowns a second, and turning on every
 * one of them threw the reader 25 pages in under a second. Repeats are given a
 * wide gap so a held key advances steadily; a genuine press gets a narrow one,
 * which is short enough never to swallow real taps.
 */
const TAP_GAP = 110;
const HOLD_GAP = 340;
let nextTurnAt = 0;

function turn(dir, { repeat = false } = {}) {
  const now = performance.now();
  if (now < nextTurnAt) return;
  nextTurnAt = now + (repeat ? HOLD_GAP : TAP_GAP);
  goTo(app.current + dir);
}

/** Is there anywhere to scroll on this axis? */
function canPan(axis) {
  const s = $('#scroller');
  return axis === 'y'
    ? s.scrollHeight - s.clientHeight > 4
    : s.scrollWidth - s.clientWidth > 4;
}

/**
 * Scroll the stage by a comfortable step.
 *
 * The scroller is a div, so the browser only scrolls it with the arrow keys
 * when it happens to hold focus — which, after a click anywhere else on the
 * page, it does not. That is why the arrows felt dead in the continuous modes.
 * Driving it explicitly makes them work wherever focus is.
 *
 * A held key takes shorter steps more often, so scrolling accelerates smoothly
 * instead of leaping a third of the screen thirty times a second.
 */
let nextPanAt = 0;
function pan(axis, dir, { repeat = false } = {}) {
  const now = performance.now();
  if (now < nextPanAt) return;
  nextPanAt = now + (repeat ? 90 : 0);

  const s = $('#scroller');
  const behavior = reduceMotion() ? 'auto' : 'smooth';
  const span = axis === 'y' ? s.clientHeight : s.clientWidth;
  const stepPx = Math.max(60, span * (repeat ? 0.12 : 0.28));
  s.scrollBy({ [axis === 'y' ? 'top' : 'left']: stepPx * dir, behavior });
}

function setView(view) {
  if (view === app.view) return;
  // Drop everything; the two layouts have incompatible DOM.
  [...app.mounted.keys()].forEach((k) => unmount(k));
  $('#deck').replaceChildren();
  app.view = view;
  document.body.dataset.view = view;
  $$('#view-modes [data-view]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.view === view)));

  if (SCROLLING.has(view)) mountScroll();
  else applyView();
  localStorage.setItem('reader:view', view);
}

/** Continuous mode: every page box exists, rendered lazily as it nears view. */
let scrollObserver;
function mountScroll() {
  const deck = $('#deck');
  app.scale = computeScale();
  app.meta.forEach((meta) => {
    const entry = buildPageBox(meta);
    app.mounted.set(meta.num, entry);
    deck.append(entry.box);
  });

  scrollObserver?.disconnect();
  const ratios = new Map();
  // A horizontal strip needs margin on the inline axis, not the block one, or
  // pages ahead of the viewport are never pre-rendered.
  const margin = app.view === 'hscroll' ? '0px 120%' : '120% 0px';
  scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const num = Number(e.target.dataset.page);
      ratios.set(num, e.intersectionRatio);
      const entry = app.mounted.get(num);
      if (!entry) return;
      if (e.isIntersecting) renderInto(entry, app.meta[num - 1]);
    });
    // While we are scrolling *to* a page, that page is the answer — the
    // observer must not vote. Mid-flight the page being left still has the
    // larger share of the viewport, so letting it win would drag app.current
    // back one; the next press would then turn from the page just left and
    // the strip would visibly go backwards.
    if (app.seeking !== null) return;

    let best = app.current, bestRatio = 0;
    ratios.forEach((r, num) => { if (r > bestRatio) { bestRatio = r; best = num; } });
    // bestRatio starts at 0, not -1: with nothing on screen every page ties at
    // zero and the first one enumerated would otherwise be declared current.
    if (bestRatio > 0 && best !== app.current) { app.current = best; syncPager(); }
  }, { root: $('#scroller'), rootMargin: margin, threshold: [0, 0.25, 0.6, 1] });

  app.mounted.forEach((entry) => scrollObserver.observe(entry.box));
  // Render the opening pages without waiting to be told they are visible.
  [app.current, app.current + 1].forEach((n) => {
    const entry = app.mounted.get(n);
    if (entry) renderInto(entry, app.meta[n - 1]);
  });
  // Restore the reading position. Done directly as well as on the next frame,
  // because rAF does not fire in a background tab and the reader would then
  // land on page one instead of where they left off.
  const restore = () => scrollToPage(app.current, 'auto');
  restore();
  requestAnimationFrame(restore);
  syncPager();
}

/* --- zoom / fit ----------------------------------------------------------- */

function reflow() {
  if (!app.pdf) return;
  if (SCROLLING.has(app.view)) {
    app.scale = computeScale();
    app.mounted.forEach((entry, num) => {
      const meta = app.meta[num - 1];
      if (!meta) return;
      sizeBox(entry.box, meta);
      entry.task?.cancel();
      entry.rendered = false;
      entry.skel.style.display = '';
    });
    const near = [app.current - 1, app.current, app.current + 1];
    near.forEach((n) => {
      const entry = app.mounted.get(n);
      if (entry) renderInto(entry, app.meta[n - 1]);
    });
    annotator.redrawAll();
    syncPager();
    scrollToPage(app.current, 'auto');
  } else {
    applyView();
  }
}

function setFit(fit) {
  app.fit = fit;
  app.zoom = 1;
  localStorage.setItem('reader:fit', fit);
  reflow();
}

function nudgeZoom(delta) {
  app.zoom = Math.min(MAX_ZOOM / 2, Math.max(MIN_ZOOM, Number((app.zoom + delta).toFixed(2))));
  reflow();
}

/* --- fullscreen ----------------------------------------------------------- */

let chromeTimer;
function showChrome(temporarily = true) {
  document.body.dataset.chrome = 'true';
  clearTimeout(chromeTimer);
  if (temporarily) chromeTimer = setTimeout(() => { document.body.dataset.chrome = 'false'; }, 2600);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (err) {
    // Fullscreen can be refused (iOS Safari, permissions); immersive still works.
    console.warn('[reader] fullscreen refused:', err);
    setImmersive(document.body.dataset.immersive !== 'true');
  }
}

function setImmersive(on) {
  document.body.dataset.immersive = String(on);
  $('#fullscreen').setAttribute('aria-pressed', String(on));
  if (on) showChrome(); else { clearTimeout(chromeTimer); document.body.dataset.chrome = 'true'; }
  requestAnimationFrame(reflow);
}

/* ==========================================================================
   Annotations
   ========================================================================== */

const annotator = createAnnotator({
  getTool: () => app.tool,
  getColor: () => app.color,
  onCreate: async (draft) => {
    const mark = await store.putMark({ ...draft, docId: app.doc.id });
    app.marks.push(mark);
    app.undoStack.push(mark.id);
    annotator.addMark(mark);
    renderMarkList();
    renderThumbFlags();
    savedFlash();
    if (mark.type === 'note' || mark.type === 'text') editNote(mark);
  },
  onDelete: async (mark) => {
    await store.deleteMark(mark.id);
    app.marks = app.marks.filter((m) => m.id !== mark.id);
    annotator.removeMark(mark);
    renderMarkList();
    renderThumbFlags();
    savedFlash('Removed');
  },
  onEditNote: (mark) => editNote(mark),
});

let noteSettled = true;
function settleNote(action) {
  if (noteSettled) return;
  noteSettled = true;
  closeNote(action);
}

function editNote(mark) {
  app.editing = mark;
  noteSettled = false;
  $('#note-title').textContent = mark.type === 'text' ? 'Text on the page' : 'Note';
  $('#note-text').value = mark.text || '';
  $('#note-dialog').showModal();
  $('#note-text').focus();
}

async function closeNote(action) {
  const mark = app.editing;
  app.editing = null;
  if (!mark) return;

  const drop = async () => {
    await store.deleteMark(mark.id);
    app.marks = app.marks.filter((m) => m.id !== mark.id);
    annotator.removeMark(mark);
    renderMarkList();
    renderThumbFlags();
  };

  if (action === 'delete') { await drop(); savedFlash('Removed'); return; }
  const text = $('#note-text').value.trim();
  if (action !== 'save') { if (!mark.text) await drop(); return; }
  if (!text && mark.type === 'text') { await drop(); return; }

  const updated = await store.putMark({ ...mark, text });
  const i = app.marks.findIndex((m) => m.id === mark.id);
  if (i >= 0) app.marks[i] = updated;
  annotator.updateMark(updated);
  renderMarkList();
  savedFlash();
}

async function toggleBookmark() {
  if (!app.doc) return;
  const existing = app.marks.find((m) => m.type === 'bookmark' && m.page === app.current);
  if (existing) {
    await store.deleteMark(existing.id);
    app.marks = app.marks.filter((m) => m.id !== existing.id);
    toast(`Bookmark removed from page ${app.current}`, 'ok', 1600);
  } else {
    app.marks.push(await store.putMark({
      docId: app.doc.id, page: app.current, type: 'bookmark', color: app.color,
    }));
    toast(`Page ${app.current} bookmarked`, 'ok', 1600);
  }
  renderMarkList();
  renderThumbFlags();
  savedFlash();
}

async function undo() {
  let id = app.undoStack.pop();
  while (id && !app.marks.some((m) => m.id === id)) id = app.undoStack.pop();
  if (!id) { toast('Nothing to undo', 'info', 1400); return; }
  const mark = app.marks.find((m) => m.id === id);
  await store.deleteMark(id);
  app.marks = app.marks.filter((m) => m.id !== id);
  annotator.removeMark(mark);
  renderMarkList();
  renderThumbFlags();
  savedFlash('Undone');
}

/* ==========================================================================
   Rail
   ========================================================================== */

const MARK_NAME = {
  highlight: 'Highlight', pen: 'Drawing', rect: 'Box',
  note: 'Note', text: 'Text', bookmark: 'Bookmark',
};

function renderMarkList() {
  const sorted = [...app.marks].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
  $('#marks-empty').hidden = sorted.length > 0;
  $('#mark-list').innerHTML = sorted.map((m) => `
    <li>
      <button class="mark-item" type="button" data-mark="${esc(m.id)}" data-page="${m.page}">
        <span class="mark-swatch" style="--c:${esc(m.color || 'var(--accent)')}"></span>
        <span class="mark-body">
          <b>${esc(MARK_NAME[m.type] || m.type)} · p.${m.page}</b>
          <span>${esc(m.text || '')}</span>
        </span>
        <span class="mark-del" data-del="${esc(m.id)}" role="button" tabindex="0" aria-label="Delete this mark">✕</span>
      </button>
    </li>`).join('');
}

function renderThumbs() {
  $('#thumb-list').innerHTML = app.meta.map((m) => `
    <li>
      <button class="thumb" type="button" data-page="${m.num}" data-current="${m.num === app.current}">
        <canvas></canvas>
        <span class="thumb-n">${m.num}</span>
        <span class="thumb-flag" data-flag="${m.num}"></span>
      </button>
    </li>`).join('');
  renderThumbFlags();

  const obs = new IntersectionObserver((entries, o) => {
    entries.forEach(async (e) => {
      if (!e.isIntersecting) return;
      o.unobserve(e.target);
      const num = Number(e.target.dataset.page);
      const meta = app.meta[num - 1];
      const canvas = e.target.querySelector('canvas');
      if (!meta || !canvas) return;
      const v = meta.page.getViewport({ scale: 150 / meta.w });
      canvas.width = Math.round(v.width);
      canvas.height = Math.round(v.height);
      try {
        await meta.page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: v }).promise;
      } catch { /* a cancelled thumbnail is not worth reporting */ }
    });
  }, { root: $('#panel-pages'), rootMargin: '200px' });
  $$('.thumb').forEach((t) => obs.observe(t));
}

function renderThumbFlags() {
  const marked = new Set(app.marks.filter((m) => m.type === 'bookmark').map((m) => m.page));
  const any = new Set(app.marks.filter((m) => m.type !== 'bookmark').map((m) => m.page));
  $$('[data-flag]').forEach((el) => {
    const n = Number(el.dataset.flag);
    el.textContent = marked.has(n) ? '🔖' : any.has(n) ? '•' : '';
  });
}

async function renderStorage() {
  const dl = $('#store-doc');
  const keep = $('#keep-offline');
  if (app.doc) {
    const cached = await store.hasFile(app.doc.id);
    dl.innerHTML = `
      <dt>Title</dt><dd>${esc(app.doc.title || '—')}</dd>
      <dt>Pages</dt><dd>${app.doc.pageCount || '—'}</dd>
      <dt>Marks</dt><dd>${app.marks.length}</dd>
      <dt>File</dt><dd>${cached ? 'kept on this device' : 'streaming as you read'}</dd>`;
    keep.hidden = false;
    keep.disabled = cached || !app.pdf;
    keep.textContent = cached ? 'Kept offline ✓' : 'Keep offline';
  } else {
    dl.innerHTML = '<dt>Book</dt><dd>none open</dd>';
    keep.hidden = true;
  }

  const use = await store.usage();
  $('#store-usage').textContent = use
    ? `${bytes(use.used)} used of about ${bytes(use.quota)} available.`
    : 'This browser does not report storage figures.';

  const docs = await store.listDocs().catch(() => []);
  $('#doc-list').innerHTML = docs.map((d) => `
    <li>
      <a href="./reader.html?doc=${encodeURIComponent(d.id)}">${esc(d.title || d.id)}</a>
      <button class="mark-del" type="button" data-forget="${esc(d.id)}" aria-label="Remove">✕</button>
    </li>`).join('') || '<li class="muted">Nothing stored yet.</li>';
}

async function renderRecent() {
  const docs = await store.listDocs().catch(() => []);
  if (!docs.length) return;
  $('#recent-block').hidden = false;
  $('#recent-list').innerHTML = docs.slice(0, 8).map((d) => `
    <li>
      <a href="./reader.html?doc=${encodeURIComponent(d.id)}">${esc(d.title || d.id)}</a>
      <small>${d.pageCount ? `p.${d.lastPage || 1} / ${d.pageCount}` : '—'}</small>
    </li>`).join('');
}

/* ==========================================================================
   Export
   ========================================================================== */

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const safeName = (s) => (s || 'nctb').slice(0, 48).replace(/[^\wঀ-৿-]+/g, '_');

async function exportJSON() {
  if (!app.doc) return;
  const bundle = await store.exportAll(app.doc.id);
  download(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
    `${safeName(app.doc.title)}-notes.json`);
  toast('Notes exported', 'ok');
}

async function importJSON(file) {
  try {
    const { docs, marks } = await store.importAll(JSON.parse(await file.text()));
    toast(`Imported ${marks} marks across ${docs} book(s)`, 'ok', 4000);
    if (app.doc) {
      app.marks = await store.listMarks(app.doc.id);
      annotator.setMarks(app.marks);
      renderMarkList();
      renderThumbFlags();
    }
    await renderStorage();
  } catch (err) {
    console.error(err);
    toast('That is not an exported notes file', 'bad');
  }
}

function loadPDFLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './assets/vendor/pdf-lib.min.js';
    s.onload = () => resolve(window.PDFLib);
    s.onerror = () => reject(new Error('pdf-lib failed to load'));
    document.head.append(s);
  });
}

/**
 * Flatten the book plus its marks into a new PDF. Each page is re-rendered
 * with the marks painted on and embedded as an image — that loses selectable
 * text, but it is the only way to reproduce Bangla annotation text without
 * shipping a full Bengali font and shaping engine.
 */
async function exportPDF() {
  if (!app.pdf) return;
  const btn = $('#export-pdf');
  btn.disabled = true;
  loading('Building the marked PDF…');
  try {
    const { PDFDocument } = await loadPDFLib();
    const out = await PDFDocument.create();
    const notes = [];

    for (let n = 1; n <= app.pdf.numPages; n += 1) {
      loading(`Marked PDF… page ${n} of ${app.pdf.numPages}`);
      const meta = app.meta[n - 1];
      const viewport = meta.page.getViewport({ scale: 1.6 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await meta.page.render({ canvasContext: ctx, viewport }).promise;

      const pageMarks = app.marks.filter((m) => m.page === n && m.type !== 'bookmark');
      pageMarks.forEach((m) => {
        if (m.type === 'note') { notes.push({ page: n, n: notes.length + 1, text: m.text || '' }); m._n = notes.length; }
      });
      paintMarks(ctx, pageMarks, canvas.width, canvas.height);

      const jpg = await out.embedJpg(canvas.toDataURL('image/jpeg', 0.85));
      out.addPage([viewport.width, viewport.height])
        .drawImage(jpg, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    }

    if (notes.length) await appendNotePage(out, notes);
    download(new Blob([await out.save()], { type: 'application/pdf' }), `${safeName(app.doc.title)}-marked.pdf`);
    toast('Marked PDF saved', 'ok');
  } catch (err) {
    console.error('[reader] export failed:', err);
    toast('The PDF could not be built', 'bad');
  } finally {
    loading(null);
    btn.disabled = false;
  }
}

async function appendNotePage(out, notes) {
  const W = 1240, H = 1754;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1a1613';
  ctx.font = '700 44px Georgia, "Noto Serif Bengali", serif';
  ctx.fillText('Notes', 80, 110);
  ctx.fillStyle = '#6f6354';
  ctx.font = '400 22px "Noto Serif Bengali", system-ui, sans-serif';
  ctx.fillText(app.doc?.title || '', 80, 152);

  let y = 230;
  ctx.font = '400 26px "Noto Serif Bengali", system-ui, sans-serif';
  for (const note of notes) {
    if (y > H - 90) break;
    ctx.fillStyle = '#a85a07';
    ctx.fillText(`${note.n}. page ${note.page}`, 80, y);
    ctx.fillStyle = '#1a1613';
    y += 38;
    for (const line of wrap(ctx, note.text, W - 200)) {
      if (y > H - 60) break;
      ctx.fillText(line, 110, y);
      y += 36;
    }
    y += 26;
  }
  const jpg = await out.embedJpg(canvas.toDataURL('image/jpeg', 0.9));
  out.addPage([W, H]).drawImage(jpg, { x: 0, y: 0, width: W, height: H });
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/* ==========================================================================
   Wiring
   ========================================================================== */

function buildSwatches() {
  $('#swatches').innerHTML = PALETTE.map((c, i) => `
    <button class="swatch" role="radio" type="button" style="--c:${c.value}"
            data-color="${c.value}" aria-checked="${i === 0}"
            aria-label="${c.name}" title="${c.name}"></button>`).join('');
}

function setTool(tool) {
  app.tool = tool;
  document.body.dataset.tool = tool;
  annotator.setTool(tool);
  $$('.tools [data-tool]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
}

/** Page-turn style. Flip is the default because it is what a book does. */
function setTurnStyle(style) {
  app.turnStyle = style;
  document.body.dataset.turn = style;
  const btn = $('#turn-style');
  btn.setAttribute('aria-pressed', String(style === 'flip'));
  btn.title = style === 'flip'
    ? 'Page turn: flip like a book (X)'
    : 'Page turn: slide (X)';
  localStorage.setItem('reader:turn', style);
}

function bindChrome() {
  document.body.dataset.view = app.view;
  document.body.dataset.tool = app.tool;
  document.body.dataset.chrome = 'true';

  /* rail */
  const rail = $('#rail');
  const railBtn = $('#toggle-rail');
  const wide = window.matchMedia('(min-width: 1100px)');
  const setRail = (open) => {
    rail.dataset.open = String(open);
    railBtn.setAttribute('aria-expanded', String(open));
    requestAnimationFrame(reflow);
  };
  setRail(wide.matches);
  railBtn.addEventListener('click', () => setRail(rail.dataset.open !== 'true'));

  // Arrival: hand authority over the current page back to the observer.
  // Bound once here rather than in mountScroll, which re-runs per view change
  // and would stack a listener each time.
  $('#scroller').addEventListener('scrollend', endSeek);
  // A scroll the reader starts themselves — wheel, drag, trackpad — means they
  // have taken over, so stop steering towards wherever we were headed.
  ['wheel', 'touchstart'].forEach((ev) =>
    $('#scroller').addEventListener(ev, endSeek, { passive: true }));

  $$('[role="tab"]').forEach((tab) => tab.addEventListener('click', () => {
    $$('[role="tab"]').forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    });
    if (tab.id === 'tab-store') renderStorage();
  }));

  /* view + fit */
  $$('#view-modes [data-view]').forEach((b) =>
    b.addEventListener('click', () => setView(b.dataset.view)));
  $('#fit-cycle').addEventListener('click', () =>
    setFit(FITS[(FITS.indexOf(app.fit) + 1) % FITS.length]));
  $('#zoom-in').addEventListener('click', () => nudgeZoom(0.15));
  $('#zoom-out').addEventListener('click', () => nudgeZoom(-0.15));

  /* paging */
  $('#prev-page').addEventListener('click', () => turn(-1));
  $('#next-page').addEventListener('click', () => turn(1));
  $('#turn-prev').addEventListener('click', () => turn(-1));
  $('#turn-next').addEventListener('click', () => turn(1));
  $('#page-num').addEventListener('change', (e) => goTo(e.target.value));
  $('#scrubber').addEventListener('input', (e) => {
    $('#page-num').value = e.target.value;
  });
  $('#scrubber').addEventListener('change', (e) => goTo(e.target.value));

  /* fullscreen */
  $('#turn-style').addEventListener('click', () =>
    setTurnStyle(app.turnStyle === 'flip' ? 'slide' : 'flip'));
  $('#fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => setImmersive(Boolean(document.fullscreenElement)));
  $('#stage').addEventListener('pointermove', () => {
    if (document.body.dataset.immersive === 'true') showChrome();
  });

  bindTheme($('[data-theme-toggle]'));

  /* tools */
  $$('.tools [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#swatches').addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color]');
    if (!sw) return;
    app.color = sw.dataset.color;
    $$('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s === sw)));
  });
  $('#bookmark-page').addEventListener('click', toggleBookmark);
  $('#undo').addEventListener('click', undo);

  /* files */
  $('#open-btn').addEventListener('click', () => $('#file-input').click());
  $('#landing-open').addEventListener('click', () => $('#file-input').click());
  $('#preview-attach').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });

  /* rail lists */
  $('#mark-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const mark = app.marks.find((m) => m.id === del.dataset.del);
      if (mark) {
        await store.deleteMark(mark.id);
        app.marks = app.marks.filter((m) => m.id !== mark.id);
        annotator.removeMark(mark);
        renderMarkList();
        renderThumbFlags();
      }
      return;
    }
    const item = e.target.closest('[data-mark]');
    if (item) goTo(item.dataset.page);
  });
  $('#thumb-list').addEventListener('click', (e) => {
    const t = e.target.closest('.thumb');
    if (t) goTo(t.dataset.page);
  });

  /* storage */
  $('#keep-offline').addEventListener('click', keepOffline);
  $('#export-json').addEventListener('click', exportJSON);
  $('#export-pdf').addEventListener('click', exportPDF);
  $('#import-json').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });
  $('#clear-marks').addEventListener('click', async () => {
    if (!app.doc || !app.marks.length) return;
    if (!confirm(`Delete all ${app.marks.length} marks on this book? This cannot be undone.`)) return;
    await store.clearMarks(app.doc.id);
    app.marks = [];
    annotator.setMarks([]);
    renderMarkList();
    renderThumbFlags();
    await renderStorage();
    toast('All marks cleared', 'ok');
  });
  $('#forget-doc').addEventListener('click', async () => {
    if (!app.doc) return;
    if (!confirm('Remove this book, its stored file and all its marks from this browser?')) return;
    await store.deleteDoc(app.doc.id);
    toast('Removed from this device', 'ok');
    location.href = './reader.html';
  });
  $('#doc-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-forget]');
    if (!btn) return;
    if (!confirm('Remove this book and its marks?')) return;
    await store.deleteDoc(btn.dataset.forget);
    await renderStorage();
  });

  /* note dialog */
  const dlg = $('#note-dialog');
  dlg.querySelector('form').addEventListener('submit', (e) => settleNote(e.submitter?.value || 'cancel'));
  dlg.addEventListener('cancel', () => settleNote('cancel'));
  dlg.addEventListener('close', () => settleNote(dlg.returnValue || 'cancel'));

  window.addEventListener('resize', debounce(reflow, 200));

  // Restore the reader's last choices.
  const savedFit = localStorage.getItem('reader:fit');
  if (FITS.includes(savedFit)) app.fit = savedFit;
  setTurnStyle(localStorage.getItem('reader:turn') === 'slide' ? 'slide' : 'flip');

  const savedView = localStorage.getItem('reader:view');
  if (VIEWS.includes(savedView)) {
    app.view = savedView;
    document.body.dataset.view = savedView;
    $$('#view-modes [data-view]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.view === savedView)));
  }
}

function bindDragDrop() {
  const overlay = $('#drop-overlay');
  let depth = 0;
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    depth += 1;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) openFile(file);
  });
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (typing) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();
    const tools = { v: 'pan', h: 'highlight', p: 'pen', r: 'rect', n: 'note', t: 'text', e: 'erase' };
    if (tools[key]) { setTool(tools[key]); return; }

    // Arrows follow the axis the current mode moves in. In a continuous mode
    // that axis scrolls and the cross axis jumps a page; in single-page mode
    // both turn, unless the page is zoomed past the window, in which case the
    // arrows pan it — being unable to reach the bottom of a zoomed page is
    // worse than not having a shortcut for the next one.
    // hscroll snaps mandatorily to each page, so a part-scroll there springs
    // back — page jumps are the only honest step. Vertical scroll is free.
    const rep = { repeat: e.repeat };
    switch (e.key) {
      case 'ArrowRight':
        if (app.view === 'single' && canPan('x')) pan('x', 1, rep); else turn(1, rep);
        e.preventDefault(); break;
      case 'ArrowLeft':
        if (app.view === 'single' && canPan('x')) pan('x', -1, rep); else turn(-1, rep);
        e.preventDefault(); break;
      case 'ArrowDown':
        if (app.view === 'scroll' || (app.view === 'single' && canPan('y'))) pan('y', 1, rep);
        else turn(1, rep);
        e.preventDefault(); break;
      case 'ArrowUp':
        if (app.view === 'scroll' || (app.view === 'single' && canPan('y'))) pan('y', -1, rep);
        else turn(-1, rep);
        e.preventDefault(); break;
      case 'PageDown': turn(1, rep); e.preventDefault(); break;
      case 'PageUp': turn(-1, rep); e.preventDefault(); break;
      case ' ': turn(e.shiftKey ? -1 : 1, rep); e.preventDefault(); break;
      case 'Home': goTo(1); e.preventDefault(); break;
      case 'End': goTo(app.pdf?.numPages || 1); e.preventDefault(); break;
      case '+': case '=': nudgeZoom(0.15); break;
      case '-': nudgeZoom(-0.15); break;
      case '0': setFit('page'); break;
      case '1': setView('single'); break;
      case '2': setView('scroll'); break;
      case '3': setView('hscroll'); break;
      default:
        if (key === 'f') toggleFullscreen();
        else if (key === 'b') toggleBookmark();
        else if (key === 'x') setTurnStyle(app.turnStyle === 'flip' ? 'slide' : 'flip');
    }
  });
}

/* ==========================================================================
   Drive setup (site owner only)
   ========================================================================== */

function readBridgeForm() {
  const mode = $('input[name="bridge-mode"]:checked')?.value || 'key';
  return mode === 'key'
    ? { mode: 'key', apiKey: $('#bridge-key').value.trim() }
    : { mode: 'proxy', proxy: $('#bridge-proxy').value.trim() };
}

function showBridgeResult(ok, detail) {
  const el = $('#bridge-result');
  el.hidden = false;
  el.dataset.ok = String(ok);
  el.textContent = detail;
}

async function runBridgeTest(save) {
  const cfg = readBridgeForm();
  if ((cfg.mode === 'key' && !cfg.apiKey) || (cfg.mode === 'proxy' && !cfg.proxy)) {
    showBridgeResult(false, 'Fill in the field for the option you picked.');
    return;
  }
  showBridgeResult(false, 'Testing…');
  $('#bridge-result').removeAttribute('data-ok');
  const { ok, detail } = await testBridge(cfg);
  showBridgeResult(ok, detail);
  if (ok && save) {
    setBridge(cfg);
    renderBridgeState();
    toast('Drive connected', 'ok', 3500);
    if (app.doc?.driveId && !app.pdf) openKnown(app.doc);
  }
}

function renderBridgeState() {
  const cfg = getBridge();
  $('#bridge-status').textContent = cfg.mode === 'key'
    ? 'Currently using a Google API key.'
    : cfg.mode === 'proxy' ? `Currently using ${cfg.proxy}`
    : bridgeActive() ? 'This site already serves Drive books itself — nothing to do here.'
    : 'This site cannot serve Drive books, so they open in Drive’s viewer.';
}

function bindBridge() {
  const dlg = $('#bridge-dialog');
  $('#open-bridge')?.addEventListener('click', () => {
    const cfg = getBridge();
    $('#bridge-key').value = cfg.apiKey || '';
    $('#bridge-proxy').value = cfg.proxy || '';
    $(`input[name="bridge-mode"][value="${cfg.mode === 'proxy' ? 'proxy' : 'key'}"]`).checked = true;
    $('#bridge-result').hidden = true;
    dlg.showModal();
  });
  $('#bridge-close').addEventListener('click', () => dlg.close());
  $('#bridge-test').addEventListener('click', () => runBridgeTest(false));
  $('#bridge-save').addEventListener('click', () => runBridgeTest(true));
  $('#bridge-clear').addEventListener('click', () => {
    setBridge({ mode: 'none' });
    renderBridgeState();
    showBridgeResult(false, 'Disconnected.');
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  renderBridgeState();
}

/* ========================================================================== */

if (!store.supported) toast('This browser blocks local storage, so notes cannot be saved', 'bad', 6000);
boot();
