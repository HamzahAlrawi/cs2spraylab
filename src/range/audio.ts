import type {Equipment} from './equipment';
import type {Vec} from './actor-physics';
import {AcousticScene, AcousticReverb, positionListener, retainSoundOcclusion, spatialChain, type SpatialSound, type SpatialAudioProfile} from './spatial-audio';
import {ActionSoundTimeline, curveGain, footstepEventKey, inverseDistanceGain, sampleIndex, type ActorSoundState, type SoundAction, type SoundTimelines} from './sound-model';

export type NativeEvent = {samples: string[]; volume: number; pitch: number; distanceCurve?: number[][];
  impactSpeedCurve?:number[][];delay?: number; source?: string; tracks?: {samples:string[]}[]; dependencies?: NativeEvent[]};
function eventSamples(event:NativeEvent,depth=0):string[] {
  if(depth>4)return [];
  return [...(event.tracks?.flatMap(track=>track.samples)??event.samples),
    ...(event.dependencies?.flatMap(child=>eventSamples(child,depth+1))??[])];
}
export type RangeAudioProfile = SpatialAudioProfile & {nativeDistanceCurves?: boolean; reverb?: boolean; propagationDelay?: boolean};
export class RangeAudio {
  context?: AudioContext;
  buffers = new Map<Equipment, AudioBuffer>();
  pending = new Map<Equipment, Promise<void>>();
  voices = new Set<AudioBufferSourceNode>();
  disposed = false;
  status: 'locked' | 'ready' | 'unavailable' = 'locked';
  private samples = new Map<string, AudioBuffer>();
  private decoding = new Map<string, Promise<void>>();
  private mono = new WeakMap<AudioBuffer, AudioBuffer>();
  private events: Record<string, NativeEvent> = {};
  private manifest?: Promise<void>;
  private common?: Promise<void>;
  private utilityBank?: Promise<void>;
  private stepLoads = new Map<string, Promise<void>>();
  private previous = new Map<string, number>();
  private listenerPose = '';
  private listenerPosition: Vec = {x: 0, y: 0, z: 0};
  private master?: DynamicsCompressorNode;
  private flashFilter?: BiquadFilterNode;
  private lastFlashExposure = -1;
  private voiceCleanup = new Map<AudioBufferSourceNode, () => void>();
  private utilityVoices = new Map<AudioBufferSourceNode, number>();
  private utilityCue?: {owner:number;duration?:number};
  private timelines: SoundTimelines = {};
  private actionSounds = new ActionSoundTimeline();
  private actorSounds = new Map<string | number, {volume: number; spatial?: SpatialSound}>();
  private acoustics?: AcousticScene;
  private reverb?: AcousticReverb;

  constructor(private readonly profile: RangeAudioProfile = {}) {}

  /** Allocate silently while loading; only a trusted gesture resumes playback. */
  prepare() {
    try {this.createContext(); return true;} catch {return false;}
  }
  private createContext() {
    const Constructor = window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Constructor || this.disposed) throw new Error('Web Audio unavailable');
    this.context ??= new Constructor({latencyHint: 'interactive'});
    if (!this.master) {
      this.master = this.context.createDynamicsCompressor();
      this.master.threshold.value = -3; this.master.knee.value = 0; this.master.ratio.value = 12;
      this.master.attack.value = .003; this.master.release.value = .08;
      if (typeof this.context.createBiquadFilter === 'function') {
        this.flashFilter=this.context.createBiquadFilter();this.flashFilter.type='lowpass';this.flashFilter.frequency.value=20000;
        this.master.connect(this.flashFilter);this.flashFilter.connect(this.context.destination);
      } else this.master.connect(this.context.destination);
      this.reverb = new AcousticReverb(this.context, this.master);
    }
  }
  private async unlockContext() {
    this.createContext();
    await this.context!.resume();
  }

  /** Strict, opt-in loading for drills that must not silently play missing samples. */
  async unlockEvents(keys: string[]) {
    try {
      await this.unlockContext();
      if (!Object.keys(this.events).length) {
        const response = await fetch('/audio/events.json');
        if (!response.ok) throw new Error('Native audio manifest unavailable');
        this.readManifest(await response.json());
      }
      const urls = [...new Set(keys.flatMap(key => {
        const event = this.events[key];
        if (!event || !eventSamples(event).length) throw new Error(`Native audio unavailable: ${key}`);
        return eventSamples(event);
      }))];
      for (let i = 0; i < urls.length; i += 4) await Promise.all(urls.slice(i, i + 4).map(url => this.decode(url)));
      if (this.disposed || this.context?.state !== 'running') return false;
      this.status = 'ready'; return true;
    } catch {this.status = 'unavailable'; return false;}
  }

  async unlock(weapon: Equipment) {
    try {
      if (this.disposed || !(window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext)) return;
      await this.unlockContext();
      this.manifest ??= fetch('/audio/events.json').then(async response => {
        if (response.ok) this.readManifest(await response.json());
      }).catch(() => {});
      await this.manifest;
      this.common ??= this.preload(Object.keys(this.events).filter(key =>
        /^(combat-|hit-|hurt-|impact-|death$)/.test(key) || /^(step|land)-(concrete|wood|metal)$/.test(key)));
      if (!this.pending.has(weapon)) this.pending.set(weapon, this.load(weapon));
      await Promise.all([this.pending.get(weapon), this.common]);
      if (!this.disposed) this.status = 'ready';
    } catch {this.status = 'unavailable'; this.pending.delete(weapon);}
  }
  private readManifest(data: {events: Record<string, NativeEvent>; timelines?: SoundTimelines}) {
    this.events = data.events; this.timelines = data.timelines ?? {};
    this.actionSounds.setTimelines(this.timelines);
  }
  /** Utilities are optional; gun-only drills must not fetch/decode the grenade bank. */
  async preloadUtilities() {
    if (this.disposed) return;
    this.createContext();
    this.manifest ??= fetch('/audio/events.json').then(async response => {
      if (response.ok) this.readManifest(await response.json());
    }).catch(() => {});
    await this.manifest;
    if (this.disposed) return;
    this.utilityBank ??= this.preload(Object.keys(this.events).filter(key => key.startsWith('utility-')));
    await this.utilityBank;
  }
  private async decode(url: string) {
    if (this.samples.has(url)) return;
    const pending = this.decoding.get(url); if (pending) return pending;
    const job = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Missing audio: ${url}`);
      const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
      if (!this.disposed) this.samples.set(url, buffer);
    })();
    this.decoding.set(url, job);
    try {await job;} finally {this.decoding.delete(url);}
  }
  private async preload(keys: string[]) {
    const urls = [...new Set(keys.flatMap(key => this.events[key] ? eventSamples(this.events[key]) : []))];
    for (let i = 0; i < urls.length; i += 4) await Promise.all(urls.slice(i, i + 4).map(url => this.decode(url).catch(() => {})));
  }
  private async load(weapon: Equipment) {
    await this.preload([weapon, `${weapon}-reload`, `${weapon}-draw`, `${weapon}-scope-in`, `${weapon}-scope-out`,
      ...Object.values(this.timelines[weapon] ?? {}).flatMap(timeline => timeline?.cues.map(cue => cue.key) ?? []),
      ...(weapon === 'knife' ? ['knife-stab', 'knife-hit', 'knife-wall', 'knife-draw'] : [])]);
    let buffer = this.samples.get(this.events[weapon]?.samples[0]);
    if (!buffer) {await this.decode(`/audio/${weapon}.wav`); buffer = this.samples.get(`/audio/${weapon}.wav`);}
    if (buffer) this.buffers.set(weapon, buffer);
  }
  updateListener(position: Vec, yaw: number, pitch: number) {
    this.listenerPosition = {...position};
    if (!this.context || this.disposed) return;
    const pose = `${position.x.toFixed(3)},${position.y.toFixed(3)},${position.z.toFixed(3)},${yaw.toFixed(4)},${pitch.toFixed(4)}`;
    if (pose === this.listenerPose) return;
    this.listenerPose = pose; positionListener(this.context, position, yaw, pitch);
  }
  private monoBuffer(buffer: AudioBuffer) {
    if (buffer.numberOfChannels === 1) return buffer;
    let mono = this.mono.get(buffer);
    if (!mono) {
      mono = this.context!.createBuffer(1, buffer.length, buffer.sampleRate);
      const data = mono.getChannelData(0);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const channel = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] += channel[i] / buffer.numberOfChannels;
      }
      this.mono.set(buffer, mono);
    }
    return mono;
  }
  private emit(buffer: AudioBuffer, volume: number, pitch: number, spatial?: SpatialSound, pan = 0, delay = 0) {
    if (!this.context || this.context.state !== 'running' || !Number.isFinite(volume) || volume <= 0 || this.disposed) return false;
    if (this.voices.size >= 24) {const oldest = this.voices.values().next().value!; oldest.stop(); this.voiceCleanup.get(oldest)?.();}
    const voice = this.context.createBufferSource(), gain = this.context.createGain();
    voice.buffer = spatial ? this.monoBuffer(buffer) : buffer; voice.playbackRate.value = pitch;
    gain.gain.value = Math.max(0, Math.min(1, volume)); voice.connect(gain);
    const chain = spatial ? spatialChain(this.context, spatial, this.profile) : undefined;
    const stereo = !spatial && pan ? this.context.createStereoPanner() : undefined;
    if (chain) {gain.connect(chain.input); chain.output.connect(this.master!);}
    else if (stereo) {stereo.pan.value = pan; gain.connect(stereo); stereo.connect(this.master!);}
    else gain.connect(this.master!);
    if (this.profile.reverb !== false && (spatial?.path?.reverb || spatial?.reverb)) {
      (chain?.output ?? gain).connect(this.reverb!.input(spatial?.path?.reverb ?? spatial!.reverb!));
    }
    this.voices.add(voice);
    const cleanup = () => {voice.disconnect(); gain.disconnect(); stereo?.disconnect(); chain?.dispose(); this.voices.delete(voice); this.voiceCleanup.delete(voice);this.utilityVoices.delete(voice);};
    this.voiceCleanup.set(voice, cleanup); voice.onended = cleanup;
    const startsAt=this.context.currentTime + delay + (this.profile.propagationDelay === false ? 0 : spatial?.path?.delay ?? 0);
    voice.start(startsAt);
    if(this.utilityCue){this.utilityVoices.set(voice,this.utilityCue.owner);
      if(this.utilityCue.duration!==undefined)voice.stop(startsAt+this.utilityCue.duration);}
    return true;
  }
  playEvent(key: string, volume: number, spatial?: SpatialSound, pan = 0) {
    const event = this.events[key];
    if (key.endsWith('-scope-out') || !event || !Number.isFinite(volume) || volume <= 0) return false;
    if (spatial && this.acoustics && !spatial.path) spatial = {...spatial,
      path: this.acoustics.resolve(this.listenerPosition, spatial.position, this.context?.currentTime ?? 0)};
    if (spatial?.path && spatial.occluded) spatial={...spatial,path:retainSoundOcclusion(spatial.path,true)};
    return this.playNativeEvent(event,key,volume,spatial,pan);
  }
  private playNativeEvent(event:NativeEvent,key:string,volume:number,spatial?:SpatialSound,pan=0,depth=0) {
    if(depth>4)return false;
    let played=false;
    const distance = spatial?.path?.distance ?? (spatial ? Math.hypot(spatial.position.x - this.listenerPosition.x,
      spatial.position.y - this.listenerPosition.y, spatial.position.z - this.listenerPosition.z) : 0);
    const mapped = spatial && event.distanceCurve && this.profile.nativeDistanceCurves !== false;
    const pathMapped = !!spatial?.path && !mapped;
    const attenuation = mapped ? curveGain(distance / .0254, event.distanceCurve!) : pathMapped ? inverseDistanceGain(distance) : 1;
    for(const [track,samples] of (event.tracks?.map(t=>t.samples)??[event.samples]).entries()) {
      if(!(event.volume>0))continue;
      const available=samples.map((url,index)=>this.samples.has(url)?index:-1).filter(index=>index>=0);
      if(!available.length)continue;
      const trackKey=`${key}:${track}`,previous=available.indexOf(this.previous.get(trackKey)??-1);
      const index=available[sampleIndex(available.length,previous<0?undefined:previous,Math.random())];
      this.previous.set(trackKey,index);
      played=this.emit(this.samples.get(samples[index])!,volume*event.volume*attenuation,event.pitch,
        (mapped||pathMapped)&&spatial?{...spatial,distanceMapped:true}:spatial,pan,
        Math.max(0,Math.min(1,event.delay??0)))||played;
    }
    // Child sound events have independent gain/pitch/delay. A silent primary
    // (notably lethal helmet feedback) must not mute its flesh and dink layers.
    for(const [index,child] of (event.dependencies??[]).slice(0,8).entries())
      played=this.playNativeEvent(child,`${key}/${index}`,volume,spatial,pan,depth+1)||played;
    return played;
  }
  play(weapon: Equipment, volume: number, spatial?: SpatialSound) {
    if (this.events[weapon]) this.playEvent(weapon, volume * .65, spatial);
    else {
      const buffer = this.buffers.get(weapon); if (buffer) this.emit(buffer, volume * .65, 1, spatial);
    }
  }
  playStep(volume: number, pan = 0, heavy = false, spatial?: SpatialSound, surface = 'concrete') {
    if (this.disposed || this.context?.state !== 'running' || !Number.isFinite(volume) || volume <= 0) return false;
    const key = footstepEventKey(surface, heavy), event = this.events[key];
    if (key.endsWith('-silent') || event && !event.samples.length) return false;
    if (event?.samples.some(url => this.samples.has(url))) return this.playEvent(key, volume, spatial, pan);
    if (event && !this.stepLoads.has(key)) this.stepLoads.set(key, this.preload([key]));
    // A cold/older asset pack keeps an on-time quiet fallback, never a late
    // footstep after movement stopped. Rare banks are not decoded at startup.
    const fallback = `${heavy ? 'land' : 'step'}-${/metal|chainlink|ladder/.test(key) ? 'metal' : /wood/.test(key) ? 'wood' : 'concrete'}`;
    const fallbackVolume = this.events[fallback]?.volume ?? 1;
    return this.playEvent(fallback, volume * Math.min(1, (event?.volume ?? fallbackVolume) / fallbackVolume), spatial, pan);
  }
  playHit(head: boolean, armor: boolean, victim: boolean, volume: number, spatial?: SpatialSound, lethal=false,
    audience:'attacker'|'victim'|'onlooker'=victim?'victim':'attacker') {
    const part=head?armor?'helmet':'head':armor?'armor':'body';
    const native=`combat-${lethal?'kill':'hit'}-${part}-${audience}`;
    if(this.events[native])return this.playEvent(native,volume,spatial);
    return this.playEvent(`${victim?'hurt':'hit'}-${part}`,volume*.55,spatial);
  }
  playBodyContact(speed:number,volume:number,spatial?:SpatialSound,team:'ct'|'t'='ct') {
    if(!Number.isFinite(speed)||speed<=0)return false;
    // Native samples and speed/gain curve; the cosmetic solver's hard/soft
    // classification is an approximation, not a Source 2 collision callback.
    const key=`combat-contact-${team}-${speed>2.35?'hard':'soft'}`,event=this.events[key];
    return this.playEvent(key,volume*(event?.impactSpeedCurve?curveGain(speed/.0254,event.impactSpeedCurve):1),spatial);
  }
  setAcoustics(scene?: AcousticScene) {this.acoustics = scene;}
  /** Call for every actor each simulation frame; local and remote use the same timeline. */
  syncActor(state: ActorSoundState, now: number, volume: number, spatial?: SpatialSound) {
    if (this.disposed) return;
    if (!this.actorSounds.has(state.id) && this.actorSounds.size >= 32) this.removeActor(this.actorSounds.keys().next().value!);
    this.actorSounds.set(state.id, {volume, spatial}); this.actionSounds.sync(state, now);
  }
  startAction(id: string | number, equipment: string, action: SoundAction, now: number,
    options: {duration?: number; local?: boolean; silent?: boolean; volume: number; spatial?: SpatialSound}) {
    if (this.disposed) return false;
    if (!this.actorSounds.has(id) && this.actorSounds.size >= 32) this.removeActor(this.actorSounds.keys().next().value!);
    this.actorSounds.set(id, {volume: options.volume, spatial: options.spatial});
    return this.actionSounds.start(id, equipment, action, now, options);
  }
  /** Consumer for DuelEvent.action. Time is simulation seconds, never the raw tick number. */
  playAction(id: string | number, equipment: string, action: string, now: number,
    options: {duration?: number; local?: boolean; silent?: boolean; volume: number; spatial?: SpatialSound}) {
    if (options.silent || this.disposed) {this.cancelAction(id); return false;}
    if (action === 'reload-cancel') {this.cancelAction(id); return false;}
    if (action === 'reload-mode') return false;
    if (action === 'reload-shell') return this.playEvent(`${equipment}-reload-shell`, options.volume, options.spatial);
    if (action === 'reload-start' && !this.timelines[equipment]?.['reload-start']) action = 'reload';
    if (action === 'reload-end' && !this.timelines[equipment]?.['reload-end']) {this.cancelAction(id); return false;}
    if (action === 'zeus-discharge') return false; // Physical fire already plays discharge.
    if (action === 'zeus-ready') return this.playEvent('zeus-ready', options.volume, options.spatial);
    if (action === 'scope-in' || action === 'scope-out' || action === 'zoom-in' || action === 'zoom-out')
      return this.playScope(equipment, action.endsWith('-in'), options.volume, options.spatial);
    if (action === 'knife-hit' || action === 'knife-wall' || action === 'knife-stab')
      return this.playKnife(action.slice(6) as 'hit' | 'wall' | 'stab', options.volume, options.spatial);
    if (action === 'cancel') {this.cancelAction(id); return false;}
    if (!['reload', 'reload-empty', 'reload-start', 'reload-loop', 'reload-end', 'draw', 'inspect', 'fire', 'fire-alt', 'charge'].includes(action)) return false;
    return this.startAction(id, equipment, action as SoundAction, now, options);
  }
  updateActions(now: number) {
    let played = 0;
    for (const cue of this.actionSounds.update(now)) {
      const actor = this.actorSounds.get(cue.actorId);
      if (actor && this.playEvent(cue.key, actor.volume, actor.spatial)) played++;
    }
    return played;
  }
  cancelAction(id: string | number) {this.actionSounds.cancel(id);}
  removeActor(id: string | number) {this.actionSounds.remove(id); this.actorSounds.delete(id);}
  playScope(equipment: string, entering: boolean, volume: number, spatial?: SpatialSound) {
    if (!entering) return false;
    return this.playEvent(`${equipment}-scope-${entering ? 'in' : 'out'}`, volume, spatial);
  }
  playKnife(kind: 'slash' | 'stab' | 'hit' | 'wall' | 'draw', volume: number, spatial?: SpatialSound) {
    return this.playEvent(kind === 'slash' ? 'knife' : `knife-${kind}`, volume, spatial);
  }
  playImpact(surface: 'concrete' | 'metal' | 'wood' | 'glass', volume: number, spatial?: SpatialSound) {
    return this.playEvent(`impact-${surface}`, volume, spatial);
  }
  playUtility(kind: 'he' | 'flash' | 'smoke' | 'molotov' | 'incendiary' | 'decoy',
    action: 'throw' | 'bounce' | 'detonate' | 'decoy' | 'extinguish', volume: number, spatial?: SpatialSound, sound?: string) {
    if (this.disposed || this.context?.state !== 'running' || !Number.isFinite(volume) || volume <= 0 || sound === 'silent') return false;
    const cue = sound ?? action;
    const key = cue.startsWith('utility-') ? cue : cue === 'extinguish' ? 'utility-extinguish' :
      cue === 'decoy-end' ? 'utility-decoy-end' : cue === 'decoy' ? 'utility-decoy-decoy' :
      cue === 'ignite' ? `utility-${kind}-detonate` : /^(he|flash|smoke)$/.test(cue) ? `utility-${cue}-detonate` :
      `utility-${kind}-${cue}`;
    const event = this.events[key];
    const audibleSamples = (native: NativeEvent, depth = 0): string[] => depth > 4 ? [] : [
      ...(native.volume > 0 ? native.tracks?.flatMap(track => track.samples) ?? native.samples : []),
      ...(native.dependencies?.flatMap(child => audibleSamples(child, depth + 1)) ?? []),
    ];
    const urls = event ? audibleSamples(event) : [];
    // Preserve authored silence/attenuation. Missing banks get an on-time quiet
    // impact only; never queue a delayed utility cue after a replay/mute change.
    if (event && (!urls.length || urls.some(url => this.samples.has(url)))) return this.playEvent(key, volume, spatial);
    return this.playImpact('concrete', volume * .12, spatial);
  }
  async preloadUtilityCues(names: readonly string[]) {
    if(this.disposed)return;
    const wanted=new Set(names);
    await this.preload(Object.keys(this.events).filter(key=>key.startsWith('utility-cue-')&&wanted.has(this.events[key].source??'')));
  }
  playUtilityCue(name: string, volume: number, spatial?: SpatialSound, owner?:number, duration?:number) {
    this.utilityCue=owner===undefined?undefined:{owner,duration:duration!==undefined&&Number.isFinite(duration)?Math.max(.001,duration):undefined};
    try{return this.playEvent(`utility-cue-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,volume,spatial);}
    finally{this.utilityCue=undefined;}
  }
  cancelUtilityCues(owner?:number) {
    for(const [voice,id]of this.utilityVoices)if(owner===undefined||id===owner){
      try{voice.stop();}catch{}this.voiceCleanup.get(voice)?.();
    }
  }
  setFlashExposure(amount: number) {
    const value=Number.isFinite(amount)?Math.max(0,Math.min(1,amount)):0;
    if(!this.context||!this.flashFilter||Math.abs(value-this.lastFlashExposure)<.001)return;
    this.lastFlashExposure=value;
    this.flashFilter.frequency.setTargetAtTime(20000*(1-value)**2+600*value,this.context.currentTime,.025);
  }
  stopVoices() {this.actionSounds.clear(); this.actorSounds.clear(); for (const v of this.voices) {try {v.stop();} catch {} this.voiceCleanup.get(v)?.();}}
  dispose() {this.disposed = true; this.stopVoices(); this.reverb?.dispose(); this.samples.clear(); this.buffers.clear();
    this.pending.clear(); this.stepLoads.clear(); void this.context?.close().catch(() => {});}
}
