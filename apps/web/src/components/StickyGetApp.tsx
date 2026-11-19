'use client';

import { useState } from 'react';
import { copy } from '@/content/en';
import { track } from '@/lib/analytics';
import { getHref, overallState, waitlistOnly } from '@/lib/stores';
import { PillLink } from './Pill';
import { useStory } from './useStory';

/**
 * Phones only: once the hero has scrolled away, a thumb-height bar keeps the way to the store in reach. It is
 * Loopfield's own pill, not a store badge, so each layout keeps a single App Store badge.
 */
export function StickyGetApp() {
  const [show, setShow] = useState(false);
  useStory((T) => {
    // Out of the way of the practice board and the final call, which carry their own buttons.
    const next = (T > 1.05 && T < 1.95) || (T > 3.05 && T < 8.92) || T > 10.45;
    if (next !== show) setShow(next);
  });
  const waitlist = waitlistOnly();
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-6 transition-[opacity,translate,scale] duration-500 md:hidden ${
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'
      }`}
      style={{ background: 'linear-gradient(0deg, rgba(16,17,20,0.94) 40%, rgba(16,17,20,0))' }}
    >
      <PillLink
        href={waitlist ? '#download' : getHref('sticky')}
        className="w-full"
        tabIndex={show ? 0 : -1}
        onClick={() => track('store_click', { platform: waitlist ? 'waitlist' : 'auto', placement: 'sticky', state: overallState() })}
      >
        {waitlist ? copy.joinWaitlist : copy.getApp}
      </PillLink>
    </div>
  );
}
