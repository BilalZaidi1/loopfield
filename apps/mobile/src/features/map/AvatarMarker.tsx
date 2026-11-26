import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, View, type HostInstance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import { captureRef } from 'react-native-view-shot';
import { useAppConfig } from '@/lib/appConfig';
import { log } from '@/lib/log';
import { useSignedUrl } from '@/features/social/media';
import { noteMarker } from '@/recording/marker';
import { useSession } from '@/state/session';

/**
 * The runner's picture as their position dot (R1). A small round copy of the profile picture (photo or drawn
 * avatar) is made once on the phone and kept in the app's files, so a run with no signal still shows it; it
 * is made again when the picture changes. Only the runner sees it. Falls back to the plain dot whenever there
 * is no picture, the runner turned it off, or the back office paused it.
 */
const PREF_KEY = 'avatar-marker-pref-v1';
/** Points of the round marker (the image is captured at twice this). */
export const MARKER_PT = 44;

export async function loadMarkerPreference(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREF_KEY)) !== 'off';
  } catch {
    return true;
  }
}

export async function saveMarkerPreference(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // a per-phone convenience; the default stays on
  }
}

/** A short, stable name for the cached marker of one picture. */
export function markerFileName(avatarPath: string): string {
  let h = 0;
  for (let i = 0; i < avatarPath.length; i++) h = (h * 31 + avatarPath.charCodeAt(i)) | 0;
  return `avatar-marker-${(h >>> 0).toString(36)}.png`;
}

/** Removes every picture marker kept on this phone (at sign-out). */
export function clearMarkerFiles(): void {
  try {
    for (const entry of new Directory(Paths.document).list()) {
      if (entry instanceof File && /^avatar-marker-[a-z0-9]+\.png$/.test(entry.name)) entry.delete();
    }
  } catch {
    // nothing kept, or the folder is unavailable
  }
}

function cachedMarker(avatarPath: string): File | null {
  try {
    return new File(Paths.document, markerFileName(avatarPath));
  } catch {
    return null;
  }
}

/** The marker image to give the map (a file URI) or null, and an off-screen helper to mount while it is made. */
export function useAvatarMarker(): { uri: string | null; maker: ReactNode } {
  const { profile } = useSession();
  const { settings } = useAppConfig();
  const [pref, setPref] = useState(true);
  const [made, setMade] = useState<{ path: string; uri: string } | null>(null);
  const shot = useRef<HostInstance>(null);
  const path = profile?.avatar_path ?? null;
  const on = Platform.OS !== 'web' && settings.enabled.avatar_marker_enabled && pref && Boolean(path);

  useEffect(() => {
    void loadMarkerPreference().then(setPref);
  }, []);

  // A marker made earlier for this picture, kept in the app's files.
  const cached = useMemo(() => {
    if (!on || !path) return null;
    try {
      const f = cachedMarker(path);
      return f?.exists ? f.uri : null;
    } catch {
      return null;
    }
  }, [on, path]);
  const uri = on && path ? (made?.path === path ? made.uri : cached) : null;

  useEffect(() => {
    noteMarker(on && uri ? 'picture' : 'dot');
  }, [on, uri]);

  const signed = useSignedUrl('avatars', on && !uri ? path : null);
  const capture = async () => {
    if (!path) return;
    try {
      const tmp = await captureRef(shot, { format: 'png', quality: 1, width: MARKER_PT * 2, height: MARKER_PT * 2, result: 'tmpfile' });
      const target = cachedMarker(path);
      if (!target) return;
      if (target.exists) target.delete();
      await new File(/^file:/.test(tmp) ? tmp : `file://${tmp}`).copy(target);
      setMade({ path, uri: target.uri });
    } catch (e) {
      log.warn(`picture marker not made: ${e instanceof Error ? e.name : 'error'}`);
    }
  };

  const maker = on && !uri && signed.data ? (
    <View pointerEvents="none" style={{ position: 'absolute', left: -2000, top: -2000 }} collapsable={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View ref={shot} collapsable={false} style={{ width: MARKER_PT, height: MARKER_PT, borderRadius: MARKER_PT / 2, overflow: 'hidden', borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#FFFFFF' }}>
        <Image source={{ uri: signed.data }} style={{ width: '100%', height: '100%' }} contentFit="cover" onLoad={() => void capture()} />
      </View>
    </View>
  ) : null;
  return { uri, maker };
}
