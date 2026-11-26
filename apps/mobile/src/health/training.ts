import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  canonicalSessions,
  compareEffort,
  earlierEfforts,
  racePredictions,
  runEffort,
  timeInZones,
  trainingLoad,
  TRAINING_RULES,
  type Effort,
  type FirstPartyRun,
  type HealthStore,
  type QuantitySample,
  type RacePrediction,
  type TrainingRun,
  type TrainingSummary,
  type ZoneConfig
} from '@loopfield/core';
import { useAppConfig } from '@/lib/appConfig';
import { useNow } from '@/lib/useNow';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';
import { getZoneConfig } from './cache';
import { deviceOffsetMin, quantities, useHealthStore } from './useHealth';

/**
 * Training load, effort and race predictions on the phone (R2). Built from the runner's own runs (their
 * server summaries, which the runner owns) and imported runs from Apple Health or Health Connect, with heart
 * rate from the health store. Nothing here is uploaded: heart rate, efforts, loads and predictions stay on the
 * phone. Late heart rate (a watch syncing after the run) simply updates the numbers when the store refreshes.
 * The back office can hide all of it by adding `training` to the suspended health cards.
 */
export const TRAINING_CARD = 'training';
/** Days of runs read: twelve weeks shown plus six weeks for the 6-week load to build up. */
export const TRAINING_DAYS = 126;

export interface TrainingActivity {
  id: string;
  started_at: string;
  ended_at: string | null;
  distance_m: number | null;
  moving_ms: number | null;
  elapsed_ms: number | null;
  perceived_effort: number | null;
}

export function useTrainingEnabled(): boolean {
  return !useAppConfig().settings.disabledHealthCards.includes(TRAINING_CARD);
}

export function useTrainingActivities(enabled = true) {
  const { userId } = useSession();
  return useQuery({
    queryKey: ['training-activities', userId],
    enabled: Boolean(userId) && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<TrainingActivity[]> => {
      const since = new Date(Date.now() - TRAINING_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase()
        .from('activities')
        .select('id, started_at, ended_at, distance_m, moving_ms, elapsed_ms, perceived_effort')
        .gte('started_at', since)
        .is('deleted_at', null)
        .order('started_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as TrainingActivity[];
    }
  });
}

/** Time in zones for a run, when heart rate covers enough of it (otherwise the effort is estimated). */
export function zonesFor(hr: readonly QuantitySample[], start: number, end: number, zones: ZoneConfig | null): number[] | null {
  if (!zones || end <= start) return null;
  const z = timeInZones(hr, start, end, zones);
  const covered = end - start - z.uncoveredMs;
  return covered / (end - start) >= TRAINING_RULES.minHrCoverage ? z.msInZone : null;
}

/** Every run the training numbers use: the runner's own and imported ones, without duplicates. */
export function buildTrainingRuns(activities: readonly TrainingActivity[], store: HealthStore, zones: ZoneConfig | null): TrainingRun[] {
  const hr = quantities(store, 'heart_rate');
  const own: TrainingRun[] = activities.map((a) => {
    const start = Date.parse(a.started_at);
    const end = a.ended_at ? Date.parse(a.ended_at) : start + (a.elapsed_ms ?? 0);
    return {
      id: a.id,
      start,
      durationMs: a.moving_ms ?? a.elapsed_ms ?? Math.max(0, end - start),
      distanceM: a.distance_m,
      zoneMs: zonesFor(hr, start, end, zones),
      feel: a.perceived_effort,
      imported: false
    };
  });
  const firstParty: FirstPartyRun[] = activities.map((a) => ({ activityId: a.id, start: Date.parse(a.started_at), end: a.ended_at ? Date.parse(a.ended_at) : Date.parse(a.started_at), distanceM: Number(a.distance_m ?? 0) }));
  const imported: TrainingRun[] = canonicalSessions([...store.workout.values()], firstParty)
    .filter((s) => s.imported && !s.firstPartyActivityId && s.activity === 'running')
    .map((s) => ({ id: s.id, start: s.start, durationMs: Math.max(0, s.end - s.start), distanceM: s.distanceM, zoneMs: zonesFor(hr, s.start, s.end, zones), feel: null, imported: true }));
  return [...own, ...imported].sort((a, b) => a.start - b.start);
}

export interface TrainingData {
  enabled: boolean;
  loading: boolean;
  error: unknown;
  runs: TrainingRun[];
  summary: TrainingSummary | null;
  predictions: RacePrediction[];
  zones: ZoneConfig | null;
}

export function useTraining(): TrainingData {
  const enabled = useTrainingEnabled();
  const store = useHealthStore();
  const activities = useTrainingActivities(enabled);
  const now = useNow(5 * 60_000);
  return useMemo(() => {
    const zones = getZoneConfig();
    if (!enabled || !activities.data) return { enabled, loading: enabled && activities.isLoading, error: activities.error, runs: [], summary: null, predictions: [], zones };
    const runs = buildTrainingRuns(activities.data, store, zones);
    return { enabled, loading: false, error: null, runs, summary: trainingLoad(runs, now, deviceOffsetMin()), predictions: racePredictions(runs, now), zones };
  }, [enabled, store, activities.data, activities.isLoading, activities.error, now]);
}

export interface RunEffort extends Effort {
  word: 'lighter' | 'usual' | 'harder' | null;
}

/** One run's effort and how it compares with the eight weeks before it; null while loading or hidden. */
export function useRunEffort(runId: string | null | undefined, fallback?: { start: number; durationMs: number; distanceM: number } | null): RunEffort | null {
  const t = useTraining();
  return useMemo(() => {
    if (!t.enabled || !runId || t.loading) return null;
    let run = t.runs.find((r) => r.id === runId) ?? null;
    if (!run && fallback) run = { id: runId, start: fallback.start, durationMs: fallback.durationMs, distanceM: fallback.distanceM, zoneMs: null, feel: null, imported: false };
    if (!run) return null;
    const e = runEffort(run);
    return { ...e, word: compareEffort(e.score, earlierEfforts(run, t.runs)) };
  }, [t, runId, fallback]);
}

/** "Effort 142 · harder than usual", with how it was worked out. */
export function effortText(e: RunEffort): { value: string; detail: string } {
  const word = e.word === 'lighter' ? 'lighter than usual' : e.word === 'harder' ? 'harder than usual' : e.word === 'usual' ? 'about usual' : null;
  const basis = e.basis === 'heart_rate' ? 'From your heart-rate zones' : e.basis === 'feel' ? 'Estimated from how it felt' : 'Estimated as a moderate run (no heart rate or rating)';
  return { value: word ? `${e.score} · ${word}` : String(e.score), detail: basis };
}
