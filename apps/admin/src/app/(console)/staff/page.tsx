import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { dateTime, relativeTime } from '@/lib/format';
import { isRole, ROLE_LABEL } from '@/lib/roles';
import type { StaffRow, UserSearchRow } from '@/lib/types';
import { ActionButton } from '@/components/client';
import { Avatar, Badge, Card, EmptyState, PageHeader, Table, buttonClass } from '@/components/ui';
import { setStaffRole } from './actions';
import { GrantRole } from './grant-role';

export const metadata: Metadata = { title: 'Staff' };

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireRole('admin');
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const [staff, results, tz] = await Promise.all([
    rpc<StaffRow[]>('ops_staff_list'),
    query.length >= 2 ? rpc<UserSearchRow[]>('ops_users_search', { p_query: query, p_limit: 20 }) : Promise.resolve([] as UserSearchRow[]),
    viewerTimeZone()
  ]);

  return (
    <>
      <PageHeader title="Staff" description="Roles are scoped: social roles never get scoring powers. Every grant and revoke is audited." />
      <Card title="Current staff">
        <Table head={['Person', 'Roles', 'Two-step sign-in', 'Last sign-in']}>
          {staff.map((s) => (
            <tr key={s.user_id}>
              <td>
                <div className="flex items-center gap-2">
                  <Avatar name={s.display_name} size={32} />
                  <div className="leading-tight">
                    <div className="font-semibold">@{s.handle}{s.user_id === ctx.userId ? <span className="type-caption text-muted"> (you)</span> : null}</div>
                    <div className="type-caption text-muted">{s.display_name}{s.status !== 'active' ? ` · ${s.status}` : ''}</div>
                  </div>
                </div>
              </td>
              <td>
                <div className="flex flex-wrap gap-1.5">
                  {s.roles.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1">
                      <Badge label={isRole(r) ? ROLE_LABEL[r] : r} tone={r === 'admin' ? 'title' : 'info'} />
                      {!(s.user_id === ctx.userId && r === 'admin') ? (
                        <ActionButton label="Revoke" size="sm" variant="ghost" requireReason={false}
                          confirmPhrase={r === 'admin' ? `@${s.handle}` : undefined}
                          title={`Revoke ${isRole(r) ? ROLE_LABEL[r] : r} from @${s.handle}?`}
                          action={setStaffRole.bind(null, s.user_id, r, false)} />
                      ) : null}
                    </span>
                  ))}
                </div>
              </td>
              <td>{s.mfa_enabled ? <Badge label="Set up" tone="success" icon="lock" /> : <Badge label="Not set up" tone="warning" />}</td>
              <td className="whitespace-nowrap" title={dateTime(s.last_sign_in_at, tz ?? 'UTC')}>{relativeTime(s.last_sign_in_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Add a role">
        <form className="flex flex-wrap items-end gap-2" action="/staff">
          <label className="flex flex-col gap-1 flex-1 min-w-[240px]">
            <span className="type-label">Find a runner</span>
            <input name="q" defaultValue={query} placeholder="Handle, name, user ID or exact email"
              className="border border-line-strong focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary rounded-md px-4 min-h-12 type-body bg-surface text-ink" />
          </label>
          <button type="submit" className={buttonClass('secondary')}>Search</button>
        </form>
        <p className="type-caption text-muted">Email searches must match exactly and are recorded in the audit log. Addresses are never shown.</p>
        {query.length >= 2 ? (
          results.length ? (
            <Table head={['Runner', 'Matched by', 'Current roles', '']}>
              {results.map((u) => (
                <tr key={u.user_id}>
                  <td><div className="font-semibold">@{u.handle}</div><div className="type-caption text-muted">{u.display_name}{u.city_label ? ` · ${u.city_label}` : ''}</div></td>
                  <td className="text-muted">{u.matched_by}</td>
                  <td>{u.roles.length ? u.roles.map((r) => (isRole(r) ? ROLE_LABEL[r] : r)).join(', ') : <span className="text-muted">None</span>}</td>
                  <td className="text-right">{u.status === 'active' ? <GrantRole userId={u.user_id} handle={u.handle} existing={u.roles} /> : <Badge label={u.status} tone="warning" />}</td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState title="No runner found" body="Try part of their handle or display name." />
        ) : null}
      </Card>
    </>
  );
}
