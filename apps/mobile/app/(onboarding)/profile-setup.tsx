import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { LEGAL_VERSION } from '@/config/env';
import { rpc } from '@/lib/api';
import { Button, LoadingState, Screen, Toggle, Txt } from '@/components/ui';
import { useSession } from '@/state/session';
import { ProfileForm } from '@/features/profile/ProfileForm';
import { spacing } from '@/theme/tokens';

/** S04 Profile setup — display name, avatar, bio, selected city, units and profile visibility. */
export default function ProfileSetup() {
  const { session, profile, settings, signOut } = useSession();
  const meta = (session?.user.user_metadata ?? {}) as { adult_confirmed?: boolean; legal_version?: string };
  const [adult, setAdult] = useState(Boolean(meta.adult_confirmed));
  const [terms, setTerms] = useState(meta.legal_version === LEGAL_VERSION);
  if (!profile || !settings) return <LoadingState />;
  return (
    <Screen>
      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        <Txt variant="caption">Step 1 of 2</Txt>
        <Txt variant="title">Set up your profile</Txt>
        <Txt color="textMuted">Only your display name and handle are required. You can change everything later.</Txt>
        <Toggle label="I am 18 or older" value={adult} onChange={setAdult} />
        <Toggle label="I accept the Terms and Privacy Notice" description={`Version ${LEGAL_VERSION}`} value={terms} onChange={setTerms} />
        <ProfileForm
          profile={profile}
          units={settings.units}
          submitLabel="Continue"
          extraValid={adult && terms}
          beforeSave={async () => {
            await rpc('set_consent', { p_kind: 'adult', p_granted: true, p_version: LEGAL_VERSION });
            await rpc('set_consent', { p_kind: 'terms', p_granted: true, p_version: LEGAL_VERSION });
            await rpc('set_consent', { p_kind: 'privacy', p_granted: true, p_version: LEGAL_VERSION });
          }}
          onSaved={() => router.push('/permissions')}
        />
        <Button variant="ghost" label="Sign out" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}
