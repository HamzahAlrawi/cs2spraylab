import data from './game-data.json';
import { nativeRecoilPattern } from './recoil';

export type Weapon = keyof typeof data.weapons;
export type Mode = 'duel' | 'guided' | 'spray' | 'transfer' | 'peek' | 'precision' | 'burst' | 'hearing';
export const modeNames: Record<Mode, string> = { duel: 'AI Duel', guided: 'Guided spray', spray: 'Free spray', transfer: 'Spray transfer', peek: 'Peeking practice', precision: 'Counterstrafing practice', burst: 'Burst & reposition', hearing: 'Hearing practice' };
export const historyModeNames = { ...modeNames, tracking: 'Target tracking (retired)' };
export function migrateMode(mode: unknown): Mode {
  if(typeof mode==='string'&&['weak','ghost','trace','fade','tracking'].includes(mode))return 'guided';
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(modeNames, mode) ? mode as Mode : 'duel';
}
export type Crosshair = { color: string; size: number; gap: number; thickness: number; outline: number; alpha: number; dot: boolean; t: boolean; dynamic: boolean };
export type Settings = {
  weapon: Weapon; sidearm: Pistol; primaryEnabled: boolean; mode: Mode; sensitivity: number; dpi: number; invertY: boolean;
  moving: boolean; targetSpeed: 'rifle' | 'smg' | 'knife';
  follow: boolean; volume: number; spread: boolean; burst: number; quality: 'auto' | 'low' | 'high' | 'performance';
  frameLimit: number; showFps: boolean; animatedGuides: boolean; protectShortcuts: boolean;
  showImpactPattern: boolean; showMousePath: boolean;
  peekScenario: 'mixed' | 'common' | 'deep' | 'off-angle' | 'elevated';
  peekDuration: number;
  impactSize: number;
  transferAfter: number;
  transferRule: 'bullet' | 'kill';
  drillPace: 'practice' | 'challenge';
  aspect: 'native' | '16:9' | '16:10' | '4:3' | '5:4';
  crosshair: Crosshair;
};
export const weaponNames: Record<Weapon, string> = { ak47: 'AK-47', m4a4: 'M4A4', m4a1s: 'M4A1-S', galil: 'Galil AR', famas: 'FAMAS', sg553: 'SG 553', aug: 'AUG', mp9: 'MP9', mp7: 'MP7', mp5sd: 'MP5-SD', mac10: 'MAC-10', ump45: 'UMP-45', p90: 'P90', bizon: 'PP-Bizon', m249: 'M249', negev: 'Negev', cz75a: 'CZ75-Auto',
  usp: 'USP-S', glock: 'Glock-18', hkp2000: 'P2000', p250: 'P250', deagle: 'Desert Eagle', elite: 'Dual Berettas',
  fiveseven: 'Five-SeveN', tec9: 'Tec-9', revolver: 'R8 Revolver', awp: 'AWP', ssg08: 'SSG 08', g3sg1: 'G3SG1', scar20: 'SCAR-20' };
export const pistolIds = ['usp', 'glock', 'hkp2000', 'p250', 'deagle', 'elite', 'fiveseven', 'tec9', 'cz75a', 'revolver'] as const;
export type Pistol = typeof pistolIds[number];
export const sniperIds: Weapon[] = ['awp', 'ssg08', 'g3sg1', 'scar20'];
export const weaponIds = Object.keys(weaponNames) as Weapon[];
export const gameData = data;
export const loadoutWeapon = (settings: Pick<Settings, 'weapon' | 'sidearm' | 'primaryEnabled'>): Weapon => settings.primaryEnabled ? settings.weapon : settings.sidearm;
export const defaults: Settings = {
  weapon: 'ak47', sidearm: 'usp', primaryEnabled: true, mode: 'duel', sensitivity: 1, dpi: 800, invertY: false,
  moving: false, targetSpeed: 'rifle', follow: false, volume: 0.2,
  spread: true, burst: 0, quality: 'auto', impactSize: 1.5,
  frameLimit: 0, showFps: false, animatedGuides: true, protectShortcuts: true,
  transferAfter: 15, transferRule: 'bullet',
  showImpactPattern: true, showMousePath: true,
  peekScenario: 'mixed', peekDuration: 1, drillPace: 'practice',
  aspect: 'native',
  crosshair: { color: '#ffeb55', size: 3, gap: 2, thickness: 2, outline: 1, alpha: 1, dot: false, t: false, dynamic: false }
};
export const presets: Record<string, Crosshair> = {
  Compact: defaults.crosshair,
  Classic: { ...defaults.crosshair, color: '#50ff76', size: 5, gap: 3, thickness: 1.5 },
  Dot: { ...defaults.crosshair, color: '#ffef68', size: 0, dot: true, thickness: 3, gap: 0 },
  'T-style': { ...defaults.crosshair, color: '#ffffff', t: true, size: 6, gap: 3 }
};
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const numeric = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
export function sanitizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const c = s.crosshair && typeof s.crosshair === 'object' ? s.crosshair : defaults.crosshair;
  return {
    weapon: weaponIds.includes(s.weapon!) ? s.weapon! : defaults.weapon,
    sidearm: pistolIds.includes(s.sidearm!) ? s.sidearm! : 'usp',
    primaryEnabled: s.primaryEnabled !== false,
    mode: migrateMode(s.mode),
    sensitivity: numeric(s.sensitivity, 1, .05, 10), dpi: numeric(s.dpi, 800, 100, 32000),
    invertY: s.invertY === true,
    moving: s.moving === true, targetSpeed: ['rifle', 'smg', 'knife'].includes(s.targetSpeed!) ? s.targetSpeed! : 'rifle',
    follow: s.follow === true, volume: numeric(s.volume, .2, 0, 1), spread: typeof s.spread === 'boolean' ? s.spread : s.mode !== 'guided',
    impactSize: numeric(s.impactSize,1.5,.5,4),
    transferAfter: Math.round(numeric(s.transferAfter,15,1,149)), transferRule: s.transferRule === 'kill' ? 'kill' : 'bullet',
    showImpactPattern: s.showImpactPattern !== false, showMousePath: s.showMousePath !== false,
    peekScenario: ['mixed','common','deep','off-angle','elevated'].includes(s.peekScenario!) ? s.peekScenario! : 'mixed',
    peekDuration: numeric(s.peekDuration,1,.5,10),
    drillPace: s.drillPace === 'challenge' ? 'challenge' : 'practice',
    burst: [0, 5, 10, 15].includes(s.burst!) ? s.burst! : 0,
    quality: ['auto', 'low', 'high', 'performance'].includes(s.quality!) ? s.quality! : 'auto',
    frameLimit: [0,30,60,120,144,240].includes(s.frameLimit!) ? s.frameLimit! : s.quality === 'performance' ? 60 : 0,
    showFps: s.showFps === true, animatedGuides: s.animatedGuides !== false, protectShortcuts: s.protectShortcuts !== false,
    aspect: ['native', '16:9', '16:10', '4:3', '5:4'].includes(s.aspect!) ? s.aspect! : 'native',
    crosshair: {
      color: /^#[\da-f]{6}$/i.test(c.color) ? c.color : defaults.crosshair.color,
      size: numeric(c.size, 3, 0, 20), gap: numeric(c.gap, 2, -4, 20), thickness: numeric(c.thickness, defaults.crosshair.thickness, .5, 5),
      outline: numeric(c.outline, 1, 0, 3), alpha: numeric(c.alpha, 1, .1, 1),
      dot: c.dot === true, t: c.t === true, dynamic: c.dynamic === true
    }
  };
}
export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem('spraylab.range.v2');
    if (saved) return sanitizeSettings(JSON.parse(saved));
    const old = JSON.parse(localStorage.getItem('spraylab.settings.v1') || '{}');
    return migrateLegacySettings(old);
  } catch { return sanitizeSettings({}); }
}
export function migrateLegacySettings(old: Record<string, unknown> | null): Settings {
  const s = old || {};
  const c = s.crosshair && typeof s.crosshair === 'object' ? s.crosshair as Record<string, unknown> : {};
  const dot = s.crosshair === 'dot' || c.style === 'dot';
  return sanitizeSettings({ ...s, sensitivity: s.cs2Sensitivity, invertY: s.invertMouse ?? s.invertMouseY,
    follow: s.followRecoil, aspect: s.aspectRatio,
    crosshair: { ...c, ...(dot ? { size: 0, dot: true } : {}), outline: c.outline === true ? c.outlineThickness ?? 1 : c.outline === false ? 0 : c.outline }
  });
}
export function saveSettings(settings: Settings): boolean {
  try { localStorage.setItem('spraylab.range.v2', JSON.stringify(settings)); return true; } catch { return false; }
}

export type Angle = { yaw: number; pitch: number };
export type MeasuredProfile = { weapon: Weapon; source: string; build: string; points: Angle[] };
export function recoilPattern(weapon: Weapon, measured?: MeasuredProfile): Angle[] {
  if (measured?.weapon === weapon) return measured.points;
  return nativeRecoilPattern(data.weapons[weapon]);
}
export function parseProfile(text: string): MeasuredProfile {
  const p = JSON.parse(text);
  if (!weaponIds.includes(p.weapon) || typeof p.source !== 'string' || !p.source.trim() || typeof p.build !== 'string' || !p.build.trim()) throw new Error('A weapon, capture source and game build are required.');
  if (!Array.isArray(p.points) || p.points.length !== data.weapons[p.weapon as Weapon].magazine) throw new Error('Include one angular point per magazine round.');
  if (!p.points.every((v: Angle) => v && Number.isFinite(v.yaw) && Number.isFinite(v.pitch) && Math.abs(v.yaw) <= 45 && Math.abs(v.pitch) <= 45)) throw new Error('Yaw and pitch must be finite degrees between -45 and 45.');
  if (Math.abs(p.points[0].yaw) > .001 || Math.abs(p.points[0].pitch) > .001) throw new Error('Normalize the first shot to zero.');
  return { weapon: p.weapon, source: p.source.slice(0, 500), build: p.build.slice(0, 100), points: p.points.map((v: Angle) => ({ yaw: v.yaw, pitch: v.pitch })) };
}
