import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Badge, Banner, Button, Screen, Segmented, TextField, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import type { ClubKind } from '@/features/clubs/api';
import { useDistricts } from '@/features/profile/ProfileForm';
import { useSession } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';

/**
 * Start a group (a private crew: you add the people, it has a chat) or a community (a club or local
 * community that can be public, private or invitation-only, with admins, announcements, races and
 * challenges), whichever the entry point asked for. The creator becomes the owner. Logo, cover and
 * colour are added afterwards in Manage.
 */
export default function CreateClub() {
  const p = usePalette();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ kind?: ClubKind }>();
  const { profile } = useSession();
  const districts = useDistricts();
  const kind: ClubKind = params.kind === 'group' ? 'group' : 'community';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [joinPolicy, setJoinPolicy] = useState<'open' | 'request' | 'invite_only'>('request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const district = districts.data?.find((d) => d.id === profile?.district_id) ?? null;
  const group = kind === 'group';

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await rpc<string>('create_club', {
        p_kind: kind,
        p_name: name.trim(),
        p_visibility: group ? 'private' : visibility,
        p_join_policy: group ? 'invite_only' : visibility === 'private' && joinPolicy === 'open' ? 'request' : joinPolicy,
        p_description: description.trim() || null,
        p_rules: group ? null : rules.trim() || null,
        p_region: district?.region_id ?? null,
        p_district: district?.id ?? null,
        p_city_label: district?.name ?? null
      });
      track('club_action', { action: 'created', club_kind: kind, visibility: group ? 'private' : visibility });
      void qc.invalidateQueries({ queryKey: ['my_clubs'] });
      router.replace({ pathname: '/club/[id]', params: { id } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button label={group ? 'Start the group' : 'Start the community'} size="lg" arrow onPress={create} loading={busy} disabled={name.trim().length < 3 || busy} />}>
      <Stack.Screen options={{ title: group ? 'New group' : 'New community' }} />
      {/* Each entry point starts one kind: "New community" never offers a group, and the other way round. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={group ? 'chat' : 'clubs'} color={p.primary} size={22} />
        </View>
        <Txt color="textMuted" style={{ flex: 1 }}>{group ? 'A private crew: you add the people, and it has its own chat.' : 'A club or local community, with admins, announcements, races and challenges.'}</Txt>
      </View>
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} placeholder={group ? 'Tuesday Crew' : 'Harbour Striders'} />
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={1000} />
      {group ? (
        <Txt color="textMuted">Groups are always private: only the people you add can see the group, its posts and its chat. You can add a picture after creating it.</Txt>
      ) : (
        <>
          <TextField label="Rules (optional)" value={rules} onChangeText={setRules} multiline maxLength={2000} />
          <View style={{ gap: spacing.sm }}>
            <Txt variant="label">Who can see it</Txt>
            <Segmented label="Who can see it" value={visibility} onChange={(v) => { setVisibility(v); if (v === 'private' && joinPolicy === 'open') setJoinPolicy('request'); }} options={[{ value: 'public', label: 'Anyone' }, { value: 'private', label: 'Members only' }]} />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Txt variant="label">How people join</Txt>
            <Segmented label="How people join" value={joinPolicy} onChange={setJoinPolicy} options={[...(visibility === 'public' ? [{ value: 'open' as const, label: 'Open' }] : []), { value: 'request', label: 'Request' }, { value: 'invite_only', label: 'Invite only' }]} />
          </View>
          <Badge icon="pin" tone={district ? 'violet' : 'muted'} label={district ? `Area: ${district.name} (with its own members' race)` : 'Set your city in your profile to list this community locally'} />
        </>
      )}
      {error ? <Banner tone="danger" text={error} /> : null}
    </Screen>
  );
}
