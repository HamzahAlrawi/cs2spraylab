import {afterEach, describe, expect, it, vi} from 'vitest';
import {RangeAudio} from './audio';
import {AcousticScene} from './spatial-audio';

function fixture() {
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
    return {ok: true, arrayBuffer: async () => new ArrayBuffer(1), json: async () => ({events: {
      ak47: {samples: ['/sample.wav'], volume: 1, pitch: 1, distanceCurve: [[0, 1], [1000, 0]]},
      out: {samples: ['/sample.wav'], volume: 1, pitch: 1}, in: {samples: ['/sample.wav'], volume: 1, pitch: 1},
      'ak47-scope-in': {samples: ['/sample.wav'], volume: 1, pitch: 1},
      'ak47-scope-out': {samples: ['/sample.wav'], volume: 1, pitch: 1},
    }, timelines: {ak47: {reload: {duration: 1, cues: [{time: .1, key: 'out'}, {time: .8, key: 'in'}]},
      fire: {duration: .1, cues: []}}}})};
  }));
  return {sources, requests, panners, gains, audio: new RangeAudio()};
}
afterEach(() => vi.unstubAllGlobals());

describe('native audio consumer', () => {
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
