import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard, Code2, Bot, Terminal, Package, Settings as SettingsIcon, Zap, Menu, X, HardDrive, Check, Loader2, AlertTriangle, ChevronRight, CircleHelp } from 'lucide-react';
import { useBotHost } from './lib/useBotHost.js';
import { TELEBOT_TEMPLATE } from './lib/templates.js';
import { uid } from './lib/storage.js';
import { Toasts } from './components/ui.jsx';
import Overview from './components/Overview.jsx';
import Studio from './components/Studio.jsx';
import Fleet from './components/Fleet.jsx';
import Logs from './components/Logs.jsx';
import Settings from './components/Settings.jsx';
import RequirementsPanel from './components/RequirementsPanel.jsx';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'studio', label: 'Code Studio', icon: Code2 },
  { id: 'fleet', label: 'Bot Fleet', icon: Bot },
  { id: 'logs', label: 'Live Logs', icon: Terminal },
  { id: 'requirements', label: 'Requirements', icon: Package },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function App() {
  const host = useBotHost();
  const [page, setPage] = useState('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [toasts, setToasts] = useState([]);
  const initialized = useRef(false);

  useEffect(() => {
    if (host.ready && !initialized.current) {
      initialized.current = true;
      if (!host.state.draft.code) host.setDraft({ code: TELEBOT_TEMPLATE, name: 'Echo Assistant' });
    }
  }, [host.ready, host.state.draft.code, host.setDraft]);

  const notify = useCallback((kind, message) => {
    const id = uid('toast');
    setToasts((current) => [...current.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);
  const dismiss = useCallback((id) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const navigate = useCallback((id) => { setPage(id); setMobileNav(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const current = NAV.find((item) => item.id === page);

  return (
    <div className="min-h-screen bg-[#0a0e14] text-slate-200">
      {mobileNav && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileNav(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-white/8 bg-[#0c1118] transition-transform lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center justify-between border-b border-white/8 px-5"><button className="flex items-center gap-2.5" onClick={() => navigate('overview')}><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-300 to-emerald-500 text-[#062018] shadow-lg shadow-emerald-500/15"><Zap size={18} strokeWidth={2.5} /></span><span className="text-left"><span className="block text-sm font-semibold tracking-tight text-white">BotHost</span><span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-300/80">Serverless</span></span></button><button className="icon-btn lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={17} /></button></div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation"><p className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Workspace</p>{NAV.map((item) => { const Icon = item.icon; const active = page === item.id; return <button key={item.id} onClick={() => navigate(item.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? 'bg-emerald-400/10 font-medium text-emerald-300' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'}`}><Icon size={17} /><span className="flex-1 text-left">{item.label}</span>{item.id === 'fleet' && host.state.bots.length > 0 && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{host.state.bots.length}</span>}{active && <ChevronRight size={14} className="opacity-60" />}</button>; })}</nav>
        <div className="space-y-3 border-t border-white/8 p-4"><div className="rounded-xl border border-white/8 bg-white/[0.025] p-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-300"><HardDrive size={14} className="text-emerald-300" />Local workspace</div><p className="mt-1.5 text-[11px] leading-5 text-slate-500">No account. No database. Your data stays in this browser.</p><div className="mt-2 flex items-center gap-1.5 text-[11px]">{host.storage.status === 'saving' ? <Loader2 size={12} className="animate-spin text-sky-300" /> : host.storage.status === 'error' ? <AlertTriangle size={12} className="text-rose-300" /> : <Check size={12} className="text-emerald-300" />}<span className={host.storage.status === 'error' ? 'text-rose-300' : 'text-slate-400'}>{host.storage.status === 'saving' ? 'Saving…' : host.storage.status === 'error' ? 'Storage unavailable' : 'All changes saved'}</span></div></div><div className="flex items-center justify-between px-1 text-[10px] text-slate-600"><span>BotHost Serverless v2.0</span><span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{host.activeCount}/3 live</span></div></div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/8 bg-[#0a0e14]/85 px-4 backdrop-blur-xl sm:px-6"><div className="flex items-center gap-3"><button className="icon-btn lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="flex items-center gap-2 text-sm"><span className="hidden text-slate-500 sm:inline">Workspace</span><ChevronRight size={14} className="hidden text-slate-600 sm:inline" /><span className="font-medium text-slate-200">{current?.label}</span></div></div><div className="flex items-center gap-3"><span className="hidden items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-400 sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${host.activeCount ? 'bg-emerald-400' : 'bg-slate-600'}`} />Browser runtime</span><button className="icon-btn" title="Open settings" aria-label="Help and runtime information" onClick={() => navigate('settings')}><CircleHelp size={17} /></button><div className="grid h-8 w-8 place-items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 text-xs font-semibold text-emerald-300">BH</div></div></header>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
          {host.storage.status === 'error' && <div className="mb-5 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-xs leading-5 text-rose-200"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{host.storage.error}</div>}
          {!host.ready ? <div className="grid min-h-[50vh] place-items-center text-sm text-slate-400"><span className="flex items-center gap-2"><Loader2 size={17} className="animate-spin text-emerald-300" />Restoring local workspace…</span></div> : <>
            {page === 'overview' && <Overview host={host} notify={notify} navigate={navigate} />}
            {page === 'studio' && <Studio host={host} notify={notify} />}
            {page === 'fleet' && <Fleet host={host} notify={notify} navigate={navigate} />}
            {page === 'logs' && <Logs host={host} notify={notify} />}
            {page === 'requirements' && <div className="space-y-6"><div><h1 className="page-title">Requirements Detector</h1><p className="page-subtitle">Imports are parsed from the current Studio draft and mapped to pip packages.</p></div><div className="grid gap-6 lg:grid-cols-[1fr_360px]"><RequirementsPanel draft={host.state.draft} setDraft={host.setDraft} notify={notify} /><div className="card p-5 text-sm leading-6 text-slate-400"><h3 className="mb-3 font-semibold text-white">How detection works</h3><ol className="list-decimal space-y-2 pl-4 text-xs leading-5"><li>Comments and string literals are masked before regex import extraction.</li><li><code>import x</code>, aliases, comma lists and <code>from x import y</code> are recognized.</li><li>Standard-library modules are excluded; common import names are mapped to their pip distribution names.</li><li>Tested Telegram packages are pinned. You can override the generated file or add pure-Python extras.</li><li>Pyodide compiles the script before deployment; micropip resolves packages at runtime.</li></ol><button className="btn-secondary mt-5" onClick={() => navigate('studio')}><Code2 size={15} />Back to Studio</button></div></div></div>}
            {page === 'settings' && <Settings host={host} notify={notify} />}
          </>}
        </main>
      </div>
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
