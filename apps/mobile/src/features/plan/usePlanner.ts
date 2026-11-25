import { useCallback, useMemo, useRef, useState } from 'react';
import {
  EMPTY_PLAN,
  PLAN_LIMITS,
  appendPoint,
  closingPoint,
  decodePolyline,
  isLoopPath,
  outAndBackPlan,
  pathLengthMeters,
  planPath,
  planSnapped,
  removeLastPoint,
  reversePlan,
  straightLeg,
  type LatLng,
  type PlanLeg,
  type PlanState
} from '@loopfield/core';
import { ApiError } from '@/lib/api';
import { snapLeg, straightLegNote } from './api';

/** A saved route opened for editing: one straight leg per stretch between its points (simplified to taps). */
export function planFromLine(line: LatLng[], snapped: boolean): PlanState {
  if (line.length < 2) return EMPTY_PLAN;
  // Keep the saved line exactly: its two ends are the points, the whole line one leg.
  return { points: [line[0]!, line[line.length - 1]!], legs: [{ path: line, snapped }] };
}

const key = (a: LatLng, b: LatLng) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

/**
 * The planner's state: tapped points, the legs between them, undo, and the route tools. With "Follow paths"
 * on (and the back office allowing it), each new leg asks the route-snap function; anything that stops it
 * draws a straight leg with a note saying why. Legs already fetched are cached, so undo and redo cost nothing.
 */
export function usePlanner(initial: PlanState = EMPTY_PLAN, snappingAllowed = true) {
  const [plan, setPlan] = useState<PlanState>(initial);
  const [history, setHistory] = useState<PlanState[]>([]);
  const [followPaths, setFollowPaths] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const cache = useRef(new Map<string, PlanLeg>());
  const busyRef = useRef(false);

  const commit = useCallback((next: PlanState) => {
    setHistory((h) => [...h.slice(-49), plan]);
    setPlan(next);
  }, [plan]);

  const legBetween = useCallback(async (a: LatLng, b: LatLng): Promise<PlanLeg> => {
    if (!followPaths || !snappingAllowed) return straightLeg(a, b);
    const k = key(a, b);
    const hit = cache.current.get(k);
    if (hit) return hit;
    try {
      const r = await snapLeg(a, b);
      if (!r.snapped) {
        setNote(straightLegNote(r.reason));
        return straightLeg(a, b);
      }
      const path = decodePolyline(r.path);
      if (path.length < 2) return straightLeg(a, b);
      const leg = { path, snapped: true };
      cache.current.set(k, leg);
      return leg;
    } catch (e) {
      setNote(straightLegNote(e instanceof ApiError && e.code === 'network' ? 'offline' : 'error'));
      return straightLeg(a, b);
    }
  }, [followPaths, snappingAllowed]);

  /** Adds a point; a leg that follows paths ends where the path does, so the next leg starts on the path. */
  const addPoint = useCallback(async (p: LatLng) => {
    if (busyRef.current) return;
    if (plan.points.length >= PLAN_LIMITS.maxPoints) {
      setNote(`A route can have up to ${PLAN_LIMITS.maxPoints} points.`);
      return;
    }
    setNote(null);
    if (!plan.points.length) {
      commit(appendPoint(plan, p, null));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const last = plan.points[plan.points.length - 1]!;
      const leg = await legBetween(last, p);
      const end = leg.snapped ? leg.path[leg.path.length - 1]! : p;
      let next = appendPoint(plan, end, leg);
      // The first leg may start a little away from the first tap (on the nearest path): move that point too.
      if (leg.snapped && plan.points.length === 1) next = { ...next, points: [leg.path[0]!, ...next.points.slice(1)] };
      commit(next);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [plan, commit, legBetween]);

  const closeLoop = useCallback(async () => {
    const first = closingPoint(plan);
    if (!first || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const leg = await legBetween(plan.points[plan.points.length - 1]!, first);
      commit(appendPoint(plan, first, leg.snapped ? { ...leg, path: [...leg.path.slice(0, -1), first] } : leg));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [plan, commit, legBetween]);

  // Back one step; a saved route opened for editing has no history yet, so undo takes off its last point.
  const undo = useCallback(() => {
    if (history.length) {
      setPlan(history[history.length - 1]!);
      setHistory(history.slice(0, -1));
    } else setPlan(removeLastPoint(plan));
    setNote(null);
  }, [plan, history]);

  const clear = useCallback(() => commit(EMPTY_PLAN), [commit]);
  const reverse = useCallback(() => commit(reversePlan(plan)), [plan, commit]);
  const outAndBack = useCallback(() => commit(outAndBackPlan(plan)), [plan, commit]);

  const path = useMemo(() => planPath(plan), [plan]);
  const distanceM = useMemo(() => pathLengthMeters(path), [path]);
  const loop = useMemo(() => isLoopPath(path), [path]);

  return {
    plan,
    path,
    distanceM,
    loop,
    snapped: planSnapped(plan),
    canUndo: history.length > 0 || plan.points.length > 0,
    canClose: Boolean(closingPoint(plan)) && !loop,
    followPaths,
    setFollowPaths,
    busy,
    note,
    clearNote: () => setNote(null),
    addPoint,
    closeLoop,
    undo,
    clear,
    reverse,
    outAndBack
  };
}

export type Planner = ReturnType<typeof usePlanner>;
