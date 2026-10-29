import { Bot, Activity, MessageSquare, AlertTriangle, Plus, ArrowUpRight, Cpu, ShieldCheck, Zap } from 'lucide-react';
import Fleet from './Fleet.jsx';
import Logs from './Logs.jsx';

function Stat({ icon: Icon, label, value, hint, tone }) {
  const tones = { emerald: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/15', sky: 'text-sky-300 bg-sky-400/10 border-sky-400/15', violet: 'text-violet-300 bg-violet-400/10 border-violet-400/15', rose: 'text-rose-300 bg-rose-400/10 border-rose-400/15' };
  return <div className="card p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-slate-400">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div><span className={`grid h-10 w-10 place-items-center rounded-xl border ${tones[tone]}`}><Icon size={19} /></span></div></div>;
}

export default function Overview({ host, notify, navigate }) {
  const messages = host.state.bots.reduce((sum, bot) => sum + bot.messages, 0);
  const errors = host.state.bots.reduce((sum, bot) => sum + bot.errors, 0);
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-br from-[#121c22] via-[#101720] to-[#0f151d] p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium text-emerald-300"><Zap size={12} />Serverless bot studio</div><h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Your bot control room.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">Paste Python, detect dependencies, validate syntax and run Telegram bots in a private browser workspace. No account, no database, no setup.</p></div>
          <div className="flex gap-2"><button className="btn-secondary" onClick={() => navigate('logs')}>View logs<ArrowUpRight size={15} /></button><button className="btn-primary" onClick={() => navigate('studio')}><Plus size={16} />New bot</button></div>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/8 pt-4 text-xs text-slate-400"><span className="flex items-center gap-2"><Cpu size={14} className="text-emerald-300" />Pyodide Web Workers</span><span className="flex items-center gap-2"><ShieldCheck size={14} className="text-sky-300" />Local-only persistence</span><span className="flex items-center gap-2"><Activity size={14} className="text-violet-300" />{host.activeCount}/3 workers active</span></div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat icon={Bot} label="Total bots" value={host.state.bots.length} hint="Saved in this browser" tone="sky" /><Stat icon={Activity} label="Running now" value={host.activeCount} hint="Live browser workers" tone="emerald" /><Stat icon={MessageSquare} label="Messages received" value={messages.toLocaleString()} hint="Across all deployments" tone="violet" /><Stat icon={AlertTriangle} label="Errors logged" value={errors.toLocaleString()} hint="Lifetime error events" tone="rose" /></div>
      <Fleet host={host} notify={notify} navigate={navigate} compact />
      <Logs host={host} notify={notify} compact />
    </div>
  );
}
