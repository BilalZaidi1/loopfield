import { useState } from 'react';
import { router, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Banner, Button, Screen, Segmented, TextField, Txt } from '@/components/ui';
import { useDistricts } from '@/features/profile/ProfileForm';
import { useSession } from '@/state/session';

/** Create a club (invited crew) or community (open local group). The creator becomes owner. */
export default function CreateClub() {
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
    <Screen>
      <Stack.Screen options={{ title: 'Create a group' }} />
      <Segmented label="Group type" value={kind} onChange={setKind} options={[{ value: 'club', label: 'Club' }, { value: 'community', label: 'Community' }]} />
      <Txt variant="caption">{kind === 'club' ? 'A club is a crew you invite people into.' : 'A community is a local group people can find and join.'}</Txt>
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} />
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={1000} />
      <TextField label="Rules (optional)" value={rules} onChangeText={setRules} multiline maxLength={2000} />
      <Segmented label="Visibility" value={visibility} onChange={(v) => { setVisibility(v); if (v === 'private' && joinPolicy === 'open') setJoinPolicy('request'); }} options={[{ value: 'private', label: 'Private' }, { value: 'public', label: 'Public' }]} />
      <Segmented label="How people join" value={joinPolicy} onChange={setJoinPolicy} options={[...(visibility === 'public' ? [{ value: 'open' as const, label: 'Open' }] : []), { value: 'request', label: 'Request' }, { value: 'invite_only', label: 'Invite only' }]} />
      <Txt variant="caption">{district ? `Area: ${district.name}` : 'Set your city in your profile to list this group locally.'}</Txt>
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button label="Create" onPress={create} loading={busy} disabled={name.trim().length < 3 || busy} />
    </Screen>
  );
}
