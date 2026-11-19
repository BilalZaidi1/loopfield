'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/Icon';
import { Lines } from '@/components/Reveal';
import { useStory } from '@/components/useStory';
import { copy } from '@/content/en';
import { span } from '@/story/state';
import { beats } from '@/story/world';

const TOTAL = copy.titles.time.minutes * 60 + copy.titles.time.seconds;
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * The orange block opens from a single cell; the time runs while the camera rides the route, freezes at the finish,
 * and the title chip lands. Pinned while the time runs.
 */
export function RouteTitles() {
  const block = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [won, setWon] = useState(false);

  useStory((T) => {
    const iris = span(T, beats.titles.iris[0], beats.titles.iris[1]);
    block.current?.style.setProperty('--iris', iris.toFixed(4));
    if (time.current) time.current.textContent = clock(Math.round(TOTAL * span(T, beats.titles.run[0], beats.titles.run[1])));
    const o = iris > 0.35;
    if (o !== open) setOpen(o);
    const w = T >= beats.titles.title;
    if (w !== won) setWon(w);
  });

  return (
    <section id="titles" data-section="titles" className="relative h-[260vh]">
      <div className="sticky top-0 flex h-[100svh] items-start overflow-hidden pt-20 md:items-center md:pt-0">
        <div className="relative mx-auto w-full max-w-[1280px] px-4 sm:px-8 lg:px-12">
          <div
            ref={block}
            className="hex-iris w-full rounded-[28px] bg-orange p-6 text-block-ink sm:p-9 md:max-w-[540px] lg:max-w-[580px] lg:p-11"
            style={{ '--iris-from': '56px', '--iris-span': '300%' } as CSSProperties}
          >
            <p className="t-kicker text-block-ink/70">{copy.titles.kicker}</p>
            <Lines
              lines={copy.titles.lines}
              show={open}
              className="mt-3 font-display text-[clamp(34px,4.3vw,66px)] font-black uppercase italic leading-[0.94] tracking-[-0.03em]"
            />
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-7">
              <span
                ref={time}
                aria-hidden
                className="font-display text-[clamp(64px,8.6vw,128px)] font-black italic leading-[0.9] tracking-[-0.032em] tabular"
              >
                00:00
              </span>
              <span
                className={`t-label inline-flex items-center gap-2 rounded-full bg-block-ink px-4 py-2 text-white transition-[opacity,translate,scale] duration-[var(--dur-pop)] ease-[var(--ease-pop)] ${
                  won ? 'scale-100 opacity-100' : 'scale-[0.6] opacity-0'
                }`}
              >
                <Icon name="trophy" size={16} className="text-orange" />
                {copy.titles.chip}
              </span>
            </div>
            <p className="sr-only">
              {copy.titles.time.minutes}:{String(copy.titles.time.seconds).padStart(2, '0')}, {copy.titles.chip}
            </p>
            <p className="mt-5 max-w-[46ch] text-[16px] font-medium leading-6 text-block-ink/80 sm:text-[17px] sm:leading-[26px]">{copy.titles.body}</p>
            <p className="t-caption mt-5 flex items-center gap-2 font-semibold text-block-ink/75">
              <Icon name="check" size={16} strokeWidth={2.6} />
              {copy.titles.trust}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
