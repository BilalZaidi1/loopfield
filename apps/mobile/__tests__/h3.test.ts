import { latLngToCell } from 'h3-js';
import { bigintCellToH3, boundsArea, cellsToFeatures, MAX_VIEWPORT_DEG2, roundBounds, summarizeCells, type ViewportCell } from '@/territory/h3';

const palette = { mine: '#00AA00', unavailable: '#777777', rivalHues: ['#123456', '#654321'] };
const cell = (lat: number, lng: number) => latLngToCell(lat, lng, 11);

describe('territory rendering helpers (display only, never ownership)', () => {
  const cells: ViewportCell[] = [
    { cell: cell(24.9, 67.05), status: 'controlled', controller_key: 'me', controller_handle: 'me', controller_name: 'Me', is_me: true },
    { cell: cell(24.901, 67.05), status: 'controlled', controller_key: 'abc', controller_handle: 'other', controller_name: 'Other', is_me: false },
    { cell: cell(24.902, 67.05), status: 'controlled', controller_key: 'abc', controller_handle: 'other', controller_name: 'Other', is_me: false },
    { cell: cell(24.903, 67.05), status: 'excluded', controller_key: null, controller_handle: null, controller_name: null, is_me: false },
    { cell: 'not-a-cell', status: 'controlled', controller_key: 'x', controller_handle: null, controller_name: null, is_me: false }
  ];

  it('builds closed polygons in lng/lat order and skips invalid cells', () => {
    const fc = cellsToFeatures(cells, palette);
    expect(fc.features).toHaveLength(4);
    const ring = (fc.features[0]!.geometry as GeoJSON.Polygon).coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0]![0]).toBeGreaterThan(60); // longitude first
    expect(fc.features[0]!.properties!.color).toBe(palette.mine);
    expect(fc.features[3]!.properties!.color).toBe(palette.unavailable);
  });

  it('summarizes the view for the accessible text alternative', () => {
    const s = summarizeCells(cells);
    expect(s.mine).toBe(1);
    expect(s.others).toBe(3);
    expect(s.unavailable).toBe(1);
    expect(s.topControllers[0]).toEqual({ key: 'abc', name: 'Other', handle: 'other', cells: 2, mine: false });
  });

  it('converts bigint-as-text exploration cells without precision loss', () => {
    const h = cell(24.9, 67.05);
    expect(bigintCellToH3(BigInt(`0x${h}`).toString())).toBe(h);
  });

  it('rounds viewports outward and flags oversized boxes like the server guard', () => {
    const b = roundBounds({ minLng: 67.0512, minLat: 24.8899, maxLng: 67.0611, maxLat: 24.9001 });
    expect(b.minLng).toBeLessThanOrEqual(67.0512);
    expect(b.maxLat).toBeGreaterThanOrEqual(24.9001);
    expect(boundsArea({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 }) > MAX_VIEWPORT_DEG2).toBe(true);
  });
});

describe('map drawing helpers', () => {
  const { gridFeatures, boundsAround, resolutionOf } = require('@/territory/h3') as typeof import('@/territory/h3');
  it('outlines the visible grid for small views and skips views that would need too many cells', () => {
    const small = gridFeatures(boundsAround([67.05, 24.89], 0.002, 0.002), 11);
    expect(small?.features.length).toBeGreaterThan(5);
    expect(small?.features[0]!.geometry.type).toBe('LineString');
    expect(gridFeatures(boundsAround([67.05, 24.89], 0.2, 0.2), 11)).toBeNull();
  });
  it('summarises a fixed area around a point when no map can be drawn', () => {
    const b = boundsAround([67.05, 24.89]);
    expect(b.maxLng - b.minLng).toBeCloseTo(0.024);
    expect(b.maxLat - b.minLat).toBeCloseTo(0.018);
  });
  it('reads the grid resolution from published cells', () => {
    const { latLngToCell } = require('h3-js') as typeof import('h3-js');
    expect(resolutionOf([{ cell: latLngToCell(24.89, 67.05, 10) }], 11)).toBe(10);
    expect(resolutionOf([], 11)).toBe(11);
  });
});
