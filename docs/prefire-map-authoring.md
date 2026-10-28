# Prefire Map Authoring

## Reusable Contract

`schema.ts` separates a `PrefireCatalog` from the shared session, physics, bots,
coach and UI. A catalog has a stable map ID, revision, licensed coordinate
sources, grouped courses, enemy side/round phase and optional `HoldingDensity`.
`PrefireSession(map, config, catalog)` validates course IDs against that catalog;
selection, automatic progression and setup UI consume its routes. History keys
include map/catalog revision and density source/sample revision so unrelated
maps or changed evidence do not share personal-best comparisons. Native map
loaders remain map-specific and lazy; adding a catalog alone does not import a map.

Dust 2 exposes ten distinct approaches, consolidating the old 24 courses / 120
lineup slots. Compatible old five-bot sets remain selectable fixed lineups within
an approach; saved course IDs migrate to the approach and lineup. Five active
opponents remains the hard budget. Split genuinely different approaches, not
different rosters on the same walking path. Angle coordinates and occupancy evidence have different
roles: authored coordinates must fit; observed centroids are never bot spawns.
Weighted pools currently admit 141 source identities and 165 approach assignments,
including eleven identities added in the coverage-v4 follow-up. Native validation is specific to each approach;
a position accepted in one pool can be rejected in another.

## Adding A Map

1. Extract static native art/collision at the recorded build and retain checksums,
   movement/shot masks and Source-to-world conversion. Never resize the map to
   compensate for movement. Preserve lazy loading and visibility culling.
2. Pin licensed common-angle coordinates with position, facing and stance.
   Include full attribution/license notices. Preserve horizontal positions;
   only a six-unit local support correction is allowed. Reject unsupported,
   overlapping, wrong-floor or unhittable holds rather than moving them.
3. Author walking approaches, not just bot points. Start at a meaningful map
   landmark on the attacking/retaking side, not an arbitrary concealed pocket.
   Label the start, face the next clearing step, and reject unnecessary
   backtracking. A bounded native floor/connector search may refine a point
   within that chosen landmark; it must not select the landmark itself.
   Hide all upper-body silhouette
   samples from standing/crouched spawn views; face the covered exit. Verify a
   protected first 32 units of movement, both stances, every native head shot
   and the full-speed actor motor through every waypoint. Use a 64-unit start
   cover margin. A slow sweep alone misses acceleration/contact problems.
   Distinct rosters become optional `lineups`, not duplicate routes. Revalidate
   every pooled position whenever the approach or native collision changes.
4. Tag the actual enemy side and round phase per course. Retake/post-plant T
   holds must not use CT opening-round density. Add mutually exclusive corner
   groups where alternative positions would produce an implausible crossfire.
5. If licensed tick data exists, import bounded complete rounds offline with
   pinned inputs and hashes. Exclude freeze/post-round time, dead players,
   utility/knife holders, movement input, nonfinite samples and teleports.
   Contiguous low-speed episodes must meet the declared dwell threshold.
   Keep Source XYZ, side, phase, unique cell/layer round identities and sampled
   denominators. Repeat pauses and nearby cells must not double-count a round.
   Retain episode anchors as acquisition diagnostics only. Do not use kill
   heatmaps as hold-frequency data or imply FACEIT rank from tournament demos.
6. Declare a coverage policy separately from observed support. Dust 2 currently
   mixes 50% equal physical-family coverage and 50% match-balanced regional
   nearby-hold support, including zero-support rounds in each match. Density chooses which
   validated holds appear, not their location or stance. Weighted
   sampling without replacement omits angles across runs; **Bots per run** is an
   explicit one-to-five training setting (default four), not measured enemy presence.
   With no support, use uniform families and label it, never fabricated statistics.
   A centroid near a corner is not proof that the exact pocket was held. Keep
   raw-episode/local-pocket geometry checks diagnostic until their input and
   conservation audits support promotion. Preserve source facing as provenance;
   route-facing runtime pre-aim is an explicit tactical adaptation.
   Weighted alternatives may enlarge a course's pool, but must pass the same
   native concealment and hittability checks from that particular start. Never
   assume that a position validated on an adjacent course is safe here.
7. Geometry plans reserve only selected opponents, never possible-but-unspawned
   holds. Cache by map/collision/course, behavior and ordered selected identities,
   with a 16-roster LRU and shared course views. Include effective trading in the
   cache key; build optional local trade excursions only when combat/trading
   are enabled. Only up to five actor plans are built
   on a cold roster; repeat rosters skip geometry queries.
   Holds remain holds. Commit peeks to meaningful firing endpoints, counterstrafe
   before shooting, and use information checks only with real concealed cover.
   Pre-aim uses authored route views or actual sightings, never hidden player
   coordinates. Route-source behavior annotations are training policy.
8. Add catalog/config/history-isolation tests, native placement/walking/firing
   tests, occupancy frequency/determinism tests and desktop/mobile browser runs.
   Run `npm run check`, importer tests, native bot audits and active CPU profiles.

## Performance And Limits

Hold-evidence rendering is memoized per route/density; sampling happens only at
round construction. Raw Parquet, Python libraries and research artifacts remain
ignored and are not shipped. No pathfinding or dense silhouette grid is added
to a browser frame. Native actor/camera/shot math stays shared with other modes.
Side and phase are explicit course metadata inherited by local clearing sets;
route names and ID substrings do not decide which statistics layer is used.

The current empirical sample is exploratory: 32 matches, 256 complete rounds. It does
not establish exact conditional probabilities for every angle, tactic or rank.
Map materials, collision contact/subtick behavior and animation graphs are not
the full Source 2 engine. See `prefire-statistics.md`, `prefire-angle-sources.md`
and `movement-native-recheck.md` for specific evidence and unverified boundaries.

## Previous Approach Verification

The final 2026-10-11 approach integration passes **3,163 tests / 134 files**
and the production build through `npm run check`. The build retains its existing
large-chunk warning. Native route tests cover canonical and admitted alternative
holds, standing/crouched concealment, protected initial movement, continuous
walking, full-speed steering, source placement and hittable heads. The importer
passes **33 tests** and its offline regeneration is byte-identical. The earlier
current-binary movement arithmetic audit passed 782 samples; no actor motor,
recoil or shot-coordinate math was changed for this weighted-pool work.

The final four-suite desktop/mobile browser run passes **12 tests**, with four
platform-specific cases deliberately skipped by project selection. It checks all
ten approaches, default four-bot density and one-to-five controls, persistence,
five-bot fixed lineups, lineup changes after Next angle, tips opt-out, evidence
labels, physical shots, camera and crosshair alignment, mobile layout, nonblank
rendering and browser errors.
The all-course native planning audit reports zero failures, including cold and
warm selected-roster caches. Its six low-cover leak observations remain
diagnostics where other qualifying covered views exist. The earlier 60-second,
seed-7 combat audit reported zero bot/control failures; passive alive-bot blockers
and duration-limited routes remain diagnostics, not claims of complete passive
route traversal.

Final active shooting samples on Long Doors, B Tunnels and CT Mid Push measure
**4.1-5.0 ms median / 5.4-6.2 ms p95 render-tick CPU work**, with zero browser or
map-resource errors. These performance-preset local samples are not GPU frame
time, an old-hardware guarantee or a representative competitive benchmark.
Weighted occupancy now requests an explicit count (default four), while
canonical exhaustive learning requests five. No density scan is performed on
each rendered frame. Generated reports remain under ignored `research/dust2`.

AI Duel's six theme overviews were visually checked with the warehouse roof
excluded only for the QA camera. Their props render and browser errors are empty.
Arena tests cover connected dry-ground bypasses, compound spawns, purposeful
cover/exposure lanes and bidirectional access across seeds/scales. The 391-pair
offline evidence diagnostic at that revision flags 33 of 143 assignments for reduced local support;
it is not promoted to replacement probabilities. See the case study and evidence
follow-up for current hashes, unresolved data conditions and rights gates.

## Coverage-v4 Follow-up

The coverage-v4 generator admits 141 source identities / 165 assignments across
the same ten approaches. The expanded pocket diagnostic checks 437 geometry
pairs and flags 38 assignments for reduced local support; those counts remain
diagnostic and are not substituted as pocket probabilities. The native canonical
planning audit still reports zero failures. Progression, optional death trading,
route-facing holders and punch-aware Prefire aiming now have separate native
and browser regressions. See `bot-trading-and-facing.md`,
`prefire-progression-trading.md` and `aim-punch-verification.md` for contracts and
the case study for final integration results.
