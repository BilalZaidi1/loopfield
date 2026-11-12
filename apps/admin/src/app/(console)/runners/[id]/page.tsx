import type { Metadata } from 'next';
import Link from 'next/link';
import { can, requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { count, dateTime, humanize, km, platformLabel, relativeTime } from '@/lib/format';
import type { RunnerOverview } from '@/lib/types';
import { ActionButton } from '@/components/client';
import { Avatar, Badge, Banner, Card, KeyValue, ListGroup, PageHeader, Row, Table } from '@/components/ui';
import { STATUS_BADGE } from '../../support/status';
import { ResetProfile } from './reset-profile';
import { resetRunnerProfile, setRunnerStatus, signOutRunner } from '../actions';

export const metadata: Metadata = { title: 'Runner' };

const hours = (ms: number) => `${Math.round(ms / 3_600_000)} h`;

export default async function RunnerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission('users.view');
  const { id } = await params;
  const [r, tz] = await Promise.all([rpc<RunnerOverview>('ops_user_overview', { p_user: id }), viewerTimeZone()]);
  const zone = tz ?? 'UTC';
  const p = r.profile;
  const s = r.stats;
  const manage = r.can_manage && !r.is_self && p.status !== 'deleted';
  return (
    <>
      <PageHeader title={p.display_name} description={<>@{p.handle}{p.district || p.city_label ? ` · ${[p.district, p.city_label].filter(Boolean).join(', ')}` : ''} · joined {relativeTime(p.created_at)}</>}
        actions={<Link href="/runners" className="type-label text-primary">All runners</Link>} />
      {p.status === 'suspended' ? <Banner tone="danger" text="This account is suspended: the runner can sign in and appeal, but cannot compete, post or message." /> : null}

      <section className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-5 xl:col-span-4 h-full">
          <div className="flex items-center gap-4">
            <Avatar name={p.display_name} size={64} />
            <div className="min-w-0 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                {p.status === 'active' ? <Badge label="Active" tone="success" /> : <Badge label={humanize(p.status)} tone="danger" />}
                {r.roles.map((x) => <Badge key={x.role} label={x.label} tone={x.role === 'admin' ? 'title' : 'violet'} />)}
              </div>
              <p className="type-caption text-muted">{p.visibility === 'public' ? 'Public profile' : `${humanize(p.visibility)} profile`}{p.discoverable ? ' · discoverable' : ''}</p>
            </div>
          </div>
          {p.bio ? <p className="type-body">{p.bio}</p> : null}
          <KeyValue items={[
            { label: 'Last sign-in', value: r.account.last_sign_in_at ? <span title={dateTime(r.account.last_sign_in_at, zone)}>{relativeTime(r.account.last_sign_in_at)}</span> : '—' },
            { label: 'Email confirmed', value: r.account.email_confirmed ? 'Yes' : 'No' },
            { label: 'Onboarding', value: p.onboarding_completed_at ? `Finished ${relativeTime(p.onboarding_completed_at)}` : 'Not finished' },
            { label: 'Devices', value: r.devices.length ? r.devices.map((d) => `${platformLabel(d.platform)}${d.disabled ? ' (off)' : ''}`).join(', ') : 'No push devices' },
            { label: 'User ID', value: <code className="font-mono text-[12px] break-all">{p.id}</code> }
          ]} />
          {manage ? (
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              {p.status === 'active' ? (
                <ActionButton label="Suspend" variant="danger" size="sm" title={`Suspend @${p.handle}?`} confirmPhrase={`@${p.handle}`}
                  description="They can still sign in, see their data and appeal, but cannot compete, post, comment or message. They are signed out everywhere."
                  action={setRunnerStatus.bind(null, p.id, 'suspended', true)} />
              ) : (
                <ActionButton label="Reinstate" variant="primary" size="sm" title={`Reinstate @${p.handle}?`} action={setRunnerStatus.bind(null, p.id, 'active', false)} />
              )}
              <ActionButton label="Sign out everywhere" variant="secondary" size="sm" title={`Sign @${p.handle} out on every device?`}
                description="Ends all their sessions. They can sign in again straight away. Use it for a lost phone or a shared password."
                action={signOutRunner.bind(null, p.id)} />
              <ResetProfile handle={p.handle} action={resetRunnerProfile.bind(null, p.id)} />
            </div>
          ) : !r.can_manage ? <p className="type-caption text-muted mt-auto">Account actions need the “Suspend and sign out runners” permission.</p> : null}
        </Card>

        <div className="col-span-12 lg:col-span-7 xl:col-span-8 grid grid-cols-2 xl:grid-cols-4 auto-rows-fr gap-4">
          {[
            ['Runs', count(s.runs), `${count(s.runs_30d)} in 30 days`],
            ['Distance', km(s.distance_m), `${km(s.distance_30d_m)} in 30 days`],
            ['Loops claimed', count(s.loops_eligible), `${count(s.loops_rejected)} not counted`],
            ['Land cells', count(s.land_cells), `${count(s.movement_points)} movement points`],
            ['Time moving', hours(s.moving_ms), s.first_run_at ? `Since ${relativeTime(s.first_run_at)}` : 'No runs yet'],
            ['Followers', count(s.followers), `Follows ${count(s.following)}`],
            ['Clubs and posts', `${count(s.clubs)} · ${count(s.posts)}`, 'Clubs · published posts'],
            ['Reports', count(s.reports_against), `Against them · ${count(s.reports_filed)} filed`]
          ].map(([label, value, note]) => (
            <div key={label} className="rounded-lg bg-surface p-4 flex flex-col gap-1 h-full min-w-0">
              <span className="type-label text-muted truncate">{label}</span>
              <span className="text-[26px] leading-[30px] font-black italic tracking-[-0.5px] tabular-nums break-words">{value}</span>
              <span className="type-caption text-muted">{note}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-12 gap-4">
        <Card title="Recent runs" className="col-span-12 xl:col-span-7 h-full">
          {r.recent_activities.length ? (
            <Table head={['When', 'Distance', 'Moving', 'Land', 'Checks']}>
              {r.recent_activities.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap"><span title={dateTime(a.started_at, zone)}>{relativeTime(a.started_at)}</span>{a.title ? <div className="type-caption text-muted">{a.title}</div> : null}</td>
                  <td className="tabular whitespace-nowrap">{km(a.distance_m)}</td>
                  <td className="tabular whitespace-nowrap">{a.moving_ms ? `${Math.round(a.moving_ms / 60_000)} min` : '—'}</td>
                  <td>{a.claim_status ? <Badge label={a.claim_status === 'eligible' ? `${count(a.claim_cells)} cells` : humanize(a.claim_status)} tone={a.claim_status === 'eligible' ? 'success' : a.claim_status === 'pending_review' ? 'warning' : 'muted'} /> : <span className="text-muted">No loop</span>}</td>
                  <td>{a.integrity_flags?.length ? <Badge label={a.integrity_flags.map(humanize).join(', ')} tone="warning" /> : <span className="text-muted">Clean</span>}</td>
                </tr>
              ))}
            </Table>
          ) : <p className="type-body text-muted">No runs yet.</p>}
        </Card>
        <ListGroup title="Support" className="col-span-12 xl:col-span-5 h-full">
          {r.support_tickets.length ? r.support_tickets.map((t) => (
            <Row key={t.id} icon="chat" title={t.subject} subtitle={`${humanize(t.category)} · ${relativeTime(t.last_message_at)}`}
              href={can(ctx, 'support') ? `/support/${t.id}` : undefined}
              right={<Badge label={STATUS_BADGE[t.status as keyof typeof STATUS_BADGE]?.label ?? t.status} tone={STATUS_BADGE[t.status as keyof typeof STATUS_BADGE]?.tone ?? 'muted'} />} />
          )) : <p className="type-body text-muted pb-4">No support conversations.</p>}
        </ListGroup>
      </section>

      <section className="grid grid-cols-12 gap-4">
        <ListGroup title="Moderation cases" className="col-span-12 md:col-span-6 xl:col-span-4 h-full">
          {r.moderation_cases.length ? r.moderation_cases.map((m) => (
            <Row key={m.id} icon="flag" title={`${humanize(m.object_type)} · ${m.report_count} report${m.report_count === 1 ? '' : 's'}`} subtitle={`${humanize(m.status)}${m.outcome ? ` · ${humanize(m.outcome)}` : ''} · ${relativeTime(m.created_at)}`}
              href={can(ctx, 'moderation') ? `/moderation/${m.id}` : undefined} />
          )) : <p className="type-body text-muted pb-4">None.</p>}
        </ListGroup>
        <ListGroup title="Integrity cases" className="col-span-12 md:col-span-6 xl:col-span-4 h-full">
          {r.integrity_cases.length ? r.integrity_cases.map((c) => (
            <Row key={c.id} icon="shield" title={humanize(c.kind)} subtitle={`${humanize(c.status)}${c.hold_from_competition ? ' · held' : ''} · ${relativeTime(c.created_at)}`}
              href={can(ctx, 'integrity') ? `/integrity/${c.id}` : undefined} />
          )) : <p className="type-body text-muted pb-4">None.</p>}
        </ListGroup>
        <ListGroup title="Account" className="col-span-12 md:col-span-12 xl:col-span-4 h-full">
          <Row icon="sparkle" title="Premium" subtitle={r.entitlements.length ? r.entitlements.map((e) => `${e.entitlement}: ${e.status}${e.expires_at ? `, until ${relativeTime(e.expires_at)}` : ''}`).join(' · ') : 'Free'} />
          <Row icon="check" title="Consents" subtitle={r.consents.length ? r.consents.map((c) => `${humanize(c.kind)} ${c.granted ? 'yes' : 'no'}`).join(' · ') : 'None recorded'} />
          <Row icon="download" title="Data export" subtitle={r.lifecycle.exports[0] ? `${humanize(r.lifecycle.exports[0].status)} · ${relativeTime(r.lifecycle.exports[0].created_at)}` : 'Never requested'} />
          <Row icon="trash" title="Deletion" subtitle={r.lifecycle.deletion ? `${humanize(r.lifecycle.deletion.status)} · ${relativeTime(r.lifecycle.deletion.requested_at)}` : 'Not requested'} />
        </ListGroup>
      </section>

      <Card title="Staff actions on this account">
        {r.staff_actions.length ? (
          <Table head={['When', 'Action', 'By', 'Reason']}>
            {r.staff_actions.map((a) => (
              <tr key={String(a.id)}>
                <td className="whitespace-nowrap" title={dateTime(a.created_at, zone)}>{relativeTime(a.created_at)}</td>
                <td>{humanize(a.action)}</td>
                <td>@{a.actor ?? 'unknown'}</td>
                <td className="text-muted">{a.reason ?? '—'}</td>
              </tr>
            ))}
          </Table>
        ) : <p className="type-body text-muted">No staff actions yet.</p>}
      </Card>
    </>
  );
}
