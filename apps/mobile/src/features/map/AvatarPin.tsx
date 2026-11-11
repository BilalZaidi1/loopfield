import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { fonts, useTheme } from '@/theme/tokens';

/** Below this zoom the map shows land only: pictures would cover the cells they stand for. */
export const MIN_AVATAR_ZOOM = 13;

export interface AvatarPinData {
  id: string;
  coord: [number, number];
  /** Signed picture URL, or null for initials on the runner's map colour. */
  uri: string | null;
  name: string;
  color: string;
  mine: boolean;
  /** Runners sharing this pin (1 = just this runner). */
  count: number;
  /** Higher wins when pins collide on screen. */
  weight: number;
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';

/**
 * A runner's picture standing on their land: a circle with a light rim (your own in your colour) and,
 * when several runners share the spot, a small count. Tapping it opens their card (or zooms in).
 */
export function AvatarPin({ pin, onPress }: { pin: AvatarPinData; onPress: () => void }) {
  const t = useTheme();
  const size = pin.count > 1 ? 44 : 40;
  const rim = pin.mine ? t.palette.primary : t.scheme === 'dark' ? '#2A2C33' : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={pin.count > 1 ? `${pin.mine ? 'You' : pin.name} and ${pin.count - 1} more ${pin.count === 2 ? 'runner' : 'runners'} hold land here. Zoom in` : pin.mine ? 'Your land. Open your card' : `${pin.name}'s land. Open their card`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <View style={{ width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, backgroundColor: rim, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
        {pin.uri ? (
          <Image source={{ uri: pin.uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: pin.color }} contentFit="cover" />
        ) : (
          <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: pin.color, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: size * 0.36 }}>{initials(pin.name)}</Text>
          </View>
        )}
      </View>
      {pin.count > 1 ? (
        <View style={{ position: 'absolute', right: -6, bottom: -4, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, backgroundColor: t.palette.orange, borderWidth: 2, borderColor: rim, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#121318', fontFamily: fonts.bold, fontSize: 11 }}>{`+${pin.count - 1}`}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
