import * as THREE from 'three';
import {UTILITY_RULES, type UtilityEffect} from './utilities';
import native from './he-explosion-native.json';
import {HE_SMOKE_PARTICLES, heSmokeParticle, type HeSmokeLayer} from './he-explosion';
const layers: readonly HeSmokeLayer[] = ['core', 'ground'];

const vertex = `attribute float instanceFrame;attribute float instanceLastFrame;attribute float instanceOpacity;
varying vec2 texUv;varying float frame;varying float lastFrame;varying float opacity;
void main(){texUv=uv;frame=instanceFrame;lastFrame=instanceLastFrame;opacity=instanceOpacity;
gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`;
const fragment = `uniform sampler2D atlas;uniform vec2 grid;uniform vec3 tint;
varying vec2 texUv;varying float frame;varying float lastFrame;varying float opacity;
vec4 sampleFrame(float value){float n=min(value,lastFrame);
vec2 cell=vec2(mod(n,grid.x),grid.y-1.-floor(n/grid.x));
return texture2D(atlas,(cell+clamp(texUv,.004,.996))/grid);}
void main(){vec4 texel=mix(sampleFrame(floor(frame)),sampleFrame(floor(frame)+1.),fract(frame));
float alpha=texel.a*opacity;if(alpha<.005)discard;
gl_FragColor=vec4(texel.rgb*tint,alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** One retained draw for all HE billows. Never participates in gameplay sight or damage. */
export class HeExplosionRenderer {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly fallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  private readonly frame: THREE.InstancedBufferAttribute;
  private readonly lastFrame: THREE.InstancedBufferAttribute;
  private readonly opacity: THREE.InstancedBufferAttribute;
  private readonly dummy = new THREE.Object3D();
  private texture?: THREE.Texture;
  private job?: Promise<void>;
  private disposed = false;
  constructor() {
    const capacity = HE_SMOKE_PARTICLES * UTILITY_RULES.maxEffects, geometry = new THREE.PlaneGeometry(1, 1);
    this.frame = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.lastFrame = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const attribute of [this.frame, this.lastFrame, this.opacity]) attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('instanceFrame', this.frame); geometry.setAttribute('instanceLastFrame', this.lastFrame); geometry.setAttribute('instanceOpacity', this.opacity);
    this.fallback.needsUpdate = true;
    const color = native.profiles.core.color;
    const material = new THREE.ShaderMaterial({vertexShader: vertex, fragmentShader: fragment,
      uniforms: {atlas: {value: this.fallback}, grid: {value: new THREE.Vector2(native.asset.columns, native.asset.rows)},
        tint: {value: new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255)}},
      transparent: true, depthWrite: false, depthTest: true, toneMapped: true, side: THREE.DoubleSide});
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity); this.mesh.name = 'utility-he-smoke';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.renderOrder = 2; this.mesh.raycast = () => {};
  }
  async prepare() {
    if (this.disposed) return;
    this.job ??= (async () => {
      let texture: THREE.Texture;
      try {texture = await new THREE.TextureLoader().loadAsync(native.asset.url);} catch {return;}
      if (this.disposed) {texture.dispose(); return;}
      texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      this.texture = texture; this.mesh.material.uniforms.atlas.value = texture;
    })();
    await this.job;
  }
  warmTextures(renderer: Pick<THREE.WebGLRenderer, 'initTexture'>) {if (this.texture) renderer.initTexture(this.texture);}
  update(effects: readonly UtilityEffect[], time: number, camera: THREE.Camera) {
    if (this.disposed) return;
    this.mesh.count = 0;
    for (let effectIndex = 0; effectIndex < Math.min(effects.length, UTILITY_RULES.maxEffects); effectIndex++) {
      const effect = effects[effectIndex];
      if (effect.type !== 'burst' || effect.kind !== 'he' || time < effect.startedAt || time >= effect.expiresAt) continue;
      for (const layer of layers) for (let i = 0; i < native.profiles[layer].delays.length; i++) {
        const particle = heSmokeParticle(effect.id, layer, i, time - effect.startedAt); if (!particle) continue;
        this.dummy.position.set(effect.position.x + particle.x, effect.position.y + particle.y, effect.position.z + particle.z);
        this.dummy.quaternion.copy(camera.quaternion); this.dummy.rotateZ(particle.rotation);
        this.dummy.scale.set(particle.size, particle.size, 1); this.dummy.updateMatrix();
        const index = this.mesh.count++; this.mesh.setMatrixAt(index, this.dummy.matrix);
        this.frame.setX(index, particle.frame); this.lastFrame.setX(index, particle.lastFrame); this.opacity.setX(index, particle.opacity);
      }
    }
    if (this.mesh.count) this.mesh.instanceMatrix.needsUpdate = this.frame.needsUpdate = this.lastFrame.needsUpdate = this.opacity.needsUpdate = true;
  }
  clear() {this.mesh.count = 0;}
  dispose() {
    if (this.disposed) return; this.disposed = true; this.clear(); this.mesh.removeFromParent();
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); this.fallback.dispose(); this.texture?.dispose();
  }
}
