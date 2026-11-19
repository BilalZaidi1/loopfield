'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SupportPriority, SupportStatus } from '@/lib/types';
import type { ActionResult } from '@/lib/errors';
import { Button, cx, inputClass } from '@/components/ui';
import { toast } from '@/components/client';

const SAVED_REPLIES = [
  { label: 'Thanks, looking into it', body: 'Thanks for letting us know. We are looking into it and will get back to you here.' },
  { label: 'Ask for the run time', body: 'Could you tell us roughly when the run was (date and time)? That lets us check the GPS data for it.' },
  { label: 'Loop rules', body: 'A loop claims land when the finish is close to the start, the run is long enough and the GPS has no long gaps. Help and game rules in the app explains each check.' },
  { label: 'Fixed in an update', body: 'This is fixed in the latest version of the app. Please update from the store and let us know if it still happens.' }
];

/** Reply composer: send to the runner (notified) or add an internal note; optionally change the status. */
export function ReplyBox({ id, status, reply }: {
  id: string;
  status: SupportStatus;
  reply: (id: string, body: string, internal: boolean, status: SupportStatus | null) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [pending, start] = useTransition();
  const send = (next: SupportStatus | null) =>
    start(async () => {
      const r = await reply(id, body, internal, next);
      if (r.ok) { setBody(''); toast(r.message ?? 'Sent'); router.refresh(); } else toast(r.error, 'danger');
    });
  return (
    <div className={cx('rounded-lg p-4 flex flex-col gap-3', internal ? 'bg-warning-soft' : 'bg-surface')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Message type" className="inline-flex rounded-full bg-surface-sunken p-1">
          {[{ v: false, l: 'Reply to runner' }, { v: true, l: 'Internal note' }].map((o) => (
            <button key={o.l} role="tab" aria-selected={internal === o.v} type="button" onClick={() => setInternal(o.v)}
              className={cx('rounded-full px-4 min-h-9 type-label', internal === o.v ? 'bg-surface text-ink shadow-raised' : 'text-muted')}>{o.l}</button>
          ))}
        </div>
        {!internal ? (
          <select aria-label="Insert a saved reply" className="border border-line-strong rounded-md px-2 min-h-9 type-label bg-surface text-ink" value=""
            onChange={(e) => { const r = SAVED_REPLIES[Number(e.target.value)]; if (r) setBody((b) => (b ? `${b}\n\n${r.body}` : r.body)); }}>
            <option value="">Saved replies…</option>
            {SAVED_REPLIES.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
          </select>
        ) : null}
      </div>
      <textarea aria-label={internal ? 'Internal note' : 'Reply'} value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000}
        placeholder={internal ? 'Only staff see notes.' : 'The runner sees this as “Loopfield support”.'}
        className={cx(inputClass, 'py-3 min-h-28 resize-y w-full')}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) send(internal ? null : 'pending'); }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-caption text-muted">{internal ? 'Notes never reach the runner.' : 'Ctrl or ⌘ + Enter sends. The runner gets a push notification.'}</span>
        <div className="flex flex-wrap gap-2">
          {internal ? (
            <Button onClick={() => send(null)} disabled={pending || !body.trim()}>Add note</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => send('solved')} disabled={pending || !body.trim()}>Send and mark solved</Button>
              <Button onClick={() => send('pending')} disabled={pending || !body.trim()} arrow>Send reply</Button>
            </>
          )}
        </div>
      </div>
      {status === 'closed' ? <p className="type-caption text-muted">This conversation is closed. A reply reopens it for staff, but the runner has to start a new conversation to answer.</p> : null}
    </div>
  );
}

/** Status, priority and assignee controls for the side panel. */
export function TicketControls({ id, status, priority, assignee, agents, me, update }: {
  id: string;
  status: SupportStatus;
  priority: SupportPriority;
  assignee: string | null;
  agents: { id: string; handle: string }[];
  me: string;
  update: (id: string, change: { status?: SupportStatus; priority?: SupportPriority; assignee?: string | null }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (change: Parameters<typeof update>[1]) =>
    start(async () => {
      const r = await update(id, change);
      if (r.ok) { toast(r.message ?? 'Updated'); router.refresh(); } else toast(r.error, 'danger');
    });
  const select = 'border border-line-strong focus:border-primary focus:outline-none rounded-md px-3 min-h-11 type-body bg-surface text-ink w-full';
  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <label className="flex flex-col gap-1">
        <span className="type-label">Status</span>
        <select className={select} value={status} disabled={pending} onChange={(e) => run({ status: e.target.value as SupportStatus })}>
          <option value="open">Open</option>
          <option value="pending">Waiting on runner</option>
          <option value="solved">Solved</option>
          <option value="closed">Closed</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="type-label">Priority</span>
        <select className={select} value={priority} disabled={pending} onChange={(e) => run({ priority: e.target.value as SupportPriority })}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="type-label">Assigned to</span>
        <select className={select} value={assignee ?? ''} disabled={pending} onChange={(e) => run({ assignee: e.target.value || null })}>
          <option value="">Nobody</option>
          {agents.map((a) => <option key={a.id} value={a.id}>@{a.handle}{a.id === me ? ' (you)' : ''}</option>)}
        </select>
      </label>
      {assignee !== me ? <Button variant="secondary" size="sm" onClick={() => run({ assignee: me })} disabled={pending}>Assign to me</Button> : null}
    </div>
  );
}
