import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, Platform, useColorScheme, type ColorSchemeName } from 'react-native';
import { ThemeContext, themes, type ThemeMode, type ThemeState } from './tokens';

/** Saved theme choice (this device only; not account data). */
export const THEME_STORAGE_KEY = 'loopfield.theme';

function applyNativeScheme(mode: ThemeMode): void {
  // Native pieces (alerts, keyboards, pickers) follow the chosen theme; 'unspecified' hands control back to the system.
  if (Platform.OS === 'web' || typeof Appearance.setColorScheme !== 'function') return;
  try {
    Appearance.setColorScheme((mode === 'system' ? 'unspecified' : mode) as ColorSchemeName);
  } catch {
    // Older runtimes without an override keep following the system.
  }
}

/**
 * Light / dark theme with three choices: follow the system, always light, always dark. The choice is
 * read before the first screen renders (the splash stays up meanwhile) so the app never flashes the
 * wrong theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const fallback = setTimeout(() => alive && setReady(true), 1500);
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((saved) => {
        if (!alive) return;
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setModeState(saved);
          applyNativeScheme(saved);
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(fallback);
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
      clearTimeout(fallback);
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    applyNativeScheme(next);
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const theme = themes[scheme];
  useEffect(() => {
    Promise.resolve()
      .then(() => SystemUI.setBackgroundColorAsync(theme.palette.bg))
      .catch(() => {});
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.backgroundColor = theme.palette.bg;
      document.documentElement.style.colorScheme = scheme;
    }
  }, [theme, scheme]);

  const value = useMemo<ThemeState>(() => ({ theme, mode, setMode }), [theme, mode, setMode]);
  if (!ready) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
