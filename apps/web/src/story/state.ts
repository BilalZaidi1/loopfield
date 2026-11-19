/**
 * The story clock, shared by the page and the 3D scene without React re-renders. `target` follows the scroll,
 * `value` eases towards it every frame, and every scroll-linked effect (camera, cells, counters, blocks) reads
 * `value`, so the 3D and the text never drift apart. One requestAnimationFrame loop drives it (StoryDriver).
 */
export type Tier = 'high' | 'mid' | 'low' | 'none';

type Listener = (value: number, dt: number) => void;

export const story = {
  target: 0.5,
  value: 0.5,
  /** 0–1: the hero's opening loop, played once in real time when the 3D first appears. */
  intro: 0,
  /** 0–1 through the page, up to the final call: drives the header's loop mark. */
  page: 0,
  /** False with Reduce Motion or the footer's Pause motion: no easing, no camera flight, no intro. */
  motion: true,
  tier: 'none' as Tier,
  pointer: { x: 0, y: 0 }
};

const listeners = new Set<Listener>();

export function onStory(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitStory(dt: number): void {
  for (const l of listeners) l(story.value, dt);
}

/** Hermite smoothstep, as in GLSL. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Progress through [from, to] on the story clock, 0–1. */
export function span(value: number, from: number, to: number): number {
  return clamp01((value - from) / (to - from));
}
