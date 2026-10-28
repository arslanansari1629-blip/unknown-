"""POST /api/webhook?token=<BOT_TOKEN>[&preset=...][&welcome=...][&r=<behavior>]

The hosted bot brain - FULL WEBHOOK edition. Telegram pushes every update to
this serverless function; it replies in milliseconds, then sleeps (true 24/7).

Built-in commands (all presets share these unless the preset says otherwise):
  /start /help /ping /echo /id /about /time /date /uptime /version
  /dice (alias /roll) /coin (alias /flip) /random /choose /reverse
  /upper /lower /count (alias /len) /calc /joke /quote /password /commands

Presets (encoded in the webhook URL - fully stateless):
  standard   full command set + smart echo (default)
  echo       pure echo bot with welcome
  menu       business menu bot (About / Services / Contact inline buttons)
  assistant  full commands + keyword-smart assistant replies

&r=<base64url JSON> embeds the behaviour extracted from the user's own bot.py
at deploy time: {"c": {"/cmd": "reply text"}, "e": 1, "t": "text reply"}.
Custom commands override built-ins, so the hosted bot answers according to
the code the user pasted. Everything is capped and sanitised server-side.

&welcome=<text> overrides the /start greeting (URL-encoded, max 300 chars).
Demo: ?demo=1 (or no token) returns the reply JSON without sending.
"""
import sys, os, time, json, base64, random, secrets, ast, operator as _op
sys.path.insert(0, os.path.dirname(__file__))
from _common import send, read_json, query_of, telegram
from http.server import BaseHTTPRequestHandler

STARTED = time.time()
HELP = (
    "⚡ *PyTeleHost Ultra Bot — Full Webhook*\n\n"
    "/start - welcome\n/help - this help\n/ping - latency check\n"
    "/echo <text> - repeat text\n/id - your Telegram ID\n/about - hosting info\n"
    "/time - current UTC time\n/date - today's date\n/uptime - brain uptime\n"
    "/dice - roll a dice 🎲\n/coin - flip a coin 🪙\n/random [min max] - random number\n"
    "/choose a, b, c - pick one for you\n/reverse <text> - txet esrever\n"
    "/upper <text> - SHOUT\n/lower <text> - whisper\n/count <text> - count chars & words\n"
    "/calc <expr> - safe calculator (e.g. /calc 2+3*4)\n/joke - random joke\n"
    "/quote - random quote\n/password [len] - generate a password\n/commands - list commands\n\n"
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
JOKES = [
    "😂 Why do Python programmers prefer dark mode? Because light attracts bugs!",
    "😂 I told my bot a UDP joke… it never replied, and I don't care.",
    "😂 There are only 10 kinds of people: those who understand binary and those who don't.",
    "😂 Why did the serverless function stay calm? It knows how to handle cold starts.",
    "😂 A SQL query walks into a bar, sees two tables and asks… 'Mind if I JOIN you?'",
]
QUOTES = [
    "💡 'Simplicity is the soul of efficiency.' — Austin Freeman",
    "💡 'First, solve the problem. Then, write the code.' — John Johnson",
    "💡 'Code is like humor. When you have to explain it, it's bad.' — Cory House",
    "💡 'The best error message is the one that never shows up.' — Thomas Fuchs",
    "💡 'Make it work, make it right, make it fast.' — Kent Beck",
]
BUILTIN_COMMANDS = ["start", "help", "ping", "echo", "id", "about", "time", "date",
                    "uptime", "version", "dice", "roll", "coin", "flip", "random",
                    "choose", "reverse", "upper", "lower", "count", "len", "calc",
                    "joke", "quote", "password", "commands"]


def parse_behavior(raw):
    """Decode & sanitise the &r= behaviour blob from a user's bot.py. Never raises."""
    if not raw or len(raw) > 4200:
        return {}
    try:
        padded = raw + "=" * (-len(raw) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()).decode("utf-8"))
        if not isinstance(data, dict):
            return {}
        out = {}
        cmds = data.get("c") or {}
        if isinstance(cmds, dict):
            clean = {}
            for k, v in list(cmds.items())[:16]:
                name = str(k).lower().lstrip("/")
                if name.replace("_", "").isalnum() and 1 <= len(name) <= 32 and isinstance(v, str) and v.strip():
                    clean[name] = v[:1000]
            if clean:
                out["c"] = clean
        if data.get("e"):
            out["e"] = 1
        if isinstance(data.get("t"), str) and data["t"].strip():
            out["t"] = data["t"][:1000]
        return out
    except Exception:
        return {}


_OPS = {ast.Add: _op.add, ast.Sub: _op.sub, ast.Mult: _op.mul, ast.Div: _op.truediv,
        ast.Mod: _op.mod, ast.Pow: _op.pow, ast.USub: _op.neg, ast.UAdd: _op.pos}


def _calc(expr):
    """Safe arithmetic via AST whitelist. Raises ValueError on anything else."""
    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            l, r = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Pow) and (abs(r) > 64 or abs(l) > 1000):
                raise ValueError("too big")
            return _OPS[type(n.op)](l, r)
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        raise ValueError("unsupported")
    v = ev(ast.parse(expr[:80], mode="eval"))
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return v


def _send(chat_id, text, kb=None):
    p = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if kb:
        p["reply_markup"] = kb
    return {"method": "sendMessage", "payload": p}


def _help_text(custom_cmds):
    if not custom_cmds:
        return HELP
    return HELP + "\n\n🧠 *Commands from your bot.py:*\n" + "\n".join("/" + c for c in sorted(custom_cmds))


def build_reply(update, preset="standard", welcome="", custom=None):
    """Return (method_payloads, summary) for a Telegram update."""
    custom = custom or {}
    cmds = custom.get("c") or {}
    msg = update.get("message") or update.get("edited_message") or {}
    cb = update.get("callback_query") or {}
    iq = update.get("inline_query") or {}
    if iq:
        return ([{"method": "answerInlineQuery", "payload": {
            "inline_query_id": iq.get("id"),
            "results": [{"type": "article", "id": "1", "title": "⚡ PyTeleHost Ultra Bot",
                         "input_message_content": {"message_text": "⚡ I am hosted 24/7 on *PyTeleHost Ultra* — try /help!", "parse_mode": "Markdown"}}],
            "cache_time": 60}}], "inline_query")
    if cb:
        chat_id = ((cb.get("message") or {}).get("chat") or {}).get("id")
        data = cb.get("data") or ""
        if data == "ping":
            text = f"🏓 Pong! Server time: `{int(time.time())}`"
        elif data == "help":
            text = _help_text(cmds)
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
    parts = text.split(None, 1)
    cmd = parts[0].lower().split("@")[0].lstrip("/") if parts else ""
    args = parts[1] if len(parts) > 1 else ""

    if preset == "echo":
        if cmd == "start":
            return [_send(chat_id, welcome or f"🔁 Echo bot ready, {name}! Everything you send comes right back.")], "message"
        if cmd == "ping":
            return [_send(chat_id, "🏓 Pong!")], "message"
        return [_send(chat_id, text or "📎 Send me text and I will echo it.")], "message"

    if preset == "menu":
        if cmd == "ping":
            return [_send(chat_id, f"🏓 Pong! `{int(time.time())}`")], "message"
        if cmd == "start" or not text.startswith("/"):
            return [_send(chat_id, welcome or f"👋 Welcome {name}! Choose an option below 👇", MENU_KB)], "message"
        return [_send(chat_id, "Use the menu buttons below 👇", MENU_KB)], "message"

    # --- commands from the user's own bot.py win first ---
    if cmd and cmd in cmds:
        return [_send(chat_id, cmds[cmd])], "message (custom /" + cmd + ")"

    # --- full built-in command set ---
    if cmd == "start":
        kb = {"inline_keyboard": [[{"text": "🏓 Ping", "callback_data": "ping"},
                                   {"text": "ℹ️ Help", "callback_data": "help"}]]}
        return [_send(chat_id, greeting, kb)], "message"
    if cmd == "help":
        return [_send(chat_id, _help_text(cmds))], "message"
    if cmd == "commands":
        extra = ("\n🧠 Yours: " + " ".join("/" + c for c in sorted(cmds))) if cmds else ""
        return [_send(chat_id, "🧭 *Commands*\n" + " ".join("/" + c for c in BUILTIN_COMMANDS) + extra)], "message"
    if cmd == "ping":
        return [_send(chat_id, f"🏓 Pong! Server time: `{int(time.time())}` · uptime `{int(time.time()-STARTED)}s`")], "message"
    if cmd == "echo":
        return [_send(chat_id, args or "Usage: /echo hello world")], "message"
    if cmd == "id":
        return [_send(chat_id, f"🪪 Your ID: `{user.get('id')}`\nChat ID: `{chat_id}`\nUsername: @{user.get('username') or '-'}")], "message"
    if cmd == "about":
        return [_send(chat_id, "⚡ *PyTeleHost Ultra — Full Webhook*\nRuntime: Python serverless (Vercel)\nMode: Webhook · zero idle cost\nCommands: " + str(len(BUILTIN_COMMANDS) + len(cmds)) + "\nDeveloper: editz900s")], "message"
    if cmd in ("time", "date"):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        return [_send(chat_id, f"🕐 UTC: `{now.strftime('%Y-%m-%d %H:%M:%S')}`" if cmd == "time" else f"📅 Today (UTC): `{now.strftime('%A, %d %B %Y')}`")], "message"
    if cmd == "uptime":
        return [_send(chat_id, f"⏱ Brain uptime: `{int(time.time()-STARTED)}s` (this warm instance)")], "message"
    if cmd == "version":
        return [_send(chat_id, "🧠 Webhook brain: *Full Webhook v2* · Python serverless · PyTeleHost Ultra")], "message"
    if cmd in ("dice", "roll"):
        return [_send(chat_id, f"🎲 You rolled: *{random.randint(1, 6)}*")], "message"
    if cmd in ("coin", "flip"):
        return [_send(chat_id, f"🪙 It landed on: *{random.choice(['Heads', 'Tails'])}*")], "message"
    if cmd == "random":
        lo, hi = 1, 100
        nums = args.replace(",", " ").split()
        try:
            if len(nums) >= 2:
                lo, hi = int(nums[0]), int(nums[1])
            elif len(nums) == 1:
                hi = int(nums[0])
        except Exception:
            pass
        if lo > hi:
            lo, hi = hi, lo
        return [_send(chat_id, f"🎰 Random number ({lo}–{hi}): *{random.randint(lo, hi)}*")], "message"
    if cmd == "choose":
        opts = [o.strip() for o in args.replace("|", ",").split(",") if o.strip()] or args.split()
        if len(opts) < 2:
            return [_send(chat_id, "Usage: /choose tea, coffee, juice")], "message"
        return [_send(chat_id, f"🤔 I choose: *{random.choice(opts)}*")], "message"
    if cmd == "reverse":
        return [_send(chat_id, args[::-1] if args else "Usage: /reverse hello")], "message"
    if cmd == "upper":
        return [_send(chat_id, args.upper() if args else "Usage: /upper hello")], "message"
    if cmd == "lower":
        return [_send(chat_id, args.lower() if args else "Usage: /lower HELLO")], "message"
    if cmd in ("count", "len"):
        if not args:
            return [_send(chat_id, "Usage: /count some text here")], "message"
        return [_send(chat_id, f"🔢 `{len(args)}` characters · `{len(args.split())}` words")], "message"
    if cmd == "calc":
        if not args:
            return [_send(chat_id, "Usage: /calc 2+3*4")], "message"
        try:
            return [_send(chat_id, f"🧮 `{args}` = *{_calc(args)}*")], "message"
        except Exception:
            return [_send(chat_id, "⚠ I can only calculate + − × ÷ % ** and brackets, e.g. /calc (2+3)*4")], "message"
    if cmd == "joke":
        return [_send(chat_id, random.choice(JOKES))], "message"
    if cmd == "quote":
        return [_send(chat_id, random.choice(QUOTES))], "message"
    if cmd == "password":
        try:
            n = min(64, max(8, int(args))) if args else 16
        except Exception:
            n = 16
        alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%*?"
        return [_send(chat_id, "🔐 `" + "".join(secrets.choice(alphabet) for _ in range(n)) + "`\n(tap to copy — never reuse bot passwords elsewhere!)")], "message"

    # --- plain text: user's code behaviour, then presets ---
    if custom.get("e") and text:
        return [_send(chat_id, text)], "message (custom echo)"
    if custom.get("t") and text and not text.startswith("/"):
        return [_send(chat_id, custom["t"])], "message (custom text-reply)"
    if preset == "assistant" and text:
        for keys, resp in SMART:
            if any(k in low for k in keys):
                return [_send(chat_id, resp or greeting)], "message"
        return [_send(chat_id, f"🤖 Got it, {name}! I can help with *pricing*, *support*, *hosting* — or type /help. You said: “{text}”")], "message"
    if text.startswith("/") and cmd:
        return [_send(chat_id, f"🤔 Unknown command `/{cmd}` — try /help for everything I can do.")], "message"
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
        custom = parse_behavior(q.get("r") or "")
        actions, kind = build_reply(update, preset, welcome, custom)
        if demo:
            return send(self, {"ok": True, "demo": True, "preset": preset,
                               "custom_commands": sorted((custom.get("c") or {}).keys()),
                               "update_type": kind, "would_send": actions,
                               "note": "Add ?token=<BOT_TOKEN> (via set_webhook) to send for real."})
        results = []
        for a in actions:
            ok, res = telegram(token, a["method"], dict(a["payload"]))
            results.append({"method": a["method"], "ok": ok and res.get("ok", False)})
        send(self, {"ok": True, "preset": preset, "update_type": kind, "sent": results})

    def do_GET(self):
        send(self, {
            "ok": True, "service": "PyTeleHost Ultra webhook brain — Full Webhook v2 (Python)",
            "usage": "POST /api/webhook?token=<BOT_TOKEN>[&preset=standard|echo|menu|assistant][&welcome=...][&r=<behavior>]",
            "commands": ["/" + c for c in BUILTIN_COMMANDS],
            "custom_behavior": "&r= base64url JSON {c:{cmd:reply}, e:1, t:text-reply} extracted from the user's bot.py at deploy time; custom commands override built-ins.",
            "presets": ["standard", "echo", "menu", "assistant"],
            "demo": "POST an update JSON with ?demo=1 to preview replies.",
        })

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
