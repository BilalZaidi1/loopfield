import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Platform, Pressable, View, type AlertButton } from 'react-native';
import { Button, Txt } from '@/components/ui';
import { radius, spacing, usePalette } from '@/theme/tokens';

/**
 * React Native's Alert does nothing in a browser, so confirmations (sign out, delete, leave a club…) would
 * silently never appear in the web version. On web, Alert.alert is routed to this in-app dialog instead,
 * which keeps the same titles, messages and buttons. Phones keep the system alert.
 */
interface PendingAlert {
  title: string;
  message?: string;
  buttons: AlertButton[];
}

const queue: PendingAlert[] = [];
let notify: (() => void) | null = null;

/** Browser-only stand-ins for the two React Native APIs the web version lacks: Alert and Linking.openSettings. */
export function installWebShims(): void {
  if (Platform.OS !== 'web') return;
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    queue.push({ title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] });
    notify?.();
  };
  // Browsers have no app settings page; permissions live in the site settings next to the address bar.
  Linking.openSettings = async () => {
    Alert.alert('Browser settings', "In a browser, location and notification access are changed in the site's settings (the icon next to the web address).");
  };
}

export function WebAlertHost() {
  const p = usePalette();
  const [current, setCurrent] = useState<PendingAlert | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    notify = () => setCurrent((c) => c ?? queue.shift() ?? null);
    notify();
    return () => {
      notify = null;
    };
  }, []);
  if (Platform.OS !== 'web' || !current) return null;

  const choose = (b: AlertButton | undefined) => {
    setCurrent(queue.shift() ?? null);
    b?.onPress?.();
  };
  const cancel = current.buttons.find((b) => b.style === 'cancel');
  const stacked = current.buttons.length > 2;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => choose(cancel)}>
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={() => (cancel ? choose(cancel) : undefined)}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
        <Pressable
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          onPress={() => {}}
          style={{ width: '100%', maxWidth: 360, backgroundColor: p.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: p.border }}>
          <Txt variant="heading">{current.title}</Txt>
          {current.message ? <Txt color="textMuted">{current.message}</Txt> : null}
          <View style={{ flexDirection: stacked ? 'column' : 'row', gap: spacing.sm }}>
            {current.buttons.map((b, i) => (
              <Button
                key={`${b.text ?? 'OK'}-${i}`}
                label={b.text ?? 'OK'}
                variant={b.style === 'destructive' ? 'danger' : b.style === 'cancel' ? 'ghost' : 'primary'}
                onPress={() => choose(b)}
                style={stacked ? undefined : { flex: 1 }}
              />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
