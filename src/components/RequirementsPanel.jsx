import { useMemo } from 'react';
import { Package, Copy, Download, RefreshCw, ShieldCheck, AlertTriangle, Sparkles } from 'lucide-react';
import { analyzeDependencies } from '../lib/analysis.js';
import { downloadText } from '../lib/storage.js';

export default function RequirementsPanel({ draft, setDraft, notify, compact = false }) {
  const analysis = useMemo(() => analyzeDependencies(draft.code), [draft.code]);
  const value = draft.autoRequirements ? analysis.requirements : draft.requirements;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value || '# No third-party dependencies detected');
      notify('success', 'requirements.txt copied to clipboard.');
    } catch {
      notify('error', 'Clipboard access was blocked. Use Download instead.');
    }
  };
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2"><Package size={16} className="text-emerald-300" /><h3 className="text-sm font-semibold text-white">Requirements detector</h3></div>
        <span className="chip"><Sparkles size={12} />Regex + Pyodide</span>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{analysis.packages.length} package{analysis.packages.length === 1 ? '' : 's'} detected</span>
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="accent-emerald-400" checked={draft.autoRequirements} onChange={(event) => setDraft({ autoRequirements: event.target.checked, requirements: event.target.checked ? analysis.requirements : value })} />Auto-generate</label>
        </div>
        <div className="rounded-lg border border-white/8 bg-[#0b1017]">
          <div className="flex items-center justify-between border-b border-white/8 px-3 py-2 text-[11px] text-slate-500"><span className="font-mono">requirements.txt</span><div className="flex gap-1"><button className="icon-btn h-6 w-6" title="Reset to detected requirements" onClick={() => setDraft({ autoRequirements: true, requirements: analysis.requirements })}><RefreshCw size={12} /></button><button className="icon-btn h-6 w-6" title="Copy requirements" onClick={copy}><Copy size={12} /></button><button className="icon-btn h-6 w-6" title="Download requirements.txt" onClick={() => downloadText('requirements.txt', value)}><Download size={12} /></button></div></div>
          <textarea aria-label="requirements.txt" spellCheck={false} value={value} onChange={(event) => setDraft({ requirements: event.target.value, autoRequirements: false })} rows={compact ? 4 : 6} className="w-full resize-y bg-transparent p-3 font-mono text-xs leading-6 text-emerald-200 outline-none placeholder:text-slate-600" placeholder="# No third-party dependencies detected" />
        </div>
        {!compact && analysis.packages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">{analysis.packages.map((pkg) => <span key={pkg.name} className="chip font-mono">{pkg.name}{pkg.pinned && <span className="text-emerald-300">pinned</span>}</span>)}</div>
        )}
        {analysis.blockers.map((blocker) => <div key={blocker.module} className="flex gap-2 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs leading-5 text-rose-200"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{blocker.message}</span></div>)}
        {analysis.warnings.map((warning, index) => <div key={index} className="flex gap-2 rounded-lg border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200/90"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{warning.message}</span></div>)}
        {analysis.blockers.length === 0 && analysis.packages.length > 0 && <div className="flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-300" /><span>Known Telegram packages are pinned to browser-tested versions. Pure-Python extras install from PyPI at deploy time.</span></div>}
      </div>
    </section>
  );
}
