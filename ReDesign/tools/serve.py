#!/usr/bin/env python3
"""Local dev server with the same /api/drive endpoint the deployed site gets.

`python -m http.server` cannot serve Drive books, because reading them needs a
server-side fetch (Google refuses cross-origin reads from browsers). This
serves the static files *and* implements /api/drive exactly as the Cloudflare
Pages / Vercel / Netlify functions do, so local development behaves like
production.

    python ReDesign/tools/serve.py          # http://localhost:8899

Serves the ReDesign folder as the web root, so http://localhost:8899/ is the
shelf. The repository root also holds an older, unrelated `index.html` (the
"NCTB Endpoints" API reference); serving from the root would put that at `/`
and it would look like the site had reverted. Can be run from anywhere.
"""

import functools
import http.server
import os
import re
import socketserver
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse, parse_qs

# Windows consoles default to cp1252, which cannot encode an arrow — let alone
# a Bengali book title — and a print() that raises takes the process with it.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):          # already wrapped, or not a tty
        pass

PORT = 8899
# tools/ -> ReDesign/
SITE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRIVE = "https://drive.usercontent.google.com/download"
ID_RE = re.compile(r"^[\w-]{10,100}$")

# Mirrors we are willing to relay, so this is never an open proxy.
MIRRORS = {
    "drive.egovcloud.gov.bd",
    "objectstorage.ap-dcc-gazipur-1.oraclecloud15.com",
}

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers":
        "Content-Length,Content-Range,Accept-Ranges,Content-Type",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        for k, v in CORS.items():
            self.send_header(k, v)

    def end_headers(self):
        """Never let a browser cache the source while it is being edited.

        SimpleHTTPRequestHandler sends Last-Modified and no Cache-Control, which
        lets a browser cache heuristically. An ES module held that way survives
        a reload, so edits appear not to apply and — worse — a stale module can
        keep throwing errors from code that no longer exists, which reads as a
        phantom bug. Books are exempt: they are large, immutable, and worth
        keeping.
        """
        if not self.path.startswith("/books/"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/").endswith("/api/drive"):
            self.proxy(parse_qs(parsed.query))
            return
        super().do_GET()

    def upstream_for(self, query):
        """?id= a Drive file, or ?u= an allow-listed mirror. Never anything else."""
        file_id = query.get("id", [""])[0]
        if ID_RE.match(file_id or ""):
            # confirm=t is the token Google's virus-scan interstitial would have
            # submitted for larger files, so there is nothing to parse.
            return f"{DRIVE}?id={file_id}&export=download&confirm=t"
        u = query.get("u", [""])[0]
        if u:
            parts = urlparse(u)
            if parts.scheme == "https" and parts.hostname in MIRRORS:
                return u
        return None

    def proxy(self, query):
        target = self.upstream_for(query)
        if not target:
            self.send_error(400, "Bad or missing id/u")
            return

        # Forward Range only. Sending Origin/Referer/Sec-Fetch-* is exactly what
        # makes Google answer with its refusal page instead of the file.
        headers = {}
        rng = self.headers.get("Range")
        if rng:
            headers["Range"] = rng

        req = urllib.request.Request(target, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as up:
                ctype = up.headers.get("Content-Type", "")
                # Google answers HTML, not an error status, when a file is
                # rate-limited ("Too many users have viewed or downloaded this
                # file recently"). Passing it on would reach pdf.js as a corrupt
                # PDF, so name it and let the reader try a mirror.
                if ctype.startswith("text/html"):
                    self.send_error(502, "Upstream refused: rate-limited or unavailable")
                    return
                body = up.read()
                self.send_response(up.status)
                self._cors()
                for h in ("Content-Type", "Content-Range", "Accept-Ranges", "ETag"):
                    if up.headers.get(h):
                        self.send_header(h, up.headers[h])
                if not ctype:
                    self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as err:
            self.send_error(err.code, f"Upstream said {err.code}")
        except Exception as err:                      # noqa: BLE001
            self.send_error(502, f"Upstream failed: {err}")

    def log_message(self, fmt, *args):
        # log_error() passes an HTTPStatus as args[0], not a string, so this
        # has to stringify before testing — otherwise a plain 404 (favicon,
        # say) raises inside the logger and takes the request thread with it.
        first = str(args[0]) if args else ""
        if "/api/drive" in first:
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=SITE_ROOT)
    with Server(("", PORT), handler) as httpd:
        print(f"The Shelf  →  http://localhost:{PORT}/")
        print(f"serving     {SITE_ROOT}")
        print("with /api/drive so Google Drive books open inline")
        httpd.serve_forever()
