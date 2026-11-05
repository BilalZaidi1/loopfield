import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { fmtArea, splitValue } from '@/lib/format';
import { Avatar, Card, Chip, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Segmented, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useDistricts } from '@/features/profile/ProfileForm';
import { daysLeft, useLeaderboard, type LeaderRow } from '@/features/territory/useTerritoryStats';
import { useCompetition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';
import { radius, spacing, useTheme } from '@/theme/tokens';

/** S19 Territory leaderboard — current controlled-area ranking, district or competition filter and your place. */
export default function Leaderboard() {
  const units = useUnits();
  const { profile } = useSession();
  const { competitions, competition, season, select } = useCompetition();
  const districts = useDistricts();
  const [district, setDistrict] = useState<string>('all');
  const board = useLeaderboard(district === 'all' ? null : district, 100);
  const regionDistricts = (districts.data ?? []).filter((d) => d.region_id === competition?.region_id);
  const rows = board.data ?? [];
  const me = rows.find((r) => r.is_me);
  const left = daysLeft(season?.ends_at);
  const podium = rows.length >= 3 ? rows.slice(0, 3) : [];
  const rest = podium.length ? rows.slice(3) : rows;
  const area = me ? splitValue(fmtArea(me.area_m2, units)) : null;
  return (
    <Screen onRefresh={() => void board.refetch()} refreshing={board.isRefetching}>
      <Stack.Screen options={{ title: 'Leaderboard' }} />
      {competitions.length > 1 ? <Segmented label="Competition" value={competition?.id ?? ''} onChange={select} options={competitions.map((c) => ({ value: c.id, label: c.name }))} /> : null}
      {season ? (
        <Card tone="orange">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="trophy" color="#121318" size={22} />
            <Txt variant="heading" style={{ flex: 1 }} numberOfLines={1}>{`${competition?.name ?? 'Competition'} · season ${season.number}`}</Txt>
          </View>
          {me && area ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xl }}>
              <View>
                <Txt variant="label" color="textMuted">Your place</Txt>
                <Txt variant="hero" style={{ fontSize: 64, lineHeight: 66 }}>{`#${me.rank}`}</Txt>
              </View>
              <View style={{ paddingBottom: spacing.sm }}>
                <Txt variant="metric">{area.value}<Txt variant="heading" color="textMuted">{` ${area.unit}`}</Txt></Txt>
                <Txt variant="caption">published land</Txt>
              </View>
            </View>
          ) : (
            <Txt variant="headline">{board.isLoading ? 'Loading your place…' : 'You have no published land in this view yet.'}</Txt>
          )}
          <Txt color="textMuted">{left === 0 ? 'Last day of the season.' : `${left} days left in the season.`} Results update at least 30 minutes after runs finish.</Txt>
        </Card>
      ) : null}
      {regionDistricts.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Area">
          <Chip label="Whole competition" selected={district === 'all'} onPress={() => setDistrict('all')} />
          {regionDistricts.map((d) => <Chip key={d.id} label={d.name} selected={district === d.id} onPress={() => setDistrict(d.id)} />)}
        </View>
      ) : null}
      {!season ? (
        <EmptyState icon="calendar" title="No active season" body="Rankings return when the next season starts." />
      ) : board.isLoading ? (
        <LoadingState rows={6} />
      ) : board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : rows.length ? (
        <>
          {podium.length ? <Podium rows={podium} /> : null}
          {rest.length ? (
            <ListGroup>
              {rest.map((r) => (
                <Row
                  key={r.user_id}
                  rank={r.rank}
                  highlight={r.is_me}
                  leading={<Avatar name={r.display_name} size={36} />}
                  title={r.is_me ? 'You' : r.display_name}
                  subtitle={r.is_me ? undefined : `@${r.handle}`}
                  value={fmtArea(r.area_m2, units)}
                  onPress={r.is_me ? undefined : () => router.push({ pathname: '/profile/[id]', params: { id: r.user_id } })}
                />
              ))}
            </ListGroup>
          ) : null}
          <Txt variant="caption">Published controlled area this season.</Txt>
        </>
      ) : (
        <EmptyState icon="hexagon" title="No published land yet" body={profile?.district_id ? 'Be the first to close a loop this season.' : undefined} action={{ label: 'Start a run', onPress: () => router.push('/record') }} />
      )}
    </Screen>
  );
}

/** First, second and third place on steps (real ranking rows; second on the left, as on a podium). */
function Podium({ rows }: { rows: LeaderRow[] }) {
  const t = useTheme();
  const p = t.palette;
  const units = useUnits();
  const order = [rows[1]!, rows[0]!, rows[2]!];
  const heights = [96, 128, 80];
  const tones = [t.blocks.blue.bg, t.blocks.violet.bg, t.blocks.orange.bg];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }} accessibilityRole="summary" accessibilityLabel={`Top three: ${rows.map((r) => `${r.rank}. ${r.is_me ? 'You' : r.display_name}, ${fmtArea(r.area_m2, units)}`).join('; ')}`}>
      {order.map((r, i) => (
        <Pressable key={r.user_id} disabled={r.is_me} onPress={() => router.push({ pathname: '/profile/[id]', params: { id: r.user_id } })} style={{ flex: 1, alignItems: 'center', gap: spacing.sm }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {r.rank === 1 ? <Icon name="crown" color={p.orange} size={26} /> : null}
          <Avatar name={r.display_name} size={i === 1 ? 64 : 52} ring={tones[i]} />
          <Txt variant="label" numberOfLines={1} align="center">{r.is_me ? 'You' : r.display_name.split(/\s+/)[0]}</Txt>
          <View style={{ width: '100%', height: heights[i], borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, backgroundColor: tones[i], alignItems: 'center', paddingTop: spacing.sm, gap: 2 }}>
            <Txt variant="metric" style={{ color: i === 2 ? '#121318' : '#FFFFFF', fontSize: 30, lineHeight: 32 }}>{String(r.rank)}</Txt>
            <Txt variant="micro" style={{ color: i === 2 ? '#121318' : '#FFFFFF' }} numberOfLines={1}>{fmtArea(r.area_m2, units)}</Txt>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
