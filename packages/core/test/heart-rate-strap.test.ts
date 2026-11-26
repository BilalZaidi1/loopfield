import { describe, expect, it } from 'vitest';
import {
  longUuid,
  parseBatteryLevel,
  parseHeartRateMeasurement,
  preferOwnHeartRate,
  sameUuid,
  strapSample,
  usableBpm,
  zoneOf,
  zonesFromMaxHr,
  type QuantitySample
} from '../src/index.ts';

/**
 * Packets are built to the Bluetooth Heart Rate Service specification, in the shapes common straps send (no
 * packets recorded from a real strap were available): flags first, then the heart rate, energy and RR intervals.
 */
describe('heart-rate strap packets', () => {
  it('reads an 8-bit heart rate with skin contact and RR intervals', () => {
    // flags 0x16: 8-bit value, contact supported and detected, RR intervals present
    expect(parseHeartRateMeasurement([0x16, 72, 0x2c, 0x03])).toEqual({ bpm: 72, contact: 'detected', energyKj: null, rrMs: [793] });
  });

  it('reads a 16-bit heart rate and a strap that cannot tell about contact', () => {
    expect(parseHeartRateMeasurement([0x01, 0xb4, 0x00])).toEqual({ bpm: 180, contact: 'unsupported', energyKj: null, rrMs: [] });
    expect(usableBpm(parseHeartRateMeasurement([0x00, 90]))).toBe(90);
  });

  it('skips the energy field to reach the RR intervals', () => {
    // flags 0x1e: 8-bit value, contact detected, energy present, RR present (two intervals)
    expect(parseHeartRateMeasurement([0x1e, 140, 0x05, 0x00, 0xb4, 0x01, 0xb8, 0x01])).toEqual({ bpm: 140, contact: 'detected', energyKj: 5, rrMs: [426, 430] });
  });

  it('keeps nothing when the strap is off the skin, the value is implausible, or the packet is cut short', () => {
    expect(usableBpm(parseHeartRateMeasurement([0x04, 0]))).toBeNull(); // contact supported, not detected
    expect(usableBpm(parseHeartRateMeasurement([0x06, 0]))).toBeNull(); // on the skin but 0 bpm
    expect(usableBpm(parseHeartRateMeasurement([0x01, 0x2c, 0x01]))).toBeNull(); // 300 bpm
    expect(parseHeartRateMeasurement([0x01, 0x50])).toBeNull(); // 16-bit announced, one byte sent
    expect(parseHeartRateMeasurement([0x08, 80, 0x01])).toBeNull(); // energy announced, one byte sent
    expect(parseHeartRateMeasurement([0x00])).toBeNull();
  });

  it('reads the battery level and matches short and long UUIDs', () => {
    expect(parseBatteryLevel([87])).toBe(87);
    expect(parseBatteryLevel([0xff])).toBeNull();
    expect(parseBatteryLevel([])).toBeNull();
    expect(sameUuid('0000180D-0000-1000-8000-00805F9B34FB', '180d')).toBe(true);
    expect(sameUuid('180D', '180d')).toBe(true);
    expect(sameUuid(longUuid('180f'), '180d')).toBe(false);
  });

  it('names the zone for a live value', () => {
    const zones = zonesFromMaxHr(190, 1); // lower bounds at 50–90 % of 190
    expect([zoneOf(80, zones), zoneOf(100, zones), zoneOf(163, zones), zoneOf(175, zones)]).toEqual([null, 1, 4, 5]);
    expect(zoneOf(150, null)).toBeNull();
    expect(zoneOf(null, zones)).toBeNull();
  });
});

describe('the strap first', () => {
  const watch = (t: number, value: number): QuantitySample => ({ id: `w${t}`, type: 'heart_rate', value, start: t, end: t, sourceId: 'watch', sourceKind: 'watch' });

  it('keeps the strap where it has readings and the watch where it has none', () => {
    const strap = [0, 1000, 2000, 3000].map((t) => strapSample(t, 150));
    const watchRun = [0, 5000, 10_000, 40_000, 60_000].map((t) => watch(t, 140));
    const kept = preferOwnHeartRate([...watchRun, ...strap]);
    // The watch at 0, 5 s and 10 s is within 15 s of the strap; at 40 s and 60 s it fills the strap's gap.
    expect(kept.filter((s) => s.sourceKind === 'watch').map((s) => s.start)).toEqual([40_000, 60_000]);
    expect(kept.filter((s) => s.sourceKind === 'self')).toHaveLength(4);
    expect(strap[0]).toEqual(expect.objectContaining({ sourceKind: 'self', type: 'heart_rate', value: 150 }));
  });

  it('changes nothing without strap readings', () => {
    const only = [watch(0, 120), watch(5000, 125)];
    expect(preferOwnHeartRate(only)).toEqual(only);
  });
});
