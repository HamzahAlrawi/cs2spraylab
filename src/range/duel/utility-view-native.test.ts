import {existsSync} from 'node:fs';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {describe, expect, it} from 'vitest';
import {UtilityView} from './utility-view';
import {utilityKinds} from './utility-loadout';

describe.skipIf(!utilityKinds.every(kind => existsSync(`public/revamp/models/view-utility-${kind}.glb`)))('local native grenade attachment regression', () => {
  it.each(utilityKinds)('%s retains its native socket across charge strengths and a 30-second hold', async kind => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), document = await io.read(`public/revamp/models/view-utility-${kind}.glb`);
    // The assertion concerns native skeletal/attachment tracks, not DOM image decoding.
    for (const texture of document.getRoot().listTextures()) texture.dispose();
    const bytes = await io.writeBinary(document), gltf = await new GLTFLoader().parseAsync(bytes.slice().buffer as ArrayBuffer, '');
    const view = new UtilityView(gltf.scene, gltf.animations, kind);
    const anchor = gltf.scene.getObjectByName('wpn')!;
    const rig = gltf.scene.children.find(child => child.getObjectByProperty('type', 'SkinnedMesh')?.userData.native_view_weapon ||
      child.children.some(node => node.userData.native_view_weapon))!;
    expect(anchor).toBeDefined(); expect(rig).toBeDefined();
    for (const name of ['hold-high', 'hold-mid', 'hold-low']) {
      const clip = gltf.animations.find(clip => clip.name === name)!;
      expect(clip.tracks.some(track => track.name.startsWith(rig.name + '.position'))).toBe(true);
      expect(clip.tracks.some(track => track.name.startsWith(rig.name + '.quaternion'))).toBe(true);
    }
    gltf.scene.updateMatrixWorld(true);
    const reference = new THREE.Matrix4().copy(anchor.matrixWorld).invert().multiply(rig.matrixWorld);
    try {
      for (const strength of [0, .25, .5, .75, 1]) for (const time of [.1, .6, .8, 1, 2, 30]) {
        view.update({kind, selectedAt: -2, readyAt: -1, primedAt: 0, strength}, time);
        gltf.scene.updateMatrixWorld(true);
        const relative = new THREE.Matrix4().copy(anchor.matrixWorld).invert().multiply(rig.matrixWorld);
        expect(Math.max(...relative.elements.map((value, index) => Math.abs(value - reference.elements[index])))).toBeLessThan(.00001);
      }
    } finally {view.dispose();}
  });
});
