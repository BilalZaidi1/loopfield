import { render, screen } from '@testing-library/react-native';
import { latLngToCell } from 'h3-js';
import { destination, encodePolyline } from '@loopfield/core';
import { buildSketch } from '@/features/share/sketch';
import { qrPath } from '@/features/share/qr';
import { landLine } from '@/features/share/RouteSketch';
import { ShareCard, type CardContent } from '@/features/share/ShareCard';

jest.mock('@/state/session', () => ({ useSession: () => ({ userId: null }), useUnits: () => 'metric' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

const start = { lat: 24.86, lng: 67.02 };
const route = encodePolyline(Array.from({ length: 16 }, (_, i) => destination(start, i * 100, 45)));
const cell = (m: number) => BigInt(`0x${latLngToCell(destination(start, m, 45).lat, destination(start, m, 45).lng, 11)}`).toString();

describe('route sketch', () => {
  it('fits the route in the box with start and finish at its visible ends', () => {
    const s = buildSketch({ route: [route] }, 320, 180, 16)!;
    expect(s.routes).toHaveLength(1);
    const [sx, sy] = s.start!;
    const [fx, fy] = s.finish!;
    expect(sx).toBeGreaterThanOrEqual(15);
    expect(fx).toBeLessThanOrEqual(305);
    expect(sy).toBeGreaterThan(fy); // north-east run: it finishes higher up the sketch
  });

  it('points the arrows along the direction of the run', () => {
    const s = buildSketch({ route: [route] }, 320, 180, 16)!;
    expect(s.arrows.length).toBeGreaterThan(0);
    for (const a of s.arrows) expect(a.angle).toBeLessThan(0); // up and to the right in screen space
  });

  it('separates the cells taken from other runners', () => {
    const cells = [cell(300), cell(700), cell(1100)];
    const s = buildSketch({ route: [route], cells, taken: [cells[1]!] }, 320, 180)!;
    expect(s.cells).toHaveLength(2);
    expect(s.taken).toHaveLength(1);
  });

  it('draws nothing without a route or land', () => {
    expect(buildSketch({ route: [], cells: [] }, 320, 180)).toBeNull();
  });
});

describe('share card pieces', () => {
  it('encodes a scannable QR as one path', () => {
    const q = qrPath('https://loopfield.expo.app/a/abcdefghijklmnopqrstuv');
    expect(q.size).toBeGreaterThanOrEqual(25);
    expect(q.d.startsWith('M')).toBe(true);
  });

  it('says what changed hands', () => {
    expect(landLine({ gained_cells: 20, kept_cells: 0, taken_cells: 10, rivals: 1, cell_count: 20 })).toBe('Captured 20 cells · 10 from 1 runner');
    expect(landLine({ gained_cells: 0, kept_cells: 12, taken_cells: 0, rivals: 0, cell_count: 12 })).toBe('Defended 12 cells');
    expect(landLine(null)).toBeNull();
  });

  const content: CardContent = {
    runnerName: 'Sana Iqbal', handle: 'sana_runs', date: '11 Nov 2026', distanceM: 8420, elapsedMs: 2_890_000, paceSecPerKm: 343,
    route: [route], land: null, achievements: ['Route title: Harbour loop'], avgHr: null, calories: null, link: null
  };

  it('shows the runner, the distance and the time, and no health data unless it was added', async () => {
    await render(<ShareCard format="9:16" content={content} units="metric" />);
    expect(screen.getByText('Sana Iqbal')).toBeTruthy();
    expect(screen.getByText('@sana_runs')).toBeTruthy();
    expect(screen.getByText('Time')).toBeTruthy();
    expect(screen.queryByText('Heart rate')).toBeNull();
    expect(screen.queryByText('Scan to see this run')).toBeNull();
  });

  it('adds heart rate (from the phone) and a QR code only when chosen', async () => {
    await render(<ShareCard format="9:16" content={{ ...content, avgHr: 152, link: 'https://loopfield.expo.app/a/abcdefghijklmnopqrstuv' }} units="metric" />);
    expect(screen.getByText('152 bpm')).toBeTruthy();
    expect(screen.getByText('Scan to see this run')).toBeTruthy();
  });

  it('keeps the shorter formats to one runner line and a corner QR code', async () => {
    await render(<ShareCard format="1:1" content={{ ...content, avgHr: 152, link: 'https://loopfield.expo.app/a/abcdefghijklmnopqrstuv' }} units="metric" />);
    expect(screen.getByText('@sana_runs · 11 Nov 2026')).toBeTruthy();
    expect(screen.queryByText('152 bpm')).toBeNull(); // square cards show time and pace only
    expect(screen.getByLabelText("QR code to this run's page")).toBeTruthy();
  });
});
