import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppConfigSync, type Maintenance } from '@/lib/appConfig';
import { installedVersion, storeUrl, storeWebUrl, versionBelow } from '@/lib/version';
import { fmtDate } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { activeSession } from '@/recording/db';
import { useSession } from '@/state/session';
import { LoopMark } from '@/components/Brand';
import { Button, Sheet, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { radius, spacing, usePalette } from '@/theme/tokens';

/** A run that is recording or paused on this phone. Maintenance and forced updates wait for it to finish. */
function runInProgress(): boolean {
  try {
    return activeSession() !== null;
  } catch {
    return false;
  }
}

/** While a gate is waiting for a run to end, look again every few seconds. */
function useRunInProgress(watch: boolean): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!watch) return;
    const id = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, [watch]);
  return watch && runInProgress();
}

export const UPDATE_PROMPT_KEY = 'loopfield.update_prompt.dismissed';

async function openStore(): Promise<void> {
  const url = storeUrl();
  const web = storeWebUrl();
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch {
    if (web) await Linking.openURL(web).catch(() => {});
  }
}

/**
 * Everything the back office can put in front of the whole app: maintenance mode, the minimum supported
 * version (a hard block) and the latest version (a one-time prompt). Settings are read on launch, on
 * returning to the foreground and every five minutes. A run that is recording is never interrupted: the
 * screens wait until it is finished, and the finished run stays queued for upload.
 */
export function SystemGate({ children, promptReady }: { children: ReactNode; promptReady: boolean }) {
  const { settings, refetch } = useAppConfigSync();
  const { staff } = useSession();
  const isStaff = staff.permissions.length > 0;
  const installed = installedVersion();
  const maintenance = settings.maintenance.enabled;
  const mustUpdate = Boolean(settings.minSupportedVersion && versionBelow(installed, settings.minSupportedVersion));
  const recording = useRunInProgress(maintenance || mustUpdate);

  // Staff may continue past one maintenance window; the choice ends with it.
  const [staffPast, setStaffPast] = useState(false);
  const [seenMaintenance, setSeenMaintenance] = useState(maintenance);
  if (seenMaintenance !== maintenance) {
    setSeenMaintenance(maintenance);
    if (!maintenance) setStaffPast(false);
  }

  if (maintenance && !recording && !(staffPast && isStaff)) {
    return <MaintenanceScreen maintenance={settings.maintenance} onCheck={refetch} onContinue={isStaff ? () => setStaffPast(true) : undefined} />;
  }
  if (mustUpdate && !recording) return <UpdateRequiredScreen installed={installed} required={settings.minSupportedVersion!} onCheck={refetch} />;
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
  const latest = platform ? settings.latestVersion[platform] : null;
  return (
    <>
      {children}
      {promptReady && latest && versionBelow(installed, latest) ? <UpdatePrompt installed={installed} latest={latest} /> : null}
    </>
  );
}

function GateFrame({ icon, title, children }: { icon: 'settings' | 'download'; title: string; children: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.xl }}>
      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.lg, width: '100%', maxWidth: 520, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <LoopMark size={44} ring={p.primary} dot={p.orange} />
          <View style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} color={p.primary} size={22} />
          </View>
        </View>
        <Txt variant="title" accessibilityRole="header">{title}</Txt>
        {children}
      </View>
    </View>
  );
}

/** The full-screen maintenance notice, with the back office's message and when the app is expected back. */
export function MaintenanceScreen({ maintenance, onCheck, onContinue }: { maintenance: Maintenance; onCheck: () => void; onContinue?: () => void }) {
  const p = usePalette();
  const now = useNow();
  const back = maintenance.until && Date.parse(maintenance.until) > now ? maintenance.until : null;
  const sameDay = back ? new Date(back).toDateString() === new Date(now).toDateString() : false;
  const backText = back ? fmtDate(back, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <GateFrame icon="settings" title="Down for maintenance">
      <Txt>{maintenance.message ?? 'Loopfield is being updated. Please check back soon.'}</Txt>
      {backText ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessible accessibilityLabel={`Expected back by ${backText}`}>
          <Icon name="clock" color={p.textMuted} size={20} />
          <Txt variant="bodyStrong">{`Back by ${backText}`}</Txt>
        </View>
      ) : null}
      <Txt color="textMuted">Runs you recorded are safe on this phone and upload once Loopfield is back.</Txt>
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Button label="Check again" icon="refresh" onPress={onCheck} />
        {onContinue ? <Button variant="ghost" label="Continue as staff" onPress={onContinue} hint="Staff can keep working during maintenance." /> : null}
      </View>
    </GateFrame>
  );
}

/** The minimum supported version is above this build: nothing else works until it is updated. */
export function UpdateRequiredScreen({ installed, required, onCheck }: { installed: string; required: string; onCheck: () => void }) {
  const store = storeUrl();
  return (
    <GateFrame icon="download" title="Update Loopfield">
      <Txt>{`This version (${installed}) is no longer supported. Version ${required} or newer is needed to keep recording and uploading runs.`}</Txt>
      <Txt color="textMuted">Runs already on this phone stay here and upload after the update.</Txt>
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {store ? (
          <Button label={Platform.OS === 'ios' ? 'Open the App Store' : 'Open the Play Store'} icon="download" onPress={() => void openStore()} />
        ) : (
          <Button label="Reload" icon="refresh" onPress={() => (Platform.OS === 'web' ? (globalThis as { location?: { reload: () => void } }).location?.reload() : onCheck())} />
        )}
        <Button variant="ghost" label="Check again" onPress={onCheck} />
      </View>
    </GateFrame>
  );
}

/**
 * "Update available": shown once per published version; either button remembers that version. It waits
 * for another launch rather than appear over a run that is recording.
 */
export function UpdatePrompt({ installed, latest }: { installed: string; latest: string }) {
  const [state, setState] = useState<{ latest: string; show: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(UPDATE_PROMPT_KEY)
      .then((seen) => live && setState({ latest, show: seen !== latest && !runInProgress() }))
      .catch(() => live && setState({ latest, show: !runInProgress() }));
    return () => {
      live = false;
    };
  }, [latest]);
  const visible = state?.latest === latest && state.show;
  const done = (open: boolean) => {
    setState({ latest, show: false });
    void AsyncStorage.setItem(UPDATE_PROMPT_KEY, latest).catch(() => {});
    if (open) void openStore();
  };
  return (
    <Sheet visible={visible} onClose={() => done(false)} title="Update available">
      <Txt>{`Version ${latest} of Loopfield is out (you have ${installed}). Update to get the latest fixes and features.`}</Txt>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button variant="ghost" label="Not now" onPress={() => done(false)} />
        <Button label="Update" icon="download" onPress={() => done(true)} style={{ flex: 1 }} />
      </View>
    </Sheet>
  );
}
