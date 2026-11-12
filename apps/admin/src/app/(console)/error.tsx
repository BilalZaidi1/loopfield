'use client';

import { useEffect } from 'react';
import { friendlyError } from '@/lib/errors';
import { Button, Card } from '@/components/ui';

/** The app's ErrorState, for anything a console page fails to load. */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card>
      <div role="alert" className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <div className="type-heading">Could not load this</div>
        <div className="type-body text-muted max-w-md">{friendlyError(error)}</div>
        {error.digest ? <div className="type-caption text-muted">Reference {error.digest}</div> : null}
        <Button variant="secondary" onClick={reset}>Try again</Button>
      </div>
    </Card>
  );
}
