import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';

export interface ActivityRow {
  id: string;
  started_at: string;
  ended_at: string;
  distance_m: number | null;
  elapsed_ms: number | null;
  moving_ms: number | null;
  avg_pace_s_per_km: number | null;
  modes: { territory?: boolean; speed?: boolean };
  status: string;
  title: string | null;
  perceived_effort: number | null;
  claim_status: string | null;
  attempt_statuses: string[];
}

/** First-party activities the runner owns (RLS: own rows only), with result indicators. */
export function useActivities(days: number | null = null) {
  const { userId } = useSession();
  return useQuery({
    queryKey: ['activities', userId, days],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ActivityRow[]> => {
      const sb = supabase();
      let q = sb
        .from('activities')
        .select('id, started_at, ended_at, distance_m, elapsed_ms, moving_ms, avg_pace_s_per_km, modes, status, title, perceived_effort')
        .is('deleted_at', null)
        .order('started_at', { ascending: false })
        .limit(500);
      if (days) q = q.gte('started_at', new Date(Date.now() - days * 86_400_000).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Omit<ActivityRow, 'claim_status' | 'attempt_statuses'>[];
      const ids = rows.map((r) => r.id);
      const [claims, attempts] = ids.length
        ? await Promise.all([
            sb.from('loop_claims').select('activity_id, status').in('activity_id', ids),
            sb.from('speed_attempts').select('activity_id, status').in('activity_id', ids)
          ])
        : [{ data: [] }, { data: [] }];
      const claimBy = new Map(((claims.data ?? []) as { activity_id: string; status: string }[]).map((c) => [c.activity_id, c.status]));
      const attBy = new Map<string, string[]>();
      for (const a of (attempts.data ?? []) as { activity_id: string; status: string }[]) attBy.set(a.activity_id, [...(attBy.get(a.activity_id) ?? []), a.status]);
      return rows.map((r) => ({ ...r, claim_status: claimBy.get(r.id) ?? null, attempt_statuses: attBy.get(r.id) ?? [] }));
    }
  });
}

/** Monday-based local week key for weekly trends. */
export function weekKey(t: number): string {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

export function weeklyTotals(rows: ActivityRow[], weeks: number): { week: string; runs: number; distanceM: number; durationMs: number }[] {
  const out: { week: string; runs: number; distanceM: number; durationMs: number }[] = [];
  const now = Date.now();
  for (let i = weeks - 1; i >= 0; i--) out.push({ week: weekKey(now - i * 7 * 86_400_000), runs: 0, distanceM: 0, durationMs: 0 });
  const by = new Map(out.map((w) => [w.week, w]));
  for (const r of rows) {
    const w = by.get(weekKey(Date.parse(r.started_at)));
    if (!w) continue;
    w.runs++;
    w.distanceM += r.distance_m ?? 0;
    w.durationMs += r.moving_ms ?? r.elapsed_ms ?? 0;
  }
  return out;
}

export function personalBests(rows: ActivityRow[]) {
  const longest = rows.reduce<ActivityRow | null>((b, r) => ((r.distance_m ?? 0) > (b?.distance_m ?? 0) ? r : b), null);
  const fastest5k = rows.filter((r) => (r.distance_m ?? 0) >= 5000 && r.avg_pace_s_per_km).reduce<ActivityRow | null>((b, r) => (!b || r.avg_pace_s_per_km! < b.avg_pace_s_per_km! ? r : b), null);
  const longestTime = rows.reduce<ActivityRow | null>((b, r) => ((r.moving_ms ?? 0) > (b?.moving_ms ?? 0) ? r : b), null);
  return { longest, fastest5k, longestTime };
}
