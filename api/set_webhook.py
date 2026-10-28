"""POST /api/set_webhook - set / delete / inspect a bot webhook on Telegram.
Body: {token, action: set|delete|info, webhook_url?, drop_pending_updates?}
Default webhook_url = https://<this-host>/api/webhook?token=<token>
"""
import sys, os
from urllib.parse import quote
sys.path.insert(0, os.path.dirname(__file__))
from _common import send, read_json, valid_token, telegram, host_of
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        data = read_json(self)
        token = str(data.get("token") or "").strip()
        action = str(data.get("action") or "set").lower()
        if not valid_token(token):
            return send(self, {"ok": False, "error": "Valid bot token required"}, 400)

        if action == "info":
            ok, res = telegram(token, "getWebhookInfo")
            return send(self, {"ok": ok, "telegram": res}, 200 if ok else 502)
        if action == "delete":
            ok, res = telegram(token, "deleteWebhook",
                               {"drop_pending_updates": bool(data.get("drop_pending_updates"))})
            return send(self, {"ok": ok and res.get("ok", False), "telegram": res},
                        200 if ok else 502)

        host, proto = host_of(self)
        webhook_url = str(data.get("webhook_url") or "").strip()
        if not webhook_url:
            webhook_url = f"{proto}://{host}/api/webhook?token={quote(token, safe='')}"
            preset = str(data.get("preset") or "").lower()
            if preset in ("standard", "echo", "menu", "assistant"):
                webhook_url += f"&preset={preset}"
            behavior = str(data.get("behavior") or "")[:4200]
            if behavior:  # commands extracted from the user's bot.py (Full Webhook)
                webhook_url += f"&r={quote(behavior, safe='')}"
            welcome = str(data.get("welcome") or "")[:300]
            if welcome:
                webhook_url += f"&welcome={quote(welcome, safe='')}"
        ok, res = telegram(token, "setWebhook", {
            "url": webhook_url,
            "drop_pending_updates": bool(data.get("drop_pending_updates", True)),
            "allowed_updates": ["message", "edited_message", "callback_query", "inline_query"],
            "max_connections": 40,
        })
        if not ok or not res.get("ok"):
            return send(self, {"ok": False, "error": (res or {}).get("description", "setWebhook failed"),
                               "telegram": res}, 502)
        send(self, {"ok": True, "webhook_url": webhook_url, "telegram": res,
                    "note": "Your Python bot is now live 24/7 on Vercel serverless."})

    def do_GET(self):
        send(self, {"ok": True, "usage": "POST {token, action: set|delete|info, webhook_url?}"})

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
