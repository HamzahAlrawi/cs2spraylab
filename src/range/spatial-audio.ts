import type {Vec} from './actor-physics';

export type SpatialSound = {position: Vec; occluded?: boolean; range?: number; distanceMapped?: boolean};
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
  panner.positionX.value = sound.position.x; panner.positionY.value = sound.position.y; panner.positionZ.value = sound.position.z;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = sound.occluded ? 1600 : 18000;
  filter.Q.value = .3;
  const gain = context.createGain(); gain.gain.value = sound.occluded ? .58 : 1;
  filter.connect(gain); gain.connect(panner);
  // Downmix after spatialization, then let the destination duplicate the mono signal.
  const mono = profile.monoOutput ? context.createGain() : undefined;
  if (mono) {mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers'; panner.connect(mono);}
  return {input: filter, output: mono ?? panner, dispose: () => {filter.disconnect(); gain.disconnect(); panner.disconnect(); mono?.disconnect();}};
}
