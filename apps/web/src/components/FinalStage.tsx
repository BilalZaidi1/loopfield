'use client';

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { span, story } from '@/story/state';
import { beats } from '@/story/world';
import { useStory } from './useStory';

/**
 * The final call's stage: the headline sits over the city-wide patchwork while the camera pulls back, then the
 * violet block opens from a single cell behind it as your patch pulses, and the buttons arrive.
 */
export function FinalStage({ headline, children }: { headline: ReactNode; children: ReactNode }) {
  const block = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useStory((T) => {
    const iris = span(T, beats.final.iris[0], beats.final.iris[1]);
    block.current?.style.setProperty('--iris', iris.toFixed(4));
    if (scrim.current) scrim.current.style.opacity = String(1 - iris);
    const o = !story.motion || iris > 0.55;
    if (o !== open) setOpen(o);
  });

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div ref={scrim} aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_50%,rgba(16,17,20,0.82)_0%,rgba(16,17,20,0.45)_60%,rgba(16,17,20,0)_100%)]" />
      <div
        ref={block}
        aria-hidden
        className="hex-iris absolute inset-2 overflow-hidden rounded-[28px] bg-primary-fill sm:inset-5"
        style={{ '--iris-from': '36px', '--iris-span': '340%' } as CSSProperties}
      >
        <svg className="absolute inset-0 h-full w-full opacity-[0.12]" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
          <defs>
            <pattern id="final-hex" width="41.57" height="72" patternUnits="userSpaceOnUse" patternTransform="translate(-8 -12)">
              <path d="M20.78 0 41.57 12v24L20.78 48 0 36V12zM20.78 48v24" fill="none" stroke="#fff" strokeWidth="1.2" />
            </pattern>
            <radialGradient id="final-glow" cx="50%" cy="38%" r="70%">
              <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <mask id="final-mask">
              <rect width="1200" height="800" fill="url(#final-glow)" />
            </mask>
          </defs>
          <rect width="1200" height="800" fill="url(#final-hex)" mask="url(#final-mask)" />
        </svg>
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-col items-center px-6 text-center sm:px-12">
        {headline}
        <div
          inert={!open}
          className={`flex w-full flex-col items-center transition-[opacity,translate] duration-700 ease-[var(--ease-out-expo)] ${open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
