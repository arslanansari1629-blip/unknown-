"""GET /api/health - liveness + platform info."""
import sys, os, platform
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(__file__))
from _common import send, SERVICE, VERSION, DEVELOPER
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send(self, {
            "ok": True, "status": "ok", "service": SERVICE, "version": VERSION,
            "developer": DEVELOPER, "mode": "vercel-serverless-webhook",
            "runtime": f"Python {platform.python_version()}",
            "region": os.environ.get("VERCEL_REGION", "local"),
            "time": datetime.now(timezone.utc).isoformat(),
            "endpoints": ["/api/health", "/api/stats", "/api/templates",
                          "/api/validate_token", "/api/bots", "/api/set_webhook",
                          "/api/webhook"],
        })

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
