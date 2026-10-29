# BotHost Serverless

A private, no-login browser dashboard for testing, deploying and managing Python Telegram bots.

**Stack:** React 19 + Vite 6 + Tailwind CSS 4 + CodeMirror 6 + Pyodide Web Workers + stateless Vercel Node functions.

> Important: this is a browser runtime, not closed-browser hosting. Bots run while a dashboard tab is open. **Autopilot / Uptime Shield** can keep a spare open browser/device alive 24/7 with leader election, wake lock, watchdog restarts and auto-resume, but no browser-only app can execute Python after every tab/device is closed. Pyrogram is detected but cannot run in a browser because MTProto needs raw TCP sockets.

Live app: https://bothost-serverless.vercel.app

---

## What works

- No signup, no login, no SQL database, no server-side bot storage.
- Code, tokens, bot settings, metrics and logs persist in IndexedDB, with a localStorage fallback.
- Dark Code Studio with Python syntax highlighting, starter templates and `.py` import.
- Regex dependency analysis with a live, editable `requirements.txt` preview.
- Real Python syntax/indentation validation using Pyodide’s `compile()` before deployment.
- Browser test runs that execute your handlers against a mocked Telegram Bot API.
- Live deployment for `telebot` / `pyTelegramBotAPI` and `python-telegram-bot` long polling.
- Bot fleet table with token masking, status, deployment date, received-message count and error count.
- Live audit logs for incoming messages, commands, Telegram API calls, timestamps and Python output.
- Deploy, pause/resume, restart, delete, clear logs, export logs, export/import workspace.
- Same-origin Vercel relay for Telegram Bot API calls. The relay stores no tokens, code, logs or bot state.
- **Autopilot / Uptime Shield**: in-app keep-awake, leader election, watchdog self-healing, auto-resume, uptime telemetry, PWA install and offline app shell — no external runner or added service.

## Runtime boundaries

| Capability | Status |
|---|---|
| `telebot` synchronous polling | Supported |
| `python-telegram-bot` asyncio polling | Supported |
| Telegram webhooks | Not supported; browser polling requires no active webhook |
| `pyrogram` / MTProto | Blocked with an actionable message; use a persistent Python host |
| Always-on execution after closing the tab | Not possible in a browser-only app |
| Native POSIX threads | Disabled; telebot runs handlers sequentially |
| Pure-Python PyPI extras | Installed with micropip when available |
| Native packages without a Pyodide/WASM build | Reported as dependency errors |
| Concurrent Python workers | 3 |
| Saved bots per workspace | 25 |
| Log retention | Latest 500 entries per bot |
| Relay upload limit | 3 MB multipart |

Pyodide unvendors native `ssl`. The worker installs a small import-compatible TLS shim because Telegram TLS is terminated by the browser and the same-origin relay, not by Python sockets. Native Python TLS socket operations raise a clear error.

Test mode mocks Telegram Bot API traffic only. Other network calls made by your script still execute and are subject to browser CORS.

---

## Quick start

Requirements: Node.js 22+.

```bash
npm ci
npm run dev
```

Open http://localhost:5173.

The Vite dev server also serves the same `/api/telegram` and `/api/health` handlers used on Vercel, so local development does not need a separate backend process.

### Production build

```bash
npm run build
npm run preview
```

`npm run build` copies the pinned Pyodide core from `node_modules/pyodide` into `public/runtime`, then builds the SPA into `dist`. The Python core is self-hosted; no Pyodide CDN is required. Pure-Python wheels are vendored in `public/wheels`.

### Tests

```bash
npm test          # Node unit tests
npm run test:e2e  # Playwright browser tests
npm run check     # unit tests + production build
```

For Playwright on a normal machine:

```bash
npx playwright install chromium
```

In constrained Linux sandboxes, `playwright.config.js` can optionally use `@sparticuz/chromium` if it is installed locally. It is not a production dependency.

---

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import it in Vercel, or use the Vercel CLI/connector.
3. Use the detected settings:
   - Framework: **Vite**
   - Install command: `npm ci`
   - Build command: `npm run build`
   - Output directory: `dist`
4. No environment variables are required.
5. If your Vercel team enables Deployment Protection by default, disable it for this project if you want the public URL to open without a Vercel login. The app itself has no login.

`vercel.json` configures the SPA rewrite, static runtime caching and function durations. The Telegram relay function is capped at 60 seconds; long-poll requests are capped at 25 seconds upstream.

### Vercel CLI alternative

```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## Using the dashboard

1. Open **Code Studio**.
2. Load a template or paste/import your Python bot.
3. Add a BotFather token in the token field, or hardcode a literal token in the script. Environment-style tokens such as `os.environ["BOT_TOKEN"]` are injected from the token field.
4. Review the generated `requirements.txt`. You can edit it or turn off auto-generation.
5. Click **Validate** for a real Python compile check.
6. Click **Test run** to execute handlers against a simulated Telegram update without sending real messages.
7. Click **Deploy bot**. The app validates syntax, verifies the token with `getMe`, checks for an active webhook, installs dependencies and starts long polling.
8. Message the bot on Telegram. Watch **Live Logs** and the **Bot Fleet** metrics.
9. Use pause/resume, restart or delete from the fleet table.

Restart flushes the log buffer and resets execution state while preserving lifetime message counts. Delete removes the local bot record only; it does not delete the BotFather bot.

---

## Autopilot / Uptime Shield

Autopilot is the maximum “24/7” mode possible **inside this app without external infrastructure**. Open **Autopilot**, mark bots as keep-running targets, then click **Arm Autopilot**. Keep one browser tab open on a spare device/browser.

What it does:

- **Leader election** — Web Locks API elects one leader tab; a localStorage lease + BroadcastChannel fallback is used when Web Locks are unavailable. Followers do not poll Telegram, preventing duplicate `getUpdates` consumers.
- **Auto-resume** — bots marked `desiredRunning` are resumed after reload, crash, failover or network recovery.
- **Watchdog** — every 10 seconds it checks worker liveness, heartbeat freshness and startup stalls. Transient failures restart with exponential backoff: 5s → 10s → 20s → 40s → … capped at 5 minutes. Healthy polling for 5 minutes resets the backoff.
- **Permanent-error stop** — bad token, syntax/indentation errors, unsupported frameworks, missing modules and webhook conflicts disable automatic retries until you fix and resume the bot.
- **Wake lock** — requests the Screen Wake Lock API while the leader tab is visible and re-acquires it when the tab becomes visible again.
- **Optional audio keepalive** — a user-gesture-armed near-silent 20 Hz tone can reduce background tab throttling on some browsers. It uses a little CPU/battery and is off by default.
- **Persistent storage** — requests `navigator.storage.persist()` to reduce browser eviction risk.
- **PWA / offline shell** — installable manifest, icons and a service worker that caches the UI, Pyodide runtime and wheels. It **never** caches `/api/*`; Telegram traffic always hits the live relay.
- **Telemetry** — shield uptime, recovery count, session count, leader diagnostics and a bounded Autopilot event feed.
- **Kiosk/fullscreen** — optional fullscreen mode for a dedicated spare screen.

### The honest boundary

Autopilot can keep a **spare device/browser that stays open** alive 24/7. It cannot execute Python after the browser/device is fully closed, the OS kills the process, or power/network is gone. No browser-only system can. For true closed-browser hosting you still need a server/runner; this mode is the maximum possible without adding external infrastructure.

Service worker registration is production-only so Vite HMR and e2e tests never fight a stale cache. In development, `/manifest.webmanifest` and `/sw.js` are still served as static files.

---

## Architecture

```text
Browser
├── React dashboard
├── IndexedDB workspace persistence
├── CodeMirror Python editor
├── Dependency / token / syntax analysis
└── Pyodide Web Worker per active bot
    ├── telebot CUSTOM_REQUEST_SENDER
    ├── python-telegram-bot fetch-backed httpx transport
    └── mocked Telegram API in test mode
          │
          ▼
Same-origin Vercel function /api/telegram
└── stateless allowlisted Telegram Bot API relay
          │
          ▼
https://api.telegram.org
```

### Key modules

| Path | Responsibility |
|---|---|
| `src/lib/analysis.js` | Import masking, dependency mapping, token extraction, redaction, structural preflight, requirements parsing |
| `src/lib/storage.js` | IndexedDB/localStorage persistence, workspace normalization, log buffers, export helpers |
| `src/lib/runtime.js` | Validator worker and live/test bot worker controller |
| `src/lib/useBotHost.js` | Deployment lifecycle, metrics, logs, pause/resume/restart/delete, workspace import/reset, Autopilot desired-state and recovery actions |
| `src/lib/autopilot.js` | DOM-free Autopilot policy: backoff, permanent errors, recovery reasons, settings/stats normalization |
| `src/lib/useAutopilot.js` | Leader election, watchdog sweep, wake lock, audio keepalive, persistence, notifications, PWA/install diagnostics |
| `src/components/Autopilot.jsx` | Uptime Shield controls, targets, telemetry and event feed |
| `public/manifest.webmanifest`, `public/sw.js`, `public/icons/` | Installable PWA manifest, offline app-shell/runtime cache and icons |
| `src/workers/python.worker.js` | Pyodide boot, micropip installs, Telegram transports, mocked test API, stdout/stderr capture, live heartbeats |
| `api/_relay.js` | Stateless Telegram relay, origin checks, rate limiting, method allowlist, payload limits |
| `api/telegram.js` | Vercel function entrypoint |
| `api/health.js` | Health probe |
| `scripts/copy-runtime.mjs` | Copies pinned Pyodide core into the static build |
| `scripts/vendor_wheels.py` | Re-downloads and SHA-256-verifies the pinned pure-Python wheels |

### Relay API

`POST /api/telegram`

```json
{
  "token": "123456789:AA…",
  "method": "sendMessage",
  "payload": { "chat_id": 123, "text": "hello" }
}
```

Optional multipart uploads use:

```json
{
  "token": "123456789:AA…",
  "method": "sendDocument",
  "payload": { "chat_id": 123 },
  "multipart": {
    "content_type": "multipart/form-data; boundary=…",
    "data_base64": "…"
  }
}
```

The relay rejects cross-origin browser requests, unsupported methods, invalid tokens and oversized payloads. It applies a best-effort per-instance rate limit. It does not persist request data.

`GET /api/health` returns service mode and confirms that storage is browser-only.

---

## Security notes

- Bot tokens are stored **unencrypted** in browser storage. Anyone with access to the browser profile or an exported workspace can read them.
- Workspace exports contain plaintext tokens. Keep them private.
- Logs redact bot tokens, but message content and chat metadata are stored locally.
- Run only trusted Python code. A Web Worker isolates execution from the UI thread, but it is not a security sandbox for malicious code.
- The public relay requires a bot token and only forwards allowlisted Telegram Bot API methods. It is not a general-purpose proxy.
- Clearing site data deletes the workspace. Export first if you need a backup.

## License

MIT. See `LICENSE`.
