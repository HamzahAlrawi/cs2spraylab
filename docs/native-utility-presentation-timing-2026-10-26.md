# Utility Presentation And Native Timing Handoff

October 28 correction: Charge completion below is a cosmetic graph transition,
not minimum gameplay hold time. Native input schedules release independently at
button release + float32(0.1). See [input-path evidence](native-utility-default-findings.md#input-release-gate-follow-up).
The simulation no longer waits 23/30 or 28/30 seconds before scheduling release.

Installed static CS2 build **2000935**, October 26, 2026. No game process,
memory, hooks, input automation, projectile equations or aiming coordinates were changed.
Ownership: `utility-render.ts`, `utility-view.ts`, their tests and new presentation
helpers/data/tools/assets only. The parent owns simulation, audio integration,
`utilities.ts` and `smoke-volume.ts`.

## Completion Is Not Sound

`src/range/duel/utility-presentation-native.json` contains six graph variations,
54 compiled clips, authored frame events, normalized compiled events, SHA256s,
graph pose references, transition durations, state completion rules and vdata deploy.
Source archives remain local. The audit uses Source2Viewer 20.1 for current vdata;
20.0 cannot decode that resource's current KV3 metadata.

All six graphs have `WPN_ACTION_COMPLETE`, `TimeRemaining`, `LessThanEqual`:

| State | Remaining | Derived Completion |
| --- | --- | --- |
| Charge, five ordinary grenades | 0.2 s | 29/30 - 0.2 = **23/30 s** |
| Charge, Molotov | 0.2 s | 34/30 - 0.2 = **28/30 s** |
| Deploying | 0.2 s | 1.0 - 0.2 = **0.8 s** |
| Throw | 0 s | overhand **23/30 s**, underhand **0.5 s** |

`scripts/weapons.vdata_c` independently specifies **1.0 s deploy** for all six.
Do not substitute the graph's 0.8 s animation completion for that gameplay deploy gate.
Graphs reference the action clips at speed 1. These are static authored rules,
not live engine frame/tick measurements or a complete graph interpreter.

Callable parent APIs in `src/range/duel/utility-presentation.ts`:

```ts
utilityPinReadySeconds(kind); // 23/30 or Molotov 28/30; undefined if unverified
utilityActionCompleteAt(kind, 'draw'); // .8, graph clock only
utilityNativeTiming(kind, strength); // deployDuration, pinReadyAt, clip lengths, readyBlend
```

`throwSoundAt` is explicitly a **sound** marker, never a projectile-release marker.
There is no projectile-release ID event in these extracted throw clips.
HE/flash overhand sound is frame 2, underhand frame 4; smoke/decoy underhand
sound is frame 0. Molotov/incendiary overhand is frame 1, underhand frame 0.

## View Playback

Draw is no longer compressed into the old 0.35 s readiness interval. At native
graph completion (.8 s), it blends to idle over the graph's .2 s idle transition,
continuing the draw source during the blend. `drawPlaybackRate` is optional and
must also be passed to the sound scheduler if used.
Queued future `primedAt` timestamps do not enter the pin/throw branch until that
time is reached; queuing input during deploy cannot snap the arms to pin frame zero.

Pin-to-hold starts at the graph Charge completion, blends over native
`ReadyToThrow` .2 s and continues the source clip's last .2 s. Hold strength
interpolates low/mid/high poses, including genuine zero-duration one-frame clips.
Longer hold resources are also pose nodes in the graph, not automatically loops.
This avoids treating a duration-zero pose as a missing action or restoring bind pose.

`UtilityPresentation.throwStartedAt` and `UtilityRenderer.throw(kind, releaseAt,
strength, startedAt?)` accept the parent's explicit throw clock. The optional
legacy fallback retains the separate .1 s presentation/release delay; it never
uses `throwSoundAt` to infer launch. Prefer explicit start clocks. At release only the grenade assembly hides; arms
continue through the authored throw end. No projectile is launched by presentation.

## Audio Contract

```ts
const cues = utilitySoundSchedule(kind, 'pullpin', actionStartedAt, playbackRate);
// {name, key, at, endAt?, action, index}
utilityNativeCueKey('HEGrenade.PullPin'); // utility-cue-hegrenade-pullpin
const timeline = new UtilitySoundTimeline(); // one per actor/action owner
timeline.start(kind, 'draw', selectedAt);
timeline.advance(now); // emits each crossed cue once, including simultaneous frame-zero cues
timeline.cancel(); // invalidates pending cues; parent also stops action-owned voices
```

Parent integrates those keys through its expanded `tools/import-utility-audio.mjs`
and `RangeAudio`; neither was edited here. A self-contained optional bank is at
`/utility-presentation/sounds.json`: 36 native-name keys, 33 WAVs, 2,851,526 bytes,
one sample per track, native child definitions retained. It is an extraction
reference/fallback, not a second bank that must be loaded alongside parent audio.
Duration events expose `endAt`; the parent must cancel owned voices on interruption.
`Molotov.IdleLoop` is not evidence to invent infinite playback from a one-shot WAV.

Compiled normalized event times are authoritative here. Some authored DMX
decompilations round subframe events: smoke inspect turns is compiled ~.4200003 s
but decompiled as frame 13 (~.4333333 s). Both are retained (`at`, `authoredAt`,
`duration`, `authoredDuration`) instead of silently asserting exact equivalence.

## Native Particles And Environmental Fill

`utility-particles-native.json` records native resource hashes and atlas hashes:

- Smoke: installed legacy fallback `vistasmokev1_emods`, opacity channel A,
  16 sequence-zero frames. RGB is ember-like emods data and is deliberately not
  rendered as smoke color.
- Fire: `molotov_groundfire_main` references `fire_burning_character`, 12 frames.
- Flash: `explosion_flashbang` references core archive `aircraft_blue`, 1 frame.

Atlases total **611,136 bytes**. All three are loaded once during `prepare`,
with explicit disposal including late resolutions after destruction. There are
no per-frame texture requests or canvas-generated replacement blobs. Smoke and
fire use animated atlas samples; flame bases stay on supplied fire cells.
The burst is now a short fading native flare plane, not a solid expanding sphere.
The existing screen-exposure clamp remains simulation-owned behavior.

Smoke consumes **only `effect.cells`**, up to the parent's `MAX_SMOKE_CELLS=768`
at `SMOKE_CELL_SIZE=.8`. Empty cells produce no smoke. There is a **2,048 puff
aggregate cap**, one smoke draw, and at most 64 effect snapshots per update.
Cell centers do not drift; texture rotation/cycling provides motion. Kernel
bloom/fade radius clips those cells. The interior overlay additionally requires
`smokeContains(camera.position, effect)` and rejects active cleared holes.
Thus being near the source through a wall cannot trigger an interior overlay.

These are bounded native sprite approximations, **not Source 2 voxel smoke**.
No native particle VM, collision operators, depth feathering, scene lighting,
heat refraction or exact alpha sorting is claimed. At saturation later clouds
can lose visible puffs; interior membership is still checked independently.

## Dropped Loot

`UtilityRenderer.syncDrops(readonly {id, utility, position, picked?, droppedAt?, owner?}[])`
reconciles at most **64 native static-model clones**, sharing template geometry,
materials and textures. It reuses unchanged IDs, removes picked/absent IDs,
supports model preparation after an early snapshot, and clears on `clear()` or
destruction. Visual grounding is local to the clone, never written into the
supplied position. Parent calls it from `Engine.syncDrops`; no physics changes.

## Rebuild And Verification

```powershell
node tools/audit-utility-presentation.mjs
node tools/import-utility-particles.mjs
node tools/import-utility-presentation-sounds.mjs # optional standalone reference bank
npx vitest run src/range/duel/utility-view.test.ts src/range/duel/utility-render.test.ts src/range/duel/utility-presentation.test.ts --maxWorkers=1
node tools/audit-utility-visuals.mjs
```

For this machine's sandbox set `TEMP`/`TMP` to an existing workspace research
directory for Vitest, and `PLAYWRIGHT_BROWSERS_PATH` to the installed local browser
cache. The browser check needs localhost access and shuts down its temporary
server and browser. Desktop 1280x800 and portrait 390x844 screenshots/results are
in `research/utility-presentation/screenshots/`. Both have nonblank pixel checks,
visible native flames, changing animation hashes and stable geometry counts.
The scene costs two effect draws without flash, three with flash, plus floor/wall.

Focused checks pass (26 tests), and `npx tsc --noEmit` passes after the parent's
concurrent fixture updates. No full suite, deployment or ZIP was performed.
