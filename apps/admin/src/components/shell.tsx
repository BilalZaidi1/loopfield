'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Icon, type IconName } from './icons';
import { Brand } from './brand';
import { CountPill, cx } from './ui';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
}
export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/** The app's wide-screen sidebar: pill items, violet-soft for the current page, orange counts. */
function NavLinks({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Console" className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col gap-1">
          {g.label ? <div className="type-micro uppercase tracking-[0.08em] text-subtle px-3 pb-1">{g.label}</div> : null}
          {g.items.map((it) => {
            const active = path === it.href || path.startsWith(`${it.href}/`);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-3 min-h-12 rounded-full px-3 type-body-strong transition-colors',
                  active ? 'bg-primary-soft text-on-primary-soft' : 'text-ink hover:bg-surface-alt'
                )}>
                <Icon name={it.icon} size={20} className={active ? 'text-primary' : 'text-muted'} />
                <span className="truncate">{it.label}</span>
                <CountPill n={it.count ?? 0} />
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col gap-7 border-r border-line bg-surface px-4 pt-7 pb-5 sticky top-0 h-dvh overflow-y-auto">
      <div className="px-2"><Brand /></div>
      <NavLinks groups={groups} />
    </aside>
  );
}

/** Narrower screens: the same navigation in a drawer. */
export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const waiting = groups.flatMap((g) => g.items).reduce((n, it) => n + (it.count ?? 0), 0);
  return (
    <div className="lg:hidden flex items-center gap-3">
      <button type="button" aria-expanded={open} aria-controls="mobile-nav" aria-label="Menu" onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink">
        <Icon name={open ? 'x' : 'list'} />
        {waiting && !open ? <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-orange" aria-label="Items waiting" /> : null}
      </button>
      <Brand compact />
      {open ? (
        <div id="mobile-nav" className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto bg-surface p-4">
          <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
