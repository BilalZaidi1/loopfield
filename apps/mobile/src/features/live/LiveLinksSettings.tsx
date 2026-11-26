import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '@/lib/api';
import { PAUSED_TEXT, useAppConfig } from '@/lib/appConfig';
import { Banner, Button, confirm, ErrorState, ListGroup, LoadingState, Row, Section, Toggle, Txt } from '@/components/ui';
import {
  createLiveLink, endLiveLink, MY_LIVE_LINKS_KEY, revokeLiveLink, rotateStandingLink, setShowEverywhere, shareLiveLink, useMyLiveLinks, type LiveLinkInfo
} from './api';

const opened = (views: number) => (views ? `Opened ${views} ${views === 1 ? 'time' : 'times'}` : 'Not opened yet');

function runLinkState(l: LiveLinkInfo): string {
  if (!l.run) return 'Waiting for the run to start';
  return l.run.ended_at ? 'Run finished' : 'Run in progress';
}

/**
 * Privacy settings (R1): the standing live link (send it again, show everywhere, change it, turn it off) and any
 * one-run links still open, each of which can be ended here.
 */
export function LiveLinksSettings() {
  const qc = useQueryClient();
  const { settings } = useAppConfig();
  const on = settings.enabled.live_links_enabled;
  const links = useMyLiveLinks(on);
  const standing = (links.data ?? []).find((l) => l.kind === 'standing') ?? null;
  const runLinks = (links.data ?? []).filter((l) => l.kind === 'run');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: MY_LIVE_LINKS_KEY });
    }
  };

  return (
    <Section title="Live location" icon="share">
      <Txt variant="caption">Send family or friends a link that shows where you are while you run. It is outside the game: never used for land or rankings, and positions are deleted within a day after sharing ends.</Txt>
      {!on ? <Banner tone="info" text={PAUSED_TEXT.live_links_enabled} /> : links.isLoading ? <LoadingState variant="rows" rows={1} /> : links.error ? (
        <ErrorState error={links.error} onRetry={() => void links.refetch()} />
      ) : standing ? (
        <>
          <ListGroup>
            <Row icon="share" title="Standing live link" subtitle={`${opened(standing.views)}. It shows each of your runs, and "Not running right now" in between.`} />
            <Toggle label="Show my position everywhere" value={standing.show_everywhere} disabled={busy !== null}
              description={standing.show_everywhere ? 'Your position shows inside your protected areas too.' : 'Inside your protected areas, such as home, your position is hidden.'}
              onChange={(v) => void act('everywhere', () => setShowEverywhere(standing.token, v))} />
          </ListGroup>
          <Button variant="secondary" icon="share" label="Send the link again" disabled={busy !== null} onPress={() => void shareLiveLink(standing.token, 'standing')} />
          <Button variant="secondary" icon="refresh" label="Change the link" loading={busy === 'rotate'} disabled={busy !== null}
            onPress={() => confirm('Change your standing link?', 'The old link stops working at once. Send the new one to the people who should keep seeing your runs.', 'Change', () => {
              void act('rotate', async () => {
                const r = await rotateStandingLink();
                await shareLiveLink(r.token, 'standing');
              });
            }, false)} />
          <Button variant="ghost" icon="trash" label="Turn off the standing link" loading={busy === 'revoke'} disabled={busy !== null}
            onPress={() => confirm('Turn off your standing link?', 'It stops working at once for everyone you sent it to, and what it showed is deleted.', 'Turn off', () => {
              void act('revoke', () => revokeLiveLink(standing.token, 'standing'));
            })} />
        </>
      ) : (
        <>
          <Txt>A standing link stays the same for every run, so the people you send it to can keep it. You can also share a link for a single run before you start.</Txt>
          <Button variant="secondary" icon="share" label="Create a standing link" loading={busy === 'create'} disabled={busy !== null}
            onPress={() => void act('create', async () => {
              const l = await createLiveLink('standing', false);
              await shareLiveLink(l.token, 'standing');
            })} />
        </>
      )}
      {on && runLinks.length ? (
        <ListGroup>
          {runLinks.map((l) => (
            <Row key={l.token} icon="share" title="Link for one run" subtitle={`${runLinkState(l)} · ${opened(l.views)}`}
              right={<Button variant="ghost" size="sm" label="End" loading={busy === l.token} disabled={busy !== null} onPress={() => void act(l.token, () => endLiveLink(l.token, 'run'))} />} />
          ))}
        </ListGroup>
      ) : null}
      {error ? <Banner tone="danger" text={error} /> : null}
    </Section>
  );
}
