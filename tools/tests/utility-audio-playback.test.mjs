import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeSoundPlayback, wavSignal} from '../utility-audio-metadata.mjs';
import {utilityEventSources, buildUtilityEvents} from '../import-utility-audio.mjs';

const summary = (start, end = 0) => `Sample Rate: 10000\nSampleCount: 20000\nLoopStart: ${start}\nLoopEnd: ${end}\n`;
test('uses VSND loop flags, including whole-file loops, not names or event duration',()=>{
  assert.deepEqual(nativeSoundPlayback(summary(0)).loop,{start:0,end:2});
  assert.deepEqual(nativeSoundPlayback(summary(5000,15000)).loop,{start:.5,end:1.5});
  assert.equal(nativeSoundPlayback(summary(-1)).loop,undefined);
  for(const text of ['',summary(-2),summary(20000),summary(4,3),summary(0,20001)])
    assert.throws(()=>nativeSoundPlayback(text),/metadata|bounds/);
});
test('retains per-sample playback independently from WAV output provenance',()=>{
  const definitions=Object.fromEntries(Object.values(utilityEventSources).map(name=>[name,
    {type:'csgo_mega',vsnd_files_track_01:['sounds/fixture.vsnd']} ]));
  const playback=nativeSoundPlayback(summary(0));
  const events=buildUtilityEvents(definitions,()=>({url:'/audio/test.wav'}),{playbackMetadata:()=>playback});
  assert.deepEqual(events['utility-fire-loop'].tracks[0].samplePlayback,[playback]);
  assert.deepEqual(events['utility-fire-loop'].tracks[0].sampleMetadata,[{}]);
  for(const key of ['utility-fire-loop','utility-fire-end','utility-molotov-failed','utility-incendiary-failed',
    'utility-smoke-clear',...['he','flash','smoke','molotov','incendiary','decoy'].map(k=>`utility-${k}-draw`)])assert.ok(events[key]);
});
test('published utility samples have nonzero measured signal and correct sample playback metadata',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../../public/revamp/audio/events.json',import.meta.url)));
  const seen=new Set();
  const verify=event=>{
    for(const track of event.tracks??[])for(const [index,url]of track.samples.entries()) {
      const playback=track.samplePlayback?.[index];assert.ok(playback,`Missing VSND metadata: ${url}`);
      const {sampleRate,sampleCount,loopStart,loopEnd}=playback.nativeSound;
      assert.deepEqual(nativeSoundPlayback(`Sample Rate: ${sampleRate}\nSampleCount: ${sampleCount}\nLoopStart: ${loopStart}\nLoopEnd: ${loopEnd}`),
        {nativeSound:playback.nativeSound,...(playback.loop?{loop:playback.loop}:{})});
      if(seen.has(url))continue;seen.add(url);
      const bytes=fs.readFileSync(new URL(`../../public/revamp${url}`,import.meta.url));
      assert.deepEqual(wavSignal(bytes),playback.signal);assert.ok(playback.signal.peak>0,`Silent utility sample: ${url}`);
    }
    event.dependencies?.forEach(verify);
  };
  for(const key of Object.keys(utilityEventSources))verify(manifest.events[key]);
  assert.ok(manifest.events['utility-fire-loop'].tracks[0].samplePlayback[0].loop);
  // Despite its event/sample name this VSND explicitly has LoopStart=-1.
  // Do not manufacture an infinite loop from the word "loop".
  assert.equal(manifest.events['utility-cue-molotov-idleloop'].tracks[0].samplePlayback[0].loop,undefined);
  assert.equal(manifest.events['utility-fire-end'].tracks[0].samplePlayback[0].loop,undefined);
});
