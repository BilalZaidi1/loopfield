import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fmtRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Avatar, Badge, Banner, EmptyState, ErrorState, IconButton, ListGroup, LoadingState, Row, Screen, Txt } from '@/components/ui';
import { useSession } from '@/state/session';

interface ConversationRow {
  id: string;
  channel_id: string;
  member_a: string;
  member_b: string;
  frozen: boolean;
  created_at: string;
  a: { id: string; display_name: string; handle: string } | null;
  b: { id: string; display_name: string; handle: string } | null;
}

/** S11 Inbox — authorized one-to-one conversations, unread state and new conversation action. */
export default function Inbox() {
  const { userId, settings } = useSession();
  const convs = useQuery({
    queryKey: ['conversations', userId],
    queryFn: async () => {
      const sb = supabase();
      const { data, error } = await sb
        .from('conversations')
        .select('id, channel_id, member_a, member_b, frozen, created_at, a:profiles!conversations_member_a_fkey(id, display_name, handle), b:profiles!conversations_member_b_fkey(id, display_name, handle)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const { data: unread } = await sb.from('notifications').select('object_id, created_at').eq('category', 'message').is('read_at', null).limit(500);
      const counts = new Map<string, { n: number; last: string }>();
      for (const u of (unread ?? []) as { object_id: string; created_at: string }[]) {
        const c = counts.get(u.object_id) ?? { n: 0, last: u.created_at };
        c.n++;
        if (u.created_at > c.last) c.last = u.created_at;
        counts.set(u.object_id, c);
      }
      return ((data ?? []) as unknown as ConversationRow[]).map((c) => ({ ...c, unread: counts.get(c.id)?.n ?? 0, lastAt: counts.get(c.id)?.last ?? c.created_at })).sort((x, y) => (x.lastAt < y.lastAt ? 1 : -1));
    }
  });
  return (
    <Screen onRefresh={() => void convs.refetch()} refreshing={convs.isRefetching}>
      <Stack.Screen options={{ title: 'Messages', headerRight: () => <IconButton icon="edit" label="New message" onPress={() => router.push({ pathname: '/connections', params: { tab: 'following' } })} /> }} />
      {settings?.messages_from === 'nobody' ? <Banner tone="info" text="You do not accept new messages. Change this in Privacy settings." /> : null}
      <Txt variant="caption">Start a conversation from a runner’s profile. By default only mutual followers can message each other.</Txt>
      {convs.isLoading ? <LoadingState /> : convs.error ? <ErrorState error={convs.error} onRetry={() => void convs.refetch()} /> : convs.data?.length ? (
        <ListGroup>
        {convs.data.map((c) => {
          const other = c.member_a === userId ? c.b : c.a;
          return (
            <Row
              key={c.id}
              leading={<Avatar name={other?.display_name ?? 'A runner'} size={48} ring={c.unread ? true : undefined} />}
              title={other?.display_name ?? 'A runner'}
              subtitle={`${c.frozen ? 'Conversation closed · ' : other?.handle ? `@${other.handle} · ` : ''}${fmtRelative(c.lastAt)}`}
              right={c.unread ? <Badge label={`${c.unread} new`} tone="violet" /> : undefined}
              onPress={() => router.push({ pathname: '/inbox/[channel]', params: { channel: c.channel_id, name: other?.display_name ?? '', conversation: c.id } })}
            />
          );
        })}
        </ListGroup>
      ) : <EmptyState icon="chat" title="No conversations yet" body="Messages you send and receive appear here." action={{ label: 'Find people you follow', onPress: () => router.push({ pathname: '/connections', params: { tab: 'following' } }) }} />}
    </Screen>
  );
}
