import { useEffect } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { safePushPreview } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Button, EmptyState, ErrorState, IconButton, ListGroup, LoadingState, Row, Screen } from '@/components/ui';
import type { IconName } from '@/components/icons';
import { usePalette } from '@/theme/tokens';
import { routeForNotification } from '@/notifications/push';
import { useSession } from '@/state/session';

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

/** S13 Notifications — social, membership and competitive updates with safe previews, read state and settings. */
const CATEGORY_ICON: Record<string, IconName> = { social: 'heart', message: 'chat', club: 'clubs', competitive: 'hexagon', system: 'info' };

export default function Notifications() {
  const p = usePalette();
  const { userId } = useSession();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['notifications', userId],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from('notifications')
        .select('id, category, kind, actor_id, object_type, object_id, data, read_at, created_at, actor:profiles!notifications_actor_id_fkey(display_name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as NotificationRow[];
    }
  });
  const markAll = useMutation({
    mutationFn: () => rpc('mark_notifications_read', { p_ids: null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['badge_counts'] });
    }
  });
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['badge_counts'] });
  }, [qc]);

  const open = (n: NotificationRow) => {
    if (!n.read_at) void rpc('mark_notifications_read', { p_ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ['badge_counts'] }));
    track('notification_opened', { category: n.category });
    router.push(routeForNotification(n));
  };

  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Stack.Screen options={{ title: 'Notifications', headerRight: () => <IconButton icon="settings" label="Notification settings" onPress={() => router.push('/settings/notifications')} /> }} />
      {list.data?.some((n) => !n.read_at) ? <View style={{ alignSelf: 'flex-end' }}><Button variant="secondary" size="sm" icon="check" label="Mark all as read" onPress={() => markAll.mutate()} /></View> : null}
      {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.data?.length ? (
        <ListGroup>
          {list.data.map((n) => {
            const preview = safePushPreview(n.kind, n.actor?.display_name ?? null);
            return (
              <Row
                key={n.id}
                icon={CATEGORY_ICON[n.category] ?? 'bell'}
                title={preview.title}
                subtitle={`${preview.body} · ${fmtRelative(n.created_at)}`}
                highlight={!n.read_at}
                right={!n.read_at ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.orange }} /> : undefined}
                onPress={() => open(n)}
                accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${preview.title}. ${preview.body}`}
              />
            );
          })}
        </ListGroup>
      ) : (
        <EmptyState icon="bell" title="No notifications yet" body="Follow requests, comments, club updates and your daily territory digest appear here." />
      )}
    </Screen>
  );
}
