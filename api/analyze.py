"""Public static code analysis (same engine as the restricted console).

POST {"files": [{"path": "bot.py", "content": "..."}], "start_command": ""}
-> {"ok": true, "report": {...}}
Pure static detection (language, framework, entry, dependencies, run mode,
readiness + security findings). Submitted code is NEVER executed.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _common import send, read_json
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        data = read_json(self)
        files = []
        for f in (data.get("files") or [])[:40]:
            if isinstance(f, dict) and f.get("path"):
                files.append({"path": str(f["path"])[:200],
                              "content": str(f.get("content") or "")[:120000]})
        if not files:
            return send(self, {"ok": False, "error": "Send at least one file to analyze"}, 400)
        try:
            from _analyze import _detect
            report = _detect(files)
            if data.get("start_command"):
                report["commands"]["start"] = str(data["start_command"])[:300]
                report["custom_start"] = True
            return send(self, {"ok": True, "report": report})
        except Exception as e:
            return send(self, {"ok": False, "error": f"Analyze failed: {e}"}, 500)

    def do_GET(self):
        send(self, {"ok": True, "service": "code-analyzer",
                    "method": "POST {files: [{path, content}]}"})

    def do_OPTIONS(self):
        send(self, {"ok": True})

    def log_message(self, *a):
        pass
