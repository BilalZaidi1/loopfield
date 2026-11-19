'use client';

import { useRef, useState } from 'react';
import { AppScreen } from '@/components/AppScreens';
import { Lines } from '@/components/Reveal';
import { useStory } from '@/components/useStory';
import { copy } from '@/content/en';
import { smoothstep, span, story } from '@/story/state';
import { beats } from '@/story/world';

const screens = copy.app.screens;
const LAST = screens.length - 1;

/**
 * Pinned and sideways: the captions slide past as you scroll while one generic phone (no notch, buttons or camera
 * island) turns a few degrees between screens.
 */
export function AppTour() {
  const [index, setIndex] = useState(0);
  const phone = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  useStory((T) => {
    // Each screen rests for most of its stretch of scroll, then slides on to the next.
    const raw = span(T, beats.app.screens[0], beats.app.screens[1]) * LAST;
    const whole = Math.min(LAST, Math.floor(raw));
    const p = whole + smoothstep(0.55, 1, raw - whole);
    const i = Math.max(0, Math.min(LAST, Math.round(p)));
    if (i !== index) setIndex(i);
    if (rail.current) rail.current.style.transform = `translate3d(${(-p * 100).toFixed(3)}%,0,0)`;
    if (phone.current) {
      const turn = story.motion ? -9 * Math.cos(p * Math.PI) : 0;
      phone.current.style.transform = `rotateY(${turn.toFixed(2)}deg) rotateX(${(2 + Math.sin(p * Math.PI) * 1.5).toFixed(2)}deg)`;
    }
  });

  return (
    <section id="app" data-section="app" aria-label={copy.app.kicker} className="relative h-[360vh] md:h-[400vh]">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden pt-16 md:pt-0">
        <div aria-hidden className="scrim-left absolute inset-y-0 left-0 hidden w-[64%] md:block" />
        <div className="relative mx-auto grid w-full max-w-[1280px] grid-cols-[minmax(0,1fr)] items-center gap-6 px-5 sm:px-8 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16 lg:gap-24 lg:px-12">
          <div className="order-2 min-w-0 md:order-1">
            <p className="t-kicker hidden text-primary md:block">{copy.app.kicker}</p>
            <Lines lines={copy.app.lines} className="t-display mt-4 max-w-[9em] text-ink max-md:sr-only" />
            <div className="overflow-hidden md:mt-12 md:max-w-[440px]">
              <div ref={rail} className="flex will-change-transform">
                {screens.map((s, i) => (
                  <div key={s.id} className="w-full shrink-0 pr-6" aria-hidden={i !== index}>
                    <p className="t-kicker text-subtle tabular">
                      {String(i + 1).padStart(2, '0')} / {String(screens.length).padStart(2, '0')}
                    </p>
                    <p className="mt-2 font-display text-[32px] font-black uppercase italic leading-none tracking-[-0.02em] text-ink md:text-[44px]">{s.title}</p>
                    <p className="t-body mt-2 text-muted">{s.body}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 flex items-center gap-1.5" aria-hidden>
              {screens.map((s, i) => (
                <span key={s.id} className={`h-1.5 rounded-full transition-[width,background-color] duration-500 ${i === index ? 'w-6 bg-primary' : 'w-1.5 bg-white/20'}`} />
              ))}
            </div>
            <p className="t-caption mt-6 text-subtle">{copy.app.disclaimer}</p>
          </div>

          <div className="order-1 mx-auto md:order-2">
            <p className="t-kicker mb-3 text-center text-primary md:hidden">{copy.app.kicker}</p>
            <div className="relative h-[484px] w-[234px] [@media(max-height:740px)]:h-[384px] [@media(max-height:740px)]:w-[186px] sm:h-[620px] sm:w-[300px] sm:[@media(max-height:740px)]:h-[484px] sm:[@media(max-height:740px)]:w-[234px] md:[@media(max-height:820px)]:h-[527px] md:[@media(max-height:820px)]:w-[255px]">
              <div className="absolute left-0 top-0 origin-top-left scale-[0.78] [perspective:1400px] [@media(max-height:740px)]:scale-[0.62] sm:scale-100 sm:[@media(max-height:740px)]:scale-[0.78] md:[@media(max-height:820px)]:scale-[0.85]">
                <div ref={phone} className="phone w-[300px] will-change-transform [transform-style:preserve-3d]">
                  <div className="phone-screen h-[600px] w-[280px]">
                    {screens.map((s, i) => (
                      <div
                        key={s.id}
                        aria-hidden
                        className={`absolute inset-0 transition-[opacity,translate,scale] duration-[var(--dur-sheet)] ease-[var(--ease-sheet)] ${
                          i === index ? 'translate-x-0 opacity-100' : i < index ? '-translate-x-[10%] opacity-0' : 'translate-x-[10%] opacity-0'
                        }`}
                      >
                        <AppScreen id={s.id} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
