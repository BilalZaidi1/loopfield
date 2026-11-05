import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';

export interface ProfileCard {
  id: string;
  handle: string;
  display_name: string;
  avatar_path: string | null;
  bio: string | null;
  city_label: string | null;
  visibility: 'public' | 'private';
  is_me: boolean;
  follow_state: 'none' | 'pending' | 'accepted';
  follows_me: boolean;
  muted: boolean;
  blocked: boolean;
  followers: number;
  following: number;
  can_view_content: boolean;
  can_message: boolean;
  titles: number | null;
}

export const useProfileCard = (id: string | undefined) =>
  useQuery({ queryKey: ['profile_card', id], enabled: Boolean(id), queryFn: () => rpc<ProfileCard | null>('profile_card', { p_profile: id }) });

export function useRelationshipActions(target: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['profile_card', target] });
    void qc.invalidateQueries({ queryKey: ['connections'] });
    void qc.invalidateQueries({ queryKey: ['search_profiles'] });
    void qc.invalidateQueries({ queryKey: ['feed'] });
  };
  const onError = (e: unknown) => Alert.alert('Not changed', friendlyError(e));
  const follow = useMutation({
    mutationFn: () => rpc<string>('follow', { p_target: target }),
    onSuccess: () => {
      track('social_action', { action: 'follow_requested', audience_class: 'none', outcome: 'ok' });
      refresh();
    },
    onError
  });
  const unfollow = useMutation({
    mutationFn: () => rpc('unfollow', { p_target: target }),
    onSuccess: () => {
      track('social_action', { action: 'unfollowed', audience_class: 'none', outcome: 'ok' });
      refresh();
    },
    onError
  });
  const mute = useMutation({ mutationFn: (muted: boolean) => rpc('mute_user', { p_target: target, p_muted: muted }), onSuccess: () => { track('social_action', { action: 'muted', audience_class: 'none', outcome: 'ok' }); refresh(); }, onError });
  const block = useMutation({ mutationFn: () => rpc('block_user', { p_target: target }), onSuccess: () => { track('social_action', { action: 'blocked', audience_class: 'none', outcome: 'ok' }); void qc.invalidateQueries(); }, onError });
  const unblock = useMutation({ mutationFn: () => rpc('unblock_user', { p_target: target }), onSuccess: () => void qc.invalidateQueries(), onError });
  return { follow, unfollow, mute, block, unblock };
}
