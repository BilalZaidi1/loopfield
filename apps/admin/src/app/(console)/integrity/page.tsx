import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { age, humanize } from '@/lib/format';
import type { IntegrityQueueRow } from '@/lib/types';
import { AutoRefresh } from '@/components/client';
import { Badge, Card, EmptyState, PageHeader, Row } from '@/components/ui';

export const metadata: Metadata = { title: 'Integrity' };

export default async function IntegrityPage() {
  await requireRole('integrity_reviewer');
  const rows = await rpc<IntegrityQueueRow[]>('ops_integrity_queue', { p_limit: 200 });
  return (
    <>
      <AutoRefresh seconds={45} />
      <PageHeader
        title="Integrity"
        description="Disputed land claims and speed attempts. Holding a result replays only its own ledger; a report alone never erases land."
      />
      <Card>
        {rows.length ? (
          <div className="flex flex-col">
            {rows.map((r) => (
              <Row
                key={r.id}
                href={`/integrity/${r.id}`}
                title={`${humanize(r.kind)} · opened by ${r.opened_by}`}
                subtitle={`${(r.reasons ?? []).map(humanize).join(', ') || 'No automatic reasons'} · result ${humanize(r.object_status ?? 'unknown')} · waiting ${age(r.created_at)}`}
                right={
                  <span className="flex items-center gap-2">
                    {r.hold ? <Badge label="Held" tone="warning" icon="lock" /> : null}
                    <Badge label={humanize(r.status)} tone={r.status === 'open' ? 'warning' : 'info'} />
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No open integrity cases" body="Cases opened by the rules engine, by reports or by appeals appear here." />
        )}
      </Card>
    </>
  );
}
