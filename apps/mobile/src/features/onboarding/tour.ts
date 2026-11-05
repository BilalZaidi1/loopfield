import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { router } from 'expo-router';

/** The first-run tour shows once per account on this device; Help can replay it. */
const key = (userId: string) => `loopfield.tour.v1.${userId}`;

export async function markTourSeen(userId: string | null): Promise<void> {
  if (userId) await AsyncStorage.setItem(key(userId), new Date().toISOString()).catch(() => {});
}

export function useFirstRunTour(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    AsyncStorage.getItem(key(userId))
      .then((seen) => {
        if (alive && !seen) router.push('/tour');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);
}
