'use client';

import { useActionState } from 'react';
import { Banner, Button } from '@/components/ui';
import { signIn, type FormState } from '../actions';

const field = 'border border-line-strong focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary rounded-md px-4 min-h-12 type-body bg-surface text-ink';

export function SignInForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="type-label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required autoFocus className={field} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="type-label">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={field} />
      </div>
      {state.error ? <Banner tone="danger" text={state.error} /> : null}
      <Button type="submit" arrow disabled={pending}>{pending ? 'Signing in…' : 'Continue'}</Button>
    </form>
  );
}
