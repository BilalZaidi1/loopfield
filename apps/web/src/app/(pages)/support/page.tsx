import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { requirementsLine, site } from '@/config/site';
import { copy } from '@/content/en';

export const metadata: Metadata = { title: 'Support · Loopfield', alternates: { canonical: '/support' } };

/** The support URL both stores ask for: real contact details, the in-app help and the common questions. */
export default function SupportPage() {
  return (
    <article>
      <PageTitle kicker="Support" title="How can we help?" lead={`Loopfield is a running game published by ${site.publisher}. ${requirementsLine}.`} />
      <div className="doc mt-12">
        <h2>Contact us</h2>
        <p>
          Email <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>. Tell us your phone model and what happened.
        </p>

        <h2>In the app</h2>
        <ul>
          <li>Settings, then Support, then Help and game rules: how loops, land, routes and titles work.</li>
          <li>Settings, then Support, then Message support: write to us from the app.</li>
          <li>Settings, then Support, then Reviews and appeals: ask for a second look at a result.</li>
        </ul>

        <h2>Common questions</h2>
        {copy.faq.items.map((item) => (
          <div key={item.id}>
            <h3>{item.q}</h3>
            <p>
              {item.a}
              {item.id === 'delete' ? (
                <>
                  {' '}
                  <Link href="/delete-account">Open the account deletion page</Link>.
                </>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}
