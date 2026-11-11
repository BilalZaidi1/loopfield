import { describe, expect, it } from 'vitest';
import { DEFAULT_EMAIL_PREFS, DEFAULT_PREFS, emailAllowed, EMAIL_CATEGORY, pushAllowed, safePushPreview } from '../src/notifications/policy.ts';

describe('which notifications are pushed', () => {
  it('never pushes land taken by other runners one by one (the daily digest is the push)', () => {
    expect(pushAllowed(DEFAULT_PREFS, 'competitive', 'territory_lost')).toBe(false);
    expect(pushAllowed(DEFAULT_PREFS, 'competitive', 'territory_contested')).toBe(false);
    expect(pushAllowed(DEFAULT_PREFS, 'competitive', 'territory_digest')).toBe(true);
    expect(pushAllowed({ ...DEFAULT_PREFS, competitiveDigest: false }, 'competitive', 'territory_digest')).toBe(false);
  });

  it('pushes your own results unless you turn them off', () => {
    expect(pushAllowed(DEFAULT_PREFS, 'competitive', 'territory_captured')).toBe(true);
    expect(pushAllowed(DEFAULT_PREFS, 'competitive', 'badge_earned')).toBe(true);
    expect(pushAllowed({ ...DEFAULT_PREFS, runResults: false }, 'competitive', 'territory_captured')).toBe(false);
    // The digest switch no longer silences your own results or events.
    expect(pushAllowed({ ...DEFAULT_PREFS, competitiveDigest: false }, 'competitive', 'badge_earned')).toBe(true);
  });

  it("keeps friends' runs in the app unless pushes for them are turned on", () => {
    expect(pushAllowed(DEFAULT_PREFS, 'social', 'friend_run')).toBe(false);
    expect(pushAllowed({ ...DEFAULT_PREFS, friendRuns: true }, 'social', 'friend_run')).toBe(true);
    expect(pushAllowed({ ...DEFAULT_PREFS, friendRuns: true, social: false }, 'social', 'friend_run')).toBe(false);
  });

  it('gives events and challenges their own switch', () => {
    for (const kind of ['event_starting', 'event_finished', 'event_cancelled', 'club_challenge', 'season_finished']) {
      expect(pushAllowed(DEFAULT_PREFS, 'competitive', kind)).toBe(true);
      expect(pushAllowed({ ...DEFAULT_PREFS, events: false }, 'competitive', kind)).toBe(false);
    }
  });

  it('follows the category switches for everything else', () => {
    expect(pushAllowed({ ...DEFAULT_PREFS, clubs: false }, 'club', 'club_member_joined')).toBe(false);
    expect(pushAllowed({ ...DEFAULT_PREFS, social: false }, 'social', 'comment')).toBe(false);
    expect(pushAllowed({ ...DEFAULT_PREFS, social: false, messages: false, clubs: false }, 'system', 'appeal_decided')).toBe(true);
  });
});

describe('push previews', () => {
  it('describes every new kind without names of places, clubs, health readings or message text', () => {
    const kinds = ['territory_captured', 'territory_lost', 'territory_contested', 'friend_run', 'club_member_joined', 'club_announcement',
      'club_ownership_offer', 'club_ownership_received', 'club_deleted', 'season_finished', 'new_follower'];
    for (const kind of kinds) {
      const p = safePushPreview(kind, 'Sara');
      expect(p.body).not.toBe('You have a new update');
      expect(`${p.title} ${p.body}`).not.toMatch(/bpm|heart|km|street|road|\d{2}:\d{2}/i);
    }
    expect(safePushPreview('territory_lost', 'Sara').body).not.toContain('Sara'); // rivals are never named in pushes
  });
});

describe('email preferences', () => {
  it('always sends account email and follows the runner for the rest', () => {
    expect(emailAllowed({ runs: false, territory: false, clubs: false, events: false }, 'welcome')).toBe(true);
    expect(emailAllowed(DEFAULT_EMAIL_PREFS, 'run_summary')).toBe(false);
    expect(emailAllowed(DEFAULT_EMAIL_PREFS, 'territory_daily')).toBe(false);
    expect(emailAllowed(DEFAULT_EMAIL_PREFS, 'club_invite')).toBe(true);
    expect(emailAllowed({ ...DEFAULT_EMAIL_PREFS, events: false }, 'event_reminder')).toBe(false);
  });

  it('files every template under a category', () => {
    for (const category of Object.values(EMAIL_CATEGORY)) expect(['account', 'runs', 'territory', 'clubs', 'events']).toContain(category);
  });
});
