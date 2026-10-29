import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal, Download, Trash2, ArrowDownToLine, Search, Radio, Pause } from 'lucide-react';
import { downloadText } from '../lib/storage.js';
import { EmptyState, formatTime, StatusBadge } from './ui.jsx';

const LEVELS = ['all', 'message', 'command', 'api', 'output', 'info', 'warn', 'error'];
const COLORS = { message: 'text-sky-300 bg-sky-400/10', command: 'text-violet-300 bg-violet-400/10', api: 'text-cyan-300 bg-cyan-400/10', output: 'text-emerald-300 bg-emerald-400/10', info: 'text-slate-400 bg-slate-400/10', warn: 'text-amber-300 bg-amber-400/10', error: 'text-rose-300 bg-rose-400/10' };

export default function Logs({ host, notify, compact = false }) {
  const [level, setLevel] = useState('all');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef(null);
  const bot = host.state.bots.find((item) => item.id === host.state.selectedBotId) || host.state.bots[0];
  const logs = useMemo(() => (bot?.logs || []).filter((log) => (level === 'all' || log.level === level) && log.message.toLowerCase().includes(query.toLowerCase())), [bot, level, query]);
  useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs.length, follow, bot?.id]);

  const exportLogs = () => {
    if (!bot) return;
    downloadText(`${bot.name.replace(/[^\w.-]+/g, '-')}-logs.txt`, bot.logs.map((log) => `[${new Date(log.at).toISOString()}] ${log.level.toUpperCase()} ${log.message}`).join('\n'));
    notify('success', 'Logs exported. Tokens are redacted.');
  };

  return (
    <div className="space-y-5">
      {!compact && <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="page-title">Live Audit Logs</h1><p className="page-subtitle">Incoming messages, commands, Telegram API calls and Python output.</p></div>{bot && <StatusBadge status={bot.status} />}</div>}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2"><Terminal size={16} className="text-emerald-300" /><h2 className="text-sm font-semibold text-white">{compact ? 'Recent activity' : 'Log stream'}</h2>{bot && <span className="chip font-mono">{bot.name}</span>}</div>
          <div className="flex flex-wrap items-center gap-2">
            {!compact && <select aria-label="Select bot" className="input w-auto py-2 text-xs" value={bot?.id || ''} onChange={(event) => host.selectBot(event.target.value)}>{host.state.bots.length === 0 && <option value="">No bots</option>}{host.state.bots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search logs" className="input w-36 py-2 pl-7 text-xs" placeholder="Filter logs…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <select aria-label="Filter log level" className="input w-auto py-2 text-xs" value={level} onChange={(event) => setLevel(event.target.value)}>{LEVELS.map((item) => <option key={item} value={item}>{item === 'all' ? 'All levels' : item.toUpperCase()}</option>)}</select>
            <button className={`icon-btn ${follow ? 'text-emerald-300' : ''}`} title={follow ? 'Pause auto-scroll' : 'Follow latest logs'} aria-label={follow ? 'Pause auto-scroll' : 'Follow latest logs'} onClick={() => setFollow(!follow)}>{follow ? <ArrowDownToLine size={15} /> : <Pause size={15} />}</button>
            <button className="icon-btn" title="Export logs" aria-label="Export logs" disabled={!bot} onClick={exportLogs}><Download size={15} /></button>
            <button className="icon-btn hover:text-rose-300" title="Clear logs" aria-label="Clear logs" disabled={!bot} onClick={() => { host.clearLogs(bot.id); notify('info', 'Log buffer cleared.'); }}><Trash2 size={15} /></button>
          </div>
        </div>
        <div ref={scrollRef} className={`${compact ? 'h-72' : 'h-[520px]'} overflow-auto bg-[#090e14] p-3 font-mono text-xs leading-6`}>
          {logs.length === 0 ? <EmptyState icon={Radio} title={bot ? 'No matching log entries' : 'No bot selected'} description={bot ? 'Deploy or resume this bot, then send it a message on Telegram. Activity appears here in real time.' : 'Deploy a bot from the Code Studio to start streaming logs.'} /> : logs.slice(compact ? -8 : -500).map((log) => <div key={log.id} className="flex gap-3 rounded px-2 py-1 hover:bg-white/[0.025]"><span className="shrink-0 select-none text-slate-600">{formatTime(log.at)}</span><span className={`mt-1 h-fit shrink-0 rounded px-1.5 py-0 text-[10px] leading-4 ${COLORS[log.level] || COLORS.info}`}>{log.level.toUpperCase()}</span><span className="min-w-0 break-words text-slate-300">{log.message}{log.command && <span className="ml-2 rounded bg-violet-400/10 px-1.5 text-[10px] text-violet-300">{log.command}</span>}</span></div>)}
        </div>
        <div className="flex items-center justify-between border-t border-white/8 px-4 py-2.5 text-[11px] text-slate-500"><span>{logs.length} entries · buffer keeps the latest 500 per bot</span><span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${follow ? 'bg-emerald-400' : 'bg-slate-600'}`} />{follow ? 'Following live' : 'Auto-scroll paused'}</span></div>
      </section>
    </div>
  );
}
