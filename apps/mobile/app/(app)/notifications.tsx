import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Button, ChipGroup, EmptyState, ErrorState, IconButton, ListGroup, LoadingState, Row, Screen } from '@/components/ui';
import { usePalette } from '@/theme/tokens';
import { routeForNotification } from '@/notifications/push';
import { FILTERS, filterOf, presentNotification, type NotificationFilter } from '@/notifications/present';
import { useSession, useUnits } from '@/state/session';

interface NotificationRow {
  id: string;
  category: 'social' | 'message' | 'club' | 'competitive' | 'system';
  kind: string;
  actor_id: string | null;
  object_type: string | null;
  object_id: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
  actor: { display_name: string } | null;
}

const EMPTY: Record<NotificationFilter, string> = {
  all: 'Follow requests, comments, community updates, event reminders and your land changes appear here.',
  land: 'Land you capture or lose appears here once it is published, plus your daily land update.',
  social: 'Follows, comments, cheers, mentions and runs your friends share.',
  clubs: 'Invitations, new members, announcements and decisions in your communities and groups.',
  events: 'Reminders, starts, cancellations and results of events, challenges and season races.',
  milestones: 'Badges you earn appear here.',
  account: 'Reviews, decisions and account updates.'
};

/** S13 Notifications — every update with read state, filters by kind, mark all read and links to what changed. */
export default function Notifications() {
  const p = usePalette();
  const units = useUnits();
  const { userId } = useSession();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const list = useQuery({
    queryKey: ['notifications', userId],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from('notifications')
        .select('id, category, kind, actor_id, object_type, object_id, data, read_at, created_at, actor:profiles!notifications_actor_id_fkey(display_name)')
        .order('created_at', { ascending: false })
        .limit(150);
      if (error) throw error;
      return (data ?? []) as unknown as NotificationRow[];
    }
  });
  const markAll = useMutation({
    mutationFn: (ids: string[] | null) => rpc('mark_notifications_read', { p_ids: ids }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['badge_counts'] });
    }
  });
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['badge_counts'] });
  }, [qc]);

  const open = (n: NotificationRow) => {
    if (!n.read_at) void rpc('mark_notifications_read', { p_ids: [n.id] }).then(() => {
      void qc.invalidateQueries({ queryKey: ['badge_counts'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    });
    track('notification_opened', { category: n.category });
    router.push(routeForNotification(n));
  };

  const rows = (list.data ?? []).filter((n) => filter === 'all' || filterOf(n) === filter);
  const unreadIn = (f: NotificationFilter) => (list.data ?? []).filter((n) => !n.read_at && (f === 'all' || filterOf(n) === f)).length;
  const unread = rows.filter((n) => !n.read_at);
  const options = FILTERS.map((f) => {
    const count = unreadIn(f.value);
    return { value: f.value, label: count ? `${f.label} · ${count}` : f.label };
  });

  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Stack.Screen options={{ title: 'Notifications', headerRight: () => <IconButton icon="settings" label="Notification settings" onPress={() => router.push('/settings/notifications')} /> }} />
      <ChipGroup<NotificationFilter> label="Show" value={filter} onChange={setFilter} options={options} scroll />
      {unread.length ? (
        <View style={{ alignSelf: 'flex-end' }}>
          <Button variant="secondary" size="sm" icon="check" label={filter === 'all' ? 'Mark all as read' : 'Mark these as read'} loading={markAll.isPending}
            onPress={() => markAll.mutate(filter === 'all' ? null : unread.map((n) => n.id))} />
        </View>
      ) : null}
      {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : rows.length ? (
        <ListGroup>
          {rows.map((n) => {
            const shown = presentNotification(n, units);
            return (
              <Row
                key={n.id}
                icon={shown.icon}
                title={shown.title}
                subtitle={`${shown.body} · ${fmtRelative(n.created_at)}`}
                highlight={!n.read_at}
                right={!n.read_at ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.orange }} /> : undefined}
                onPress={() => open(n)}
                accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${shown.title}. ${shown.body}`}
              />
            );
          })}
        </ListGroup>
      ) : (
        <EmptyState icon="bell" title={filter === 'all' ? 'No notifications yet' : 'Nothing here yet'} body={EMPTY[filter]} />
      )}
    </Screen>
  );
}
