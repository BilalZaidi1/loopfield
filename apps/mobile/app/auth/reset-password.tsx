import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Banner, Button, Screen, TextField, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';

/** S03 recovery — set a new password after opening a recovery link. */
export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    setDone(true);
  };
  return (
    <Screen
      maxWidth={520}
      footer={done ? <Button label="Continue" size="lg" arrow onPress={() => router.replace('/')} /> : <Button label="Save password" size="lg" arrow onPress={save} loading={busy} disabled={password.length < 10 || busy} />}>
      <View style={{ gap: spacing.xs, marginTop: spacing.xxl }}>
        <Txt variant="title">Choose a new password</Txt>
        <Txt color="textMuted">Use at least 10 characters. You will stay signed in on this device.</Txt>
      </View>
      {done ? (
        <Banner tone="success" text="Password updated." />
      ) : (
        <>
          <TextField label="New password" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="new-password" hint="At least 10 characters." />
          {error ? <Banner tone="danger" text={error} /> : null}
        </>
      )}
    </Screen>
  );
}
