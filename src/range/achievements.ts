import type {CosmeticDefinition, DrillMode, DuelXpResult, DuelXpSetup, ProgressionProfile} from './progression';

export type AchievementCategory = 'combat' | 'technique' | 'training' | 'collection' | 'career';
const modes: readonly DrillMode[] = ['guided', 'spray', 'transfer', 'peek', 'precision', 'burst'];
const counters = ['duelWins', 'duelKills', 'duelHeadshots', 'winsLevel5', 'winsLevel10', 'fiveBotWins',
  'flawlessWins', 'controlledRounds', 'accurateRounds', 'excellentWins', 'currentWinStreak', 'bestWinStreak',
  'cleanHeadRounds', 'efficientWins', 'comebackWins'] as const;
type Counter = typeof counters[number];
export type AchievementStats = Readonly<Record<Counter, number> & {drills: Readonly<Record<DrillMode, number>>}>;
export type AchievementState = Readonly<{stats: AchievementStats; unlocked: Readonly<Record<string, number>>}>;
type Metric = Counter | `drill:${DrillMode}` | 'allDrills' | 'completedDrills' | 'level' |
  'collection' | 'knives' | 'gloves' | 'agents';
export type AchievementDefinition = Readonly<{
  id: string; title: string; description: string; category: AchievementCategory; metric: Metric; target: number;
}>;
const badge = (id: string, title: string, description: string, category: AchievementCategory, metric: Metric, target = 1): AchievementDefinition =>
  Object.freeze({id, title, description, category, metric, target});
const drillNames: Readonly<Record<DrillMode, string>> = {
  guided: 'Guided spray', spray: 'Free spray', transfer: 'Spray transfer', peek: 'Peeking practice',
  precision: 'Counterstrafing practice', burst: 'Burst & reposition',
};
const tiers = (id: string, title: string, description: string, category: AchievementCategory, metric: Metric, targets: readonly number[]) =>
  targets.map(target => badge(`${id}-${target}`, `${title} / ${target.toLocaleString('en-US')}`,
    `${description.replace('{n}', target.toLocaleString('en-US'))}`, category, metric, target));
export const ACHIEVEMENTS: readonly AchievementDefinition[] = Object.freeze([
  badge('first-blood', 'First blood', 'Eliminate your first AI Duel opponent.', 'combat', 'duelKills'),
  badge('kills-100', 'Century of duels', 'Eliminate 100 AI Duel opponents.', 'combat', 'duelKills', 100),
  badge('kills-1000', 'Battle tested', 'Eliminate 1,000 AI Duel opponents.', 'combat', 'duelKills', 1000),
  badge('heads-100', 'Head hunter', 'Land 100 AI Duel headshots.', 'combat', 'duelHeadshots', 100),
  badge('heads-1000', 'Head specialist', 'Land 1,000 AI Duel headshots.', 'combat', 'duelHeadshots', 1000),
  badge('wins-1', 'First victory', 'Win your first AI Duel.', 'combat', 'duelWins'),
  badge('wins-10', 'Finding your rhythm', 'Win 10 AI Duels.', 'combat', 'duelWins', 10),
  badge('wins-100', 'Duel veteran', 'Win 100 AI Duels.', 'combat', 'duelWins', 100),
  badge('wins-1000', 'Duel legend', 'Win 1,000 AI Duels.', 'combat', 'duelWins', 1000),
  badge('level5-win', 'Rising challenge', 'Win against gun-equipped level 5+ bots: armored, at least 100 HP, accuracy at least 100%, player HP at most 100.', 'combat', 'winsLevel5'),
  badge('level10-win', 'Top-tier challenger', 'Win against gun-equipped level 10/10+ bots: armored, at least 100 HP, accuracy at least 100%, player HP at most 100.', 'combat', 'winsLevel10'),
  badge('level10-wins-100', 'Elite consistency', 'Win 100 of those level 10/10+ duels.', 'combat', 'winsLevel10', 100),
  badge('five-bot-win', 'One against five', 'Win against five gun-equipped, armored bots with at least 100 HP and 100% accuracy; player HP at most 100.', 'combat', 'fiveBotWins'),
  badge('flawless-win', 'Untouched', 'Win without taking health damage against gun-equipped, armored, 100+ HP bots with 100%+ accuracy; player HP at most 100.', 'combat', 'flawlessWins'),
  badge('streak-3', 'Three in a row', 'Win three consecutive qualifying AI Duels.', 'combat', 'bestWinStreak', 3),
  badge('streak-10', 'Unstoppable', 'Win ten consecutive qualifying AI Duels.', 'combat', 'bestWinStreak', 10),
  badge('controlled-fire', 'Feet first', 'Finish an AI Duel with 10+ shots, at least 90% settled shots and no airborne shots.', 'technique', 'controlledRounds'),
  badge('accurate-fire', 'Make them count', 'Finish an AI Duel with 10+ shots and at least 80% hit accuracy.', 'technique', 'accurateRounds'),
  badge('excellent-win', 'Complete package', 'Win an AI Duel with a feedback score of at least 90.', 'technique', 'excellentWins'),
  ...modes.flatMap(mode => [
    badge(`drill-${mode}-1`, `${drillNames[mode]} graduate`, `Complete a qualifying ${drillNames[mode].toLowerCase()} attempt.`, 'training', `drill:${mode}`),
    badge(`drill-${mode}-25`, `${drillNames[mode]} regular`, `Complete 25 qualifying ${drillNames[mode].toLowerCase()} attempts.`, 'training', `drill:${mode}`, 25),
  ]),
  badge('all-drills', 'Well rounded', 'Complete a qualifying attempt in each of the six drills.', 'training', 'allDrills', 6),
  badge('drills-1000', 'Practice pays', 'Complete 1,000 qualifying drill attempts.', 'training', 'completedDrills', 1000),
  badge('collection-1', 'Your first finish', 'Own your first non-default cosmetic.', 'collection', 'collection'),
  badge('collection-10', 'Curated collection', 'Own 10 non-default cosmetics.', 'collection', 'collection', 10),
  badge('collection-100', 'Collector', 'Own 100 non-default cosmetics.', 'collection', 'collection', 100),
  badge('knife-1', 'A sharper look', 'Own a non-default knife finish.', 'collection', 'knives'),
  badge('gloves-1', 'Fits like a glove', 'Own a non-default glove finish.', 'collection', 'gloves'),
  badge('agent-1', 'New opponent', 'Own a non-default bot agent.', 'collection', 'agents'),
  badge('career-10', 'Dedicated', 'Reach player level 10.', 'career', 'level', 10),
  badge('career-50', 'Seasoned', 'Reach player level 50.', 'career', 'level', 50),
  badge('career-100', 'Centurion', 'Reach player level 100.', 'career', 'level', 100),
  ...tiers('combat-kills', 'Frag ladder', 'Eliminate {n} AI Duel opponents.', 'combat', 'duelKills', [10,25,50,250,500,2500,5000,10000,25000]),
  ...tiers('combat-heads', 'Headshot discipline', 'Land {n} AI Duel headshots.', 'combat', 'duelHeadshots', [10,25,50,250,500,2500,5000,10000]),
  ...tiers('combat-wins', 'Duel circuit', 'Win {n} qualifying AI Duels.', 'combat', 'duelWins', [25,50,250,500,2500,5000]),
  ...tiers('challenge-five', 'Climbing the ranks', 'Win {n} fair duels against level 5+ gun-equipped, armored, 100+ HP bots at 100%+ accuracy; player HP at most 100.', 'combat', 'winsLevel5', [5,25,100,500]),
  ...tiers('challenge-ten', 'Elite circuit', 'Win {n} fair duels against level 10/10+ gun-equipped, armored, 100+ HP bots at 100%+ accuracy; player HP at most 100.', 'combat', 'winsLevel10', [5,10,25,50,250,500]),
  ...tiers('challenge-five-bots', 'Outnumbered', 'Win {n} fair five-bot duels: armed, armored, 100+ HP, 100%+ accuracy; player HP at most 100.', 'combat', 'fiveBotWins', [5,10,25,100]),
  ...tiers('challenge-flawless', 'Clean sheet', 'Win {n} fair duels without health damage: armed, armored, 100+ HP, 100%+ accuracy bots; player HP at most 100.', 'combat', 'flawlessWins', [5,25,100,500]),
  ...tiers('technique-settled', 'Stop before the shot', 'Finish {n} duels with 10+ shots, 90%+ settled shots and no airborne shots.', 'technique', 'controlledRounds', [10,50,250,1000]),
  ...tiers('technique-accuracy', 'Shots with purpose', 'Finish {n} duels with 10+ shots and at least 80% hit accuracy.', 'technique', 'accurateRounds', [10,50,250,1000]),
  ...tiers('technique-score', 'Complete player', 'Win {n} duels with a feedback score of at least 90.', 'technique', 'excellentWins', [10,50,250,1000]),
  ...tiers('combat-streak', 'On a heater', 'Win {n} consecutive qualifying AI Duels.', 'combat', 'bestWinStreak', [5,15,25]),
  ...modes.flatMap(mode => tiers(`practice-${mode}`, `${drillNames[mode]} mastery`,
    `Complete {n} qualifying ${drillNames[mode].toLowerCase()} attempts.`, 'training', `drill:${mode}`, [5,10,100,250,1000])),
  ...tiers('practice-total', 'Time in the server', 'Complete {n} qualifying drill attempts.', 'training', 'completedDrills', [10,50,100,250,500,2500,5000]),
  ...tiers('collect-finishes', 'Finish library', 'Own {n} non-default cosmetics.', 'collection', 'collection', [5,25,50,250,500]),
  ...tiers('collect-knives', 'Blade archive', 'Own {n} non-default knife finishes.', 'collection', 'knives', [5,10,25,50]),
  ...tiers('collect-gloves', 'Glove locker', 'Own {n} non-default glove finishes.', 'collection', 'gloves', [2,4,7]),
  ...tiers('collect-agents', 'Full roster', 'Own {n} non-default bot agents.', 'collection', 'agents', [2,3,5]),
  ...tiers('rank', 'Rank journey', 'Reach player level {n}.', 'career', 'level', [2,5,15,20,25,30,40,60,75,90]),
  ...tiers('technique-head-line', 'Keep it head level', 'Finish {n} duels with 10+ shots, 4+ headshots and at least 80% of hits to the head.', 'technique', 'cleanHeadRounds', [1,10,50,250]),
  ...tiers('technique-efficient', 'Economy of bullets', 'Win {n} fair multi-bot duels with no more than three shots per elimination; armed, armored, 100+ HP, 100%+ accuracy bots; player HP at most 100.', 'technique', 'efficientWins', [1,10,50,250]),
  ...tiers('combat-recovery', 'Stay in the round', 'Win {n} fair duels after losing at least 50 HP; armed, armored, 100+ HP, 100%+ accuracy bots; player HP at most 100.', 'combat', 'comebackWins', [1,10,50,250]),
]);

const MAX_COUNTER = 1_000_000_000_000;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNTER ? value : 0;
const increment = (value: number, amount = 1) => Math.min(MAX_COUNTER, value + amount);

export function sanitizeAchievements(raw: unknown): AchievementState {
  const value = record(raw), input = record(value.stats), drills = record(input.drills);
  const stats = Object.fromEntries(counters.map(key => [key, count(input[key])])) as Record<Counter, number>;
  stats.bestWinStreak = Math.min(stats.duelWins, stats.bestWinStreak);
  stats.currentWinStreak = Math.min(stats.bestWinStreak, stats.currentWinStreak);
  const unlocked: Record<string, number> = {};
  const saved = record(value.unlocked);
  for (const item of ACHIEVEMENTS) {
    const at = saved[item.id];
    if (typeof at === 'number' && Number.isSafeInteger(at) && at >= 0 && at <= 8_640_000_000_000_000) unlocked[item.id] = at;
  }
  return Object.freeze({stats: Object.freeze({...stats, drills: Object.freeze(Object.fromEntries(modes.map(mode => [mode, count(drills[mode])])) as Record<DrillMode, number>)}),
    unlocked: Object.freeze(unlocked)});
}

/** Called only after the progression controller validates and consumes the result token. */
export function recordDuelAchievements(state: AchievementState, setup: DuelXpSetup, result: DuelXpResult): AchievementState {
  const stats = {...state.stats}, review = result.review, won = result.outcome === 'won';
  const fairChallenge = setup.playerHealth <= 100 && setup.bots.every(bot => bot.health >= 100 && bot.armor && bot.accuracy >= 1 && bot.weapon !== 'knife');
  stats.duelKills = increment(stats.duelKills, review.kills);
  if (Number.isInteger(review.heads) && review.heads! >= 0 && review.heads! <= review.hits) stats.duelHeadshots = increment(stats.duelHeadshots, review.heads!);
  stats.currentWinStreak = won ? increment(stats.currentWinStreak) : 0;
  stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
  if (won) {
    stats.duelWins = increment(stats.duelWins);
    if (review.score !== null && review.score >= 90) stats.excellentWins = increment(stats.excellentWins);
    if (fairChallenge) {
      if (review.kills >= 2 && review.shots >= review.kills && review.shots <= review.kills * 3) stats.efficientWins = increment(stats.efficientWins);
      if (typeof review.taken === 'number' && review.taken >= 50 && review.taken < setup.playerHealth) stats.comebackWins = increment(stats.comebackWins);
      if (setup.bots.every(bot => bot.skill === '10+' || bot.skill >= 5)) stats.winsLevel5 = increment(stats.winsLevel5);
      if (setup.bots.every(bot => bot.skill === '10+' || bot.skill >= 10)) stats.winsLevel10 = increment(stats.winsLevel10);
      if (setup.bots.length === 5) stats.fiveBotWins = increment(stats.fiveBotWins);
      if (review.taken === 0) stats.flawlessWins = increment(stats.flawlessWins);
    }
  }
  if (review.shots >= 10) {
    if (typeof review.heads === 'number' && Number.isInteger(review.heads) && review.heads >= 4 && review.heads <= review.hits &&
      review.hits > 0 && review.heads / review.hits >= .8) stats.cleanHeadRounds = increment(stats.cleanHeadRounds);
    if (review.hits / review.shots >= .8) stats.accurateRounds = increment(stats.accurateRounds);
    if (typeof review.settled === 'number' && Number.isFinite(review.settled) && review.settled >= 90 && review.settled <= 100 &&
      review.airShots === 0 && Number.isInteger(review.movingShots) && review.movingShots! >= 0 && review.movingShots! <= review.shots * .1 &&
      Math.abs(review.settled - 100 * (review.shots - review.movingShots!) / review.shots) < .01) stats.controlledRounds = increment(stats.controlledRounds);
  }
  return sanitizeAchievements({...state, stats});
}

export function recordDrillAchievements(state: AchievementState, mode: DrillMode): AchievementState {
  return sanitizeAchievements({...state, stats: {...state.stats, drills: {...state.stats.drills, [mode]: increment(state.stats.drills[mode])}}});
}

export function achievementProgress(item: AchievementDefinition, profile: ProgressionProfile, catalog: readonly CosmeticDefinition[], level: number) {
  const {stats, unlocked} = profile.achievements;
  let current: number;
  if (item.metric.startsWith('drill:')) current = stats.drills[item.metric.slice(6) as DrillMode];
  else if (item.metric === 'allDrills') current = modes.filter(mode => stats.drills[mode] > 0).length;
  else if (item.metric === 'completedDrills') current = profile.completedDrills;
  else if (item.metric === 'level') current = level;
  else if (['collection', 'knives', 'gloves', 'agents'].includes(item.metric)) {
    const equipment = {knives: 'knife', gloves: 'gloves', agents: 'agent'}[item.metric as 'knives' | 'gloves' | 'agents'];
    const owned = new Set(profile.owned);
    current = catalog.filter(cosmetic => !cosmetic.isDefault && owned.has(cosmetic.id) && (item.metric === 'collection' || cosmetic.equipment === equipment)).length;
  } else current = stats[item.metric as Counter];
  const earned = Object.prototype.hasOwnProperty.call(unlocked, item.id);
  return {current: earned ? item.target : Math.min(current, item.target), target: item.target, fraction: earned ? 1 : Math.min(1, current / item.target),
    earned, earnedAt: earned ? unlocked[item.id] : null};
}

/** Load-time recognition uses timestamp zero for facts already present in an older save. */
export function unlockAchievements(profile: ProgressionProfile, catalog: readonly CosmeticDefinition[], level: number, at: number) {
  const ids = ACHIEVEMENTS.filter(item => {
    const progress = achievementProgress(item, profile, catalog, level);
    return !progress.earned && progress.current >= item.target;
  }).map(item => item.id);
  if (!ids.length) return {state: profile.achievements, ids: Object.freeze(ids)};
  return {state: sanitizeAchievements({...profile.achievements, unlocked: {...profile.achievements.unlocked, ...Object.fromEntries(ids.map(id => [id, at]))}}), ids: Object.freeze(ids)};
}
