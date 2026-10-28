import type {CoachingSummary, SkillMetric} from './coaching-types';

export const HEARING_CONFIG_KEY = 'spraylab.hearing.config.v1';
export const HEARING_HISTORY_KEY = 'spraylab.hearing.history.v1';
export const HEARING_HISTORY_LIMIT = 100;
export const HEARING_RADIUS = 24;
export const HEARING_BOARD_RADIUS = 28;
export const hearingGuns = ['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553'] as const;
export const hearingGunNames = ['AK-47', 'M4A4', 'M4A1-S', 'Galil AR', 'FAMAS', 'SG 553'];
export type HearingConfig = {
  sounds: 'mix' | 'steps' | 'shots'; surface: 'concrete' | 'wood' | 'metal';
  gun: typeof hearingGuns[number]; panner: 'HRTF' | 'equalpower';
  falloff: 'native' | 'calibrated';
  task: 'direction-distance' | 'direction'; device: 'headphones' | 'stereo' | 'mono';
  gain: number; muffled: boolean;
};
export const hearingDefaults: HearingConfig = {
  sounds: 'mix', surface: 'concrete', gun: 'ak47', panner: 'HRTF',
  task: 'direction-distance', device: 'headphones', falloff: 'native', gain: .55, muffled: false,
};
export type HearingPoint = {x: number; z: number};
export type HearingTrial = {point: HearingPoint; event: string; steps: boolean; muffled: boolean};
export type HearingScoring = 'direction' | 'direction-distance' | 'distance';
export type HearingResult = {
  date: string; target: HearingPoint; guess: HearingPoint; scoring: HearingScoring;
  directionError: number; distanceError: number; score: number; replays: number;
  context?: {config: HearingConfig; heading: number; volume: number; event: string; muffled: boolean};
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function normalizeHearingConfig(value: unknown): HearingConfig {
  const input = record(value), result = {...hearingDefaults};
  const choices = {
    sounds: ['mix', 'steps', 'shots'], surface: ['concrete', 'wood', 'metal'], gun: hearingGuns,
    panner: ['HRTF', 'equalpower'], falloff: ['native', 'calibrated'], task: ['direction-distance', 'direction'], device: ['headphones', 'stereo', 'mono'],
  };
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    if ((choices[key] as readonly unknown[]).includes(input[key])) Object.assign(result, {[key]: input[key]});
  }
  if (typeof input.gain === 'number' && Number.isFinite(input.gain)) result.gain = Math.max(.1, Math.min(1, input.gain));
  if (typeof input.muffled === 'boolean') result.muffled = input.muffled;
  return result;
}
export function normalizeDegrees(angle: number) {return (angle % 360 + 360) % 360;}
export function hearingPoint(angle: number, distance: number): HearingPoint {
  const radians = normalizeDegrees(angle) * Math.PI / 180;
  return {x: Math.sin(radians) * distance, z: -Math.cos(radians) * distance};
}
export function hearingAngle(point: HearingPoint) {return normalizeDegrees(Math.atan2(point.x, -point.z) * 180 / Math.PI);}
export function angularError(a: number, b: number) {return Math.abs((normalizeDegrees(a - b) + 180) % 360 - 180);}
/** Positive is a clockwise/right correction; the antipodal case has no unique side. */
export function signedHearingError(target: number, guess: number) {return (normalizeDegrees(target - guess) + 180) % 360 - 180;}
export function hearingScoring(config: HearingConfig): HearingScoring {return config.device === 'mono' ? 'distance' : config.task;}
export function scoreHearing(target: HearingPoint, guess: HearingPoint, scoring: HearingScoring) {
  const directionError = angularError(hearingAngle(target), hearingAngle(guess));
  const distanceError = Math.abs(Math.hypot(target.x, target.z) - Math.hypot(guess.x, guess.z));
  const directionScore = Math.max(0, 1 - directionError / 90);
  const distanceScore = Math.max(0, 1 - distanceError / 12);
  const score = Math.round(100 * (scoring === 'distance' ? distanceScore : scoring === 'direction' ? directionScore : (directionScore + distanceScore) / 2));
  return {directionError, distanceError, score};
}
export function boardHearingPoint(x: number, y: number): HearingPoint {
  const point = {x: (x - .5) * HEARING_BOARD_RADIUS * 2, z: (y - .5) * HEARING_BOARD_RADIUS * 2};
  const distance = Math.hypot(point.x, point.z);
  return distance > HEARING_RADIUS ? {x: point.x * HEARING_RADIUS / distance, z: point.z * HEARING_RADIUS / distance} : point;
}
export function hearingBoardPosition(point: HearingPoint) {
  return {left: `${50 + point.x / HEARING_BOARD_RADIUS * 50}%`, top: `${50 + point.z / HEARING_BOARD_RADIUS * 50}%`};
}

/** One shuffled cycle covers every direction sector and distance band exactly once. */
export class HearingTrialDeck {
  private cells: number[] = [];
  constructor(private readonly random: () => number = Math.random) {}
  next(config: HearingConfig): HearingTrial {
    if (!this.cells.length) {
      this.cells = Array.from({length: 24}, (_, i) => i);
      for (let i = 23; i > 0; i--) {const j = Math.floor(this.random() * (i + 1)); [this.cells[i], this.cells[j]] = [this.cells[j], this.cells[i]];}
    }
    const cell = this.cells.pop()!, sector = cell % 8, band = Math.floor(cell / 8);
    const angle = normalizeDegrees(sector * 45 + (this.random() - .5) * 40);
    const distance = 4 + band * (20 / 3) + this.random() * (20 / 3);
    const steps = config.sounds === 'steps' || config.sounds === 'mix' && this.random() < .5;
    return {point: hearingPoint(angle, distance), steps, event: steps ? `step-${config.surface}` : config.gun,
      muffled: config.muffled && this.random() < .5};
  }
}

export function hearingSequence(steps: boolean) {return steps ? [0, 430, 860, 1290] : [0, 240];}
export class HearingPlayback {
  private generation = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(private readonly stop: () => void) {}
  begin() {this.cancel(); return this.generation;}
  current(token: number) {return token === this.generation;}
  schedule(token: number, delay: number, callback: () => void) {
    if (!this.current(token)) return;
    const timer = setTimeout(() => {this.timers.delete(timer); if (this.current(token)) callback();}, delay);
    this.timers.add(timer);
  }
  cancel() {this.generation++; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); this.stop();}
}

export function parseHearingHistory(value: unknown): HearingResult[] {
  if (!Array.isArray(value)) return [];
  const point = (v: unknown) => {
    const p = record(v);
    return typeof p.x === 'number' && typeof p.z === 'number' && Number.isFinite(p.x) && Number.isFinite(p.z)
      && Math.hypot(p.x, p.z) >= .25 && Math.hypot(p.x, p.z) <= HEARING_RADIUS + .001;
  };
  return value.slice(0, HEARING_HISTORY_LIMIT).flatMap(v => {
    const row = record(v);
    if (typeof row.date !== 'string' || row.date.length > 40 || !Number.isFinite(Date.parse(row.date))
      || !point(row.target) || !point(row.guess) || !['direction', 'direction-distance', 'distance'].includes(String(row.scoring))
      || typeof row.replays !== 'number' || !Number.isInteger(row.replays) || row.replays < 0 || row.replays > 10000) return [];
    const target = record(row.target) as HearingPoint, guess = record(row.guess) as HearingPoint;
    const scoring = row.scoring as HearingScoring;
    const candidate = parseHearingContext(row.context);
    const context = candidate && hearingScoring(candidate.config) === scoring ? candidate : undefined;
    return [{date: row.date, target: {x: target.x, z: target.z}, guess: {x: guess.x, z: guess.z}, scoring, replays: row.replays,
      ...(context ? {context} : {}),
      ...scoreHearing(target, guess, scoring)}];
  });
}

function parseHearingContext(value: unknown): HearingResult['context'] {
  const input = record(value), raw = record(input.config), config = normalizeHearingConfig(raw);
  if ((Object.keys(config) as (keyof HearingConfig)[]).some(key => raw[key] !== config[key])
    || typeof input.heading !== 'number' || !Number.isFinite(input.heading) || input.heading < 0 || input.heading >= 360
    || typeof input.volume !== 'number' || !Number.isFinite(input.volume) || input.volume <= 0 || input.volume > 1
    || typeof input.muffled !== 'boolean' || typeof input.event !== 'string'
    || ![...hearingGuns, 'step-concrete', 'step-wood', 'step-metal'].includes(input.event)) return undefined;
  const expectedEvent = input.event.startsWith('step-') ? `step-${config.surface}` : config.gun;
  if (input.event !== expectedEvent || config.sounds === 'steps' && !input.event.startsWith('step-')
    || config.sounds === 'shots' && input.event.startsWith('step-') || input.muffled && !config.muffled) return undefined;
  return {config, heading: input.heading, volume: input.volume, event: input.event, muffled: input.muffled};
}

function sameSetup(a: HearingConfig, b: HearingConfig) {
  return (Object.keys(hearingDefaults) as (keyof HearingConfig)[]).every(key => a[key] === b[key]);
}
function answerKey(row: HearingResult) {return `${row.date}|${row.target.x}|${row.target.z}|${row.guess.x}|${row.guess.z}`;}

/** Unknown old setups remain in history but cannot establish a comparable baseline. */
export function comparableHearingResults(config: HearingConfig, rows: readonly HearingResult[], volume: number, reference?: HearingResult) {
  const seen = new Set<string>();
  return rows.slice(0, HEARING_HISTORY_LIMIT).filter(row => {
    const c = row.context, ref = reference?.context, key = answerKey(row);
    if (!c || !sameSetup(config, c.config) || c.volume !== volume || row.scoring !== hearingScoring(config)
      || reference && (!ref || c.event !== ref.event || c.muffled !== ref.muffled || row.replays !== reference.replays)
      || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

const directionSectors = ['front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left'];
function hearingSector(row: HearingResult) {return Math.round(normalizeDegrees(hearingAngle(row.target) - (row.context?.heading ?? 0)) / 45) % 8;}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

function hearingHistoryMetrics(rows: HearingResult[], direction: boolean, distance: boolean): SkillMetric[] {
  const metrics: SkillMetric[] = [];
  if (direction && rows.length >= 12) {
    const sectors = directionSectors.map((label, index) => ({label, rows: rows.filter(row => hearingSector(row) === index)}))
      .filter(sector => sector.rows.length >= 3);
    if (sectors.length >= 2) {
      const worst = sectors.sort((a, b) => mean(b.rows.map(row => row.directionError)) - mean(a.rows.map(row => row.directionError)))[0];
      const error = mean(worst.rows.map(row => row.directionError)), best = mean(sectors[sectors.length - 1].rows.map(row => row.directionError));
      if (error >= 15 && error - best >= 5) metrics.push({label: 'Weakest sampled sector', value: worst.label, score: null,
        detail: `${error.toFixed(1)} degrees mean error over ${worst.rows.length} answers. Only ${sectors.length}/8 sectors have at least 3 answers; this is not a full directional ranking.`});
    }
  }
  if (rows.length < 24) return metrics;
  // Match difficulty strata before comparing blocks; changing sector/range mix must not look like improvement.
  const recent = rows.slice(0, 12), previous = rows.slice(12, 24);
  const trend = (label: string, group: (row: HearingResult) => number, error: (row: HearingResult) => number, minimum: number, unit: string) => {
    const groups = [...new Set(recent.map(group))].map(key => ({recent: recent.filter(row => group(row) === key), previous: previous.filter(row => group(row) === key)}))
      .filter(pair => pair.recent.length >= 2 && pair.previous.length >= 2);
    if (groups.length < minimum) return;
    const now = mean(groups.map(pair => mean(pair.recent.map(error)))), before = mean(groups.map(pair => mean(pair.previous.map(error))));
    const sample = groups.reduce((n, pair) => n + pair.recent.length + pair.previous.length, 0);
    metrics.push({label, value: `${before.toFixed(1)} -> ${now.toFixed(1)}${unit}`, score: null,
      detail: `${sample} answers across ${groups.length} matched ${label === 'Direction trend' ? 'direction sectors' : 'distance bands'}, equally weighted. Lower error is better; this is a practice observation, not proven mastery.`});
  };
  if (direction) trend('Direction trend', hearingSector, row => row.directionError, 3, ' degrees');
  if (distance) trend('Distance trend', row => Math.min(2, Math.floor((Math.hypot(row.target.x, row.target.z) - 4) / (20 / 3))), row => row.distanceError, 2, ' m');
  return metrics;
}

export function hearingCoaching(result: HearingResult, config: HearingConfig, history: readonly HearingResult[] = []): CoachingSummary {
  const scoring = hearingScoring(config), direction = scoring !== 'distance', distance = scoring !== 'direction';
  const measured = scoreHearing(result.target, result.guess, scoring);
  const signed = signedHearingError(hearingAngle(result.target), hearingAngle(result.guess));
  const offset = Math.hypot(result.guess.x, result.guess.z) - Math.hypot(result.target.x, result.target.z);
  const targetAngle = normalizeDegrees(hearingAngle(result.target) - (result.context?.heading ?? 0));
  const guessAngle = normalizeDegrees(hearingAngle(result.guess) - (result.context?.heading ?? 0));
  const frontBack = direction && result.context !== undefined
    && Math.cos(targetAngle * Math.PI / 180) * Math.cos(guessAngle * Math.PI / 180) < 0
    && Math.abs(Math.cos(targetAngle * Math.PI / 180)) > .35 && Math.abs(Math.cos(guessAngle * Math.PI / 180)) > .35
    && angularError(targetAngle, 180 - guessAngle) <= 30;
  const directionEvidence = Math.abs(signed) < .05 ? 'Bearing matched within 0.1 degrees.' : Math.abs(signed) >= 179.95
    ? 'The source was opposite your estimate: 180.0 degrees away.'
    : `The source was ${Math.abs(signed).toFixed(1)} degrees ${signed < 0 ? 'left' : 'right'} of your estimate.`;
  const distanceEvidence = Math.abs(offset) < .05 ? 'Range matched within 0.1 m in this drill.'
    : `You ${offset > 0 ? 'overshot' : 'undershot'} range by ${Math.abs(offset).toFixed(1)} m (${Math.hypot(result.guess.x, result.guess.z).toFixed(1)} m guessed; ${Math.hypot(result.target.x, result.target.z).toFixed(1)} m actual).`;
  const metrics: SkillMetric[] = [];
  if (direction) metrics.push({label: 'Direction error', value: `${measured.directionError.toFixed(1)} degrees`,
    score: Math.round(100 * Math.max(0, 1 - measured.directionError / 90)), detail: directionEvidence});
  if (distance) metrics.push({label: 'Distance error', value: `${measured.distanceError.toFixed(1)} m`,
    score: Math.round(100 * Math.max(0, 1 - measured.distanceError / 12)), detail: `${distanceEvidence} Loudness varies with sound type and muffling; metre accuracy here is not a guarantee of in-game range estimation.`});
  const compatible = result.context ? comparableHearingResults(config, history, result.context.volume, result) : [];
  const rows = [{...result, ...measured}, ...compatible.filter(row => answerKey(row) !== answerKey(result))].slice(0, HEARING_HISTORY_LIMIT);
  if (result.context) metrics.push(...hearingHistoryMetrics(rows, direction, distance));
  let focus: string, action: string, goal: string;
  const directionGoal = measured.directionError > 45 ? 45 : measured.directionError > 20 ? 20 : 10;
  const distanceGoal = measured.distanceError > 6 ? 5 : measured.distanceError > 2 ? 3 : 2;
  if (!direction) {
    focus = 'Estimate range, not direction';
    action = `Mono has no left/right cue. Compare the same ${result.context?.event.startsWith('step-') ? 'footstep surface' : 'sound'} with Near and Far at a fixed, comfortable volume. Choose a near/far band before an exact spot.`;
    goal = `Next sound: place the range estimate within ${distanceGoal} m in this drill; bearing is not judged.`;
  } else if (frontBack) {
    focus = 'Check front versus back';
    action = config.panner === 'equalpower'
      ? 'This panner can make front/back sound alike. Try HRTF with headphones, then turn the listener 90 degrees and replay the cue.'
      : 'Check front versus back before placing the sound cue. Turn the listener 90 degrees and replay; listen for how the left/right balance changes.';
    goal = `Next sound: identify the front/back half first, then aim for less than ${directionGoal} degrees bearing error.`;
  } else if (measured.directionError > 20 || !distance) {
    focus = measured.directionError > 20 ? 'Locate the sound cue' : 'Good directional read';
    action = config.device === 'stereo' ? 'Keep your listening position and speaker placement fixed. Check Left and Right, then call the side before narrowing down the sound cue.'
      : 'Read left/right first, then place the sound cue more precisely. If the sides sound reversed, check Left and Right calibration instead of guessing around it.';
    goal = `Next sound: keep bearing error within ${directionGoal} degrees${!distance ? '; distance does not affect this score' : ', without changing volume'}.`;
  } else if (measured.distanceError > 2) {
    focus = result.context?.muffled ? 'Separate muffling from distance' : 'Calibrate the range estimate';
    action = result.context?.muffled ? 'Quiet does not always mean far: cover can muffle the cue. Compare Near and Far with the same sound; do not translate quieter audio directly into metres.'
      : 'Compare Near and Far with the same sound at a fixed, comfortable volume. A footstep and a gunshot are not equally loud at the same range.';
    goal = `Next sound: retain bearing within 20 degrees and estimate range within ${distanceGoal} m in this drill.`;
  } else {
    focus = 'Good direction and range read';
    action = 'Keep that sound read. Repeat from other directions with the same setup before adding muffling or changing the sound; do not just drill your strongest side.';
    goal = 'Next sound: bearing within 10 degrees and range within 2 m in this drill; replays remain available.';
  }
  const confidence = `${rows.length} comparable ${result.replays > 0 ? 'replayed' : 'first-listen'} practice ${rows.length === 1 ? 'answer' : 'answers'}. ${rows.length < 5 ? 'One small sample cannot establish a habit.' : rows.length < 12 ? 'Early sample; keep practicing before drawing conclusions.' : 'Observed practice only, not a rank or mastery claim.'}`
    + `${result.context ? '' : ' This older answer has no setup metadata, so history comparisons are unavailable.'}`
    + `${result.replays ? ` ${result.replays} ${result.replays === 1 ? 'replay was' : 'replays were'} used; score is unchanged, and comparisons use the same replay count.` : ''}`
    + `${direction && config.panner === 'equalpower' ? ' Equal-power front/back ambiguity is not proof of poor listening.' : ''}`
    + ' External device volume cannot be checked here.';
  return {score: measured.score, focus, evidence: [direction ? directionEvidence : 'Mono: no directional judgment.', distance ? distanceEvidence : 'Direction-only: distance is not scored.', frontBack ? 'The estimate swapped the front/back half.' : ''].filter(Boolean).join(' '),
    action, goal, confidence, metrics,
    ...(direction && measured.directionError <= 20 ? {strength: `Bearing error was ${measured.directionError.toFixed(1)} degrees on this trial.`} : {})};
}
export function hearingStats(rows: HearingResult[]) {
  const directions = rows.filter(row => row.scoring !== 'distance'), distances = rows.filter(row => row.scoring !== 'direction');
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {count: rows.length, score: mean(rows.map(row => row.score)), direction: mean(directions.map(row => row.directionError)),
    distance: mean(distances.map(row => row.distanceError))};
}
export function readHearingStorage(key: string): unknown {
  try {return JSON.parse(localStorage.getItem(key) || 'null');} catch {return null;}
}
export function saveHearingStorage(key: string, value: unknown) {
  try {localStorage.setItem(key, JSON.stringify(value)); return true;} catch {return false;}
}
