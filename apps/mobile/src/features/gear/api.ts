import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useFeature } from '@/lib/appConfig';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { prepareImage, uploadToBucket } from '@/features/social/media';
import { useSession } from '@/state/session';

/**
 * Shoe mileage (R4). Pairs live on the server (so every phone shows the same totals) but are private:
 * only the runner can read them, every change goes through the database's functions, and nothing about
 * them is on the profile or in a shared post. Photos sit in the runner's own folder of a private bucket.
 */
export interface Gear {
  id: string;
  name: string;
  photo_path: string | null;
  start_distance_m: number;
  reminder_m: number;
  is_default: boolean;
  retired_at: string | null;
  /** The starting distance plus every run counted towards the pair. */
  distance_m: number;
  runs: number;
  created_at: string;
}

export const GEAR_BUCKET = 'gear-photos';
/** Shoe photos are small on screen, so they are kept small. */
const PHOTO_EDGE = 1024;

export function useMyGear() {
  const { userId } = useSession();
  const on = useFeature('gear_enabled');
  return useQuery({
    queryKey: ['gear', userId],
    enabled: Boolean(userId) && on,
    staleTime: 30_000,
    queryFn: async () => (await rpc<Gear[] | null>('my_gear')) ?? []
  });
}

export const inUse = (list: readonly Gear[]) => list.filter((g) => !g.retired_at);

/** The Me row's line: how many pairs are in use and which one new runs count towards. */
export function shoesSubtitle(list: readonly Gear[] | undefined): string {
  if (!list) return 'Distance on each pair';
  const using = list.filter((g) => !g.retired_at);
  if (!using.length) return list.length ? 'No pairs in use' : 'Keep count of the distance on each pair';
  const main = using.find((g) => g.is_default);
  const count = using.length === 1 ? '1 pair' : `${using.length} pairs`;
  return main ? `${count} · new runs: ${main.name}` : `${count} · new runs count towards none`;
}
export const retired = (list: readonly Gear[]) => list.filter((g) => g.retired_at);
export const defaultPair = (list: readonly Gear[] | undefined) => list?.find((g) => g.is_default && !g.retired_at) ?? null;

/** How far through its reminder distance a pair is (0–1, capped), and whether a reminder is due. */
export function wear(g: Pick<Gear, 'distance_m' | 'reminder_m'>): { share: number; due: 'none' | 'soon' | 'now' } {
  const share = g.reminder_m > 0 ? g.distance_m / g.reminder_m : 0;
  return { share: Math.min(1, Math.max(0, share)), due: share >= 1 ? 'now' : share >= 0.9 ? 'soon' : 'none' };
}

export function refreshGear(activityId?: string): void {
  void queryClient.invalidateQueries({ queryKey: ['gear'] });
  void queryClient.invalidateQueries({ queryKey: ['gear-run'] });
  if (activityId) void queryClient.invalidateQueries({ queryKey: ['activity', activityId] });
}

export async function saveGear(input: { id: string | null; name: string; startM: number; reminderM: number; isDefault: boolean }): Promise<string> {
  const id = await rpc<string>('save_gear', { p_id: input.id, p_name: input.name.trim(), p_start_distance_m: input.startM, p_reminder_m: input.reminderM, p_default: input.isDefault });
  track('gear', { action: input.id ? 'edited' : 'added' });
  refreshGear();
  return id;
}

export async function retireGear(id: string, retire: boolean): Promise<void> {
  await rpc('retire_gear', { p_id: id, p_retired: retire });
  track('gear', { action: retire ? 'retired' : 'back_in_use' });
  refreshGear();
}

/** Deletes a pair and its photo. Its runs keep their distances and count towards nothing. */
export async function deleteGear(g: Pick<Gear, 'id' | 'photo_path'>): Promise<void> {
  await rpc('delete_gear', { p_id: g.id });
  if (g.photo_path) await removeFile(g.photo_path);
  track('gear', { action: 'deleted' });
  refreshGear();
}

/** A new file name each time, so a changed photo is never served from an old cached link. */
export function gearPhotoPath(userId: string, gearId: string): string {
  return `${userId}/${gearId}-${Date.now()}.jpg`;
}

/** Re-encodes the photo on the phone (dropping its location and other metadata), uploads it, then removes the old one. */
export async function setGearPhoto(userId: string, g: Pick<Gear, 'id' | 'photo_path'>, pickedUri: string): Promise<void> {
  const img = await prepareImage(pickedUri, { maxEdge: PHOTO_EDGE });
  const path = gearPhotoPath(userId, g.id);
  await uploadToBucket(GEAR_BUCKET, path, img.uri);
  try {
    await rpc('set_gear_photo', { p_id: g.id, p_path: path });
  } catch (e) {
    await removeFile(path);
    throw e;
  }
  if (g.photo_path) await removeFile(g.photo_path);
  track('gear', { action: 'photo_added' });
  refreshGear();
}

export async function removeGearPhoto(g: Pick<Gear, 'id' | 'photo_path'>): Promise<void> {
  await rpc('set_gear_photo', { p_id: g.id, p_path: null });
  if (g.photo_path) await removeFile(g.photo_path);
  refreshGear();
}

/** Which pair a run counts towards, or none. */
export async function setRunGear(activityId: string, gearId: string | null): Promise<void> {
  await rpc('set_run_gear', { p_activity: activityId, p_gear: gearId });
  track('gear', { action: 'changed_on_run' });
  refreshGear(activityId);
}

async function removeFile(path: string): Promise<void> {
  try {
    await supabase().storage.from(GEAR_BUCKET).remove([path]);
  } catch {
    // An unreferenced photo in the runner's own private folder; account deletion removes the folder.
  }
}

/**
 * The pair a run counts towards, with its total including the run: null when it counts towards none (or
 * shoes are off), undefined while not known yet. The totals are read once the server has processed the run.
 */
export function useRunShoes(activity: { id: string; status: string; gear_id?: string | null } | null | undefined): Gear | null | undefined {
  const on = useFeature('gear_enabled');
  const ready = on && activity?.status === 'processed' && Boolean(activity.gear_id);
  const q = useQuery({
    queryKey: ['gear-run', activity?.id, activity?.gear_id],
    enabled: ready,
    staleTime: Infinity,
    queryFn: async () => (await rpc<Gear[] | null>('my_gear')) ?? []
  });
  if (!on) return null;
  if (!activity) return undefined;
  if (activity.status !== 'processed') return activity.gear_id === null ? null : undefined;
  if (!activity.gear_id) return null;
  if (!q.data) return undefined;
  return q.data.find((g) => g.id === activity.gear_id) ?? null;
}
