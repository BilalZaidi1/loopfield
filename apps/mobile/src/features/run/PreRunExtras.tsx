import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { rpc } from '@/lib/api';
import { useAppConfig } from '@/lib/appConfig';
import { fmtDistance } from '@/lib/format';
import { Button, ListGroup, Row, Sheet, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { LiveShareSheet } from '@/features/live/LiveShare';
import { useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';
import type { PreRun } from './usePreRun';

/** Before GO (R1): the route to follow, if any. Racing a speed route follows its own line unless switched off. */
export function FollowPicker({ pre }: { pre: PreRun }) {
  const p = usePalette();
  const units = useUnits();
  const [open, setOpen] = useState(false);
  const racing = pre.wantsSpeed && Boolean(pre.courseId && pre.course.data);
  const routes = pre.planned.data ?? [];
  if (racing) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Txt variant="label">{"Follow the route's line"}</Txt>
          <Txt variant="caption">You hear an alert if you go off it. It never changes your time.</Txt>
        </View>
        <Switch value={pre.followCourse} onValueChange={pre.setFollowCourse} accessibilityLabel="Follow the route's line"
          trackColor={{ true: p.primaryFill, false: p.borderStrong }} thumbColor="#FFFFFF" />
      </View>
    );
  }
  const chosen = pre.follow?.kind === 'planned' ? pre.follow : null;
  return (
    <>
      <Row icon="route" title={chosen ? `Following ${chosen.name}` : 'Follow a planned route'}
        subtitle={chosen ? 'Tap to change' : routes.length ? 'Optional' : 'Plan one first'}
        onPress={() => (routes.length ? setOpen(true) : router.push('/plan'))} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Follow a route">
        <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
          <ListGroup>
            <Row title="No route" onPress={() => { pre.setPlanId(null); setOpen(false); }}
              right={!pre.planId ? <Icon name="check" color={p.primary} size={22} /> : undefined} />
            {routes.map((r) => (
              <Row key={r.id} title={r.name} subtitle={`${fmtDistance(r.distance_m, units)}${r.is_loop ? ' · loop' : ''}`}
                right={pre.planId === r.id ? <Icon name="check" color={p.primary} size={22} /> : undefined}
                onPress={() => { pre.setPlanId(r.id); setOpen(false); }} />
            ))}
          </ListGroup>
        </ScrollView>
        <Button variant="ghost" icon="plus" label="Plan a new route" onPress={() => { setOpen(false); router.push('/plan'); }} />
      </Sheet>
    </>
  );
}

/** Before GO (R1): share a live link, or see that the standing link will share this run. */
export function LivePicker({ pre }: { pre: PreRun }) {
  const p = usePalette();
  const { settings } = useAppConfig();
  const [open, setOpen] = useState(false);
  if (!settings.enabled.live_links_enabled) return null;
  if (pre.pendingLive) {
    const cancel = async () => {
      const link = pre.pendingLive!;
      pre.setPendingLive(null);
      if (link.kind === 'run') await rpc('live_link_end', { p_token: link.token }).catch(() => {});
    };
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="share" color={p.primary} size={20} />
        <Txt variant="caption" color="text" style={{ flex: 1 }}>Live link sent. People with it see this run once you start.</Txt>
        <Button size="sm" variant="ghost" label="Cancel" onPress={() => void cancel()} />
      </View>
    );
  }
  if (pre.standing && !pre.skipStanding) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessibilityLiveRegion="polite">
        <Icon name="share" color={p.primary} size={20} />
        <Txt variant="caption" color="text" style={{ flex: 1 }}>Your standing live link is on: people with it can see this run.</Txt>
        <Button size="sm" variant="ghost" label="Not this run" onPress={() => pre.setSkipStanding(true)} />
      </View>
    );
  }
  return (
    <>
      <Row icon="share" title="Share live location" subtitle={pre.standing ? 'Not shared this run. Tap to share' : 'Optional: family and friends see where you are'} onPress={() => setOpen(true)} />
      <LiveShareSheet visible={open} onClose={() => setOpen(false)} sessionId={null} onShared={(link) => { pre.setPendingLive(link); pre.setSkipStanding(false); }} />
    </>
  );
}
