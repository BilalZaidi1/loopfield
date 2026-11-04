import { describe, expect, it } from 'vitest';
import { destination } from '../src/geo/geo.ts';
import { evaluateLoop, closureHint } from '../src/territory/loop.ts';
import { summarizeActivity } from '../src/recording/summary.ts';
import { circlePath, figureEightPath, loopEvents, ORIGIN, outAndBackPath, rectanglePath, samplePath, T0 } from './fixtures.ts';

describe('territory loop validation (FR29, Appendix A)', () => {
  it('accepts a closed simple loop and reports a verified completion time', () => {
    const s = samplePath(circlePath(ORIGIN, 300));
    const r = evaluateLoop(s, loopEvents(s));
    expect(r.decision).toBe('eligible');
    expect(r.reasons).toEqual([]);
    expect(r.lengthM).toBeGreaterThan(1800);
    expect(r.areaEstimateM2).toBeGreaterThan(270_000);
    expect(r.areaEstimateM2).toBeLessThan(290_000);
    expect(r.completedAt).toBe(s[s.length - 1]!.t);
  });

  it('rejects an open loop instead of bridging the gap', () => {
    const path = circlePath(ORIGIN, 300).slice(0, 115); // stops ~80 m before the start
    const s = samplePath(path);
    const r = evaluateLoop(s, loopEvents(s));
    expect(r.reasons).toContain('open_loop');
    expect(r.decision).toBe('unranked');
  });

  it('treats an out-and-back as degenerate (no land)', () => {
    const s = samplePath(outAndBackPath(ORIGIN, 800));
    const r = evaluateLoop(s, loopEvents(s));
    expect(r.decision).toBe('unranked');
    expect(r.reasons).toContain('degenerate_geometry');
  });

  it('withholds competitive fill for a figure eight (self crossing)', () => {
    const s = samplePath(figureEightPath(ORIGIN, 250));
    const r = evaluateLoop(s, loopEvents(s));
    expect(r.reasons).toContain('self_crossing');
    expect(r.decision).toBe('unranked');
  });

  it('marks a paused competitive interval ineligible but keeps the workout', () => {
    const s = samplePath(circlePath(ORIGIN, 300));
    const mid = s[200]!;
    const r = evaluateLoop(
      s,
      loopEvents(s, [
        { kind: 'pause', t: mid.t + 100, afterSeq: mid.seq },
        { kind: 'resume', t: mid.t + 400, afterSeq: mid.seq }
      ])
    );
    expect(r.reasons).toContain('paused_interval');
    expect(r.decision).toBe('unranked');
    const summary = summarizeActivity(s, loopEvents(s));
    expect(summary.distanceM).toBeGreaterThan(1800);
  });

  it('withholds the result when GPS evidence has a gap longer than ten seconds', () => {
    const s = samplePath(circlePath(ORIGIN, 300), { gap: [100, 115] });
    const r = evaluateLoop(s, loopEvents(s));
    expect(r.reasons).toContain('recording_gap');
    expect(r.decision).toBe('unranked');
  });

  it('flags mocked locations as a rule violation', () => {
    const s = samplePath(circlePath(ORIGIN, 300), { mocked: true });
    expect(evaluateLoop(s, loopEvents(s)).decision).toBe('invalid');
  });

  it('enforces the supported length range', () => {
    const s = samplePath(circlePath(ORIGIN, 100));
    expect(evaluateLoop(s, loopEvents(s)).reasons).toContain('too_short');
  });

  it('holds vehicle-like sustained speed for review rather than accusing', () => {
    const s = samplePath(circlePath(ORIGIN, 600), { speedMps: 14 });
    const r = evaluateLoop(s, loopEvents(s));
    expect(r.reasons).toContain('suspicious_speed');
    expect(r.decision).toBe('pending_review');
  });

  it('requires an explicit capture interval', () => {
    const s = samplePath(circlePath(ORIGIN, 300));
    const r = evaluateLoop(s, [{ kind: 'start', t: T0, afterSeq: -1 }]);
    expect(r.reasons).toEqual(['interval_missing']);
  });

  it('flags unreliable endpoint accuracy', () => {
    const s = samplePath(rectanglePath(ORIGIN, 400, 400));
    s[0] = { ...s[0]!, acc: 22 };
    expect(evaluateLoop(s, loopEvents(s)).reasons).toContain('unreliable_endpoints');
  });

  it('only shows a provisional closure hint near the start after the minimum distance', () => {
    const start = { seq: 0, t: T0, lat: ORIGIN.lat, lng: ORIGIN.lng, acc: 5 };
    const near = { seq: 1, t: T0 + 1, ...destination(ORIGIN, 10, 90), acc: 5 };
    expect(closureHint(start, near, 500)).toBe('open');
    expect(closureHint(start, near, 1500)).toBe('possible_closure');
  });
});

describe('activity summary (FR07, FR08)', () => {
  it('does not accumulate distance across a long gap', () => {
    const full = samplePath(rectanglePath(ORIGIN, 500, 500));
    const gapped = samplePath(rectanglePath(ORIGIN, 500, 500), { gap: [200, 260] });
    const a = summarizeActivity(full, loopEvents(full));
    const b = summarizeActivity(gapped, loopEvents(gapped));
    expect(b.gaps.length).toBe(1);
    expect(b.distanceM).toBeLessThan(a.distanceM - 150);
  });

  it('produces kilometre splits that sum to the distance', () => {
    const s = samplePath(circlePath(ORIGIN, 400));
    const sum = summarizeActivity(s, loopEvents(s));
    const total = sum.splits.reduce((acc, sp) => acc + sp.distanceM, 0);
    expect(Math.abs(total - sum.distanceM)).toBeLessThan(2);
    expect(sum.splits[0]!.elapsedMs).toBeGreaterThan(300_000);
  });
});
