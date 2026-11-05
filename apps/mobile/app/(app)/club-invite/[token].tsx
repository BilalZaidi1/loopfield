import { useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Banner, Button, Card, Screen, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';

/**
 * S29 (email invitation deep link: loopfield://club-invite/<token>). Accepting is an explicit action;
 * opening the link alone never adds the runner to the group.
 */
export default function ClubEmailInvite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const clubId = await rpc<string>('accept_club_email_invite', { p_token: token });
      track('club_action', { action: 'invite_accepted', club_kind: 'club', visibility: 'private' });
      void qc.invalidateQueries({ queryKey: ['my_clubs'] });
      router.replace({ pathname: '/club/[id]', params: { id: clubId } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen maxWidth={560} footer={<><Button label="Accept invitation" size="lg" arrow onPress={accept} loading={busy} /><Button variant="ghost" label="Not now" onPress={() => router.replace('/clubs')} /></>}>
      <Stack.Screen options={{ title: 'Group invitation' }} />
      <Card tone="orange">
        <Icon name="clubs" color="#121318" size={32} />
        <Txt variant="display" style={{ fontSize: 32, lineHeight: 36 }}>You were invited to a group</Txt>
        <Txt color="textMuted">Accept to join with this account. The invitation works once and expires.</Txt>
      </Card>
      {error ? <Banner tone="danger" text={error.includes('invalid') || error.includes('expired') ? 'This invitation is invalid, expired or was already used.' : error} /> : null}
    </Screen>
  );
}
