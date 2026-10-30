import * as THREE from 'three';
import type {UtilityEffect} from './utilities';
import {UTILITY_RULES} from './utilities';
import {buildSmokeDensity, sameSmokeCells, SMOKE_GRID_SIZE, SMOKE_RENDER_STEPS, SMOKE_EXTINCTION, smokeHoleRadius} from './smoke-density';
import {compileRetainedShaders} from '../shader-warmup';

const vertex = `varying vec2 screenUv;
void main(){screenUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;
const fragment = `
precision highp sampler3D;
uniform sampler2D sceneDepth;
uniform sampler3D densityGrid;
uniform sampler3D noiseGrid;
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
uniform vec3 eye;
uniform vec3 boundsMin;
uniform vec3 boundsSize;
uniform vec3 center;
uniform float radius;
uniform float age;
uniform float fade;
uniform int marchSteps;
uniform int holeCount;
uniform vec4 holeFrom[16];
uniform vec3 holeTo[16];
varying vec2 screenUv;
void main(){
  vec4 viewEnd=inverseProjection*vec4(screenUv*2.-1.,texture2D(sceneDepth,screenUv).r*2.-1.,1.);
  vec3 worldEnd=(cameraWorld*vec4(viewEnd.xyz/viewEnd.w,1.)).xyz;
  vec3 ray=normalize(worldEnd-eye);
  vec3 inverseRay=mix(vec3(-1.),vec3(1.),step(vec3(0.),ray))/max(abs(ray),vec3(.000001));
  vec3 a=(boundsMin-eye)*inverseRay, b=(boundsMin+boundsSize-eye)*inverseRay;
  vec3 lo=min(a,b),hi=max(a,b);
  float entry=max(0.,max(lo.x,max(lo.y,lo.z)));
  float exit=min(length(worldEnd-eye),min(hi.x,min(hi.y,hi.z)));
  if(exit<=entry)discard;
  float stride=(exit-entry)/float(marchSteps);
  float transmittance=1.;vec3 light=vec3(0.);
  for(int i=0;i<${SMOKE_RENDER_STEPS};i++){
    if(i>=marchSteps)break;
    vec3 p=eye+ray*(entry+(float(i)+.5)*stride);
    float occupancy=texture(densityGrid,(p-boundsMin)/boundsSize).r;
    float edge=1.-smoothstep(radius-.25,radius+.15,length(p-center));
    if(occupancy<.01||edge<.01)continue;
    float cleared=0.;
    for(int j=0;j<16;j++){
      if(j>=holeCount)break;
      vec3 axis=holeTo[j]-holeFrom[j].xyz;
      float t=clamp(dot(p-holeFrom[j].xyz,axis)/max(dot(axis,axis),.000001),0.,1.);
      float distanceToHole=length(p-holeFrom[j].xyz-axis*t);
      float r=holeFrom[j].w;
      cleared=max(cleared,1.-smoothstep(r*.8,r,distanceToHole));
    }
    float noise=texture(noiseGrid,p*.24+vec3(age*.009,age*.014,age*.006)).r;
    float detail=texture(noiseGrid,p*.71-vec3(0.,age*.018,0.)).r;
    float density=occupancy*edge*(1.-cleared)*(.72+noise*.4+detail*.16)*fade;
    float extinction=1.-exp(-density*stride*${SMOKE_EXTINCTION.toFixed(1)});
    float height=clamp((p.y-center.y)/max(radius,1.)*.5+.5,0.,1.);
    vec3 color=mix(vec3(.20,.215,.225),vec3(.48,.49,.48),height*.6+noise*.4);
    light+=transmittance*extinction*color;
    transmittance*=1.-extinction;
    if(transmittance<.003)break;
  }
  float alpha=1.-transmittance;if(alpha<.003)discard;
  gl_FragColor=vec4(light/max(alpha,.0001),alpha);
  #include <colorspace_fragment>
}`;

function densityTexture(bytes: Uint8Array, n: number, repeat = false) {
  const texture = new THREE.Data3DTexture(bytes, n, n, n);
  texture.format = THREE.RedFormat; texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.unpackAlignment = 1;
  texture.wrapS = texture.wrapT = texture.wrapR = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true; return texture;
}
function noiseTexture() {
  const bytes = new Uint8Array(32 ** 3); let state = 15485863;
  for (let i = 0; i < bytes.length; i++) {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; bytes[i] = state & 255;}
  return densityTexture(bytes, 32, true);
}
type Cloud = {cells: UtilityEffect['cells']; texture: THREE.Data3DTexture; min: THREE.Vector3; size: THREE.Vector3;
  bounds: THREE.Box3; effect: UtilityEffect};

/** Depth-aware world pass. No framebuffer or extra world render when no smoke is active. */
export class SmokeRenderer {
  private readonly clouds = new Map<number, Cloud>();
  private readonly active: Cloud[] = [];
  private readonly noise = noiseTexture();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material = new THREE.ShaderMaterial({vertexShader: vertex, fragmentShader: fragment,
    uniforms: {sceneDepth: {value: null}, densityGrid: {value: null}, noiseGrid: {value: this.noise},
      inverseProjection: {value: new THREE.Matrix4()}, cameraWorld: {value: new THREE.Matrix4()}, eye: {value: new THREE.Vector3()},
      boundsMin: {value: new THREE.Vector3()}, boundsSize: {value: new THREE.Vector3()}, center: {value: new THREE.Vector3()},
      radius: {value: 0}, age: {value: 0}, fade: {value: 1}, marchSteps: {value: SMOKE_RENDER_STEPS}, holeCount: {value: 0},
      holeFrom: {value: Array.from({length: 16}, () => new THREE.Vector4())},
      holeTo: {value: Array.from({length: 16}, () => new THREE.Vector3())}},
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false});
  private readonly blit = new THREE.ShaderMaterial({vertexShader: vertex, fragmentShader:
    `uniform sampler2D image;varying vec2 screenUv;void main(){gl_FragColor=texture2D(image,screenUv);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`, uniforms: {image: {value: null}}, depthTest: false, depthWrite: false, toneMapped: true});
  private readonly mesh = new THREE.Mesh(this.geometry, this.material);
  private target?: THREE.WebGLRenderTarget;
  private readonly drawingSize = new THREE.Vector2();
  private readonly savedViewport = new THREE.Vector4();
  private readonly savedScissor = new THREE.Vector4();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly projected = new THREE.Vector3();
  private readonly seen = new Set<number>();
  private time = 0;
  private disposed = false;
  private preparation?: Promise<void>;

  constructor() {this.mesh.frustumCulled = false; this.scene.add(this.mesh);}
  get count() {return this.active.length;}
  get retainedVolumes() {return this.clouds.size;}
  setQuality(quality: string) {this.material.uniforms.marchSteps.value = quality === 'performance' ? 32 : quality === 'balanced' ? 48 : 64;}
  prepare(renderer: THREE.WebGLRenderer) {
    return this.preparation ??= (async () => {
      if (this.disposed) return;
      this.mesh.material = this.material; await compileRetainedShaders(renderer, this.scene, this.camera);
      if (this.disposed) return;
      this.mesh.material = this.blit;
      try {await compileRetainedShaders(renderer, this.scene, this.camera);}
      finally {this.mesh.material = this.material;}
    })();
  }
  update(effects: readonly UtilityEffect[], time: number) {
    if (this.disposed) return;
    this.time = time; this.active.length = 0; this.seen.clear();
    for (const effect of effects) {
      if (this.active.length >= UTILITY_RULES.maxEffects) break;
      if (effect.type !== 'smoke' || !effect.cells.length || time <= effect.startedAt || time >= effect.expiresAt || this.seen.has(effect.id)) continue;
      this.seen.add(effect.id);
      let cloud = this.clouds.get(effect.id);
      if (!cloud || cloud.effect.radius !== effect.radius || cloud.effect.position.x !== effect.position.x ||
        cloud.effect.position.y !== effect.position.y || cloud.effect.position.z !== effect.position.z || !sameSmokeCells(cloud.cells, effect.cells)) {
        const grid = buildSmokeDensity(effect);
        if (cloud) {cloud.texture.image.data.set(grid.data); cloud.texture.needsUpdate = true;}
        else cloud = {cells: effect.cells, texture: densityTexture(grid.data, SMOKE_GRID_SIZE),
          min: new THREE.Vector3(), size: new THREE.Vector3(), bounds: new THREE.Box3(), effect};
        cloud.cells = effect.cells; cloud.min.copy(grid.min); cloud.size.copy(grid.size);
        cloud.bounds.min.copy(cloud.min); cloud.bounds.max.copy(cloud.min).add(cloud.size);
        this.clouds.set(effect.id, cloud);
      }
      cloud.effect = effect; this.active.push(cloud);
    }
    for (const [id, cloud] of this.clouds) if (!this.seen.has(id)) {cloud.texture.dispose(); this.clouds.delete(id);}
  }

  render(renderer: THREE.WebGLRenderer, world: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (!this.active.length || this.disposed) {renderer.render(world, camera); return;}
    renderer.getDrawingBufferSize(this.drawingSize);
    const width = this.drawingSize.x, height = this.drawingSize.y;
    if (!this.target) this.target = new THREE.WebGLRenderTarget(width, height, {depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType),
      type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter});
    else if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
    const previousTarget = renderer.getRenderTarget(), autoClear = renderer.autoClear, scissorTest = renderer.getScissorTest();
    renderer.getViewport(this.savedViewport); renderer.getScissor(this.savedScissor);
    try {
      renderer.setScissorTest(false); renderer.setRenderTarget(this.target); renderer.autoClear = true;
      renderer.render(world, camera);
      renderer.setRenderTarget(previousTarget); renderer.setViewport(this.savedViewport);
      this.blit.uniforms.image.value = this.target.texture; this.mesh.material = this.blit;
      renderer.render(this.scene, this.camera); renderer.autoClear = false;
      this.mesh.material = this.material;
      const uniforms = this.material.uniforms;
      uniforms.sceneDepth.value = this.target.depthTexture;
      uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      uniforms.cameraWorld.value.copy(camera.matrixWorld); uniforms.eye.value.copy(camera.position);
      this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      // Far-to-near alpha compositing; each volume integrates its own density.
      this.active.sort((a, b) => camera.position.distanceToSquared(b.effect.position) - camera.position.distanceToSquared(a.effect.position));
      for (const cloud of this.active) {
        if (!this.frustum.intersectsBox(cloud.bounds)) continue;
        if (!this.scissor(renderer, cloud, camera)) continue;
        const effect = cloud.effect, age = this.time - effect.startedAt;
        uniforms.densityGrid.value = cloud.texture; uniforms.boundsMin.value.copy(cloud.min); uniforms.boundsSize.value.copy(cloud.size);
        uniforms.center.value.copy(effect.position); uniforms.radius.value = effect.radius * Math.min(1, age / UTILITY_RULES.smokeBloom);
        uniforms.age.value = age + effect.id * 2.71; uniforms.fade.value = Math.min(1, (effect.expiresAt - this.time) / 1.5);
        let holes = 0;
        for (const hole of effect.holes) {
          const radius = smokeHoleRadius(hole, this.time); if (!radius || holes >= 16) continue;
          uniforms.holeFrom.value[holes].set(hole.from.x, hole.from.y, hole.from.z, radius);
          uniforms.holeTo.value[holes++].copy(hole.to);
        }
        uniforms.holeCount.value = holes; renderer.render(this.scene, this.camera);
      }
    } finally {
      renderer.autoClear = autoClear; renderer.setRenderTarget(previousTarget); renderer.setViewport(this.savedViewport);
      renderer.setScissor(this.savedScissor); renderer.setScissorTest(scissorTest);
    }
  }

  private scissor(renderer: THREE.WebGLRenderer, cloud: Cloud, camera: THREE.PerspectiveCamera) {
    let left = 1, right = -1, bottom = 1, top = -1;
    const view = this.savedViewport;
    if (cloud.bounds.containsPoint(camera.position)) {left = bottom = -1; right = top = 1;}
    else for (let i = 0; i < 8; i++) {
      this.projected.set(i & 1 ? cloud.bounds.max.x : cloud.bounds.min.x,
        i & 2 ? cloud.bounds.max.y : cloud.bounds.min.y, i & 4 ? cloud.bounds.max.z : cloud.bounds.min.z);
      this.projected.applyMatrix4(camera.matrixWorldInverse);
      if (this.projected.z >= -camera.near) {left = bottom = -1; right = top = 1; break;}
      this.projected.applyMatrix4(camera.projectionMatrix);
      left = Math.min(left, this.projected.x); right = Math.max(right, this.projected.x);
      bottom = Math.min(bottom, this.projected.y); top = Math.max(top, this.projected.y);
    }
    left = Math.max(-1, left); right = Math.min(1, right); bottom = Math.max(-1, bottom); top = Math.min(1, top);
    if (right <= left || top <= bottom) return false;
    renderer.setScissor(view.x + (left + 1) * .5 * view.z, view.y + (bottom + 1) * .5 * view.w,
      Math.ceil((right - left) * .5 * view.z), Math.ceil((top - bottom) * .5 * view.w)); renderer.setScissorTest(true); return true;
  }
  clear() {this.active.length = 0; for (const cloud of this.clouds.values()) cloud.texture.dispose(); this.clouds.clear();}
  dispose() {
    if (this.disposed) return; this.disposed = true; this.clear(); this.target?.dispose();
    this.material.dispose(); this.blit.dispose(); this.geometry.dispose(); this.noise.dispose();
  }
}
