import { View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { Badge, Card, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useSignedUrl } from '@/features/social/media';
import { radius, spacing, useTheme, type BlockTone } from '@/theme/tokens';
import { kindLabel, roleLabel, type ClubArtwork, type MyClub } from './api';

const TONES: BlockTone[] = ['violet', 'blue', 'green', 'orange'];

/** Stable colour for a community or group, so its card looks the same everywhere. */
export function clubTone(id: string): BlockTone {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length]!;
}

export function ClubMonogram({ name, tone, size = 48, inverted }: { name: string; tone: BlockTone; size?: number; inverted?: boolean }) {
  const t = useTheme();
  const b = t.blocks[tone];
  const letters = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: inverted ? b.fg : b.bg, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Txt variant="metric" style={{ color: inverted ? b.bg : b.fg, fontSize: size * 0.4, lineHeight: size * 0.48 }}>{letters || '?'}</Txt>
    </View>
  );
}

/** The logo when there is one (a private image, shown through a short-lived link), the monogram otherwise. */
export function ClubLogo({ club, size = 48, inverted }: { club: { id: string; name: string; avatar_path?: string | null }; size?: number; inverted?: boolean }) {
  const t = useTheme();
  const url = useSignedUrl('club-media', club.avatar_path ?? null);
  if (club.avatar_path && url.data) {
    return (
      <Image source={{ uri: url.data }} style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: t.palette.surfaceAlt }}
        contentFit="cover" accessibilityLabel={`${club.name} logo`} accessible />
    );
  }
  return <ClubMonogram name={club.name} tone={clubTone(club.id)} size={size} inverted={inverted} />;
}

export const ARTWORKS: { id: ClubArtwork; label: string }[] = [
  { id: 'trail', label: 'Trail' },
  { id: 'tide', label: 'Tide' },
  { id: 'grid', label: 'Grid' },
  { id: 'peaks', label: 'Peaks' },
  { id: 'dunes', label: 'Dunes' },
  { id: 'city', label: 'City' }
];

/** Predefined cover artwork: simple running-ground motifs drawn in the club's colour (no image needed). */
export function Artwork({ kind, tone, width, height }: { kind: ClubArtwork; tone: BlockTone; width: number; height: number }) {
  const t = useTheme();
  const b = t.blocks[tone];
  const ink = b.fg;
  const w = width;
  const h = height;
  const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => <Path key={i} d={f(i)} stroke={ink} strokeOpacity={0.28} strokeWidth={2} fill="none" />);
  return (
    <Svg width={w} height={h} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={0} y={0} width={w} height={h} fill={b.bg} />
      {kind === 'trail' ? (
        <G>
          {lines(5, (i) => `M -10 ${h * 0.25 + i * 14} C ${w * 0.3} ${h * 0.05 + i * 14}, ${w * 0.6} ${h * 0.75 + i * 10}, ${w + 10} ${h * 0.35 + i * 12}`)}
          <Circle cx={w * 0.72} cy={h * 0.52} r={6} fill={ink} fillOpacity={0.6} />
        </G>
      ) : kind === 'tide' ? (
        <G>{lines(7, (i) => `M -10 ${h * 0.2 + i * 16} Q ${w * 0.25} ${h * 0.1 + i * 16}, ${w * 0.5} ${h * 0.2 + i * 16} T ${w + 10} ${h * 0.2 + i * 16}`)}</G>
      ) : kind === 'grid' ? (
        <G>
          {Array.from({ length: Math.ceil(w / 28) * Math.ceil(h / 24) }, (_, i) => {
            const cols = Math.ceil(w / 28);
            const x = (i % cols) * 28 + (Math.floor(i / cols) % 2 ? 14 : 0);
            const y = Math.floor(i / cols) * 24;
            return <Path key={i} d={`M ${x} ${y + 6} l 8 -5 l 8 5 l 0 10 l -8 5 l -8 -5 z`} stroke={ink} strokeOpacity={0.22} strokeWidth={1.5} fill="none" />;
          })}
        </G>
      ) : kind === 'peaks' ? (
        <G>
          <Path d={`M 0 ${h} L ${w * 0.22} ${h * 0.35} L ${w * 0.4} ${h * 0.7} L ${w * 0.62} ${h * 0.2} L ${w * 0.85} ${h * 0.65} L ${w} ${h * 0.45} L ${w} ${h} Z`} fill={ink} fillOpacity={0.18} />
          <Path d={`M 0 ${h} L ${w * 0.3} ${h * 0.6} L ${w * 0.55} ${h * 0.85} L ${w * 0.78} ${h * 0.5} L ${w} ${h * 0.8} L ${w} ${h} Z`} fill={ink} fillOpacity={0.22} />
        </G>
      ) : kind === 'dunes' ? (
        <G>{lines(4, (i) => `M -10 ${h * 0.45 + i * 18} C ${w * 0.25} ${h * 0.25 + i * 18}, ${w * 0.45} ${h * 0.25 + i * 18}, ${w * 0.6} ${h * 0.45 + i * 18} S ${w * 0.9} ${h * 0.6 + i * 18}, ${w + 10} ${h * 0.4 + i * 18}`)}</G>
      ) : (
        <G>
          {Array.from({ length: 9 }, (_, i) => {
            const bw = w / 9;
            const bh = h * (0.3 + ((i * 37) % 50) / 100);
            return <Rect key={i} x={i * bw + 3} y={h - bh} width={bw - 6} height={bh} fill={ink} fillOpacity={0.16 + (i % 3) * 0.04} rx={3} />;
          })}
        </G>
      )}
    </Svg>
  );
}

/** Cover: the uploaded photo, otherwise the chosen artwork, otherwise the plain colour block. */
export function ClubCover({ club, height = 132, width, override }: {
  club: { id: string; cover_path?: string | null; artwork?: ClubArtwork | null };
  height?: number;
  width: number;
  /** Preview before saving: a local photo or an artwork choice. */
  override?: { uri?: string | null; artwork?: ClubArtwork | null } | null;
}) {
  const t = useTheme();
  const tone = clubTone(club.id);
  const url = useSignedUrl('club-media', override ? null : club.cover_path ?? null);
  const photo = override?.uri ?? url.data ?? null;
  const art = override?.artwork ?? (override?.uri ? null : club.artwork) ?? null;
  return (
    <View style={{ width, height, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: t.blocks[tone].bg }}>
      {photo ? <Image source={{ uri: photo }} style={{ width, height }} contentFit="cover" accessibilityLabel="Cover photo" accessible /> : art ? <Artwork kind={art} tone={tone} width={width} height={height} /> : null}
    </View>
  );
}

/** Colour-block card for one of your communities or groups. */
export function ClubCard({ club, width }: { club: MyClub; width?: number }) {
  const tone = clubTone(club.id);
  return (
    <Card tone={tone} onPress={() => router.push({ pathname: '/club/[id]', params: { id: club.id } })} accessibilityLabel={`${club.name}, ${kindLabel(club.kind)}, ${club.member_count} members`} style={{ width, minHeight: 168, justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <ClubLogo club={club} size={44} inverted />
        {club.role !== 'member' ? <Badge label={roleLabel(club.role)} /> : null}
      </View>
      <View style={{ gap: spacing.xs }}>
        <Txt variant="headline" numberOfLines={2}>{club.name}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Icon name={club.kind === 'group' ? 'chat' : 'clubs'} color={tone === 'orange' || tone === 'green' ? '#121318' : '#FFFFFF'} size={16} />
          <Txt variant="label" color="textMuted">{`${club.member_count} members · ${kindLabel(club.kind)}`}</Txt>
        </View>
      </View>
    </Card>
  );
}
