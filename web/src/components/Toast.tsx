/**
 * Lightweight toasts: call toast({ title, message }) from anywhere; one <ToastHost /> (mounted in App) renders them.
 * Announced politely to screen readers, auto-dismiss after a few seconds (paused while hovered), stack top-right (below the header on wide screens).
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Info, X } from 'lucide-react';

type Tone = 'success' | 'info';
type Toast = { id: number; title: string; message?: string; tone: Tone };

let push: ((t: Omit<Toast, 'id'>) => void) | null = null;
let seq = 0;

export function toast({ title, message, tone = 'success' }: { title: string; message?: string; tone?: Tone }) {
  push?.({ title, message, tone });
}

const TTL = 4000;

function Item({ t, onClose }: { t: Toast; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(TTL);
  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const timer = window.setTimeout(onClose, left.current);
    return () => { window.clearTimeout(timer); left.current -= Date.now() - start; };
  }, [paused]);
  const I = t.tone === 'success' ? CheckCircle2 : Info;
  return (
    <div role="status" className="toast pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-white p-3.5 pr-2.5 shadow-xl shadow-slate-900/10 sm:w-[360px]"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <I className={`mt-0.5 h-5 w-5 shrink-0 ${t.tone === 'success' ? 'text-emerald-600' : 'text-sky-600'}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-navy">{t.title}</p>
        {t.message && <p className="mt-0.5 text-[13px] leading-snug text-slate-600">{t.message}</p>}
      </div>
      <button type="button" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Dismiss" onClick={onClose}>
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => setItems((xs) => [...xs.slice(-2), { ...t, id: ++seq }]);
    return () => { push = null; };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 top-4 z-[70] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 lg:top-[calc(var(--hdr-full,90px)+0.75rem)]">
      {items.map((t) => <Item key={t.id} t={t} onClose={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} />)}
    </div>
  );
}
