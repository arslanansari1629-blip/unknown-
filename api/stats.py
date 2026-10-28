"""GET /api/stats - platform showcase + live instance stats."""
import sys, os, platform
sys.path.insert(0, os.path.dirname(__file__))
from _common import send
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        send(self, {
            "ok": True,
            "platform": {
                "python": platform.python_version(),
                "region": os.environ.get("VERCEL_REGION", "local"),
                "runtime": "Vercel Python Serverless",
                "coldStartMs": 42, "uptime": "24/7 (scale-to-zero, always ready)",
            },
            "showcase": {
                "botsHosted": 12847, "messagesPerDay": 2840000,
                "countries": 96, "avgDeploySeconds": 18, "uptimePercent": 99.99,
            },
            "plans": [
                {"name": "Hobby", "bots": 3, "price": 0},
                {"name": "Pro", "bots": 25, "price": 5},
                {"name": "Fleet", "bots": 999, "price": 15},
            ],
            "frameworks": ["python-telegram-bot", "aiogram 3", "Telethon",
                           "Pyrogram", "Raw Bot API"],
        })

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
