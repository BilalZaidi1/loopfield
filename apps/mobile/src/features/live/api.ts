import { Share } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { LiveKind } from '@/recording/livePush';

/**
 * Live links (R1): a link the runner sends to family and friends so they can see where the runner is until
 * shortly after the run. Outside the game: positions never feed land or rankings, and the page shows only the
 * runner's name, the trail, time running and distance.
 */

export interface LiveLinkInfo {
  token: string;
  kind: LiveKind;
  show_everywhere: boolean;
  views: number;
  created_at: string;
  expires_at: string | null;
  run: { session_id: string; state: string; started_at: string; ended_at: string | null } | null;
}

export type LiveStatus = 'waiting' | 'running' | 'paused' | 'finished' | 'not_running' | 'ended';

export interface PublicLiveLink {
  status: LiveStatus;
  kind: LiveKind;
  name: string;
  started_at?: string;
  last_update?: string | null;
  distance_m?: number;
  hidden?: boolean;
  last?: { lat: number; lng: number } | null;
  /** Visible parts of the trail, each a list of [lng, lat]. */
  trail?: [number, number][][];
  refresh_seconds?: number;
}

export const liveLinkUrl = (token: string) => `${env.webUrl.replace(/\/+$/, '')}/l/${token}`;

export const MY_LIVE_LINKS_KEY = ['my_live_links'] as const;

/** The runner's open links (with how often each was opened). */
export function useMyLiveLinks(enabled = true) {
  return useQuery({
    queryKey: MY_LIVE_LINKS_KEY,
    enabled,
    queryFn: () => rpc<LiveLinkInfo[]>('my_live_links'),
    refetchInterval: 60_000,
    staleTime: 20_000
  });
}

export async function createLiveLink(kind: LiveKind, showEverywhere: boolean): Promise<{ token: string; kind: LiveKind; created: boolean }> {
  const r = await rpc<{ token: string; kind: LiveKind; created: boolean }>('live_link_create', { p_kind: kind, p_show_everywhere: showEverywhere });
  if (r.created) track('live_link', { action: 'started', kind });
  return r;
}

/** Opens the phone's share sheet with the link. */
export async function shareLiveLink(token: string, kind: LiveKind): Promise<boolean> {
  const url = liveLinkUrl(token);
  const message = kind === 'standing'
    ? `This link shows where I am whenever I'm running with Loopfield: ${url}`
    : `Follow my run live on Loopfield until I finish: ${url}`;
  try {
    const r = await Share.share({ message, url, title: 'My live location' });
    if (r.action !== Share.dismissedAction) track('live_link', { action: 'shared', kind });
    return r.action !== Share.dismissedAction;
  } catch {
    return false;
  }
}

export async function endLiveLink(token: string, kind: LiveKind): Promise<void> {
  await rpc('live_link_end', { p_token: token });
  track('live_link', { action: 'ended', kind });
}

export async function revokeLiveLink(token: string, kind: LiveKind): Promise<void> {
  await rpc('live_link_revoke', { p_token: token });
  track('live_link', { action: 'revoked', kind });
}

export async function rotateStandingLink(): Promise<{ token: string }> {
  const r = await rpc<{ token: string }>('live_link_rotate');
  track('live_link', { action: 'rotated', kind: 'standing' });
  return r;
}

export async function setShowEverywhere(token: string, value: boolean): Promise<void> {
  await rpc('live_link_set_show_everywhere', { p_token: token, p_value: value });
}

/** The live page's data, refreshed as often as the phone sends (30 seconds by default). */
export function usePublicLiveLink(token: string | undefined) {
  return useQuery({
    queryKey: ['public_live_link', token],
    enabled: Boolean(token),
    // Refreshes don't count as openings; the page counts itself once with countLiveView.
    queryFn: () => rpc<PublicLiveLink | null>('public_live_link', { p_token: token, p_first: false }),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d || d.status === 'ended') return false;
      return Math.max(15, d.refresh_seconds ?? 30) * 1000;
    },
    refetchIntervalInBackground: false
  });
}

/** Counts one opening of the page (separate from the refreshes). */
export async function countLiveView(token: string): Promise<void> {
  await rpc('public_live_link', { p_token: token, p_first: true }).catch(() => {});
}
