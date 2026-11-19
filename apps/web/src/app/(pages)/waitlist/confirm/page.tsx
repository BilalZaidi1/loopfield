import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { PillButton } from '@/components/Pill';

export const metadata: Metadata = { title: 'Confirm your spot · Loopfield', robots: { index: false, follow: false } };

/** The link in the confirmation email opens this page; the button posts the token, so link scanners can't confirm. */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const value = typeof token === 'string' ? token : '';
  return (
    <div>
      <PageTitle kicker="Waitlist" title="Confirm your spot" lead="One tap and you’re on the list. We’ll email you when Loopfield launches." />
      {value ? (
        <form method="post" action="/api/waitlist/confirm" className="mt-10">
          <input type="hidden" name="token" value={value} />
          <PillButton type="submit">Confirm my spot</PillButton>
        </form>
      ) : (
        <p className="t-body mt-10 text-muted">This link is missing its code. Open the newest email from us and tap the button again.</p>
      )}
    </div>
  );
}
