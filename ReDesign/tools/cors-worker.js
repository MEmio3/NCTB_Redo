/**
 * Atlas Drive proxy — a Cloudflare Worker.
 *
 * Google refuses cross-origin reads of Drive files from browsers: the same
 * request that returns `206` + `access-control-allow-origin: *` to curl comes
 * back `403 text/html` once it carries browser `Sec-Fetch-*` metadata. A
 * server-side fetch has no such metadata, so this Worker gets the real bytes
 * and re-serves them with headers a browser will accept.
 *
 * Deploy (free tier is plenty):
 *   npm i -g wrangler
 *   wrangler init atlas-drive-proxy      # choose "Hello World" worker
 *   # replace src/index.js with this file
 *   wrangler deploy
 *
 * Then paste the deployed URL into the reader's Drive connection panel as:
 *   https://atlas-drive-proxy.<you>.workers.dev/?url={url}
 *
 * Range requests are passed through, which is what lets pdf.js open page one
 * of a 30 MB textbook without pulling the whole file.
 */

// Lock this down to the sites you actually serve Atlas from. "*" is fine
// while testing; narrow it before sharing the Worker's address.
const ALLOWED_ORIGINS = ['*'];

// Only ever proxy Google's own file hosts, so this cannot be used as an open
// relay for arbitrary URLs.
const ALLOWED_HOSTS = new Set([
  'drive.usercontent.google.com',
  'drive.google.com',
  'www.googleapis.com',
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return new Response('Pass ?url=<encoded Drive URL>', { status: 400, headers: cors });
    }

    let upstream;
    try {
      upstream = new URL(target);
    } catch {
      return new Response('Malformed url parameter', { status: 400, headers: cors });
    }
    if (!ALLOWED_HOSTS.has(upstream.hostname)) {
      return new Response(`Refusing to proxy ${upstream.hostname}`, { status: 403, headers: cors });
    }

    // Forward only Range. Everything else — Origin, Referer, Sec-Fetch-* — is
    // deliberately dropped: those headers are exactly what makes Google serve
    // the 403 interstitial instead of the file.
    const headers = new Headers();
    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);

    const res = await fetch(upstream.toString(), {
      method: request.method,
      headers,
      redirect: 'follow',
      cf: { cacheTtl: 3600, cacheEverything: true },
    });

    const out = new Headers(cors);
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    // Drive labels PDFs as octet-stream; pdf.js does not mind, but being
    // accurate helps anything else that consumes this.
    if (!out.has('Content-Type')) out.set('Content-Type', 'application/pdf');
    out.set('Cache-Control', 'public, max-age=3600');

    return new Response(res.body, { status: res.status, headers: out });
  },
};
