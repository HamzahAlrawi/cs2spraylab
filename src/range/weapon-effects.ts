import * as THREE from 'three';
import type {Equipment} from './equipment';
import data from './weapon-fx-data.json';

export function hasTracer(equipment: Equipment, shot: number) {
  const frequency = data.weapons[equipment]?.tracerFrequency ?? 0;
  return !data.weapons[equipment]?.silenced && frequency > 0 && shot % frequency === 0;
}

/** Fixed-size pools: firing never allocates geometry, materials or textures. */
export class MuzzleFlashes {
  readonly sprites: THREE.Sprite[] = [];
  private anchors: (THREE.Object3D | undefined)[];
  private expires: Float64Array;
  private born: Uint32Array;
  private frame = 0;
  private next = 0;
  private point = new THREE.Vector3();
  private texture?: THREE.Texture;
  constructor(private parent: THREE.Object3D, capacity = 8, texture?: THREE.Texture) {
    this.texture = texture ?? (typeof document === 'undefined' ? undefined : new THREE.TextureLoader().load(data.muzzleTexture));
    if (this.texture) this.texture.colorSpace = THREE.SRGBColorSpace;
    this.anchors = Array(capacity); this.expires = new Float64Array(capacity); this.born = new Uint32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: this.texture, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
      sprite.name = 'weapon-muzzle-flame'; sprite.visible = false; sprite.frustumCulled = false;
      parent.add(sprite); this.sprites.push(sprite);
    }
  }
  fire(anchor: THREE.Object3D | undefined, equipment: Equipment, now: number, world = false) {
    if (!anchor || equipment === 'knife') return;
    const index = this.next; this.next = (index + 1) % this.sprites.length;
    this.anchors[index] = anchor; this.expires[index] = now + .045; this.born[index] = this.frame;
    const sprite = this.sprites[index], silenced = data.weapons[equipment]?.silenced;
    sprite.visible = true; sprite.scale.setScalar((silenced ? .026 : .12) * (world ? 1.8 : 1));
    sprite.material.opacity = silenced ? .45 : 1.3;
    sprite.material.rotation = index * 2.39996;
    this.place(index);
  }
  private place(index: number) {
    const anchor = this.anchors[index];
    if (!anchor) return;
    anchor.getWorldPosition(this.point); this.parent.worldToLocal(this.point);
    this.sprites[index].position.copy(this.point);
  }
  update(now: number) {
    for (let i = 0; i < this.sprites.length; i++) if (this.sprites[i].visible) {
      // At 30 FPS even a short native flash must survive its first rendered frame.
      if (now >= this.expires[i] && this.frame > this.born[i]) {this.sprites[i].visible = false; this.anchors[i] = undefined;}
      else this.place(i);
    }
    this.frame++;
  }
  clear() {this.sprites.forEach(sprite => {sprite.visible = false;}); this.anchors.fill(undefined);}
  dispose() {
    this.sprites.forEach(sprite => {sprite.removeFromParent(); sprite.material.dispose();});
    this.texture?.dispose(); this.anchors.fill(undefined);
  }
}

export class ShotEffects {
  readonly tracers: THREE.LineSegments;
  readonly impacts: THREE.InstancedMesh;
  readonly flashes: MuzzleFlashes;
  private tracePositions: THREE.BufferAttribute;
  private traceColors: THREE.BufferAttribute;
  private traceUntil: Float64Array;
  private traceBorn: Uint32Array;
  private traceTint: Float32Array;
  private impactUntil: Float64Array;
  private nextTrace = 0; private nextImpact = 0; private frame = 0;
  private matrix = new THREE.Matrix4();
  private scale = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  constructor(parent: THREE.Object3D, readonly capacity = 64, impactCapacity = 192) {
    this.tracePositions = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.traceColors = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.traceTint = new Float32Array(capacity * 3);
    this.traceUntil = new Float64Array(capacity); this.traceBorn = new Uint32Array(capacity);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', this.tracePositions); geometry.setAttribute('color', this.traceColors);
    this.tracers = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    this.tracers.name = 'batched-weapon-tracers'; this.tracers.frustumCulled = false; this.tracers.visible = false;
    parent.add(this.tracers);
    this.impacts = new THREE.InstancedMesh(new THREE.SphereGeometry(.023, 6, 4), new THREE.MeshBasicMaterial(), impactCapacity);
    this.impacts.name = 'batched-duel-impacts'; this.impacts.frustumCulled = false; this.impacts.count = 0;
    this.impacts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parent.add(this.impacts);
    this.impactUntil = new Float64Array(impactCapacity);
    this.flashes = new MuzzleFlashes(parent);
  }
  trace(equipment: Equipment, shot: number, from: THREE.Vector3, to: THREE.Vector3, now: number, color: THREE.Color) {
    if (!hasTracer(equipment, shot)) return false;
    const index = this.nextTrace; this.nextTrace = (index + 1) % this.capacity;
    this.tracePositions.setXYZ(index * 2, from.x, from.y, from.z);
    this.tracePositions.setXYZ(index * 2 + 1, to.x, to.y, to.z);
    this.tracePositions.needsUpdate = true;
    this.traceUntil[index] = now + .065; this.traceBorn[index] = this.frame;
    this.traceTint[index * 3] = color.r; this.traceTint[index * 3 + 1] = color.g; this.traceTint[index * 3 + 2] = color.b;
    this.tracers.visible = true; this.writeColor(index, .7);
    return true;
  }
  impact(point: THREE.Vector3, size: number, color: THREE.Color, now: number) {
    const index = this.nextImpact; this.nextImpact = (index + 1) % this.impactUntil.length;
    this.matrix.compose(point, this.rotation, this.scale.setScalar(size));
    this.impacts.setMatrixAt(index, this.matrix); this.impacts.setColorAt(index, color);
    this.impacts.instanceMatrix.needsUpdate = true; this.impacts.instanceColor!.needsUpdate = true;
    this.impacts.count = Math.min(this.impacts.count + 1, this.impactUntil.length);
    this.impactUntil[index] = now + 2;
  }
  private writeColor(index: number, alpha: number) {
    const start = index * 3, r = this.traceTint[start] * alpha, g = this.traceTint[start + 1] * alpha, b = this.traceTint[start + 2] * alpha;
    this.traceColors.setXYZ(index * 2, r * .35, g * .35, b * .35);
    this.traceColors.setXYZ(index * 2 + 1, r, g, b); this.traceColors.needsUpdate = true;
  }
  update(now: number) {
    let visible = false;
    for (let i = 0; i < this.capacity; i++) if (this.traceUntil[i]) {
      const remaining = this.traceUntil[i] - now;
      if (remaining <= 0 && this.frame > this.traceBorn[i]) {this.traceUntil[i] = 0; this.writeColor(i, 0);}
      else {visible = true; this.writeColor(i, Math.max(.15, remaining / .065) * .7);}
    }
    this.tracers.visible = visible;
    for (let i = 0; i < this.impacts.count; i++) if (this.impactUntil[i] && now >= this.impactUntil[i]) {
      this.impactUntil[i] = 0; this.matrix.makeScale(0, 0, 0); this.impacts.setMatrixAt(i, this.matrix); this.impacts.instanceMatrix.needsUpdate = true;
    }
    this.flashes.update(now); this.frame++;
  }
  clear() {
    this.traceUntil.fill(0); (this.traceColors.array as Float32Array).fill(0); this.traceColors.needsUpdate = true;
    this.tracers.visible = false; this.impacts.count = 0; this.impactUntil.fill(0);
    this.nextTrace = this.nextImpact = 0; this.flashes.clear();
  }
  dispose() {
    this.tracers.removeFromParent(); this.tracers.geometry.dispose(); (this.tracers.material as THREE.Material).dispose();
    this.impacts.removeFromParent(); this.impacts.geometry.dispose(); (this.impacts.material as THREE.Material).dispose(); this.impacts.dispose();
    this.flashes.dispose();
  }
}
