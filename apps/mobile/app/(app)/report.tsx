import { useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Banner, Button, Card, Screen, Segmented, TextField, Txt } from '@/components/ui';

const CATEGORIES = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam' },
  { value: 'unsafe_area', label: 'Unsafe area' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'hate', label: 'Hate' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence' },
  { value: 'self_harm', label: 'Self-harm' },
  { value: 'cheating', label: 'Cheating' },
  { value: 'other', label: 'Other' }
] as const;

const TYPE_LABEL: Record<string, string> = { post: 'post', comment: 'comment', profile: 'profile', club: 'group', route: 'route', area: 'area', media: 'photo' };

/** S47 Report a problem — affected object, category, explanation and submission state. */
export default function Report() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('harassment');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpc('submit_report', { p_object_type: type, p_object_id: id, p_category: category, p_details: details.trim() || null });
      track('social_action', { action: 'reported', audience_class: 'none', outcome: 'ok' });
      setDone(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Report' }} />
      {done ? (
        <Card>
          <Txt variant="heading">Report received</Txt>
          <Txt color="textMuted">A moderator will review it. The person you reported is not told who reported them. If you feel unsafe, you can also block them.</Txt>
          <Button label="Done" onPress={() => router.back()} />
        </Card>
      ) : (
        <>
          <Txt>You are reporting a {TYPE_LABEL[type] ?? 'item'}.</Txt>
          <Segmented label="What is the problem?" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
          <TextField label="Explanation (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} hint="Do not include anyone’s private details." />
          {category === 'self_harm' ? <Banner tone="info" text="If someone may be in immediate danger, contact local emergency services now." /> : null}
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button label="Submit report" onPress={() => void submit()} loading={busy} disabled={!type || !id} />
        </>
      )}
    </Screen>
  );
}
