import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { Avatar, Badge, Banner, Button, Chip, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';
import { ClubLogo } from '@/features/clubs/ClubBits';
import type { DiscoverClub } from '@/features/clubs/api';
import { useSignedUrl } from '@/features/social/media';
import { useRelationshipActions } from '@/features/social/profile';
import { placeText } from '@/features/profile/location';
import { countryName } from '@/lib/countries';
import { useSession } from '@/state/session';

interface Found {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_path: string | null;
  city_label: string | null;
  country_code: string | null;
  follow_state: 'none' | 'pending' | 'accepted';
}

type Scope = 'city' | 'country' | 'everywhere';

function RunnerRow({ r }: { r: Found }) {
  const avatar = useSignedUrl('avatars', r.avatar_path);
  const { follow } = useRelationshipActions(r.user_id);
  return (
    <Row
      leading={<Avatar name={r.display_name} uri={avatar.data} size={44} />}
      title={r.display_name}
      subtitle={[`@${r.handle}`, placeText(r.city_label, r.country_code)].filter(Boolean).join(' · ')}
      onPress={() => router.push({ pathname: '/profile/[id]', params: { id: r.user_id } })}
      right={r.follow_state === 'none' ? <Button label="Follow" size="sm" icon="plus" variant="secondary" onPress={() => follow.mutate()} loading={follow.isPending} /> : <Badge label={r.follow_state === 'pending' ? 'Requested' : 'Following'} tone="muted" />}
    />
  );
}

/**
 * S07 Discover runners and communities — opted-in profiles and public communities in the runner's city,
 * their country or everywhere (the place on their profile; never their live location).
 */
export default function Discover() {
  const { profile } = useSession();
  const city = profile?.city_label?.trim() || null;
  const country = profile?.country_code ?? null;
  const [scope, setScope] = useState<Scope>(city && country ? 'city' : country ? 'country' : 'everywhere');
  const [query, setQuery] = useState('');
  const place = scope === 'city' && city && country ? { p_country: country, p_city: city } : scope !== 'everywhere' && country ? { p_country: country } : {};
  const runners = useQuery({ queryKey: ['search_profiles', query, place], queryFn: () => rpc<Found[]>('search_profiles', { p_query: query.trim(), p_limit: 30, ...place }) });
  const clubs = useQuery({ queryKey: ['discover_clubs', place, query], queryFn: () => rpc<DiscoverClub[]>('discover_clubs', { p_query: query.trim() || null, p_limit: 20, ...place }) });
  const where = scope === 'city' ? city : scope === 'country' ? countryName(country) : null;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Discover' }} />
      <TextField label="Search by name or handle" value={query} onChangeText={setQuery} autoCapitalize="none" placeholder="Runner, handle or club" />
      {country ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Where">
          {city ? <Chip icon="pin" label={city} selected={scope === 'city'} onPress={() => setScope('city')} /> : null}
          <Chip icon="compass" label={countryName(country) ?? country} selected={scope === 'country'} onPress={() => setScope('country')} />
          <Chip icon="globe" label="Everywhere" selected={scope === 'everywhere'} onPress={() => setScope('everywhere')} />
        </View>
      ) : (
        <Banner tone="info" text="Add your city and country to your profile to find runners near you." action={{ label: 'Edit profile', onPress: () => router.push('/settings/profile') }} />
      )}
      <Txt variant="caption">Only runners who chose to appear in Discover are listed.</Txt>
      <Section title="Runners" icon="user">
        {runners.isLoading ? <LoadingState /> : runners.error ? <ErrorState error={runners.error} onRetry={() => void runners.refetch()} /> : runners.data?.length ? <ListGroup>{runners.data.map((r) => <RunnerRow key={r.user_id} r={r} />)}</ListGroup> : (
          <EmptyState icon="user" title={where ? `No runners found in ${where}` : 'No runners found'} body={scope === 'everywhere' ? 'Try another name.' : 'Try another name, or look further afield.'} />
        )}
      </Section>
      <Section title="Communities and clubs" icon="clubs">
        {clubs.isLoading ? <LoadingState /> : clubs.data?.length ? (
          <ListGroup>
            {clubs.data.map((c) => <Row key={c.id} leading={<ClubLogo club={c} size={44} />} title={c.name} subtitle={`Community · ${c.member_count} members`} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />)}
          </ListGroup>
        ) : <EmptyState icon="clubs" title={where ? `No public communities in ${where} yet` : 'No public communities found'} />}
      </Section>
    </Screen>
  );
}
