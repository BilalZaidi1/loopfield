import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';

export interface MyClub {
  id: string;
  kind: 'club' | 'community';
  name: string;
  visibility: 'public' | 'private';
  role: 'owner' | 'organizer' | 'member';
  state: 'active' | 'invited' | 'requested';
  member_count: number;
}

export interface DiscoverClub {
  id: string;
  kind: 'club' | 'community';
  name: string;
  city_label: string | null;
  visibility: 'public' | 'private';
  join_policy: 'open' | 'request' | 'invite_only';
  member_count: number;
  my_state: string | null;
}

export interface ClubDetail {
  id: string;
  kind: 'club' | 'community';
  name: string;
  description: string | null;
  rules: string | null;
  visibility: 'public' | 'private';
  join_policy: 'open' | 'request' | 'invite_only';
  posting_policy: 'members' | 'organizers';
  city_label: string | null;
  avatar_path: string | null;
  status: string;
  my_role: 'owner' | 'organizer' | 'member' | null;
  my_state: 'active' | 'invited' | 'requested' | null;
  member_count: number;
  pending_requests: number | null;
  competition_id: string | null;
  organizers: { id: string; handle: string; display_name: string; role: string }[];
}

export const useMyClubs = () => useQuery({ queryKey: ['my_clubs'], queryFn: () => rpc<MyClub[]>('my_clubs') });

export const useClub = (id: string | undefined) =>
  useQuery({ queryKey: ['club', id], enabled: Boolean(id), queryFn: () => rpc<ClubDetail | null>('club_detail', { p_club: id }) });

/** Membership changes are always explicit actions by the runner (never inferred from location or follows). */
export function useMembershipActions(clubId: string, kind: 'club' | 'community', visibility: 'public' | 'private') {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['club', clubId] });
    void qc.invalidateQueries({ queryKey: ['my_clubs'] });
    void qc.invalidateQueries({ queryKey: ['discover_clubs'] });
    void qc.invalidateQueries({ queryKey: ['competitions'] });
  };
  const onError = (e: unknown) => Alert.alert('Could not update membership', friendlyError(e));
  const join = useMutation({
    mutationFn: () => rpc<string>('join_club', { p_club: clubId }),
    onSuccess: (state) => {
      track('club_action', { action: state === 'requested' ? 'requested' : 'joined', club_kind: kind, visibility });
      done();
    },
    onError
  });
  const leave = useMutation({
    mutationFn: () => rpc('leave_club', { p_club: clubId }),
    onSuccess: () => {
      track('club_action', { action: 'left', club_kind: kind, visibility });
      done();
    },
    onError
  });
  const respond = useMutation({
    mutationFn: (accept: boolean) => rpc('respond_club_invite', { p_club: clubId, p_accept: accept }),
    onSuccess: (_d, accept) => {
      track('club_action', { action: accept ? 'invite_accepted' : 'invite_declined', club_kind: kind, visibility });
      done();
    },
    onError
  });
  return { join, leave, respond };
}
