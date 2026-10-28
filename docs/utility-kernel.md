# Utility Kernel Contract And Sources

This is a browser training approximation, not CS2 gameplay automation, a lineup
certifier, or an implementation of Valve's native grenade/smoke solver.

Updated October 28, 2026. The [native fidelity audit](native-grenade-fidelity-2026-10-28.md)
supersedes earlier numeric assumptions. Build 2000935 is statically inspected;
offline arithmetic fixtures are not a measured comparison with a running game.

## Integration

- `UtilityKind` is imported/re-exported from `utility-loadout.ts`; all six item
  IDs are supported: he, flash, smoke, molotov, incendiary, decoy. The two fire
  items share a fire class but retain different durations and spread limits.
- `new UtilitySimulation(seed)` owns only utility entities. `reset()` resets its
  clock, IDs, entities and deterministic random stream.
- `throw({actorId, side, kind, origin, direction, velocity?, strength, time})`
  returns an ID, or `undefined` for invalid input, stale release time, or a full
  projectile pool. `velocity` means actor world velocity, not projectile velocity.
  The caller owns inventory, equipment readiness and the hand origin. Origins
  must be outside world solids with grenade clearance. No target teleportation,
  implicit hand offset, pitch remapping, or aim correction is performed.
- `utilityLaunchVelocity(direction, strength, actorVelocity)` normalizes the
  already pitch-adjusted direction, uses the extracted per-item throw velocity,
  native speed clamp and strength scaling, and adds `1.25 * actorVelocity`.
  `utilityLaunchPose` applies the native pitch remap, strength-dependent eye height
  and forward 16-unit +/-2.02-unit hull sweep. `UTILITY_RULES.gravity` is `320 * .0254`
  metres per second squared. Coordinates are world metres, y-up; trainer pitch
  is positive-up and yaw zero faces negative z.
- `advance(dt, time, arena, actors)` takes interval **end time** in seconds.
  Intervals must be contiguous and monotonic. First call establishes the clock
  at `time - dt`. Physics uses a 128 Hz accumulator; results can lag by less than
  one physics tick. Future releases are not simulated before release time.
- Actors are read-only structural inputs: `{id,side,position,feet,yaw,pitch,
  alive,duckAmount?,armor?}`. Missing armor is zero. Actors, arena, caller vectors
  and snapshots are never mutated by the kernel.
- `projectiles` and `effects` are allocation-free, borrowed **read-only views**
  for immediate rendering; do not mutate their elements or retain them as
  historical state. `snapshot()` provides a detached deep copy when needed.
  Projectiles have `{id,actorId,side,kind,position,velocity,radius,thrownAt,
  resting,bounces}`. Effects have `{id,actorId,side,kind,type,position,radius,
  startedAt,expiresAt,cells,holes}`. Effect type is smoke/fire/decoy/burst;
  effect `kind` retains the actual selected utility item.

`advance` returns `UtilityEvent[]`, discriminated by **`type`**, not `kind`:

| Type | Additional Fields |
| --- | --- |
| damage | targetId, damage, cause (he/fire/decoy), shooter, victim, healthDamage, armorDamage, point, direction |
| flash | targetId, exposure (0..1), duration (seconds) |
| sound | sound (bounce/he/flash/smoke/ignite/extinguish/decoy/decoy-end), radius (metres) |
| detonate | none |
| bounce | normal |
| extinguish | smokeId |
| expire | none |

Every event carries `{utilityId,time,actorId,side,kind,position}`. Damage `damage`
aliases healthDamage. Damage direction points from the utility to the target's
chest. Events report requested damage, not health-clamped applied damage. The
caller applies team-damage rules, health changes, flash stacking and sounds.
Armor is provisionally consumed across multiple impacts within one advance;
the caller must apply those events before the next call. Fire bypasses armor.
Death and respawn remain entirely caller-owned.

## Smoke And Performance

- `obscuresSegment(from,to,time)` checks a finite segment; `smokeExposure`
  returns bounded sampled optical obscuration in [0,1]. The standalone
  `smokeSegmentExposure(from,to,effects,time)` also works on snapshots.
- `sightFilter(observer,time)` returns `(samplePoint) => boolean`, true for a
  clear sample. Apply this to **every** visible body/shadow sample rather than
  hiding an actor because only its aimpoint is smoky.
- `clearSmokeSegment(from,to,time,radius=.12,duration=.35)` accepts the caller's
  world-clipped bullet segment. HE independently creates a 3 m spherical hole
  for one second when not separated from the smoke center by world cover.
  Bullets create capsule-shaped holes; neither deletes the cloud. Plain chords
  use 24 deterministic samples against connected cells and active holes.
- Hard limits: 32 projectiles, 64 effects, 768 smoke cells/effect, 16 fire cells/effect, 16 smoke
  holes/effect, 64 live actor inputs, 4 contacts/projectile/tick and 4096 returned
  events/call. Excess throws are rejected, excess persistent effects are not
  added. Callers should stay well below these defensive caps.
- Collision prefers `arena.native.sweepGrenade`: a two-unit cuboid with separate
  grenade masks and the installed Dust 2 grenade-clip mesh. `sweepSphere` is used
  only without that query, never after a clear grenade sweep. Snapshot restoration
  reapplies masks without changing movement/shots. Standing/crouched actor hulls
  bounce grenades, ignoring the thrower for .2 seconds. Authored maps use the shared
  convex box/ramp hull sweep for cover and release placement.
  Native maps require their grenade/sphere query. The synthetic y=0
  floor and authored x/z boundary bounces apply only to non-native arenas.
  Native chunk extents are not physical grenade walls.
- Fire damage runs at 5 Hz. Smoke/fire coverage checks run at 10 Hz, with
  immediate checks after a newly deployed smoke/fire. No RNG or wall-clock
  globals are used; decoy cadence and per-inferno placement have independent seeded streams.
- At most one second/128 physics ticks is simulated per call. Longer suspension
  intervals discard skipped projectiles and expired effects rather than
  delivering old grenade damage to current actor positions. Short frames are
  partition invariant for identical actor/arena inputs; interpolation and moving
  actors between calls remain caller-owned.

## Evidence

Local extracted static data was read on 2026-10-26 through 2026-10-28; nothing was read from a
running game or game memory. This document does not assert the installed data
matches the latest live version.

- `research/weapons.vdata`, SHA-256
  `3289d4dba65b1ef3f884c389448c8a6c6db8691442c18a7aaddb28434aaf250d`:
  all six grenade definitions have `m_flThrowVelocity = 750`. Generic vdata
  damage fields are **not** treated as actual blast or flash damage.
- `research/convars.txt`, SHA-256
  `5f7d0b3e965fc9aa5260f7ef084f86f46557e8ed87835fe6e4d6644121f9a079`:
  `inferno_damage/inferno_damage_ct = 40`, `inferno_damage_timer = .2`,
  `inferno_flame_lifetime = 7`, `inferno_flame_lifetime_incendiary = 5.5`,
  `inferno_max_range = 150`, `inferno_max_range_ct = 110`,
  `inferno_max_flames = 16`, `molotov_throw_detonate_time = 2`,
  `weapon_molotov_maxdetonateslope = 30`, `sv_gravity = 800`.
  The radius convar of 2 units is a reference size, not proof of the actual
  native hull: `sv_grenade_collision_sphere` is false in this dump.
- [Valve's CS2 feature description](https://www.counter-strike.net/cs2) describes
  smoke as environment-interacting volumetric objects responsive to shots and
  explosions. This kernel deliberately uses a simpler analytic volume.
- [Valve's May 23, 2024 release notes](https://store.steampowered.com/news/posts/?appids=730&enddate=1718063111&feed=steam_announce%2F1000)
  establish that incendiary duration/spread differs from molotov; the numeric
  values above come from the installed convar dump, not that historical note.

## Accuracy Boundaries

The installed client/server code verifies launch arithmetic, default gravity,
biased collision clipping, elasticity clamp, slope/speed settling conditions and
high-speed floor attenuation. Native-reference tests cover isolated arithmetic.
World support is assumed eligible; specialized entity predicates, moving supports,
breakables, contact damage and complete Rubikon behavior remain incomplete.
Separate grenade mask selection does not certify every native trace flag.

HE/flash store a 1.5-second deadline and use strict greater-than and tick-quantized
0.2-second think requests. The trainer's first check is the nearest outer tick at
creation; native first-dispatch ordering has not been measured. Do not replace
these clocks with a universal 1.5, 1.6 or 1.625-second detonation. The eight-second
defensive projectile timeout remains a trainer limit.

HE uses extracted 99 damage, 350-unit radius and native exponential falloff,
with native ordinary blast armor ratio/cost/truncation. Exposure has the native
five weights, but binary rays and a deterministic chest point still simplify
fractional obstruction, randomized BodyTarget and alternate-source selection.
The hull/sphere broad phase approximates the native entity-shape query.
Final fractional-health accounting is not certified native.
See [HE findings](native-he-findings.md). Fire uses the native spawn-relative
two-second raw-damage ramp and bounded parent/child timers instead of an instant
golden-angle patch. Reachable floor projection, candidate generation, flame
lifetimes/contact volumes and cross-inferno stacking still simplify the engine.
It does not ignite through walls or project distant airborne bursts to ground.
Raw fractional damage is preserved; final native integer-health carry is not
claimed. See [inferno findings](native-inferno-findings.md).

Smoke now requires age >= float32(1.188) and speed <= float32(0.1) native units/s.
Its volume-build completion/visibility latency is not reproduced.
Smoke still has a spherical analytic envelope, one-second bloom, 20-second lifetime,
and a fade; it is **not exact native volumetric smoke**. A bounded .8 m grid
fills connected space around openings and rejects sealed wall/floor crossings.
Its index is shared by sight, fire suppression and interior overlays.
Smoke-covered fire cells are removed; covering more
than one third of the remaining fire cells extinguishes the effect. Coverage
requires solid-world LOS and is aggregated across smoke entities; this is a
trainer rule, not a certification of current native multi-smoke behavior.

Flash uses the installed 3000-unit distance term, four 3D facing bands,
hold/fade/network-duration arithmetic and nonadditive overlapping flash state.
Three alternate offset paths use clipped first endpoints and .167 visibility
contributions when direct LOS fails. Trainer queries still simplify the native
filter and material/animated-entity behavior. Smoke visibility is not arbitrarily
multiplied into flash exposure. Client alpha, afterimage and compositing remain
adaptations; a bounded local low-pass approximates flash deafening.
See [flash findings](native-flash-findings.md).
Decoy cadence, audible radii, 15-second life and its small
terminal damage are explicit training approximations, not extracted sound
propagation or measured native decoy behavior.
