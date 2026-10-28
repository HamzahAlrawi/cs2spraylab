import {afterEach, describe, expect, it, vi} from 'vitest';
import {RangeAudio, type NativeEvent} from './audio';

const event = (url: string, volume = 1): NativeEvent => ({samples: [url], volume, pitch: 1});
function fixture(events: Record<string, NativeEvent> = {}, missing: string[] = []) {
  const sources: {start: ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>; playbackRate: {value: number}}[] = [];
  const gains: {gain: {value: number}}[] = [], requests: string[] = [];
  const param = () => ({value: 1, setValueAtTime() {}});
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  class Context {
    state = 'running'; currentTime = 0; destination = node();
    resume = async () => {}; close = async () => {};
    createDynamicsCompressor = () => ({...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param()});
    decodeAudioData = async () => ({numberOfChannels: 1});
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
