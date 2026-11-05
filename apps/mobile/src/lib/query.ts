import { QueryClient, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected))));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2, refetchOnReconnect: true },
    mutations: { retry: 0 }
  }
});
