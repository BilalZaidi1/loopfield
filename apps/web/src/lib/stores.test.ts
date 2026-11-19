import { describe, expect, it } from 'vitest';
import { appStoreUrl, campaignToken, detectPlatform, getHref, playStoreUrl } from './stores';

describe('campaign tokens', () => {
  it('keeps Apple-safe characters and caps the length at 30', () => {
    expect(campaignToken('hero')).toBe('hero');
    expect(campaignToken('  final call! <script>  ')).toBe('final call script');
    expect(campaignToken('x'.repeat(40))).toHaveLength(30);
  });
  it('never returns an empty token', () => {
    expect(campaignToken('')).toBe('site');
    expect(campaignToken('***')).toBe('site');
    expect(campaignToken(null)).toBe('site');
  });
});

describe('App Store links', () => {
  it('needs a numeric Apple ID', () => {
    expect(appStoreUrl('')).toBeNull();
    expect(appStoreUrl('dev.loopfield.app')).toBeNull();
    expect(appStoreUrl('6470000001')).toBe('https://apps.apple.com/app/id6470000001');
  });
  it('adds provider and campaign tokens only when a provider token exists', () => {
    const url = new URL(appStoreUrl('6470000001', { providerToken: '123456', name: 'final' })!);
    expect(url.searchParams.get('pt')).toBe('123456');
    expect(url.searchParams.get('ct')).toBe('final');
    expect(url.searchParams.get('mt')).toBe('8');
    expect(appStoreUrl('6470000001', { providerToken: '', name: 'final' })).toBe('https://apps.apple.com/app/id6470000001');
  });
});

describe('Google Play links', () => {
  it('rejects anything that is not a package name', () => {
    expect(playStoreUrl('')).toBeNull();
    expect(playStoreUrl('loopfield')).toBeNull();
    expect(playStoreUrl('dev.loopfield.app')).toBe('https://play.google.com/store/apps/details?id=dev.loopfield.app');
  });
  it('carries UTM values in the install referrer', () => {
    const url = new URL(playStoreUrl('dev.loopfield.app', { name: 'qr', medium: 'print' })!);
    const referrer = new URLSearchParams(url.searchParams.get('referrer')!);
    expect(referrer.get('utm_source')).toBe('site');
    expect(referrer.get('utm_medium')).toBe('print');
    expect(referrer.get('utm_campaign')).toBe('qr');
  });
});

describe('platform detection', () => {
  it('spots iPhone, iPad (desktop mode) and Android', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, 'MacIntel')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, 'MacIntel')).toBe('desktop');
  });
});

describe('/get links', () => {
  it('names the placement and, when given, the store', () => {
    expect(getHref('hero')).toBe('/get?c=hero');
    expect(getHref('final call', 'ios')).toBe('/get?c=final+call&p=ios');
  });
});
