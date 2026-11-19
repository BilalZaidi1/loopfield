import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SPEED_RULES, TERRITORY_RULES, withRuleOverrides } from '@loopfield/core';
import { rpc } from '@/lib/api';

interface GameRules {
  territory_version: string;
  territory: Record<string, number>;
  speed_version: string;
  speed: Record<string, number>;
}

/**
 * The running season's rules (`game_rules()`, set in the back office). Read again when a screen that uses
 * them opens and the copy is over a minute old, and when the app returns to the foreground, so a rule
 * applied to the running season reaches Help and the live hints quickly.
 */
function useGameRulesQuery() {
  return useQuery({ queryKey: ['game_rules'], staleTime: 60_000, retry: 1, queryFn: () => rpc<GameRules | null>('game_rules') });
}

/**
 * The running season's territory rules, merged over the built-in ones. The server always decides whether a
 * loop counts; these values drive the live hints, Help and explanations, so the app falls back to the
 * built-in rules when it is offline.
 */
export function useTerritoryRules(): typeof TERRITORY_RULES {
  const data = useGameRulesQuery().data;
  return useMemo(() => (data?.territory ? withRuleOverrides(TERRITORY_RULES, data.territory, data.territory_version) : TERRITORY_RULES), [data]);
}

/** The running season's speed-route rules, merged over the built-in ones (built-in when offline). */
export function useSpeedRules(): typeof SPEED_RULES {
  const data = useGameRulesQuery().data;
  return useMemo(() => (data?.speed ? withRuleOverrides(SPEED_RULES, data.speed, data.speed_version) : SPEED_RULES), [data]);
}

/** Rules for explaining a result judged under `version`: the season's when it matches, the built-in ones when those were used, otherwise none. */
export function rulesForVersion<T extends { readonly version: string }>(version: string | null | undefined, season: T, builtIn: T): T | null {
  if (!version) return null;
  if (version === season.version) return season;
  if (version === builtIn.version) return builtIn;
  return null;
}
