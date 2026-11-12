import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { requirePermission } from '@/lib/auth';
import { getMetrics } from '@/lib/data';
import { rpc } from '@/lib/rpc';
import { change, humanize, minutes, num, platformLabel, relativeTime, shortDay } from '@/lib/format';
import type { Breakdowns, KeyValueCount, RetentionCohort } from '@/lib/types';
import { ColumnChart, HBars, LineChart, Sparkline } from '@/components/charts';
import { buttonClass, Card, cx, inputClass, PageHeader, SegmentedLinks } from '@/components/ui';
import { Icon } from '@/components/icons';
import { bandSpans } from '@/lib/widgets';

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
  const [m, prev, b, funnel, retention] = await Promise.all([
    getMetrics(from, to),
    getMetrics(addDays(from, -len), addDays(from, -1)).catch(() => null),
    rpc<Breakdowns>('ops_analytics_breakdowns', { p_from: from, p_to: to }),
    rpc<KeyValueCount[]>('ops_analytics_funnel', { p_from: from, p_to: to }),
    rpc<RetentionCohort[]>('ops_analytics_retention', { p_weeks: 8 })
  ]);
  const prevOf = (k: string) => (prev && prev.series[k]?.length === m.series[k]?.length ? prev.series[k] : undefined);
  const unit = (k: string) => m.catalog.find((c) => c.key === k)?.unit;
  const label = (k: string) => m.catalog.find((c) => c.key === k)?.label ?? humanize(k);
  const labels = m.days.map(shortDay);

  const line = (k: string, withPrev = true) => <LineChart days={m.days} values={m.series[k] ?? []} previous={withPrev ? prevOf(k) : undefined} label={label(k)} unit={unit(k)} />;
  const cols = (k: string, height = 220) => <ColumnChart labels={labels} values={m.series[k] ?? []} label={label(k)} unit={unit(k)} height={height} />;

  return (
    <>
      <PageHeader title="Analytics"
        description={<>Counted per day in {m.time_zone} · refreshed {relativeTime(m.refreshed_at)} · compared with the {len} days before</>}
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

      <section className="grid grid-cols-12 gap-4" aria-label="Headline numbers">
        {(['active_runners', 'runs', 'distance_km', 'loops_claimed', 'signups', 'land_km2', 'support_solved', 'support_first_response_min'] as const).map((k) => (
          <Kpi key={k} label={label(k)} value={m.totals[k] ?? null} previous={m.previous[k] ?? null} unit={unit(k)} series={m.series[k] ?? []} lowerIsBetter={k === 'support_first_response_min'}
            format={k === 'support_first_response_min' ? (n) => minutes(n) : undefined} />
        ))}
      </section>

      <Group title="Running">
        <Chart title={label('active_runners')} note="Runners who recorded at least one run each day">{line('active_runners')}</Chart>
        <Chart title={label('runs')} note="Runs recorded each day">{cols('runs')}</Chart>
        <Chart title={label('distance_km')} note="Kilometres run each day">{line('distance_km')}</Chart>
        <Chart title="When people run" note={`Runs by hour of the day, ${m.time_zone}`}>
          <ColumnChart labels={Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)} values={b.hour_of_day} label="Runs by hour of the day" unit="runs" labelEvery={3} />
        </Chart>
        <Chart title="Run length" note="Runs by distance"><HBars items={b.distance_buckets} label="Runs by distance" /></Chart>
        <Chart title="Busiest days of the week" note="Runs by weekday">
          <ColumnChart labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} values={b.weekday} label="Runs by weekday" unit="runs" labelEvery={1} />
        </Chart>
      </Group>

      <Group title="Territory">
        <Chart title={label('loops_claimed')} note="Loops that met every rule and claimed land">{cols('loops_claimed')}</Chart>
        <Chart title={label('land_km2')} note="Land captured each day">{line('land_km2')}</Chart>
        <Chart title="Loop outcomes" note="Every loop attempt in the period"><HBars items={b.loop_outcomes.map((x) => ({ ...x, label: reason(x.key) }))} label="Loop outcomes" /></Chart>
        <Chart title="Why loops were not counted" note="A loop can fail more than one check. Tune these in Game rules.">
          <HBars items={b.rejection_reasons.map((x) => ({ ...x, label: reason(x.key) }))} label="Reasons loops were not counted" />
        </Chart>
      </Group>

      <Group title="Growth">
        <Chart title={label('signups')} note="New accounts each day">{line('signups')}</Chart>
        <Chart title="From sign-up to habit" note="Runners who signed up in this period">
          <HBars items={funnel.map((x, i) => ({ ...x, label: `${x.key}${i ? ` · ${funnel[0]!.value ? Math.round((100 * x.value) / funnel[0]!.value) : 0}%` : ''}` }))} label="Sign-up funnel" showShare={false} />
        </Chart>
        <Chart title="Weekly retention" note="Share of each sign-up week that ran in each week after" wide><Retention cohorts={retention} /></Chart>
      </Group>

      <Group title="Where">
        <Chart title="Top districts" note="Runs by the runner’s district"><HBars items={b.top_districts} label="Runs by district" /></Chart>
        <Chart title="Phones" note="Runners with notifications on, by platform"><HBars items={b.platforms.map((x) => ({ ...x, label: platformLabel(x.key) }))} label="Runners by platform" /></Chart>
      </Group>

      <Group title="Community">
        {(['posts', 'comments', 'follows', 'club_joins'] as const).map((k) => <Chart key={k} title={label(k)} compact total={m.totals[k]}>{cols(k, 150)}</Chart>)}
      </Group>

      <Group title="Trust, safety and support">
        <Chart title={label('support_opened')} note="New conversations each day">{cols('support_opened')}</Chart>
        <Chart title={label('support_first_response_min')} note="Median minutes until the first reply">
          <LineChart days={m.days} values={m.series.support_first_response_min ?? []} label={label('support_first_response_min')} unit="min" formatAs="minutes" />
        </Chart>
        <Chart title="What runners write about" note="Support conversations by topic"><HBars items={b.support_categories.map((x) => ({ ...x, label: humanize(x.key) }))} label="Support by topic" /></Chart>
        <Chart title="What gets reported" note="Reports by category"><HBars items={b.report_categories.map((x) => ({ ...x, label: humanize(x.key) }))} label="Reports by category" /></Chart>
        {(['reports', 'moderation_resolved', 'integrity_opened', 'route_proposals'] as const).map((k) => <Chart key={k} title={label(k)} compact total={m.totals[k]}>{cols(k, 150)}</Chart>)}
      </Group>

      <Group title="Platform">
        {(['pushes_sent', 'emails_sent', 'jobs_dead'] as const).map((k, i, all) => <Chart key={k} title={label(k)} compact span={bandSpans(all.length, 3, 2)[i]} total={m.totals[k]}>{cols(k, 150)}</Chart>)}
      </Group>
    </>
  );
}

function Kpi({ label, value, previous, unit, series, lowerIsBetter, format }: { label: string; value: number | null; previous: number | null; unit?: string; series: number[]; lowerIsBetter?: boolean; format?: (n: number) => string }) {
  const d = change(value, previous);
  const good = d == null ? null : lowerIsBetter ? d <= 0 : d >= 0;
  const shown = value == null ? '–' : format ? format(value) : num(value, { compact: true });
  return (
    <div className="col-span-6 md:col-span-3 2xl:col-span-3 rounded-lg bg-surface p-5 flex flex-col gap-2 h-full min-w-0">
      <span className="type-label text-muted truncate">{label}</span>
      <span className="flex items-baseline gap-1.5 min-w-0">
        <span className="type-metric truncate">{shown}</span>
        {unit && !format ? <span className="type-body-strong text-muted">{unit}</span> : null}
      </span>
      <Sparkline values={series} height={32} />
      <span className={cx('type-caption font-semibold mt-auto', good == null ? 'text-muted' : good ? 'text-success' : 'text-danger')}>
        {d == null ? 'No earlier data' : `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))}% on the period before`}
      </span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="type-headline">{title}</h2>
      <div className="grid grid-cols-12 gap-4">{children}</div>
    </section>
  );
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

