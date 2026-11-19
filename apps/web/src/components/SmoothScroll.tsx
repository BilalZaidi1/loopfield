'use client';

import Lenis from 'lenis';
import { useEffect } from 'react';

/**
 * Lenis smooths wheel scrolling on top of native scroll, so sticky sections, anchors and assistive tech keep
 * working. Off with Reduce Motion or the footer's Pause motion; touch scrolling stays native.
 */
export function SmoothScroll() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lenis: Lenis | null = null;

    const sync = () => {
      const off = reduce.matches || root.dataset.motion === 'off';
      if (off && lenis) {
        lenis.destroy();
        lenis = null;
      } else if (!off && !lenis) {
        lenis = new Lenis({ autoRaf: true, lerp: 0.11, smoothWheel: true, anchors: { offset: -64 } });
      }
    };
    sync();
    reduce.addEventListener('change', sync);
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-motion'] });

    return () => {
      observer.disconnect();
      reduce.removeEventListener('change', sync);
      lenis?.destroy();
    };
  }, []);

  return null;
}
