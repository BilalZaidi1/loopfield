import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Avatar, Button, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Segmented } from '@/components/ui';
import { useSession } from '@/state/session';
import { spacing } from '@/theme/tokens';

interface Connection {
  user_id: string;
  handle: string;
  display_name: string;
  state: string;
  since: string;
}

/** S10 Connections — followers, following, pending requests, approve, remove, unfollow and mute. */
export default function Connections() {
  const { userId } = useSession();
  const params = useLocalSearchParams<{ profile?: string; tab?: 'followers' | 'following' | 'requests' }>();
  const profileId = params.profile ?? userId!;
  const own = profileId === userId;
  const [tab, setTab] = useState<'followers' | 'following' | 'requests'>(params.tab ?? (own ? 'requests' : 'followers'));
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['connections', profileId, tab], queryFn: () => rpc<Connection[]>('connections', { p_profile: profileId, p_kind: tab, p_limit: 100 }) });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['connections'] });
      void qc.invalidateQueries({ queryKey: ['badge_counts'] });
    },
    onError: (e) => Alert.alert('Not changed', friendlyError(e))
  });

  const right = (c: Connection) => {
    if (!own) return undefined;
    if (tab === 'requests')
      return (
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <Button label="Approve" size="sm" onPress={() => act.mutate(async () => { await rpc('respond_follow_request', { p_follower: c.user_id, p_accept: true }); track('social_action', { action: 'follow_approved', audience_class: 'none', outcome: 'ok' }); })} />
          <Button label="Decline" size="sm" variant="ghost" onPress={() => act.mutate(() => rpc('respond_follow_request', { p_follower: c.user_id, p_accept: false }))} />
        </View>
      );
    if (tab === 'followers') return <Button label="Remove" size="sm" variant="ghost" onPress={() => Alert.alert('Remove follower?', `${c.display_name} will no longer see your followers-only posts. They are not notified.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => act.mutate(() => rpc('remove_follower', { p_follower: c.user_id })) }])} />;
    return (
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        <Button label="Mute" size="sm" variant="ghost" onPress={() => act.mutate(() => rpc('mute_user', { p_target: c.user_id, p_muted: true }))} />
        <Button label="Unfollow" size="sm" variant="secondary" onPress={() => act.mutate(() => rpc('unfollow', { p_target: c.user_id }))} />
      </View>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Connections' }} />
      <Segmented label="Connection list" value={tab} onChange={setTab} options={[...(own ? [{ value: 'requests' as const, label: 'Requests' }] : []), { value: 'followers', label: 'Followers' }, { value: 'following', label: 'Following' }]} />
      {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.data?.length ? (
        <ListGroup>
          {list.data.map((c) => <Row key={c.user_id} leading={<Avatar name={c.display_name} size={40} />} title={c.display_name} subtitle={`@${c.handle}`} onPress={() => router.push({ pathname: '/profile/[id]', params: { id: c.user_id } })} right={right(c)} />)}
        </ListGroup>
      ) : (
        <EmptyState icon="clubs" title={tab === 'requests' ? 'No pending requests' : tab === 'followers' ? 'No followers to show' : 'Not following anyone yet'} action={tab === 'following' && own ? { label: 'Discover runners', onPress: () => router.push('/discover') } : undefined} />
      )}
    </Screen>
  );
}
