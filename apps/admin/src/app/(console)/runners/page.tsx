import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { count, km, relativeTime } from '@/lib/format';
import { roleLabel } from '@/lib/roles';
import type { RunnerList, UserSearchRow } from '@/lib/types';
import { Avatar, Badge, buttonClass, Card, cx, EmptyState, inputClass, PageHeader, SegmentedLinks } from '@/components/ui';

export const metadata: Metadata = { title: 'Runners' };

const PAGE = 50;
const SORTS = [
  { value: 'recent', label: 'Newest' },
  { value: 'active', label: 'Last run' },
  { value: 'runs', label: 'Most runs' },
  { value: 'distance', label: 'Most distance' },
  { value: 'handle', label: 'Handle' }
];

export default async function RunnersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; sort?: string; page?: string; email?: string }> }) {
  await requirePermission('users.view');
  const sp = await searchParams;
  const status = sp.status === 'active' || sp.status === 'suspended' ? sp.status : null;
  const sort = SORTS.find((s) => s.value === sp.sort)?.value ?? 'recent';
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const email = (sp.email ?? '').trim();
  const [list, byEmail] = await Promise.all([
    rpc<RunnerList>('ops_users_list', { p_query: sp.q?.trim() || null, p_status: status, p_sort: sort, p_limit: PAGE, p_offset: page * PAGE }),
    email.includes('@') ? rpc<UserSearchRow[]>('ops_users_search', { p_query: email, p_limit: 5 }) : Promise.resolve(null)
  ]);
  const qs = (patch: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q ?? null, status, sort, page: 0, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== '' && !(k === 'page' && v === 0) && !(k === 'sort' && v === 'recent')) p.set(k, String(v));
    const s = p.toString();
    return `/runners${s ? `?${s}` : ''}`;
  };
  const pages = Math.ceil(list.total / PAGE);
  return (
    <>
      <PageHeader title="Runners" description="Everyone with a Loopfield account. Routes, places, health data and email addresses are never shown here." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedLinks label="Account status" value={status ?? 'all'} options={[
          { value: 'all', label: 'All', count: list.counts.all, href: qs({ status: null }) },
          { value: 'active', label: 'Active', count: list.counts.active, href: qs({ status: 'active' }) },
          { value: 'suspended', label: 'Suspended', count: list.counts.suspended, href: qs({ status: 'suspended' }) }
        ]} />
        <form action="/runners" className="flex flex-wrap gap-2 w-full lg:w-auto">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Handle, name or user ID" aria-label="Search runners" className={cx(inputClass, 'flex-1 lg:w-64')} />
          <select name="sort" defaultValue={sort} aria-label="Sort" className={cx(inputClass, 'px-3')}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button type="submit" className={buttonClass('secondary')}>Search</button>
        </form>
      </div>

      <Card padded={false}>
        {list.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[760px]">
              <thead>
                <tr className="border-b border-line">
                  {['Runner', 'Status', 'Joined', 'Runs', 'Distance', 'Loops', 'Last run'].map((h, i) => (
                    <th key={h} scope="col" className={cx('type-caption text-subtle font-semibold py-3 pr-4', i === 0 && 'pl-5', i >= 3 && i <= 5 && 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.items.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-surface-alt/50">
                    <td className="py-3 pl-5 pr-4">
                      <Link href={`/runners/${r.id}`} className="flex items-center gap-3 min-w-0">
                        <Avatar name={r.display_name} size={36} />
                        <span className="min-w-0">
                          <span className="block type-body-strong truncate">{r.display_name}</span>
                          <span className="block type-caption text-muted truncate">@{r.handle}{r.city_label ? ` · ${r.city_label}` : ''}{r.roles.length ? ` · ${r.roles.map(roleLabel).join(', ')}` : ''}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 pr-4">{r.status === 'active' ? (r.onboarding_completed_at ? <Badge label="Active" tone="success" /> : <Badge label="Onboarding" tone="muted" />) : <Badge label={r.status === 'suspended' ? 'Suspended' : 'Deleted'} tone="danger" />}</td>
                    <td className="py-3 pr-4 type-caption text-muted whitespace-nowrap">{relativeTime(r.created_at)}</td>
                    <td className="py-3 pr-4 text-right tabular">{count(r.runs)}</td>
                    <td className="py-3 pr-4 text-right tabular whitespace-nowrap">{km(r.distance_m)}</td>
                    <td className="py-3 pr-4 text-right tabular">{count(r.loops)}</td>
                    <td className="py-3 pr-5 type-caption text-muted whitespace-nowrap">{r.last_run_at ? relativeTime(r.last_run_at) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-5"><EmptyState icon="users" title="No runners match" body="Try part of a handle or a display name." /></div>}
        {pages > 1 ? (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-line">
            <span className="type-caption text-muted">{count(list.total)} runners · page {page + 1} of {pages}</span>
            <div className="flex gap-2">
              {page > 0 ? <Link href={qs({ page: page - 1 })} className={buttonClass('secondary', 'sm')}>Previous</Link> : null}
              {page + 1 < pages ? <Link href={qs({ page: page + 1 })} className={buttonClass('secondary', 'sm')}>Next</Link> : null}
            </div>
          </div>
        ) : null}
      </Card>

      <Card title="Find by email">
        <form action="/runners" className="flex flex-wrap gap-2">
          <input name="email" type="email" defaultValue={email} placeholder="Exact email address" aria-label="Exact email address" className={cx(inputClass, 'flex-1 min-w-[240px]')} />
          <button type="submit" className={buttonClass('secondary')}>Look up</button>
        </form>
        <p className="type-caption text-muted">Must match exactly. Every lookup is recorded in the audit log with your name, and the address is never shown.</p>
        {byEmail ? (byEmail.length ? (
          <ul className="flex flex-col gap-2">
            {byEmail.map((u) => (
              <li key={u.user_id}><Link href={`/runners/${u.user_id}`} className="type-body-strong text-primary">@{u.handle}</Link> <span className="text-muted">· {u.display_name}</span></li>
            ))}
          </ul>
        ) : <p className="type-body text-muted">No account uses that address.</p>) : null}
      </Card>
    </>
  );
}
