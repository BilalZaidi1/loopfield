import { useEffect, useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import { timeInZones, zonesFromMaxHr } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { fmtDate, fmtDuration } from '@/lib/format';
import { BarChart } from '@/components/charts';
import { View } from 'react-native';
import { Banner, Button, Card, Chip, EmptyState, Screen, Section, TextField, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { radius, spacing, usePalette } from '@/theme/tokens';
import { getZoneConfig, saveZoneConfig } from '@/health/cache';
import { quantities, useHealthDerived } from '@/health/useHealth';

/** Zone swatches, cool to hot (each labelled, so colour is never the only signal). */
const ZONE_COLORS = ['#A9D8F5', '#8BE07A', '#FFE27A', '#FFB547', '#FF7B7B'];

/** S39 Heart rate zones — thresholds, basis and version, time in zones and uncovered intervals. */
export default function Zones() {
  const p = usePalette();
  const d = useHealthDerived();
  const [config, setConfig] = useState(() => getZoneConfig());
  const [maxHr, setMaxHr] = useState(config?.maxHr ? String(config.maxHr) : '');
  const sessions = useMemo(() => d.sessions.filter((s) => s.activity === 'running').slice(-10).reverse(), [d.sessions]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => track('health_viewed', { screen: 'zones', session_count: d.sessions.length }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const session = sessions.find((s) => s.id === selected) ?? sessions[0] ?? null;
  const hr = quantities(d.store, 'heart_rate');
  const summary = useMemo(() => (config && session ? timeInZones(hr, session.start, session.end, config) : null), [config, session, hr]);

  const save = () => {
    const v = Number(maxHr);
    if (!Number.isFinite(v) || v < 120 || v > 230) return;
    const next = zonesFromMaxHr(Math.round(v), (config?.version ?? 0) + 1);
    saveZoneConfig(next);
    setConfig(next);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Heart rate zones' }} />
      <Card accessibilityLabel="Zone settings">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="pulse" color={p.greenText} size={22} />
          <Txt variant="heading">Your zones</Txt>
        </View>
        {config ? (
          <>
            <Txt variant="caption">Version {config.version} · based on a maximum heart rate you entered ({config.maxHr} bpm). Changing it creates a new version; older summaries keep the version they used.</Txt>
            <View style={{ gap: spacing.xs }}>
              {config.lowerBounds.map((b, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }} accessible accessibilityLabel={`Zone ${i + 1}: ${b}${config.lowerBounds[i + 1] ? ` to ${config.lowerBounds[i + 1]! - 1}` : ' and above'} bpm`}>
                  <View style={{ width: 34, height: 26, borderRadius: radius.xs, backgroundColor: ZONE_COLORS[i] ?? '#888', alignItems: 'center', justifyContent: 'center' }}>
                    <Txt variant="micro" style={{ color: '#121318' }}>{`Z${i + 1}`}</Txt>
                  </View>
                  <Txt variant="bodyStrong" tabular>{`${b}${config.lowerBounds[i + 1] ? `–${config.lowerBounds[i + 1]! - 1}` : '+'} bpm`}</Txt>
                </View>
              ))}
            </View>
          </>
        ) : <Txt color="textMuted">Set your maximum heart rate to calculate zones (50–100% of max, in five bands).</Txt>}
        <TextField label="Maximum heart rate (bpm)" value={maxHr} onChangeText={setMaxHr} keyboardType="number-pad" hint="Use a value you know from testing or your clinician; estimates by age are unreliable." />
        <Button variant="secondary" label="Save zones" onPress={save} disabled={!maxHr || Number(maxHr) < 120 || Number(maxHr) > 230} />
      </Card>
      {!config ? null : sessions.length === 0 ? (
        <EmptyState icon="pulse" title="No runs with workout data yet" body="Time in zones appears for runs recorded here or imported, when heart rate readings exist on this phone." />
      ) : (
        <Section title="Time in zones" icon="stopwatch">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Run">
            {sessions.slice(0, 6).map((s) => <Chip key={s.id} label={fmtDate(s.start, { month: 'short', day: 'numeric' })} selected={session?.id === s.id} onPress={() => setSelected(s.id)} />)}
          </View>
          {summary && summary.msInZone.some((x) => x > 0) ? (
            <>
              <BarChart title="Minutes per zone" unit="min" data={summary.msInZone.map((ms, i) => ({ label: `Z${i + 1}`, long: `Zone ${i + 1}`, value: ms / 60_000 }))} format={(v) => v.toFixed(1)} table={{ period: 'Zone', series: 'Minutes', total: true }} />
              {summary.uncoveredMs > 0 ? <Banner tone="info" text={`${fmtDuration(summary.uncoveredMs)} of this run had no heart rate readings and is not assigned to any zone.`} /> : null}
              <Txt variant="caption">Zone version {summary.zoneVersion}. Descriptive only — not training or medical advice.</Txt>
            </>
          ) : <Txt color="textMuted">No heart rate readings were recorded during this run.</Txt>}
        </Section>
      )}
    </Screen>
  );
}
