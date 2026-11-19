'use client';

import { useEffect } from 'react';
import { initAnalytics, track } from '@/lib/analytics';

/** Starts cookieless analytics (when configured) and records each section once, when it reaches the middle of the screen. */
export function Analytics() {
  useEffect(() => {
    initAnalytics();
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.section;
          if (e.isIntersecting && id && !seen.has(id)) {
            seen.add(id);
            track('section_view', { section: id });
          }
        }
      },
      // Pinned sections are taller than the screen, so "half visible" would never happen: use the middle line instead.
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    );
    document.querySelectorAll('[data-section]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
