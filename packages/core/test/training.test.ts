import { describe, expect, it } from 'vitest';
import {
  compareEffort,
  earlierEfforts,
  effortFromFeel,
  effortFromZones,
  racePredictions,
  riegel,
  runEffort,
  sanitizeEvent,
  trainingLoad,
  type TrainingRun
} from '../src/index.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 25, 12);
const min = (m: number) => m * 60_000;
const run = (id: string, daysAgo: number, over: Partial<TrainingRun> = {}): TrainingRun => ({
  id, start: NOW - daysAgo * DAY, durationMs: min(40), distanceM: 8000, zoneMs: null, feel: null, imported: false, ...over
});

describe('effort score', () => {
  it('weights minutes by heart-rate zone (the worked example)', () => {
    // Ten, twenty, twenty and ten minutes in zones 1 to 4.
    expect(effortFromZones([min(10), min(20), min(20), min(10), 0])).toBe(150);
    expect(runEffort({ durationMs: min(60), zoneMs: [min(10), min(20), min(20), min(10), 0], feel: 3 })).toEqual({ score: 150, basis: 'heart_rate' });
  });

  it('falls back to how it felt, then to a moderate rating, marked as estimates', () => {
    expect(effortFromFeel(min(40), 6)).toBe(120);
    expect(runEffort({ durationMs: min(40), zoneMs: null, feel: 6 })).toEqual({ score: 120, basis: 'feel' });
    expect(runEffort({ durationMs: min(40), zoneMs: [0, 0, 0, 0, 0], feel: null })).toEqual({ score: 100, basis: 'assumed' });
    expect(effortFromFeel(min(40), 14)).toBe(effortFromFeel(min(40), 10));
  });

  it('compares a run with the eight weeks before it, once there are enough runs', () => {
    expect(compareEffort(100, [100, 110])).toBeNull();
    expect(compareEffort(70, [100, 110, 90, 100])).toBe('lighter');
    expect(compareEffort(105, [100, 110, 90, 100])).toBe('usual');
    expect(compareEffort(140, [100, 110, 90, 100])).toBe('harder');
    const runs = [run('a', 70), run('b', 30), run('c', 10), run('d', 0)];
    expect(earlierEfforts(runs[3]!, runs)).toEqual([100, 100]);
  });
});

describe('training load', () => {
  it('builds up the 6-week and 7-day loads day by day, with balance between them', () => {
    const runs = Array.from({ length: 30 }, (_, i) => run(`r${i}`, i * 2, { feel: 5 }));
    const t = trainingLoad(runs, NOW, 0);
    expect(t.days).toHaveLength(84);
    expect(t.days[t.days.length - 1]!.day).toBe('2026-11-25');
    expect(t.long).toBeGreaterThan(30);
    expect(t.short).toBeGreaterThan(t.long);
    expect(t.balance).toBeCloseTo(t.long - t.short, 0);
    expect(t.balanceReady).toBe(true);
    expect(t.estimatedRuns).toBe(30);
  });

  it('waits about three weeks before balance means anything, and ignores runs in the future', () => {
    const t = trainingLoad([run('a', 10), run('b', 3), run('future', -2)], NOW, 0);
    expect(t.balanceReady).toBe(false);
    expect(t.runsCounted).toBe(2);
    expect(trainingLoad([], NOW, 0).long).toBe(0);
  });

  it('puts a run on the runner’s own day', () => {
    const late = { ...run('late', 0), start: Date.UTC(2026, 10, 24, 23, 30) };
    const t = trainingLoad([late], NOW, 60); // UTC+1: 00:30 on the 25th
    expect(t.days.find((d) => d.effort > 0)!.day).toBe('2026-11-25');
  });
});

describe('race predictions', () => {
  it('uses Riegel’s formula: a 25:00 5K predicts about 52:07 for 10K', () => {
    expect(Math.round(riegel(1500, 5000, 10000))).toBe(3127);
    const p = racePredictions([run('five', 5, { distanceM: 5000, durationMs: 25 * 60_000 })], NOW);
    expect(p.map((x) => x.label)).toEqual(['5K', '10K']);
    const tenK = p[1]!;
    expect(tenK.seconds).toBe(3127);
    expect(tenK.low).toBe(Math.round(3127.4 * 0.97));
    expect(tenK.basedOn).toMatchObject({ id: 'five', distanceM: 5000, seconds: 1500 });
  });

  it('needs long enough runs for long races, recent runs only, and takes the best', () => {
    const runs = [
      run('short', 3, { distanceM: 2500, durationMs: min(10) }),
      run('old', 70, { distanceM: 20000, durationMs: min(90) }),
      run('eight', 10, { distanceM: 8000, durationMs: min(40) }),
      run('quick', 20, { distanceM: 8000, durationMs: min(36) }),
      run('long', 15, { distanceM: 16000, durationMs: min(85) })
    ];
    const p = racePredictions(runs, NOW);
    expect(p.map((x) => x.label)).toEqual(['5K', '10K', 'Half marathon', 'Marathon']);
    expect(p[0]!.basedOn.id).toBe('quick');
    expect(p[3]!.basedOn.id).toBe('long');
    expect(racePredictions([run('eight', 10, { distanceM: 8000 })], NOW).map((x) => x.label)).toEqual(['5K', '10K', 'Half marathon']);
  });

  it('counts imported runs, which are personal and never competitive', () => {
    const p = racePredictions([run('watch', 4, { distanceM: 10000, durationMs: min(50), imported: true })], NOW);
    expect(p[0]!.basedOn.id).toBe('watch');
  });
});

describe('analytics for training and the other stage 2 features', () => {
  it('sends only the part viewed, never a score, load or time', () => {
    const e = sanitizeEvent('training_viewed', { part: 'load', long: 41.2, balance: -3 } as never);
    expect(e.properties).toEqual({ part: 'load' });
    expect(sanitizeEvent('running_now', { action: 'shown', count: 23, city: 'Karachi' } as never).properties).toEqual({ action: 'shown' });
    expect(sanitizeEvent('friends_live', { action: 'turned_on', audience: 'chosen', friends: 4 } as never).properties).toEqual({ action: 'turned_on', audience: 'chosen' });
    expect(sanitizeEvent('run_summary', { action: 'shown', lines: '2', top: 'longest', text: 'Your longest run' } as never).properties).toEqual({ action: 'shown', lines: '2', top: 'longest' });
  });
});
