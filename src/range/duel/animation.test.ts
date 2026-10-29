import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {DuelAnimator, nativeGestureName, nativeGestureClips, cachedLegProbeIndices} from './animation';
import type {DuelActorSnapshot} from './types';

const actor = (): DuelActorSnapshot => ({id: 1, generation: 1, side: 'enemy', position: {x: 0, y: 0, z: 0},
  feet: 0, velocity: {x: 0, z: 0}, yaw: 0, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false});
function fixture() {
  const model = new THREE.Group(), hip = new THREE.Bone(), spine = new THREE.Bone(), head = new THREE.Bone();
  hip.name = 'pelvis'; hip.position.y = 1; spine.name = 'spine_2'; spine.position.y = .3; head.name = 'head_0'; head.position.y = .3;
  model.add(hip); hip.add(spine); spine.add(head);
  const clips = [new THREE.AnimationClip('animation/anims/world/idle_rifle', 0, [
    new THREE.QuaternionKeyframeTrack('spine_2.quaternion', [0], [0, 0, 0, 1]),
    new THREE.QuaternionKeyframeTrack('head_0.quaternion', [0], [0, 0, 0, 1]),
  ]), new THREE.AnimationClip('animation/anims/world/presentation/gesture_reload_ak47', 1, [
    new THREE.QuaternionKeyframeTrack('spine_2.quaternion', [0, .5, 1], [0, 0, 0, 1, .3, 0, 0, Math.sqrt(.91), 0, 0, 0, 1]),
    new THREE.VectorKeyframeTrack('pelvis.position', [0, 1], [0, 40, 0, 0, 50, 0]),
  ])];
  return {model, hip, spine, head, animator: new DuelAnimator(model, clips, 0, 'ak47')};
}

describe('immutable leg probe metadata cache', () => {
  it('selects native eye-cover poses only for complete whiteout and removes them after recovery', () => {
    const {animator, spine} = fixture();
    const clip = (name: string) => new THREE.AnimationClip(name, 0, [
      new THREE.QuaternionKeyframeTrack('spine_2.quaternion', [0], [.4, 0, 0, Math.sqrt(.84)])]);
    animator.addGestureClips([clip('gesture_flashed_rifle'), clip('gesture_flashed_crouch_rifle')]);
    const actions = (animator as unknown as {actions: Map<string, THREE.AnimationAction>}).actions;
    animator.update({...actor(), flashAmount: .13}, .1);
    expect(actions.get('gesture_flashed_rifle')!.enabled).toBe(false);
    animator.update({...actor(), flashAmount: 1}, .1);
    expect(actions.get('gesture_flashed_rifle')!.enabled).toBe(true); expect(spine.quaternion.x).toBeGreaterThan(.2);
    animator.update({...actor(), flashAmount: 0}, .1);
    expect(actions.get('gesture_flashed_rifle')!.enabled).toBe(false); animator.dispose();
  });
  it('avoids rescanning shared geometry without retaining or sharing actor pose state', () => {
    const geometry = new THREE.BufferGeometry();
    const joints = new THREE.Uint16BufferAttribute([0,1,0,0, 1,0,0,0, 0,0,0,0],4);
    geometry.setAttribute('skinIndex',joints);
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([.2,.8,0,0, 1,0,0,0, 1,0,0,0],4));
    const a = new THREE.SkinnedMesh(geometry), b = new THREE.SkinnedMesh(geometry);
    const read = vi.spyOn(joints,'getComponent');
    const first = cachedLegProbeIndices(a,[false,true]); expect(first).toEqual([0,1]);
    expect(Object.isFrozen(first)).toBe(true); read.mockClear();
    expect(cachedLegProbeIndices(b,[false,true])).toBe(first);expect(read).not.toHaveBeenCalled();
    expect(cachedLegProbeIndices(b,[true,false])).toEqual([0,2]);
    a.position.y=10;b.position.y=20;
    expect(a.position.y).toBe(10);expect(b.position.y).toBe(20);
    geometry.dispose();
  });
  it('invalidates replaced/updated skin attributes and respects remapped palettes', () => {
    const geometry = new THREE.BufferGeometry();
    const joints = new THREE.Uint16BufferAttribute([0,1,0,0],4), weights = new THREE.Float32BufferAttribute([1,0,0,0],4);
    geometry.setAttribute('skinIndex',joints);geometry.setAttribute('skinWeight',weights);
    const mesh = new THREE.SkinnedMesh(geometry);
    expect(cachedLegProbeIndices(mesh,[false,true])).toEqual([]);
    weights.setXYZW(0,0,1,0,0);weights.needsUpdate=true;
    expect(cachedLegProbeIndices(mesh,[false,true])).toEqual([0]);
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([1,0,0,0],4));
    expect(cachedLegProbeIndices(mesh,[false,true])).toEqual([]);
    expect(cachedLegProbeIndices(mesh,[true,false])).toEqual([0]);geometry.dispose();
  });
});

describe('immutable animation preprocessing cache', () => {
  const world = (name: string, tracks: THREE.KeyframeTrack[]) => new THREE.AnimationClip(`animation/anims/world/${name}`, 1, tracks);
  const rotation = (angle: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray();
  const quaternion = (name: string, angle: number) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0], rotation(angle));
  const actions = (animator: DuelAnimator) => (animator as unknown as {actions: Map<string, THREE.AnimationAction>}).actions;
  function rig(pivot = false) {
    const model = new THREE.Group(), spine = new THREE.Bone(), hand = new THREE.Bone();
    model.name = 'actor'; spine.name = 'spine_2'; hand.name = 'hand_R'; model.add(spine); spine.add(hand);
    if (pivot) {const bone = new THREE.Bone(); bone.name = 'wpnPivot'; model.add(bone);}
    return {model, spine, hand};
  }

  it('does not edit source clips, tracks or sample arrays during filtering, conversion or playback', () => {
    const clips = [world('idle_rifle', [quaternion('spine_2', .2), quaternion('missing', .5)]),
      world('idle_pistol', [quaternion('spine_2', .3)]), world('idle_usp', [quaternion('hand_R', .4)]),
      world('gesture_reload_ak47', [quaternion('spine_2', .8), quaternion('pelvis', 1),
        new THREE.VectorKeyframeTrack('spine_2.position', [0], [1, 2, 3]),
        new THREE.VectorKeyframeTrack('hand_R.scale', [0], [2, 2, 2])]),
      world('gesture_fire_usp', [quaternion('hand_R', .1)])];
    clips[4].blendMode = THREE.AdditiveAnimationBlendMode;
    const originals = clips.map(clip => ({json: THREE.AnimationClip.toJSON(clip), tracks: clip.tracks,
      samples: clip.tracks.map(track => ({track, times: track.times, values: track.values}))}));
    const a = new DuelAnimator(rig().model, clips), b = new DuelAnimator(rig().model, clips);
    const processed = [...actions(a).values()].map(action => THREE.AnimationClip.toJSON(action.getClip()));
    expect(actions(a).get('idle_usp')!.getClip().blendMode).toBe(THREE.AdditiveAnimationBlendMode);
    expect(actions(a).get('gesture_reload_ak47')!.getClip().tracks.map(track => track.name)).toEqual(['spine_2.quaternion']);
    for (const action of actions(a).values()) {action.enabled = true; action.time = .4; action.play();}
    a.mixer.update(0); a.dispose();
    expect([...actions(b).values()].map(action => THREE.AnimationClip.toJSON(action.getClip()))).toEqual(processed);
    clips.forEach((clip, index) => {
      expect(THREE.AnimationClip.toJSON(clip)).toEqual(originals[index].json); expect(clip.tracks).toBe(originals[index].tracks);
      clip.tracks.forEach((track, i) => {
        expect(track).toBe(originals[index].samples[i].track);
        expect(track.times).toBe(originals[index].samples[i].times);
        expect(track.values).toBe(originals[index].samples[i].values);
      });
    });
    const bound = actions(b).get('idle_rifle')!.getClip();
    expect(bound.tracks[0]).not.toBe(clips[0].tracks[0]);
    expect(bound.tracks[0].times).not.toBe(clips[0].tracks[0].times);
    expect(bound.tracks[0].values).not.toBe(clips[0].tracks[0].values);
    expect(Object.isFrozen(bound)).toBe(true); expect(Object.isFrozen(bound.tracks)).toBe(true);
    expect(Object.isFrozen(bound.tracks[0])).toBe(true); b.dispose();
  });

  it('shares processed data across equipment and rebuilds, but keeps actions, mixers and poses independent', () => {
    const source = world('idle_rifle', [new THREE.VectorKeyframeTrack('hand_R.position', [0, 1], [0, 0, 0, 2, 0, 0])]);
    const clone = vi.spyOn(source, 'clone'), first = rig(), second = rig();
    const a = new DuelAnimator(first.model, [source], 0, 'ak47'), b = new DuelAnimator(second.model, [source], .5, 'm4a4');
    const aa = actions(a).get('idle_rifle')!, ba = actions(b).get('idle_rifle')!;
    expect(clone).toHaveBeenCalledTimes(1); expect(aa.getClip()).toBe(ba.getClip());
    expect(a.mixer).not.toBe(b.mixer); expect(aa).not.toBe(ba);
    expect(first.hand).not.toBe(second.hand); expect(first.hand.position).not.toBe(second.hand.position);
    aa.enabled = true; aa.time = .25; aa.setEffectiveWeight(.4); aa.play(); a.mixer.update(0);
    expect(first.hand.position.x).toBeCloseTo(.2); expect(second.hand.position.x).toBe(0);
    expect(ba.time).toBe(0); expect(ba.enabled).toBe(false); expect(ba.getEffectiveWeight()).toBe(1);
    ba.enabled = true; ba.time = .75; ba.play(); b.mixer.update(0);
    expect(second.hand.position.x).toBeCloseTo(1.5); expect(first.hand.position.x).toBeCloseTo(.2);
    a.dispose(); ba.time = .5; b.mixer.update(0); expect(second.hand.position.x).toBeCloseTo(1);
    const rebuilt = new DuelAnimator(rig().model, [source], 0, 'ak47');
    expect(actions(rebuilt).get('idle_rifle')!.getClip()).toBe(ba.getClip());
    expect(clone).toHaveBeenCalledTimes(1); rebuilt.dispose(); b.dispose();
  });

  it('separates actual rig/weapon bindings and refreshes bindings for late gesture loads', () => {
    const locomotion = world('idle_rifle', [quaternion('hand_R', 0), quaternion('wpnPivot', .2)]);
    const gesture = world('gesture_draw_ak47', [quaternion('wpnPivot', .3)]);
    gesture.blendMode = THREE.AdditiveAnimationBlendMode;
    const clone = vi.spyOn(gesture, 'clone'), bare = rig(), equipped = rig(true);
    const a = new DuelAnimator(bare.model, [locomotion, gesture], 0, 'ak47');
    const b = new DuelAnimator(equipped.model, [locomotion, gesture], 0, 'ak47');
    const c = new DuelAnimator(rig().model, [locomotion, gesture], 0, 'ak47');
    expect(actions(a).get('idle_rifle')!.getClip().tracks.map(track => track.name)).toEqual(['hand_R.quaternion']);
    expect(actions(b).get('idle_rifle')!.getClip().tracks.map(track => track.name)).toEqual(['hand_R.quaternion', 'wpnPivot.quaternion']);
    expect(actions(a).has('gesture_draw_ak47')).toBe(false); expect(actions(c).has('gesture_draw_ak47')).toBe(false);
    expect(clone).toHaveBeenCalledTimes(2);
    const pivot = new THREE.Bone(); pivot.name = 'wpnPivot'; bare.model.add(pivot); a.addGestureClips([gesture]);
    expect(actions(a).get('gesture_draw_ak47')!.getClip()).toBe(actions(b).get('gesture_draw_ak47')!.getClip());
    expect(clone).toHaveBeenCalledTimes(2); a.dispose(); b.dispose(); c.dispose();
  });

  it('keys death root filtering by model name even when the binding-name sets match', () => {
    const source = world('death_chest_a', [
      new THREE.VectorKeyframeTrack('.position', [0], [0, 1, 0]),
      new THREE.VectorKeyframeTrack('actor.position', [0], [0, 2, 0]),
      new THREE.VectorKeyframeTrack('other.position', [0], [0, 3, 0]), quaternion('hand_R', .1),
    ]);
    const first = rig(), second = rig(), childA = new THREE.Group(), childB = new THREE.Group();
    childA.name = 'other'; first.model.add(childA);
    second.model.name = 'other'; childB.name = 'actor'; second.model.add(childB);
    const a = new DuelAnimator(first.model, [source]), b = new DuelAnimator(second.model, [source]);
    expect(actions(a).get('death_chest_a')!.getClip().tracks.map(track => track.name)).toEqual(['other.position', 'hand_R.quaternion']);
    expect(actions(b).get('death_chest_a')!.getClip().tracks.map(track => track.name)).toEqual(['actor.position', 'hand_R.quaternion']);
    a.dispose(); b.dispose();
  });

  it('preserves equipment selection without poisoning shared family clip data', () => {
    const clips = ['idle_rifle', 'idle_pistol', 'idle_usp', 'idle_glock'].map(name => world(name, [quaternion('hand_R', .2)]));
    const rifle = new DuelAnimator(rig().model, clips, 0, 'ak47');
    const usp = new DuelAnimator(rig().model, clips, 0, 'usp'), glock = new DuelAnimator(rig().model, clips, 0, 'glock');
    expect([...actions(rifle).keys()]).toEqual(['idle_rifle']);
    expect([...actions(usp).keys()]).toEqual(['idle_pistol', 'idle_usp']);
    expect([...actions(glock).keys()]).toEqual(['idle_pistol', 'idle_glock']);
    expect(actions(usp).get('idle_pistol')!.getClip()).toBe(actions(glock).get('idle_pistol')!.getClip());
    rifle.dispose(); usp.dispose(); glock.dispose();
  });

  it('converts shared absolute gestures against the correct base identity, stance and family', () => {
    const idle = world('idle_rifle', [quaternion('hand_R', .2)]), alternate = world('idle_rifle', [quaternion('hand_R', .7)]);
    const crouch = world('idle_crouch_rifle', [quaternion('hand_R', -.3)]), pistol = world('idle_pistol', [quaternion('hand_R', .9)]);
    const gesture = world('gesture_reload_ak47', [quaternion('hand_R', 1.1)]);
    const crouchGesture = world('gesture_reload_crouch_ak47', [quaternion('hand_R', 1.1)]);
    const pistolGesture = world('gesture_reload_usp', [quaternion('hand_R', 1.1)]);
    const clips = [crouch, pistol, gesture, crouchGesture, pistolGesture];
    const clone = vi.spyOn(gesture, 'clone');
    const missing = new DuelAnimator(rig().model, [gesture]);
    expect(actions(missing).has('gesture_reload_ak47')).toBe(false); missing.dispose();
    const a = new DuelAnimator(rig().model, [idle, ...clips]), b = new DuelAnimator(rig().model, [alternate, ...clips]);
    const c = new DuelAnimator(rig().model, [idle, ...clips]);
    const bound = (animator: DuelAnimator, name = 'gesture_reload_ak47') => actions(animator).get(name)!.getClip();
    expect(bound(a)).toBe(bound(c)); expect(bound(a)).not.toBe(bound(b)); expect(clone).toHaveBeenCalledTimes(2);
    for (const [animator, name, angle] of [[a, 'gesture_reload_ak47', .9], [b, 'gesture_reload_ak47', .4],
      [a, 'gesture_reload_crouch_ak47', 1.4], [a, 'gesture_reload_usp', .2]] as const) {
      expect(new THREE.Quaternion().fromArray(bound(animator, name).tracks[0].values)
        .angleTo(new THREE.Quaternion().fromArray(rotation(angle)))).toBeLessThan(.001);
      expect((animator as unknown as {absoluteGestures: Set<string>}).absoluteGestures.has(name)).toBe(true);
    }
    expect(bound(a, 'gesture_reload_crouch_ak47')).toBe(bound(b, 'gesture_reload_crouch_ak47'));
    expect(idle.blendMode).toBe(THREE.NormalAnimationBlendMode); expect(gesture.blendMode).toBe(THREE.NormalAnimationBlendMode);
    a.dispose(); b.dispose(); c.dispose();
  });

  it('keeps native additive gestures unconverted and respects newly applied asset metadata', () => {
    const idle = world('idle_rifle', [quaternion('hand_R', .5)]), gesture = world('gesture_fire_ak47', [quaternion('hand_R', .2)]);
    const a = new DuelAnimator(rig().model, [idle, gesture]);
    nativeGestureClips({animations: [gesture], parser: {json: {animations: [{extras: {additive: true}}]}}});
    const b = new DuelAnimator(rig().model, [idle, gesture]), c = new DuelAnimator(rig().model, [gesture]);
    const bound = actions(b).get('gesture_fire_ak47')!.getClip();
    expect(bound).not.toBe(actions(a).get('gesture_fire_ak47')!.getClip());
    expect(bound).toBe(actions(c).get('gesture_fire_ak47')!.getClip());
    expect(Array.from(bound.tracks[0].values)).toEqual(Array.from(gesture.tracks[0].values));
    expect((b as unknown as {absoluteGestures: Set<string>}).absoluteGestures.size).toBe(0);
    a.dispose(); b.dispose(); c.dispose();
  });
});

describe('timestamped flinch integration',()=>{
  it('samples head/body movement without drift and restores an earlier clean pose',()=>{
    const f=fixture(),a=actor();
    f.animator.update(a,0,undefined,{poseTime:1});const clean=f.head.quaternion.clone();
    a.recentHits=[{time:1,region:'head',helmet:false,actorYaw:0,incoming:{x:1,z:1}}];
    f.animator.update(a,0,undefined,{poseTime:1.02});const first=f.head.quaternion.clone();
    expect(first.angleTo(clean)).toBeGreaterThan(.01);
    for(let i=0;i<8;i++)f.animator.update(a,0,undefined,{poseTime:1.02});
    expect(f.head.quaternion.angleTo(first)).toBeLessThan(1e-6);
    f.animator.update(a,0,undefined,{poseTime:.99});expect(f.head.quaternion.angleTo(clean)).toBeLessThan(1e-6);
    f.animator.update(a,0,undefined,{poseTime:1.02});expect(f.head.quaternion.angleTo(first)).toBeLessThan(1e-6);
    f.animator.update(a,0,undefined,{poseTime:1.4});expect(f.head.quaternion.angleTo(clean)).toBeLessThan(1e-6);
    expect(f.model.position.toArray()).toEqual([0,0,0]);f.animator.dispose();
  });
});

function plantFixture() {
  const f = fixture(); f.animator.dispose();
  for (const side of ['L', 'R']) {
    let parent: THREE.Object3D = f.hip;
    for (const [name, position] of [['leg_upper', [side === 'L' ? -.14 : .14, 0, 0]],
      ['leg_lower', [0, -.45, .04]], ['ankle', [0, -.43, -.04]], ['ball', [0, 0, .1]]] as const) {
      const bone = new THREE.Bone(); bone.name = `${name}_${side}`; bone.position.fromArray(position); parent.add(bone); parent = bone;
    }
  }
  const tracks: THREE.KeyframeTrack[] = [];
  f.model.traverse(bone => {if (bone instanceof THREE.Bone) tracks.push(
    new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0], bone.position.toArray()),
    new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0], bone.quaternion.toArray()));});
  const clips = [new THREE.AnimationClip('animation/anims/world/idle_rifle', 0, tracks),
    ...['e2w', 'w2e'].map(direction => new THREE.AnimationClip(`animation/anims/world/planted_${direction}_rifle`, .5333, [
      new THREE.VectorKeyframeTrack('pelvis.position', [0, .1, .5333], [0, 1, 0, 0, .92, 0, 0, 1, 0]),
      ...tracks.filter(track => /^(leg_|ankle_|ball_)/.test(track.name)).map(track => track.clone()),
    ]))];
  const animator = new DuelAnimator(f.model, clips, 0, 'ak47');
  const state = animator as unknown as {plant?: {name: string; elapsed: number; weight: number}; strafe?: unknown};
  const a = actor();
  for (let n = 0; n < 5; n++) {a.velocity.x = 215 * .0254; animator.update(a, .01);}
  a.velocity.x = 0; animator.update(a, .01);
  return {...f, animator, state, a};
}
describe('native weapon layers and dynamic death hooks', () => {
  it.each([0, .8, Math.PI])('looks up with positive physical pitch at yaw %s, without reversing the native +Z aim axis', yaw => {
    const f = fixture(), a = {...actor(), yaw}; f.model.rotation.y = yaw - Math.PI;
    a.pitch = .6; f.animator.update(a, 0); f.model.updateWorldMatrix(true, true);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(f.head.getWorldQuaternion(new THREE.Quaternion())).y).toBeGreaterThan(0);
    a.pitch = -.6; f.animator.update(a, 0); f.model.updateWorldMatrix(true, true);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(f.head.getWorldQuaternion(new THREE.Quaternion())).y).toBeLessThan(0);
    a.pitch = 0; f.animator.update(a, 0); f.model.updateWorldMatrix(true, true);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(f.head.getWorldQuaternion(new THREE.Quaternion())).y).toBeCloseTo(0, 8);
    f.animator.dispose();
  });
  it('keeps a sleeping corpse pose without remapping joints, and compensates root transforms if they change', () => {
    const f = fixture(), a = actor(); a.alive = false;
    f.animator.setDeathWorld({floor: 0});
    for (let frame = 0; frame < 160; frame++) f.animator.update(a, 1 / 15);
    const head = f.head.getWorldPosition(new THREE.Vector3());
    const update = vi.spyOn(f.head, 'updateWorldMatrix');
    for (let frame = 0; frame < 10; frame++) f.animator.update(a, 1 / 60);
    expect(update).not.toHaveBeenCalled();
    f.model.position.x += 1; f.animator.update(a, 1 / 60);
    expect(update).toHaveBeenCalled();
    expect(f.head.getWorldPosition(new THREE.Vector3()).distanceTo(head)).toBeLessThan(1e-6);
    f.animator.dispose();
  });
  it('selects stance and Dualies side without inventing unavailable gestures', () => {
    expect(nativeGestureName('ak47', 'reload', {crouched: true})).toBe('gesture_reload_crouch_ak47');
    expect(nativeGestureName('elite', 'fire', {side: 'left', lastShot: true})).toBe('gesture_fire-left-last_elite');
    expect(nativeGestureName('ak47', 'unknown')).toBe(null);
  });
  it('layers native reload over locomotion without applying root/pelvis tracks', () => {
    const f = fixture(), a = actor(); a.reloading = true;
    expect(f.animator.playAction('ak47', 'reload', {duration: 2})).toBe(true);
    f.animator.update(a, .01, undefined, {reloadDuration: 2, reloadRemaining: 1});
    expect(f.spine.quaternion.x).toBeGreaterThan(.2); expect(f.hip.position.y).toBe(1);
    a.reloading = false; f.animator.update(a, .01); expect(f.spine.quaternion.x).toBeCloseTo(0);
    expect(f.animator.playAction('ak47', 'draw')).toBe(false); f.animator.dispose();
  });
  it('does not accumulate procedural aim on constant native bone tracks', () => {
    const f = fixture(), a = actor(); a.pitch = .8;
    for (let n = 0; n < 100; n++) f.animator.update(a, 1 / 60);
    expect(f.spine.quaternion.x).toBeCloseTo(Math.sin(-.8 * .35 / 2), 5);
    a.pitch = 0; f.animator.update(a, 0); expect(f.spine.quaternion.x).toBeCloseTo(0); f.animator.dispose();
  });
  it('refreshes only the required aim chains without changing world-space pitch', () => {
    const f = fixture(); f.animator.dispose();
    const low = new THREE.Bone(), middle = new THREE.Bone(); low.name = 'spine_0'; middle.name = 'spine_1';
    f.hip.remove(f.spine); f.hip.add(low); low.add(middle); middle.add(f.spine);
    low.rotation.z = .12; middle.rotation.y = -.23; f.model.rotation.set(.08, .5, -.1);
    const clip = new THREE.AnimationClip('animation/anims/world/idle_rifle', 0,
      [low, middle, f.spine, f.head].map(bone =>
        new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0], bone.quaternion.toArray())));
    const animator = new DuelAnimator(f.model, [clip], 0, 'ak47'), a = actor(); animator.update(a, 0);
    const before = f.head.getWorldQuaternion(new THREE.Quaternion());
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(f.model.getWorldQuaternion(new THREE.Quaternion()));
    const update = vi.spyOn(f.head, 'updateWorldMatrix'); a.pitch = .72; animator.update(a, 1 / 60);
    expect(update.mock.calls.filter(([, children]) => children)).toHaveLength(0);
    const expected = before.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -a.pitch));
    expect(f.head.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)).toBeLessThan(1e-6);
    animator.dispose();
  });
  it('moves both native weapon anchors with the hands and restores the additive idle after reload', () => {
    const model = new THREE.Group(), pivot = new THREE.Bone(), weapon = new THREE.Bone();
    pivot.name = 'wpnPivot'; weapon.name = 'wpn'; model.add(pivot); pivot.add(weapon);
    const clip = (name: string, height: number, offset: number) => new THREE.AnimationClip(`animation/anims/world/${name}`, 1, [
      new THREE.VectorKeyframeTrack('wpnPivot.position', [0, 1], [0, height, 0, 0, height, 0]),
      new THREE.VectorKeyframeTrack('wpn.position', [0, 1], [offset, 0, 0, offset, 0, 0]),
    ]);
    const idle = clip('gesture_idle_ak47', .2, .02); idle.blendMode = THREE.AdditiveAnimationBlendMode;
    const animator = new DuelAnimator(model, [clip('idle_rifle', 1, 0),
      idle, clip('gesture_reload_ak47', 1.5, .1)], 0, 'ak47');
    const a = actor(); animator.update(a, 0);
    expect(pivot.position.y).toBeCloseTo(1.2); expect(weapon.position.x).toBeCloseTo(.02);
    a.reloading = true; animator.playAction('ak47', 'reload', {duration: 2});
    animator.update(a, 0, undefined, {reloadDuration: 2, reloadRemaining: 1});
    expect(pivot.position.y).toBeCloseTo(1.5); expect(weapon.position.x).toBeCloseTo(.1);
    a.reloading = false; animator.update(a, 0);
    expect(pivot.position.y).toBeCloseTo(1.2); expect(weapon.position.x).toBeCloseTo(.02);
    animator.dispose();
  });
  it('preserves native additive metadata instead of subtracting a second reference pose', () => {
    const clips = ['idle', 'reload', 'composed'].map(name => new THREE.AnimationClip(name, 1, []));
    nativeGestureClips({animations: clips, parser: {json: {animations: [{extras: {additive: true}}, {},
      {extras: {additive: true, additive_composed: true}}]}}});
    expect(clips.map(clip => clip.blendMode)).toEqual([THREE.AdditiveAnimationBlendMode, THREE.NormalAnimationBlendMode, THREE.NormalAnimationBlendMode]);
  });
  it('does not let additive scale tracks multiply actor dimensions', () => {
    const f = fixture(), layer = new THREE.AnimationClip('animation/anims/world/gesture_idle_ak47', 1,
      [new THREE.VectorKeyframeTrack('spine_2.scale', [0, 1], [1, 1, 1, 1, 1, 1])], THREE.AdditiveAnimationBlendMode);
    f.animator.addGestureClips([layer]);
    for (let n = 0; n < 10; n++) f.animator.update(actor(), .1);
    expect(f.spine.scale.toArray()).toEqual([1, 1, 1]); f.animator.dispose();
  });
  it('carries a posed weapon with procedural wrist aim without cumulative drift', () => {
    const f = fixture(); f.animator.dispose();
    const hand = new THREE.Bone(), pivot = new THREE.Bone(); hand.name = 'hand_R'; pivot.name = 'wpnPivot';
    hand.position.set(0, .1, .1); f.spine.add(hand); f.model.add(pivot);
    const idle = new THREE.AnimationClip('animation/anims/world/idle_rifle', 0, [
      new THREE.QuaternionKeyframeTrack('spine_2.quaternion', [0], [0, 0, 0, 1]),
      new THREE.VectorKeyframeTrack('wpnPivot.position', [0], [0, 1.4, .1]),
      new THREE.QuaternionKeyframeTrack('wpnPivot.quaternion', [0], [0, 0, 0, 1]),
    ]);
    const animator = new DuelAnimator(f.model, [idle], 0, 'ak47'), a = actor();
    animator.update(a, 0); const relative = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(pivot.matrixWorld);
    a.pitch = .8;
    for (let n = 0; n < 100; n++) animator.update(a, 1 / 60);
    const aimed = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(pivot.matrixWorld);
    expect(Math.max(...relative.elements.map((value, index) => Math.abs(value - aimed.elements[index])))).toBeLessThan(1e-6);
    a.pitch = 0; animator.update(a, 0);
    expect(pivot.position.distanceTo(new THREE.Vector3(0, 1.4, .1))).toBeLessThan(1e-6); animator.dispose();
  });
  it.each([-.6, .6])('completes physical pitch %s through both arm chains without detaching the gun or accumulating it', pitch => {
    const f = fixture(); f.animator.dispose();
    const low = new THREE.Bone(), middle = new THREE.Bone(); low.name = 'spine_0'; middle.name = 'spine_1';
    f.hip.remove(f.spine); f.hip.add(low); low.add(middle); middle.add(f.spine);
    const shoulders = ['L', 'R'].map(side => {
      const shoulder = new THREE.Bone(), hand = new THREE.Bone();
      shoulder.name = `clavicle_${side}`; hand.name = `hand_${side}`;
      shoulder.position.set(side === 'L' ? -.15 : .15, 0, 0); hand.position.set(0, 0, .35);
      f.spine.add(shoulder); shoulder.add(hand); return {shoulder, hand};
    });
    const pivot = new THREE.Bone(); pivot.name = 'wpnPivot'; pivot.position.set(.15, 1.3, .35); f.model.add(pivot);
    const bones = [low, middle, f.spine, f.head, ...shoulders.map(value => value.shoulder), pivot];
    const clip = new THREE.AnimationClip('animation/anims/world/idle_rifle', 0, bones.flatMap(bone => [
      new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0], bone.quaternion.toArray()),
      new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0], bone.position.toArray()),
    ]));
    const animator = new DuelAnimator(f.model, [clip], 0, 'ak47'), a = {...actor(), yaw: .8};
    f.model.rotation.y = a.yaw - Math.PI; animator.update(a, 0);
    const grip = new THREE.Matrix4().copy(shoulders[1].hand.matrixWorld).invert().multiply(pivot.matrixWorld);
    a.pitch = pitch;
    const expected = new THREE.Vector3(-Math.sin(a.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(a.yaw) * Math.cos(pitch));
    for (let frame = 0; frame < 100; frame++) animator.update(a, 1 / 60);
    for (const bone of [f.head, ...shoulders.map(value => value.hand), pivot]) {
      const actual = new THREE.Vector3(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
      expect(actual.angleTo(expected)).toBeLessThan(1e-6);
    }
    const relative = new THREE.Matrix4().copy(shoulders[1].hand.matrixWorld).invert().multiply(pivot.matrixWorld);
    expect(Math.max(...grip.elements.map((value, index) => Math.abs(value - relative.elements[index])))).toBeLessThan(1e-6);
    a.pitch = 0; animator.update(a, 0);
    expect(pivot.position.distanceTo(new THREE.Vector3(.15, 1.3, .35))).toBeLessThan(1e-6);
    animator.dispose();
  });
  it('captures the current posed skeleton and solves prop contacts only when opted in', () => {
    const f = fixture(), a = actor(); f.animator.update(a, 0);
    const before = f.head.getWorldPosition(new THREE.Vector3()).y;
    a.alive = false; f.animator.setDeathWorld({floor: 0, boxes: []}); f.animator.update(a, 0);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(before);
    for (let n = 0; n < 180; n++) f.animator.update(a, 1 / 60);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThanOrEqual(.12 - 1e-5);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(before); f.animator.dispose();
  });
  it('ignores late gesture loads and actions after disposal', () => {
    const f = fixture(); f.animator.dispose(); f.animator.dispose();
    f.animator.addGestureClips([new THREE.AnimationClip('animation/anims/world/presentation/gesture_draw_ak47', 1, [])]);
    expect(f.animator.playAction('ak47', 'reload')).toBe(false);
    f.animator.update(actor(), 1);
    expect(f.hip.position.y).toBe(1);
  });
  it('keeps the unverified native recovery disabled without moving the actor or accumulating contact IK', () => {
    const f = plantFixture(), snapshot = structuredClone(f.a), root = f.model.position.clone();
    expect(f.state.plant).toBeUndefined();
    expect((f.animator as unknown as {plantFeet: unknown[]}).plantFeet).toHaveLength(0);
    for (let n = 0; n < 12; n++) f.animator.update(f.a, .01);
    const toe = f.model.getObjectByName('ball_L')!.getWorldPosition(new THREE.Vector3());
    for (let n = 0; n < 10; n++) f.animator.update(f.a, 0);
    expect(f.state.plant).toBeUndefined();
    expect(f.model.getObjectByName('ball_L')!.getWorldPosition(new THREE.Vector3()).distanceTo(toe)).toBeLessThan(1e-6);
    expect(f.a).toEqual(snapshot); expect(f.model.position.distanceTo(root)).toBe(0);
    for (let n = 0; n < 70; n++) f.animator.update(f.a, .01);
    expect(f.state.plant).toBeUndefined(); expect(f.hip.position.y).toBeCloseTo(1); f.animator.dispose();
  });
  it.each(['pistol', 'knife', 'zeus', 'crouch', 'air', 'health-tag', 'armor-tag', 'death', 'generation', 'turn', 'step', 'boost'])(
    'does not activate the unverified recovery on %s, including zero-time authoritative samples', reason => {
      const f = plantFixture(); f.animator.update(f.a, .02); expect(f.state.plant).toBeUndefined();
      if (reason === 'pistol') f.a.equipment = 'usp';
      if (reason === 'knife' || reason === 'zeus') f.a.equipment = reason;
      if (reason === 'crouch') f.a.duckAmount = .2;
      if (reason === 'air') f.a.grounded = false;
      if (reason === 'health-tag') f.a.health = 99;
      if (reason === 'armor-tag') f.a.armor = 90;
      if (reason === 'death') f.a.alive = false;
      if (reason === 'generation') f.a.generation++;
      if (reason === 'turn') f.a.yaw += .3;
      if (reason === 'step') f.a.feet += .2;
      if (reason === 'boost') f.a.supportingActor = 2;
      f.animator.update(f.a, 0); expect(f.state.plant).toBeUndefined();
      f.animator.dispose();
    });
});
