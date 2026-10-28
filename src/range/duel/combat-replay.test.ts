import {describe, expect, it} from 'vitest';
import {CombatReplay, diagnoseShot, recordingActors, recordingBounds, recordingFrame, recordingWorld, type ReplayActor, type ReplayShot} from './combat-replay';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {idleCommand} from './types';
import {testArena} from './geometry';
import {createEnvironmentState, useEnvironmentPiece} from './environment';

function setup() {
  const sim = new DuelSimulation(sanitizeDuelConfig({skill: 3, roundSeconds: 180}), 921, testArena());
  sim.actors[0].position = {x: 0, y: 1.6256, z: 4};
  sim.actors[1].position = {x: 0, y: 1.6256, z: -4};
  sim.command(1, {...idleCommand()});
  return sim;
}
const shot = (): ReplayShot => ({id: 0, tick: 1, time: 1 / 128, shooter: 0, weapon: 'ak47',
  origin: {x: 0, y: 1.4, z: 4}, direction: {x: 1, y: 0, z: 0}, aimDirection: {x: 0, y: 0, z: -1},
  range: 100, targets: [{actor: setup().snapshot()[1]}], contacts: []});

describe('combat replay', () => {
  it('detaches utility draw/prime/release timing and flash, without anticipating future equip or flash onset', () => {
    const replay = new CombatReplay(1), actor: ReplayActor = {...setup().snapshot()[0], flashAmount: 0};
    replay.frame(0, 0, [actor]);
    actor.flashAmount = .9; actor.utility = 'flash';
    actor.utilityState = {kind: 'flash', selectedAt: .5, readyAt: .8, primedAt: .9, releaseAt: 1.3, throwStartedAt: 1.1, drawPlaybackRate: 1.2};
    replay.frame(128, 1, [actor]);
    actor.utilityState = {...actor.utilityState, releaseAt: 99};
    const recording = replay.export();
    expect(recordingActors(recording, .99)[0]).toMatchObject({flashAmount: 0});
    expect(recordingActors(recording, .99)[0].utilityState).toBeUndefined();
    expect(recordingActors(recording, 1)[0].utilityState).toMatchObject({releaseAt: 1.3, throwStartedAt: 1.1, drawPlaybackRate: 1.2});
    recording.frames[1].actors[0].utilityState = undefined;
    expect(replay.export().frames[1].actors[0].utilityState?.releaseAt).toBe(1.3);
  });
  it('transfers a completed recording without retaining mutable aliases in the recorder',()=>{
    const replay=new CombatReplay(1),actor=setup().snapshot()[0];
    replay.frame(0,0,[actor]);replay.input(0,0,idleCommand());replay.shot(shot());
    const recording=replay.release();
    expect(recording.frames).toHaveLength(1);expect(recording.shots).toHaveLength(1);
    expect(replay.frameCount).toBe(0);expect(replay.shotCount).toBe(0);
    replay.contact({kind:'hit',tick:1,shooter:0,victim:1,shotId:0,group:'head',point:{x:0,y:0,z:0},healthDamage:10,armorDamage:0,lethal:false});
    expect(recording.shots[0].contacts).toHaveLength(0);
    replay.frame(4,1,[actor]);recording.frames[0].actors[0].position.x=777;
    expect(replay.export().frames[0].actors[0].position.x).not.toBe(777);
    expect(replay.export().shots).toHaveLength(0);
  });
  it('plays a movement-only recording with interpolated poses and recorded camera angles', () => {
    const replay = new CombatReplay(1), actor: ReplayActor = {...setup().snapshot()[0],
      yaw: Math.PI - .1, bodyYaw: Math.PI - .1, view: {yaw: Math.PI - .1, pitch: .1, roll: .02, fov: 50}};
    replay.frame(0, 0, [actor]);
    replay.frame(4, 1, [{...actor, position: {...actor.position, x: 4}, yaw: -Math.PI + .1,
      bodyYaw: -Math.PI + .1, duckAmount: 1, view: {yaw: -Math.PI + .1, pitch: .3, roll: .04, fov: 50}}]);
    const recording = replay.export(), before = structuredClone(recording);
    const middle = recordingActors(recording, .5)[0];
    expect(recording.shots).toHaveLength(0);
    expect(recordingBounds(recording)).toEqual({first: 0, last: 1});
    expect(middle.position.x).toBe(2); expect(middle.duckAmount).toBe(.5);
    expect(middle.bodyYaw).toBeCloseTo(Math.PI); expect(middle.view?.yaw).toBeCloseTo(Math.PI);
    expect(middle.view?.pitch).toBeCloseTo(.2);
    recordingActors(recording, 1); recordingActors(recording, 0);
    expect(recording).toEqual(before);
  });
  it('does not interpolate an elimination, damage or equipment change before its recorded frame', () => {
    const replay = new CombatReplay(1), actor = setup().snapshot()[0];
    replay.frame(0, 0, [actor]);
    replay.frame(1, .1, [{...actor, alive: false, health: 0, equipment: 'knife'}], undefined, true);
    const recording = replay.export();
    expect(recordingActors(recording, .099)[0]).toMatchObject({alive: true, health: 100, equipment: 'ak47'});
    expect(recordingActors(recording, .1)[0]).toMatchObject({alive: false, health: 0, equipment: 'knife'});
    expect(recordingFrame(recording, .1)?.tick).toBe(1);
  });
  it('captures the terminal frame even when the lethal shot is between regular recording ticks', () => {
    const sim = setup(); sim.actors[0].health = 10000; sim.actors[1].health = 1;
    sim.start(); sim.command(0, {fireHeld: true, firePressed: true});
    for (let tick = 0; tick < 128 && sim.phase === 'fighting'; tick++) sim.step();
    const frames = sim.replay.export().frames, last = frames[frames.length - 1];
    expect(sim.phase).toBe('result'); expect(last.tick).toBe(sim.tick);
    expect(last.actors[1].alive).toBe(false); expect(last.actors[1].health).toBe(0);
  });
  it('keeps the recorded arena and interactive door states detached from the next round', () => {
    const arena = testArena();
    arena.solids.push({id: 'door', center: {x: 0, y: 1, z: 0}, size: {x: 1, y: 2, z: .2},
      interaction: {kind: 'door', openOffset: {x: 2, y: 0, z: 0}, useRadius: 3}});
    const state = createEnvironmentState(arena), replay = new CombatReplay(1);
    replay.world(0, arena, state); replay.frame(0, 0, []);
    const opened = useEnvironmentPiece(arena, state, 'door', {x: 0, y: 1, z: 1}).state;
    replay.world(opened.revision, arena, opened); replay.frame(4, 1, []);
    arena.solids[0].center.x = 50;
    const recording = replay.export();
    expect(recordingWorld(recording, 0)?.solids[0].center.x).toBe(0);
    expect(recordingWorld(recording, 1)?.solids[0]).toMatchObject({center: {x: 2}, passable: true});
    recording.worlds![0].solids.length = 0;
    expect(replay.export().worlds![0].solids).toHaveLength(1);
  });
  it('bounds changing world snapshots to frames and shots still retained', () => {
    const replay = new CombatReplay(1);
    for (let tick = 0; tick < 1800; tick += 4) {replay.world(tick, testArena()); replay.frame(tick, tick / 128, []);}
    const recording = replay.export();
    expect(recording.worlds!.length).toBeLessThanOrEqual(321);
    expect(recording.frames.every(frame => recording.worlds!.some(world => world.revision === frame.world))).toBe(true);
  });
  it('keeps authoritative outcomes detached from moving actor/pose buffers and exports', () => {
    const replay = new CombatReplay(1), input = shot();
    replay.shot(input); input.origin.x = 42; input.targets[0].actor.position.z = 90;
    replay.contact({kind: 'hit', tick: 1, shooter: 0, victim: 1, shotId: 0, group: 'head', point: {x: 0, y: 1.4, z: -4}, healthDamage: 100, armorDamage: 0, lethal: true});
    const first = replay.export(); first.shots[0].contacts.length = 0;
    expect(replay.export().shots[0].origin.x).toBe(0);
    expect(replay.export().shots[0].targets[0].actor.position.z).toBe(-4);
    expect(diagnoseShot(replay.export().shots[0]).label).toBe('Head hit');
  });
  it('bounds frame, shot and input storage over long rounds and excludes old records', () => {
    const replay = new CombatReplay(1);
    for (let tick = 1; tick <= 128 * 45; tick++) {
      replay.frame(tick, tick / 128, []); replay.input(tick, 0, {...idleCommand(), yawDelta: tick});
      if (tick % 8 === 0) replay.shot({...shot(), id: tick, time: tick / 128, tick});
    }
    const result = replay.export();
    expect(result.frames.length).toBeLessThanOrEqual(321);
    expect(result.shots.length).toBeLessThanOrEqual(160);
    expect(result.inputs.length).toBeLessThanOrEqual(1281);
    expect(result.frames.every(frame => frame.time >= 35)).toBe(true);
    expect(recordingFrame(result, 44)?.time).toBeLessThanOrEqual(44);
  });
  it('separates a sampled spread miss from an off-target pre-spread ray', () => {
    const centered = shot();
    expect(diagnoseShot(centered).label).toContain('Spread');
    centered.aimDirection = {x: 1, y: 0, z: 0};
    expect(diagnoseShot(centered).label).toContain('Aim and recoil');
  });
  it('retains held-input baselines when other actors wrap the changed-input ring', () => {
    const replay = new CombatReplay(1);
    replay.input(0, 0, {...idleCommand(), forward: 1});
    for (let tick = 1; tick <= 9000; tick++) replay.input(tick, 1, {...idleCommand(), yawDelta: tick});
    replay.frame(9000, 9000 / 128, []);
    const result = replay.export();
    expect(result.initialInputs.find(input => input.actor === 0)?.command.forward).toBe(1);
    expect(result.initialInputs.find(input => input.actor === 1)?.tick).toBeLessThan((9000 / 128 - 10) * 128);
    expect(result.inputs.every(input => input.tick / 128 >= 9000 / 128 - 10)).toBe(true);
  });
  it('checks every pellet and does not blame an unrelated pellet surface', () => {
    const pellets = shot(); pellets.weapon = 'nova';
    pellets.pellets = [pellets.direction, pellets.aimDirection];
    pellets.contacts.push({kind: 'surface', tick: 1, shooter: 0, shotId: 0,
      point: {x: 1, y: 1.4, z: 4}, surfaceId: 0, phase: 'entry', material: 'wood'});
    expect(diagnoseShot(pellets).label).toBe('Inspect this shot');
  });
  it('identifies an intervening surface instead of blaming aim', () => {
    const blocked = shot(); blocked.direction = {...blocked.aimDirection};
    blocked.contacts.push({kind: 'surface', tick: 1, shooter: 0, shotId: 0, point: {x: 0, y: 1.4, z: 1}, surfaceId: 0, phase: 'entry', material: 'wood'});
    expect(diagnoseShot(blocked).label).toContain('Cover');
  });
  it('reproduces recorded damage for identical seeded inputs without consuming extra RNG', () => {
    const run = () => {
      const sim = setup(); sim.start(); sim.command(0, {fireHeld: true, firePressed: true});
      for (let tick = 0; tick < 128 && sim.phase === 'fighting'; tick++) sim.step();
      return sim.replay.export();
    };
    const a = run(), b = run();
    expect(a.shots.length).toBeGreaterThan(0);
    expect(a.shots).toEqual(b.shots);
    expect(Math.abs(a.shots[0].aimDirection.x)).toBe(0);
    expect(a.shots[0].aimDirection.z).toBe(-1);
    expect(a.shots.flatMap(shot => shot.contacts).some(contact => contact.kind === 'hit')).toBe(true);
  });
});
