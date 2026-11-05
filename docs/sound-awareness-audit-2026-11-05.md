# Map sound awareness and native audio audit

## Scope

This iteration adds a separate map-based sound-awareness drill. It does not change
the existing hearing board or the default AI Duel mode. The map/area picker uses
the native map registry; Dust 2 is the only installed map currently available.
No game process, process memory, hooks or DLL execution were used. All inspection
was offline against static installed resources. Extracted assets remain local
and ignored by Git.

## Training design

- Learn with reveal: briefly mark the last audible source on screen, radar or both.
- Direction hint: quantize the heard bearing into eight sectors, without an exact
  screen position or radar contact.
- Unaided training: no source or cue identity until the learner answers.
- Listen and explore: no answers required; the next demonstration follows.
- Running, jump/landing, gunfire and reload demonstrations use the shared actor
  physics and weapon state machines, not an independently animated soundboard.
- Grenade bounces and bursts are deliberately placed native audio sources. They
  identify the grenade, not the thrower; this drill does not simulate an enemy's
  complete throw for those demonstrations.
- Hidden native-lane placements must fit the actor hull and produce an audible
  cue. Running also requires an unobstructed short movement lane. Low-cover
  demonstrators retain their crouched stance.
- Score the first physical fired ray against the frozen heard location, rather
  than treating a screen-center crosshair as a hit. Record angular error, active
  answer time and optional distance error. These are training metrics, not
  measured human reaction time or an in-game rank.
- Score is directional by default: 100 at zero error, zero at 60 degrees. Optional
  distance scoring contributes 25%. These weights are authored training choices.
- Mono is unscored. Assistance, output, panner, volume, cue group and optional
  distance scoring are separated in displayed comparisons. Replayed or paused
  answers are excluded from first-listen comparisons. History is bounded to 100.
- Pausing after a cue preserves its frozen location, allowing distance entry;
  it cancels future sounds and marks the answer assisted. Changing effective
  volume invalidates the trial. Replay restarts the same source/action.
- Missing/undecoded samples never create a scored or revealed cue. Results only
  begin after an audible event and acoustic travel delay. The audibility floor
  of 0.0015 is trainer calibration, not a measured CS2 hearing threshold.
- No combat XP or progression rewards are granted by this assisted drill.

## Installed source identity

Inspected installation:
`C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive`.

| Item | Identity |
| --- | --- |
| Client/server version | 2000942 |
| Patch version | 1.41.9.6 |
| Source revision | 11206718 |
| Version date/time | Nov 04 2026, 16:01:59 |
| Steam build ID | 26445667 |
| `server.dll` SHA-256 | `70c66e850b2ce72c8c7ca026de6989ef4de7f12dad64ec503645fbd2a7f06d9f` |
| Player sound bank compiled SHA-256 | `2408be34e284133481e3f311df8c006e459ecb8f59c69c624ecfa053c6a0daae` |
| Player sound bank decompiled SHA-256 | `35b2ca5d4be176b7690a94521f8278a8456ff3b91142d7acf013d0af4cf89409` |
| Footstep bank compiled SHA-256 | `ae98b09cac5978787f5866796f18d4437c060b99a4ce9094f6b44e8e07ea639a` |
| Footstep bank decompiled SHA-256 | `a5e880fb7f55be614163bb9058b10dd39f318411e6891448f5bfb6cdb09dfccc` |
| Weapon bank compiled SHA-256 | `43783bf047a6ad803a4bffd6980fc53ec7f4dcefd3a00d674e4c3ba260ff49a1` |
| Weapon bank decompiled SHA-256 | `4a7747f0be0ea7c991a17e98d3e34d40eccddbe165da268d8c3b87108e96b13e` |

Method: Source2Viewer CLI 20.1 VPK extraction/decompilation; structured KV3 parsing.
`tools/import-awareness-audio.mjs` and
`tools/import-weapon-sound-events.mjs` retain provenance and compiled sample
hashes. Both are part of `tools/build-assets.mjs`. No remote asset dependency was
introduced. The utility sound importer was also rerun: 75 events, 118 WAV samples,
26,454,270 output bytes from this installation.

## Native audio findings

`Default.WalkJump` in `soundevents/game_sounds_player.vsndevts_c`:

- Volume 0.1, pitch 1.1, emitter offset `[0, 0, 30]` Source units.
- Distance curve knots: `[40, 1]`, `[155.714294, 0.263889]`,
  `[493.714294, 0]`; last knot is approximately 12.54 meters.
- `broadcast_distance_override=98` is radar-broadcast metadata, not an audible
  distance cutoff. It is not used as the jump hearing radius.
- Compiled jump sample SHA-256:
  `79d9d60b43ae215b933f7c3ebfff030fb247a71581f71b9f712838f77a3cc42b`.

The current decompiled footstep bank matches the previous stored bank despite
the old build label. Concrete step/landing events have `block_duration=0.15`.
Playback now enforces that cooldown per actor in AudioContext wall-clock time;
different actors do not suppress one another. Physics stride accumulation is
bounded by actual horizontal velocity, so hull support/depenetration corrections
cannot count as extra walking distance. Jump launch cues require a real supported
launch, not arbitrary upward motion. Movement constants were not retuned.

Weapon sound roots alone were incomplete: enabled child events supply distant
and mechanical layers. The new importer preserves independent child gains,
curves, delays, pitch and tracks for 36 existing weapon roots, bounded to three
samples per track (113 unique samples, 39,849,334 output bytes). This does not add
selectable weapons. Content-addressed sample names invalidate changed audio
without invalidating unchanged samples.

For example, the AK main curve ends at 2500 units. Its enabled
`Weapon_AK47.SingleDistant` child has volume 0.5 and knots
`[800, 0]`, `[2335.836914, 0.540441]`, `[2868.571533, 0.095588]`.
The composed trainer envelope therefore extends to about 72.86 meters, rather
than the old main-only 63.5 meters. Primary weapon gain/curve fields did not change
in this audit; the missing composition was the problem. Suppressed USP-S retains
its authored shorter envelope, rather than sharing a generic gunshot radius.

Playback, AI hearing and training share bounded distance-curve evaluation.
Audibility uses the strongest enabled component, not an invented phase-coherent
sum. Native children are still played independently. Curves without explicit
native distance data retain the existing inverse-distance browser fallback;
their unresolved engine defaults are not presented as measured native values.

Inspected HE first-person pin clip metadata is `ClientOnly`, named
`HEGrenade.PullPin`, at `EntityEyePos`. This proves the audience of that clip,
not the absence of a separate server broadcast. Draw/pin cues are consequently
excluded from reliable enemy-location training until that route is traced.
Reload cues similarly filter the extracted sound timeline by audience.

## Multi-elevation inferno placement

The previous trainer adapter imposed a 0.35-meter vertical-difference cutoff,
preventing fire from spreading across many native steps and ledges.

Current build 2000942 `server.dll` static disassembly, RVAs:

- Function fragment `0x3523c7..0x35369d` contains the child-placement trace.
- `0x353042` subtracts float32 200 from the parent height, using constant
  `0x179bea4`, to form the downward endpoint.
- `0x3530cd` loads float32 50 from `0x17b2c40`.
- `0x35310c` adds that value to candidate height for the trace start.
- `0x35313f` calls trace helper `0x341300`.

These establish local trace bounds, not the complete native placement algorithm.
The older inspected 2000935 path matches structurally. The browser adapter now
searches within 50 units up / 200 units down, retaining support normals, world
bounds, range/depth limits and a maximum of two collision queries per attempt.
It allows downward ledge spill without falsely colliding with the ledge's own
vertical face; uphill/ceiling links and solid partitions remain blocked. Spacing
and range tests include elevation. Native timers, damage fixtures and trace caps
are unchanged. Existing projectile-flight setup fingerprints are unchanged,
because this is post-detonation fire placement, not throw trajectory arithmetic.

The 15-unit surface offset comes from the previously recorded convar snapshot;
its current default was not independently recovered here. Complete native RNG,
trace filters and terrain topology traversal remain unverified. This is a bounded
adapter improvement, not proof of full native inferno parity.

## CT spawn / collider audit

Fresh `maps/de_dust2/world_physics.vmdl_c` SHA-256:
`d31ef6c5ae4c60d1b2d242ecb9e938b7bad5ab72015c6523109f697f2c6abd41`.
It matches `docs/dust2-map-inventory.json.physicsSha256`; the source resource has
not become stale merely because the manifest records an older build label.
No native collider was deleted based on visual appearance alone.

`ct-audio-native.test.ts` walks the actual installed Mid/CT chunk corridor and
ramp (native course views 12 through 20) through shared movement. It asserts
route completion, over 20 meters of travel, zero false landing cues, and bounded
stride count/cadence. This protects one reported class of duplicate sounds, not
every CT location or complete native movement equivalence. Exact alleged extra
collider locations remain unresolved without a reproducible position/capture.
Native resource equality does not certify every browser trace/hull semantic.

## Validation and limits

Regression coverage includes assistance leakage, real weapon readiness gates,
physical-ray scoring, mute/missing samples, pause/replay, reserve reloads,
crouched source stance, per-actor audio cooldown, sound-child envelopes,
multi-elevation fire support and the actual CT collision route. Browser coverage
checks desktop and mobile, nonblank native rendering, assisted reveal, no
unaided radar/screen reveal, a real scored shot and persisted history.

Browser HRTF is not CS2's native HRTF. Curve interpolation remains linear rather
than native Hermite; DSP, mixer groups, voice allocation, reverb and doorway
propagation remain approximations. No new exact-CS2 audio, collider or complete
inferno-runtime parity claim is made. Desktop screenshots and native regression
fixtures cannot replace controlled, measured in-game trajectories/listening
captures.

Validation run: `npm run check` passed 297 test files / 6,908 tests and the
production build. A subsequent focused run passed 22 awareness/terrain/native-CT
tests, including the added low-cover crouch regression. Four desktop/mobile
Playwright awareness/footstep tests and the existing desktop HRTF hearing-board
regression passed. `npm run assets:check`, `npm run source:check` and whitespace
checks passed. Build output retains its pre-existing large-chunk advisory.

Public first-party context reviewed (not numerical gameplay authority):

- https://www.counter-strike.net/cs2
- https://www.counter-strike.net/newsentry/529853754800866483
- https://www.counter-strike.net/news/cs2-updates
- https://store.steampowered.com/news/posts/?appids=730&enddate=1755202836&feed=steam_community_announcements

No deployment is part of this iteration; commit and push only.
