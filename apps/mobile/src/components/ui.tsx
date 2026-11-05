import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnline } from '@/lib/network';
import { friendlyError } from '@/lib/api';
import { radius, spacing, TOUCH, type, usePalette, type Palette } from '@/theme/tokens';

type Variant = keyof typeof type;

export function Txt({ variant = 'body', color, style, children, numberOfLines, accessibilityRole, accessibilityLabel }: {
  variant?: Variant;
  color?: keyof Palette;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text' | 'alert' | 'summary';
  accessibilityLabel?: string;
}) {
  const p = usePalette();
  return (
    <Text
      style={[type[variant], { color: p[color ?? (variant === 'caption' ? 'textMuted' : 'text')] }, style]}
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole ?? (variant === 'title' || variant === 'display' || variant === 'heading' ? 'header' : undefined)}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={2}>
      {children}
    </Text>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <Banner tone="warning" text="Offline. Runs keep recording and will upload when you reconnect." />;
}

export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, edges = ['top'] }: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const p = usePalette();
  const content = <View style={padded ? { padding: spacing.lg, gap: spacing.lg } : undefined}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={edges}>
      <OfflineBanner />
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}>
          {content}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{content}</View>
      )}
    </SafeAreaView>
  );
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, hint, style }: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const bg = variant === 'primary' ? p.primary : variant === 'danger' ? p.danger : variant === 'secondary' ? p.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? p.primaryText : variant === 'danger' ? '#FFFFFF' : p.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, borderColor: variant === 'ghost' ? p.border : bg },
        style
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[type.label, { color: fg, fontSize: 16 }]}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const p = usePalette();
  const body = <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {body}
    </Pressable>
  );
}

export function Row({ title, subtitle, right, onPress, accessibilityLabel, leading }: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  leading?: ReactNode;
}) {
  const p = usePalette();
  const inner = (
    <View style={[styles.row, { borderColor: p.border }]}>
      {leading}
      <View style={{ flex: 1 }}>
        <Txt variant="body" style={{ fontWeight: '600' }}>{title}</Txt>
        {subtitle ? <Txt variant="caption">{subtitle}</Txt> : null}
      </View>
      {right ?? (onPress ? <Txt variant="heading" color="textMuted">›</Txt> : null)}
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}>{inner}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {inner}
    </Pressable>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="heading">{title}</Txt>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Banner({ text, tone = 'info', action }: { text: string; tone?: 'info' | 'warning' | 'danger' | 'success'; action?: { label: string; onPress: () => void } }) {
  const p = usePalette();
  const color = tone === 'warning' ? p.warning : tone === 'danger' ? p.danger : tone === 'success' ? p.success : p.info;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { borderColor: color, backgroundColor: p.surface }]}>
      <Txt variant="label" style={{ color, flex: 1 }}>{text}</Txt>
      {action ? <Button label={action.label} onPress={action.onPress} variant="ghost" style={{ minHeight: 40, paddingHorizontal: spacing.md }} /> : null}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const p = usePalette();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={p.primary} />
      <Txt variant="caption">{label}</Txt>
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={[styles.center, { paddingVertical: spacing.xxl }]}>
      <Txt variant="heading" style={{ textAlign: 'center' }}>{title}</Txt>
      {body ? <Txt variant="body" color="textMuted" style={{ textAlign: 'center' }}>{body}</Txt> : null}
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <View style={[styles.center, { paddingVertical: spacing.xl }]} accessibilityRole="alert">
      <Txt variant="heading">{title}</Txt>
      <Txt variant="body" color="textMuted" style={{ textAlign: 'center' }}>{friendlyError(error)}</Txt>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

/** Renders loading / error / empty states for a query result consistently across screens. */
export function QueryView<T>({ query, empty, emptyState, children, loadingLabel }: {
  query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
  empty?: (data: T) => boolean;
  emptyState?: ReactNode;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}) {
  if (query.isLoading) return <LoadingState label={loadingLabel} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return null;
  if (empty?.(query.data)) return <>{emptyState ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children(query.data)}</>;
}

export function Toggle({ label, description, value, onChange, disabled }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const p = usePalette();
  return (
    <View style={[styles.row, { borderColor: p.border }]}>
      <View style={{ flex: 1 }}>
        <Txt variant="body" style={{ fontWeight: '600' }}>{label}</Txt>
        {description ? <Txt variant="caption">{description}</Txt> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={description}
        trackColor={{ true: p.primary, false: p.border }}
      />
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const p = usePalette();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.segmented, { backgroundColor: p.surfaceAlt }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            style={[styles.segment, selected && { backgroundColor: p.surface, borderColor: p.primary, borderWidth: 2 }]}>
            <Txt variant="label" color={selected ? 'text' : 'textMuted'}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TextField({ label, value, onChangeText, error, secure, multiline, maxLength, placeholder, autoCapitalize = 'sentences', keyboardType, autoComplete, hint }: {
  label: string;
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
}) {
  const p = usePalette();
  return (
    <View style={{ gap: spacing.xs }}>
      <Txt variant="label">{label}</Txt>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        multiline={multiline}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={p.textMuted}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        accessibilityLabel={label}
        accessibilityHint={hint}
        style={[styles.input, { color: p.text, borderColor: error ? p.danger : p.border, backgroundColor: p.surface, minHeight: multiline ? 96 : TOUCH }]}
      />
      {hint ? <Txt variant="caption">{hint}</Txt> : null}
      {maxLength ? <Txt variant="caption">{`${value.length}/${maxLength}`}</Txt> : null}
      {error ? <Txt variant="caption" color="danger" accessibilityRole="alert">{error}</Txt> : null}
    </View>
  );
}

export function Avatar({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number }) {
  const p = usePalette();
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityIgnoresInvertColors accessible={false} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Text style={[type.label, { color: p.text }]}>{initials || '?'}</Text>
    </View>
  );
}

export function Badge({ label, tone = 'info' }: { label: string; tone?: 'info' | 'success' | 'warning' | 'danger' | 'title' | 'muted' }) {
  const p = usePalette();
  const color = { info: p.info, success: p.success, warning: p.warning, danger: p.danger, title: p.title, muted: p.textMuted }[tone];
  return (
    <View style={{ borderColor: color, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Txt variant="caption" style={{ color, fontWeight: '700' }}>{label}</Txt>
    </View>
  );
}

export function StatTile({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.stat, { backgroundColor: p.surface, borderColor: p.border }]} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}${note ? `. ${note}` : ''}`}>
      <Txt variant="caption">{label}</Txt>
      <Txt variant="title">{value}{unit ? <Txt variant="label" color="textMuted">{` ${unit}`}</Txt> : null}</Txt>
      {note ? <Txt variant="caption">{note}</Txt> : null}
    </View>
  );
}

export function confirm(title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = true): void {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm }
  ]);
}

const styles = StyleSheet.create({
  button: { minHeight: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderWidth: 1.5 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  row: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, margin: spacing.sm },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 16 },
  stat: { flex: 1, minWidth: 140, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: 2 }
});
