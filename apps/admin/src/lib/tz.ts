import 'server-only';
import { cookies } from 'next/headers';

/** The viewer's IANA time zone (set by TimeZoneSync), or null before the first visit. */
export async function viewerTimeZone(): Promise<string | null> {
  const raw = (await cookies()).get('tz')?.value;
  if (!raw) return null;
  const tz = decodeURIComponent(raw);
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}
