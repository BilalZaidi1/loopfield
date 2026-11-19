'use client';

import { useSyncExternalStore } from 'react';
import { copy } from '@/content/en';

/** The page's motion setting lives on <html data-motion>, set before first paint from the saved choice. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return () => observer.disconnect();
}
const motionOff = () => document.documentElement.dataset.motion === 'off';

/** Pauses smooth scrolling, the camera flight and every reveal for anyone, not only with Reduce Motion. */
export function MotionToggle() {
  const off = useSyncExternalStore(subscribe, motionOff, () => false);
  const toggle = () => {
    const next = !off;
    if (next) document.documentElement.dataset.motion = 'off';
    else delete document.documentElement.dataset.motion;
    try {
      localStorage.setItem('lf-motion', next ? 'off' : 'on');
    } catch {
      /* storage can be unavailable */
    }
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={off} className="t-label rounded-md text-muted underline-offset-4 hover:text-ink hover:underline">
      {off ? copy.footer.motionOff : copy.footer.motionOn}
    </button>
  );
}
