import { describe, expect, it } from 'vitest';
import { destination } from '../src/geo/geo.ts';
import {
  beyondRecords,
  cadenceBetween,
  dropIsolatedSpikes,
  integrityRulesWith,
  liveIntegrity,
  liveIntegrityText,
  recordSpeedFor,
  smoothedSpeeds,
  sustainedAbove,
  type StepWindow
} from '../src/integrity/speed.ts';
import { decide } from '../src/rules/decisions.ts';
import { INTEGRITY_RULES } from '../src/rules/config.ts';
import { evaluateLoop } from '../src/territory/loop.ts';
import type { LocationSample, RecordingEvent } from '../src/recording/types.ts';
import { ORIGIN, T0, samplePath } from './fixtures.ts';

const line = (lengthM: number, bearing = 90, from = ORIGIN) => [from, destination(from, lengthM, bearing)];
/** Running, then something faster, then running again, as one continuous trace. */
function trace(parts: { m: number; mps: number }[]): LocationSample[] {
  let at = ORIGIN;
  let t = T0;
  const out: LocationSample[] = [];
  for (const p of parts) {
    const seg = samplePath(line(p.m, 90, at), { speedMps: p.mps, startT: t }, out.length);
    out.push(...(out.length ? seg.slice(1) : seg));
    at = destination(at, p.m, 90);
    t = out[out.length - 1]!.t;
  }
  return out.map((s, i) => ({ ...s, seq: i }));
}
const steps = (from: number, to: number, spm: number): StepWindow[] => {
  const out: StepWindow[] = [];
  for (let t = from; t < to; t += 15_000) out.push({ from: t, to: Math.min(to, t + 15_000), steps: (spm * Math.min(15_000, to - t)) / 60_000 });
  return out;
};

describe('record envelope', () => {
  it('follows the world records from sprint to marathon, with the GPS margin', () => {
    expect(recordSpeedFor(19.19)).toBeCloseTo(10.42 * 1.1, 5);
    expect(recordSpeedFor(20)).toBeGreaterThan(11.3);
    expect(recordSpeedFor(20)).toBeLessThan(10.42 * 1.1);
    expect(recordSpeedFor(60)).toBeGreaterThan(9.3);
    expect(recordSpeedFor(60)).toBeLessThan(10.3);
    expect(recordSpeedFor(206)).toBeCloseTo(7.28 * 1.1, 2);
    expect(recordSpeedFor(4 * 3600)).toBeCloseTo(5.83 * 1.1, 2);
    // longer efforts are never allowed to be faster than shorter ones
    const pts = [20, 45, 90, 200, 500, 1000, 3000, 8000].map((d) => recordSpeedFor(d));
    for (let i = 1; i < pts.length; i++) expect(pts[i]!).toBeLessThanOrEqual(pts[i - 1]!);
  });

  it('flags a car burst but not an elite middle-distance pace or ordinary running', () => {
    expect(beyondRecords(trace([{ m: 500, mps: 3.5 }, { m: 600, mps: 15 }, { m: 500, mps: 3.5 }])).length).toBe(1);
    expect(beyondRecords(trace([{ m: 1500, mps: 7.2 }]))).toEqual([]); // 1500 m in 3:28, just off the world record
    expect(beyondRecords(trace([{ m: 10_000, mps: 4 }]))).toEqual([]);
  });
});

describe('GPS spikes and smoothing', () => {
  it('drops a fix that jumps away and comes back, but keeps a real relocation', () => {
    const s = samplePath(line(800), { speedMps: 3 });
    const far = destination(s[100]!, 500, 0);
    s[100] = { ...s[100]!, lat: far.lat, lng: far.lng };
    const spike = dropIsolatedSpikes(s);
    expect(spike.dropped).toBe(1);
    expect(spike.kept.length).toBe(s.length - 1);

    const car = trace([{ m: 300, mps: 3 }, { m: 1500, mps: 20 }]);
    expect(dropIsolatedSpikes(car).dropped).toBe(0);
  });

  it('needs a sustained stretch: a 30 s sprint is not a vehicle, two minutes at 9 m/s is', () => {
    const sprint = smoothedSpeeds(trace([{ m: 500, mps: 3 }, { m: 240, mps: 8 }, { m: 500, mps: 3 }]));
    expect(sustainedAbove(sprint, 6.5, 60)).toEqual([]);
    const car = smoothedSpeeds(trace([{ m: 500, mps: 3 }, { m: 1100, mps: 9 }, { m: 500, mps: 3 }]));
    expect(sustainedAbove(car, 6.5, 60)).toHaveLength(1);
  });
});

describe('live check on the phone', () => {
  it('stays quiet for ordinary running and a single GPS spike', () => {
    const run = trace([{ m: 600, mps: 3.5 }]);
    expect(liveIntegrity(run, null).state).toBe('ok');
    const far = destination(run[150]!, 400, 0);
    run[150] = { ...run[150]!, lat: far.lat, lng: far.lng };
    expect(liveIntegrity(run, null).state).toBe('ok');
  });

  it('warns about an impossible speed at once and pauses once it lasts', () => {
    const shortBurst = trace([{ m: 300, mps: 3 }, { m: 25 * 15, mps: 15 }]);
    expect(liveIntegrity(shortBurst, null)).toMatchObject({ state: 'warn', reason: 'impossible' });
    const longBurst = trace([{ m: 300, mps: 3 }, { m: 75 * 15, mps: 15 }]);
    const r = liveIntegrity(longBurst, null);
    expect(r).toMatchObject({ state: 'pause', reason: 'impossible' });
    expect(liveIntegrityText(r)).toMatch(/^Recording paused: 54 km\/h/);
  });

  it('warns about vehicle-like speed after 30 s and pauses after two minutes', () => {
    expect(liveIntegrity(trace([{ m: 300, mps: 3 }, { m: 40 * 7.5, mps: 7.5 }]), null)).toMatchObject({ state: 'warn', reason: 'vehicle' });
    expect(liveIntegrity(trace([{ m: 300, mps: 3 }, { m: 130 * 7.5, mps: 7.5 }]), null)).toMatchObject({ state: 'pause', reason: 'vehicle' });
  });

  it('catches running speed without running steps (a bicycle), never a fast runner', () => {
    const ride = trace([{ m: 90 * 5, mps: 5 }]);
    const from = ride[0]!.t;
    const to = ride[ride.length - 1]!.t;
    const flagged = liveIntegrity(ride, steps(from, to, 20));
    expect(flagged).toMatchObject({ state: 'warn', reason: 'no_steps' });
    expect(flagged.window!.to - flagged.window!.from).toBeGreaterThanOrEqual(60_000);
    expect(liveIntegrity(trace([{ m: 200 * 5, mps: 5 }]), steps(from, from + 210_000, 15))).toMatchObject({ state: 'pause', reason: 'no_steps' });
    expect(liveIntegrity(ride, steps(from, to, 172)).state).toBe('ok'); // an 18 km/h runner
    expect(liveIntegrity(ride, null).state).toBe('ok'); // no step counter: GPS checks only
  });

  it('works out cadence only when the step windows cover the period', () => {
    expect(cadenceBetween(steps(0, 60_000, 168), 0, 60_000)).toBeCloseTo(168, 5);
    expect(cadenceBetween(steps(0, 20_000, 168), 0, 60_000)).toBeNull();
  });
});

describe('server results', () => {
  const loopTrace = () => {
    const ring = [ORIGIN, destination(ORIGIN, 400, 90), destination(destination(ORIGIN, 400, 90), 400, 0), destination(ORIGIN, 400, 0), ORIGIN];
    return samplePath(ring, { speedMps: 3.2 });
  };
  const loopEvents = (s: LocationSample[], extra: RecordingEvent[] = []): RecordingEvent[] => [
    { kind: 'start', t: s[0]!.t, afterSeq: -1 },
    { kind: 'capture_start', t: s[0]!.t, afterSeq: -1 },
    ...extra,
    { kind: 'capture_end', t: s[s.length - 1]!.t, afterSeq: s[s.length - 1]!.seq },
    { kind: 'finish', t: s[s.length - 1]!.t, afterSeq: s[s.length - 1]!.seq }
  ];

  it('keeps a loop eligible when a GPS spike is ignored', () => {
    const s = loopTrace();
    const far = destination(s[200]!, 700, 45);
    s[200] = { ...s[200]!, lat: far.lat, lng: far.lng };
    const r = evaluateLoop(s, loopEvents(s));
    expect(r.reasons).toEqual(['gps_spike_ignored']);
    expect(r.decision).toBe('eligible');
  });

  it('holds a loop for review when the phone counted no running steps', () => {
    const s = loopTrace();
    const r = evaluateLoop(s, loopEvents(s, [{ kind: 'steps_check', t: s[300]!.t, afterSeq: 300, data: { result: 'no_running_steps', from: s[200]!.t, to: s[300]!.t } }]));
    expect(r.reasons).toEqual(['no_running_steps']);
    expect(r.decision).toBe('pending_review');
  });

  it('treats informational reasons as no reason at all', () => {
    expect(decide(['gps_spike_ignored'])).toBe('eligible');
    expect(decide(['gps_spike_ignored', 'implausible_speed'])).toBe('pending_review');
  });
});

describe('backend overrides', () => {
  it('takes known, sane values and ignores the rest, so the checks cannot be switched off', () => {
    const r = integrityRulesWith({ version: 'v2', stepsMinCadence: 90, liveWarnSeconds: 0, envelopeMargin: 'x', unknown: 1 });
    expect(r.stepsMinCadence.value).toBe(90);
    expect(r.liveWarnSeconds.value).toBe(INTEGRITY_RULES.liveWarnSeconds.value);
    expect(r.envelopeMargin.value).toBe(INTEGRITY_RULES.envelopeMargin.value);
    expect(r.version).toBe(`${INTEGRITY_RULES.version}+v2`);
    expect(integrityRulesWith(null)).toBe(INTEGRITY_RULES);
  });
});
