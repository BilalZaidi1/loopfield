'use client';

import { useEffect } from 'react';
import { emitStory, story } from '@/story/state';
import { beats, SECTIONS, type SectionId } from '@/story/world';

/**
 * Turns the scroll position into the story clock: T = section index + how far the viewport's middle has travelled
 * through that section. Eases `story.value` towards it each frame (instantly with Reduce Motion) and notifies every
 * scroll-linked effect from one requestAnimationFrame loop.
 */
export function StoryDriver() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyMotion = () => {
      story.motion = !(reduce.matches || root.dataset.motion === 'off');
    };
    applyMotion();
    reduce.addEventListener('change', applyMotion);
    const motionObserver = new MutationObserver(applyMotion);
    motionObserver.observe(root, { attributes: true, attributeFilter: ['data-motion'] });

    let marks: { index: number; top: number; height: number }[] = [];
    const measure = () => {
      const y = window.scrollY;
      marks = [...document.querySelectorAll<HTMLElement>('[data-section]')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { index: SECTIONS.indexOf(el.dataset.section as SectionId), top: r.top + y, height: Math.max(1, r.height) };
        })
        .filter((m) => m.index >= 0)
        .sort((a, b) => a.top - b.top);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(document.body);
    window.addEventListener('load', measure);

    const compute = () => {
      const y = window.scrollY + window.innerHeight * 0.5;
      const first = marks[0];
      if (!first) return;
      let current = first;
      for (const m of marks) if (m.top <= y) current = m;
      const local = Math.max(0, Math.min(1, (y - current.top) / current.height));
      story.target = y < first.top ? first.index : current.index + local;
      // The header's loop closes as your patch pulses at the final call.
      story.page = Math.min(1, story.target / beats.final.pulse);
    };

    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      compute();
      if (story.motion) story.value += (story.target - story.value) * (1 - Math.exp(-dt * 7));
      else story.value = story.target;
      emitStory(dt);
      raf = requestAnimationFrame(tick);
    };
    compute();
    story.value = story.target;
    raf = requestAnimationFrame(tick);

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      story.pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
      story.pointer.y = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      motionObserver.disconnect();
      reduce.removeEventListener('change', applyMotion);
      window.removeEventListener('load', measure);
      window.removeEventListener('pointermove', onPointer);
    };
  }, []);

  return null;
}
