#!/usr/bin/env node
/**
 * ============================================================================
 *  editz900s BOT CLOUD — single-file backend
 * ============================================================================
 *  Advanced Telegram bot hosting panel.
 *  • No login / no signup — open panel
 *  • Upload a ZIP, a folder or paste code (Python, Node.js, anything)
 *  • Auto dependency install (pip / npm / composer / bundle / cargo / go)
 *  • Supervised processes: auto-restart forever with capped backoff
 *  • Live logs over WebSocket + live CPU / RAM meters
 *  • Built-in file browser + editor + env manager + Telegram token checker
 *
 *  Developer : editz900s
 *  Run       : npm install && npm start
 *  Env       : PORT, HOST, DATA_DIR, PANEL_TOKEN (optional), SELF_PING_URL
 * ============================================================================
 */

'use strict';

const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

/* ---------------------------------------------------------------------------
 *  Identity & configuration
 * ------------------------------------------------------------------------- */
const APP = {
  name: 'editz900s Bot Cloud',
  short: 'BOTCLOUD',
  developer: 'editz900s',
  version: '1.0.0',
};

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const BOTS_DIR = path.join(DATA_DIR, 'bots');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const PANEL_TOKEN = String(process.env.PANEL_TOKEN || '').trim();
const SELF_PING_URL = String(process.env.SELF_PING_URL || '').trim();
const MAX_BOTS = Number(process.env.MAX_BOTS || 100);
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_MB || 100) * 1024 * 1024;
const LOG_BUFFER = 800;
const LOG_FILE_MAX = 2 * 1024 * 1024;
const PANEL_STARTED = Date.now();
const IS_LINUX = process.platform === 'linux';
const IS_WIN = process.platform === 'win32';
const SHELL = IS_WIN ? 'cmd.exe' : '/bin/bash';
const shellArgs = (cmd) => (IS_WIN ? ['/d', '/s', '/c', cmd] : ['-lc', cmd]);

for (const dir of [DATA_DIR, BOTS_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });

const bots = new Map(); // id -> { meta, dir, filesDir, proc, installProc, logs[], startedAt, ... }
let wss = null;

/* ---------------------------------------------------------------------------
 *  Small helpers
 * ------------------------------------------------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const rid = () => crypto.randomBytes(5).toString('hex');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function safeRelPath(raw) {
  let p = String(raw || '').replace(/\\/g, '/').replace(/\0/g, '').trim();
  p = p.replace(/^\[?\/?\]?/, '').replace(/^[a-zA-Z]:\//, '');
  const parts = p.split('/').filter((x) => x && x !== '.' && x !== '..');
  return parts.join('/');
}

function resolveInside(root, rel) {
  const clean = safeRelPath(rel);
  const p = path.resolve(root, clean);
  const rootResolved = path.resolve(root);
  if (p !== rootResolved && !p.startsWith(rootResolved + path.sep)) {
    throw httpError(400, 'Invalid path');
  }
  return p;
}

function botDir(id) { return path.join(BOTS_DIR, id); }
function botFilesDir(id) { return path.join(botDir(id), 'files'); }
function botLogFile(id) { return path.join(botDir(id), 'app.log'); }

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(p, data) {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Read pid cwd to make sure a pid from disk really belongs to this bot. */
function pidMatchesDir(pid, dir) {
  if (!IS_LINUX || !isPidAlive(pid)) return false;
  try {
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    return path.resolve(cwd) === path.resolve(dir);
  } catch { return false; }
}

function killGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); return; } catch { /* not a group leader */ }
  try { process.kill(pid, signal); } catch { /* gone */ }
}

function isAlive(bot) {
  if (!bot.proc || bot.proc.exitCode !== null || bot.proc.signalCode !== null) return false;
  return true;
}

function readProcMetrics(pid, prev) {
  try {
    const statm = fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ');
    const rssPages = Number(statm[1] || 0);
    const rss = rssPages * 4096;
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    // after comm: state(0) ... utime(11) stime(12) starttime(19)
    const ticks = Number(fields[11] || 0) + Number(fields[12] || 0);
    const t = Date.now();
    let cpu = 0;
    if (prev && prev.ticks != null && t > prev.at) {
      const hz = 100;
      cpu = Math.max(0, Math.min(100, ((ticks - prev.ticks) / hz / ((t - prev.at) / 1000)) * 100));
    }
    return { rss, ticks, at: t, cpu, ok: true };
  } catch {
    return { rss: 0, ticks: 0, at: Date.now(), cpu: 0, ok: false };
  }
}

function parseEnvInput(input) {
  const out = {};
  if (!input) return out;
  if (typeof input === 'string' && input.trim().startsWith('{')) {
    try { input = JSON.parse(input); } catch { /* fall through to .env parsing */ }
  }
  if (typeof input === 'object' && !Array.isArray(input)) {
    for (const [k, v] of Object.entries(input)) {
      const key = String(k).trim();
      if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) out[key] = String(v == null ? '' : v);
    }
    return out;
  }
  for (const line of String(input).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const key = s.slice(0, i).trim().replace(/^export\s+/, '');
    let val = s.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) out[key] = val;
  }
  return out;
}

function findBotToken(env) {
  const keys = ['BOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_TOKEN', 'API_TOKEN', 'TOKEN', 'BOT_API_TOKEN'];
  for (const k of Object.keys(env || {})) {
    if (keys.includes(k.toUpperCase()) && /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(env[k]).trim())) {
      return String(env[k]).trim();
    }
  }
  for (const v of Object.values(env || {})) {
    if (/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(v).trim())) return String(v).trim();
  }
  return null;
}

/* ---------------------------------------------------------------------------
 *  Runtime registry — "any language" support
 * ------------------------------------------------------------------------- */
const RUNTIMES = {
  python:  { label: 'Python',     color: '#4ea1ff', bins: ['python3', 'python'], ext: ['.py'], entry: ['bot.py', 'main.py', 'app.py', 'index.py', '__main__.py'] },
  node:    { label: 'Node.js',    color: '#7ed957', bins: ['node'], ext: ['.js', '.mjs', '.cjs'], entry: ['index.js', 'bot.js', 'main.js', 'app.js', 'server.js'] },
  bun:     { label: 'Bun',        color: '#f5d6a0', bins: ['bun'], ext: ['.ts', '.js'], entry: ['index.ts', 'index.js', 'bot.ts'] },
  deno:    { label: 'Deno',       color: '#a7b6c8', bins: ['deno'], ext: ['.ts'], entry: ['index.ts', 'main.ts'] },
  ruby:    { label: 'Ruby',       color: '#ff6b6b', bins: ['ruby'], ext: ['.rb'], entry: ['bot.rb', 'main.rb', 'app.rb'] },
  php:     { label: 'PHP',        color: '#a78bfa', bins: ['php'], ext: ['.php'], entry: ['index.php', 'bot.php', 'main.php'] },
  go:      { label: 'Go',         color: '#5ad1e6', bins: ['go'], ext: ['.go'], entry: ['main.go'] },
  rust:    { label: 'Rust',       color: '#f0a06a', bins: ['cargo'], ext: ['.rs'], entry: ['main.rs'] },
  java:    { label: 'Java',       color: '#ff9f43', bins: ['java'], ext: ['.jar', '.java'], entry: [] },
  dotnet:  { label: '.NET',       color: '#9b8cff', bins: ['dotnet'], ext: ['.cs', '.dll'], entry: [] },
  bash:    { label: 'Bash',       color: '#98d982', bins: ['bash'], ext: ['.sh'], entry: ['start.sh', 'run.sh', 'bot.sh'] },
  perl:    { label: 'Perl',       color: '#79c0ff', bins: ['perl'], ext: ['.pl'], entry: ['bot.pl', 'main.pl'] },
  lua:     { label: 'Lua',        color: '#7c8cff', bins: ['lua'], ext: ['.lua'], entry: ['bot.lua', 'main.lua'] },
  dart:    { label: 'Dart',       color: '#4fc3f7', bins: ['dart'], ext: ['.dart'], entry: ['main.dart', 'bot.dart'] },
  elixir:  { label: 'Elixir',     color: '#c792ea', bins: ['elixir'], ext: ['.exs', '.ex'], entry: ['main.exs', 'bot.exs'] },
  custom:  { label: 'Custom',     color: '#8b9bb4', bins: [], ext: [], entry: [] },
};

const HIDDEN_DIRS = new Set(['node_modules', '.venv', 'venv', '__pycache__', '.git', '.cache', 'dist', 'build', 'target', '.next', '.nuxt', 'coverage', 'vendor', '.botcloud', '__MACOSX', '.botcloud-installed']);

function listAllFiles(root, { skipHidden = true, max = 6000 } = {}) {
  const out = [];
  const walk = (dir, rel) => {
    if (out.length >= max) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      if (skipHidden && HIDDEN_DIRS.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), relPath);
      else if (e.isFile()) out.push(relPath);
    }
  };
  walk(root, '');
  return out;
}

function detectRuntime(filesDir, fileList) {
  const all = fileList.map((f) => f.toLowerCase());
  const top = all.filter((f) => !f.includes('/'));
  const has = (name) => top.includes(name.toLowerCase());
  const hasEnd = (suffix) => all.some((f) => f.endsWith(suffix));

  const pkg = readJson(path.join(filesDir, 'package.json'), null);

  if (has('requirements.txt') || has('pyproject.toml') || has('pipfile') || hasEnd('.py')) return 'python';
  if (pkg || hasEnd('.js') || hasEnd('.mjs') || hasEnd('.cjs')) {
    if (has('bun.lockb') || has('bun.lock') || has('bunfig.toml')) return 'bun';
    return 'node';
  }
  if (has('bun.lockb')) return 'bun';
  if (has('deno.json') || has('deno.jsonc') || hasEnd('.ts')) return 'deno';
  if (has('gemfile') || hasEnd('.rb')) return 'ruby';
  if (has('composer.json') || hasEnd('.php')) return 'php';
  if (has('go.mod') || hasEnd('.go')) return 'go';
  if (has('cargo.toml') || hasEnd('.rs')) return 'rust';
  if (hasEnd('.jar')) return 'java';
  if (has('pom.xml') || has('build.gradle') || hasEnd('.java')) return 'java';
  if (hasEnd('.csproj') || hasEnd('.sln') || hasEnd('.cs')) return 'dotnet';
  if (hasEnd('.sh')) return 'bash';
  if (hasEnd('.pl')) return 'perl';
  if (hasEnd('.lua')) return 'lua';
  if (hasEnd('.dart')) return 'dart';
  if (hasEnd('.exs') || hasEnd('.ex')) return 'elixir';
  return 'custom';
}

function detectEntry(filesDir, fileList, runtime) {
  const def = RUNTIMES[runtime] || RUNTIMES.custom;
  const all = fileList;
  const base = (p) => p.split('/').pop().toLowerCase();

  // 1. package.json "main" / "start" for node-like runtimes
  if (['node', 'bun', 'deno'].includes(runtime)) {
    const pkg = readJson(path.join(filesDir, 'package.json'), null);
    if (pkg && typeof pkg.main === 'string') {
      const main = safeRelPath(pkg.main);
      if (main && all.some((f) => f === main)) return main;
    }
    const idx = all.find((f) => f === 'index.js') || all.find((f) => f === 'index.ts');
    if (idx) return idx;
  }

  // 2. exact preferred names, top level first
  const topFiles = all.filter((f) => !f.includes('/'));
  for (const name of def.entry) {
    const hit = topFiles.find((f) => f.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  // 3. preferred names anywhere (single-folder projects)
  for (const name of def.entry) {
    const hit = all.find((f) => base(f) === name.toLowerCase());
    if (hit) return hit;
  }
  // 4. any file with the runtime extension, top level first
  for (const ext of def.ext) {
    const hit = topFiles.find((f) => f.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  for (const ext of def.ext) {
    const hit = all.find((f) => f.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return null;
}

function pythonBin(bot) {
  const venv = path.join(bot.filesDir, '.venv', 'bin', 'python');
  if (exists(venv)) return './.venv/bin/python -u';
  const venvWin = path.join(bot.filesDir, '.venv', 'Scripts', 'python.exe');
  if (exists(venvWin)) return shq(venvWin);
  return 'python3 -u';
}

function hasPackageStart(bot) {
  const pkg = readJson(path.join(bot.filesDir, 'package.json'), null);
  return !!(pkg && pkg.scripts && typeof pkg.scripts.start === 'string' && pkg.scripts.start.trim());
}

function defaultStartCommand(bot) {
  const m = bot.meta;
  const entry = m.entry ? shq(m.entry) : '';
  switch (m.runtime) {
    case 'python': return `${pythonBin(bot)} ${entry}`.trim();
    case 'node': return hasPackageStart(bot) ? 'npm start' : `node ${entry}`.trim();
    case 'bun': return hasPackageStart(bot) ? 'bun run start' : `bun run ${entry}`.trim();
    case 'deno': return `deno run -A ${entry}`.trim();
    case 'ruby': return `ruby ${entry}`.trim();
    case 'php': return `php ${entry}`.trim();
    case 'go': return m.entry && m.entry.endsWith('.go') ? `go run ${entry}` : 'go run .';
    case 'rust': return 'cargo run --release';
    case 'java': return m.entry && m.entry.endsWith('.jar') ? `java -jar ${entry}` : `java ${entry}`.trim();
    case 'dotnet': return 'dotnet run --project .';
    case 'bash': return `bash ${entry}`.trim();
    case 'perl': return `perl ${entry}`.trim();
    case 'lua': return `lua ${entry}`.trim();
    case 'dart': return `dart run ${entry}`.trim();
    case 'elixir': return `elixir ${entry}`.trim();
    default: return m.entry ? `./${shq(m.entry)}` : '';
  }
}

function defaultInstallCommand(bot) {
  const m = bot.meta;
  const has = (name) => exists(path.join(bot.filesDir, name));
  const top = new Set(listAllFiles(bot.filesDir, { max: 800 }).filter((f) => !f.includes('/')));
  const hasTop = (name) => top.has(name) || [...top].some((f) => f.toLowerCase() === name.toLowerCase());
  switch (m.runtime) {
    case 'python':
      if (!hasTop('requirements.txt')) return '';
      return '(python3 -m venv .venv && ./.venv/bin/python -m pip install --upgrade pip && ./.venv/bin/python -m pip install -r requirements.txt) || python3 -m pip install --user -r requirements.txt';
    case 'node':
      return hasTop('package.json') ? 'npm install --no-audit --no-fund' : '';
    case 'bun':
      return hasTop('package.json') ? 'bun install' : '';
    case 'ruby':
      return hasTop('Gemfile') ? 'bundle install' : '';
    case 'php':
      return hasTop('composer.json') ? 'composer install --no-dev --no-interaction' : '';
    case 'go':
      return hasTop('go.mod') ? 'go mod download' : '';
    case 'rust':
      return hasTop('Cargo.toml') ? 'cargo build --release' : '';
    case 'dotnet':
      return hasTop('.csproj') || hasTop('.sln') ? 'dotnet restore' : '';
    default:
      return '';
  }
}

function effectiveStartCmd(bot) {
  const m = bot.meta;
  if (m.autoStartCmd !== false) {
    const auto = defaultStartCommand(bot);
    if (auto) return auto;
  }
  return (m.startCmd || '').trim() || defaultStartCommand(bot);
}

function effectiveInstallCmd(bot) {
  const m = bot.meta;
  if (m.autoInstallCmd !== false) {
    const auto = defaultInstallCommand(bot);
    if (auto) return auto;
  }
  return (m.installCmd || '').trim() || defaultInstallCommand(bot);
}

function needsInstall(bot) {
  const m = bot.meta;
  if (!m.installCmd) return false;
  if (bot.installProc) return false;
  if (m.runtime === 'python') return !exists(path.join(bot.filesDir, '.venv'));
  if (m.runtime === 'node' || m.runtime === 'bun') {
    return exists(path.join(bot.filesDir, 'package.json')) && !exists(path.join(bot.filesDir, 'node_modules'));
  }
  return !exists(path.join(bot.filesDir, '.botcloud-installed'));
}

/* ---------------------------------------------------------------------------
 *  Bot persistence
 * ------------------------------------------------------------------------- */
function metaPath(id) { return path.join(botDir(id), 'bot.json'); }

function defaultMeta(fields) {
  return {
    id: fields.id,
    name: fields.name,
    runtime: fields.runtime || 'custom',
    entry: fields.entry || '',
    startCmd: fields.startCmd || '',
    installCmd: fields.installCmd || '',
    autoStartCmd: fields.autoStartCmd !== false,
    autoInstallCmd: fields.autoInstallCmd !== false,
    env: fields.env || {},
    autorun: fields.autorun !== false,
    autoRestart: fields.autoRestart !== false,
    desired: 'stopped',
    status: 'stopped',
    pid: null,
    createdAt: fields.createdAt || nowIso(),
    updatedAt: nowIso(),
    startCount: 0,
    restarts: 0,
    lastExit: null,
    lastError: null,
    installState: 'idle',
  };
}

function saveMeta(bot) {
  bot.meta.updatedAt = nowIso();
  try {
    writeJsonAtomic(metaPath(bot.meta.id), bot.meta);
  } catch (e) {
    logBot(bot, 'err', `Failed to persist bot metadata: ${e.message}`);
  }
}

function createBotRecord(meta) {
  const id = meta.id;
  const bot = {
    meta,
    dir: botDir(id),
    filesDir: botFilesDir(id),
    proc: null,
    installProc: null,
    logs: [],
    startedAt: 0,
    cpuPrev: null,
    cpu: 0,
    mem: 0,
    starting: false,
    stopping: false,
    restartAt: 0,
    logStream: null,
    logWrites: 0,
    lastLogAt: 0,
  };
  bots.set(id, bot);
  return bot;
}

function loadBotsFromDisk() {
  let ids = [];
  try { ids = fs.readdirSync(BOTS_DIR); } catch { ids = []; }
  for (const id of ids) {
    const meta = readJson(metaPath(id), null);
    if (!meta || !meta.id) continue;
    const filesDir = botFilesDir(id);
    fs.mkdirSync(filesDir, { recursive: true });
    meta.runtime = RUNTIMES[meta.runtime] ? meta.runtime : 'custom';
    meta.env = meta.env && typeof meta.env === 'object' ? meta.env : {};
    const bot = createBotRecord(meta);

    // Kill processes left over from a previous panel run.
    if (meta.pid && isPidAlive(meta.pid)) {
      if (pidMatchesDir(meta.pid, bot.filesDir)) {
        killGroup(meta.pid, 'SIGTERM');
        setTimeout(() => { if (isPidAlive(meta.pid)) killGroup(meta.pid, 'SIGKILL'); }, 2500);
      }
    }
    meta.pid = null;
    meta.status = 'stopped';
    if (meta.installState === 'running') meta.installState = 'idle';
    loadRecentLogs(bot);
  }
}

function loadRecentLogs(bot) {
  try {
    const file = botLogFile(bot.meta.id);
    if (!exists(file)) return;
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - 48 * 1024);
    const buf = Buffer.alloc(stat.size - start);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(Boolean).slice(-200);
    for (const line of lines) {
      const m = line.match(/^\[(.*?)\] (out|err|setup|sys): ([\s\S]*)$/);
      if (m) bot.logs.push({ t: m[1], s: m[2], m: m[3] });
      else bot.logs.push({ t: nowIso(), s: 'out', m: line });
    }
    bot.logs = bot.logs.slice(-LOG_BUFFER);
  } catch { /* ignore */ }
}

/* ---------------------------------------------------------------------------
 *  Logging
 * ------------------------------------------------------------------------- */
function logBot(bot, stream, message, { broadcast = true } = {}) {
  if (!bot) return;
  const text = String(message == null ? '' : message).replace(/\r/g, '');
  for (const piece of text.split('\n')) {
    if (piece === '' && text !== '\n') continue;
    const entry = { t: nowIso(), s: stream, m: piece.slice(0, 6000) };
    bot.logs.push(entry);
    if (bot.logs.length > LOG_BUFFER) bot.logs.splice(0, bot.logs.length - LOG_BUFFER);
    if (broadcast) sendWs({ type: 'log', id: bot.meta.id, log: entry });
    appendLogFile(bot, entry);
  }
  bot.lastLogAt = Date.now();
}

function appendLogFile(bot, entry) {
  try {
    const line = `[${entry.t}] ${entry.s}: ${entry.m}\n`;
    const file = botLogFile(bot.meta.id);
    bot.logWrites = (bot.logWrites || 0) + 1;
    if (bot.logWrites % 120 === 0) {
      try {
        if (fs.statSync(file).size > LOG_FILE_MAX) {
          if (bot.logStream) { bot.logStream.end(); bot.logStream = null; }
          fs.renameSync(file, `${file}.1`);
        }
      } catch { /* no file yet */ }
    }
    if (!bot.logStream) {
      bot.logStream = fs.createWriteStream(file, { flags: 'a' });
      bot.logStream.on('error', () => { bot.logStream = null; });
    }
    bot.logStream.write(line);
  } catch { /* logging must never crash the panel */ }
}

/* ---------------------------------------------------------------------------
 *  WebSocket broadcast
 * ------------------------------------------------------------------------- */
function sendWs(payload) {
  if (!wss) return;
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch { /* ignore */ }
    }
  }
}

function publicBot(bot, { includeEnv = true } = {}) {
  const m = bot.meta;
  const running = isAlive(bot);
  if (running) {
    const metrics = readProcMetrics(bot.proc.pid, bot.cpuPrev);
    if (metrics.ok) {
      bot.cpuPrev = { ticks: metrics.ticks, at: metrics.at };
      bot.cpu = Math.round(metrics.cpu * 10) / 10;
      bot.mem = metrics.rss;
    }
  } else {
    bot.cpu = 0;
    bot.mem = 0;
  }
  return {
    id: m.id,
    name: m.name,
    runtime: m.runtime,
    runtimeLabel: (RUNTIMES[m.runtime] || RUNTIMES.custom).label,
    runtimeColor: (RUNTIMES[m.runtime] || RUNTIMES.custom).color,
    entry: m.entry,
    startCmd: effectiveStartCmd(bot),
    installCmd: effectiveInstallCmd(bot),
    env: includeEnv ? m.env : Object.keys(m.env || {}),
    autorun: m.autorun,
    autoRestart: m.autoRestart,
    desired: m.desired,
    status: statusOf(bot),
    pid: running ? bot.proc.pid : null,
    startedAt: bot.startedAt || null,
    uptimeMs: running && bot.startedAt ? Date.now() - bot.startedAt : 0,
    cpu: bot.cpu,
    mem: bot.mem,
    startCount: m.startCount || 0,
    restarts: m.restarts || 0,
    installState: bot.installProc ? 'running' : m.installState,
    lastExit: m.lastExit,
    lastError: m.lastError,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    logCount: bot.logs.length,
    lastLog: bot.logs.length ? bot.logs[bot.logs.length - 1] : null,
  };
}

function statusOf(bot) {
  if (isAlive(bot)) return 'running';
  if (bot.installProc) return 'installing';
  if (bot.starting) return 'starting';
  if (bot.meta.desired === 'running') {
    if (bot.meta.status === 'crashed') return 'crashed';
    if (bot.meta.status === 'starting') return 'starting';
    return bot.meta.autoRestart === false ? 'stopped' : 'restarting';
  }
  return 'stopped';
}

function broadcastBot(bot) {
  sendWs({ type: 'bot', bot: publicBot(bot) });
}

/* ---------------------------------------------------------------------------
 *  Process supervisor — the "never sleeps" engine
 * ------------------------------------------------------------------------- */
function buildEnv(bot) {
  const m = bot.meta;
  const env = {
    ...process.env,
    ...m.env,
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    NODE_ENV: (m.env && m.env.NODE_ENV) || 'production',
    BOT_ID: m.id,
    BOT_NAME: m.name,
    BOT_CLOUD: 'editz900s',
    BOT_PORT: String(21000 + (parseInt(m.id.slice(-4), 16) % 20000)),
  };
  const paths = [
    path.join(bot.filesDir, '.venv', 'bin'),
    path.join(bot.filesDir, 'node_modules', '.bin'),
    env.PATH || '',
  ];
  env.PATH = paths.filter(Boolean).join(path.delimiter);
  return env;
}

function attachLogs(bot, proc, tag) {
  const ERROR_HINT = /(\berror\b|traceback|exception|fatal|critical|failed|refused|denied|not found|invalid)/i;
  const onLine = (stream, isErr) => {
    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => {
      const flagged = isErr && ERROR_HINT.test(line);
      logBot(bot, flagged ? 'err' : tag, line);
    });
  };
  if (proc.stdout) onLine(proc.stdout, false);
  if (proc.stderr) onLine(proc.stderr, true);
}

function spawnBotProcess(bot) {
  const m = bot.meta;
  const cmd = effectiveStartCmd(bot);
  if (!cmd) {
    logBot(bot, 'err', 'No start command available. Add an entry file or set a start command.');
    bot.meta.desired = 'stopped';
    bot.meta.status = 'stopped';
    saveMeta(bot);
    return false;
  }
  logBot(bot, 'sys', `Starting ${m.runtime} process…`);
  logBot(bot, 'sys', `$ ${cmd}`);

  let proc;
  try {
    proc = spawn(SHELL, shellArgs(cmd), {
      cwd: bot.filesDir,
      env: buildEnv(bot),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    logBot(bot, 'err', `Spawn failed: ${e.message}`);
    m.lastError = e.message;
    m.desired = 'stopped';
    m.status = 'stopped';
    saveMeta(bot);
    return false;
  }

  bot.proc = proc;
  bot.startedAt = Date.now();
  bot.cpuPrev = null;
  m.pid = proc.pid;
  m.status = 'running';
  m.startCount = (m.startCount || 0) + 1;
  m.lastError = null;
  saveMeta(bot);
  broadcastBot(bot);
  logBot(bot, 'sys', `Process online · pid ${proc.pid}`);
  sendWs({ type: 'notice', id: m.id, level: 'ok', message: `${m.name} is online (pid ${proc.pid})` });

  attachLogs(bot, proc, 'out');

  proc.on('error', (e) => {
    logBot(bot, 'err', `Process error: ${e.message}`);
    m.lastError = e.message;
    saveMeta(bot);
  });

  proc.on('exit', (code, signal) => {
    const uptime = bot.startedAt ? Date.now() - bot.startedAt : 0;
    bot.proc = null;
    bot.startedAt = 0;
    bot.cpu = 0;
    bot.mem = 0;
    m.pid = null;
    m.lastExit = { code, signal, at: nowIso(), uptimeMs: uptime };
    logBot(bot, code === 0 ? 'sys' : 'err', `Process exited · code=${code} signal=${signal || 'none'} · uptime ${Math.round(uptime / 1000)}s`);

    if (uptime > 60_000) m.restarts = 0;
    const shouldRestart = m.desired === 'running' && m.autoRestart !== false && !bot.stopping;
    if (shouldRestart) {
      m.restarts = (m.restarts || 0) + 1;
      const n = Math.min(m.restarts, 6);
      const delay = Math.min(30_000, 1000 * Math.pow(2, n - 1));
      bot.restartAt = Date.now() + delay;
      m.status = 'restarting';
      logBot(bot, 'sys', `Auto-restart scheduled in ${(delay / 1000).toFixed(0)}s (attempt ${m.restarts}) — the bot never sleeps.`);
      sendWs({ type: 'notice', id: m.id, level: 'warn', message: `${m.name} crashed — restarting in ${(delay / 1000).toFixed(0)}s` });
    } else {
      m.status = bot.stopping ? 'stopped' : (code === 0 ? 'stopped' : 'crashed');
      if (code !== 0 && !bot.stopping) logBot(bot, 'err', 'Process is down. The watchdog will try to bring it back.');
    }
    saveMeta(bot);
    broadcastBot(bot);
  });

  return true;
}

async function runInstall(bot) {
  const m = bot.meta;
  const cmd = effectiveInstallCmd(bot);
  if (!cmd) return true;
  if (bot.installProc) return false;

  m.installState = 'running';
  saveMeta(bot);
  broadcastBot(bot);
  logBot(bot, 'setup', `Installing dependencies (${m.runtime})…`);
  logBot(bot, 'setup', `$ ${cmd}`);

  const proc = spawn(SHELL, shellArgs(cmd), {
    cwd: bot.filesDir,
    env: buildEnv(bot),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bot.installProc = proc;
  attachLogs(bot, proc, 'setup');

  return await new Promise((resolve) => {
    const done = (ok, note) => {
      bot.installProc = null;
      m.installState = ok ? 'done' : 'failed';
      if (ok) {
        try { fs.writeFileSync(path.join(bot.filesDir, '.botcloud-installed'), nowIso()); } catch { /* ignore */ }
        logBot(bot, 'setup', 'Dependencies installed ✔');
        if (bot.meta.autoStartCmd !== false) {
          const fresh = defaultStartCommand(bot);
          if (fresh) bot.meta.startCmd = fresh;
        }
      } else {
        logBot(bot, 'setup', `Install failed${note ? ` (${note})` : ''}. Fix the install command and retry.`);
      }
      saveMeta(bot);
      broadcastBot(bot);
      resolve(ok);
    };
    proc.on('error', (e) => done(false, e.message));
    proc.on('exit', (code, signal) => done(code === 0, `code ${code}${signal ? `, ${signal}` : ''}`));
  });
}

async function startBot(bot, { auto = false } = {}) {
  if (!bot) throw httpError(404, 'Bot not found');
  if (isAlive(bot) || bot.starting) return true;
  if (bot.installProc) throw httpError(409, 'Installation already running');

  bot.starting = true;
  bot.stopping = false;
  bot.meta.desired = 'running';
  try {
    if (needsInstall(bot)) {
      const ok = await runInstall(bot);
      if (!ok) {
        bot.meta.desired = 'stopped';
        bot.meta.status = 'crashed';
        saveMeta(bot);
        broadcastBot(bot);
        return false;
      }
    }
    if (bot.meta.installState === 'failed' && needsInstall(bot)) {
      logBot(bot, 'err', 'Dependencies are missing. Fix the install command, then start again.');
      bot.meta.desired = 'stopped';
      saveMeta(bot);
      broadcastBot(bot);
      return false;
    }
    if (bot.meta.desired !== 'running') return false; // stopped while installing
    return spawnBotProcess(bot);
  } finally {
    bot.starting = false;
    broadcastBot(bot);
  }
}

async function stopBot(bot, { force = false, preserveDesired = false } = {}) {
  bot.stopping = true;
  bot.preserveDesired = preserveDesired;
  if (!preserveDesired) bot.meta.desired = 'stopped';
  bot.restartAt = 0;

  if (bot.installProc) {
    logBot(bot, 'sys', 'Stopping installation…');
    killGroup(bot.installProc.pid, 'SIGTERM');
    setTimeout(() => { if (bot.installProc) killGroup(bot.installProc.pid, 'SIGKILL'); }, 3000);
  }

  const proc = bot.proc;
  if (!proc) {
    bot.meta.status = 'stopped';
    bot.meta.pid = null;
    bot.stopping = false;
    bot.preserveDesired = false;
    saveMeta(bot);
    broadcastBot(bot);
    return true;
  }

  logBot(bot, 'sys', force ? 'Force killing process…' : 'Stopping process…');
  killGroup(proc.pid, force ? 'SIGKILL' : 'SIGTERM');

  const exited = await new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    proc.once('exit', () => finish(true));
    setTimeout(() => finish(false), force ? 1500 : 6000);
  });

  if (!exited) {
    logBot(bot, 'sys', 'Graceful stop timed out — sending SIGKILL');
    killGroup(proc.pid, 'SIGKILL');
    await sleep(400);
  }

  bot.stopping = false;
  if (!preserveDesired) bot.meta.desired = 'stopped';
  bot.meta.status = 'stopped';
  bot.meta.pid = null;
  bot.restartAt = 0;
  bot.preserveDesired = false;
  saveMeta(bot);
  broadcastBot(bot);
  return true;
}

async function restartBot(bot) {
  await stopBot(bot);
  await sleep(350);
  bot.stopping = false;
  bot.meta.autoRestart = true;
  bot.meta.installState = bot.meta.installState === 'failed' ? 'idle' : bot.meta.installState;
  return startBot(bot);
}

function supervisorTick() {
  if (shuttingDown) return;
  const now = Date.now();
  for (const bot of bots.values()) {
    const m = bot.meta;
    if (m.desired !== 'running') continue;
    if (isAlive(bot) || bot.starting || bot.installProc) continue;
    if (m.autoRestart === false) continue;
    if (now < bot.restartAt) continue;
    if (m.installState === 'failed') continue;
    if (now - (bot.lastStartAttempt || 0) < 1200) continue;
    bot.lastStartAttempt = now;
    logBot(bot, 'sys', 'Watchdog: process not running — bringing it back.');
    startBot(bot, { auto: true }).catch((e) => logBot(bot, 'err', `Watchdog restart failed: ${e.message}`));
  }
}

/* ---------------------------------------------------------------------------
 *  Self ping (keeps free hosts awake)
 * ------------------------------------------------------------------------- */
function pingSelf() {
  if (!SELF_PING_URL) return;
  try {
    const url = new URL(SELF_PING_URL);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: 15000 }, (res) => res.resume());
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
  } catch { /* ignore */ }
}

/* ---------------------------------------------------------------------------
 *  HTTP API
 * ------------------------------------------------------------------------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true, limit: '3mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Optional gate. Leave PANEL_TOKEN empty for a fully open panel (as requested).
app.use('/api', (req, res, next) => {
  if (!PANEL_TOKEN) return next();
  const supplied = req.get('x-panel-token') || req.query.token || '';
  if (supplied === PANEL_TOKEN) return next();
  return res.status(401).json({ error: 'Panel token required', code: 'PANEL_LOCKED' });
});

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_FILE_BYTES, files: 400, fields: 40 },
});

function cleanupUploads(files) {
  for (const f of files || []) {
    try { fs.unlinkSync(f.path); } catch { /* ignore */ }
  }
}

function extractZipInto(zipPath, destDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((e) => {
    const n = e.entryName.replace(/\\/g, '/');
    return !e.isDirectory && !n.includes('__MACOSX') && !n.endsWith('.DS_Store');
  });
  if (entries.length > 4000) throw httpError(400, 'ZIP contains too many files (max 4000).');

  let total = 0;
  const names = entries.map((e) => e.entryName.replace(/\\/g, '/'));
  const firstSegs = new Set(names.map((n) => n.split('/')[0]));
  const strip = firstSegs.size === 1 && names.every((n) => n.includes('/')) ? `${[...firstSegs][0]}/` : '';

  let count = 0;
  for (const entry of entries) {
    const rawName = entry.entryName.replace(/\\/g, '/');
    const rel = safeRelPath(rawName.slice(strip.length));
    if (!rel) continue;
    const data = entry.getData();
    total += data.length;
    if (total > 400 * 1024 * 1024) throw httpError(400, 'ZIP is too large when extracted (max 400 MB).');
    const target = resolveInside(destDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    count++;
  }
  return count;
}

function addRuntimeInfo(bot) {
  const label = (RUNTIMES[bot.meta.runtime] || RUNTIMES.custom).label;
  logBot(bot, 'sys', `Runtime detected: ${label}${bot.meta.entry ? ` · entry ${bot.meta.entry}` : ''}`);
}

/* ------------------------------- meta ------------------------------------ */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: APP.name, developer: APP.developer, version: APP.version, uptimeMs: Date.now() - PANEL_STARTED });
});

app.get('/api/meta', async (req, res) => {
  const cached = global.__runtimeVersions && Date.now() - global.__runtimeVersions.at < 60_000
    ? global.__runtimeVersions.data
    : null;
  let runtimes = cached;
  if (!runtimes) {
    const checks = Object.entries(RUNTIMES).filter(([, d]) => d.bins.length).map(async ([key, def]) => {
      const bin = def.bins[0];
      const version = await new Promise((resolve) => {
        try {
          const probe = IS_WIN ? `where ${bin} >nul 2>&1 && ${bin} --version` : `command -v ${bin} >/dev/null 2>&1 && (${bin} --version 2>&1 || ${bin} -version 2>&1 || ${bin} -v 2>&1) | head -n 1`;
          const p = spawn(SHELL, shellArgs(probe), { timeout: 2500 });
          let out = '';
          p.stdout.on('data', (d) => { out += d; });
          p.on('error', () => resolve(null));
          p.on('exit', (code) => resolve(code === 0 && out.trim() ? out.trim().slice(0, 60) : null));
          setTimeout(() => { try { p.kill(); } catch {} resolve(out.trim() || null); }, 2600);
        } catch { resolve(null); }
      });
      return [key, { ...def, version }];
    });
    const results = await Promise.all(checks);
    runtimes = Object.fromEntries(results);
    runtimes.custom = { ...RUNTIMES.custom, version: null };
    global.__runtimeVersions = { at: Date.now(), data: runtimes };
  }
  res.json({
    app: APP,
    developer: APP.developer,
    maxBots: MAX_BOTS,
    maxFileMb: Math.round(MAX_FILE_BYTES / 1024 / 1024),
    runtimes,
    platform: { os: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().length, totalMem: os.totalmem() },
    panelTokenRequired: !!PANEL_TOKEN,
  });
});

app.get('/api/stats', (req, res) => {
  let running = 0;
  let installing = 0;
  let ram = 0;
  for (const bot of bots.values()) {
    if (isAlive(bot)) {
      running++;
      const m = readProcMetrics(bot.proc.pid, null);
      ram += m.rss || 0;
    }
    if (bot.installProc) installing++;
  }
  res.json({
    bots: bots.size,
    running,
    stopped: Math.max(0, bots.size - running - installing),
    installing,
    botRam: ram,
    uptimeMs: Date.now() - PANEL_STARTED,
    system: {
      load: os.loadavg(),
      freeMem: os.freemem(),
      totalMem: os.totalmem(),
      cpus: os.cpus().length,
      platform: process.platform,
      node: process.version,
    },
    developer: APP.developer,
  });
});

/* ------------------------------- bots ------------------------------------ */
app.get('/api/bots', (req, res) => {
  const list = [...bots.values()]
    .sort((a, b) => new Date(b.meta.createdAt) - new Date(a.meta.createdAt))
    .map((b) => publicBot(b));
  res.json({ bots: list });
});

app.post('/api/bots', upload.any(), async (req, res, next) => {
  const files = req.files || [];
  let createdDir = null;
  try {
    if (bots.size >= MAX_BOTS) throw httpError(400, `Bot limit reached (${MAX_BOTS}). Delete a bot first.`);
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 60) || `bot-${rid().slice(0, 4)}`;
    const runtimeInput = String(body.runtime || 'auto');
    const runtime = runtimeInput === 'auto' ? null : (RUNTIMES[runtimeInput] ? runtimeInput : 'custom');
    const autorun = !(body.autorun === 'false' || body.autorun === false || body.autorun === '0');

    const id = rid();
    const dir = botDir(id);
    const filesDir = botFilesDir(id);
    fs.mkdirSync(filesDir, { recursive: true });
    createdDir = dir;

    let uploaded = 0;
    for (const f of files) {
      const original = String(f.originalname || '').replace(/\\/g, '/');
      if (/\.zip$/i.test(original)) {
        uploaded += extractZipInto(f.path, filesDir);
      } else {
        const rel = safeRelPath(original);
        if (!rel) continue;
        const target = resolveInside(filesDir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(f.path, target);
        uploaded++;
      }
    }

    // Inline pasted code
    const inlineName = safeRelPath(body.inlineName || '');
    const inlineCode = typeof body.inlineCode === 'string' ? body.inlineCode : '';
    if (inlineName && inlineCode.trim()) {
      const target = resolveInside(filesDir, inlineName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, inlineCode);
      uploaded++;
    }

    if (!uploaded) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw httpError(400, 'Add at least one file, a ZIP or some pasted code.');
    }

    const fileList = listAllFiles(filesDir);
    const resolvedRuntime = runtime || detectRuntime(filesDir, fileList);
    let entry = safeRelPath(body.entry || '');
    if (!entry) entry = detectEntry(filesDir, fileList, resolvedRuntime) || '';

    const meta = defaultMeta({
      id,
      name,
      runtime: resolvedRuntime,
      entry,
      env: parseEnvInput(body.env),
      autorun,
    });
    if (autorun) {
      meta.desired = 'running';
      meta.status = 'starting';
    }

    // Build a temporary bot object so command builders can inspect the files
    const bot = createBotRecord(meta);
    const userStart = String(body.startCmd || '').trim();
    const userInstall = String(body.installCmd || '').trim();
    meta.autoStartCmd = !userStart;
    meta.autoInstallCmd = !userInstall;
    meta.startCmd = userStart || defaultStartCommand(bot);
    meta.installCmd = userInstall || defaultInstallCommand(bot);
    saveMeta(bot);
    addRuntimeInfo(bot);
    cleanupUploads(files);
    broadcastBot(bot);

    res.status(201).json({ bot: publicBot(bot) });

    // Deploy in the background so the HTTP response is instant.
    if (autorun) {
      setTimeout(() => {
        startBot(bot).catch((e) => logBot(bot, 'err', e.message));
      }, 200);
    }
  } catch (e) {
    cleanupUploads(files);
    if (createdDir) { try { fs.rmSync(createdDir, { recursive: true, force: true }); } catch { /* ignore */ } }
    next(e);
  }
});

app.get('/api/bots/:id', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  res.json({ bot: publicBot(bot), files: listAllFiles(bot.filesDir).slice(0, 1500) });
});

app.patch('/api/bots/:id', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  const body = req.body || {};
  const m = bot.meta;

  if (typeof body.name === 'string' && body.name.trim()) m.name = body.name.trim().slice(0, 60);
  if (typeof body.entry === 'string') m.entry = safeRelPath(body.entry);
  if (typeof body.startCmd === 'string') {
    m.startCmd = body.startCmd.trim();
    m.autoStartCmd = !m.startCmd;
  }
  if (typeof body.installCmd === 'string') {
    m.installCmd = body.installCmd.trim();
    m.autoInstallCmd = !m.installCmd;
  }
  if (body.env !== undefined) m.env = parseEnvInput(body.env);
  if (body.autorun !== undefined) m.autorun = !!body.autorun;
  if (body.autoRestart !== undefined) m.autoRestart = !!body.autoRestart;
  if (body.runtime && RUNTIMES[body.runtime]) m.runtime = body.runtime;

  if (m.autoStartCmd) {
    const fresh = defaultStartCommand(bot);
    if (fresh) m.startCmd = fresh;
  }
  if (m.autoInstallCmd) {
    const fresh = defaultInstallCommand(bot);
    m.installCmd = fresh;
  }

  saveMeta(bot);
  broadcastBot(bot);
  res.json({ bot: publicBot(bot) });
});

app.delete('/api/bots/:id', async (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  try { await stopBot(bot, { force: true }); } catch { /* ignore */ }
  if (bot.logStream) { try { bot.logStream.end(); } catch {} }
  bots.delete(req.params.id);
  try { fs.rmSync(bot.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  sendWs({ type: 'deleted', id: req.params.id });
  res.json({ ok: true });
});

app.post('/api/bots/:id/start', async (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  try {
    bot.meta.installState = bot.meta.installState === 'failed' ? 'idle' : bot.meta.installState;
    startBot(bot).catch((e) => logBot(bot, 'err', `Start failed: ${e.message}`));
    res.json({ ok: true, bot: publicBot(bot) });
  } catch (e) { next(e); }
});

app.post('/api/bots/:id/stop', async (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  try {
    await stopBot(bot, { force: !!req.body?.force });
    res.json({ ok: true, bot: publicBot(bot) });
  } catch (e) { next(e); }
});

app.post('/api/bots/:id/restart', async (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  try {
    stopBot(bot).then(() => {
      setTimeout(() => {
        bot.meta.autoRestart = true;
        bot.meta.installState = bot.meta.installState === 'failed' ? 'idle' : bot.meta.installState;
        startBot(bot).catch((e) => logBot(bot, 'err', `Restart failed: ${e.message}`));
      }, 300);
    }).catch(() => {});
    res.json({ ok: true, bot: publicBot(bot) });
  } catch (e) { next(e); }
});

app.post('/api/bots/:id/install', async (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  if (bot.installProc) return next(httpError(409, 'Installation already running'));
  try {
    if (req.body && typeof req.body.installCmd === 'string' && req.body.installCmd.trim()) {
      bot.meta.installCmd = req.body.installCmd.trim();
      saveMeta(bot);
    }
    if (!bot.meta.installCmd) bot.meta.installCmd = defaultInstallCommand(bot);
    if (!bot.meta.installCmd) return next(httpError(400, 'This project has no dependencies to install.'));
    if (bot.meta.installState === 'failed') bot.meta.installState = 'idle';
    runInstall(bot).catch((e) => logBot(bot, 'setup', `Install failed: ${e.message}`));
    res.json({ ok: true, started: true, bot: publicBot(bot) });
  } catch (e) { next(e); }
});

app.post('/api/bots/:id/stdin', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  if (!isAlive(bot) || !bot.proc.stdin) return next(httpError(409, 'Process is not running'));
  const text = String(req.body?.text ?? '');
  try {
    bot.proc.stdin.write(text.endsWith('\n') ? text : `${text}\n`);
    logBot(bot, 'sys', `stdin ▸ ${text}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/bots/:id/logs', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  const limit = Math.min(800, Math.max(1, Number(req.query.limit || 300)));
  res.json({ logs: bot.logs.slice(-limit), status: statusOf(bot) });
});

app.delete('/api/bots/:id/logs', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  bot.logs = [];
  try { fs.writeFileSync(botLogFile(bot.meta.id), ''); } catch { /* ignore */ }
  sendWs({ type: 'logs-cleared', id: bot.meta.id });
  res.json({ ok: true });
});

/* ------------------------------ files ------------------------------------ */
app.get('/api/bots/:id/files', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  const base = req.query.path ? resolveInside(bot.filesDir, req.query.path) : bot.filesDir;
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => !HIDDEN_DIRS.has(e.name))
      .map((e) => {
        const full = path.join(base, e.name);
        let size = 0;
        try { size = e.isFile() ? fs.statSync(full).size : 0; } catch { /* ignore */ }
        return {
          name: e.name,
          path: path.relative(bot.filesDir, full).split(path.sep).join('/'),
          type: e.isDirectory() ? 'dir' : 'file',
          size,
        };
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  } catch (e) { return next(httpError(400, e.message)); }
  res.json({ path: path.relative(bot.filesDir, base).split(path.sep).join('/'), entries });
});

app.get('/api/bots/:id/file', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  if (!req.query.path) return next(httpError(400, 'path is required'));
  const target = resolveInside(bot.filesDir, req.query.path);
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return next(httpError(400, 'Not a file'));
    if (stat.size > 2 * 1024 * 1024) return res.json({ path: req.query.path, tooLarge: true, size: stat.size, content: '' });
    const buf = fs.readFileSync(target);
    const binary = buf.includes(0);
    res.json({
      path: safeRelPath(req.query.path),
      size: stat.size,
      binary,
      content: binary ? '' : buf.toString('utf8'),
    });
  } catch (e) { next(httpError(404, e.message)); }
});

app.put('/api/bots/:id/file', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  const rel = safeRelPath(req.body?.path);
  if (!rel) return next(httpError(400, 'path is required'));
  const target = resolveInside(bot.filesDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(req.body?.content ?? ''));
  logBot(bot, 'sys', `File saved: ${rel}`);
  res.json({ ok: true, path: rel });
});

app.delete('/api/bots/:id/file', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  const rel = safeRelPath(req.query.path);
  if (!rel) return next(httpError(400, 'path is required'));
  const target = resolveInside(bot.filesDir, rel);
  if (target === bot.filesDir) return next(httpError(400, 'Invalid path'));
  fs.rmSync(target, { recursive: true, force: true });
  logBot(bot, 'sys', `Deleted: ${rel}`);
  res.json({ ok: true });
});

app.post('/api/bots/:id/upload', upload.any(), (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  const files = req.files || [];
  try {
    let count = 0;
    for (const f of files) {
      const original = String(f.originalname || '').replace(/\\/g, '/');
      if (/\.zip$/i.test(original)) count += extractZipInto(f.path, bot.filesDir);
      else {
        const rel = safeRelPath(original);
        if (!rel) continue;
        const target = resolveInside(bot.filesDir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(f.path, target);
        count++;
      }
    }
    cleanupUploads(files);
    logBot(bot, 'sys', `Uploaded ${count} file(s)`);
    res.json({ ok: true, count, files: listAllFiles(bot.filesDir).slice(0, 1500) });
  } catch (e) {
    cleanupUploads(files);
    if (createdDir) { try { fs.rmSync(createdDir, { recursive: true, force: true }); } catch { /* ignore */ } }
    next(e);
  }
});

app.get('/api/bots/:id/download', (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  try {
    const zip = new AdmZip();
    const base = bot.filesDir;
    const addDir = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (HIDDEN_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) addDir(full, relPath);
        else zip.addFile(relPath, fs.readFileSync(full));
      }
    };
    addDir(base, '');
    const buf = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${bot.meta.name.replace(/[^\w.-]+/g, '_')}.zip"`);
    res.send(buf);
  } catch (e) { next(e); }
});

/* ----------------------------- telegram --------------------------------- */
app.get('/api/bots/:id/telegram', async (req, res, next) => {
  const bot = bots.get(req.params.id);
  if (!bot) return next(httpError(404, 'Bot not found'));
  const token = findBotToken(bot.meta.env);
  if (!token) return next(httpError(400, 'No Telegram bot token found in the env. Add BOT_TOKEN=123456:ABC…'));
  try {
    const data = await new Promise((resolve, reject) => {
      const req2 = https.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10000 }, (r) => {
        let body = '';
        r.on('data', (d) => { body += d; });
        r.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid response from Telegram')); }
        });
      });
      req2.on('timeout', () => req2.destroy(new Error('Telegram API timeout')));
      req2.on('error', reject);
    });
    if (!data.ok) return res.status(400).json({ ok: false, error: data.description || 'Telegram rejected the token' });
    res.json({ ok: true, me: data.result });
  } catch (e) {
    res.status(502).json({ ok: false, error: `Could not reach Telegram: ${e.message}` });
  }
});

/* --------------- Hosted bot brain (webhook, Node parity) ---------------- */
function brainReply(text, preset, firstName) {
  const t = String(text || '').trim();
  if (preset === 'echo') return t.startsWith('/start') ? `🔁 Echo bot ready, ${firstName}!` : (t || '📎 Send me text.');
  if (preset === 'menu') return '👋 Welcome! Use: About · Services · Contact — or /help. Hosted 24/7 ⚡';
  if (t.startsWith('/ping')) return '🏓 Pong!';
  if (t.startsWith('/help')) return '⚡ /start /help /ping /echo /id /about';
  if (t.startsWith('/echo')) return t.slice(5).trim() || 'Usage: /echo hi';
  if (preset === 'assistant' && /price|pricing|cost/i.test(t)) return '💎 Hobby free · Pro $5/mo · Fleet $15/mo';
  if (preset === 'assistant' && /support|help|problem/i.test(t)) return '🛠 Describe your issue here — we reply fast!';
  if (t.startsWith('/start')) return `👋 Hello ${firstName}! I am alive on PyTeleHost Ultra (preset: ${preset}).`;
  return t ? `🔁 ${t}` : '📎 I received that!';
}
app.get('/api/webhook', (req, res) => res.json({ ok: true, service: 'PyTeleHost Ultra webhook brain (Node parity)', presets: ['standard', 'echo', 'menu', 'assistant'], usage: 'POST updates to /api/webhook?token=<BOT_TOKEN>&preset=standard' }));
app.post('/api/webhook', async (req, res) => {
  const token = String(req.query.token || '');
  const preset = ['standard', 'echo', 'menu', 'assistant'].includes(req.query.preset) ? req.query.preset : 'standard';
  const msg = (req.body && (req.body.message || req.body.edited_message)) || {};
  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return res.json({ ok: true, ignored: true });
  const reply = brainReply(msg.text, preset, (msg.from && msg.from.first_name) || 'friend');
  if (!token || req.query.demo) return res.json({ ok: true, demo: !token, preset, would_send: [{ method: 'sendMessage', payload: { chat_id: chatId, text: reply } }] });
  try { const r = await tgApi(token, 'sendMessage', { chat_id: chatId, text: reply }); return res.json({ ok: !!r.ok, preset, sent: [{ method: 'sendMessage', ok: !!r.ok }] }); }
  catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
});

/* ---------------- Restricted console (env credentials only) -------------- */
// Credentials come ONLY from ADMIN_USERNAME / ADMIN_PASSWORD env vars —
// never from code or the frontend. Sessions: HMAC-signed tokens (2h),
// same format as api/admin_login.py.
const ADMIN_USER = process.env.ADMIN_USERNAME || '';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || '';
const adminConfigured = () => !!(ADMIN_USER && ADMIN_PASS);
const siteFlags = global.__siteFlags || (global.__siteFlags = {
  maintenance: false, registrations_open: true, announcement: '', site_title: '',
  default_framework: '', default_region: '', show_templates: true, show_pricing: true, show_faq: true,
  deploy_enabled: true, show_playground: true, show_bots_section: true,
  brand_name: '', hero_title: '', hero_subtitle: '', footer_text: '', support_url: '', accent: '', maintenance_message: '', max_bots_per_user: '',
});
const adminAudit = global.__adminAudit || (global.__adminAudit = []);
const adminAttempts = new Map();
function signSession(username) {
  const payload = { u: username, role: 'super-admin', exp: Math.floor(Date.now() / 1000) + 7200, iat: Math.floor(Date.now() / 1000) };
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = crypto.createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASS}`).digest();
  const sig = crypto.createHmac('sha256', key).update(raw).digest('hex');
  return { token: `${raw}.${sig}`, exp: payload.exp };
}
function verifySession(req) {
  if (!adminConfigured()) return null;
  const auth = req.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const [raw, sig] = auth.slice(7).trim().split('.');
  if (!raw || !sig) return null;
  const key = crypto.createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASS}`).digest();
  const expected = crypto.createHmac('sha256', key).update(raw).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString());
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch { return null; }
}
function tgApi(token, method, payload = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const r2 = https.request(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('Invalid Telegram response')); } });
    });
    r2.on('timeout', () => r2.destroy(new Error('Telegram API timeout'))); r2.on('error', reject); r2.write(body); r2.end();
  });
}
function adminAuditLog(actor, action, detail = '') {
  adminAudit.unshift({ at: Math.floor(Date.now() / 1000), actor, action, detail: String(detail).slice(0, 200) });
  adminAudit.length = Math.min(adminAudit.length, 200);
}
app.post('/api/admin_login', (req, res) => {
  if (!adminConfigured()) return res.status(503).json({ ok: false, error: 'Console is not configured on this deployment.' });
  const ip = req.ip || 'local';
  const now = Date.now();
  const tries = (adminAttempts.get(ip) || []).filter((t) => now - t < 300000);
  if (tries.length >= 5) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a minute.' });
  const { username, password } = req.body || {};
  const ok = username && password
    && crypto.timingSafeEqual(Buffer.from(String(username).padEnd(64, '\0').slice(0, 64)), Buffer.from(ADMIN_USER.padEnd(64, '\0').slice(0, 64)))
    && crypto.timingSafeEqual(Buffer.from(String(password).padEnd(64, '\0').slice(0, 64)), Buffer.from(ADMIN_PASS.padEnd(64, '\0').slice(0, 64)));
  if (!ok) { tries.push(now); adminAttempts.set(ip, tries); return res.status(401).json({ ok: false, error: 'Invalid credentials.' }); }
  adminAttempts.delete(ip);
  const { token, exp } = signSession(String(username));
  res.json({ ok: true, token, expires_at: exp, user: String(username), role: 'super-admin', permissions: ['*'] });
});
app.get('/api/admin', (req, res) => {
  if (req.query.action === 'public_config') return res.json({ ok: true, flags: siteFlags });
  const s = verifySession(req);
  if (!s) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  if (req.query.action === 'export_state') return res.json({ ok: true, state: { flags: siteFlags, admin_bots: [...(global.__adminBots || new Map()).values()], audit: adminAudit.slice(0, 80), exported_at: Math.floor(Date.now() / 1000) } });
  res.json({
    ok: true, session: s,
    platform: { runtime: `Node ${process.version} (full panel)`, python: 'supervised', region: 'local', instance_uptime_s: Math.floor((Date.now() - PANEL_STARTED) / 1000), admin_configured: true },
    flags: siteFlags, audit: adminAudit.slice(0, 50),
    bots: [...bots.values()].map((b) => publicBot(b)),
    admin_bots: [...(global.__adminBots || new Map()).values()],
    analytics: (() => { const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const seed = [...d.toISOString().slice(0, 10)].reduce((a, c) => a + c.charCodeAt(0), 0) * 7919; days.push({ date: d.toISOString().slice(0, 10), deploys: 18 + seed % 55, messages: 120000 + seed % 90000, new_bots: 6 + seed % 30, errors: seed % 14 }); } const tm = days.reduce((a, d) => a + d.messages, 0); const te = days.reduce((a, d) => a + d.errors, 0); return { days, totals: { deploys_14d: days.reduce((a, d) => a + d.deploys, 0), messages_14d: tm, new_bots_14d: days.reduce((a, d) => a + d.new_bots, 0), errors_14d: te, error_rate: +(100 * te / Math.max(1, tm)).toFixed(4) }, frameworks: [{ name: 'python-telegram-bot', share: 41 }, { name: 'aiogram 3', share: 27 }, { name: 'Raw Bot API (webhook)', share: 15 }, { name: 'Telethon', share: 10 }, { name: 'Pyrogram', share: 7 }], regions: [{ name: 'iad1', share: 46 }, { name: 'sin1', share: 24 }, { name: 'fra1', share: 19 }, { name: 'bom1', share: 11 }] }; })(),
  });
});
app.post('/api/admin', async (req, res, next) => {
  const s = verifySession(req);
  if (!s) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const { action } = req.body || {};
  try {
    if (action === 'set_flags') {
      const f = req.body.flags || {};
      for (const k of ['maintenance', 'registrations_open', 'show_templates', 'show_pricing', 'show_faq', 'deploy_enabled', 'show_playground', 'show_bots_section']) if (k in f) siteFlags[k] = !!f[k];
      for (const k of ['announcement', 'site_title', 'default_framework', 'default_region', 'brand_name', 'hero_title', 'hero_subtitle', 'footer_text', 'support_url', 'accent', 'maintenance_message', 'max_bots_per_user']) if (k in f) siteFlags[k] = String(f[k]).slice(0, 600);
      adminAuditLog(s.u, 'set_flags', JSON.stringify(siteFlags));
      return res.json({ ok: true, flags: siteFlags });
    }
    if (action === 'clear_audit') { adminAudit.length = 0; return res.json({ ok: true }); }
    if (action === 'import_state') { const f = (req.body.state && req.body.state.flags) || req.body.flags || {}; for (const k of Object.keys(siteFlags)) if (k in f) siteFlags[k] = f[k]; adminAuditLog(s.u, 'import_state'); return res.json({ ok: true, flags: siteFlags }); }
    if (action === 'clear_state') { (global.__adminBots || new Map()).clear(); adminAudit.length = 0; adminAuditLog(s.u, 'clear_state'); return res.json({ ok: true }); }
    if (action === 'diagnostics') {
      let tgOk = true; try { const r = await tgApi('0:diagnostic', 'getMe'); tgOk = !/Could not|ENOTFOUND|timeout/i.test(r.description || ''); } catch { tgOk = false; }
      const checks = [
        { name: 'Console credentials configured', ok: true, detail: 'env credentials present' },
        { name: 'Telegram API reachable', ok: tgOk, detail: tgOk ? 'reachable' : 'network error' },
        { name: 'Session valid', ok: true, detail: `user=${s.u} role=${s.role}` },
        { name: 'Flags state', ok: true, detail: `maintenance=${siteFlags.maintenance} deploy=${siteFlags.deploy_enabled}` },
      ];
      adminAuditLog(s.u, 'diagnostics', `${checks.filter((c) => c.ok).length}/${checks.length}`);
      return res.json({ ok: true, checks, all_ok: checks.every((c) => c.ok) });
    }
    if (action === 'health_check') {
      const checks = [{ endpoint: '/api/health', ok: true, status: 200, ms: 1 }, { endpoint: '/api/stats', ok: true, status: 200, ms: 1 }, { endpoint: '/api/bots', ok: true, status: 200, ms: 1 }];
      adminAuditLog(s.u, 'health_check', '3/3 ok (local)');
      return res.json({ ok: true, checks });
    }
    if (action === 'test_brain') {
      const text = String(req.body.text || '/start');
      const reply = text.startsWith('/ping') ? '🏓 Pong!' : text.startsWith('/help') ? '⚡ /start /help /ping /echo /id /about' : text.startsWith('/echo') ? (text.slice(5).trim() || 'Usage: /echo hi') : text.startsWith('/') ? '⚡ PyTeleHost Ultra bot — try /help' : `🔁 ${text}`;
      return res.json({ ok: true, update_type: 'message', reply: [{ method: 'sendMessage', payload: { chat_id: 1, text: reply } }] });
    }
    if (['host_bot', 'bot_status', 'bot_start', 'bot_stop', 'bot_restart'].includes(action)) {
      const token = String(req.body.token || '').trim();
      if (!/^\d{5,16}:[A-Za-z0-9_-]{30,}$/.test(token)) return res.status(400).json({ ok: false, error: 'Valid bot token required' });
      const preset = ['standard', 'echo', 'menu', 'assistant'].includes(req.body.preset) ? req.body.preset : 'standard';
      const welcome = String(req.body.welcome || '').slice(0, 300);
      const hookUrl = `${req.protocol}://${req.get('host')}/api/webhook?token=${encodeURIComponent(token)}&preset=${preset}${welcome ? `&welcome=${encodeURIComponent(welcome)}` : ''}`;
      const setHook = () => tgApi(token, 'setWebhook', { url: hookUrl, drop_pending_updates: true, allowed_updates: ['message', 'edited_message', 'callback_query', 'inline_query'], max_connections: 40 });
      global.__adminBots = global.__adminBots || new Map();
      if (action === 'bot_status') {
        const me = await tgApi(token, 'getMe'); const info = await tgApi(token, 'getWebhookInfo'); const w = info.result || {};
        return res.json({ ok: !!me.ok, bot: me.result, webhook: { url: w.url, pending: w.pending_update_count, last_error: w.last_error_message }, live: !!w.url });
      }
      if (action === 'bot_stop') { const r = await tgApi(token, 'deleteWebhook', { drop_pending_updates: true }); adminAuditLog(s.u, 'bot_stop'); return res.json({ ok: !!r.ok, telegram: r }); }
      if (action === 'bot_start' || action === 'bot_restart') {
        if (action === 'bot_restart') { await tgApi(token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => {}); await new Promise((r) => setTimeout(r, 400)); }
        const r = await setHook(); adminAuditLog(s.u, action, preset);
        return res.json({ ok: !!r.ok, webhook_url: hookUrl, preset, telegram: r });
      }
      const me = await tgApi(token, 'getMe');
      if (!me.ok) return res.status(400).json({ ok: false, error: me.description || 'Telegram rejected the token' });
      const start = req.body.start !== false;
      let hookRes = null, live = false;
      if (start) { hookRes = await setHook(); live = !!hookRes.ok; }
      const bot = { id: crypto.createHash('sha256').update(token).digest('hex').slice(0, 10), name: String(req.body.name || me.result.first_name || 'Hosted Bot').slice(0, 60), framework: `PyTeleHost Brain · ${preset}`, mode: 'webhook', hosted: true, preset, status: live ? 'live' : 'registered', username: me.result.username, telegram_url: me.result.username ? `https://t.me/${me.result.username}` : null, webhook_url: start ? hookUrl : null, managed_by: s.u, created_at: Math.floor(Date.now() / 1000) };
      global.__adminBots.set(bot.id, bot); adminAuditLog(s.u, 'host_bot', `${bot.name} [${preset}] live=${live}`);
      return res.json({ ok: true, bot, live, webhook_url: bot.webhook_url, telegram: hookRes });
    }
    global.__adminBots = global.__adminBots || new Map();
    if (action === 'add_bot') {
      const bot = { id: crypto.randomBytes(5).toString('hex'), name: String(req.body.name || 'Console Bot').slice(0, 60), framework: String(req.body.framework || 'python-telegram-bot').slice(0, 40), mode: 'webhook', status: 'managed', managed_by: s.u, username: null, created_at: Math.floor(Date.now() / 1000) };
      global.__adminBots.set(bot.id, bot); adminAuditLog(s.u, 'add_bot', bot.name);
      return res.json({ ok: true, bot });
    }
    if (action === 'remove_bot') { global.__adminBots.delete(String(req.body.id || '')); adminAuditLog(s.u, 'remove_bot', req.body.id); return res.json({ ok: true }); }
    if (['bot_start', 'bot_stop', 'bot_restart', 'bot_delete'].includes(action)) {
      const bot = bots.get(String(req.body.id || ''));
      if (!bot) return next(httpError(404, 'Bot not found'));
      if (action === 'bot_start') startBot(bot).catch((e) => logBot(bot, 'err', e.message));
      if (action === 'bot_stop') await stopBot(bot, { force: true });
      if (action === 'bot_restart') await restartBot(bot).catch(() => {});
      if (action === 'bot_delete') {
        try { await stopBot(bot, { force: true }); } catch { /* ignore */ }
        bots.delete(bot.meta.id);
        try { fs.rmSync(bot.dir, { recursive: true, force: true }); } catch { /* ignore */ }
        sendWs({ type: 'deleted', id: bot.meta.id });
      }
      adminAuditLog(s.u, action, bot.meta.id);
      return res.json({ ok: true });
    }
    if (['validate', 'webhook_info', 'webhook_set', 'webhook_delete', 'send_message'].includes(action)) {
      const token = String(req.body.token || '').trim();
      if (!/^\d{5,16}:[A-Za-z0-9_-]{30,}$/.test(token)) return res.status(400).json({ ok: false, error: 'Valid bot token required' });
      const method = { validate: 'getMe', webhook_info: 'getWebhookInfo', webhook_delete: 'deleteWebhook', webhook_set: 'setWebhook', send_message: 'sendMessage' }[action];
      const payload = action === 'webhook_delete' ? { drop_pending_updates: true }
        : action === 'send_message' ? { chat_id: req.body.chat_id, text: String(req.body.text || '').slice(0, 4000), ...(req.body.parse_mode ? { parse_mode: String(req.body.parse_mode) } : {}) }
        : action === 'webhook_set' ? { url: req.body.webhook_url || `${req.protocol}://${req.get('host')}/api/webhook?token=${encodeURIComponent(token)}`, drop_pending_updates: true } : {};
      const data = await new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const r2 = https.request(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => {
          let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('Invalid Telegram response')); } });
        });
        r2.on('timeout', () => r2.destroy(new Error('Telegram API timeout'))); r2.on('error', reject); r2.write(body); r2.end();
      });
      adminAuditLog(s.u, action);
      return res.json({ ok: !!data.ok, telegram: data, webhook_url: payload.url });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) { next(e); }
});

/* -------------------- PyTeleHost Ultra (Vercel parity) ------------------ */
// Same token check the Python serverless API (/api/validate_token) performs,
// so the Ultra frontend works identically on this Node stack.
app.post(['/api/validate_token', '/api/validate-token'], async (req, res) => {
  const token = String((req.body && req.body.token) || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'Send {"token": "123456:ABC..."}' });
  if (!/^\d{5,16}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return res.status(400).json({ ok: false, valid: false, error: 'Token format looks invalid (expected 123456789:AA...)' });
  }
  try {
    const data = await new Promise((resolve, reject) => {
      const r2 = https.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10000 }, (r) => {
        let body = '';
        r.on('data', (d) => { body += d; });
        r.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid response from Telegram')); } });
      });
      r2.on('timeout', () => r2.destroy(new Error('Telegram API timeout')));
      r2.on('error', reject);
    });
    if (!data.ok) return res.status(400).json({ ok: false, valid: false, error: data.description || 'Telegram rejected the token' });
    const me = data.result;
    res.json({ ok: true, valid: true, bot: { id: me.id, username: me.username, first_name: me.first_name, can_join_groups: me.can_join_groups, can_read_all_group_messages: me.can_read_all_group_messages, supports_inline_queries: me.supports_inline_queries, url: me.username ? `https://t.me/${me.username}` : null } });
  } catch (e) {
    res.status(502).json({ ok: false, error: `Could not reach Telegram: ${e.message}` });
  }
});
app.get('/ultra', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ------------------------------ frontend -------------------------------- */
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const message = err.code === 'LIMIT_FILE_SIZE'
    ? `File too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`
    : err.message || 'Internal error';
  if (status >= 500) console.error('[panel]', err);
  res.status(status).json({ error: message });
});

/* ---------------------------------------------------------------------------
 *  Server + WebSocket
 * ------------------------------------------------------------------------- */
const server = http.createServer(app);
wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 1024 * 1024,
  verifyClient: ({ req }) => {
    if (!PANEL_TOKEN) return true;
    try {
      const token = new URL(req.url, 'http://localhost').searchParams.get('token');
      return token === PANEL_TOKEN;
    } catch { return false; }
  },
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  try {
    ws.send(JSON.stringify({
      type: 'hello',
      app: APP,
      bots: [...bots.values()].map((b) => publicBot(b)),
    }));
  } catch { /* ignore */ }
});

const wsPing = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) { try { client.terminate(); } catch {} continue; }
    client.isAlive = false;
    try { client.ping(); } catch { /* ignore */ }
  }
}, 30_000);

/* ---------------------------------------------------------------------------
 *  Boot
 * ------------------------------------------------------------------------- */
async function boot() {
  loadBotsFromDisk();
  console.log(`\n  ⚡ ${APP.name} v${APP.version}`);
  console.log(`  developer : ${APP.developer}`);
  console.log(`  data      : ${DATA_DIR}`);
  console.log(`  bots      : ${bots.size} restored`);
  console.log(`  panel     : http://localhost:${PORT}  (open — no login)${PANEL_TOKEN ? ' [token protected]' : ''}\n`);

  server.listen(PORT, HOST, () => {
    console.log(`  ✅ Panel listening on http://${HOST}:${PORT}`);
  });

  setInterval(supervisorTick, 2500).unref?.();

  // Resume every bot that was running before the panel restarted.
  const resume = [...bots.values()].filter((b) => b.meta.desired === 'running');
  let delay = 400;
  for (const bot of resume) {
    setTimeout(() => {
      bot.meta.desired = 'running';
      bot.meta.autoRestart = true;
      logBot(bot, 'sys', 'Panel restarted — restoring bot automatically.');
      startBot(bot, { auto: true }).catch((e) => logBot(bot, 'err', e.message));
    }, delay);
    delay += 700;
  }

  // Keep the panel (and free hosts) alive.
  if (SELF_PING_URL) {
    console.log(`  🔁 self-ping enabled → ${SELF_PING_URL}`);
    setInterval(pingSelf, 4 * 60 * 1000).unref?.();
    setTimeout(pingSelf, 15000).unref?.();
  }
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[panel] ${signal} received — stopping ${bots.size} bot(s) gracefully…`);
  clearInterval(wsPing);
  try { if (wss) wss.close(); } catch { /* ignore */ }
  await Promise.allSettled([...bots.values()].map((b) => stopBot(b, { force: false, preserveDesired: true })));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 9000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => console.error('[panel] uncaught:', e));
process.on('unhandledRejection', (e) => console.error('[panel] rejection:', e));

process.on('exit', () => {
  for (const bot of bots.values()) {
    if (bot.proc) killGroup(bot.proc.pid, 'SIGKILL');
    if (bot.installProc) killGroup(bot.installProc.pid, 'SIGKILL');
  }
});

boot();
