import {readFileSync} from 'node:fs';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {prepareRapier} from '../rapier-runtime';
import {RigidDeath} from './rigid-death';
import native from './native-ragdoll.json';

// Reuse the shipped skeleton, not a made-up joint arrangement. Mesh decoding,
// textures and installed game files are unnecessary for solver regressions.
function rig(height = 0) {
  const bytes = readFileSync('public/revamp/models/target.glb');
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const joints = new Set<number>(gltf.skins.flatMap((skin: {joints: number[]}) => skin.joints));
  const nodes: THREE.Object3D[] = gltf.nodes.map((node: {name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]}, index: number) => {
    const result = joints.has(index) ? new THREE.Bone() : new THREE.Group(); result.name = node.name ?? '';
    if (node.translation) result.position.fromArray(node.translation);
    if (node.rotation) result.quaternion.fromArray(node.rotation);
    if (node.scale) result.scale.fromArray(node.scale);
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(result.position, result.quaternion, result.scale);
    return result;
  });
  gltf.nodes.forEach((node: {children?: number[]}, i: number) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = new THREE.Group(); root.position.y = height;
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) root.add(nodes[index]);
  root.updateMatrixWorld(true); return root;
}
const hit = {direction: {x: 0, y: 0, z: 1}, headshot: false};
const still = {x: 0, y: 0, z: 0};
const point = (root: THREE.Object3D, name = 'head_0') => root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());

describe('articulated native-rig deaths', () => {
  beforeAll(async () => {await prepareRapier();});
  it('pins the installed source topology, provenance, shape units and anatomical limits', () => {
    expect(native.source).toMatchObject({build: '2000935', unit: .0254,
      sha256: '8993e5f611bc537ff60c994b3b0c49345cfcb7ae379de9b91fb8e271c1f62ce9'});
    expect(native.bodies).toHaveLength(15); expect(native.joints).toHaveLength(14);
    expect(native.bodies.every(body => body.mass > 0 && body.inertiaScale === 7 && body.shapes.length > 0)).toBe(true);
    expect(native.joints.filter(j => j.swing === 0)).toHaveLength(2); // Knees cannot bend sideways.
  });
  it('captures the death pose exactly and keeps rendered joints on the articulated bodies', () => {
    const root = rig(), before = point(root), locals = new Map<string, THREE.Vector3>();
    root.traverse(bone => {if (bone instanceof THREE.Bone && bone.name !== 'pelvis') locals.set(bone.name, bone.position.clone());});
    const death = new RigidDeath(root, {floor: 0}, still, hit);
    try {
      death.update(0); expect(point(root).distanceTo(before)).toBeLessThan(1e-6);
      for (let frame = 1; frame <= 180; frame++) {
        death.update(frame / 60);
        for (const [name, position] of locals) expect(root.getObjectByName(name)!.position.distanceTo(position), name).toBeLessThan(.10);
        const bodies = (death as unknown as {bindings: {bone: THREE.Object3D; body: {translation(): {x: number; y: number; z: number}}}[]}).bindings;
        for (const binding of bodies) expect(point(root, binding.bone.name).distanceTo(new THREE.Vector3().copy(binding.body.translation()))).toBeLessThan(1e-6);
      }
      expect(point(root).y).toBeGreaterThan(-.1); expect(point(root).y).toBeLessThan(.8);
    } finally {death.dispose();}
  });
  it('is deterministic across render rates and replay rewinds', () => {
    const roots = [rig(), rig(), rig()], deaths = roots.map(root => new RigidDeath(root, {floor: 0}, {x: 1, y: 0, z: 0}, hit));
    try {
      for (let frame = 1; frame <= 60; frame++) deaths[0].update(frame / 60);
      for (let frame = 1; frame <= 240; frame++) deaths[1].update(frame / 240);
      deaths[2].update(1.5); deaths[2].update(.2); deaths[2].update(1);
      for (const name of native.bodies.map(body => body.name)) {
        expect(point(roots[0], name).distanceTo(point(roots[1], name))).toBeLessThan(1e-5);
        expect(point(roots[0], name).distanceTo(point(roots[2], name))).toBeLessThan(1e-5);
      }
    } finally {deaths.forEach(death => death.dispose());}
  });
  it('inherits running and jumping momentum instead of sliding the model root by a canned offset', () => {
    const roots = [rig(1), rig(1)], deaths = roots.map((root, i) => new RigidDeath(root, {floor: -10}, i ? {x: 3, y: 3, z: 0} : still, hit));
    try {
      deaths.forEach(death => death.update(.1));
      const [a, b] = deaths.map(death => death.center(new THREE.Vector3()));
      expect(b.x - a.x).toBeGreaterThan(.25); expect(b.y - a.y).toBeGreaterThan(.25);
    } finally {deaths.forEach(death => death.dispose());}
  });
  it('rewinds even when the requested time is less than one fixed step earlier', () => {
    const roots = [rig(), rig()], deaths = roots.map(root => new RigidDeath(root, {floor: 0}, still, hit));
    try {
      deaths[0].update(.1); deaths[0].update(.095); deaths[1].update(.095);
      for (const spec of native.bodies) expect(point(roots[0], spec.name).distanceTo(point(roots[1], spec.name))).toBeLessThan(1e-6);
    } finally {deaths.forEach(death => death.dispose());}
  });
  it('uses supplied native triangles, emits impact contacts and sleeps without further queries', () => {
    const root = rig(2), geometry = new THREE.BoxGeometry(10, .2, 10).translate(0, 1.9, 0);
    const corpseGeometry = vi.fn(() => ({vertices: Float32Array.from(geometry.attributes.position.array), indices: Uint32Array.from(geometry.index!.array)}));
    const contacts = vi.fn(), death = new RigidDeath(root, {floor: -1000, corpseGeometry}, still, hit);
    try {
      death.update(8, contacts);
      expect(point(root).y).toBeGreaterThan(1.9); expect(point(root).y).toBeLessThan(2.8);
      expect(contacts).toHaveBeenCalled(); expect(death.sleeping).toBe(true);
      death.update(8, contacts); expect(corpseGeometry).toHaveBeenCalledTimes(1);
      death.dispose(); death.dispose(); expect(() => death.update(9)).not.toThrow();
    } finally {death.dispose(); geometry.dispose();}
  });
  it('remaps a settled pose after a root transform without dragging the corpse', () => {
    const root = rig(), death = new RigidDeath(root, {floor: 0}, still, hit);
    try {
      death.update(8); const before = point(root);
      root.position.set(3, 2, -4); root.rotation.y = 1;
      death.update(8); expect(point(root).distanceTo(before)).toBeLessThan(1e-5);
    } finally {death.dispose();}
  });
  it('rejects incomplete rigs instead of silently constructing broken anatomy', () => {
    expect(RigidDeath.supported(new THREE.Group())).toBe(false);
  });
  it('does not cull a displaced corpse using stale standing skin bounds, and restores flags on disposal', () => {
    const root = rig(), mesh = new THREE.SkinnedMesh(); root.add(mesh);
    const death = new RigidDeath(root, {floor: 0}, still, hit);
    expect(mesh.frustumCulled).toBe(false); death.dispose(); expect(mesh.frustumCulled).toBe(true);
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
  });
});
