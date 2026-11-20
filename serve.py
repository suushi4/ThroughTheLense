from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen
import webbrowser


ADDRESS = "http://127.0.0.1:8000/"
WEB_ROOT = Path(__file__).resolve().parent / "web"


class JournalHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def end_headers(self):
        path = urlsplit(self.path).path
        if path == "/" or Path(path).suffix in {".html", ".js", ".mjs", ".css"}:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    handler = partial(JournalHandler, directory=str(WEB_ROOT))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 8000), handler)
    except OSError:
        try:
            with urlopen(ADDRESS, timeout=2) as response:
                if b"ThroughTheLense" not in response.read(4096):
                    raise ValueError()
        except (OSError, ValueError):
            raise SystemExit("Порт 8000 занят. Закройте другой локальный сервер и снова откройте дневник.")
        webbrowser.open(ADDRESS)
        return

    with server:
        print("ThroughTheLense открыт по адресу", ADDRESS, flush=True)
        print("Оставьте это окно открытым, пока пользуетесь дневником.", flush=True)
        webbrowser.open(ADDRESS)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
