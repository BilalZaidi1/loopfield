import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { fonts, useTheme } from '@/theme/tokens';

/**
 * A friend running now (R2): their picture in a round marker with a light rim, a small arrow showing which
 * way they are heading, and their name underneath. Tapping opens their card.
 */
export interface FriendMarkerData {
  id: string;
  coord: [number, number];
  name: string;
  /** Signed picture URL, or null for their initials. */
  uri: string | null;
  /** Degrees from north, or null when not known. */
  bearing: number | null;
  paused: boolean;
}

const SIZE = 38;
const initials = (name: string) => name.replace(/^@/, '').split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';

export function FriendMarker({ friend, onPress }: { friend: FriendMarkerData; onPress: () => void }) {
  const t = useTheme();
  const p = t.palette;
  const rim = t.scheme === 'dark' ? '#2A2C33' : '#FFFFFF';
  const ring = SIZE + 6;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button"
      accessibilityLabel={`${friend.name}, a friend ${friend.paused ? 'who has paused' : 'running now'}. Open their card`}
      style={({ pressed }) => ({ alignItems: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <View style={{ width: ring + 14, height: ring + 14, alignItems: 'center', justifyContent: 'center' }}>
        {friend.bearing != null && !friend.paused ? (
          <Svg width={ring + 14} height={ring + 14} style={{ position: 'absolute', transform: [{ rotate: `${friend.bearing}deg` }] }} accessibilityElementsHidden>
            <Path d={`M ${(ring + 14) / 2 - 6} 8 L ${(ring + 14) / 2} 0 L ${(ring + 14) / 2 + 6} 8 Z`} fill={p.primary} stroke={rim} strokeWidth={1.5} />
          </Svg>
        ) : null}
        <View style={{ width: ring, height: ring, borderRadius: ring / 2, backgroundColor: rim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: p.primary, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4, opacity: friend.paused ? 0.75 : 1 }}>
          {friend.uri ? (
            <Image source={{ uri: friend.uri }} style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2 }} contentFit="cover" />
          ) : (
            <View style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: SIZE * 0.36 }}>{initials(friend.name)}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ marginTop: -4, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: rim }}>
        <Text style={{ color: p.text, fontFamily: fonts.bold, fontSize: 11 }} numberOfLines={1}>{friend.name}</Text>
      </View>
    </Pressable>
  );
}
