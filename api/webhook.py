"""POST /api/webhook?token=<BOT_TOKEN> - the actual hosted Python bot brain.

This is real hosting, the Vercel way: Telegram pushes every update to this
Python serverless function, it replies in milliseconds, then sleeps for free.
Built-in commands: /start /help /ping /echo <text> /id /about - anything else
is echoed back. Demo mode: add ?demo=1 (or omit token) to see the JSON reply
without sending anything to Telegram.
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from _common import send, read_json, query_of, telegram
from http.server import BaseHTTPRequestHandler

STARTED = time.time()
HELP = (
    "⚡ *PyTeleHost Ultra Bot*\n\n"
    "/start - welcome\n/help - this help\n/ping - latency check\n"
    "/echo <text> - repeat text\n/id - your Telegram ID\n/about - hosting info\n\n"
    "Send anything else and I will echo it. Hosted 24/7 on Vercel Python serverless 🇮🇳"
)


def build_reply(update):
    """Return (method_payloads, summary) for a Telegram update."""
    msg = update.get("message") or update.get("edited_message") or {}
    cb = update.get("callback_query") or {}
    if cb:
        chat_id = ((cb.get("message") or {}).get("chat") or {}).get("id")
        return ([
            {"method": "answerCallbackQuery",
             "payload": {"callback_query_id": cb.get("id"), "text": "⚡ Button received!"}},
            {"method": "sendMessage",
             "payload": {"chat_id": chat_id, "text": f"🔘 You pressed: `{cb.get('data')}`",
                         "parse_mode": "Markdown"}},
        ], "callback_query")
    if not msg:
        return [], "ignored (not a message)"

    chat_id = (msg.get("chat") or {}).get("id")
    user = msg.get("from") or {}
    text = (msg.get("text") or "").strip()
    name = user.get("first_name", "friend")

    if text.startswith("/start"):
        reply = (f"👋 Hello {name}! I am alive on *PyTeleHost Ultra*.\n\n"
                 "Your Python bot is hosted 24/7 - no server, no polling, instant webhooks.\n"
                 "Try /help, /ping or just send a message.")
    elif text.startswith("/help"):
        reply = HELP
    elif text.startswith("/ping"):
        reply = f"🏓 Pong! Server time: `{int(time.time())}` · uptime `{int(time.time()-STARTED)}s`"
    elif text.startswith("/echo"):
        reply = text[5:].strip() or "Usage: /echo hello world"
    elif text.startswith("/id"):
        reply = (f"🪪 Your ID: `{user.get('id')}`\nChat ID: `{chat_id}`\n"
                 f"Username: @{user.get('username') or '-'}")
    elif text.startswith("/about"):
        reply = ("⚡ *PyTeleHost Ultra*\nRuntime: Python serverless (Vercel)\n"
                 "Mode: Webhook - zero idle cost, infinite scale\nDeveloper: editz900s")
    elif text:
        reply = f"🔁 {text}"
    else:
        reply = "📎 I received that! Send me text, or try /help."

    payload = {"chat_id": chat_id, "text": reply, "parse_mode": "Markdown",
               "reply_markup": {"inline_keyboard": [[
                   {"text": "🏓 Ping", "callback_data": "ping"},
                   {"text": "ℹ️ Help", "callback_data": "help"}]]}}
    return [{"method": "sendMessage", "payload": payload}], "message"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        q = query_of(self)
        update = read_json(self)
        token = q.get("token") or self.headers.get("X-Bot-Token") or ""
        demo = q.get("demo") in ("1", "true") or not token
        actions, kind = build_reply(update)
        if demo:
            return send(self, {"ok": True, "demo": True, "update_type": kind,
                               "would_send": actions,
                               "note": "Add ?token=<BOT_TOKEN> (via set_webhook) to send for real."})
        results = []
        for a in actions:
            payload = dict(a["payload"])
            if a["method"] == "answerCallbackQuery":
                pass
            ok, res = telegram(token, a["method"], payload)
            results.append({"method": a["method"], "ok": ok and res.get("ok", False)})
        send(self, {"ok": True, "update_type": kind, "sent": results})

    def do_GET(self):
        send(self, {
            "ok": True, "service": "PyTeleHost Ultra webhook brain (Python)",
            "usage": "Point Telegram at POST /api/webhook?token=<BOT_TOKEN> "
                     "(use /api/set_webhook or the Deploy Console).",
            "commands": ["/start", "/help", "/ping", "/echo", "/id", "/about"],
            "demo": "POST an update JSON with ?demo=1 to preview replies.",
        })

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
