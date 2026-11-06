# Continuous, playable-space sound density

The narrow kernels, hidden-only eligibility and single-frame preparation below
were subsequently revised in [the source-variety follow-up](sound-awareness-variety-2026-11-06.md).

Follow-up to `sound-awareness-full-map-2026-11-05.md`. This replaces its
listener-centered radial probes. Full-map loading, caching, native collision,
movement constants, native sound fields and scoring are unchanged.

## Distribution

Sound sources are draws from a continuous mixture, not a uniform bearing around
the listener or a categorical choice of fixed spawn coordinates:

- Common-hold components: 0.65-meter horizontal Gaussian bandwidth.
- Clearing-corridor components: 0.8-meter bandwidth.
- Kernels are truncated at 2.5 standard deviations. Coordinates are not clamped
  to the truncation boundary or snapped to an anchor.
- Locally available holds receive 80% of proposal mass and route coverage 20%.
  If one category is absent, the available category receives the full mass.
- Existing hold evidence determines relative hold weights. Local normalization
  prevents hundreds of route samples from diluting common-hold priority.
- Duplicate physical holds and repeated courses do not add probability mass.
  Nearby route samples are deduplicated at 0.5-meter cells before weighting.
- Candidates remain within 28 meters of the current listener and at least two
  meters away. Audibility, hidden placement and cue-specific action feasibility
  further condition the accepted distribution.

Centimeter-rounded keys only deduplicate almost identical proposals; the sampled
coordinates themselves retain full precision. Sampling uses seeded Box-Muller
normal draws around map anchors, not bearings around the player.

## What the weights mean

The existing `holdingEvidence` / `selectionWeights` implementation supplies
match-balanced regional hold support and a coverage prior. Its within-hold
policy retains 50% physical-family coverage and 50% evidence allocation. Kernel
bandwidths, the 80/20 hold/corridor split and rejection budgets are authored
training choices, not extracted CS2 constants or exact match probabilities.

Current pinned regional data:

- OpenCS2-derived `dust2-hold-density.json`, revision
  `8d7deddcd30c081fb197b75f58b4a0fba1117b9d`.
- 1,835 regional cells; the current side/phase layers cover 32 matches.
- Source: https://huggingface.co/datasets/blanchon/opencs2_dataset/tree/8d7deddcd30c081fb197b75f58b4a0fba1117b9d
- Existing source/license caveats remain in that metadata. No new dataset is
  downloaded or rights claim made by this iteration.

Regional proximity supports a stronger training priority, not a certified
per-pocket encounter percentage. Data from another map is ignored. Repeated
route appearances keep the strongest applicable support instead of summing
duplicate evidence. Native-validated catalog positions are the kernel anchors;
raw statistical cell centroids are never used as spawns.

## Keeping sources in play space

An arbitrary supported floor is insufficient: native map collision also contains
scenery outside the playable route. Accordingly:

1. Start from a supported native-validated hold or authored route position.
   Interpolated corridor positions require a walkable connection to the previous
   admitted route position; a line-of-sight ray alone is not enough.
2. Sample a small continuous horizontal offset around that anchor.
3. Walk the entire offset in at most 0.3-meter increments with the shared
   `moveOnTerrain` player-hull solver and native collision. Require support,
   hull clearance, world bounds, endpoint agreement and step-height continuity.
4. Reject walls, unsupported gaps, disconnected floors and blocked hulls. Never
   ray-project through a wall, drop five meters to another floor, snap onto a
   roof, or fall back to a random listener-centered probe.
5. Validate event-specific audibility. A running demonstration additionally
   requires its existing short, supported native lane.

Low-cover reload/gunfire cue placement uses crouched emitter height rather than
placing the source above the crouched hull. Running/jumping still use actual
shared actor motion; a jump sound may correctly originate in the air.

These checks constrain samples to locally traversable neighborhoods of admitted
playable positions, not the broad rectangular collision extents. They do not
certify the native catalog or every browser collision semantic against all
possible CS2 map exploits. A bad upstream anchor still requires correction at
its source rather than hiding it with a coordinate clamp.

## Cost and verification

Hold evidence is evaluated during map preparation, not per render frame.
Each trial has at most 96 proposals, 32 returned candidates and 384 shared
movement increments. Failure yields another trial instead of unbounded searching.

Tests cover seeded continuous sampling, a 9:1 prior's observed frequency, no
fixed-position atoms, route-density isolation, duplicate-course invariance,
stronger hold evidence, walls, unsupported gaps, wrong elevations, native hull
clearance and support at every current Dust 2 route start for all cue groups.
Existing desktop/mobile tests also exercise reveal/hint/unaided play and verify
zero map requests on a healthy cached reload.

Validation: `npm run check` passed 301 files / 6,920 tests and the production
build. Both desktop/mobile awareness browser tests, asset verification,
tracked-source asset policy and whitespace checks passed. The existing large
JavaScript bundle advisory remains.

No deployment is part of this iteration. Commit and push only.
