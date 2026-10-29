import * as THREE from 'three';
import {UtilityRenderer} from '../src/range/duel/utility-render';
import {HE_EXPLOSION_SECONDS} from '../src/range/duel/he-explosion';
import type {UtilityEffect} from '../src/range/duel/utilities';

export async function heExplosionHarness() {
  const renderer = new THREE.WebGLRenderer({preserveDrawingBuffer: true}); renderer.setSize(640, 480);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  document.body.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#929b9f');
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({color: '#6e797c'}));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({color: '#e04a71'}));
  board.position.set(0, 1.5, -5); scene.add(board);
  const blocker = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({color: '#1dcc57'}));
  blocker.position.set(0, 1.6, 8); blocker.visible = false; scene.add(blocker);
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, .01, 100); camera.position.set(0, 1.6, 10); camera.lookAt(0, 1.4, 0);
  const utilities = new UtilityRenderer(scene, new THREE.Group()); await utilities.prepareParticles(); utilities.warmParticleTextures(renderer);
  const effect: UtilityEffect = {id: 3, actorId: 0, side: 'player', kind: 'he', type: 'burst', position: {x: 0, y: .1, z: 0},
    radius: 8, startedAt: 0, expiresAt: HE_EXPLOSION_SECONDS, cells: [], holes: []};
  const frame = (time: number, active = true) => {
    utilities.update([], active ? [effect] : [], time, camera); renderer.render(scene, camera);
    const bytes = new Uint8Array(640 * 480 * 4), gl = renderer.getContext(); gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return bytes;
  };
  const diff = (a: Uint8Array, b: Uint8Array) => {
    let count = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 20) count++; return count;
  };
  const baseline = frame(0, false), flash = frame(.06), cloud = frame(.5), later = frame(.85), tail = frame(2.5);
  const removed = frame(HE_EXPLOSION_SECONDS + .1);
  blocker.visible = true; const blocked = frame(.5), wall = frame(.5, false); blocker.visible = false;
  frame(.5);
  const result = {flash: diff(baseline, flash), smoke: diff(baseline, cloud), moving: diff(cloud, later), tail: diff(baseline, tail),
    removed: diff(baseline, removed), blocked: diff(blocked, wall), glError: renderer.getContext().getError()};
  (window as any).heExplosionFixture = {renderer, utilities, scene, camera, frame}; return result;
}
