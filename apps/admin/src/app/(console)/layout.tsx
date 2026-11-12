import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { can as canDo, requireStaff } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import type { SupportQueue } from '@/lib/types';
import { getOverview } from '@/lib/data';
import type { Permission } from '@/lib/roles';
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
  const can = (p: Permission) => canDo(ctx, p);
  const deadJobs = Object.values(overview?.jobs ?? {}).reduce((n, q) => n + q.dead, 0);
  const support = can('support') ? await rpc<SupportQueue>('ops_support_queue', { p_view: 'open', p_limit: 1 }).catch(() => null) : null;
  const item = (show: boolean, href: string, label: string, icon: NavGroup['items'][number]['icon'], count?: number) => (show ? [{ href, label, icon, count }] : []);

  const allGroups: NavGroup[] = [
    { label: null, items: [...item(true, '/overview', 'Overview', 'pulse'), ...item(can('analytics'), '/analytics', 'Analytics', 'chart')] },
    {
      label: 'Runners & support',
      items: [...item(can('users.view'), '/runners', 'Runners', 'users'), ...item(can('support'), '/support', 'Support inbox', 'chat', support?.counts.open)]
    },
    {
      label: 'Trust & safety',
      items: [
        ...item(can('moderation'), '/moderation', 'Moderation', 'flag', overview?.queues.moderation.open),
        ...item(can('integrity'), '/integrity', 'Integrity', 'shield', overview?.queues.integrity.open),
        ...item(can('moderation') || can('integrity'), '/appeals', 'Appeals', 'scale', overview?.queues.appeals.open),
        ...item(can('routes'), '/routes', 'Route proposals', 'route', overview?.queues.routes.open)
      ]
    },
    { label: 'Game', items: [...item(true, '/settings', 'App control', 'sliders'), ...item(true, '/rules', 'Game rules', 'target')] },
    { label: 'Insights', items: [...item(can('sql'), '/sql', 'SQL editor', 'database')] },
    {
      label: 'Platform',
      items: [
        ...item(can('jobs'), '/jobs', 'Jobs', 'layers', deadJobs),
        ...item(can('staff'), '/staff', 'Staff', 'user'),
        ...item(true, '/roles', 'Roles & permissions', 'key'),
        ...item(can('audit'), '/audit', 'Audit log', 'list')
      ]
    }
  ];
  const groups = allGroups.filter((g) => g.items.length > 0);

  const store = await cookies();
  const theme = store.get('theme')?.value;
  const tz = await viewerTimeZone();
  const roleText = ctx.roles.includes('admin') ? 'Admin' : ctx.roleLabels.join(', ');

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
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-5 md:px-7 pt-2 pb-10 flex flex-col gap-6">{children}</main>
      </div>
      <Toaster />
      <TimeZoneSync current={tz} />
    </div>
  );
}
