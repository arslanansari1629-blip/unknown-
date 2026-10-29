export const PACKAGE_MAP = {
  telebot: 'pytelegrambotapi',
  telegram: 'python-telegram-bot',
  'telegram.ext': 'python-telegram-bot',
  pyrogram: 'pyrogram',
  requests: 'requests',
  httpx: 'httpx',
  aiohttp: 'aiohttp',
  bs4: 'beautifulsoup4',
  dotenv: 'python-dotenv',
  PIL: 'pillow',
  cv2: 'opencv-python',
  sklearn: 'scikit-learn',
  yaml: 'pyyaml',
  dateutil: 'python-dateutil',
  Crypto: 'pycryptodome',
  OpenSSL: 'pyopenssl',
  attr: 'attrs',
  serial: 'pyserial',
  usb: 'pyusb',
  pandas: 'pandas',
  numpy: 'numpy',
  flask: 'flask',
  fastapi: 'fastapi',
  sqlalchemy: 'sqlalchemy',
  psycopg2: 'psycopg2-binary',
  MySQLdb: 'mysqlclient',
  redis: 'redis',
  pymongo: 'pymongo',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google-api-python-client',
  googleapiclient: 'google-api-python-client',
  discord: 'discord.py',
  slugify: 'python-slugify',
  jwt: 'pyjwt',
  jose: 'python-jose',
  magic: 'python-magic',
  decouple: 'python-decouple',
  loguru: 'loguru',
  pydantic: 'pydantic',
  emoji: 'emoji',
  gtts: 'gtts',
  wikipedia: 'wikipedia',
  feedparser: 'feedparser',
  lxml: 'lxml',
  matplotlib: 'matplotlib',
  scipy: 'scipy',
  torch: 'torch',
  tensorflow: 'tensorflow',
};

export const DEFAULT_PINS = {
  pytelegrambotapi: '4.26.0',
  'python-telegram-bot': '21.10',
  requests: '2.32.3',
  httpx: '0.27.2',
};

// Python 3.12 standard library. The authoritative check also runs in Pyodide.
export const STDLIB = new Set(`__future__ _thread abc aifc argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg cProfile crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib numbers operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo`.split(/\s+/));

export const UNSUPPORTED_MODULES = {
  pyrogram: 'Pyrogram uses MTProto raw TCP sockets, which browsers cannot open. Use a telebot or python-telegram-bot polling script here, or run Pyrogram on a persistent Python host.',
  tgcrypto: 'Tgcrypto is a native Pyrogram acceleration module and is not available in this browser runtime.',
  pyromod: 'pyromod depends on Pyrogram’s raw-socket MTProto transport, which is unavailable in a browser.',
  uvloop: 'uvloop needs native event-loop access. Pyodide provides its own browser event loop.',
  psutil: 'psutil needs operating-system process access that a browser does not expose.',
  pyautogui: 'Browser workers cannot control the host desktop.',
  serial: 'Hardware serial ports are not available inside the Python worker.',
};

export const NATIVE_HINTS = new Set(['numpy', 'pandas', 'pillow', 'opencv-python', 'scipy', 'scikit-learn', 'lxml', 'matplotlib', 'torch', 'tensorflow', 'aiohttp', 'pycryptodome', 'pyopenssl']);

/** Mask comments and string contents while preserving line/column offsets. */
export function maskPython(source) {
  let out = '';
  let quote = null;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (source.startsWith(quote, i)) {
        out += ' '.repeat(quote.length);
        i += quote.length;
        quote = null;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (ch === '#') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = source.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      out += ' '.repeat(quote.length);
      i += quote.length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Replace comments with spaces while preserving string literals and offsets. */
export function maskComments(source) {
  let out = '';
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        if (i + 1 < source.length) out += source[i + 1];
        i += 1;
        continue;
      }
      if (source.startsWith(quote, i)) {
        out += quote.slice(1);
        i += quote.length - 1;
        quote = null;
      }
      continue;
    }
    if (ch === '#') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      if (i < source.length) out += '\n';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = source.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      out += quote;
      i += quote.length - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Regex import extraction, including aliases, comma lists and parenthesized from-imports. */
export function detectImports(source) {
  const masked = maskPython(source);
  const found = new Set();
  const importRe = /^[ \t]*import[ \t]+([^\n;#]+)/gm;
  const fromRe = /^[ \t]*from[ \t]+([A-Za-z_][\w.]*)[ \t]+import[ \t]+([\s\S]*?)(?=\n[ \t]*(?:from|import|def|class|@|[A-Za-z_][\w.]*[ \t]*=)|$)/gm;
  let match;
  while ((match = importRe.exec(masked))) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_][\w.]*$/.test(name)) found.add(name.split('.')[0]);
    }
  }
  while ((match = fromRe.exec(masked))) {
    const name = match[1];
    if (!name.startsWith('.')) found.add(name.split('.')[0]);
  }
  return [...found].sort();
}

export function analyzeDependencies(source) {
  const imports = detectImports(source);
  const packages = [];
  const warnings = [];
  const blockers = [];
  for (const mod of imports) {
    if (STDLIB.has(mod)) continue;
    const pkg = PACKAGE_MAP[mod] || mod;
    if (UNSUPPORTED_MODULES[mod]) blockers.push({ module: mod, message: UNSUPPORTED_MODULES[mod] });
    if (NATIVE_HINTS.has(pkg)) warnings.push({ module: mod, message: `${pkg} may require a WebAssembly build. If pip cannot find a pure-Python wheel, deployment will report the exact package error.` });
    const pin = DEFAULT_PINS[pkg];
    packages.push({ module: mod, name: pkg, requirement: pin ? `${pkg}==${pin}` : pkg, pinned: Boolean(pin) });
  }
  const unique = [...new Map(packages.map((p) => [p.name, p])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const framework = imports.includes('telebot') ? 'telebot' : imports.includes('telegram') ? 'python-telegram-bot' : imports.includes('pyrogram') ? 'pyrogram' : null;
  if (!framework && imports.length) warnings.push({ module: 'runtime', message: 'No supported Telegram framework import was detected. The script can still be validated, but live deployment needs telebot or python-telegram-bot polling.' });
  return { imports, packages, requirements: unique.map((p) => p.requirement).join('\n'), warnings, blockers, framework };
}

export const TOKEN_RE = /\b(\d{5,16}:[A-Za-z0-9_-]{30,})\b/;
const ENV_TOKEN_NAMES = ['BOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_TOKEN', 'TOKEN'];

export function extractToken(source, override = '') {
  const trimmed = override.trim();
  if (trimmed) return { token: trimmed, source: 'manual', valid: TOKEN_RE.test(trimmed) };
  const masked = maskComments(source);
  // Find literal assignments first; preserve the original string value.
  const assignRe = /(?:BOT_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_TOKEN|TOKEN|token)\s*=\s*(['"])(.*?)\1/g;
  let match;
  while ((match = assignRe.exec(masked))) {
    if (TOKEN_RE.test(match[2])) return { token: match[2].match(TOKEN_RE)[1], source: 'code', valid: true };
  }
  const stringRe = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let stringMatch;
  while ((stringMatch = stringRe.exec(masked))) {
    const tokenMatch = stringMatch[2].match(TOKEN_RE);
    if (tokenMatch) return { token: tokenMatch[1], source: 'code', valid: true };
  }
  const envUsed = ENV_TOKEN_NAMES.some((name) => new RegExp(`(?:environ(?:\\.get)?\\s*(?:\\[|\\()\\s*['"]${name}['"]|getenv\\s*\\(\\s*['"]${name}['"])`).test(masked));
  return { token: '', source: envUsed ? 'environment' : 'missing', valid: false };
}

export function maskToken(token) {
  if (!token) return 'Not configured';
  const colon = token.indexOf(':');
  if (colon < 0) return '••••••••';
  return `${token.slice(0, colon + 1)}••••••••${token.slice(-4)}`;
}

export function redact(text, token) {
  let value = String(text ?? '');
  if (token) value = value.split(token).join('[REDACTED_TOKEN]');
  return value.replace(/\b\d{5,16}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED_TOKEN]');
}

/** Fast structural preflight. Pyodide's compile() is the authoritative syntax check. */
export function preflightPython(source) {
  const errors = [];
  if (!source.trim()) return { ok: false, errors: [{ line: 1, message: 'Paste some Python code before continuing.' }] };
  if (source.length > 200_000) errors.push({ line: 1, message: 'Source is larger than the 200 KB studio limit.' });
  const lines = source.split('\n');
  const maskedLines = maskPython(source).split('\n');
  let depth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const indent = line.match(/^[ \t]*/)[0];
    if (indent.includes('\t') && indent.includes(' ')) errors.push({ line: i + 1, message: 'Mixed tabs and spaces in indentation. Use four spaces consistently.' });
    const code = maskedLines[i] || '';
    if (/^[ \t]*(?:def|class|if|elif|else|for|while|try|except|finally|with|async\s+def|match|case)\b[^#\n]*:\s*(?:#.*)?$/.test(code)) {
      const next = lines.slice(i + 1).find((l) => l.trim() && !l.trim().startsWith('#'));
      if (next !== undefined) {
        const currentIndent = indent.replace(/\t/g, '    ').length;
        const nextIndent = next.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
        if (nextIndent <= currentIndent) errors.push({ line: i + 2, message: 'Expected an indented block after this statement.' });
      }
    }
    for (const ch of code) {
      if ('([{'.includes(ch)) depth += 1;
      if (')]}'.includes(ch)) depth -= 1;
    }
  }
  if (depth !== 0) errors.push({ line: lines.length, message: 'Unbalanced brackets or parentheses in source.' });
  return { ok: errors.length === 0, errors };
}

export function parseRequirements(text) {
  const requirements = [];
  const errors = [];
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (/^(-|--|https?:|git\+|file:)/i.test(line)) {
      errors.push(`Line ${index + 1}: pip options, URLs and editable installs are not supported.`);
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9,_-]+\])?(?:(?:==|>=|<=|~=|!=|>|<)\s*[A-Za-z0-9.*+!-]+(?:\s*,\s*(?:==|>=|<=|~=|!=|>|<)\s*[A-Za-z0-9.*+!-]+)*)?$/.test(line)) {
      errors.push(`Line ${index + 1}: invalid requirement “${line}”.`);
      continue;
    }
    requirements.push(line);
  }
  return { requirements, errors };
}
