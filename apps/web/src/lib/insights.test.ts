import { describe, expect, it } from 'vitest';
import { keepCampaignParams } from './insights';

describe('page addresses sent to Vercel', () => {
  it('drops the waitlist token', () => {
    expect(keepCampaignParams('https://example.com/waitlist/confirm?token=eyJlbWFpbCI6InJ1bm5lckBleGFtcGxlLmNvbSJ9.c2ln')).toBe(
      'https://example.com/waitlist/confirm'
    );
  });

  it('keeps utm_ tags and drops everything else, fragment included', () => {
    expect(keepCampaignParams('https://example.com/?waitlist=confirmed&utm_source=instagram&tier=low&utm_campaign=launch#download')).toBe(
      'https://example.com/?utm_source=instagram&utm_campaign=launch'
    );
  });

  it('leaves a plain address alone', () => {
    expect(keepCampaignParams('https://example.com/privacy')).toBe('https://example.com/privacy');
  });
});
