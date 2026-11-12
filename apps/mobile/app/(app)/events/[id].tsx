import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Avatar, Badge, Banner, Button, Card, confirm, EmptyState, ErrorState, ListGroup, LoadingState, ProgressBar, Row, Screen, Section, Sheet, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useMyClubs } from '@/features/clubs/api';
import { ClubLogo } from '@/features/clubs/ClubBits';
import { phaseText, useCancelEvent, useEvent, useEventStandings, useJoinEvent, useLeaveEvent, type EventRow, type StandingRow } from '@/features/events/api';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtArea, fmtDate, fmtDistance } from '@/lib/format';
import { useCompetition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

const when = (iso: string) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** How an event is scored, in plain words (shown before anyone joins). */
function rulesText(e: EventRow): string {
  const team = e.team_mode === 'club' ? ' You run for one of your clubs; clubs are ranked by their runners\' combined total.' : '';
  if (e.event_type === 'territory') {
    return `Land taken by the loops you run for the public race in ${e.region_name ?? 'this region'}, from runs you start after joining. Event land is separate: it never changes the all-time map or the season race.${team}`;
  }
  return `Server-verified distance of every run you start after joining, until the event ends. Only your total appears in the standings, never your routes.${team}`;
}

/** One event: what it is, joining and leaving, and its own standings (final once it is archived). */
export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const units = useUnits();
  const { settings } = useSession();
  const { select } = useCompetition();
  const event = useEvent(id);
  const e = event.data;
  const standings = useEventStandings(id, Boolean(e));
  const join = useJoinEvent(e);
  const leave = useLeaveEvent(e);
  const cancel = useCancelEvent(e);
  const clubs = useMyClubs();
  const [pickClub, setPickClub] = useState(false);
  if (event.isLoading) return <Screen><Stack.Screen options={{ title: 'Event' }} /><LoadingState variant="cards" /></Screen>;
  if (event.error) return <Screen><Stack.Screen options={{ title: 'Event' }} /><ErrorState error={event.error} onRetry={() => void event.refetch()} /></Screen>;
  if (!e) return <Screen><Stack.Screen options={{ title: 'Event' }} /><EmptyState icon="flag" title="Event not found" body="It may be for club members only, or it was removed." /></Screen>;

  const open = e.phase === 'upcoming' || e.phase === 'live';
  const valueText = (v: number) => (e.event_type === 'territory' ? fmtArea(v, units) : fmtDistance(v, units, 1));
  const rows = standings.data ?? [];
  const mine = rows.find((r) => r.is_me);
  const myClubs = (clubs.data ?? []).filter((c) => c.state === 'active');
  const needsTerritory = e.event_type === 'territory' && !settings?.territory_competition_enabled;
  const doJoin = (clubId: string | null) => join.mutate(clubId, { onSuccess: () => setPickClub(false) });

  return (
    <Screen onRefresh={() => { void event.refetch(); void standings.refetch(); }} refreshing={event.isRefetching}>
      <Stack.Screen options={{ title: 'Event' }} />
      <Card tone={e.event_type === 'territory' ? 'violet' : 'blue'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name={e.event_type === 'territory' ? 'hexagon' : 'route'} color="#FFFFFF" size={22} />
          <Txt variant="label" style={{ flex: 1 }}>{e.event_type === 'territory' ? 'Territory event' : 'Distance event'}</Txt>
        </View>
        <Txt variant="title">{e.name}</Txt>
        {e.host_club_id && e.host_club_name ? (
          <Pressable onPress={() => router.push({ pathname: '/club/[id]', params: { id: e.host_club_id! } })} accessibilityRole="link" accessibilityLabel={`Hosted by ${e.host_club_name}. Open it`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', minHeight: 36 }}>
            <ClubLogo club={{ id: e.host_club_id, name: e.host_club_name, avatar_path: e.host_avatar_path, tone: e.host_tone }} size={28} inverted />
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{`Hosted by ${e.host_club_name}`}</Txt>
          </Pressable>
        ) : null}
        <Txt>{`${when(e.starts_at)} – ${when(e.ends_at)}`}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Badge icon={e.phase === 'live' ? 'pulse' : 'calendar'} label={phaseText(e)} />
          <Badge icon="user" label={`${e.participants} taking part`} />
          {e.team_mode === 'club' ? <Badge icon="clubs" label="Club against club" /> : null}
          {e.joined ? <Badge icon="check" label="You joined" /> : null}
        </View>
        {e.target_m && e.event_type === 'distance' && mine ? (
          <View style={{ gap: spacing.xs }}>
            <Txt variant="label">{`${fmtDistance(mine.value, units, 1)} of ${fmtDistance(e.target_m, units, 0)}`}</Txt>
            <ProgressBar value={Math.min(1, mine.value / e.target_m)} label={`Goal progress: ${fmtDistance(mine.value, units, 1)} of ${fmtDistance(e.target_m, units, 0)}`} />
          </View>
        ) : null}
      </Card>

      {e.description ? <Txt>{e.description}</Txt> : null}
      <Section title="How it works" icon="info">
        <Txt color="textMuted">{rulesText(e)}</Txt>
        {e.event_type === 'territory' ? <Txt variant="caption">Reclaiming with points is not available in events. Land appears at least 30 minutes after a run, as on the map.</Txt> : null}
      </Section>

      {open ? (
        <View style={{ gap: spacing.sm }}>
          {join.error ? <Banner tone="danger" text={friendlyError(join.error)} /> : null}
          {leave.error ? <Banner tone="danger" text={friendlyError(leave.error)} /> : null}
          {e.joined ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {e.event_type === 'territory' && e.phase === 'live' ? (
                <Button label="Show on the map" icon="map" style={{ flex: 1 }} onPress={() => {
                  select(e.id);
                  track('event_action', { action: 'shown_on_map', event_type: e.event_type, team_mode: e.team_mode, host: e.host_club_id ? 'club' : 'operator' });
                  router.push('/map');
                }} />
              ) : null}
              <Button label="Leave" variant="secondary" style={{ flex: 1 }} loading={leave.isPending} onPress={() =>
                confirm('Leave this event?', e.event_type === 'territory' ? 'Your land in this event is removed. The all-time map and the season race are not affected.' : 'Your distance stops counting for this event.', 'Leave', () => leave.mutate())} />
            </View>
          ) : needsTerritory ? (
            <Banner tone="info" text="Turn on territory in Privacy settings to join territory events." action={{ label: 'Privacy', onPress: () => router.push('/settings/privacy') }} />
          ) : (
            <Button label={e.team_mode === 'club' ? 'Join for one of your clubs' : 'Join the event'} size="lg" arrow loading={join.isPending}
              disabled={e.team_mode === 'club' && !myClubs.length}
              hint={e.team_mode === 'club' && !myClubs.length ? 'Join a club first to take part' : undefined}
              onPress={() => (e.team_mode === 'club' ? setPickClub(true) : doJoin(null))} />
          )}
          {e.event_type === 'territory' && e.phase === 'live' && !e.joined ? (
            <Button label="Watch on the map" variant="ghost" icon="map" onPress={() => { select(e.id); router.push('/map'); }} />
          ) : null}
        </View>
      ) : null}

      <Section title={e.phase === 'finished' ? 'Final standings' : 'Standings'} icon="medal">
        {standings.isLoading ? <LoadingState rows={4} /> : standings.error ? <ErrorState error={standings.error} onRetry={() => void standings.refetch()} /> : rows.length ? (
          <ListGroup>
            {rows.map((r) => <StandingLine key={`${r.entrant_kind}-${r.entrant_id ?? r.rank}-${r.rank}`} row={r} value={valueText(r.value)} />)}
          </ListGroup>
        ) : (
          <Txt color="textMuted">{e.phase === 'upcoming' ? 'Standings start when the event does.' : e.event_type === 'territory' ? 'No event land published yet.' : 'No verified distance yet.'}</Txt>
        )}
        {e.phase !== 'finished' && rows.length ? <Txt variant="caption">Standings update as runs are verified{e.event_type === 'territory' ? ' and published' : ''}. Results are final a day after the event ends.</Txt> : null}
      </Section>

      {e.can_manage && open ? (
        <Button label="Cancel the event" variant="danger" loading={cancel.isPending} onPress={() =>
          confirm('Cancel this event?', 'Everyone taking part is told. Standings are not kept for cancelled events. This cannot be undone.', 'Cancel event', () => cancel.mutate())} />
      ) : null}
      {cancel.error ? <Banner tone="danger" text={friendlyError(cancel.error)} /> : null}

      <Sheet visible={pickClub} title="Run for which club?" onClose={() => setPickClub(false)}>
        <Txt color="textMuted">You run for the same club until the event ends.</Txt>
        <ListGroup>
          {myClubs.map((c) => <Row key={c.id} icon="clubs" title={c.name} subtitle={`${c.member_count} members`} onPress={() => doJoin(c.id)} />)}
        </ListGroup>
        {join.error ? <Banner tone="danger" text={friendlyError(join.error)} /> : null}
      </Sheet>
    </Screen>
  );
}

function StandingLine({ row: r, value }: { row: StandingRow; value: string }) {
  const title = r.is_me ? (r.entrant_kind === 'club' ? `${r.display_name} (your club)` : 'You') : r.display_name;
  return (
    <Row
      rank={r.rank}
      highlight={r.is_me}
      leading={<Avatar name={r.display_name} size={36} />}
      title={title}
      subtitle={r.entrant_kind === 'club' ? `${r.members ?? 0} ${r.members === 1 ? 'runner' : 'runners'}` : r.handle && !r.is_me ? `@${r.handle}` : undefined}
      value={value}
      onPress={r.entrant_kind === 'runner' && r.entrant_id && !r.is_me ? () => router.push({ pathname: '/profile/[id]', params: { id: r.entrant_id! } }) :
        r.entrant_kind === 'club' && r.entrant_id ? () => router.push({ pathname: '/club/[id]', params: { id: r.entrant_id! } }) : undefined}
    />
  );
}
