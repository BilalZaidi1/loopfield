import { View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Card, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { spacing, useTheme, type BlockTone } from '@/theme/tokens';
import type { MyClub } from './api';

const TONES: BlockTone[] = ['violet', 'blue', 'green', 'orange'];

/** Stable colour for a group, so its card looks the same everywhere. */
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

/** Colour-block card for one of your groups. */
export function ClubCard({ club, width }: { club: MyClub; width?: number }) {
  const tone = clubTone(club.id);
  return (
    <Card tone={tone} onPress={() => router.push({ pathname: '/club/[id]', params: { id: club.id } })} accessibilityLabel={`${club.name}, ${club.member_count} members`} style={{ width, minHeight: 168, justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <ClubMonogram name={club.name} tone={tone} size={44} inverted />
        {club.role !== 'member' ? <Badge label={club.role === 'owner' ? 'Owner' : 'Organizer'} /> : null}
      </View>
      <View style={{ gap: spacing.xs }}>
        <Txt variant="headline" numberOfLines={2}>{club.name}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Icon name="clubs" color={tone === 'orange' || tone === 'green' ? '#121318' : '#FFFFFF'} size={16} />
          <Txt variant="label" color="textMuted">{`${club.member_count} members · ${club.kind === 'club' ? 'Club' : 'Community'}`}</Txt>
        </View>
      </View>
    </Card>
  );
}

