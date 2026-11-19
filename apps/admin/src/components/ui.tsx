import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/*
 * Web versions of the app's redesigned primitives (apps/mobile/src/components/ui.tsx, docs/DESIGN.md):
 * pill buttons (with the round arrow for the main call to action), flat cards with a 24 px radius and
 * no borders, hairline-divided lists with tinted icon tiles, soft-tinted badges and banners, a sunken
 * segmented track with a raised thumb, heavy-italic numerals, and saturated block cards.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'title' | 'muted' | 'violet';

const BADGE: Record<Tone, string> = {
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  title: 'bg-orange-soft text-orange-text',
  muted: 'bg-sunken text-muted',
  violet: 'bg-primary-soft text-on-primary-soft'
};

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'ink' | 'onBlock';

export function buttonClass(variant: ButtonVariant = 'primary', size: 'md' | 'sm' = 'md'): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition-[background-color,opacity,transform]',
    'active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none',
    size === 'md' ? 'min-h-12 px-6 text-[16px] leading-[23px]' : 'min-h-10 px-4 text-[14px] leading-[19px]',
    variant === 'primary' && 'bg-primary-fill text-on-primary hover:bg-primary-pressed',
    variant === 'secondary' && 'bg-primary-soft text-on-primary-soft hover:brightness-[0.97]',
    variant === 'danger' && 'bg-danger-soft text-danger hover:brightness-[0.97]',
    variant === 'ghost' && 'bg-transparent border-[1.5px] border-line-strong text-primary hover:bg-surface-alt',
    variant === 'ink' && 'bg-ink text-bg',
    variant === 'onBlock' && 'bg-white text-block-ink'
  );
}

/** The app's signature trailing round arrow: a filled disc at the end of the pill. */
function ArrowDot({ variant, size }: { variant: ButtonVariant; size: 'md' | 'sm' }) {
  const disc = variant === 'primary' ? 'bg-white text-primary-fill' : variant === 'onBlock' ? 'bg-block-ink text-white' : variant === 'danger' ? 'bg-danger text-danger-soft' : 'bg-primary-fill text-white';
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full', size === 'md' ? 'h-9 w-9' : 'h-7 w-7', disc)}>
      <Icon name="arrow-right" size={size === 'md' ? 18 : 15} strokeWidth={2.4} />
    </span>
  );
}

export function Button({ variant = 'primary', size = 'md', arrow, className, children, ...rest }: ComponentProps<'button'> & { variant?: ButtonVariant; size?: 'md' | 'sm'; arrow?: boolean }) {
  return (
    <button type="button" className={cx(buttonClass(variant, size), arrow && (size === 'md' ? 'pr-1.5' : 'pr-1'), className)} {...rest}>
      {children}
      {arrow ? <ArrowDot variant={variant} size={size} /> : null}
    </button>
  );
}

export function ButtonLink({ variant = 'secondary', size = 'md', arrow, className, children, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: 'md' | 'sm'; arrow?: boolean }) {
  return (
    <Link className={cx(buttonClass(variant, size), arrow && (size === 'md' ? 'pr-1.5' : 'pr-1'), className)} {...rest}>
      {children}
      {arrow ? <ArrowDot variant={variant} size={size} /> : null}
    </Link>
  );
}

export type BlockTone = 'violet' | 'blue' | 'orange' | 'green' | 'ink';
const BLOCK: Record<BlockTone, string> = {
  violet: 'bg-primary-fill text-white',
  blue: 'bg-blue text-white',
  orange: 'bg-orange text-block-ink',
  green: 'bg-green text-block-ink',
  ink: 'bg-ink text-bg'
};

/** Flat surface card (no border, 24 px radius) or a saturated block card (28 px radius). */
export function Card({ children, className, title, action, padded = true, tone }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; padded?: boolean; tone?: BlockTone }) {
  return (
    <section className={cx('min-w-0 flex flex-col gap-3', tone ? cx('rounded-[28px]', BLOCK[tone], padded && 'p-6') : cx('rounded-lg bg-surface', padded && 'p-5'), className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3 min-h-8">
          {title ? <h2 className="type-headline">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Rows separated by hairlines, the last divider hidden (the app's ListGroup). */
export function ListGroup({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('min-w-0 rounded-lg bg-surface', className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-1">
          {title ? <h2 className="type-headline">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className="px-5">{children}</div>
    </section>
  );
}

export function Section({ title, action, children, description }: { title: string; action?: ReactNode; children: ReactNode; description?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 min-h-8">
        <div>
          <h2 className="type-headline">{title}</h2>
          {description ? <p className="type-caption text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Tinted square behind a line icon, as in the app's rows. */
export function IconTile({ name, tone = 'violet' }: { name: IconName; tone?: Tone }) {
  return (
    <span className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm', BADGE[tone])}>
      <Icon name={name} size={20} />
    </span>
  );
}

export function Row({ title, subtitle, right, href, leading, icon, iconTone, value, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  href?: string;
  leading?: ReactNode;
  icon?: IconName;
  iconTone?: Tone;
  value?: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {icon ? <IconTile name={icon} tone={iconTone} /> : null}
      {leading}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="type-body-strong truncate">{title}</div>
        {subtitle ? <div className="type-caption text-muted">{subtitle}</div> : null}
      </div>
      {value != null ? <div className="type-body-strong tabular text-muted">{value}</div> : null}
      {right ?? (href ? <Icon name="chevron" size={20} className="text-subtle shrink-0" /> : null)}
    </>
  );
  const base = cx('flex items-center gap-3 min-h-[60px] py-3 border-b border-line last:border-b-0', className);
  if (href) {
    return (
      <Link href={href} className={cx(base, 'transition-opacity hover:opacity-70')}>
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

const BANNER: Record<Exclude<Tone, 'title' | 'muted' | 'violet'>, { box: string; text: string; icon: IconName }> = {
  info: { box: 'bg-info-soft', text: 'text-ink', icon: 'info' },
  success: { box: 'bg-success-soft', text: 'text-success', icon: 'check' },
  warning: { box: 'bg-warning-soft', text: 'text-warning', icon: 'alert' },
  danger: { box: 'bg-danger-soft', text: 'text-danger', icon: 'alert' }
};

export function Banner({ text, tone = 'info', action, className }: { text: ReactNode; tone?: 'info' | 'success' | 'warning' | 'danger'; action?: ReactNode; className?: string }) {
  const c = BANNER[tone];
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cx('flex items-center gap-3 rounded-md px-4 py-3', c.box, className)}>
      <Icon name={c.icon} size={20} className={tone === 'info' ? 'text-info' : c.text} />
      <div className={cx('type-label flex-1', c.text)}>{text}</div>
      {action}
    </div>
  );
}

/** Pill that sits inside a banner, on the surface colour (the app's banner action). */
export function BannerAction({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-9 items-center rounded-full bg-surface px-3 type-label text-primary">{children}</Link>;
}

export function Badge({ label, tone = 'info', icon }: { label: ReactNode; tone?: Tone; icon?: IconName }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] leading-[16px] font-semibold whitespace-nowrap', BADGE[tone])}>
      {icon ? <Icon name={icon} size={14} strokeWidth={2.4} /> : null}
      {label}
    </span>
  );
}

/** Orange count, as on the app's sidebar and tab bar. */
export function CountPill({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-orange px-1.5 text-[12px] font-bold text-block-ink tabular" aria-label={`${n} waiting`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function StatTile({ label, value, unit, note, icon }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex-1 min-w-[150px] rounded-lg bg-surface p-4 flex flex-col gap-1">
      <div className="flex items-center gap-1 type-caption text-muted">
        {icon ? <Icon name={icon} size={16} /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-[28px] leading-[32px] font-black italic tracking-[-0.6px] tabular">
        {value}
        {unit ? <span className="type-label not-italic text-muted"> {unit}</span> : null}
      </div>
      {note ? <div className="type-caption text-muted">{note}</div> : null}
    </div>
  );
}

/** The signature heavy-italic number with an optional unit and label. */
export function BigNumber({ value, unit, label, size = 76 }: { value: ReactNode; unit?: string; label?: ReactNode; size?: number }) {
  return (
    <div className="flex flex-col">
      {label ? <div className="type-label opacity-85">{label}</div> : null}
      <div className="flex items-end gap-1">
        <span className="font-black italic tabular" style={{ fontSize: size, lineHeight: `${Math.round(size * 1.03)}px`, letterSpacing: `${-size * 0.032}px` }}>{value}</span>
        {unit ? <span className="type-headline opacity-80" style={{ marginBottom: Math.round(size * 0.13) }}>{unit}</span> : null}
      </div>
    </div>
  );
}

/** Link-driven segmented control: a sunken pill track with a raised surface thumb. */
export function SegmentedLinks({ label, options, value }: { label: string; value: string; options: { value: string; label: string; href: string; count?: number }[] }) {
  return (
    <nav aria-label={label} className="flex min-h-12 rounded-full p-1 gap-1 bg-sunken overflow-x-auto">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={selected ? 'page' : undefined}
            className={cx(
              'flex-1 min-h-10 rounded-full flex items-center justify-center gap-1.5 type-label px-4 whitespace-nowrap transition-colors',
              selected ? 'bg-surface text-ink shadow-raised' : 'text-muted hover:text-ink'
            )}>
            {o.label}
            {o.count ? <span className="tabular text-muted">{o.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Initials on a soft, stable tint (the app's avatarTint). */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  const n = (h % 5) + 1;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, background: `var(--lf-av${n}-bg)`, color: `var(--lf-av${n}-fg)`, fontSize: Math.round(size * 0.38) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold">
      {initials || '?'}
    </span>
  );
}

export function EmptyState({ title, body, action, icon = 'sparkle' }: { title: string; body?: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
      <span className="mb-1 inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon name={icon} size={28} />
      </span>
      <div className="type-headline">{title}</div>
      {body ? <div className="type-body text-muted max-w-md">{body}</div> : null}
      {action}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4 gap-y-2">
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
  if (value == null || (typeof value === 'object' && Object.keys(value as object).length === 0)) return <span className="type-caption text-subtle">—</span>;
  return (
    <details className="group">
      <summary className="type-label text-primary cursor-pointer select-none">{summary}</summary>
      <pre className="mt-2 max-h-72 overflow-auto rounded-sm bg-sunken p-3 text-[12px] leading-[17px] font-mono whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
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
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} scope="col" className="type-caption text-subtle font-semibold py-2 pr-4 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-b-0 [&_td]:py-3 [&_td]:pr-4 [&_td]:align-top [&_td]:type-body">
          {children}
        </tbody>
      </table>
      {empty}
    </div>
  );
}

/** Text inputs: surface fill, hairline border that thickens to violet on focus, 16 px radius. */
export const inputClass = 'border border-line-strong focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary rounded-md px-4 min-h-12 type-body bg-surface text-ink placeholder:text-subtle';
