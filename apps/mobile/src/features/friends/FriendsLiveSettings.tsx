import { useState } from 'react';
import { router } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { PAUSED_TEXT, useAppConfig } from '@/lib/appConfig';
import { Banner, ListGroup, Row, Section, Segmented, Toggle, Txt } from '@/components/ui';
import { useSession } from '@/state/session';
import { setFriendsMode, useShareCandidates, type FriendsMode } from './api';

/**
 * Privacy settings (R2): sharing live runs with friends (off by default; friends I choose, or all my friends)
 * and being counted in runners out right now (on by default). Each runner decides only about their own
 * position; seeing friends doesn't require sharing.
 */
export function FriendsLiveSettings({ onCountChange }: { onCountChange: (counted: boolean) => void }) {
  const { settings: cfg } = useAppConfig();
  const { userId, settings, refresh } = useSession();
  const mode: FriendsMode = (settings?.friends_live_mode as FriendsMode | undefined) ?? 'off';
  const counted = settings?.running_now_counted !== false;
  const candidates = useShareCandidates(mode === 'chosen');
  const chosen = (candidates.data ?? []).filter((c) => c.chosen).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: FriendsMode) => {
    if (!userId || next === mode) return;
    setBusy(true);
    setError(null);
    try {
      await setFriendsMode(userId, next, mode);
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title="Live runs with friends" icon="clubs">
        <Txt variant="caption">Friends are people you follow who follow you back. When you share, they see where you are while you run, with your picture and name and the last few minutes of your path. That includes runs that take land: friends see them as they happen, before the delay that applies to everyone else. Inside your protected areas your position is always hidden.</Txt>
        {!cfg.enabled.friends_live_enabled ? <Banner tone="info" text={PAUSED_TEXT.friends_live_enabled} /> : null}
        <ListGroup>
          <Toggle label="Share my live runs with friends" value={mode !== 'off'} disabled={busy}
            description={mode === 'off' ? 'Off. Friends who share with you still appear on your map.' : 'Friends can also see you take land before the 30-minute delay that applies to everyone else.'}
            onChange={(v) => void save(v ? 'chosen' : 'off')} />
          {mode !== 'off' ? (
            <Row icon="clubs" title={mode === 'all' ? 'All my friends' : 'Friends I choose'}
              subtitle={mode === 'all' ? 'Every friend sees your runs live' : candidates.isLoading ? 'Loading…' : chosen ? `${chosen} chosen. Tap to change` : 'Nobody chosen yet: tap to choose'}
              onPress={mode === 'chosen' ? () => router.push('/settings/friends-live') : undefined} />
          ) : null}
        </ListGroup>
        {mode !== 'off' ? (
          <Segmented label="Who sees your live runs" value={mode} onChange={(v) => void save(v)}
            options={[{ value: 'chosen', label: 'Friends I choose' }, { value: 'all', label: 'All my friends' }]} />
        ) : null}
        {mode !== 'off' ? <Txt variant="caption">The Record tab reminds you before each run, with Not this run to skip it once. Sharing ends when the run ends.</Txt> : null}
        {error ? <Banner tone="danger" text={error} /> : null}
      </Section>
      {cfg.enabled.running_now_enabled ? (
        <Section title="Runners out right now" icon="globe">
          <ListGroup>
            <Toggle label="Count me in runners out right now" value={counted}
              description="Counts how many runners are out in your city and country, by the city on your profile. It never sends where you are, and it changes nothing else."
              onChange={onCountChange} />
          </ListGroup>
        </Section>
      ) : null}
    </>
  );
}
