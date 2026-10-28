"""PyTeleHost Ultra - shared helpers for Vercel Python serverless functions.
Files starting with _ are not exposed as routes by Vercel.
"""
import json
import os
import re
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
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
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
    proto = handler.headers.get("X-Forwarded-Proto") or "https"
    return host, proto


def valid_token(token):
    return bool(token and TOKEN_RE.match(str(token).strip()))


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
