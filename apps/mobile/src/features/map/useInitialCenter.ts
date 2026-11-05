import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { defaultMapCenter } from '@/config/env';

/** Last known position when location is already permitted; otherwise the configured default centre. */
export function useInitialCenter(): [number, number] | null | undefined {
  const [center, setCenter] = useState<[number, number] | null | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
        if (last) return setCenter([last.coords.longitude, last.coords.latitude]);
      }
      setCenter(defaultMapCenter());
    })();
  }, []);
  return center;
}
