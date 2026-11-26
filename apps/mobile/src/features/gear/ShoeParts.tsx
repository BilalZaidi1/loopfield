import { useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { router } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { useFeature } from '@/lib/appConfig';
import { Button, Card, ListGroup, Row, Sheet, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useSignedUrl } from '@/features/social/media';
import { useUnits } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';
import { GEAR_BUCKET, inUse, setRunGear, useMyGear, type Gear } from './api';
import { gearDistance } from './text';

/** The pair's photo, or a shoe on a tinted tile. */
export function ShoeThumb({ path, size = 48 }: { path: string | null | undefined; size?: number }) {
  const p = usePalette();
  const url = useSignedUrl(GEAR_BUCKET, path ?? null);
  const box = { width: size, height: size, borderRadius: radius.md };
  if (path && url.data) return <Image source={{ uri: url.data }} style={box} accessibilityIgnoresInvertColors />;
  return (
    <View style={[box, { backgroundColor: p.blueSoft, alignItems: 'center', justifyContent: 'center' }]}>
      <Icon name="shoe" color={p.blueText} size={Math.round(size * 0.55)} />
    </View>
  );
}

/**
 * "Shoes: Blue trainers, 512 km. Change" on a run: which pair the run counts towards, and a sheet to choose
 * another or none. Shown only to a runner who has shoes, and only once the server has the run.
 */
export function RunShoesCard({ activityId, gearId }: { activityId: string; gearId: string | null | undefined }) {
  const p = usePalette();
  const units = useUnits();
  const on = useFeature('gear_enabled');
  const gear = useMyGear();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!on || gearId === undefined || !gear.data?.length) return null;
  const list = gear.data;
  const pair = list.find((g) => g.id === gearId) ?? null;
  // Pairs in use, plus the run's own pair if it has since been retired.
  const choices = [...inUse(list), ...(pair?.retired_at ? [pair] : [])];
  const pick = async (id: string | null) => {
    if (id === (gearId ?? null)) return setOpen(false);
    setBusy(true);
    try {
      await setRunGear(activityId, id);
      setOpen(false);
    } catch (e) {
      Alert.alert('Not changed', friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const line = pair ? `${pair.name}, ${gearDistance(pair.distance_m, units)}` : 'None';
  return (
    <Card accessibilityLabel={`Shoes on this run: ${line}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <ShoeThumb path={pair?.photo_path} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label" color="textMuted">Shoes</Txt>
          <Txt variant="bodyStrong" numberOfLines={2}>{line}</Txt>
        </View>
        <Button size="sm" variant="secondary" label="Change" onPress={() => setOpen(true)} accessibilityLabel="Change the shoes this run counts towards" />
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Shoes for this run">
        <ListGroup>
          {choices.map((g: Gear) => (
            <Row key={g.id} leading={<ShoeThumb path={g.photo_path} size={40} />} title={g.name}
              subtitle={`${gearDistance(g.distance_m, units)}${g.retired_at ? ' · retired' : ''}`}
              right={g.id === gearId ? <Icon name="check" color={p.primary} size={22} /> : undefined}
              onPress={busy ? undefined : () => void pick(g.id)} accessibilityLabel={`${g.name}${g.id === gearId ? ', chosen' : ''}`} />
          ))}
          <Row icon="close" title="No shoes" subtitle="The run counts towards no pair"
            right={!gearId ? <Icon name="check" color={p.primary} size={22} /> : undefined}
            onPress={busy ? undefined : () => void pick(null)} accessibilityLabel={`No shoes${!gearId ? ', chosen' : ''}`} />
        </ListGroup>
        <Button variant="ghost" icon="shoe" label="Manage shoes" onPress={() => {
          setOpen(false);
          router.push('/shoes');
        }} />
      </Sheet>
    </Card>
  );
}
