import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useAppConfig } from '@/lib/appConfig';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';

/**
 * Live runs with people you know (R2). Friends are people who follow each other (both accepted), have not
 * blocked each other and whose accounts are active; the server checks this on every call. A runner shares
 * only their own position, with the friends they choose or all their friends, and only while sharing is on.
 * Seeing friends doesn't require sharing.
 */
export type FriendsMode = 'off' | 'chosen' | 'all';

export interface FriendLive {
  user_id: string;
  display_name: string | null;
  handle: string;
  avatar_path: string | null;
  state: 'running' | 'paused';
  started_at: string;
  last_update: string | null;
  /** True while they are in one of their protected areas: no position is sent. */
  hidden: boolean;
  position: { lat: number; lng: number } | null;
  bearing: number | null;
  /** The last few minutes of their path, as [lng, lat] segments. */
  trail: [number, number][][];
}

export interface ShareCandidate {
  id: string;
  display_name: string | null;
  handle: string;
  avatar_path: string | null;
  chosen: boolean;
}

export const FRIENDS_LIVE_KEY = ['friends_live_now'] as const;
export const SHARE_CANDIDATES_KEY = ['live_share_candidates'] as const;

export const friendName = (f: { display_name: string | null; handle: string }) => f.display_name?.trim() || `@${f.handle}`;
/** The name a picture's initials come from (never the "@"). */
export const avatarName = (f: { display_name: string | null; handle: string }) => f.display_name?.trim() || f.handle;
/** The handle under a name, only when the name isn't already the handle. */
export const handleLine = (f: { display_name: string | null; handle: string }) => (f.display_name?.trim() ? `@${f.handle}` : undefined);

/** Friends running now who share with me; refreshed every 30 seconds while the map is open. */
export function useFriendsLive(active: boolean) {
  const { settings } = useAppConfig();
  const { userId } = useSession();
  return useQuery({
    queryKey: FRIENDS_LIVE_KEY,
    enabled: Boolean(userId) && settings.enabled.friends_live_enabled,
    refetchInterval: active ? 30_000 : false,
    staleTime: 15_000,
    queryFn: () => rpc<FriendLive[]>('friends_live_now')
  });
}

export function useShareCandidates(enabled = true) {
  const { userId } = useSession();
  return useQuery({
    queryKey: SHARE_CANDIDATES_KEY,
    enabled: Boolean(userId) && enabled,
    queryFn: () => rpc<ShareCandidate[]>('live_share_candidates')
  });
}

export async function saveSharePeople(ids: string[]): Promise<{ saved: number; skipped: number }> {
  const r = await rpc<{ saved: number; skipped: number }>('set_live_share_people', { p_people: ids });
  void queryClient.invalidateQueries({ queryKey: SHARE_CANDIDATES_KEY });
  return r;
}

/** Turns sharing on (with friends I choose, or all) or off. Turning it off ends a share in progress at once. */
export async function setFriendsMode(userId: string, mode: FriendsMode, previous: FriendsMode): Promise<void> {
  const { error } = await supabase().from('user_settings').update({ friends_live_mode: mode }).eq('user_id', userId);
  if (error) throw error;
  if (mode === 'off' && previous !== 'off') track('friends_live', { action: 'turned_off', audience: previous });
  else if (mode !== 'off') track('friends_live', { action: 'turned_on', audience: mode });
}

/** "Running for 32 min · updated 20 s ago" for a friend's card. */
export function friendStatus(f: Pick<FriendLive, 'state' | 'started_at' | 'last_update' | 'hidden'>, now: number): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(f.started_at)) / 60_000));
  const running = f.state === 'paused' ? 'Paused' : mins < 1 ? 'Just started' : mins < 60 ? `Running for ${mins} min` : `Running for ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
  if (f.hidden) return `${running} · in one of their protected areas`;
  if (!f.last_update) return `${running} · waiting for their position`;
  const age = Math.max(0, Math.round((now - Date.parse(f.last_update)) / 1000));
  const updated = age < 15 ? 'updated just now' : age < 120 ? `updated ${age} s ago` : `last update ${Math.floor(age / 60)} min ago`;
  return `${running} · ${updated}`;
}
