from __future__ import annotations

import json
import os
import smtplib
import sys
import hashlib
from datetime import datetime, timezone
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.environ.get("STATE_PATH", "").strip() or os.path.join(BASE_DIR, "state.json")
MAX_BODY_BYTES = 2 * 1024 * 1024


def booklet_key_from_path(path: str) -> str:
    parsed = urlparse(path)
    key = parse_qs(parsed.query).get("booklet", ["mykonos"])[0].strip().lower()
    if not key:
        return "mykonos"
    return "".join(ch for ch in key if ch.isalnum() or ch in ("-", "_")) or "mykonos"


def read_store() -> dict:
    if not os.path.exists(STATE_PATH):
        return {"booklets": {}}

    with open(STATE_PATH, "r", encoding="utf-8-sig") as state_file:
        parsed = json.load(state_file)

    if isinstance(parsed, dict) and isinstance(parsed.get("booklets"), dict):
        return parsed

    if isinstance(parsed, dict) and isinstance(parsed.get("names"), list):
        return {"booklets": {"mykonos": parsed}}

    return {"booklets": {}}


def state_revision(payload: dict) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f'"{digest}"'


def write_store(store: dict) -> None:
    temp_path = f"{STATE_PATH}.tmp"
    with open(temp_path, "w", encoding="utf-8") as temp_file:
        json.dump(store, temp_file, ensure_ascii=False)
    os.replace(temp_path, STATE_PATH)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            self._handle_get_state()
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            self._handle_post_state()
            return
        if path == "/api/notify":
            self._handle_post_notify()
            return
        self.send_error(404, "Not Found")

    def _handle_get_state(self) -> None:
        booklet = booklet_key_from_path(self.path)
        try:
            store = read_store()
        except OSError:
            self.send_error(500, "Failed to read state")
            return
        except json.JSONDecodeError:
            self.send_error(500, "Invalid persisted state")
            return

        current = store.get("booklets", {}).get(booklet)
        if not isinstance(current, dict):
            self.send_response(404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"error":"state-not-found"}')
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("ETag", state_revision(current))
        self.end_headers()
        self.wfile.write(json.dumps(current, ensure_ascii=False).encode("utf-8"))

    def _handle_post_state(self) -> None:
        content_length = self.headers.get("Content-Length")
        if content_length is None:
            self.send_error(411, "Content-Length required")
            return

        try:
            length = int(content_length)
        except ValueError:
            self.send_error(400, "Invalid Content-Length")
            return

        if length < 0 or length > MAX_BODY_BYTES:
            self.send_error(413, "Payload too large")
            return

        try:
            body = self.rfile.read(length)
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")
            return

        if not isinstance(parsed, dict):
            self.send_error(400, "State must be a JSON object")
            return

        booklet = booklet_key_from_path(self.path)
        parsed_url = urlparse(self.path)
        query = parse_qs(parsed_url.query)
        client_rev = (self.headers.get("If-Match") or "").strip()
        if not client_rev:
            client_rev = (query.get("rev", [""])[0] or "").strip()

        try:
            store = read_store()
            if not isinstance(store.get("booklets"), dict):
                store["booklets"] = {}
            existing = store["booklets"].get(booklet)
            if isinstance(existing, dict):
                current_rev = state_revision(existing)
                if not client_rev:
                    self.send_response(409)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("ETag", current_rev)
                    self.end_headers()
                    self.wfile.write(
                        json.dumps({"error": "stale-state", "reason": "missing-revision", "currentRev": current_rev}).encode("utf-8")
                    )
                    return
                if client_rev != current_rev:
                    self.send_response(409)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("ETag", current_rev)
                    self.end_headers()
                    self.wfile.write(
                        json.dumps({"error": "stale-state", "reason": "revision-mismatch", "currentRev": current_rev}).encode("utf-8")
                    )
                    return
            store["booklets"][booklet] = parsed
            write_store(store)
        except OSError:
            self.send_error(500, "Failed to persist state")
            return
        except json.JSONDecodeError:
            self.send_error(500, "Invalid persisted state")
            return

        self.send_response(204)
        self.send_header("ETag", state_revision(parsed))
        self.end_headers()

    def _handle_post_notify(self) -> None:
        content_length = self.headers.get("Content-Length")
        if content_length is None:
            self.send_error(411, "Content-Length required")
            return

        try:
            length = int(content_length)
        except ValueError:
            self.send_error(400, "Invalid Content-Length")
            return

        if length < 0 or length > MAX_BODY_BYTES:
            self.send_error(413, "Payload too large")
            return

        payload: dict = {}
        try:
            raw = self.rfile.read(length)
            if raw:
                parsed = json.loads(raw.decode("utf-8"))
                if isinstance(parsed, dict):
                    payload = parsed
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")
            return

        smtp_host = os.environ.get("SMTP_HOST", "").strip()
        smtp_port = int(os.environ.get("SMTP_PORT", "587"))
        smtp_user = os.environ.get("SMTP_USER", "").strip()
        smtp_pass = os.environ.get("SMTP_PASS", "").strip()
        notify_to = os.environ.get("NOTIFY_TO", "").strip()
        notify_from = os.environ.get("NOTIFY_FROM", smtp_user).strip()
        smtp_secure = os.environ.get("SMTP_SECURE", "starttls").strip().lower()

        if not (smtp_host and smtp_user and smtp_pass and notify_to and notify_from):
            self.send_response(503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b'{"error":"email-not-configured","hint":"Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NOTIFY_TO, NOTIFY_FROM"}'
            )
            return

        booklet = payload.get("booklet") or booklet_key_from_path(self.path)
        pages = payload.get("pages") or "unknown"
        updated_at = payload.get("updatedAt") or datetime.now(timezone.utc).isoformat()

        msg = EmailMessage()
        msg["From"] = notify_from
        msg["To"] = notify_to
        msg["Subject"] = f"Booklet update: {booklet}"
        msg.set_content(
            "Your client reported changes in the booklet planner.\n\n"
            f"Booklet: {booklet}\n"
            f"Pages: {pages}\n"
            f"Updated at (UTC): {updated_at}\n"
        )

        try:
            if smtp_secure == "ssl":
                with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20) as server:
                    server.login(smtp_user, smtp_pass)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
                    server.ehlo()
                    if smtp_secure == "starttls":
                        server.starttls()
                        server.ehlo()
                    server.login(smtp_user, smtp_pass)
                    server.send_message(msg)
        except Exception as exc:
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            safe_error = str(exc).replace('"', "'")
            self.wfile.write(json.dumps({"error": "email-send-failed", "details": safe_error}).encode("utf-8"))
            return

        self.send_response(204)
        self.end_headers()


def main() -> None:
    port = int(os.environ.get("PORT", "5500"))
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    os.chdir(BASE_DIR)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving booklet app on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
