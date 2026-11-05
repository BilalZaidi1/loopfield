import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  canonicalSessions,
  dailyCumulative,
  latestBySource,
  seriesByMethod,
  sleepNights,
  type FirstPartyRun,
  type HealthStore,
  type QuantitySample
} from '@loopfield/core';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';
import { getConnection, loadStore, type ConnectionState } from './cache';
import { HEALTH_PLATFORM, healthVersion, onHealthChange } from './sync';

export function useHealthVersion(): number {
  const [v, setV] = useState(healthVersion());
  useEffect(() => onHealthChange(() => setV(healthVersion())), []);
  return v;
}

export function useHealthConnection(): ConnectionState {
  const v = useHealthVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getConnection(HEALTH_PLATFORM), [v]);
}

/** Device-local store snapshot; recomputed only when a sync or clear changes it. */
export function useHealthStore(): HealthStore {
  const v = useHealthVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => loadStore(), [v]);
}

export const deviceOffsetMin = () => -new Date().getTimezoneOffset();

export function quantities(store: HealthStore, type: QuantitySample['type']): QuantitySample[] {
  return [...store.quantity.values()].filter((q) => q.type === type);
}

/** First-party runs (server summaries the runner owns) used only on-device for duplicate resolution. */
export function useFirstPartyRuns(days = 90) {
  const { userId } = useSession();
  return useQuery({
    queryKey: ['first-party-runs', userId, days],
    enabled: Boolean(userId),
    queryFn: async (): Promise<FirstPartyRun[]> => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase()
        .from('activities')
        .select('id, started_at, ended_at, distance_m')
        .gte('started_at', since)
        .is('deleted_at', null)
        .order('started_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((a) => ({ activityId: a.id as string, start: Date.parse(a.started_at as string), end: Date.parse(a.ended_at as string), distanceM: Number(a.distance_m ?? 0) }));
    }
  });
}

export function useHealthDerived() {
  const store = useHealthStore();
  const runs = useFirstPartyRuns();
  return useMemo(() => {
    const offset = deviceOffsetMin();
    const steps = dailyCumulative(quantities(store, 'steps'), offset);
    const energy = dailyCumulative(quantities(store, 'active_energy'), offset);
    const nights = sleepNights([...store.sleep.values()], offset);
    const sessions = canonicalSessions([...store.workout.values()], runs.data ?? []);
    return {
      store,
      steps,
      energy,
      nights,
      sessions,
      heartRate: quantities(store, 'heart_rate'),
      resting: seriesByMethod(quantities(store, 'resting_heart_rate'), 'resting_heart_rate'),
      hrv: seriesByMethod(quantities(store, 'hrv'), 'hrv'),
      vo2: latestBySource(quantities(store, 'vo2_max'), 'vo2_max'),
      vo2Series: seriesByMethod(quantities(store, 'vo2_max'), 'vo2_max'),
      cadence: quantities(store, 'cadence'),
      elevation: dailyCumulative(quantities(store, 'elevation_gain'), offset),
      runsLoading: runs.isLoading
    };
  }, [store, runs.data, runs.isLoading]);
}
