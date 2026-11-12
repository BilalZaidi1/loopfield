import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { dateTime, humanize, relativeTime } from '@/lib/format';
import type { AuditRow } from '@/lib/types';
import { Badge, Card, EmptyState, JsonBlock, PageHeader, Table, buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Audit log' };

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('admin');
  const sp = await searchParams;
  const filters = {
    action: sp.action?.trim() || null,
    object_type: sp.object_type?.trim() || null,
    object_id: sp.object_id?.trim() || null,
    actor: sp.actor && UUID.test(sp.actor.trim()) ? sp.actor.trim() : null,
    before: sp.before && /^\d+$/.test(sp.before) ? Number(sp.before) : null
  };
  const [rows, tz] = await Promise.all([
    rpc<AuditRow[]>('ops_audit_log', {
      p_actor: filters.actor,
      p_action: filters.action,
      p_object_type: filters.object_type,
      p_object_id: filters.object_id,
      p_before: filters.before,
      p_limit: PAGE
    }),
    viewerTimeZone()
  ]);
  const last = rows.at(-1);
  const keep = new URLSearchParams(Object.entries({ action: filters.action, object_type: filters.object_type, object_id: filters.object_id, actor: filters.actor })
    .filter(([, v]) => v) as [string, string][]);
  const field = 'border-[1.5px] border-line rounded-md px-3 min-h-11 type-body bg-surface text-ink';

  return (
    <>
      <PageHeader title="Audit log" description="Every staff, organizer and system action recorded by the database, newest first. Entries cannot be edited or deleted from the console." />
      <Card>
        <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] items-end" action="/audit">
          <label className="flex flex-col gap-1"><span className="type-label">Action starts with</span><input name="action" defaultValue={filters.action ?? ''} placeholder="config_, moderation_" className={field} /></label>
          <label className="flex flex-col gap-1"><span className="type-label">Object type</span><input name="object_type" defaultValue={filters.object_type ?? ''} placeholder="app_config, profile" className={field} /></label>
          <label className="flex flex-col gap-1"><span className="type-label">Object ID</span><input name="object_id" defaultValue={filters.object_id ?? ''} className={field} /></label>
          <label className="flex flex-col gap-1"><span className="type-label">Actor user ID</span><input name="actor" defaultValue={filters.actor ?? ''} className={field} /></label>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass('secondary')}>Filter</button>
            {keep.size ? <Link href="/audit" className={buttonClass('ghost')}>Clear</Link> : null}
          </div>
        </form>
      </Card>
      <Card>
        {rows.length ? (
          <Table head={['When', 'Who', 'Action', 'Object', 'Details']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap" title={dateTime(r.created_at, tz ?? 'UTC')}>{relativeTime(r.created_at)}</td>
                <td className="whitespace-nowrap">
                  {r.actor_handle ? <Link className="text-primary" href={`/audit?actor=${r.actor_id}`}>@{r.actor_handle}</Link> : <span className="text-muted">{r.actor_kind}</span>}
                  {r.actor_kind !== 'staff' && r.actor_handle ? <span className="type-caption text-muted"> · {r.actor_kind}</span> : null}
                </td>
                <td><Badge label={humanize(r.action)} tone={/remov|suspend|invalid|revoke|dead/.test(r.action) ? 'danger' : 'info'} /></td>
                <td className="whitespace-nowrap">
                  <span className="text-muted">{r.object_type}</span>
                  {r.object_id ? <> · <Link className="font-mono text-[13px] text-primary" href={`/audit?object_type=${encodeURIComponent(r.object_type)}&object_id=${encodeURIComponent(r.object_id)}`}>{r.object_id.length > 24 ? `${r.object_id.slice(0, 8)}…` : r.object_id}</Link></> : null}
                </td>
                <td className="min-w-[180px]"><JsonBlock value={r.details} /></td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title="No entries match" />}
        <div className="flex justify-between pt-2">
          {filters.before ? <Link href={`/audit${keep.size ? `?${keep}` : ''}`} className="type-label text-primary">Newest</Link> : <span />}
          {rows.length === PAGE && last ? (
            <Link href={`/audit?${new URLSearchParams([...keep, ['before', String(last.id)]])}`} className="type-label text-primary">Older entries</Link>
          ) : null}
        </div>
      </Card>
    </>
  );
}
