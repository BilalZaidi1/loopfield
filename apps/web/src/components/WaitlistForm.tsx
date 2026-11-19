'use client';

import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import { copy } from '@/content/en';
import { track } from '@/lib/analytics';
import { PillButton } from './Pill';

type Status = 'idle' | 'sending' | 'sent' | 'confirmed' | 'failed' | 'invalid' | 'consent' | 'closed';

const noSubscribe = () => () => {};
/** The confirm step sends people back with ?waitlist=confirmed (or expired). */
const fromUrl = (): Status => {
  const w = new URLSearchParams(window.location.search).get('waitlist');
  return w === 'confirmed' ? 'confirmed' : w === 'expired' ? 'failed' : 'idle';
};

const messages: Partial<Record<Status, string>> = {
  invalid: copy.waitlist.invalid,
  consent: copy.waitlist.consentNeeded,
  failed: copy.waitlist.failed,
  closed: copy.waitlist.closed
};

/** Double opt-in, email only: the API emails a confirmation link and stores nothing until it is tapped. */
export function WaitlistForm({ placement = 'final' }: { placement?: string }) {
  const [local, setStatus] = useState<Status>('idle');
  const landed = useSyncExternalStore(noSubscribe, fromUrl, () => 'idle' as Status);
  const status = local === 'idle' ? landed : local;
  const id = useId();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      email: String(form.get('email') ?? '').trim(),
      consent: form.get('consent') === 'on',
      website: String(form.get('website') ?? '')
    };
    if (!/^\S+@\S+\.\S+$/.test(body.email)) {
      setStatus('invalid');
      return;
    }
    // The form skips the browser's own checks, so an unticked box gets its own message rather than a server 400.
    if (!body.consent) {
      setStatus('consent');
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        setStatus('sent');
        track('waitlist_submit', { placement });
      } else setStatus(res.status === 503 ? 'closed' : res.status === 400 ? 'invalid' : 'failed');
    } catch {
      setStatus('failed');
    }
  };

  if (status === 'sent' || status === 'confirmed') {
    return (
      <p role="status" className="t-headline max-w-[34ch] rounded-[20px] bg-white/10 px-5 py-4 text-white">
        {status === 'sent' ? copy.waitlist.sent : copy.waitlist.confirmed}
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="relative grid w-full max-w-[520px] gap-3 md:max-w-[600px]" aria-describedby={`${id}-msg`}>
      {/* The headline and the line above it already introduce the form, so its title is for screen readers. */}
      <h3 className="sr-only">{copy.waitlist.title}</h3>
      <label className="sr-only" htmlFor={`${id}-email`}>
        {copy.waitlist.email}
      </label>
      <input
        id={`${id}-email`}
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder={copy.waitlist.email}
        aria-invalid={status === 'invalid' || undefined}
        className="h-14 rounded-full bg-white px-6 text-[17px] font-semibold text-block-ink placeholder:text-block-ink/50 focus-visible:outline-white"
      />
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {/* Phones stack the consent and the button; wider screens put them side by side under the email. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-8">
        <label className="flex items-start gap-3 py-1 text-[14px] leading-5 text-white/90 md:max-w-[36ch]">
          <input
            name="consent"
            type="checkbox"
            required
            aria-invalid={status === 'consent' || undefined}
            className="mt-0.5 size-5 shrink-0 accent-white [color-scheme:light]"
          />
          <span className="text-pretty">{copy.waitlist.consent}</span>
        </label>
        <PillButton type="submit" variant="light" disabled={status === 'sending'} className="shrink-0 self-start md:self-auto">
          {status === 'sending' ? copy.waitlist.sending : copy.waitlist.submit}
        </PillButton>
      </div>
      <p id={`${id}-msg`} role="status" className="min-h-5 text-[14px] font-semibold text-white">
        {messages[status] ?? ''}
      </p>
    </form>
  );
}
