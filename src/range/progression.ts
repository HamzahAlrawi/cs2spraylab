import type {DuelReview} from './duel/coaching';
import type {SkillLevel} from './duel/config';
import {recordDrillAchievements, recordDuelAchievements, sanitizeAchievements, unlockAchievements, type AchievementState} from './achievements';

export const PROGRESSION_KEY = 'spraylab.progression.v1';
export const PROGRESSION_VERSION = 2;
export const MAX_LEVEL = 100;
export const MAX_XP = 100_000_000;
export const MAX_CREDITS = 100_000_000;
export const MAX_CREDIT_COUNTER = 1_000_000_000_000;
export const MAX_COMPLETIONS = 1_000_000_000;
export const STANDARD_KNIFE_ID = 'knife-standard';
export const BUTTERFLY_EMERALD_ID = 'knife-butterfly-emerald';
export const BUTTERFLY_EMERALD_LEVEL = 20;
export type CosmeticCategory = 'weapon' | 'knife' | 'gloves' | 'agent';
export const CREDIT_RATES = Object.freeze({duel: .6, drill: .35});
export const MAX_CREDITS_PER_ACTIVE_SECOND = 6;
export const PROGRESSION_MILESTONES = Object.freeze([
  ...Array.from({length: 10}, (_, index) => {
    const target = (index + 1) * 10;
    return Object.freeze({id: `level-${target}`, kind: 'level' as const, target, credits: target * 150, label: `Level ${target}`});
  }),
  ...[[25, 250], [100, 1000], [500, 4000], [1000, 7500], [2500, 12500], [5000, 20000], [10000, 35000]].map(([target, credits]) =>
    Object.freeze({id: `rounds-${target}`, kind: 'attempts' as const, target, credits, label: `${target.toLocaleString('en-US')} qualifying attempts`})),
]);

/** Main supplies native asset metadata. IDs refer to local cosmetics, never inventory items. */
export type CosmeticDefinition = Readonly<{
  id: string;
  equipment: string;
  label: string;
  unlockLevel: number;
  isDefault?: boolean;
  swatch?: string;
  imageUrl?: string;
  assetKey?: string;
  category?: CosmeticCategory;
  /** Omitted only for legacy catalogs; prepareCosmeticCatalog supplies a nonzero price. */
  price?: number;
  rarity?: string;
  /** Only finishes that existed in the v1 catalog can migrate as implicit unlocks. */
  legacyUnlockLevel?: number;
}>;
export type ProgressionProfile = Readonly<{
  version: 2;
  xp: number;
  balance: number;
  owned: readonly string[];
  creditsEarned: number;
  creditsSpent: number;
  completedDuels: number;
  completedDrills: number;
  milestones: readonly string[];
  equipped: Readonly<Record<string, string>>;
  achievements: AchievementState;
}>;
export type ProgressionStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type StorageStatus = 'saved' | 'memory-only' | 'unsupported-version';
export type XpNotice = Readonly<{
  id: string; xp: number; source: 'duel' | DrillMode | 'collection';
  levelBefore: number; levelAfter: number; unlockedIds: readonly string[];
  credits: number; milestoneCredits: number; milestoneIds: readonly string[];
  achievementIds: readonly string[];
}>;
export type ProgressionSnapshot = Readonly<{
  profile: ProgressionProfile;
  storageStatus: StorageStatus;
  notification: XpNotice | null;
}>;
export type XpBot = Readonly<{
  id: string;
  skill: SkillLevel;
  health: number;
  armor: boolean;
  accuracy: number;
  weapon: string;
}>;
export type DuelXpSetup = Readonly<{
  playerHealth: number;
  playerArmor: boolean;
  bots: readonly XpBot[];
}>;
export type Completion = 'completed' | 'reset' | 'abandoned' | 'settings-changed';
export type DuelXpResult = Readonly<{
  completion: Completion;
  outcome: 'won' | 'lost' | 'draw';
  /** Simulated fighting time only; pausing and round review do not count. */
  activeSeconds: number;
  review: Pick<DuelReview, 'score' | 'shots' | 'hits' | 'kills' | 'damage'> & Partial<Pick<DuelReview, 'heads' | 'taken' | 'settled' | 'movingShots' | 'airShots'>>;
  /** Sum player-to-bot healthDamage events, already capped to remaining health. */
  opponents: readonly {id: string; healthDamage: number; killed: boolean}[];
}>;
export type DrillMode = 'guided' | 'spray' | 'transfer' | 'peek' | 'precision' | 'burst';
export type DrillXpResult = Readonly<{
  completion: Completion;
  objectiveCompleted: boolean;
  score: number;
  shots: number;
  hits: number;
  activeSeconds: number;
  /** Actual stop/reposition successes, not movement-key presses. */
  movementReps: number;
  targetsHit: number;
}>;
export type XpEvaluation = Readonly<{
  xp: number;
  reason: 'earned' | 'not-completed' | 'invalid-result' | 'no-engagement' | 'below-reward-threshold';
}>;
export type AwardResult = Readonly<{
  awarded: boolean;
  xp: number;
  credits: number;
  reason: XpEvaluation['reason'] | 'unknown-attempt' | 'settings-changed';
}>;
export type PurchaseResult = Readonly<
  {success: true; reason: 'purchased' | 'already-owned'; cosmeticId: string; spent: number} |
  {success: false; reason: 'unknown-cosmetic' | 'level-locked' | 'insufficient-credits' | 'counter-limit' | 'disposed'; cosmeticId: string; spent: 0}
>;

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number): value is number => finite(value, min, max) && Number.isInteger(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const noXp = (reason: XpEvaluation['reason']): XpEvaluation => ({xp: 0, reason});
const earned = (value: number): XpEvaluation => {
  const xp = Math.floor(value + 1e-9);
  return xp > 0 ? {xp, reason: 'earned'} : noXp('below-reward-threshold');
};

export function xpForLevel(level: number): number {
  const n = clamp(Number.isFinite(level) ? Math.floor(level) : 1, 1, MAX_LEVEL) - 1;
  return 150 * n + 35 * n * n;
}

export function levelProgress(xp: number) {
  const total = clamp(Number.isFinite(xp) ? Math.floor(xp) : 0, 0, MAX_XP);
  let level = 1;
  while (level < MAX_LEVEL && total >= xpForLevel(level + 1)) level++;
  const start = xpForLevel(level), end = level === MAX_LEVEL ? start : xpForLevel(level + 1);
  return {level, total, current: level === MAX_LEVEL ? 0 : total - start,
    needed: end - start, remaining: Math.max(0, end - total), fraction: level === MAX_LEVEL ? 1 : (total - start) / (end - start)};
}

export function cosmeticCategory(item: CosmeticDefinition): CosmeticCategory {
  return item.category ?? (item.equipment === 'knife' || item.equipment === 'gloves' || item.equipment === 'agent' ? item.equipment : 'weapon');
}

export function cosmeticPrice(item: CosmeticDefinition): number {
  if (item.isDefault) return 0;
  if (integer(item.price, 1, MAX_CREDITS)) return item.price;
  const category = cosmeticCategory(item);
  return category === 'knife' ? 20_000 + 1000 * item.unlockLevel : category === 'gloves' ? 15_000 + 700 * item.unlockLevel :
    category === 'agent' ? 1500 + 100 * item.unlockLevel : 400 + 60 * item.unlockLevel;
}

export function ownsCosmetic(profile: ProgressionProfile, item: CosmeticDefinition): boolean {
  return item.isDefault === true || profile.owned.includes(item.id);
}

export function cosmeticsForEquipment(profile: ProgressionProfile, catalog: readonly CosmeticDefinition[], equipment: string, ownership: 'owned' | 'unowned' = 'owned') {
  return catalog.filter(item => item.equipment === equipment && ownsCosmetic(profile, item) === (ownership === 'owned'));
}

/** Credits inherit the existing validated XP difficulty/engagement weights, not wall-clock time. */
export function creditsForXp(xp: number, source: 'duel' | DrillMode): number {
  return integer(xp, 1, MAX_XP) ? Math.floor(xp * (source === 'duel' ? CREDIT_RATES.duel : CREDIT_RATES.drill)) : 0;
}

export function prepareCosmeticCatalog(definitions: readonly CosmeticDefinition[] = []): readonly CosmeticDefinition[] {
  const stock: CosmeticDefinition = {id: STANDARD_KNIFE_ID, equipment: 'knife', category: 'knife', price: 0, label: 'Standard knife', unlockLevel: 1, isDefault: true};
  const catalog = new Map<string, CosmeticDefinition>([[stock.id, stock]]);
  for (const raw of definitions.slice(0, 2000)) {
    const item = record(raw);
    if (!identifier(item.id) || !identifier(item.equipment) || typeof item.label !== 'string' || !item.label.trim() ||
      !integer(item.unlockLevel, 1, MAX_LEVEL) || catalog.has(item.id) && item.id !== STANDARD_KNIFE_ID) continue;
    if (item.id === STANDARD_KNIFE_ID && item.equipment !== 'knife') continue;
    const unlockLevel = item.id === STANDARD_KNIFE_ID ? 1 : item.id === BUTTERFLY_EMERALD_ID ? Math.max(BUTTERFLY_EMERALD_LEVEL, item.unlockLevel) : item.unlockLevel;
    const category = cosmeticCategory({equipment: item.equipment} as CosmeticDefinition);
    if (item.category !== undefined && item.category !== category) continue;
    const isDefault = item.id === STANDARD_KNIFE_ID || item.equipment !== 'knife' && item.isDefault === true && unlockLevel === 1;
    if (!isDefault && item.price !== undefined && !integer(item.price, 1, MAX_CREDITS)) continue;
    const price = cosmeticPrice({equipment: item.equipment, unlockLevel, isDefault, price: item.price as number | undefined} as CosmeticDefinition);
    catalog.set(item.id, Object.freeze({
      id: item.id, equipment: item.equipment, label: item.id === STANDARD_KNIFE_ID ? stock.label : item.label.trim().slice(0, 120), unlockLevel,
      isDefault, category, price,
      ...(typeof item.rarity === 'string' && /^[a-zA-Z][a-zA-Z0-9 -]{0,31}$/.test(item.rarity) ? {rarity: item.rarity} : {}),
      ...(integer(item.legacyUnlockLevel, 1, MAX_LEVEL) ? {legacyUnlockLevel:item.legacyUnlockLevel} : {}),
      ...(typeof item.swatch === 'string' && /^#[a-f0-9]{6}$/i.test(item.swatch) ? {swatch: item.swatch} : {}),
      ...(typeof item.imageUrl === 'string' && /^\/(?!\/)[^\\\s<>]{1,500}$/.test(item.imageUrl) ? {imageUrl: item.imageUrl} : {}),
      ...(typeof item.assetKey === 'string' && item.assetKey.length <= 256 ? {assetKey: item.assetKey} : {}),
    }));
  }
  return Object.freeze([...catalog.values()].map(item => Object.freeze(item)));
}

export function sanitizeProgression(raw: unknown, catalog: readonly CosmeticDefinition[] = prepareCosmeticCatalog()): ProgressionProfile {
  const value = record(raw);
  const legacy = value.version === 1, current = value.version === PROGRESSION_VERSION;
  const xp = legacy && finite(value.xp, 0, MAX_XP) ? Math.floor(value.xp) : current && integer(value.xp, 0, MAX_XP) ? value.xp : 0;
  const level = levelProgress(xp).level;
  const owned = new Set<string>(catalog.filter(item => item.isDefault || legacy && item.legacyUnlockLevel !== undefined && item.legacyUnlockLevel <= level).map(item => item.id));
  if (current && Array.isArray(value.owned)) for (const id of value.owned.slice(0, 10_000)) if (identifier(id)) owned.add(id);
  const milestones = new Set<string>();
  if (current && Array.isArray(value.milestones)) for (const id of value.milestones.slice(0, 10_000)) if (identifier(id)) milestones.add(id);
  // Existing levels were earned before milestone credits existed. Do not grant them retroactively.
  if (legacy) for (const milestone of PROGRESSION_MILESTONES) if (milestone.kind === 'level' && milestone.target <= level) milestones.add(milestone.id);
  const equipped: Record<string, string> = {knife: STANDARD_KNIFE_ID};
  if (legacy || current) for (const [equipment, id] of Object.entries(record(value.equipped))) {
    if (!identifier(equipment) || !identifier(id)) continue;
    const item = catalog.find(candidate => candidate.id === id);
    if (item && item.equipment !== equipment) continue;
    // Preserve legacy equipment even when a new catalog raises its level, and retain retired IDs.
    if (legacy) owned.add(id);
    if (owned.has(id)) equipped[equipment] = id;
  }
  const credits = current && integer(value.balance, 0, MAX_CREDITS) ? value.balance : 0;
  const spent = current && integer(value.creditsSpent, 0, MAX_CREDIT_COUNTER) ? Math.min(value.creditsSpent, MAX_CREDIT_COUNTER - credits) : 0;
  const earned = spent + credits;
  return Object.freeze({version: PROGRESSION_VERSION, xp, balance: credits, owned: Object.freeze([...owned]), creditsEarned: earned, creditsSpent: spent,
    completedDuels: current && integer(value.completedDuels, 0, MAX_COMPLETIONS) ? value.completedDuels : 0,
    completedDrills: current && integer(value.completedDrills, 0, MAX_COMPLETIONS) ? value.completedDrills : 0,
    milestones: Object.freeze([...milestones]), equipped: Object.freeze(equipped), achievements: sanitizeAchievements(current ? value.achievements : undefined)});
}

export function equippedCosmetic(profile: ProgressionProfile, catalog: readonly CosmeticDefinition[], equipment: string): CosmeticDefinition | undefined {
  return catalog.find(item => item.equipment === equipment && item.id === profile.equipped[equipment] && ownsCosmetic(profile, item)) ??
    catalog.find(item => item.equipment === equipment && item.isDefault && item.unlockLevel === 1);
}

function validSetup(setup: DuelXpSetup): boolean {
  return !!setup && finite(setup.playerHealth, 1, 500) && typeof setup.playerArmor === 'boolean' &&
    Array.isArray(setup.bots) && setup.bots.length >= 1 && setup.bots.length <= 5 &&
    new Set(setup.bots.map(bot => bot?.id)).size === setup.bots.length && setup.bots.every(bot => bot && identifier(bot.id) &&
      (bot.skill === '10+' || integer(bot.skill, 1, 10)) && finite(bot.health, 1, 500) && typeof bot.armor === 'boolean' &&
      finite(bot.accuracy, .5, 1.5) && identifier(bot.weapon));
}

function setupKey(setup: DuelXpSetup): string {
  return JSON.stringify([setup.playerHealth, setup.playerArmor, [...setup.bots].sort((a, b) => a.id.localeCompare(b.id)).map(bot =>
    [bot.id, bot.skill, bot.health, bot.armor, bot.accuracy, bot.weapon])]);
}

/** Pure, deterministic reward calculation. Only the controller can settle a live attempt. */
export function evaluateDuelXp(setup: DuelXpSetup, result: DuelXpResult): XpEvaluation {
  if (!result || result.completion !== 'completed') return noXp('not-completed');
  if (!validSetup(setup) || !['won', 'lost', 'draw'].includes(result.outcome) || !finite(result.activeSeconds,0,3600)) return noXp('invalid-result');
  const review = result.review;
  if (!review || !integer(review.shots, 0, 100_000) || !integer(review.hits, 0, review.shots) || !integer(review.kills, 0, setup.bots.length) ||
    !finite(review.damage, 0, 2500) || review.score !== null && !finite(review.score, 0, 100) ||
    !Array.isArray(result.opponents) || result.opponents.length !== setup.bots.length ||
    new Set(result.opponents.map(bot => bot?.id)).size !== setup.bots.length) return noXp('invalid-result');
  let totalDamage = 0, kills = 0, rosterThreat = 0, engagedThreat = 0;
  for (const bot of setup.bots) {
    const dealt = result.opponents.find(item => item?.id === bot.id);
    if (!dealt || !finite(dealt.healthDamage, 0, bot.health + .001) || typeof dealt.killed !== 'boolean' ||
      dealt.killed !== (dealt.healthDamage >= bot.health - .001)) return noXp('invalid-result');
    totalDamage += dealt.healthDamage;
    kills += +dealt.killed;
    // Keep level 5 neutral while making actual bot skill carry more reward weight.
    const difficulty = bot.skill === '10+' ? 2 : .4 + (bot.skill - 1) * .15;
    const threat = difficulty * Math.min(1, bot.health / 100) * (bot.armor ? 1 : .8) * Math.min(1.15, bot.accuracy);
    rosterThreat += threat;
    engagedThreat += threat * Math.min(1, dealt.healthDamage / bot.health);
  }
  if (Math.abs(totalDamage - review.damage) > .01 || kills !== review.kills ||
    (result.outcome === 'won' ? kills !== setup.bots.length : kills === setup.bots.length)) return noXp('invalid-result');
  if (totalDamage <= 0) return noXp('no-engagement');
  // Count effective opposition, not nominal bot count. Untouched or one-HP bots cannot pad rewards.
  const opposition = engagedThreat / Math.pow(Math.max(1, rosterThreat), .38);
  const playerHandicap = Math.min(1, 100 / setup.playerHealth);
  const outcome = result.outcome === 'won' ? 1.2 : result.outcome === 'lost' ? .65 : .75;
  return earned((55 + 95 * (review.score ?? 0) / 100) * opposition * outcome * playerHandicap);
}

const drillModes: readonly DrillMode[] = ['guided', 'spray', 'transfer', 'peek', 'precision', 'burst'];
export function evaluateDrillXp(mode: DrillMode, result: DrillXpResult): XpEvaluation {
  if (!result || result.completion !== 'completed' || !result.objectiveCompleted) return noXp('not-completed');
  if (!drillModes.includes(mode) || !finite(result.score, 0, 100) || !integer(result.shots, 1, 100_000) ||
    !integer(result.hits, 0, result.shots) || !finite(result.activeSeconds, 0, 3600) ||
    !integer(result.movementReps, 0, 10_000) || !integer(result.targetsHit, 0, result.hits)) return noXp('invalid-result');
  const minimumSeconds = mode === 'precision' || mode === 'burst' ? .25 : 2;
  if (!result.hits || result.activeSeconds < minimumSeconds || !result.targetsHit) return noXp('no-engagement');
  if ((mode === 'guided' || mode === 'spray' || mode === 'burst') && result.shots < 6 ||
    mode === 'transfer' && result.targetsHit < 2 || (mode === 'precision' || mode === 'burst' || mode === 'peek') && !result.movementReps) return noXp('not-completed');
  const base = mode === 'guided' || mode === 'spray' ? 5 : 7;
  return earned(base + 9 * result.score / 100);
}

type ActiveAttempt = {id: string; revision: string; kind: 'duel'; setup: DuelXpSetup} |
  {id: string; revision: string; kind: 'drill'; mode: DrillMode};
export type ProgressionController = {
  readonly catalog: readonly CosmeticDefinition[];
  getSnapshot(): ProgressionSnapshot;
  subscribe(listener: () => void): () => void;
  /** One active attempt. Starting another abandons the previous one. Store this ID on the round. */
  beginDuel(setup: DuelXpSetup, settingsRevision: string): string | null;
  beginDrill(mode: DrillMode, settingsRevision: string): string | null;
  completeDuel(roundId: string, result: DuelXpResult, finalSetup: DuelXpSetup, settingsRevision: string): AwardResult;
  completeDrill(attemptId: string, result: DrillXpResult, settingsRevision: string): AwardResult;
  cancelAttempt(attemptId?: string): void;
  equip(equipment: string, cosmeticId: string): boolean;
  resetEquipment(equipment: string): boolean;
  /** Buying never auto-equips. Repeating a successful purchase cannot charge twice. */
  canPurchase(cosmeticId: string): boolean;
  purchase(cosmeticId: string): PurchaseResult;
  dismissNotification(): void;
  dispose(): void;
};

export function createProgressionController(options: {
  catalog?: readonly CosmeticDefinition[];
  /** null forces session-only storage; omitted uses localStorage when accessible. */
  storage?: ProgressionStorage | null;
  storageKey?: string;
} = {}): ProgressionController {
  const catalog = prepareCosmeticCatalog(options.catalog);
  const key = options.storageKey ?? PROGRESSION_KEY;
  let storage = options.storage ?? null;
  if (options.storage === undefined) try {storage = typeof localStorage === 'undefined' ? null : localStorage;} catch {storage = null;}
  let raw: unknown, storageStatus: StorageStatus = storage ? 'saved' : 'memory-only';
  let savedText: string | null | undefined;
  try {savedText = storage?.getItem(key);} catch {storageStatus = 'memory-only'; storage = null;}
  try {raw = savedText ? JSON.parse(savedText) : undefined;} catch {storageStatus = 'memory-only';}
  if (record(raw).version !== undefined && record(raw).version !== 1 && record(raw).version !== PROGRESSION_VERSION) storageStatus = 'unsupported-version';
  let snapshot: ProgressionSnapshot = Object.freeze({profile: sanitizeProgression(raw, catalog), storageStatus, notification: null});
  const recognized = unlockAchievements(snapshot.profile, catalog, levelProgress(snapshot.profile.xp).level, 0);
  if (recognized.ids.length) snapshot = Object.freeze({...snapshot, profile: sanitizeProgression({...snapshot.profile, achievements: recognized.state}, catalog)});
  if ((record(raw).version === 1 || recognized.ids.length) && storage && storageStatus !== 'unsupported-version') {
    try {storage.setItem(key, JSON.stringify(snapshot.profile));} catch {storageStatus = 'memory-only';}
    snapshot = Object.freeze({...snapshot, storageStatus});
  }
  const listeners = new Set<() => void>();
  let active: ActiveAttempt | null = null, disposed = false, serial = 0;
  const session = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const publish = (profile: ProgressionProfile, notification = snapshot.notification) => {
    if (snapshot.storageStatus !== 'unsupported-version') {
      try {if (storage) {storage.setItem(key, JSON.stringify(profile)); storageStatus = 'saved';} else storageStatus = 'memory-only';}
      catch {storageStatus = 'memory-only';}
    }
    snapshot = Object.freeze({profile, storageStatus, notification});
    for (const listener of listeners) listener();
  };
  // Fast consecutive rounds must not erase an achievement before its toast has been read.
  const pendingAchievements = (ids: readonly string[]) => Object.freeze([...new Set([...(snapshot.notification?.achievementIds ?? []), ...ids])]);
  const settle = (attempt: ActiveAttempt, evaluation: XpEvaluation, activeSeconds: number, achievements: AchievementState): AwardResult => {
    if (!evaluation.xp) return {awarded: false, xp: 0, credits: 0, reason: evaluation.reason};
    const previous = snapshot.profile;
    const xp = Math.min(evaluation.xp, MAX_XP - previous.xp);
    const completedDuels = Math.min(MAX_COMPLETIONS, previous.completedDuels + +(attempt.kind === 'duel'));
    const completedDrills = Math.min(MAX_COMPLETIONS, previous.completedDrills + +(attempt.kind === 'drill'));
    const levelBefore = levelProgress(previous.xp).level, levelAfter = levelProgress(previous.xp + xp).level;
    const milestones = PROGRESSION_MILESTONES.filter(item => !previous.milestones.includes(item.id) &&
      (item.kind === 'level' ? levelAfter >= item.target : completedDuels + completedDrills >= item.target));
    const source = attempt.kind === 'duel' ? 'duel' : attempt.mode;
    const headroom = Math.min(MAX_CREDITS - previous.balance, MAX_CREDIT_COUNTER - previous.creditsEarned);
    // Use the evaluated reward, not stored XP headroom, so credits continue at the XP cap.
    const baseCredits = Math.min(headroom, creditsForXp(evaluation.xp, source), Math.floor(activeSeconds*MAX_CREDITS_PER_ACTIVE_SECOND));
    const milestoneCredits = Math.min(headroom - baseCredits, milestones.reduce((sum, item) => sum + item.credits, 0));
    const credits = baseCredits + milestoneCredits;
    const updated = sanitizeProgression({...previous, xp: previous.xp + xp, balance: previous.balance + credits,
      creditsEarned: previous.creditsEarned + credits, completedDuels, completedDrills,
      milestones: [...previous.milestones, ...milestones.map(item => item.id)], achievements}, catalog);
    const unlocked = unlockAchievements(updated, catalog, levelAfter, Date.now());
    const profile = unlocked.ids.length ? sanitizeProgression({...updated, achievements: unlocked.state}, catalog) : updated;
    const awarded = xp > 0 || credits > 0;
    publish(profile, awarded || unlocked.ids.length ? Object.freeze({id: attempt.id, xp, credits, milestoneCredits, milestoneIds: Object.freeze(milestones.map(item => item.id)), source,
      levelBefore, levelAfter, achievementIds: pendingAchievements(unlocked.ids), unlockedIds: Object.freeze(catalog.filter(item => !ownsCosmetic(profile, item) && item.unlockLevel > levelBefore && item.unlockLevel <= levelAfter).map(item => item.id))}) : snapshot.notification);
    return {awarded, xp, credits, reason: awarded ? 'earned' : 'below-reward-threshold'};
  };
  const takeAttempt = (id: string, kind: ActiveAttempt['kind']) => {
    if (disposed || !active || active.id !== id || active.kind !== kind) return null;
    const attempt = active;
    active = null;
    return attempt;
  };
  const denied = (reason: AwardResult['reason']): AwardResult => ({awarded: false, xp: 0, credits: 0, reason});
  const validRevision = (revision: string) => typeof revision === 'string' && revision.length > 0 && revision.length <= 512;
  return {
    catalog,
    getSnapshot: () => snapshot,
    subscribe(listener) {if (disposed) return () => {}; listeners.add(listener); return () => {listeners.delete(listener);};},
    beginDuel(setup, revision) {
      active = null;
      if (disposed || !validSetup(setup) || !validRevision(revision)) return null;
      active = {id: `${session}:${++serial}`, kind: 'duel', revision,
        setup: {playerHealth: setup.playerHealth, playerArmor: setup.playerArmor, bots: setup.bots.map(bot => ({...bot}))}};
      return active.id;
    },
    beginDrill(mode, revision) {
      active = null;
      if (disposed || !drillModes.includes(mode) || !validRevision(revision)) return null;
      active = {id: `${session}:${++serial}`, kind: 'drill', revision, mode};
      return active.id;
    },
    completeDuel(id, result, finalSetup, revision) {
      const attempt = takeAttempt(id, 'duel');
      if (attempt?.kind !== 'duel') return denied('unknown-attempt');
      if (attempt.revision !== revision || !validSetup(finalSetup) || setupKey(attempt.setup) !== setupKey(finalSetup)) return denied('settings-changed');
      const evaluation = evaluateDuelXp(attempt.setup, result);
      return settle(attempt, evaluation, result?.activeSeconds, evaluation.xp ? recordDuelAchievements(snapshot.profile.achievements, attempt.setup, result) : snapshot.profile.achievements);
    },
    completeDrill(id, result, revision) {
      const attempt = takeAttempt(id, 'drill');
      if (attempt?.kind !== 'drill') return denied('unknown-attempt');
      if (attempt.revision !== revision) return denied('settings-changed');
      const evaluation = evaluateDrillXp(attempt.mode, result);
      return settle(attempt, evaluation, result?.activeSeconds, evaluation.xp ? recordDrillAchievements(snapshot.profile.achievements, attempt.mode) : snapshot.profile.achievements);
    },
    cancelAttempt(id) {if (id === undefined || active?.id === id) active = null;},
    equip(equipment, id) {
      if (disposed || !identifier(equipment)) return false;
      const item = catalog.find(candidate => candidate.equipment === equipment && candidate.id === id);
      if (!item || !ownsCosmetic(snapshot.profile, item)) return false;
      if (snapshot.profile.equipped[equipment] === id) return true;
      publish(sanitizeProgression({...snapshot.profile, equipped: {...snapshot.profile.equipped, [equipment]: id}}, catalog));
      return true;
    },
    resetEquipment(equipment) {
      if (disposed || !identifier(equipment)) return false;
      const equipped = {...snapshot.profile.equipped};
      delete equipped[equipment];
      publish(sanitizeProgression({...snapshot.profile, equipped}, catalog));
      return true;
    },
    canPurchase(id) {
      const item = catalog.find(candidate => candidate.id === id), profile = snapshot.profile;
      return !disposed && !!item && !ownsCosmetic(profile, item) && item.unlockLevel <= levelProgress(profile.xp).level &&
        cosmeticPrice(item) <= profile.balance && cosmeticPrice(item) <= MAX_CREDIT_COUNTER - profile.creditsSpent;
    },
    purchase(id) {
      const fail = (reason: Extract<PurchaseResult, {success: false}>['reason']): PurchaseResult => ({success: false, reason, cosmeticId: id, spent: 0});
      if (disposed) return fail('disposed');
      const item = catalog.find(candidate => candidate.id === id);
      if (!item) return fail('unknown-cosmetic');
      const previous = snapshot.profile;
      if (ownsCosmetic(previous, item)) return {success: true, reason: 'already-owned', cosmeticId: id, spent: 0};
      if (item.unlockLevel > levelProgress(previous.xp).level) return fail('level-locked');
      const price = cosmeticPrice(item);
      if (price > previous.balance) return fail('insufficient-credits');
      if (price > MAX_CREDIT_COUNTER - previous.creditsSpent) return fail('counter-limit');
      const updated = sanitizeProgression({...previous, balance: previous.balance - price, creditsSpent: previous.creditsSpent + price, owned: [...previous.owned, id]}, catalog);
      const level = levelProgress(updated.xp).level, unlocked = unlockAchievements(updated, catalog, level, Date.now());
      const profile = unlocked.ids.length ? sanitizeProgression({...updated, achievements: unlocked.state}, catalog) : updated;
      publish(profile, unlocked.ids.length ? Object.freeze({id: `${session}:purchase:${++serial}`, xp: 0, credits: 0, source: 'collection',
        levelBefore: level, levelAfter: level, unlockedIds: Object.freeze([]), milestoneCredits: 0, milestoneIds: Object.freeze([]), achievementIds: pendingAchievements(unlocked.ids)}) : snapshot.notification);
      return {success: true, reason: 'purchased', cosmeticId: id, spent: price};
    },
    dismissNotification() {
      if (!snapshot.notification) return;
      snapshot = Object.freeze({...snapshot, notification: null});
      for (const listener of listeners) listener();
    },
    dispose() {disposed = true; active = null; listeners.clear();},
  };
}
