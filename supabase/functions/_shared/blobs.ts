import type { SupabaseClient } from '@supabase/supabase-js';

/** Minimal object-store contract so job handlers run against Supabase Storage or an in-memory store in tests. */
export interface BlobStore {
  put(bucket: string, path: string, body: Uint8Array | string, contentType: string): Promise<void>;
  get(bucket: string, path: string): Promise<Uint8Array | null>;
  remove(bucket: string, paths: string[]): Promise<void>;
  list(bucket: string, prefix: string): Promise<string[]>;
  signedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string>;
}

export class SupabaseBlobStore implements BlobStore {
  constructor(private client: SupabaseClient) {}

  async put(bucket: string, path: string, body: Uint8Array | string, contentType: string) {
    const payload = typeof body === 'string' ? new Blob([body], { type: contentType }) : new Blob([body as BlobPart], { type: contentType });
    const { error } = await this.client.storage.from(bucket).upload(path, payload, { contentType, upsert: true });
    if (error) throw new Error(`storage put failed: ${error.message}`);
  }

  async get(bucket: string, path: string) {
    const { data, error } = await this.client.storage.from(bucket).download(path);
    if (error) {
      if (/not found|does not exist|404/i.test(error.message)) return null;
      throw new Error(`storage get failed: ${error.message}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async remove(bucket: string, paths: string[]) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await this.client.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    }
  }

  /** Recursive listing of object paths (relative to the bucket) under a prefix. */
  async list(bucket: string, prefix: string): Promise<string[]> {
    const out: string[] = [];
    const base = prefix.replace(/\/$/, '');
    let offset = 0;
    for (;;) {
      const { data, error } = await this.client.storage.from(bucket).list(base, { limit: 1000, offset });
      if (error) throw new Error(`storage list failed: ${error.message}`);
      for (const f of data ?? []) {
        const path = `${base}/${f.name}`;
        // Folders are returned without an id; descend into them.
        if ((f as { id: string | null }).id === null) out.push(...(await this.list(bucket, path)));
        else out.push(path);
      }
      if (!data || data.length < 1000) break;
      offset += 1000;
    }
    return out;
  }

  async signedUrl(bucket: string, path: string, ttlSeconds: number) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, ttlSeconds);
    if (error || !data) throw new Error(`signed url failed: ${error?.message}`);
    return data.signedUrl;
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  private key = (b: string, p: string) => `${b}/${p}`;
  async put(bucket: string, path: string, body: Uint8Array | string, contentType: string) {
    this.objects.set(this.key(bucket, path), { body: typeof body === 'string' ? new TextEncoder().encode(body) : body, contentType });
  }
  async get(bucket: string, path: string) {
    return this.objects.get(this.key(bucket, path))?.body ?? null;
  }
  async remove(bucket: string, paths: string[]) {
    for (const p of paths) this.objects.delete(this.key(bucket, p));
  }
  async list(bucket: string, prefix: string) {
    const base = this.key(bucket, prefix.replace(/\/$/, '') + '/');
    return [...this.objects.keys()].filter((k) => k.startsWith(base)).map((k) => k.slice(bucket.length + 1));
  }
  async signedUrl(bucket: string, path: string, ttlSeconds: number) {
    return `memory://${bucket}/${path}?ttl=${ttlSeconds}`;
  }
}

export const BUCKETS = {
  evidence: 'gps-evidence',
  uploads: 'media-uploads',
  media: 'post-media',
  avatars: 'avatars',
  clubMedia: 'club-media',
  exports: 'exports'
} as const;

export const evidenceChunkPath = (userId: string, activityId: string, idx: number) => `${userId}/${activityId}/${String(idx).padStart(5, '0')}.txt`;
