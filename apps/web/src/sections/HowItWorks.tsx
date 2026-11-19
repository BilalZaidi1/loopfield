'use client';

import { useRef, useState } from 'react';
import { Lines } from '@/components/Reveal';
import { useStory } from '@/components/useStory';
import { copy } from '@/content/en';
import { smoothstep, span } from '@/story/state';
import { beats } from '@/story/world';

const steps = copy.how.steps;

/**
 * Pinned for three beats: start, close the loop, the ground turns violet. The 3D runs the same beats. Desktops list
 * all three steps beside the scene; phones show the current step in a card under it.
 */
export function HowItWorks({ cells }: { cells: number }) {
  const [step, setStep] = useState(0);
  const counters = useRef<(HTMLSpanElement | null)[]>([]);
  const counterWraps = useRef<(HTMLElement | null)[]>([]);
  const bars = useRef<(HTMLDivElement | null)[]>([]);

  useStory((T) => {
    const s = T < beats.how.close[0] - 0.08 ? 0 : T < beats.how.claim ? 1 : 2;
    if (s !== step) setStep(s);
    const claimed = smoothstep(beats.how.claim, beats.how.claim + beats.how.ripple + 0.04, T);
    const shown = String(smoothstep(beats.how.claim - 0.03, beats.how.claim + 0.02, T));
    const progress = `scaleX(${span(T, 1.12, 1.84).toFixed(4)})`;
    for (const el of counters.current) if (el) el.textContent = `+${Math.round(cells * claimed)}`;
    for (const el of counterWraps.current) if (el) el.style.opacity = shown;
    for (const el of bars.current) if (el) el.style.transform = progress;
  });

  const badge = (i: number, active: boolean, done: boolean) =>
    `grid size-8 shrink-0 place-items-center rounded-full font-display text-[15px] font-black italic transition-colors duration-500 ${
      active ? (i === 1 ? 'bg-orange text-block-ink' : 'bg-primary-fill text-white') : done ? 'bg-primary-soft text-on-primary-soft' : 'bg-white/10 text-muted'
    }`;
  const current = steps[step]!;

  return (
    <section id="how" data-section="how" className="relative h-[280vh] md:h-[300vh]">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-between overflow-hidden pb-28 pt-20 md:justify-center md:pb-0 md:pt-0">
        <div aria-hidden className="scrim-left absolute inset-y-0 left-0 hidden w-[62%] md:block" />
        <div aria-hidden className="absolute inset-x-0 top-0 h-[42%] bg-gradient-to-b from-bg/95 via-bg/70 to-transparent md:hidden" />
        <div aria-hidden className="scrim-bottom absolute inset-x-0 bottom-0 h-[46%] md:hidden" />

        <div className="relative mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-12">
          <p className="t-kicker text-primary">{copy.how.kicker}</p>
          <Lines lines={copy.how.lines} className="t-display mt-4 max-w-[9em] text-ink" />
          <ol className="mt-10 hidden max-w-[460px] gap-1.5 md:grid">
            {steps.map((s, i) => {
              const active = i === step;
              const done = i < step;
              return (
                <li
                  key={s.title}
                  aria-current={active ? 'step' : undefined}
                  className={`flex gap-4 rounded-[20px] px-4 py-3.5 transition-[background-color,opacity] duration-500 ${active ? 'bg-white/[0.06]' : ''} ${
                    active || done ? 'opacity-100' : 'opacity-45'
                  }`}
                >
                  <span className={`mt-0.5 ${badge(i, active, done)}`}>{i + 1}</span>
                  <span>
                    <span className="t-headline block text-ink">{s.title}</span>
                    <span className="mt-1 block text-[16px] leading-6 text-muted">{s.body}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <div ref={(el) => void (counterWraps.current[0] = el)} className="mt-8 hidden items-baseline gap-3 opacity-0 md:flex">
            <span
              ref={(el) => void (counters.current[0] = el)}
              className="font-display text-[clamp(56px,7.5vw,112px)] font-black italic leading-none tracking-[-0.035em] text-primary tabular"
            >
              +0
            </span>
            <span className="t-kicker text-muted">{copy.how.counterLabel}</span>
          </div>
          <div className="mt-8 hidden h-[3px] w-full max-w-[460px] overflow-hidden rounded-full bg-white/10 md:block" aria-hidden>
            <div ref={(el) => void (bars.current[0] = el)} className="h-full origin-left scale-x-0 rounded-full bg-gradient-to-r from-[#4FA8FF] to-primary" />
          </div>
        </div>

        <div className="relative px-5 sm:px-8 md:hidden">
          <div className="rounded-[24px] bg-surface/90 p-5 ring-1 ring-white/10 backdrop-blur-md">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-3">
                <span className={badge(step, true, false)}>{step + 1}</span>
                <span className="t-caption text-subtle">
                  {step + 1} / {steps.length}
                </span>
              </span>
              <span ref={(el) => void (counterWraps.current[1] = el)} className="flex items-baseline gap-1.5 opacity-0">
                <span ref={(el) => void (counters.current[1] = el)} className="font-display text-[30px] font-black italic leading-none text-primary tabular">
                  +0
                </span>
                <span className="t-kicker text-muted">{copy.how.counterLabel}</span>
              </span>
            </div>
            <p key={current.title} aria-live="polite" className="mt-3">
              <span className="t-headline block text-ink">{current.title}</span>
              <span className="mt-1 block text-[15px] leading-[22px] text-muted">{current.body}</span>
            </p>
            <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
              <div ref={(el) => void (bars.current[1] = el)} className="h-full origin-left scale-x-0 rounded-full bg-gradient-to-r from-[#4FA8FF] to-primary" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
