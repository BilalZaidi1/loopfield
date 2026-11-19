import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { age, humanize } from '@/lib/format';
import type { SupportQueue } from '@/lib/types';
import { STATUS_BADGE } from './status';
import { AutoRefresh } from '@/components/client';
import { Avatar, Badge, buttonClass, Card, cx, EmptyState, inputClass, PageHeader, SegmentedLinks } from '@/components/ui';
import { Icon } from '@/components/icons';

export const metadata: Metadata = { title: 'Support inbox' };

const VIEWS = [
  { value: 'open', label: 'Open' },
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'pending', label: 'Waiting on runner' },
  { value: 'solved', label: 'Solved' },
  { value: 'all', label: 'All' }
] as const;


export default async function SupportPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  await requirePermission('support');
  const { view: v, q } = await searchParams;
  const view = VIEWS.find((x) => x.value === v)?.value ?? 'open';
  const data = await rpc<SupportQueue>('ops_support_queue', { p_view: view, p_query: q?.trim() || null, p_limit: 100 });
  const counts = data.counts as unknown as Record<string, number>;
  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Support inbox" description="Messages runners send from Help and feedback in the app. Replies notify the runner; internal notes stay with staff. Runners never see who answered." />
      <section className="grid grid-cols-12 gap-4" aria-label="Inbox summary">
        <Stat label="Open" value={data.counts.open} note={data.counts.oldest_open ? `Oldest waiting ${age(data.counts.oldest_open)}` : 'Nothing waiting'} />
        <Stat label="Unassigned" value={data.counts.unassigned} note="Open and nobody on it" />
        <Stat label="Urgent or high" value={data.counts.urgent} note="Open with raised priority" tone={data.counts.urgent ? 'danger' : undefined} />
        <Stat label="Waiting on runner" value={data.counts.pending} note="We replied; their move" />
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedLinks label="Inbox views" value={view} options={VIEWS.map((x) => ({ value: x.value, label: x.label, count: counts[x.value], href: `/support?view=${x.value}${q ? `&q=${encodeURIComponent(q)}` : ''}` }))} />
        <form action="/support" className="flex gap-2 w-full sm:w-auto">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={q ?? ''} placeholder="Subject or runner" aria-label="Search conversations" className={cx(inputClass, 'w-full sm:w-64')} />
          <button type="submit" className={buttonClass('secondary')}>Search</button>
        </form>
      </div>
      <Card padded={false}>
        {data.items.length ? (
          <ul className="divide-y divide-line">
            {data.items.map((t) => (
              <li key={t.id}>
                <Link href={`/support/${t.id}`} className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface-alt/60 transition-colors">
                  <span className="relative row-span-2 sm:row-span-1">
                    <Avatar name={t.runner.display_name} size={40} />
                    {t.staff_unread ? <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-orange ring-2 ring-surface" aria-label="Unread" /> : null}
                  </span>
                  <span className="min-w-0 flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cx('type-body-strong truncate', t.staff_unread && 'font-bold')}>{t.subject}</span>
                      {t.priority === 'urgent' || t.priority === 'high' ? <Badge label={humanize(t.priority)} tone="danger" /> : null}
                      <Badge label={humanize(t.category)} tone="muted" />
                    </span>
                    <span className="type-caption text-muted truncate">
                      @{t.runner.handle} · {t.last_message ? `${t.last_message.from === 'runner' ? '' : t.last_message.internal ? 'Note: ' : 'You: '}${t.last_message.body}` : ''}
                    </span>
                  </span>
                  <span className="col-start-2 sm:col-start-3 flex flex-wrap sm:flex-col items-center sm:items-end gap-2 sm:gap-1">
                    <Badge label={STATUS_BADGE[t.status].label} tone={STATUS_BADGE[t.status].tone} />
                    <span className="type-caption text-muted whitespace-nowrap inline-flex items-center gap-1">
                      <Icon name="clock" size={13} /> {age(t.last_message_at) ?? 'now'}{t.assignee ? ` · @${t.assignee.handle}` : ' · unassigned'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5"><EmptyState icon="chat" title={q ? 'No conversations match' : 'Nothing here'} body={view === 'open' ? 'Every conversation has an answer.' : 'Try another view.'} /></div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: number; note: string; tone?: 'danger' }) {
  return (
    <div className="col-span-6 xl:col-span-3 rounded-lg bg-surface p-5 flex flex-col gap-1 h-full">
      <span className="type-label text-muted">{label}</span>
      <span className={cx('type-metric', tone === 'danger' && value > 0 && 'text-danger')}>{value}</span>
      <span className="type-caption text-muted mt-auto">{note}</span>
    </div>
  );
}
