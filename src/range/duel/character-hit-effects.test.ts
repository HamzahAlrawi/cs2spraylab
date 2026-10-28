import {describe, it, expect, vi} from 'vitest';
import * as THREE from 'three';
import {CharacterHitEffects, type CharacterHitEffect} from './character-hit-effects';

const hit: CharacterHitEffect = {point: {x: 3, y: 1.6, z: -4}, direction: {x: 0, y: 0, z: -1},
  headshot: true, helmet: false, lethal: true};
const sprites = (effects: CharacterHitEffects) => effects.group.children as THREE.Sprite[];

describe('bounded world-space character hit effects', () => {
  it('shows an immediate localized red head impact, then expires without trails or actor references', () => {
    const scene = new THREE.Scene(), effects = new CharacterHitEffects(scene);
    expect(effects.emit(hit)).toBe(true); expect(effects.activeCount).toBe(10);
    for (const sprite of sprites(effects).filter(s => s.visible)) {
      expect(sprite.position.distanceTo(new THREE.Vector3().copy(hit.point))).toBeLessThan(.04);
      expect(sprite.material.opacity).toBeGreaterThan(.8);
      expect(sprite.material.depthTest).toBe(true); expect(sprite.material.depthWrite).toBe(false);
      expect(sprite.material.blending).toBe(THREE.NormalBlending);
      expect(sprite.scale.x).toBeLessThan(.09);
      expect(sprite.material.color.r).toBeGreaterThan(sprite.material.color.g * 3);
    }
    effects.update(.1); expect(effects.activeCount).toBe(10);
    effects.update(1); expect(effects.activeCount).toBe(0);
    effects.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('separates helmet sparks/flash from flesh, with less output on body hits', () => {
    const effects = new CharacterHitEffects(new THREE.Scene());
    effects.emit({...hit, helmet: true, lethal: false}); expect(effects.activeCount).toBe(8);
    const active = sprites(effects).filter(s => s.visible);
    expect(active.filter(s => s.material.blending === THREE.AdditiveBlending)).toHaveLength(5);
    expect(active.filter(s => s.material.blending === THREE.NormalBlending)).toHaveLength(3);
    effects.update(.09); expect(effects.activeCount).toBe(7);
    effects.update(.12); expect(effects.activeCount).toBe(3);
    effects.clear(); effects.emit({...hit, headshot: false, helmet: true});
    expect(effects.activeCount).toBe(4);
    expect(sprites(effects).filter(s => s.visible).every(s => s.material.blending === THREE.NormalBlending)).toBe(true);
    effects.dispose();
  });
  it('reuses preallocated objects under stress, caps capacity and never participates in raycasts', () => {
    const effects = new CharacterHitEffects(new THREE.Scene(), {capacity: 1e6});
    const objects = [...effects.group.children], materials = sprites(effects).map(s => s.material);
    for (let i = 0; i < 400; i++) effects.emit({...hit, helmet: i % 2 === 0});
    expect(effects.group.children).toHaveLength(256); expect(effects.activeCount).toBe(256);
    expect(effects.group.children).toEqual(objects); expect(sprites(effects).map(s => s.material)).toEqual(materials);
    const ray = new THREE.Raycaster(new THREE.Vector3(3, 1.6, 0), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(effects.group, true)).toEqual([]);
    effects.clear(); expect(effects.activeCount).toBe(0); effects.dispose();
  });
  it('keeps emitted world locations fixed when a scene parent moves and normalizes direction', () => {
    const parent = new THREE.Group(); parent.position.set(4, 0, 2); parent.rotation.y = .7;
    const a = new CharacterHitEffects(parent), b = new CharacterHitEffects(new THREE.Scene());
    a.emit(hit); b.emit({...hit, direction: {x: 0, y: 0, z: -20}});
    parent.position.x += 3; parent.rotation.y = -.4;
    a.update(.02); b.update(.02);
    const pa = sprites(a)[0].getWorldPosition(new THREE.Vector3()), pb = sprites(b)[0].getWorldPosition(new THREE.Vector3());
    expect(pa.distanceTo(pb)).toBeLessThan(1e-7);
    a.dispose(); b.dispose();
  });
  it('is frame-rate independent, freezes on pause and rejects invalid input', () => {
    const a = new CharacterHitEffects(new THREE.Scene()), b = new CharacterHitEffects(new THREE.Scene());
    a.emit(hit); b.emit(hit); a.update(.1);
    for (let i = 0; i < 10; i++) b.update(.01);
    expect(sprites(a)[0].position.distanceTo(sprites(b)[0].position)).toBeLessThan(1e-7);
    const before = sprites(a)[0].position.clone();
    a.update(0); a.update(-1); a.update(NaN); a.update(Infinity);
    expect(sprites(a)[0].position).toEqual(before);
    expect(a.emit({...hit, point: {x: NaN, y: 0, z: 0}})).toBe(false);
    expect(a.emit({...hit, direction: {x: 0, y: 0, z: 0}})).toBe(false);
    a.dispose(); b.dispose();
  });
  it('disposes owned resources once but never borrowed native textures', () => {
    const texture = new THREE.Texture(), external = vi.spyOn(texture, 'dispose');
    const effects = new CharacterHitEffects(new THREE.Scene(), {bloodTexture: texture, sparkTexture: texture});
    const materials = sprites(effects).map(s => vi.spyOn(s.material, 'dispose'));
    effects.emit(hit); effects.dispose(); effects.dispose(); effects.update(1);
    expect(effects.emit(hit)).toBe(false); expect(external).not.toHaveBeenCalled();
    expect(materials.every(spy => spy.mock.calls.length === 1)).toBe(true);
    const fallback = new CharacterHitEffects(new THREE.Scene());
    const dispose = vi.spyOn(sprites(fallback)[0].material.map!, 'dispose'); fallback.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
