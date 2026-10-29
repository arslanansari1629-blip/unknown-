/* global loadPyodide */
const BASE = self.location.origin;
let pyodide = null;
let config = null;
let stopped = false;
let testUpdateDelivered = false;
let testFinished = false;
let consecutiveFailures = 0;
let messageId = 100;
const startedAt = Date.now();

function post(type, data = {}) {
  if (!stopped) self.postMessage({ type, ...data });
}

function log(level, message) {
  post('log', { level, message: String(message) });
}

function b64(bytes) {
  if (!bytes || !bytes.length) return '';
  let binary = '';
  const view = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 8192) binary += String.fromCharCode(...view.subarray(i, i + 8192));
  return btoa(binary);
}

function parseTelegramUrl(url) {
  const parsed = new URL(url, BASE);
  const match = parsed.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
  if (parsed.hostname !== 'api.telegram.org' || !match) return null;
  const payload = {};
  for (const [key, value] of parsed.searchParams) payload[key] = value;
  return { token: match[1], method: match[2], payload };
}

function auditResponse(method, status, body, duration) {
  if (!(config?.mode === 'test' && method === 'getUpdates' && Array.isArray(body?.result) && body.result.length === 0)) {
    post('api', { method, status, duration, at: Date.now() });
  }
  if (method === 'getUpdates' && body?.ok && Array.isArray(body.result)) {
    if (body.result.length) post('updates', { updates: body.result });
    if (config?.mode === 'live') post('polling');
  }
  if (body?.ok === false) {
    const code = body.error_code;
    if (code === 401 || code === 409) {
      post('fatal', { message: body.description || `Telegram returned ${code}` });
    }
  }
}

function mockTelegram(method, payload) {
  const now = Math.floor(Date.now() / 1000);
  if (method === 'getMe') return { ok: true, result: { id: 123456789, is_bot: true, first_name: 'BotHost Test', username: 'bothost_test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } };
  if (method === 'getWebhookInfo') return { ok: true, result: { url: '', has_custom_certificate: false, pending_update_count: 0 } };
  if (method === 'deleteWebhook') return { ok: true, result: true };
  if (method === 'getUpdates') {
    if (!testUpdateDelivered) {
      testUpdateDelivered = true;
      const offset = Number(payload.offset) || 0;
      const update = {
        update_id: Math.max(Date.now(), offset),
        message: {
          message_id: 1,
          date: now,
          chat: { id: 10001, type: 'private', first_name: 'Test', username: 'test_user' },
          from: { id: 10001, is_bot: false, first_name: 'Test', username: 'test_user', language_code: 'en' },
          text: config.testText || '/start',
          entities: (config.testText || '/start').startsWith('/') ? [{ type: 'bot_command', offset: 0, length: (config.testText || '/start').split(/\s/)[0].length }] : [],
        },
      };
      return { ok: true, result: [update] };
    }
    if (!testFinished) {
      testFinished = true;
      post('test-complete', { delivered: true });
    }
    return { ok: true, result: [] };
  }
  if (method.startsWith('send') || method === 'copyMessage' || method === 'forwardMessage') {
    messageId += 1;
    const result = { message_id: messageId, date: now, chat: { id: Number(payload.chat_id) || 10001, type: 'private' } };
    if (payload.text !== undefined) result.text = String(payload.text);
    log('output', `[test] ${method} → ${String(payload.text ?? payload.caption ?? '(media/action)').slice(0, 500)}`);
    return { ok: true, result };
  }
  if (method === 'editMessageText') return { ok: true, result: { message_id: Number(payload.message_id) || 1, date: now, chat: { id: Number(payload.chat_id) || 10001, type: 'private' }, text: String(payload.text || '') } };
  if (method === 'getMyCommands') return { ok: true, result: [] };
  return { ok: true, result: true };
}

function requestBody(token, method, payload, multipart, timeout) {
  const body = { token, method, payload };
  if (multipart?.data_base64) body.multipart = multipart;
  return { body: JSON.stringify(body), timeout: Math.min(35_000, Math.max(5000, (Number(timeout) || 30) * 1000 + 5000)) };
}

function envelope(status, data) {
  return JSON.stringify({ status, body: data });
}

function requestSync(token, method, payloadJson, multipartJson, timeout) {
  const begin = Date.now();
  let payload = {};
  let multipart = null;
  try { payload = JSON.parse(payloadJson || '{}'); multipart = multipartJson ? JSON.parse(multipartJson) : null; } catch { /* handled below */ }
  if (config?.mode === 'test') {
    const data = mockTelegram(method, payload);
    auditResponse(method, 200, data, Date.now() - begin);
    return envelope(200, data);
  }
  const { body, timeout: ms } = requestBody(token, method, payload, multipart, timeout);
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/telegram`, false);
    xhr.timeout = ms;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(body);
    let data;
    try { data = JSON.parse(xhr.responseText); } catch { data = { ok: false, description: `Relay returned HTTP ${xhr.status}` }; }
    consecutiveFailures = data?.ok === false ? consecutiveFailures + 1 : 0;
    auditResponse(method, xhr.status, data, Date.now() - begin);
    if (consecutiveFailures >= 6) post('fatal', { message: 'Telegram relay failed six times in a row. Check the network and resume the bot.' });
    return envelope(xhr.status || 502, data);
  } catch (error) {
    consecutiveFailures += 1;
    const data = { ok: false, description: `Browser relay request failed: ${error.message}` };
    auditResponse(method, 502, data, Date.now() - begin);
    if (consecutiveFailures >= 6) post('fatal', { message: data.description });
    return envelope(502, data);
  }
}

async function requestAsync(token, method, payloadJson, multipartJson, timeout) {
  const begin = Date.now();
  let payload = {};
  let multipart = null;
  try { payload = JSON.parse(payloadJson || '{}'); multipart = multipartJson ? JSON.parse(multipartJson) : null; } catch { /* handled below */ }
  if (config?.mode === 'test') {
    const data = mockTelegram(method, payload);
    auditResponse(method, 200, data, Date.now() - begin);
    if (method === 'getUpdates' && testFinished) await new Promise((r) => setTimeout(r, 500));
    return envelope(200, data);
  }
  const { body, timeout: ms } = requestBody(token, method, payload, multipart, timeout);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(`${BASE}/api/telegram`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
    let data;
    try { data = await response.json(); } catch { data = { ok: false, description: `Relay returned HTTP ${response.status}` }; }
    consecutiveFailures = data?.ok === false ? consecutiveFailures + 1 : 0;
    auditResponse(method, response.status, data, Date.now() - begin);
    if (consecutiveFailures >= 6) post('fatal', { message: 'Telegram relay failed six times in a row. Check the network and resume the bot.' });
    return envelope(response.status, data);
  } catch (error) {
    consecutiveFailures += 1;
    const data = { ok: false, description: `Browser relay request failed: ${error.message}` };
    auditResponse(method, 502, data, Date.now() - begin);
    if (consecutiveFailures >= 6) post('fatal', { message: data.description });
    return envelope(502, data);
  } finally {
    clearTimeout(timer);
  }
}

async function boot() {
  importScripts(`${BASE}/runtime/pyodide.js`);
  pyodide = await loadPyodide({ indexURL: `${BASE}/runtime/`, stdout: () => {}, stderr: () => {} });
}

async function validate(source) {
  await boot();
  pyodide.globals.set('__bothost_source', source);
  const result = pyodide.runPython(`
import json, sys
result = {"ok": True, "errors": [], "python": sys.version.split()[0]}
try:
    compile(__bothost_source, "bot.py", "exec")
except SyntaxError as exc:
    result = {"ok": False, "python": sys.version.split()[0], "errors": [{"line": exc.lineno or 1, "column": exc.offset or 1, "message": exc.msg}]}
json.dumps(result)
`);
  post('validation', JSON.parse(result));
}

async function run(message) {
  config = message;
  post('status', { status: 'installing' });
  await boot();
  const manifestResponse = await fetch(`${BASE}/wheels/manifest.json`);
  if (!manifestResponse.ok) throw new Error('Python package manifest is missing. Rebuild the app with npm run build.');
  const manifest = await manifestResponse.json();
  pyodide.registerJsModule('_bothost', {
    log,
    request_sync: requestSync,
    request_async: requestAsync,
    mode: message.mode,
  });
  await pyodide.loadPackage([
    `${BASE}/wheels/${manifest.packaging.file}`,
    `${BASE}/wheels/${manifest.micropip.file}`,
  ]);
  pyodide.globals.set('__bothost_manifest', JSON.stringify(manifest));
  pyodide.globals.set('__bothost_requirements', JSON.stringify(message.requirements || []));
  pyodide.globals.set('__bothost_base', BASE);
  await pyodide.runPythonAsync(`
import json, micropip
from packaging.requirements import Requirement
manifest = json.loads(__bothost_manifest)
requirements = [Requirement(r) for r in json.loads(__bothost_requirements)]
explicit = {r.name.lower().replace('_', '-'): r for r in requirements}
frameworks = {'pytelegrambotapi', 'python-telegram-bot'}
local, remote = [], []
for name, meta in manifest.items():
    if name in {'micropip', 'packaging'}:
        continue
    if name in frameworks and name not in explicit:
        continue
    req = explicit.get(name)
    if req is not None and (req.url or not req.specifier.contains(meta['version'], prereleases=True)):
        continue
    local.append(__bothost_base + '/wheels/' + meta['file'])
for req in requirements:
    name = req.name.lower().replace('_', '-')
    meta = manifest.get(name)
    if meta is None or req.url or not req.specifier.contains(meta['version'], prereleases=True):
        remote.append(str(req))
await micropip.install(local + remote, deps=True, keep_going=False)
`);
  // Pyodide unvendors native ssl. Telegram TLS is terminated by the browser /
  // same-origin relay, so provide an import-compatible no-op context for libraries
  // that only need ssl symbols while their transport is replaced below.
  pyodide.runPython(`
import sys, types, enum
try:
    import ssl  # noqa: F401
except ModuleNotFoundError:
    ssl = types.ModuleType('ssl')
    class SSLError(OSError): pass
    class SSLCertVerificationError(SSLError): pass
    class SSLZeroReturnError(SSLError): pass
    class SSLWantReadError(SSLError): pass
    class SSLWantWriteError(SSLError): pass
    class SSLSyscallError(SSLError): pass
    class SSLEOFError(SSLError): pass
    class VerifyMode(enum.IntEnum):
        CERT_NONE = 0
        CERT_OPTIONAL = 1
        CERT_REQUIRED = 2
    class Purpose(enum.Enum):
        SERVER_AUTH = 'SERVER_AUTH'
        CLIENT_AUTH = 'CLIENT_AUTH'
    class TLSVersion(enum.IntEnum):
        MINIMUM_SUPPORTED = -2
        MAXIMUM_SUPPORTED = -1
        SSLv3 = 768
        TLSv1 = 769
        TLSv1_1 = 770
        TLSv1_2 = 771
        TLSv1_3 = 772
    class SSLSocket: pass
    class SSLObject: pass
    class MemoryBIO: pass
    class SSLContext:
        def __init__(self, *a, **k):
            self.check_hostname = False
            self.hostname_checks_common_name = False
            self.verify_mode = VerifyMode.CERT_NONE
            self.options = 0
            self.minimum_version = TLSVersion.MINIMUM_SUPPORTED
            self.maximum_version = TLSVersion.MAXIMUM_SUPPORTED
            self.post_handshake_auth = False
            self.num_tickets = 0
        def set_alpn_protocols(self, *a, **k): pass
        def load_verify_locations(self, *a, **k): pass
        def load_cert_chain(self, *a, **k): pass
        def set_ciphers(self, *a, **k): pass
        def wrap_socket(self, *a, **k): raise RuntimeError('Native Python TLS sockets are unavailable in the browser. Use the BotHost relay or browser fetch transport.')
        def wrap_bio(self, *a, **k): raise RuntimeError('Native Python TLS sockets are unavailable in the browser.')
    ssl.SSLError = SSLError
    ssl.SSLCertVerificationError = SSLCertVerificationError
    ssl.SSLZeroReturnError = SSLZeroReturnError
    ssl.SSLWantReadError = SSLWantReadError
    ssl.SSLWantWriteError = SSLWantWriteError
    ssl.SSLSyscallError = SSLSyscallError
    ssl.SSLEOFError = SSLEOFError
    ssl.SSLContext = SSLContext
    ssl.SSLSocket = SSLSocket
    ssl.SSLObject = SSLObject
    ssl.MemoryBIO = MemoryBIO
    ssl.VerifyMode = VerifyMode
    ssl.Purpose = Purpose
    ssl.TLSVersion = TLSVersion
    ssl.CERT_NONE = VerifyMode.CERT_NONE
    ssl.CERT_OPTIONAL = VerifyMode.CERT_OPTIONAL
    ssl.CERT_REQUIRED = VerifyMode.CERT_REQUIRED
    ssl.PROTOCOL_TLS = 2
    ssl.PROTOCOL_TLS_CLIENT = 16
    ssl.PROTOCOL_TLS_SERVER = 17
    ssl.OP_ALL = 0x80000000
    ssl.OP_NO_SSLv2 = 0x01000000
    ssl.OP_NO_SSLv3 = 0x02000000
    ssl.OP_NO_TLSv1 = 0x04000000
    ssl.OP_NO_TLSv1_1 = 0x10000000
    ssl.OP_NO_TLSv1_2 = 0x08000000
    ssl.OP_NO_TLSv1_3 = 0x20000000
    ssl.OP_NO_COMPRESSION = 0x20000
    ssl.OP_NO_TICKET = 0x4000
    ssl.HAS_NEVER_CHECK_COMMON_NAME = True
    ssl.HAS_SNI = True
    ssl.HAS_ALPN = True
    ssl.HAS_SSLv3 = False
    ssl.HAS_TLSv1 = False
    ssl.HAS_TLSv1_1 = False
    ssl.HAS_TLSv1_2 = True
    ssl.HAS_TLSv1_3 = True
    ssl.OPENSSL_VERSION = 'OpenSSL 3.0.0 (BotHost browser relay shim)'
    ssl.OPENSSL_VERSION_INFO = (3, 0, 0, 0, 0)
    ssl.OPENSSL_VERSION_NUMBER = 0x30000000
    ssl.create_default_context = lambda *a, **k: SSLContext()
    ssl.wrap_socket = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('Native Python TLS sockets are unavailable in the browser.'))
    ssl.get_default_verify_paths = lambda: types.SimpleNamespace(cafile=None, capath=None, openssl_cafile=None, openssl_capath=None)
    ssl.RAND_bytes = lambda n: bytes(n)
    sys.modules['ssl'] = ssl
    sys.modules['_ssl'] = ssl
`);
  log('info', `Python ${pyodide.runPython('import sys; sys.version.split()[0]')} runtime ready. Dependencies installed.`);
  post('status', { status: 'connecting' });
  pyodide.globals.set('__bothost_token', message.token || '123456789:TEST_TOKEN_PLACEHOLDER_000000000000000');
  pyodide.globals.set('__bothost_offset', message.offset || 0);
  pyodide.globals.set('__bothost_source', message.code);
  await pyodide.runPythonAsync(`
import os, sys, json, base64, logging, traceback
import _bothost
from urllib.parse import urlsplit, parse_qsl

os.environ['BOT_TOKEN'] = __bothost_token
os.environ['TELEGRAM_BOT_TOKEN'] = __bothost_token
os.environ['TELEGRAM_TOKEN'] = __bothost_token
os.environ['TOKEN'] = __bothost_token
os.environ['BOTHOST_MODE'] = _bothost.mode

class _LineLogger:
    def __init__(self, level):
        self.level = level
        self.buffer = ''
    def write(self, text):
        self.buffer += str(text)
        while '\\n' in self.buffer:
            line, self.buffer = self.buffer.split('\\n', 1)
            if line.strip():
                _bothost.log(self.level, line)
        return len(text)
    def flush(self):
        if self.buffer.strip():
            _bothost.log(self.level, self.buffer)
        self.buffer = ''
    def isatty(self):
        return False

sys.stdout = _LineLogger('output')
sys.stderr = _LineLogger('error')
logging.basicConfig(level=logging.INFO, stream=sys.stdout, format='%(levelname)s %(name)s: %(message)s', force=True)

def _split_url(url):
    parts = urlsplit(str(url))
    path = parts.path
    if path.startswith('/bot'):
        _, token, method = path.split('/', 2)
    else:
        token, method = __bothost_token, path.strip('/').split('/')[-1]
    return token, method, dict(parse_qsl(parts.query, keep_blank_values=True))

def _body_payload(body, content_type, payload):
    if not body:
        return payload, None
    ctype = (content_type or '').lower()
    raw = body.encode() if isinstance(body, str) else bytes(body)
    if ctype.startswith('multipart/form-data'):
        return payload, {'content_type': content_type, 'data_base64': base64.b64encode(raw).decode()}
    if 'json' in ctype:
        try:
            payload.update(json.loads(raw))
        except Exception:
            pass
    else:
        payload.update(dict(parse_qsl(raw.decode('utf-8', 'replace'), keep_blank_values=True)))
    return payload, None

def _sync_call(url, body=None, content_type='', timeout=30):
    token, method, payload = _split_url(url)
    payload, multipart = _body_payload(body, content_type, payload)
    return json.loads(_bothost.request_sync(token, method, json.dumps(payload), json.dumps(multipart) if multipart else '', timeout))

async def _async_call(url, body=None, content_type='', timeout=30):
    token, method, payload = _split_url(url)
    payload, multipart = _body_payload(body, content_type, payload)
    raw = await _bothost.request_async(token, method, json.dumps(payload), json.dumps(multipart) if multipart else '', timeout)
    return json.loads(raw)

# Telebot: route every Bot API request through the same-origin relay and avoid
# POSIX worker threads, which are unavailable in a non-isolated browser worker.
try:
    import telebot
    import requests
    _orig_telebot_init = telebot.TeleBot.__init__
    def _browser_telebot_init(self, *args, **kwargs):
        kwargs['threaded'] = False
        kwargs['num_threads'] = 1
        if __bothost_offset > 0:
            kwargs['last_update_id'] = __bothost_offset - 1
        _orig_telebot_init(self, *args, **kwargs)
    telebot.TeleBot.__init__ = _browser_telebot_init
    def _telebot_sender(method, url, params=None, files=None, timeout=None, **kwargs):
        prepared = requests.Request(method.upper(), url, params=params, files=files).prepare()
        seconds = timeout[1] if isinstance(timeout, tuple) else (timeout or 30)
        env = _sync_call(prepared.url, prepared.body, prepared.headers.get('Content-Type', ''), seconds)
        response = requests.Response()
        response.status_code = env['status']
        response._content = json.dumps(env['body']).encode()
        response.headers['Content-Type'] = 'application/json'
        response.encoding = 'utf-8'
        response.url = 'https://api.telegram.org/bot[REDACTED]/request'
        response.reason = 'OK' if env['status'] == 200 else 'ERROR'
        return response
    telebot.apihelper.CUSTOM_REQUEST_SENDER = _telebot_sender
except ImportError:
    pass

# Generic requests / urllib support for non-Telegram HTTP (subject to CORS).
try:
    import pyodide_http
    pyodide_http.patch_all()
except ImportError:
    pass

# python-telegram-bot uses httpx. Inject an async transport backed by fetch.
try:
    import httpx
    from pyodide.http import pyfetch
    class _BothostTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            url = str(request.url)
            if 'api.telegram.org' in url:
                timeout = getattr(request.extensions.get('timeout', {}), 'get', lambda k, d=None: d)('read', 30)
                env = await _async_call(url, request.content, request.headers.get('content-type', ''), timeout or 30)
                return httpx.Response(env['status'], json=env['body'], request=request)
            response = await pyfetch(url, method=request.method, headers=dict(request.headers), body=request.content or None)
            content = await response.bytes()
            return httpx.Response(response.status, content=content, headers=dict(response.headers), request=request)
    _orig_httpx_init = httpx.AsyncClient.__init__
    def _browser_httpx_init(self, *args, **kwargs):
        kwargs['transport'] = _BothostTransport()
        _orig_httpx_init(self, *args, **kwargs)
    httpx.AsyncClient.__init__ = _browser_httpx_init
except ImportError:
    pass

print('Starting bot script…')
`);
  const namespace = pyodide.toPy({ __name__: '__main__', __file__: 'bot.py' });
  try {
    await pyodide.runPythonAsync(message.code, { globals: namespace });
    if (config.mode === 'test') {
      if (!testFinished) post('test-complete', { delivered: testUpdateDelivered });
    } else if (!stopped) {
      post('finished', { message: 'The script finished without keeping a polling loop alive. Use bot.infinity_polling() or application.run_polling().' });
    }
  } finally {
    namespace.destroy();
  }
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.action === 'validate') await validate(message.code);
    else if (message.action === 'run') await run(message);
  } catch (error) {
    post('error', { message: error?.message || String(error), stack: error?.stack || '' });
  }
};
