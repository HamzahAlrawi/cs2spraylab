export type WeaponId = 'ak47' | 'm4a4' | 'm4a1s' | 'galil' | 'famas' | 'sg553' | 'mp9' | 'mp7' | 'mac10' | 'p90';

export type TrainingMode =
  | 'learn'
  | 'ghosthair'
  | 'trace'
  | 'fade-assist'
  | 'no-guide'
  | 'weak-section';

export type SprayLength = 5 | 10 | 15 | 'full';
export type TargetDistance = 'close' | 'mid' | 'long';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type RecoilPoint = {
  bullet: number;
  /** Horizontal mouse compensation in trainer pixels, relative to first shot. */
  x: number;
  /** Vertical mouse compensation in trainer pixels, relative to first shot. Positive means pull down. */
  y: number;
  /** Exact bullet fire timestamp from spray start. */
  timeMs: number;
};

export type WeaponInaccuracyProfile = {
  /** Extra wall-error in trainer pixels for a standing/idle automatic shot. */
  standPx: number;
  /** Multiplier applied to stand/move spread while crouched. */
  crouchMultiplier: number;
  /** Extra wall-error in trainer pixels when moving above the accurate-speed threshold. */
  movePx: number;
  /** Fraction of weapon move speed where shots start becoming clearly inaccurate. */
  accurateMoveSpeedRatio: number;
};

export type WeaponPattern = {
  id: WeaponId;
  name: string;
  magazineSize: number;
  difficulty: Difficulty;
  fireRateRpm: number;
  refireMs: number;
  movementSpeed: number;
  inaccuracy: WeaponInaccuracyProfile;
  sourceAccuracy: 'community-derived' | 'measured' | 'official';
  notes: string;
  /** Ideal mouse compensation path. This is what the player should perform. */
  pattern: RecoilPoint[];
  /** Uncompensated bullet impact path on a wall, useful for replay/visualization. */
  impactPattern: RecoilPoint[];
};

export type PointerSample = {
  t: number;
  x: number;
  y: number;
  /** True when WASD movement speed is high enough to damage weapon accuracy. */
  moving?: boolean;
  /** True while crouch is held. */
  crouching?: boolean;
  /** Player movement speed in normalized range units per second. */
  speed?: number;
  /** Extra deterministic wall spread applied by the trainer for movement/crouch accuracy state. */
  inaccuracyPx?: number;
  /** Crosshair error from the target head at spray start; kept constant during the burst. */
  startAimOffsetX?: number;
  startAimOffsetY?: number;
  /** Compensation-projected point on the target wall plane, used for the guide trail. */
  wallX?: number;
  wallY?: number;
  /** Raw center-crosshair hit point on the wall plane before subtracting the spray start offset. */
  rawWallX?: number;
  rawWallY?: number;
};

export type UserSettings = {
  cs2Sensitivity: number;
  dpi: number;
  cm360: number;
  resolution: string;
  aspectRatio: string;
  crosshair: 'dot' | 'classic' | 'small';
  calibrationScale: number;
};

export type BulletError = {
  bullet: number;
  ideal: RecoilPoint;
  user: PointerSample;
  dx: number;
  dy: number;
  distance: number;
  /** Estimated timestamp where the player got closest to this bullet's ideal position. Negative means early. */
  timingMs: number;
  timingScore: number;
  /** Movement/stance spread penalty applied to this bullet, in wall pixels. */
  movementPenalty: number;
  moving: boolean;
  crouching: boolean;
  /** Where this bullet would land on the wall after the user's compensation. */
  impact: { x: number; y: number };
  hitZone: HitZone;
  comment: string;
};

export type WeakSegment = {
  from: number;
  to: number;
  averageError: number;
};

export type AttemptScores = {
  overall: number;
  pathAccuracy: number;
  temporalAccuracy: number;
  verticalControl: number;
  horizontalTiming: number;
  smoothness: number;
  overcorrection: number;
  undercorrection: number;
  first5: number;
  first10: number;
  consistency: number;
};

export type AttemptResult = {
  id: string;
  createdAt: string;
  weaponId: WeaponId;
  weaponName: string;
  mode: TrainingMode;
  sprayLength: SprayLength;
  distance: TargetDistance;
  scores: AttemptScores;
  weakSegment: WeakSegment;
  bulletErrors: BulletError[];
  userSamples: PointerSample[];
  idealPattern: RecoilPoint[];
  feedback: string[];
};

export type HitZone = 'head' | 'chest' | 'stomach' | 'legs' | 'miss';
