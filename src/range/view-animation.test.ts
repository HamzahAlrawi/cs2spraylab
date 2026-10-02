import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {ViewAnimation} from './view-animation';
import {Simulation} from './simulation';
import {defaults} from './config';
import {MovementLesson} from './lesson-model';
import {groundVelocity, STEP} from './actor-physics';
import {createScenario, angleTo, exposedHead} from './drills';

function viewFixture(names = ['idle', 'reload', 'reload-empty', 'draw', 'inspect']) {
  const root = new THREE.Group(), hand = new THREE.Object3D(), weapon = new THREE.Object3D();
  hand.name = 'hand'; weapon.name = 'weapon'; root.add(hand, weapon);
  const clips = names.map(name => new THREE.AnimationClip(name, name === 'idle' ? 0 : 2, [
    new THREE.NumberKeyframeTrack('hand.position[x]', name === 'idle' ? [0] : [0, 1, 2], name === 'idle' ? [0] : [0, name === 'reload-empty' ? .8 : .4, 0]),
    new THREE.NumberKeyframeTrack('weapon.position[x]', name === 'idle' ? [0] : [0, 1, 2], name === 'idle' ? [1] : [1, name === 'reload-empty' ? 1.8 : 1.4, 1]),
  ]));
  return {hand, weapon, animation: new ViewAnimation(root, clips)};
}

describe('native first-person action runtime', () => {
  it('restarts high-RPM native fire with one mixer evaluation and no intermediate idle', () => {
    const {animation, hand, weapon} = viewFixture(['idle','fire','inspect']);
    const update = vi.spyOn(THREE.AnimationMixer.prototype, 'update');
    try {
      animation.playInspect(); animation.update(0,1,1);
      for (let shot = 0; shot < 50; shot++) {
        update.mockClear();
        expect(animation.playFire('mp9')).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        expect(animation.activeAction).toBe('fire');
        animation.update(0,1,.07);
        expect(hand.position.x).toBeCloseTo(.028);
        expect(weapon.position.x - hand.position.x).toBeCloseTo(1);
      }
      animation.update(0,1,2);
      expect(animation.activeAction).toBe('idle'); expect(hand.position.x).toBe(0);
    } finally {update.mockRestore(); animation.dispose();}
  });
  it('samples short shot presentations at full weight before the tail blend', () => {
    const {animation, hand} = viewFixture(['idle','fire']);
    animation.playFire('ak47', {duration:.07}); animation.update(0,1,.035);
    expect(hand.position.x).toBeCloseTo(.4);
    animation.update(0,1,.035); expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('selects scoped fire and falls back only to an exported native fire clip', () => {
    const scoped = viewFixture(['idle','fire','fire-scoped']).animation;
    expect(scoped.playFire('sg553',{zoomed:true})).toBe(true);
    expect(scoped.activeAction).toBe('fire-scoped'); scoped.dispose();
    const older = viewFixture(['idle','fire']).animation;
    expect(older.playFire('usp',{lastShot:true})).toBe(true); expect(older.activeAction).toBe('fire');
    expect(older.playFire('aug',{zoomed:true})).toBe(true); expect(older.activeAction).toBe('fire'); older.dispose();
    const absent = viewFixture(['idle']).animation;
    expect(absent.playFire('ak47')).toBe(false); expect(absent.playFire('unknown')).toBe(false); absent.dispose();
  });
  it('blends last-shot motion into the native empty pose, not the loaded idle', () => {
    const root = new THREE.Group(), hand = new THREE.Object3D(); hand.name = 'hand'; root.add(hand);
    const animation = new ViewAnimation(root, [
      new THREE.AnimationClip('idle', 0, [new THREE.NumberKeyframeTrack('hand.position[x]',[0],[0])]),
      new THREE.AnimationClip('idle-empty', 0, [new THREE.NumberKeyframeTrack('hand.position[x]',[0],[2])]),
      new THREE.AnimationClip('fire-last', .4, [new THREE.NumberKeyframeTrack('hand.position[x]',[0,.4],[3,2])]),
    ]);
    animation.playFire('glock',{lastShot:true}); animation.update(0,1,.36,{ammo:0});
    expect(hand.position.x).toBeCloseTo(2.05);
    animation.update(0,1,.04,{ammo:0}); expect(hand.position.x).toBeCloseTo(2);
    animation.update(0,1,1,{ammo:0}); expect(hand.position.x).toBe(2);
    animation.update(0,1,0,{ammo:20}); expect(hand.position.x).toBe(0); animation.dispose();
  });
  it('holds the native R8 charge pose until firing, and cancels it on early release',()=>{
    const {animation,hand}=viewFixture(['idle','charge','fire','fire-alt']);
    animation.update(0,1,.1,{charging:true,chargeDuration:.2});
    expect(animation.activeAction).toBe('charge');expect(hand.position.x).toBeCloseTo(.4);
    animation.update(0,1,1,{charging:true,chargeDuration:.2});
    expect(animation.activeAction).toBe('charge');
    animation.update(0,1,0,{charging:false});expect(animation.activeAction).toBe('idle');
    expect(animation.playFire('revolver',{alternate:true})).toBe(true);expect(animation.activeAction).toBe('fire-alt');
    animation.update(0,1,1);expect(hand.position.x).toBeCloseTo(.4);
    animation.dispose();
  });
  it('plays both native Dualies barrels and keeps empty poses separate from gameplay ammo',()=>{
    const {animation,hand}=viewFixture(['idle','fire-left','fire-right-last','idle-left-empty','idle-empty']);
    expect(animation.playFire('elite',{side:'left'})).toBe(true);expect(animation.activeAction).toBe('fire-left');
    animation.update(0,1,1);expect(hand.position.x).toBeCloseTo(.4);
    animation.playFire('elite',{side:'right',lastShot:true});expect(animation.activeAction).toBe('fire-right-last');
    animation.update(0,1,3,{ammo:0});expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('plays inspect at native duration with synchronized arm and weapon tracks', () => {
    const {animation, hand, weapon} = viewFixture();
    expect(animation.playInspect()).toBe(true);
    animation.update(0, 3, 1);
    expect(animation.activeAction).toBe('inspect');
    expect(hand.position.x).toBeCloseTo(.4);
    expect(weapon.position.x - hand.position.x).toBeCloseTo(1);
    animation.update(0, 3, 1);
    expect(animation.activeAction).toBe('idle');
    expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('samples draw against native deploy time and supports replay', () => {
    const {animation, hand} = viewFixture();
    expect(animation.playDraw(1)).toBe(true);
    animation.update(0, 3, .5);
    expect(hand.position.x).toBeCloseTo(.4);
    animation.update(0, 3, .5);
    expect(animation.activeAction).toBe('idle');
    animation.playDraw(1); animation.update(0, 3, .5);
    expect(hand.position.x).toBeCloseTo(.4);
    animation.dispose();
  });
  it('explicitly reuses native draw for pickup when no pickup was exported', () => {
    const {animation} = viewFixture();
    expect(animation.has('pickup')).toBe(false);
    expect(animation.playPickup()).toBe(true);
    expect(animation.activeAction).toBe('draw');
    animation.dispose();
    const own = viewFixture(['idle', 'draw', 'pickup']).animation;
    expect(own.playPickup()).toBe(true); expect(own.activeAction).toBe('pickup'); own.dispose();
  });
  it('reload overrides inspect and prevents an inspect request from restarting it', () => {
    const {animation, hand} = viewFixture();
    animation.playInspect(); animation.update(0, 3, .5);
    animation.update(1.5, 3, .1);
    expect(animation.activeAction).toBe('reload');
    expect(hand.position.x).toBeCloseTo(.4);
    expect(animation.playInspect()).toBe(false);
    animation.update(0, 3, .1);
    expect(animation.activeAction).toBe('idle');
    expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('firing cancellation restores idle immediately and never resumes a canceled inspect', () => {
    const {animation, hand} = viewFixture();
    animation.playInspect(); animation.update(0, 3, 1); animation.cancel();
    expect(hand.position.x).toBe(0); expect(animation.activeAction).toBe('idle');
    animation.update(0, 3, .5); expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('equip cancels an old inspect or reload presentation', () => {
    const {animation} = viewFixture();
    animation.update(1.5, 3);
    expect(animation.playDraw(.8)).toBe(true);
    expect(animation.activeAction).toBe('draw');
    animation.update(0, 3, .8); expect(animation.activeAction).toBe('idle');
    animation.dispose();
  });
  it('selects native empty reload only when available', () => {
    const {animation, hand} = viewFixture();
    animation.update(1.5, 3, 0, {reloadEmpty: true}); expect(hand.position.x).toBeCloseTo(.8);
    animation.dispose();
    const legacy = viewFixture(['idle', 'reload']);
    legacy.animation.update(1.5, 3, 0, {reloadEmpty: true}); expect(legacy.hand.position.x).toBeCloseTo(.4);
    legacy.animation.dispose();
  });
  it('does not invent missing inspect, draw, or reload motion for legacy assets', () => {
    const {animation, hand} = viewFixture(['idle']);
    expect(animation.playInspect()).toBe(false); expect(animation.playDraw()).toBe(false);
    expect(animation.playPickup()).toBe(false);
    animation.update(1.5, 3); expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('handles static idle, invalid timing, and large frame deltas without NaNs', () => {
    const {animation, hand, weapon} = viewFixture();
    for (const [remaining, duration, dt] of [[1, 0, NaN], [NaN, 1, -1], [Infinity, 3, Infinity], [0, 0, 10]]) {
      animation.update(remaining, duration, dt);
      expect(hand.position.x).toBe(0); expect(weapon.position.x).toBe(1);
    }
    expect(animation.playDraw(NaN)).toBe(false); expect(animation.playDraw(-1)).toBe(false);
    animation.playInspect(); animation.update(0, 1, 1000);
    expect(animation.activeAction).toBe('idle'); expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('does not create new action state after disposal', () => {
    const {animation} = viewFixture();
    animation.dispose(); animation.dispose(); animation.cancel(); animation.update(1, 3, .1);
    expect(animation.playInspect()).toBe(false); expect(animation.playDraw()).toBe(false);
    expect(animation.has('idle')).toBe(false);
  });
});

describe('reload and lesson continuity', () => {
  it('maps native reload motion to the weapon duration and restores idle on interruption', () => {
    const root = new THREE.Group(), hand = new THREE.Object3D(); hand.name = 'hand'; root.add(hand);
    const idle = new THREE.AnimationClip('idle', 1, [new THREE.NumberKeyframeTrack('hand.position[x]', [0, 1], [0, 0])]);
    const reload = new THREE.AnimationClip('reload', 2, [new THREE.NumberKeyframeTrack('hand.position[x]', [0, 1, 2], [0, .4, 0])]);
    const animation = new ViewAnimation(root, [idle, reload]);
    animation.update(1.5, 3); expect(hand.position.x).toBeCloseTo(.4);
    animation.update(0, 3); expect(hand.position.x).toBe(0);
    animation.dispose();
  });
  it('blocks range fire during reload and cancels reload when changing slots', () => {
    const sim = new Simulation({...defaults, mode: 'spray'}); sim.active = true;
    expect(sim.reload()).toBe(true); expect(sim.start()).toBe(false);
    for (let n = 0; n < 400; n++) sim.step(STEP);
    expect(sim.primaryReloadAt).toBe(0); expect(sim.start()).toBe(true);
    sim.reload(); sim.equip(2); expect(sim.primaryReloadAt).toBe(0);
  });
  it('keeps tutorial braking identical to the range instead of freezing at the accuracy threshold', () => {
    const lesson = new MovementLesson(0); let speed = 0;
    for (let tick = 0; tick < 100; tick++) {
      const input = tick < 46 ? 1 : speed > .02 ? -1 : 0;
      speed = groundVelocity(speed, 0, lesson.complete ? 0 : input, 0, lesson.cap, STEP).x;
      lesson.update(STEP, input);
      expect(lesson.velocity).toBeCloseTo(speed, 9);
    }
    expect(lesson.complete).toBe(true); expect(Math.abs(lesson.velocity)).toBe(0);
  });
  it.each([1, 2])('allows manual lesson %s to finish with readable persistent feedback', id => {
    const m = new MovementLesson(id);
    while (m.x < -.25) m.update(STEP, 1);
    while (m.velocity > .02) m.update(STEP, -1);
    m.update(.2, 0); m.shoot();
    expect(m.complete).toBe(true);
    const message = m.message;
    for (let n = 0; n < 1000; n++) m.update(STEP, 0);
    expect(m.message).toBe(message);
  });
  it('starts peeking near head height, but requires a small vertical mouse correction', () => {
    for (const r of [.1, .4, .6, .9]) {
      const s = createScenario('peek', 0, 'common', () => r);
      const exact = angleTo({...s.spawn, x: s.spawn.x + s.side * 2.05}, exposedHead(s));
      expect(Math.abs(s.pitch - exact.pitch) * 180 / Math.PI).toBeGreaterThan(.6);
      expect(Math.abs(s.pitch - exact.pitch) * 180 / Math.PI).toBeLessThan(1.2);
    }
  });
});
