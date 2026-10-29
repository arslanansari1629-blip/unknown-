// Pure helpers shared by the Autopilot UI, the bot host and the unit tests.
// Nothing here touches the DOM, so the recovery policy can be tested in Node.

export const AUTOPILOT_LOCK = 'bothost-autopilot-leader';
export const AUTOPILOT_CHANNEL = 'bothost-autopilot';
export const AUTOPILOT_LEASE_KEY = 'bothost-autopilot-lease';
export const HEARTBEAT_TIMEOUT_MS = 90_000;
export const STARTUP_TIMEOUT_MS = 180_000;
export const STABLE_RESET_MS = 300_000;
export const CAPACITY_RETRY_MS = 60_000;
export const MAX_BACKOFF_MS = 300_000;

export const ACTIVE_STATUSES = new Set(['running', 'connecting', 'installing', 'validating']);

/** Exponential backoff: 5s, 10s, 20s, 40s … capped at five minutes. */
export function backoffDelay(attempt = 0) {
  const safe = Math.max(0, Math.min(20, Number(attempt) || 0));
  return Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** safe);
}

/** Errors that will never fix themselves by restarting the same script/token. */
export function isPermanentError(message = '') {
  return /401|unauthorized|invalid token|bot token|webhook configured|pyrogram|syntaxerror|indentationerror|modulenotfounderror|no module named|not supported|requires a telebot|python worker failed to start|could not create python worker/i.test(String(message));
}

export function isActive(bot) {
  return ACTIVE_STATUSES.has(bot?.status);
}

/**
 * Decide whether a desired-running bot needs a recovery right now.
 * Returns null when healthy/waiting, otherwise a short reason string.
 */
export function recoveryReason(bot, now = Date.now(), runtimeAlive = true) {
  if (!bot?.desiredRunning) return null;
  if (!isActive(bot) && bot.nextRetryAt && now < bot.nextRetryAt) return null;

  if (isActive(bot)) {
    if (!runtimeAlive) return 'worker disappeared';
    if (bot.status === 'running') {
      const beat = Number(bot.lastHeartbeat) || 0;
      if (beat && now - beat > HEARTBEAT_TIMEOUT_MS) return 'heartbeat timeout';
      return null;
    }
    const since = Number(bot.updatedAt) || now;
    if (now - since > STARTUP_TIMEOUT_MS) return 'startup timeout';
    return null;
  }

  if (bot.status === 'error') {
    if (isPermanentError(bot.lastError)) return 'permanent error';
    return 'error retry';
  }
  if (bot.status === 'paused' || bot.status === 'stopped') return 'auto-resume';
  return null;
}

export function formatDuration(ms = 0) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000)) || 0;
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function normalizeAutopilotSettings(input = {}) {
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  return {
    enabled: bool(input.enabled, false),
    autoResume: bool(input.autoResume, true),
    wakeLock: bool(input.wakeLock, true),
    silentAudio: bool(input.silentAudio, false),
    watchdog: bool(input.watchdog, true),
    notifications: bool(input.notifications, false),
    leaderOnly: bool(input.leaderOnly, true),
    kiosk: bool(input.kiosk, false),
  };
}

export function normalizeAutopilotStats(input = {}) {
  const num = (value) => Math.max(0, Number(value) || 0);
  return {
    uptimeMs: num(input.uptimeMs),
    recoveries: num(input.recoveries),
    sessions: num(input.sessions),
    lastStartedAt: Number(input.lastStartedAt) || null,
    leaderSince: Number(input.leaderSince) || null,
  };
}
