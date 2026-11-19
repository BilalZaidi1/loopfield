import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { useSession } from '@/state/session';

/**
 * Support conversations with a reply the runner has not opened yet (`support_unread_count()`). Read again
 * whenever the screen showing it comes into focus, and after any push (see `useBackgroundServices`).
 */
export function useSupportUnread(): number {
  const { userId } = useSession();
  const q = useQuery({ queryKey: ['support_unread', userId], enabled: Boolean(userId), staleTime: 30_000, queryFn: () => rpc<number>('support_unread_count') });
  const refetch = q.refetch;
  useFocusEffect(
    useCallback(() => {
      if (userId) void refetch();
    }, [userId, refetch])
  );
  return typeof q.data === 'number' && q.data > 0 ? q.data : 0;
}
