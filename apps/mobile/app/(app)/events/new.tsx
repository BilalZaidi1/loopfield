import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Banner, Button, ChipGroup, EmptyState, Screen, TextField, Txt } from '@/components/ui';
import { useClub } from '@/features/clubs/api';
import { startOptions, useCreateEvent, windowFrom } from '@/features/events/api';
import { friendlyError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';
import { spacing } from '@/theme/tokens';

type Length = '2' | '7' | '14' | '30';
type Goal = 'none' | '50000' | '100000' | '200000';

/**
 * Create an event. Club organisers make challenges for their members (`?club=`); territory operators
 * make region or worldwide events, including club-against-club ones. Dates are chosen from simple
 * presets so every event starts and ends at a clear local time.
 */
export default function NewEvent() {
  const { club: clubId } = useLocalSearchParams<{ club?: string }>();
  const { roles } = useSession();
  const club = useClub(clubId);
  const operator = roles.includes('territory_operator') || roles.includes('admin');
  const regions = useQuery({
    queryKey: ['regions'],
    enabled: !clubId,
    queryFn: async () => {
      const { data, error } = await supabase().from('regions').select('id, name').eq('status', 'active').order('name');
      if (error) throw error;
      return data ?? [];
    }
  });
  const create = useCreateEvent(clubId ?? null);
  const starts = useMemo(() => startOptions(), []);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'distance' | 'territory'>('distance');
  const [team, setTeam] = useState<'individual' | 'club'>('individual');
  const [region, setRegion] = useState<string>('anywhere');
  const [start, setStart] = useState(starts[1]!.value);
  const [length, setLength] = useState<Length>('7');
  const [goal, setGoal] = useState<Goal>('none');

  const organizer = club.data?.my_role === 'owner' || club.data?.my_role === 'organizer';
  if (clubId ? club.data && !organizer : !operator) {
    return <Screen><Stack.Screen options={{ title: 'New event' }} /><EmptyState icon="flag" title={clubId ? 'Organisers only' : 'Operators only'} body={clubId ? 'Club owners and organisers create challenges.' : 'Events across a region are created by the operations team.'} /></Screen>;
  }

  const at = starts.find((s) => s.value === start)!.at;
  const { startsAt, endsAt } = windowFrom(at, Number(length));
  const regionId = clubId ? null : region === 'anywhere' ? null : region;
  const needsRegion = !clubId && type === 'territory' && !regionId;
  const valid = name.trim().length >= 3 && !needsRegion;
  const submit = () =>
    create.mutate(
      { name, description, eventType: type, teamMode: clubId ? 'individual' : team, regionId, startsAt, endsAt, targetM: type === 'distance' && goal !== 'none' ? Number(goal) : null },
      { onSuccess: (id) => router.replace({ pathname: '/events/[id]', params: { id } }) }
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: clubId ? 'New challenge' : 'New event' }} />
      {clubId && club.data ? <Txt color="textMuted">{`For members of ${club.data.name}. They are told when you create it.`}</Txt> : null}
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} placeholder={type === 'territory' ? 'Weekend Territory Challenge' : 'November 100 km'} />
      <TextField label="What it is about (optional)" value={description} onChangeText={setDescription} maxLength={1000} multiline />
      <ChipGroup label="Scored on" value={type} onChange={setType} options={[{ value: 'distance', label: 'Distance', icon: 'route' }, { value: 'territory', label: 'Land', icon: 'hexagon' }]} />
      <Txt variant="caption">
        {type === 'territory'
          ? 'Land taken in the event by loops runners record for the public race. Event land never changes the all-time map.'
          : 'Server-verified distance of every run started after joining. Only totals are shown.'}
      </Txt>
      {!clubId ? (
        <>
          <ChipGroup label="Who competes" value={team} onChange={setTeam} options={[{ value: 'individual', label: 'Runners', icon: 'user' }, { value: 'club', label: 'Club against club', icon: 'clubs' }]} />
          <ChipGroup label="Where" value={region} onChange={setRegion} scroll
            options={[...(type === 'distance' ? [{ value: 'anywhere', label: 'Anywhere' }] : []), ...(regions.data ?? []).map((r) => ({ value: r.id as string, label: r.name as string }))]} />
          {needsRegion ? <Txt variant="caption" color="textMuted">Land events take place in one region: choose it above.</Txt> : null}
        </>
      ) : null}
      <ChipGroup label="Starts" value={start} onChange={setStart} options={starts.map((s) => ({ value: s.value, label: s.label }))} />
      <ChipGroup<Length> label="Runs for" value={length} onChange={setLength} options={[{ value: '2', label: 'A weekend' }, { value: '7', label: '1 week' }, { value: '14', label: '2 weeks' }, { value: '30', label: '30 days' }]} />
      {type === 'distance' ? (
        <ChipGroup<Goal> label="Distance goal" value={goal} onChange={setGoal} options={[{ value: 'none', label: 'No goal' }, { value: '50000', label: '50 km' }, { value: '100000', label: '100 km' }, { value: '200000', label: '200 km' }]} />
      ) : null}
      <View style={{ gap: spacing.xs }}>
        <Txt variant="label">When</Txt>
        <Txt color="textMuted">{`${fmtDate(startsAt, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} – ${fmtDate(endsAt, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}</Txt>
      </View>
      {create.error ? <Banner tone="danger" text={friendlyError(create.error)} /> : null}
      <Button label={clubId ? 'Create the challenge' : 'Create the event'} size="lg" arrow disabled={!valid} loading={create.isPending} onPress={submit}
        hint={name.trim().length < 3 ? 'Give it a name of at least 3 characters' : needsRegion ? 'Choose a region' : undefined} />
    </Screen>
  );
}
