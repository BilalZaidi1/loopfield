/**
 * Server-side metadata stripping for JPEG uploads (PRD §9/§11: strip EXIF location metadata and
 * serve only processed derivatives). The device already re-encodes photos to JPEG without metadata;
 * this pass is defence in depth and runs in Deno and Node without native dependencies.
 *
 * Keeps: SOI, APP0 (JFIF), APP14 (Adobe colour transform), DQT, DHT, SOFn, DRI, SOS + entropy data, EOI.
 * Drops: APP1 (EXIF/XMP incl. GPS), APP2..APP13, APP15 (ICC/MPF/IPTC/maker notes), COM.
 */

export class UnsupportedImageError extends Error {}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === SOI && bytes[2] === 0xff;
}

export function stripJpegMetadata(input: Uint8Array): { bytes: Uint8Array; removedSegments: string[] } {
  if (!isJpeg(input)) throw new UnsupportedImageError('Only JPEG uploads are accepted');
  const out: number[] = [0xff, SOI];
  const removed: string[] = [];
  let i = 2;
  while (i < input.length) {
    if (input[i] !== 0xff) throw new UnsupportedImageError('Corrupt JPEG marker stream');
    // Skip fill bytes.
    while (input[i] === 0xff && input[i + 1] === 0xff) i++;
    const marker = input[i + 1]!;
    if (marker === EOI) {
      out.push(0xff, EOI);
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    const len = (input[i + 2]! << 8) | input[i + 3]!;
    if (len < 2 || i + 2 + len > input.length) throw new UnsupportedImageError('Truncated JPEG segment');
    const segEnd = i + 2 + len;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = !isApp ? marker !== 0xfe : marker === 0xe0 || marker === 0xee;
    if (keep) for (let k = i; k < segEnd; k++) out.push(input[k]!);
    else removed.push(marker === 0xfe ? 'COM' : `APP${marker - 0xe0}`);
    i = segEnd;
    if (marker === SOS) {
      // Copy entropy-coded data up to the next non-RST marker.
      while (i < input.length) {
        if (input[i] === 0xff && input[i + 1] !== 0x00 && !(input[i + 1]! >= 0xd0 && input[i + 1]! <= 0xd7)) break;
        out.push(input[i]!);
        i++;
      }
    }
  }
  return { bytes: Uint8Array.from(out), removedSegments: removed };
}

/** Width/height from the first SOF segment (for derivative metadata and size limits). */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    i += 2 + len;
  }
  return null;
}
