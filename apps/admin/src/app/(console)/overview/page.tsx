import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { getOverview } from '@/lib/data';
import { hasRole } from '@/lib/roles';
import { viewerTimeZone } from '@/lib/tz';
import { age, ageMinutes, count, dateTime, relativeTime } from '@/lib/format';
import { SWITCHES, asMaintenance } from '@/lib/switches';
import { AutoRefresh } from '@/components/client';
import { Badge, Banner, Card, PageHeader, Row, StatTile, Table } from '@/components/ui';

export const metadata: Metadata = { title: 'Overview' };

const STALE_JOB_MIN = 10;

export default async function OverviewPage() {
  const ctx = await requireStaff();
  const [o, tz] = await Promise.all([getOverview(), viewerTimeZone()]);
  const s = o.settings;
  const maintenance = asMaintenance(s.maintenance_mode);
  const offSwitches = SWITCHES.filter((sw) => s[sw.key] === false);
  const queues = Object.entries(o.jobs).sort(([a], [b]) => a.localeCompare(b));
  const dead = queues.reduce((n, [, q]) => n + q.dead, 0);
  const stale = queues.filter(([, q]) => ageMinutes(q.oldest_ready_at) > STALE_JOB_MIN);
  const failedCron = o.cron.filter((c) => c.last_status === 'failed');
  const isAdmin = hasRole(ctx.roles, 'admin');

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Overview" description={<>Live state of the app. Updated {relativeTime(o.generated_at)}; refreshes every 30 seconds.</>} />

      <div className="flex flex-col gap-2">
        {maintenance.enabled ? <Banner tone="danger" text={`Maintenance mode is on: “${maintenance.message ?? ''}”`} action={<Link href="/settings?tab=release" className="type-label text-primary">Manage</Link>} /> : null}
        {offSwitches.length ? (
          <Banner tone="warning" text={`Switched off: ${offSwitches.map((x) => x.label).join(', ')}.`} action={<Link href="/settings" className="type-label text-primary">Review</Link>} />
        ) : null}
        {dead ? <Banner tone="danger" text={`${dead} job${dead === 1 ? '' : 's'} failed permanently and need a retry or a fix.`} action={isAdmin ? <Link href="/jobs" className="type-label text-primary">Open jobs</Link> : undefined} /> : null}
        {stale.length ? <Banner tone="warning" text={`Jobs are waiting longer than ${STALE_JOB_MIN} minutes in: ${stale.map(([q]) => q).join(', ')}. Check the job runner.`} /> : null}
        {failedCron.length ? <Banner tone="danger" text={`Scheduled task failed: ${failedCron.map((c) => c.job).join(', ')}.`} /> : null}
        {o.billing.failed_events_7d ? <Banner tone="warning" text={`${o.billing.failed_events_7d} billing events failed to apply in the last 7 days.`} /> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <StatTile label="Runs, last 24 h" value={count(o.activity_24h.runs)} />
        <StatTile label="Land claims, last 24 h" value={count(o.activity_24h.claims)} />
        <StatTile label="Sign-ups, last 24 h" value={count(o.activity_24h.sign_ups)} />
        <StatTile label="Posts, last 24 h" value={count(o.activity_24h.posts)} />
        <StatTile label="Active runners" value={count(o.totals.runners)} note={o.totals.suspended ? `${count(o.totals.suspended)} suspended` : undefined} />
        <StatTile label="Clubs" value={count(o.totals.clubs)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
        <Card title="Needs attention">
          <div className="flex flex-col">
            <Row
              title="Moderation"
              subtitle={queueSubtitle(o.queues.moderation.open, o.queues.moderation.oldest, `${o.queues.reports_24h} reports in the last 24 h`)}
              href={hasRole(ctx.roles, 'moderator') ? '/moderation' : undefined}
              right={<QueueBadges open={o.queues.moderation.open} extra={o.queues.moderation.urgent ? { label: `${o.queues.moderation.urgent} urgent`, tone: 'danger' } : undefined} />}
            />
            <Row
              title="Integrity"
              subtitle={queueSubtitle(o.queues.integrity.open, o.queues.integrity.oldest, o.queues.integrity.held ? `${o.queues.integrity.held} held from competition` : null)}
              href={hasRole(ctx.roles, 'integrity_reviewer') ? '/integrity' : undefined}
              right={<QueueBadges open={o.queues.integrity.open} />}
            />
            <Row title="Appeals" subtitle={queueSubtitle(o.queues.appeals.open, o.queues.appeals.oldest)}
              href={hasRole(ctx.roles, 'moderator') || hasRole(ctx.roles, 'integrity_reviewer') ? '/appeals' : undefined}
              right={<QueueBadges open={o.queues.appeals.open} />} />
            <Row title="Route proposals" subtitle={queueSubtitle(o.queues.routes.open, o.queues.routes.oldest)}
              href={hasRole(ctx.roles, 'route_reviewer') ? '/routes' : undefined}
              right={<QueueBadges open={o.queues.routes.open} />} />
            <Row title="Account requests" subtitle={`${o.queues.exports} data exports running · ${o.queues.deletions} deletions pending`} />
          </div>
        </Card>

        <Card title="App state" action={<Link href="/settings" className="type-label text-primary">App control</Link>}>
          <div className="flex flex-col">
            {SWITCHES.map((sw) => (
              <Row key={sw.key} title={sw.label} right={s[sw.key] === undefined ? <Badge label="Not set" tone="muted" /> : s[sw.key] ? <Badge label="On" tone="success" /> : <Badge label="Off" tone="danger" />} />
            ))}
            <Row title="Paywall" right={s.paywall_enabled ? <Badge label="On" tone="title" /> : <Badge label="Off · free pilot" tone="muted" />} />
            <Row title="Maintenance mode" right={maintenance.enabled ? <Badge label="On" tone="danger" /> : <Badge label="Off" tone="muted" />} />
            <Row title="Minimum app version" right={<span className="type-label tabular">{String(s.min_supported_app_version ?? '—').replace(/"/g, '')}</span>} />
            <Row title="MFA required for operator actions" right={s.ops_require_mfa ? <Badge label="Enforced" tone="success" /> : <Badge label="Console only" tone="warning" />} />
          </div>
        </Card>

        <Card title="Job queues" action={isAdmin ? <Link href="/jobs" className="type-label text-primary">Jobs</Link> : undefined}>
          {queues.length ? (
            <Table head={['Queue', 'Waiting', 'Running', 'Failed', 'Oldest waiting']}>
              {queues.map(([name, q]) => (
                <tr key={name}>
                  <td className="font-semibold">{name}</td>
                  <td className="tabular">{q.queued}</td>
                  <td className="tabular">{q.running}</td>
                  <td className="tabular">{q.dead ? <span className="text-danger font-semibold">{q.dead}</span> : 0}</td>
                  <td className={ageMinutes(q.oldest_ready_at) > STALE_JOB_MIN ? 'text-warning font-semibold' : 'text-muted'}>{age(q.oldest_ready_at) ?? '—'}</td>
                </tr>
              ))}
            </Table>
          ) : <p className="type-body text-muted">No jobs yet.</p>}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Active seasons">
            {o.seasons.length ? (
              <div className="flex flex-col">
                {o.seasons.map((x) => (
                  <Row key={`${x.competition}-${x.number}`} title={`${x.competition} · season ${x.number}`}
                    subtitle={`${x.status === 'settling' ? 'Settling' : 'Ends'} ${relativeTime(x.ends_at)} · ${dateTime(x.ends_at, tz ?? 'UTC')}`} />
                ))}
              </div>
            ) : <p className="type-body text-muted">No season is running.</p>}
          </Card>
          <Card title="Scheduled tasks">
            {o.cron.length ? (
              <div className="flex flex-col">
                {o.cron.map((c) => (
                  <Row key={c.job} title={c.job} subtitle={`${c.schedule} · last run ${relativeTime(c.last_start)}`}
                    right={!c.active ? <Badge label="Paused" tone="warning" /> : c.last_status === 'failed' ? <Badge label="Failed" tone="danger" /> : c.last_status ? <Badge label={c.last_status} tone="success" /> : <Badge label="No runs" tone="muted" />} />
                ))}
              </div>
            ) : <p className="type-body text-muted">pg_cron is not available in this environment.</p>}
          </Card>
          <Card title="Delivery">
            <div className="flex flex-col">
              <Row title="Email bounces and complaints, 7 days" right={<span className="type-label tabular">{o.email.bounced_7d}</span>} />
              <Row title="Email failures, 7 days" right={<span className={o.email.failed_7d ? 'type-label tabular text-danger' : 'type-label tabular'}>{o.email.failed_7d}</span>} />
              <Row title="Billing events not applied, 7 days" right={<span className={o.billing.failed_events_7d ? 'type-label tabular text-danger' : 'type-label tabular'}>{o.billing.failed_events_7d}</span>} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function queueSubtitle(open: number, oldest: string | null, extra?: string | null): string {
  const parts = [open ? `${open} open · oldest ${age(oldest)}` : 'Nothing waiting'];
  if (extra) parts.push(extra);
  return parts.join(' · ');
}

function QueueBadges({ open, extra }: { open: number; extra?: { label: string; tone: 'danger' | 'warning' } }) {
  return (
    <div className="flex items-center gap-2">
      {extra ? <Badge label={extra.label} tone={extra.tone} /> : null}
      <Badge label={open ? String(open) : 'Clear'} tone={open ? 'warning' : 'success'} />
    </div>
  );
}
