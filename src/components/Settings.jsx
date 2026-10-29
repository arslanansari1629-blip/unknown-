import { useRef, useState } from 'react';
import { Database, Download, Upload, Trash2, ShieldCheck, Cpu, Globe, HardDrive, AlertTriangle } from 'lucide-react';
import { exportWorkspace } from '../lib/storage.js';
import { Modal } from './ui.jsx';

export default function Settings({ host, notify }) {
  const fileRef = useRef(null);
  const [resetting, setResetting] = useState(false);
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 15_000_000) return notify('error', 'Workspace imports are limited to 15 MB.');
    const result = await host.importWorkspace(file);
    if (result.ok) notify('success', 'Workspace imported. Previously running bots are paused for safety.');
    else notify('error', result.error);
  };
  return (
    <div className="space-y-6">
      <div><h1 className="page-title">Workspace Settings</h1><p className="page-subtitle">Local persistence, portability and runtime boundaries.</p></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-4 flex items-center gap-2"><Database size={17} className="text-emerald-300" /><h2 className="text-sm font-semibold text-white">Browser storage</h2></div>
          <dl className="space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-400">Backend</dt><dd className="font-mono text-xs text-slate-200">{host.storage.backend}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-400">Persistence</dt><dd className={host.storage.status === 'error' ? 'text-rose-300' : 'text-emerald-300'}>{host.storage.status === 'error' ? 'Unavailable' : 'Automatic'}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-400">Saved bots</dt><dd className="text-slate-200">{host.state.bots.length} / 25</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-400">Log retention</dt><dd className="text-slate-200">Latest 500 entries / bot</dd></div></dl>
          {host.storage.error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs leading-5 text-rose-200">{host.storage.error}</p>}
          <div className="mt-5 flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => { exportWorkspace(host.state); notify('info', 'Workspace exported. The file contains plaintext tokens—keep it private.'); }}><Download size={15} />Export workspace</button><button className="btn-secondary" onClick={() => fileRef.current?.click()}><Upload size={15} />Import</button><input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={importFile} /></div>
          <p className="mt-4 text-xs leading-5 text-slate-500">Code, tokens, settings, metrics and logs stay in IndexedDB on this origin. Clearing site data removes them. Export before switching browsers or devices.</p>
        </section>
        <section className="card p-5">
          <div className="mb-4 flex items-center gap-2"><Cpu size={17} className="text-sky-300" /><h2 className="text-sm font-semibold text-white">Execution model</h2></div>
          <ul className="space-y-3 text-sm leading-6 text-slate-400"><li className="flex gap-2"><ShieldCheck size={15} className="mt-1 shrink-0 text-emerald-300" />Python runs in Pyodide inside a dedicated Web Worker, never on the Vercel function.</li><li className="flex gap-2"><Globe size={15} className="mt-1 shrink-0 text-sky-300" />Telegram Bot API calls use a same-origin, stateless Vercel relay to avoid browser CORS restrictions.</li><li className="flex gap-2"><HardDrive size={15} className="mt-1 shrink-0 text-violet-300" />The relay stores no tokens, code, logs or bot state. It only forwards allowlisted Bot API methods.</li><li className="flex gap-2"><Cpu size={15} className="mt-1 shrink-0 text-amber-300" />Up to three concurrent workers. Bots pause when the dashboard closes; this is not always-on hosting.</li></ul>
        </section>
        <section className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2"><AlertTriangle size={17} className="text-amber-300" /><h2 className="text-sm font-semibold text-white">Framework compatibility</h2></div>
          <div className="grid gap-3 text-sm sm:grid-cols-3"><div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-4"><p className="font-medium text-emerald-300">telebot / pyTelegramBotAPI</p><p className="mt-2 text-xs leading-5 text-slate-400">Supported with synchronous long polling. POSIX handler threads are disabled automatically for browser compatibility.</p></div><div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-4"><p className="font-medium text-emerald-300">python-telegram-bot</p><p className="mt-2 text-xs leading-5 text-slate-400">Supported with asyncio polling through a fetch-backed httpx transport. Use app.run_polling(). Webhooks and native extras are not supported.</p></div><div className="rounded-xl border border-rose-400/15 bg-rose-400/5 p-4"><p className="font-medium text-rose-300">pyrogram</p><p className="mt-2 text-xs leading-5 text-slate-400">Detected and blocked before deployment. MTProto requires raw TCP sockets that browsers cannot provide. Use a persistent Python host for Pyrogram.</p></div></div>
        </section>
        <section className="card border-rose-400/15 p-5 lg:col-span-2"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-sm font-semibold text-rose-200">Reset workspace</h2><p className="mt-1 text-xs leading-5 text-slate-500">Stop all workers and delete every saved bot, token, draft and log from this browser.</p></div><button className="btn-danger" onClick={() => setResetting(true)}><Trash2 size={15} />Reset everything</button></div></section>
      </div>
      {resetting && <Modal title="Reset this workspace?" onClose={() => setResetting(false)} footer={<><button className="btn-secondary" onClick={() => setResetting(false)}>Cancel</button><button className="btn-danger" onClick={() => { host.resetWorkspace(); setResetting(false); notify('success', 'Workspace reset.'); }}><Trash2 size={15} />Reset workspace</button></>}><p className="leading-6">This cannot be undone. Export your workspace first if you need a backup. BotFather bots and Telegram messages are not affected.</p></Modal>}
    </div>
  );
}
