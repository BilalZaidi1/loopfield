import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { friendlyError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Avatar, Banner, Button, Segmented, TextField, Toggle, Txt } from '@/components/ui';
import { useSession, type Profile } from '@/state/session';
import { spacing } from '@/theme/tokens';
import { prepareImage, uploadToBucket, useSignedUrl } from '@/features/social/media';

export interface District {
  id: string;
  name: string;
  region_id: string;
}

export function useDistricts() {
  return useQuery({
    queryKey: ['districts'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase().from('districts').select('id, name, region_id').order('name');
      if (error) throw error;
      return (data ?? []) as District[];
    }
  });
}

/** Shared by S04 Profile setup and the profile editor: name, avatar, bio, city, units, visibility. */
export function ProfileForm({ profile, units: initialUnits, submitLabel, onSaved, extraValid = true, beforeSave }: {
  profile: Profile;
  units: 'metric' | 'imperial';
  submitLabel: string;
  onSaved: () => void;
  extraValid?: boolean;
  beforeSave?: () => Promise<void>;
}) {
  const { userId, refresh } = useSession();
  const districts = useDistricts();
  const [handle, setHandle] = useState(profile.handle.startsWith('runner_') ? '' : profile.handle);
  const [name, setName] = useState(profile.display_name === 'New runner' ? '' : profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [district, setDistrict] = useState<string | null>(profile.district_id);
  const [visibility, setVisibility] = useState<'public' | 'private'>(profile.visibility);
  const [discoverable, setDiscoverable] = useState(profile.discoverable);
  const [units, setUnits] = useState(initialUnits);
  const [avatarPath, setAvatarPath] = useState<string | null>(profile.avatar_path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarUrl = useSignedUrl('avatars', avatarPath);

  const handleOk = /^[A-Za-z0-9_]{3,24}$/.test(handle);
  const nameOk = name.trim().length >= 1 && name.trim().length <= 40;

  const pickAvatar = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9, exif: false });
    if (res.canceled || !res.assets[0]) return;
    try {
      setBusy(true);
      const img = await prepareImage(res.assets[0].uri);
      const path = `${userId}/avatar-${Date.now()}.jpg`;
      await uploadToBucket('avatars', path, img.uri);
      setAvatarPath(path);
    } catch (e) {
      Alert.alert('Photo not uploaded', friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await beforeSave?.();
      const d = districts.data?.find((x) => x.id === district);
      const { error: e1 } = await supabase()
        .from('profiles')
        .update({ handle, display_name: name.trim(), bio: bio.trim() || null, district_id: district, city_label: d?.name ?? null, visibility, discoverable: visibility === 'public' && discoverable, avatar_path: avatarPath })
        .eq('id', userId!);
      if (e1) throw e1.code === '23505' ? new Error('That handle is taken. Try another.') : e1;
      const { error: e2 } = await supabase().from('user_settings').update({ units }).eq('user_id', userId!);
      if (e2) throw e2;
      await refresh();
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Pressable onPress={pickAvatar} accessibilityRole="button" accessibilityLabel="Choose a profile photo" style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar name={name || 'You'} uri={avatarUrl.data} size={64} />
        <Txt variant="label" color="primary">{avatarPath ? 'Change photo' : 'Add photo (optional)'}</Txt>
      </Pressable>
      <TextField label="Display name" value={name} onChangeText={setName} maxLength={40} error={name && !nameOk ? 'Use 1–40 characters.' : undefined} />
      <TextField label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" maxLength={24} hint="3–24 letters, numbers or underscores. Others can @mention you with it." error={handle && !handleOk ? 'Use 3–24 letters, numbers or underscores.' : undefined} />
      <TextField label="Bio (optional)" value={bio} onChangeText={setBio} multiline maxLength={280} />
      <Txt variant="label">City or district</Txt>
      {districts.isLoading ? <Txt variant="caption">Loading supported areas…</Txt> : null}
      {districts.error ? <Banner tone="warning" text="Supported areas could not be loaded. You can set this later." /> : null}
      {districts.data?.length ? (
        <Segmented label="City or district" value={district ?? 'none'} onChange={(v) => setDistrict(v === 'none' ? null : v)} options={[{ value: 'none', label: 'Not set' }, ...districts.data.map((d) => ({ value: d.id, label: d.name }))]} />
      ) : null}
      <Segmented label="Units" value={units} onChange={setUnits} options={[{ value: 'metric', label: 'Kilometres' }, { value: 'imperial', label: 'Miles' }]} />
      <Segmented
        label="Profile visibility"
        value={visibility}
        onChange={setVisibility}
        options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]}
      />
      <Txt variant="caption">{visibility === 'private' ? 'Private: people must ask to follow you; your posts reach approved followers only.' : 'Public: anyone signed in can see your profile and public posts.'}</Txt>
      {visibility === 'public' ? <Toggle label="Show me in Discover" description="Lets runners in your city find you. Off by default." value={discoverable} onChange={setDiscoverable} /> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button label={submitLabel} onPress={save} loading={busy} disabled={!handleOk || !nameOk || !extraValid || busy} />
    </View>
  );
}
