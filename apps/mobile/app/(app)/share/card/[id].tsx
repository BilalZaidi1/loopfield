import { useMemo, useRef, useState } from 'react';
import { Platform, Share, View, useWindowDimensions, type HostInstance } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { activeEnergyDuring, heartRateSummary } from '@loopfield/core';
import { ActionBar, Banner, ChipGroup, ListGroup, LoadingState, Screen, Section, Toggle, Txt, type ActionItem } from '@/components/ui';
import { quantities, useHealthStore } from '@/health/useHealth';
import { useActivityDetail } from '@/features/results/useActivity';
import { publicActivityUrl, useActivityLink, useLinkActions, useSharePreview } from '@/features/share/api';
import { renderCard, saveImage, shareImage } from '@/features/share/exportCard';
import { CARD_SIZE, ShareCard, type CardFormat } from '@/features/share/ShareCard';
import type { ShareField } from '@/features/social/publish';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDate } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useSession, useUnits } from '@/state/session';
import { useLayout } from '@/theme/layout';
import { spacing } from '@/theme/tokens';

/**
 * Share a run as an image (9:16 for stories, 4:5 and 1:1 for posts) through the phone's share sheet, save
 * it, or add a QR code and link to a public page. The route on the card is the server's trimmed version
 * (first and last 200 m and private areas left out). Heart rate and energy can be added from the phone's
 * health data for the image only: they are drawn on this device and never uploaded.
 */
export default function ShareCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const units = useUnits();
  const { profile } = useSession();
  const { width } = useWindowDimensions();
  const { gutter } = useLayout();
  const now = useNow();
  const detail = useActivityDetail(id);
  const store = useHealthStore();
  const link = useActivityLink(id);
  const { create, revoke } = useLinkActions(id);
  const [format, setFormat] = useState<CardFormat>('9:16');
  const [route, setRoute] = useState(true);
  const [land, setLand] = useState(true);
  const [pace, setPace] = useState(true);
  const [heart, setHeart] = useState(false);
  const [energy, setEnergy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const card = useRef<HostInstance>(null);

  const a = detail.data?.activity;
  const fields: ShareField[] = ['distance', 'duration', 'date', ...(pace ? (['pace'] as const) : []), ...(route ? (['route'] as const) : []), ...(land ? (['land'] as const) : []), 'title'];
  const preview = useSharePreview(id, fields);
  const health = useMemo(() => {
    if (!a) return { hr: null, kcal: null };
    const start = Date.parse(a.started_at);
    const end = Date.parse(a.ended_at);
    const hr = heartRateSummary(quantities(store, 'heart_rate'), start, end);
    return { hr: hr.coverage >= 0.5 ? hr.avg : null, kcal: activeEnergyDuring(quantities(store, 'active_energy'), start, end) };
  }, [a, store]);

  if (detail.isLoading || !a) return <Screen><Stack.Screen options={{ title: 'Share image' }} /><LoadingState variant="cards" /></Screen>;
  const s = preview.data?.summary ?? null;
  const titles = (detail.data?.attempts ?? []).filter((x) => x.is_benchmark).map((x) => `Route title: ${x.course_name}`);
  const activeLink = link.data ?? null;
  const url = activeLink ? publicActivityUrl(activeLink.token) : null;
  const linkWaits = activeLink && Date.parse(activeLink.publish_after) > now;
  const { w, h } = CARD_SIZE[format];
  const scale = Math.min(1, (Math.min(width, 520) - gutter * 2) / w);
  const props = { format, with_route: Boolean(route && preview.data?.route?.length), with_land: Boolean(land && preview.data?.land), with_qr: Boolean(url) };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };
  const doShare = () => run('share', async () => {
    const result = await shareImage(await renderCard(card, format));
    track('share_card', { action: result, ...props });
  });
  const doSave = () => run('save', async () => {
    const result = await saveImage(await renderCard(card, format));
    if (result === 'denied') throw new Error('Allow Loopfield to add photos in Settings to save the image.');
    if (result === 'saved') setDone('Saved to Photos.');
    track('share_card', { action: result === 'saved' ? 'saved' : result, ...props });
  });
  const makeLink = () => run('link', async () => {
    await create.mutateAsync(fields);
    track('share_card', { action: 'link_created', ...props });
  });
  const sendLink = () => run('send', async () => {
    if (!url) return;
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(url);
      setDone('Link copied.');
    } else {
      await Share.share({ message: url, url });
    }
    track('share_card', { action: 'link_shared', ...props });
  });

  const actions: ActionItem[] = [
    { icon: 'share', label: 'Share', primary: true, onPress: () => void doShare(), disabled: Boolean(busy) },
    { icon: 'download', label: Platform.OS === 'web' ? 'Download' : 'Save', onPress: () => void doSave(), disabled: Boolean(busy) },
    url
      ? { icon: 'link', label: Platform.OS === 'web' ? 'Copy link' : 'Send link', onPress: () => void sendLink(), disabled: Boolean(busy) }
      : { icon: 'link', label: 'Add QR', onPress: () => void makeLink(), disabled: Boolean(busy) },
    { icon: 'send', label: 'Post', onPress: () => router.push({ pathname: '/share/[id]', params: { id: a.id } }) }
  ];

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Share image' }} />
      <ChipGroup<CardFormat> label="Format" value={format} onChange={setFormat} options={[{ value: '9:16', label: 'Story 9:16' }, { value: '4:5', label: 'Post 4:5' }, { value: '1:1', label: 'Square 1:1' }]} />
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: w * scale, height: h * scale, borderRadius: 14, overflow: 'hidden' }}>
          <View style={{ width: w, height: h, transform: [{ scale }], transformOrigin: 'top left' }}>
            <ShareCard
              ref={card}
              format={format}
              units={units}
              content={{
                runnerName: profile?.display_name ?? 'Runner',
                handle: profile?.handle ?? 'runner',
                date: s?.activity_date ? fmtDate(a.started_at, { day: 'numeric', month: 'short', year: 'numeric' }) : null,
                distanceM: s?.distance_m ?? a.distance_m,
                elapsedMs: s?.elapsed_ms ?? a.elapsed_ms,
                paceSecPerKm: pace ? s?.avg_pace_s_per_km ?? a.avg_pace_s_per_km : null,
                route: route ? preview.data?.route ?? null : null,
                land: land ? preview.data?.land ?? null : null,
                achievements: titles,
                avgHr: heart ? health.hr : null,
                calories: energy ? health.kcal : null,
                link: url
              }}
            />
          </View>
        </View>
      </View>
      <ActionBar actions={actions} />
      {busy ? <Txt variant="caption" align="center">{busy === 'link' ? 'Making the link…' : 'Preparing the image…'}</Txt> : null}
      {done ? <Banner tone="success" text={done} /> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
      {linkWaits ? <Banner text="The link opens 30 minutes after your run, when its results are published." /> : null}

      <Section title="On the image" icon="image">
        <ListGroup>
          <Toggle label="Route (start and finish hidden)" value={route} onChange={setRoute} />
          {detail.data?.claim?.status === 'eligible' ? <Toggle label="Land and what changed hands" value={land} onChange={setLand} /> : null}
          <Toggle label="Pace" value={pace} onChange={setPace} />
          {health.hr ? <Toggle label={`Average heart rate (${health.hr} bpm, from your phone)`} value={heart} onChange={setHeart} /> : null}
          {health.kcal ? <Toggle label={`Energy (${health.kcal} kcal, from your phone)`} value={energy} onChange={setEnergy} /> : null}
        </ListGroup>
        <Txt variant="caption">
          {health.hr || health.kcal
            ? 'Heart rate and energy come from your phone\'s health data. They are drawn into this image on your phone only: never uploaded, never on your posts or links.'
            : 'Heart rate and energy can be added here when your phone has them for this run (connect health data in Health).'}
        </Txt>
      </Section>

      <Section title="Link and QR code" icon="link">
        {activeLink && url ? (
          <View style={{ gap: spacing.sm }}>
            <Txt color="textMuted">{`Anyone with the link can see this run's page: the same route, distance, time${pace ? ', pace' : ''} and land as the image, never health data. Opened ${activeLink.views} ${activeLink.views === 1 ? 'time' : 'times'}.`}</Txt>
            <Txt variant="label" selectable>{url}</Txt>
            <ListGroup>
              <Toggle label="Keep the public link" value onChange={() => void run('revoke', async () => {
                await revoke.mutateAsync(activeLink.token);
                track('share_card', { action: 'link_revoked', ...props });
                setDone('Link turned off. The QR code no longer opens anything.');
              })} />
            </ListGroup>
          </View>
        ) : (
          <Txt color="textMuted">Add a QR code and a link to a page showing this run (route, distance, time and land). Nothing is listed or searchable; you can turn the link off at any time.</Txt>
        )}
      </Section>
      <Txt variant="caption">Instagram, TikTok, Snapchat, WhatsApp, Facebook and LinkedIn appear in the share sheet when they are installed.</Txt>
    </Screen>
  );
}
