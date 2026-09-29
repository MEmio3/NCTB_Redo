/* ==========================================================================
   NCTB Atlas — the Drive bridge

   A browser cannot read Google Drive file bytes cross-origin. That is not a
   CORS oversight on Google's part, it is deliberate: `drive.usercontent
   .google.com` returns 206 with `access-control-allow-origin: *` to curl, and
   403 text/html to anything sending browser `Sec-Fetch-*` metadata. There is
   no header trick, no redirect, and no fetch mode that gets around it.

   The fix belongs to whoever publishes the site, once — never to the reader.
   A student should click a book and read it, and should never encounter the
   words "API key". So the default mode is `auto`:

     auto    Probe `./api/drive?id=…` once per session. That endpoint ships
             with this project (`functions/api/drive.js` for Cloudflare Pages,
             `api/drive.js` for Vercel, `netlify/functions/drive.js` for
             Netlify), so on any of those hosts it simply exists after deploy
             and Drive books open inline with zero configuration anywhere.
             On a plain static host with no functions the probe fails quietly
             and the reader falls back to Drive's own viewer.

   The two manual modes stay available for anyone who needs them, but nothing
   in the normal reading path ever asks for them:

     key     `www.googleapis.com/drive/v3/files/{id}?alt=media&key=…`.
             googleapis.com is browser-facing, so CORS passes there.
     proxy   Any URL that re-serves the file with permissive CORS.

   Manual settings are stored per-browser in localStorage and never travel
   anywhere except to the endpoint configured.
   ========================================================================== */

import { driveApiURL } from './sources.js';

const KEY = 'atlas:drive-bridge';

/** @typedef {{mode:'none'|'key'|'proxy', apiKey?:string, proxy?:string}} Bridge */

/** @returns {Bridge} */
export function getBridge() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { mode: 'none' };
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' ? cfg : { mode: 'none' };
  } catch {
    return { mode: 'none' };
  }
}

export function setBridge(cfg) {
  if (!cfg || cfg.mode === 'none') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(cfg));
  return getBridge();
}

/* --------------------------------------------------------------------------
   The bundled endpoint
   -------------------------------------------------------------------------- */

const AUTO_KEY = 'atlas:auto-drive';
const AUTO_PATH = './api/drive';
/** A small, known-public NCTB book used to prove the endpoint really works. */
const PROBE_ID = '1hY6Hjdw9Tr2R7fjQmbZMc_jeP0qJHEEA';

let autoProbe;

/**
 * Does this deployment carry the bundled /api/drive function?
 * Probed at most once per tab; the answer is remembered for the session so
 * repeat visits and page changes cost nothing.
 */
export function autoAvailable() {
  return sessionStorage.getItem(AUTO_KEY) === '1';
}

export async function detectAuto() {
  const cached = sessionStorage.getItem(AUTO_KEY);
  if (cached !== null) return cached === '1';

  autoProbe ||= (async () => {
    try {
      const res = await fetch(`${AUTO_PATH}?id=${PROBE_ID}`, { headers: { Range: 'bytes=0-4' } });
      if (!res.ok && res.status !== 206) throw new Error(String(res.status));
      const magic = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).subarray(0, 5));
      // A static host without functions happily returns its 404 page with a
      // 200, so the bytes themselves are the only trustworthy signal.
      return magic === '%PDF-';
    } catch {
      return false;
    }
  })();

  const ok = await autoProbe;
  sessionStorage.setItem(AUTO_KEY, ok ? '1' : '0');
  return ok;
}

/** True when Drive books can be read inline, however that was arranged. */
export const bridgeActive = () => getBridge().mode !== 'none' || autoAvailable();

/**
 * Every URL worth trying for a Drive file, best first.
 *
 * The bundled endpoint is ALWAYS included, even when the probe said it was
 * absent. The probe is a five-byte guess that can fail for reasons that have
 * nothing to do with this book — a cold start, a blip, a `0` cached in
 * sessionStorage from a page load under a different server — and if a stale
 * "no" stops us from even attempting, every Drive book silently degrades to
 * Drive's viewer. Opening the actual book is the only test that matters.
 */
export function driveCandidates(fileId) {
  const cfg = getBridge();
  const out = [];

  if (cfg.mode === 'key' && cfg.apiKey) out.push(driveApiURL(fileId, cfg.apiKey));
  if (cfg.mode === 'proxy' && cfg.proxy) {
    const target =
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
    out.push(cfg.proxy.includes('{url}')
      ? cfg.proxy.replace('{url}', encodeURIComponent(target))
      : cfg.proxy + encodeURIComponent(target));
  }

  out.push(`${AUTO_PATH}?id=${encodeURIComponent(fileId)}`);
  return out;
}

/** Kept for the settings dialog, which only cares about the configured route. */
export function driveStreamURL(fileId) {
  return driveCandidates(fileId)[0] || null;
}

/**
 * Check a bridge against a known-public file before saving it, so the reader
 * finds out here rather than on their first book.
 *
 * @returns {Promise<{ok:boolean, detail:string}>}
 */
export async function testBridge(cfg, fileId = '1hY6Hjdw9Tr2R7fjQmbZMc_jeP0qJHEEA') {
  const previous = getBridge();
  try {
    setBridge(cfg);
    const url = driveStreamURL(fileId);
    if (!url) return { ok: false, detail: 'Nothing configured to test.' };

    // A short range keeps the check to a few hundred bytes.
    const res = await fetch(url, { headers: { Range: 'bytes=0-15' } });
    if (!res.ok && res.status !== 206) {
      let reason = `${res.status} ${res.statusText}`;
      try {
        const body = await res.clone().json();
        if (body?.error?.message) reason = body.error.message;
      } catch { /* not JSON; the status line is enough */ }
      return { ok: false, detail: reason };
    }

    const head = new Uint8Array(await res.arrayBuffer()).subarray(0, 5);
    const magic = new TextDecoder().decode(head);
    if (magic !== '%PDF-') {
      return { ok: false, detail: `Expected a PDF, received "${magic.trim() || '?'}"` };
    }
    return { ok: true, detail: 'Streamed a real PDF — Drive books will open inline.' };
  } catch (err) {
    return {
      ok: false,
      detail: /Failed to fetch/i.test(String(err))
        ? 'Blocked by the browser — the endpoint did not allow a cross-origin read.'
        : String(err).slice(0, 140),
    };
  } finally {
    // Only the caller decides whether to keep it.
    setBridge(previous);
  }
}
