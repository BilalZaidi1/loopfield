import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImageManipulator from 'expo-image-manipulator';
import { SOCIAL_RULES } from '@loopfield/core';
import { supabase } from '@/lib/supabase';

/**
 * Media references are short-lived signed URLs (PRD §11); storage policies decide who may obtain
 * one. Originals are uploaded to a private per-user bucket and only processed derivatives (metadata
 * stripped server-side) are ever served to viewers.
 */
const TTL = SOCIAL_RULES.mediaUrlTtlSeconds.value;

export function useSignedUrl(bucket: 'post-media' | 'avatars' | 'club-media', path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed', bucket, path],
    enabled: Boolean(path),
    staleTime: (TTL - 30) * 1000,
    gcTime: TTL * 1000,
    queryFn: async () => {
      const { data, error } = await supabase().storage.from(bucket).createSignedUrl(path!, TTL);
      if (error) throw error;
      return data.signedUrl;
    }
  });
}

/** Several private pictures in one request (map pins); each URL is also cached under its single-path key. */
export function useSignedUrls(bucket: 'avatars' | 'club-media', paths: (string | null | undefined)[]) {
  const qc = useQueryClient();
  const list = [...new Set(paths.filter((x): x is string => Boolean(x)))].sort();
  return useQuery({
    queryKey: ['signed-batch', bucket, list],
    enabled: list.length > 0,
    staleTime: (TTL - 30) * 1000,
    gcTime: TTL * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase().storage.from(bucket).createSignedUrls(list, TTL);
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.path && row.signedUrl) {
          out[row.path] = row.signedUrl;
          qc.setQueryData(['signed', bucket, row.path], row.signedUrl);
        }
      }
      return out;
    }
  });
}

/**
 * Re-encode a picked image to JPEG on device before upload: bounded size, and re-encoding drops
 * EXIF/GPS metadata. The server strips metadata again regardless (defence in depth).
 */
export async function prepareImage(uri: string): Promise<{ uri: string; width: number; height: number }> {
  const edge = SOCIAL_RULES.maxImageEdgePixels.value;
  // Downsample while decoding (never upscales); re-encoding writes a JPEG without the source metadata.
  const img = await ImageManipulator.ImageManipulator.manipulate(uri, { maxWidth: edge, maxHeight: edge }).renderAsync();
  const out = await img.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.82 });
  return { uri: out.uri, width: out.width, height: out.height };
}

export async function uploadToBucket(bucket: 'media-uploads' | 'avatars' | 'club-media', path: string, fileUri: string): Promise<void> {
  const res = await fetch(fileUri);
  const body = await res.arrayBuffer();
  if (body.byteLength > SOCIAL_RULES.maxOriginalImageBytes.value) throw new Error('This photo is larger than 10 MB.');
  const { error } = await supabase().storage.from(bucket).upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
}
