import {expect, it} from 'vitest';
import {Mesh} from 'three';
import {ReplayScene} from './replay-scene';
import {CombatReplay, type ReplayShot} from './combat-replay';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';

it('renders the same orientation-correct analytic fallback used by hits when native poses are unavailable', () => {
  const target = new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 1, testArena()).snapshot()[1];
  target.yaw = Math.PI / 2;
  const shot: ReplayShot = {id: 1, tick: 1, time: 0, shooter: 0, weapon: 'ak47', range: 100,
    origin: {x: 0, y: 1.4, z: 4}, direction: {x: 0, y: 0, z: -1}, aimDirection: {x: 0, y: 0, z: -1},
    targets: [{actor: target}], contacts: []};
  const replay = new CombatReplay(1); replay.shot(shot);
  const scene = new ReplayScene(); scene.show(replay.export(), shot, 0);
  const meshes = scene.group.children.filter(node => node instanceof Mesh);
  expect(meshes).toHaveLength(6);
  expect(meshes.slice(1).every(node => node.rotation.y === target.yaw)).toBe(true);
  scene.dispose(); expect(scene.group.children).toHaveLength(0);
});
