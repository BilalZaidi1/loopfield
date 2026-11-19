import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { site } from '@/config/site';

export const metadata: Metadata = { title: 'Terms · Loopfield', alternates: { canonical: '/terms' } };

/** Placeholder until the reviewed terms are ready; linked from sign-up in the app. */
export default function TermsPage() {
  return (
    <article>
      <PageTitle
        kicker="Terms"
        title="Terms of use"
        lead="The full terms are being reviewed. Until they are published here, these are the ground rules of the pilot."
        updated="Pilot draft, November 2026."
      />
      <div className="doc mt-12">
        <h2>Who can play</h2>
        <p>Loopfield is for adults (18+).</p>

        <h2>Play fair</h2>
        <ul>
          <li>Run your own runs, on foot. Runs made by bike or car, or with altered GPS, don’t count.</li>
          <li>Every run is checked for GPS quality, bikes and cars, and suspicious results go to review. You can ask for a review or appeal in the app.</li>
          <li>Be decent in clubs, chats and posts. We may remove content or accounts that harass or endanger others.</li>
        </ul>

        <h2>Stay safe</h2>
        <p>Watch the road, follow local laws and never enter private or unsafe ground to claim a cell. No territory is worth it.</p>

        <h2>The pilot</h2>
        <p>The game’s rules are still being tuned in field tests, so loops, routes, titles and seasons may change, and results may be corrected.</p>

        <h2>Contact</h2>
        <p>
          Loopfield is published by {site.publisher}. Write to <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>.
        </p>
      </div>
    </article>
  );
}
