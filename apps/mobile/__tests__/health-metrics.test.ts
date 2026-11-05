jest.mock('@/health/useHealth', () => ({ deviceOffsetMin: () => 0 }));

import type { MethodSeries } from '@loopfield/core';
import { dailyValues } from '@/features/health/metrics';

const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const series = (method: string, pts: Array<[string, number]>): MethodSeries => ({ key: method, method, sourceId: 'src', points: pts.map(([d, v]) => ({ t: day(d), value: v })) });

function derived(over: Record<string, unknown> = {}) {
  return { steps: [], energy: [], nights: [], resting: [], hrv: [], vo2Series: [], heartRate: [], cadence: [], elevation: [], sessions: [], ...over } as never;
}

describe('on-device health metrics', () => {
  it('keeps HRV methods separate and never merges SDNN with RMSSD', () => {
    const d = derived({ hrv: [series('sdnn', [['2026-11-01', 50]]), series('rmssd', [['2026-11-01', 30]])] });
    expect(dailyValues('hrv_sdnn', d).get('2026-11-01')).toBe(50);
    expect(dailyValues('hrv_rmssd', d).get('2026-11-01')).toBe(30);
  });

  it('leaves days without readings absent rather than zero', () => {
    const d = derived({ steps: [{ day: '2026-11-01', value: 8000, coveredHours: 14, sourceIds: ['watch'] }, { day: '2026-11-03', value: 0, coveredHours: 2, sourceIds: ['phone'] }] });
    const m = dailyValues('steps', d);
    expect(m.get('2026-11-01')).toBe(8000);
    expect(m.has('2026-11-02')).toBe(false);
    expect(m.get('2026-11-03')).toBe(0);
  });

  it('reports sleep as hours asleep per night', () => {
    const d = derived({ nights: [{ night: '2026-11-02', sourceId: 'watch', asleepMs: 7.5 * 3_600_000, inBedMs: null, stagesMs: null, start: 0, end: 0 }] });
    expect(dailyValues('sleep', d).get('2026-11-02')).toBe(7.5);
  });
});
