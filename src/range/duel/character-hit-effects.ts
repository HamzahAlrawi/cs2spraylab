import * as THREE from 'three';
import type {Vec} from '../actor-physics';

export type CharacterHitEffect = {
  /** Actual resolved world contact. Do not substitute crosshair or actor center. */
  point: Vec;
  /** World bullet TRAVEL direction; normalized internally. */
  direction: Vec;
  headshot: boolean;
  helmet: boolean;
  lethal: boolean;
};
export type CharacterHitEffectOptions = {
  /** Particle slots, hard capped at 256. Oldest slots are reused on overflow. */
  capacity?: number;
  /** Borrowed textures, never disposed here. Native textures may be supplied by the caller. */
  bloodTexture?: THREE.Texture;
  sparkTexture?: THREE.Texture;
};
type Particle = {sprite: THREE.Sprite; position: THREE.Vector3; velocity: THREE.Vector3;
  age: number; life: number; size: number; opacity: number; gravity: number; stretch: number};
const finite = (v: Vec) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

// No blood/spark atlas is shipped in revamp/textures. Do not recolor the native
// muzzle flame as blood. A tiny analytic mask is the explicit fallback, not a
// claimed Source 2 particle asset. Borrowed native atlases can replace it later.
function impactMask() {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const edge = Math.max(0, 1 - Math.hypot(u, v));
    const at = (y * size + x) * 4;
    pixels[at] = pixels[at + 1] = pixels[at + 2] = 255;
    pixels[at + 3] = Math.round(255 * Math.min(1, edge * 3) ** 1.5);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

/** Cosmetic only: no actor references, raycasts, hitbox registration or root edits.
 * Attach once to a scene, emit once per resolved hit (not per render), update with
 * unpaused seconds, clear on round/replay reset, dispose with the scene. Positions
 * are captured in world space and never follow the victim or camera.
 */
export class CharacterHitEffects {
  readonly group = new THREE.Group();
  private readonly particles: Particle[];
  private readonly fallback?: THREE.DataTexture;
  private readonly blood: THREE.Texture;
  private readonly spark: THREE.Texture;
  private readonly direction = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private cursor = 0;
  private seed = 1;
  private disposed = false;

  constructor(parent: THREE.Object3D, options: CharacterHitEffectOptions = {}) {
    const requested = options.capacity ?? 96;
    const capacity = Number.isFinite(requested) ? Math.max(1, Math.min(256, Math.floor(requested))) : 96;
    if (!options.bloodTexture || !options.sparkTexture) this.fallback = impactMask();
    this.blood = options.bloodTexture ?? this.fallback!; this.spark = options.sparkTexture ?? this.fallback!;
    this.group.name = 'character-hit-effects'; parent.add(this.group);
    this.particles = Array.from({length: capacity}, () => {
      const material = new THREE.SpriteMaterial({map: this.blood, transparent: true, depthWrite: false,
        depthTest: true, toneMapped: false, opacity: 0});
      const sprite = new THREE.Sprite(material); sprite.visible = false;
      sprite.raycast = () => {}; // Effects must never become shot targets.
      this.group.add(sprite);
      return {sprite, position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, life: 0,
        size: 0, opacity: 0, gravity: 0, stretch: 1};
    });
  }
  get activeCount() {return this.particles.reduce((count, p) => count + Number(p.sprite.visible), 0);}
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  emit(hit: CharacterHitEffect) {
    if (this.disposed || !finite(hit.point) || !finite(hit.direction)) return false;
    this.direction.copy(hit.direction);
    if (this.direction.lengthSq() < 1e-12) return false;
    this.direction.normalize();
    this.side.set(0, 1, 0);
    if (Math.abs(this.direction.y) > .95) this.side.set(1, 0, 0);
    this.side.cross(this.direction).normalize(); this.up.crossVectors(this.direction, this.side).normalize();
    this.group.updateWorldMatrix(true, false); this.inverse.copy(this.group.matrixWorld).invert();
    const sparks = hit.headshot && hit.helmet;
    const count = hit.headshot ? hit.lethal ? 10 : 8 : 4;
    for (let i = 0; i < Math.min(count, this.particles.length); i++) {
      const p = this.particles[this.cursor]; this.cursor = (this.cursor + 1) % this.particles.length;
      const metal = sparks && i < 5, flash = metal && i === 0;
      p.age = 0; p.life = flash ? .065 : metal ? .12 + this.random() * .08 : .22 + this.random() * .12;
      p.size = flash ? .16 : metal ? .018 + this.random() * .018 : .028 + this.random() * .035;
      if (hit.headshot && !metal) p.size *= 1.25;
      p.opacity = flash ? .95 : metal ? 1 : .9;
      p.gravity = flash ? 0 : metal ? 5 : 2.5; p.stretch = metal && !flash ? 2.8 : 1;
      p.position.copy(hit.point).addScaledVector(this.direction, -.025);
      p.velocity.copy(this.direction).multiplyScalar(flash ? 0 : metal ? -.5 : -.3 - this.random() * .5)
        .addScaledVector(this.side, (this.random() - .5) * (metal ? 3 : 1.5))
        .addScaledVector(this.up, (this.random() - .35) * (metal ? 2.5 : 1.2));
      if (flash) p.velocity.set(0, 0, 0);
      const material = p.sprite.material;
      material.map = metal ? this.spark : this.blood;
      material.blending = metal ? THREE.AdditiveBlending : THREE.NormalBlending;
      material.color.setHex(metal ? flash ? 0xfff3c4 : 0xffc363 : i % 2 ? 0x9b1821 : 0xc42a30);
      material.rotation = this.random() * Math.PI; material.opacity = p.opacity;
      p.sprite.position.copy(p.position).applyMatrix4(this.inverse);
      p.sprite.scale.set(p.size, p.size * p.stretch, 1); p.sprite.visible = true;
    }
    return true;
  }
  update(dt: number) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.group.updateWorldMatrix(true, false); this.inverse.copy(this.group.matrixWorld).invert();
    for (const p of this.particles) {
      if (!p.sprite.visible) continue;
      const step = Math.min(dt, p.life - p.age); p.age += step;
      if (p.age >= p.life - 1e-9) {p.sprite.visible = false; continue;}
      p.position.addScaledVector(p.velocity, step); p.position.y -= .5 * p.gravity * step * step;
      p.velocity.y -= p.gravity * step;
      const t = p.age / p.life, size = p.size * (1 + t * .6);
      p.sprite.material.opacity = p.opacity * (1 - t) ** 1.4;
      p.sprite.scale.set(size, size * p.stretch, 1);
      p.sprite.position.copy(p.position).applyMatrix4(this.inverse);
    }
  }
  clear() {
    for (const p of this.particles) {p.sprite.visible = false; p.age = p.life;}
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clear(); this.group.removeFromParent();
    for (const p of this.particles) p.sprite.material.dispose();
    this.fallback?.dispose(); this.group.clear();
  }
}
