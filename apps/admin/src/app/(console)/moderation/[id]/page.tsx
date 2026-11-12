import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { dateTime, humanize, relativeTime, shortId } from '@/lib/format';
import type { ModerationCase } from '@/lib/types';
import { ActionButton } from '@/components/client';
import { Badge, ButtonLink, Card, JsonBlock, KeyValue, PageHeader, Row } from '@/components/ui';
import { moderate } from '../actions';

export const metadata: Metadata = { title: 'Moderation case' };

const REMOVE_EFFECT: Record<string, string> = {
  post: 'Hides the post from everyone.',
  comment: 'Hides the comment.',
  profile: 'Clears the bio and photo and resets the display name to “Runner”.',
  club: 'Suspends the club.',
  route: 'Withdraws the course and its titles.',
  message: 'Deletes the message from the chat service.'
};

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('moderator');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [data, tz] = await Promise.all([rpc<ModerationCase | null>('ops_moderation_case', { p_case: id }), viewerTimeZone()]);
  if (!data) notFound();
  const c = data.case;
  const open = c.status === 'open' || c.status === 'in_review';
  const obj = data.object ?? {};
  const restorable = ['post', 'comment', 'club'].includes(c.object_type);

  return (
    <>
      <PageHeader
        title={`Reported ${c.object_type}`}
        description={<>Case {shortId(c.id)} · opened {relativeTime(c.created_at)} · {c.report_count} report{c.report_count === 1 ? '' : 's'}</>}
        actions={<ButtonLink href="/moderation" variant="ghost">Back to queue</ButtonLink>}
      />
      <div className="flex flex-wrap gap-2">
        {c.priority === 'urgent' ? <Badge label="Urgent" tone="danger" /> : null}
        <Badge label={humanize(c.status)} tone={open ? 'warning' : 'muted'} />
        {c.outcome ? <Badge label={`Outcome: ${humanize(c.outcome)}`} tone="info" /> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Card title={humanize(c.object_type)}>
            <ReportedObject type={c.object_type} obj={obj} />
          </Card>
          <Card title="Reports">
            <div className="flex flex-col">
              {(data.reports ?? []).map((r, i) => (
                <Row key={i} title={<Badge label={humanize(r.category)} tone={r.category === 'self_harm' || r.category === 'violence' ? 'danger' : 'info'} />}
                  subtitle={<>{r.details ? `“${r.details}” · ` : ''}{relativeTime(r.created_at)}</>} />
              ))}
            </div>
          </Card>
          {data.evidence?.length ? (
            <Card title="Restricted evidence">
              <p className="type-caption text-muted">Captured when the report was made (for example a reported message). Only moderators can see this.</p>
              {data.evidence.map((e, i) => <JsonBlock key={i} value={e} summary={`Evidence ${i + 1}`} />)}
            </Card>
          ) : null}
          {data.actions?.length ? (
            <Card title="Decisions">
              <div className="flex flex-col">
                {data.actions.map((a, i) => (
                  <Row key={i} title={humanize(a.action)} subtitle={`${a.reason ?? ''} · ${dateTime(a.at, tz ?? 'UTC')}`} />
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <Card title="Decide" className="self-start lg:sticky lg:top-20">
          <p className="type-caption text-muted">The runner is notified of every decision except a dismissal.</p>
          <div className="flex flex-col gap-2">
            {open ? (
              <>
                <ActionButton label="Remove content" variant="danger" action={moderate.bind(null, c.id, 'remove_content')} description={REMOVE_EFFECT[c.object_type]} />
                <ActionButton label="Warn the runner" variant="secondary" action={moderate.bind(null, c.id, 'warn')} description="Records a warning and notifies the runner. Nothing is removed." />
                {c.subject_user_id ? (
                  <ActionButton label="Suspend account" variant="danger" confirmPhrase="suspend" action={moderate.bind(null, c.id, 'suspend_account')}
                    description="The runner can't use the app until reinstated. Their chat access is deactivated." />
                ) : null}
                <ActionButton label="Dismiss" variant="ghost" action={moderate.bind(null, c.id, 'dismiss')} description="Closes the case with no action. Reporters' reports are marked dismissed." />
              </>
            ) : (
              <>
                {restorable ? <ActionButton label="Restore content" variant="secondary" action={moderate.bind(null, c.id, 'restore_content')} description="Undoes a removal." /> : null}
                {c.subject_user_id ? <ActionButton label="Reinstate account" variant="secondary" action={moderate.bind(null, c.id, 'reinstate_account')} description="Lifts a suspension." /> : null}
                {c.outcome_reason ? <p className="type-caption text-muted">Reason given: “{c.outcome_reason}”</p> : null}
              </>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function ReportedObject({ type, obj }: { type: string; obj: Record<string, unknown> }) {
  const str = (k: string) => (typeof obj[k] === 'string' ? (obj[k] as string) : null);
  if (!Object.keys(obj).length) return <p className="type-body text-muted">The reported item no longer exists or is a message (see evidence).</p>;
  if (type === 'post' || type === 'comment') {
    const media = Array.isArray(obj.media) ? obj.media.length : 0;
    return (
      <div className="flex flex-col gap-3">
        <blockquote className="type-body whitespace-pre-wrap border-l-4 border-line pl-3">{str('body') || <span className="text-muted">No text</span>}</blockquote>
        <KeyValue items={[
          { label: 'Status', value: humanize(str('status') ?? '—') },
          ...(type === 'post' ? [{ label: 'Audience', value: humanize(str('audience') ?? '—') }, { label: 'Photos', value: media ? `${media} (photo review comes with the ops-admin function)` : 'None' }] : []),
          { label: 'Author', value: <code className="font-mono text-[13px]">{str('author')}</code> }
        ]} />
      </div>
    );
  }
  if (type === 'profile') {
    return <KeyValue items={[{ label: 'Handle', value: `@${str('handle')}` }, { label: 'Display name', value: str('display_name') }, { label: 'Bio', value: str('bio') }, { label: 'Photo', value: str('avatar_path') ? 'Has a photo' : 'None' }, { label: 'Status', value: humanize(str('status') ?? '—') }]} />;
  }
  if (type === 'club') {
    return <KeyValue items={[{ label: 'Name', value: str('name') }, { label: 'Description', value: str('description') }, { label: 'Rules', value: str('rules') }, { label: 'Status', value: humanize(str('status') ?? '—') }]} />;
  }
  return <JsonBlock value={obj} summary="Reported item" />;
}
