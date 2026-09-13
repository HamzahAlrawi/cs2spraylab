import { describe, expect, it, vi } from 'vitest';
import { defaults, gameData, migrateLegacySettings, migrateMode, parseProfile, recoilPattern, sanitizeSettings, weaponIds } from './config';
import { DEG, direction, groundVelocity, mouseAngle, Simulation, STEP, targetSpeed, UNIT, VERTICAL_FOV, TARGET_Z, SPAWN_Z, JUMP_SPEED, GRAVITY } from './simulation';
import { requestRawLock } from './input';

const make = (extra = {}) => new Simulation({ ...defaults, ...extra, crosshair: { ...defaults.crosshair } });
const run = (s: Simulation, seconds: number, fps = 60) => { for (let i = 0; i < Math.round(seconds * fps); i++) s.advance(1 / fps); };

describe('Source scale and input', () => {
  it('uses 0.022 degrees per raw count without multiplying by DPI or resolution', () => {
    expect(mouseAngle(1000, .5) / DEG).toBeCloseTo(11, 10);
    expect(mouseAngle(1000, 1) / mouseAngle(1000, .5)).toBe(2);
    expect(VERTICAL_FOV).toBeCloseTo(73.739795, 5);
    expect(64 * UNIT).toBeCloseTo(1.6256);
  });
  it('inverts pitch only and clamps at 89 degrees', () => {
    const s = make(), inverted = make({ invertY: true });
    s.aim(200, 200); inverted.aim(200, 200);
    expect(s.yaw).toBe(inverted.yaw); expect(s.pitch).toBe(-inverted.pitch);
    s.aim(0, 1e8); expect(s.pitch).toBe(-89 * DEG);
  });
  it('produces normalized rays at any aim angle', () => {
    const d = direction(.7, .8); expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
  });
  it('does not normalize a zero direction into NaN', () => {
    expect(groundVelocity(0, 0, 0, 0, 5, STEP)).toEqual({ x: 0, z: 0 });
  });
  it('matches the installed AK maximum speed, including diagonals', () => {
    for (const side of [0, 1]) {
      const s = make(); s.active = true; s.input.forward = 1; s.input.side = side; run(s, 1);
      expect(Math.hypot(s.velocity.x, s.velocity.z) / UNIT).toBeCloseTo(215, 5);
    }
  });
  it('walk is slower, crouch changes eye height, and friction stops movement', () => {
    const s = make(); s.active = true; s.input.forward = 1; s.input.walk = true; run(s, 1);
    expect(Math.hypot(s.velocity.x, s.velocity.z) / UNIT).toBeCloseTo(215 * .52, 5);
    s.input.forward = 0; s.input.crouch = true; run(s, 1);
    expect(Math.hypot(s.velocity.x, s.velocity.z)).toBe(0);
    expect(s.position.y).toBeCloseTo(46 * UNIT, 4);
  });
  it('has identical movement at 30, 60 and 144 FPS', () => {
    const positions = [30, 60, 144].map(fps => { const s = make(); s.active = true; s.input.side = 1; run(s, 1, fps); return s.position.x; });
    expect(positions[0]).toBeCloseTo(positions[1], 9); expect(positions[1]).toBeCloseTo(positions[2], 9);
  });
  it('applies weapon, MP9 and knife speed profiles', () => {
    expect(targetSpeed({ ...defaults, targetSpeed: 'knife' }) / UNIT).toBe(250);
    expect(targetSpeed({ ...defaults, targetSpeed: 'smg' }) / UNIT).toBe(240);
    expect(targetSpeed(defaults) / UNIT).toBeCloseTo(215, 9);
  });
  it('reverses a moving target and remains bounded', () => {
    const s = make({ moving: true }); s.active = true;
    run(s, 10); expect(Math.abs(s.targetX)).toBeLessThan(4);
    expect(s.targetVelocity).not.toBe(0);
  });
});
describe('Shot scheduling and independent drills', () => {
  it.each([0, 5, 10, 15])('transfer switches at the selected burst midpoint (%s rounds)', burst => {
    const s = make({ mode: 'transfer', burst }), lanes: number[] = [];
    s.onShot = shot => lanes.push(s.targetForShot(shot.index)); s.start(true); run(s, 5);
    const count = burst || gameData.weapons.ak47.magazine;
    expect(lanes).toEqual(Array.from({ length: count }, (_, i) => i >= Math.floor(count / 2) ? 1 : 0));
  });
  it.each(weaponIds)('%s fires precisely its installed magazine at its installed cadence', id => {
    const s = make({ weapon: id }), times: number[] = [];
    s.onShot = shot => times.push(shot.at); s.start(true); run(s, gameData.weapons[id].cycle * gameData.weapons[id].magazine + 1);
    expect(times.length).toBe(gameData.weapons[id].magazine);
    times.forEach((t, i) => expect(Math.abs(t - i * gameData.weapons[id].cycle)).toBeLessThanOrEqual(STEP + 1e-9));
    expect(s.latest?.shots).toBe(times.length);
  });
  it('scores only fired bullets after a short release', () => {
    const s = make(); s.start(); run(s, .25, 100); s.release('mouse');
    expect(s.latest?.shots).toBe(3); run(s, 1); expect(s.shots).toBe(3);
  });
  it('allows a new independent practice attempt immediately without a fake reload delay', () => {
    const s = make(); s.start(); run(s, 1); s.release('mouse');
    run(s, .4, 100); expect(s.start()).toBe(true); expect(s.shots).toBe(1);
    expect(Math.abs(s.recoil.yaw)).toBe(0); expect(s.recoil.pitch).toBe(0);
  });
  it('finishes a touch burst despite touch and compatibility mouse release', () => {
    const s = make({ burst: 5 }); s.start(true); s.release('touch'); s.release('mouse'); run(s, 1);
    expect(s.latest?.shots).toBe(5); expect(s.firing).toBe(false);
  });
  it('cancels firing, motion and input on interruption', () => {
    const s = make(); s.start(true); s.input.side = 1; s.cancel(); run(s, 5);
    expect(s.shots).toBe(1); expect(s.active).toBe(false); expect(s.velocity.x).toBe(0); expect(s.input.side).toBe(0);
  });
  it('migrates retired tracking to an ordinary guided shooting attempt', () => {
    const s = new Simulation(sanitizeSettings({mode: 'tracking', burst: 5}));
    s.start(true); run(s, 1);
    expect(s.latest?.mode).toBe('guided'); expect(s.latest?.shots).toBe(5); expect(s.latest?.tracking).toBe(0);
  });
  it('only emits one result even when release and blur arrive together', () => {
    const s = make(), result = vi.fn(); s.onResult = result; s.start(); s.release('mouse'); s.cancel();
    expect(result).toHaveBeenCalledTimes(1);
  });
  it('rapid click/release cannot bypass the native shot interval', () => {
    const s = make(), times: number[] = []; s.onShot = shot => times.push(shot.at);
    s.start(); s.release('mouse'); expect(s.start()).toBe(true);
    expect(s.shots).toBe(0); run(s, .2, 100);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(gameData.weapons.ak47.cycle);
  });
  it('consolidates retired training modes into guided spray', () => {
    for (const mode of ['weak', 'ghost', 'trace', 'fade', 'tracking', '__proto__', 'toString']) expect(migrateMode(mode)).toBe('guided');
    expect(migrateMode('transfer')).toBe('transfer');
  });
  it('the same angular shot grows linearly with distance, including 100m', () => {
    const p = recoilPattern('ak47')[15]; const dir = direction(-p.yaw * DEG, p.pitch * DEG);
    const at = (d: number) => ({ x: dir.x * -d / dir.z, y: dir.y * -d / dir.z });
    expect(at(100).y / at(10).y).toBeCloseTo(10); expect(at(100).x / at(10).x).toBeCloseTo(10);
  });
});
describe('Compatibility and imported data', () => {
  it('migrates the actual deployed settings shape, including crosshair outline and inversion', () => {
    const s = migrateLegacySettings({ cs2Sensitivity: 1.2, invertMouse: true, followRecoil: true, aspectRatio: '4:3', crosshair: { style: 'dot', color: '#abcdef', outline: false, alpha: .8 } });
    expect(s.invertY).toBe(true); expect(s.follow).toBe(true); expect(s.sensitivity).toBe(1.2);
    expect(s.aspect).toBe('4:3'); expect(s.crosshair.size).toBe(0); expect(s.crosshair.outline).toBe(0);
    expect(s.crosshair.color).toBe('#abcdef'); expect(s.crosshair.alpha).toBe(.8);
  });
  it('falls back when raw input is unsupported', async () => {
    const requestPointerLock = vi.fn().mockRejectedValueOnce({ name: 'NotSupportedError' }).mockResolvedValueOnce(undefined);
    expect(await requestRawLock({ requestPointerLock } as unknown as HTMLElement)).toBe('standard');
    expect(requestPointerLock).toHaveBeenNthCalledWith(1, { unadjustedMovement: true });
    expect(requestPointerLock).toHaveBeenNthCalledWith(2);
  });
  it('falls back to drag for denied or missing Pointer Lock', async () => {
    expect(await requestRawLock({} as HTMLElement)).toBe('drag');
    expect(await requestRawLock({ requestPointerLock: () => Promise.reject({ name: 'SecurityError' }) } as unknown as HTMLElement)).toBe('drag');
  });
  it('accepts old non-Promise Pointer Lock implementations', async () => {
    expect(await requestRawLock({ requestPointerLock: () => undefined } as unknown as HTMLElement)).toBe('raw');
  });
  it('rejects invalid profiles and only accepts full, normalized captures', () => {
    const profile = { weapon: 'ak47', source: 'Measured wall capture', build: '2000908', points: Array.from({ length: 30 }, () => ({ yaw: 0, pitch: 0 })) };
    expect(parseProfile(JSON.stringify(profile)).points).toHaveLength(30);
    expect(() => parseProfile(JSON.stringify({ ...profile, points: profile.points.slice(1) }))).toThrow();
    expect(() => parseProfile(JSON.stringify({ ...profile, source: '' }))).toThrow();
    expect(() => parseProfile(JSON.stringify({ ...profile, points: profile.points.map(() => ({ yaw: '1', pitch: 0 })) }))).toThrow();
  });
  it('sanitizes corrupted and hostile storage settings', () => {
    const s = sanitizeSettings({ weapon: 'nope', mode: 'nope', sensitivity: NaN, distance: 10000, volume: -1, crosshair: { color: 'url(javascript:bad)', size: 1e6, alpha: null } });
    expect(s.weapon).toBe('ak47'); expect(s.sensitivity).toBe(1); expect('distance' in s).toBe(false);
    expect(s.volume).toBe(0); expect(s.crosshair.color).toBe(defaults.crosshair.color); expect(s.crosshair.size).toBe(20);
  });
});
describe('walking distance, jumping and moving lanes', () => {
  it('starts twelve metres from a stationary target line; resets and settings never teleport the player', () => {
    const s = make(); expect(s.position.z).toBe(SPAWN_Z); expect(s.position.z - TARGET_Z).toBe(12);
    s.active = true; s.input.forward = 1; run(s, 1); const z = s.position.z;
    expect(z).toBeLessThan(SPAWN_Z); s.reset(); expect(s.position.z).toBe(z);
    s.configure({ ...defaults, weapon: 'mp9' }); expect(s.position.z).toBe(z); expect(s.targetPosition(0).z).toBe(TARGET_Z);
  });
  it('keeps target speed constant through reversals, in bounded independent transfer lanes', () => {
    const s = make({ moving: true, mode: 'transfer' }); s.active = true;
    let reversals = 0, sign = 1;
    for (let i = 0; i < 512; i++) {
      s.advance(STEP); expect(Math.abs(s.targetVelocity)).toBeCloseTo(targetSpeed(s.settings), 10);
      expect(Math.abs(s.targetX)).toBeLessThanOrEqual(1.25);
      expect(s.targetPosition(1).x - s.targetPosition(0).x).toBe(4);
      if (s.targetSign !== sign) reversals++; sign = s.targetSign;
    }
    expect(reversals).toBeGreaterThan(2);
  });
  it('uses native jump impulse/gravity, lands, and requires a new key press', () => {
    const s = make(); s.active = true; s.input.jump = true;
    let apex = 0;
    for (let i = 0; i < 256; i++) { s.advance(STEP); apex = Math.max(apex, s.feet); }
    expect(apex).toBeCloseTo(JUMP_SPEED ** 2 / (2 * GRAVITY), 3);
    expect(s.feet).toBe(0); expect(s.position.y).toBe(64 * UNIT);
    s.input.jump = false; s.advance(STEP); s.input.jump = true; s.advance(STEP); expect(s.feet).toBeGreaterThan(0);
  });
  it('ships the requested first-run defaults', () => {
    expect(defaults.sensitivity * defaults.dpi).toBe(800); expect(defaults.volume).toBe(.2);
    expect(defaults.crosshair.color).toBe('#ffeb55'); expect(defaults.mode).toBe('guided');
  });
});
