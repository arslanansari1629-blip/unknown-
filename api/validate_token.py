"""POST /api/validate_token {token} - real check against Telegram getMe."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _common import send, read_json, query_of, valid_token, telegram
from http.server import BaseHTTPRequestHandler


def handle(h, data):
    token = str(data.get("token") or "").strip()
    if not token:
        return send(h, {"ok": False, "error": "Send {\"token\": \"123456:ABC...\"}"}, 400)
    if not valid_token(token):
        return send(h, {"ok": False, "valid": False,
                        "error": "Token format looks invalid (expected 123456789:AA...)"}, 400)
    ok, res = telegram(token, "getMe")
    if not ok or not res.get("ok"):
        return send(h, {"ok": False, "valid": False,
                        "error": (res or {}).get("description", "Telegram rejected the token")}, 400)
    me = res["result"]
    send(h, {"ok": True, "valid": True, "bot": {
        "id": me.get("id"), "username": me.get("username"),
        "first_name": me.get("first_name"),
        "can_join_groups": me.get("can_join_groups"),
        "can_read_all_group_messages": me.get("can_read_all_group_messages"),
        "supports_inline_queries": me.get("supports_inline_queries"),
        "url": f"https://t.me/{me.get('username')}" if me.get("username") else None,
    }})


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        handle(self, read_json(self))

    def do_GET(self):
        q = query_of(self)
        if q.get("token"):
            handle(self, q)
        else:
            send(self, {"ok": True, "usage": "POST /api/validate_token with JSON {\"token\": \"...\"}"})

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
