import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getOverview } from '@/lib/data';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { age, dateTime, relativeTime } from '@/lib/format';
import type { DeadJobRow } from '@/lib/types';
import { ActionButton, AutoRefresh } from '@/components/client';
import { Card, EmptyState, PageHeader, Table } from '@/components/ui';
import { retryDeadJobs, retryJob } from './actions';

export const metadata: Metadata = { title: 'Jobs' };

export default async function JobsPage() {
  await requirePermission('jobs');
  const [o, dead, tz] = await Promise.all([getOverview(), rpc<DeadJobRow[]>('ops_dead_jobs', { p_limit: 200 }), viewerTimeZone()]);
  const queues = Object.entries(o.jobs).sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Jobs"
        description="Durable background work: territory, speed, publication, notifications, media, email, chat, account and billing queues. Failed jobs retry with backoff, then stop here."
        actions={dead.length ? (
          <ActionButton label="Retry all failed" variant="primary" requireReason={false} icon="refresh" action={retryDeadJobs.bind(null, null)}
            description="Queues every failed job again, except duplicates that are already waiting." />
        ) : undefined}
      />
      <Card title="Queues">
        {queues.length ? (
          <Table head={['Queue', 'Waiting', 'Running', 'Failed', 'Failed or retried, 24 h', 'Oldest waiting', '']}>
            {queues.map(([name, q]) => (
              <tr key={name}>
                <td className="font-semibold">{name}</td>
                <td className="tabular">{q.queued}</td>
                <td className="tabular">{q.running}</td>
                <td className="tabular">{q.dead ? <span className="text-danger font-semibold">{q.dead}</span> : 0}</td>
                <td className="tabular">{q.failed_24h}</td>
                <td className="text-muted">{age(q.oldest_ready_at) ?? '—'}</td>
                <td className="text-right">
                  {q.dead ? <ActionButton label="Retry failed" size="sm" variant="ghost" requireReason={false} action={retryDeadJobs.bind(null, name)}
                    description={`Queues the failed ${name} jobs again.`} /> : null}
                </td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title="No jobs yet" />}
      </Card>
      <Card title="Failed jobs">
        {dead.length ? (
          <Table head={['Job', 'Attempts', 'Last error', 'Failed', '']}>
            {dead.map((j) => (
              <tr key={j.id}>
                <td className="whitespace-nowrap"><span className="font-semibold">{j.queue}</span>/{j.kind} <span className="type-caption text-muted">#{j.id}</span></td>
                <td className="tabular">{j.attempts}</td>
                <td className="max-w-[420px]"><code className="font-mono text-[12px] text-danger break-words">{j.last_error ?? '—'}</code></td>
                <td className="whitespace-nowrap" title={dateTime(j.updated_at, tz ?? 'UTC')}>{relativeTime(j.updated_at)}</td>
                <td className="text-right">
                  <ActionButton label="Retry" size="sm" variant="secondary" requireReason={false} action={retryJob.bind(null, j.id)}
                    description="Resets attempts and queues this job now. Fix the cause first if the error is not transient." />
                </td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title="No failed jobs" body="Jobs that run out of retries land here." />}
      </Card>
    </>
  );
}
