import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import type { NativeStackHeaderProps } from 'expo-router/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, useTheme } from '@/theme/tokens';
import { useLayout } from '@/theme/layout';
import { IconButton, Txt } from './ui';

/**
 * Header for every pushed screen: a back arrow (announced as "Back"), the screen title and the screen's
 * own actions. It sits on the page colour with no bar or shadow, so the content below reads as one page.
 */
export function StackHeader({ options, back, navigation }: NativeStackHeaderProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const modal = options.presentation === 'modal' || options.presentation === 'formSheet';
  const title = typeof options.headerTitle === 'string' ? options.headerTitle : options.title ?? '';
  const right = typeof options.headerRight === 'function' ? options.headerRight({ tintColor: t.palette.text, canGoBack: Boolean(back) }) : null;
  const top = modal && Platform.OS === 'ios' ? spacing.sm : insets.top;
  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : router.replace('/home'));
  return (
    <View style={{ paddingTop: top, backgroundColor: t.palette.bg }}>
      <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: gutter - 10, paddingRight: gutter - 6 }}>
        {back || modal ? (
          <IconButton icon={modal && !back ? 'close' : 'arrow-left'} label={modal && !back ? 'Close' : 'Back'} onPress={goBack} />
        ) : (
          <View style={{ width: 10 }} />
        )}
        <Txt variant="headline" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </Txt>
        {right ? <View style={{ flexDirection: 'row', alignItems: 'center' }}>{right}</View> : null}
      </View>
    </View>
  );
}
