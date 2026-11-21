"""Loopback account and diary API for the local ThroughTheLense server."""
from contextlib import contextmanager
from collections import deque
from hashlib import pbkdf2_hmac, sha256
from hmac import compare_digest
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
import json
import os
import re
import secrets
import sqlite3
import time
from threading import Lock


COOKIE = "ttl_session"
SESSION_SECONDS = 14 * 24 * 60 * 60
DAY_LIMIT = 76 * 1024 * 1024
DAY_PATH = re.compile(r"/api/days/([A-Za-z0-9_-]{8,64})")
EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
DB_PATH = Path(os.environ.get("TTL_DATA_DIR", Path(__file__).parent / ".ttl-data")) / "journal.sqlite"
CLOUD_URL = os.environ.get("SUPABASE_URL")
CLOUD_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
POST_LIMITS = {"/api/login": 8, "/api/register": 6, "/api/analytics": 60}
post_attempts = {path: deque() for path in POST_LIMITS}
attempts_lock = Lock()

SCHEMA = """
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt BLOB NOT NULL, digest BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS days (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL, summary TEXT NOT NULL, content BLOB NOT NULL,
        PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS home_visits (
        day TEXT PRIMARY KEY, visits INTEGER NOT NULL
    );
"""


class RequestError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


@contextmanager
def database():
    connection = sqlite3.connect(DB_PATH, timeout=8)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def prepare_accounts():
    DB_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with database() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA)


def password_digest(password, salt):
    return pbkdf2_hmac("sha256", password.encode(), salt, 600_000)


def token_digest(token):
    return sha256(token.encode()).hexdigest()


def limit_post(path):
    attempts = post_attempts[path]
    with attempts_lock:
        now = time.monotonic()
        while attempts and attempts[0] <= now - 60:
            attempts.popleft()
        if len(attempts) >= POST_LIMITS[path]:
            raise RequestError(429, "Слишком много запросов. Попробуйте через минуту.")
        attempts.append(now)


class JournalAPI:
    def api_json(self, status, data, cookie=None):
        self.api_reply(status, json.dumps(data, ensure_ascii=False).encode(), cookie)

    def api_reply(self, status, payload, cookie=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status == 429:
            self.send_header("Retry-After", "60")
        if cookie is not None:
            expires = SESSION_SECONDS if cookie else 0
            self.send_header("Set-Cookie", f"{COOKIE}={cookie}; Path=/api; HttpOnly; SameSite=Strict; Max-Age={expires}")
        self.end_headers()
        self.wfile.write(payload)

    def body(self, limit):
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= limit:
                raise RequestError(413, "Файл или запрос слишком большой.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeError):
            raise RequestError(400, "Не удалось прочитать запрос.")

    def session_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        item = cookie.get(COOKIE)
        if item and re.fullmatch(r"[A-Za-z0-9_-]{43}", item.value):
            return token_digest(item.value)
        return None

    def session_user(self, db):
        return db.execute(
            "SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id "
            "WHERE token=? AND expires>?", (self.session_token(), int(time.time()))
        ).fetchone()

    def new_session(self, db, user_id):
        token = secrets.token_urlsafe(32)
        db.execute("DELETE FROM sessions WHERE expires<=? OR token=?", (int(time.time()), self.session_token()))
        db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (token_digest(token), user_id, int(time.time()) + SESSION_SECONDS))
        return token

    def credentials(self, path, db):
        data = self.body(4096)
        email, password = data.get("email"), data.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            raise RequestError(400, "Введите почту и пароль.")
        email = email.strip().lower()
        if len(email) > 254 or not EMAIL.fullmatch(email) or not 1 <= len(password) <= 128:
            raise RequestError(400, "Проверьте почту и пароль.")
        if path == "/api/register":
            if len(password) < 8:
                raise RequestError(400, "Пароль должен содержать не менее 8 символов.")
            user_id, salt = secrets.token_hex(16), secrets.token_bytes(16)
            digest = password_digest(password, salt)
            try:
                db.execute("INSERT INTO users VALUES (?, ?, ?, ?)", (user_id, email, salt, digest))
            except sqlite3.IntegrityError:
                raise RequestError(409, "Этот адрес уже зарегистрирован.")
        else:
            row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            digest = password_digest(password, row["salt"] if row else b"invalid-account!")
            if row is None or not compare_digest(row["digest"], digest):
                raise RequestError(401, "Неверная почта или пароль.")
            user_id = row["id"]
        return {"user": {"id": user_id, "email": email}}, self.new_session(db, user_id)

    def day_request(self, path, db, owner):
        if path == "/api/days" and self.command == "GET":
            rows = db.execute("SELECT id, summary FROM days WHERE user_id=?", (owner,))
            return {"days": [{**json.loads(row["summary"]), "id": row["id"]} for row in rows]}
        match = DAY_PATH.fullmatch(path)
        if not match:
            raise RequestError(404, "Адрес не найден.")
        day_id = match[1]
        if self.command == "GET":
            row = db.execute("SELECT content FROM days WHERE user_id=? AND id=?", (owner, day_id)).fetchone()
            if row is None:
                raise RequestError(404, "День не найден.")
            return row["content"]
        if self.command == "DELETE":
            db.execute("DELETE FROM days WHERE user_id=? AND id=?", (owner, day_id))
            return {"ok": True}
        if self.command != "PUT":
            raise RequestError(405, "Метод недоступен.")
        data = self.body(DAY_LIMIT)
        summary, content = data.get("summary"), data.get("copy")
        if (not isinstance(summary, dict) or not isinstance(content, dict)
                or content.get("format") != "ThroughTheLense/day" or content.get("version") != 1):
            raise RequestError(400, "Копия дня не распознана.")
        encoded = json.dumps(summary, ensure_ascii=False)
        if len(encoded) > 360_000:
            raise RequestError(413, "Обложка слишком большая.")
        payload = json.dumps(content, ensure_ascii=False).encode()
        if data.get("editing") is True:
            result = db.execute("UPDATE days SET summary=?, content=? WHERE user_id=? AND id=?", (encoded, payload, owner, day_id))
            if not result.rowcount:
                raise RequestError(404, "День уже удалён.")
        else:
            db.execute(
                "INSERT INTO days VALUES(?, ?, ?, ?) ON CONFLICT(user_id, id) DO NOTHING",
                (owner, day_id, encoded, payload)
            )
        return {"ok": True}

    def handle_api(self, path):
        try:
            host = self.headers.get("Host")
            port = self.server.server_port
            if host not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
                raise RequestError(403, "Сервер доступен только на этом компьютере.")
            if self.command not in {"GET", "HEAD"} and (
                self.headers.get("Origin") not in (None, f"http://{host}") or
                self.headers.get("X-Diary-Request") != "1"
            ):
                raise RequestError(403, "Запрос отклонён.")
            if path == "/api/runtime" and self.command == "GET":
                mode = {"mode": "local", "analytics": "local"}
                if CLOUD_URL and CLOUD_KEY and CLOUD_KEY.startswith("sb_publishable_"):
                    mode.update(mode="supabase", url=CLOUD_URL, key=CLOUD_KEY)
                self.api_json(200, mode)
                return
            if self.command == "POST" and path in POST_LIMITS:
                limit_post(path)
            cookie = None
            with database() as db:
                if self.command == "POST" and path == "/api/analytics":
                    if self.body(128) != {"event": "home_view"}:
                        raise RequestError(400, "Неизвестное событие.")
                    db.execute(
                        "INSERT INTO home_visits VALUES(date('now','localtime'), 1) "
                        "ON CONFLICT(day) DO UPDATE SET visits=visits+1"
                    )
                    result = {"ok": True}
                elif self.command == "POST" and path in {"/api/register", "/api/login"}:
                    result, cookie = self.credentials(path, db)
                elif path == "/api/logout" and self.command == "POST":
                    db.execute("DELETE FROM sessions WHERE token=?", (self.session_token(),))
                    result, cookie = {"ok": True}, ""
                else:
                    user = self.session_user(db)
                    if path == "/api/session" and self.command == "GET":
                        result = {"user": dict(user) if user else None}
                    elif path.startswith("/api/days") and user:
                        result = self.day_request(path, db, user["id"])
                    elif path.startswith("/api/days"):
                        raise RequestError(401, "Войдите в аккаунт.")
                    else:
                        raise RequestError(404, "Адрес не найден.")
            if isinstance(result, bytes):
                self.api_reply(200, result)
            else:
                self.api_json(200, result, cookie)
        except RequestError as error:
            # The connection may still contain an unread (possibly oversized) body.
            self.close_connection = True
            self.api_json(error.status, {"message": error.message})
        except sqlite3.Error:
            self.api_json(503, {"message": "Дневник временно недоступен. Попробуйте снова."})
