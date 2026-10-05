import type {Vec} from './actor-physics';

export type ReverbProfile = 'outdoor' | 'room' | 'warehouse';
export type AcousticPath = {distance: number; gain: number; lowpass: number; delay: number;
  apparentPosition: Vec; routed: boolean; reverb: ReverbProfile};
export type AcousticBox = {center: Vec; size: Vec};
export type SpatialSound = {position: Vec; occluded?: boolean; range?: number; distanceMapped?: boolean;
  path?: AcousticPath; reverb?: ReverbProfile};
export type SpatialAudioProfile = {panningModel?: PanningModelType; monoOutput?: boolean};

export function listenerOrientation(yaw: number, pitch: number) {
  return {
    forward: {x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch)},
    up: {x: Math.sin(yaw) * Math.sin(pitch), y: Math.cos(pitch), z: Math.cos(yaw) * Math.sin(pitch)},
  };
}

export function positionListener(context: BaseAudioContext, position: Vec, yaw: number, pitch: number) {
  const listener = context.listener;
  const {forward, up} = listenerOrientation(yaw, pitch);
  if (listener.positionX) {
    const time = context.currentTime;
    listener.positionX.setValueAtTime(position.x, time); listener.positionY.setValueAtTime(position.y, time);
    listener.positionZ.setValueAtTime(position.z, time);
    listener.forwardX.setValueAtTime(forward.x, time); listener.forwardY.setValueAtTime(forward.y, time);
    listener.forwardZ.setValueAtTime(forward.z, time);
    listener.upX.setValueAtTime(up.x, time); listener.upY.setValueAtTime(up.y, time); listener.upZ.setValueAtTime(up.z, time);
  } else {
    listener.setPosition(position.x, position.y, position.z);
    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

export function spatialChain(context: BaseAudioContext, sound: SpatialSound, profile: SpatialAudioProfile = {}) {
  const panner = context.createPanner();
  panner.panningModel = profile.panningModel ?? 'HRTF'; panner.distanceModel = 'inverse';
  panner.refDistance = 3; panner.maxDistance = sound.range ?? 55; panner.rolloffFactor = sound.distanceMapped ? 0 : .7;
  const position = sound.path?.apparentPosition ?? sound.position;
  panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = sound.path?.lowpass ?? (sound.occluded ? 1600 : 18000);
  filter.Q.value = .3;
  const gain = context.createGain(); gain.gain.value = sound.path?.gain ?? (sound.occluded ? .58 : 1);
  filter.connect(gain); gain.connect(panner);
  // Downmix after spatialization, then let the destination duplicate the mono signal.
  const mono = profile.monoOutput ? context.createGain() : undefined;
  if (mono) {mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers'; panner.connect(mono);}
  return {input: filter, output: mono ?? panner, dispose: () => {filter.disconnect(); gain.disconnect(); panner.disconnect(); mono?.disconnect();}};
}

const axes = ['x', 'y', 'z'] as const;
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function blocked(a: Vec, b: Vec, box: AcousticBox) {
  let near = 0, far = 1;
  for (const axis of axes) {
    const d = b[axis] - a[axis], min = box.center[axis] - box.size[axis] / 2, max = min + box.size[axis];
    if (Math.abs(d) < 1e-9) {if (a[axis] <= min || a[axis] >= max) return false; continue;}
    const x = (min - a[axis]) / d, y = (max - a[axis]) / d;
    near = Math.max(near, Math.min(x, y)); far = Math.min(far, Math.max(x, y));
    if (far <= near) return false;
  }
  return far > .001 && near < .999;
}

/** Small visibility graph around nearby solid corners, not Source 2 acoustic portals. */
export class AcousticScene {
  private boxes: AcousticBox[] = [];
  private cache = new Map<string, {at: number; value: AcousticPath}>();
  computations = 0;
  constructor(boxes: readonly AcousticBox[] = [], readonly reverb: ReverbProfile = 'outdoor') {this.setBoxes(boxes);}
  setBoxes(boxes: readonly AcousticBox[]) {
    this.boxes = boxes.slice(0, 128).map(box => ({center: {...box.center}, size: {...box.size}}));
    this.cache.clear();
  }
  resolve(listener: Vec, source: Vec, now = 0): AcousticPath {
    const key = [listener, source].flatMap(p => axes.map(axis => Math.round(p[axis] * 4))).join(',');
    const cached = this.cache.get(key);
    if (cached && now >= cached.at && now - cached.at < .1) return {...cached.value, apparentPosition: {...cached.value.apparentPosition}};
    this.computations++;
    const direct = distance(listener, source);
    const blockers = this.boxes.filter(box => blocked(source, listener, box));
    let value: AcousticPath = {distance: direct, gain: 1, lowpass: 18000,
      delay: Math.min(.18, direct / 343), apparentPosition: {...source}, routed: false, reverb: this.reverb};
    if (blockers.length) {
      const nodes: Vec[] = [{...source}, {...listener}];
      for (const box of blockers.slice(0, 3)) {
        const y = Math.max(source.y, listener.y);
        for (const x of [-1, 1]) for (const z of [-1, 1]) nodes.push({
          x: box.center.x + x * (box.size.x / 2 + .08), y,
          z: box.center.z + z * (box.size.z / 2 + .08)});
        nodes.push({x: box.center.x, y: box.center.y + box.size.y / 2 + .08, z: box.center.z});
      }
      const costs = nodes.map(() => Infinity), parents = nodes.map(() => -1), visited = new Set<number>();
      costs[0] = 0;
      for (let step = 0; step < nodes.length; step++) {
        let best = -1;
        for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (best < 0 || costs[i] < costs[best])) best = i;
        if (best < 0 || !Number.isFinite(costs[best]) || best === 1) break;
        visited.add(best);
        for (let i = 0; i < nodes.length; i++) {
          if (visited.has(i) || this.boxes.some(box => blocked(nodes[best], nodes[i], box))) continue;
          const cost = costs[best] + distance(nodes[best], nodes[i]);
          if (cost < costs[i]) {costs[i] = cost; parents[i] = best;}
        }
      }
      const routed = Number.isFinite(costs[1]) && costs[1] <= direct * 1.8 + 3;
      const length = routed ? costs[1] : direct;
      value = {distance: length, gain: routed ? Math.max(.2, .72 * Math.exp(-(length - direct) * .08)) : .32,
        lowpass: routed ? 4800 : 1300, delay: Math.min(.18, length / 343),
        apparentPosition: {...(routed ? nodes[parents[1]] : source)}, routed, reverb: this.reverb};
    }
    if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, {at: now, value});
    return {...value, apparentPosition: {...value.apparentPosition}};
  }
  get cacheSize() {return this.cache.size;}
  clear() {this.cache.clear();}
}

export const reverbTaps: Record<ReverbProfile, readonly (readonly [number, number])[]> = {
  outdoor: [[.043, .045], [.083, .025]],
  room: [[.029, .13], [.061, .09], [.113, .055]],
  warehouse: [[.067, .16], [.137, .11], [.229, .075]],
};

/** Shared, feed-forward early reflections: no convolution, per-voice IR, or feedback loop. */
export class AcousticReverb {
  private buses = new Map<ReverbProfile, {input: GainNode; nodes: AudioNode[]}>();
  constructor(private context: BaseAudioContext, private output: AudioNode) {}
  input(profile: ReverbProfile) {
    const old = this.buses.get(profile); if (old) return old.input;
    const input = this.context.createGain(), filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 4200; input.connect(filter);
    const nodes: AudioNode[] = [input, filter];
    for (const [seconds, level] of reverbTaps[profile]) {
      const delay = this.context.createDelay(.3), gain = this.context.createGain();
      delay.delayTime.value = seconds; gain.gain.value = level;
      filter.connect(delay); delay.connect(gain); gain.connect(this.output); nodes.push(delay, gain);
    }
    this.buses.set(profile, {input, nodes}); return input;
  }
  dispose() {for (const bus of this.buses.values()) for (const node of bus.nodes) node.disconnect(); this.buses.clear();}
}
