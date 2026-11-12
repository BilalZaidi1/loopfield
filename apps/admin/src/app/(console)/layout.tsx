import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { requireStaff } from '@/lib/auth';
import { getOverview } from '@/lib/data';
import { hasRole, ROLE_LABEL } from '@/lib/roles';
import { env, ENV_LABEL } from '@/lib/env';
import { viewerTimeZone } from '@/lib/tz';
import { Sidebar, MobileNav, type NavGroup } from '@/components/shell';
import { ThemeToggle, TimeZoneSync, Toaster } from '@/components/client';
import { Avatar, Badge } from '@/components/ui';
import { Icon } from '@/components/icons';
import { signOut } from '../(auth)/actions';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const ctx = await requireStaff();
  const overview = await getOverview().catch(() => null);
  const can = (r: Parameters<typeof hasRole>[1]) => hasRole(ctx.roles, r);
  const deadJobs = Object.values(overview?.jobs ?? {}).reduce((n, q) => n + q.dead, 0);

  const allGroups: NavGroup[] = [
    {
      label: null,
      items: [
        { href: '/overview', label: 'Overview', icon: 'pulse' },
        { href: '/settings', label: 'App control', icon: 'sliders' }
      ]
    },
    {
      label: 'Trust & safety',
      items: [
        ...(can('moderator') ? [{ href: '/moderation', label: 'Moderation', icon: 'flag' as const, count: overview?.queues.moderation.open }] : []),
        ...(can('integrity_reviewer') ? [{ href: '/integrity', label: 'Integrity', icon: 'shield' as const, count: overview?.queues.integrity.open }] : []),
        ...(can('moderator') || can('integrity_reviewer') ? [{ href: '/appeals', label: 'Appeals', icon: 'scale' as const, count: overview?.queues.appeals.open }] : []),
        ...(can('route_reviewer') ? [{ href: '/routes', label: 'Route proposals', icon: 'route' as const, count: overview?.queues.routes.open }] : [])
      ]
    },
    {
      label: 'Platform',
      items: [
        ...(can('admin') ? [{ href: '/jobs', label: 'Jobs', icon: 'layers' as const, count: deadJobs }] : []),
        ...(can('admin') ? [{ href: '/staff', label: 'Staff', icon: 'users' as const }] : []),
        ...(can('admin') ? [{ href: '/audit', label: 'Audit log', icon: 'list' as const }] : [])
      ]
    }
  ];
  const groups = allGroups.filter((g) => g.items.length > 0);

  const store = await cookies();
  const theme = store.get('theme')?.value;
  const tz = await viewerTimeZone();
  const roleText = ctx.roles.includes('admin') ? ROLE_LABEL.admin : ctx.roles.map((r) => ROLE_LABEL[r]).join(', ');

  return (
    <div className="min-h-dvh flex">
      <Sidebar groups={groups} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-bg/90 backdrop-blur px-5 md:px-7">
          <MobileNav groups={groups} />
          <div className="hidden sm:flex items-center gap-2">
            {env.appEnv !== 'production' ? <Badge label={`${ENV_LABEL[env.appEnv]} data`} tone="warning" /> : null}
            {ctx.requireMfa ? null : <span className="hidden xl:inline-flex"><Badge label="MFA not enforced in the database yet" tone="muted" icon="lock" /></span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle initial={theme === 'light' || theme === 'dark' ? theme : 'system'} />
            <div className="hidden sm:flex items-center gap-2.5 rounded-full bg-surface py-1 pl-1 pr-4">
              <Avatar name={ctx.displayName} size={34} />
              <div className="leading-tight">
                <div className="type-label">@{ctx.handle}</div>
                <div className="type-micro text-muted">{roleText}</div>
              </div>
            </div>
            <form action={signOut}>
              <button type="submit" aria-label="Sign out" title="Sign out" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-ink hover:bg-surface">
                <Icon name="logout" />
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 w-full max-w-[1100px] mx-auto px-5 md:px-7 pt-2 pb-10 flex flex-col gap-6">{children}</main>
      </div>
      <Toaster />
      <TimeZoneSync current={tz} />
    </div>
  );
}
