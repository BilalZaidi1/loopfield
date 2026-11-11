import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { env } from '@/config/env';
import { rpc } from '@/lib/api';
import type { SharedLand } from '@/features/social/PostCard';
import type { ShareField } from '@/features/social/publish';

/** What a share would show, computed by the server (trimmed route, land, summary). */
export interface SharePayload {
  summary?: {
    distance_m?: number;
    elapsed_ms?: number;
    moving_ms?: number;
    avg_pace_s_per_km?: number;
    elevation_gain_m?: number;
    activity_date?: string;
    achievement?: 'land_claimed';
    area_m2?: number;
    achievement_title?: 'route_title';
  } | null;
  route?: string[] | null;
  land?: (SharedLand & { publish_after?: string }) | null;
  publish_after?: string;
}

export interface ActivityLink {
  token: string;
  share_fields: ShareField[];
  publish_after: string;
  views: number;
  created_at: string;
}

/** The public page for a link (web), e.g. https://loopfield.expo.app/a/<token>. */
export const publicActivityUrl = (token: string) => `${env.webUrl.replace(/\/$/, '')}/a/${token}`;

export function useSharePreview(activityId: string | undefined, fields: ShareField[]) {
  const key = [...fields].sort().join(',');
  return useQuery({
    queryKey: ['share_preview', activityId, key],
    enabled: Boolean(activityId),
    staleTime: 60_000,
    queryFn: () => rpc<SharePayload | null>('share_preview', { p_activity: activityId, p_share_fields: fields })
  });
}

export function useActivityLink(activityId: string | undefined) {
  return useQuery({
    queryKey: ['activity_link', activityId],
    enabled: Boolean(activityId),
    queryFn: () => rpc<ActivityLink | null>('my_activity_link', { p_activity: activityId })
  });
}

export function useLinkActions(activityId: string | undefined) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['activity_link', activityId] });
  const create = useMutation({ mutationFn: (fields: ShareField[]) => rpc<{ token: string; publish_after: string }>('create_activity_link', { p_activity: activityId, p_share_fields: fields }), onSuccess: done });
  const revoke = useMutation({ mutationFn: (token: string) => rpc<void>('revoke_activity_link', { p_token: token }), onSuccess: done });
  return { create, revoke };
}

/** A public activity page as anyone with the link sees it (null when unavailable). */
export interface PublicActivity {
  runner: { handle: string; display_name: string; is_me: boolean };
  summary: SharePayload['summary'];
  route: string[] | null;
  land: Omit<SharedLand, 'layer'> & { layer?: SharedLand['layer'] } | null;
  shared_at: string;
}

export const usePublicActivity = (token: string | undefined) =>
  useQuery({ queryKey: ['public_activity', token], enabled: Boolean(token), queryFn: () => rpc<PublicActivity | null>('public_activity', { p_token: token }) });
