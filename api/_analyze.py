"""Multi-language Telegram bot project analyzer (not a route: _ prefix).

Detects language/runtime, entry file, framework, dependencies, execution
mode (polling / webhook / server) and generates production deploy assets
(Dockerfile, Procfile, start/install commands, hosting compatibility).
Mirrors the runtime table of server.js so the Vercel console and the full
process panel always agree.
"""
import json
import re

RUNTIMES = {
    "python": {"label": "Python", "ext": [".py"], "entry": ["bot.py", "main.py", "app.py", "index.py", "__main__.py"], "manifests": ["requirements.txt", "pyproject.toml", "Pipfile"]},
    "node": {"label": "Node.js", "ext": [".js", ".mjs", ".cjs"], "entry": ["index.js", "bot.js", "main.js", "app.js", "server.js"], "manifests": ["package.json"]},
    "bun": {"label": "Bun", "ext": [".ts", ".js"], "entry": ["index.ts", "index.js", "bot.ts"], "manifests": ["package.json", "bun.lockb", "bunfig.toml"]},
    "deno": {"label": "Deno", "ext": [".ts"], "entry": ["index.ts", "main.ts", "bot.ts"], "manifests": ["deno.json", "deno.jsonc"]},
    "ruby": {"label": "Ruby", "ext": [".rb"], "entry": ["bot.rb", "main.rb", "app.rb"], "manifests": ["Gemfile"]},
    "php": {"label": "PHP", "ext": [".php"], "entry": ["index.php", "bot.php", "main.php"], "manifests": ["composer.json"]},
    "go": {"label": "Go", "ext": [".go"], "entry": ["main.go"], "manifests": ["go.mod"]},
    "rust": {"label": "Rust", "ext": [".rs"], "entry": ["src/main.rs", "main.rs"], "manifests": ["Cargo.toml"]},
    "java": {"label": "Java", "ext": [".java", ".jar"], "entry": [], "manifests": ["pom.xml", "build.gradle"]},
    "dotnet": {"label": ".NET / C#", "ext": [".cs"], "entry": [], "manifests": [".csproj", ".sln"]},
    "bash": {"label": "Bash", "ext": [".sh"], "entry": ["start.sh", "run.sh", "bot.sh", "main.sh"], "manifests": []},
    "perl": {"label": "Perl", "ext": [".pl"], "entry": ["bot.pl", "main.pl"], "manifests": ["cpanfile"]},
    "lua": {"label": "Lua", "ext": [".lua"], "entry": ["bot.lua", "main.lua"], "manifests": []},
    "dart": {"label": "Dart", "ext": [".dart"], "entry": ["main.dart", "bot.dart"], "manifests": ["pubspec.yaml"]},
    "elixir": {"label": "Elixir", "ext": [".exs", ".ex"], "entry": ["main.exs", "bot.exs"], "manifests": ["mix.exs"]},
}
FRAMEWORK_PATTERNS = [
    ("python-telegram-bot", [r"from telegram", r"import telegram", r"Application\.builder"]),
    ("aiogram", [r"aiogram"]),
    ("Telethon", [r"telethon"]),
    ("Pyrogram", [r"pyrogram"]),
    ("Telegraf (Node)", [r"telegraf"]),
    ("grammY (Node)", [r"grammy", r"grammY"]),
    ("node-telegram-bot-api", [r"node-telegram-bot-api"]),
    ("Telegram Bot PHP SDK", [r"Telegram\\\\Bot", r"telegram-bot-sdk"]),
    ("telegram-bot-ruby", [r"telegram/bot"]),
    ("Go Telegram Bot API", [r"telegram-bot-api", r"go-telegram-bot-api"]),
    ("Teloxide (Rust)", [r"teloxide"]),
    ("Java TelegramBots", [r"org\.telegram\.telegrambots"]),
]
PY_IMPORT_MAP = {"telegram": "python-telegram-bot", "aiogram": "aiogram", "telethon": "Telethon",
                 "pyrogram": "pyrogram", "PIL": "Pillow", "cv2": "opencv-python", "bs4": "beautifulsoup4",
                 "dotenv": "python-dotenv", "requests": "requests", "aiohttp": "aiohttp", "flask": "Flask",
                 "fastapi": "fastapi", "uvicorn": "uvicorn", "sqlalchemy": "SQLAlchemy", "redis": "redis",
                 "openai": "openai", "httpx": "httpx", "numpy": "numpy", "pandas": "pandas"}
POLLING_PATTERNS = [r"run_polling", r"start_polling", r"bot\.launch\s*\(", r"launch\s*\(\s*\)",
                    r"run_until_disconnected", r"executor\.start_polling", r"polling\s*\(", r"getUpdates",
                    r"start_polling", r"infinity_polling", r"bot\.polling"]
WEBHOOK_PATTERNS = [r"setWebhook", r"set_webhook", r"run_webhook", r"webhook", r"@app\.(post|route|get)",
                    r"FastAPI", r"Flask", r"express\s*\(", r"createServer", r"\.listen\s*\("]
BASE_IMAGES = {"python": "python:3.12-slim", "node": "node:20-slim", "bun": "oven/bun:1",
               "deno": "denoland/deno:1.46", "ruby": "ruby:3.3-slim", "php": "php:8.3-cli",
               "go": "golang:1.22-alpine", "rust": "rust:1.80-slim", "java": "eclipse-temurin:21-jre",
               "dotnet": "mcr.microsoft.com/dotnet/runtime:8.0", "bash": "ubuntu:24.04",
               "perl": "perl:5.40-slim", "lua": "alpine:3.20", "dart": "dart:stable", "elixir": "elixir:1.17-slim"}


def _detect(files):
    names = [f["path"].replace("\\", "/") for f in files]
    lower = [n.lower() for n in names]
    top = [n for n in lower if "/" not in n]
    blob = "\n".join((f.get("content") or "")[:80000] for f in files)
    def has(name):
        return name.lower() in top
    def endswith(sfx):
        return any(n.endswith(sfx) for n in lower)
    runtime = "custom"
    if has("requirements.txt") or has("pyproject.toml") or has("pipfile") or endswith(".py"):
        runtime = "python"
    elif has("bun.lockb") or has("bunfig.toml"):
        runtime = "bun"
    elif has("package.json") or endswith((".js", ".mjs", ".cjs")):
        runtime = "node"
    elif has("deno.json") or has("deno.jsonc") or endswith(".ts"):
        runtime = "deno"
    elif has("gemfile") or endswith(".rb"):
        runtime = "ruby"
    elif has("composer.json") or endswith(".php"):
        runtime = "php"
    elif has("go.mod") or endswith(".go"):
        runtime = "go"
    elif has("cargo.toml") or endswith(".rs"):
        runtime = "rust"
    elif endswith(".jar") or has("pom.xml") or has("build.gradle") or endswith(".java"):
        runtime = "java"
    elif any(n.endswith((".csproj", ".sln")) for n in lower) or endswith(".cs"):
        runtime = "dotnet"
    elif endswith(".sh"):
        runtime = "bash"
    elif endswith(".pl"):
        runtime = "perl"
    elif endswith(".lua"):
        runtime = "lua"
    elif endswith(".dart"):
        runtime = "dart"
    elif endswith((".exs", ".ex")):
        runtime = "elixir"

    entry = None
    for cand in RUNTIMES.get(runtime, {}).get("entry", []):
        for n in names:
            if n.lower() == cand or n.lower().endswith("/" + cand):
                entry = n; break
        if entry:
            break
    if not entry and runtime != "custom":
        exts = RUNTIMES[runtime]["ext"]
        code = [n for n in names if any(n.lower().endswith(e) for e in exts)]
        entry = code[0] if len(code) == 1 else entry

    framework = None
    for name, pats in FRAMEWORK_PATTERNS:
        if any(re.search(p, blob) for p in pats):
            framework = name; break

    deps, manifests = [], [n for n in names if any(m in n for m in
                            RUNTIMES.get(runtime, {}).get("manifests", []))]
    if runtime == "python":
        req = next((f for f in files if f["path"].lower().endswith("requirements.txt")), None)
        if req:
            deps += [l.strip().split("#")[0].strip() for l in (req.get("content") or "").splitlines()
                     if l.strip() and not l.startswith("#")]
        found = set(re.findall(r"^(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)", blob, re.M))
        deps += [PY_IMPORT_MAP[m] for m in sorted(found) if m in PY_IMPORT_MAP]
    if runtime in ("node", "bun"):
        pkg = next((f for f in files if f["path"].lower().endswith("package.json")), None)
        if pkg:
            try:
                data = json.loads(pkg.get("content") or "{}")
                deps += list((data.get("dependencies") or {}).keys())
            except Exception:
                pass
    seen_deps = {}
    for d in deps:
        if d:
            seen_deps.setdefault(re.split(r"[<>=~\[]", d)[0].strip().lower(), d)
    deps = sorted(seen_deps.values())[:60]

    polling = any(re.search(p, blob) for p in POLLING_PATTERNS)
    webhook = any(re.search(p, blob) for p in WEBHOOK_PATTERNS)
    mode = "webhook" if (webhook and not polling) else "polling" if polling else "long-running"

    warnings = []
    if re.search(r"\b\d{6,12}:[A-Za-z0-9_-]{30,}\b", blob):
        warnings.append("A bot-token-looking string is hardcoded in code — move it to BOT_TOKEN env var.")
    if "while True" in blob or "while(true)" in blob:
        warnings.append("Busy loop detected (while True) — make sure it sleeps to avoid 100% CPU.")
    if not re.search(r"BOT_TOKEN|TELEGRAM_TOKEN|environ|getenv|process\.env|ENV\[|System\.getenv|os\.getenv", blob):
        warnings.append("No BOT_TOKEN env usage detected — the bot may expect the token elsewhere.")
    if not entry:
        warnings.append("No clear entry file found — set a custom start command.")
    if runtime == "custom":
        warnings.append("Language not auto-detected — a custom start command is required.")

    install_cmd, start_cmd = "", ""
    e = entry or "main"
    if runtime == "python":
        install_cmd = "pip install -r requirements.txt" if any(m.endswith("requirements.txt") for m in manifests) else ""
        start_cmd = f"python {e}"
    elif runtime in ("node", "bun"):
        install_cmd = "bun install" if runtime == "bun" else "npm install"
        start_cmd = f"{'bun run' if runtime == 'bun' else 'node'} {e}"
    elif runtime == "deno":
        start_cmd = f"deno run --allow-all {e}"
    elif runtime == "ruby":
        install_cmd = "bundle install" if manifests else ""
        start_cmd = f"ruby {e}"
    elif runtime == "php":
        install_cmd = "composer install" if manifests else ""
        start_cmd = f"php {e}"
    elif runtime == "go":
        install_cmd = "go mod download"
        start_cmd = "go run ."
    elif runtime == "rust":
        install_cmd = "cargo build --release"
        start_cmd = "cargo run --release"
    elif runtime == "java":
        start_cmd = "java -jar app.jar" if endswith(".jar") else "mvn -q exec:java"
    elif runtime == "dotnet":
        start_cmd = "dotnet run"
    elif runtime == "bash":
        start_cmd = f"bash {e}"
    elif runtime == "perl":
        start_cmd = f"perl {e}"
    elif runtime == "lua":
        start_cmd = f"lua {e}"
    elif runtime == "dart":
        start_cmd = f"dart run {e}"
    elif runtime == "elixir":
        start_cmd = f"elixir {e}"

    vercel_ok = runtime in ("python", "node") and mode == "webhook"
    score = 40 + (20 if entry else 0) + (15 if framework else 0) + (15 if manifests else 5) \
        + (10 if mode != "long-running" else 0) - (5 * len(warnings))
    dockerfile = "\n".join([
        f"FROM {BASE_IMAGES.get(runtime, 'ubuntu:24.04')}",
        "WORKDIR /app", "COPY . .",
        *( [f"RUN {install_cmd}"] if install_cmd else [] ),
        'ENV BOT_TOKEN=""',
        f'CMD ["sh","-c","{start_cmd}"]', ""])
    return {
        "runtime": runtime, "language": RUNTIMES.get(runtime, {}).get("label", "Custom"),
        "entry": entry, "framework": framework, "dependencies": deps,
        "manifests": manifests, "mode": mode,
        "file_count": len(files),
        "total_bytes": sum(len(f.get("content") or "") for f in files),
        "warnings": warnings,
        "readiness": max(5, min(100, score)),
        "compatibility": {
            "full_panel": True,
            "docker_vps": True,
            "vercel_webhook": vercel_ok,
            "vercel_reason": ("Webhook-ready Python/Node project" if vercel_ok else
                              "Vercel is serverless: polling/long-running code needs the Full Panel or Docker. "
                              "Convert to webhook (or use the built-in brain) for Vercel."),
        },
        "commands": {"install": install_cmd, "start": start_cmd},
        "generated": {
            "Dockerfile": dockerfile,
            "Procfile": f"worker: {start_cmd}\n",
            "manifest": {"runtime": runtime, "entry": entry, "framework": framework,
                         "start": start_cmd, "install": install_cmd, "mode": mode},
        },
    }
