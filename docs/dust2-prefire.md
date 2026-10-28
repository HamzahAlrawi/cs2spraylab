# Dust 2 Prefire

## Training

Select **Map prefire / Dust 2** in the drill picker. Ten distinct approaches cover
Long doors, pit, Long to A, Short, site boxes, Upper tunnels to B, B doors,
Mid, CT pushes, Lower/Upper tunnels and post-plant A/B retakes. The former
24 route entries become compatible fixed lineups within these approaches,
retaining source attribution rather than duplicating the same walking path.
Raw sampled facing and crouched stance are preserved in the catalog. Runtime
holders pre-aim a visible point on the selected approach, rather than blindly
reusing a facing authored for a different upstream route. See
`prefire-angle-sources.md` for provenance.
This is inspired by angle-clearing practice, not an import of Refrag's routes.
Weighted practice has 141 admitted source identities and 165 approach assignments,
including new B closet-side/close-right, tunnel-side box-top, lower/catwalk,
outside-long anti-push, Long car/A-site variants, extra Short/Top Mid holds and
elevated B post-plant checks. Some source records
describe overlapping variants, not distinct physical angles; shared families
prevent duplicate prevalence. Elevator samples that fail native placement and
unsourced ninja coordinates are not silently invented.

The adjacent panel groups approaches by region and selects fixed/weighted angle occupancy, static targets
or angle-specific behavior, optional return fire (300-2500 ms continuous sight
delay), a floor-following guide, repeat, next and automatic progression.
Angle-specific behavior is the fresh-install default; saved legacy movement
choices are retained. Local role annotations on the pinned source samples mix
stationary holds, duck-to-hide cycles, recurring controlled move-outs and periodic peeks.
Peeking bots use the shared full-speed motor, short controlled bursts and real
counterstrafes, rather than shift-walking into every fight. Quick, wide and
crouch-at-contact variants are assigned by angle. Oblique door exits and
112-unit swings are considered alongside shorter lateral lanes. A source sample
that is already exposed remains its fighting point; the bot physically retreats
to a validated covered endpoint before re-peeking it. Sightings shorten the next
re-peek wait and pre-aim the observed head, without following hidden movement.
Every excursion is checked for native hull clearance, floor support, neighboring
targets and spawn concealment; unsuitable geometry falls back to a hold.
Eligible move-outs can make a bounded, reversible advance along a native-validated
corridor after losing a recently recognized contact. They stop on reacquisition
and recover via their fighting point, never path toward hidden live coordinates.
Explicit local moving/peek hints use the same gates; passive local holds remain
fixed. See [active-bot behavior and limits](prefire-active-bots.md).
Static targets preserve source position and stance; their approach-facing
pre-aim uses authored route views, not the hidden player's current position.

Default bots do not fire. Enable **Return fire (bots fight back)** at the top of
the adjacent panel for bursts after seeing the player and counterstrafing to a
stop. Their timers reset on lost sight, shots recheck cover, and reloads use the
same weapon state machine as the player. A short immutable last-seen memory
does not track the player through walls. Cadence is seeded and varies per angle,
not a synchronized fixed back-and-forth loop. Geometry plans reserve only active
opponents and use a 16-roster LRU per map/course, keyed by behavior and selected
source identities. Route views are shared; regular perception runs around 11 Hz.
These are limited angle-clearing opponents, intentionally unlike Duel's adaptive
opponents. **Bots trade teammates** enables a bounded teammate-death response
when Return fire is on. Nearby allies use fresh recognized sight/sound reports
and prevalidated excursions, never the killer's hidden live position. They
counterstrafe and satisfy ordinary LOS/reaction/weapon gates before shooting;
after the order expires they return physically to their hold. No usable local
excursion means no invented movement route. See `bot-trading-and-facing.md`.
Clear every active enemy to finish a course. The next route starts by default
after the review notification; **Repeat route** keeps the current course.

All ten starts use native shot-blocking cover, including a 64-unit cover margin,
standing/crouched
views, shoulder/crown margins and a protected initial 32-unit movement. Dense
native geometry checks also verify every standing and crouched walking course,
first-contact exposure after moving, and original target head reachability.
These are locally authored landmark starts and paths, not copied upstream route
data. Outside Long, Long corner, upper-tunnel pillar, CT-mid cover, Xbox slope,
CT-side Mid doors and under-A cover replace several awkward or narrow old
starts. B retake uses the supported CT-spawn approach around the intervening
wall; a shorter slow-sweep connector was rejected after actual running stalled.
See `prefire-map-case-study.md` for the development record and next-map gates.

Shots, recoil, accuracy, movement, crouching, jump physics, switching, reloads,
native character animations, armor and hit feedback reuse the Duel simulation.
The scorecard reports accuracy, headshots, stopped-shot percentage, elapsed time,
shots, kills, feedback and score. Prefire does not award Duel XP or add entries
to Duel history.

### Deliberate Practice

The training preset selector provides an explicit progression:

- **Learn the angles:** all static targets, route guide, no return fire. Select
  Repeat route to learn one course's likely threat locations and opening aim.
- **Clean entries:** angle-specific behavior, random occupancy and no guide.
  Keep the same shot timing when the expected angle is empty or a bot peeks.
- **Under pressure:** the same uncertainty with return fire at 750 ms. This is
  a training preset, not a measured FACEIT rank. Reaction remains customizable.

Presets leave progression and trading preferences unchanged. New installations
advance by default; explicit saved Repeat route choices remain authoritative.
Weighted occupancy
can omit any angle, including the first, drawing from native-validated holds in
compatible course variants. **Bots per run** chooses one to five nonoverlapping
targets (default four); the count is no longer an independent coin flip.
Selection mixes 50% equal physical-family coverage with 50% match-balanced
nearby-hold support, separately for enemy side and preplant/postplant phase.
Every match contributes equally, including zero-support rounds; overlapping
variants share a family rather than multiplying that corner's prevalence.
Without support, families are uniform. Broad centroid proximity is regional
evidence, not verified local-pocket or encounter probability. This declared
coverage policy is not a fitted FACEIT distribution. Position evidence explains
the sample and statistical limits.
Native source positions are not displaced to fake randomness.

The dedicated Prefire coach separates opening velocity, prepared aim, opening
hits, recent-movement entries and time with one visible threat. It uses existing
32-Hz sight samples and actual shot IDs/weapon-mode accuracy data; no new
silhouette grids or pathfinding run each frame. Prepared aim uses only an exposed
head point, or an exposed body point for body-focused weapons. A horizontal
tolerance of two head radii or one degree, whichever is larger, permits
micro-corrections. Vertical rifle aim uses 1.5 head radii or 0.1 degrees, so
chest-level aim is not incorrectly accepted at long range. Body-focused weapons
use a larger vertical allowance.
This tolerance affects coaching only, never physical hitboxes or bullets.

Opening quality is measured once per target, rather than being overwritten by
later successful shots. A hit before the next sight sample is registered from
its actual event without fabricating a hidden-head measurement. Mouse movement
is not directly penalized; unexpected targets require legitimate corrections.
"Clean entry" requires measured movement within 750 ms, settled firing, prepared
aim where measurable and no second visible threat at that shot. It does not
prove which counterstrafe key was pressed. One-threat exposure uses the player's
view and sampled LOS, not unseen enemies behind the camera.

Quality score weights completion 20%, settled openings 25%, prepared aim 20%,
clean entries 15%, isolation 10% and hit efficiency 10%. Hit efficiency reaches
full credit at 50% accuracy, so an isolated spread miss is forgiving. Time is
not rewarded. A clean-route goal requires a complete route, at least three
openings (or every target in a smaller population), 90% settled openings, 70%
prepared aim, 70% clean entries, 80% one-threat exposure and 35% hit accuracy.
These are local coaching heuristics, not validated learning-rate or professional
performance benchmarks. Two comparable clean wins form the progression goal.

Per-angle advice appears below the crosshair after a kill and remains available
in Angle review. Small landscape views keep the advice in the panel/result
instead of covering the HUD. Prefire has an independent 2-10 second review
timer, default five seconds; Duel retains its existing short timer. Completed
runs alone enter a bounded, validated local history of 40 records. Scores/streaks
compare only the same course, starting loadout, bot count, occupancy, behavior, return-fire
delay, effective trading and guide setting; changing weapons or difficulty is not a free personal
best. Storage failures fall back to the current session.

Deep regressions also fixed queued trigger input after pause, one-tick cover
breaks retaining a continuous-sight reaction timer, and exhausted bots sticking
in an exposed burst. Reload progress, ammunition, recoil and scopes survive
pause; pending trigger/windup inputs do not. Visible contacts have a cheap
post-movement continuity guard; hidden targets retain staggered idle sensing.

## Geometry Provenance

`tools/import-dust2.mjs` reads the installed `game/csgo/maps/de_dust2.vpk` using
Source2 Viewer CLI (current build recorded in the inventory). It extracts the
`PHYS` block from `world_physics.vmdl_c`:
native convex hull faces and indexed mesh triangles, without collision
decimation. Source coordinates become `[x,z,-y] * 0.0254`; heights are not
normalized and there is no map resizing. Clip/pass-bullet and player-exclusion
groups have separate movement and shot masks. The public binary is checksummed.

VRF's glTF world export uses `[Source y, Source z, Source x]` in meters. The
importer rotates that export 90 degrees around Y to match the collision frame.
Do not apply another unit conversion to the glTF. An earlier visual/physics
comparison caught this transform mismatch; both data paths now share a frame.

Visual meshes use spatial batches, visual-only Meshoptimizer simplification,
16-bit position quantization and Meshopt compression. Native albedo textures
are retained up to 1024 pixels; normal/AO/roughness data maps up to 256 pixels.
Native UV sets, per-instance linear tints and opaque/cutout/blended modes are
preserved. Signs, overlays, doors, trims and high roofs stay in the scene.
Tool/light-volume and unsupported soft-particle helper meshes are not drawn.
Vertex colors used only for foliage wind are not treated as visible tint.
Collision stays untouched. Lighting and layered Source 2 materials still use
browser approximations, not the complete CS2 renderer. Current import sizes,
exporter revision and source hashes are recorded in `dust2-map-inventory.json`.

## Runtime And Limits

The mode and Rapier WASM are lazy-loaded. Other modes do not fetch Dust 2.
Rapier is only a static shape-query accelerator: the existing 128-step trainer
motor computes velocity, friction, counterstrafing, crouch and gravity. This is
not a replacement with Rapier rigid-body movement and not Valve's engine.
Static visual sectors are frustum-culled and use native VXVS potentially-visible
sets. Unmapped viewpoints fail open to avoid disappearing rooms. Native
textures are content-addressed, shared on the GPU and external to sector files.
Public files stay below Cloudflare Pages' 25 MiB per-file limit.

Vertical queries clip native triangles against the full square player hull,
so seams and float32 shape-query noise do not cause false airborne flags. Native
ground tolerance also spans the shape-cast skin; otherwise gentle uphill motion
can fall between both queries and incorrectly select air acceleration. Fixture
tests compare moving uphill/downhill acceleration, wall sliding, 18/19-unit
steps, jumping and airborne crouching to the existing motor, rather than merely
testing waypoint clearance.
Source positions must fit at their sampled height within six units; no horizontal
nudge or snapping to a different floor conceals invalid target/spawn placement.

The native-map world camera follows the interpolated actor eye, just like the
shot-origin coordinate model. The earlier extra stair lag displaced that view
by as much as 18 units and made aiming misleading on rising terrain. Stair
easing is now restricted to a small cosmetic viewmodel offset; it does not move
the world camera, actor hulls, shot origins, existing impacts or recoil state.
Its Source SDK-inspired rate is not a verified current-CS2 view algorithm.

Map dimensions and static collision come from native data. Imported bot rigs
now use all 19 bone-local SAS cstrike hit capsules, including the original
4.3-unit head radius. On-demand sampling uses current authoritative actor
position, facing, pitch and stance; it does not reuse a stale rendered pose or
move a shot toward a target. Nearer arm/body capsules still block head hits.
The local player and headless/unloaded-rig fallback retain analytic shapes.
Animation blending, perception proxies and native subtick interpolation remain
approximations. See [aiming audit](prefire-aiming-audit.md).
Native map walls currently stop bullets as opaque cover, so
material-specific Dust 2 wallbangs are **not** reproduced. Native navigation,
scripted map entities, CS2 baked lighting and dynamic doors are not imported.
This prevents claiming complete in-game equivalence.

The importer is offline and reads only static files. It does not attach to a
running game, read game memory, automate aiming or send commands to CS2.
Native assets stay ignored locally, like the existing native weapon assets.
SprayLab is not affiliated with Valve, FACEIT or Refrag. Preserve attribution
and review asset redistribution permissions before publishing native artwork.

## Verification

- `npm run assets:dust2`: regenerate collision and lightweight art.
- `npm run assets:check:dust2`: check hashes, units, compression and file limits.
- `npm run audit:prefire`: sweep the native 32x72-unit standing hull along every
  course segment and check physical visibility at standing/crouched head height
  and target overlap, plus full upper-body concealment at spawn.
- `npm run audit:prefire:bots`: seeded native movement/return-fire audits,
  actual cover-changing peeks, crouched silhouette checks and planning/decision
  costs. Geometry probes are cached and never run on regular controller ticks.
- `node tools/audit-prefire-training.mjs`: walk and shoot all native courses,
  respecting collision, weapon spread, recoil, ammunition and real damage.
  It checks complete clearance and agreement between actual events and training
  statistics. Its offline QA driver is not human-skill calibration or a feature
  included in the browser game.
- `node tools/audit-dust2-movement.mjs --routes`: native-ground/crouch accuracy,
  shared-core braking comparisons and continuous route traversal.
- `node tools/audit-dust2-movement.mjs --motor-routes`: running-speed waypoint
  diagnostics including ground transitions, stopped ticks and height changes.
  This simple steering driver is a diagnostic, not proof of human pathing parity.
- `node tools/profile-prefire.mjs --active`: whole-frame CPU/draw statistics and screenshots
  across all courses. GPU competition from other apps can affect these results.
- Add `--combat` for physically approached visible bot contacts. `CPU_RATE=4`
  enables Chromium CPU throttling; that does not emulate a specific old CPU/GPU.
- `npx vitest run src/range/prefire`: config persistence, scenario behavior,
  visibility-gated return fire, transitions, clip/shot masks, source transform
  and optional installed-map floor/clearance integration.
- `npx playwright test tests/prefire.spec.ts --project=chromium --project=mobile-chromium`:
  rendered desktop/mobile map, all courses, pointer lock, firing, mode switching
  and adjacent controls. The native asset tests require a local map import.

`author-prefire.mjs` is an offline authoring aid using A* plus native swept-hull
edge validation; no pathfinding library runs in the browser. `preview-dust2.mjs`
generates a native clearance diagnostic. Neither modifies course definitions.

Verified 2026-10-09 against map build 2000927: 40 targets, eight courses, two
seeds and 180 simulated seconds per run. The final geometry-eligible mix is
19 holds, four crouch-hiders, ten cover-changing periodic
peeks and seven move-outs. All bot-behavior checks pass. The nonfiring audit
walker cannot complete B doors while its live close-door NPC occupies the lane;
those four traversal diagnostics are separate from bot-behavior failures.
Kill that defender before walking through, as required by the normal course.

The refined geometry planner considers more directions and denser course views.
Local cold plan creation measured 32-143 ms; cached repeats 0.34-1.50 ms.
These are Node/native-query timings on this machine, not browser FPS or a
guarantee for older hardware. The retained report is locally generated under
`research/dust2/prefire-bots-final.json`, which stays ignored.

## References

- [Source2 Viewer map export guide](https://s2v.app/ValveResourceFormat/guides/exporting-maps.html)
- [VRF native hull decoder](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Shapes/Hull.cs)
- [VRF indexed physics meshes](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Resource/ResourceTypes/RubikonPhysics/Shapes/Mesh.cs)
- [VRF voxel visibility reference](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Resource/Blocks/VoxelVisibility.cs)
- [OpenPrefirePrac Dust 2 profiles](https://github.com/lengran/OpenPrefirePrac/tree/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26/maps/de_dust2)
- [Rapier scene queries](https://rapier.rs/docs/user_guides/javascript/scene_queries/)
- [Valve Source SDK stair-view implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/baseplayer_shared.cpp)
- [Meshoptimizer processing and compression](https://github.com/zeux/meshoptimizer/blob/master/js/README.md)
- [Refrag Prefire](https://wiki.refrag.gg/en/Prefire)
- [Refrag angle-training concepts](https://refrag.gg/blog/refrags-angle-trainer-level-up-your-cs2-crosshair-placement-pathing/)
- [Refrag counterstrafe coaching](https://refrag.gg/blog/counter-strafing-the-key-to-precision-aim-in-counter-strike-2/)
- [Refrag random occupancy and micro-adjustment practice](https://refrag.gg/blog/refrag-update-bringing-prefire-to-the-next-level/)
- [Refrag pre-aim, angle isolation and shooting choice](https://refrag.gg/blog/how-to-improve-your-aim-in-counter-strike/)
