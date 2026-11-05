import { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { Banner, Button, ErrorState, LoadingState, TextField, Txt } from '@/components/ui';
import { reportMessage, useConversation, type UiMessage } from '@/chat/client';
import { setViewingChannel } from '@/notifications/push';
import { useSession } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';

const REPORT_CATEGORIES = ['harassment', 'spam', 'hate', 'sexual', 'violence', 'other'] as const;

/** S12 Conversation — text and permitted content links, send status, mute, block, report and deletion. */
export default function Conversation() {
  const p = usePalette();
  const qc = useQueryClient();
  const { channel, name, conversation } = useLocalSearchParams<{ channel: string; name?: string; conversation?: string }>();
  const { userId } = useSession();
  const chat = useConversation(userId, channel);
  const [text, setText] = useState('');
  const conv = useQuery({
    queryKey: ['conversation', channel],
    queryFn: async () => {
      const { data } = await supabase().from('conversations').select('id, member_a, member_b, frozen').eq('channel_id', channel).maybeSingle();
      return data as { id: string; member_a: string; member_b: string; frozen: boolean } | null;
    }
  });
  const prefs = useQuery({
    queryKey: ['conversation_prefs', conv.data?.id],
    enabled: Boolean(conv.data),
    queryFn: async () => (await supabase().from('conversation_prefs').select('muted').eq('conversation_id', conv.data!.id).maybeSingle()).data as { muted: boolean } | null
  });
  const otherId = conv.data ? (conv.data.member_a === userId ? conv.data.member_b : conv.data.member_a) : null;

  useEffect(() => {
    setViewingChannel(channel);
    const id = conversation ?? conv.data?.id;
    if (id) {
      void supabase().from('notifications').select('id').eq('object_type', 'conversation').eq('object_id', id).is('read_at', null).then(({ data }) => {
        const ids = (data ?? []).map((r) => r.id as string);
        if (ids.length) void rpc('mark_notifications_read', { p_ids: ids }).then(() => qc.invalidateQueries({ queryKey: ['badge_counts'] }));
      });
    }
    return () => setViewingChannel(null);
  }, [channel, conversation, conv.data?.id, chat.messages.length, qc]);

  const send = async () => {
    const body = text;
    setText('');
    try {
      await chat.send(body);
    } catch (e) {
      setText(body);
      Alert.alert('Not sent', friendlyError(e));
    }
  };

  const toggleMute = async () => {
    if (!conv.data || !userId) return;
    const muted = !prefs.data?.muted;
    await supabase().from('conversation_prefs').upsert({ conversation_id: conv.data.id, user_id: userId, muted });
    track('message_action', { action: 'conversation_muted', outcome: 'ok' });
    void prefs.refetch();
  };

  const messageMenu = (m: UiMessage) => {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (m.mine && !m.deleted) buttons.push({ text: 'Delete message', style: 'destructive', onPress: () => void chat.remove(m.id).catch((e) => Alert.alert('Not deleted', friendlyError(e))) });
    if (!m.mine && !m.deleted) {
      buttons.push({
        text: 'Report message',
        onPress: () =>
          Alert.alert('Why are you reporting this?', 'The message and minimal context go to moderators. The sender is not told who reported.', [
            ...REPORT_CATEGORIES.map((c) => ({ text: c.replace('_', ' '), onPress: () => void reportMessage(channel, m.id, c).then(() => Alert.alert('Report sent', 'Thank you. You can block this runner as well.')).catch((e) => Alert.alert('Not sent', friendlyError(e))) })),
            { text: 'Cancel', style: 'cancel' as const }
          ])
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Message', undefined, buttons);
  };

  const more = () =>
    Alert.alert(name || 'Conversation', undefined, [
      { text: prefs.data?.muted ? 'Unmute notifications' : 'Mute notifications', onPress: () => void toggleMute() },
      ...(otherId ? [{ text: 'View profile', onPress: () => router.push({ pathname: '/profile/[id]', params: { id: otherId } }) }] : []),
      ...(otherId
        ? [{ text: 'Block', style: 'destructive' as const, onPress: () => Alert.alert('Block this runner?', 'The conversation closes and neither of you can message the other.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Block', style: 'destructive', onPress: () => void rpc('block_user', { p_target: otherId }).then(() => { track('social_action', { action: 'blocked', audience_class: 'none', outcome: 'ok' }); router.back(); }) }]) }]
        : []),
      { text: 'Cancel', style: 'cancel' }
    ]);

  const frozen = chat.frozen || conv.data?.frozen;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: name || 'Conversation', headerRight: () => <Button variant="ghost" label="More" onPress={more} /> }} />
      {chat.status === 'connecting' ? <LoadingState label="Connecting…" /> : chat.status === 'error' ? <ErrorState error={chat.error} onRetry={() => void chat.retry()} title="Messages could not be loaded" /> : (
        <FlatList
          inverted
          data={[...chat.messages].reverse()}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          onEndReached={() => void chat.loadOlder()}
          renderItem={({ item: m }) => (
            <Pressable onLongPress={() => messageMenu(m)} onPress={() => messageMenu(m)} accessibilityRole="button" accessibilityLabel={`${m.mine ? 'You' : name || 'They'}: ${m.deleted ? 'message deleted' : m.text}. ${m.state === 'failed' ? 'Not sent.' : m.state === 'sending' ? 'Sending.' : ''}`} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <View style={{ backgroundColor: m.mine ? p.primary : p.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: m.mine ? 0 : 1, borderColor: p.border }}>
                <Txt style={{ color: m.mine ? p.primaryText : p.text, fontStyle: m.deleted ? 'italic' : 'normal' }}>{m.deleted ? 'Message deleted' : m.text}</Txt>
              </View>
              <Txt variant="caption" style={{ textAlign: m.mine ? 'right' : 'left' }}>
                {m.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {m.mine ? (m.state === 'sending' ? ' · Sending' : m.state === 'failed' ? ' · Not sent' : ' · Sent') : ''}
              </Txt>
            </Pressable>
          )}
        />
      )}
      <View style={{ padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: p.border, backgroundColor: p.surface }}>
        {frozen ? <Banner tone="info" text="This conversation is closed. Messages can no longer be sent." /> : (
          <>
            <TextField label="Message" value={text} onChangeText={setText} multiline maxLength={2000} hint="Previews in notifications never include your message text." />
            <Button label="Send" onPress={() => void send()} disabled={!text.trim() || chat.status !== 'ready'} />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
