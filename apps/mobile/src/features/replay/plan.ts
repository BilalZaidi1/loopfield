import { useMemo } from 'react';
import { buildReplay, decodePolyline, type ReplayPlan, type Split } from '@loopfield/core';
import type { ActivityJson } from '@/features/results/useActivity';

const MILE = 1609.344;

/** The replay of a run from its own line and splits, worked out on the phone; null when the run has no line yet. */
export function useReplayPlan(a: ActivityJson | null | undefined, units: 'metric' | 'imperial'): ReplayPlan | null {
  const line = a?.personal_route ?? null;
  const splits: Split[] | null = a?.splits ?? null;
  return useMemo(() => (line ? buildReplay(decodePolyline(line), splits ?? [], { markerEveryM: units === 'imperial' ? MILE : 1000 }) : null), [line, splits, units]);
}
