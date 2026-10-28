# ⚡ editz900s Bot Cloud

**Advanced Telegram bot hosting panel — no login, no signup, no account.**
Upload a ZIP, a folder or paste code. Python, Node.js or **any** language runs on a supervised process that restarts itself forever.

Built and maintained by **editz900s**.

```
Frontend  : index.html   (one single file — HTML + CSS + JS, zero dependencies)
Backend   : server.js    (one single file — Express + WebSocket + supervisor)
```

---

## ✨ Features

| | |
|---|---|
| 🔓 **No login / no signup** | Open the panel and deploy. Optional `PANEL_TOKEN` if you want to lock it. |
| 🐍 **Python + Node.js first-class** | Auto-detects `requirements.txt`, `package.json`, `bot.py`, `index.js` and picks the right entry file. |
| 🌍 **Any language** | Bun, Deno, Ruby, PHP, Go, Rust, Java, .NET, Bash, Perl, Lua, Dart, Elixir — or a fully custom start command. |
| 📦 **Smart uploads** | ZIP archives (auto-strips the top folder), multi-file folders with paths preserved, or paste code straight into the panel. |
| 🧠 **Auto dependency install** | `pip` inside a virtualenv, `npm install`, `bundle install`, `composer install`, `go mod download`, `cargo build`, `dotnet restore`. |
| 🔁 **Never shuts down** | Crash → automatic restart with capped exponential backoff. Watchdog re-launches dead processes every 2.5 s. Bots marked running are resumed after a panel reboot. |
| 🪵 **Live logs** | Real WebSocket streaming of stdout/stderr + stdin input, download and clear. |
| 🗂 **File manager & editor** | Browse, create, edit, upload, download and delete project files in the browser. |
| 🔐 **Env / secrets manager** | `.env`-style variables injected into every process — never exposed to the browser bundle. |
| 📊 **Live metrics** | CPU, RSS memory, uptime, restart count, host load, per-bot process ID. |
| 🤖 **Telegram token check** | Verifies `BOT_TOKEN` with the official `getMe` API and shows the bot's @username. |
| 💾 **Persistence** | Metadata, logs and files survive restarts on disk (`data/bots/<id>`). |

---

## 🚀 Quick start

```bash
git clone <this-repo> bot-cloud
cd bot-cloud
npm install
npm start
```

Open **http://localhost:8080** — that's it. No account, no setup wizard.

Requirements: **Node.js 18+**. Python 3 is needed only for Python bots (`python3` + `python3-venv`).

### Run it 24/7

**Docker**

```bash
docker build -t editz900s-bot-cloud .
docker run -d --name bot-cloud -p 8080:8080 -v botcloud_data:/data --restart always editz900s-bot-cloud
```

**VPS (systemd)**

```ini
[Unit]
Description=editz900s Bot Cloud
After=network.target

[Service]
WorkingDirectory=/opt/bot-cloud
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Environment=DATA_DIR=/opt/bot-cloud/data
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

**Render / Railway / Koyeb / Fly.io** — deploy this repository as a Node web service with `npm install` as the build command and `node server.js` as the start command. Mount a persistent disk at `/data` and set `DATA_DIR=/data` so bots survive redeploys.

> ⚠️ Free tiers of some platforms sleep idle containers. Set `SELF_PING_URL` to your public panel URL and the server will ping itself every 4 minutes, and keep an external uptime monitor (e.g. UptimeRobot) pointed at `/api/health` as a second layer.

---

## 🖥️ Using the panel

1. **Deploy** → drop a ZIP / folder / source file.
2. Add `BOT_TOKEN` (and any other secrets) in the environment box.
3. Press **Deploy bot** — the runtime is detected, dependencies install, the process starts.
4. Watch **Logs**, edit **Files**, change **Settings**, verify the token in one click.

Your bot keeps running even when you close the tab. Nothing is tied to a browser session.

### Example `.env`

```env
BOT_TOKEN=1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OWNER_ID=123456789
DATABASE_URL=postgres://...
```

### Example start commands

| Project | Command |
|---|---|
| Python | `python3 -u bot.py` (auto: `./.venv/bin/python -u bot.py` after install) |
| Node.js | `npm start` or `node index.js` |
| Go | `go run .` |
| Rust | `cargo run --release` |
| Java | `java -jar app.jar` |
| Custom | `./my-binary --token $BOT_TOKEN` |

Every command runs inside `/bin/bash` with the project folder as the working directory.

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Where bots, logs and metadata live |
| `PANEL_TOKEN` | *(empty)* | Optional shared secret. Open the panel with `?token=...`; API accepts `x-panel-token` or `?token=` |
| `SELF_PING_URL` | *(empty)* | Public panel URL to self-ping every 4 minutes (keeps free hosts awake) |
| `MAX_BOTS` | `100` | Maximum number of bots |
| `MAX_FILE_MB` | `100` | Max size of a single uploaded file |

---

## 🔌 HTTP API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness probe |
| `GET` | `/api/meta` | App info, runtimes + detected versions, limits |
| `GET` | `/api/stats` | Fleet and host statistics |
| `GET` | `/api/bots` | List bots |
| `POST` | `/api/bots` | Deploy (`multipart/form-data`: `files`, `inlineCode`, `name`, `runtime`, `entry`, `startCmd`, `installCmd`, `env`, `autorun`) |
| `GET/PATCH/DELETE` | `/api/bots/:id` | Read / update / remove a bot |
| `POST` | `/api/bots/:id/start` · `/stop` · `/restart` · `/install` | Process control |
| `POST` | `/api/bots/:id/stdin` | Write to the process stdin |
| `GET/DELETE` | `/api/bots/:id/logs` | Read / clear logs |
| `GET` | `/api/bots/:id/files?path=` | List a directory |
| `GET/PUT/DELETE` | `/api/bots/:id/file?path=` | Read / write / delete a file |
| `POST` | `/api/bots/:id/upload` | Upload files into an existing bot |
| `GET` | `/api/bots/:id/download` | Download the project as ZIP |
| `GET` | `/api/bots/:id/telegram` | Verify the stored Telegram token |
| `WS` | `/ws` | Live `hello` / `bot` / `log` / `notice` / `deleted` events |

Example:

```bash
curl -X POST http://localhost:8080/api/bots \
  -F "name=my-bot" \
  -F "files=@bot.zip" \
  -F 'env={"BOT_TOKEN":"123456:ABC..."}' \
  -F "autorun=true"
```

---

## 🗂 Project structure

```
.
├── index.html        # entire frontend (UI, styles, WebSocket client)
├── server.js         # entire backend (API, supervisor, logs, files)
├── package.json
├── Dockerfile
├── Procfile
├── render.yaml
└── data/             # created at runtime (gitignored)
    ├── bots/<id>/bot.json
    ├── bots/<id>/app.log
    └── bots/<id>/files/…
```

---

## 🧠 How "never shut down" works

1. **Exit handler** — when a process exits while `desired = running`, a restart is scheduled with exponential backoff (1 s → 30 s).
2. **Watchdog** — a 2.5 s interval restarts any bot that should be running but has no process (protects against missed events, OOM kills and spawn failures).
3. **Boot resume** — every bot whose last state was *running* is relaunched when the panel starts, including after a hard kill of the panel.
4. **Orphan cleanup** — on boot, leftover processes from a previous panel instance are identified by PID + working directory and replaced cleanly.
5. **Self-ping** — optional `SELF_PING_URL` keeps sleeping free hosts awake; `/api/health` is ready for external uptime monitors.

A bot only stops when **you** press Stop or Delete.

---

## 🔒 Security notes

This panel intentionally has **no authentication** — that is the requested behaviour. It executes code you upload, so treat it like a shell:

* Run it on a VPS/container you control, not on a shared production machine.
* Put it behind HTTPS and, if it is public, set `PANEL_TOKEN` and open it with `?token=...`.
* Or restrict access with a reverse proxy, VPN, IP allowlist or Cloudflare Access.
* Never commit `data/` — it contains bot tokens.

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| Bot says `ModuleNotFoundError` | Open **Settings → Reinstall deps**, or check that `requirements.txt` is at the project root. |
| Python install fails | Install `python3-venv` and `python3-pip` on the host. |
| `command not found` at start | That runtime is not installed on the server. Use **Runtimes** to check what is available, or switch to a Docker image that includes it. |
| Bot exits instantly | Read the logs — a wrong token or missing env variable is the usual cause. |
| Panel sleeps on a free host | Set `SELF_PING_URL` and add an external uptime monitor. |
| Token check cannot reach Telegram | The server needs outbound HTTPS access to `api.telegram.org`. |

---

## 📄 License

MIT © **editz900s**

Made with ⚡ by **editz900s** — if you deploy it, keep the credit.
