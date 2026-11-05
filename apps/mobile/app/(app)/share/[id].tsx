import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '@/lib/api';
import { fmtArea, fmtDate, fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import { Badge, Banner, BigNumber, Button, Card, Chip, ListGroup, LoadingState, Screen, Section, TextField, Toggle, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { spacing } from '@/theme/tokens';
import { AUDIENCE_LABEL } from '@/features/social/PostCard';
import { publishPost, type ShareField } from '@/features/social/publish';
import { useActivityDetail } from '@/features/results/useActivity';
import { useNow } from '@/lib/useNow';
import { useSession, useUnits } from '@/state/session';

/** S25 Share preview — exact basic activity or achievement fields and chosen audience; no imported biometrics. */
export default function SharePreview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const units = useUnits();
  const qc = useQueryClient();
  const { settings } = useSession();
  const detail = useActivityDetail(id);
  const now = useNow();
  const [fields, setFields] = useState<Record<ShareField, boolean>>({ distance: true, duration: true, pace: true, date: true, land: true, title: true });
  const [audience, setAudience] = useState<'only_me' | 'followers' | 'public'>(settings?.default_post_audience ?? 'followers');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = detail.data?.activity;
  if (detail.isLoading || !a) return <Screen><Stack.Screen options={{ title: 'Share run' }} /><LoadingState variant="cards" /></Screen>;
  const claimEligible = detail.data?.claim?.status === 'eligible';
  const titleHeld = detail.data?.attempts.some((t) => t.is_benchmark);
  const delayed = (claimEligible && fields.land && detail.data?.claim?.publish_after && Date.parse(detail.data.claim.publish_after) > now) || (titleHeld && fields.title);
  const chosen = (Object.keys(fields) as ShareField[]).filter((k) => fields[k] && (k !== 'land' || claimEligible) && (k !== 'title' || titleHeld));

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await publishPost({ audience, body, activityId: a.id, shareFields: chosen });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      router.replace({ pathname: '/post/[id]', params: { id: r.postId } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (k: ShareField) => (v: boolean) => setFields((f) => ({ ...f, [k]: v }));
  const dist = splitValue(fmtDistance(a.distance_m, units));
  const meta = [fields.duration ? fmtDuration(a.elapsed_ms) : null, fields.pace ? fmtPace(a.avg_pace_s_per_km, units) : null, fields.date ? fmtDate(a.started_at) : null].filter(Boolean);
  return (
    <Screen footer={<Button label="Publish" size="lg" arrow icon="send" onPress={() => void publish()} loading={busy} disabled={busy || (!chosen.length && !body.trim())} />}>
      <Stack.Screen options={{ title: 'Share run' }} />
      <Card tone="blue" accessibilityLabel="Preview">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name={audience === 'only_me' ? 'lock' : audience === 'followers' ? 'clubs' : 'globe'} color="#FFFFFF" size={20} />
          <Txt variant="label" style={{ flex: 1 }}>{`Preview · ${AUDIENCE_LABEL[audience]}`}</Txt>
        </View>
        {body ? <Txt>{body}</Txt> : null}
        {fields.distance ? (
          <BigNumber value={dist.value} unit={dist.unit} size={64} />
        ) : null}
        <Txt color="textMuted">{meta.length ? meta.join('   ') : fields.distance ? '' : 'No run fields selected'}</Txt>
        {(claimEligible && fields.land) || (titleHeld && fields.title) ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {claimEligible && fields.land ? <Badge icon="hexagon" label="Claimed land" /> : null}
            {titleHeld && fields.title ? <Badge icon="trophy" label="Took a route title" /> : null}
          </View>
        ) : null}
      </Card>
      <Txt color="textMuted">Choose exactly what to share. The route map, GPS trace and any health readings are never included.</Txt>
      <Section title="What to include" icon="check">
        <ListGroup>
          <Toggle label={`Distance (${fmtDistance(a.distance_m, units)})`} value={fields.distance} onChange={toggle('distance')} />
          <Toggle label={`Duration (${fmtDuration(a.elapsed_ms)})`} value={fields.duration} onChange={toggle('duration')} />
          <Toggle label={`Average pace (${fmtPace(a.avg_pace_s_per_km, units)})`} value={fields.pace} onChange={toggle('pace')} />
          <Toggle label="Date" value={fields.date} onChange={toggle('date')} />
          {claimEligible ? <Toggle label={`Land claimed (${fmtArea(detail.data?.claim?.eligible_area_m2, units)})`} value={fields.land} onChange={toggle('land')} /> : null}
          {titleHeld ? <Toggle label="Route title" value={fields.title} onChange={toggle('title')} /> : null}
        </ListGroup>
      </Section>
      <TextField label="Caption (optional)" value={body} onChangeText={setBody} multiline maxLength={2000} />
      <Section title="Who can see it" icon="eye">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Audience">
          <Chip icon="lock" label="Only me" selected={audience === 'only_me'} onPress={() => setAudience('only_me')} />
          <Chip icon="clubs" label="Followers" selected={audience === 'followers'} onPress={() => setAudience('followers')} />
          <Chip icon="globe" label="Public" selected={audience === 'public'} onPress={() => setAudience('public')} />
        </View>
      </Section>
      {delayed ? <Banner text="Achievements appear in the post only after the result is published (at least 30 minutes after the run)." /> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
    </Screen>
  );
}
