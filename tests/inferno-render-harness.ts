import * as THREE from 'three';
import {InfernoRenderer} from '../src/range/duel/inferno-render';
import type {UtilityEffect} from '../src/range/duel/utilities';

export async function infernoRenderHarness(kind: 'molotov' | 'incendiary') {
  const renderer = new THREE.WebGLRenderer({preserveDrawingBuffer: true}); renderer.setSize(640, 480);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  document.body.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#343c42');
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({color: '#555b5d'}));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, .01, 100); camera.position.set(0, 1.63, 5.5); camera.lookAt(0, .3, 0);
  const fire: UtilityEffect = {id: 2, actorId: 0, side: 'player', kind, type: 'fire', radius: 3,
    position: {x: 0, y: 0, z: 0}, startedAt: 0, expiresAt: 7, cells: [], holes: []};
  for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) if (Math.hypot(x, z) <= 2.2) fire.cells.push({x: x * .8, y: 0, z: z * .8});
  const inferno = new InfernoRenderer(); await inferno.prepare(); scene.add(inferno.group);
  const frame = (time: number) => {
    inferno.update([fire], time, camera); renderer.render(scene, camera);
    const bytes = new Uint8Array(640 * 480 * 4), gl = renderer.getContext(); gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return bytes;
  };
  const first = frame(2), second = frame(2.2); let warm = 0, changed = 0, white = 0;
  for (let at = 0; at < second.length; at += 4) {
    if (second[at] > second[at + 1] + 15 && second[at + 1] > second[at + 2] + 15) warm++;
    if (Math.abs(second[at] - first[at]) + Math.abs(second[at + 1] - first[at + 1]) + Math.abs(second[at + 2] - first[at + 2]) > 30) changed++;
    if (second[at] > 250 && second[at + 1] > 250 && second[at + 2] > 250) white++;
  }
  const glError = renderer.getContext().getError();
  return {warm, changed, white, pixels: 640 * 480, glError};
}
