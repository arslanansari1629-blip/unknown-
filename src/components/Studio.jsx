import { useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { Play, Rocket, Upload, CheckCircle2, XCircle, FlaskConical, Eye, EyeOff, BadgeCheck, FileCode2, Terminal, Square, Loader2 } from 'lucide-react';
import { analyzeDependencies, extractToken, preflightPython } from '../lib/analysis.js';
import { validatePython } from '../lib/runtime.js';
import { TEMPLATES } from '../lib/templates.js';
import { formatTime, Modal, StatusBadge } from './ui.jsx';
import RequirementsPanel from './RequirementsPanel.jsx';

const editorTheme = EditorView.theme({
  '&': { backgroundColor: '#0b1017', fontSize: '13px' },
  '.cm-gutters': { backgroundColor: '#0b1017', borderRight: '1px solid rgba(255,255,255,0.06)' },
  '.cm-content': { fontFamily: "'JetBrains Mono', monospace", padding: '12px 0' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', monospace" },
});

export default function Studio({ host, notify }) {
  const { draft } = host.state;
  const [validation, setValidation] = useState(null);
  const [validating, setValidating] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(null);
  const [testModal, setTestModal] = useState(false);
  const [testText, setTestText] = useState('/start');
  const fileRef = useRef(null);
  const analysis = useMemo(() => analyzeDependencies(draft.code), [draft.code]);
  const tokenInfo = useMemo(() => extractToken(draft.code, draft.token), [draft.code, draft.token]);
  const requirements = draft.autoRequirements ? analysis.requirements : draft.requirements;
  const currentDraft = { ...draft, requirements };

  const updateCode = (code) => {
    host.setDraft({ code });
    setValidation(null);
    setVerified(null);
  };

  const runValidation = async () => {
    setValidating(true);
    const quick = preflightPython(draft.code);
    if (!quick.ok) {
      setValidation(quick);
      setValidating(false);
      return quick;
    }
    const result = await validatePython(draft.code);
    setValidation(result);
    setValidating(false);
    return result;
  };

  const deploy = async () => {
    setDeploying(true);
    const result = await host.deploy(currentDraft);
    setDeploying(false);
    if (result.ok) notify('success', 'Deployment started. Follow progress in Live Logs.');
    else notify('error', result.error);
  };

  const verify = async () => {
    setVerifying(true);
    const result = await host.verifyToken(currentDraft);
    setVerifying(false);
    setVerified(result);
    if (result.ok) notify('success', `Token verified: @${result.username}`);
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 200_000) return notify('error', 'Python files are limited to 200 KB.');
    updateCode(await file.text());
    if (!draft.name) host.setDraft({ name: file.name.replace(/\.py$/i, '') });
    notify('success', `Loaded ${file.name}.`);
  };

  const loadTemplate = (id) => {
    const template = TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    host.setDraft({ code: template.code, name: template.name, requirements: '', autoRequirements: true });
    setValidation(null);
    setVerified(null);
    notify('info', `${template.label} template loaded.`);
  };

  const startTest = async () => {
    setTestModal(false);
    const result = await host.runTest(currentDraft, testText);
    if (!result.ok) notify('error', result.error);
  };

  const testActive = ['validating', 'installing', 'connecting', 'running'].includes(host.test.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="page-title">Code Studio</h1><p className="page-subtitle">Write, validate and launch a Python Telegram bot from your browser.</p></div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Load a starter template" className="input w-auto text-xs" defaultValue="" onChange={(event) => { loadTemplate(event.target.value); event.target.value = ''; }}><option value="" disabled>Load template…</option>{TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</select>
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}><Upload size={15} />Import .py</button>
          <input ref={fileRef} type="file" accept=".py,text/x-python" className="hidden" onChange={upload} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
        <div className="space-y-4">
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 bg-white/[0.02] px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs"><FileCode2 size={15} className="text-sky-300" /><span className="font-mono text-slate-200">bot.py</span><span className="chip ml-2">Python 3.12</span></div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500"><span>{draft.code.split('\n').length} lines</span><span>·</span><span>UTF-8</span></div>
            </div>
            <CodeMirror value={draft.code} height="460px" extensions={[python(), editorTheme, EditorView.lineWrapping]} theme={oneDark} onChange={updateCode} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true, bracketMatching: true }} aria-label="Python code editor" />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 bg-white/[0.02] px-4 py-3">
              <div className="text-xs text-slate-500">Trusted code only · runs in an isolated Web Worker</div>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={validating || deploying} onClick={runValidation}>{validating ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{validating ? 'Checking…' : 'Validate'}</button>
                <button className="btn-secondary" disabled={testActive || deploying} onClick={() => setTestModal(true)}><FlaskConical size={15} />Test run</button>
                <button className="btn-primary" disabled={deploying || validating || !host.ready} onClick={deploy}>{deploying ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}{deploying ? 'Deploying…' : 'Deploy bot'}</button>
              </div>
            </div>
          </section>

          {validation && <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${validation.ok ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200' : 'border-rose-400/20 bg-rose-400/5 text-rose-200'}`}>{validation.ok ? <CheckCircle2 size={18} className="shrink-0" /> : <XCircle size={18} className="shrink-0" />}<div>{validation.ok ? <p>Syntax and indentation look good. Compiled with Python {validation.python}.</p> : <ul className="space-y-1">{validation.errors.map((error, index) => <li key={index}><span className="font-mono">Line {error.line}:</span> {error.message}</li>)}</ul>}</div></div>}

          {(host.test.logs.length > 0 || testActive) && <section className="card overflow-hidden"><div className="flex items-center justify-between border-b border-white/8 px-4 py-3"><div className="flex items-center gap-2"><Terminal size={15} className="text-violet-300" /><h3 className="text-sm font-semibold">Test console</h3><StatusBadge status={host.test.status} /></div>{testActive && <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={host.stopTest}><Square size={12} />Stop</button>}</div><div className="max-h-64 overflow-auto bg-[#0b1017] p-3 font-mono text-xs leading-6">{host.test.logs.map((log) => <div key={log.id} className="flex gap-3"><span className="shrink-0 text-slate-600">{formatTime(log.at)}</span><span className={log.level === 'error' ? 'text-rose-300' : log.level === 'output' ? 'text-emerald-200' : log.level === 'message' ? 'text-sky-200' : 'text-slate-400'}>{log.message}</span></div>)}</div><p className="border-t border-white/8 px-4 py-2 text-[11px] text-slate-500">Test mode mocks Telegram Bot API calls. Other network calls in your script are still real and subject to browser CORS.</p></section>}
        </div>

        <div className="space-y-4">
          <section className="card p-4">
            <h3 className="mb-4 text-sm font-semibold text-white">Deployment configuration</h3>
            <label className="label" htmlFor="bot-name">Bot name</label>
            <input id="bot-name" className="input" value={draft.name} maxLength={80} placeholder="My Telegram Bot" onChange={(event) => host.setDraft({ name: event.target.value })} />
            <div className="mt-4 flex items-center justify-between"><label className="label mb-0" htmlFor="bot-token">Bot token</label><span className="text-[11px] text-slate-500">{tokenInfo.source === 'code' ? 'Detected in code' : tokenInfo.source === 'environment' ? 'Reads from environment' : 'Required for live deploy'}</span></div>
            <div className="relative mt-1.5"><input id="bot-token" className="input pr-20 font-mono text-xs" type={showToken ? 'text' : 'password'} value={draft.token} placeholder="123456789:AA… or leave blank if hardcoded" autoComplete="off" onChange={(event) => { host.setDraft({ token: event.target.value }); setVerified(null); }} /><div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1"><button className="icon-btn h-7 w-7" onClick={() => setShowToken(!showToken)} aria-label={showToken ? 'Hide token' : 'Show token'}>{showToken ? <EyeOff size={14} /> : <Eye size={14} />}</button><button className="icon-btn h-7 w-7" disabled={verifying || !tokenInfo.valid} onClick={verify} aria-label="Verify token">{verifying ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}</button></div></div>
            {verified && <p className={`mt-2 text-xs ${verified.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{verified.ok ? `Verified @${verified.username}` : verified.error}</p>}
            <p className="mt-3 text-[11px] leading-5 text-slate-500">Stored only in this browser’s IndexedDB, unencrypted. The relay forwards it to Telegram and does not persist it. Use a disposable test bot on shared devices.</p>
          </section>
          <RequirementsPanel draft={draft} setDraft={host.setDraft} notify={notify} compact />
          <div className="rounded-xl border border-sky-400/15 bg-sky-400/5 p-4 text-xs leading-5 text-sky-200/80"><strong className="text-sky-200">Browser runtime.</strong> Deployed bots poll Telegram while this tab is open. Closing the dashboard pauses them. Up to three workers run concurrently; this is not 24/7 hosting.</div>
        </div>
      </div>

      {testModal && <Modal title="Run a simulated Telegram update" onClose={() => setTestModal(false)} footer={<><button className="btn-secondary" onClick={() => setTestModal(false)}>Cancel</button><button className="btn-primary" onClick={startTest}><Play size={15} />Run test</button></>}><p className="mb-4 leading-6 text-slate-400">The worker installs dependencies and executes your script against a mocked Telegram API. No real messages are sent. Enter the message your handlers should receive.</p><label className="label" htmlFor="test-message">Incoming test message</label><input id="test-message" className="input font-mono" value={testText} onChange={(event) => setTestText(event.target.value)} placeholder="/start" /><p className="mt-3 text-xs text-slate-500">Supported: telebot and python-telegram-bot polling handlers. Arbitrary non-Telegram network calls still execute.</p></Modal>}
    </div>
  );
}
