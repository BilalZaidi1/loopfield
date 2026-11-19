import type { Spring } from '@/theme/brand';

/**
 * The app's springs (Reanimated: damping, stiffness, mass) as closed-form step responses, so the web can move
 * exactly like the app: CSS gets them as linear() easings, canvas animations sample them directly, and the cell
 * shader uses the same formula.
 */
export function springParams(s: Spring) {
  const omega0 = Math.sqrt(s.stiffness / s.mass);
  const zeta = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  return { omega0, zeta };
}

/** Position of a spring released from 0 towards 1 at rest, t seconds later. */
export function springAt(s: Spring, t: number): number {
  if (t <= 0) return 0;
  const { omega0, zeta } = springParams(s);
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega0 * t);
    return 1 - envelope * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
  }
  if (zeta === 1) return 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega0 * (zeta - root);
  const r2 = -omega0 * (zeta + root);
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

/** Seconds until the motion stays within 0.1 % of rest. */
export function springDuration(s: Spring): number {
  const { omega0, zeta } = springParams(s);
  return Math.min(2, Math.log(1000) / (Math.min(zeta, 1) * omega0));
}

/** A CSS linear() easing and its duration, so transitions use the app's springs. */
export function springToCss(s: Spring, points = 40): { easing: string; durationMs: number } {
  const duration = springDuration(s);
  const values: string[] = [];
  for (let i = 0; i <= points; i++) {
    const v = i === points ? 1 : springAt(s, (duration * i) / points);
    values.push(String(Math.round(v * 10000) / 10000));
  }
  return { easing: `linear(${values.join(', ')})`, durationMs: Math.round(duration * 1000) };
}

/** Largest overshoot past 1, as a fraction (0.176 = 17.6 %). */
export function springOvershoot(s: Spring): number {
  const { zeta } = springParams(s);
  if (zeta >= 1) return 0;
  return Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
}
