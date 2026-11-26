import type { QuantitySample } from '../health/types.ts';
import type { ZoneConfig } from '../health/metrics.ts';

/**
 * Bluetooth heart-rate straps (R3). Any strap that uses the standard Heart Rate Service works: the measurement
 * characteristic (0x2A37) carries the heart rate (8 or 16 bits), whether the strap is touching the skin, and
 * optionally energy and RR intervals; the Battery Service gives the battery level (0x2A19). These functions read
 * the raw bytes, so they are tested with recorded packets. Readings stay on the phone, in the health cache, as
 * the app's own source, which outranks a watch for the same minutes.
 */
export const HR_SERVICE = '180d';
export const HR_MEASUREMENT = '2a37';
export const BATTERY_SERVICE = '180f';
export const BATTERY_LEVEL = '2a19';

/** The long (128-bit) form of a 16-bit Bluetooth UUID, as some phones report it. */
export function longUuid(short: string): string {
  return `0000${short.toLowerCase()}-0000-1000-8000-00805f9b34fb`;
}

/** True when a UUID, short or long and in any case, is the given 16-bit one. */
export function sameUuid(uuid: string, short: string): boolean {
  const u = uuid.toLowerCase();
  return u === short.toLowerCase() || u === longUuid(short);
}

export type SensorContact = 'detected' | 'not_detected' | 'unsupported';

export interface HeartRateMeasurement {
  bpm: number;
  contact: SensorContact;
  /** Energy expended since the strap last reset it, in kJ, when the strap sends it. */
  energyKj: number | null;
  /** RR intervals in milliseconds, when the strap sends them. */
  rrMs: number[];
}

/** Heart rates a strap can plausibly report; anything else is a glitch and is dropped. */
export const STRAP_RULES = {
  minBpm: 25,
  maxBpm: 240,
  /** At most one reading kept per this many milliseconds (straps send about one a second). */
  keepEveryMs: 1000,
  /** A strap's readings take the place of other sources' within this distance (ms), as timeInZones allows. */
  coverMs: 15_000
} as const;

/** Reads one Heart Rate Measurement notification. Null for a packet too short for what its flags announce. */
export function parseHeartRateMeasurement(bytes: ArrayLike<number>): HeartRateMeasurement | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0]! & 0xff;
  const wide = (flags & 0x01) !== 0;
  let i = 1;
  if (bytes.length < i + (wide ? 2 : 1)) return null;
  const bpm = wide ? (bytes[i]! & 0xff) | ((bytes[i + 1]! & 0xff) << 8) : bytes[i]! & 0xff;
  i += wide ? 2 : 1;
  const contact: SensorContact = (flags & 0x04) === 0 ? 'unsupported' : (flags & 0x02) !== 0 ? 'detected' : 'not_detected';
  let energyKj: number | null = null;
  if (flags & 0x08) {
    if (bytes.length < i + 2) return null;
    energyKj = (bytes[i]! & 0xff) | ((bytes[i + 1]! & 0xff) << 8);
    i += 2;
  }
  const rrMs: number[] = [];
  if (flags & 0x10) {
    for (; i + 1 < bytes.length; i += 2) rrMs.push(Math.round((((bytes[i]! & 0xff) | ((bytes[i + 1]! & 0xff) << 8)) * 1000) / 1024));
  }
  return { bpm, contact, energyKj, rrMs };
}

/** The heart rate to keep from a reading: none when the strap says it is off the skin or the value is implausible. */
export function usableBpm(m: HeartRateMeasurement | null): number | null {
  if (!m || m.contact === 'not_detected') return null;
  return m.bpm >= STRAP_RULES.minBpm && m.bpm <= STRAP_RULES.maxBpm ? m.bpm : null;
}

/** The Battery Level characteristic: 0–100 %, or null for anything else. */
export function parseBatteryLevel(bytes: ArrayLike<number>): number | null {
  if (bytes.length < 1) return null;
  const v = bytes[0]! & 0xff;
  return v <= 100 ? v : null;
}

/** The heart-rate zone (1 to 5) for a value, or null below zone 1 or without zones. */
export function zoneOf(bpm: number | null, zones: ZoneConfig | null): number | null {
  if (bpm == null || !zones) return null;
  for (let z = zones.lowerBounds.length - 1; z >= 0; z--) if (bpm >= zones.lowerBounds[z]!) return z + 1;
  return null;
}

/** A strap reading as a health-cache sample, owned by the app (`self`), so it outranks a watch. */
export function strapSample(t: number, bpm: number): QuantitySample {
  return { id: `strap:${t}`, type: 'heart_rate', value: bpm, start: t, end: t, sourceId: 'loopfield-strap', sourceKind: 'self', method: null, version: null };
}

/**
 * Heart rate with the strap first: where the app's own readings exist, other sources' readings within
 * `coverMs` of them are left out, so the same minutes are never counted from a watch and a strap at once.
 */
export function preferOwnHeartRate(samples: readonly QuantitySample[]): QuantitySample[] {
  const own = samples.filter((s) => s.sourceKind === 'self').map((s) => s.start).sort((a, b) => a - b);
  if (!own.length) return [...samples];
  const near = (t: number) => {
    let lo = 0;
    let hi = own.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (own[mid]! < t) lo = mid + 1;
      else hi = mid - 1;
    }
    const d1 = lo < own.length ? Math.abs(own[lo]! - t) : Infinity;
    const d2 = lo > 0 ? Math.abs(t - own[lo - 1]!) : Infinity;
    return Math.min(d1, d2) <= STRAP_RULES.coverMs;
  };
  return samples.filter((s) => s.sourceKind === 'self' || !near(s.start));
}
