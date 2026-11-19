import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { site } from '@/config/site';

export const metadata: Metadata = { title: 'Delete your account · Loopfield', alternates: { canonical: '/delete-account' } };

/**
 * Google Play asks for a web page, naming the app as on its listing, where people can ask for their account and data
 * to be deleted without reinstalling the app. The request goes by email from the account's own address, which is
 * how ownership is confirmed.
 */
export default function DeleteAccountPage() {
  const subject = encodeURIComponent('Delete my Loopfield account');
  const body = encodeURIComponent(
    'Please delete my Loopfield account and the data tied to it.\n\nI am writing from the email address I use to sign in to Loopfield.\n\nDisplay name (optional): '
  );
  return (
    <article>
      <PageTitle kicker="Account" title="Delete your Loopfield account" lead="You can delete your account in the app at any time, or ask us here if you no longer have the app." />
      <div className="doc mt-12">
        <h2>In the Loopfield app</h2>
        <ol>
          <li>Open Settings.</li>
          <li>Tap Account and data.</li>
          <li>Under Delete account, type DELETE and tap Delete my account.</li>
        </ol>
        <p>Deletion starts at once and you are signed out. It cannot be undone.</p>

        <h2>Without the app</h2>
        <p>
          Email us from the address you use to sign in to Loopfield, so we know the account is yours. We confirm by email and delete the account and the data tied to it.
        </p>
        <p>
          <a href={`mailto:${site.supportEmail}?subject=${subject}&body=${body}`}>Email a deletion request</a> to {site.supportEmail}.
        </p>

        <h2>What is deleted</h2>
        <ul>
          <li>Your account, profile and sign-in.</li>
          <li>Your runs, the land and route titles they earned, and your posts, photos and messages.</li>
          <li>The app’s copy of your health readings, which stays on your phone and is cleared from it. Records in Apple Health or Health Connect stay there.</li>
        </ul>
        <p>
          Anything the law requires us to keep for a time is described in the <Link href="/privacy">privacy policy</Link>.
        </p>
      </div>
    </article>
  );
}
