import { useEffect, useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { fmtDistance } from '@/lib/format';
import { Banner, Button, PressableScale, Row, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import type { RunMode } from '@/recording/db';
import { useUnits } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';
import { GoButton } from './GoButton';
import { BROWSER, RUN_MODES, type PreRun } from './usePreRun';

/** The four run types as one row of buttons: icon over a short name, the chosen one filled. */
export function ModePicker({ value, onChange }: { value: RunMode; onChange: (m: RunMode) => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.xs }} accessibilityRole="radiogroup" accessibilityLabel="Run type">
      {RUN_MODES.map((m) => {
        const selected = m.value === value;
        return (
          <PressableScale
            key={m.value}
            onPress={() => onChange(m.value)}
            scaleTo={0.95}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${m.title}. ${m.body}`}
            style={{ flex: 1, minHeight: 60, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 2,
              backgroundColor: selected ? p.primaryFill : p.surfaceAlt }}>
            <Icon name={m.icon} color={selected ? '#FFFFFF' : p.textMuted} size={20} strokeWidth={selected ? 2.4 : 2} />
            <Txt variant="label" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: selected ? '#FFFFFF' : p.text, fontSize: 13 }}>{m.title}</Txt>
          </PressableScale>
        );
      })}
    </View>
  );
}

/**
 * Before the run, in one place: the run type, a line on what it does and where it counts, the loop-capture
 * switch or the chosen route, anything that blocks a competitive run, and GO. `starting` keeps GO busy
 * from the tap until the recorder switches to the live view.
 */
export function PreRunControls({ pre, compact }: { pre: PreRun; compact?: boolean }) {
  const p = usePalette();
  const units = useUnits();
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!starting) return;
    // The recorder switches to the live view within a second; if it does not, GO comes back.
    const id = setTimeout(() => setStarting(false), 4000);
    return () => clearTimeout(id);
  }, [starting]);
  const info = RUN_MODES.find((m) => m.value === pre.mode)!;
  const blocker = pre.blockers[0];
  const go = async () => {
    if (await pre.start()) setStarting(true);
  };
  return (
    <View style={{ gap: compact ? spacing.sm : spacing.md }}>
      <ModePicker value={pre.mode} onChange={pre.setMode} />
      <Txt variant="caption" color="text">{pre.counts ? `${info.body} ${pre.counts}` : info.body}</Txt>
      {pre.wantsTerritory ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Txt variant="label">Start the loop capture at GO</Txt>
            <Txt variant="caption">Off: jog to your loop first and start it from the run screen.</Txt>
          </View>
          <Switch value={pre.captureNow} onValueChange={pre.setCaptureNow} accessibilityLabel="Start the loop capture at GO"
            trackColor={{ true: p.primaryFill, false: p.borderStrong }} thumbColor="#FFFFFF" ios_backgroundColor={p.borderStrong}
            {...(Platform.OS === 'web' ? ({ activeThumbColor: '#FFFFFF', activeTrackColor: p.primaryFill } as object) : null)} />
        </View>
      ) : null}
      {pre.wantsSpeed ? (
        pre.courseId && pre.course.data ? (
          <Row icon="route" title={pre.course.data.name} subtitle={`${fmtDistance(pre.course.data.length_m, units)} · tap to change`} onPress={() => router.push('/routes')} />
        ) : pre.courseId && pre.course.isLoading ? <Txt variant="caption">Loading the route…</Txt> : null
      ) : null}
      {blocker ? (
        <Banner tone="warning" text={blocker.text}
          action={blocker.settings ? { label: 'Privacy settings', onPress: () => router.push('/settings/privacy') } : blocker.route ? { label: 'Choose a route', onPress: () => router.push('/routes') } : undefined} />
      ) : null}
      {pre.error ? <Banner tone="danger" text={pre.error} /> : null}
      <View style={{ alignItems: 'center', marginVertical: compact ? -spacing.sm : 0 }}>
        <GoButton size={compact ? 88 : 116} halo={!compact} accessibilityLabel={pre.mode === 'private' ? 'Start private run' : `Start ${info.title.toLowerCase()} run`}
          onPress={() => void go()} busy={pre.busy || starting} disabled={pre.blockers.length > 0} />
      </View>
      {blocker && pre.mode !== 'private' && !BROWSER ? <Button variant="ghost" size="sm" icon="lock" label="Record privately instead" onPress={() => { pre.setMode('private'); }} /> : null}
      {pre.distanceEvents.length && pre.mode !== 'private' ? (
        <Txt variant="caption" style={{ color: p.textMuted }}>{`Your verified distance also counts in ${pre.distanceEvents.length === 1 ? pre.distanceEvents[0]!.name : `${pre.distanceEvents.length} distance events`}.`}</Txt>
      ) : null}
    </View>
  );
}
