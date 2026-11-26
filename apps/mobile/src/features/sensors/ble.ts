import { PermissionsAndroid, Platform } from 'react-native';
import { BATTERY_LEVEL, BATTERY_SERVICE, HR_MEASUREMENT, HR_SERVICE, parseBatteryLevel, sameUuid } from '@loopfield/core';
import { isExpoGo, optionalNativeModule } from '@/lib/runtime';

/**
 * The phone's Bluetooth, for heart-rate straps (R3), through react-native-ble-manager. Only app builds that
 * include the module have it: on the web, in Expo Go and in builds made before stage 3 there is no Bluetooth
 * here, and the Sensors screen says the newer app is needed. Only the standard Heart Rate Service is scanned for,
 * so other Bluetooth devices nearby are never listed or touched. The module is loaded on first use.
 */
type Subscription = { remove: () => void };
interface BleManagerModule {
  start(options?: { showAlert?: boolean }): Promise<void>;
  checkState(): Promise<string>;
  scan(options: { serviceUUIDs?: string[]; seconds?: number }): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(id: string, force?: boolean): Promise<void>;
  retrieveServices(id: string, serviceUUIDs?: string[]): Promise<unknown>;
  startNotification(id: string, service: string, characteristic: string): Promise<void>;
  stopNotification(id: string, service: string, characteristic: string): Promise<void>;
  read(id: string, service: string, characteristic: string): Promise<number[]>;
  onDiscoverPeripheral(cb: (p: { id: string; name?: string; rssi: number; advertising?: { localName?: string } }) => void): Subscription;
  onStopScan(cb: () => void): Subscription;
  onDisconnectPeripheral(cb: (e: { peripheral: string }) => void): Subscription;
  onDidUpdateValueForCharacteristic(cb: (e: { peripheral: string; characteristic: string; service: string; value: number[] }) => void): Subscription;
}

let loaded: BleManagerModule | null | undefined;
function ble(): BleManagerModule | null {
  if (loaded !== undefined) return loaded;
  loaded = Platform.OS === 'web' || isExpoGo
    ? null
    : optionalNativeModule('react-native-ble-manager', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module, loaded on first use
        const m = require('react-native-ble-manager');
        return (m.default ?? m) as BleManagerModule;
      });
  return loaded;
}

let started: Promise<void> | null = null;
function ready(): Promise<BleManagerModule> {
  const m = ble();
  if (!m) return Promise.reject(new Error('bluetooth_unavailable'));
  started ??= m.start({ showAlert: false }).catch((e: unknown) => {
    started = null;
    throw e;
  });
  return started.then(() => m);
}

/** Whether this app build can use Bluetooth at all. */
export function bluetoothInBuild(): boolean {
  return ble() != null;
}

export type BluetoothAccess = 'granted' | 'denied' | 'off' | 'unavailable';

/**
 * Asks for what scanning and connecting need: on Android 12 and later the Nearby devices permissions (scanning
 * is declared as never used for location); before that, the location access the app already uses for runs.
 */
export async function ensureBluetoothAccess(): Promise<BluetoothAccess> {
  if (!ble()) return 'unavailable';
  if (Platform.OS === 'android') {
    const v = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    const wanted = v >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const res = await PermissionsAndroid.requestMultiple(wanted);
    if (!wanted.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED)) return 'denied';
  }
  const m = await ready();
  const state = await m.checkState().catch(() => 'unknown');
  return state === 'off' || state === 'turning_off' ? 'off' : 'granted';
}

export interface FoundStrap {
  id: string;
  /** The name the strap advertises, shown on this phone only. */
  name: string | null;
  rssi: number;
}

/**
 * One scan for heart-rate straps (Android allows only a few scans every 30 seconds, so the screen scans once and
 * waits). Calls back for each strap as it is found, and once when the scan ends. Returns a way to stop early.
 */
export async function scanForStraps(seconds: number, onFound: (s: FoundStrap) => void, onDone: () => void): Promise<() => void> {
  const m = await ready();
  const seen = new Set<string>();
  const found = m.onDiscoverPeripheral((p) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    onFound({ id: p.id, name: p.name?.trim() || p.advertising?.localName?.trim() || null, rssi: p.rssi });
  });
  const stopped = m.onStopScan(() => {
    found.remove();
    stopped.remove();
    onDone();
  });
  await m.scan({ serviceUUIDs: [HR_SERVICE], seconds });
  return () => {
    void m.stopScan().catch(() => {});
  };
}

/** Connects to a strap and asks for its heart-rate notifications. */
export async function connectStrap(id: string): Promise<void> {
  const m = await ready();
  await m.connect(id);
  await m.retrieveServices(id, [HR_SERVICE, BATTERY_SERVICE]);
  await m.startNotification(id, HR_SERVICE, HR_MEASUREMENT);
}

export async function disconnectStrap(id: string): Promise<void> {
  const m = ble();
  if (!m) return;
  await m.stopNotification(id, HR_SERVICE, HR_MEASUREMENT).catch(() => {});
  await m.disconnect(id).catch(() => {});
}

/** The strap's battery level, when it has the Battery Service. Needs a connection. */
export async function readStrapBattery(id: string): Promise<number | null> {
  const m = await ready();
  const bytes = await m.read(id, BATTERY_SERVICE, BATTERY_LEVEL).catch(() => null);
  return bytes ? parseBatteryLevel(bytes) : null;
}

/** Heart-rate packets from one strap, and its disconnections. Returns a function that stops listening. */
export function listenToStrap(id: string, onPacket: (bytes: number[], at: number) => void, onLost: () => void): () => void {
  const m = ble();
  if (!m) return () => {};
  const value = m.onDidUpdateValueForCharacteristic((e) => {
    if (e.peripheral === id && sameUuid(e.characteristic, HR_MEASUREMENT)) onPacket(e.value, Date.now());
  });
  const lost = m.onDisconnectPeripheral((e) => {
    if (e.peripheral === id) onLost();
  });
  return () => {
    value.remove();
    lost.remove();
  };
}
