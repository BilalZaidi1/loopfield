import { describe, expect, it } from 'vitest';
import { applyClaim, areaByUser, rankByArea, resolveControl, type LedgerClaim, type CellOwner } from '../src/territory/ledger.ts';

const cells = (prefix: string, n: number, offset = 0) => Array.from({ length: n }, (_, i) => `${prefix}${i + offset}`);
const hour = (h: number) => Date.UTC(2026, 10, 2, h);

describe('cell control ledger (FR13, FR30, FR31, Appendix A)', () => {
  it('transfers only the overlapping cells to a later loop (partial takeover)', () => {
    // A controls 100 cells (1 km² at 0.01 km²/cell); B's later loop covers 20 of them plus 10 new cells.
    const a: LedgerClaim = { id: 'claimA', userId: 'A', completedAt: hour(9), cells: cells('c', 100), eligible: true };
    const b: LedgerClaim = { id: 'claimB', userId: 'B', completedAt: hour(10), cells: [...cells('c', 20, 80), ...cells('n', 10)], eligible: true };
    const control = resolveControl([a, b]);
    const area = areaByUser(control, () => 10_000);
    const byUser = Object.fromEntries(area.map((e) => [e.userId, e.areaM2]));
    expect(byUser.A).toBe(800_000);
    expect(byUser.B).toBe(300_000);
  });

  it('decides by verified completion order, not upload order', () => {
    const a: LedgerClaim = { id: 'a', userId: 'A', completedAt: hour(9), cells: ['x', 'y'], eligible: true };
    const b: LedgerClaim = { id: 'b', userId: 'B', completedAt: hour(10), cells: ['y', 'z'], eligible: true };
    // Incremental, B uploaded first.
    const control = new Map<string, CellOwner>();
    applyClaim(control, b);
    const late = applyClaim(control, a);
    expect(late.unchanged).toEqual(['y']);
    expect(control.get('y')!.userId).toBe('B');
    expect(control.get('x')!.userId).toBe('A');
    // Full replay in any order gives identical control.
    const replayed = resolveControl([a, b]);
    expect([...replayed.entries()].map(([k, v]) => [k, v.userId]).sort()).toEqual([...control.entries()].map(([k, v]) => [k, v.userId]).sort());
  });

  it('reverts cells to the latest remaining eligible claim after invalidation', () => {
    const a: LedgerClaim = { id: 'a', userId: 'A', completedAt: hour(9), cells: ['x', 'y'], eligible: true };
    const b: LedgerClaim = { id: 'b', userId: 'B', completedAt: hour(10), cells: ['y', 'z'], eligible: false };
    const control = resolveControl([a, b]);
    expect(control.get('y')!.userId).toBe('A');
    expect(control.has('z')).toBe(false);
  });

  it('records a refreshed claim for the same runner without counting it as a gain', () => {
    const control = new Map<string, CellOwner>();
    applyClaim(control, { id: 'a1', userId: 'A', completedAt: hour(9), cells: ['x'], eligible: true });
    const r = applyClaim(control, { id: 'a2', userId: 'A', completedAt: hour(11), cells: ['x'], eligible: true });
    expect(r.refreshed).toEqual(['x']);
    expect(r.gained).toEqual([]);
  });

  it('breaks exact completion-time ties deterministically by claim id', () => {
    const t = hour(9);
    const c1 = resolveControl([
      { id: 'b', userId: 'B', completedAt: t, cells: ['x'], eligible: true },
      { id: 'a', userId: 'A', completedAt: t, cells: ['x'], eligible: true }
    ]);
    expect(c1.get('x')!.userId).toBe('B');
  });

  it('shares rank on exact ties', () => {
    const r = rankByArea([
      { userId: 'A', areaM2: 500 },
      { userId: 'B', areaM2: 500 },
      { userId: 'C', areaM2: 100 }
    ]);
    expect(r.map((e) => e.rank)).toEqual([1, 1, 3]);
  });
});
