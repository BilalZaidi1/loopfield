import { useMemo, useState } from 'react';
import { router, Stack } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { useAppConfig } from '@/lib/appConfig';
import { View } from 'react-native';
import { Avatar, Banner, Button, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useSignedUrls } from '@/features/social/media';
import { avatarName, friendName, handleLine, saveSharePeople, useShareCandidates } from '@/features/friends/api';
import { usePalette } from '@/theme/tokens';

/** Choosing which friends see your live runs (R2), when sharing is set to "Friends I choose". */
export default function ChooseFriends() {
  const p = usePalette();
  const { settings } = useAppConfig();
  const max = settings.friendsLiveMaxPeople;
  const q = useShareCandidates();
  const pictures = useSignedUrls('avatars', (q.data ?? []).map((c) => c.avatar_path));
  // The saved choice, until the runner changes it here.
  const initial = useMemo(() => (q.data ? new Set(q.data.filter((c) => c.chosen).map((c) => c.id)) : null), [q.data]);
  const [edits, setEdits] = useState<Set<string> | null>(null);
  const picked = edits ?? initial;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setEdits((prev) => {
    const next = new Set(prev ?? initial ?? []);
    if (next.has(id)) next.delete(id);
    else if (next.size < max) next.add(id);
    return next;
  });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveSharePeople([...(picked ?? [])]);
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Friends who see your runs' }} />
      {q.isLoading || picked === null && !q.error ? <LoadingState variant="rows" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? (
        <EmptyState icon="clubs" title="No friends yet" body="Friends are people you follow who follow you back. Once someone does, you can choose them here." />
      ) : (
        <>
          <Txt variant="caption">{`Choose up to ${max}. Only the friends you choose see your runs live, while you run.`}</Txt>
          <ListGroup>
            {q.data.map((c) => {
              const on = picked?.has(c.id) ?? false;
              return (
                <Row key={c.id} leading={<Avatar uri={c.avatar_path ? pictures.data?.[c.avatar_path] ?? null : null} name={avatarName(c)} size={40} />}
                  title={friendName(c)} subtitle={handleLine(c)} onPress={() => toggle(c.id)}
                  accessibilityLabel={`${friendName(c)}, ${on ? 'chosen' : 'not chosen'}. Tap to ${on ? 'remove' : 'choose'}`}
                  right={on ? (
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: p.primaryFill, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" color={p.primaryText} size={16} /></View>
                  ) : <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: p.borderStrong }} />} />
              );
            })}
          </ListGroup>
          {(picked?.size ?? 0) >= max ? <Banner tone="info" text={`You have chosen the most friends you can (${max}).`} /> : null}
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button label={`Save (${picked?.size ?? 0} chosen)`} onPress={() => void save()} loading={busy} disabled={busy} />
        </>
      )}
    </Screen>
  );
}
