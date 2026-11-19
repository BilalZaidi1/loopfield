'use client';

import { useEffect, useRef } from 'react';
import { onStory } from '@/story/state';

/**
 * Run `effect` on every story frame. Write to DOM refs inside it rather than setting state, so scroll-linked
 * effects never re-render React; set state only when a discrete value (a step, a flag) actually changes.
 */
export function useStory(effect: (T: number, dt: number) => void): void {
  const ref = useRef(effect);
  useEffect(() => {
    ref.current = effect;
  });
  useEffect(() => onStory((T, dt) => ref.current(T, dt)), []);
}
