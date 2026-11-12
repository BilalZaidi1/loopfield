import { describe, expect, it } from 'vitest';
import { closureHint, evaluateLoop, MOVEMENT_RULES, TERRITORY_RULES, withRuleOverrides, withThreshold } from '../src/index.ts';
import { circlePath, loopEvents, ORIGIN, samplePath } from './fixtures.ts';

describe('withRuleOverrides', () => {
  it('replaces known numeric thresholds and stamps the version', () => {
    const r = withRuleOverrides(TERRITORY_RULES, { minLoopLengthMeters: 600, closureMaxGapMeters: 30 }, 'territory-x+ops.1');
    expect(r.version).toBe('territory-x+ops.1');
    expect(r.minLoopLengthMeters.value).toBe(600);
    expect(r.minLoopLengthMeters.source).toBe(TERRITORY_RULES.minLoopLengthMeters.source);
    expect(r.closureMaxGapMeters.value).toBe(30);
    expect(r.maxLoopLengthMeters.value).toBe(TERRITORY_RULES.maxLoopLengthMeters.value);
  });

  it('ignores unknown keys, non-numbers and non-finite values', () => {
    const r = withRuleOverrides(TERRITORY_RULES, { nope: 1, minLoopLengthMeters: '5', maxLoopLengthMeters: Number.NaN, version: 'x' }, 'v2');
    expect(r.minLoopLengthMeters.value).toBe(TERRITORY_RULES.minLoopLengthMeters.value);
    expect(r.maxLoopLengthMeters.value).toBe(TERRITORY_RULES.maxLoopLengthMeters.value);
    expect((r as Record<string, unknown>).nope).toBeUndefined();
    expect(r.version).toBe('v2');
  });

  it('tolerates missing or malformed overrides', () => {
    expect(withRuleOverrides(TERRITORY_RULES, null, 'v').minSamples.value).toBe(TERRITORY_RULES.minSamples.value);
    expect(withRuleOverrides(TERRITORY_RULES, [1, 2], 'v').minSamples.value).toBe(TERRITORY_RULES.minSamples.value);
  });

  it('changes what the engine accepts: a shorter minimum loop admits a 700 m loop', () => {
    const s = samplePath(circlePath(ORIGIN, 700 / (2 * Math.PI)));
    const strict = evaluateLoop(s, loopEvents(s));
    const relaxed = evaluateLoop(s, loopEvents(s), withRuleOverrides(TERRITORY_RULES, { minLoopLengthMeters: 500 }, 'v'));
    expect(strict.reasons).toContain('too_short');
    expect(relaxed.reasons).not.toContain('too_short');
    expect(relaxed.ruleVersion).toBe('v');
  });

  it('feeds the live closing hint', () => {
    const first = { t: 0, lat: 24.86, lng: 67, acc: 5 };
    const near = { t: 1, lat: 24.86, lng: 67.0001, acc: 5 };
    expect(closureHint(first, near, 800)).toBe('open');
    expect(closureHint(first, near, 800, withRuleOverrides(TERRITORY_RULES, { minLoopLengthMeters: 600 }, 'v'))).toBe('possible_closure');
  });
});

describe('withThreshold', () => {
  it('replaces one value and keeps the rest', () => {
    const m = withThreshold(MOVEMENT_RULES, 'minVerifiedDistanceMeters', 500);
    expect(m.minVerifiedDistanceMeters.value).toBe(500);
    expect(m.pointsPerKm.value).toBe(MOVEMENT_RULES.pointsPerKm.value);
    expect(withThreshold(MOVEMENT_RULES, 'minVerifiedDistanceMeters', null)).toBe(MOVEMENT_RULES);
  });
});
