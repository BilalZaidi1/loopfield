import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { age, humanize } from '@/lib/format';
import type { ModerationQueueRow } from '@/lib/types';
import { AutoRefresh } from '@/components/client';
import { Badge, Card, EmptyState, PageHeader, Row, SegmentedLinks } from '@/components/ui';

export const metadata: Metadata = { title: 'Moderation' };

const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'in_review', label: 'In review' },
  { value: 'actioned', label: 'Actioned' },
  { value: 'dismissed', label: 'Dismissed' }
];

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePermission('moderation');
  const { status: raw } = await searchParams;
  const status = STATUSES.some((s) => s.value === raw) ? raw! : 'open';
  const rows = await rpc<ModerationQueueRow[]>('ops_moderation_queue', { p_status: status, p_limit: 200 });
  return (
    <>
      <AutoRefresh seconds={45} />
      <PageHeader title="Moderation" description="Reports grouped into cases. Urgent cases first, then oldest. Every decision needs a reason and notifies the runner." />
      <SegmentedLinks label="Case status" value={status} options={STATUSES.map((s) => ({ ...s, href: `/moderation?status=${s.value}` }))} />
      <Card>
        {rows.length ? (
          <div className="flex flex-col">
            {rows.map((r) => (
              <Row
                key={r.id}
                href={`/moderation/${r.id}`}
                title={<span className="flex items-center gap-2">{humanize(r.object_type)} <span className="type-caption text-muted font-normal">#{r.object_id.slice(0, 8)}</span></span>}
                subtitle={`${r.report_count} report${r.report_count === 1 ? '' : 's'} · ${(r.categories ?? []).map(humanize).join(', ') || 'no category'} · waiting ${age(r.created_at)}`}
                right={
                  <span className="flex items-center gap-2">
                    {r.priority === 'urgent' ? <Badge label="Urgent" tone="danger" /> : null}
                    <Badge label={humanize(r.status)} tone={r.status === 'open' ? 'warning' : 'muted'} />
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title={status === 'open' ? 'No open cases' : 'Nothing here'} body={status === 'open' ? 'New reports appear here automatically.' : undefined} />
        )}
      </Card>
    </>
  );
}
