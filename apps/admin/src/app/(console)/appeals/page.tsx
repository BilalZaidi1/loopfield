import type { Metadata } from 'next';
import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { age, dateTime, humanize } from '@/lib/format';
import type { AppealRow } from '@/lib/types';
import { redirect } from 'next/navigation';
import { ActionButton } from '@/components/client';
import { Badge, Card, EmptyState, PageHeader, SegmentedLinks } from '@/components/ui';
import { decideAppeal } from './actions';

export const metadata: Metadata = { title: 'Appeals' };

const EFFECT: Record<string, string> = {
  post: 'Accepting restores the post.',
  comment: 'Accepting restores the comment.',
  account_action: 'Accepting reinstates the suspended account.',
  moderation_case: 'Accepting records the decision as overturned.',
  route_proposal: 'Accepting records the decision as overturned; re-review the proposal if needed.'
};

export default async function AppealsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireStaff();
  if (!can(ctx, 'moderation') && !can(ctx, 'integrity')) redirect('/no-access?permission=moderation');
  const { status: raw } = await searchParams;
  const status = raw === 'decided' ? 'decided' : 'open';
  const [rows, tz] = await Promise.all([rpc<AppealRow[]>('ops_appeals_queue', { p_status: status, p_limit: 200 }), viewerTimeZone()]);

  return (
    <>
      <PageHeader title="Appeals" description="Runners can appeal a removal, a suspension or a competitive decision once. Your written response is sent to them." />
      <SegmentedLinks label="Appeal status" value={status} options={[
        { value: 'open', label: 'Waiting', href: '/appeals' },
        { value: 'decided', label: 'Decided', href: '/appeals?status=decided' }
      ]} />
      {rows.length ? (
        <div className="flex flex-col gap-3">
          {rows.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge label={a.track === 'competitive' ? 'Competitive' : 'Content'} tone={a.track === 'competitive' ? 'title' : 'info'} />
                <span className="type-body font-semibold">{humanize(a.object_type)}</span>
                <span className="type-caption text-muted">by @{a.user_handle ?? 'unknown'} · {status === 'open' ? `waiting ${age(a.created_at)}` : `decided ${dateTime(a.decided_at, tz ?? 'UTC')}`}</span>
                {status === 'decided' ? <Badge label={humanize(a.status)} tone={a.status === 'overturned' ? 'success' : 'muted'} /> : null}
              </div>
              <blockquote className="type-body whitespace-pre-wrap border-l-4 border-line pl-3">{a.reason}</blockquote>
              {a.response ? <p className="type-caption text-muted">Response: “{a.response}”</p> : null}
              {status === 'open' ? (
                a.track === 'competitive' ? (
                  a.integrity_case_id ? (
                    <Link href={`/integrity/${a.integrity_case_id}`} className="type-label text-primary self-start">Decide in the integrity case</Link>
                  ) : <p className="type-caption text-muted">Waiting for its integrity case to open.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <ActionButton label="Accept appeal" variant="primary" reasonLabel="Response to the runner"
                      description={EFFECT[a.object_type]}
                      action={decideAppeal.bind(null, a.id, a.object_type === 'account_action' ? 'account' : 'content', true)} />
                    <ActionButton label="Decline appeal" variant="ghost" reasonLabel="Response to the runner"
                      description="The original decision stands."
                      action={decideAppeal.bind(null, a.id, a.object_type === 'account_action' ? 'account' : 'content', false)} />
                  </div>
                )
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <Card><EmptyState title={status === 'open' ? 'No appeals waiting' : 'No decided appeals yet'} /></Card>
      )}
    </>
  );
}
