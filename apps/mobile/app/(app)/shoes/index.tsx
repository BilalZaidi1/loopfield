import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAppConfig } from '@/lib/appConfig';
import { fmtDate } from '@/lib/format';
import { Banner, Button, EmptyState, ErrorState, ListGroup, LoadingState, ProgressBar, Row, Screen, Section, Txt } from '@/components/ui';
import { PausedNote } from '@/components/Notices';
import { inUse, retired, useMyGear, wear } from '@/features/gear/api';
import { ShoeThumb } from '@/features/gear/ShoeParts';
import { gearDistance, gearSubtitle, reminderText } from '@/features/gear/text';
import { useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

/** Me → Shoes (R4): the runner's pairs with their distances, the pair new runs count towards, and retired pairs. */
export default function Shoes() {
  const units = useUnits();
  const { settings } = useAppConfig();
  const on = settings.enabled.gear_enabled;
  const gear = useMyGear();
  const list = gear.data ?? [];
  const using = inUse(list);
  const old = retired(list);
  const full = using.length >= settings.gearMaxItems;

  return (
    <Screen onRefresh={on ? () => void gear.refetch() : undefined} refreshing={gear.isRefetching}>
      <Stack.Screen options={{ title: 'Shoes' }} />
      {!on ? <PausedNote feature="gear_enabled" /> : gear.isLoading ? <LoadingState /> : gear.error ? <ErrorState error={gear.error} onRetry={() => void gear.refetch()} /> : (
        <>
          {list.length ? (
            <Section title="In use" icon="shoe">
              {using.length ? (
                <ListGroup>
                  {using.map((g) => {
                    const w = wear(g);
                    return (
                      <View key={g.id}>
                        <Row leading={<ShoeThumb path={g.photo_path} />} title={g.name} subtitle={gearSubtitle(g, units)}
                          onPress={() => router.push({ pathname: '/shoes/[id]', params: { id: g.id } })} />
                        <View style={{ gap: spacing.xs, paddingBottom: spacing.md }}>
                          <ProgressBar value={w.share} tone={w.due === 'none' ? 'blue' : 'orange'} height={6}
                            label={`${g.name}: ${gearDistance(g.distance_m, units)} of its ${gearDistance(g.reminder_m, units)} reminder distance`} />
                          <Txt variant="caption">{reminderText(g, units)}</Txt>
                        </View>
                      </View>
                    );
                  })}
                </ListGroup>
              ) : <Txt color="textMuted">No pairs in use. New runs count towards no pair until you add one or put one back in use.</Txt>}
            </Section>
          ) : (
            <EmptyState icon="shoe" title="Keep count of your shoes" body="Add a pair and every run you record counts towards it, with a reminder as it nears the distance you set." />
          )}
          {full ? <Banner tone="info" text={`You have ${using.length} pairs in use, the most at once. Retire one to add another.`} /> : null}
          <Button icon="plus" label={list.length ? 'Add shoes' : 'Add your first pair'} disabled={full} onPress={() => router.push({ pathname: '/shoes/[id]', params: { id: 'new' } })} />
          {old.length ? (
            <Section title="Retired">
              <ListGroup>
                {old.map((g) => (
                  <Row key={g.id} leading={<ShoeThumb path={g.photo_path} size={40} />} title={g.name}
                    subtitle={`${gearDistance(g.distance_m, units)} · retired ${fmtDate(g.retired_at)}`}
                    onPress={() => router.push({ pathname: '/shoes/[id]', params: { id: g.id } })} />
                ))}
              </ListGroup>
            </Section>
          ) : null}
          <Txt variant="caption">Your shoes are private: they are not on your profile or in anything you share. Runs you record count towards the pair set for new runs, and you can change the pair on any run.</Txt>
        </>
      )}
    </Screen>
  );
}
