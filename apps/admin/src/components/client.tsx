'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/errors';
import { Icon } from './icons';
import { Banner, Button, cx, type ButtonVariant } from './ui';

/* ------------------------------------------------------------------------------------------------
 * Toasts: a tiny event bus so any action can confirm what happened.
 * ---------------------------------------------------------------------------------------------- */
type Toast = { id: number; text: string; tone: 'success' | 'danger' };

export function toast(text: string, tone: Toast['tone'] = 'success') {
  window.dispatchEvent(new CustomEvent<Omit<Toast, 'id'>>('lf-toast', { detail: { text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent<Omit<Toast, 'id'>>).detail;
      const id = ++n;
      setItems((s) => [...s, { ...d, id }]);
      setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 5000);
    };
    window.addEventListener('lf-toast', on);
    return () => window.removeEventListener('lf-toast', on);
  }, []);
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(420px,calc(100vw-32px))]">
      {items.map((t) => (
        <div key={t.id} className={cx('flex items-center gap-2 rounded-md border-[1.5px] bg-surface p-3 shadow-lg type-label', t.tone === 'success' ? 'border-success text-success' : 'border-danger text-danger')}>
          <Icon name={t.tone === 'success' ? 'check' : 'alert'} size={18} />
          <span className="flex-1">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Modal dialog shell (native <dialog>, so focus trapping and Escape come for free).
 * ---------------------------------------------------------------------------------------------- */
function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className="m-auto rounded-lg border border-line bg-surface text-ink p-0 w-[min(520px,calc(100vw-32px))] shadow-xl">
      <div className="p-4 flex flex-col gap-3">
        <h2 id={titleId} className="type-heading">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Operator decisions always carry a written reason (as in the app's ReasonPrompt); dangerous ones
 * also need the operator to type a confirmation phrase.
 * ---------------------------------------------------------------------------------------------- */
export function ActionButton({
  label,
  action,
  variant = 'secondary',
  size = 'md',
  title,
  description,
  requireReason = true,
  reasonLabel = 'Reason (recorded in the audit log)',
  confirmPhrase,
  confirmLabel = 'Confirm',
  successMessage = 'Done',
  disabled,
  icon
}: {
  label: string;
  action: (reason: string) => Promise<ActionResult>;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  title?: string;
  description?: ReactNode;
  requireReason?: boolean;
  reasonLabel?: string;
  confirmPhrase?: string;
  confirmLabel?: string;
  successMessage?: string;
  disabled?: boolean;
  icon?: Parameters<typeof Icon>[0]['name'];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fieldId = useId();
  const reasonOk = !requireReason || reason.trim().length >= 5;
  const phraseOk = !confirmPhrase || phrase.trim() === confirmPhrase;

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await action(reason.trim());
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
      setReason('');
      setPhrase('');
      toast(r.message ?? successMessage);
      router.refresh();
    });

  return (
    <>
      <Button variant={variant} size={size} disabled={disabled || pending} onClick={() => { setError(null); setOpen(true); }}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {label}
      </Button>
      <Modal open={open} onClose={() => !pending && setOpen(false)} title={title ?? label}>
        {description ? <div className="type-body text-muted">{description}</div> : null}
        {requireReason ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${fieldId}-reason`} className="type-label">{reasonLabel}</label>
            <textarea
              id={`${fieldId}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              className="border-[1.5px] border-line rounded-md px-3 py-2 type-body bg-surface text-ink min-h-24 resize-y"
            />
            <span className="type-caption text-muted">{reason.length}/500 · at least 5 characters</span>
          </div>
        ) : null}
        {confirmPhrase ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${fieldId}-phrase`} className="type-label">
              Type <span className="font-mono">{confirmPhrase}</span> to confirm
            </label>
            <input
              id={`${fieldId}-phrase`}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              className="border-[1.5px] border-line rounded-md px-3 min-h-11 type-body bg-surface text-ink"
            />
          </div>
        ) : null}
        {error ? <Banner tone="danger" text={error} /> : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} disabled={!reasonOk || !phraseOk || pending} onClick={submit}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Switch (the app's Toggle), plus a version that asks for a reason before applying the change.
 * ---------------------------------------------------------------------------------------------- */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-line'
      )}>
      <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

export function ReasonSwitch({ checked, label, action, disabled, onLabel = 'On', offLabel = 'Off', describe }: {
  checked: boolean;
  label: string;
  action: (next: boolean, reason: string) => Promise<ActionResult>;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
  describe?: (next: boolean) => ReactNode;
}) {
  const router = useRouter();
  const [next, setNext] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  const submit = () =>
    start(async () => {
      if (next === null) return;
      setError(null);
      const r = await action(next, reason.trim());
      if (!r.ok) { setError(r.error); return; }
      toast(`${label}: ${next ? onLabel : offLabel}`);
      setNext(null);
      setReason('');
      router.refresh();
    });
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={cx('type-label', checked ? 'text-success' : 'text-muted')}>{checked ? onLabel : offLabel}</span>
        <Switch checked={checked} label={label} disabled={disabled || pending} onChange={(v) => { setError(null); setNext(v); }} />
      </div>
      <Modal open={next !== null} onClose={() => !pending && setNext(null)} title={`${label}: turn ${next ? onLabel.toLowerCase() : offLabel.toLowerCase()}?`}>
        {next !== null && describe ? <div className="type-body text-muted">{describe(next)}</div> : null}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-reason`} className="type-label">Reason (recorded in the audit log)</label>
          <textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} autoFocus
            className="border-[1.5px] border-line rounded-md px-3 py-2 type-body bg-surface text-ink min-h-24 resize-y" />
          <span className="type-caption text-muted">{reason.length}/500 · at least 5 characters</span>
        </div>
        {error ? <Banner tone="danger" text={error} /> : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button disabled={reason.trim().length < 5 || pending} onClick={submit}>{pending ? 'Applying…' : 'Apply'}</Button>
          <Button variant="ghost" disabled={pending} onClick={() => setNext(null)}>Cancel</Button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Page helpers
 * ---------------------------------------------------------------------------------------------- */
/** Re-renders the server page every `seconds` while the tab is visible. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** Stores the browser's time zone in a cookie so server-rendered times are local. */
export function TimeZoneSync({ current }: { current: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== current) {
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax; secure`;
      router.refresh();
    }
  }, [current, router]);
  return null;
}

export function ThemeToggle({ initial }: { initial: 'light' | 'dark' | 'system' }) {
  const [mode, setMode] = useState(initial);
  const apply = (m: 'light' | 'dark' | 'system') => {
    setMode(m);
    document.cookie = `theme=${m}; path=/; max-age=31536000; samesite=lax; secure`;
    if (m === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = m;
  };
  const nextMode = mode === 'system' ? 'dark' : mode === 'dark' ? 'light' : 'system';
  return (
    <Button variant="ghost" size="sm" onClick={() => apply(nextMode)} aria-label={`Theme: ${mode}. Switch to ${nextMode}.`} title={`Theme: ${mode}`}>
      <Icon name={mode === 'dark' ? 'moon' : mode === 'light' ? 'sun' : 'pulse'} size={16} />
      <span className="capitalize">{mode}</span>
    </Button>
  );
}

/** Submits a plain form action and reports the result as a toast. */
export function useActionToast() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, success?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast(r.message ?? success ?? 'Saved'); router.refresh(); }
      else toast(r.error, 'danger');
    });
  return { pending, run };
}
