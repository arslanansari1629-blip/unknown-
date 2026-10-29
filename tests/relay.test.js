import test from 'node:test';
import assert from 'node:assert/strict';
import { relayTelegram, assertSameOrigin, RelayError } from '../api/_relay.js';

const token = '123456789:AAH' + 'c'.repeat(33);

test('rejects invalid tokens and unsupported methods', async () => {
  await assert.rejects(relayTelegram({ token: 'bad', method: 'getMe' }, 't1'), RelayError);
  await assert.rejects(relayTelegram({ token, method: 'setWebhook' }, 't2'), /not supported/);
});

test('caps long-poll timeout and forwards JSON to Telegram', async () => {
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { status: 200, text: async () => JSON.stringify({ ok: true, result: [] }) };
  };
  try {
    const result = await relayTelegram({ token, method: 'getUpdates', payload: { timeout: 500, limit: 900 } }, 't3');
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(captured.options.body).timeout, 25);
    assert.equal(JSON.parse(captured.options.body).limit, 100);
    assert.equal(captured.url, `https://api.telegram.org/bot${token}/getUpdates`);
  } finally {
    globalThis.fetch = original;
  }
});

test('enforces same-origin browser requests', () => {
  assert.throws(() => assertSameOrigin({ headers: { origin: 'https://evil.example', host: 'app.example' } }), RelayError);
  assert.doesNotThrow(() => assertSameOrigin({ headers: { origin: 'https://app.example', host: 'app.example' } }));
});
