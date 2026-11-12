import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { humanize, km, relativeTime, shortId } from '@/lib/format';
import type { IntegrityDetail } from '@/lib/types';
import { ActionButton } from '@/components/client';
import { Badge, Banner, ButtonLink, Card, JsonBlock, KeyValue, PageHeader } from '@/components/ui';
import { resolveCase, setHold } from '../actions';

export const metadata: Metadata = { title: 'Integrity case' };

export default async function IntegrityCasePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('integrity');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Opening a case is itself audited (integrity_viewed).
  const d = await rpc<IntegrityDetail | null>('ops_integrity_detail', { p_case: id });
  if (!d?.case) notFound();
  const c = d.case;
  const result = (d.claim ?? d.attempt ?? {}) as Record<string, unknown>;
  const a = d.activity;
  const usable = a && a.sample_count ? Math.round((a.usable_sample_count / a.sample_count) * 100) : null;
  const resolved = c.status === 'resolved';
  const notesLabel = d.appeal ? 'Notes (shared with the runner as the appeal response)' : 'Notes (kept on the case)';

  return (
    <>
      <PageHeader
        title={`${humanize(c.kind)} case`}
        description={<>Case {shortId(c.id)} · opened by {c.opened_by} {relativeTime(c.created_at)}</>}
        actions={<ButtonLink href="/integrity" variant="ghost">Back to queue</ButtonLink>}
      />
      <div className="flex flex-wrap gap-2">
        <Badge label={humanize(c.status)} tone={resolved ? 'muted' : 'warning'} />
        {c.hold_from_competition ? <Badge label="Held from competition" tone="warning" icon="lock" /> : null}
        {c.resolution ? <Badge label={`Resolution: ${humanize(c.resolution)}`} tone="info" /> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {d.appeal ? (
            <Banner tone="info" text={<>The runner appealed {relativeTime(d.appeal.created_at)}: “{d.appeal.reason}”</>} />
          ) : null}
          <Card title={d.claim ? 'Land claim' : 'Speed attempt'}>
            <KeyValue items={[
              { label: 'Status', value: humanize(String(result.status ?? '—')) },
              { label: 'Reasons', value: Array.isArray(result.reasons) && result.reasons.length ? (result.reasons as string[]).map(humanize).join(', ') : 'None' },
              { label: 'Rule version', value: String(result.rule_version ?? '—') },
              { label: 'Runner', value: <code className="font-mono text-[13px]">{String(result.user_id ?? c.subject_user_id ?? '—')}</code> }
            ]} />
            <JsonBlock value={result} summary="All fields" />
          </Card>
          <Card title="Recording quality">
            {a ? (
              <KeyValue items={[
                { label: 'Distance', value: km(a.distance_m) },
                { label: 'Duration', value: `${Math.round(a.elapsed_ms / 60000)} min` },
                { label: 'GPS samples', value: `${a.usable_sample_count} usable of ${a.sample_count}${usable != null ? ` (${usable}%)` : ''}` },
                { label: 'Gaps', value: <JsonBlock value={a.gaps} summary="Show gaps" /> },
                { label: 'Device', value: <JsonBlock value={a.device} summary="Show device" /> }
              ]} />
            ) : <p className="type-body text-muted">No activity is linked to this case.</p>}
            <p className="type-caption text-muted">The raw GPS trace stays in storage. Viewing it through a short-lived, audited link comes with the ops-admin function.</p>
          </Card>
          {c.notes ? <Card title="Notes"><p className="type-body whitespace-pre-wrap">{c.notes}</p></Card> : null}
        </div>

        <Card title="Decide" className="self-start lg:sticky lg:top-20">
          {resolved ? (
            <p className="type-body text-muted">Resolved {relativeTime(c.resolved_at)}.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {c.hold_from_competition ? (
                <ActionButton label="Release hold" variant="secondary" requireReason={false} action={setHold.bind(null, c.id, false)}
                  description="Puts the result back into competition and replays its ledger." />
              ) : (
                <ActionButton label="Hold from competition" variant="secondary" requireReason={false} action={setHold.bind(null, c.id, true)}
                  description="Takes the result out of competition while you review. Only its own ledger is replayed." />
              )}
              <div className="h-px bg-line my-1" />
              <ActionButton label="Uphold result" variant="primary" reasonLabel={notesLabel} action={resolveCase.bind(null, c.id, 'upheld')}
                description="The result stands as recorded." />
              <ActionButton label="Overturn and restore" variant="secondary" reasonLabel={notesLabel} action={resolveCase.bind(null, c.id, 'overturned')}
                description="Restores a result that was held or invalidated." />
              <ActionButton label="Invalidate result" variant="danger" confirmPhrase="invalidate" reasonLabel={notesLabel} action={resolveCase.bind(null, c.id, 'invalidated')}
                description="Removes the land or title permanently and replays the ledger." />
              <ActionButton label="No action" variant="ghost" reasonLabel={notesLabel} action={resolveCase.bind(null, c.id, 'no_action')}
                description="Closes the case without changing anything." />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
