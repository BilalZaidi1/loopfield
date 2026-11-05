import { useState } from 'react';
import { router } from 'expo-router';
import { LEGAL_VERSION } from '@/config/env';
import { rpc } from '@/lib/api';
import { Button, ListGroup, LoadingState, Screen, Toggle } from '@/components/ui';
import { useSession } from '@/state/session';
import { ProfileForm } from '@/features/profile/ProfileForm';
import { StepHeader } from '@/features/onboarding/StepHeader';

/** S04 Profile setup — display name, avatar, bio, selected city, units and profile visibility. */
export default function ProfileSetup() {
  const { session, profile, settings, signOut } = useSession();
  const meta = (session?.user.user_metadata ?? {}) as { adult_confirmed?: boolean; legal_version?: string };
  const [adult, setAdult] = useState(Boolean(meta.adult_confirmed));
  const [terms, setTerms] = useState(meta.legal_version === LEGAL_VERSION);
  if (!profile || !settings) return <Screen><LoadingState /></Screen>;
  return (
    <Screen maxWidth={560}>
      <StepHeader step={1} of={2} title="Make it yours" subtitle="Only your display name and handle are required. You can change everything later." />
      <ListGroup>
        <Toggle label="I am 18 or older" description="The pilot is for adults only." value={adult} onChange={setAdult} />
        <Toggle label="I accept the Terms and Privacy Notice" description={`Version ${LEGAL_VERSION}`} value={terms} onChange={setTerms} />
      </ListGroup>
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
      <Button variant="ghost" label="Sign out" icon="logout" onPress={() => void signOut()} />
    </Screen>
  );
}
