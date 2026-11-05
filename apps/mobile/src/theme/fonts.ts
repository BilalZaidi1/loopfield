import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import { log } from '@/lib/log';
import { fonts } from './tokens';

/** Only the weights the type scale uses are bundled (about 200 KB). */
const FONT_FILES = {
  [fonts.medium]: require('@expo-google-fonts/figtree/500Medium/Figtree_500Medium.ttf'),
  [fonts.semibold]: require('@expo-google-fonts/figtree/600SemiBold/Figtree_600SemiBold.ttf'),
  [fonts.bold]: require('@expo-google-fonts/figtree/700Bold/Figtree_700Bold.ttf'),
  [fonts.extrabold]: require('@expo-google-fonts/figtree/800ExtraBold/Figtree_800ExtraBold.ttf'),
  [fonts.blackItalic]: require('@expo-google-fonts/figtree/900Black_Italic/Figtree_900Black_Italic.ttf')
};

/**
 * `ready` once the app fonts loaded, failed, or took too long; `active` only when they actually loaded
 * (otherwise text falls back to system weights).
 */
export function useAppFonts(): { ready: boolean; active: boolean } {
  const [loaded, error] = useFonts(FONT_FILES);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (error) log.warn(`app fonts unavailable, using the system font: ${String(error)}`);
  }, [error]);
  return { ready: loaded || Boolean(error) || timedOut, active: loaded && !error };
}
