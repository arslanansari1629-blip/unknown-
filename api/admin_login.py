"""Restricted console sign-in. Credentials from server env only.

POST {"username": "...", "password": "..."} -> {"token", "expires_at", ...}
Brute-force guard: 5 failed attempts from one IP locks it for 60 seconds
(per warm instance). Nothing about valid credentials is ever returned
on failure.
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from _common import send, read_json, admin_configured, check_credentials, issue_session
from http.server import BaseHTTPRequestHandler

ATTEMPTS = {}  # ip -> [timestamps]
LOCKS = {}     # ip -> locked_until


def client_ip(h):
    return (h.headers.get("X-Forwarded-For") or "local").split(",")[0].strip()


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not admin_configured():
            return send(self, {"ok": False, "error": "Console is not configured on this deployment."}, 503)
        ip = client_ip(self)
        now = time.time()
        if LOCKS.get(ip, 0) > now:
            return send(self, {"ok": False, "error": "Too many attempts. Try again in a minute."}, 429)
        data = read_json(self)
        if check_credentials(data.get("username"), data.get("password")):
            ATTEMPTS.pop(ip, None)
            token, exp = issue_session(str(data.get("username")))
            return send(self, {"ok": True, "token": token, "expires_at": exp,
                               "user": str(data.get("username")), "role": "super-admin",
                               "permissions": ["*"]})
        tries = [t for t in ATTEMPTS.get(ip, []) if now - t < 300] + [now]
        ATTEMPTS[ip] = tries
        if len(tries) >= 5:
            LOCKS[ip] = now + 60
            ATTEMPTS[ip] = []
        send(self, {"ok": False, "error": "Invalid credentials."}, 401)

    def do_GET(self):
        send(self, {"ok": True, "configured": admin_configured(),
                    "console": "v9", "method": "POST {username, password}"})

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
