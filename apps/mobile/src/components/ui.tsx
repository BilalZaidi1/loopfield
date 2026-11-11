import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useOnline } from '@/lib/network';
import { friendlyError } from '@/lib/api';
import { avatarTint, familyForWeight, radius, spacing, TOUCH, type, useTheme, type Block, type BlockTone, type Palette, type TypeVariant } from '@/theme/tokens';
import { useLayout } from '@/theme/layout';
import { springs, useReducedMotion } from '@/theme/motion';
import { Icon, type IconName } from './icons';

/* ------------------------------------------------------------------------------------------------
 * Context: colour blocks recolour their contents; nested surfaces step their fills.
 * ---------------------------------------------------------------------------------------------- */

const BlockContext = createContext<Block | null>(null);
/** The colour block the component sits on, if any (text, buttons and badges adapt to it). */
export const useBlock = () => useContext(BlockContext);
const SurfaceContext = createContext(0);

/** Set once at start-up: when the app fonts failed to load, text falls back to system weights. */
let customFontsActive = true;
export function setCustomFontsActive(active: boolean): void {
  customFontsActive = active;
}

const FALLBACK_WEIGHT: Record<TypeVariant, TextStyle['fontWeight']> = {
  hero: '900', display: '900', metric: '900', title: '800', headline: '700', heading: '700',
  body: '500', bodyStrong: '600', label: '600', caption: '500', micro: '600'
};
const ITALIC: Partial<Record<TypeVariant, true>> = { hero: true, display: true, metric: true };

/* ------------------------------------------------------------------------------------------------
 * Text
 * ---------------------------------------------------------------------------------------------- */

export function Txt({ variant = 'body', color, style, children, numberOfLines, accessibilityRole, accessibilityLabel, align, tabular, selectable, adjustsFontSizeToFit, minimumFontScale }: {
  variant?: TypeVariant;
  color?: keyof Palette;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text' | 'alert' | 'summary';
  accessibilityLabel?: string;
  align?: 'left' | 'center' | 'right';
  tabular?: boolean;
  selectable?: boolean;
  /** Shrink slightly instead of truncating when a short label meets a narrow column. */
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}) {
  const { palette: p } = useTheme();
  const block = useBlock();
  const base = type[variant] as TextStyle;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const { fontWeight, fontStyle, ...rest } = flat;
  const italic = fontStyle === 'italic' || (fontStyle === undefined && ITALIC[variant] === true);
  const family = fontWeight || fontStyle ? familyForWeight(fontWeight ?? FALLBACK_WEIGHT[variant], italic) : (base.fontFamily as string);
  const font: TextStyle = customFontsActive ? { fontFamily: family } : { fontFamily: undefined, fontWeight: fontWeight ?? FALLBACK_WEIGHT[variant], fontStyle: italic ? 'italic' : 'normal' };
  const key = color ?? (variant === 'caption' ? 'textMuted' : 'text');
  const tone = block && (key === 'text' || key === 'textMuted' || key === 'textSubtle') ? (key === 'text' ? block.fg : block.fgMuted) : p[key];
  return (
    <Text
      style={[base, { color: tone }, rest, font, align ? { textAlign: align } : null, tabular ? { fontVariant: ['tabular-nums'] } : null]}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
      selectable={selectable}
      accessibilityRole={accessibilityRole ?? (variant === 'title' || variant === 'display' || variant === 'headline' || variant === 'heading' ? 'header' : undefined)}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={variant === 'hero' || variant === 'display' || variant === 'metric' ? 1.3 : 2}>
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Pressables
 * ---------------------------------------------------------------------------------------------- */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable with a small spring squeeze (an opacity dip instead when Reduce Motion is on). */
export function PressableScale({ style, scaleTo = 0.97, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const reduce = useReducedMotion();
  const pressed = useSharedValue(0);
  const anim = useAnimatedStyle(() => (reduce ? { opacity: 1 - pressed.value * 0.18 } : { transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: 90 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withSpring(0, springs.press);
        onPressOut?.(e);
      }}
      style={[style, anim]}
    />
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'ink' | 'onBlock';

export function Button({ label, onPress, variant = 'primary', disabled, loading, hint, style, size = 'md', icon, arrow, accessibilityLabel }: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md' | 'lg';
  /** Leading icon. */
  icon?: IconName;
  /** Trailing round arrow: the signature call to action. */
  arrow?: boolean;
  accessibilityLabel?: string;
}) {
  const { palette: p } = useTheme();
  const block = useBlock();
  const v: ButtonVariant = block && variant === 'primary' ? 'onBlock' : variant;
  const colors: Record<ButtonVariant, { bg: string; fg: string; border?: string; dot: string; dotFg: string }> = {
    primary: { bg: p.primaryFill, fg: p.primaryText, dot: '#FFFFFF', dotFg: p.primaryFill },
    secondary: block ? { bg: block.chip, fg: block.fg, dot: block.fg, dotFg: block.bg } : { bg: p.primarySoft, fg: p.onPrimarySoft, dot: p.primaryFill, dotFg: '#FFFFFF' },
    danger: { bg: p.dangerSoft, fg: p.danger, dot: p.danger, dotFg: p.dangerSoft },
    ghost: block ? { bg: 'transparent', fg: block.fg, border: block.chip, dot: block.fg, dotFg: block.bg } : { bg: 'transparent', fg: p.primary, border: p.borderStrong, dot: p.primaryFill, dotFg: '#FFFFFF' },
    ink: { bg: p.ink, fg: p.onInk, dot: p.onInk, dotFg: p.ink },
    onBlock: { bg: '#FFFFFF', fg: '#121318', dot: '#121318', dotFg: '#FFFFFF' }
  };
  const c = colors[v];
  const height = size === 'lg' ? 58 : size === 'sm' ? 40 : TOUCH;
  // Arrow buttons reserve an equal slot on both sides so the label sits on the button's centre line,
  // the same axis as any plain button stacked above or below it.
  const dot = height - 12;
  const pad = size === 'sm' ? spacing.lg : spacing.xxl;
  const off = Boolean(disabled || loading);
  return (
    <PressableScale
      onPress={onPress}
      disabled={off}
      hitSlop={size === 'sm' ? 4 : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy: Boolean(loading) }}
      style={[
        styles.button,
        { minHeight: height, backgroundColor: c.bg, borderColor: c.border ?? c.bg, borderWidth: c.border ? 1.5 : 0, opacity: disabled ? 0.45 : 1, paddingLeft: arrow ? 6 : pad, paddingRight: arrow ? 6 : pad },
        style
      ]}>
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : arrow ? (
        <>
          <View style={{ width: dot, height: dot, alignItems: 'center', justifyContent: 'center' }}>
            {icon ? <Icon name={icon} color={c.fg} size={size === 'sm' ? 18 : 20} /> : null}
          </View>
          <Txt variant={size === 'sm' ? 'label' : 'bodyStrong'} style={{ color: c.fg, flex: 1, textAlign: 'center', fontWeight: '700' }} numberOfLines={2}>
            {label}
          </Txt>
          <View style={{ width: dot, height: dot, borderRadius: radius.pill, backgroundColor: c.dot, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="arrow-right" color={c.dotFg} size={size === 'lg' ? 22 : 18} strokeWidth={2.4} />
          </View>
        </>
      ) : (
        <>
          {icon ? <Icon name={icon} color={c.fg} size={size === 'sm' ? 18 : 20} /> : null}
          <Txt variant={size === 'sm' ? 'label' : 'bodyStrong'} style={{ color: c.fg, flexShrink: 1, textAlign: 'center', fontWeight: '700' }} numberOfLines={2}>
            {label}
          </Txt>
        </>
      )}
    </PressableScale>
  );
}

export function IconButton({ icon, label, onPress, count, variant = 'plain', size = TOUCH, color, disabled }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  count?: number;
  /** plain: no fill · surface: floating disc (map controls) · soft: tinted disc. */
  variant?: 'plain' | 'surface' | 'soft';
  size?: number;
  color?: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  const p = t.palette;
  const block = useBlock();
  const bg = variant === 'surface' ? p.surface : variant === 'soft' ? (block ? block.chip : p.surfaceAlt) : 'transparent';
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} new` : label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[{ width: Math.max(size, 44), height: Math.max(size, 44), borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: disabled ? 0.4 : 1 }, variant === 'surface' ? t.elevation.raised : null]}>
      <Icon name={icon} color={color ?? (block ? block.fg : p.text)} size={22} />
      {count ? (
        <View style={[styles.count, { backgroundColor: p.orange, borderColor: variant === 'surface' ? p.surface : p.bg }]}>
          <Text style={[type.micro, { color: '#121318', fontFamily: customFontsActive ? type.label.fontFamily : undefined }]}>{count > 99 ? '99+' : String(count)}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Filter / choice chip. */
export function Chip({ label, selected, onPress, icon, count }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; count?: number }) {
  const { palette: p } = useTheme();
  const fg = selected ? p.primaryText : p.text;
  const body = (
    <>
      {icon ? <Icon name={icon} color={fg} size={16} /> : null}
      <Txt variant="label" style={{ color: fg }}>{label}</Txt>
      {count !== undefined ? <Txt variant="label" style={{ color: selected ? 'rgba(255,255,255,0.8)' : p.textMuted }}>{String(count)}</Txt> : null}
    </>
  );
  const style = [styles.chip, { backgroundColor: selected ? p.primaryFill : p.surface, borderColor: selected ? p.primaryFill : p.border }];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: Boolean(selected) }} accessibilityLabel={count !== undefined ? `${label}, ${count}` : label} style={style}>
      {body}
    </PressableScale>
  );
}

/** Single choice from wrapping chips: for option sets too long or too many for a segmented control. */
/**
 * One choice from a set of chips. `scroll` keeps long sets on one line that scrolls sideways to the
 * screen edges (use it only directly inside a Screen, whose gutter it bleeds into).
 */
export function ChipGroup<T extends string>({ label, value, onChange, options, showLabel = true, scroll = false }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: IconName }[]; showLabel?: boolean; scroll?: boolean }) {
  const { gutter } = useLayout();
  const chips = options.map((o) => <Chip key={o.value} label={o.label} icon={o.icon} selected={o.value === value} onPress={() => onChange(o.value)} />);
  return (
    <View style={{ gap: spacing.sm }}>
      {showLabel ? <Txt variant="label">{label}</Txt> : null}
      {scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={label}
          style={{ marginHorizontal: -gutter, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm }}>
          {chips}
        </ScrollView>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
          {chips}
        </View>
      )}
    </View>
  );
}

/**
 * A row of cards that scrolls sideways and runs to the screen edges, with the same gap before the first
 * card and after the last. The padding sits on the content, not the scroll view: Android drops a scroll
 * view's own end padding, which left the last card touching the screen edge. Use directly inside a Screen.
 */
export function CardRail({ children, gap = spacing.md, accessibilityLabel }: { children: ReactNode; gap?: number; accessibilityLabel?: string }) {
  const { gutter } = useLayout();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={accessibilityLabel}
      style={{ marginHorizontal: -gutter, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: gutter, gap }}>
      {children}
    </ScrollView>
  );
}

export interface ActionItem {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** The main action gets the filled disc. */
  primary?: boolean;
  disabled?: boolean;
  /** Spoken description when the visible label is short ("Share" → "Share this run"). */
  accessibilityLabel?: string;
}

/**
 * Three to five actions as equal columns of round icon buttons with a one-line label under each, instead
 * of a stack of full-width buttons. Labels never wrap; the main action is the only filled disc.
 */
export function ActionBar({ actions }: { actions: ActionItem[] }) {
  const t = useTheme();
  const p = t.palette;
  const block = useBlock();
  return (
    <View style={styles.actionBar} accessibilityRole="toolbar">
      {actions.map((a) => {
        const bg = a.primary ? (block ? block.fg : p.primaryFill) : block ? block.chip : p.surfaceAlt;
        const fg = a.primary ? (block ? block.bg : '#FFFFFF') : block ? block.fg : p.text;
        return (
          <PressableScale key={a.label} onPress={a.onPress} disabled={a.disabled} scaleTo={0.94} accessibilityRole="button"
            accessibilityLabel={a.accessibilityLabel ?? a.label} accessibilityState={{ disabled: Boolean(a.disabled) }}
            style={[styles.action, { opacity: a.disabled ? 0.45 : 1 }]}>
            <View style={[styles.actionDisc, { backgroundColor: bg }]}>
              <Icon name={a.icon} color={fg} size={24} />
            </View>
            <Txt variant="label" align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{a.label}</Txt>
          </PressableScale>
        );
      })}
    </View>
  );
}

/** "See all" style link: label plus arrow, at least 48 dp tall. */
export function ArrowLink({ label, onPress, accessibilityLabel }: { label?: string; onPress: () => void; accessibilityLabel?: string }) {
  const { palette: p } = useTheme();
  const block = useBlock();
  const color = block ? block.fg : p.primary;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label ?? 'Open'} style={({ pressed }) => [{ minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs, opacity: pressed ? 0.6 : 1 }]}>
      {label ? <Txt variant="label" style={{ color }}>{label}</Txt> : null}
      <Icon name="arrow-right" color={color} size={20} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------------------------------- */

export function OfflineBanner() {
  const { palette: p } = useTheme();
  const online = useOnline();
  if (online) return null;
  return (
    <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: p.ink }]}>
      <Icon name="globe" color={p.onInk} size={16} />
      <Txt variant="label" style={{ color: p.onInk, flex: 1 }}>Offline. Runs keep recording and upload when you reconnect.</Txt>
    </View>
  );
}

export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, edges = ['top'], title, subtitle, headerRight, footer, gap = spacing.lg, maxWidth }: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  /** Large in-page title, for screens without a navigation header. */
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
  /** Pinned action area under the content (primary actions on forms and flows). */
  footer?: ReactNode;
  gap?: number;
  maxWidth?: number;
}) {
  const { palette: p } = useTheme();
  const { gutter, contentMax } = useLayout();
  const insets = useSafeAreaInsets();
  const width = Math.min(maxWidth ?? contentMax, contentMax);
  const head = title ? (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Txt variant="title">{title}</Txt>
        {subtitle ? <Txt color="textMuted">{subtitle}</Txt> : null}
      </View>
      {headerRight}
    </View>
  ) : null;
  const inner = (
    <View style={{ width: '100%', maxWidth: width, alignSelf: 'center', paddingHorizontal: padded ? gutter : 0, paddingTop: padded ? spacing.sm : 0, gap }}>
      {head}
      {children}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={edges}>
      <OfflineBanner />
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: footer ? spacing.xl : spacing.huge }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={p.primary} colors={[p.primaryFill]} /> : undefined}>
          {inner}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{inner}</View>
      )}
      {footer ? (
        <View style={{ paddingHorizontal: gutter, paddingTop: spacing.md, paddingBottom: Math.max(insets.bottom, spacing.lg), backgroundColor: p.bg }}>
          <View style={{ width: '100%', maxWidth: width, alignSelf: 'center', gap: spacing.sm }}>{footer}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** Surface card, or a saturated colour block (`tone`) whose text, buttons and badges recolour automatically. */
export function Card({ children, style, onPress, accessibilityLabel, tone = 'surface', padded = true }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  tone?: 'surface' | 'soft' | BlockTone;
  padded?: boolean;
}) {
  const t = useTheme();
  const p = t.palette;
  const level = useContext(SurfaceContext);
  const block = tone !== 'surface' && tone !== 'soft' ? t.blocks[tone] : null;
  const bg = block ? block.bg : tone === 'soft' ? p.primarySoft : level > 0 ? p.surfaceAlt : p.surface;
  const content = (
    <SurfaceContext.Provider value={level + 1}>
      <BlockContext.Provider value={block}>{children}</BlockContext.Provider>
    </SurfaceContext.Provider>
  );
  const boxStyle = [styles.card, { backgroundColor: bg, borderRadius: block ? 28 : radius.lg, padding: padded ? (block ? spacing.xxl : spacing.xl) : 0 }, style];
  if (!onPress) return <View style={boxStyle}>{content}</View>;
  return (
    <PressableScale onPress={onPress} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={boxStyle}>
      {content}
    </PressableScale>
  );
}

export function Section({ title, children, action, icon, subtitle, onSeeAll, seeAllLabel }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  subtitle?: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
}) {
  const { palette: p } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 }}>
        {icon ? <Icon name={icon} color={p.primary} size={22} /> : null}
        <View style={{ flex: 1 }}>
          <Txt variant="headline">{title}</Txt>
          {subtitle ? <Txt variant="caption">{subtitle}</Txt> : null}
        </View>
        {action}
        {onSeeAll ? <ArrowLink onPress={onSeeAll} accessibilityLabel={seeAllLabel ?? `See all ${title.toLowerCase()}`} /> : null}
      </View>
      {children}
    </View>
  );
}

/** List container: rows separated by hairlines, the last divider hidden. */
export function ListGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Card padded={false} style={[{ paddingHorizontal: spacing.lg, overflow: 'hidden' }, style]}>
      <View style={{ marginBottom: -StyleSheet.hairlineWidth }}>{children}</View>
    </Card>
  );
}

export function Row({ title, subtitle, right, onPress, accessibilityLabel, leading, icon, value, rank, destructive, highlight }: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  leading?: ReactNode;
  /** Leading icon in a tinted tile. */
  icon?: IconName;
  /** Right-aligned value text (tabular). */
  value?: string;
  /** Ranked lists: "01." prefix. */
  rank?: number;
  destructive?: boolean;
  /** Emphasise the row (your own entry in a ranking). */
  highlight?: boolean;
}) {
  const { palette: p } = useTheme();
  const block = useBlock();
  const titleColor = destructive ? p.danger : undefined;
  const label = accessibilityLabel ?? [rank ? `${rank}.` : null, title, subtitle, value].filter(Boolean).join(', ');
  const inner = (
    <View style={[styles.row, { borderColor: block ? block.chip : p.border }, highlight ? { backgroundColor: p.primarySoft, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, borderBottomWidth: 0 } : null]}>
      {rank !== undefined ? (
        <Txt variant="label" color="textMuted" tabular style={{ width: 30 }}>{`${String(rank).padStart(2, '0')}.`}</Txt>
      ) : null}
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: destructive ? p.dangerSoft : block ? block.chip : p.primarySoft }]}>
          <Icon name={icon} color={destructive ? p.danger : block ? block.fg : p.primary} size={20} />
        </View>
      ) : null}
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" style={titleColor ? { color: titleColor } : undefined}>{title}</Txt>
        {subtitle ? <Txt variant="caption">{subtitle}</Txt> : null}
      </View>
      {value ? <Txt variant="bodyStrong" tabular color="textMuted">{value}</Txt> : null}
      {right ?? (onPress && rank === undefined ? <Icon name="chevron-right" color={block ? block.fgMuted : p.textSubtle} size={20} /> : null)}
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={label}>{inner}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {inner}
    </Pressable>
  );
}

/** Icon + label + value line, for run stats (time, pace, elevation). */
export function StatLine({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { palette: p } = useTheme();
  const block = useBlock();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.statLine, { borderColor: block ? block.chip : p.border }]}>
      <Icon name={icon} color={block ? block.fgMuted : p.textMuted} size={22} />
      <Txt variant="bodyStrong" style={{ flex: 1 }}>{label}</Txt>
      <Txt variant="bodyStrong" tabular>{value}</Txt>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Feedback and states
 * ---------------------------------------------------------------------------------------------- */

type Tone = 'info' | 'warning' | 'danger' | 'success';
function toneColors(p: Palette, tone: Tone) {
  return {
    info: { fg: p.info, bg: p.infoSoft, icon: 'info' as const },
    warning: { fg: p.warning, bg: p.warningSoft, icon: 'alert' as const },
    danger: { fg: p.danger, bg: p.dangerSoft, icon: 'alert' as const },
    success: { fg: p.success, bg: p.successSoft, icon: 'check' as const }
  }[tone];
}

export function Banner({ text, tone = 'info', action }: { text: string; tone?: Tone; action?: { label: string; onPress: () => void } }) {
  const { palette: p } = useTheme();
  const c = toneColors(p, tone);
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: c.bg }]}>
      <Icon name={c.icon} color={c.fg} size={20} />
      <Txt variant="label" style={{ color: tone === 'info' ? p.text : c.fg, flex: 1 }}>{text}</Txt>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} hitSlop={6} style={({ pressed }) => [styles.bannerAction, { backgroundColor: p.surface, opacity: pressed ? 0.7 : 1 }]}>
          <Txt variant="label" style={{ color: tone === 'info' ? p.primary : c.fg }}>{action.label}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Placeholder shape while content loads; pulses gently unless Reduce Motion is on. */
export function Skeleton({ width = '100%', height = 16, round = radius.xs, style }: { width?: number | `${number}%`; height?: number; round?: number; style?: StyleProp<ViewStyle> }) {
  const { palette: p } = useTheme();
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduce) o.value = withRepeat(withSequence(withTiming(0.45, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
  }, [reduce, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width, height, borderRadius: round, backgroundColor: p.surfaceSunken }, anim, style]} />;
}

export function LoadingState({ label = 'Loading…', variant = 'rows', rows = 3 }: { label?: string; variant?: 'rows' | 'cards' | 'spinner'; rows?: number }) {
  const { palette: p } = useTheme();
  if (variant === 'spinner') {
    return (
      <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
        <ActivityIndicator color={p.primary} />
        <Txt variant="caption">{label}</Txt>
      </View>
    );
  }
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ gap: spacing.lg, paddingVertical: spacing.md }}>
      {variant === 'cards' ? <Skeleton height={168} round={radius.xl} /> : null}
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Skeleton width={44} height={44} round={radius.sm} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Skeleton width={i % 2 ? '58%' : '72%'} height={14} />
            <Skeleton width={i % 2 ? '34%' : '46%'} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ title, body, action, icon = 'sparkle' }: { title: string; body?: string; action?: { label: string; onPress: () => void }; icon?: IconName }) {
  const { palette: p } = useTheme();
  return (
    <View style={[styles.center, { paddingVertical: spacing.xxxl }]}>
      <View style={[styles.stateIcon, { backgroundColor: p.primarySoft }]}>
        <Icon name={icon} color={p.primary} size={28} />
      </View>
      <Txt variant="heading" align="center">{title}</Txt>
      {body ? <Txt color="textMuted" align="center" style={{ maxWidth: 420 }}>{body}</Txt> : null}
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" style={{ marginTop: spacing.xs }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const { palette: p } = useTheme();
  return (
    <View style={[styles.center, { paddingVertical: spacing.xxl }]} accessibilityRole="alert">
      <View style={[styles.stateIcon, { backgroundColor: p.dangerSoft }]}>
        <Icon name="alert" color={p.danger} size={26} />
      </View>
      <Txt variant="heading" align="center">{title}</Txt>
      <Txt color="textMuted" align="center" style={{ maxWidth: 420 }}>{friendlyError(error)}</Txt>
      {onRetry ? <Button label="Try again" icon="refresh" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Inputs
 * ---------------------------------------------------------------------------------------------- */

export function Toggle({ label, description, value, onChange, disabled }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { palette: p } = useTheme();
  return (
    <View style={[styles.row, { borderColor: p.border, opacity: disabled ? 0.55 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        {description ? <Txt variant="caption">{description}</Txt> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={description}
        trackColor={{ true: p.primaryFill, false: p.borderStrong }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={p.borderStrong}
        {...(Platform.OS === 'web' ? ({ activeThumbColor: '#FFFFFF', activeTrackColor: p.primaryFill } as object) : null)}
      />
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  const p = t.palette;
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segW = options.length ? (w - 8) / options.length : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = reduce ? index * segW : withSpring(index * segW, springs.press);
  }, [index, segW, reduce, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[styles.segmented, { backgroundColor: p.surfaceSunken }]}>
      {w > 0 && options.some((o) => o.value === value) ? (
        <Animated.View style={[styles.segmentThumb, { width: segW, backgroundColor: p.surface }, t.elevation.raised, thumb]} />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={o.label} style={styles.segment}>
            <Txt variant="label" color={selected ? 'text' : 'textMuted'} numberOfLines={1}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TextField({ label, value, onChangeText, error, secure, multiline, maxLength, placeholder, autoCapitalize = 'sentences', keyboardType, autoComplete, hint, onSubmitEditing, returnKeyType, autoFocus, editable = true, labelHidden, compact }: {
  label: string;
  /** Multiline field that starts one line tall (comment and message bars). */
  compact?: boolean;
  /** Keep the label for screen readers only (compact composers). */
  labelHidden?: boolean;
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  secure?: boolean;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  autoComplete?: 'email' | 'password' | 'new-password' | 'current-password' | 'username' | 'off';
  hint?: string;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'next' | 'go' | 'send';
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const { palette: p } = useTheme();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const border = error ? p.danger : focused ? p.primary : p.borderStrong;
  return (
    <View style={{ gap: spacing.xs + 2 }}>
      {labelHidden ? null : <Txt variant="label">{label}</Txt>}
      <View style={[styles.inputWrap, { borderColor: border, borderWidth: focused || error ? 2 : 1, backgroundColor: p.surface, minHeight: multiline && !compact ? 112 : 54, opacity: editable ? 1 : 0.6 }]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure && !reveal}
          multiline={multiline}
          maxLength={maxLength}
          placeholder={placeholder}
          placeholderTextColor={p.textSubtle}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          autoCorrect={!secure && keyboardType !== 'email-address'}
          accessibilityLabel={label}
          accessibilityHint={hint}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          autoFocus={autoFocus}
          editable={editable}
          selectionColor={p.primary}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={[type.body, { flex: 1, color: p.text, paddingVertical: multiline ? spacing.md : 0, minHeight: multiline && !compact ? 104 : 50, maxHeight: compact ? 140 : undefined }, customFontsActive ? null : { fontFamily: undefined }]}
        />
        {secure ? (
          <Pressable onPress={() => setReveal(!reveal)} accessibilityRole="button" accessibilityLabel={reveal ? 'Hide password' : 'Show password'} hitSlop={6} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={reveal ? 'eye-off' : 'eye'} color={p.textMuted} size={22} />
          </Pressable>
        ) : null}
      </View>
      {hint ? <Txt variant="caption">{hint}</Txt> : null}
      {maxLength && !labelHidden ? <Txt variant="caption" align="right" tabular>{`${value.length}/${maxLength}`}</Txt> : null}
      {error ? <Txt variant="caption" color="danger" accessibilityRole="alert">{error}</Txt> : null}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Identity and data display
 * ---------------------------------------------------------------------------------------------- */

export function Avatar({ name, uri, size = 40, ring }: { name: string; uri?: string | null; size?: number; ring?: boolean | string }) {
  const t = useTheme();
  const tint = avatarTint(name, t.scheme);
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const face = uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityIgnoresInvertColors accessible={false} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Text style={[type.label, { color: tint.fg, fontSize: Math.max(11, size * 0.36), lineHeight: Math.max(14, size * 0.44), fontFamily: customFontsActive ? type.heading.fontFamily : undefined }]}>{initials || '?'}</Text>
    </View>
  );
  if (!ring) return face;
  const ringColor = typeof ring === 'string' ? ring : t.palette.primary;
  return <View style={{ padding: 3, borderRadius: size, borderWidth: 2, borderColor: ringColor }} accessible={false}>{face}</View>;
}

type BadgeTone = 'info' | 'success' | 'warning' | 'danger' | 'title' | 'muted' | 'violet';
export function Badge({ label, tone = 'info', icon }: { label: string; tone?: BadgeTone; icon?: IconName }) {
  const { palette: p } = useTheme();
  const block = useBlock();
  const c = block
    ? { bg: block.chip, fg: block.fg }
    : {
        info: { bg: p.infoSoft, fg: p.info },
        success: { bg: p.successSoft, fg: p.success },
        warning: { bg: p.warningSoft, fg: p.warning },
        danger: { bg: p.dangerSoft, fg: p.danger },
        title: { bg: p.orangeSoft, fg: p.orangeText },
        muted: { bg: p.surfaceSunken, fg: p.textMuted },
        violet: { bg: p.primarySoft, fg: p.onPrimarySoft }
      }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      {icon ? <Icon name={icon} color={c.fg} size={14} strokeWidth={2.4} /> : null}
      <Txt variant="micro" style={{ color: c.fg, fontSize: 12, lineHeight: 16 }}>{label}</Txt>
    </View>
  );
}

export function StatTile({ label, value, unit, note, icon }: { label: string; value: string; unit?: string; note?: string; icon?: IconName }) {
  const { palette: p } = useTheme();
  const block = useBlock();
  const level = useContext(SurfaceContext);
  return (
    <View
      style={[styles.stat, { backgroundColor: block ? block.chip : level > 0 ? p.surfaceAlt : p.surface }]}
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}${note ? `. ${note}` : ''}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        {icon ? <Icon name={icon} color={block ? block.fgMuted : p.textMuted} size={16} /> : null}
        <Txt variant="caption" numberOfLines={1}>{label}</Txt>
      </View>
      <Txt variant="metric" style={{ fontSize: 28, lineHeight: 32 }} numberOfLines={1}>
        {value}
        {unit ? <Txt variant="label" color="textMuted" style={{ fontStyle: 'normal', fontWeight: '600' }}>{` ${unit}`}</Txt> : null}
      </Txt>
      {note ? <Txt variant="caption">{note}</Txt> : null}
    </View>
  );
}

/** The signature big heavy-italic number with its unit (and optional label), used for every hero figure. */
export function BigNumber({ value, unit, label, size = 76, dim, align = 'left' }: { value: string; unit?: string; label?: string; size?: number; dim?: boolean; align?: 'left' | 'center' }) {
  return (
    <View accessible accessibilityLabel={`${label ? `${label}: ` : ''}${value}${unit ? ` ${unit}` : ''}`} style={{ alignItems: align === 'center' ? 'center' : 'flex-start' }}>
      {label ? <Txt variant="label" color="textMuted">{label}</Txt> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs }}>
        <Txt variant="hero" numberOfLines={1} style={{ fontSize: size, lineHeight: Math.round(size * 1.03), opacity: dim ? 0.55 : 1 }}>{value}</Txt>
        {unit ? <Txt variant="headline" color="textMuted" style={{ marginBottom: Math.round(size * 0.13) }}>{unit}</Txt> : null}
      </View>
    </View>
  );
}

export function ProgressBar({ value, tone = 'violet', height = 8, label }: { value: number; tone?: BlockTone | 'violet'; height?: number; label?: string }) {
  const t = useTheme();
  const p = t.palette;
  const block = useBlock();
  const reduce = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const wv = useSharedValue(reduce ? clamped : 0);
  useEffect(() => {
    wv.value = reduce ? clamped : withTiming(clamped, { duration: 700 });
  }, [clamped, reduce, wv]);
  const fill = useAnimatedStyle(() => ({ width: `${wv.value * 100}%` }));
  const color = block ? block.fg : t.blocks[tone].bg;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }} style={{ height, borderRadius: radius.pill, backgroundColor: block ? block.chip : p.surfaceSunken, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: radius.pill, backgroundColor: color }, fill]} />
    </View>
  );
}

export function ProgressRing({ value, size = 72, stroke = 8, tone = 'violet', children, label }: { value: number; size?: number; stroke?: number; tone?: BlockTone; children?: ReactNode; label?: string }) {
  const t = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.palette.surfaceSunken} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.blocks[tone].bg} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c * clamped} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      {children}
    </View>
  );
}

/**
 * Medal for achievements and personal bests: gradient ring with a bead border and a gold centre
 * (grey when not yet earned). The label is the real achievement (for example "5K").
 */
export function Medal({ label, tone = 'violet', size = 64, earned = true }: { label: string; tone?: 'violet' | 'orange' | 'blue' | 'green'; size?: number; earned?: boolean }) {
  const ring = { violet: ['#C04BE0', '#5B57E3'], orange: ['#FFB547', '#F2541D'], blue: ['#38B6FF', '#0A5BD8'], green: ['#8BE07A', '#12A36B'] }[tone];
  const id = `m-${tone}-${earned ? 1 : 0}`;
  const beads = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    return [32 + Math.cos(a) * 26.5, 32 + Math.sin(a) * 26.5] as const;
  });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Svg width={size} height={size} viewBox="0 0 64 64" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`${id}-r`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={earned ? ring[0] : '#C9CCD6'} />
            <Stop offset="1" stopColor={earned ? ring[1] : '#8A8F9E'} />
          </LinearGradient>
          <LinearGradient id={`${id}-c`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={earned ? '#FFE27A' : '#F1F2F6'} />
            <Stop offset="1" stopColor={earned ? '#FFB01F' : '#D9DCE4'} />
          </LinearGradient>
        </Defs>
        <Circle cx={32} cy={32} r={31} fill={`url(#${id}-r)`} />
        {beads.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={1.3} fill="#FFFFFF" opacity={0.7} />)}
        <Circle cx={32} cy={32} r={21} fill={`url(#${id}-c)`} />
        <Circle cx={32} cy={32} r={21} fill="none" stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={1.5} />
      </Svg>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ color: earned ? '#5A3A00' : '#6B7080', fontSize: size * 0.24, lineHeight: size * 0.3, maxWidth: size * 0.58, textAlign: 'center', fontFamily: customFontsActive ? type.metric.fontFamily : undefined, fontWeight: customFontsActive ? undefined : '900' }}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Sheets and dialogs
 * ---------------------------------------------------------------------------------------------- */

/** Modal bottom sheet for contextual detail and choices. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { contentMax } = useLayout();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible ? (
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={[StyleSheet.absoluteFill, { backgroundColor: t.palette.overlay }]}>
            <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View
            entering={SlideInDown.springify().damping(springs.sheet.damping).stiffness(springs.sheet.stiffness)}
            exiting={SlideOutDown.duration(180)}
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: t.palette.surface, paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm, width: '100%', maxWidth: Math.min(contentMax, 640), alignSelf: 'center' }, t.elevation.floating]}>
            <View style={[styles.grabber, { backgroundColor: t.palette.borderStrong }]} />
            {title ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Txt variant="headline" style={{ flex: 1 }}>{title}</Txt>
                <IconButton icon="close" label="Close" onPress={onClose} variant="soft" size={40} />
              </View>
            ) : null}
            <SurfaceContext.Provider value={1}>{children}</SurfaceContext.Provider>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

export function confirm(title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = true): void {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm }
  ]);
}

const styles = StyleSheet.create({
  actionBar: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start', gap: spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: spacing.xs, minHeight: 84, maxWidth: 96 },
  actionDisc: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  button: { borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  count: { position: 'absolute', top: 4, right: 2, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  chip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginVertical: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  card: { gap: spacing.md },
  row: { minHeight: TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  statLine: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  bannerAction: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  stateIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  segmented: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, minHeight: 48 },
  segmentThumb: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: radius.pill },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingLeft: spacing.lg, paddingRight: spacing.xs },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4, alignSelf: 'flex-start' },
  stat: { flex: 1, minWidth: 140, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.lg },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: spacing.xs }
});
