import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Badge, Banner, Button, PressableScale, Screen, Segmented, TextField, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useDistricts } from '@/features/profile/ProfileForm';
import { useSession } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';

/** Create a club (invited crew) or community (open local group). The creator becomes owner. */
export default function CreateClub() {
  const p = usePalette();
  const qc = useQueryClient();
  const { profile } = useSession();
  const districts = useDistricts();
  const [kind, setKind] = useState<'club' | 'community'>('club');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [joinPolicy, setJoinPolicy] = useState<'open' | 'request' | 'invite_only'>('request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const district = districts.data?.find((d) => d.id === profile?.district_id) ?? null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await rpc<string>('create_club', {
        p_kind: kind,
        p_name: name.trim(),
        p_visibility: visibility,
        p_join_policy: visibility === 'private' && joinPolicy === 'open' ? 'request' : joinPolicy,
        p_description: description.trim() || null,
        p_rules: rules.trim() || null,
        p_region: district?.region_id ?? null,
        p_district: district?.id ?? null,
        p_city_label: district?.name ?? null
      });
      track('club_action', { action: 'created', club_kind: kind, visibility });
      void qc.invalidateQueries({ queryKey: ['my_clubs'] });
      router.replace({ pathname: '/club/[id]', params: { id } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button label="Create group" size="lg" arrow onPress={create} loading={busy} disabled={name.trim().length < 3 || busy} />}>
      <Stack.Screen options={{ title: 'Create a group' }} />
      <View style={{ flexDirection: 'row', gap: spacing.md }} accessibilityRole="radiogroup" accessibilityLabel="Group type">
        {([
          { value: 'club', icon: 'clubs', title: 'Club', body: 'A crew you invite people into.' },
          { value: 'community', icon: 'globe', title: 'Community', body: 'A local group people can find and join.' }
        ] as const).map((o) => {
          const selected = kind === o.value;
          return (
            <PressableScale key={o.value} onPress={() => setKind(o.value)} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${o.title}. ${o.body}`} style={{ flex: 1, gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 2, borderColor: selected ? p.primary : 'transparent', backgroundColor: selected ? p.primarySoft : p.surface }}>
              <Icon name={o.icon} color={selected ? p.primary : p.textMuted} size={24} />
              <Txt variant="heading">{o.title}</Txt>
              <Txt variant="caption">{o.body}</Txt>
            </PressableScale>
          );
        })}
      </View>
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} />
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={1000} />
      <TextField label="Rules (optional)" value={rules} onChangeText={setRules} multiline maxLength={2000} />
      <View style={{ gap: spacing.sm }}>
        <Txt variant="label">Visibility</Txt>
        <Segmented label="Visibility" value={visibility} onChange={(v) => { setVisibility(v); if (v === 'private' && joinPolicy === 'open') setJoinPolicy('request'); }} options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]} />
      </View>
      <View style={{ gap: spacing.sm }}>
        <Txt variant="label">How people join</Txt>
        <Segmented label="How people join" value={joinPolicy} onChange={setJoinPolicy} options={[...(visibility === 'public' ? [{ value: 'open' as const, label: 'Open' }] : []), { value: 'request', label: 'Request' }, { value: 'invite_only', label: 'Invite only' }]} />
      </View>
      <Badge icon="pin" tone={district ? 'violet' : 'muted'} label={district ? `Area: ${district.name}` : 'Set your city in your profile to list this group locally'} />
      {error ? <Banner tone="danger" text={error} /> : null}
    </Screen>
  );
}
