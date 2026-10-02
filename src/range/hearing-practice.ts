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
    return [{date: row.date, target: {x: target.x, z: target.z}, guess: {x: guess.x, z: guess.z}, scoring, replays: row.replays,
      ...scoreHearing(target, guess, scoring)}];
  });
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
