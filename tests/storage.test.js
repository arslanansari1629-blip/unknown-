import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, normalizeBot, appendLog, makeLog, MAX_LOGS } from '../src/lib/storage.js';

test('normalizes corrupt workspace to defaults', () => {
  assert.deepEqual(normalizeState(null).bots, []);
  assert.deepEqual(normalizeState({ version: 99, bots: 'bad' }).bots, []);
});

test('restored running bots become paused with an audit entry', () => {
  const bot = normalizeBot({ id: 'b1', name: 'Test', status: 'running', logs: [] });
  assert.equal(bot.status, 'paused');
  assert.match(bot.logs.at(-1).message, /paused/);
});

test('log buffer is bounded and error counter increments', () => {
  let bot = normalizeBot({ id: 'b1', status: 'paused', logs: Array.from({ length: MAX_LOGS }, (_, i) => makeLog('info', String(i))) });
  bot = appendLog(bot, 'error', 'boom');
  assert.equal(bot.logs.length, MAX_LOGS);
  assert.equal(bot.errors, 1);
  assert.equal(bot.logs.at(-1).message, 'boom');
});
