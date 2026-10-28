# Procedural AI Duel Arena Diversity Audit

## Scope

The procedural generator keeps the `createArena(seed, options)` API, six design
names, theme overrides, deterministic streams and the existing scale clamp
of 0.65 through 1.5. Dust2 prefire, geometry, rendering engine, simulation,
movement, configuration and assets are outside this change.

## Material Layout Changes

- Central cover selects an offset straight screen, an L return, a T spine or
  two staggered screens with a navigable dogleg between them. Solids remain
  axis-aligned; no collision-only rotations or reduced actor hulls are used.
- North and south independently select static camp bundles, horizontal sides,
  facing and depth. Camp positions are no longer mirrored pairs.
- Each half independently selects an environment assembly. Full-size arenas
  also select independent ordinary flanks, and optional rear/side clusters can
  add more traversal or low/tall cover. Compact arenas repack full-size props.
- The cover catalog grows from 54 to 66 authored plans, including two compact
  closed-shell clusters per theme. The environment catalog grows from 15 to
  26 assemblies, using the established stairs, ramps, ladders, water, movable
  cases and door/glass/vent passage helpers.
- Existing batched Three.js shell details now include deterministic window
  dividers, planter insets, equipment louvers/control panels, cabinet seams,
  cargo straps/labels and movable-case markings. Pallet slats are bounded by
  actual hull height. These are mesh/material variations, not new native assets.

## Safety And Cost Bounds

Generation permits at most 24 candidates and 8 placement trials per slot.
Optional slots are capped at two in compact maps and four in full-size maps.
The hard solid cap increases from 40 to 56; measured maxima remain below it.
This work executes during round construction, not in simulation ticks.

Every accepted candidate checks nonintersecting solids, disjoint POI
reservations, arena bounds, north/south ground connectivity, both lane segments,
0.6 m local clearance, lane reachability from both halves and five hidden,
separated, connected bot spawns. Ground-level traversal entries/exits and boost
dismounts must fit the unchanged native hull and be reachable. Traversal does
not become necessary to connect the two halves: intact doors/glass and dry
bypasses remain compatible with the existing ground navigator.

The deterministic emergency plan retains the previously validated packing,
including the first camp and environment for every theme, and is subjected to
the same safety checks. Fallback may be symmetric and deliberately has fewer
objects. Tests force candidate rejection to exercise this path and its bound.

## Seed Sweep

Seeds 0 through 239 were measured at each scale below. Every scale had 240
distinct coarse layouts (template identity, facing and placement rounded to
2 m), all 240 layouts were nonmirrored, all four central shapes appeared, and
no fallback was used. This measures meaningful structure, not just floating
point jitter or names.

| Scale | POI Counts | Environment Counts | Maximum Solids | Different North/South Environment Choices |
| --- | --- | --- | --- | --- |
| 0.65 | 4-6 | 2 | 28 | 186/240 |
| 0.70 | 4-6 | 2 | 27 | 188/240 |
| 0.75 | 5-6 | 2 | 28 | 186/240 |
| 0.85 | 5-6 | 2 | 28 | 183/240 |
| 1.00 | 6-9 | 2-4 | 37 | 205/240 |
| 1.25 | 6-10 | 2-5 | 46 | 202/240 |
| 1.50 | 6-10 | 2-5 | 46 | 203/240 |

Local construction timing in this sweep was about 3.4-8.6 ms median and
5.0-11.8 ms p95, including round-time validation. These are machine-specific
observations, not a performance guarantee or per-frame cost measurement.

## Validation And Integration Notes

Owned tests replace mirrored/exact-count assertions with hull size,
nonintersection, clearance, connectivity, hidden spawn and diversity checks.
The layout sweep validates every route segment with the existing navigator
and checks every POI against its original unscaled part sizes. Rendering tests
exercise deterministic shell variants, mesh bounds, coplanar top avoidance,
static batching and addressable dynamic groups across seeded placements.

The focused arena suites passed 207 tests. The production build passed, with
the existing large-chunk warning.
The focused run includes 504 large-seed/non-default-theme cases at seven
scales, including 0.99 and 1.01, and forced fallback checks for all themes at
nine scales. The existing Chromium render-resource/native-stance Playwright
regression passed. Separate desktop (1440 x 900) and Pixel 7 checks captured
16 arena screenshots over seeds 0-3 at scales 0.65 and 1.5, with RGB standard
deviations above 38, no canvas overflow and no page errors. Representative
screenshots were visually inspected. QA images live in the visualization
workspace, not in the source tree.

The full unit-suite run had 2,003 passes and seven failures in unowned files:

- `environment.test.ts`: three old exact 4/6 POI-count assertions.
- `tactics.test.ts`: one exact six-POI assertion, one fixed positive-X spawn
  assumption at seed 12, and the fixed-population combat-variety threshold.
- `bot-audibility-regression.test.ts`: the same fixed-population threshold.

All 12 sampled bots still fired at the idle player, all 12 used multiple roles,
and five exhibited combat microstrafing. Seven, rather than the old required
eight, had multiple peek types or microstrafing. These calibration and old
layout assertions need the parent owner's review; they were not changed here.
Browser compact-map tests also contain exact 4/6 POI assertions and will need
the same gameplay-safety update by their owner.

There are no new native model imports, textures, simulation behaviors or
claims of exact CS2 map accuracy. No commit, push, deployment or ZIP was made.
