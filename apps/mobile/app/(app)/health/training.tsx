import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { track } from '@/lib/analytics';
import { fmtDate, fmtDistance, fmtDuration } from '@/lib/format';
import { Banner, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { DataTable } from '@/components/charts';
import { LoadChart } from '@/features/training/LoadChart';
import { balanceWord, NOT_MEDICAL, weekRows } from '@/features/training/text';
import { useTraining } from '@/health/training';
import { useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

/**
 * Training (R2): how training has built up over twelve weeks (6-week load, 7-day load and the balance between
 * them) and what recent runs suggest for 5K to marathon. Worked out on this phone only. Our own names; for
 * training, not medical advice.
 */
export default function TrainingScreen() {
  const units = useUnits();
  const t = useTraining();
  const [part, setPart] = useState<'load' | 'predictions'>('load');
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (t.enabled) track('training_viewed', { part });
  }, [part, t.enabled]);

  // Twelve weeks starting on a Monday, so the table's weeks are whole.
  const days = useMemo(() => {
    const all = t.summary?.days ?? [];
    const first = all.findIndex((d) => new Date(`${d.day}T12:00:00`).getDay() === 1);
    return first > 0 ? all.slice(first) : all;
  }, [t.summary]);

  if (!t.enabled) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Training' }} />
        <EmptyState icon="progress" title="Training is paused for now" body="Your runs and health data are unchanged." />
      </Screen>
    );
  }
  if (t.loading) return <Screen><Stack.Screen options={{ title: 'Training' }} /><LoadingState variant="cards" /></Screen>;
  if (t.error) return <Screen><Stack.Screen options={{ title: 'Training' }} /><ErrorState error={t.error} /></Screen>;
  const s = t.summary;
  const counted = s?.runsCounted ?? 0;
  const first = days[0];
  const last = days[days.length - 1];
  const chartLabel = first && last
    ? `Training load over twelve weeks. 6-week load went from ${Math.round(first.long)} to ${Math.round(last.long)}; 7-day load is now ${Math.round(last.short)}.`
    : 'Training load chart.';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Training' }} />
      <Segmented label="Training" value={part} onChange={setPart} options={[{ value: 'load', label: 'Load' }, { value: 'predictions', label: 'Race predictions' }]} />
      {!counted ? (
        <EmptyState icon="record" title="No runs to count yet" body="Record a run, or connect Apple Health or Health Connect, and your training shows here." action={{ label: 'Health connections', onPress: () => router.push('/health/connections') }} />
      ) : part === 'load' ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              <View style={{ flex: 1 }}>
                <Txt variant="caption">6-week load</Txt>
                <Txt variant="title">{Math.round(s!.long)}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="caption">7-day load</Txt>
                <Txt variant="title">{Math.round(s!.short)}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="caption">Balance</Txt>
                <Txt variant="title">{s!.balanceReady ? String(Math.round(s!.balance)) : '–'}</Txt>
              </View>
            </View>
            <Txt>{s!.balanceReady ? `${balanceWord(s!.balance)}. Balance is your 6-week load minus your 7-day load: above zero means fresher than usual.` : 'Balance shows after about three weeks of runs.'}</Txt>
          </Card>
          <Section title="Twelve weeks">
            <LoadChart days={days} label={chartLabel} />
            <Button size="sm" variant="ghost" icon={table ? 'progress' : 'layers'} label={table ? 'Show the chart only' : 'Show as a table'} onPress={() => setTable((v) => !v)} />
            {table ? <DataTable header={['Week of', 'Effort', '6-week', '7-day', 'Balance']} rows={weekRows(days)} /> : null}
          </Section>
          <Section title="How effort is worked out">
            <Txt>Each run gets an effort score: minutes in each heart-rate zone times the zone number. Without heart rate, it is minutes times your 1 to 10 rating of how it felt, halved; with neither, the run counts as moderate.</Txt>
            {s!.estimatedRuns ? <Txt variant="caption">{`${s!.estimatedRuns} of ${counted} runs here are estimated, without heart rate.`}</Txt> : null}
            {!t.zones ? <Banner tone="info" text="Set your heart-rate zones so runs with heart rate use them." action={{ label: 'Zones', onPress: () => router.push('/health/zones') }} /> : (
              <Txt variant="caption">{`Using your zones from the Zones screen (${t.zones.basis === 'user_thresholds' ? 'set by you' : 'from your maximum heart rate'}). A wrong maximum heart rate changes every score.`}</Txt>
            )}
          </Section>
        </>
      ) : (
        <Section title="Race predictions">
          {t.predictions.length ? (
            <ListGroup>
              {t.predictions.map((p) => (
                <Row key={p.label} icon="stopwatch" title={`${p.label}: ${fmtDuration(p.low * 1000)} to ${fmtDuration(p.high * 1000)}`}
                  subtitle={`Based on your ${fmtDistance(p.basedOn.distanceM, units)} run on ${fmtDate(p.basedOn.start, { day: 'numeric', month: 'short' })}`} />
              ))}
            </ListGroup>
          ) : (
            <Txt>A run of 3 km or more in the last eight weeks gives your first predictions.</Txt>
          )}
          <Txt variant="caption">From your best runs of 3 km or more in the last eight weeks, with Riegel’s formula. The half marathon needs a run of 8 km or more, and the marathon one of 15 km or more. Long races depend on training these numbers can’t see.</Txt>
        </Section>
      )}
      <Txt variant="caption">{NOT_MEDICAL} Worked out on this phone; nothing here is uploaded.</Txt>
    </Screen>
  );
}
