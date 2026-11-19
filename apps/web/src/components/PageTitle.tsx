import type { ReactNode } from 'react';

/** Title block shared by the plain pages. */
export function PageTitle({ kicker, title, lead, updated }: { kicker: string; title: string; lead?: ReactNode; updated?: string }) {
  return (
    <div>
      <p className="t-kicker text-primary">{kicker}</p>
      <h1 className="t-display mt-4 text-ink">{title}</h1>
      {lead ? <p className="t-body mt-6 text-muted">{lead}</p> : null}
      {updated ? <p className="t-caption mt-4 text-subtle">{updated}</p> : null}
    </div>
  );
}
