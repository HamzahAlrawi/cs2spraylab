import * as THREE from 'three';
import {SmokeRenderer} from '../src/range/duel/smoke-render';
import type {UtilityEffect} from '../src/range/duel/utilities';

export function smokeRenderHarness() {
  const renderer = new THREE.WebGLRenderer({preserveDrawingBuffer: true}); renderer.setSize(320, 320);
  renderer.domElement.dataset.smokeTest = 'true'; document.body.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#101010');
  const camera = new THREE.PerspectiveCamera(70, 1, .01, 100); camera.position.set(0, 1.6, 3);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({color: '#ff0000'}));
  board.position.set(0, 1.6, -6); scene.add(board);
  const blocker = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({color: '#00ff00'}));
  blocker.position.set(0, 1.6, 1); blocker.visible = false; scene.add(blocker);
  const cloud: UtilityEffect = {id: 1, kind: 'smoke', actorId: 0, side: 'player', type: 'smoke', position: {x: 0, y: 1.6, z: -1},
    radius: 2.4, startedAt: 0, expiresAt: 20, cells: [], holes: []};
  for (let z = -2; z <= 2; z++) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++)
    if (Math.hypot(x, y, z) * .8 < 2.4) cloud.cells.push({x: x * .8, y: 1.6 + y * .8, z: -1 + z * .8});
  const smoke = new SmokeRenderer();
  const pixel = () => {
    const gl = renderer.getContext(), buffer = new Uint8Array(4); gl.readPixels(160, 160, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
    return [...buffer];
  };
  const render = (time: number, active = true) => {smoke.update(active ? [cloud] : [], time); smoke.render(renderer, scene, camera); return pixel();};
  const empty = render(2, false), dense = render(2);
  cloud.holes = [{from: {x: 0, y: 1.6, z: 4}, to: {x: 0, y: 1.6, z: -7}, radius: .12, startedAt: 2, expiresAt: 2.35}];
  const bullet = render(2.1), healed = render(2.4);
  cloud.holes = [{from: {x: 0, y: 1.6, z: -1}, to: {x: 0, y: 1.6, z: -1}, radius: 3, startedAt: 3, expiresAt: 4}];
  const he = render(3.1);
  cloud.holes = []; blocker.visible = true; const wall = render(4);
  blocker.visible = false; camera.position.z = -1; const interior = render(5);
  camera.position.z = 3; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  (board.material as THREE.MeshBasicMaterial).color.setRGB(4, .2, .1);
  const toneReference = render(6, false);
  cloud.position.x += 30; cloud.cells = cloud.cells.map(cell => ({...cell, x: cell.x + 30}));
  const toneVolume = render(6);
  const result = {empty, dense, bullet, healed, he, wall, interior, toneReference, toneVolume, glError: renderer.getContext().getError()};
  renderer.domElement.dataset.result = JSON.stringify(result); return result;
}
