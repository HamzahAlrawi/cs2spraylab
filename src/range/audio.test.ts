import {afterEach, describe, expect, it, vi} from 'vitest';
import {RangeAudio,type NativeEvent} from './audio';
import {AcousticScene} from './spatial-audio';

function fixture(extraEvents: Record<string, NativeEvent> = {}, missing: string[] = []) {
  const sources: any[] = [], panners: any[] = [], gains: any[] = [], requests: string[] = [];
  const param = () => ({value: 1, setValueAtTime() {}});
  const node = () => ({connect: vi.fn(), disconnect: vi.fn(), gain: param()});
  class Context {
    state = 'running'; currentTime = 0; destination = node(); listener = {setPosition() {}, setOrientation() {}};
    resume = vi.fn(async () => {}); close = vi.fn(async () => {});
    createDynamicsCompressor = () => ({...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param()});
    decodeAudioData = vi.fn(async () => ({numberOfChannels: 1, length: 32, sampleRate: 48000, getChannelData: () => new Float32Array(32)}));
    createGain = () => {const gain = node(); gains.push(gain); return gain;};
    createBiquadFilter = () => ({...node(), frequency: param(), Q: param()});
    createDelay = () => ({...node(), delayTime: param()});
    createPanner = () => {const panner = {...node(), positionX: param(), positionY: param(), positionZ: param()}; panners.push(panner); return panner;};
    createBufferSource = () => {
      const source = {...node(), playbackRate: param(), start: vi.fn(), stop: vi.fn(), onended: undefined}; sources.push(source); return source;
    };
  }
  vi.stubGlobal('window', {AudioContext: Context});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(url);
    return {ok: !missing.includes(url), arrayBuffer: async () => new ArrayBuffer(1), json: async () => ({events: {
      ak47: {samples: ['/sample.wav'], volume: 1, pitch: 1, distanceCurve: [[0, 1], [1000, 0]]},
      out: {samples: ['/sample.wav'], volume: 1, pitch: 1}, in: {samples: ['/sample.wav'], volume: 1, pitch: 1},
      'ak47-scope-in': {samples: ['/sample.wav'], volume: 1, pitch: 1},
      'ak47-scope-out': {samples: ['/sample.wav'], volume: 1, pitch: 1},
      ...extraEvents,
    }, timelines: {ak47: {reload: {duration: 1, cues: [{time: .1, key: 'out'}, {time: .8, key: 'in'}]},
      fire: {duration: .1, cues: []}}}})};
  }));
  return {sources, requests, panners, gains, audio: new RangeAudio()};
}
afterEach(() => vi.unstubAllGlobals());

describe('native audio consumer', () => {
  it('prepares silently before a gesture without resuming, fetching or replacing the audio context', async () => {
    const {audio, requests, sources} = fixture();
    expect(audio.prepare()).toBe(true); const context = audio.context!;
    expect(audio.prepare()).toBe(true); expect(audio.context).toBe(context);
    expect(context.resume).not.toHaveBeenCalled(); expect(requests).toEqual([]); expect(sources).toEqual([]);
    expect(audio.status).toBe('locked');
    await audio.unlock('ak47'); expect(context.resume).toHaveBeenCalledOnce(); expect(audio.status).toBe('ready');
    audio.dispose(); expect(audio.prepare()).toBe(false);
  });
  it('plays the lethal helmet children even when the native primary is silent, without a generic death voice',async()=>{
    const {audio,sources,gains,requests}=fixture({'combat-kill-helmet-attacker':{samples:['/silent.wav'],volume:0,pitch:1,
      dependencies:[{samples:['/flesh.wav'],volume:.3,pitch:1,delay:.05},{samples:['/dink.wav'],volume:.6,pitch:1.1}]}});
    await audio.unlock('ak47');
    expect(requests).toContain('/flesh.wav');expect(requests).toContain('/dink.wav');
    expect(audio.playHit(true,true,false,.5,undefined,true)).toBe(true);
    expect(sources).toHaveLength(2);expect(gains.map(g=>g.gain.value)).toEqual([.15,.3]);
    expect(sources[0].start).toHaveBeenCalledWith(.05);expect(sources[1].playbackRate.value).toBe(1.1);
    audio.dispose();
  });
  it('selects the audience and lethal event rather than inferring armor from rounded damage',async()=>{
    const event=(url:string):NativeEvent=>({samples:[url],volume:1,pitch:1});
    const {audio,sources}=fixture({'combat-hit-helmet-victim':event('/hurt.wav'),
      'combat-kill-body-onlooker':event('/kill.wav')});
    await audio.unlock('ak47');
    expect(audio.playHit(true,true,true,.4)).toBe(true);
    expect(audio.playHit(false,false,false,.4,undefined,true,'onlooker')).toBe(true);
    expect(sources).toHaveLength(2);audio.dispose();
  });
  it('scales corpse contact audio by native impact speed and keeps invalid contacts silent',async()=>{
    const {audio,sources,gains}=fixture({'combat-contact-ct-soft':{samples:['/body.wav'],volume:.6,pitch:1,
      impactSpeedCurve:[[0,0],[100,1]]}});await audio.unlock('ak47');
    expect(audio.playBodyContact(50*.0254,.5)).toBe(true);expect(gains[0].gain.value).toBeCloseTo(.15);
    expect(audio.playBodyContact(NaN,.5)).toBe(false);expect(audio.playBodyContact(0,.5)).toBe(false);
    expect(sources).toHaveLength(1);audio.dispose();
  });
  const step = (samples: string[], volume = 1) => ({samples, volume, pitch: 1, distanceCurve: [[0, 1], [1100, 0]]});
  it('loads uncommon surface banks on demand without late voices or a startup decode fanout', async () => {
    const {audio, sources, requests, gains} = fixture({'step-concrete': step(['/concrete.wav'], .9),
      'step-sand': step(['/sand.wav'], .6), 'step-silent': step([])});
    await audio.unlock('ak47');
    expect(requests).not.toContain('/sand.wav');
    expect(audio.playStep(.4, 0, false, undefined, 'sand')).toBe(true);
    expect(sources).toHaveLength(1); // On-time conservative fallback while the bank warms.
    expect(gains[0].gain.value).toBeCloseTo(.4 * .6);
    audio.stopVoices(); await vi.waitFor(() => expect(requests).toContain('/sand.wav'));
    expect(sources).toHaveLength(1);
    expect(audio.playStep(.4, 0, false, undefined, 'sand')).toBe(true);
    expect(sources).toHaveLength(2);
    expect(audio.playStep(.4, 0, false, undefined, 'silent')).toBe(false);
    expect(audio.playStep(0, 0, false, undefined, 'dirt')).toBe(false);
    expect(sources).toHaveLength(2); audio.dispose();
  });
  it('keeps surviving samples audible when one file fails and falls back for unknown/older surface packs', async () => {
    const {audio, sources} = fixture({'step-concrete': step(['/missing.wav', '/concrete.wav'], .9)}, ['/missing.wav']);
    await audio.unlock('ak47');
    for (let i = 0; i < 8; i++) expect(audio.playStep(.4, 0, false, undefined, 'unrecognized')).toBe(true);
    expect(audio.playStep(.4, 0, false, undefined, 'sand')).toBe(true);
    expect(sources).toHaveLength(9); audio.dispose();
  });
  it('applies native footstep curve, event volume and cover only once and keeps mute silent', async () => {
    const {audio, gains, panners, sources} = fixture({'step-concrete': step(['/concrete.wav'], .9)});
    await audio.unlock('ak47');
    const path = {distance: 550 * .0254, gain: .5, lowpass: 4800, delay: .03,
      apparentPosition: {x: 1, y: 0, z: 0}, routed: true, reverb: 'outdoor' as const};
    expect(audio.playStep(.4, 0, false, {position: {x: 8, y: 0, z: 0}, path})).toBe(true);
    expect(gains[0].gain.value).toBeCloseTo(.4 * .9 * .5);
    expect(gains[1].gain.value).toBe(.5); expect(panners[0].rolloffFactor).toBe(0);
    expect(audio.playStep(0)).toBe(false); expect(sources).toHaveLength(1); audio.dispose();
  });
  it('retains native wall obstruction when a procedural acoustic scene has no boxes',async()=>{
    const {audio,gains,panners}=fixture({'step-concrete':step(['/concrete.wav'],.9)});
    await audio.unlock('ak47');audio.setAcoustics(new AcousticScene());
    audio.playStep(.4,0,false,{position:{x:4,y:0,z:0},occluded:true});
    expect(gains[1].gain.value).toBe(.32);
    expect(panners[0].rolloffFactor).toBe(0);
    audio.dispose();
  });
  it('preloads shared buffers once, emits per-event reload cues and cancels future cues', async () => {
    const {audio, sources, requests} = fixture(); await audio.unlock('ak47');
    expect(requests.filter(url => url === '/sample.wav').length).toBe(1);
    audio.playAction(1, 'ak47', 'reload-start', 0, {volume: .5});
    expect(audio.updateActions(.1)).toBe(1); expect(sources.length).toBe(1);
    audio.playAction(1, 'ak47', 'reload-cancel', .2, {volume: .5});
    expect(audio.updateActions(.8)).toBe(0); audio.dispose();
  });
  it('does not create voices for silence, absent cues, scope-out or an out-of-range native gunshot', async () => {
    const {audio, sources} = fixture(); await audio.unlock('ak47');
    audio.playAction(1, 'ak47', 'reload', 0, {volume: 1, silent: true});
    expect(audio.updateActions(.1)).toBe(0); expect(audio.playEvent('missing', 1)).toBe(false);
    expect(audio.playScope('ak47', false, 1)).toBe(false); expect(audio.playEvent('ak47-scope-out', 1)).toBe(false);
    audio.play('ak47', 1, {position: {x: 60, y: 0, z: 0}}); audio.play('ak47', 0);
    expect(sources.length).toBe(0); audio.dispose();
  });
  it('never doubles physical shot audio via a foley-only native fire timeline', async () => {
    const {audio, sources} = fixture(); await audio.unlock('ak47');
    audio.play('ak47', .5); audio.playAction(1, 'ak47', 'fire', 0, {volume: .5}); audio.updateActions(.1);
    expect(sources.length).toBe(1); audio.dispose();
  });
  it('maps estimated cue attenuation to full acoustic path length, not apparent corner distance', async () => {
    const {audio, panners, gains} = fixture(); await audio.unlock('ak47');
    const path = {distance: 12, gain: .5, lowpass: 4800, delay: .03,
      apparentPosition: {x: 1, y: 0, z: 0}, routed: true, reverb: 'outdoor' as const};
    expect(audio.playEvent('out', 1, {position: {x: 8, y: 0, z: 0}, path})).toBe(true);
    expect(gains[0].gain.value).toBeCloseTo(1 / (1 + .7 * 3));
    expect(gains[1].gain.value).toBe(.5); expect(panners[0].rolloffFactor).toBe(0); audio.dispose();
  });
  it('uses acoustic delay, bounds voices, disconnects stolen/ended resources and clears scheduled actions', async () => {
    const {audio, sources} = fixture(); await audio.unlock('ak47'); audio.setAcoustics(new AcousticScene());
    for (let n = 0; n < 30; n++) audio.play('ak47', .5, {position: {x: 5, y: 0, z: 0}});
    expect(audio.voices.size).toBe(24); expect(sources[0].start).toHaveBeenCalledWith(5 / 343);
    expect(sources[0].disconnect).toHaveBeenCalled(); expect(sources[0].stop).toHaveBeenCalled();
    audio.stopVoices(); expect(audio.voices.size).toBe(0); expect(audio.updateActions(30)).toBe(0); audio.dispose();
  });
});
