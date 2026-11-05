import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

/**
 * Every audio cue has a visual text equivalent and an optional haptic (PRD §8 accessibility).
 * Components subscribe to cues to show the visual banner; audio and haptics are user preferences.
 */
export type CueKind = 'started' | 'paused' | 'resumed' | 'split' | 'closure_possible' | 'gps_weak' | 'gps_restored' | 'gap' | 'finished' | 'capture_started' | 'speed_started';
export interface Cue {
  kind: CueKind;
  text: string;
  at: number;
}

type Listener = (cue: Cue) => void;
const listeners = new Set<Listener>();
let prefs = { audio: false, haptics: true };

export function setCuePreferences(p: Partial<typeof prefs>): void {
  prefs = { ...prefs, ...p };
}

export function onCue(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function emitCue(kind: CueKind, text: string): void {
  const cue = { kind, text, at: Date.now() };
  listeners.forEach((l) => l(cue));
  if (prefs.haptics) {
    const warn = kind === 'gps_weak' || kind === 'gap';
    void Haptics.notificationAsync(warn ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
  if (prefs.audio) Speech.speak(text, { rate: 1.0 });
}

const PREFS_KEY = 'cue-preferences-v1';

export function cuePreferences(): { audio: boolean; haptics: boolean } {
  return { ...prefs };
}

/** Cue preferences are a per-device convenience (not account data). */
export async function loadCuePreferences(): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) prefs = { ...prefs, ...(JSON.parse(raw) as Partial<typeof prefs>) };
  } catch {
    // defaults stay in effect
  }
}

export async function saveCuePreferences(p: Partial<typeof prefs>): Promise<void> {
  setCuePreferences(p);
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // best effort
  }
}
