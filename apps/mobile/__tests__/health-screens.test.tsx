import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { localDayKey } from '@loopfield/core';
import { dailyRanges, fmtClock, fmtHoursMinutes, periodPoints, quantile, sleepSummary, weeklyRanges } from '@/features/health/series';
import MetricDetail from '../app/(app)/health/metric/[type]';

// jest.mock factories are hoisted above imports, so they load their stand-ins with require.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock'));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/health/useHealth', () => ({ deviceOffsetMin: () => 0, useHealthDerived: () => mockDerived.current }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, Stack: { Screen: () => null }, useLocalSearchParams: () => ({ type: mockType.current }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const mockType: { current: string } = { current: 'steps' };
const mockDerived: { current: unknown } = { current: null };

const DAY = 86_400_000;
const today = localDayKey(Date.now(), 0);
const daysAgo = (n: number) => localDayKey(Date.now() - n * DAY, 0);
const derived = (over: Record<string, unknown> = {}) => ({ steps: [], energy: [], nights: [], resting: [], hrv: [], vo2Series: [], heartRate: [], cadence: [], elevation: [], sessions: [], ...over });

describe('shaping health data', () => {
  it('draws long periods as weeks, averaging only the days with readings', () => {
    const days = Array.from({ length: 90 }, (_, i) => daysAgo(89 - i));
    const daily = new Map<string, number>([[days[89]!, 10_000], [days[88]!, 6_000]]);
    const weeks = periodPoints(daily, days);
    expect(weeks).toHaveLength(13);
    expect(weeks[12]).toMatchObject({ value: 8_000, covered: 2, span: 7 });
    expect(weeks[0]!.value).toBeNull();
    expect(periodPoints(daily, days.slice(-28))).toHaveLength(28);
  });

  it("keeps each day's lowest, highest and average heart rate, and when they happened", () => {
    const t0 = Date.parse(`${today}T06:00:00Z`);
    const r = dailyRanges([60, 140, 80].map((value, i) => ({ id: `${i}`, type: 'heart_rate' as const, value, start: t0 + i * 3_600_000, end: t0 + i * 3_600_000, sourceId: 'watch', sourceKind: 'watch' as never })), 0).get(today)!;
    expect(r).toMatchObject({ min: 60, max: 140, avg: 280 / 3, n: 3, maxAt: t0 + 3_600_000 });
    expect(weeklyRanges(new Map([[today, r]]), [today])[0]!.range!.max).toBe(140);
  });

  it('summarises nights: average asleep, stages, and bedtimes either side of midnight', () => {
    const night = (k: string, bed: string, stages: Record<string, number> | null) => ({
      night: k, sourceId: 'watch', asleepMs: 7 * 3_600_000, inBedMs: null, stagesMs: stages,
      start: Date.parse(`${bed}Z`), end: Date.parse(`${k}T07:00:00Z`)
    });
    const s = sleepSummary([
      night('2026-11-02', '2026-11-01T23:30:00', { deep: 90 * 60_000, light: 240 * 60_000, rem: 90 * 60_000, awake: 0 }),
      night('2026-11-03', '2026-11-03T00:30:00', null)
    ], new Set(['2026-11-02', '2026-11-03']), 0);
    expect(s.nights).toBe(2);
    expect(fmtHoursMinutes(s.avgAsleepMs! / 60_000)).toBe('7 h');
    expect(fmtClock(s.bedtime!)).toBe('00:00');
    expect(s.stages).toMatchObject({ deep: 90, light: 240, rem: 90 });
    expect(s.stageNights).toBe(1);
  });

  it('finds the middle half of a set of readings', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe('each metric has its own screen, and none lists every day', () => {
  const layout = async () => {
    // Charts measure their width before drawing.
    for (const el of screen.queryAllByRole('image')) {
      await act(async () => {
        fireEvent(el, 'layout', { nativeEvent: { layout: { width: 340, height: 200, x: 0, y: 0 } } });
      });
    }
  };

  it('steps: the daily average leads, with columns and the best day', async () => {
    mockType.current = 'steps';
    mockDerived.current = derived({ steps: [{ day: today, value: 6412, coveredHours: 10, sourceIds: ['phone'] }, { day: daysAgo(3), value: 12_840, coveredHours: 16, sourceIds: ['phone'] }] });
    await render(<MetricDetail />);
    await layout();
    expect(screen.getByText('steps a day')).toBeTruthy();
    expect(screen.getByText('Today so far: 6,412 steps')).toBeTruthy();
    expect(screen.getByText('Best day')).toBeTruthy();
    expect(screen.queryByText('no data')).toBeNull();
    expect(screen.queryByText(/^Day$/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Show the numbers' }));
    expect(screen.getAllByText(/6,412|12,840/).length).toBeGreaterThan(1);
  });

  it('active calories: a total and a calendar', async () => {
    mockType.current = 'calories';
    mockDerived.current = derived({ energy: [{ day: daysAgo(1), value: 420, coveredHours: 14, sourceIds: ['watch'] }, { day: daysAgo(2), value: 180, coveredHours: 14, sourceIds: ['watch'] }] });
    await render(<MetricDetail />);
    await layout();
    expect(screen.getByText('kcal in 28 days')).toBeTruthy();
    expect(screen.getByText('Most active day')).toBeTruthy();
    expect(screen.getByText('Tap a day to see its value.')).toBeTruthy();
  });

  it('heart rate: the average leads, with each day as a range', async () => {
    mockType.current = 'heart_rate';
    const t0 = Date.now() - 2 * 3_600_000;
    mockDerived.current = derived({ heartRate: [58, 74, 151].map((value, i) => ({ id: `${i}`, type: 'heart_rate', value, start: t0 + i * 60_000, end: t0 + i * 60_000, sourceId: 'watch' })) });
    await render(<MetricDetail />);
    await layout();
    expect(screen.getByText('bpm on average')).toBeTruthy();
    expect(screen.getByText('Lowest reading')).toBeTruthy();
    expect(screen.getByText('Highest reading')).toBeTruthy();
    expect(screen.getByText('Tap a day to see its lowest, average and highest.')).toBeTruthy();
  });

  it('says plainly when a period has no readings, and where they come from', async () => {
    mockType.current = 'heart_rate';
    mockDerived.current = derived();
    await render(<MetricDetail />);
    expect(screen.getByText('No heart rate in the last 28 days')).toBeTruthy();
    expect(screen.getByText(/Heart rate comes from a watch or band/)).toBeTruthy();
    expect(screen.queryByText('no data')).toBeNull();
  });
});
