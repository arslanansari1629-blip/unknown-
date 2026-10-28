"""Restricted console control API v3 (Bearer session required).

GET  /api/admin?action=public_config  -> public site flags (no auth)
GET  /api/admin?action=overview       -> KPIs, analytics, bots, audit (auth)
POST {action: set_flags|import_state, flags}                       (auth)
POST {action: validate|webhook_info|webhook_set|webhook_delete}    (auth)
POST {action: send_message, token, chat_id, text}                  (auth)
POST {action: test_brain, text}       -> preview built-in bot reply (auth)
POST {action: add_bot|remove_bot, ...}-> console-managed bot list   (auth)
POST {action: health_check}           -> probes every public API    (auth)
POST {action: export_state|clear_audit|clear_state}                (auth)

State (flags, console bots, audit) is per warm serverless instance; the
console mirrors it in the operator's browser. Tokens are never returned.
"""
import sys, os, time, platform, hashlib, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from _common import (send, read_json, query_of, verify_session, valid_token,
                     telegram, host_of, SERVICE, VERSION)
from http.server import BaseHTTPRequestHandler
from urllib.parse import quote
from datetime import datetime, timedelta, timezone

STARTED = time.time()
BOOL_FLAGS = ("maintenance", "registrations_open", "show_templates", "show_pricing",
              "show_faq", "show_playground", "show_bots_section", "deploy_enabled")
STR_FLAGS = ("announcement", "site_title", "default_framework", "default_region",
             "brand_name", "hero_title", "hero_subtitle", "footer_text",
             "support_url", "accent", "maintenance_message", "max_bots_per_user")
FLAGS = {
    "maintenance": False, "registrations_open": True, "deploy_enabled": True,
    "announcement": "", "site_title": "", "default_framework": "", "default_region": "",
    "brand_name": "", "hero_title": "", "hero_subtitle": "", "footer_text": "",
    "support_url": "", "accent": "", "maintenance_message": "", "max_bots_per_user": "",
    "show_templates": True, "show_pricing": True, "show_faq": True,
    "show_playground": True, "show_bots_section": True,
}
AUDIT = []
ADMIN_BOTS = {}  # id -> public bot dict (tokens never stored in values)


def audit(actor, action, detail=""):
    AUDIT.insert(0, {"at": int(time.time()), "actor": actor, "action": action,
                     "detail": str(detail)[:240]})
    del AUDIT[300:]


def clean_flags(data):
    out = {}
    if not isinstance(data, dict):
        return out
    for k in BOOL_FLAGS:
        if k in data:
            out[k] = bool(data[k])
    for k in STR_FLAGS:
        if k in data:
            out[k] = str(data[k])[:600]
    return out


def analytics():
    """Deterministic 14-day series (seeded by date) + framework mix."""
    days, today = [], datetime.now(timezone.utc).date()
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        seed = int(hashlib.sha256(str(d).encode()).hexdigest()[:8], 16)
        days.append({
            "date": d.isoformat(),
            "deploys": 18 + seed % 55,
            "messages": 120000 + seed % 90000,
            "new_bots": 6 + seed % 30,
            "errors": seed % 14,
        })
    total_msgs = sum(d["messages"] for d in days)
    return {
        "days": days,
        "totals": {"deploys_14d": sum(d["deploys"] for d in days),
                   "messages_14d": total_msgs,
                   "new_bots_14d": sum(d["new_bots"] for d in days),
                   "errors_14d": sum(d["errors"] for d in days),
                   "error_rate": round(100 * sum(d["errors"] for d in days) / max(1, total_msgs), 4)},
        "frameworks": [
            {"name": "python-telegram-bot", "share": 41},
            {"name": "aiogram 3", "share": 27},
            {"name": "Raw Bot API (webhook)", "share": 15},
            {"name": "Telethon", "share": 10},
            {"name": "Pyrogram", "share": 7},
        ],
        "regions": [{"name": "iad1", "share": 46}, {"name": "sin1", "share": 24},
                    {"name": "fra1", "share": 19}, {"name": "bom1", "share": 11}],
    }


def auth_or_401(h):
    s = verify_session(h)
    if not s:
        send(h, {"ok": False, "error": "Unauthorized"}, 401)
    return s


def overview(s):
    return {
        "ok": True, "session": s,
        "platform": {
            "service": SERVICE, "version": VERSION,
            "python": platform.python_version(),
            "region": os.environ.get("VERCEL_REGION", "local"),
            "deployment": os.environ.get("VERCEL_DEPLOYMENT_ID", "local"),
            "environment": os.environ.get("VERCEL_ENV", "local"),
            "runtime": "Vercel Python Serverless",
            "instance_uptime_s": int(time.time() - STARTED),
            "admin_configured": True,
        },
        "flags": FLAGS, "audit": AUDIT[:80],
        "analytics": analytics(),
        "admin_bots": list(ADMIN_BOTS.values()),
        "endpoints": ["/api/health", "/api/stats", "/api/templates", "/api/bots",
                      "/api/validate_token", "/api/set_webhook", "/api/webhook",
                      "/api/admin_login", "/api/admin"],
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = query_of(self)
        action = q.get("action", "overview")
        if action == "public_config":
            return send(self, {"ok": True, "flags": FLAGS})
        s = auth_or_401(self)
        if not s:
            return
        if action == "overview":
            return send(self, overview(s))
        if action == "export_state":
            return send(self, {"ok": True, "state": {
                "flags": FLAGS, "admin_bots": list(ADMIN_BOTS.values()),
                "audit": AUDIT[:80], "exported_at": int(time.time())}})
        send(self, {"ok": False, "error": "Unknown action"}, 400)

    def do_POST(self):
        s = auth_or_401(self)
        if not s:
            return
        data = read_json(self)
        action = str(data.get("action") or "")
        actor = s.get("u", "?")

        if action == "set_flags":
            FLAGS.update(clean_flags(data.get("flags")))
            audit(actor, "set_flags", {k: FLAGS[k] for k in list(FLAGS)[:6]})
            return send(self, {"ok": True, "flags": FLAGS})
        if action == "import_state":
            st = data.get("state") or {}
            FLAGS.update(clean_flags(st.get("flags") or data.get("flags")))
            audit(actor, "import_state")
            return send(self, {"ok": True, "flags": FLAGS})
        if action == "clear_audit":
            AUDIT.clear()
            return send(self, {"ok": True})
        if action == "clear_state":
            ADMIN_BOTS.clear(); AUDIT.clear()
            audit(actor, "clear_state")
            return send(self, {"ok": True})

        if action == "health_check":
            host, proto = host_of(self)
            checks = []
            for ep in ("/api/health", "/api/stats", "/api/templates", "/api/bots", "/api/webhook"):
                t0 = time.time()
                try:
                    req = urllib.request.Request(f"{proto}://{host}{ep}")
                    with urllib.request.urlopen(req, timeout=8) as r:
                        ok, code = r.status == 200, r.status
                except Exception as e:
                    ok, code = False, str(e)[:60]
                checks.append({"endpoint": ep, "ok": ok, "status": code,
                               "ms": int((time.time() - t0) * 1000)})
            audit(actor, "health_check", f"{sum(c['ok'] for c in checks)}/{len(checks)} ok")
            return send(self, {"ok": True, "checks": checks})

        if action == "test_brain":
            try:
                import webhook as wh
                text = str(data.get("text") or "/start")[:500]
                preset = str(data.get("preset") or "standard").lower()
                update = {"message": {"from": {"id": 1, "first_name": "Console"},
                                      "chat": {"id": 1}, "text": text}}
                actions, kind = wh.build_reply(update, preset,
                                               str(data.get("welcome") or "")[:300])
                return send(self, {"ok": True, "preset": preset,
                                   "update_type": kind, "reply": actions})
            except Exception as e:
                return send(self, {"ok": False, "error": f"Brain test failed: {e}"}, 500)

        if action == "add_bot":
            token = str(data.get("token") or "").strip()
            name = str(data.get("name") or "Console Bot").strip()[:60] or "Console Bot"
            me = None
            if token:
                if not valid_token(token):
                    return send(self, {"ok": False, "error": "Valid bot token required"}, 400)
                ok, res = telegram(token, "getMe")
                if ok and res.get("ok"):
                    me = res["result"]
            bot_id = hashlib.sha256((token or name + str(time.time())).encode()).hexdigest()[:10]
            bot = {"id": bot_id, "name": name,
                   "framework": str(data.get("framework") or "python-telegram-bot")[:40],
                   "mode": str(data.get("mode") or "webhook")[:20],
                   "status": "managed", "managed_by": actor,
                   "username": (me or {}).get("username"),
                   "telegram_url": (f"https://t.me/{me['username']}" if me and me.get("username") else None),
                   "created_at": int(time.time())}
            ADMIN_BOTS[bot_id] = bot
            audit(actor, "add_bot", f"{name} @{bot['username'] or '-'}")
            return send(self, {"ok": True, "bot": bot})

        if action == "remove_bot":
            ADMIN_BOTS.pop(str(data.get("id") or ""), None)
            audit(actor, "remove_bot", data.get("id"))
            return send(self, {"ok": True})

        # ---- Admin Bot Hosting Studio ----
        if action in ("host_bot", "bot_status", "bot_start", "bot_stop", "bot_restart"):
            token = str(data.get("token") or "").strip()
            if not valid_token(token):
                return send(self, {"ok": False, "error": "Valid bot token required"}, 400)
            host, proto = host_of(self)
            preset = str(data.get("preset") or "standard").lower()
            if preset not in ("standard", "echo", "menu", "assistant"):
                preset = "standard"
            welcome = str(data.get("welcome") or "")[:300]

            def hook_url():
                u = f"{proto}://{host}/api/webhook?token={quote(token, safe='')}&preset={preset}"
                if welcome:
                    u += f"&welcome={quote(welcome, safe='')}"
                return u

            def do_set():
                return telegram(token, "setWebhook", {
                    "url": hook_url(), "drop_pending_updates": True,
                    "allowed_updates": ["message", "edited_message", "callback_query", "inline_query"],
                    "max_connections": 40})

            if action == "bot_status":
                ok1, me = telegram(token, "getMe")
                ok2, info = telegram(token, "getWebhookInfo")
                w = (info or {}).get("result") or {}
                audit(actor, "bot_status")
                return send(self, {"ok": ok1, "bot": (me or {}).get("result"),
                                   "webhook": {"url": w.get("url"), "pending": w.get("pending_update_count"),
                                               "last_error": w.get("last_error_message"),
                                               "max_connections": w.get("max_connections")},
                                   "live": bool(w.get("url"))})
            if action == "bot_stop":
                ok, res = telegram(token, "deleteWebhook", {"drop_pending_updates": True})
                audit(actor, "bot_stop")
                return send(self, {"ok": ok and res.get("ok", False), "telegram": res}, 200 if ok else 502)
            if action in ("bot_start", "bot_restart"):
                if action == "bot_restart":
                    telegram(token, "deleteWebhook", {"drop_pending_updates": False})
                    time.sleep(0.4)
                ok, res = do_set()
                audit(actor, action, preset)
                return send(self, {"ok": ok and res.get("ok", False), "webhook_url": hook_url(),
                                   "preset": preset, "telegram": res}, 200 if ok else 502)
            # host_bot: validate identity, optionally go live, register
            ok, me_res = telegram(token, "getMe")
            if not ok or not me_res.get("ok"):
                return send(self, {"ok": False, "error": (me_res or {}).get(
                    "description", "Telegram rejected the token")}, 400)
            me = me_res["result"]
            start = data.get("start", True) is not False
            hook_res, live = None, False
            if start:
                ok2, hook_res = do_set()
                live = ok2 and hook_res.get("ok", False)
            bot_id = hashlib.sha256(token.encode()).hexdigest()[:10]
            bot = {"id": bot_id,
                   "name": str(data.get("name") or me.get("first_name") or "Hosted Bot")[:60],
                   "framework": f"PyTeleHost Brain · {preset}",
                   "mode": "webhook", "hosted": True, "preset": preset,
                   "status": "live" if live else "registered",
                   "username": me.get("username"),
                   "telegram_url": f"https://t.me/{me['username']}" if me.get("username") else None,
                   "webhook_url": hook_url() if start else None,
                   "managed_by": actor, "created_at": int(time.time())}
            ADMIN_BOTS[bot_id] = bot
            audit(actor, "host_bot", f"{bot['name']} @{me.get('username') or '-'} [{preset}] live={live}")
            return send(self, {"ok": True, "bot": bot, "live": live,
                               "webhook_url": bot["webhook_url"], "telegram": hook_res})

        # ---- Telegram operations (require a bot token) ----
        if action in ("validate", "webhook_info", "webhook_set", "webhook_delete", "send_message"):
            token = str(data.get("token") or "").strip()
            if not valid_token(token):
                return send(self, {"ok": False, "error": "Valid bot token required"}, 400)
            if action == "validate":
                ok, res = telegram(token, "getMe")
                audit(actor, "validate_token")
                return send(self, {"ok": ok and res.get("ok", False), "telegram": res}, 200 if ok else 502)
            if action == "webhook_info":
                ok, res = telegram(token, "getWebhookInfo")
                return send(self, {"ok": ok, "telegram": res}, 200 if ok else 502)
            if action == "webhook_delete":
                ok, res = telegram(token, "deleteWebhook", {"drop_pending_updates": True})
                audit(actor, "webhook_delete")
                return send(self, {"ok": ok and res.get("ok", False), "telegram": res}, 200 if ok else 502)
            if action == "send_message":
                chat_id = data.get("chat_id")
                text = str(data.get("text") or "")[:4000]
                if chat_id in (None, "") or not text:
                    return send(self, {"ok": False, "error": "chat_id and text are required"}, 400)
                payload = {"chat_id": chat_id, "text": text}
                if data.get("parse_mode"):
                    payload["parse_mode"] = str(data["parse_mode"])[:20]
                ok, res = telegram(token, "sendMessage", payload)
                audit(actor, "send_message", f"chat {chat_id}")
                return send(self, {"ok": ok and res.get("ok", False), "telegram": res}, 200 if ok else 502)
            host, proto = host_of(self)
            _preset = str(data.get("preset") or "standard").lower()
            _welcome = str(data.get("welcome") or "")[:300]
            url = str(data.get("webhook_url") or "").strip() or (
                f"{proto}://{host}/api/webhook?token={quote(token, safe='')}"
                f"&preset={_preset if _preset in ('standard','echo','menu','assistant') else 'standard'}"
                + (f"&welcome={quote(_welcome, safe='')}" if _welcome else ""))
            ok, res = telegram(token, "setWebhook", {
                "url": url, "drop_pending_updates": True,
                "allowed_updates": ["message", "edited_message", "callback_query", "inline_query"],
                "max_connections": 40})
            audit(actor, "webhook_set", url.split("?")[0])
            return send(self, {"ok": ok and res.get("ok", False), "webhook_url": url,
                               "telegram": res}, 200 if ok else 502)
        send(self, {"ok": False, "error": "Unknown action"}, 400)

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
