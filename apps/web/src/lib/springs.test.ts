import { describe, expect, it } from 'vitest';
import { springs } from '@/theme/brand';
import { springAt, springDuration, springOvershoot, springToCss } from './springs';

describe('app springs', () => {
  it('start at 0 and settle at 1', () => {
    for (const s of Object.values(springs)) {
      expect(springAt(s, 0)).toBe(0);
      expect(Math.abs(springAt(s, springDuration(s)) - 1)).toBeLessThan(0.002);
    }
  });

  it('keep their character: the pop overshoots about 18 %, the sheet barely moves past rest', () => {
    expect(springOvershoot(springs.pop)).toBeGreaterThan(0.16);
    expect(springOvershoot(springs.pop)).toBeLessThan(0.19);
    expect(springOvershoot(springs.sheet)).toBeLessThan(0.02);
  });

  it('peak where the closed form says', () => {
    let peak = 0;
    for (let t = 0; t < 1; t += 0.001) peak = Math.max(peak, springAt(springs.pop, t));
    expect(peak - 1).toBeCloseTo(springOvershoot(springs.pop), 2);
  });

  it('become a CSS linear() easing that ends at 1', () => {
    const { easing, durationMs } = springToCss(springs.press);
    expect(easing.startsWith('linear(0, ')).toBe(true);
    expect(easing.endsWith(', 1)')).toBe(true);
    expect(durationMs).toBeGreaterThan(300);
    expect(durationMs).toBeLessThan(900);
  });
});
