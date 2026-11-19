'use client';

import { useRef, type CSSProperties } from 'react';
import { Icon } from '@/components/Icon';
import { FadeUp, Lines, useShown } from '@/components/Reveal';
import { useStory } from '@/components/useStory';
import { copy } from '@/content/en';
import { metals } from '@/theme/brand';

const HEX = 'M50 3 90.7 26.5v47L50 97 9.3 73.5v-47z';
const INNER = 'M50 15 80.3 32.5v35L50 85 19.7 67.5v-35z';
const metalNames = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' } as const;

/** A bevelled metal hexagon that turns with the scroll and catches the light; never spins on its own. */
function Badge({ metal, icon, label, index }: (typeof copy.progress.badges)[number] & { index: number }) {
  const turn = useRef<HTMLDivElement>(null);
  const shine = useRef<SVGLinearGradientElement>(null);
  const [light, mid, shade] = metals[metal];
  const id = `badge-${metal}`;

  useStory((T) => {
    const a = Math.max(-32, Math.min(32, (T - 6.45 - index * 0.04) * 70));
    if (turn.current) turn.current.style.transform = `rotateY(${a.toFixed(2)}deg) rotateX(${(a * -0.18).toFixed(2)}deg)`;
    // The highlight slides across the face as it turns.
    const x = 50 - a * 3.2;
    shine.current?.setAttribute('x1', `${(x - 40).toFixed(1)}%`);
    shine.current?.setAttribute('x2', `${(x + 40).toFixed(1)}%`);
  });

  return (
    <li className="flex flex-col items-center gap-3">
      <div className="relative aspect-square w-full max-w-[180px] [perspective:700px]">
        <div aria-hidden className="absolute inset-x-[16%] bottom-[2%] h-[10%] rounded-[50%] bg-black/60 blur-md" />
        <div ref={turn} className="relative h-full w-full [transform-style:preserve-3d]">
          {[7, 5.25, 3.5, 1.75].map((z) => (
            <svg key={z} aria-hidden viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" style={{ transform: `translateZ(-${z}px)` } as CSSProperties}>
              <path d={HEX} fill={shade} />
            </svg>
          ))}
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" role="img" aria-label={`${metalNames[metal]} ${label} badge`}>
            <defs>
              <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={light} />
                <stop offset="0.55" stopColor={mid} />
                <stop offset="1" stopColor={shade} />
              </linearGradient>
              <linearGradient id={`${id}-bevel`} x1="1" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor={light} />
                <stop offset="0.6" stopColor={mid} />
                <stop offset="1" stopColor={shade} />
              </linearGradient>
              <linearGradient ref={shine} id={`${id}-shine`} x1="10%" y1="0%" x2="90%" y2="100%">
                <stop offset="0.38" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
                <stop offset="0.62" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={HEX} fill={`url(#${id}-face)`} />
            <path d={INNER} fill={`url(#${id}-bevel)`} />
            <path d={INNER} fill="none" stroke={light} strokeOpacity="0.7" strokeWidth="1" />
            <path d={HEX} fill={`url(#${id}-shine)`} />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-block-ink/85 [filter:drop-shadow(0_1px_0_rgba(255,255,255,0.55))]">
            <Icon name={icon} size={44} strokeWidth={2.4} className="h-[24%] w-[24%]" />
          </span>
        </div>
      </div>
      <p className="text-center">
        <span className="t-label block text-ink">{label}</span>
        <span className="t-caption text-subtle">{metalNames[metal]}</span>
      </p>
    </li>
  );
}

/** The weekly chart in the health green; the bars grow once, as in the app. */
function WeekChart() {
  const [ref, shown] = useShown<HTMLDivElement>(0.4);
  const { week } = copy.progress;
  const max = Math.max(...week.days.map((d) => d.v));
  return (
    <div ref={ref} className="rounded-[24px] bg-surface/90 p-5 ring-1 ring-white/[0.08] backdrop-blur-md sm:p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="t-kicker text-green-text">{week.label}</p>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-[44px] font-black italic leading-none tracking-[-0.03em] text-ink tabular">{week.total}</span>
            <span className="t-label text-muted">{week.unit}</span>
          </p>
        </div>
        <span className="t-caption rounded-full bg-green-soft px-3 py-1.5 font-semibold text-green-text">{week.runs(week.days.filter((d) => d.v > 0).length)}</span>
      </div>
      <ul className="mt-6 grid h-32 grid-cols-7 items-end gap-2.5" aria-label={`${week.label}: ${week.total} ${week.unit}`}>
        {week.days.map((d, i) => (
          <li key={d.d} className="flex h-full flex-col items-center justify-end gap-2">
            {d.v > 0 ? (
              <span
                className="w-full max-w-[26px] origin-bottom rounded-t-[8px] rounded-b-[3px] bg-green transition-transform duration-[var(--dur-sheet)] ease-[var(--ease-sheet)]"
                style={{ height: `${(d.v / max) * 100}%`, transform: shown ? 'scaleY(1)' : 'scaleY(0)', transitionDelay: `${i * 55}ms` }}
                title={`${d.d}: ${d.v} km`}
              />
            ) : (
              <span className="mb-0.5 size-1.5 rounded-full bg-white/20" />
            )}
            <span className="t-caption text-subtle">{d.d[0]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Progress() {
  return (
    <section id="progress" data-section="progress" className="relative py-24 md:py-36">
      <div aria-hidden className="scrim-left pointer-events-none absolute inset-y-0 left-0 hidden w-[56%] md:block" />
      <div className="relative mx-auto grid w-full max-w-[1280px] items-center gap-12 px-5 sm:px-8 md:grid-cols-2 md:gap-14 lg:gap-24 lg:px-12">
        <div>
          <p className="t-kicker text-green-text">{copy.progress.kicker}</p>
          <Lines lines={copy.progress.lines} className="t-display mt-4 max-w-[8em] text-ink" />
          <p className="t-body mt-6 max-w-[40ch] text-muted">{copy.progress.body}</p>
          <FadeUp className="mt-10 max-w-[420px]">
            <WeekChart />
          </FadeUp>
        </div>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-8 sm:gap-x-10" aria-label="Badges">
          {copy.progress.badges.map((b, i) => (
            <Badge key={b.metal} {...b} index={i} />
          ))}
        </ul>
      </div>
    </section>
  );
}
