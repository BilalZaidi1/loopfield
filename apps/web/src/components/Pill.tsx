import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';

type Variant = 'primary' | 'ghost' | 'ink' | 'light';

const styles: Record<Variant, { pill: string; disc: string }> = {
  primary: { pill: 'bg-primary-fill text-white hover:bg-primary-pressed', disc: 'bg-white text-primary-fill' },
  ghost: { pill: 'bg-white/[0.06] text-ink ring-1 ring-inset ring-white/15 hover:bg-white/[0.1]', disc: 'bg-white/10 text-ink' },
  ink: { pill: 'bg-block-ink text-white hover:bg-black', disc: 'bg-white text-block-ink' },
  light: { pill: 'bg-white text-block-ink hover:bg-white/90', disc: 'bg-primary-fill text-white' }
};

interface Common {
  children: ReactNode;
  variant?: Variant;
  arrow?: boolean;
  size?: 'lg' | 'md';
  className?: string;
}

function inner(children: ReactNode, variant: Variant, arrow: boolean, size: 'lg' | 'md') {
  const disc = size === 'lg' ? 'size-[46px]' : 'size-9';
  return (
    <>
      <span className={arrow ? (size === 'lg' ? 'pl-5' : 'pl-4') : ''}>{children}</span>
      {arrow ? (
        <span className={`arrow-disc grid shrink-0 place-items-center rounded-full ${disc} ${styles[variant].disc}`}>
          <Icon name="arrow-right" size={size === 'lg' ? 22 : 18} strokeWidth={2.4} />
        </span>
      ) : null}
    </>
  );
}

function classes(variant: Variant, arrow: boolean, size: 'lg' | 'md', className?: string) {
  const height = size === 'lg' ? 'min-h-[58px] text-[17px]' : 'min-h-12 text-[15px]';
  const pad = arrow ? 'gap-3 pr-1.5' : size === 'lg' ? 'px-7' : 'px-5';
  return `press inline-flex items-center justify-between rounded-full font-bold tracking-[-0.01em] transition-colors ${height} ${pad} ${styles[variant].pill} ${className ?? ''}`;
}

/** The app's signature call to action: a pill with a round arrow at the end. */
export function PillLink({ children, variant = 'primary', arrow = true, size = 'lg', className, ...rest }: Common & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a {...rest} className={classes(variant, arrow, size, className)}>
      {inner(children, variant, arrow, size)}
    </a>
  );
}

export function PillButton({ children, variant = 'primary', arrow = true, size = 'lg', className, type = 'button', ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} {...rest} className={classes(variant, arrow, size, className)}>
      {inner(children, variant, arrow, size)}
    </button>
  );
}
