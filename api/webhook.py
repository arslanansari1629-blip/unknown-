"""POST /api/webhook?token=<BOT_TOKEN>[&preset=...][&welcome=...]

The hosted Python bot brain. Telegram pushes every update to this serverless
function; it replies in milliseconds, then sleeps for free (true 24/7).

Presets (chosen at deploy time, encoded in the webhook URL - fully stateless):
  standard   /start /help /ping /echo /id /about + smart echo (default)
  echo       pure echo bot with welcome
  menu       business menu bot (About / Services / Contact inline buttons)
  assistant  keyword-smart assistant (pricing, support, hours, greetings…)

&welcome=<text> overrides the /start greeting (URL-encoded, max 300 chars).
Demo: ?demo=1 (or no token) returns the reply JSON without sending.
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
    "Hosted 24/7 on Vercel Python serverless 🇮🇳"
)
MENU_KB = {"inline_keyboard": [
    [{"text": "ℹ️ About Us", "callback_data": "menu_about"},
     {"text": "🛠 Services", "callback_data": "menu_services"}],
    [{"text": "📞 Contact", "callback_data": "menu_contact"},
     {"text": "🏓 Ping", "callback_data": "ping"}]]}
MENU_PAGES = {
    "menu_about": "ℹ️ *About Us*\nWe build fast, reliable Telegram bots hosted 24/7 on PyTeleHost Ultra.",
    "menu_services": "🛠 *Services*\n• 🤖 Bot development\n• ☁️ 24/7 hosting\n• 💬 Support bots\n• 🛒 Shop & payment bots",
    "menu_contact": "📞 *Contact*\nMessage us right here in this chat — we reply fast!",
    "help": HELP, "ping": None,
}
SMART = [
    (("price", "pricing", "cost", "plan", "charge"), "💎 *Pricing*\nHobby is free forever. Pro is $5/mo (25 bots), Fleet $15/mo (unlimited). Details on our site!"),
    (("support", "help me", "problem", "issue", "error", "bug"), "🛠 *Support*\nDescribe your issue here and our team will jump in. Meanwhile try /help for commands."),
    (("time", "timing", "hour", "open", "when"), "🕐 We are online *24/7* — this bot never sleeps (serverless webhooks)."),
    (("hi", "hello", "hey", "namaste", "hii"), None),  # greeting -> welcome
    (("bye", "goodbye", "thanks", "thank"), "👋 Anytime! Ping me whenever you need something. ⚡"),
    (("bot", "host", "deploy", "create"), "🚀 Want your own bot like me? Deploy free in ~18 seconds on *PyTeleHost Ultra* — paste a token, press deploy, done."),
]


def _send(chat_id, text, kb=None):
    p = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if kb:
        p["reply_markup"] = kb
    return {"method": "sendMessage", "payload": p}


def build_reply(update, preset="standard", welcome=""):
    """Return (method_payloads, summary) for a Telegram update."""
    msg = update.get("message") or update.get("edited_message") or {}
    cb = update.get("callback_query") or {}
    if cb:
        chat_id = ((cb.get("message") or {}).get("chat") or {}).get("id")
        data = cb.get("data") or ""
        if data == "ping":
            text = f"🏓 Pong! Server time: `{int(time.time())}`"
        else:
            text = MENU_PAGES.get(data, f"🔘 You pressed: `{data}`")
        return ([{"method": "answerCallbackQuery",
                  "payload": {"callback_query_id": cb.get("id"), "text": "⚡ Done"}},
                 _send(chat_id, text, MENU_KB if preset == "menu" else None)], "callback_query")
    if not msg:
        return [], "ignored (not a message)"

    chat_id = (msg.get("chat") or {}).get("id")
    user = msg.get("from") or {}
    text = (msg.get("text") or "").strip()
    low = text.lower()
    name = user.get("first_name", "friend")
    greeting = welcome or (f"👋 Hello {name}! I am alive on *PyTeleHost Ultra* — hosted 24/7, "
                           "no server, instant webhooks.\nTry /help, /ping or just send a message.")

    if preset == "echo":
        if text.startswith("/start"):
            return [_send(chat_id, welcome or f"🔁 Echo bot ready, {name}! Everything you send comes right back.")], "message"
        if text.startswith("/ping"):
            return [_send(chat_id, "🏓 Pong!")], "message"
        return [_send(chat_id, text or "📎 Send me text and I will echo it.")], "message"

    if preset == "menu":
        if text.startswith("/start") or not text.startswith("/"):
            return [_send(chat_id, welcome or f"👋 Welcome {name}! Choose an option below 👇", MENU_KB)], "message"
        if text.startswith("/ping"):
            return [_send(chat_id, f"🏓 Pong! `{int(time.time())}`")], "message"
        return [_send(chat_id, "Use the menu buttons below 👇", MENU_KB)], "message"

    # assistant + standard share commands
    if text.startswith("/start"):
        reply, kb = greeting, (MENU_KB if preset == "menu" else {"inline_keyboard": [[
            {"text": "🏓 Ping", "callback_data": "ping"}, {"text": "ℹ️ Help", "callback_data": "help"}]]})
        return [_send(chat_id, reply, kb)], "message"
    if text.startswith("/help"):
        return [_send(chat_id, HELP)], "message"
    if text.startswith("/ping"):
        return [_send(chat_id, f"🏓 Pong! Server time: `{int(time.time())}` · uptime `{int(time.time()-STARTED)}s`")], "message"
    if text.startswith("/echo"):
        return [_send(chat_id, text[5:].strip() or "Usage: /echo hello world")], "message"
    if text.startswith("/id"):
        return [_send(chat_id, f"🪪 Your ID: `{user.get('id')}`\nChat ID: `{chat_id}`\nUsername: @{user.get('username') or '-'}")], "message"
    if text.startswith("/about"):
        return [_send(chat_id, "⚡ *PyTeleHost Ultra*\nRuntime: Python serverless (Vercel)\nMode: Webhook - zero idle cost, infinite scale\nDeveloper: editz900s")], "message"
    if preset == "assistant" and text:
        for keys, resp in SMART:
            if any(k in low for k in keys):
                return [_send(chat_id, resp or greeting)], "message"
        return [_send(chat_id, f"🤖 Got it, {name}! I can help with *pricing*, *support*, *hosting* — or type /help. You said: “{text}”")], "message"
    return [_send(chat_id, f"🔁 {text}" if text else "📎 I received that! Send me text, or try /help.")], "message"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        q = query_of(self)
        update = read_json(self)
        token = q.get("token") or self.headers.get("X-Bot-Token") or ""
        demo = q.get("demo") in ("1", "true") or not token
        preset = (q.get("preset") or "standard").lower()
        if preset not in ("standard", "echo", "menu", "assistant"):
            preset = "standard"
        welcome = (q.get("welcome") or "")[:300]
        actions, kind = build_reply(update, preset, welcome)
        if demo:
            return send(self, {"ok": True, "demo": True, "preset": preset,
                               "update_type": kind, "would_send": actions,
                               "note": "Add ?token=<BOT_TOKEN> (via set_webhook) to send for real."})
        results = []
        for a in actions:
            ok, res = telegram(token, a["method"], dict(a["payload"]))
            results.append({"method": a["method"], "ok": ok and res.get("ok", False)})
        send(self, {"ok": True, "preset": preset, "update_type": kind, "sent": results})

    def do_GET(self):
        send(self, {
            "ok": True, "service": "PyTeleHost Ultra webhook brain (Python)",
            "usage": "POST /api/webhook?token=<BOT_TOKEN>[&preset=standard|echo|menu|assistant][&welcome=...]",
            "commands": ["/start", "/help", "/ping", "/echo", "/id", "/about"],
            "presets": ["standard", "echo", "menu", "assistant"],
            "demo": "POST an update JSON with ?demo=1 to preview replies.",
        })

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
