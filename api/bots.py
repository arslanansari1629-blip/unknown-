"""POST/GET/DELETE /api/bots - serverless bot registry.

On Vercel each function instance keeps this registry in memory (stateless by
design); the Deploy Console also saves your bots in the browser, and the real
source of truth is Telegram itself - once the webhook is set, the bot works
whether or not this registry remembers it.
"""
import sys, os, hashlib, time
sys.path.insert(0, os.path.dirname(__file__))
from _common import send, read_json, query_of, valid_token, telegram, host_of, verify_session
from http.server import BaseHTTPRequestHandler
from urllib.parse import quote

REGISTRY = {}  # id -> bot dict (per warm instance)


def public(bot):
    b = dict(bot)
    b.pop("token", None)
    return b


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send(self, {"ok": True, "count": len(REGISTRY),
                    "bots": [public(b) for b in REGISTRY.values()],
                    "note": "Stateless serverless registry - bots stay live via their Telegram webhook."})

    def do_POST(self):
        data = read_json(self)
        name = str(data.get("name") or "My Python Bot").strip()[:60] or "My Python Bot"
        token = str(data.get("token") or "").strip()
        framework = str(data.get("framework") or "python-telegram-bot")
        mode = str(data.get("mode") or "webhook")
        bot_id = hashlib.sha256((token or name + str(time.time())).encode()).hexdigest()[:10]

        bot_info = None
        if token:
            if not valid_token(token):
                return send(self, {"ok": False, "error": "Bot token format is invalid"}, 400)
            ok, res = telegram(token, "getMe")
            if ok and res.get("ok"):
                bot_info = res["result"]

        host, proto = host_of(self)
        webhook_url = None
        if token and mode == "webhook":
            webhook_url = f"{proto}://{host}/api/webhook?token={quote(token, safe='')}"
            preset = str(data.get("preset") or "").lower()
            if preset in ("standard", "echo", "menu", "assistant"):
                webhook_url += f"&preset={preset}"
            behavior = str(data.get("behavior") or "")[:4200]
            if behavior:  # commands extracted from the user's bot.py (Full Webhook)
                webhook_url += f"&r={quote(behavior, safe='')}"
        bot = {
            "id": bot_id, "name": name, "framework": framework, "mode": mode,
            "status": "live" if mode == "webhook" else "ready-for-vps",
            "username": (bot_info or {}).get("username"),
            "telegram_url": f"https://t.me/{bot_info['username']}" if bot_info and bot_info.get("username") else None,
            "webhook_url": webhook_url,
            "python": "3.12", "created_at": int(time.time()),
            "runtime": "Vercel Python Serverless" if mode == "webhook" else "Node supervisor (server.js / Docker)",
        }
        if token:
            bot["token"] = token  # never returned (stripped in public())
        REGISTRY[bot_id] = bot
        send(self, {"ok": True, "bot": public(bot),
                    "next": "Call POST /api/set_webhook {token} or tick 'Set webhook now' in the console."})

    def do_DELETE(self):
        # Registry removal is a console-only operation (Bearer session).
        if not verify_session(self):
            return send(self, {"ok": False, "error": "Unauthorized"}, 401)
        q = query_of(self)
        REGISTRY.pop(q.get("id", ""), None)
        send(self, {"ok": True})

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
