import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backoffDelay, isPermanentError, recoveryReason, formatDuration,
  normalizeAutopilotSettings, normalizeAutopilotStats, HEARTBEAT_TIMEOUT_MS,
} from '../src/lib/autopilot.js';
import { normalizeBot, normalizeState } from '../src/lib/storage.js';

test('backoff is exponential and capped', () => {
  assert.equal(backoffDelay(0), 5_000);
  assert.equal(backoffDelay(1), 10_000);
  assert.equal(backoffDelay(2), 20_000);
  assert.equal(backoffDelay(20), 300_000);
});

test('permanent errors are classified', () => {
  assert.equal(isPermanentError('Telegram returned 401 Unauthorized'), true);
  assert.equal(isPermanentError('SyntaxError: invalid syntax'), true);
  assert.equal(isPermanentError('This bot has a webhook configured.'), true);
  assert.equal(isPermanentError('Telegram relay failed six times in a row.'), false);
});

test('recoveryReason respects desired state, backoff and heartbeats', () => {
  const now = 1_000_000;
  assert.equal(recoveryReason({ desiredRunning: false, status: 'paused' }, now), null);
  assert.equal(recoveryReason({ desiredRunning: true, status: 'paused', nextRetryAt: now + 1 }, now), null);
  assert.equal(recoveryReason({ desiredRunning: true, status: 'paused' }, now), 'auto-resume');
  assert.equal(recoveryReason({ desiredRunning: true, status: 'error', lastError: 'network timeout' }, now), 'error retry');
  assert.equal(recoveryReason({ desiredRunning: true, status: 'error', lastError: '401 Unauthorized' }, now), 'permanent error');
  assert.equal(recoveryReason({ desiredRunning: true, status: 'running', lastHeartbeat: now - 1000 }, now, true), null);
  assert.equal(recoveryReason({ desiredRunning: true, status: 'running', lastHeartbeat: now - HEARTBEAT_TIMEOUT_MS - 1 }, now, true), 'heartbeat timeout');
  assert.equal(recoveryReason({ desiredRunning: true, status: 'running', lastHeartbeat: now }, now, false), 'worker disappeared');
  assert.equal(recoveryReason({ desiredRunning: true, status: 'connecting', updatedAt: now - 200_000 }, now, true), 'startup timeout');
});

test('restored running bots keep desiredRunning for Autopilot', () => {
  const bot = normalizeBot({ id: 'b1', status: 'running', desiredRunning: true, logs: [] });
  assert.equal(bot.status, 'paused');
  assert.equal(bot.desiredRunning, true);
  assert.match(bot.logs.at(-1).message, /Autopilot/);
});

test('workspace normalization preserves Autopilot settings and stats', () => {
  const state = normalizeState({ version: 1, bots: [], settings: { autopilot: { enabled: true, wakeLock: false } }, autopilotStats: { uptimeMs: 1234, recoveries: 2 }, autopilotEvents: [{ id: 'e1', at: 1, level: 'info', message: 'ok' }] });
  assert.equal(state.settings.autopilot.enabled, true);
  assert.equal(state.settings.autopilot.wakeLock, false);
  assert.equal(state.settings.autopilot.watchdog, true);
  assert.equal(state.autopilotStats.uptimeMs, 1234);
  assert.equal(state.autopilotStats.recoveries, 2);
  assert.equal(state.autopilotEvents.length, 1);
});

test('autopilot normalizers reject garbage', () => {
  assert.equal(normalizeAutopilotSettings({ enabled: 'yes' }).enabled, false);
  assert.equal(normalizeAutopilotStats({ uptimeMs: -5 }).uptimeMs, 0);
  assert.equal(formatDuration(3_661_000), '1h 1m 1s');
});
