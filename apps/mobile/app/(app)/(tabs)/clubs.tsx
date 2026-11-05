import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { TopBar } from '@/components/TopBar';
import { useMembershipActions, useMyClubs, type DiscoverClub, type MyClub } from '@/features/clubs/api';
import { useSession } from '@/state/session';
import { spacing } from '@/theme/tokens';

function InviteRow({ c }: { c: MyClub }) {
  const { respond } = useMembershipActions(c.id, c.kind, c.visibility);
  return (
    <Row
      title={c.name}
      subtitle={`Invitation · ${c.kind === 'club' ? 'Club' : 'Community'} · ${c.member_count} members`}
      onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })}
      right={
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <Button label="Accept" onPress={() => respond.mutate(true)} loading={respond.isPending} />
          <Button label="Decline" variant="ghost" onPress={() => respond.mutate(false)} />
        </View>
      }
    />
  );
}

/** S28 Clubs and communities — joined groups, discoverable communities, invitations and explicit join/leave. */
export default function Clubs() {
  const { profile } = useSession();
  const mine = useMyClubs();
  const [query, setQuery] = useState('');
  const discover = useQuery({
    queryKey: ['discover_clubs', profile?.district_id, query],
    queryFn: () => rpc<DiscoverClub[]>('discover_clubs', { p_district: profile?.district_id ?? null, p_query: query.trim() || null, p_limit: 30 })
  });
  const active = (mine.data ?? []).filter((c) => c.state === 'active');
  const invites = (mine.data ?? []).filter((c) => c.state === 'invited');
  const requested = (mine.data ?? []).filter((c) => c.state === 'requested');

  return (
    <Screen onRefresh={() => { void mine.refetch(); void discover.refetch(); }} refreshing={mine.isRefetching}>
      <TopBar title="Clubs" />
      <Txt variant="caption">Membership is always your choice. Following someone or running nearby never adds you to a group.</Txt>
      {mine.isLoading ? <LoadingState /> : mine.error ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> : (
        <>
          {invites.length ? (
            <Section title="Invitations">
              {invites.map((c) => <InviteRow key={c.id} c={c} />)}
            </Section>
          ) : null}
          <Section title="Your groups" action={<Button variant="ghost" label="Create" onPress={() => router.push('/club/create')} />}>
            {active.length === 0 ? <Txt color="textMuted">You have not joined any clubs or communities yet.</Txt> : null}
            {active.map((c) => (
              <Row key={c.id} title={c.name} subtitle={`${c.kind === 'club' ? 'Club' : 'Community'} · ${c.member_count} members${c.role !== 'member' ? ` · ${c.role}` : ''}`} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />
            ))}
            {requested.map((c) => (
              <Row key={c.id} title={c.name} subtitle="Request pending" right={<Badge label="Requested" tone="muted" />} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />
            ))}
          </Section>
        </>
      )}
      <Section title="Discover">
        <TextField label="Search clubs and communities" value={query} onChangeText={setQuery} autoCapitalize="none" />
        {discover.isLoading ? <LoadingState /> : discover.error ? <ErrorState error={discover.error} onRetry={() => void discover.refetch()} /> : discover.data?.length ? (
          discover.data.map((c) => (
            <Row
              key={c.id}
              title={c.name}
              subtitle={`${c.kind === 'club' ? 'Club' : 'Community'} · ${c.city_label ?? 'Any area'} · ${c.member_count} members · ${c.join_policy === 'open' ? 'Open to join' : c.join_policy === 'request' ? 'Request to join' : 'Invitation only'}`}
              right={c.my_state ? <Badge label={c.my_state === 'active' ? 'Member' : c.my_state} tone="muted" /> : undefined}
              onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })}
            />
          ))
        ) : (
          <EmptyState title="No public groups found" body={profile?.district_id ? 'Try another search, or create a club for your crew.' : 'Set your city in your profile to see groups near you.'} />
        )}
      </Section>
    </Screen>
  );
}
