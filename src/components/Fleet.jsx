import { useMemo, useState } from 'react';
import { Bot, Search, Pause, Play, RotateCw, Trash2, Terminal, Copy, Eye, EyeOff, Plus, Filter, ShieldCheck, ShieldOff } from 'lucide-react';
import { maskToken } from '../lib/analysis.js';
import { downloadText } from '../lib/storage.js';
import { EmptyState, Modal, StatusBadge, timeAgo } from './ui.jsx';

export default function Fleet({ host, notify, navigate, compact = false }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [revealed, setRevealed] = useState({});
  const [deleting, setDeleting] = useState(null);
  const bots = useMemo(() => host.state.bots.filter((bot) => {
    const matchesQuery = `${bot.name} ${bot.username} ${bot.framework}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === 'all' || bot.status === status);
  }), [host.state.bots, query, status]);

  const act = (result, success) => {
    if (result?.ok === false) notify('error', result.error);
    else if (success) notify('success', success);
  };

  const copyToken = async (token) => {
    try { await navigator.clipboard.writeText(token); notify('success', 'Token copied. Keep it private.'); }
    catch { notify('error', 'Clipboard access was blocked.'); }
  };

  return (
    <div className="space-y-5">
      {!compact && <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="page-title">Bot Fleet</h1><p className="page-subtitle">Every deployed bot, its health and its controls in one place.</p></div><button className="btn-primary" onClick={() => navigate('studio')}><Plus size={16} />New bot</button></div>}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2"><Bot size={16} className="text-emerald-300" /><h2 className="text-sm font-semibold text-white">{compact ? 'Your bots' : 'Deployed bots'}</h2><span className="chip">{host.state.bots.length}</span></div>
          <div className="flex flex-wrap gap-2">
            <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search bots" className="input w-48 py-2 pl-8 text-xs" placeholder="Search bots…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <div className="relative"><Filter size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" /><select aria-label="Filter by status" className="input w-auto py-2 pl-7 text-xs" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="running">Running</option><option value="paused">Paused</option><option value="error">Error</option><option value="connecting">Connecting</option><option value="installing">Installing</option><option value="stopped">Stopped</option></select></div>
          </div>
        </div>
        {bots.length === 0 ? <EmptyState icon={Bot} title={host.state.bots.length ? 'No bots match this filter' : 'No bots deployed yet'} description={host.state.bots.length ? 'Try a different search or status.' : 'Open the Code Studio, paste a Python bot and deploy it in a few seconds.'} action={!host.state.bots.length && <button className="btn-primary" onClick={() => navigate('studio')}><Plus size={15} />Create your first bot</button>} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead><tr className="border-b border-white/8 bg-white/[0.015] text-[11px] uppercase tracking-wider text-slate-500"><th className="px-4 py-3 font-medium">Bot</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Token</th><th className="px-4 py-3 font-medium">Deployed</th><th className="px-4 py-3 text-right font-medium">Messages</th><th className="px-4 py-3 text-right font-medium">Errors</th><th className="px-4 py-3 text-right font-medium">Actions</th></tr></thead>
              <tbody className="divide-y divide-white/5">{bots.map((bot) => {
                const active = ['running', 'connecting', 'installing', 'validating'].includes(bot.status);
                return <tr key={bot.id} className={`group transition hover:bg-white/[0.02] ${host.state.selectedBotId === bot.id ? 'bg-emerald-400/[0.025]' : ''}`}>
                  <td className="px-4 py-3.5"><button className="flex items-center gap-3 text-left" onClick={() => { host.selectBot(bot.id); navigate('logs'); }}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/8 bg-gradient-to-br from-emerald-400/15 to-sky-400/10 text-emerald-300"><Bot size={17} /></span><span><span className="block font-medium text-slate-100">{bot.name}</span><span className="block text-xs text-slate-500">{bot.username ? `@${bot.username}` : bot.framework || 'Python bot'}</span></span></button></td>
                  <td className="px-4 py-3.5"><div className="flex flex-col items-start gap-1.5"><StatusBadge status={bot.status} />{bot.desiredRunning && <span className="chip border-emerald-400/20 bg-emerald-400/5 text-emerald-300"><ShieldCheck size={10} />keep-running</span>}</div></td>
                  <td className="px-4 py-3.5"><div className="flex items-center gap-1"><code className="max-w-[160px] truncate text-xs text-slate-400" title={revealed[bot.id] ? bot.token : 'Token hidden'}>{revealed[bot.id] ? bot.token : maskToken(bot.token)}</code><button className="icon-btn h-6 w-6" aria-label={revealed[bot.id] ? 'Hide token' : 'Reveal token'} onClick={() => setRevealed((current) => ({ ...current, [bot.id]: !current[bot.id] }))}>{revealed[bot.id] ? <EyeOff size={12} /> : <Eye size={12} />}</button><button className="icon-btn h-6 w-6" aria-label="Copy token" onClick={() => copyToken(bot.token)}><Copy size={12} /></button></div></td>
                  <td className="px-4 py-3.5 text-xs text-slate-400" title={new Date(bot.deployedAt || bot.createdAt).toLocaleString()}>{timeAgo(bot.deployedAt || bot.createdAt)}</td>
                  <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-200">{bot.messages.toLocaleString()}</td>
                  <td className="px-4 py-3.5 text-right font-mono text-xs"><span className={bot.errors ? 'text-rose-300' : 'text-slate-500'}>{bot.errors}</span></td>
                  <td className="px-4 py-3.5"><div className="flex justify-end gap-1">
                    <button className={`icon-btn ${bot.desiredRunning ? 'text-emerald-300' : 'text-slate-500'}`} title={bot.desiredRunning ? 'Remove from Autopilot keep-running' : 'Mark keep-running for Autopilot'} aria-label={`Autopilot ${bot.name}`} onClick={() => { host.setDesiredRunning(bot.id, !bot.desiredRunning); notify('info', bot.desiredRunning ? `${bot.name} removed from Autopilot targets.` : `${bot.name} marked keep-running. Arm Autopilot to guard it while a tab is open.`); }}>{bot.desiredRunning ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}</button>
                    {active ? <button className="icon-btn" title="Pause bot" aria-label={`Pause ${bot.name}`} onClick={() => { host.pause(bot.id); notify('info', `${bot.name} paused.`); }}><Pause size={15} /></button> : <button className="icon-btn text-emerald-300" title="Resume bot" aria-label={`Resume ${bot.name}`} onClick={() => act(host.resume(bot.id), `${bot.name} is reconnecting.`)}><Play size={15} /></button>}
                    <button className="icon-btn" title="Restart bot (flush logs)" aria-label={`Restart ${bot.name}`} onClick={() => act(host.restart(bot.id), `${bot.name} restarted. Logs flushed.`)}><RotateCw size={15} /></button>
                    <button className="icon-btn" title="View logs" aria-label={`View logs for ${bot.name}`} onClick={() => { host.selectBot(bot.id); navigate('logs'); }}><Terminal size={15} /></button>
                    <button className="icon-btn hover:text-rose-300" title="Delete bot" aria-label={`Delete ${bot.name}`} onClick={() => setDeleting(bot)}><Trash2 size={15} /></button>
                  </div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        {!compact && bots.length > 0 && <div className="flex items-center justify-between border-t border-white/8 px-4 py-3 text-xs text-slate-500"><span>{bots.length} of {host.state.bots.length} bots · {host.activeCount}/3 workers active</span><button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => downloadText('bothost-fleet.json', JSON.stringify(bots.map(({ token, ...rest }) => rest), null, 2), 'application/json')}>Export metadata</button></div>}
      </section>
      {deleting && <Modal title={`Delete ${deleting.name}?`} onClose={() => setDeleting(null)} footer={<><button className="btn-secondary" onClick={() => setDeleting(null)}>Cancel</button><button className="btn-danger" onClick={() => { host.remove(deleting.id); notify('success', `${deleting.name} deleted from this browser.`); setDeleting(null); }}><Trash2 size={15} />Delete bot</button></>}><p className="leading-6">This stops the worker and permanently removes the bot’s code, token, metrics and logs from this browser. It does not delete the bot in BotFather or affect Telegram’s servers.</p></Modal>}
    </div>
  );
}
