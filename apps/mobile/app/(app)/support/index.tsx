import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';

export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  status: 'open' | 'pending' | 'solved' | 'closed';
  unread: boolean;
  created_at: string;
  last_message_at: string;
  last_message: { body: string; from: 'runner' | 'staff' | 'system'; at: string } | null;
}

export const SUPPORT_STATUS: Record<SupportTicket['status'], { label: string; tone: 'info' | 'success' | 'warning' | 'muted' }> = {
  open: { label: 'With support', tone: 'info' },
  pending: { label: 'Support replied', tone: 'warning' },
  solved: { label: 'Solved', tone: 'success' },
  closed: { label: 'Closed', tone: 'muted' }
};

/** Help and feedback — the runner's conversations with Loopfield support, newest first. */
export default function SupportInbox() {
  const list = useQuery({ queryKey: ['support_inbox'], queryFn: () => rpc<SupportTicket[]>('support_inbox'), refetchInterval: 60_000 });
  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Stack.Screen options={{ title: 'Help and feedback' }} />
      <Card tone="violet" accessibilityLabel="Message support">
        <Txt variant="headline">Something not right?</Txt>
        <Txt>Report a problem, ask about your account or tell us what would make Loopfield better. A person reads every message.</Txt>
        <View style={{ flexDirection: 'row' }}>
          <Button label="New message" arrow onPress={() => router.push('/support/new')} />
        </View>
      </Card>
      <Section title="Your conversations" icon="chat">
        {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.data?.length ? (
          <ListGroup>
            {list.data.map((t) => (
              <Row
                key={t.id}
                icon={t.unread ? 'mail' : 'chat'}
                highlight={t.unread}
                title={t.subject}
                subtitle={`${t.last_message ? `${t.last_message.from === 'runner' ? 'You' : 'Support'}: ${t.last_message.body}` : ''}\n${fmtDate(t.last_message_at)}`}
                right={<Badge label={t.unread ? 'New reply' : SUPPORT_STATUS[t.status].label} tone={t.unread ? 'warning' : SUPPORT_STATUS[t.status].tone} />}
                onPress={() => router.push({ pathname: '/support/[id]', params: { id: t.id } })}
                accessibilityLabel={`${t.subject}. ${t.unread ? 'New reply.' : SUPPORT_STATUS[t.status].label}`}
              />
            ))}
          </ListGroup>
        ) : <EmptyState icon="chat" title="No messages yet" body="When you write to support, the conversation and our replies show up here." />}
      </Section>
      <Section title="Before you write" icon="help">
        <ListGroup>
          <Row icon="help" title="Help and game rules" subtitle="How loops, land and seasons work" onPress={() => router.push('/help')} />
          <Row icon="flag" title="Reviews and appeals" subtitle="Ask for a second look at a result or decision" onPress={() => router.push('/appeals')} />
        </ListGroup>
        <Txt variant="caption" style={{ marginTop: spacing.xs }}>For an emergency, contact local emergency services first.</Txt>
      </Section>
    </Screen>
  );
}
