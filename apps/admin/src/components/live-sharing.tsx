import type { ActionResult } from '@/lib/errors';
import { sharingLines } from '@/lib/running';
import type { LiveSharing } from '@/lib/types';
import { ActionButton } from './client';
import { Badge } from './ui';

/**
 * A runner's live sharing as support sees it: whether live links work and whether sharing with friends is on,
 * never where the runner is or who they share with. With `end`, the safety action that ends it all at once.
 */
export function LiveSharingDetails({ handle, sharing, end, endNeeds }: {
  handle: string;
  sharing?: LiveSharing;
  end?: (reason: string, stopFriendSharing: boolean) => Promise<ActionResult>;
  /** Shown instead of the action when the viewer may not end live links. */
  endNeeds?: string;
}) {
  const s = sharingLines(sharing);
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2">
        {[
          { label: 'Live link', value: s.live, on: Boolean(sharing?.live_links) },
          { label: 'Sharing with friends', value: s.friends, on: Boolean(sharing?.friends_sharing) }
        ].map((it) => (
          <div key={it.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <dt className="type-caption text-muted">{it.label}</dt>
            <dd>{it.on ? <Badge label={it.value} tone="warning" /> : <span className="type-body">{it.value}</span>}</dd>
          </div>
        ))}
      </dl>
      {s.note ? <p className="type-caption text-muted">{s.note}</p> : null}
      <p className="type-caption text-muted">Where they are, who has a link and who they share with are never shown here.</p>
      {end ? (
        <div className="flex flex-col gap-1.5 items-start">
          <ActionButton label="End live links" variant="danger" size="sm" icon="link" title={`End @${handle}'s live sharing?`} disabled={!s.anything}
            description={<>Ends all of @{handle}&apos;s live links at once, including a run being shared with friends. Each link stops working and the positions it showed are deleted, as when a runner turns a link off. @{handle} is told in the app that support did this.</>}
            option={sharing?.friends_sharing ? { label: 'Also turn off sharing with friends', help: 'The friends they chose are kept, so they can turn it back on in Privacy.' } : undefined}
            reasonLabel="Reason (recorded in the audit log, never shown to the runner)"
            confirmLabel="End live links"
            action={end} />
          {!s.anything && sharing ? <span className="type-caption text-muted">Nothing to end: no open links, and sharing with friends is off.</span> : null}
        </div>
      ) : endNeeds ? <p className="type-caption text-muted">{endNeeds}</p> : null}
    </div>
  );
}
