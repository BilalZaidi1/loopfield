import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Segmented, Txt } from '@/components/ui';
import { EventCard } from '@/features/events/EventCard';
import { useEvents } from '@/features/events/api';
import { useSession } from '@/state/session';
import { spacing } from '@/theme/tokens';

/**
 * Events: weekend territory challenges, city takeovers, distance months and club-against-club races.
 * Each has its own standings; none of them ever changes the all-time map or a season race.
 */
export default function Events() {
  const { roles } = useSession();
  const [scope, setScope] = useState<'current' | 'finished'>('current');
  const events = useEvents(scope);
  const operator = roles.includes('territory_operator') || roles.includes('admin');
  const rows = events.data ?? [];
  return (
    <Screen onRefresh={() => void events.refetch()} refreshing={events.isRefetching}>
      <Stack.Screen options={{ title: 'Events' }} />
      <Txt color="textMuted">Events run for a set time with their own standings. The all-time map and the season race never change because of them.</Txt>
      <Segmented label="Which events" value={scope} onChange={(v) => setScope(v as 'current' | 'finished')} options={[{ value: 'current', label: 'Now and upcoming' }, { value: 'finished', label: 'Finished' }]} />
      {events.isLoading ? (
        <LoadingState variant="cards" />
      ) : events.error ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : rows.length ? (
        <View style={{ gap: spacing.md }}>
          {rows.map((e) => <EventCard key={e.id} event={e} />)}
        </View>
      ) : (
        <EmptyState
          icon="flag"
          title={scope === 'current' ? 'No events right now' : 'No finished events yet'}
          body={scope === 'current' ? 'New challenges appear here. Your clubs can run their own too.' : 'Final standings of past events stay here.'}
        />
      )}
      {operator ? <Button label="Create an event" variant="secondary" icon="plus" onPress={() => router.push('/events/new')} /> : null}
    </Screen>
  );
}
