import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { ArrowLink, Badge, Button, Card, CardRail, Chip, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { ClubCard, ClubLogo } from '@/features/clubs/ClubBits';
import { useLayout } from '@/theme/layout';
import { TopBar } from '@/components/TopBar';
import { kindLabel, useMembershipActions, useMyClubs, type DiscoverClub, type MyClub } from '@/features/clubs/api';
import { useSession } from '@/state/session';
import { useFeature } from '@/lib/appConfig';
import { PausedNote, SuspendedNotice, useSuspended } from '@/components/Notices';
import { spacing } from '@/theme/tokens';

function InviteCard({ c }: { c: MyClub }) {
  const { respond } = useMembershipActions(c.id, c.kind, c.visibility);
  return (
    <Card tone="orange" accessibilityLabel={`Invitation to ${c.name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <ClubLogo club={c} size={48} inverted />
        <View style={{ flex: 1 }}>
          <Txt variant="label" color="textMuted">You are invited</Txt>
          <Txt variant="headline" numberOfLines={2}>{c.name}</Txt>
        </View>
      </View>
      <Txt color="textMuted">{`${kindLabel(c.kind)} · ${c.member_count} members · ${c.visibility === 'private' ? 'private' : 'public'}`}</Txt>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Accept" arrow onPress={() => respond.mutate(true)} loading={respond.isPending} style={{ flex: 1 }} />
        <Button label="Decline" variant="ghost" onPress={() => respond.mutate(false)} />
      </View>
      <ArrowLink label={c.kind === 'group' ? 'See the group first' : 'See the community first'} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />
    </Card>
  );
}

/**
 * S28 Communities and groups — two different things. Groups: small, private crews you are added to, with
 * a chat. Communities: public, private or invitation-only clubs with admins, announcements, races and
 * challenges. Membership is always an explicit choice (following someone never adds you to anything).
 */
export default function Clubs() {
  const { profile } = useSession();
  const { isTablet } = useLayout();
  const mine = useMyClubs();
  // App control can pause new clubs; suspended accounts cannot create them either.
  const creationOn = useFeature('club_creation_enabled');
  const suspended = useSuspended();
  const canCreate = creationOn && !suspended;
  const [query, setQuery] = useState('');
  // Communities in the city on your profile first; everywhere when you have none or ask for it.
  const city = profile?.city_label?.trim() || null;
  const country = profile?.country_code ?? null;
  const [near, setNear] = useState(true);
  const local = near && Boolean(city && country);
  const discover = useQuery({
    queryKey: ['discover_clubs', local ? [country, city] : null, query],
    queryFn: () => rpc<DiscoverClub[]>('discover_clubs', { p_query: query.trim() || null, p_limit: 30, ...(local ? { p_country: country, p_city: city } : {}) })
  });
  const active = (mine.data ?? []).filter((c) => c.state === 'active');
  const groups = active.filter((c) => c.kind === 'group');
  const communities = active.filter((c) => c.kind === 'community');
  const invites = (mine.data ?? []).filter((c) => c.state === 'invited');
  const requested = (mine.data ?? []).filter((c) => c.state === 'requested');
  const rail = (list: MyClub[]) =>
    isTablet ? <View style={styles.grid}>{list.map((c) => <ClubCard key={c.id} club={c} />)}</View> : <CardRail>{list.map((c) => <ClubCard key={c.id} club={c} width={232} />)}</CardRail>;

  return (
    <Screen onRefresh={() => { void mine.refetch(); void discover.refetch(); }} refreshing={mine.isRefetching}>
      <TopBar title="Communities" />
      {mine.isLoading ? <LoadingState variant="cards" /> : mine.error ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> : (
        <>
          {invites.map((c) => <InviteCard key={c.id} c={c} />)}
          {!creationOn ? <PausedNote feature="club_creation_enabled" text="Creating groups and communities is paused for now. You can still join and use the ones you are in." /> : suspended ? <SuspendedNotice what="club" compact /> : null}
          <Section title="Your groups" icon="chat" action={canCreate ? <Button variant="secondary" size="sm" icon="plus" label="New group" onPress={() => router.push({ pathname: '/club/create', params: { kind: 'group' } })} /> : undefined}>
            {groups.length ? rail(groups) : (
              <Card tone="soft">
                <Txt variant="headline">A private crew with its own chat</Txt>
                <Txt color="textMuted">Groups are for the people you already run with: always private, and only the people you add can see them.</Txt>
                {canCreate ? <Button label="Start a group" arrow onPress={() => router.push({ pathname: '/club/create', params: { kind: 'group' } })} /> : null}
              </Card>
            )}
          </Section>
          <Section title="Your communities" icon="clubs" action={canCreate ? <Button variant="secondary" size="sm" icon="plus" label="New community" onPress={() => router.push({ pathname: '/club/create', params: { kind: 'community' } })} /> : undefined}>
            {communities.length ? rail(communities) : <Txt color="textMuted">Running clubs and local communities you join appear here. Find one below, or start one.</Txt>}
            {requested.length ? (
              <ListGroup>
                {requested.map((c) => (
                  <Row key={c.id} leading={<ClubLogo club={c} size={40} />} title={c.name} subtitle="Request pending" right={<Badge label="Requested" tone="muted" />} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />
                ))}
              </ListGroup>
            ) : null}
          </Section>
        </>
      )}
      <Section title="Discover communities" icon="search" subtitle={local ? `In ${city}` : 'Everywhere'}>
        <TextField label="Search communities" value={query} onChangeText={setQuery} autoCapitalize="none" placeholder="Name" />
        {city && country ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Where">
            <Chip icon="pin" label={city} selected={local} onPress={() => setNear(true)} />
            <Chip icon="globe" label="Everywhere" selected={!local} onPress={() => setNear(false)} />
          </View>
        ) : null}
        {discover.isLoading ? <LoadingState /> : discover.error ? <ErrorState error={discover.error} onRetry={() => void discover.refetch()} /> : discover.data?.length ? (
          <ListGroup>
            {discover.data.map((c) => (
              <Row
                key={c.id}
                leading={<ClubLogo club={c} size={44} />}
                title={c.name}
                subtitle={`${c.city_label ?? 'Any area'} · ${c.member_count} members\n${c.join_policy === 'open' ? 'Open to join' : c.join_policy === 'request' ? 'Request to join' : 'Invitation only'}`}
                right={c.my_state && c.my_state !== 'none' ? <Badge label={c.my_state === 'active' ? 'Member' : c.my_state} tone={c.my_state === 'active' ? 'success' : 'muted'} /> : undefined}
                onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })}
              />
            ))}
          </ListGroup>
        ) : (
          <EmptyState icon="clubs" title={local ? `No public communities in ${city} yet` : 'No public communities found'}
            body={local ? 'Look everywhere, or start the first one here.' : city && country ? 'Try another search, or start a community.' : 'Add your city and country to your profile to see communities near you.'}
            action={local ? { label: 'Look everywhere', onPress: () => setNear(false) } : undefined} />
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }
});
