import { render, screen } from '@testing-library/react-native';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { destination } from '@loopfield/core';
import { AVATAR_OPTIONS, avatarShapes, avatarSvg, DEFAULT_AVATAR, parseAvatar, shuffleAvatar } from '@/features/avatar/spec';
import { CartoonAvatar } from '@/features/avatar/CartoonAvatar';
import { clusterPins, ownerAnchors } from '@/features/map/owners';
import type { ViewportCell } from '@/territory/h3';

jest.mock('@/lib/supabase', () => ({ supabase: jest.fn() }));
jest.mock('@/state/session', () => ({ useSession: () => ({ userId: null }), useUnits: () => 'metric' }));

describe('cartoon avatars', () => {
  it('falls back part by part, so old or edited data never breaks the picture', () => {
    expect(parseAvatar(null)).toEqual(DEFAULT_AVATAR);
    expect(parseAvatar({ hair: 'afro', face: 'laser-eyes', bg: '#123456' })).toEqual({ ...DEFAULT_AVATAR, hair: 'afro' });
  });

  it('shuffles the same way for the same seed and only picks real options', () => {
    expect(shuffleAvatar(42)).toEqual(shuffleAvatar(42));
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => shuffleAvatar(i + 1).hair));
    expect(kinds.size).toBeGreaterThan(4);
    for (let i = 1; i < 30; i++) {
      const s = shuffleAvatar(i);
      expect(AVATAR_OPTIONS.extra).toContain(s.extra);
      expect(s.outfitColor).not.toBe(s.bg);
    }
  });

  it('covers the hair under a headscarf and the eyes under sunglasses', () => {
    const scarf = avatarShapes({ ...DEFAULT_AVATAR, hair: 'curly', extra: 'headscarf' });
    expect(scarf.filter((sh) => sh.tag === 'circle' && sh.fill === DEFAULT_AVATAR.hairColor)).toHaveLength(0);
    const shades = avatarShapes({ ...DEFAULT_AVATAR, extra: 'sunglasses' });
    expect(shades.some((sh) => sh.tag === 'circle' && sh.r === 2.7)).toBe(false);
  });

  it('draws as SVG with only safe attributes', () => {
    const svg = avatarSvg(shuffleAvatar(7));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/script|href|url\(/i);
  });

  it('renders in the app with a label for screen readers', async () => {
    await render(<CartoonAvatar spec={DEFAULT_AVATAR} size={64} label="Your avatar" />);
    expect(screen.getByLabelText('Your avatar')).toBeTruthy();
  });
});

describe('runners on the map', () => {
  const origin = { lat: 24.9, lng: 67.05 };
  const cellAt = (m: number, bearing = 90) => {
    const p = destination(origin, m, bearing);
    return BigInt(`0x${latLngToCell(p.lat, p.lng, 11)}`).toString();
  };
  const held = (key: string, cell: string): ViewportCell => ({ cell, status: 'controlled', controller_key: key, controller_handle: key, controller_name: key, is_me: false });

  it('stands each picture on its own land, even when the land is L-shaped', () => {
    const l = [...new Set([0, 30, 60, 90, 120].map((m) => cellAt(m, 90)).concat([30, 60, 90, 120].map((m) => cellAt(m, 0))))];
    const anchors = ownerAnchors([...l.map((c) => held('a', c)), held('b', cellAt(600)), { cell: cellAt(900), status: 'excluded', controller_key: null, controller_handle: null, controller_name: null, is_me: false }]);
    expect(anchors.get('a')!.cells).toBe(l.length);
    // The anchor is the centre of one of the runner's own cells.
    const centres = l.map((c) => { const [lat, lng] = cellToLatLng(BigInt(c).toString(16)); return `${lng.toFixed(6)},${lat.toFixed(6)}`; });
    expect(centres).toContain(anchors.get('a')!.anchor.map((x) => x.toFixed(6)).join(','));
    expect(anchors.has('b')).toBe(true);
    expect(anchors.size).toBe(2); // unavailable cells have no owner
  });

  it('groups pictures that would overlap, and separates them when zoomed in', () => {
    const near = (key: string, m: number, weight: number) => {
      const p = destination(origin, m, 90);
      return { key, anchor: [p.lng, p.lat] as [number, number], weight };
    };
    const pins = [near('a', 0, 5), near('b', 150, 9), near('c', 2000, 3)];
    const far = clusterPins(pins, 13);
    expect(far).toHaveLength(2);
    expect(far[0]!.members.map((m) => m.key)).toEqual(['b', 'a']); // the runner with most land leads
    expect(clusterPins(pins, 17)).toHaveLength(3);
  });
});
