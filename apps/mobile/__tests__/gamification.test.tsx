import { fireEvent, render, screen } from '@testing-library/react-native';
import { latLngToCell } from 'h3-js';
import { BarChart } from '@/components/charts';
import { Button } from '@/components/ui';
import { RankingExplainer } from '@/features/achievements/Badges';
import { progressText } from '@/features/achievements/api';
import { groupLost, type LostCell } from '@/features/movement/api';
import { ReclaimReceipt } from '@/features/movement/Reclaim';
import { fmtCount } from '@/lib/format';
import { cellPolygon, cellsToFeatures, lostToFeatures, resolutionOf, type ViewportCell } from '@/territory/h3';

jest.mock('@/state/session', () => ({ useSession: () => ({ userId: null }), useUnits: () => 'metric' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

/** Host views carrying an explicit width (the arrow button's two equal slots). */
function widths(node: unknown, out: number[] = []): number[] {
  const n = node as { type?: string; props?: { style?: unknown }; children?: unknown[] } | null;
  if (!n || typeof n !== 'object') return out;
  const flat = ([] as unknown[]).concat(n.props?.style ?? []).flat(4) as Array<{ width?: number } | null>;
  const w = flat.reduce<number | undefined>((acc, s) => (s && typeof s.width === 'number' ? s.width : acc), undefined);
  if (n.type === 'View' && w !== undefined) out.push(w);
  for (const c of n.children ?? []) widths(c, out);
  return out;
}

describe('onboarding buttons', () => {
  it('reserves an equal slot on both sides of an arrow button, so the label sits on the centre line', async () => {
    await render(<Button label="Next" size="lg" arrow onPress={() => {}} />);
    const w = widths(screen.toJSON());
    expect(w.filter((x) => x === 46)).toHaveLength(2); // 58 high: 46 px left slot and 46 px arrow
  });
});

describe('chart numbers view', () => {
  it('names each period in full, adds the comparison column, marks the current period and totals', async () => {
    await render(
      <BarChart
        title="Distance per day this week"
        unit="km"
        data={[{ label: 'M', long: 'Mon', value: 1.2 }, { label: 'T', long: 'Tue', value: 0.4, current: true }, { label: 'W', long: 'Wed', value: null }]}
        compare={[0.5, null, 2]}
        format={(v) => v.toFixed(1)}
        table={{ period: 'Day', series: 'This week', compareSeries: 'Last week', currentTag: 'Today', total: true }}
      />
    );
    await fireEvent.press(screen.getByRole('button', { name: /^Show numbers/ }));
    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByLabelText('Tue: 0.4 km, Last week no data, Today')).toBeTruthy();
    expect(screen.getByLabelText('Wed: no data, Last week 2.0 km')).toBeTruthy();
    expect(screen.getByLabelText('Total: 1.6 km, Last week 2.5 km')).toBeTruthy();
  });
});

describe('map cells from the server', () => {
  const h = latLngToCell(24.9, 67.05, 11);
  const decimal = BigInt(`0x${h}`).toString();

  it('draws cells sent as decimal ids (how the server stores them) and keeps the server id for taps', () => {
    const cells: ViewportCell[] = [{ cell: decimal, status: 'controlled', controller_key: 'k', controller_handle: null, controller_name: null, is_me: false }];
    const fc = cellsToFeatures(cells, { mine: '#000', unavailable: '#777', rivalHues: ['#123'] });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties!.cell).toBe(decimal);
    expect(cellPolygon(decimal)).not.toBeNull();
    expect(resolutionOf(cells, 9)).toBe(11);
  });

  it('marks lost cells as reclaimable or not, and selected ones', () => {
    const other = BigInt(`0x${latLngToCell(24.901, 67.05, 11)}`).toString();
    const fc = lostToFeatures([{ cell: decimal, reclaimable: true }, { cell: other, reclaimable: false }], new Set([decimal]));
    expect(fc.features.map((f) => [f.properties!.reclaimable, f.properties!.selected])).toEqual([[true, true], [false, false]]);
  });
});

describe('reclaiming', () => {
  const cell = (n: number, key: string, on: string, reclaimable = true): LostCell => ({
    cell: String(n), controller_key: key, controller_name: key === 'a' ? 'Sara' : 'Omar', lost_on: on, reclaimable, blocked_reason: reclaimable ? null : 'taken_with_points', cost: 3
  });

  it('groups lost cells by who took them and when, newest first', () => {
    const g = groupLost([cell(1, 'a', '2026-11-03'), cell(2, 'a', '2026-11-03'), cell(3, 'b', '2026-11-05', false), cell(4, 'a', '2026-11-01')]);
    expect(g.map((x) => [x.name, x.lostOn, x.cells.length, x.reclaimable.length])).toEqual([
      ['Omar', '2026-11-05', 1, 0],
      ['Sara', '2026-11-03', 2, 2],
      ['Sara', '2026-11-01', 1, 1]
    ]);
  });

  it('shows the full receipt before anything is spent', async () => {
    await render(<ReclaimReceipt cells={4} costPerCell={3} total={12} balance={388} remaining={376} />);
    expect(screen.getByLabelText('Selected: 4 cells')).toBeTruthy();
    expect(screen.getByLabelText('Cost per cell: 3 points')).toBeTruthy();
    expect(screen.getByLabelText('Total: 12 points')).toBeTruthy();
    expect(screen.getByLabelText('Your balance: 388 points')).toBeTruthy();
    expect(screen.getByLabelText('After reclaiming: 376 points')).toBeTruthy();
  });
});

describe('achievements', () => {
  it('explains my score with the published formula: tier points plus a bonus per category', async () => {
    await render(
      <RankingExplainer
        rules={{ tierPoints: { bronze: 10, silver: 25, gold: 60, platinum: 150 }, categoryBonus: 25 }}
        badges={[
          { id: 'distance_10', tier: 'bronze', category: 'distance', title: 'First ten', completed_on: '2026-11-01' },
          { id: 'distance_50', tier: 'silver', category: 'distance', title: 'Half century', completed_on: '2026-11-02' },
          { id: 'capture_25', tier: 'bronze', category: 'territory', title: 'Stake a claim', completed_on: '2026-11-03' }
        ]}
      />
    );
    expect(screen.getByText('45')).toBeTruthy(); // 10 + 25 + 10
    expect(screen.getByText('50')).toBeTruthy(); // 2 categories × 25
    expect(screen.getByText('95')).toBeTruthy();
    expect(screen.getByText(/Movement points never count/)).toBeTruthy();
  });

  it('states progress in the challenge unit and never beyond the target', () => {
    expect(progressText({ progress: 37.24, target: 50, unit: 'km' })).toBe('37.2 of 50.0 km');
    expect(progressText({ progress: 312.7, target: 250, unit: 'km' })).toBe('250 of 250 km');
    expect(progressText({ progress: 3, target: 4, unit: 'weeks' })).toBe('3 of 4 weeks');
  });

  it('keeps counts short enough for their column', () => {
    expect(fmtCount(0)).toBe('0');
    expect(fmtCount(9_999)).toBe((9_999).toLocaleString());
    expect(fmtCount(12_345)).toBe('12.3k');
    expect(fmtCount(250_000)).toBe('250k');
  });
});
