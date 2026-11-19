import type { Metadata } from 'next';
import { LoopMark } from '@/components/LoopMark';
import { PageTitle } from '@/components/PageTitle';
import { site } from '@/config/site';
import { copy } from '@/content/en';

export const metadata: Metadata = { title: 'Press kit · Loopfield', alternates: { canonical: '/press' } };

const files = [
  { href: '/press/loopfield-mark.svg', label: 'Mark, for dark backgrounds (SVG)' },
  { href: '/press/loopfield-mark-light.svg', label: 'Mark, for light backgrounds (SVG)' },
  { href: '/press/loopfield-app-icon.svg', label: 'App icon (SVG)' }
];

export default function PressPage() {
  return (
    <article>
      <PageTitle kicker="Press kit" title="Loopfield in one paragraph" />
      <div className="doc mt-10">
        <p className="text-ink">
          Loopfield is a running game played on your streets. {copy.meta.description} Health data stays on your phone, and other runners see the ground you claim, never your raw
          GPS trace.
        </p>

        <h2>Logo</h2>
        <p>
          The mark is an open loop with the runner’s dot at the gap: the moment before a loop closes and claims ground. Violet is the runner and their land; orange is the
          runner’s dot.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="grid aspect-[4/3] place-items-center rounded-[24px] bg-surface ring-1 ring-white/[0.08]">
            <LoopMark size={96} />
          </div>
          <div className="grid aspect-[4/3] place-items-center rounded-[24px] bg-[#EEF0F5]">
            <LoopMark size={96} ring="#5853E0" />
          </div>
        </div>
        <ul>
          {files.map((f) => (
            <li key={f.href}>
              <a href={f.href} download>
                {f.label}
              </a>
            </li>
          ))}
        </ul>

        <h2>Screenshots</h2>
        <p>App screenshots will be added here with the store listings.</p>

        <h2>Contact</h2>
        <p>
          Press and creators: <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>.
        </p>
      </div>
    </article>
  );
}
