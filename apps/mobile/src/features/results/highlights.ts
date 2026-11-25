import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import {
  best5kFromSplits,
  canonicalSessions,
  halvesFromSplits,
  runHighlights,
  type Highlight,
  type HighlightContext,
  type HighlightMemory,
  type HighlightRun,
  type Split
} from '@loopfield/core';
import { track } from '@/lib/analytics';
import { useAppConfig } from '@/lib/appConfig';
import { supabase } from '@/lib/supabase';
import { getGoals } from '@/health/cache';
import { useRunEffort } from '@/health/training';
import { deviceOffsetMin, useHealthStore } from '@/health/useHealth';
import { useSession, useUnits } from '@/state/session';
import type { LayerResult } from './ResultCards';

/**
 * Run highlights on the phone (R2). The rules are in core; this gathers what they need from data the phone
 * already has (the run, the last four months of runs including imported ones, goals, the land result and the
 * effort score) and keeps, per run, the lines it showed and the cool-down memory from before that run, so the
 * same run always shows the same lines and opening it again never uses up a cool-down. Nothing is uploaded.
 */
export const HIGHLIGHT_DAYS = 120;
const STORE_KEY = 'run-highlights-v1';
const KEEP_RUNS = 40;

interface Stored {
  memory: HighlightMemory;
  runs: Record<string, { before: HighlightMemory; lines: Highlight[]; at: number; hidden?: boolean; land?: boolean }>;
}

async function readStore(): Promise<Stored> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    const v = raw ? (JSON.parse(raw) as Stored) : null;
    return v && typeof v === 'object' && v.runs ? v : { memory: {}, runs: {} };
  } catch {
    return { memory: {}, runs: {} };
  }
}

async function writeStore(s: Stored): Promise<void> {
  const ids = Object.keys(s.runs).sort((a, b) => (s.runs[b]!.at ?? 0) - (s.runs[a]!.at ?? 0));
  for (const id of ids.slice(KEEP_RUNS)) delete s.runs[id];
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // a per-phone nicety: the lines are simply worked out again
  }
}

interface HistoryRow {
  id: string;
  started_at: string;
  distance_m: number | null;
  moving_ms: number | null;
  elapsed_ms: number | null;
  splits: Split[] | null;
}

export function useHighlightHistory(enabled: boolean) {
  const { userId } = useSession();
  return useQuery({
    queryKey: ['highlight-history', userId],
    enabled: Boolean(userId) && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<HistoryRow[]> => {
      const since = new Date(Date.now() - HIGHLIGHT_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase()
        .from('activities')
        .select('id, started_at, distance_m, moving_ms, elapsed_ms, splits')
        .gte('started_at', since)
        .is('deleted_at', null)
        .order('started_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as HistoryRow[];
    }
  });
}

export function toHighlightRun(r: { id: string; start: number; distanceM: number; durationMs: number; splits?: Split[] | null; imported?: boolean }): HighlightRun {
  return { id: r.id, start: r.start, distanceM: r.distanceM, durationMs: r.durationMs, best5kSeconds: best5kFromSplits(r.splits), halves: halvesFromSplits(r.splits), imported: Boolean(r.imported) };
}

/** The season race's land result for the run (the runner's own view; shared only once published). */
export function landFrom(layers: readonly LayerResult[] | undefined): { gained: number; kept: number; taken: number; published: boolean } | null {
  const l = layers?.find((x) => x.kind === 'public') ?? null;
  if (!l || l.status !== 'eligible') return null;
  return { gained: l.gained_cells ?? 0, kept: l.kept_cells ?? 0, taken: l.taken_cells ?? 0, published: Boolean(l.published) };
}

export interface RunHighlights {
  lines: Highlight[];
  hidden: boolean;
  /** Lines that may go on a share card: never the effort line, and land only once it is published. */
  shareable: string[];
  hide: () => void;
}

/**
 * The run's highlights, or null while anything they depend on is loading (rules stay quiet rather than
 * guess). `run` is the run as this phone knows it (just recorded) when the server hasn't got it yet.
 */
export function useRunHighlights(activityId: string | null | undefined, opts: {
  run?: { start: number; distanceM: number; durationMs: number; splits: Split[] | null } | null;
  layers?: readonly LayerResult[];
  landSettled: boolean;
  /** False reads only the lines already shown for the run (the share card), never working them out. */
  compute?: boolean;
}): RunHighlights | null {
  const { settings } = useAppConfig();
  const units = useUnits();
  const on = settings.enabled.run_summaries_enabled;
  const history = useHighlightHistory(on && Boolean(activityId) && opts.compute !== false);
  const store = useHealthStore();
  const effort = useRunEffort(activityId, opts.run ? { start: opts.run.start, durationMs: opts.run.durationMs, distanceM: opts.run.distanceM } : null);
  const [saved, setSaved] = useState<Stored | null>(null);
  const land = landFrom(opts.layers);

  useEffect(() => {
    void readStore().then(setSaved);
  }, []);

  const ctx = useMemo((): Omit<HighlightContext, 'memory' | 'now' | 'historyFrom'> | null => {
    if (!on || !activityId || !history.data) return null;
    const rows = history.data;
    const firstParty = rows.map((r) => ({ activityId: r.id, start: Date.parse(r.started_at), end: Date.parse(r.started_at) + (r.elapsed_ms ?? 0), distanceM: Number(r.distance_m ?? 0) }));
    const imported = canonicalSessions([...store.workout.values()], firstParty)
      .filter((s) => s.imported && !s.firstPartyActivityId && s.activity === 'running' && (s.distanceM ?? 0) > 0)
      .map((s) => toHighlightRun({ id: s.id, start: s.start, distanceM: s.distanceM ?? 0, durationMs: Math.max(0, s.end - s.start), imported: true }));
    const own = rows.map((r) => toHighlightRun({ id: r.id, start: Date.parse(r.started_at), distanceM: Number(r.distance_m ?? 0), durationMs: r.moving_ms ?? r.elapsed_ms ?? 0, splits: r.splits }));
    const mine = own.find((r) => r.id === activityId) ?? (opts.run ? toHighlightRun({ id: activityId, ...opts.run }) : null);
    if (!mine) return null;
    return {
      run: mine,
      history: [...own.filter((r) => r.id !== activityId), ...imported],
      offsetMin: deviceOffsetMin(),
      units,
      goals: getGoals(),
      land: land ? { gained: land.gained, kept: land.kept, taken: land.taken } : null,
      effortWord: effort?.word ?? null
    };
  }, [on, activityId, history.data, store, opts.run, units, land?.gained, land?.kept, land?.taken, effort?.word]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = activityId && saved ? saved.runs[activityId] : undefined;
  // Worked out once per run, and once more when the land result arrives.
  const needsWork = opts.compute !== false && Boolean(ctx && saved && activityId && (!entry || (opts.landSettled && !entry.land)));

  useEffect(() => {
    if (!needsWork || !ctx || !saved || !activityId) return;
    const before = entry?.before ?? saved.memory;
    const now = Date.now();
    const result = runHighlights({ ...ctx, now, historyFrom: now - HIGHLIGHT_DAYS * 86_400_000, memory: before });
    const next: Stored = {
      memory: { ...saved.memory, ...result.memory },
      runs: { ...saved.runs, [activityId]: { before, lines: result.lines, at: entry?.at ?? now, hidden: entry?.hidden, land: opts.landSettled } }
    };
    void writeStore(next).then(() => setSaved(next));
    if (!entry && result.lines.length) {
      const top = result.lines[0]!.kind;
      track('run_summary', { action: 'shown', lines: String(result.lines.length) as '1' | '2' | '3', top: top === 'effort' ? 'other' : top });
    }
  }, [needsWork]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!on || !entry) return null;
  const hide = () => {
    if (!saved || !activityId) return;
    const next: Stored = { ...saved, runs: { ...saved.runs, [activityId]: { ...entry, hidden: true } } };
    setSaved(next);
    void writeStore(next);

    track('run_summary', { action: 'hidden', lines: String(entry.lines.length) as '0' | '1' | '2' | '3', top: entry.lines[0] ? (entry.lines[0].kind === 'effort' ? 'other' : entry.lines[0].kind) : 'none' });
  };
  const shareable = entry.lines.filter((l) => l.shareable && (l.kind !== 'land' || land?.published)).map((l) => l.text);
  return { lines: entry.lines, hidden: Boolean(entry.hidden), shareable, hide };
}
