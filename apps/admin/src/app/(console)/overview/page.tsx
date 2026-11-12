import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { getOverview } from '@/lib/data';
import { hasRole } from '@/lib/roles';
import { viewerTimeZone } from '@/lib/tz';
import { age, ageMinutes, count, dateTime, relativeTime } from '@/lib/format';
import { SWITCHES, asMaintenance } from '@/lib/switches';
import { AutoRefresh } from '@/components/client';
import { Badge, Banner, BannerAction, BigNumber, ButtonLink, Card, ListGroup, PageHeader, Row, StatTile, Table } from '@/components/ui';

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
  const q = o.queues;
  const waiting = q.moderation.open + q.integrity.open + q.appeals.open + q.routes.open;
  const oldest = [q.moderation.oldest, q.integrity.oldest, q.appeals.oldest, q.routes.oldest].filter(Boolean).sort()[0] ?? null;
  const links = [
    { n: q.moderation.open, label: 'Moderation', href: '/moderation', show: hasRole(ctx.roles, 'moderator') },
    { n: q.integrity.open, label: 'Integrity', href: '/integrity', show: hasRole(ctx.roles, 'integrity_reviewer') },
    { n: q.appeals.open, label: 'Appeals', href: '/appeals', show: hasRole(ctx.roles, 'moderator') || hasRole(ctx.roles, 'integrity_reviewer') },
    { n: q.routes.open, label: 'Routes', href: '/routes', show: hasRole(ctx.roles, 'route_reviewer') }
  ].filter((l) => l.show && l.n > 0);

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Overview" description={<>Live state of the app · updated {relativeTime(o.generated_at)}, refreshes every 30 seconds</>} />

      {/* One loud element: what needs a person right now. */}
      <Card tone={waiting ? 'violet' : 'green'}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <BigNumber value={count(waiting)} unit={waiting === 1 ? 'item' : 'items'} label={waiting ? 'Waiting for review' : 'Nothing waiting for review'} />
          <div className="flex flex-col gap-3 items-start sm:items-end">
            {waiting && oldest ? <span className="type-label opacity-90">Oldest has waited {age(oldest)}</span> : <span className="type-label opacity-90">Every queue is clear</span>}
            {links.length ? (
              <div className="flex flex-wrap gap-2">
                {links.map((l) => (
                  <ButtonLink key={l.href} href={l.href} variant="onBlock" size="sm" arrow>{`${l.label} · ${l.n}`}</ButtonLink>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {maintenance.enabled || offSwitches.length || dead || stale.length || failedCron.length || o.billing.failed_events_7d ? (
        <div className="flex flex-col gap-2">
          {maintenance.enabled ? <Banner tone="danger" text={`Maintenance mode is on: “${maintenance.message ?? ''}”`} action={<BannerAction href="/settings?tab=release">Manage</BannerAction>} /> : null}
          {offSwitches.length ? <Banner tone="warning" text={`Switched off: ${offSwitches.map((x) => x.label).join(', ')}.`} action={<BannerAction href="/settings">Review</BannerAction>} /> : null}
          {dead ? <Banner tone="danger" text={`${dead} job${dead === 1 ? '' : 's'} failed permanently and need a retry or a fix.`} action={isAdmin ? <BannerAction href="/jobs">Open jobs</BannerAction> : undefined} /> : null}
          {stale.length ? <Banner tone="warning" text={`Jobs have waited longer than ${STALE_JOB_MIN} minutes in: ${stale.map(([name]) => name).join(', ')}. Check the job runner.`} /> : null}
          {failedCron.length ? <Banner tone="danger" text={`Scheduled task failed: ${failedCron.map((c) => c.job).join(', ')}.`} /> : null}
          {o.billing.failed_events_7d ? <Banner tone="warning" text={`${o.billing.failed_events_7d} billing events failed to apply in the last 7 days.`} /> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <StatTile icon="route" label="Runs, 24 h" value={count(o.activity_24h.runs)} />
        <StatTile icon="hexagon" label="Land claims, 24 h" value={count(o.activity_24h.claims)} />
        <StatTile icon="plus" label="Sign-ups, 24 h" value={count(o.activity_24h.sign_ups)} />
        <StatTile icon="chat" label="Posts, 24 h" value={count(o.activity_24h.posts)} />
        <StatTile icon="users" label="Active runners" value={count(o.totals.runners)} note={o.totals.suspended ? `${count(o.totals.suspended)} suspended` : undefined} />
        <StatTile icon="clubs" label="Clubs" value={count(o.totals.clubs)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
        <ListGroup title="Queues">
          <Row icon="flag" title="Moderation" subtitle={queueSubtitle(q.moderation.open, q.moderation.oldest, `${q.reports_24h} reports in 24 h`)}
            href={hasRole(ctx.roles, 'moderator') ? '/moderation' : undefined}
            right={<QueueBadges open={q.moderation.open} urgent={q.moderation.urgent} />} />
          <Row icon="shield" title="Integrity" subtitle={queueSubtitle(q.integrity.open, q.integrity.oldest, q.integrity.held ? `${q.integrity.held} held` : null)}
            href={hasRole(ctx.roles, 'integrity_reviewer') ? '/integrity' : undefined}
            right={<QueueBadges open={q.integrity.open} />} />
          <Row icon="scale" title="Appeals" subtitle={queueSubtitle(q.appeals.open, q.appeals.oldest)}
            href={hasRole(ctx.roles, 'moderator') || hasRole(ctx.roles, 'integrity_reviewer') ? '/appeals' : undefined}
            right={<QueueBadges open={q.appeals.open} />} />
          <Row icon="route" title="Route proposals" subtitle={queueSubtitle(q.routes.open, q.routes.oldest)}
            href={hasRole(ctx.roles, 'route_reviewer') ? '/routes' : undefined}
            right={<QueueBadges open={q.routes.open} />} />
          <Row icon="users" title="Account requests" subtitle={`${q.exports} exports running · ${q.deletions} deletions pending`} />
        </ListGroup>

        <ListGroup title="App state" action={<Link href="/settings" className="type-label text-primary">App control</Link>}>
          {SWITCHES.map((sw) => (
            <Row key={sw.key} title={sw.label}
              right={s[sw.key] === undefined ? <Badge label="Not set" tone="muted" /> : s[sw.key] ? <Badge label="On" tone="success" /> : <Badge label="Off" tone="danger" />} />
          ))}
          <Row title="Paywall" right={s.paywall_enabled ? <Badge label="On" tone="title" /> : <Badge label="Off · free pilot" tone="muted" />} />
          <Row title="Maintenance mode" right={maintenance.enabled ? <Badge label="On" tone="danger" /> : <Badge label="Off" tone="muted" />} />
          <Row title="Minimum app version" value={String(s.min_supported_app_version ?? '—').replace(/"/g, '')} />
          <Row title="MFA for operator actions" right={s.ops_require_mfa ? <Badge label="Enforced" tone="success" /> : <Badge label="Console only" tone="warning" />} />
        </ListGroup>

        <Card title="Job queues" action={isAdmin ? <Link href="/jobs" className="type-label text-primary">Jobs</Link> : undefined}>
          {queues.length ? (
            <Table head={['Queue', 'Waiting', 'Running', 'Failed', 'Oldest']}>
              {queues.map(([name, j]) => (
                <tr key={name}>
                  <td className="font-semibold">{name}</td>
                  <td className="tabular">{j.queued}</td>
                  <td className="tabular">{j.running}</td>
                  <td className="tabular">{j.dead ? <span className="text-danger font-bold">{j.dead}</span> : 0}</td>
                  <td className={ageMinutes(j.oldest_ready_at) > STALE_JOB_MIN ? 'text-warning font-semibold' : 'text-muted'}>{age(j.oldest_ready_at) ?? '—'}</td>
                </tr>
              ))}
            </Table>
          ) : <p className="type-body text-muted">No jobs yet.</p>}
        </Card>

        <div className="flex flex-col gap-4">
          <ListGroup title="Active seasons">
            {o.seasons.length ? o.seasons.map((x) => (
              <Row key={`${x.competition}-${x.number}`} icon="trophy" iconTone="title" title={`${x.competition} · season ${x.number}`}
                subtitle={`${x.status === 'settling' ? 'Settling' : 'Ends'} ${relativeTime(x.ends_at)} · ${dateTime(x.ends_at, tz ?? 'UTC')}`} />
            )) : <p className="type-body text-muted pb-5">No season is running.</p>}
          </ListGroup>
          <ListGroup title="Scheduled tasks">
            {o.cron.length ? o.cron.map((c) => (
              <Row key={c.job} icon="clock" iconTone="muted" title={c.job} subtitle={`${c.schedule} · last run ${relativeTime(c.last_start)}`}
                right={!c.active ? <Badge label="Paused" tone="warning" /> : c.last_status === 'failed' ? <Badge label="Failed" tone="danger" /> : c.last_status ? <Badge label={c.last_status} tone="success" /> : <Badge label="No runs" tone="muted" />} />
            )) : <p className="type-body text-muted pb-5">pg_cron is not available in this environment.</p>}
          </ListGroup>
          <ListGroup title="Delivery">
            <Row icon="mail" iconTone="info" title="Bounces and complaints, 7 days" value={o.email.bounced_7d} />
            <Row icon="alert" iconTone={o.email.failed_7d ? 'danger' : 'muted'} title="Email failures, 7 days" value={o.email.failed_7d} />
            <Row icon="bolt" iconTone={o.billing.failed_events_7d ? 'danger' : 'muted'} title="Billing events not applied, 7 days" value={o.billing.failed_events_7d} />
          </ListGroup>
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

function QueueBadges({ open, urgent }: { open: number; urgent?: number }) {
  return (
    <div className="flex items-center gap-2">
      {urgent ? <Badge label={`${urgent} urgent`} tone="danger" /> : null}
      <Badge label={open ? String(open) : 'Clear'} tone={open ? 'violet' : 'success'} />
    </div>
  );
}
