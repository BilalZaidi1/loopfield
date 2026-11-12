import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { rpc } from '@/lib/rpc';
import { env } from '@/lib/env';
import { age, km } from '@/lib/format';
import type { RouteProposalRow } from '@/lib/types';
import { ActionButton } from '@/components/client';
import { RouteMap } from '@/components/route-map';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { reviewRoute } from './actions';

export const metadata: Metadata = { title: 'Route proposals' };

export default async function RoutesPage() {
  await requireRole('route_reviewer');
  const rows = await rpc<RouteProposalRow[]>('ops_route_queue', { p_limit: 50 });
  return (
    <>
      <PageHeader
        title="Route proposals"
        description="Runner-proposed speed routes waiting for review. Approving publishes a course; a founding run is scored if the runner asked for it."
      />
      {rows.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="type-heading">{r.name}</h2>
                <Badge label={r.closed ? 'Loop' : 'Point to point'} tone="info" />
                {r.score_founding_run ? <Badge label="Score founding run" tone="title" /> : null}
              </div>
              <p className="type-caption text-muted">
                by @{r.creator_handle} · {km(r.length_m)} · corridor {r.course_geometry?.corridor_m ?? '—'} m · waiting {age(r.created_at)}
              </p>
              {r.path_geojson ? (
                <RouteMap path={r.path_geojson} startGate={r.course_geometry?.start_gate} finishGate={r.course_geometry?.finish_gate} token={env.mapboxToken} />
              ) : (
                <p className="type-body text-muted">No geometry was built for this proposal.</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <ActionButton label="Approve" variant="primary" action={reviewRoute.bind(null, r.id, true)}
                  description="Publishes this route as a course that everyone can race. The proposer is notified." />
                <ActionButton label="Decline" variant="ghost" action={reviewRoute.bind(null, r.id, false)}
                  description="The proposer is notified with your reason." />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card><EmptyState title="No routes waiting" body="Proposals appear here after the server builds their geometry." /></Card>
      )}
    </>
  );
}
