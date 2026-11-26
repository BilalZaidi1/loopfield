import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '@/lib/api';
import { PAUSED_TEXT, useAppConfig } from '@/lib/appConfig';
import { Banner, Button, Segmented, Sheet, Toggle, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { attachLiveShare, liveShareFor, pushLive, setPendingLiveShare, stopLiveShare, type LiveKind } from '@/recording/livePush';
import { spacing, usePalette } from '@/theme/tokens';
import { createLiveLink, MY_LIVE_LINKS_KEY, shareLiveLink, useMyLiveLinks, type LiveLinkInfo } from './api';

/** What the sheet says about who can see a live link and for how long. */
export function liveLinkExplainer(graceMinutes: number, maxHours: number): string {
  const after = graceMinutes > 0 ? `${graceMinutes} minutes after your run ends` : 'when your run ends';
  return `Anyone with this link can see where you are until it ends: ${after}, when you stop sharing, or after ${maxHours} hours at most.`;
}

/**
 * Sharing a live link, before GO or during a run: this run only, or the standing link that stays the same
 * for every run. With a run in progress the link starts at once; before GO it waits for the run to start.
 */
export function LiveShareSheet({ visible, onClose, sessionId, onShared }: {
  visible: boolean;
  onClose: () => void;
  /** The run in progress, or null before GO. */
  sessionId: string | null;
  onShared?: (link: { token: string; kind: LiveKind }) => void;
}) {
  const p = usePalette();
  const qc = useQueryClient();
  const { settings } = useAppConfig();
  const on = settings.enabled.live_links_enabled;
  const links = useMyLiveLinks(visible && on);
  const standing = (links.data ?? []).find((l) => l.kind === 'standing') ?? null;
  const [kind, setKind] = useState<LiveKind>('run');
  const [everywhere, setEverywhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const link = await createLiveLink(kind, kind === 'standing' && standing ? standing.show_everywhere : everywhere);
      await shareLiveLink(link.token, link.kind);
      if (sessionId) {
        attachLiveShare(sessionId, link.token, link.kind, settings.liveLinkPushSeconds);
        void pushLive(sessionId, { force: true });
      } else setPendingLiveShare({ token: link.token, kind: link.kind });
      void qc.invalidateQueries({ queryKey: MY_LIVE_LINKS_KEY });
      onShared?.({ token: link.token, kind: link.kind });
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Share live location">
      <View style={{ gap: spacing.md }}>
        {!on ? <Banner tone="info" text={PAUSED_TEXT.live_links_enabled} /> : (
          <>
            <Txt>{liveLinkExplainer(settings.liveLinkGraceMinutes, settings.liveLinkMaxHours)}</Txt>
            <Segmented label="Which link" value={kind} onChange={setKind}
              options={[{ value: 'run', label: 'This run only' }, { value: 'standing', label: standing ? 'My standing link' : 'A standing link' }]} />
            <Txt variant="caption">{kind === 'run'
              ? 'A new link for this run. It stops working after the run.'
              : standing
                ? 'The same link you already sent. It shows each of your runs, and "Not running right now" in between.'
                : 'The same link for every run, so family can keep it. You can change or turn it off in Privacy settings.'}</Txt>
            {kind === 'run' || !standing ? (
              <Toggle label="Show my position everywhere" value={everywhere} onChange={setEverywhere}
                description={everywhere ? 'Your position shows inside your protected areas too.' : 'Inside your protected areas, such as home, your position is hidden.'} />
            ) : null}
            {error ? <Banner tone="danger" text={error} /> : null}
            <Button label="Share link" icon="share" onPress={() => void share()} loading={busy} disabled={busy} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <Icon name="lock" color={p.textMuted} size={16} />
              <Txt variant="caption" style={{ flex: 1 }}>Your position is never used for land or rankings, and is deleted within a day after sharing ends.</Txt>
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

/** During the run: who can see it, how often the link was opened, and Stop sharing. */
export function LiveShareStatus({ sessionId, onShare }: { sessionId: string; onShare: () => void }) {
  const p = usePalette();
  const qc = useQueryClient();
  const { settings } = useAppConfig();
  const [, setTick] = useState(0);
  let share = null as ReturnType<typeof liveShareFor>;
  try {
    share = liveShareFor(sessionId);
  } catch {
    share = null;
  }
  const links = useMyLiveLinks(Boolean(share) && !share?.ended);
  if (!settings.enabled.live_links_enabled) return null;
  if (!share || share.ended) {
    return <Button variant="ghost" size="sm" icon="share" label="Share live location" onPress={onShare} />;
  }
  const info: LiveLinkInfo | undefined = (links.data ?? []).find((l) => l.token === share!.token);
  const views = info?.views ?? 0;
  const stop = async () => {
    await stopLiveShare(sessionId);
    setTick((n) => n + 1);
    void qc.invalidateQueries({ queryKey: MY_LIVE_LINKS_KEY });
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessibilityLiveRegion="polite">
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.danger }} />
      <Txt variant="label" style={{ flex: 1 }}>{views ? `Live · opened ${views} ${views === 1 ? 'time' : 'times'}` : 'Live · link sent'}</Txt>
      <Button variant="ghost" size="sm" icon="stop" label="Stop sharing" onPress={() => void stop()} />
    </View>
  );
}
