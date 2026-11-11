import { Platform, type HostInstance } from 'react-native';
import type { RefObject } from 'react';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { CARD_SIZE, type CardFormat } from './ShareCard';

/**
 * Renders the card to a PNG at 3× (1080 px wide). On the web the image is a data URL; on phones it is a
 * temporary file that the share sheet or the photo library takes from there. Nothing is uploaded by us.
 */
export async function renderCard(ref: RefObject<HostInstance | null>, format: CardFormat): Promise<string> {
  const { w, h } = CARD_SIZE[format];
  if (!ref.current) throw new Error('The card is not ready yet.');
  return captureRef(ref, { format: 'png', quality: 1, width: w * 3, height: h * 3, result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile' });
}

/** The system share sheet: Instagram, TikTok, Snapchat, WhatsApp, Facebook, LinkedIn and others appear there. */
export async function shareImage(uri: string): Promise<'shared' | 'downloaded'> {
  if (Platform.OS === 'web') {
    downloadOnWeb(uri);
    return 'downloaded';
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your run' });
  return 'shared';
}

/**
 * Saves the image. iOS adds it to Photos (add-only permission: the app never reads your library);
 * Android uses the share sheet, where "Save" and Files appear, so the app needs no media permission.
 */
export async function saveImage(uri: string): Promise<'saved' | 'shared' | 'downloaded' | 'denied'> {
  if (Platform.OS === 'web') {
    downloadOnWeb(uri);
    return 'downloaded';
  }
  if (Platform.OS === 'ios') {
    const perm = await requestPermissionsAsync(true);
    if (!perm.granted) return 'denied';
    await Asset.create(uri.startsWith('file://') ? uri : `file://${uri}`);
    return 'saved';
  }
  await shareImage(uri);
  return 'shared';
}

function downloadOnWeb(dataUri: string) {
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = 'loopfield-run.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
