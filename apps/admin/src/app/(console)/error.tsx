'use client';

import { useEffect } from 'react';
import { friendlyError } from '@/lib/errors';
import { Button, Card } from '@/components/ui';

/**
 * The app's ErrorState, for anything a console page fails to load. In production a server error reaches the
 * browser without its message (React error #441); its digest is the reference that finds it in the Vercel logs.
 * `retry` fetches the page again (`reset` would only re-render what failed).
 */
export default function ConsoleError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  const message = digest && process.env.NODE_ENV === 'production'
    ? 'The server hit a problem while loading this page. Try again; if it keeps happening, pass the reference below to an engineer.'
    : friendlyError(error);
  return (
    <Card>
      <div role="alert" className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <div className="type-heading">Could not load this</div>
        <div className="type-body text-muted max-w-md">{message}</div>
        {digest ? <div className="type-caption text-muted">Reference {digest}</div> : null}
        <Button variant="secondary" onClick={() => retry()}>Try again</Button>
      </div>
    </Card>
  );
}
