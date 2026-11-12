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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/95 backdrop-blur px-4 md:px-6">
          <MobileNav groups={groups} />
          {env.appEnv !== 'production' ? <Badge label={`${ENV_LABEL[env.appEnv]} data`} tone="warning" /> : null}
          {ctx.requireMfa ? null : (
            <span className="hidden lg:inline-flex"><Badge label="MFA not enforced in the database yet" tone="muted" icon="lock" /></span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle initial={theme === 'light' || theme === 'dark' ? theme : 'system'} />
            <div className="hidden sm:flex items-center gap-2 pl-2">
              <Avatar name={ctx.displayName} />
              <div className="leading-tight">
                <div className="type-label">@{ctx.handle}</div>
                <div className="type-caption text-muted">{roleText}</div>
              </div>
            </div>
            <form action={signOut}>
              <button type="submit" aria-label="Sign out" title="Sign out" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface-alt">
                <Icon name="logout" />
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 w-full max-w-[1200px] mx-auto p-4 md:p-6 flex flex-col gap-6">{children}</main>
      </div>
      <Toaster />
      <TimeZoneSync current={tz} />
    </div>
  );
}
