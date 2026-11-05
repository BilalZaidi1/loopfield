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
    <Screen>
      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        <Txt variant="title">Choose a new password</Txt>
        {done ? (
          <>
            <Banner tone="success" text="Password updated." />
            <Button label="Continue" onPress={() => router.replace('/')} />
          </>
        ) : (
          <>
            <TextField label="New password" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="new-password" hint="At least 10 characters." />
            {error ? <Banner tone="danger" text={error} /> : null}
            <Button label="Save password" onPress={save} loading={busy} disabled={password.length < 10 || busy} />
          </>
        )}
      </View>
    </Screen>
  );
}
