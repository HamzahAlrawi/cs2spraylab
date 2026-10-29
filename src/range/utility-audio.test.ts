import {afterEach, describe, expect, it, vi} from 'vitest';
import {RangeAudio, type NativeEvent} from './audio';

const event = (url: string, volume = 1): NativeEvent => ({samples: [url], volume, pitch: 1});
function fixture(events: Record<string, NativeEvent> = {}, missing: string[] = []) {
  const sources: {start: ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>; playbackRate: {value: number}; loop?:boolean;loopStart?:number;loopEnd?:number}[] = [];
  const gains: {gain: {value: number}}[] = [], requests: string[] = [];
  const param = () => ({value: 1, setValueAtTime() {}});
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  class Context {
    state = 'running'; currentTime = 0; destination = node();
    resume = async () => {}; close = async () => {};
    createDynamicsCompressor = () => ({...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param()});
    decodeAudioData = async () => ({numberOfChannels: 1, duration: 2});
    createGain = () => {const gain = {...node(), gain: param()}; gains.push(gain); return gain;};
    createBiquadFilter = () => ({...node(), frequency: param(), Q: param()});
    createPanner = () => ({...node(), positionX: param(), positionY: param(), positionZ: param()});
    createBufferSource = () => {
      const source = {...node(), playbackRate: param(), start: vi.fn(), stop: vi.fn()}; sources.push(source); return source;
    };
  }
  vi.stubGlobal('window', {AudioContext: Context});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(url);
    return {ok: !missing.includes(url), arrayBuffer: async () => new ArrayBuffer(1),
      json: async () => ({events: {ak47: event('/gun.wav'), 'impact-concrete': event('/impact.wav'), ...events}})};
  }));
  return {audio: new RangeAudio({reverb: false}), sources, gains, requests};
}
afterEach(() => vi.unstubAllGlobals());

describe('utility audio', () => {
  it('loads raw, mixed-case and prefixed cues before any gun unlock, sharing one manifest', async () => {
    const {audio, requests, sources} = fixture({'utility-cue-hegrenade-pullpin': {...event('/pin.wav'), source:'HEGrenade.PullPin'},
      'utility-fire-loop': {...event('/burn.wav'), source:'Inferno.Loop'}});
    await Promise.all([audio.preloadUtilityCues([' hegrenade.pullpin ', 'UTILITY-CUE-HEGRENADE-PULLPIN']),
      audio.preloadUtilityCues(['inferno.loop'])]);
    expect(requests.filter(url=>url==='/audio/events.json')).toHaveLength(1);
    expect(requests.filter(url=>url==='/pin.wav')).toHaveLength(1);
    expect(audio.playUtilityCue('UTILITY-CUE-HEGRENADE-PULLPIN',1)).toBe(true);
    expect(audio.playUtilityCue('inferno.loop',1)).toBe(true);
    expect(audio.playUtilityCue('WPN_ACTION_COMPLETE',1)).toBe(false);
    expect(sources).toHaveLength(2);audio.dispose();
  });
  it('retries failed manifest/sample loads, without replaying stale cues',async()=>{
    const missing=['/audio/events.json','/pin.wav'];
    const {audio,sources,requests}=fixture({'utility-he-pin':event('/pin.wav')},missing);
    await expect(audio.preloadUtilities()).rejects.toThrow(/manifest/);
    missing.splice(0,1);await audio.preloadUtilities();
    expect(audio.playUtilityCue('utility-he-pin',1)).toBe(false);
    missing.length=0;await audio.preloadUtilities();
    expect(sources).toHaveLength(0);
    expect(requests.filter(url=>url==='/pin.wav')).toHaveLength(2);
    expect(audio.playUtilityCue('utility-he-pin',1)).toBe(true);audio.dispose();
  });
  it('uses exported sample loops only for owned cues, deduplicates sustain and independently stops world/actor voices',async()=>{
    const loop:NativeEvent={...event('/loop.wav'),tracks:[{samples:['/loop.wav'],samplePlayback:[{loop:{start:.1,end:1.8}}]}]};
    const {audio,sources}=fixture({'utility-cue-molotov-idleloop':loop,'utility-fire-loop':loop,'utility-fire-end':event('/end.wav')});
    await audio.preloadUtilities();
    expect(audio.playUtilityCue('Molotov.IdleLoop',1,undefined,0)).toBe(true);
    expect(sources[0].loop).toBe(true);expect(sources[0].loopStart).toBe(.1);expect(sources[0].loopEnd).toBe(1.8);
    audio.playUtilityCue('Molotov.IdleLoop',1,undefined,0);expect(sources).toHaveLength(1);
    audio.playUtilityCue('utility-fire-loop',1,undefined,'fire:1',6);
    audio.playUtilityCue('utility-fire-end',1,undefined,'fire:1');
    expect(sources[1].stop).toHaveBeenCalledWith(6);
    audio.stopUtilityLoops('fire:1');expect(sources[1].stop).toHaveBeenCalledWith();
    expect(sources[0].stop).not.toHaveBeenCalled();expect(sources[2].stop).not.toHaveBeenCalled();
    audio.cancelUtilityCues(0);expect(sources[0].stop).toHaveBeenCalledWith();
    audio.playUtilityCue('Molotov.IdleLoop',1);expect(sources[3].loop).not.toBe(true);
    audio.playUtilityCue('Molotov.IdleLoop',1,undefined,2,undefined,{loop:false});expect(sources[4].loop).not.toBe(true);
    audio.stopVoices();expect(audio.voices.size).toBe(0);audio.dispose();
  });
  it('rejects expired/nonfinite cues and invalid loop bounds, and does not infer looping from a name',async()=>{
    const {audio,sources}=fixture({'utility-fire-loop':event('/one-shot.wav'),
      'utility-molotov-idle':{...event('/invalid.wav'),tracks:[{samples:['/invalid.wav'],samplePlayback:[{loop:{start:0,end:10}}]}]}});
    await audio.preloadUtilities();
    for(const duration of [0,-1,NaN,Infinity])expect(audio.playUtilityCue('utility-fire-loop',1,undefined,0,duration)).toBe(false);
    audio.playUtilityCue('utility-fire-loop',1,undefined,0);
    audio.playUtilityCue('utility-molotov-idle',1,undefined,0);
    expect(sources).toHaveLength(2);expect(sources.every(s=>!s.loop)).toBe(true);audio.dispose();
  });
  it('preserves utility native gain above unity and does not apply an empty distance curve as silence',async()=>{
    const {audio,gains}=fixture({'utility-flash-throw':{...event('/throw.wav',1.4),distanceCurve:[]}});
    await audio.preloadUtilities();
    expect(audio.playUtility('flash','throw',1,{position:{x:0,y:0,z:0}})).toBe(true);
    expect(gains[0].gain.value).toBe(1.4);audio.dispose();
  });
  it('cancels only the interrupted actor presentation and bounds duration-event voices',async()=>{
    const {audio,sources}=fixture({'utility-cue-hegrenade-pullpin':event('/pin.wav')});
    await audio.unlock('ak47');await audio.preloadUtilities();
    audio.playUtilityCue('HEGrenade.PullPin',.5,undefined,1,.3);
    audio.playUtilityCue('HEGrenade.PullPin',.5,undefined,2);
    expect(sources[0].stop).toHaveBeenCalledWith(.3);
    audio.cancelUtilityCues(1);expect(sources[0].stop).toHaveBeenCalledWith();expect(sources[1].stop).not.toHaveBeenCalled();
    audio.cancelUtilityCues();expect(sources[1].stop).toHaveBeenCalledWith();expect(audio.voices.size).toBe(0);
    audio.dispose();
  });
  it('does not download the utility bank for gun-only drills', async () => {
    const {audio, requests} = fixture({'utility-he-detonate': event('/grenade.wav')});
    await audio.unlock('ak47'); expect(requests).not.toContain('/grenade.wav');
    await audio.preloadUtilities(); expect(requests).toContain('/grenade.wav'); audio.dispose();
  });
  it('preloads all utility tracks and children once, and plays native volume, pitch, delay and spatial curve', async () => {
    const native: NativeEvent = {...event('/primary.wav', .6), pitch: 1.1, delay: .05,
      tracks: [{samples: ['/primary.wav', '/alternate.wav']}], distanceCurve: [[0, 1], [1000, 0]],
      dependencies: [event('/child.wav', .2)]};
    const {audio, sources, gains, requests} = fixture({'utility-he-detonate': native});
    await audio.unlock('ak47'); await audio.preloadUtilities(); await audio.preloadUtilities();
    for (const url of ['/primary.wav', '/alternate.wav', '/child.wav']) expect(requests.filter(value => value === url)).toHaveLength(1);
    expect(audio.playUtility('he', 'detonate', .5, {position: {x: 500 * .0254, y: 0, z: 0}})).toBe(true);
    expect(sources).toHaveLength(2); expect(sources[0].start).toHaveBeenCalledWith(.05);
    expect(sources[0].playbackRate.value).toBe(1.1); expect(gains[0].gain.value).toBeCloseTo(.15);
    audio.dispose();
  });
  it('routes all kinds/actions and simulation sound aliases, including pin and decoy end, without engine imports', async () => {
    const keys = ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'] as const;
    const events = Object.fromEntries(keys.flatMap(kind => ['throw', 'bounce', 'detonate', 'pin'].map(action =>
      [`utility-${kind}-${action}`, event(`/${kind}-${action}.wav`)])));
    events['utility-decoy-decoy'] = event('/decoy.wav'); events['utility-decoy-end'] = event('/end.wav');
    events['utility-extinguish'] = event('/extinguish.wav');
    const {audio} = fixture(events); await audio.unlock('ak47'); await audio.preloadUtilities();
    const play = vi.spyOn(audio, 'playEvent');
    for (const kind of keys) for (const action of ['throw', 'bounce', 'detonate'] as const) {
      expect(audio.playUtility(kind, action, .5)).toBe(true);
      expect(play).toHaveBeenLastCalledWith(`utility-${kind}-${action}`, .5, undefined);
    }
    for (const [kind, action, sound, key] of [
      ['molotov', 'detonate', 'ignite', 'utility-molotov-detonate'],
      ['incendiary', 'detonate', 'ignite', 'utility-incendiary-detonate'],
      ['he', 'detonate', 'he', 'utility-he-detonate'],
      ['flash', 'detonate', 'flash', 'utility-flash-detonate'],
      ['smoke', 'detonate', 'smoke', 'utility-smoke-detonate'],
      ['decoy', 'decoy', undefined, 'utility-decoy-decoy'],
      ['decoy', 'detonate', 'decoy-end', 'utility-decoy-end'],
      ['molotov', 'extinguish', undefined, 'utility-extinguish'],
      ['he', 'throw', 'pin', 'utility-he-pin'],
      ['he', 'throw', 'utility-he-pin', 'utility-he-pin'],
    ] as const) {
      expect(audio.playUtility(kind, action, .5, undefined, sound)).toBe(true);
      expect(play).toHaveBeenLastCalledWith(key, .5, undefined);
    }
    audio.dispose();
  });
  it('plays a quiet on-time impact for absent or failed banks without deferred replay', async () => {
    const {audio, sources, gains, requests} = fixture({'utility-smoke-detonate': event('/missing.wav')}, ['/missing.wav']);
    await audio.unlock('ak47'); await audio.preloadUtilities();
    expect(audio.playUtility('he', 'detonate', .5)).toBe(true);
    expect(audio.playUtility('smoke', 'detonate', .5)).toBe(true);
    expect(gains.map(gain => gain.gain.value)).toEqual([.06, .06]);
    audio.stopVoices(); const count = requests.length;
    await Promise.resolve(); await Promise.resolve();
    expect(sources).toHaveLength(2); expect(requests).toHaveLength(count);
    audio.dispose();
  });
  it('does not substitute impacts for native silence, distance attenuation, mute, suspended replay or disposal', async () => {
    const {audio, sources} = fixture({'utility-he-detonate': event('/silent.wav', 0),
      'utility-flash-detonate': {...event('/flash.wav'), distanceCurve: [[0, 1], [100, 0]]},
      'utility-smoke-detonate': {samples: [], volume: 1, pitch: 1}});
    await audio.unlock('ak47'); await audio.preloadUtilities();
    expect(audio.playUtility('he', 'detonate', 1)).toBe(false);
    expect(audio.playUtility('smoke', 'detonate', 1)).toBe(false);
    expect(audio.playUtility('flash', 'detonate', 1, {position: {x: 20, y: 0, z: 0}})).toBe(false);
    for (const volume of [0, -1, NaN, Infinity]) expect(audio.playUtility('decoy', 'decoy', volume)).toBe(false);
    expect(audio.playUtility('he', 'throw', 1, undefined, 'silent')).toBe(false);
    Object.defineProperty(audio.context!, 'state', {value: 'suspended'});
    expect(audio.playUtility('he', 'throw', 1)).toBe(false);
    audio.dispose(); expect(audio.playUtility('he', 'throw', 1)).toBe(false);
    expect(sources).toHaveLength(0);
  });
  it('keeps audible child layers when the native primary is muted and tolerates one missing variant', async () => {
    const {audio, sources, gains} = fixture({'utility-he-detonate': {...event('/silent.wav', 0),
      dependencies: [{samples: ['/missing.wav', '/child.wav'], volume: .3, pitch: 1}] }}, ['/missing.wav']);
    await audio.unlock('ak47'); await audio.preloadUtilities();
    expect(audio.playUtility('he', 'detonate', .5)).toBe(true);
    expect(sources).toHaveLength(1); expect(gains[0].gain.value).toBe(.15);
    audio.dispose();
  });
});
