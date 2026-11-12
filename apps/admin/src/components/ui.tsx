import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/*
 * Web versions of the app's primitives (apps/mobile/src/components/ui.tsx): same colours, radii,
 * 1.5px borders on controls, outlined pill badges, cards with a 16px radius and hairline rows.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'title' | 'muted';

const TONE_TEXT: Record<Tone, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  title: 'text-title',
  muted: 'text-muted'
};
const TONE_BORDER: Record<Tone, string> = {
  info: 'border-info',
  success: 'border-success',
  warning: 'border-warning',
  danger: 'border-danger',
  title: 'border-title',
  muted: 'border-muted'
};

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function buttonClass(variant: ButtonVariant = 'primary', size: 'md' | 'sm' = 'md'): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-md border-[1.5px] type-label whitespace-nowrap transition-opacity',
    'hover:opacity-90 active:opacity-85 disabled:opacity-50 disabled:pointer-events-none',
    size === 'md' ? 'min-h-11 px-4 text-[15px]' : 'min-h-9 px-3',
    variant === 'primary' && 'bg-primary border-primary text-on-primary',
    variant === 'secondary' && 'bg-surface-alt border-surface-alt text-primary',
    // Text uses the page background so it stays legible on the lighter dark-mode danger colour.
    variant === 'danger' && 'bg-danger border-danger text-bg',
    variant === 'ghost' && 'bg-transparent border-line text-primary'
  );
}

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ComponentProps<'button'> & { variant?: ButtonVariant; size?: 'md' | 'sm' }) {
  return <button type="button" className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function ButtonLink({ variant = 'secondary', size = 'md', className, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: 'md' | 'sm' }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function Card({ children, className, title, action, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; padded?: boolean }) {
  return (
    <section className={cx('min-w-0 rounded-lg border border-line bg-surface flex flex-col gap-2', padded && 'p-4', className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3">
          {title ? <h2 className="type-heading">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Section({ title, action, children, description }: { title: string; action?: ReactNode; children: ReactNode; description?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-heading">{title}</h2>
        {action}
      </div>
      {description ? <p className="type-caption text-muted -mt-1">{description}</p> : null}
      {children}
    </section>
  );
}

export function Row({ title, subtitle, right, href, leading, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  href?: string;
  leading?: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {leading}
      <div className="flex-1 min-w-0">
        <div className="type-body font-semibold truncate">{title}</div>
        {subtitle ? <div className="type-caption text-muted">{subtitle}</div> : null}
      </div>
      {right ?? (href ? <Icon name="chevron" className="text-muted shrink-0" /> : null)}
    </>
  );
  const base = cx('flex items-center gap-3 min-h-14 py-2 border-b border-line last:border-b-0', className);
  if (href) {
    return (
      <Link href={href} className={cx(base, 'hover:bg-surface-alt/60 -mx-2 px-2 rounded-sm transition-colors')}>
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

export function Banner({ text, tone = 'info', action, className }: { text: ReactNode; tone?: Exclude<Tone, 'title' | 'muted'>; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cx('flex items-center gap-2 border-[1.5px] rounded-md p-3 bg-surface', TONE_BORDER[tone], className)}>
      <div className={cx('type-label flex-1', TONE_TEXT[tone])}>{text}</div>
      {action}
    </div>
  );
}

export function Badge({ label, tone = 'info', icon }: { label: ReactNode; tone?: Tone; icon?: IconName }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border-[1.5px] px-2 py-px type-caption font-bold whitespace-nowrap', TONE_BORDER[tone], TONE_TEXT[tone])}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {label}
    </span>
  );
}

/** Red count pill, as on the app's notification bell. */
export function CountPill({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-danger px-1 text-[11px] leading-[18px] font-semibold text-bg text-center tabular" aria-label={`${n} waiting`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function StatTile({ label, value, unit, note, tone }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex-1 min-w-[150px] rounded-lg border border-line bg-surface p-3 flex flex-col gap-0.5">
      <div className="type-caption text-muted">{label}</div>
      <div className={cx('type-title tabular', tone && TONE_TEXT[tone])}>
        {value}
        {unit ? <span className="type-label text-muted"> {unit}</span> : null}
      </div>
      {note ? <div className="type-caption text-muted">{note}</div> : null}
    </div>
  );
}

/** Link-driven segmented control (server-rendered filters), styled like the app's Segmented. */
export function SegmentedLinks({ label, options, value }: { label: string; value: string; options: { value: string; label: string; href: string; count?: number }[] }) {
  return (
    <nav aria-label={label} className="flex rounded-md p-1 gap-1 bg-surface-alt">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={selected ? 'page' : undefined}
            className={cx(
              'flex-1 min-h-10 rounded-sm flex items-center justify-center gap-1.5 type-label px-3 border-2',
              selected ? 'bg-surface border-primary text-ink' : 'border-transparent text-muted hover:text-ink'
            )}>
            {o.label}
            {o.count ? <span className="tabular text-muted">({o.count})</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-alt type-label text-ink">
      {initials || '?'}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
      <div className="type-heading">{title}</div>
      {body ? <div className="type-body text-muted max-w-md">{body}</div> : null}
      {action}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="type-caption text-muted pt-0.5">{it.label}</dt>
          <dd className="type-body break-words">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Collapsible JSON for evidence and audit details. */
export function JsonBlock({ value, summary = 'Details' }: { value: unknown; summary?: string }) {
  if (value == null || (typeof value === 'object' && Object.keys(value as object).length === 0)) return <span className="type-caption text-muted">—</span>;
  return (
    <details className="group">
      <summary className="type-caption text-primary cursor-pointer select-none">{summary}</summary>
      <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-surface-alt p-3 text-[12px] leading-[17px] font-mono whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="type-title">{title}</h1>
        {description ? <p className="type-body text-muted max-w-3xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} scope="col" className="type-caption text-muted font-semibold py-2 pr-4 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-b-0 [&_td]:py-2.5 [&_td]:pr-4 [&_td]:align-top [&_td]:type-body">
          {children}
        </tbody>
      </table>
      {empty}
    </div>
  );
}
