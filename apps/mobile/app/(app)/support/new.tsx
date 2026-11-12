import { useState } from 'react';
import { Platform } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { friendlyError, rpc } from '@/lib/api';
import { Banner, Button, Card, ChipGroup, Screen, TextField, Txt } from '@/components/ui';

type Category = 'bug' | 'feedback' | 'account' | 'competition' | 'safety' | 'billing' | 'other';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'bug', label: 'Something broke' },
  { value: 'feedback', label: 'Feedback or idea' },
  { value: 'competition', label: 'Land, loops or routes' },
  { value: 'account', label: 'My account' },
  { value: 'safety', label: 'Safety or privacy' },
  { value: 'billing', label: 'Subscription' },
  { value: 'other', label: 'Something else' }
];

/** New support message. The app version, platform and phone model are attached so support can help faster. */
export default function NewSupportMessage() {
  const params = useLocalSearchParams<{ category?: Category; subject?: string; context?: string }>();
  const qc = useQueryClient();
  const [category, setCategory] = useState<Category>(CATEGORIES.some((c) => c.value === params.category) ? params.category! : 'bug');
  const [subject, setSubject] = useState(params.subject ?? '');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () =>
      rpc<string>('support_create', {
        p_category: category,
        p_subject: subject.trim(),
        p_body: body.trim(),
        p_context: params.context ? { from: params.context } : {},
        p_app_version: Constants.expoConfig?.version ?? null,
        p_platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
        p_device: [Device.manufacturer, Device.modelName, Device.osVersion ? `OS ${Device.osVersion}` : null].filter(Boolean).join(' ') || null
      }),
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ['support_inbox'] });
      router.replace({ pathname: '/support/[id]', params: { id } });
    }
  });
  const ready = subject.trim().length >= 3 && body.trim().length >= 10;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'New message' }} />
      <Card>
        <ChipGroup label="What is it about?" value={category} onChange={setCategory} options={CATEGORIES} />
        <TextField label="Subject" value={subject} onChangeText={setSubject} maxLength={120} placeholder="A few words, for example: Loop not counted" />
        <TextField label="Message" value={body} onChangeText={setBody} multiline maxLength={4000}
          placeholder="What happened, and what did you expect? For a run, say roughly when it was." />
        <Txt variant="caption">We attach your app version and phone model to help us look into it. Never include passwords or card numbers.</Txt>
        {send.error ? <Banner tone="danger" text={friendlyError(send.error)} /> : null}
        <Button label="Send to support" arrow onPress={() => send.mutate()} loading={send.isPending} disabled={!ready} hint="A subject and at least 10 characters." />
      </Card>
    </Screen>
  );
}
