# Gameplay Integration Audit

Date: 2026-10-05. Source baseline: `49d8ea6`. Frontend-only, offline training.
No process hooks, live game memory, input injection, game automation or native
DLL loading. Offline numeric tools emulate hash-pinned arithmetic blocks only.

## Delivered Runtime

| Area | Integration | Remaining Boundary |
| --- | --- | --- |
| Penetration / collaterals | Shared ordered material entry/exit and flesh contacts; residual damage and range falloff; cover impacts are physical points | Native loss arithmetic verified, not native map/entity tracing; overlapping materials and analytic Duel hit zones remain simplified |
| Range scoring | Same simulated shot ray; target-mesh front/reverse entry/exit; one scored discharge even for collaterals/pellets | Head threshold remains the existing mesh-height classification; no native articulated hitboxes |
| Shotguns / Zeus | Four shotguns and Zeus in loadouts/bot pools; native pellets, recoil/spread data, cadence, reserves; Zeus slot 4/recharge | Zeus special damage-distance curve unresolved; generic native-data falloff fallback |
| Knife | Slash/stab, first/follow-up hits, backstab, hull fallback and cover occlusion; selected knife bots approach and attack | Damage/ranges/cooldowns/backstab cone are Source-family estimates, not current-build native fixtures; range melee remains practice feedback |
| Reload / alternate actions | Finite inventory; magazine/start/shell/finish state; interruption/holster, phase-aware animation/foley; scopes, bolt cycling, burst and R8 alternate mode shared | Ammo commit timing, shell start/end and silent multiplier are estimates; R8 windup remains estimated |
| Terrain / contacts | Same actor motor for human and AI; ramps, stairs, ladder/water triggers, crouch clearance, actor support/carry, jump edges and landing recovery | Continuous hull solver and water/ladder projection are trainer implementations; not native collision or complete subtick processing |
| Boosts / routing | Native actor support plus two real jumps; base-first update, support settling and second-jump run-up; quiet route planner for safe experienced bots | Authored opportunities and rank-conditioned coordination heuristics; novices do not execute these advanced plans |
| Environment | 15 new bundles beside 54 original POIs; use-operated gates, glass/vents, impulse-driven cargo; one shared resolved state | Authored geometry/health/mass; translation-only cargo; sliding doors become passable immediately, not native hinge/contact animation |
| Tactics | Sight/sound memory, timed trades, entries, crossfires, safe terrain use and partner boosts; knife/close-range weapon handling | Skill presets and decisions are trainer heuristics, not measured FACEIT-equivalent humans |
| Shadows | Rendered and sensed low-cost footprints use the same illumination/occlusion checks; only visible footprint evidence reaches the brain | Ground receiver only, conservative ellipse silhouette; not Source 2 shadows or wall/elevated receivers |
| Radar | Rotation, zoom, hide setting; LOS contacts and expiring last-known coordinates; no hidden-position refresh | Single-player training radar, not full team spotting/server spotted-mask logic |
| Armor | Independent Kevlar, helmet and 0-100 condition for player/global/per-bot; pellet-order exhaustion; XP threat weighting accounts for actual starting protection | Native weapon armor ratios verified; integer damage rounding and complete engine damage flow not verified; XP protection weighting is a training heuristic |
| Immediate combat | Direct actor commands; current target geometry; firing, damage, death and round events delivered together without artificial delay | Local fixed-step simulation, not online multiplayer; ordinary frame interpolation and native weapon/human AI timings remain |
| Animation / death | Native view actions and lazy world gestures; actual stance/air height preserved; world-geometry constrained skeletal falls | Native clips retargeted/blended in Three.js; death physics is a lightweight joint solver, not native VPhysics; player death remains a camera/weapon fall |
| Audio | Native varied samples/event foley; audience-specific action windows, reload loops, silent suppression; directional HRTF and cover transmission/detours | Native bank build 2000922 retained; propagation/reverb approximated, not Source 2's acoustic engine/distant layers |
| Recoil / spread | Installed-build primary/alternate/shotgun tables; native uniform RNG transform and R8/Negev radial branches; accumulated punch/inaccuracy survive release | Camera `.45`/weapon `.22` fractions and old punch recurrence remain estimates; shot ordinal is a training seed, not native command/subtick seed derivation |

Local latency simulation was removed at the user's request on 2026-10-05.
There are no input delivery queues, historical snapshots, rewind, weapon
prediction replay or delayed hit/round presentation. Sanitization drops old
global and per-bot ping/buffer preferences while preserving unrelated settings.
Mouse look is immediate between fixed ticks; ordinary frame interpolation,
weapon cadence/reload/deploy timings and human AI reaction delays remain.

The unchanged physical scoring contract is important: cosmetic muzzle traces,
crosshair positions, body gestures and camera kick never determine a hit. Range
shots use actual mesh intersections; Duel uses its existing analytic zones.
Previously fired wall points do not follow later camera/distance changes.

## Evidence And Checks

- Fresh installed build **2000924**, weapon export SHA-256
  `3289d4dba65b1ef3f884c389448c8a6c6db8691442c18a7aaddb28434aaf250d`.
- `node tools/verify-weapon-data.mjs`: all 35 retained definitions, both modes.
- `python tools/verify-native-recoil.py`: RNG, primary/alternate impulse and
  four shotgun angle/radius tables against hash-pinned isolated machine code.
- `python tools/verify-native-penetration.py`: scalar loss and stop/count cases.
- `node tools/verify-native-surfaces.mjs`: eight native material aliases.
- `python tools/verify-terrain-contact.py`: 32 landing-factor outputs and
  ladder detach constant; does not certify collision/time selection.
- `node tools/verify-presentation-assets.mjs`: 219 clips, 36 mesh/texture-free
  packs, 82 desktop/mobile animated pose checks. Actual application tests also
  verify standing/airborne head height, nonblank canvas pixels and bounded GPU
  resources. A radar bounding-box regression prevents covering the game view.
- Third-person gesture packs retain `wpn`/`wpnPivot` as well as hand channels.
  Source2Viewer's [additive export metadata](https://s2v.app/ValveResourceFormat/api/ValveResourceFormat.IO.GltfModelExporter.html)
  distinguishes raw delta tracks from absolute poses; deltas layer over active
  locomotion instead of the bind pose. Procedural aim carries the weapon anchor
  by the wrist transform, maintaining the posed grip rather than leaving the gun behind.
- `npm run assets:check`: converted local asset completeness, PCM bank, native
  grips and finite models; runtime assets are intentionally Git-ignored.
- `npm run check`: complete unit regressions, TypeScript and production build.
- Live guide-projection checks cover 4, 15 and 90 meters, crouched/intermediate/
  standing eye heights, and both Follow Recoil states. Assertions use physical
  mesh hits, not the projected cue alone.
- Lethal-hit feedback and death-pose initialization are checked on the hit frame
  at both 30 and 240 FPS. Dynamic deaths preserve the hit pose and contact a
  raised platform at real elapsed time; the native baked fallback is tested separately.
- Armor/helmet/condition and radar controls are checked through the UI, the live
  simulation and persisted configuration. Legacy latency settings are discarded;
  input, ammo, scope/reload and hit/round feedback have immediate-combat regressions.
- Browser checks exercise weapon firing/reload/recharge, input, feedback,
  stance, loadouts and performance in Chromium, Firefox, WebKit, mobile
  Chromium/WebKit, Brave and Opera GX. Emulation is not physical-phone testing.

Native numeric provenance and precise limits are recorded in
[combat](combat-physics-audit.md), [weapons](weapons-combat-audit.md),
[terrain/contact](terrain-contact-audit.md), [environment](environment-mechanics-audit.md)
and [team tactics](bot-team-tactics-audit.md).

Latency removal checks (2026-10-05): **1,935 unit tests in 103 files**, TypeScript
and production build passed. Reviewed Chromium workflows had **28 passes and
two mobile-only skips**, including the corrected configuration-migration test.
Additional native firing/reload/recharge checks passed in Firefox, WebKit,
mobile Chromium and mobile WebKit. No new physical-phone testing was performed.

Prior expansion checks (before latency removal): **1,953 unit tests in 105 files**, TypeScript and production
build passed. The full Chromium replay had **95 passes and three mobile-only
skips**. Final-source smoke/workflow checks across Firefox, WebKit, mobile
Chromium/WebKit, Brave and Opera GX had **23 passes and 13 platform-inapplicable
skips**. Native presentation validation passed all 82 desktop/mobile pose renders;
asset completeness and the native arithmetic/data verifiers also passed. No
physical-phone or end-to-end CS2 parity certification is implied. The build still
warns about the large initial JavaScript chunk (2.72 MB, approximately 594 KB gzip).

## Performance

No generalized rigid-body engine or per-shot GL allocation was introduced.
Static props remain batched; dynamic instances preserve stable IDs. Gesture
packs load on demand and are cached with bounded ownership. Native motor runs
at 128 Hz; planning/perception run at 32 Hz, shadows at 20 Hz, radar at 10 Hz.
Terrain worlds/routes are cached by immutable geometry identity. Dead joints
sleep; cosmetic effects are pooled. Latency queues, history and weapon prediction
replay have been removed entirely.
Aim layers refresh the descendant skeleton once after the spine chain rather
than repeatedly per joint; a nontrivial rotated-chain regression verifies the
same world-space pitch. Static batching separates incompatible index/attribute
layouts instead of losing mixed ramp/prop geometry during merging.

Final standalone benchmark on this machine (`npm run bench:duel`, seed 431,
20 simulated seconds, no WebGL): one bot 532 ms total, p99 tick 1.35 ms;
five bots 1604 ms total, p99 tick 2.69 ms. This is not an old-CPU guarantee or
a complete frame-time measurement; hardware/browser/load change the results.
Performance quality, adaptive resolution and frame caps remain available.

The final renderer profile uses fixed Freight yard seed 431, preloaded gestures,
Performance quality, a 60 FPS cap, and 4x Chromium CPU throttling. CPU p95 was
9.0 ms for one bot, 23.2 ms for five bots in normal cover, and 25.2 ms for the
synthetic five-visible-bot stress case. Median frame interval was 16.7 ms;
p95 intervals were 20.8 / 37.4 / 29.2 ms respectively. There were no page errors.
Five-bot scenes still have frame-time spikes under this throttle. These short
synthetic measurements do not certify physical old CPUs, integrated GPUs or
mobile devices. Reproduce with `npm run profile:duel`.

## Distribution

The local workspace includes converted assets. A Git clone does not. Build
success alone cannot prove an asset-complete deployment. Run asset validation
before publishing. Valve content remains separately proprietary; these imports
do not grant redistribution rights. This audit does not claim a deployment or
that the trainer is indistinguishable from CS2.
