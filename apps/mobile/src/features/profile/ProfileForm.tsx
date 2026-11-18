import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { friendlyError } from '@/lib/api';
import { useFeature } from '@/lib/appConfig';
import { PausedNote } from '@/components/Notices';
import { supabase } from '@/lib/supabase';
import { Avatar, Banner, Button, Segmented, Sheet, TextField, Toggle, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useSession, type Profile } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';
import { prepareImage, uploadToBucket, useSignedUrl } from '@/features/social/media';
import { AvatarBuilder } from '@/features/avatar/AvatarBuilder';
import { LocationPicker, type LocationDraft } from './LocationPicker';
import { cleanCountry, cleanPlace } from './location';
import { parseAvatar, shuffleAvatar, type AvatarSpec } from '@/features/avatar/spec';

/** Shared by S04 Profile setup and the profile editor: name, avatar, bio, where you run, units, visibility. */
export function ProfileForm({ profile, units: initialUnits, submitLabel, onSaved, extraValid = true, beforeSave }: {
  profile: Profile;
  units: 'metric' | 'imperial';
  submitLabel: string;
  onSaved: () => void;
  extraValid?: boolean;
  beforeSave?: () => Promise<void>;
}) {
  const p = usePalette();
  const { userId, refresh, settings } = useSession();
  const [handle, setHandle] = useState(profile.handle.startsWith('runner_') ? '' : profile.handle);
  const [name, setName] = useState(profile.display_name === 'New runner' ? '' : profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [place, setPlace] = useState<LocationDraft>({
    city: profile.city_label ?? '',
    countryCode: profile.country_code ?? null,
    area: settings?.area_label ?? '',
    showArea: settings?.show_area ?? false,
    districtId: profile.district_id
  });
  const [visibility, setVisibility] = useState<'public' | 'private'>(profile.visibility);
  const [discoverable, setDiscoverable] = useState(profile.discoverable);
  const [units, setUnits] = useState(initialUnits);
  const [avatarPath, setAvatarPath] = useState<string | null>(profile.avatar_path);
  const [avatarKind, setAvatarKind] = useState<'photo' | 'cartoon' | null>(profile.avatar_kind ?? (profile.avatar_path ? 'photo' : null));
  const [avatarStyle, setAvatarStyle] = useState<AvatarSpec | null>(profile.avatar_style ? parseAvatar(profile.avatar_style) : null);
  const [photoPath, setPhotoPath] = useState<string | null>(profile.avatar_photo_path ?? (profile.avatar_kind !== 'cartoon' ? profile.avatar_path : null));
  const [building, setBuilding] = useState(false);
  // A different starting avatar for everyone who has not made one yet ("Surprise me" shuffles again).
  const [firstAvatar] = useState(() => shuffleAvatar(Math.floor(Math.random() * 100_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarUrl = useSignedUrl('avatars', avatarPath);
  // App control can pause new profile photos. Drawn avatars keep working (the server lets their pictures
  // through), and switching back to an earlier photo still works because nothing new is uploaded.
  const uploadsOn = useFeature('avatar_uploads_enabled');

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
      setPhotoPath(path);
      setAvatarKind('photo');
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
      const city = cleanPlace(place.city);
      const country = cleanCountry(place.countryCode);
      // No place, no playing area: the area comes only from the phone's check, which a cleared place undoes.
      const districtId = city || country ? place.districtId : null;
      const area = city ? cleanPlace(place.area) : null;
      const { error: e1 } = await supabase()
        .from('profiles')
        .update({ handle, display_name: name.trim(), bio: bio.trim() || null, district_id: districtId, city_label: city, country_code: country, visibility, discoverable: visibility === 'public' && discoverable, avatar_path: avatarPath,
                  avatar_kind: avatarKind, avatar_style: avatarStyle, avatar_photo_path: photoPath })
        .eq('id', userId!);
      if (e1) throw e1.code === '23505' ? new Error('That handle is taken. Try another.') : e1;
      // The neighbourhood lives in the runner's own settings, which nobody else can read.
      const { error: e2 } = await supabase().from('user_settings').update({ units, area_label: area, show_area: Boolean(area) && place.showArea }).eq('user_id', userId!);
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
    <View style={{ gap: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <Pressable onPress={uploadsOn ? pickAvatar : () => setBuilding(true)} accessibilityRole="button" accessibilityLabel={uploadsOn ? (avatarPath ? 'Change your picture to a photo' : 'Add a photo (optional)') : (avatarKind === 'cartoon' ? 'Edit your avatar' : 'Make an avatar (optional)')} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Avatar name={name || 'You'} uri={avatarUrl.data} size={84} />
          <View style={{ position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: p.primaryFill, borderWidth: 3, borderColor: p.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={avatarKind === 'cartoon' ? 'sparkle' : 'camera'} color="#FFFFFF" size={16} />
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: spacing.sm }}>
          <Txt variant="caption">Optional. Your picture marks your land on the map and shows on your profile, posts and rankings.</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {uploadsOn ? <Button label={avatarKind === 'photo' ? 'New photo' : 'Photo'} icon="camera" size="sm" variant="secondary" onPress={() => void pickAvatar()} /> : null}
            <Button label={avatarKind === 'cartoon' ? 'Edit avatar' : 'Avatar'} icon="sparkle" size="sm" variant="secondary" onPress={() => setBuilding(true)} />
            {avatarKind === 'cartoon' && photoPath ? (
              <Button label="Use my photo" size="sm" variant="ghost" onPress={() => { setAvatarPath(photoPath); setAvatarKind('photo'); }} />
            ) : null}
          </View>
          {uploadsOn ? null : <PausedNote feature="avatar_uploads_enabled" />}
        </View>
      </View>
      <Sheet visible={building} title="Your avatar" onClose={() => setBuilding(false)}>
        {building && userId ? (
          <AvatarBuilder
            userId={userId}
            initial={avatarStyle ?? firstAvatar}
            onCancel={() => setBuilding(false)}
            onSaved={({ path, spec }) => {
              setAvatarPath(path);
              setAvatarStyle(spec);
              setAvatarKind('cartoon');
              setBuilding(false);
            }}
          />
        ) : null}
      </Sheet>
      <View style={{ gap: spacing.lg }}>
        <TextField label="Display name" value={name} onChangeText={setName} maxLength={40} error={name && !nameOk ? 'Use 1–40 characters.' : undefined} />
        <TextField label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" maxLength={24} hint="3–24 letters, numbers or underscores. Others can @mention you with it." error={handle && !handleOk ? 'Use 3–24 letters, numbers or underscores.' : undefined} />
        <TextField label="Bio (optional)" value={bio} onChangeText={setBio} multiline maxLength={280} />
      </View>
      <LocationPicker value={place} onChange={setPlace} />
      <View style={{ gap: spacing.sm }}>
        <Txt variant="label">Units</Txt>
        <Segmented label="Units" value={units} onChange={setUnits} options={[{ value: 'metric', label: 'Kilometres' }, { value: 'imperial', label: 'Miles' }]} />
      </View>
      <View style={{ gap: spacing.sm }}>
        <Txt variant="label">Who can see your profile</Txt>
        <View style={{ flexDirection: 'row', gap: spacing.md }} accessibilityRole="radiogroup" accessibilityLabel="Profile visibility">
          {([
            { value: 'private', icon: 'lock', title: 'Private', body: 'People ask to follow you; posts reach approved followers.' },
            { value: 'public', icon: 'globe', title: 'Public', body: 'Anyone signed in sees your profile and public posts.' }
          ] as const).map((o) => {
            const selected = visibility === o.value;
            return (
              <Pressable key={o.value} onPress={() => setVisibility(o.value)} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${o.title}. ${o.body}`} style={({ pressed }) => ({ flex: 1, gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 2, borderColor: selected ? p.primary : p.border, backgroundColor: selected ? p.primarySoft : p.surface, opacity: pressed ? 0.8 : 1 })}>
                <Icon name={o.icon} color={selected ? p.primary : p.textMuted} size={22} />
                <Txt variant="heading">{o.title}</Txt>
                <Txt variant="caption">{o.body}</Txt>
              </Pressable>
            );
          })}
        </View>
      </View>
      {visibility === 'public' ? <Toggle label="Show me in Discover" description="Lets runners in your city find you. Off by default." value={discoverable} onChange={setDiscoverable} /> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button label={submitLabel} size="lg" arrow onPress={save} loading={busy} disabled={!handleOk || !nameOk || !extraValid || busy} hint={!extraValid ? 'Confirm the age and terms questions above first.' : undefined} />
    </View>
  );
}
