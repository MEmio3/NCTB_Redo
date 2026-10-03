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

export const isGovUrl = (url) =>
  Boolean(url && (/drive\.egovcloud\.gov\.bd|\.gov\.bd|oraclecloud15\.com/i.test(url)));

export const isGovLink = (link) =>
  Boolean(link && (link.source === 'egov' || isGovUrl(link.url)));

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
 * Exposes driveId, gov mirror URL, and any alternates so the reader
 * can try:
 *   1) Google Drive
 *   2) Government Mirror (eGov Cloud)
 *   3) Downloaded copy in books/ (last resort)
 */
export function readerHref({ path, label, link, links = [] }) {
  const p = new URLSearchParams();
  const driveLink = links.find((l) => l.source === 'drive' && l.fileId) || (link?.source === 'drive' && link.fileId ? link : null);
  const govLink = links.find((l) => l.source === 'egov' || (l.url && isGovUrl(l.url))) || (link && isGovUrl(link.url) ? link : null);

  if (driveLink?.fileId) p.set('drive', driveLink.fileId);
  if (govLink?.url) p.set('gov', govLink.url);

  if (!driveLink && !govLink && link?.url) {
    p.set('url', link.url);
  }

  const alts = links
    .filter((l) => l !== driveLink && l !== govLink)
    .map((l) => {
      if (l.source === 'drive' && l.fileId) return `d:${l.fileId}`;
      if (l.url) return `u:${l.url}`;
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
 * A downloaded book is kept on this disk as a last-resort backup if both
 * Drive and the government mirror cannot be reached.
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
      const held = { file: row.file, cover: row.cover || null, urls: row.urls || [] };
      if (row.driveId) localIndex.set(`drive:${row.driveId}`, held);
      for (const u of row.urls || []) {
        localIndex.set(u, held);
        localIndex.set(egovDownloadURL(u), held);
      }
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
 * @param {number} year
 * @param {number} listed how many books the catalogue lists for that year
 * @returns {'local'|'remote'} where its books will actually come from
 */
export function yearOrigin(year, listed) {
  if (!localStats || !listed) return 'remote';
  const held = localStats[String(year)] || 0;
  return held / listed >= 0.9 ? 'local' : 'remote';
}

const heldRow = ({ driveId, url, gov } = {}) => {
  if (!localIndex) return null;
  return (driveId && localIndex.get(`drive:${driveId}`))
      || (gov && localIndex.get(gov))
      || (gov && localIndex.get(egovDownloadURL(gov)))
      || (url && localIndex.get(url))
      || (url && localIndex.get(egovDownloadURL(url)))
      || null;
};

/** Path to a downloaded copy of this book, if one exists (used as last resort). */
export function localCopy(ref) {
  const row = heldRow(ref);
  return row ? bookPath(row.file) : null;
}

/**
 * Resolve an associated government mirror URL for a given book reference
 * using alts or local index catalog metadata.
 */
export function findGovUrl({ driveId, url, alts } = {}) {
  if (alts) {
    for (const token of String(alts).split('|')) {
      if (token.startsWith('u:')) {
        const u = token.slice(2);
        if (isGovUrl(u)) return u;
      }
    }
  }
  if (localIndex) {
    if (driveId) {
      const row = localIndex.get(`drive:${driveId}`);
      if (row?.urls) {
        const g = row.urls.find(isGovUrl);
        if (g) return g;
      }
    }
    if (url) {
      const row = localIndex.get(url);
      if (row?.urls) {
        const g = row.urls.find(isGovUrl);
        if (g) return g;
      }
    }
  }
  return null;
}

/** Cover art rendered from page one of the downloaded book. */
export function localCoverURL(ref) {
  const row = heldRow(ref);
  return row?.cover ? bookPath(row.cover) : null;
}

/** Turn one encoded alternate back into a URL the reader can stream. */
export function altURL(token) {
  if (!token) return null;
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
  if (!url) return null;
  if (url.startsWith('./api/drive') || url.startsWith('/api/drive')) return url;
  const target = egovDownloadURL(url);
  return `./api/drive?u=${encodeURIComponent(target)}`;
}
