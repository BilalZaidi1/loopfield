import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { requirePermission } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { env } from '@/lib/env';
import { km } from '@/lib/format';
import { lengthCheck, ROUTE_DECLINE_PRESETS, shapeLabel, sourceLabel, START_TO_FINISH_CHECKLIST, stretchText, waitedText } from '@/lib/running';
import type { RouteProposalRow } from '@/lib/types';
import { ActionButton } from '@/components/client';
import { RouteMap } from '@/components/route-map';
import { Badge, Banner, Card, cx, EmptyState, PageHeader } from '@/components/ui';
import { Icon } from '@/components/icons';
import { reviewRoute } from './actions';

export const metadata: Metadata = { title: 'Route proposals' };

export default async function RoutesPage() {
  await requirePermission('routes');
  const rows = await rpc<RouteProposalRow[]>('ops_route_queue', { p_limit: 50 });
  const target = rows.find((r) => r.checks)?.checks?.target_hours ?? null;
  const late = rows.filter((r) => r.over_target).length;
  return (
    <>
      <PageHeader
        title="Route proposals"
        description={<>Runner-proposed speed routes waiting for review, oldest first{target ? `, with a ${target}-hour review target` : ''}. Approving publishes a course; a founding run is scored if the runner asked for it.</>}
      />
      {late ? <Banner tone="warning" text={`${late} proposal${late === 1 ? ' has' : 's have'} waited longer than the ${target ?? ''} h review target.`} /> : null}
      {rows.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((r) => <Proposal key={r.id} r={r} target={target} />)}
        </div>
      ) : (
        <Card><EmptyState title="No routes waiting" body="Proposals appear here after the server builds their geometry." /></Card>
      )}
    </>
  );
}

function Proposal({ r, target }: { r: RouteProposalRow; target: number | null }) {
  const shape = shapeLabel(r);
  const stretch = stretchText(r);
  const fromStretch = stretch != null;
  return (
    <Card className={cx(r.over_target && 'ring-2 ring-warning')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="type-heading">{r.name}</h2>
        <Badge label={sourceLabel(r)} tone="violet" />
        <Badge label={shape} tone={shape === 'Start to finish' ? 'title' : 'info'} />
        {r.score_founding_run ? <Badge label="Score founding run" tone="title" /> : null}
      </div>
      <p className="type-caption text-muted">
        by @{r.creator_handle} · {km(r.length_m)} · corridor {r.course_geometry?.corridor_m ?? '—'} m{stretch ? ` · ${stretch}` : ''}
      </p>
      <p className={cx('type-label inline-flex items-center gap-1.5', r.over_target ? 'text-warning' : 'text-muted')}>
        <Icon name="clock" size={14} />
        Waiting {waitedText(r.waited_hours)}{r.over_target && target ? ` · past the ${target} h target` : ''}
      </p>
      {r.path_geojson ? (
        <>
          <RouteMap path={r.path_geojson} startGate={r.course_geometry?.start_gate} finishGate={r.course_geometry?.finish_gate} token={env.mapboxToken} />
          <p className="type-caption text-muted -mt-1">
            {fromStretch ? 'Only the part of the run that would become the route is shown, ' : 'The route as built from the run, '}with its start and finish gates.
          </p>
        </>
      ) : (
        <p className="type-body text-muted">No geometry was built for this proposal.</p>
      )}
      <QuickChecks r={r} />
      <div className="flex flex-wrap gap-2 pt-1">
        <ActionButton label="Approve" variant="primary" action={reviewRoute.bind(null, r.id, true)}
          title={`Approve ${r.name}?`}
          description="Publishes this route as a course that everyone can race. The proposer is notified."
          checklist={shape === 'Start to finish' ? START_TO_FINISH_CHECKLIST : undefined} />
        <ActionButton label="Decline" variant="ghost" action={reviewRoute.bind(null, r.id, false)}
          title={`Decline ${r.name}?`}
          description="The proposer is notified with your reason."
          reasonLabel="Reason (sent to the proposer and recorded in the audit log)"
          presets={ROUTE_DECLINE_PRESETS} />
      </div>
    </Card>
  );
}

/** What the server already checked before the proposal reached review. */
function QuickChecks({ r }: { r: RouteProposalRow }) {
  const c = r.checks;
  if (!c) return null;
  const len = lengthCheck(r.length_m, c.length_min_m, c.length_max_m);
  const nearby = c.nearby ?? [];
  return (
    <section aria-label="Quick checks" className="rounded-md bg-surface-alt/60 px-4 py-3 flex flex-col gap-2">
      <h3 className="type-label">Checked by the server</h3>
      <ul className="flex flex-col gap-1.5">
        <Check ok={len.ok} label="Length" value={len.text} />
        <Check ok={Boolean(c.region)} label="Region" value={c.region ?? 'Not in a region'} />
        <Check ok label="Protected areas" value="Passed. The areas themselves are never shown." />
        <Check ok={!nearby.length} warn={nearby.length > 0} label="Existing routes nearby"
          value={nearby.length
            ? `${nearby.length} within ${c.nearby_within_m} m: ${nearby.map((n) => `${n.name} (${n.distance_m} m)`).join(', ')}`
            : `None within ${c.nearby_within_m} m`} />
      </ul>
    </section>
  );
}

function Check({ ok, warn, label, value }: { ok: boolean; warn?: boolean; label: string; value: ReactNode }) {
  const tone = warn ? 'text-warning' : ok ? 'text-success' : 'text-danger';
  return (
    <li className="flex items-start gap-2 type-caption">
      <span className={cx('mt-0.5 shrink-0', tone)}><Icon name={warn ? 'alert' : ok ? 'check' : 'x'} size={14} strokeWidth={2.4} /></span>
      <span><span className="font-semibold text-ink">{label}:</span> <span className="text-muted">{value}</span></span>
    </li>
  );
}
