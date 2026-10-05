import {describe, expect, it} from 'vitest';
import {equipmentIds} from './equipment';
import soundEvents from './sound-events-data.json';
import {ActionSoundTimeline, curveGain, gunshotGain, gunshotRange, propagatedGunshotGain, propagatedFootstepGain, sampleIndex} from './sound-model';
import {AcousticScene} from './spatial-audio';

describe('native weapon hearing metadata', () => {
  it('covers every equipped weapon with ordered, finite native curve knots', () => {
    expect(Object.keys(soundEvents.weapons).sort()).toEqual([...equipmentIds].sort());
    expect(soundEvents.build).toBe('2000922');
    for (const equipment of equipmentIds) {
      const event = soundEvents.weapons[equipment];
      expect(event.source).toMatch(/^Weapon_/);
      expect(event.volume).toBeGreaterThan(0);
      expect(event.distanceCurve.length).toBeGreaterThan(1);
      event.distanceCurve.forEach(([units, gain], index) => {
        expect(Number.isFinite(units) && Number.isFinite(gain)).toBe(true);
        expect(units).toBeGreaterThanOrEqual(0);
        expect(gain).toBeGreaterThanOrEqual(0);
        if (index) expect(units).toBeGreaterThan(event.distanceCurve[index - 1][0]);
        expect(gunshotGain(equipment, units * .0254)).toBeCloseTo(event.volume * gain, 8);
      });
      expect(gunshotGain(equipment, gunshotRange(equipment) + .01)).toBe(0);
    }
  });

  it('converts metres into native units and interpolates between adjacent knots', () => {
    const event = soundEvents.weapons.ak47;
    const [a, b] = event.distanceCurve.slice(3, 5);
    const units = (a[0] + b[0]) / 2;
    expect(curveGain(units, event.distanceCurve)).toBeCloseTo((a[1] + b[1]) / 2, 8);
    expect(gunshotGain('ak47', units * .0254)).toBeCloseTo(event.volume * (a[1] + b[1]) / 2, 8);
  });

  it('does not assign unsuppressed rifle range to a suppressed weapon', () => {
    expect(gunshotRange('ak47')).toBeCloseTo(2500 * .0254, 8);
    expect(gunshotRange('m4a1s')).toBeLessThan(gunshotRange('ak47'));
    expect(gunshotGain('m4a1s', 40)).toBe(0);
    expect(gunshotGain('ak47', 40)).toBeGreaterThan(.1);
  });
});

describe('per-actor native sound timeline', () => {
  const make = () => new ActionSoundTimeline({ak47: {reload: {duration: 2, cues: [
    {time: .2, key: 'out'}, {time: 1, key: 'in'}, {time: 1.8, key: 'bolt'},
  ]}, draw: {duration: 1, cues: [{time: 0, key: 'gear', audience: 'local'}, {time: .5, key: 'draw'}]}}});
  it('retimes every reload event, emits once, and shares the schedule between local and bot', () => {
    const t = make();
    for (const id of [0, 1]) t.start(id, 'ak47', 'reload', 10, {duration: 3, local: id === 0});
    expect(t.update(10.29)).toEqual([]);
    expect(t.update(10.3).map(c => c.key)).toEqual(['out', 'out']);
    expect(t.update(10.3)).toEqual([]);
    expect(t.update(11.5).map(c => c.key)).toEqual(['in', 'in']);
    expect(t.update(12.7).map(c => c.key)).toEqual(['bolt', 'bolt']);
    expect(t.size).toBe(0);
  });
  it('cancels on death, generation change, switch, interruption and explicit silence', () => {
    for (const update of [{alive: false}, {generation: 2}, {equipment: 'knife'}, {reloading: false}, {silent: true}]) {
      const t = make(), state = {id: 1, generation: 1, alive: true, equipment: 'ak47', reloading: true, reloadDuration: 2};
      t.sync(state, 0); t.sync({...state, ...update}, .1); expect(t.update(.2)).toEqual([]);
    }
  });
  it('never synthesizes absent or silent events, and respects client-only relevance', () => {
    const t = make();
    expect(t.start(0, 'unknown', 'draw', 0)).toBe(false);
    expect(t.start(0, 'ak47', 'draw', 0, {silent: true})).toBe(false);
    t.start(0, 'ak47', 'draw', 0, {local: true}); t.start(1, 'ak47', 'draw', 0);
    expect(t.update(0).map(c => c.actorId)).toEqual([0]);
    expect(t.update(.5).map(c => c.actorId)).toEqual([0, 1]);
  });
  it('does not replay expired audio after a background frame or late renderer attachment', () => {
    const t = make(); t.start(0, 'ak47', 'reload', 0);
    expect(t.update(20)).toEqual([]); expect(t.size).toBe(0);
    t.start(0, 'ak47', 'reload', 10, {elapsed: 1.2}); expect(t.update(10)).toEqual([]);
    expect(t.update(10.6).map(c => c.key)).toEqual(['bolt']);
  });
  it('restarts native insertion segments only at phase changes or progress wrap', () => {
    const t = new ActionSoundTimeline({nova: {
      'reload-start': {duration: .4, cues: [{time: .2, key: 'start'}]},
      'reload-loop': {duration: .6, cues: [{time: .3, key: 'shell'}]},
      'reload-end': {duration: .8, cues: [{time: .4, key: 'finish'}]},
    }});
    const state = {id: 1, equipment: 'nova', alive: true, reloading: true, reloadDuration: .6,
      reloadPhase: 'shell' as const, reloadProgress: 0};
    t.sync(state, 0); t.sync({...state, reloadProgress: .5}, .3);
    expect(t.update(.3).map(cue => cue.key)).toEqual(['shell']);
    expect(t.update(.3)).toEqual([]);
    t.sync(state, .6); expect(t.update(.9).map(cue => cue.key)).toEqual(['shell']);
    t.sync({...state, reloadPhase: 'finish', reloadDuration: .8}, 1.2);
    expect(t.update(1.6).map(cue => cue.key)).toEqual(['finish']);
  });
  it('suppresses a silent phase and resumes loud cues at current progress without replay', () => {
    const t = make(), state = {id: 1, equipment: 'ak47', alive: true, reloading: true, reloadDuration: 2, reloadProgress: 0};
    t.sync(state, 0); t.sync({...state, silent: true, reloadProgress: .1}, .2);
    expect(t.update(.2)).toEqual([]);
    t.sync({...state, silent: false, reloadProgress: .6}, 1.2);
    expect(t.update(1.2)).toEqual([]); expect(t.update(1.8).map(cue => cue.key)).toEqual(['bolt']);
  });
  it('bounds actor allocations and guards nonfinite clocks and random inputs', () => {
    const t = make(); for (let n = 0; n < 100; n++) t.start(n, 'ak47', 'reload', 0);
    expect(t.size).toBe(32); expect(t.update(NaN)).toEqual([]); t.clear(); expect(t.size).toBe(0);
    for (const r of [-5, 1, Infinity, NaN]) expect(sampleIndex(3, undefined, r)).toBeGreaterThanOrEqual(0);
    expect(sampleIndex(3, undefined, 1)).toBeLessThan(3);
  });
  it('gives AI the same native path-length attenuation and cover gain as playback', () => {
    const scene = new AcousticScene([{center: {x: 0, y: 1, z: 0}, size: {x: 1, y: 4, z: 2}}]);
    const path = scene.resolve({x: -4, y: 1, z: 0}, {x: 4, y: 1, z: 0});
    expect(propagatedGunshotGain('ak47', path)).toBeCloseTo(gunshotGain('ak47', path.distance) * path.gain);
    expect(propagatedFootstepGain(path, true)).toBe(0);
  });
  it('can schedule extracted cues for AI hearing without browser audio or fetch', () => {
    const t = new ActionSoundTimeline();
    expect(t.start(1, 'ak47', 'reload', 0)).toBe(true);
    const cues = t.update(4 / 30);
    expect(cues).toHaveLength(1); expect(cues[0].key).toMatch(/^cue-[0-9a-f]{16}$/);
  });
});
