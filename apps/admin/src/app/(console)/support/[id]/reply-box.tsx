'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SupportPriority, SupportStatus } from '@/lib/types';
import type { ActionResult } from '@/lib/errors';
import { Button, cx, inputClass } from '@/components/ui';
import { toast } from '@/components/client';

const SAVED_REPLIES: { group: string; label: string; body: string }[] = [
  { group: 'General', label: 'Thanks, looking into it', body: 'Thanks for letting us know. We are looking into it and will get back to you here.' },
  { group: 'General', label: 'Ask for the run time', body: 'Could you tell us roughly when the run was (date and time)? That lets us check the GPS data for it.' },
  { group: 'General', label: 'Loop rules', body: 'A loop claims land when the finish is close to the start, the run is long enough and the GPS has no long gaps. Help and game rules in the app explains each check.' },
  { group: 'General', label: 'Fixed in an update', body: 'This is fixed in the latest version of the app. Please update from the store and let us know if it still happens.' },
  { group: 'Running tools', label: 'Live link sent to the wrong person',
    body: 'You can stop a live link at any time in Settings → Privacy, under Live location: End a link for one run, or Turn off the standing link. It stops working at once and the positions it showed are deleted. To keep a standing link but give it a new address, use Change the link, then send the new one only to the people you meant.' },
  { group: 'Running tools', label: 'Someone has my live link',
    body: 'Thank you for telling us. We have ended all of your live links, so the link they have no longer shows anything, and the positions it showed are deleted. When you want to share again, make a new link and send it only to people you trust. If you ever feel unsafe, contact your local emergency services first.' },
  { group: 'Running tools', label: 'Stop friends seeing my runs live',
    body: 'In Settings → Privacy, under Live runs with friends, turn off Share my live runs with friends. A run being shared ends at once. To share with only some people, choose Friends I choose instead and pick who can see your runs. Only people you follow who follow you back can be chosen.' },
  { group: 'Running tools', label: 'Path following isn’t working',
    body: 'When the route builder can’t follow paths, it draws that leg as a straight line and says why under the map. There is a daily limit on legs that follow paths, so after a lot of planning they are straight lines until the next day. Check that Follow paths is on and that you have a connection. Routes you have saved keep their lines either way.' },
  { group: 'Running tools', label: 'Heart-rate strap won’t connect',
    body: 'Most straps only wake up when they touch the skin, so put it on (a little water on the sensor pads helps) and keep it near the phone, then pair it in Settings → Sensors. A strap connects to one app at a time, so close other apps that use it. On Android, Loopfield needs the Nearby devices permission. Once it is paired, the phone connects to it by itself when a run starts.' },
  { group: 'Running tools', label: 'Imported run has no map',
    body: 'Maps of imported runs are off until you turn on Show maps for imported runs in Health → Sources. A map appears only when the app that recorded the run saved its route, and on Android you are asked once for each run another app recorded. These maps stay on your phone: they are never uploaded or shared.' },
  { group: 'Running tools', label: 'Shoe reminders',
    body: 'Each pair of shoes reminds you once when it reaches 90% of the distance you set, and once at 100%. You can change the distance on the pair’s page, and the reminders then follow the new distance. Retired pairs don’t send reminders.' }
];
const GROUPS = [...new Set(SAVED_REPLIES.map((r) => r.group))];

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
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {SAVED_REPLIES.map((r, i) => (r.group === g ? <option key={r.label} value={i}>{r.label}</option> : null))}
              </optgroup>
            ))}
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
