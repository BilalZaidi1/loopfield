/** Kill switches shown on the overview, in the app's order. */
export const SWITCHES: { key: string; label: string }[] = [
  { key: 'territory_capture_enabled', label: 'Land capture' },
  { key: 'speed_titles_enabled', label: 'Speed titles' },
  { key: 'public_publication_enabled', label: 'Public results' },
  { key: 'photo_uploads_enabled', label: 'Photo uploads' },
  { key: 'messaging_enabled', label: 'Direct messages' },
  { key: 'reclaim_enabled', label: 'Reclaim' }
];

export interface Maintenance {
  enabled: boolean;
  message: string | null;
  until: string | null;
}

export function asMaintenance(v: unknown): Maintenance {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Maintenance>;
  return { enabled: o.enabled === true, message: typeof o.message === 'string' ? o.message : null, until: typeof o.until === 'string' ? o.until : null };
}
