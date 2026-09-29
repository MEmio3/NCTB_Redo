/**
 * Vercel Edge Function — GET /api/drive
 *
 *   ?id=<driveFileId>   a Google Drive file
 *   ?u=<encoded url>    an allow-listed mirror (eGov cloud, Object Storage)
 *
 * This file is the whole reason students never see a settings screen. Deploy
 * the site here and it deploys with it; the reader finds it on its own.
 *
 * Why it is needed: Google refuses cross-origin reads of Drive files from
 * browsers. The identical request that returns 206 + `access-control-allow-
 * origin: *` to a server comes back `403 text/html` once it carries browser
 * `Sec-Fetch-*` metadata. A server-side fetch has no such metadata, so it gets
 * the real bytes and re-serves them with headers a browser will accept.
 *
 * Range requests pass through, which is what lets the reader open page one of
 * a 30 MB textbook without pulling the whole file.
 */

const DRIVE = 'https://drive.usercontent.google.com/download';

// Mirrors we are willing to relay, so this can never be an open proxy.
const MIRRORS = [
  'drive.egovcloud.gov.bd',
  'objectstorage.ap-dcc-gazipur-1.oraclecloud15.com',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** Resolve the query into an upstream URL, or null if it is not allowed. */
function upstreamFor(params) {
  const id = params.get('id');
  if (id && /^[\w-]{10,100}$/.test(id)) {
    // `confirm=t` is the token Google's virus-scan interstitial would have
    // submitted for larger files, so there is nothing to parse.
    return `${DRIVE}?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  }
  const u = params.get('u');
  if (u) {
    try {
      const url = new URL(u);
      if (url.protocol === 'https:' && MIRRORS.includes(url.hostname)) return url.toString();
    } catch { /* malformed */ }
  }
  return null;
}

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  const target = upstreamFor(new URL(request.url).searchParams);
  if (!target) return new Response('Bad or missing id/u', { status: 400, headers: CORS });

  // Forward Range only. Origin, Referer and Sec-Fetch-* are deliberately
  // dropped — those headers are exactly what makes Google serve the refusal.
  const headers = new Headers();
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);

  const upstream = await fetch(target, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'follow',
  });

  // Google answers HTML — not an error status — when a file is rate-limited
  // ("Too many users have viewed or downloaded this file recently"). Passing
  // that through would reach pdf.js as a corrupt PDF, so name it instead and
  // let the reader move on to a mirror.
  const type = upstream.headers.get('Content-Type') || '';
  if (type.startsWith('text/html')) {
    return new Response('Upstream refused: file is rate-limited or unavailable',
      { status: 502, headers: { ...CORS, 'Content-Type': 'text/plain' } });
  }

  const out = new Headers(CORS);
  for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has('Content-Type')) out.set('Content-Type', 'application/pdf');
  out.set('Cache-Control', 'public, max-age=86400');

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
