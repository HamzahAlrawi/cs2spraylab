import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import native from './he-explosion-native.json';
import {HE_EXPLOSION_SECONDS, HE_SMOKE_PARTICLES, heSmokeParticle} from './he-explosion';
import {HeExplosionRenderer} from './he-explosion-render';
import {UtilitySimulation, UTILITY_RULES, type UtilityEffect} from './utilities';
import {testArena} from './geometry';

const burst: UtilityEffect = {id: 1, actorId: 0, side: 'player', kind: 'he', type: 'burst',
  position: {x: 2, y: .1, z: -3}, radius: 8, startedAt: 1, expiresAt: 1 + HE_EXPLOSION_SECONDS, cells: [], holes: []};

describe('installed HE smoke presentation', () => {
  it('pins real HE children, authored fields and bounded nonempty atlas bytes', () => {
    expect(native.build).toBe('2000938'); expect(native.parent).toContain('explosion_hegrenade');
    expect(native.profiles.core.delays).toEqual([0, .05, .1]);
    expect(native.profiles.core.lifetime).toEqual([1, 2]); expect(native.profiles.ground.lifetime).toEqual([1.5, 6]);
    expect(HE_EXPLOSION_SECONDS).toBe(6); expect(HE_SMOKE_PARTICLES).toBe(7);
    const bytes = readFileSync(`public/revamp${native.asset.url}`);
    expect(bytes.length).toBe(native.asset.bytes); expect(bytes.length).toBeLessThan(1_000_000);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.asset.sha256);
    expect(native.asset.sequences).toHaveLength(5);
    expect(native.asset.columns * native.asset.size).toBeLessThanOrEqual(2048);
    expect(native.asset.rows * native.asset.size).toBeLessThanOrEqual(2048);
  });
  it('respects emitter delays, fitted frame ends and native lifespan boundaries', () => {
    expect(heSmokeParticle(1, 'core', 1, .049)).toBeUndefined();
    expect(heSmokeParticle(1, 'core', 1, .05)).toBeDefined();
    expect(heSmokeParticle(1, 'core', 0, 2)).toBeUndefined();
    expect(heSmokeParticle(1, 'ground', 0, 6)).toBeUndefined();
    expect(heSmokeParticle(1, 'ground', 0, NaN)).toBeUndefined();
    for (let id = 0; id < 16; id++) for (const layer of ['core', 'ground'] as const) {
      const first = heSmokeParticle(id, layer, 0, .2)!, later = heSmokeParticle(id, layer, 0, .5)!;
      expect(later.size).toBeGreaterThan(first.size); expect(later.opacity).toBeLessThanOrEqual(first.opacity);
      expect(later.frame).toBeLessThanOrEqual(later.lastFrame);
      expect(heSmokeParticle(id, layer, 0, .2)).toEqual(first);
    }
  });
  it('renders after the flash, stays anchored in world space and resets on absolute backward seeks', () => {
    const renderer = new HeExplosionRenderer(), camera = new THREE.PerspectiveCamera();
    const buffer = renderer.mesh.instanceMatrix.array;
    renderer.update([burst], 1.5, camera); expect(renderer.mesh.count).toBe(7);
    const first = [...renderer.mesh.instanceMatrix.array];
    renderer.update([burst], 3.5, camera); expect(renderer.mesh.count).toBeGreaterThan(0);
    renderer.update([burst], 1.5, camera); expect([...renderer.mesh.instanceMatrix.array]).toEqual(first);
    camera.position.set(4, 7, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); renderer.update([burst], 1.5, camera);
    const matrix = new THREE.Matrix4(); renderer.mesh.getMatrixAt(0, matrix);
    const p = heSmokeParticle(1, 'core', 0, .5)!;
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([
      expect.closeTo(burst.position.x + p.x, 5), expect.closeTo(burst.position.y + p.y, 5), expect.closeTo(burst.position.z + p.z, 5)]);
    expect(renderer.mesh.instanceMatrix.array).toBe(buffer);
    renderer.update([burst], burst.expiresAt, camera); expect(renderer.mesh.count).toBe(0);
    renderer.update([{...burst, kind: 'flash'}], 1.5, camera); expect(renderer.mesh.count).toBe(0);
    renderer.dispose(); renderer.dispose();
  });
  it('bounds particles and releases buffers/materials exactly once', () => {
    const renderer = new HeExplosionRenderer(), camera = new THREE.PerspectiveCamera();
    renderer.update(Array.from({length: 100}, (_, id) => ({...burst, id})), 1.5, camera);
    expect(renderer.mesh.count).toBe(UTILITY_RULES.maxEffects * HE_SMOKE_PARTICLES);
    const dispose = vi.fn(); renderer.mesh.geometry.addEventListener('dispose', dispose);
    renderer.dispose(); renderer.dispose(); expect(dispose).toHaveBeenCalledOnce();
    renderer.update([burst], 1.5, camera); expect(renderer.mesh.count).toBe(0);
  });
  it('extends only cosmetic lifetime; detonation damage still occurs on the same event', () => {
    const sim = new UtilitySimulation();
    sim.throw({actorId: 0, side: 'player', kind: 'he', origin: {x: 0, y: .1, z: 0}, direction: {x: 0, y: -1, z: 0},
      velocity: {x: 0, y: UTILITY_RULES.throwSpeed * .3 / 1.25, z: 0}, strength: 0, time: 0});
    const actor = {id: 1, side: 'enemy' as const, position: {x: 0, y: 1.6, z: 1}, feet: 0, yaw: 0, pitch: 0, alive: true, armor: 0};
    const events = [];
    for (let i = 1; i <= 256; i++) events.push(...sim.advance(1 / 128, i / 128, testArena(), [actor]));
    const detonate = events.find(e => e.type === 'detonate')!, damage = events.find(e => e.type === 'damage')!;
    expect(damage.time).toBe(detonate.time);
    const effect = sim.effects.find(e => e.kind === 'he')!;
    expect(effect.expiresAt - effect.startedAt).toBe(HE_EXPLOSION_SECONDS);
    expect(effect.type).toBe('burst'); expect(sim.smokeExposure({x: -8, y: 1.6, z: 0}, {x: 8, y: 1.6, z: 0}, 2)).toBe(0);
  });
});
