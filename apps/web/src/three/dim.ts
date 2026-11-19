import { smoothstep } from '@/story/state';

/** How much the field steps back where the page's own content leads (the board, badges, phone, FAQ). */
export function dimAt(T: number): number {
  const band = (a: number, b: number, c: number, d: number) => smoothstep(a, b, T) * (1 - smoothstep(c, d, T));
  return Math.max(
    band(1.98, 2.2, 2.8, 3.02) * 0.82,
    band(5.98, 6.18, 6.84, 7.04) * 0.8,
    band(7.98, 8.14, 8.86, 9.02) * 0.8,
    smoothstep(10.05, 10.4, T) * 0.75
  );
}
