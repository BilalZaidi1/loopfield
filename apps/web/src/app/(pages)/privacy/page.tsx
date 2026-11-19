import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { site } from '@/config/site';

export const metadata: Metadata = { title: 'Privacy · Loopfield', alternates: { canonical: '/privacy' } };

/**
 * A plain-language summary of what the app and this site do today, taken from the app's code and permission texts.
 * The reviewed policy replaces it before launch; the app's consent version is still a pilot draft.
 */
export default function PrivacyPage() {
  return (
    <article>
      <PageTitle
        kicker="Privacy"
        title="Your run stays yours."
        lead="Other runners see the ground you claim and the results you choose to share, never your raw GPS trace or your health data."
        updated="Pilot draft, November 2026. The reviewed privacy policy will replace this page before launch."
      />
      <div className="doc mt-12">
        <h2>Location</h2>
        <ul>
          <li>Loopfield uses your location only to record runs you start. Background location keeps a run you started recording while your screen is locked, and recording stops when you finish.</li>
          <li>Territory and route results use only the competitive part of a run that you explicitly start.</li>
          <li>Raw traces are never shown to other runners. Shared runs are trimmed at the start and finish, protected areas you set are left out, and runs are published after a delay so nobody can follow you live.</li>
        </ul>

        <h2>Health and motion</h2>
        <ul>
          <li>Connecting Apple Health or Health Connect is optional. Readings power a private dashboard on your phone and are never uploaded or shared.</li>
          <li>Disconnecting, signing out or deleting your account clears the app’s copy of your health readings. Records in Apple Health or Health Connect are never deleted by Loopfield.</li>
          <li>During a run you start, your step count is checked on your phone to tell running from cycling. Steps are never uploaded; only a yes or no is sent with the run.</li>
          <li>Saving runs to Apple Health or Health Connect is a separate choice you can turn on.</li>
        </ul>

        <h2>Photos and posts</h2>
        <p>Location data is removed from a photo before it uploads. You choose who sees each run and post.</p>

        <h2>Analytics</h2>
        <ul>
          <li>
            <strong>In the app:</strong> only if you opt in. Events come from a fixed list with coarse values. No raw GPS, health readings, message text or other free text is
            ever sent.
          </li>
          <li>
            <strong>On this website:</strong> PostHog (EU) in cookieless mode. Nothing is stored in your browser, there is no session recording, and only a short list of
            events is counted, such as which section was viewed and which store button was tapped.
          </li>
        </ul>

        <h2>The waitlist</h2>
        <p>
          If you join the waitlist, we keep your email address and, if you give them, your city and country, so we can tell you when Loopfield opens where you run. Nothing is
          kept until you tap the link in the confirmation email. The list is held with our email provider, Resend, and every email has an unsubscribe link.
        </p>

        <h2>Deleting your account</h2>
        <p>
          In the app, go to Settings, then Account and data, then Delete account. You can also ask on the <Link href="/delete-account">account deletion page</Link>.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about privacy: <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>. Loopfield is published by {site.publisher}.
        </p>
      </div>
    </article>
  );
}
