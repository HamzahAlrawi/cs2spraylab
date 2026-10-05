# Authored Environment Mechanics And Integration

## Scope And Evidence

This package adds offline, authored training geometry and pure dynamic state.
There are no game hooks, process inspection, input automation, network services,
or runtime CS2 dependencies. Neither the terrain shapes nor their health, mass,
door reach, shallow-water drag, or break thresholds were extracted or measured
from CS2. They are explicit content estimates, not an exact-parity claim.

The existing project metre scale (`UNIT = .0254`), 32-unit hull width,
72/54-unit stance heights, and 18-unit step allowance informed the layout.
The separate movement worker owns evidence for the shared contact solver.
This package does not change recoil, aim, actor physics, shot generation, or
world-space impact storage. Analytic entry/exit points are geometric results,
not native game penetration rules.

## Layout Content

The original 54 cover templates remain in `arenaPOIs`. A separate 15-template
`environmentPOIs` catalog provides these purpose-built traversal bundles:

| Theme | Authored Bundles |
| --- | --- |
| Freight | Inspection stairs and loose dispatch cargo; container loft with ladder and stair-accessed partner boost |
| Service | Maintenance ramp; shallow drainage crossover; breakable crouch vent |
| Courtyard | Water rill with dry bypasses; breakable full-height arcade window |
| Switchback | Ramped overlook with jump-up block; use-operated sliding gate |
| Loading | Dock stairs; breakable receiving glass |
| Workshop | Ladder loft; movable cargo and fixed rack; sliding door; crouch vent |

One environment pair replaces a flank pair. The existing four-POI compact and
six-POI regular counts remain unchanged. Permanent camp/spawn cover is never
interactive. Assemblies, hulls and step rises are not scaled down for small maps.
Stairs have four .3m rises and 1.8m-wide treads. Ramps rise 1.2m over 2.4m;
their renderer and combat ray use the same actual wedge. Ladder lofts have a
2.4m top and clear approach/dismount positions. Water is a .32m-deep volume
over the existing floor, not a pit or hidden ground-height change.

Doors/glass provide standing shortcuts; vent lintels leave a 1.4m-high
crouch passage. Removing a panel never removes its structural jambs/lintel.
Movable wooden cases are low cover, not replacements for guaranteed spawn cover.
Boost links mark content opportunities; partner-required links never imply
automatic actor stacking or a stronger jump impulse. Freight/workshop lofts
provide a 1.8m x 2m shared assembly platform at .95m height, reached through
three .3m treads and a final .05m rise. Base and climber mount centres are
.95m apart, each fully inside the platform footprint with hull clearance.
The crouched partner's top is at 2.3216m, just below the 2.4m loft perch.
The library places these opportunities occasionally as opposing mirrored pairs.

The existing bounded generation, reservations, reachable camp/entry/flank
anchors and five hidden starts are retained. Layout intersection checks are
3D, allowing a lintel and its panel to touch without treating their common
horizontal footprint as interpenetration. Surface count is bounded below 40.

## Typed Contract

Definitions live in `src/range/duel/environment.ts`, imported as types by
`geometry.ts`. Existing `Solid` literals remain legal. Optional metadata:

```ts
type EnvironmentMetadata = {
  id?: string;
  material?: 'concrete' | 'metal' | 'wood' | 'glass' | 'grate' | 'water';
  health?: number;
  active?: boolean;
  passable?: boolean;
  shotBlocking?: boolean;
  shape?: {kind: 'ramp'; axis: 'x' | 'z'; highSide: -1 | 1};
  interaction?: EnvironmentInteraction;
};
```

Generated IDs are `arena/central-screen` and `${poiId}/${localPartId}`.
Old manually constructed solids fall back to `solid-${arrayIndex}`. Numeric
`surfaceId` is always the original array index, even after destruction.
Never splice or replace the authored static solid array to remove a piece.
Arrays and template objects are not mutated by state reducers.

`EnvironmentInteraction` is a discriminated union:

- Door: `{kind:'door', openOffset:Vec, useRadius:number, initiallyOpen?:boolean}`.
- Breakable: `{kind:'breakable', debris:'glass'|'vent'|'wood'}`.
- Movable: `{kind:'movable', mass:number, damping:number, maxSpeed:number}`.

Main can store `gameplayState: EnvironmentState`, initialized once per round
with `createEnvironmentState(arena)`. It contains `{revision,pieces}`; `pieces`
is an ID-keyed record of `{health?,active,passable,open,offset,velocity}`.
Reducers return `{state,events,changed}`. Assign the returned state only, and
feed the same state to human, bot, combat, audio and render queries.

Use APIs:

```ts
const target = traceEnvironmentUse(eye, aimDirection, arena, gameplayState);
if (target.pieceId) {
  const result = useEnvironmentPiece(arena, gameplayState, target.pieceId, eye, occupiedHulls);
  gameplayState = result.state;
}
// Feed only an authoritative physical shot's selected piece ID and damage.
gameplayState = damageEnvironmentPiece(arena, gameplayState, hit.pieceId, damage, impulse).state;
gameplayState = advanceEnvironment(arena, gameplayState, tickSeconds, occupiedHulls).state;
```

Use is reach/occlusion checked. Open doors retain a use target in the original
doorway, allowing closure. Supply live actor hulls to prevent closure inside a
body and prevent props pushing through bodies. Main must also gate use by alive,
paused, menu/input and network-authority state; the pure reducer cannot know those.
Events report material, stable ID and world position for audio/debris/feedback.
Health is cumulative; destruction happens once and disables collision and rays.

Movables use a deterministic, damped, ground-plane impulse approximation with
bounded .08m substeps, a .25s maximum update and authored speed caps. They slide
against solid boxes, world bounds and supplied occupants. There is no angular
motion, rigid-body stacking, buoyancy or ramp climbing for props. Do not present
this as a general physics engine. Sliding doors park their leaf above the passage;
the open leaf is render-only and does not block shots or movement. No hinge/sweep
physics or animated intermediate collision state is claimed.

## Movement And Navigation Integration

`Arena.traversalVolumes` and `Arena.traversalLinks` are optional, separate arrays.
Volumes carry stable ID, bounds, kind and material. Ladder metadata includes
`axis`, outward `facing`, `bottom`, `top`, and world-space `dismount`. Water
metadata includes `surfaceY`, estimated `speedScale` and `drag`.

`environmentTerrainWorld(arena, state)` adapts this package to the worker's
`TerrainWorld` without a runtime dependency on the physics solver:

- Active, nonpassable box pieces become `traversal:{kind:'solid'}`.
- Ramps become `{kind:'ramp',axis,rise:size.y,direction:highSide}`.
- Ladder volumes become noncolliding `{kind:'ladder',normal}`.
- Water volumes become noncolliding `{kind:'water'}`.
- Destroyed/opened colliders are omitted; bounds and floor zero are supplied.

Main should use this world for the same shared movement/vertical-contact helper
on every actor, adding actor contact hulls separately. The adapter does not
override the worker's native-default ladder/water coefficients. Per-volume
water drag/speed metadata is an optional authored override requiring intentional
worker integration; it is not silently applied by this package.

Links describe stairs/ramp/ladder/boost/wade/door/breakable transitions with world
feet positions, supporting surface IDs, optional volume ID and opening/breaking
requirements. `availableTraversalLinks` filters state gates and partner-required
boosts. The caller still checks stance/capabilities, actual supports and landing
clearance. The conservative existing ground grid does not itself execute jumps,
climbs, use actions or elevation transitions. Ground routes preserve dry/open
bypasses; closed doors/unbroken panels are not assumed passable.

Parent/Copernicus boost contract: `arenaBoostPOIs(arena,state)` returns only
explicit partner assemblies, each with `{id,poiId,base,mount,partnerTop,perch,
dismount,platformId,perchId,approachLinkId,partnerStance:'crouch',requiresPartner:true}`.
The query also supplies `lookAt`, compatible with the coordination worker's
`BoostPOI`: an authored entry-angle target, not a hidden actor query.
All five assembly positions are world-space FEET positions, not eye centres. `base` is
the stationary crouched partner's feet; `mount` is the climber's initial feet
on the same platform. `partnerTop` is a subsequent support-height aim point,
not a teleport destination. `perch` is the loft landing; `dismount` is an
unobstructed ground landing on the far side. The referenced stairs link carries
the approach from ordinary ground to the climber's mount point.

The same data is on `TraversalLink.boost` as `PartnerBoostGeometry`. Placement
transforms all five positions and prefixes every supporting/link ID together.
The query excludes assemblies with disabled supporting surfaces. `boostPOIs`
also exposes simpler single-jump spots; it is not the full assembly contract.
Main owns partner recruitment, crouch/occupancy, input-based jumping, aborts,
actual observed feasibility and cooldowns. No actor velocity/position assignment
is implied by the metadata. Tests walk the approach in all four mirrors and
use `advanceActor` inputs/contact to mount a crouched partner and jump onto
the loft without changing impulse, teleporting, or modifying the solver.
The verified second jump uses a 16-tick run-up on head support before jumping
toward the loft. Main's planner must preserve that actual momentum (or verify
another physically feasible approach), not jump across from rest and assume
air acceleration supplies running speed. Ground routing first approaches the
stairs link's ground `from` point; the controlled stairs transition then reaches
the elevated base/mount. A flat grid route directly to the platform is not enough.

`canFitInArena`, `moveInArena`, `clearSegment` and `routeTo` accept an optional
environment state. Callers omitting it continue using initial authored state.
`routeTo` caches occupancy per arena, solid-array and state reference; use the new
state object after every reducer, or replace a separate resolved arena view's
solid array with `environmentSolids(authoredArena,state)`. Its cardinal-only grid avoids diagonal corner
cutting, includes low props and rechecks smoothed segments. Terrain changes
invalidate the occupancy cache. In-place authored geometry mutation after first
routing is unsupported; replacing the resolved view's array is supported.
`solidTopAt` is a shape query, not automatic step-up physics.
Repeated ground queries reuse at most eight complete cardinal BFS trees per
arena/state, keyed by the reachable starting grid cells. Discovery order and
smoothed collision checks are retained. Generation's repeated north/south lane
queries therefore do not repeat flood searches for every individual goal.

## Combat Integration

`traceSolid(..., maxDistance, state)` and `traceSolidEntries(...)` resolve the same
environment and skip inactive/opened pieces. They return numeric `surfaceId`,
stable `pieceId`, `material`, entry `distance`, `exitDistance`, `entry`/`exit`
world points, `normal`/`exitNormal` and world-distance `thickness`. Entry/exit
distances are ray parameters; supply the usual normalized shot direction for
metre distances. Thickness accounts for nonunit directions too. Exit is the
full geometric exit, not artificially truncated at the weapon's remaining range.
Inside-start thickness covers only the remaining travel to exit.

`materialForSurface` supports stable-index material lookup. Plain box and true
wedge intervals are analytic. Ladder and water volumes are not bullet blockers.
Glass initially blocks physical rays; the combat worker decides penetration,
range/damage loss and same-shot continuation. Breaking a panel alone does not
guarantee that the current shot hits an actor behind it. Continue the original
ray only under the combat worker's penetration rules. Never re-aim a shot or
recompute persistent marks from a changed environment.

Shot blocking and visual opacity are different. If main supplies transparent
glass, visual perception must treat glass appropriately (for example, use the
ordered surface/material query to skip glass for sight). This package does not
modify perception/audio workers or equate bullet blocking with opaque glass.

## Rendering And Shadows Integration

`environmentRenderMetadata(arena)` marks dynamic pieces with ID, original
surface index, material and interaction. Main's existing static batch should
contain only pieces without `interaction`. Use a separate dynamic group:

```ts
const groups = createEnvironmentRenderMap(arena, dynamicRoot, materials);
syncEnvironmentRenderMap(groups, gameplayState);
// Repeat sync when gameplayState.revision changes.
for (const volume of arena.traversalVolumes ?? []) addArenaTraversal(volume, staticRoot, materials);
```

The map is keyed by stable surface ID. Each group contains authored-position
geometry; sync applies its state offset and active visibility. Do not render an
interactive piece in both static and dynamic groups or batch the dynamic IDs
away. Existing static covers can keep the current batcher. Use shared `glass`
and `water` transparent materials plus optional `metal`/`grate` overrides in
`CoverMaterials`; no hidden per-piece materials are allocated. Main owns material
lifecycle, lighting, transparency order, shadows and the revision-sync schedule.

New stairs/platforms do not get protruding generic top caps. Ramp meshes and
ray wedges agree; ladder rung count is capped by authored height, and water's
surface is above the floor instead of coplanar with it. Structural decorations
remain offset from their backing surfaces.

`shadowFootprints(arena,sunToward,state,groundY)` returns deterministic convex
ground polygons, stable IDs and materials. Sun vector points toward the sun
and must have positive Y; casting projects away from it. These are conservative
AABB proxies (including for ramps), omit glass/destroyed pieces, and follow moved
props/open leaf offsets. They do not solve receiver occlusion or render shadows.

## Verification

Focused command (while other workers are editing shared files):

```text
npm run test:run -- src/range/duel/environment.test.ts src/range/duel/geometry.test.ts src/range/duel/arena-layout.test.ts src/range/duel/arena-pois.test.ts src/range/duel/arena-props.test.ts
```

Coverage includes 1,680 seeded maps across seven scales; unchanged POI counts;
hidden separated starts; reachable ground lanes; full-size pieces; disjoint
reservations; 3D overlap; deterministic mirroring and metadata references;
door occlusion/reach/occupied closure; cumulative destruction; prop movement,
occupants and ray-index stability; low-blocker navigation; ramp worker-height
and mesh-ray agreement; no coplanar differently colored tops; dynamic render
sync; water elevation/rung budget; deterministic shadow polygons.

Final five-file focused run: 207 tests passed in 23.87s. The prior pre-tree-cache
run took 111.74s on this workspace; these are local test-run measurements while
other workers were active, not browser frame-time or cross-machine benchmarks.
The additional unchanged combat-style suite passed all 7 tests, including its
90-map covered-start sweep, in 1.09s test time (1.86s total). No assertion or
test timeout was weakened. Full `tsc --noEmit` and the package-scoped strict
typecheck both passed. Tracked package edits also pass `git diff --check`.

Main has reported state/terrain and dynamic rendering integration. Full build,
global tests and integrated desktop/mobile browser validation remain main-owned;
this package's unit results do not establish final traversal AI/playability or
native game parity. The owning agent did not edit runtime simulation/engine/UI
files, commit, push, deploy, or package a build.
