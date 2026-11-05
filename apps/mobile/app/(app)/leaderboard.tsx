import { useState } from 'react';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { fmtArea } from '@/lib/format';
import { Badge, EmptyState, ErrorState, LoadingState, Row, Screen, Segmented, Txt } from '@/components/ui';
import { useDistricts } from '@/features/profile/ProfileForm';
import { useCompetition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';

interface LeaderRow {
  rank: number;
  user_id: string;
  handle: string;
  display_name: string;
  area_m2: number;
  is_me: boolean;
}

/** S19 Territory leaderboard — current controlled-area ranking, district or competition filter and your place. */
export default function Leaderboard() {
  const units = useUnits();
  const { profile } = useSession();
  const { competitions, competition, season, select } = useCompetition();
  const districts = useDistricts();
  const [district, setDistrict] = useState<string>('all');
  const board = useQuery({
    queryKey: ['territory_leaderboard', competition?.id, season?.id, district],
    enabled: Boolean(competition && season),
    queryFn: () => rpc<LeaderRow[]>('territory_leaderboard', { p_competition: competition!.id, p_season: season!.id, p_district: district === 'all' ? null : district, p_limit: 100 })
  });
  const regionDistricts = (districts.data ?? []).filter((d) => d.region_id === competition?.region_id);
  const me = board.data?.find((r) => r.is_me);
  return (
    <Screen onRefresh={() => void board.refetch()} refreshing={board.isRefetching}>
      <Stack.Screen options={{ title: 'Leaderboard' }} />
      {competitions.length > 1 ? <Segmented label="Competition" value={competition?.id ?? ''} onChange={select} options={competitions.map((c) => ({ value: c.id, label: c.name }))} /> : null}
      {regionDistricts.length ? <Segmented label="Area" value={district} onChange={setDistrict} options={[{ value: 'all', label: 'Whole competition' }, ...regionDistricts.map((d) => ({ value: d.id, label: d.name }))]} /> : null}
      {!season ? <EmptyState title="No active season" /> : board.isLoading ? <LoadingState /> : board.error ? <ErrorState error={board.error} onRetry={() => void board.refetch()} /> : board.data?.length ? (
        <>
          <Txt variant="caption">Published controlled area this season. Results update at least 30 minutes after runs finish.</Txt>
          {me ? <Row title={`Your place: ${me.rank}`} right={<Badge label={fmtArea(me.area_m2, units)} tone="success" />} /> : <Txt color="textMuted">You have no published land in this view yet.</Txt>}
          {board.data.map((r) => (
            <Row key={r.user_id} title={`${r.rank}. ${r.is_me ? 'You' : r.display_name}`} subtitle={r.is_me ? undefined : `@${r.handle}`} right={<Txt variant="label">{fmtArea(r.area_m2, units)}</Txt>} onPress={r.is_me ? undefined : () => router.push({ pathname: '/profile/[id]', params: { id: r.user_id } })} />
          ))}
        </>
      ) : <EmptyState title="No published land yet" body={profile?.district_id ? 'Be the first to close a loop this season.' : undefined} />}
    </Screen>
  );
}
