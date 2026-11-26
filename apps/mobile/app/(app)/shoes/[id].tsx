import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useAppConfig } from '@/lib/appConfig';
import { fmtDate, splitValue } from '@/lib/format';
import { Banner, BigNumber, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, ProgressBar, Screen, TextField, Toggle, Txt, confirm } from '@/components/ui';
import { PausedNote } from '@/components/Notices';
import { deleteGear, removeGearPhoto, retireGear, saveGear, setGearPhoto, useMyGear, wear, type Gear } from '@/features/gear/api';
import { ShoeThumb } from '@/features/gear/ShoeParts';
import { gearDistance, metresText, reminderText, typedMetres, unitWord } from '@/features/gear/text';
import { useSession, useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

/** One pair of shoes (R4): add (`new`) or change it, its distance against the reminder, retire or delete it. */
export default function ShoeScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { settings } = useAppConfig();
  const gear = useMyGear();
  const isNew = id === 'new';
  useEffect(() => {
    if (from === 'reminder') track('gear', { action: 'reminder_opened' });
  }, [from]);
  const title = isNew ? 'Add shoes' : 'Shoes';
  if (!settings.enabled.gear_enabled) return <Screen><Stack.Screen options={{ title }} /><PausedNote feature="gear_enabled" /></Screen>;
  if (gear.isLoading) return <Screen><Stack.Screen options={{ title }} /><LoadingState /></Screen>;
  if (gear.error) return <Screen><Stack.Screen options={{ title }} /><ErrorState error={gear.error} onRetry={() => void gear.refetch()} /></Screen>;
  const list = gear.data ?? [];
  const pair = isNew ? null : list.find((g) => g.id === id) ?? null;
  if (!isNew && !pair) return <Screen><Stack.Screen options={{ title }} /><EmptyState icon="shoe" title="These shoes are not here any more" body="They may have been deleted." /></Screen>;
  return <ShoeForm key={pair?.id ?? 'new'} pair={pair} firstInUse={!list.some((g) => !g.retired_at)} />;
}

async function pickPhoto(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9, exif: false });
  return res.canceled || !res.assets[0] ? null : res.assets[0].uri;
}

function ShoeForm({ pair, firstInUse }: { pair: Gear | null; firstInUse: boolean }) {
  const units = useUnits();
  const { userId } = useSession();
  const { settings } = useAppConfig();
  const photosOn = settings.enabled.photo_uploads_enabled;
  const [name, setName] = useState(pair?.name ?? '');
  const [start, setStart] = useState(pair ? metresText(pair.start_distance_m, units) : '0');
  const [reminder, setReminder] = useState(metresText(pair?.reminder_m ?? settings.gearReminderDefaultKm * 1000, units));
  const [isDefault, setDefault] = useState(pair ? pair.is_default : firstInUse);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startM = typedMetres(start, units);
  const reminderM = typedMetres(reminder, units);
  const nameOk = name.trim().length >= 1 && name.trim().length <= 60;
  const startOk = startM !== null && startM <= 10_000_000;
  const reminderOk = reminderM !== null && reminderM >= 50_000 && reminderM <= 5_000_000;
  const unit = unitWord(units);

  const run = async (work: () => Promise<void>, failTitle: string) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      Alert.alert(failTitle, friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await saveGear({ id: pair?.id ?? null, name, startM: startM!, reminderM: reminderM!, isDefault: pair?.retired_at ? false : isDefault });
      if (picked && userId) {
        try {
          await setGearPhoto(userId, { id, photo_path: null }, picked);
        } catch (e) {
          Alert.alert('Saved without the photo', friendlyError(e));
        }
      }
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const changePhoto = async () => {
    const uri = await pickPhoto();
    if (!uri) return;
    if (!pair) return setPicked(uri);
    if (userId) await run(() => setGearPhoto(userId, pair, uri), 'Photo not added');
  };

  const remove = () =>
    confirm('Delete these shoes?', 'Their runs keep their distances and count towards no pair. This cannot be undone.', 'Delete', () =>
      void run(async () => {
        await deleteGear(pair!);
        router.back();
      }, 'Not deleted'));

  const dist = pair ? splitValue(gearDistance(pair.distance_m, units)) : null;
  const w = pair ? wear(pair) : null;
  const photoPath = pair?.photo_path ?? null;

  return (
    <Screen footer={<Button label={pair ? 'Save changes' : 'Add shoes'} size="lg" onPress={() => void save()} loading={busy} disabled={busy || !nameOk || !startOk || !reminderOk} />}>
      <Stack.Screen options={{ title: pair ? pair.name : 'Add shoes' }} />
      {pair && dist && w ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <ShoeThumb path={photoPath} size={72} />
            <View style={{ flex: 1 }}>
              <BigNumber value={dist.value} unit={dist.unit} label={pair.runs === 1 ? '1 run' : `${pair.runs} runs`} size={52} />
            </View>
          </View>
          <ProgressBar value={w.share} tone={w.due === 'none' ? 'blue' : 'orange'} label={`${gearDistance(pair.distance_m, units)} of the ${gearDistance(pair.reminder_m, units)} reminder distance`} />
          <Txt variant="caption">{reminderText(pair, units)}</Txt>
          {pair.retired_at ? <Txt variant="caption">{`Retired ${fmtDate(pair.retired_at)}. New runs no longer count towards it.`}</Txt> : null}
        </Card>
      ) : null}
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} placeholder="For example, Blue trainers" error={name.length > 0 && !nameOk ? 'Use 1 to 60 characters.' : undefined} />
      <TextField label={`Distance already on them (${unit})`} value={start} onChangeText={setStart} keyboardType="number-pad"
        hint="What they had done before you added them here." error={start.length > 0 && !startOk ? 'Enter a distance.' : undefined} />
      <TextField label={`Remind me at (${unit})`} value={reminder} onChangeText={setReminder} keyboardType="number-pad"
        hint={`A reminder comes at 90% and again at 100%. Many runners replace shoes somewhere between ${gearDistance(500_000, units)} and ${gearDistance(800_000, units)}.`}
        error={reminder.length > 0 && !reminderOk ? `Choose between ${gearDistance(50_000, units)} and ${gearDistance(5_000_000, units)}.` : undefined} />
      {pair?.retired_at ? null : (
        <ListGroup>
          <Toggle label="Count new runs towards this pair" description="Every run you record goes to this pair unless you change it on the run. Only one pair at a time." value={isDefault} onChange={setDefault} />
        </ListGroup>
      )}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {picked ? <Txt style={{ flex: 1 }}>Photo chosen. It is added when you save.</Txt> : <Txt style={{ flex: 1 }}>{photoPath ? 'Photo' : 'No photo'}</Txt>}
          <Button size="sm" variant="secondary" icon="camera" label={photoPath || picked ? 'Change' : 'Add photo'} disabled={busy || !photosOn} onPress={() => void changePhoto()} />
          {photoPath ? <Button size="sm" variant="ghost" label="Remove" disabled={busy} onPress={() => void run(() => removeGearPhoto(pair!), 'Photo not removed')} /> : null}
        </View>
        <Txt variant="caption">Only you see it. Its location and other details are removed on this phone before it is uploaded.</Txt>
        {photosOn ? null : <PausedNote feature="photo_uploads_enabled" />}
      </Card>
      {error ? <Banner tone="danger" text={error} /> : null}
      {pair ? (
        <View style={{ gap: spacing.sm }}>
          <Button variant="secondary" icon={pair.retired_at ? 'refresh' : 'check'} label={pair.retired_at ? 'Put back in use' : 'Retire this pair'} disabled={busy}
            onPress={() => void run(() => retireGear(pair.id, !pair.retired_at), pair.retired_at ? 'Not put back' : 'Not retired')} />
          <Txt variant="caption">{pair.retired_at ? 'Back in use, it can count new runs again.' : 'Retired shoes keep their runs and distance, and stop counting new runs.'}</Txt>
          <Button variant="ghost" icon="trash" label="Delete this pair" disabled={busy} onPress={remove} />
        </View>
      ) : null}
    </Screen>
  );
}
