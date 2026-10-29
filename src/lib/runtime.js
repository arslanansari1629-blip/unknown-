import { redact } from './analysis.js';

const workerUrl = () => new URL('../workers/python.worker.js', import.meta.url);

export function validatePython(code) {
  return new Promise((resolve) => {
    let worker;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker?.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, errors: [{ line: 1, message: 'Python validator timed out while loading the runtime. Check your connection and retry.' }] }), 60_000);
    try {
      worker = new Worker(workerUrl());
      worker.onmessage = (event) => {
        const message = event.data;
        if (message.type === 'validation') finish(message);
        if (message.type === 'error') finish({ ok: false, errors: [{ line: 1, message: redact(message.message) }] });
      };
      worker.onerror = (event) => finish({ ok: false, errors: [{ line: 1, message: event.message || 'Python worker failed to start.' }] });
      worker.postMessage({ action: 'validate', code });
    } catch (error) {
      finish({ ok: false, errors: [{ line: 1, message: error.message }] });
    }
  });
}

export class BotRuntime {
  constructor(bot, options, handlers) {
    this.bot = bot;
    this.options = options;
    this.handlers = handlers;
    this.worker = null;
    this.disposed = false;
    this.startupTimer = null;
    this.polling = false;
  }

  start() {
    const { bot, options, handlers } = this;
    this.startupTimer = setTimeout(() => {
      if (!this.polling && !this.disposed) {
        handlers.onFatal('The bot did not start polling within two minutes. Check the script, dependencies and token.');
        this.stop();
      }
    }, 120_000);
    try {
      this.worker = new Worker(workerUrl());
    } catch (error) {
      handlers.onFatal(`Could not create Python worker: ${error.message}`);
      return;
    }
    this.worker.onerror = (event) => {
      handlers.onFatal(redact(event.message || 'Python worker crashed.', bot.token));
      this.stop();
    };
    this.worker.onmessage = (event) => {
      if (this.disposed) return;
      const message = event.data || {};
      switch (message.type) {
        case 'status':
          handlers.onStatus(message.status);
          break;
        case 'log':
          handlers.onLog(message.level, redact(message.message, bot.token));
          break;
        case 'polling':
          if (!this.polling) {
            this.polling = true;
            clearTimeout(this.startupTimer);
            handlers.onStatus('running');
            handlers.onLog('info', 'Long polling connected. Waiting for Telegram messages.');
          }
          break;
        case 'updates':
          handlers.onUpdates(message.updates || []);
          break;
        case 'api':
          handlers.onApi(message);
          break;
        case 'fatal':
          handlers.onFatal(redact(message.message, bot.token));
          this.stop();
          break;
        case 'finished':
          handlers.onFatal(message.message);
          this.stop();
          break;
        case 'test-complete':
          handlers.onTestComplete(message);
          this.stop();
          break;
        case 'error': {
          const text = redact(message.message, bot.token);
          handlers.onFatal(text);
          this.stop();
          break;
        }
        default:
          break;
      }
    };
    this.worker.postMessage({
      action: 'run',
      mode: options.mode || 'live',
      code: bot.code,
      token: bot.token,
      requirements: options.requirements || [],
      offset: bot.offset || 0,
      testText: options.testText || '/start',
    });
  }

  stop() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.startupTimer);
    this.worker?.terminate();
    this.worker = null;
  }
}

export async function telegramRequest(token, method, payload = {}) {
  const response = await fetch('/api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, method, payload }),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Relay returned HTTP ${response.status}.`); }
  if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram request failed (${response.status}).`);
  return data.result;
}
