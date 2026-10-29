import * as THREE from 'three';
import native from './inferno-presentation-native.json';
import type {UtilityEffect} from './utilities';
import {UTILITY_RULES} from './utilities';
import {infernoParticle, type InfernoLayer} from './inferno-particles';

export const INFERNO_RENDER_CELLS = 24;
type Layer = InfernoLayer;
const layers = Object.keys(native.assets) as Layer[];
const molotovLayers: readonly Layer[] = ['center', 'edge', 'ground', 'embers'];
const incendiaryLayers: readonly Layer[] = ['incendiary', 'edge', 'ground', 'embers'];
const vertex = `attribute float instanceFrame;attribute float instanceLastFrame;attribute float instanceOpacity;
varying vec2 texUv;varying float frame;varying float lastFrame;varying float opacity;
void main(){texUv=uv;frame=instanceFrame;lastFrame=instanceLastFrame;opacity=instanceOpacity;
gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`;
const fragment = `uniform sampler2D atlas;uniform vec2 grid;uniform float overbright;
varying vec2 texUv;varying float frame;varying float lastFrame;varying float opacity;
vec4 sampleFrame(float value){float n=min(value,lastFrame);
vec2 cell=vec2(mod(n,grid.x),grid.y-1.-floor(n/grid.x));
return texture2D(atlas,(cell+clamp(texUv,.003,.997))/grid);}
void main(){vec4 texel=mix(sampleFrame(floor(frame)),sampleFrame(floor(frame)+1.),fract(frame));
float alpha=texel.a*opacity;if(alpha<.015)discard;
gl_FragColor=vec4(texel.rgb*overbright,alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** Snapshot-driven native texture layers, not the Source 2 particle interpreter. */
export class InfernoRenderer {
  readonly group = new THREE.Group();
  private readonly pools = new Map<Layer, {mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    frame: THREE.InstancedBufferAttribute; lastFrame: THREE.InstancedBufferAttribute; opacity: THREE.InstancedBufferAttribute}>();
  private readonly fallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  private readonly textures = new Set<THREE.Texture>();
  private readonly dummy = new THREE.Object3D();
  private job?: Promise<void>;
  private disposed = false;
  constructor() {
    this.fallback.needsUpdate = true; this.group.name = 'inferno-native-layers';
    for (const layer of layers) {
      const asset = native.assets[layer], count = INFERNO_RENDER_CELLS * UTILITY_RULES.maxEffects * 2;
      const geometry = new THREE.PlaneGeometry(1, 1);
      const frame = new THREE.InstancedBufferAttribute(new Float32Array(count), 1), opacity = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
      const lastFrame = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
      frame.setUsage(THREE.DynamicDrawUsage); opacity.setUsage(THREE.DynamicDrawUsage);
      lastFrame.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('instanceFrame', frame); geometry.setAttribute('instanceLastFrame', lastFrame); geometry.setAttribute('instanceOpacity', opacity);
      const material = new THREE.ShaderMaterial({vertexShader: vertex, fragmentShader: fragment,
        uniforms: {atlas: {value: this.fallback}, grid: {value: new THREE.Vector2(asset.columns, asset.rows)}, overbright: {value: asset.presentation.overbright}},
        transparent: true, depthWrite: false, depthTest: true, toneMapped: true,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending});
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = layer === 'center' ? 'utility-fire' : `utility-fire-${layer}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false;
      mesh.renderOrder = layer === 'ground' ? 1 : layer === 'embers' ? 4 : 3; mesh.raycast = () => {};
      mesh.userData.sourceRole = 'installed-groundfire-child-layer'; mesh.userData.nativeParticle = asset.particle;
      this.pools.set(layer, {mesh, frame, lastFrame, opacity}); this.group.add(mesh);
    }
  }
  async prepare() {
    if (this.disposed) return;
    this.job ??= Promise.all(layers.map(async layer => {
      let texture: THREE.Texture;
      try {texture = await new THREE.TextureLoader().loadAsync(native.assets[layer].url);} catch {return;}
      if (this.disposed) {texture.dispose(); return;}
      texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter; this.textures.add(texture);
      this.pools.get(layer)!.mesh.material.uniforms.atlas.value = texture;
    })).then(() => {});
    await this.job;
  }
  warmTextures(renderer: Pick<THREE.WebGLRenderer, 'initTexture'>) {
    for (const texture of this.textures) renderer.initTexture(texture);
  }
  update(effects: readonly UtilityEffect[], time: number, camera: THREE.Camera) {
    if (this.disposed) return;
    this.clear();
    for (let index = 0; index < Math.min(effects.length, UTILITY_RULES.maxEffects); index++) {
      const effect = effects[index];
      if (effect.type !== 'fire' || time <= effect.startedAt || time >= effect.expiresAt) continue;
      const count = Math.min(INFERNO_RENDER_CELLS, effect.cells.length), age = time - effect.startedAt;
      const fade = Math.min(1, age * 7, (effect.expiresAt - time) / .5);
      for (let i = 0; i < count; i++) {
        const cell = effect.cells[Math.floor(i * effect.cells.length / count)];
        for (const layer of effect.kind === 'incendiary' ? incendiaryLayers : molotovLayers) {
          for (let lane = 0; lane < (layer === 'ground' ? 1 : 2); lane++) {
            const pool = this.pools.get(layer)!; if (pool.mesh.count >= pool.frame.count) continue;
            const ground = layer === 'ground', ember = layer === 'embers';
            const particle = infernoParticle(layer, effect.id, i, lane, age); if (!particle) continue;
            const height = ember ? .025 : ground ? 1 : layer === 'edge' ? 1.05 : 1.3;
            const width = ember ? .025 : ground ? 1.6 : layer === 'edge' ? 1.05 : 1.3;
            this.dummy.position.set(cell.x + particle.x, cell.y + (ground ? .012 : ember ? .2 + particle.progress * .85 : height * particle.scale * .36), cell.z + particle.z);
            if (ground) this.dummy.rotation.set(-Math.PI / 2, 0, particle.rotation * 4);
            else {
              this.dummy.quaternion.copy(camera.quaternion);
              if (!ember) this.dummy.rotateZ(particle.rotation);
            }
            this.dummy.scale.set(width * particle.scale, (ground ? width : height) * particle.scale, 1); this.dummy.updateMatrix();
            pool.mesh.setMatrixAt(pool.mesh.count, this.dummy.matrix);
            pool.frame.setX(pool.mesh.count, particle.frame); pool.lastFrame.setX(pool.mesh.count, particle.lastFrame);
            pool.opacity.setX(pool.mesh.count++, fade * particle.opacity);
          }
        }
      }
    }
    for (const {mesh, frame, lastFrame, opacity} of this.pools.values()) if (mesh.count) {
      mesh.instanceMatrix.needsUpdate = frame.needsUpdate = lastFrame.needsUpdate = opacity.needsUpdate = true;
    }
  }
  clear() {for (const {mesh} of this.pools.values()) mesh.count = 0;}
  dispose() {
    if (this.disposed) return; this.disposed = true; this.clear(); this.group.removeFromParent();
    for (const {mesh} of this.pools.values()) {mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose();}
    this.fallback.dispose(); for (const texture of this.textures) texture.dispose(); this.textures.clear(); this.group.clear();
  }
}
