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

function NavLinks({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Console" className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col gap-0.5">
          {g.label ? <div className="type-caption font-semibold text-muted uppercase tracking-wide px-3 pb-1">{g.label}</div> : null}
          {g.items.map((it) => {
            const active = path === it.href || path.startsWith(`${it.href}/`);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-3 min-h-10 rounded-md px-3 type-label transition-colors',
                  active ? 'bg-surface-alt text-ink' : 'text-muted hover:bg-surface-alt/60 hover:text-ink'
                )}>
                <Icon name={it.icon} size={18} className={active ? 'text-primary' : undefined} />
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
    <aside className="hidden md:flex w-[248px] shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-4 sticky top-0 h-dvh overflow-y-auto">
      <div className="px-2"><Brand /></div>
      <NavLinks groups={groups} />
    </aside>
  );
}

/** Small screens: the same navigation in a drawer. */
export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const waiting = groups.flatMap((g) => g.items).reduce((n, it) => n + (it.count ?? 0), 0);
  return (
    <div className="md:hidden">
      <button type="button" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md border-[1.5px] border-line text-ink">
        <Icon name={open ? 'x' : 'list'} />
        {waiting && !open ? <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-danger" aria-label="Items waiting" /> : null}
      </button>
      {open ? (
        <div id="mobile-nav" className="fixed inset-x-0 top-[64px] bottom-0 z-40 overflow-y-auto bg-surface border-t border-line p-4">
          <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
