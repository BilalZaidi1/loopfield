'use client';

import { useCallback, useState } from 'react';
import { DrawPad } from '@/components/DrawPad';
import { Lines } from '@/components/Reveal';
import { StoreButtons } from '@/components/StoreButtons';
import { copy } from '@/content/en';

/** The visitor's own loop. The field behind steps back while the board leads; the store buttons follow a claim. */
export function YourTurn() {
  const [claimed, setClaimed] = useState(false);
  const onClaim = useCallback(() => setClaimed(true), []);

  return (
    <section id="turn" data-section="turn" className="relative py-24 md:py-36">
      <div aria-hidden className="scrim-left pointer-events-none absolute inset-y-0 left-0 hidden w-[56%] md:block" />
      <div className="relative mx-auto grid w-full max-w-[1280px] gap-8 px-5 sm:px-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:grid-rows-[auto_1fr] md:gap-x-14 md:gap-y-10 lg:gap-x-20 lg:px-12">
        <div className="md:col-start-1 md:row-start-1 md:self-end">
          <p className="t-kicker text-primary">{copy.turn.kicker}</p>
          <Lines lines={copy.turn.lines} className="t-display mt-4 text-ink" />
          <p className="t-body mt-6 max-w-[34ch] text-muted">{copy.turn.body}</p>
        </div>
        <div className="md:col-start-2 md:row-span-2 md:row-start-1 md:self-center">
          <DrawPad onClaim={onClaim} />
        </div>
        <div
          inert={!claimed}
          className={`md:col-start-1 md:row-start-2 transition-[opacity,translate,scale] duration-700 ease-[var(--ease-out-expo)] ${
            claimed ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
          }`}
        >
          <p className="t-title max-w-[16em] text-ink">{copy.turn.cta}</p>
          <StoreButtons placement="your-turn" className="mt-5" />
        </div>
      </div>
    </section>
  );
}
