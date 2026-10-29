import { Activity, AlertTriangle, BatteryCharging, Bell, Bot, Check, Crown, Download, Eye, Gauge, HardDrive, Maximize2, Minimize2, MonitorSmartphone, Power, Radio, RefreshCw, ShieldCheck, ShieldOff, Sparkles, Volume2, VolumeX, Wifi, WifiOff, Zap } from 'lucide-react';
import { formatDuration, isActive } from '../lib/autopilot.js';
import { EmptyState, StatusBadge, timeAgo } from './ui.jsx';

function Toggle({ checked, onChange, label, description, icon: Icon, disabled = false }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${checked ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : 'border-white/8 bg-white/[0.02] hover:border-white/15'} ${disabled ? 'opacity-50' : ''}`}>
      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${checked ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-white/8 bg-white/[0.03] text-slate-400'}`}><Icon size={16} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-100">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span>
      <span className={`mt-1 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? 'bg-emerald-400' : 'bg-white/10'}`}><span className={`h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : ''}`} /></span>
    </button>
  );
}

function Capability({ icon: Icon, label, value, ok, hint }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-medium text-slate-300"><Icon size={15} className={ok ? 'text-emerald-300' : 'text-slate-500'} />{label}</span><span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-600'}`} /></div>
      <p className={`mt-2 text-sm font-semibold ${ok ? 'text-emerald-300' : 'text-slate-400'}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-4 text-slate-500">{hint}</p>}
    </div>
  );
}

export default function Autopilot({ host, autopilot, notify, navigate }) {
  const stats = host.state.autopilotStats;
  const events = [...host.state.autopilotEvents].reverse();
  const targets = host.state.bots.filter((bot) => bot.desiredRunning);
  const ap = autopilot;
  const armed = ap.enabled;
  const leader = ap.leader || !ap.settings.leaderOnly;

  const toggleTarget = (bot) => {
    const next = !bot.desiredRunning;
    host.setDesiredRunning(bot.id, next);
    if (next && !isActive(bot)) {
      const result = host.resume(bot.id);
      if (result?.ok === false) notify('error', result.error);
    }
    notify(next ? 'success' : 'info', next ? `${bot.name} added to Autopilot targets.` : `${bot.name} removed from Autopilot targets.`);
  };

  return (
    <div className="space-y-6">
      <section className={`relative overflow-hidden rounded-2xl border p-6 sm:p-8 ${armed ? 'border-emerald-400/25 bg-gradient-to-br from-[#0e1f1a] via-[#101720] to-[#0f151d]' : 'border-white/8 bg-gradient-to-br from-[#121c22] via-[#101720] to-[#0f151d]'}`}>
        <div className={`pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl ${armed ? 'bg-emerald-400/15' : 'bg-slate-400/5'}`} />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <div className={`mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium ${armed ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-slate-400'}`}>
              {armed ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}{armed ? 'Uptime Shield armed' : 'Uptime Shield standby'}
            </div>
            <h1 className="page-title flex items-center gap-3"><Sparkles size={24} className={armed ? 'text-emerald-300' : 'text-slate-500'} />Autopilot</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">A self-healing control layer for your browser workers: leader election, wake lock, watchdog restarts, auto-resume, offline app shell and uptime telemetry. Built entirely inside this app — no VM, no runner, no extra service.</p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              <span className={`chip ${leader ? 'border-amber-400/25 text-amber-300' : ''}`}><Crown size={12} />{leader ? 'Leader tab' : 'Follower tab'}</span>
              <span className="chip"><Radio size={12} />{ap.peers} tab{ap.peers === 1 ? '' : 's'} detected</span>
              <span className={`chip ${ap.online ? 'text-emerald-300' : 'text-rose-300'}`}>{ap.online ? <Wifi size={12} /> : <WifiOff size={12} />}{ap.online ? 'Online' : 'Offline'}</span>
              <span className="chip"><Eye size={12} />{ap.visible ? 'Visible' : 'Background'}</span>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2">
            <button className={armed ? 'btn-danger' : 'btn-primary'} onClick={armed ? ap.disarm : ap.arm}>{armed ? <Power size={16} /> : <Zap size={16} />}{armed ? 'Disarm Autopilot' : 'Arm Autopilot'}</button>
            <button className="btn-secondary" onClick={ap.toggleFullscreen}>{ap.fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{ap.fullscreen ? 'Exit kiosk' : 'Kiosk / fullscreen'}</button>
            <button className="btn-secondary" onClick={ap.install}><Download size={15} />{ap.canInstall ? 'Install app' : 'Install / Add to Home Screen'}</button>
          </div>
        </div>
        <div className="relative mt-6 grid gap-4 border-t border-white/8 pt-5 sm:grid-cols-4">
          <div><p className="text-[11px] uppercase tracking-wider text-slate-500">Shield uptime</p><p className="mt-1 font-mono text-lg text-white">{formatDuration(stats.uptimeMs)}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-slate-500">Recoveries</p><p className="mt-1 font-mono text-lg text-white">{stats.recoveries}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-slate-500">Sessions</p><p className="mt-1 font-mono text-lg text-white">{stats.sessions}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-slate-500">Targets</p><p className="mt-1 font-mono text-lg text-white">{targets.length} / {host.state.bots.length}</p></div>
        </div>
      </section>

      <section className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-sm leading-6 text-amber-100/90">
        <div className="flex gap-3"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" /><div><p className="font-semibold text-amber-200">The honest boundary</p><p className="mt-1 text-xs leading-5 text-amber-100/80">Autopilot can keep a <strong>spare device/browser that stays open</strong> alive 24/7: it resists sleep, restarts crashed workers, resumes after reloads and fails over between tabs. It cannot execute Python after the browser/device is fully closed, the OS kills it, or power/network is gone. No browser-only system can. For true closed-browser hosting you still need a server/runner; this mode is the maximum possible without external infrastructure.</p></div></div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Capability icon={Crown} label="Leader election" value={ap.lockMode === 'web-locks' ? 'Web Locks' : ap.lockMode === 'lease' ? 'Lease fallback' : ap.lockMode === 'single-tab' ? 'Single-tab mode' : 'Off'} ok={armed && leader} hint={ap.lockMode === 'web-locks' ? 'One elected tab owns the workers.' : 'Prevents duplicate Telegram polling.'} />
        <Capability icon={BatteryCharging} label="Screen wake lock" value={ap.wakeLockActive ? 'Holding screen awake' : ap.settings.wakeLock ? 'Waiting / unsupported' : 'Disabled'} ok={ap.wakeLockActive} hint="Re-acquired when the tab becomes visible." />
        <Capability icon={HardDrive} label="Persistent storage" value={ap.persisted ? 'Granted' : 'Best-effort'} ok={ap.persisted} hint="Requests protection from browser eviction." />
        <Capability icon={MonitorSmartphone} label="Offline app shell" value={ap.swStatus === 'active' ? 'Service worker active' : ap.swStatus === 'registered' ? 'Registered' : 'Production only'} ok={ap.swStatus === 'active'} hint="Caches UI/runtime/wheels, never /api." />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="card p-5">
          <div className="mb-4 flex items-center gap-2"><Gauge size={17} className="text-emerald-300" /><h2 className="text-sm font-semibold text-white">Shield controls</h2></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle icon={RefreshCw} label="Auto-resume" description="Resume desired bots after reload, crash, failover or network recovery." checked={ap.settings.autoResume} onChange={(v) => ap.updateSetting('autoResume', v)} />
            <Toggle icon={Activity} label="Watchdog" description="Restart workers on heartbeat timeout, startup stall or transient errors with exponential backoff." checked={ap.settings.watchdog} onChange={(v) => ap.updateSetting('watchdog', v)} />
            <Toggle icon={BatteryCharging} label="Wake lock" description="Ask the OS to keep the screen awake while this leader tab is visible." checked={ap.settings.wakeLock} onChange={(v) => ap.updateSetting('wakeLock', v)} />
            <Toggle icon={Crown} label="Leader-only workers" description="Only the elected leader tab runs bots. Followers stay hot for instant failover." checked={ap.settings.leaderOnly} onChange={(v) => ap.updateSetting('leaderOnly', v)} />
            <Toggle icon={Bell} label="Notifications" description="Notify when Autopilot recovers a bot while the tab is hidden." checked={ap.settings.notifications} onChange={(v) => v ? ap.requestNotifications() : ap.updateSetting('notifications', false)} />
            <Toggle icon={ap.audioActive ? Volume2 : VolumeX} label="Audio keepalive" description="Optional near-silent 20 Hz tone to reduce background tab throttling. Uses a little CPU/battery." checked={ap.settings.silentAudio} onChange={async (v) => { ap.updateSetting('silentAudio', v); if (v) await ap.startAudio(); else ap.stopAudio(); }} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => { ap.sweep('manual'); notify('info', 'Manual recovery sweep completed.'); }}><RefreshCw size={15} />Run recovery sweep</button>
            <button className="btn-secondary" onClick={ap.requestPersistence}><HardDrive size={15} />Request persistent storage</button>
            {ap.settings.silentAudio && !ap.audioActive && <button className="btn-secondary" onClick={ap.startAudio}><Volume2 size={15} />Arm audio keepalive</button>}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-slate-500">Recovery backoff: 5s → 10s → 20s → 40s → … capped at 5 minutes. Permanent errors (bad token, syntax, unsupported framework, webhook conflict) disable automatic retries until you fix and resume the bot. Healthy polling for 5 minutes resets the backoff.</p>
        </section>

        <section className="card flex flex-col p-5">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><Bot size={17} className="text-sky-300" /><h2 className="text-sm font-semibold text-white">Autopilot targets</h2></div><span className="chip">{targets.length}</span></div>
          {host.state.bots.length === 0 ? <EmptyState icon={Bot} title="No bots yet" description="Deploy a bot, then mark it as an Autopilot target." action={<button className="btn-primary" onClick={() => navigate('studio')}><Zap size={15} />Open Studio</button>} /> : (
            <div className="space-y-2 overflow-y-auto">
              {host.state.bots.map((bot) => (
                <div key={bot.id} className={`rounded-xl border p-3 ${bot.desiredRunning ? 'border-emerald-400/20 bg-emerald-400/[0.04]' : 'border-white/8 bg-white/[0.02]'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <button className="min-w-0 text-left" onClick={() => { host.selectBot(bot.id); navigate('logs'); }}><span className="block truncate text-sm font-medium text-slate-100">{bot.name}</span><span className="block truncate text-[11px] text-slate-500">{bot.username ? `@${bot.username}` : bot.framework || 'Python bot'}</span></button>
                    <button role="switch" aria-checked={bot.desiredRunning} aria-label={`Autopilot target ${bot.name}`} onClick={() => toggleTarget(bot)} className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${bot.desiredRunning ? 'bg-emerald-400' : 'bg-white/10'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition ${bot.desiredRunning ? 'translate-x-5' : ''}`} /></button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><StatusBadge status={bot.status} /><span>restarts: {bot.restartCount || 0}</span><span>beat: {bot.lastHeartbeat ? timeAgo(bot.lastHeartbeat) : '—'}</span>{bot.nextRetryAt > Date.now() && <span className="text-amber-300">retry {timeAgo(bot.nextRetryAt)}</span>}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3"><div className="flex items-center gap-2"><Activity size={16} className="text-violet-300" /><h2 className="text-sm font-semibold text-white">Shield event feed</h2><span className="chip">{events.length}</span></div><button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => { host.clearAutopilotEvents(); notify('info', 'Autopilot events cleared.'); }}>Clear</button></div>
        {events.length === 0 ? <div className="px-4 py-10 text-center text-sm text-slate-500">No Autopilot events yet. Arm the shield to begin.</div> : (
          <div className="max-h-80 divide-y divide-white/5 overflow-y-auto font-mono text-xs">
            {events.map((event) => <div key={event.id} className="flex gap-3 px-4 py-2.5"><span className="shrink-0 text-slate-600">{new Date(event.at).toLocaleTimeString(undefined,{hour12:false})}</span><span className={`shrink-0 uppercase ${event.level === 'error' ? 'text-rose-300' : event.level === 'warn' ? 'text-amber-300' : 'text-emerald-300'}`}>{event.level}</span><span className="text-slate-300">{event.message}</span></div>)}
          </div>
        )}
      </section>

      <section className="card p-5 text-xs leading-6 text-slate-500">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Check size={15} className="text-emerald-300" />Diagnostics</h3>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          <span>Tab ID: <code className="text-slate-300">{ap.tabId}</code></span>
          <span>Lock mode: <code className="text-slate-300">{ap.lockMode}</code></span>
          <span>Notification permission: <code className="text-slate-300">{ap.notificationPermission}</code></span>
          <span>Leader since: <code className="text-slate-300">{stats.leaderSince ? new Date(stats.leaderSince).toLocaleString() : '—'}</code></span>
          <span>Last armed: <code className="text-slate-300">{stats.lastStartedAt ? new Date(stats.lastStartedAt).toLocaleString() : '—'}</code></span>
          <span>Storage backend: <code className="text-slate-300">{host.storage.backend}</code></span>
        </div>
      </section>
    </div>
  );
}
