'use client';

import { useState, useTransition } from 'react';
import { Banner, Button } from '@/components/ui';
import { startEnrollment, verifyCode, type Enrollment } from '../actions';

function CodeForm({ factorId, next, cta }: { factorId: string; next: string | null; cta: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await verifyCode(factorId, code, next);
          if (r && !r.ok) setError(r.error);
        });
      }}>
      <div className="flex flex-col gap-1">
        <label htmlFor="code" className="type-label">6-digit code</label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="border-[1.5px] border-line rounded-md px-3 min-h-12 bg-surface text-ink text-center tabular tracking-[0.4em] text-[22px] font-bold"
        />
      </div>
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button type="submit" disabled={pending || code.replace(/\s/g, '').length !== 6}>{pending ? 'Checking…' : cta}</Button>
    </form>
  );
}

export function MfaVerify({ factorId, next }: { factorId: string; next: string | null }) {
  return <CodeForm factorId={factorId} next={next} cta="Verify" />;
}

export function MfaEnroll({ next }: { next: string | null }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [pending, start] = useTransition();
  if (!enrollment || !enrollment.ok) {
    return (
      <div className="flex flex-col gap-3">
        {enrollment && !enrollment.ok ? <Banner tone="danger" text={enrollment.error} /> : null}
        <Button disabled={pending} onClick={() => start(async () => setEnrollment(await startEnrollment()))}>
          {pending ? 'Preparing…' : 'Set up authenticator app'}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ol className="type-body flex flex-col gap-1 list-decimal pl-5">
        <li>Scan this code with your authenticator app.</li>
        <li>Enter the 6-digit code it shows.</li>
      </ol>
      <div className="self-center rounded-md bg-white p-3 border border-line">
        {/* The QR code is an inline SVG data URI from Supabase Auth. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrollment.qr} alt="QR code for your authenticator app" width={176} height={176} />
      </div>
      <details>
        <summary className="type-caption text-primary cursor-pointer">Can&apos;t scan? Enter the key manually</summary>
        <code className="mt-1 block break-all rounded-md bg-surface-alt p-2 font-mono text-[13px]">{enrollment.secret}</code>
      </details>
      <CodeForm factorId={enrollment.factorId} next={next} cta="Finish setup" />
    </div>
  );
}
