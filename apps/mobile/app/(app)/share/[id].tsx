import { useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '@/lib/api';
import { fmtArea, fmtDistance, fmtDuration, fmtPace } from '@/lib/format';
import { Badge, Banner, Button, Card, LoadingState, Screen, Segmented, TextField, Toggle, Txt } from '@/components/ui';
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
  if (detail.isLoading || !a) return <LoadingState />;
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
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Share run' }} />
      <Txt color="textMuted">Choose exactly what to share. The route map, GPS trace and any health readings are never included.</Txt>
      <Toggle label={`Distance (${fmtDistance(a.distance_m, units)})`} value={fields.distance} onChange={toggle('distance')} />
      <Toggle label={`Duration (${fmtDuration(a.elapsed_ms)})`} value={fields.duration} onChange={toggle('duration')} />
      <Toggle label={`Average pace (${fmtPace(a.avg_pace_s_per_km, units)})`} value={fields.pace} onChange={toggle('pace')} />
      <Toggle label="Date" value={fields.date} onChange={toggle('date')} />
      {claimEligible ? <Toggle label={`Land claimed (${fmtArea(detail.data?.claim?.eligible_area_m2, units)})`} value={fields.land} onChange={toggle('land')} /> : null}
      {titleHeld ? <Toggle label="Route title" value={fields.title} onChange={toggle('title')} /> : null}
      <TextField label="Caption (optional)" value={body} onChangeText={setBody} multiline maxLength={2000} />
      <Segmented label="Audience" value={audience} onChange={setAudience} options={[{ value: 'only_me', label: 'Only me' }, { value: 'followers', label: 'Followers' }, { value: 'public', label: 'Public' }]} />
      <Card accessibilityLabel="Preview">
        <Txt variant="label">Preview · {AUDIENCE_LABEL[audience]}</Txt>
        {body ? <Txt>{body}</Txt> : null}
        <Txt>
          {[fields.distance ? fmtDistance(a.distance_m, units) : null, fields.duration ? fmtDuration(a.elapsed_ms) : null, fields.pace ? fmtPace(a.avg_pace_s_per_km, units) : null, fields.date ? a.started_at.slice(0, 10) : null].filter(Boolean).join(' · ') || 'No run fields selected'}
        </Txt>
        {claimEligible && fields.land ? <Badge label="Claimed land" tone="success" /> : null}
        {titleHeld && fields.title ? <Badge label="Took a route title" tone="title" /> : null}
      </Card>
      {delayed ? <Banner text="Achievements appear in the post only after the result is published (at least 30 minutes after the run)." /> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button label="Publish" onPress={() => void publish()} loading={busy} disabled={busy || (!chosen.length && !body.trim())} />
    </Screen>
  );
}
