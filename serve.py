from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from argparse import ArgumentParser
from pathlib import Path
import re
from urllib.parse import urlsplit
from urllib.request import urlopen
import webbrowser

from account_server import JournalAPI, prepare_accounts

WEB_ROOT = Path(__file__).resolve().parent / "web"
PUBLIC_PAGES = ("/", "/privacy.html", "/terms.html")
DEMO_AUDIO = {f"/media/{name}.wav" for name in ("street", "cocoa", "stage")}
AUDIO_RANGE = re.compile(r"bytes=([0-9]{0,19})-([0-9]{0,19})")


class JournalHandler(JournalAPI, SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            self.handle_api(path)
        elif path in {"/robots.txt", "/sitemap.xml"}:
            self.discovery_file(path)
        elif path in DEMO_AUDIO and self.send_audio_range(path):
            return
        elif path == "/vendor/supabase.js":
            sdk = WEB_ROOT.parent / "node_modules/@supabase/supabase-js/dist/umd/supabase.js"
            if not sdk.exists():
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(sdk.stat().st_size))
            self.end_headers()
            with sdk.open("rb") as source:
                self.copyfile(source, self.wfile)
        else:
            super().do_GET()

    def do_POST(self):
        self.handle_api(urlsplit(self.path).path)

    do_PUT = do_DELETE = do_POST

    def send_audio_range(self, path):
        match = AUDIO_RANGE.fullmatch(self.headers.get("Range", ""))
        if not match or not any(match.groups()):
            return False
        file = WEB_ROOT / path.lstrip("/")
        if not file.is_file():
            return False
        first, last = match.groups()
        size = file.stat().st_size
        if first:
            start, end = int(first), min(int(last), size - 1) if last else size - 1
        else:
            start, end = max(0, size - int(last)), size - 1
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        with file.open("rb") as source:
            self.send_response(206)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            source.seek(start)
            self.wfile.write(source.read(end - start + 1))
        return True

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path in {"/robots.txt", "/sitemap.xml"}:
            self.discovery_file(path)
        else:
            super().do_HEAD()

    def discovery_file(self, path):
        origin = f"http://127.0.0.1:{self.server.server_port}"
        if path == "/robots.txt":
            mime = "text/plain"
            content = f"User-agent: *\nDisallow: /\nSitemap: {origin}/sitemap.xml\n"
        else:
            mime = "application/xml"
            entries = "\n".join(f"  <url><loc>{origin}{route}</loc></url>" for route in PUBLIC_PAGES)
            content = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{entries}\n</urlset>\n'
        self.file_reply(200, mime, content.encode("utf-8"))

    def file_reply(self, status, mime, body):
        self.send_response(status)
        self.send_header("Content-Type", f"{mime}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def list_directory(self, _path):
        self.send_error(404)
        return None

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            self.file_reply(404, "text/html", (WEB_ROOT / "404.html").read_bytes())
        else:
            super().send_error(code, message, explain)

    def end_headers(self):
        path = urlsplit(self.path).path
        if path in DEMO_AUDIO:
            self.send_header("Accept-Ranges", "bytes")
        if path == "/" or Path(path).suffix in {".html", ".js", ".mjs", ".css"}:
            self.send_header("Cache-Control", "no-store")
        if not path.startswith("/api/"):
            self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()


def main():
    parser = ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    address = f"http://127.0.0.1:{args.port}/"
    handler = partial(JournalHandler, directory=str(WEB_ROOT))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError:
        try:
            with urlopen(address, timeout=2) as response:
                if b"ThroughTheLense" not in response.read(4096):
                    raise ValueError()
        except (OSError, ValueError):
            raise SystemExit(f"Порт {args.port} занят. Закройте другой локальный сервер и снова откройте дневник.")
        if not args.no_browser:
            webbrowser.open(address)
        return

    with server:
        prepare_accounts()
        print("ThroughTheLense открыт по адресу", address, flush=True)
        print("Оставьте это окно открытым, пока пользуетесь дневником.", flush=True)
        if not args.no_browser:
            webbrowser.open(address)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
