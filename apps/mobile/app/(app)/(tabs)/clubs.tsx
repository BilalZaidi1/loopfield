import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { ArrowLink, Badge, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { ClubCard, ClubMonogram, clubTone } from '@/features/clubs/ClubBits';
import { useLayout } from '@/theme/layout';
import { TopBar } from '@/components/TopBar';
import { useMembershipActions, useMyClubs, type DiscoverClub, type MyClub } from '@/features/clubs/api';
import { useSession } from '@/state/session';
import { spacing } from '@/theme/tokens';

function InviteCard({ c }: { c: MyClub }) {
  const { respond } = useMembershipActions(c.id, c.kind, c.visibility);
  return (
    <Card tone="orange" accessibilityLabel={`Invitation to ${c.name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <ClubMonogram name={c.name} tone="orange" size={48} inverted />
        <View style={{ flex: 1 }}>
          <Txt variant="label" color="textMuted">You are invited</Txt>
          <Txt variant="headline" numberOfLines={2}>{c.name}</Txt>
        </View>
      </View>
      <Txt color="textMuted">{`${c.kind === 'club' ? 'Club' : 'Community'} · ${c.member_count} members · ${c.visibility === 'private' ? 'private' : 'public'}`}</Txt>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Accept" arrow onPress={() => respond.mutate(true)} loading={respond.isPending} style={{ flex: 1 }} />
        <Button label="Decline" variant="ghost" onPress={() => respond.mutate(false)} />
      </View>
      <ArrowLink label="See the group first" onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />
    </Card>
  );
}

/** S28 Clubs and communities — joined groups, discoverable communities, invitations and explicit join/leave. */
export default function Clubs() {
  const { profile } = useSession();
  const { isTablet } = useLayout();
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
      {mine.isLoading ? <LoadingState variant="cards" /> : mine.error ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> : (
        <>
          {invites.map((c) => <InviteCard key={c.id} c={c} />)}
          <Section title="Your groups" icon="clubs" action={<Button variant="secondary" size="sm" icon="plus" label="Create" onPress={() => router.push('/club/create')} />}>
            {active.length === 0 ? (
              <Card tone="soft">
                <Txt variant="headline">Run with your people</Txt>
                <Txt color="textMuted">Join a club below, or create one for your crew. Membership is always your choice: following someone or running nearby never adds you to a group.</Txt>
                <Button label="Create a club" arrow onPress={() => router.push('/club/create')} />
              </Card>
            ) : (
              <ScrollView horizontal={!isTablet} showsHorizontalScrollIndicator={false} contentContainerStyle={isTablet ? styles.grid : { gap: spacing.md, paddingRight: spacing.lg }} style={isTablet ? undefined : { marginHorizontal: -spacing.xl, paddingLeft: spacing.xl }}>
                {active.map((c) => <ClubCard key={c.id} club={c} width={isTablet ? undefined : 232} />)}
              </ScrollView>
            )}
            {requested.length ? (
              <ListGroup>
                {requested.map((c) => (
                  <Row key={c.id} leading={<ClubMonogram name={c.name} tone={clubTone(c.id)} size={40} />} title={c.name} subtitle="Request pending" right={<Badge label="Requested" tone="muted" />} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />
                ))}
              </ListGroup>
            ) : null}
          </Section>
        </>
      )}
      <Section title="Discover" icon="search" subtitle={profile?.city_label ? `Groups around ${profile.city_label}` : undefined}>
        <TextField label="Search clubs and communities" value={query} onChangeText={setQuery} autoCapitalize="none" placeholder="Name or area" />
        {discover.isLoading ? <LoadingState /> : discover.error ? <ErrorState error={discover.error} onRetry={() => void discover.refetch()} /> : discover.data?.length ? (
          <ListGroup>
            {discover.data.map((c) => (
              <Row
                key={c.id}
                leading={<ClubMonogram name={c.name} tone={clubTone(c.id)} size={44} />}
                title={c.name}
                subtitle={`${c.kind === 'club' ? 'Club' : 'Community'} · ${c.city_label ?? 'Any area'} · ${c.member_count} members\n${c.join_policy === 'open' ? 'Open to join' : c.join_policy === 'request' ? 'Request to join' : 'Invitation only'}`}
                right={c.my_state ? <Badge label={c.my_state === 'active' ? 'Member' : c.my_state} tone={c.my_state === 'active' ? 'success' : 'muted'} /> : undefined}
                onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })}
              />
            ))}
          </ListGroup>
        ) : (
          <EmptyState icon="clubs" title="No public groups found" body={profile?.district_id ? 'Try another search, or create a club for your crew.' : 'Set your city in your profile to see groups near you.'} />
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }
});
