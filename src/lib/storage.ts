import { AttemptResult, PointerSample, UserSettings } from '../types';

const attemptsKey = 'spraylab.attempts.v1';
const settingsKey = 'spraylab.settings.v1';

export const defaultSettings: UserSettings = {
  cs2Sensitivity: 0.5,
  dpi: 800,
  cm360: 30.56,
  resolution: '1920x1080',
  aspectRatio: '16:9',
  crosshair: 'classic',
  calibrationScale: 1
};

function isAttemptLike(value: unknown): value is AttemptResult {
  const item = value as Partial<AttemptResult> | undefined;
  return Boolean(item && typeof item.id === 'string' && item.scores && Array.isArray(item.bulletErrors));
}

export function decimateSamples(samples: PointerSample[], maxSamples = 160): PointerSample[] {
  if (samples.length <= maxSamples) return samples;
  const stride = Math.ceil(samples.length / maxSamples);
  const result = samples.filter((_, index) => index % stride === 0);
  const last = samples[samples.length - 1];
  if (last && result[result.length - 1] !== last) result.push(last);
  return result;
}

export function compactAttemptForStorage(attempt: AttemptResult): AttemptResult {
  return {
    ...attempt,
    userSamples: decimateSamples(attempt.userSamples, 160),
    bulletErrors: attempt.bulletErrors.map((error) => ({
      ...error,
      user: {
        t: error.user.t,
        x: error.user.x,
        y: error.user.y,
        moving: error.user.moving,
        crouching: error.user.crouching,
        speed: error.user.speed,
        inaccuracyPx: error.user.inaccuracyPx,
        startAimOffsetX: error.user.startAimOffsetX,
        startAimOffsetY: error.user.startAimOffsetY
      }
    }))
  };
}

export function loadAttempts(): AttemptResult[] {
  try {
    const raw = localStorage.getItem(attemptsKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isAttemptLike) : [];
  } catch {
    return [];
  }
}

export function saveAttempts(attempts: AttemptResult[]): void {
  const compacted = attempts.slice(0, 80).map(compactAttemptForStorage);
  try {
    localStorage.setItem(attemptsKey, JSON.stringify(compacted));
  } catch (error) {
    // localStorage quota errors should never take down the app right after a magazine ends.
    // Fall back to fewer attempts and less replay detail.
    try {
      const minimal = compacted.slice(0, 20).map((attempt) => ({
        ...attempt,
        userSamples: decimateSamples(attempt.userSamples, 48)
      }));
      localStorage.setItem(attemptsKey, JSON.stringify(minimal));
    } catch {
      console.warn('Could not save spray attempts locally. Continuing without persistence.', error);
    }
  }
}

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return defaultSettings;
    const saved = JSON.parse(raw) as Partial<UserSettings>;
    // Previous builds auto-saved the old default of 1.7. Treat that exact value
    // as the old default so existing local installs move to the new 0.5 default,
    // while preserving any custom sensitivity the user set manually.
    if (saved.cs2Sensitivity === 1.7) saved.cs2Sensitivity = defaultSettings.cs2Sensitivity;
    return { ...defaultSettings, ...saved };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // Settings persistence is optional; never crash the trainer because a browser blocks storage.
  }
}

export function resetLocalProgress(): void {
  try {
    localStorage.removeItem(attemptsKey);
  } catch {
    // Ignore storage errors.
  }
}
