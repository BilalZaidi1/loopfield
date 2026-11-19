import type { Metadata } from 'next';
import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { dateTime, humanize, platformLabel, relativeTime } from '@/lib/format';
import type { SupportTicketDetail } from '@/lib/types';
import { Avatar, Badge, Card, cx, KeyValue, ListGroup, PageHeader, Row } from '@/components/ui';
import { STATUS_BADGE } from '../status';
import { ReplyBox, TicketControls } from './reply-box';
import { replyToTicket, updateTicket } from '../actions';

export const metadata: Metadata = { title: 'Support conversation' };

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission('support');
  const { id } = await params;
  const [t, tz] = await Promise.all([rpc<SupportTicketDetail>('ops_support_ticket', { p_ticket: id }), viewerTimeZone()]);
  const zone = tz ?? 'UTC';
  const tk = t.ticket;
  return (
    <>
      <PageHeader title={tk.subject}
        description={<span className="inline-flex flex-wrap items-center gap-2"><Badge label={STATUS_BADGE[tk.status].label} tone={STATUS_BADGE[tk.status].tone} /><Badge label={humanize(tk.category)} tone="muted" /> started {relativeTime(tk.created_at)}</span>}
        actions={<Link href="/support" className="type-label text-primary">Back to inbox</Link>} />
      <div className="grid grid-cols-12 gap-4 items-start">
        <div className="col-span-12 xl:col-span-8 flex flex-col gap-4 min-w-0">
          <Card>
            <ol className="flex flex-col gap-4" aria-label="Messages">
              {t.messages.map((m) => m.from === 'system' ? (
                <li key={m.id} className="type-caption text-muted text-center">{m.body} · {relativeTime(m.at)}</li>
              ) : (
                <li key={m.id} className={cx('flex flex-col gap-1 max-w-[85%]', m.from === 'staff' ? 'self-end items-end' : 'self-start items-start')}>
                  <span className="type-caption text-muted">
                    {m.from === 'runner' ? `@${t.runner?.handle ?? 'runner'}` : m.internal ? `Internal note · @${m.author ?? 'staff'}` : `@${m.author ?? 'staff'} (shown as Loopfield support)`} · <span title={dateTime(m.at, zone)}>{relativeTime(m.at)}</span>
                  </span>
                  <div className={cx('rounded-lg px-4 py-3 type-body whitespace-pre-wrap break-words',
                    m.from === 'runner' ? 'bg-surface-alt rounded-bl-[6px]' : m.internal ? 'bg-warning-soft border border-dashed border-warning rounded-br-[6px]' : 'bg-primary-fill text-white rounded-br-[6px]')}>
                    {m.body}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <ReplyBox id={tk.id} status={tk.status} reply={replyToTicket} />
        </div>
        <aside className="col-span-12 xl:col-span-4 flex flex-col gap-4 min-w-0">
          {t.runner ? (
            <Card>
              <div className="flex items-center gap-3">
                <Avatar name={t.runner.display_name} size={48} />
                <div className="min-w-0">
                  <div className="type-heading truncate">{t.runner.display_name}</div>
                  <div className="type-caption text-muted">@{t.runner.handle}{t.runner.status !== 'active' ? ` · ${t.runner.status}` : ''}</div>
                </div>
              </div>
              <KeyValue items={[
                { label: 'Joined', value: relativeTime(t.runner.joined_at) },
                { label: 'Runs', value: t.runner.runs },
                { label: 'Last run', value: relativeTime(t.runner.last_run_at) },
                { label: 'Conversations', value: t.runner.tickets }
              ]} />
              {can(ctx, 'users.view') ? <Link href={`/runners/${t.runner.id}`} className="type-label text-primary">Open runner profile</Link> : null}
            </Card>
          ) : null}
          <Card title="Conversation">
            <TicketControls id={tk.id} status={tk.status} priority={tk.priority} assignee={tk.assigned_to} agents={t.agents} me={t.me} update={updateTicket} />
          </Card>
          <Card title="Sent from">
            <KeyValue items={[
              { label: 'App', value: tk.app_version ?? '—' },
              { label: 'Platform', value: platformLabel(tk.platform) },
              { label: 'Device', value: tk.device ?? '—' },
              { label: 'First reply', value: tk.first_response_at ? relativeTime(tk.first_response_at) : 'Not yet' }
            ]} />
          </Card>
          {t.other_tickets.length ? (
            <ListGroup title="Other conversations">
              {t.other_tickets.map((o) => <Row key={o.id} title={o.subject} subtitle={relativeTime(o.created_at)} href={`/support/${o.id}`} right={<Badge label={STATUS_BADGE[o.status].label} tone={STATUS_BADGE[o.status].tone} />} />)}
            </ListGroup>
          ) : null}
        </aside>
      </div>
    </>
  );
}
