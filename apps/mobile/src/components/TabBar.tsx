import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/state/session';
import { useSignedUrl } from '@/features/social/media';
import { radius, spacing, TOUCH, useTheme } from '@/theme/tokens';
import { useLayout } from '@/theme/layout';
import { springs, tick, useReducedMotion } from '@/theme/motion';
import { LoopMark, Wordmark } from './Brand';
import { Icon, type IconName } from './icons';
import { useBadgeCounts } from './TopBar';
import { Avatar, Button, PressableScale, Txt } from './ui';

export const TAB_ICONS: Record<string, IconName> = { home: 'home', map: 'map', record: 'record', progress: 'progress', clubs: 'clubs' };

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const a = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return open;
}

/** Bottom tab bar on phones and tablets, a sidebar on wide screens. Record is the raised centre action. */
export function AppTabBar(props: BottomTabBarProps) {
  const { isWide } = useLayout();
  return isWide ? <Sidebar {...props} /> : <BottomBar {...props} />;
}

function useTabPress({ state, emitter, navigateToTab }: BottomTabBarProps) {
  return (index: number) => {
    const route = state.routes[index]!;
    const focused = state.index === index;
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) {
      if (route.name === 'record') tick('light');
      navigateToTab(route.key);
    }
  };
}

function BottomBar(props: BottomTabBarProps) {
  const { state, descriptors } = props;
  const t = useTheme();
  const p = t.palette;
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOpen();
  const reduce = useReducedMotion();
  const badges = useBadgeCounts();
  const press = useTabPress(props);
  const [w, setW] = useState(0);
  const slot = w / Math.max(1, state.routes.length);
  const x = useSharedValue(0);
  useEffect(() => {
    const target = state.index * slot + slot / 2 - 12;
    x.value = reduce ? target : withSpring(target, springs.press);
  }, [state.index, slot, reduce, x]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  if (keyboard) return null;
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[styles.bar, { backgroundColor: p.tabBar, borderTopColor: p.border, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {w > 0 && state.routes[state.index]?.name !== 'record' ? <Animated.View style={[styles.indicator, { backgroundColor: p.primaryFill }, indicator]} /> : null}
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]!;
        const label = typeof options.title === 'string' ? options.title : route.name;
        const focused = state.index === index;
        const icon = TAB_ICONS[route.name] ?? 'home';
        const count = route.name === 'clubs' ? badges.data?.club_invites ?? 0 : 0;
        if (route.name === 'record') {
          return (
            <View key={route.key} style={styles.item}>
              <PressableScale
                onPress={() => press(index)}
                scaleTo={0.92}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={`${label}, start or resume a run`}
                style={[styles.record, { backgroundColor: p.primaryFill, borderColor: p.tabBar }, t.elevation.raised]}>
                <Icon name="record" color="#FFFFFF" size={28} strokeWidth={2.4} />
              </PressableScale>
              <Txt variant="micro" style={{ color: focused ? p.text : p.textMuted, marginTop: 2 }}>{label}</Txt>
            </View>
          );
        }
        return (
          <Pressable
            key={route.key}
            onPress={() => press(index)}
            onLongPress={() => props.emitter.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={count ? `${label}, ${count} new` : label}
            style={styles.item}>
            <View>
              <Icon name={icon} color={focused ? p.text : p.textSubtle} size={25} strokeWidth={focused ? 2.3 : 2} />
              {count ? <View style={[styles.dot, { backgroundColor: p.orange, borderColor: p.tabBar }]} /> : null}
            </View>
            <Txt variant="micro" style={{ color: focused ? p.text : p.textMuted }}>{label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

function Sidebar(props: BottomTabBarProps) {
  const { state, descriptors } = props;
  const t = useTheme();
  const p = t.palette;
  const insets = useSafeAreaInsets();
  const press = useTabPress(props);
  const badges = useBadgeCounts();
  const { profile } = useSession();
  const avatar = useSignedUrl('avatars', profile?.avatar_path);
  const unread = (badges.data?.notifications ?? 0) + (badges.data?.follow_requests ?? 0);
  const recordIndex = state.routes.findIndex((r) => r.name === 'record');
  return (
    <View style={[styles.sidebar, { backgroundColor: p.surface, borderRightColor: p.border, paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm }}>
        <LoopMark size={34} ring={p.primaryFill} dot={p.orange} />
        <Wordmark size={24} />
      </View>
      {recordIndex >= 0 ? <Button label="Start a run" size="lg" arrow onPress={() => press(recordIndex)} style={{ marginVertical: spacing.lg }} /> : null}
      <View style={{ gap: spacing.xs }} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key]!;
          const label = typeof options.title === 'string' ? options.title : route.name;
          const focused = state.index === index;
          const count = route.name === 'clubs' ? badges.data?.club_invites ?? 0 : 0;
          return (
            <SideItem key={route.key} icon={TAB_ICONS[route.name] ?? 'home'} label={label} focused={focused} count={count} role="tab" onPress={() => press(index)} />
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ gap: spacing.xs }}>
        <SideItem icon="chat" label="Messages" onPress={() => router.push('/inbox')} />
        <SideItem icon="bell" label="Notifications" count={unread} onPress={() => router.push('/notifications')} />
        <Pressable onPress={() => router.push('/me')} accessibilityRole="button" accessibilityLabel="Your profile and settings" style={({ pressed }) => [styles.sideItem, { opacity: pressed ? 0.7 : 1 }]}>
          <Avatar name={profile?.display_name ?? 'You'} uri={avatar.data} size={30} />
          <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{profile?.display_name ?? 'Profile'}</Txt>
        </Pressable>
      </View>
    </View>
  );
}

function SideItem({ icon, label, focused, count, onPress, role = 'button' }: { icon: IconName; label: string; focused?: boolean; count?: number; onPress: () => void; role?: 'tab' | 'button' }) {
  const { palette: p } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={role === 'tab' ? { selected: Boolean(focused) } : undefined}
      accessibilityLabel={count ? `${label}, ${count} new` : label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.sideItem, { backgroundColor: focused ? p.primarySoft : hovered ? p.surfaceAlt : 'transparent', opacity: pressed ? 0.75 : 1 }]}>
      <Icon name={icon} color={focused ? p.primary : p.textMuted} size={22} />
      <Txt variant="bodyStrong" style={{ flex: 1, color: focused ? p.onPrimarySoft : p.text }}>{label}</Txt>
      {count ? (
        <View style={[styles.sideCount, { backgroundColor: p.orange }]}>
          <Txt variant="micro" style={{ color: '#121318' }}>{count > 99 ? '99+' : String(count)}</Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  indicator: { position: 'absolute', top: 0, left: 0, width: 24, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  item: { flex: 1, minHeight: TOUCH + 4, alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  record: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginTop: -26, borderWidth: 4 },
  dot: { position: 'absolute', top: -1, right: -3, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  sidebar: { width: 260, borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg },
  sideItem: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  sideCount: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }
});
