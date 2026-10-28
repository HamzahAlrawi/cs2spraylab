# CS2 fidelity and AI Duel loading audit

Assessment: October 22, 2026. This is a measured implementation plan, not a record
of delivered gameplay fixes. Application code and deployed assets are unchanged.
Two repeatable audit tools were added. Local research reports retain raw timings.

The next work should prioritize shot/movement timing, native-map tactical geometry,
and asset delivery. Individual extracted constants and passing synthetic tests do
not establish whole-game equivalence. Preserve physical world-space impacts and
the shared movement/shot model. Artificial network delay remains removed.

## Measured loading baseline

Deployed `https://spraylab.pages.dev/`, fresh headless Chromium contexts, 1440x1000,
Performance graphics, three level-3 bots, i7-13700K. Each row is one sample, not a
percentile or a controlled older-PC benchmark. CPU and network restrictions are
synthetic; other machine workloads were not controlled.

| Case | Entry control ready | Textured canvas observed | Map transfer | Largest main-thread task |
| --- | ---: | ---: | ---: | ---: |
| Mid/CT, cold browser | 3.13 s | 3.37 s | 23.86 MB | 364 ms |
| Mid/CT, same browser reload | 1.69 s | 2.23 s | 19.12 MB | 224 ms |
| Catwalk, cold, 20 Mbps / 50 ms | 15.28 s | 15.51 s | 30.56 MB | 327 ms |
| Mid/CT, cold, 4x CPU throttle | 6.93 s | 7.86 s | 23.86 MB | 445 ms |

Canvas timing includes screenshot readback. Entry readiness does not prove all
motion, sidearm, knife, or audio assets have finished loading. The reload discards
the JS scene cache; it does not measure the existing zero-fetch previous-round
reuse. ResourceTiming showed full transfers of both large Mid binary resources on
this browser reload. This is an observation, not a diagnosis of browser eviction.

The eight local asset inventories below count requested resources once, excluding
the duplicate compatibility image copies in the physical directories. MB is
decimal; decoded image memory is MiB, before mipmaps, GPU copies and geometry.

| Chunk | Raw map resources | Texture pack | Decoded image estimate | Render triangles |
| --- | ---: | ---: | ---: | ---: |
| Long doors/pit | 21.40 MB | 8.46 MB | 178.4 MiB | 793,650 |
| B tunnels/site | 15.63 MB | 5.76 MB | 136.6 MiB | 545,812 |
| Mid/CT | 24.52 MB | 9.38 MB | 203.1 MiB | 911,704 |
| Long/A | 26.41 MB | 9.65 MB | 208.7 MiB | 1,033,199 |
| Catwalk/A | 31.67 MB | 10.11 MB | 226.7 MiB | 1,334,066 |
| B doors | 13.64 MB | 4.69 MB | 111.3 MiB | 540,256 |
| Tunnels | 21.99 MB | 8.15 MB | 185.9 MiB | 797,529 |
| Top mid | 25.67 MB | 9.11 MB | 200.6 MiB | 1,018,942 |

Across all eight image packs: **65,306,414 bytes**, but only **11,397,170 bytes of
unique image contents**, identified by their existing SHA-256s. Approximately 83%
of cumulative image bytes are duplicates. This is an across-chunk opportunity,
not an 83% saving on an individual first load.

An isolated local loader, excluding module imports and rendering, measured:

| Sequence | Total, normal CPU | Collision construction | Total, 4x CPU | Collision construction |
| --- | ---: | ---: | ---: | ---: |
| Mid cold | 1,003 ms | 302 ms | 3,073 ms | 1,325 ms |
| Catwalk with Mid still alive | 740 ms | 300 ms | 2,547 ms | 1,331 ms |
| Mid rebuilt with Catwalk alive | 506 ms | 243 ms | 2,016 ms | 1,175 ms |

Catwalk reused 370 decoded images and decoded 50 new ones. The rebuilt Mid reused
all 377 images but still rebuilt collision and geometry. Existing image sharing
works; downloading packs and rebuilding the rest remain significant costs.

## Loading implementation priorities

### L1. Remove avoidable transfer and request dependencies

Evidence: `duel/real-map.ts:158` loads chunk metadata, then navigation, then the
map, then radar JSON and its image. `prefire/map.ts:128` constructs collision
before requesting glTF and its large buffers/images. In the throttled Catwalk
sample, the main visual downloads did not start until 4.30 s after navigation.

The live glTF and binary responses were uncompressed. An in-memory Brotli
quality-4 trial, without modifying any shipped files, produced:

| Resource | Mid original -> compressed | Catwalk original -> compressed |
| --- | ---: | ---: |
| Collision binary | 3.28 -> 1.44 MB | 4.05 -> 1.74 MB |
| glTF JSON | 1.36 -> 0.15 MB | 1.88 -> 0.20 MB |
| Meshopt geometry binary | 9.74 -> 7.56 MB | 14.30 -> 11.00 MB |

Potential combined savings are **5.23 MB Mid / 7.29 MB Catwalk** before other
changes. Compression/decompression overhead and actual CDN delivery still need
measurement. Cloudflare compresses selected content types; correctly label glTF
JSON and verify the resulting response. For binaries, choose a supported explicit
compressed asset format/decoder or a confirmed delivery configuration. Do not
assume Pages automatically compresses `.bin` or mislabel binary data as text.

Plan: after validating the small chunk manifest, start independent navigation,
collision and visual fetches together, with bounded concurrency. Start image-pack
and geometry fetches as soon as visual metadata is available. Radar should load in
parallel and should not delay an otherwise complete playable scene. Preserve
abort ownership, digests, size budgets, disposal and actionable failures.

### L2. Share content-addressed bundles across chunks

The decoded bitmap cache already shares images, but every chunk owns a different
monolithic `textures.bin`. The same content therefore downloads repeatedly.

Build modest shared bundles, grouped by material co-occurrence across chunks,
plus rare per-chunk bundles. A chunk lists the exact bundles it requires. Start
with a bounded target such as 1-4 MB per bundle and measure request overhead.
Do not return to hundreds of individual texture requests or download every map.
Cloudflare Pages does not currently promise partial-range responses, so ordinary
small immutable bundles are preferable to depending on range reads of one giant
archive. Existing hashes provide a migration path.

Live assets currently use `public, max-age=0, must-revalidate`. Give genuinely
content-hashed bundles immutable browser caching, while keeping mutable entry
manifests revalidated. Add a bounded persistent compressed-byte cache keyed by
content hash, with quota/eviction fallback. Validate deployment upgrades so an
old collision manifest cannot pair with a new navigation graph. Immutable
headers alone do not prevent browser eviction or guarantee zero download.

### L3. Bake the collision indexes and restore verified query worlds

`prefire/native-collision.ts:109` validates every group, constructs Rapier
trimeshes, reconstructs convex solids/open meshes, builds vertical column indexes
and builds a shot-solid tree in the browser on every uncached chunk load.

Bake immutable columns, solid metadata and acceleration structures offline.
Evaluate a Rapier snapshot produced by the exact installed package/WASM version
against rebuilding that world. Keep a raw fallback for incompatible versions.
A worker can prepare transferable sidecar data, but a Rapier world is not a
transferable JS object: restore a verified snapshot on the owning thread or keep
its entire query owner in a worker. Do not make every physics ray an async RPC.

Acceptance: independent original-vs-restored shot rays, penetration intervals,
hull sweeps, support, slopes and crouch clearance must match; retain exact source
floats. Budget the additional snapshot bytes against the CPU savings. Version
checks include map hash, compiler schema, package version and WASM hash.

### L4. Prepare one next round while the current round is playable

`RealMapSession.prepareRound` starts loading only when restart pauses simulation.
Choose the next chunk deterministically earlier, fetch its compressed assets at
low priority, and prepare bounded stages during idle time. Keep the current and
previous replay map contracts intact. Initially cache the next chunk as compressed
bytes; do not quietly retain three fully decoded maps on constrained hardware.
Abort on changed settings/mode, respect data-saving preferences, and measure
active-fight p95/p99 before enabling background decode or shader warmup.

### L5. Reduce render cost without changing combat geometry

The largest chunk contains 1.33 million render triangles; every source render
triangle is retained today. Duel chunks explicitly disable native PVS. Import
chunk-scoped visibility and preserve cluster membership through batching, then
introduce visual-only LOD for distant decoration. Preserve cover silhouettes,
alpha-tested fences, openings, important sightlines and exact collision. Never
use render simplification to change bullet or movement hitboxes.

Evaluate KTX2/Basis GPU-compressed textures with appropriate color/normal formats
and mipmaps. Measure transcode cost on weak CPUs as well as texture memory;
WebP savings on disk do not prevent expansion to RGBA in memory. Compare native
labels, grate alpha, scope sightlines and material response before accepting it.

### L6. Reduce startup JS and define a meaningful ready state

The deployed first Duel sampled 6.84 MB of decoded JS. Build outputs include
2.21 MB main JS, 2.28 MB map/Rapier JS, 0.90 MB occupancy and 0.76 MB real-map
catalog code. `RangeApp.tsx:15` eagerly imports progression/cosmetics; the map
imports all round data and the full route inventory.

Split shop presentation and detailed cosmetic material data from the small
equipped-loadout lookup. Publish round/course data per chunk as hash-checked
assets, preserving stable IDs and the evidence catalog. Avoid moving a dependency
to a new file while still importing it eagerly through another path.

`DuelEngine.ts:276` starts target/viewmodel loading asynchronously after map load.
Define readiness as collision + navigation + visible map + authoritative target
rig + selected first-person weapon + their required shaders. Track download,
prepare and render stages separately. Optional inspect/other weapon assets can
continue later. Native target pose availability must not silently change hit
geometry after a fight has already started.

Proposed gates after implementation: initial critical transfer <=12 MB for every
chunk, cached/prefetched transitions <=750 ms on this desktop, collision restore
<=100 ms on this desktop, and no loading-preparation main-thread task >100 ms.
These are targets to validate, not predicted results. Include a real older laptop,
Brave, Opera GX and mobile in acceptance; CPU throttling does not substitute for
those tests. Require ten alternating rounds, replay, cancellation and repeated
settings changes without growing resource counts.

## Gameplay fidelity priorities

### G1. Timestamped shot sampling and shared command ordering

`duel/weapon-state.ts:179` carries fractional fire cadence, but `simulation.ts:356`
advances the actor before firing, and `weapon-state.ts:105` advances recovery for
the full step first. Shot state is therefore sampled at the end of a 1/128-second
slice, not necessarily the scheduled firing instant. This can affect edge peeks,
counterstrafing speed, recoil and hit pose even when average RPM is correct.

Introduce event-time sampling for origin, angle, velocity, recoil and target pose;
keep input timestamps and weapon readiness in the same clock. Verify equivalent
input streams at 30/60/144/240 FPS and all trigger offsets inside a physics step.
Valve's sub-tick description supports this goal but does not specify its complete
runtime implementation. Do not call an independent fixed-step motor identical.

Bots currently scope before movement (`simulation.ts:353`) while player scope
input is handled afterward (`weapon-state.ts:97`). Normalize command ordering so
the same command affects the same movement slice. Independently verify scope
FOV transition, sensitivity, accuracy and fire-ready clocks.

### G2. Landing accuracy and complete movement trajectories

`WeaponRecovery.advance` has airborne/standing/crouching baselines but does not
apply the extracted landing contribution. Duel touchdown currently emits sound.
The native audit also leaves the landing routine's caller transformation open.
Verify that caller before adding a penalty: raw downward speed is not an
established input. Compare multiple jump/drop heights and the first 300 ms after
touchdown, with standing and crouched shots.

Ground acceleration arithmetic has fixtures, but air steering, jump-crouch eye
and hull transitions, stairs, edge landings and full stopping trajectories remain
less well established. The existing conformance importer has synthetic examples,
not measured CS2 trajectories. Populate it with authorized manual reference runs,
build IDs, capture precision and predeclared tolerances. Compare speed-time curves,
stopping distance, eye height and contact transitions. Check native support
friction semantics rather than assuming every material needs a new coefficient.

### G3. Preserve individual pellet mechanics

Concrete source defect: `simulation.ts:417` merges pellet damage to a victim and
promotes the aggregate hitgroup to head. At `simulation.ts:446`, aim punch uses
that combined group. `aim-punch.ts:15` suppresses helmeted head punch, so a head
pellet can suppress the chest-pellet contribution; without a helmet, torso damage
receives the head coefficient. Retain per-hit mechanics and aggregate only the
feedback. Verify native pellet/armor ordering before choosing sum/max behavior.
Test nonlethal mixed head/chest hits, armor depletion and multiple victims.

### G4. Refresh sources and validate recoil/damage as complete sequences

Installed `steam.inf`: **2000934 / 1.41.9.1 / source revision 11150591**. Map assets
record 2000932; audio/reload audits 2000933; ordinary spread/accuracy audits
2000930; base weapon provenance 2000924. This does not prove anything changed.
Run build-pinned field and resource diffs, preserve the historical fixtures, and
re-audit only affected functions instead of overwriting provenance labels.

Recheck recoil/camera trajectories, interrupted bursts, tap intervals, crouch
transitions and 5/15/30/50-metre group distributions. Compare angular dispersion
and physical targets with matched FOV; screen pixels alone are not a scale test.
Add end-to-end damage matrices for hitgroup, range, armor exhaustion, penetration,
collateral, knife and Zeus. Existing isolated formulas are useful but do not prove
the complete input/animation/trace/damage pipeline or native RNG command seeding.

### G5. Finish reload/action timing verification

Magazine commit timing has already been improved. Remaining estimates include
shotgun start/finish phases, shell insertion at loop end despite markers inside
the loop, silent-reload rate, and some holster/readiness rules. See
`native-reload-timing-audit.md:118` and `equipment.ts:17`.

Test ammo commitment separately from animation end and earliest permitted shot.
Cover interruption immediately before/after insert, empty vs partial reload,
weapon switch, hold-R changes, pump/bolt states and inspect during draw. Match
native sound-event frames as well: `tools/import-audio.mjs:183` still calls the
timeline extractor without the source FPS, defaulting to 30 for 60-Hz sources.

### G6. Give native-map tactics correct geometry and purpose

Concrete mismatch: `real-map-rounds.ts:55` defines lane side from a relative
watch-direction X delta, while `tactics.ts:379` and `:433` compare it to the sign
of a sound/sighting's absolute world X. These coordinates are unrelated on Dust 2.
Replace this with local cover orientation, reachable approach and actual exposed
angle. Validate the same encounter translated and rotated in world space.

Every baked native lane is also tagged `camp`. That flattens the entry/flank/
off-angle distinctions used by tactical and coordination scoring. Author meaningful
roles from approach coverage, escape route, weapon range and teammate separation.
Rate a crossfire by simultaneous coverage of a threat, not opposite world signs.

The current AI already has sight memory, cleared-angle evidence, sound, team
callouts and trade orders. Extend those into round-level commitments: hold a
useful angle, jiggle for a specific information need, reposition after disclosure,
cover a teammate's reload, and trade only when a reachable opening exists.
Measure exposed-idle time, bad-facing time, time to first accurate shot, repeated
peek frequency, cover use and trade opportunity/attempt/success separately.
Use replay decision reasons and blind human reviews to identify unnatural cycles.

`skill.ts:141` explicitly labels FACEIT curves as heuristics. Use conditional demo
distributions for weapon/distance/preaim/visibility/role, with held-out matches
and uncertainty. Leetify time-to-damage is not pure reaction time; its visibility
method changed in 2026, so mixed-method benchmarks are not interchangeable.
Do not promise a measured level-5 population using interpolated rank constants.

### G7. Restore transitions, foot contact and native sound context

Native movement and weapon clips already exist. The missing fidelity is in their
transitions and constraints: `duel/animation.ts:60` keeps the failed foot-plant
prototype disabled; native start/stop transitions are incomplete; torso pitch is
estimated. Validate plant/reversal, crouch entry/exit, feet on stairs, weapon grip
and muzzle clearance through the full motion, with the visible pose and hit pose
sampled from the same clock. Blend from current pose; do not just add more clips.

Death physics is a bounded sphere/link approximation, not Source 2 ragdoll
constraints. Improve joint limits, death momentum and native-map contact near
stairs/ledges before chasing more dramatic animations. Keep corpse simulation
cosmetic and sleeping quickly so it cannot alter damage or consume frame budget.

Native footstep banks are now present, but cadence is a fixed 1.35-metre travelled
distance in Duel (`simulation.ts:374`). Audio uses browser HRTF, a small box-corner
graph and fixed obstruction filters (`spatial-audio.ts:12,72`), not native acoustic
portals. Native chunks have no procedural boxes, so confirmed obstruction gets a
generic muffling treatment without reconstructing a doorway route.

Bake a small native acoustic portal/room graph offline. Share audible evidence
between AI hearing and rendered sound, retain teammate filtering, and test stairs,
tunnels, doors, vertical separation and rear/front ambiguity. Verify cadence and
sound-event timing against references. Use bounded voice counts and region-level
reverb; do not raycast every audio sample or convolve every individual voice.

### G8. Match scene readability, then add broader round context

The map geometry is native, but the lighting remains an authored hemisphere,
ambient and directional-light approximation (`prefire/lighting.ts:8`). Improve
baked static light/shadow/material response and color calibration for representative
Dust 2 views. Use comparable FOV/exposure and keep performance presets readable.

After the mechanics and loading gates pass, utility-aware encounters would move
the trainer closer to actual rounds: flash response, smoke-blocked sight and
movement away from fire. Those systems are absent today and constitute a separate
major project. Their visibility/audio/AI interactions and performance need a
dedicated specification; they should not delay the concrete fixes above.

## Suggested execution order

1. L1/L2 asset compression, parallel critical fetches and reusable bundles; G3
   pellet grouping and G6 coordinate/role defects as separately tested fixes.
2. L3/L4 baked collision and bounded next-round preparation; event-time G1 and
   source refresh G4. Keep performance comparisons tied to the same encounters.
3. G2/G5 measured movement, landing accuracy and action timing; L5 GPU textures,
   visibility/LOD; G7 motion and acoustic transitions.
4. Conditional human behavior calibration, visual parity and optional utility.

Record actual before/after results for every batch. Use all eight chunks, both
sides of cover, 1/3/5 bots, all weapon classes, low/high frame rates, cancellations
and replay. Existing tests guard regressions; add captured external witnesses for
claims about matching CS2. Never improve a score by changing hidden physics.

## Reproduction and references

```powershell
node tools/audit-duel-loading.mjs
node tools/audit-duel-loader-stages.mjs
npm run check
```

The first tool reads deployed production resources. `DUEL_URL` and `REPORT`
override its destination/report path. The second starts and closes an isolated
local Vite server and browser. Reports: `research/duel-loading-audit-2026-10-22.json`
and `research/duel-loader-stages-2026-10-22.json`.

- [Cloudflare Pages serving/caching](https://developers.cloudflare.com/pages/configuration/serving-pages/): ETags, revalidation, immutable hashed assets and range behavior.
- [Cloudflare content compression](https://developers.cloudflare.com/speed/optimization/content/compression/): supported content types and response compression.
- [Three.js KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html): GPU texture transcoding; confirm APIs against installed Three 0.170 before integrating.
- [Rapier snapshots](https://rapier.rs/docs/user_guides/javascript/serialization/): world serialization; pin the exact engine build when evaluating restoration.
- [Valve CS2 overview](https://www.counter-strike.net/cs2): sub-tick event intent and Source 2 presentation, not a complete engine specification.
- [Leetify glossary](https://leetify.com/blog/leetify-stats-glossary/): metric definitions, including TTD vs reaction and trade opportunities.
- [Leetify visibility update](https://leetify.com/blog/aim-stat-calculation-hitboxes-improved/amp/): changed hitbox-based visibility and benchmark comparability.

Validation status: loading audit completed all four browser cases without page or
asset errors; six isolated loader cases completed. `npm run check` passed all
3,880 tests in 191 files and the TypeScript/production build. Both audit scripts
passed Node syntax checks; `git diff --check` passed. Existing bundle-size warnings
remain. The build reproduced the deployed application asset names. No deployment
or gameplay changes were performed.
