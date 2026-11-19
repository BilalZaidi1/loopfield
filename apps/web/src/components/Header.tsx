'use client';

import { useEffect, useRef, useState } from 'react';
import { copy } from '@/content/en';
import { track } from '@/lib/analytics';
import { getHref, overallState, waitlistOnly } from '@/lib/stores';
import { smoothstep, story } from '@/story/state';
import { mark } from '@/theme/brand';
import { Wordmark } from './LoopMark';
import { PillLink } from './Pill';
import { useStory } from './useStory';

/** The loop mark doubles as the page's progress: its arc fills as you scroll and the dot lands at the final call. */
function ProgressMark() {
  const arc = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  useStory(() => {
    const p = story.page;
    arc.current?.setAttribute('stroke-dashoffset', String(1 - p));
    if (dot.current) {
      const s = 0.35 + 0.65 * smoothstep(0.96, 1, p);
      dot.current.style.transform = `scale(${s.toFixed(3)})`;
      dot.current.style.opacity = String(0.45 + 0.55 * smoothstep(0.96, 1, p));
    }
  });
  return (
    <svg width={30} height={30} viewBox={mark.viewBox} aria-hidden="true">
      <path d={mark.ring} stroke={mark.ringColor} strokeOpacity={0.32} strokeWidth={mark.strokeWidth} strokeLinecap="round" fill="none" />
      <path ref={arc} d={mark.ring} stroke={mark.ringColor} strokeWidth={mark.strokeWidth} strokeLinecap="round" fill="none" pathLength={1} strokeDasharray="1" strokeDashoffset="1" />
      <circle
        ref={dot}
        cx={mark.dot.cx}
        cy={mark.dot.cy}
        r={mark.dot.r}
        fill={mark.dotColor}
        style={{ transformOrigin: `${mark.dot.cx}px ${mark.dot.cy}px`, transform: 'scale(0.35)', opacity: 0.45, transition: 'transform var(--dur-pop) var(--ease-pop)' }}
      />
    </svg>
  );
}

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const waitlist = waitlistOnly();

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled ? 'border-b border-white/[0.06] bg-bg/70 backdrop-blur-xl' : 'border-b border-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-6 px-5 sm:px-8 lg:px-12">
        <a href="#top" className="flex items-center gap-2.5 rounded-md" aria-label="Loopfield, back to top">
          <ProgressMark />
          <Wordmark className="text-[22px] leading-none" />
        </a>
        <nav aria-label="Sections" className="hidden items-center gap-7 lg:flex">
          {copy.nav.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="t-label text-muted transition-colors hover:text-ink">
              {item.label}
            </a>
          ))}
        </nav>
        <PillLink
          href={waitlist ? '#download' : getHref('header')}
          size="md"
          variant="primary"
          onClick={() => track('store_click', { platform: waitlist ? 'waitlist' : 'auto', placement: 'header', state: overallState() })}
        >
          {waitlist ? copy.joinWaitlist : copy.getApp}
        </PillLink>
      </div>
    </header>
  );
}
