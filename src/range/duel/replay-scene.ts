import * as THREE from 'three';
import type {ReplayShot, CombatRecording} from './combat-replay';
import {recordingFrame} from './combat-replay';
import {analyticActorBodyZones} from './actor-hitboxes';
import {actorHeadPoint} from './geometry';

const vector = (v: {x: number; y: number; z: number}) => new THREE.Vector3(v.x, v.y, v.z);
export class ReplayScene {
  readonly group = new THREE.Group();
  private objects: {geometry: THREE.BufferGeometry; material: THREE.Material}[] = [];
  clear() {
    for (const {geometry, material} of this.objects) {geometry.dispose(); material.dispose();}
    this.objects.length = 0; this.group.clear();
  }
  show(recording: CombatRecording, shot: ReplayShot, time: number) {
    this.clear();
    const line = (from: THREE.Vector3, to: THREE.Vector3, color: string, opacity = 1) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      const material = new THREE.LineBasicMaterial({color, transparent: true, opacity, depthTest: false});
      const object = new THREE.Line(geometry, material); object.renderOrder = 20; this.group.add(object);
      this.objects.push({geometry, material});
    };
    const start = vector(shot.origin), extent = Math.min(shot.range, 65);
    const actualContact = shot.contacts.filter(c => c.kind === 'hit' || c.phase !== 'exit')
      .map(c => start.distanceTo(vector(c.point))).sort((a, b) => a - b)[0];
    line(start, vector(shot.aimDirection).multiplyScalar(Math.min(extent, (actualContact ?? extent) + 1)).add(start), '#5eead4', .85);
    for (const direction of shot.pellets ?? [shot.direction])
      line(start, vector(direction).multiplyScalar(Math.min(extent, (actualContact ?? extent) + .2)).add(start), '#fb7185');
    for (const contact of shot.contacts) {
      const geometry = new THREE.SphereGeometry(.045, 8, 6);
      const material = new THREE.MeshBasicMaterial({color: contact.kind === 'hit' ? '#a3e635' : '#f9a8d4', depthTest: false});
      const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(vector(contact.point)); mesh.renderOrder = 21;
      this.group.add(mesh); this.objects.push({geometry, material});
    }
    for (const target of shot.targets) {
      if (!target.pose) {
        const actor = target.actor, yaw = actor.yaw, cy = Math.cos(yaw), sy = Math.sin(yaw);
        const head = actorHeadPoint({...actor.position, y: actor.feet}, actor.duckAmount, yaw);
        const shapes = [{geometry: new THREE.SphereGeometry(.135, 8, 6), point: head, color: '#a3e635', yaw: 0},
          ...analyticActorBodyZones(actor.duckAmount).map(zone => ({
            geometry: new THREE.BoxGeometry(zone.halfWidth * 2, zone.high - zone.low, zone.halfDepth * 2),
            point: {x: actor.position.x + zone.centerX * cy, y: actor.feet + (zone.low + zone.high) / 2,
              z: actor.position.z - zone.centerX * sy}, color: '#60a5fa', yaw}))];
        for (const shape of shapes) {
          const material = new THREE.MeshBasicMaterial({color: shape.color, wireframe: true, depthTest: false, transparent: true, opacity: .55});
          const mesh = new THREE.Mesh(shape.geometry, material); mesh.position.copy(vector(shape.point)); mesh.rotation.y = shape.yaw;
          mesh.renderOrder = 19; this.group.add(mesh); this.objects.push({geometry: shape.geometry, material});
        }
      }
      for (const capsule of target.pose?.capsules ?? []) {
        const a = vector(capsule.point0), b = vector(capsule.point1), delta = b.clone().sub(a);
        const geometry = new THREE.CapsuleGeometry(capsule.radius, delta.length(), 3, 8);
        const material = new THREE.MeshBasicMaterial({color: capsule.group === 'head' ? '#a3e635' : '#60a5fa',
          wireframe: true, depthTest: false, transparent: true, opacity: .55});
        const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(a.add(b).multiplyScalar(.5));
        if (delta.lengthSq() > 1e-10) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
        mesh.renderOrder = 19; this.group.add(mesh); this.objects.push({geometry, material});
      }
    }
    // The trail is positional history. Only the capsules above represent exact shot-time native poses.
    for (const actor of recordingFrame(recording, time)?.actors ?? []) {
      const from = vector({...actor.position, y: actor.feet}), to = vector(actor.position);
      line(from, to, actor.id === 0 ? '#f8fafc' : '#fb923c', .8);
    }
    for (const [index, frame] of recording.frames.entries()) {
      if (frame.time > time) break;
      const prior = recording.frames[index - 1];
      if (!prior) continue;
      const a = prior.actors[0], b = frame.actors[0];
      if (a && b) line(vector({...a.position, y: a.feet + .04}), vector({...b.position, y: b.feet + .04}), '#f8fafc', .45);
    }
  }
  camera(camera: THREE.PerspectiveCamera, shot: ReplayShot, overview: boolean) {
    const start = vector(shot.origin);
    if (overview) {
      const first = shot.contacts[0]?.point;
      const end = first ? vector(first) : vector(shot.direction).multiplyScalar(12).add(start);
      const center = start.clone().add(end).multiplyScalar(.5), span = Math.min(32, Math.max(7, start.distanceTo(end)));
      camera.position.copy(center).add(new THREE.Vector3(span * .45, span * .8, span * .35));
      camera.lookAt(center);
    } else {camera.position.copy(start); camera.lookAt(start.clone().add(vector(shot.aimDirection)));}
    camera.updateMatrixWorld();
  }
  dispose() {this.clear(); this.group.removeFromParent();}
}
