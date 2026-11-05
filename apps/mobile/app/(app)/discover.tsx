import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { Avatar, Badge, Button, Chip, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';
import { ClubMonogram, clubTone } from '@/features/clubs/ClubBits';
import type { DiscoverClub } from '@/features/clubs/api';
import { useSignedUrl } from '@/features/social/media';
import { useRelationshipActions } from '@/features/social/profile';
import { useDistricts } from '@/features/profile/ProfileForm';
import { useSession } from '@/state/session';

interface Found {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_path: string | null;
  city_label: string | null;
  follow_state: 'none' | 'pending' | 'accepted';
}

function RunnerRow({ r }: { r: Found }) {
  const avatar = useSignedUrl('avatars', r.avatar_path);
  const { follow } = useRelationshipActions(r.user_id);
  return (
    <Row
      leading={<Avatar name={r.display_name} uri={avatar.data} size={44} />}
      title={r.display_name}
      subtitle={`@${r.handle}${r.city_label ? ` · ${r.city_label}` : ''}`}
      onPress={() => router.push({ pathname: '/profile/[id]', params: { id: r.user_id } })}
      right={r.follow_state === 'none' ? <Button label="Follow" size="sm" icon="plus" variant="secondary" onPress={() => follow.mutate()} loading={follow.isPending} /> : <Badge label={r.follow_state === 'pending' ? 'Requested' : 'Following'} tone="muted" />}
    />
  );
}

/** S07 Discover runners and communities — opted-in profiles and public communities for a selected city. */
export default function Discover() {
  const { profile } = useSession();
  const districts = useDistricts();
  const [district, setDistrict] = useState<string | null>(profile?.district_id ?? null);
  const [query, setQuery] = useState('');
  const runners = useQuery({ queryKey: ['search_profiles', query, district], queryFn: () => rpc<Found[]>('search_profiles', { p_query: query.trim(), p_district: district, p_limit: 30 }) });
  const clubs = useQuery({ queryKey: ['discover_clubs', district, query], queryFn: () => rpc<DiscoverClub[]>('discover_clubs', { p_district: district, p_query: query.trim() || null, p_limit: 20 }) });
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Discover' }} />
      <TextField label="Search by name or handle" value={query} onChangeText={setQuery} autoCapitalize="none" placeholder="Runner, handle or club" />
      {districts.data?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Area">
          <Chip label="Any area" selected={district === null} onPress={() => setDistrict(null)} />
          {districts.data.map((d) => <Chip key={d.id} label={d.name} selected={district === d.id} onPress={() => setDistrict(d.id)} />)}
        </View>
      ) : null}
      <Txt variant="caption">Only runners who chose to appear in Discover are listed.</Txt>
      <Section title="Runners" icon="user">
        {runners.isLoading ? <LoadingState /> : runners.error ? <ErrorState error={runners.error} onRetry={() => void runners.refetch()} /> : runners.data?.length ? <ListGroup>{runners.data.map((r) => <RunnerRow key={r.user_id} r={r} />)}</ListGroup> : <EmptyState icon="user" title="No runners found" body="Try another name or area." />}
      </Section>
      <Section title="Communities and clubs" icon="clubs">
        {clubs.isLoading ? <LoadingState /> : clubs.data?.length ? (
          <ListGroup>
            {clubs.data.map((c) => <Row key={c.id} leading={<ClubMonogram name={c.name} tone={clubTone(c.id)} size={44} />} title={c.name} subtitle={`${c.kind === 'club' ? 'Club' : 'Community'} · ${c.member_count} members`} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />)}
          </ListGroup>
        ) : <EmptyState icon="clubs" title="No public groups found" />}
      </Section>
    </Screen>
  );
}
