import { useEffect, useRef, useState } from 'react';
import { closureHint, haversineMeters, summarizeActivity, type ActivitySummary, type LocationSample, type RecordingEvent } from '@loopfield/core';
import { useTerritoryRules } from '@/lib/gameRules';
import { emitCue } from '@/lib/cues';
import { activeSession, eventsFor, getSession, samplesAfter, type SessionRow } from './db';

export interface LiveState {
  session: SessionRow | null;
  summary: ActivitySummary | null;
  last: LocationSample | null;
  gpsQuality: 'none' | 'weak' | 'good';
  gpsStaleSeconds: number | null;
  closure: 'not_started' | 'open' | 'possible_closure';
  captureDistanceM: number;
  /** Display path: fixes good enough to draw (≤ 50 m accuracy), thinned to one point every few metres. */
  path: [number, number][];
  /** Where the loop capture started, for the closing hint on the map. */
  captureStart: [number, number] | null;
  events: RecordingEvent[];
}

/** Minimum spacing between drawn points: enough for a smooth line, far fewer points to send to the map. */
const DRAW_SPACING_M = 3;

const EMPTY: LiveState = { session: null, summary: null, last: null, gpsQuality: 'none', gpsStaleSeconds: null, closure: 'not_started', captureDistanceM: 0, path: [], captureStart: null, events: [] };

/**
 * UI view of the recording. This 1 s refresh only re-reads persisted samples for display; it is not
 * the sampling source (location events written by the background task are). Only samples added since the
 * last refresh are read, and the drawn path is thinned, so long runs stay cheap to display.
 */
export function useRecording(sessionId?: string, refreshMs = 1000): LiveState {
  const [state, setState] = useState<LiveState>(EMPTY);
  // The season's rules from the back office; read through a ref so the refresh interval keeps running.
  const rules = useTerritoryRules();
  const rulesRef = useRef(rules);
  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);
  const lastQuality = useRef<string>('none');
  const cache = useRef<{ id: string; samples: LocationSample[]; path: [number, number][]; lastSeq: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const session = sessionId ? getSession(sessionId) : activeSession();
      if (!session) {
        cache.current = null;
        return setState((s) => (s.session ? EMPTY : s));
      }
      if (cache.current?.id !== session.id) cache.current = { id: session.id, samples: [], path: [], lastSeq: -1 };
      const c = cache.current;
      const fresh = samplesAfter(session.id, c.lastSeq);
      let pathChanged = false;
      for (const s of fresh) {
        c.samples.push(s);
        c.lastSeq = s.seq;
        if ((s.acc ?? 99) > 50) continue;
        const prev = c.path[c.path.length - 1];
        if (!prev || haversineMeters({ lat: prev[1], lng: prev[0] }, s) >= DRAW_SPACING_M) {
          c.path.push([s.lng, s.lat]);
          pathChanged = true;
        }
      }
      const samples = c.samples;
      const events = eventsFor(session.id);
      const last = samples[samples.length - 1] ?? null;
      const stale = last ? (Date.now() - last.t) / 1000 : null;
      const quality = !last || (stale ?? 99) > 15 ? 'none' : (last.acc ?? 99) > rulesRef.current.maxUsableAccuracyMeters.value ? 'weak' : 'good';
      if (session.state === 'recording' && quality !== lastQuality.current) {
        if (quality === 'weak') emitCue('gps_weak', 'GPS signal is weak');
        else if (quality === 'none' && lastQuality.current !== 'none') emitCue('gap', 'No GPS fixes. This gap will be shown, not filled in.');
        else if (quality === 'good' && lastQuality.current !== 'good') emitCue('gps_restored', 'GPS signal is good');
        lastQuality.current = quality;
      }
      const captureStart = events.find((e) => e.kind === 'capture_start');
      const capSamples = captureStart ? samples.filter((s) => s.t >= captureStart.t) : [];
      let capDist = 0;
      for (let i = 1; i < capSamples.length; i++) capDist += haversineMeters(capSamples[i - 1]!, capSamples[i]!);
      const first = capSamples[0];
      setState((prev) => ({
        session,
        summary: summarizeActivity(samples, events),
        last,
        gpsQuality: quality,
        gpsStaleSeconds: stale,
        closure: session.capture_state === 'open' ? closureHint(first ?? null, last, capDist, rulesRef.current) : 'not_started',
        captureDistanceM: capDist,
        // A new array only when the drawn line changed, so the map re-renders only then.
        path: pathChanged || prev.session?.id !== session.id ? [...c.path] : prev.path,
        captureStart: first ? [first.lng, first.lat] : null,
        events
      }));
    };
    tick();
    const id = setInterval(tick, refreshMs);
    return () => clearInterval(id);
  }, [sessionId, refreshMs]);
  return state;
}
