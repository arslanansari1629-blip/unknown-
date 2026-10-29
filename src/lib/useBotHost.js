import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeDependencies, extractToken, parseRequirements, preflightPython, redact } from './analysis.js';
import { appendLog, defaultState, loadState, makeLog, MAX_BOTS, MAX_LOGS, normalizeState, saveState, storageBackend, uid } from './storage.js';
import { BotRuntime, telegramRequest, validatePython } from './runtime.js';

const ACTIVE = new Set(['running', 'connecting', 'installing', 'validating']);
const MAX_ACTIVE = 3;

export function useBotHost() {
  const [state, setState] = useState(defaultState);
  const [ready, setReady] = useState(false);
  const [storage, setStorage] = useState({ status: 'loading', backend: 'indexeddb', error: '' });
  const [test, setTest] = useState({ status: 'idle', logs: [], error: '' });
  const stateRef = useRef(state);
  const runtimes = useRef(new Map());
  const testRuntime = useRef(null);
  const saveTimer = useRef(null);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    loadState().then((value) => {
      if (cancelled) return;
      setState(value);
      setReady(true);
      setStorage({ status: 'saved', backend: storageBackend(), error: '' });
    }).catch((error) => {
      if (cancelled) return;
      setReady(true);
      setStorage({ status: 'error', backend: 'memory', error: error.message });
    });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback((value) => {
    setStorage((s) => ({ ...s, status: 'saving' }));
    saveState(value).then((backend) => {
      setStorage({ status: 'saved', backend, error: '' });
    }).catch((error) => {
      setStorage({ status: 'error', backend: storageBackend(), error: error?.name === 'QuotaExceededError' ? 'Browser storage is full. Export your workspace, then delete old bots or logs.' : error.message });
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(stateRef.current), 250);
    return () => clearTimeout(saveTimer.current);
  }, [state, ready, persist]);

  useEffect(() => {
    const flush = () => {
      if (!ready) return;
      const snapshot = stateRef.current;
      const paused = {
        ...snapshot,
        bots: snapshot.bots.map((bot) => ACTIVE.has(bot.status) ? { ...bot, status: 'paused', logs: [...bot.logs, makeLog('warn', 'Dashboard closed. Bot paused automatically; resume after reopening.')].slice(-MAX_LOGS) } : bot),
      };
      stateRef.current = paused;
      setState(paused);
      saveState(paused).catch(() => {});
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      runtimes.current.forEach((runtime) => runtime.stop());
      testRuntime.current?.stop();
    };
  }, [ready]);

  const updateBot = useCallback((id, updater) => {
    setState((current) => ({ ...current, bots: current.bots.map((bot) => bot.id === id ? updater(bot) : bot) }));
  }, []);

  const logBot = useCallback((id, level, message, extra) => {
    updateBot(id, (bot) => appendLog(bot, level, redact(message, bot.token), extra));
  }, [updateBot]);

  const activeCount = useCallback(() => stateRef.current.bots.filter((bot) => ACTIVE.has(bot.status)).length + (testRuntime.current && !testRuntime.current.disposed ? 1 : 0), []);

  const startRuntime = useCallback((bot, requirements) => {
    runtimes.current.get(bot.id)?.stop();
    const handlers = {
      onStatus: (status) => updateBot(bot.id, (current) => ({ ...current, status, updatedAt: Date.now(), lastError: status === 'running' ? '' : current.lastError })),
      onLog: (level, message) => logBot(bot.id, level, message),
      onFatal: (message) => updateBot(bot.id, (current) => appendLog({ ...current, status: 'error', lastError: message }, 'error', message)),
      onApi: (entry) => logBot(bot.id, 'api', `${entry.method} · HTTP ${entry.status} · ${entry.duration} ms`, entry),
      onUpdates: (updates) => updateBot(bot.id, (current) => {
        const seen = new Set(current.seenIds);
        let next = { ...current };
        let offset = current.offset || 0;
        for (const update of updates) {
          const id = Number(update.update_id);
          if (!Number.isFinite(id)) continue;
          offset = Math.max(offset, id + 1);
          if (seen.has(id)) continue;
          seen.add(id);
          const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
          if (message) {
            next = { ...next, messages: next.messages + 1 };
            const text = message.text || message.caption || `[${Object.keys(update).find((k) => k !== 'update_id') || 'non-text'} update]`;
            const from = message.from?.username ? `@${message.from.username}` : message.from?.first_name || 'chat';
            next = appendLog(next, 'message', `${from}: ${text}`, { command: text.startsWith('/') ? text.split(/\s/)[0] : null, chatId: message.chat?.id });
          } else if (update.callback_query) {
            next = appendLog(next, 'command', `Callback query: ${update.callback_query.data || '(empty)'}`);
          }
        }
        return { ...next, offset, seenIds: [...seen].slice(-2000), updatedAt: Date.now() };
      }),
    };
    const runtime = new BotRuntime(bot, { mode: 'live', requirements }, handlers);
    runtimes.current.set(bot.id, runtime);
    runtime.start();
  }, [logBot, updateBot]);

  const setDraft = useCallback((patch) => {
    setState((current) => ({ ...current, draft: { ...current.draft, ...patch } }));
  }, []);

  const deploy = useCallback(async (draft) => {
    if (!ready) return { ok: false, error: 'Workspace is still loading.' };
    if (stateRef.current.bots.length >= MAX_BOTS) return { ok: false, error: `This workspace supports up to ${MAX_BOTS} saved bots. Delete one before deploying.` };
    if (activeCount() >= MAX_ACTIVE) return { ok: false, error: `At most ${MAX_ACTIVE} Python workers can run at once. Pause a bot or stop the test first.` };
    const analysis = analyzeDependencies(draft.code);
    if (analysis.blockers.length) return { ok: false, error: analysis.blockers[0].message };
    const structural = preflightPython(draft.code);
    if (!structural.ok) return { ok: false, error: `Line ${structural.errors[0].line}: ${structural.errors[0].message}` };
    const reqs = parseRequirements(draft.requirements);
    if (reqs.errors.length) return { ok: false, error: reqs.errors[0] };
    const tokenInfo = extractToken(draft.code, draft.token);
    if (!tokenInfo.valid) return { ok: false, error: 'Enter a valid BotFather token, or assign a literal token in the code. Environment-style tokens need the token field.' };
    if (stateRef.current.bots.some((bot) => bot.token === tokenInfo.token && ACTIVE.has(bot.status))) return { ok: false, error: 'Another active bot already uses this token. Pause it before deploying a second poller.' };
    if (!analysis.framework || analysis.framework === 'pyrogram') return { ok: false, error: 'Live deployment requires a telebot or python-telegram-bot polling script.' };
    const id = uid();
    const now = Date.now();
    let bot = {
      id, name: draft.name.trim() || 'Untitled bot', code: draft.code, token: tokenInfo.token,
      requirements: draft.requirements, framework: analysis.framework, username: '', telegramId: null,
      status: 'validating', createdAt: now, updatedAt: now, deployedAt: now, messages: 0, errors: 0,
      offset: 0, seenIds: [], logs: [makeLog('info', 'Deployment requested. Validating Python syntax…')], lastError: '',
    };
    setState((current) => ({ ...current, bots: [bot, ...current.bots], selectedBotId: id }));
    const syntax = await validatePython(draft.code);
    if (!syntax.ok) {
      const message = `Line ${syntax.errors[0].line}: ${syntax.errors[0].message}`;
      updateBot(id, (current) => appendLog({ ...current, status: 'error', lastError: message }, 'error', message));
      return { ok: false, error: message };
    }
    logBot(id, 'info', `Python ${syntax.python || '3.12'} syntax check passed.`);
    try {
      const me = await telegramRequest(bot.token, 'getMe');
      const webhook = await telegramRequest(bot.token, 'getWebhookInfo');
      if (webhook?.url) throw new Error('This bot has a webhook configured. Browser polling cannot run alongside a webhook. Keep the existing host, or explicitly remove the webhook in BotFather before retrying.');
      bot = { ...bot, name: draft.name.trim() || me.first_name || me.username || 'Telegram bot', username: me.username || '', telegramId: me.id || null, status: 'installing' };
      updateBot(id, (current) => appendLog({ ...current, name: bot.name, username: bot.username, telegramId: bot.telegramId, status: 'installing' }, 'info', `Token verified as @${bot.username}. Installing browser dependencies…`));
      startRuntime(bot, reqs.requirements);
      return { ok: true, id };
    } catch (error) {
      const message = redact(error.message, bot.token);
      updateBot(id, (current) => appendLog({ ...current, status: 'error', lastError: message }, 'error', message));
      return { ok: false, error: message };
    }
  }, [activeCount, logBot, ready, startRuntime, updateBot]);

  const pause = useCallback((id) => {
    runtimes.current.get(id)?.stop();
    runtimes.current.delete(id);
    updateBot(id, (bot) => appendLog({ ...bot, status: 'paused' }, 'warn', 'Bot paused. Incoming messages are queued by Telegram until you resume.'));
  }, [updateBot]);

  const resume = useCallback((id) => {
    const bot = stateRef.current.bots.find((item) => item.id === id);
    if (!bot) return { ok: false, error: 'Bot not found.' };
    if (activeCount() >= MAX_ACTIVE) return { ok: false, error: `At most ${MAX_ACTIVE} workers can run at once.` };
    const reqs = parseRequirements(bot.requirements);
    if (reqs.errors.length) return { ok: false, error: reqs.errors[0] };
    updateBot(id, (current) => appendLog({ ...current, status: 'connecting', lastError: '' }, 'info', 'Resuming browser worker…'));
    startRuntime(bot, reqs.requirements);
    return { ok: true };
  }, [activeCount, startRuntime, updateBot]);

  const restart = useCallback((id) => {
    const bot = stateRef.current.bots.find((item) => item.id === id);
    if (!bot) return { ok: false, error: 'Bot not found.' };
    runtimes.current.get(id)?.stop();
    runtimes.current.delete(id);
    const wasActive = ACTIVE.has(bot.status);
    if (!wasActive && activeCount() >= MAX_ACTIVE) return { ok: false, error: `At most ${MAX_ACTIVE} workers can run at once.` };
    const fresh = { ...bot, logs: [makeLog('info', 'Restart requested. Log buffer flushed and execution state reset.')], errors: 0, lastError: '', status: 'connecting' };
    updateBot(id, () => fresh);
    const reqs = parseRequirements(bot.requirements);
    startRuntime(fresh, reqs.requirements);
    return { ok: true };
  }, [activeCount, startRuntime, updateBot]);

  const remove = useCallback((id) => {
    runtimes.current.get(id)?.stop();
    runtimes.current.delete(id);
    setState((current) => {
      const bots = current.bots.filter((bot) => bot.id !== id);
      return { ...current, bots, selectedBotId: current.selectedBotId === id ? bots[0]?.id || null : current.selectedBotId };
    });
  }, []);

  const selectBot = useCallback((id) => setState((current) => ({ ...current, selectedBotId: id })), []);
  const clearLogs = useCallback((id) => updateBot(id, (bot) => ({ ...bot, logs: [makeLog('info', 'Log buffer cleared.')], updatedAt: Date.now() })), [updateBot]);

  const stopTest = useCallback(() => {
    testRuntime.current?.stop();
    testRuntime.current = null;
    setTest((current) => ({ ...current, status: current.status === 'completed' ? 'completed' : 'stopped', logs: [...current.logs, makeLog('warn', 'Test worker stopped.')].slice(-MAX_LOGS) }));
  }, []);

  const runTest = useCallback(async (draft, text) => {
    if (activeCount() >= MAX_ACTIVE) return { ok: false, error: `At most ${MAX_ACTIVE} workers can run at once.` };
    const analysis = analyzeDependencies(draft.code);
    if (analysis.blockers.length) return { ok: false, error: analysis.blockers[0].message };
    const structural = preflightPython(draft.code);
    if (!structural.ok) return { ok: false, error: `Line ${structural.errors[0].line}: ${structural.errors[0].message}` };
    const reqs = parseRequirements(draft.requirements);
    if (reqs.errors.length) return { ok: false, error: reqs.errors[0] };
    testRuntime.current?.stop();
    setTest({ status: 'validating', logs: [makeLog('info', 'Test run started. Telegram traffic is mocked; no real messages are sent.')], error: '' });
    const syntax = await validatePython(draft.code);
    if (!syntax.ok) {
      const message = `Line ${syntax.errors[0].line}: ${syntax.errors[0].message}`;
      setTest({ status: 'error', error: message, logs: [makeLog('error', message)] });
      return { ok: false, error: message };
    }
    const tokenInfo = extractToken(draft.code, draft.token);
    const bot = { id: 'test', code: draft.code, token: tokenInfo.token || '123456789:TEST_TOKEN_PLACEHOLDER_000000000000000', offset: 0 };
    const push = (level, message) => setTest((current) => ({ ...current, logs: [...current.logs, makeLog(level, redact(message, bot.token))].slice(-MAX_LOGS) }));
    const runtime = new BotRuntime(bot, { mode: 'test', requirements: reqs.requirements, testText: text || '/start' }, {
      onStatus: (status) => setTest((current) => ({ ...current, status })),
      onLog: push,
      onApi: (entry) => push('api', `${entry.method} · mocked · ${entry.duration} ms`),
      onUpdates: (updates) => updates.forEach((update) => push('message', `Test user: ${update.message?.text || '[update]'}`)),
      onFatal: (message) => { push('error', message); setTest((current) => ({ ...current, status: 'error', error: message })); },
      onTestComplete: () => { push('info', 'Test update processed. Test run completed.'); setTest((current) => ({ ...current, status: 'completed' })); },
    });
    testRuntime.current = runtime;
    runtime.start();
    return { ok: true };
  }, [activeCount]);

  const verifyToken = useCallback(async (draft) => {
    const info = extractToken(draft.code, draft.token);
    if (!info.valid) return { ok: false, error: 'Enter a valid token first.' };
    try {
      const me = await telegramRequest(info.token, 'getMe');
      return { ok: true, username: me.username, name: me.first_name };
    } catch (error) {
      return { ok: false, error: redact(error.message, info.token) };
    }
  }, []);

  const importWorkspace = useCallback(async (file) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.bots)) throw new Error('This is not a BotHost v1 workspace export.');
      runtimes.current.forEach((runtime) => runtime.stop());
      runtimes.current.clear();
      testRuntime.current?.stop();
      const normalized = normalizeState(parsed);
      setState(normalized);
      persist(normalized);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not import workspace.' };
    }
  }, [persist]);

  const resetWorkspace = useCallback(() => {
    runtimes.current.forEach((runtime) => runtime.stop());
    runtimes.current.clear();
    testRuntime.current?.stop();
    const fresh = defaultState();
    setState(fresh);
    persist(fresh);
  }, [persist]);

  return {
    state, ready, storage, test, activeCount: state.bots.filter((bot) => ACTIVE.has(bot.status)).length,
    setDraft, deploy, pause, resume, restart, remove, selectBot, clearLogs, runTest, stopTest, verifyToken,
    importWorkspace, resetWorkspace, exportState: state,
  };
}
