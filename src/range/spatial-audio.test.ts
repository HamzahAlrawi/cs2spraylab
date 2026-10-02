import {describe, expect, it} from 'vitest';
import {listenerOrientation, spatialChain} from './spatial-audio';

describe('world-space audio listener', () => {
  it('uses the same forward direction as the camera and ballistic model', () => {
    expect(listenerOrientation(0, 0).forward.z).toBe(-1);
    expect(listenerOrientation(Math.PI / 2, 0).forward.x).toBeCloseTo(-1);
    expect(listenerOrientation(0, Math.PI / 4).forward.y).toBeCloseTo(Math.SQRT1_2);
  });
  it('keeps listener up orthogonal during turns and crouch-height changes', () => {
    for (const yaw of [0, .7, Math.PI, 7]) for (const pitch of [-1.3, 0, 1.2]) {
      const {forward: f, up: u} = listenerOrientation(yaw, pitch);
      expect(f.x * u.x + f.y * u.y + f.z * u.z).toBeCloseTo(0);
      expect(Math.hypot(f.x, f.y, f.z)).toBeCloseTo(1);
      expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1);
    }
  });
});

describe('optional hearing spatial profile', () => {
  function context() {
    const panners: any[] = [], gains: any[] = [];
    const node = () => ({connect() {}, disconnect() {}, gain: {value: 1}});
    return {panners, gains, createPanner: () => {
      const p = {...node(), positionX: {value: 0}, positionY: {value: 0}, positionZ: {value: 0}}; panners.push(p); return p;
    }, createBiquadFilter: () => ({...node(), frequency: {value: 0}, Q: {value: 0}}), createGain: () => {
      const g = node(); gains.push(g); return g;
    }};
  }
  it('leaves engine HRTF, distance and stereo defaults unchanged', () => {
    const c = context(); const chain = spatialChain(c as unknown as BaseAudioContext, {position: {x: 8, y: 0, z: -4}});
    expect(c.panners[0]).toMatchObject({panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 3, rolloffFactor: .7});
    expect(chain.output).toBe(c.panners[0]); expect(c.gains.length).toBe(1); chain.dispose();
  });
  it('uses a real selectable panner and explicit mono downmix after it', () => {
    const c = context(); const chain = spatialChain(c as unknown as BaseAudioContext, {position: {x: 8, y: 0, z: 0}}, {panningModel: 'equalpower', monoOutput: true});
    expect(c.panners[0].panningModel).toBe('equalpower');
    expect(chain.output).toMatchObject({channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers'});
    expect(c.gains.length).toBe(2); chain.dispose();
  });
});
