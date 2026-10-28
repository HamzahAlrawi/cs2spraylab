import {prefireRoutes, prefireRouteAliases} from './routes';

export type PrefireConfig = {
  routeId: string;
  lineupId?: string;
  population: 'all' | 'random' | 'contextual';
  botsPerRun: number;
  botBehavior: 'angle-specific' | 'static';
  // Persisted alias for older Prefire settings.
  movingBots: boolean;
  returnFire: boolean;
  tradeEnabled: boolean;
  reactionMs: number;
  autoAdvance: boolean;
  routeGuide: boolean;
  navigationHints: boolean;
  reviewSeconds: number;
};

export const prefireDefaults: PrefireConfig = {
  routeId: 'long-doors',
  population: 'random',
  botsPerRun: 4,
  botBehavior: 'angle-specific',
  movingBots: true,
  returnFire: false,
  tradeEnabled: true,
  reactionMs: 1000,
  autoAdvance: true,
  routeGuide: true,
  navigationHints: true,
  reviewSeconds: 5,
};

const routeIds = prefireRoutes.map(route => route.id);
const storageKey = 'spraylab.prefire.v1';
const boolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

export function sanitizePrefireConfig(raw: unknown, availableRoutes: readonly string[] = routeIds): PrefireConfig {
  const input: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const botBehavior = input.botBehavior === 'static' || input.botBehavior === 'angle-specific'
    ? input.botBehavior : typeof input.movingBots === 'boolean'
      ? input.movingBots ? 'angle-specific' : 'static' : prefireDefaults.botBehavior;
  const oldId = typeof input.routeId === 'string' ? input.routeId : '';
  const routeId = availableRoutes.find(id => id === oldId) ?? availableRoutes.find(id => id === prefireRouteAliases[oldId])
    ?? availableRoutes[0] ?? prefireDefaults.routeId;
  const route = prefireRoutes.find(route => route.id === routeId);
  const wantedLineup = input.lineupId ?? (oldId !== routeId ? oldId : undefined);
  const lineupId = route?.lineups?.find(lineup => lineup.id === wantedLineup && lineup.id !== routeId)?.id;
  return {
    routeId,
    ...(lineupId ? {lineupId} : {}),
    population: input.population === 'random' || input.population === 'all' || input.population === 'contextual' ? input.population : prefireDefaults.population,
    botsPerRun: typeof input.botsPerRun === 'number' && Number.isFinite(input.botsPerRun)
      ? Math.max(1, Math.min(5, Math.round(input.botsPerRun))) : prefireDefaults.botsPerRun,
    botBehavior,
    movingBots: botBehavior === 'angle-specific',
    returnFire: boolean(input.returnFire, prefireDefaults.returnFire),
    tradeEnabled: boolean(input.tradeEnabled, prefireDefaults.tradeEnabled),
    reactionMs: typeof input.reactionMs === 'number' && Number.isFinite(input.reactionMs)
      ? Math.max(300, Math.min(2500, input.reactionMs)) : prefireDefaults.reactionMs,
    autoAdvance: boolean(input.autoAdvance, prefireDefaults.autoAdvance),
    routeGuide: boolean(input.routeGuide, prefireDefaults.routeGuide),
    navigationHints: boolean(input.navigationHints, prefireDefaults.navigationHints),
    reviewSeconds: typeof input.reviewSeconds === 'number' && Number.isFinite(input.reviewSeconds)
      ? Math.max(2, Math.min(10, input.reviewSeconds)) : prefireDefaults.reviewSeconds,
  };
}

export const prefirePresets = {
  learn: {population: 'all', botBehavior: 'static', movingBots: false, returnFire: false},
  entry: {population: 'random', botBehavior: 'angle-specific', movingBots: true, returnFire: false},
  pressure: {population: 'random', botBehavior: 'angle-specific', movingBots: true, returnFire: true, reactionMs: 750},
} as const satisfies Record<string, Partial<Omit<PrefireConfig, 'autoAdvance' | 'tradeEnabled' | 'routeGuide' | 'navigationHints'>>>;

export function prefirePreset(config: PrefireConfig): keyof typeof prefirePresets | 'custom' {
  for (const name of Object.keys(prefirePresets) as (keyof typeof prefirePresets)[]) {
    if (Object.entries(prefirePresets[name]).every(([key, value]) => config[key as keyof PrefireConfig] === value)) return name;
  }
  return 'custom';
}

export function loadPrefireConfig(): PrefireConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || '{}');
    const config = sanitizePrefireConfig(raw);
    // Older entry/pressure presets silently disabled navigation. Restore the default once;
    // new saves distinguish an explicit opt-out from that legacy preset side effect.
    if (raw?.routeGuidePreference !== 1 && raw?.routeGuide === false &&
      (prefirePreset(config) === 'entry' || prefirePreset(config) === 'pressure')) config.routeGuide = true;
    return config;
  }
  catch {return sanitizePrefireConfig(undefined);}
}

export function savePrefireConfig(config: PrefireConfig): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify({...sanitizePrefireConfig(config), routeGuidePreference: 1}));
    return true;
  } catch {return false;}
}
