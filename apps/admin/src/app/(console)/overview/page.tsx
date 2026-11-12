import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { can, requireStaff } from '@/lib/auth';
import { getMetrics, getOverview, getPreferences } from '@/lib/data';
import { rpc } from '@/lib/rpc';
import { viewerTimeZone } from '@/lib/tz';
import { age, ageMinutes, change, count, dateTime, num, relativeTime, shortDay } from '@/lib/format';
import { SWITCHES, asMaintenance } from '@/lib/switches';
import { BAND_LAYOUT, availableWidgets, bandSpans, chosenWidgets, type WidgetBand, type WidgetDef } from '@/lib/widgets';
import type { Metrics, Overview, SupportQueue } from '@/lib/types';
import { AutoRefresh } from '@/components/client';
import { ColumnChart, LineChart, Sparkline } from '@/components/charts';
import { Badge, Banner, BannerAction, BigNumber, ButtonLink, Card, cx, PageHeader, Row, Table } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { CustomizeOverview } from './customize';
import { resetOverviewWidgets, saveOverviewWidgets } from './actions';

export const metadata: Metadata = { title: 'Overview' };

const STALE_JOB_MIN = 10;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default async function OverviewPage() {
  const ctx = await requireStaff();
  const today = new Date();
  const from = isoDay(new Date(today.getTime() - 13 * 86_400_000));
  const [o, tz, prefs, metrics, support] = await Promise.all([
    getOverview(),
    viewerTimeZone(),
    getPreferences().catch(() => ({}) as Record<string, unknown>),
    can(ctx, 'analytics') ? getMetrics(from, isoDay(today)).catch(() => null) : Promise.resolve(null),
    can(ctx, 'support') ? rpc<SupportQueue>('ops_support_queue', { p_view: 'open', p_limit: 5 }).catch(() => null) : Promise.resolve(null)
  ]);
  const widgets = chosenWidgets(prefs.overview_widgets, ctx.permissions);
  const maintenance = asMaintenance(o.settings.maintenance_mode);
  const offSwitches = SWITCHES.filter((sw) => o.settings[sw.key] === false);
  const queues = Object.entries(o.jobs).sort(([a], [b]) => a.localeCompare(b));
  const dead = queues.reduce((n, [, q]) => n + q.dead, 0);
  const stale = queues.filter(([, q]) => ageMinutes(q.oldest_ready_at) > STALE_JOB_MIN);
  const failedCron = o.cron.filter((c) => c.last_status === 'failed');
  const q = o.queues;
  const reviewLinks = [
    { n: q.moderation.open, label: 'Moderation', href: '/moderation', show: can(ctx, 'moderation') },
    { n: q.integrity.open, label: 'Integrity', href: '/integrity', show: can(ctx, 'integrity') },
    { n: q.appeals.open, label: 'Appeals', href: '/appeals', show: can(ctx, 'moderation') || can(ctx, 'integrity') },
    { n: q.routes.open, label: 'Routes', href: '/routes', show: can(ctx, 'routes') },
    { n: support?.counts.open ?? 0, label: 'Support', href: '/support', show: can(ctx, 'support') }
  ];
  const waiting = reviewLinks.filter((l) => l.show).reduce((n, l) => n + l.n, 0);
  const oldest = [q.moderation.oldest, q.integrity.oldest, q.appeals.oldest, q.routes.oldest, support?.counts.oldest_open ?? null].filter(Boolean).sort()[0] ?? null;
  const env = { o, tz: tz ?? 'UTC', metrics, support, ctx };

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Overview"
        description={<>Live state of the app · updated {relativeTime(o.generated_at)}, refreshes every 30 seconds</>}
        actions={<CustomizeOverview available={availableWidgets(ctx.permissions)} selected={widgets.map((w) => w.id)} save={saveOverviewWidgets} reset={resetOverviewWidgets} />}
      />

      {/* One loud element: what needs a person right now. */}
      <Card tone={waiting ? 'violet' : 'green'}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <BigNumber value={count(waiting)} unit={waiting === 1 ? 'item' : 'items'} label={waiting ? 'Waiting for a person' : 'Nothing waiting for a person'} />
          <div className="flex flex-col gap-3 items-start sm:items-end">
            <span className="type-label opacity-90">{waiting && oldest ? `Oldest has waited ${age(oldest)}` : 'Every queue is clear'}</span>
            <div className="flex flex-wrap gap-2">
              {reviewLinks.filter((l) => l.show && l.n > 0).map((l) => (
                <ButtonLink key={l.href} href={l.href} variant="onBlock" size="sm" arrow>{`${l.label} · ${l.n}`}</ButtonLink>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {maintenance.enabled || offSwitches.length || dead || stale.length || failedCron.length || o.billing.failed_events_7d ? (
        <div className="flex flex-col gap-2">
          {maintenance.enabled ? <Banner tone="danger" text={`Maintenance mode is on: “${maintenance.message ?? ''}”`} action={<BannerAction href="/settings?tab=release">Manage</BannerAction>} /> : null}
          {offSwitches.length ? <Banner tone="warning" text={`Switched off: ${offSwitches.map((x) => x.label).join(', ')}.`} action={<BannerAction href="/settings">Review</BannerAction>} /> : null}
          {dead ? <Banner tone="danger" text={`${dead} job${dead === 1 ? '' : 's'} failed permanently and need a retry or a fix.`} action={can(ctx, 'jobs') ? <BannerAction href="/jobs">Open jobs</BannerAction> : undefined} /> : null}
          {stale.length ? <Banner tone="warning" text={`Jobs have waited longer than ${STALE_JOB_MIN} minutes in: ${stale.map(([name]) => name).join(', ')}. Check the job runner.`} /> : null}
          {failedCron.length ? <Banner tone="danger" text={`Scheduled task failed: ${failedCron.map((c) => c.job).join(', ')}.`} /> : null}
          {o.billing.failed_events_7d ? <Banner tone="warning" text={`${o.billing.failed_events_7d} billing events failed to apply in the last 7 days.`} /> : null}
        </div>
      ) : null}

      {widgets.length === 0 ? (
        <Card><p className="type-body text-muted">No widgets chosen. Use Customize to add some.</p></Card>
      ) : (
        (['tile', 'chart', 'panel'] as WidgetBand[]).map((band) => {
          const items = widgets.filter((w) => w.band === band);
          if (!items.length) return null;
          const spans = bandSpans(items.length, BAND_LAYOUT[band].xl, BAND_LAYOUT[band].md, BAND_LAYOUT[band].base);
          return (
            <section key={band} className="grid grid-cols-12 gap-4" aria-label={band === 'tile' ? 'Key numbers' : band === 'chart' ? 'Trends' : 'Operations'}>
              {items.map((w, i) => (
                <div key={w.id} className={cx(spans[i], 'min-w-0 flex')}>
                  <Widget w={w} env={env} />
                </div>
              ))}
            </section>
          );
        })
      )}
    </>
  );
}

type Env = { o: Overview; tz: string; metrics: Metrics | null; support: SupportQueue | null; ctx: Awaited<ReturnType<typeof requireStaff>> };

const KPI_ICON: Record<string, IconName> = { kpi_active: 'users', kpi_runs: 'route', kpi_distance: 'map', kpi_loops: 'hexagon', kpi_signups: 'plus', kpi_land: 'hexagon' };
const UNIT: Record<string, string> = { distance_km: 'km', land_km2: 'km²' };

function Widget({ w, env }: { w: WidgetDef; env: Env }) {
  const { o, metrics: m } = env;
  if (w.band === 'tile') {
    if (w.id === 'kpi_support') {
      const c = env.support?.counts;
      return <Tile icon="chat" label={w.label} value={count(c?.open ?? 0)} note={c ? `${c.unassigned} unassigned · ${c.urgent} urgent` : 'Not available'} href="/support" />;
    }
    if (w.id === 'kpi_runners') return <Tile icon="users" label={w.label} value={count(o.totals.runners)} note={`${count(o.totals.suspended)} suspended · ${count(o.totals.clubs)} clubs`} href="/runners" />;
    const s = m?.series[w.metric!] ?? [];
    const todayVal = s[s.length - 1] ?? 0;
    const week = s.slice(-7).reduce((a, b) => a + b, 0);
    const prevWeek = s.slice(-14, -7).reduce((a, b) => a + b, 0);
    const d = change(week, prevWeek);
    return (
      <Tile icon={KPI_ICON[w.id] ?? 'pulse'} label={w.label} value={num(todayVal, { compact: true })} unit={UNIT[w.metric!]}
        note={<>Last 7 days {num(week, { compact: true })}{d != null ? <Delta value={d} /> : null}</>} spark={s} href="/analytics" />
    );
  }
  if (w.band === 'chart') {
    if (!m) return <Card className="w-full" title={w.label}><p className="type-body text-muted">Analytics is not available.</p></Card>;
    const values = m.series[w.metric!] ?? [];
    const unit = UNIT[w.metric!] ?? m.catalog.find((c) => c.key === w.metric)?.unit;
    const total = values.reduce((a, b) => a + b, 0);
    return (
      <Card className="w-full" title={w.label} action={<Link href="/analytics" className="type-label text-primary">Analytics</Link>}>
        <p className="type-caption text-muted -mt-2">{num(total, { compact: true })} {unit} in 14 days · days in {m.time_zone}</p>
        {w.metric === 'active_runners' || w.metric === 'distance_km'
          ? <LineChart days={m.days} values={values} label={w.label} unit={unit} height={200} />
          : <ColumnChart labels={m.days.map(shortDay)} values={values} label={w.label} unit={unit} height={200} />}
      </Card>
    );
  }
  return <Panel id={w.id} label={w.label} env={env} />;
}

function Tile({ icon, label, value, unit, note, spark, href }: { icon: IconName; label: string; value: ReactNode; unit?: string; note?: ReactNode; spark?: number[]; href?: string }) {
  const body = (
    <div className="rounded-lg bg-surface p-5 flex flex-col gap-3 h-full w-full hover:bg-surface-alt/40 transition-colors">
      <div className="flex items-center gap-2 text-muted">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-primary"><Icon name={icon} size={16} /></span>
        <span className="type-label">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="type-metric">{value}</span>
        {unit ? <span className="type-body-strong text-muted">{unit}</span> : null}
      </div>
      {spark && spark.length > 1 ? <Sparkline values={spark} /> : null}
      {note ? <div className="type-caption text-muted mt-auto">{note}</div> : null}
    </div>
  );
  return href ? <Link href={href} className="flex w-full rounded-lg focus-visible:outline-2 focus-visible:outline-primary">{body}</Link> : body;
}

function Delta({ value }: { value: number }) {
  const up = value >= 0;
  return <span className={cx('ml-2 font-semibold', up ? 'text-success' : 'text-danger')}>{up ? '▲' : '▼'} {Math.abs(Math.round(value))}% on the week before</span>;
}

function Panel({ id, label, env }: { id: string; label: string; env: Env }) {
  const { o, tz, ctx } = env;
  const q = o.queues;
  const s = o.settings;
  const shell = (children: ReactNode, action?: ReactNode) => (
    <Card className="w-full" padded={false} title={<span className="block px-5 pt-5">{label}</span>} action={action ? <span className="pr-5 pt-5 whitespace-nowrap">{action}</span> : undefined}>
      <div className="px-5 pb-2 flex flex-col">{children}</div>
    </Card>
  );
  switch (id) {
    case 'queues':
      return shell(<>
        <Row icon="flag" title="Moderation" subtitle={queueSubtitle(q.moderation.open, q.moderation.oldest, `${q.reports_24h} reports in 24 h`)} href={can(ctx, 'moderation') ? '/moderation' : undefined} right={<QueueBadges open={q.moderation.open} urgent={q.moderation.urgent} />} />
        <Row icon="shield" title="Integrity" subtitle={queueSubtitle(q.integrity.open, q.integrity.oldest, q.integrity.held ? `${q.integrity.held} held` : null)} href={can(ctx, 'integrity') ? '/integrity' : undefined} right={<QueueBadges open={q.integrity.open} />} />
        <Row icon="scale" title="Appeals" subtitle={queueSubtitle(q.appeals.open, q.appeals.oldest)} href={can(ctx, 'moderation') || can(ctx, 'integrity') ? '/appeals' : undefined} right={<QueueBadges open={q.appeals.open} />} />
        <Row icon="route" title="Route proposals" subtitle={queueSubtitle(q.routes.open, q.routes.oldest)} href={can(ctx, 'routes') ? '/routes' : undefined} right={<QueueBadges open={q.routes.open} />} />
        <Row icon="users" title="Account requests" subtitle={`${q.exports} exports running · ${q.deletions} deletions pending`} />
      </>);
    case 'switches':
      return shell(<>
        {SWITCHES.map((sw) => (
          <Row key={sw.key} title={sw.label} right={s[sw.key] === undefined ? <Badge label="Not set" tone="muted" /> : s[sw.key] ? <Badge label="On" tone="success" /> : <Badge label="Off" tone="danger" />} />
        ))}
        <Row title="Paywall" right={s.paywall_enabled ? <Badge label="On" tone="title" /> : <Badge label="Off · free pilot" tone="muted" />} />
        <Row title="Maintenance mode" right={asMaintenance(s.maintenance_mode).enabled ? <Badge label="On" tone="danger" /> : <Badge label="Off" tone="muted" />} />
        <Row title="Minimum app version" value={String(s.min_supported_app_version ?? '—').replace(/"/g, '')} />
      </>, <Link href="/settings" className="type-label text-primary">App control</Link>);
    case 'jobs': {
      const queues = Object.entries(o.jobs).sort(([a], [b]) => a.localeCompare(b));
      return shell(queues.length ? (
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
      ) : <p className="type-body text-muted pb-3">No jobs yet.</p>, can(ctx, 'jobs') ? <Link href="/jobs" className="type-label text-primary">Jobs</Link> : undefined);
    }
    case 'seasons':
      return shell(o.seasons.length ? o.seasons.map((x) => (
        <Row key={`${x.competition}-${x.number}`} icon="trophy" iconTone="title" title={`${x.competition} · season ${x.number}`}
          subtitle={new Date(x.ends_at).getFullYear() > 9000 ? 'Never ends (all-time map)' : `${x.status === 'settling' ? 'Settling' : 'Ends'} ${relativeTime(x.ends_at)} · ${dateTime(x.ends_at, tz)}`} />
      )) : <p className="type-body text-muted pb-3">No season is running.</p>, <Link href="/rules" className="type-label text-primary">Game rules</Link>);
    case 'schedules':
      return shell(o.cron.length ? o.cron.map((c) => (
        <Row key={c.job} icon="clock" iconTone="muted" title={c.job} subtitle={`${c.schedule} · last run ${relativeTime(c.last_start)}`}
          right={!c.active ? <Badge label="Paused" tone="warning" /> : c.last_status === 'failed' ? <Badge label="Failed" tone="danger" /> : c.last_status ? <Badge label={c.last_status} tone="success" /> : <Badge label="Not run yet" tone="muted" />} />
      )) : <p className="type-body text-muted pb-3">pg_cron is not available in this environment.</p>);
    case 'delivery':
      return shell(<>
        <Row icon="mail" iconTone="info" title="Bounces and complaints, 7 days" value={o.email.bounced_7d} />
        <Row icon="alert" iconTone={o.email.failed_7d ? 'danger' : 'muted'} title="Email failures, 7 days" value={o.email.failed_7d} />
        <Row icon="bolt" iconTone={o.billing.failed_events_7d ? 'danger' : 'muted'} title="Billing events not applied, 7 days" value={o.billing.failed_events_7d} />
      </>);
    case 'support_queue': {
      const sq = env.support;
      return shell(sq && sq.items.length ? sq.items.slice(0, 5).map((t) => (
        <Row key={t.id} icon={t.staff_unread ? 'mail' : 'chat'} iconTone={t.priority === 'urgent' || t.priority === 'high' ? 'danger' : 'violet'} title={t.subject}
          subtitle={`@${t.runner.handle} · waiting ${age(t.last_runner_message_at) ?? 'now'}`} href={`/support/${t.id}`}
          right={t.priority === 'urgent' || t.priority === 'high' ? <Badge label={t.priority === 'urgent' ? 'Urgent' : 'High'} tone="danger" /> : undefined} />
      )) : <p className="type-body text-muted pb-3">No open conversations.</p>, <Link href="/support" className="type-label text-primary">Inbox</Link>);
    }
    default:
      return shell(<p className="type-body text-muted pb-3">Unknown widget.</p>);
  }
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
