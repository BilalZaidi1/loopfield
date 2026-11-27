import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { requirePermission } from '@/lib/auth';
import { getMetrics } from '@/lib/data';
import { rpc, settle } from '@/lib/rpc';
import { change, humanize, minutes, num, platformLabel, relativeTime, shortDay } from '@/lib/format';
import type { Breakdowns, KeyValueCount, RetentionCohort } from '@/lib/types';
import { ColumnChart, HBars, LineChart, Sparkline } from '@/components/charts';
import { Banner, BannerAction, buttonClass, Card, cx, inputClass, PageHeader, SegmentedLinks } from '@/components/ui';
import { Icon } from '@/components/icons';
import { bandSpans } from '@/lib/widgets';
import { RUNNING_TOOLS_DASHBOARD_URL } from '@/lib/running';

export const metadata: Metadata = { title: 'Analytics' };

const RANGES = [7, 30, 90] as const;
const REASON_LABEL: Record<string, string> = {
  open_loop: 'Loop not closed', too_short: 'Too short', too_long: 'Too long', gps_gap: 'GPS gap', low_accuracy: 'Low GPS accuracy',
  degenerate_shape: 'Out-and-back shape', suspicious_speed: 'Vehicle-like speed', implausible_speed: 'Impossible speed', no_running_steps: 'No running steps',
  insufficient_samples: 'Too few GPS points', no_eligible_cells: 'No land left to claim', too_large: 'Area too large', late_upload: 'Uploaded too late',
  outside_season: 'Outside the season', no_ticket: 'Not started as a competitive run', duplicate_evidence: 'Duplicate upload', pending_review: 'Pending review',
  withheld_privacy: 'Held back for privacy', eligible: 'Claimed land', unranked: 'Not counted', invalid: 'Invalid'
};
const reason = (k: string) => REASON_LABEL[k] ?? humanize(k);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requirePermission('analytics');
  const sp = await searchParams;
  const today = iso(new Date());
  const custom = sp.from && sp.to && DAY.test(sp.from) && DAY.test(sp.to) && sp.from <= sp.to;
  const days = RANGES.find((r) => String(r) === sp.range) ?? 30;
  const to = custom ? sp.to! : today;
  const from = custom ? sp.from! : addDays(today, -(days - 1));
  const len = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const here = custom ? `/analytics?from=${from}&to=${to}` : `/analytics?range=${days}`;
  // Each source loads on its own, so one that fails shows "Not loaded" in its charts instead of failing the page.
  const [metrics, before, breakdowns, signups, cohorts] = await Promise.all([
    settle(getMetrics(from, to)),
    settle(getMetrics(addDays(from, -len), addDays(from, -1))),
    settle(rpc<Breakdowns>('ops_analytics_breakdowns', { p_from: from, p_to: to })),
    settle(rpc<KeyValueCount[]>('ops_analytics_funnel', { p_from: from, p_to: to })),
    settle(rpc<RetentionCohort[]>('ops_analytics_retention', { p_weeks: 8 }))
  ]);
  const m = metrics.ok ? metrics.data : null;
  const prev = before.ok ? before.data : null;
  const b = breakdowns.ok ? breakdowns.data : null;
  const funnel = signups.ok ? signups.data : null;
  const retention = cohorts.ok ? cohorts.data : null;
  const problems = [
    { part: 'Daily figures', r: metrics },
    { part: 'Breakdowns', r: breakdowns },
    { part: 'Sign-up funnel', r: signups },
    { part: 'Weekly retention', r: cohorts }
  ].flatMap(({ part, r }) => (r.ok ? [] : [`${part}: ${r.error}`]));

  const prevOf = (k: string) => (m && prev && prev.series[k]?.length === m.series[k]?.length ? prev.series[k] : undefined);
  const unit = (k: string) => m?.catalog.find((c) => c.key === k)?.unit;
  const label = (k: string) => m?.catalog.find((c) => c.key === k)?.label ?? humanize(k);

  const line = (k: string) => (m ? <LineChart days={m.days} values={m.series[k] ?? []} previous={prevOf(k)} label={label(k)} unit={unit(k)} /> : <NotLoaded />);
  const cols = (k: string, height = 220) =>
    m ? <ColumnChart labels={m.days.map(shortDay)} values={m.series[k] ?? []} label={label(k)} unit={unit(k)} height={height} /> : <NotLoaded height={height} />;
  const fromBreakdowns = (render: (x: Breakdowns) => ReactNode) => (b ? render(b) : <NotLoaded />);

  return (
    <>
      <PageHeader title="Analytics"
        description={m ? <>Counted per day in {m.time_zone} · refreshed {relativeTime(m.refreshed_at)} · compared with the {len} days before</> : <>Compared with the {len} days before</>}
        actions={<a href={`/analytics/export?from=${from}&to=${to}`} className={buttonClass('secondary', 'sm')}><Icon name="download" size={16} /> Export CSV</a>} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedLinks label="Time range" value={custom ? 'custom' : String(days)} options={[
          ...RANGES.map((r) => ({ value: String(r), label: `${r} days`, href: `/analytics?range=${r}` })),
          ...(custom ? [{ value: 'custom', label: `${shortDay(from)} – ${shortDay(to)}`, href: `/analytics?from=${from}&to=${to}` }] : [])
        ]} />
        <form action="/analytics" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1"><span className="type-caption text-muted">From</span><input type="date" name="from" defaultValue={from} max={today} className={cx(inputClass, 'min-h-10 px-3')} /></label>
          <label className="flex flex-col gap-1"><span className="type-caption text-muted">To</span><input type="date" name="to" defaultValue={to} max={today} className={cx(inputClass, 'min-h-10 px-3')} /></label>
          <button type="submit" className={buttonClass('secondary', 'sm')}>Apply</button>
        </form>
      </div>

      {problems.length ? (
        <Banner tone="danger" action={<BannerAction href={here}>Reload</BannerAction>}
          text={<>Part of this page could not load. Everything else on it is current.<ul className="mt-1 font-normal">{problems.map((p) => <li key={p}>{p}</li>)}</ul></>} />
      ) : null}

      <section className="grid grid-cols-12 gap-4" aria-label="Headline numbers">
        {(['active_runners', 'runs', 'distance_km', 'loops_claimed', 'signups', 'land_km2', 'support_solved', 'support_first_response_min'] as const).map((k) => (
          <Kpi key={k} label={label(k)} value={m?.totals[k] ?? null} previous={m?.previous[k] ?? null} unit={unit(k)} series={m?.series[k] ?? []} lowerIsBetter={k === 'support_first_response_min'}
            format={k === 'support_first_response_min' ? (n) => minutes(n) : undefined} missing={!m} />
        ))}
      </section>

      <Group title="Running">
        <Chart title={label('active_runners')} note="Runners who recorded at least one run each day">{line('active_runners')}</Chart>
        <Chart title={label('runs')} note="Runs recorded each day">{cols('runs')}</Chart>
        <Chart title={label('distance_km')} note="Kilometres run each day">{line('distance_km')}</Chart>
        <Chart title="When people run" note={m ? `Runs by hour of the day, ${m.time_zone}` : 'Runs by hour of the day'}>
          {fromBreakdowns((x) => <ColumnChart labels={Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)} values={x.hour_of_day} label="Runs by hour of the day" unit="runs" labelEvery={3} />)}
        </Chart>
        <Chart title="Run length" note="Runs by distance">{fromBreakdowns((x) => <HBars items={x.distance_buckets} label="Runs by distance" />)}</Chart>
        <Chart title="Busiest days of the week" note="Runs by weekday">
          {fromBreakdowns((x) => <ColumnChart labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} values={x.weekday} label="Runs by weekday" unit="runs" labelEvery={1} />)}
        </Chart>
      </Group>

      <Group title="Territory">
        <Chart title={label('loops_claimed')} note="Loops that met every rule and claimed land">{cols('loops_claimed')}</Chart>
        <Chart title={label('land_km2')} note="Land captured each day">{line('land_km2')}</Chart>
        <Chart title="Loop outcomes" note="Every loop attempt in the period">
          {fromBreakdowns((x) => <HBars items={x.loop_outcomes.map((o) => ({ ...o, label: reason(o.key) }))} label="Loop outcomes" />)}
        </Chart>
        <Chart title="Why loops were not counted" note="A loop can fail more than one check. Tune these in Game rules.">
          {fromBreakdowns((x) => <HBars items={x.rejection_reasons.map((o) => ({ ...o, label: reason(o.key) }))} label="Reasons loops were not counted" />)}
        </Chart>
      </Group>

      <Group title="Growth">
        <Chart title={label('signups')} note="New accounts each day">{line('signups')}</Chart>
        <Chart title="From sign-up to habit" note="Runners who signed up in this period">
          {funnel ? <HBars items={funnel.map((x, i) => ({ ...x, label: `${x.key}${i ? ` · ${funnel[0]!.value ? Math.round((100 * x.value) / funnel[0]!.value) : 0}%` : ''}` }))} label="Sign-up funnel" showShare={false} /> : <NotLoaded />}
        </Chart>
        <Chart title="Weekly retention" note="Share of each sign-up week that ran in each week after" wide>{retention ? <Retention cohorts={retention} /> : <NotLoaded />}</Chart>
      </Group>

      <Group title="Where">
        <Chart title="Top districts" note="Runs by the runner’s district">{fromBreakdowns((x) => <HBars items={x.top_districts} label="Runs by district" />)}</Chart>
        <Chart title="Phones" note="Runners with notifications on, by platform">
          {fromBreakdowns((x) => <HBars items={x.platforms.map((o) => ({ ...o, label: platformLabel(o.key) }))} label="Runners by platform" />)}
        </Chart>
      </Group>

      <Group title="Community">
        {(['posts', 'comments', 'follows', 'club_joins'] as const).map((k) => <Chart key={k} title={label(k)} compact total={m?.totals[k]}>{cols(k, 150)}</Chart>)}
      </Group>

      <Group title="Running tools" id="running-tools"
        action={RUNNING_TOOLS_DASHBOARD_URL
          ? <a href={RUNNING_TOOLS_DASHBOARD_URL} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>PostHog dashboard <Icon name="arrow-right" size={14} /></a>
          : <span className="type-caption text-muted">PostHog dashboard not linked yet</span>}>
        <p className="col-span-12 type-caption text-muted -mt-1">
          Counts only. Where runners go, their planned routes, heart rate, training and shoe names never reach these figures. How the phone-only features are used (training, straps, highlights, replay) is in PostHog.
        </p>
        <Chart title={label('planned_routes_created')} note="Routes runners planned and saved in the route builder">{cols('planned_routes_created')}</Chart>
        <Chart title={label('route_snap_requests')} note="Legs drawn along paths with Mapbox, counted per UTC day">{cols('route_snap_requests')}</Chart>
        <Chart title={label('live_links_started')} note={m ? openedNote(m.totals.live_links_opened, m.totals.live_links_started) : 'Live links made for one run or as a standing link'}>{cols('live_links_started')}</Chart>
        <Chart title={label('running_now_peak')} note="The busiest moment each day, counted per UTC day. The total is the busiest day.">{line('running_now_peak')}</Chart>
        <Chart title={label('route_review_hours_median')} note="Median hours from proposal to a reviewer’s decision">
          {m ? <LineChart days={m.days} values={m.series.route_review_hours_median ?? []} previous={prevOf('route_review_hours_median')} label={label('route_review_hours_median')} unit="h" /> : <NotLoaded />}
        </Chart>
        <Chart title={label('runs_with_gear')} note={m ? shareNote(m.totals.runs_with_gear, m.totals.runs, 'of all runs counted towards a pair of shoes') : 'Runs counted towards a pair of shoes'}>{cols('runs_with_gear')}</Chart>
        {(['live_links_opened', 'friends_live_runs', 'route_proposals_stretch', 'route_proposals_a_to_b', 'gear_added', 'gear_reminders_sent'] as const).map((k, i, all) => (
          <Chart key={k} title={label(k)} compact span={bandSpans(all.length, 3, 2)[i]} total={m?.totals[k]}>{cols(k, 150)}</Chart>
        ))}
      </Group>

      <Group title="Trust, safety and support">
        <Chart title={label('support_opened')} note="New conversations each day">{cols('support_opened')}</Chart>
        <Chart title={label('support_first_response_min')} note="Median minutes until the first reply">
          {m ? <LineChart days={m.days} values={m.series.support_first_response_min ?? []} label={label('support_first_response_min')} unit="min" formatAs="minutes" /> : <NotLoaded />}
        </Chart>
        <Chart title="What runners write about" note="Support conversations by topic">
          {fromBreakdowns((x) => <HBars items={x.support_categories.map((o) => ({ ...o, label: humanize(o.key) }))} label="Support by topic" />)}
        </Chart>
        <Chart title="What gets reported" note="Reports by category">
          {fromBreakdowns((x) => <HBars items={x.report_categories.map((o) => ({ ...o, label: humanize(o.key) }))} label="Reports by category" />)}
        </Chart>
        {(['reports', 'moderation_resolved', 'integrity_opened', 'route_proposals'] as const).map((k) => <Chart key={k} title={label(k)} compact total={m?.totals[k]}>{cols(k, 150)}</Chart>)}
      </Group>

      <Group title="Platform">
        {(['pushes_sent', 'emails_sent', 'jobs_dead'] as const).map((k, i, all) => <Chart key={k} title={label(k)} compact span={bandSpans(all.length, 3, 2)[i]} total={m?.totals[k]}>{cols(k, 150)}</Chart>)}
      </Group>
    </>
  );
}

/** Where a chart would be when its data did not load; the same height keeps the grid aligned. */
function NotLoaded({ height = 220 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-md bg-surface-alt/50 type-caption text-muted" style={{ minHeight: height }}>
      <Icon name="alert" size={16} /> Not loaded
    </div>
  );
}

function Kpi({ label, value, previous, unit, series, lowerIsBetter, format, missing }: {
  label: string; value: number | null; previous: number | null; unit?: string; series: number[]; lowerIsBetter?: boolean; format?: (n: number) => string; missing?: boolean;
}) {
  const d = change(value, previous);
  const good = d == null ? null : lowerIsBetter ? d <= 0 : d >= 0;
  const shown = value == null ? '–' : format ? format(value) : num(value, { compact: true });
  return (
    <div className="col-span-6 md:col-span-3 2xl:col-span-3 rounded-lg bg-surface p-5 flex flex-col gap-2 h-full min-w-0">
      <span className="type-label text-muted truncate">{label}</span>
      <span className="flex items-baseline gap-1.5 min-w-0">
        <span className="type-metric truncate">{shown}</span>
        {unit && !format && !missing ? <span className="type-body-strong text-muted">{unit}</span> : null}
      </span>
      <Sparkline values={series} height={32} />
      <span className={cx('type-caption font-semibold mt-auto', good == null ? 'text-muted' : good ? 'text-success' : 'text-danger')}>
        {missing ? 'Not loaded' : d == null ? 'No earlier data' : `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))}% on the period before`}
      </span>
    </div>
  );
}

function Group({ title, children, id, action }: { title: string; children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 scroll-mt-24" aria-label={title} id={id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="type-headline">{title}</h2>
        {action}
      </div>
      <div className="grid grid-cols-12 gap-4">{children}</div>
    </section>
  );
}

/** "12 of 30 opened at least once (40%)". */
function openedNote(opened: number | null | undefined, started: number | null | undefined): string {
  if (!started) return 'Live links made for one run or as a standing link';
  return `${num(opened ?? 0)} of ${num(started)} opened at least once (${Math.round((100 * (opened ?? 0)) / started)}%)`;
}

function shareNote(part: number | null | undefined, whole: number | null | undefined, what: string): string {
  if (!whole) return `None yet ${what.replace(/^of all /, 'among ')}`;
  return `${Math.round((100 * (part ?? 0)) / whole)}% ${what}`;
}

function Chart({ title, note, children, compact, wide, total, span }: { title: string; note?: string; children: ReactNode; compact?: boolean; wide?: boolean; total?: number | null; span?: string }) {
  return (
    <Card className={cx('h-full', span ?? (wide ? 'col-span-12' : compact ? 'col-span-12 sm:col-span-6 2xl:col-span-3' : 'col-span-12 xl:col-span-6'))}
      title={<span className="type-heading">{title}</span>} action={total != null ? <span className="type-label text-muted tabular-nums">{num(total, { compact: true })}</span> : undefined}>
      {note ? <p className="type-caption text-muted -mt-2">{note}</p> : null}
      {children}
    </Card>
  );
}

function Retention({ cohorts }: { cohorts: RetentionCohort[] }) {
  if (!cohorts.length) return <p className="type-caption text-muted py-6 text-center">No sign-ups in the last eight weeks.</p>;
  const weeks = cohorts[0]!.weeks.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px] min-w-[640px]">
        <caption className="sr-only">Weekly retention: share of each sign-up week that ran in each following week</caption>
        <thead>
          <tr>
            <th scope="col" className="type-caption text-subtle font-semibold text-left pr-3 pb-1">Signed up</th>
            <th scope="col" className="type-caption text-subtle font-semibold text-right pr-3 pb-1">Runners</th>
            {Array.from({ length: weeks }, (_, k) => <th key={k} scope="col" className="type-caption text-subtle font-semibold pb-1">{k === 0 ? 'Week 0' : `+${k}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.week}>
              <th scope="row" className="type-caption text-ink font-semibold text-left pr-3 whitespace-nowrap">{shortDay(c.week)}</th>
              <td className="type-caption text-muted text-right pr-3 tabular-nums">{c.size}</td>
              {c.weeks.map((v, k) => (
                <td key={k} className="h-9 min-w-12 rounded-[4px] text-center type-caption tabular-nums font-semibold"
                  style={v == null ? undefined : { background: `color-mix(in oklab, var(--lf-chart-1) ${Math.round(12 + (v / 100) * 88)}%, var(--lf-surface))`, color: v >= 50 ? '#FFFFFF' : 'var(--lf-text)' }}>
                  {v == null ? '' : `${Math.round(v)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

