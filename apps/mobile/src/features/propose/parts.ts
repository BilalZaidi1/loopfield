import { useQuery } from '@tanstack/react-query';
import { densify, haversineMeters, type LatLng } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';

/**
 * Checks the phone makes while a runner chooses a speed route from a run (R4), so a proposal that would be
 * declined is never sent. The server checks everything again from the run's evidence.
 */
export interface OwnArea {
  id: string;
  label: string | null;
  radius_m: number;
  lat: number;
  lng: number;
}

export interface OwnProposal {
  id: string;
  name: string;
  status: string;
  from_m: number | null;
  to_m: number | null;
}

/** Margin the server keeps around protected areas. */
export const PROTECTED_MARGIN_M = 50;
const OPEN = ['processing', 'pending_review', 'approved'];

/** The first protected area the line comes within the margin of, or null. */
export function touchedArea(line: readonly LatLng[], areas: readonly OwnArea[], marginM = PROTECTED_MARGIN_M): OwnArea | null {
  if (line.length < 2 || !areas.length) return null;
  const pts = densify(line, 10);
  for (const a of areas) {
    const reach = a.radius_m + marginM;
    if (pts.some((q) => haversineMeters(q, { lat: a.lat, lng: a.lng }) <= reach)) return a;
  }
  return null;
}

/** Why this choice clashes with the runner's open proposals from the same run, or null. */
export function overlapWith(existing: readonly OwnProposal[], whole: boolean, fromM: number, toM: number): { kind: 'whole_taken' | 'parts_taken' | 'overlap'; other: OwnProposal } | null {
  const open = existing.filter((p) => OPEN.includes(p.status));
  const wholeOne = open.find((p) => p.from_m === null || p.to_m === null);
  if (wholeOne) return { kind: 'whole_taken', other: wholeOne };
  if (whole && open.length) return { kind: 'parts_taken', other: open[0]! };
  const clash = open.find((p) => p.from_m! < toM && fromM < p.to_m!);
  return clash ? { kind: 'overlap', other: clash } : null;
}

/** Where the sliders start: the whole run when it fits the length rules, otherwise its first stretch of the longest allowed length. */
export function defaultPart(lengthM: number, maxCourseM: number): [number, number] {
  return [0, Math.round(Math.min(lengthM, maxCourseM - 10))];
}

export function useOwnAreas() {
  const { userId } = useSession();
  return useQuery({ queryKey: ['my_protected_areas', userId], enabled: Boolean(userId), staleTime: 60_000, queryFn: async () => (await rpc<OwnArea[] | null>('my_protected_areas')) ?? [] });
}

export function useRunProposals(activityId: string | undefined) {
  return useQuery({
    queryKey: ['run-proposals', activityId],
    enabled: Boolean(activityId),
    queryFn: async () => {
      const { data, error } = await supabase().from('route_proposals').select('id, name, status, from_m, to_m').eq('source_activity_id', activityId!);
      if (error) throw error;
      return (data ?? []) as OwnProposal[];
    }
  });
}
