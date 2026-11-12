import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError, rpc } from '@/lib/api';
import { Badge, Banner, Button, ErrorState, LoadingState, PressableScale, TextField, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { radius, spacing, usePalette } from '@/theme/tokens';
import { SUPPORT_STATUS, type SupportTicket } from './index';

interface Thread {
  id: string;
  subject: string;
  category: string;
  status: SupportTicket['status'];
  created_at: string;
  messages: { id: string; from: 'runner' | 'staff' | 'system'; body: string; at: string }[];
}

/** One support conversation: the runner's messages on the right, support's replies on the left. */
export default function SupportThread() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState('');
  const thread = useQuery({
    queryKey: ['support_thread', id],
    queryFn: async () => {
      const t = await rpc<Thread>('support_thread', { p_ticket: id });
      void qc.invalidateQueries({ queryKey: ['support_inbox'] });
      return t;
    },
    refetchInterval: 20_000
  });
  const reply = useMutation({
    mutationFn: () => rpc('support_reply', { p_ticket: id, p_body: text.trim() }),
    onSuccess: () => {
      setText('');
      void thread.refetch();
    }
  });
  const t = thread.data;
  const closed = t?.status === 'closed';
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: t?.subject ?? 'Support' }} />
      {thread.isLoading ? <LoadingState variant="spinner" /> : thread.error ? <ErrorState error={thread.error} onRetry={() => void thread.refetch()} /> : t ? (
        <FlatList
          inverted
          data={[...t.messages].reverse()}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ListFooterComponent={
            <View style={{ alignItems: 'center', gap: spacing.xs, paddingBottom: spacing.md }}>
              <Badge label={SUPPORT_STATUS[t.status].label} tone={SUPPORT_STATUS[t.status].tone} />
              <Txt variant="caption">Started {new Date(t.created_at).toLocaleDateString()}</Txt>
            </View>
          }
          renderItem={({ item: m }) =>
            m.from === 'system' ? (
              <Txt variant="caption" align="center" style={{ marginVertical: spacing.xs }}>{m.body}</Txt>
            ) : (
              <View style={{ alignSelf: m.from === 'runner' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}
                accessible accessibilityLabel={`${m.from === 'runner' ? 'You' : 'Loopfield support'}: ${m.body}`}>
                {m.from === 'staff' ? <Txt variant="micro" style={{ color: p.primary, marginBottom: 2 }}>Loopfield support</Txt> : null}
                <View style={{ backgroundColor: m.from === 'runner' ? p.primaryFill : p.surface, borderRadius: radius.lg,
                  borderBottomRightRadius: m.from === 'runner' ? 6 : radius.lg, borderBottomLeftRadius: m.from === 'runner' ? radius.lg : 6,
                  paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}>
                  <Txt style={{ color: m.from === 'runner' ? p.primaryText : p.text }} selectable>{m.body}</Txt>
                </View>
                <Txt variant="caption" style={{ textAlign: m.from === 'runner' ? 'right' : 'left', marginTop: 2 }}>
                  {new Date(m.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Txt>
              </View>
            )
          }
        />
      ) : null}
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: Math.max(insets.bottom, spacing.md), gap: spacing.xs, backgroundColor: p.bg }}>
        {closed ? (
          <>
            <Banner tone="info" text="This conversation is closed. Start a new one if you still need help." />
            <Button label="New message" variant="secondary" arrow onPress={() => router.replace('/support/new')} />
          </>
        ) : (
          <>
            {reply.error ? <Banner tone="danger" text={friendlyError(reply.error)} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField label="Reply" labelHidden compact placeholder="Write a reply" value={text} onChangeText={setText} multiline maxLength={4000} />
              </View>
              <PressableScale onPress={() => reply.mutate()} disabled={!text.trim() || reply.isPending} accessibilityRole="button" accessibilityLabel="Send reply"
                accessibilityState={{ disabled: !text.trim() || reply.isPending }}
                style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: p.primaryFill, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || reply.isPending ? 0.4 : 1 }}>
                <Icon name="send" color="#FFFFFF" size={22} />
              </PressableScale>
            </View>
            {t?.status === 'solved' ? <Txt variant="caption">Marked as solved. Replying opens it again.</Txt> : null}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
