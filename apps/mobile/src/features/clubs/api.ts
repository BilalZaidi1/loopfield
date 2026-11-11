import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';

export type ClubKind = 'community' | 'group';
/** Predefined cover artwork (drawn in the app; no image needed). */
export type ClubArtwork = 'trail' | 'tide' | 'grid' | 'peaks' | 'dunes' | 'city';

export interface MyClub {
  id: string;
  kind: ClubKind;
  name: string;
  visibility: 'public' | 'private';
  role: 'owner' | 'organizer' | 'member';
  state: 'active' | 'invited' | 'requested';
  member_count: number;
  avatar_path: string | null;
  artwork: ClubArtwork | null;
}

export interface DiscoverClub {
  id: string;
  kind: ClubKind;
  avatar_path: string | null;
  artwork: ClubArtwork | null;
  name: string;
  city_label: string | null;
  visibility: 'public' | 'private';
  join_policy: 'open' | 'request' | 'invite_only';
  member_count: number;
  my_state: string | null;
}

export interface ClubDetail {
  id: string;
  kind: ClubKind;
  cover_path: string | null;
  artwork: ClubArtwork | null;
  region_id: string | null;
  /** A pending ownership offer: to me (accept or decline), or from me as the owner (to whom). */
  ownership_offer: { to_me: boolean; expires_at: string; to?: { id: string; display_name: string } } | null;
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
export function useMembershipActions(clubId: string, kind: ClubKind, visibility: 'public' | 'private') {
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

/** Plain name of the product: communities and groups are different things to runners. */
export const kindLabel = (k: ClubKind) => (k === 'group' ? 'Group' : 'Community');
/** Admins are stored as "organizer". */
export const roleLabel = (r: 'owner' | 'organizer' | 'member') => (r === 'owner' ? 'Owner' : r === 'organizer' ? 'Admin' : 'Member');

export interface ClubStats {
  members: number;
  runs_this_week: number;
  runners_this_week: number;
  distance_this_week_m: number;
  land_held_m2: number;
}

export const useClubStats = (id: string | undefined, enabled = true) =>
  useQuery({ queryKey: ['club_stats', id], enabled: Boolean(id) && enabled, staleTime: 5 * 60_000, queryFn: () => rpc<ClubStats | null>('club_stats', { p_club: id }) });

/** Owner and admin actions: branding, visibility, roles, ownership offers and deletion (all checked on the server). */
export function useClubAdmin(club: Pick<ClubDetail, 'id' | 'kind' | 'visibility'> | null | undefined) {
  const qc = useQueryClient();
  const id = club?.id;
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['club', id] });
    void qc.invalidateQueries({ queryKey: ['club_members', id] });
    void qc.invalidateQueries({ queryKey: ['my_clubs'] });
    void qc.invalidateQueries({ queryKey: ['discover_clubs'] });
  };
  const t = (action: 'branding_saved' | 'ownership_offered' | 'ownership_accepted' | 'ownership_declined' | 'admin_added' | 'admin_removed' | 'deleted') =>
    club && track('club_action', { action, club_kind: club.kind, visibility: club.visibility });
  const branding = useMutation({
    mutationFn: (b: { logoPath?: string | null; coverPath?: string | null; artwork?: ClubArtwork | null; clearCover?: boolean }) =>
      rpc<void>('set_club_branding', { p_club: id, p_logo_path: b.logoPath ?? null, p_cover_path: b.coverPath ?? null, p_artwork: b.artwork ?? null, p_clear_cover: Boolean(b.clearCover) }),
    onSuccess: () => {
      t('branding_saved');
      done();
    }
  });
  const details = useMutation({
    mutationFn: (d: { name?: string; description?: string }) => rpc<void>('update_club', { p_club: id, p_name: d.name ?? null, p_description: d.description ?? null }),
    onSuccess: done
  });
  const visibility = useMutation({
    mutationFn: (v: { visibility: 'public' | 'private'; joinPolicy: 'open' | 'request' | 'invite_only' }) => rpc<void>('set_club_visibility', { p_club: id, p_visibility: v.visibility, p_join_policy: v.joinPolicy }),
    onSuccess: done
  });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: 'organizer' | 'member' }) => rpc<void>('set_club_role', { p_club: id, p_user: v.userId, p_role: v.role }),
    onSuccess: (_d, v) => {
      t(v.role === 'organizer' ? 'admin_added' : 'admin_removed');
      done();
    }
  });
  const offer = useMutation({
    mutationFn: (userId: string) => rpc<void>('offer_club_ownership', { p_club: id, p_user: userId }),
    onSuccess: () => {
      t('ownership_offered');
      done();
    }
  });
  const cancelOffer = useMutation({ mutationFn: () => rpc<void>('cancel_club_ownership_offer', { p_club: id }), onSuccess: done });
  const respondOffer = useMutation({
    mutationFn: (accept: boolean) => rpc<void>('respond_club_ownership', { p_club: id, p_accept: accept }),
    onSuccess: (_d, accept) => {
      t(accept ? 'ownership_accepted' : 'ownership_declined');
      done();
    }
  });
  const remove = useMutation({
    mutationFn: (confirmName: string) => rpc<void>('delete_club', { p_club: id, p_confirm_name: confirmName }),
    onSuccess: () => {
      t('deleted');
      done();
      void qc.invalidateQueries({ queryKey: ['competitions'] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    }
  });
  return { branding, details, visibility, setRole, offer, cancelOffer, respondOffer, remove };
}
