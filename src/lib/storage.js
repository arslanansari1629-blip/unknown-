import { normalizeAutopilotSettings, normalizeAutopilotStats } from './autopilot.js';

export const STORAGE_KEY = 'bothost-serverless:v1';
export const MAX_LOGS = 500;
export const MAX_BOTS = 25;
const DB_NAME = 'bothost-serverless';
const STORE = 'workspace';

export function uid(prefix = 'bot') {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${value}`;
}

export function makeLog(level, message, extra = {}) {
  return { id: uid('log'), at: Date.now(), level, message: String(message).slice(0, 4000), ...extra };
}

export const MAX_AUTOPILOT_EVENTS = 200;

export function defaultAutopilot() {
  return {
    enabled: false,
    autoResume: true,
    wakeLock: true,
    silentAudio: false,
    watchdog: true,
    notifications: false,
    leaderOnly: true,
    kiosk: false,
  };
}

export function defaultAutopilotStats() {
  return { uptimeMs: 0, recoveries: 0, sessions: 0, lastStartedAt: null, leaderSince: null };
}

export function defaultState() {
  return {
    version: 1,
    bots: [],
    draft: { name: '', code: '', token: '', requirements: '', autoRequirements: true },
    selectedBotId: null,
    settings: { revealTokens: false, autopilot: defaultAutopilot() },
    autopilotStats: defaultAutopilotStats(),
    autopilotEvents: [],
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB is unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab'));
  });
}

async function idbGet() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(STORAGE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(value) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, STORAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
    });
  } finally {
    db.close();
  }
}

function localGet() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

let backend = null;

export async function loadState() {
  let value = null;
  try {
    value = await idbGet();
    backend = 'indexeddb';
  } catch {
    try {
      value = localGet();
      backend = 'localstorage';
    } catch {
      backend = 'memory';
      throw new Error('Browser storage is blocked. The dashboard works for this session, but changes cannot persist. Allow site storage to enable persistence.');
    }
  }
  if (!value) return defaultState();
  return normalizeState(value);
}

export async function saveState(state) {
  const snapshot = JSON.parse(JSON.stringify(state));
  if (backend === 'localstorage') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return backend;
  }
  if (backend === 'memory') throw new Error('Persistence is unavailable in this browser session.');
  try {
    await idbSet(snapshot);
    return 'indexeddb';
  } catch (error) {
    if (error?.name === 'QuotaExceededError') throw error;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      backend = 'localstorage';
      return backend;
    } catch {
      throw error;
    }
  }
}

export function storageBackend() {
  return backend || 'indexeddb';
}

export function normalizeState(input) {
  const base = defaultState();
  if (!input || typeof input !== 'object' || input.version !== 1) return base;
  const bots = Array.isArray(input.bots) ? input.bots.slice(0, MAX_BOTS).map(normalizeBot).filter(Boolean) : [];
  return {
    ...base,
    bots,
    draft: { ...base.draft, ...(input.draft && typeof input.draft === 'object' ? input.draft : {}) },
    selectedBotId: bots.some((b) => b.id === input.selectedBotId) ? input.selectedBotId : bots[0]?.id || null,
    settings: {
      ...base.settings,
      ...(input.settings || {}),
      autopilot: normalizeAutopilotSettings(input.settings?.autopilot),
    },
    autopilotStats: normalizeAutopilotStats(input.autopilotStats),
    autopilotEvents: Array.isArray(input.autopilotEvents) ? input.autopilotEvents.slice(-MAX_AUTOPILOT_EVENTS) : [],
  };
}

export function normalizeBot(bot) {
  if (!bot || typeof bot !== 'object' || typeof bot.id !== 'string') return null;
  const wasRunning = ['running', 'connecting', 'installing', 'validating', 'stopping'].includes(bot.status);
  const desiredRunning = typeof bot.desiredRunning === 'boolean' ? bot.desiredRunning : wasRunning;
  const logs = Array.isArray(bot.logs) ? bot.logs.slice(-MAX_LOGS) : [];
  if (wasRunning) {
    logs.push(makeLog('warn', desiredRunning
      ? 'Browser session restored. The bot is paused; Autopilot resumes it automatically when armed, otherwise press Resume. Bots do not run while every dashboard tab is closed.'
      : 'Browser session restored. The bot is paused; press Resume to reconnect. Bots do not run while this dashboard is closed.'));
  }
  return {
    id: bot.id,
    name: String(bot.name || 'Untitled bot').slice(0, 80),
    code: String(bot.code || ''),
    token: String(bot.token || ''),
    requirements: String(bot.requirements || ''),
    framework: bot.framework || null,
    username: bot.username || '',
    telegramId: bot.telegramId || null,
    status: wasRunning ? 'paused' : ['paused', 'stopped', 'error', 'draft'].includes(bot.status) ? bot.status : 'stopped',
    desiredRunning,
    restartCount: Math.max(0, Number(bot.restartCount) || 0),
    nextRetryAt: Math.max(0, Number(bot.nextRetryAt) || 0),
    lastHeartbeat: Math.max(0, Number(bot.lastHeartbeat) || 0),
    lastRecoveryAt: Math.max(0, Number(bot.lastRecoveryAt) || 0),
    createdAt: Number(bot.createdAt) || Date.now(),
    updatedAt: Number(bot.updatedAt) || Date.now(),
    deployedAt: Number(bot.deployedAt) || null,
    messages: Math.max(0, Number(bot.messages) || 0),
    errors: Math.max(0, Number(bot.errors) || 0),
    offset: Number(bot.offset) || 0,
    seenIds: Array.isArray(bot.seenIds) ? bot.seenIds.slice(-2000) : [],
    logs,
    lastError: bot.lastError || '',
  };
}

export function appendLog(bot, level, message, extra = {}) {
  const logs = [...bot.logs, makeLog(level, message, extra)].slice(-MAX_LOGS);
  return { ...bot, logs, updatedAt: Date.now(), ...(level === 'error' ? { errors: bot.errors + 1 } : {}) };
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportWorkspace(state) {
  const payload = { ...state, exportedAt: new Date().toISOString(), notice: 'Contains bot tokens in plaintext. Keep this file private.' };
  downloadText(`bothost-workspace-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
}
