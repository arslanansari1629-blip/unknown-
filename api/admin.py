"""Restricted console control API (Bearer session required).

GET  /api/admin?action=public_config          -> public site flags (no auth)
GET  /api/admin?action=overview               -> platform overview (auth)
POST /api/admin {action: "set_flags", flags:{...}}         (auth)
POST /api/admin {action: "webhook_info|webhook_set|webhook_delete", token, webhook_url?} (auth)
POST /api/admin {action: "validate", token}   -> Telegram getMe    (auth)
POST /api/admin {action: "clear_audit"}                            (auth)

Site flags are kept per warm serverless instance (best-effort global);
the console also persists them in the operator's browser, and every page
load merges the server copy over the local one. Audit log is in-memory.
"""
import sys, os, time, platform
sys.path.insert(0, os.path.dirname(__file__))
from _common import (send, read_json, query_of, verify_session, valid_token, telegram, host_of)
from http.server import BaseHTTPRequestHandler
from urllib.parse import quote

STARTED = time.time()
FLAGS = {
    "maintenance": False,
    "registrations_open": True,
    "announcement": "",
    "site_title": "",
    "default_framework": "",
    "default_region": "",
    "show_templates": True,
    "show_pricing": True,
    "show_faq": True,
}
AUDIT = []


def audit(actor, action, detail=""):
    AUDIT.insert(0, {"at": int(time.time()), "actor": actor, "action": action,
                     "detail": str(detail)[:200]})
    del AUDIT[200:]


def clean_flags(data):
    out = {}
    if not isinstance(data, dict):
        return out
    for k in ("maintenance", "registrations_open", "show_templates", "show_pricing", "show_faq"):
        if k in data:
            out[k] = bool(data[k])
    for k in ("announcement", "site_title", "default_framework", "default_region"):
        if k in data:
            out[k] = str(data[k])[:300]
    return out


def auth_or_401(h):
    s = verify_session(h)
    if not s:
        send(h, {"ok": False, "error": "Unauthorized"}, 401)
    return s


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
            return send(self, {
                "ok": True, "session": s,
                "platform": {"python": platform.python_version(),
                             "region": os.environ.get("VERCEL_REGION", "local"),
                             "runtime": "Vercel Python Serverless",
                             "instance_uptime_s": int(time.time() - STARTED),
                             "admin_configured": True},
                "flags": FLAGS, "audit": AUDIT[:50],
            })
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
            audit(actor, "set_flags", FLAGS)
            return send(self, {"ok": True, "flags": FLAGS})
        if action == "clear_audit":
            AUDIT.clear()
            return send(self, {"ok": True})
        if action in ("webhook_info", "webhook_set", "webhook_delete", "validate"):
            token = str(data.get("token") or "").strip()
            if not valid_token(token):
                return send(self, {"ok": False, "error": "Valid bot token required"}, 400)
            if action == "validate":
                ok, res = telegram(token, "getMe")
                audit(actor, "validate_token")
                return send(self, {"ok": ok and res.get("ok", False), "telegram": res},
                            200 if ok else 502)
            if action == "webhook_info":
                ok, res = telegram(token, "getWebhookInfo")
                return send(self, {"ok": ok, "telegram": res}, 200 if ok else 502)
            if action == "webhook_delete":
                ok, res = telegram(token, "deleteWebhook", {"drop_pending_updates": True})
                audit(actor, "webhook_delete")
                return send(self, {"ok": ok and res.get("ok", False), "telegram": res},
                            200 if ok else 502)
            host, proto = host_of(self)
            url = str(data.get("webhook_url") or "").strip() or \
                f"{proto}://{host}/api/webhook?token={quote(token, safe='')}"
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
