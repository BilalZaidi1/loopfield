import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TERRITORY_RULES, withRuleOverrides } from '@loopfield/core';
import { rpc } from '@/lib/api';

interface GameRules {
  territory_version: string;
  territory: Record<string, number>;
  speed_version: string;
  speed: Record<string, number>;
}

/**
 * The running season's territory rules (set in the back office), merged over the built-in ones. The
 * server always decides whether a loop counts; these values only drive the live hints while recording,
 * so the app falls back to the built-in rules when it is offline.
 */
export function useTerritoryRules(): typeof TERRITORY_RULES {
  const q = useQuery({ queryKey: ['game_rules'], staleTime: 10 * 60_000, retry: 1, queryFn: () => rpc<GameRules | null>('game_rules') });
  const data = q.data;
  return useMemo(() => (data?.territory ? withRuleOverrides(TERRITORY_RULES, data.territory, data.territory_version) : TERRITORY_RULES), [data]);
}
