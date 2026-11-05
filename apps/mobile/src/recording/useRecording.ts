import { useEffect, useRef, useState } from 'react';
import { closureHint, haversineMeters, summarizeActivity, TERRITORY_RULES, type ActivitySummary, type LocationSample } from '@loopfield/core';
import { emitCue } from '@/lib/cues';
import { activeSession, eventsFor, getSession, samplesFor, type SessionRow } from './db';

export interface LiveState {
  session: SessionRow | null;
  summary: ActivitySummary | null;
  last: LocationSample | null;
  gpsQuality: 'none' | 'weak' | 'good';
  gpsStaleSeconds: number | null;
  closure: 'not_started' | 'open' | 'possible_closure';
  captureDistanceM: number;
  path: [number, number][];
}

/**
 * UI view of the recording. This 1 s refresh only re-reads persisted samples for display; it is not
 * the sampling source (location events written by the background task are).
 */
export function useRecording(sessionId?: string, refreshMs = 1000): LiveState {
  const [state, setState] = useState<LiveState>({ session: null, summary: null, last: null, gpsQuality: 'none', gpsStaleSeconds: null, closure: 'not_started', captureDistanceM: 0, path: [] });
  const lastQuality = useRef<string>('none');
  useEffect(() => {
    const tick = () => {
      const session = sessionId ? getSession(sessionId) : activeSession();
      if (!session) return setState((s) => ({ ...s, session: null }));
      const samples = samplesFor(session.id);
      const events = eventsFor(session.id);
      const last = samples[samples.length - 1] ?? null;
      const stale = last ? (Date.now() - last.t) / 1000 : null;
      const quality = !last || (stale ?? 99) > 15 ? 'none' : (last.acc ?? 99) > TERRITORY_RULES.maxUsableAccuracyMeters.value ? 'weak' : 'good';
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
      setState({
        session,
        summary: summarizeActivity(samples, events),
        last,
        gpsQuality: quality,
        gpsStaleSeconds: stale,
        closure: session.capture_state === 'open' ? closureHint(capSamples[0] ?? null, last, capDist) : 'not_started',
        captureDistanceM: capDist,
        path: samples.filter((s) => (s.acc ?? 99) <= 50).map((s) => [s.lng, s.lat])
      });
    };
    tick();
    const id = setInterval(tick, refreshMs);
    return () => clearInterval(id);
  }, [sessionId, refreshMs]);
  return state;
}
