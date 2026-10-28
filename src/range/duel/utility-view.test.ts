import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {UtilityView, type UtilityPresentation} from './utility-view';

function setup() {
  const scene = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  body.userData.native_view_weapon = 'utility-he'; scene.add(body);
  const view = new UtilityView(scene, ['idle', 'draw', 'inspect', 'pullpin', 'hold-high', 'hold-mid', 'hold-low', 'throw-high', 'throw-low']
    .map(name => new THREE.AnimationClip(name, 1, [])));
  const state: UtilityPresentation = {kind: 'he', selectedAt: 1, readyAt: 1.35};
  return {view, state, body};
}
describe('native grenade view action selection', () => {
  it('selects draw, idle, pin and all three strength poses without changing gameplay state', () => {
    const {view, state} = setup(); const original = {...state};
    view.update(state, 1.1); expect(view.activeAction).toBe('draw');
    view.update(state, 1.4); expect(view.activeAction).toBe('draw');
    view.update(state, 2); expect(view.activeAction).toBe('idle');
    view.update({...state, primedAt: 2}, 2.5); expect(view.activeAction).toBe('pullpin');
    for (const [strength, name] of [[0, 'hold-low'], [.5, 'hold-mid'], [1, 'hold-high']] as const) {
      view.update({...state, primedAt: 2, strength}, 3.2); expect(view.activeAction).toBe(name);
    }
    expect(state).toEqual(original); view.dispose();
  });
  it('supports inspect, interrupts it on priming, and handles both throws and death cancellation', () => {
    const {view, state, body} = setup();
    expect(view.inspect(2)).toBe(true); view.update(state, 2.1); expect(view.activeAction).toBe('inspect');
    view.update({...state, primedAt: 2.2}, 2.3); expect(view.activeAction).toBe('pullpin');
    view.update({...state, primedAt: 2.2, releaseAt: 3, strength: 0}, 2.95); expect(view.activeAction).toBe('throw-low');
    view.throw(3, 0); expect(view.update(undefined, 3.1)).toBe(true); expect(body.visible).toBe(false);
    expect(view.update(undefined, 4)).toBe(false); expect(body.visible).toBe(true);
    view.throw(5); view.cancel(); expect(view.followingThrough).toBe(false);
    view.update(state, 6); expect(body.visible).toBe(true); view.dispose();
  });
  it('hides a multi-material grenade group at release, but retains its separate hands', () => {
    const scene = new THREE.Group(), weapon = new THREE.Group(), hands = new THREE.Group();
    weapon.userData.native_view_weapon = 'utility-flash';
    weapon.add(new THREE.Mesh(), new THREE.Mesh()); scene.add(weapon, hands);
    const view = new UtilityView(scene, [new THREE.AnimationClip('throw-high', 1, []), new THREE.AnimationClip('idle', 1, [])]);
    view.throw(1); view.update(undefined, 1.1);
    expect(weapon.visible).toBe(false); expect(hands.visible).toBe(true);
    view.cancel(); expect(weapon.visible).toBe(true); view.dispose();
  });
  it('samples zero-duration native poses and blends from the final pin pose without bind-pose pops', () => {
    const scene = new THREE.Group(), bone = new THREE.Object3D(); bone.name = 'testBone'; scene.add(bone);
    const clip = (name: string, seconds: number, x: number) => new THREE.AnimationClip(name, seconds,
      [new THREE.NumberKeyframeTrack('testBone.position[x]', [0], [x])]);
    const view = new UtilityView(scene, [clip('idle', 0, 0), clip('pullpin', 1, 2),
      clip('hold-low', 0, 4), clip('hold-mid', 0, 6), clip('hold-high', 0, 8)]);
    const state = {kind: 'he' as const, selectedAt: 0, readyAt: 0, primedAt: 1, strength: 1};
    view.update(state, 1.79); expect(bone.position.x).toBeCloseTo(2);
    view.update(state, 1.8); expect(bone.position.x).toBeCloseTo(2);
    view.update(state, 1.9); expect(bone.position.x).toBeCloseTo(5);
    view.update(state, 2); expect(bone.position.x).toBeCloseTo(8);
    view.update({...state, strength: .25}, 3); expect(bone.position.x).toBeCloseTo(5);
    view.dispose();
  });
  it('uses explicit throw start clocks without treating a sound marker as projectile release', () => {
    const {view, state} = setup();
    view.throw(3, 1, 2.8);
    expect(view.update(undefined, 3.79)).toBe(true);
    expect(view.update(undefined, 3.8)).toBe(false);
    view.update({...state, primedAt: 2, releaseAt: 4, throwStartedAt: 3.5}, 3.6);
    expect(view.activeAction).toBe('throw-high'); view.dispose();
  });
  it('does not enter pin or throw early when input queues a future primedAt during deployment', () => {
    const {view, state} = setup();
    const queued = {...state, readyAt: 2, primedAt: 2, releaseAt: 3};
    view.update(queued, 1.2); expect(view.activeAction).toBe('draw');
    view.update(queued, 1.7); expect(view.activeAction).toBe('draw');
    view.update(queued, 1.99); expect(view.activeAction).not.toBe('pullpin');
    expect(view.activeAction).not.toBe('throw-high');
    view.update(queued, 2); expect(view.activeAction).toBe('pullpin'); view.dispose();
  });
  it('advances a native idle loop even when the model becomes visible after deploy finished', () => {
    const scene = new THREE.Group(), bone = new THREE.Object3D(); bone.name = 'idleBone'; scene.add(bone);
    const view = new UtilityView(scene, [new THREE.AnimationClip('idle', 1,
      [new THREE.NumberKeyframeTrack('idleBone.position[x]', [0, 1], [0, 1])])]);
    const state = {kind: 'he' as const, selectedAt: 0, readyAt: 1};
    view.update(state, 3.2); expect(bone.position.x).toBeCloseTo(.2);
    view.update(state, 3.4); expect(bone.position.x).toBeCloseTo(.4); view.dispose();
  });
});
