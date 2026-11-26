import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The heart-rate strap a runner paired (R3), remembered on this phone only (never on the server): its Bluetooth
 * id, the name it advertises (shown here only; names can hold serial numbers, so they never go to analytics) and
 * the battery level last read.
 */
export interface PairedStrap {
  id: string;
  name: string | null;
  battery: number | null;
  batteryAt: number | null;
}

const KEY = 'hr-strap-v1';
let current: PairedStrap | null = null;
let loaded = false;
let loading: Promise<PairedStrap | null> | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function loadPairedStrap(): Promise<PairedStrap | null> {
  if (loaded) return Promise.resolve(current);
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      current = raw ? (JSON.parse(raw) as PairedStrap) : null;
    })
    .catch(() => {
      current = null;
    })
    .then(() => {
      loaded = true;
      loading = null;
      emit();
      return current;
    });
  return loading;
}

export async function savePairedStrap(strap: PairedStrap | null): Promise<void> {
  current = strap;
  loaded = true;
  emit();
  if (strap) await AsyncStorage.setItem(KEY, JSON.stringify(strap));
  else await AsyncStorage.removeItem(KEY);
}

/** Pairs a strap found nearby, with the battery level read while connected (if the strap reports one). */
export function pairStrap(found: { id: string; name: string | null }, battery: number | null): Promise<void> {
  return savePairedStrap({ id: found.id, name: found.name, battery, batteryAt: battery != null ? Date.now() : null });
}

/** The paired strap, and whether the phone's copy has been read yet. */
export function usePairedStrap(): { strap: PairedStrap | null; loaded: boolean } {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!loaded) void loadPairedStrap();
      return () => listeners.delete(l);
    },
    () => (loaded ? current : undefined)
  );
  return { strap: snap ?? null, loaded: snap !== undefined };
}

/** Test-only reset. */
export function _resetPairedStrapForTests(): void {
  current = null;
  loaded = false;
  loading = null;
}
