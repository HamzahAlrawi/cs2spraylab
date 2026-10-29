import fs from 'node:fs';
import crypto from 'node:crypto';
import {runInNewContext} from 'node:vm';
import sharp from 'sharp';
import {describe, expect, it} from 'vitest';
import {nativeUtilityPresentation, utilityNativeTiming, utilitySoundSchedule, UtilitySoundTimeline,
  utilityPinReadySeconds, utilityActionCompleteAt, utilityNativeCueKey} from './utility-presentation';
import {utilityKinds} from './utility-loadout';
import particles from './utility-particles-native.json';

describe('installed native grenade presentation evidence', () => {
  it('retains the six-by-nine audited clocks and treats single-frame clips as zero-duration poses', () => {
    expect(nativeUtilityPresentation.build).toBe('2000935');
    for (const kind of utilityKinds) {
      const {actions, transitions} = nativeUtilityPresentation.utilities[kind];
      expect(Object.keys(actions)).toHaveLength(9);
      expect(actions.draw.seconds).toBe(1);
      expect(transitions.find(t => t.name === 'ReadyToThrow')?.seconds).toBe(.2);
      for (const action of Object.values(actions)) {
        expect(action.seconds).toBeCloseTo(Math.max(0, action.frames - 1) / action.fps);
        if (action.pose) expect(action.seconds).toBe(0);
        for (const event of action.events) expect(event.at).toBeGreaterThanOrEqual(0);
      }
    }
    expect(nativeUtilityPresentation.utilities.he.actions['hold-high'].pose).toBe(true);
    expect(nativeUtilityPresentation.utilities.flash.actions['hold-high'].pose).toBe(false);
    expect(nativeUtilityPresentation.utilities.flash.actions['hold-high'].seconds).toBe(1);
  });
  it('keeps compiled subframe timing distinct from rounded authored decompilation', () => {
    const events = nativeUtilityPresentation.utilities.smoke.actions.inspect.events;
    const turns = events.find(e => e.name === 'SmokeGrenade.Inspect01.Turns')!;
    expect(turns.at).toBeCloseTo(.42, 5); expect(turns.authoredAt).toBeCloseTo(13 / 30);
    expect(utilityNativeTiming('he').throwSoundAt).toBeCloseTo(2 / 30, 5);
    expect(utilityNativeTiming('he', 0).throwSoundAt).toBeCloseTo(4 / 30, 5);
    expect(utilityNativeTiming('smoke', 0).throwSoundAt).toBe(0);
    expect(utilityNativeTiming('molotov').throwSoundAt).toBeCloseTo(1 / 30, 5);
    expect(utilitySoundSchedule('decoy', 'pullpin', 10)[0].at).toBeCloseTo(10 + 5 / 30, 5);
    expect(utilitySoundSchedule('molotov', 'pullpin', 0).some(c => c.name.endsWith('PullPin'))).toBe(false);
  });
  it('derives gameplay pin readiness from graph TimeRemaining, not a sound or full clip end', () => {
    for (const kind of utilityKinds) {
      expect(utilityNativeTiming(kind).deployDuration).toBe(1);
      expect(utilityActionCompleteAt(kind, 'draw')).toBe(.8);
      expect(utilityPinReadySeconds(kind)).toBeCloseTo(kind === 'molotov' ? 28 / 30 : 23 / 30);
      const completion = nativeUtilityPresentation.utilities[kind].completions.find(c => c.state === 'Charge')!;
      expect(completion.event).toBe('WPN_ACTION_COMPLETE'); expect(completion.type).toBe('TimeRemaining');
      expect(completion.remaining).toBe(.2);
    }
    expect(utilityActionCompleteAt('he', 'inspect')).toBeUndefined();
  });
  it('schedules all simultaneous sounds once, applies playback rate and invalidates cancelled cues', () => {
    const timeline = new UtilitySoundTimeline(); timeline.start('he', 'draw', 10, 2);
    expect(timeline.advance(9)).toEqual([]);
    expect(timeline.advance(10).map(c => c.name)).toEqual(['Draw.Gear']);
    expect(utilityNativeCueKey('HEGrenade.PullPin')).toBe('utility-cue-hegrenade-pullpin');
    expect(timeline.advance(10)).toEqual([]);
    expect(timeline.advance(10.04)[0].name).toBe('HEGrenade.Draw');
    expect(timeline.advance(9)).toEqual([]);
    expect(timeline.advance(11)).toEqual([]);
    timeline.start('decoy', 'pullpin', 12); timeline.cancel(); expect(timeline.advance(20)).toEqual([]);
    expect(utilitySoundSchedule('he', 'draw', NaN)).toEqual([]);
    expect(utilitySoundSchedule('he', 'draw', 1, 0)).toEqual([]);
  });
  it('ships hashed bounded native texture atlases and native presentation sound events', () => {
    for (const asset of Object.values(particles.assets)) {
      const file = asset.url.startsWith('data:') ? Buffer.from(asset.url.split(',')[1], 'base64') : fs.readFileSync(`public/revamp${asset.url}`);
      expect(crypto.createHash('sha256').update(file).digest('hex')).toBe(asset.sha256);
      expect(file.length).toBe(asset.bytes); expect(asset.columns * asset.rows).toBeGreaterThanOrEqual(asset.frames);
      expect(asset.frames).toBeLessThanOrEqual(32);
    }
    expect(particles.assets.smoke.channel).toBe('A');
    const sounds = JSON.parse(fs.readFileSync('public/revamp/utility-presentation/sounds.json', 'utf8'));
    for (const kind of utilityKinds) for (const action of Object.values(nativeUtilityPresentation.utilities[kind].actions))
      for (const event of action.events.filter(e => e.type.endsWith('_Sound')))
        expect(sounds.events[event.name!]?.source).toBe(event.name);
    expect(sounds.provenance.outputBytes).toBeLessThan(32e6);
  });
  it('decodes the external and embedded WebP atlases at their declared grid dimensions', async () => {
    for (const [kind, asset] of Object.entries(particles.assets)) {
      const bytes = asset.url.startsWith('data:') ? Buffer.from(asset.url.split(',')[1], 'base64') : fs.readFileSync(`public/revamp${asset.url}`);
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe('webp');
      // Flash uses SPRITECARD_TEXTURE_BLEND_LUMINANCE; an opaque RGB atlas is valid there.
      if (kind !== 'flash') expect(metadata.hasAlpha, kind).toBe(true);
      else expect(asset.renderers[0].m_vecTexturesInput[0]).toMatchObject({m_nTextureBlendMode: 'SPRITECARD_TEXTURE_BLEND_LUMINANCE'});
      expect(metadata.width).toBe(asset.columns * asset.cellSize);
      expect(metadata.height).toBe(asset.rows * asset.cellSize);
      const {data} = await sharp(bytes).ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject: true});
      expect(data.some((alpha: number) => alpha > 0)).toBe(true);
    }
  });
  it('runs native utility asset producers before their consumers in the full build', () => {
    const script = fs.readFileSync('tools/build-assets.mjs', 'utf8'), steps: string[] = [];
    // Execute the real pipeline with child execution stubbed, without rebuilding shared assets.
    runInNewContext(script.slice(script.indexOf('\n') + 1), {
      process: {execPath: 'node'}, execFileSync: (_node: string, args: string[]) => steps.push(args[0])
    }, {timeout: 1000});
    for (const [producer, consumer] of [
      ['import-utility-models', 'build-utility-gestures'],
      ['build-utility-gestures', 'audit-utility-presentation'],
      ['audit-utility-active-resources', 'import-utility-particles'],
      ['audit-utility-presentation', 'import-utility-presentation-sounds'],
      ['audit-utility-presentation', 'import-utility-audio'],
      ['import-utility-models', 'build-combat-model-delivery']
    ]) {
      const before = steps.indexOf(`tools/${producer}.mjs`), after = steps.indexOf(`tools/${consumer}.mjs`);
      expect(before, producer).toBeGreaterThanOrEqual(0);
      expect(after, `${producer} before ${consumer}`).toBeGreaterThan(before);
    }
  });
});
