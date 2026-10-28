"""PyTeleHost Ultra - shared helpers for Vercel Python serverless functions.
Files starting with _ are not exposed as routes by Vercel.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.request
import urllib.error

SERVICE = "PyTeleHost Ultra"
VERSION = "2.0.0"
DEVELOPER = "editz900s"
TOKEN_RE = re.compile(r"^\d{5,16}:[A-Za-z0-9_-]{30,}$")


def send(handler, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("X-Powered-By", "PyTeleHost Ultra (Python on Vercel)")
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler):
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except ValueError:
        length = 0
    raw = handler.rfile.read(length) if length > 0 else b""
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def query_of(handler):
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(handler.path).query)
    return {k: v[0] for k, v in q.items()}


def host_of(handler):
    host = handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or "localhost"
    proto = handler.headers.get("X-Forwarded-Proto")
    if not proto:  # direct (non-proxied) local/self-hosted call: avoid https->http mismatch
        proto = "http" if host.split(":")[0] in ("localhost", "127.0.0.1", "::1") else "https"
    return host, proto


def valid_token(token):
    return bool(token and TOKEN_RE.match(str(token).strip()))


"""Console authentication.

Credentials live ONLY in server-side environment variables
(ADMIN_USERNAME / ADMIN_PASSWORD, set in the Vercel dashboard) - they are
never present in frontend code, HTML, or API responses. Sessions are
stateless HMAC-signed tokens (2h) keyed by the server-side secret.
"""


def _admin_user():
    return os.environ.get("ADMIN_USERNAME", "")


def _admin_pass():
    return os.environ.get("ADMIN_PASSWORD", "")


def admin_configured():
    return bool(_admin_user() and _admin_pass())


def _signing_key():
    return hashlib.sha256(f"{_admin_user()}:{_admin_pass()}".encode()).digest()


def check_credentials(username, password):
    if not admin_configured():
        return False
    return (hmac.compare_digest(str(username or ""), _admin_user())
            and hmac.compare_digest(str(password or ""), _admin_pass()))


def issue_session(username):
    payload = {"u": username, "role": "super-admin",
               "exp": int(time.time()) + 2 * 3600, "iat": int(time.time())}
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    sig = hmac.new(_signing_key(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}", payload["exp"]


def verify_session(handler):
    """Return session payload dict, or None. Expects 'Authorization: Bearer …'."""
    auth = handler.headers.get("Authorization") or ""
    if not auth.startswith("Bearer ") or not admin_configured():
        return None
    try:
        raw, sig = auth[7:].strip().rsplit(".", 1)
        expected = hmac.new(_signing_key(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def telegram(token, method, payload=None, timeout=10):
    """Call the Telegram Bot API. Returns (ok, dict)."""
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload or {}).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return True, json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            return False, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return False, {"ok": False, "description": f"Telegram HTTP {e.code}"}
    except Exception as e:  # network / timeout
        return False, {"ok": False, "description": f"Could not reach Telegram: {e}"}
