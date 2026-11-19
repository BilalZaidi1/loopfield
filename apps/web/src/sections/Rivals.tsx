'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Lines } from '@/components/Reveal';
import { useStory } from '@/components/useStory';
import { copy } from '@/content/en';
import { beats } from '@/story/world';
import { territory } from '@/theme/brand';

const factTones = ['bg-primary-soft text-on-primary-soft', 'bg-green-soft text-green-text', 'bg-white/[0.07] text-muted'] as const;

/** A notification card in the app's style, dropping in on its beat. */
function Toast({ shown, avatar, who, text, when }: { shown: boolean; avatar: ReactNode; who: string; text: string; when: string }) {
  return (
    <div
      className={`flex w-full max-w-[360px] items-start gap-3 rounded-[20px] bg-surface/95 px-4 py-3.5 shadow-[var(--lf-shadow-floating)] ring-1 ring-white/10 backdrop-blur-md transition-[opacity,translate,scale] duration-[var(--dur-sheet)] ease-[var(--ease-sheet)] ${
        shown ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-3 scale-[0.98] opacity-0'
      }`}
    >
      {avatar}
      <p className="t-label min-w-0 flex-1 text-ink">
        <span className="font-extrabold">{who}</span> <span className="text-muted">{text}</span>
      </p>
      <span className="t-caption shrink-0 text-subtle">{when}</span>
    </div>
  );
}

/** A rival's loop sweeps across your land; your lost cells keep a dashed outline; movement points take some back. */
export function Rivals({ lost, reclaimed }: { lost: number; reclaimed: number }) {
  const [beat, setBeat] = useState(0);
  useStory((T) => {
    const b = T < beats.rivals.flip + 0.03 || T > 3.98 ? 0 : T < beats.rivals.reclaim + 0.03 ? 1 : 2;
    if (b !== beat) setBeat(b);
  });

  return (
    <section id="rivals" data-section="rivals" className="relative h-[220vh]">
      <div className="sticky top-0 flex h-[100svh] items-end overflow-hidden pb-24 md:items-center md:pb-0">
        <div aria-hidden className="scrim-left absolute inset-y-0 left-0 hidden w-[70%] md:block" />
        <div aria-hidden className="scrim-bottom absolute inset-x-0 bottom-0 h-[78%] md:hidden" />

        <div aria-hidden className="absolute inset-x-5 top-20 z-10 flex flex-col max-md:[@media(max-height:700px)]:hidden items-center gap-2.5 sm:inset-x-8 md:inset-x-auto md:right-[6%] md:top-[20%] md:items-end lg:right-[8%]">
          <Toast
            shown={beat >= 1}
            avatar={
              <span className="grid size-9 shrink-0 place-items-center rounded-full text-[15px] font-black italic text-block-ink" style={{ background: territory.rivalHues[0] }}>
                {copy.rivals.toast.who[0]}
              </span>
            }
            who={copy.rivals.toast.who}
            text={copy.rivals.toast.text(lost)}
            when={copy.rivals.toast.when}
          />
          <Toast
            shown={beat >= 2}
            avatar={
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-green-soft text-green-text">
                <Icon name="bolt" size={18} />
              </span>
            }
            who={copy.rivals.reclaim.who}
            text={copy.rivals.reclaim.text(reclaimed)}
            when={copy.rivals.reclaim.when}
          />
        </div>

        <div className="relative mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-12">
          <p className="t-kicker text-orange-text">{copy.rivals.kicker}</p>
          <Lines lines={copy.rivals.lines} className="t-display mt-4 max-w-[9em] text-ink" />
          <p className="t-body mt-6 max-w-[40ch] text-muted">{copy.rivals.body}</p>
          <ul className="mt-8 grid max-w-[440px] gap-3">
            {copy.rivals.facts.map((f, i) => (
              <li key={f.text} className="flex items-center gap-3.5">
                <span className={`grid size-9 shrink-0 place-items-center rounded-full ${factTones[i]}`}>
                  <Icon name={f.icon} size={18} />
                </span>
                <span className="t-label text-ink">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
