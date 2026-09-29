/* ==========================================================================
   NCTB Atlas — download source intelligence

   NCTB spreads its PDFs over four hosts with very different browser
   behaviour. This module is the single place that knows the difference, so
   the UI can promise only what a given link can actually deliver.

   Measured against the live hosts on 2026-08-16:

     oracle  objectstorage...oraclecloud15.com
             `access-control-allow-origin: *` and `accept-ranges: bytes`.
             pdf.js streams it directly.

     drive   drive.google.com
             No Drive file host can be read cross-origin by a browser.
             Both obvious candidates are dead ends:
               - `drive.google.com/uc?export=download` → 403, no CORS headers.
               - `drive.usercontent.google.com/download` → a decoy. It answers
                 206 with `access-control-allow-origin: *` to curl, but replay
                 the identical request with browser metadata (`Sec-Fetch-Mode:
                 cors`, `Sec-Fetch-Site: cross-site`, a `Referer`) and it
                 becomes `403 text/html` with no CORS header. Google serves the
                 permissive header only to clients that are not browsers —
                 where CORS is moot anyway. Confirmed from a real page: the
                 request does leave (a `no-cors` fetch resolves opaque) but the
                 cross-origin read is refused.
             `www.googleapis.com` is different: it is Google's browser-facing
             API surface and CORS passes there (a keyless request returns a
             *readable* 403). Seamless Drive streaming is therefore possible,
             but only via the Drive API with a key, or via a proxy — see
             `bridge.js`. Without one of those, Drive falls back to its own
             preview iframe plus a one-time file drop.

     egov    drive.egovcloud.gov.bd
             /download returns a real application/pdf, but with no
             `access-control-allow-origin`, so fetch() is blocked. Useful as a
             download link only.

     gdocs   docs.google.com — opens externally.
   ========================================================================== */

export const SOURCES = {
  oracle: {
    label: 'Object Storage',
    short: 'Direct',
    tone: 'ok',
    streamable: true,
    note: 'Opens straight in the reader — this host allows cross-origin reads.',
  },
  drive: {
    label: 'Google Drive',
    short: 'Drive',
    tone: 'warn',
    // Only true once a Drive bridge is configured; bridge.js overrides this.
    streamable: false,
    note: 'Reads inline once a Drive connection is set up; otherwise previews in Drive’s own viewer.',
  },
  egov: {
    label: 'eGov cloud',
    short: 'Mirror',
    tone: 'cyan',
    streamable: false,
    note: 'Government mirror. Downloads directly, but the browser cannot read it into the page.',
  },
  gdocs: {
    label: 'Google Docs',
    short: 'Docs',
    tone: 'muted',
    streamable: false,
    note: 'A Google Doc rather than a PDF — opens on docs.google.com.',
  },
  other: {
    label: 'External',
    short: 'Link',
    tone: 'muted',
    streamable: false,
    note: 'Hosted outside the known NCTB distribution channels.',
  },
};

export const sourceInfo = (key) => SOURCES[key] || SOURCES.other;

/** Cover thumbnail for a Drive file. Served to <img> without CORS. */
export const coverURL = (fileId, width = 400) =>
  `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;

/** Embeddable read-only viewer — the fallback when streaming fails. */
export const previewURL = (fileId) =>
  `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;

/**
 * Where to send a reader who wants the file on their own disk. Fine for a
 * top-level navigation — the browser restrictions that block `fetch` do not
 * apply when the user simply visits the URL.
 */
export const driveDownloadURL = (fileId) =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;

/** Drive API media endpoint — the only Drive URL a browser can read. */
export const driveApiURL = (fileId, key) =>
  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
  + `?alt=media&supportsAllDrives=true&key=${encodeURIComponent(key)}`;

/** Normalise an eGov share link to its direct-download form. */
export function egovDownloadURL(url) {
  const clean = url.replace(/\/+$/, '');
  return clean.endsWith('/download') ? clean : `${clean}/download`;
}

/** The best URL to send a reader to for a given link record. */
export function openURL(link) {
  if (link.source === 'drive' && link.fileId) return driveDownloadURL(link.fileId);
  if (link.source === 'egov') return egovDownloadURL(link.url);
  return link.url;
}

/**
 * The URL pdf.js can stream from with no help. Drive is deliberately absent:
 * it is only readable through a configured bridge, and that lives in
 * `bridge.js` (which imports this module, so the dependency cannot run the
 * other way).
 */
export function streamURL(link) {
  if (!link) return null;
  return link.source === 'oracle' ? link.url : null;
}

export const isDriveLink = (link) =>
  Boolean(link && link.source === 'drive' && link.fileId);

/**
 * Pick the link a title should open with. Object Storage first — it is
 * NCTB's own host and needs no redirect — then Drive, then anything else.
 */
export function bestLink(links = []) {
  const rank = (l) => {
    if (l.source === 'oracle') return 0;
    if (l.source === 'drive' && l.fileId) return 1;
    if (l.source === 'egov') return 2;
    return 3;
  };
  return [...links].sort((a, b) => rank(a) - rank(b))[0] || null;
}

/**
 * How a whole title can be read, for badge purposes.
 * @param {boolean} driveReadable whether a Drive bridge is configured
 */
export function titleCapability(links = [], driveReadable = false) {
  if (links.some((l) => streamURL(l))) return 'direct';
  if (driveReadable && links.some(isDriveLink)) return 'direct';
  if (links.some(isDriveLink)) return 'preview';
  if (links.length) return 'download';
  return 'none';
}

export const CAPABILITY = {
  direct:   { label: 'Reads inline', tone: 'ok' },
  preview:  { label: 'Preview · connect to annotate', tone: 'warn' },
  download: { label: 'Download only', tone: 'cyan' },
  none:     { label: 'No file', tone: 'muted' },
};

/**
 * Build a reader deep-link for a title.
 *
 * `alts` carries every *other* file NCTB lists for this same book — the
 * government mirror, and any sibling Drive copy. Google rate-limits its
 * popular files outright ("Too many users have viewed or downloaded this file
 * recently") and answers HTML instead of the PDF, so a single link is a single
 * point of failure. Handing the reader the alternates turns that from "this
 * book will not open" into a retry it can make on its own.
 *
 * Encoded compactly as `d:<driveId>` / `u:<url>` joined by `|`, capped at
 * three so the address bar stays sane.
 */
export function readerHref({ path, label, link, links = [] }) {
  const p = new URLSearchParams();
  if (link?.source === 'drive' && link.fileId) p.set('drive', link.fileId);
  else if (link?.url) p.set('url', link.url);

  const alts = links
    .filter((l) => l !== link)
    .map((l) => {
      if (l.source === 'drive' && l.fileId) return `d:${l.fileId}`;
      if (l.source === 'egov' || l.source === 'oracle') return `u:${l.url}`;
      return null;
    })
    .filter(Boolean)
    .slice(0, 3);
  if (alts.length) p.set('alts', alts.join('|'));

  if (label) p.set('title', label);
  if (path) p.set('from', path);
  return `./reader.html?${p.toString()}`;
}

/* --------------------------------------------------------------------------
   Local copies
   -------------------------------------------------------------------------- */

let localIndex = null;
let localStats = null;

/**
 * Load books/manifest.json, written by tools/fetch_books.py.
 *
 * A downloaded book is served straight off this origin: no Google, no rate
 * limit, no wait. Absent manifest simply means nobody has run the fetcher,
 * which is the normal case — so a miss is silent.
 */
export async function loadLocalIndex() {
  if (localIndex) return localIndex;
  try {
    const res = await fetch('./books/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    localIndex = new Map();
    localStats = data.byYear || {};
    for (const row of data.books || []) {
      // Indexed by every handle the site might hold: the Drive id it links by,
      // and each mirror URL, so a book found via any route resolves locally.
      const held = { file: row.file, cover: row.cover || null };
      if (row.driveId) localIndex.set(`drive:${row.driveId}`, held);
      for (const u of row.urls || []) localIndex.set(u, held);
      if (row.source) localIndex.set(row.source, held);
    }
  } catch {
    localIndex = new Map();
  }
  return localIndex;
}

const bookPath = (file) =>
  `./books/${file.split('/').map(encodeURIComponent).join('/')}`;

/**
 * How completely a given year is held on this origin.
 *
 * The fetcher is run per year, so a year is either almost entirely downloaded
 * or barely touched — there is no meaningful middle. `held / listed` therefore
 * separates the two cleanly, and stray singles picked up during testing do not
 * make a year claim to be offline when it is not.
 *
 * @param {number} year
 * @param {number} listed how many books the catalogue lists for that year
 * @returns {'local'|'remote'} where its books will actually come from
 */
export function yearOrigin(year, listed) {
  if (!localStats || !listed) return 'remote';
  const held = localStats[String(year)] || 0;
  return held / listed >= 0.9 ? 'local' : 'remote';
}

const heldRow = ({ driveId, url } = {}) => {
  if (!localIndex) return null;
  return (driveId && localIndex.get(`drive:${driveId}`)) || (url && localIndex.get(url)) || null;
};

/** Path to a downloaded copy of this book, if one exists. */
export function localCopy(ref) {
  const row = heldRow(ref);
  return row ? bookPath(row.file) : null;
}

/**
 * Cover art rendered from page one of the downloaded book.
 *
 * Google's thumbnail endpoint is rate-limited like everything else on Drive,
 * and a limited id returns nothing at all — which is why popular books showed a
 * blank tile even though the PDF itself was sitting on this disk. When we hold
 * the book we hold its cover, so this is preferred and Drive is the fallback,
 * exactly the order used for the books themselves.
 */
export function localCoverURL(ref) {
  const row = heldRow(ref);
  return row?.cover ? bookPath(row.cover) : null;
}

/** Turn one encoded alternate back into a URL the reader can stream. */
export function altURL(token) {
  if (token.startsWith('d:')) {
    return `./api/drive?id=${encodeURIComponent(token.slice(2))}`;
  }
  if (token.startsWith('u:')) return mirrorURL(token.slice(2));
  return null;
}

/**
 * Relay a mirror through the bundled endpoint, which can read it server-side.
 * eGov links in the catalogue are share *pages*; only the `/download` form
 * returns bytes, so normalise before relaying or the proxy fetches HTML.
 */
export function mirrorURL(url) {
  const target = /drive\.egovcloud\.gov\.bd/i.test(url) ? egovDownloadURL(url) : url;
  return `./api/drive?u=${encodeURIComponent(target)}`;
}
