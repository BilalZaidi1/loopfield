import { describe, expect, it } from 'vitest';
import { best5kFromSplits, halvesFromSplits, runHighlights, type HighlightContext, type HighlightRun } from '../src/index.ts';

const DAY = 86_400_000;
// Wednesday 25 November 2026, 18:00 UTC.
const NOW = Date.UTC(2026, 10, 25, 18);
const r = (id: string, daysAgo: number, km: number, over: Partial<HighlightRun> = {}): HighlightRun => ({
  id, start: NOW - daysAgo * DAY - 3_600_000, distanceM: km * 1000, durationMs: km * 330_000, best5kSeconds: null, halves: null, imported: false, ...over
});
const ctx = (run: HighlightRun, history: HighlightRun[], over: Partial<HighlightContext> = {}): HighlightContext => ({
  run, history, historyFrom: NOW - 120 * DAY, now: NOW, offsetMin: 0, units: 'metric', goals: { weeklyRuns: null, weeklyDistanceM: null },
  land: null, effortWord: null, memory: {}, ...over
});
const texts = (c: HighlightContext) => runHighlights(c).lines.map((l) => l.text);

describe('run highlights', () => {
  it('says when a run is the longest this month, and stays quiet when it is not', () => {
    const today = r('today', 0, 12.4);
    expect(texts(ctx(today, [r('a', 3, 8), r('b', 10, 10)]))).toContain('Your longest run this month: 12.4 km.');
    expect(texts(ctx(today, [r('a', 3, 13)]))).toEqual([]);
    // The only run this month isn't special, and a history that doesn't reach the 1st can't tell.
    expect(texts(ctx(today, [r('october', 40, 5)]))).toEqual([]);
    expect(texts(ctx(today, [r('a', 3, 8)], { historyFrom: NOW - 5 * DAY }))).toEqual([]);
  });

  it('names the month since a faster 5 km, using imported runs that might have been faster', () => {
    const today = r('today', 0, 6, { best5kSeconds: 1491 });
    const history = [r('aug', 100, 5, { best5kSeconds: 1450 }), r('sep', 70, 6, { best5kSeconds: 1530 }), r('oct', 40, 5, { best5kSeconds: 1600 })];
    expect(texts(ctx(today, history))).toContain('Your fastest 5 km since August: 24:51.');
    // A watch run in October without splits, about as fast: the claim stops there.
    const watch = r('watch', 35, 5, { imported: true, durationMs: 1500_000 });
    expect(texts(ctx(today, [...history, watch]))).toContain('Your fastest 5 km since October: 24:51.');
    // A faster run only a week ago makes the line not worth saying.
    expect(texts(ctx(today, [...history, r('last-week', 7, 5, { best5kSeconds: 1480 })]))).not.toEqual(expect.arrayContaining([expect.stringContaining('fastest')]));
    // Faster than everything loaded: it says how far back that reaches.
    expect(texts(ctx(today, [r('sep', 70, 6, { best5kSeconds: 1530 })]))).toContain('Your fastest 5 km in three months: 24:51.');
  });

  it('notices a faster second half, but not run after run', () => {
    const today = r('today', 0, 8, { halves: { first: 1360, second: 1320 } });
    expect(texts(ctx(today, []))).toContain('Second half 40 seconds faster than the first.');
    const memory = { faster_second_half: { at: NOW - DAY, fact: '45' } };
    expect(texts(ctx(today, [], { memory }))).toEqual([]);
    expect(texts(ctx(r('today', 0, 8, { halves: { first: 1400, second: 1320 } }), [], { memory }))).toContain('Second half 80 seconds faster than the first.');
    expect(texts(ctx(r('short', 0, 2, { halves: { first: 400, second: 300 } }), []))).toEqual([]);
  });

  it('reports land, and goal and streak lines at most once a day', () => {
    expect(texts(ctx(r('t', 0, 5), [], { land: { gained: 10, kept: 2, taken: 6 } }))).toEqual(['You took 6 cells from other runners.']);
    // Monday 23 and Tuesday 24 November, then today: the third run of the week.
    const week = [r('mon', 2, 5), r('tue', 1, 5)];
    expect(texts(ctx(r('t', 0, 5), week, { goals: { weeklyRuns: 4, weeklyDistanceM: null } }))).toContain('Third run this week. One more reaches your weekly goal.');
    const shown = runHighlights(ctx(r('t', 0, 5), week, { goals: { weeklyRuns: 3, weeklyDistanceM: null } }));
    expect(shown.lines.map((l) => l.text)).toContain('Third run this week: you reached your weekly goal.');
    expect(texts(ctx(r('t2', 0, 5), week, { goals: { weeklyRuns: 3, weeklyDistanceM: null }, memory: shown.memory }))).not.toEqual(expect.arrayContaining([expect.stringContaining('goal')]));
    const lastWeeks = [r('a', 7, 5), r('b', 8, 5), r('c', 9, 5), r('d', 14, 5), r('e', 15, 5), r('f', 16, 5)];
    expect(texts(ctx(r('t', 0, 5), [...week, ...lastWeeks]))).toContain('Three weeks in a row with at least three runs.');
  });

  it('keeps the effort line on the phone, and the three most important lines', () => {
    const lines = runHighlights(ctx(r('t', 0, 12.4, { halves: { first: 1360, second: 1320 } }), [r('a', 3, 8)], { effortWord: 'harder', land: { gained: 3, kept: 0, taken: 0 } })).lines;
    expect(lines.map((l) => l.kind)).toEqual(['longest', 'land', 'faster_second_half']);
    const effort = runHighlights(ctx(r('t', 0, 5), [], { effortWord: 'harder' })).lines;
    expect(effort).toEqual([{ kind: 'effort', priority: 40, text: 'Harder than usual for you.', shareable: false }]);
  });

  it('marks shoe milestones once each', () => {
    const c = ctx(r('t', 0, 5), [], { shoes: { name: 'Pegasus', distanceM: 512_000 } });
    const first = runHighlights(c);
    expect(first.lines.map((l) => l.text)).toEqual(['Your Pegasus shoes are now at 512 km.']);
    expect(texts({ ...c, memory: first.memory })).toEqual([]);
  });
});

describe('splits', () => {
  const km = (s: number, gap = false) => ({ distanceM: 1000, elapsedMs: s * 1000, containsGap: gap });
  it('finds the fastest 5 km in a row, skipping gaps', () => {
    expect(best5kFromSplits([km(310), km(300), km(295), km(298), km(301), km(296), km(330)])).toBe(1490);
    expect(best5kFromSplits([km(300), km(300), km(300, true), km(300), km(300)])).toBeNull();
    expect(best5kFromSplits([km(300)])).toBeNull();
  });

  it('times each half of the distance', () => {
    expect(halvesFromSplits([km(300), km(300), km(280), { distanceM: 500, elapsedMs: 130_000, containsGap: false }])).toEqual({ first: 525, second: 485 });
    expect(halvesFromSplits([km(300), km(300, true)])).toBeNull();
  });
});
