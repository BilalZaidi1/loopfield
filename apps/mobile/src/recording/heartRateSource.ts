import { Platform } from 'react-native';
import { getConnection } from '@/health/cache';

/**
 * Where a run's heart rate came from, for `run_saved` (R3): the paired strap when it gave readings, the health app
 * when heart rate is connected there, otherwise none. Only the source is sent, never a value. AirPods come with the
 * iPhone app.
 */
export function heartRateFrom(strapReadings: number): 'none' | 'health_app' | 'strap' {
  if (strapReadings > 0) return 'strap';
  try {
    const c = getConnection(Platform.OS === 'ios' ? 'healthkit' : 'health_connect');
    return c.connected && (c.enabledCards.includes('heart_rate') || c.enabledCards.includes('zones')) ? 'health_app' : 'none';
  } catch {
    return 'none';
  }
}
