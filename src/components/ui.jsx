import { useEffect, useRef } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, Inbox } from 'lucide-react';

export function StatusBadge({ status }) {
  const map = {
    running: ['bg-emerald-400', 'Running', 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'],
    connecting: ['bg-sky-400 animate-pulse', 'Connecting', 'text-sky-300 bg-sky-400/10 border-sky-400/20'],
    installing: ['bg-sky-400 animate-pulse', 'Installing', 'text-sky-300 bg-sky-400/10 border-sky-400/20'],
    validating: ['bg-amber-400 animate-pulse', 'Validating', 'text-amber-300 bg-amber-400/10 border-amber-400/20'],
    paused: ['bg-amber-400', 'Paused', 'text-amber-300 bg-amber-400/10 border-amber-400/20'],
    stopped: ['bg-slate-500', 'Stopped', 'text-slate-300 bg-slate-400/10 border-slate-400/20'],
    error: ['bg-rose-400', 'Error', 'text-rose-300 bg-rose-400/10 border-rose-400/20'],
    draft: ['bg-slate-500', 'Draft', 'text-slate-300 bg-slate-400/10 border-slate-400/20'],
    completed: ['bg-emerald-400', 'Completed', 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'],
    idle: ['bg-slate-500', 'Idle', 'text-slate-300 bg-slate-400/10 border-slate-400/20'],
  };
  const [dot, label, classes] = map[status] || map.stopped;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${classes}`}><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{label}</span>;
}

export function Modal({ title, children, onClose, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#121821] shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={17} /></button>
        </div>
        <div className="px-5 py-4 text-sm text-slate-300">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-white/8 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-white/8 bg-white/[0.03] text-slate-400"><Icon size={22} /></div>
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Toasts({ toasts, dismiss }) {
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'error' ? AlertTriangle : toast.kind === 'success' ? CheckCircle2 : Info;
        const color = toast.kind === 'error' ? 'text-rose-300 border-rose-400/25' : toast.kind === 'success' ? 'text-emerald-300 border-emerald-400/25' : 'text-sky-300 border-sky-400/25';
        return <div key={toast.id} className={`flex items-start gap-3 rounded-xl border bg-[#141b25]/95 p-3.5 shadow-xl backdrop-blur ${color}`}><Icon size={17} className="mt-0.5 shrink-0" /><p className="flex-1 text-sm leading-5 text-slate-200">{toast.message}</p><button onClick={() => dismiss(toast.id)} className="text-slate-500 hover:text-white" aria-label="Dismiss notification"><X size={15} /></button></div>;
      })}
    </div>
  );
}

export function timeAgo(timestamp) {
  if (!timestamp) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
