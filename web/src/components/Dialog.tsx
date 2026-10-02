/**
 * In-app replacement for window.confirm / window.prompt. Promise-based so call sites stay one-liners:
 *   if (await confirmDialog({ title, message })) …
 *   const reason = await promptDialog({ title, defaultValue });  // null when cancelled
 * A single <DialogHost /> (mounted in App) renders whichever request is pending.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';

type Tone = 'default' | 'danger';
type Base = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; tone?: Tone };
type Req =
  | (Base & { kind: 'confirm'; resolve: (v: boolean) => void })
  | (Base & { kind: 'prompt'; label?: string; defaultValue?: string; placeholder?: string; resolve: (v: string | null) => void });

let show: ((r: Req) => void) | null = null;

export function confirmDialog(opts: Base): Promise<boolean> {
  if (!show) return Promise.resolve(window.confirm(opts.message ?? opts.title));
  return new Promise((resolve) => show!({ ...opts, kind: 'confirm', resolve }));
}

export function promptDialog(opts: Base & { label?: string; defaultValue?: string; placeholder?: string }): Promise<string | null> {
  if (!show) return Promise.resolve(window.prompt(opts.message ?? opts.title, opts.defaultValue));
  return new Promise((resolve) => show!({ ...opts, kind: 'prompt', resolve }));
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [value, setValue] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    show = (r) => { setValue(r.kind === 'prompt' ? r.defaultValue ?? '' : ''); setReq(r); };
    return () => { show = null; };
  }, []);

  const close = (ok: boolean) => {
    if (!req) return;
    if (req.kind === 'confirm') req.resolve(ok);
    else req.resolve(ok && value.trim() ? value.trim() : null);
    setReq(null);
  };

  // Focus the primary control on open; restore focus to the trigger on close.
  useEffect(() => {
    if (!req) return;
    const prev = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => { if (req.kind === 'prompt') { input.current?.focus(); input.current?.select(); } else confirmBtn.current?.focus(); });
    return () => prev?.focus?.();
  }, [req]);

  if (!req) return null;
  const danger = req.tone === 'danger';
  const I = danger ? AlertTriangle : HelpCircle;
  const disabled = req.kind === 'prompt' && !value.trim();

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(false); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const f = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (!disabled) close(true); };

  return (
    <div className="dialog-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }} onKeyDown={onKey}>
      <div ref={panel} role={danger ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={titleId} aria-describedby={req.message ? descId : undefined}
        className="dialog-panel relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-white shadow-2xl shadow-slate-900/20">
        <form onSubmit={submit}>
          <div className="flex gap-4 p-5 sm:p-6">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${danger ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-100' : 'bg-teal-50 text-brand ring-1 ring-teal-100'}`}>
              <I className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 id={titleId} className="text-base font-semibold text-navy">{req.title}</h2>
              {req.message && <p id={descId} className="mt-1.5 text-sm leading-relaxed text-slate-600">{req.message}</p>}
              {req.kind === 'prompt' && (
                <label className="mt-4 block">
                  {req.label && <span className="mb-1.5 block text-xs font-medium text-slate-600">{req.label}</span>}
                  <input ref={input} className="input w-full" value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} />
                </label>
              )}
            </div>
            <button type="button" className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close" onClick={() => close(false)}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-slate-50/70 px-5 py-3.5 sm:flex-row sm:justify-end sm:px-6">
            <button type="button" className="btn-secondary" onClick={() => close(false)}>{req.cancelLabel ?? 'Cancel'}</button>
            <button ref={confirmBtn} type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={disabled}>{req.confirmLabel ?? 'Confirm'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
