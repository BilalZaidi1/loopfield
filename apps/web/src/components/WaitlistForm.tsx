'use client';

import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import { copy } from '@/content/en';
import { track } from '@/lib/analytics';
import { PillButton } from './Pill';

type Status = 'idle' | 'sending' | 'sent' | 'confirmed' | 'failed' | 'invalid' | 'closed';

const noSubscribe = () => () => {};
/** The confirm step sends people back with ?waitlist=confirmed (or expired). */
const fromUrl = (): Status => {
  const w = new URLSearchParams(window.location.search).get('waitlist');
  return w === 'confirmed' ? 'confirmed' : w === 'expired' ? 'failed' : 'idle';
};

/** Double opt-in: the API emails a confirmation link and stores nothing until it is tapped. */
export function WaitlistForm({ source = 'final' }: { source?: string }) {
  const [local, setStatus] = useState<Status>('idle');
  const landed = useSyncExternalStore(noSubscribe, fromUrl, () => 'idle' as Status);
  const status = local === 'idle' ? landed : local;
  const id = useId();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      email: String(form.get('email') ?? '').trim(),
      city: String(form.get('city') ?? '').trim(),
      country: String(form.get('country') ?? '').trim(),
      consent: form.get('consent') === 'on',
      website: String(form.get('website') ?? ''),
      source
    };
    if (!/^\S+@\S+\.\S+$/.test(body.email)) {
      setStatus('invalid');
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        setStatus('sent');
        track('waitlist_submit', { country: body.country.slice(0, 56) || 'unknown' });
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

  const message =
    status === 'invalid' ? copy.waitlist.invalid : status === 'failed' ? copy.waitlist.failed : status === 'closed' ? copy.waitlist.closed : '';

  return (
    <form onSubmit={submit} noValidate className="relative grid w-full max-w-[520px] gap-3 md:max-w-[780px]" aria-describedby={`${id}-msg`}>
      {/* The headline and the line above it already introduce the form, so its title is for screen readers. */}
      <h3 className="sr-only">{copy.waitlist.title}</h3>
      {/* Phones stack the fields; wider screens put email, city and country on one row, so the block stays short. */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
          className="h-12 min-w-0 rounded-full bg-white px-6 text-[17px] font-semibold text-block-ink placeholder:text-block-ink/50 focus-visible:outline-white sm:h-14"
        />
        <div className="grid grid-cols-2 gap-3 md:contents">
          <label className="sr-only" htmlFor={`${id}-city`}>
            {copy.waitlist.city}
          </label>
          <input
            id={`${id}-city`}
            name="city"
            autoComplete="address-level2"
            placeholder={copy.waitlist.city}
            className="h-12 min-w-0 rounded-full bg-white/15 px-5 text-[16px] font-semibold text-white placeholder:text-white/70 md:h-14"
          />
          <label className="sr-only" htmlFor={`${id}-country`}>
            {copy.waitlist.country}
          </label>
          <input
            id={`${id}-country`}
            name="country"
            autoComplete="country-name"
            placeholder={copy.waitlist.country}
            className="h-12 min-w-0 rounded-full bg-white/15 px-5 text-[16px] font-semibold text-white placeholder:text-white/70 md:h-14"
          />
        </div>
      </div>
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-8">
        <label className="flex items-start gap-3 py-1 text-[14px] leading-5 text-white/90 md:max-w-[44ch]">
          <input name="consent" type="checkbox" required className="mt-0.5 size-5 shrink-0 accent-white [color-scheme:light]" />
          <span>{copy.waitlist.consent}</span>
        </label>
        <PillButton type="submit" variant="light" disabled={status === 'sending'} className="shrink-0 self-start md:self-auto">
          {status === 'sending' ? copy.waitlist.sending : copy.waitlist.submit}
        </PillButton>
      </div>
      <p id={`${id}-msg`} role="status" className="min-h-5 text-[14px] font-semibold text-white">
        {message}
      </p>
    </form>
  );
}
