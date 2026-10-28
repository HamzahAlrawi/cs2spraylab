# Purposeful AI Duel Arena Placement

## Scope

This revision replaces independent depth/side scatter with bounded sockets
related to a shared landmark, two approach lanes, and sheltered compounds.
It preserves `createArena(seed, options)`, all six design/theme choices,
the 0.65-1.5 scale clamp, the existing axis-aligned geometric API, full-size
authored assemblies, actor hulls, and traversal/environment behavior.
Simulation, physics, range settings, Dust2 routes, and tips are untouched.

The placement rules here supersede the independent-placement description in
`arena-diversity-audit.md`. That document's earlier timing and seed statistics
are not measurements of this revision.

## Spatial Relationships

- The central landmark retains straight, L-return, T-spine, and staggered
  screen plans. Bounded position/width variation changes approaches without
  relocating the entire encounter. Existing theme-specific shell styles make
  the landmark read as freight, equipment, an arcade, or a workshop fixture.
- Each landmark has a north/south transfer apron and separate west/east
  bypasses. Their full-hull corridors are reserved before placing any POI.
  Rear access trunks remain open; neither doors, breakables, elevated routes,
  nor water are required to connect the halves.
- Each half has one static spawn compound. Compounds may occupy the same or
  opposite horizontal side, while their internal rooms face midfield. Six
  wall-backed spawn candidates per compound have a protected rear envelope.
  The south wall is far enough inside the boundary to retain both spawn rows.
- A traversal assembly occupies the other side of each compound's approach.
  Stairs, ramps, and ladders face toward the transfer apron. Full-size arenas
  also have ordinary cover on the compound's side of that apron. Native-size
  compact arenas omit that extra flank assembly instead of shrinking it.
- Optional support clusters occupy bounded rear-compound shoulder rows,
  beyond the spawn envelope, rather than arbitrary deep coordinates. The
  northern rear has more space because existing arena bounds extend farther
  north. Each support names its compound and supplies an off-angle lane:
  a side-covered anchor beside its tallest shell, an exposed corner toward
  midfield, and a clear retreat. Low shells provide crouch-height cover.
  Unusable or over-budget optional sockets can be omitted.
- Both halves independently select fitting authored templates. Seeded
  asymmetry, central topology, compound sides, socket offsets, and optional
  rows provide variation within the coherent circulation plan.

`PlacedPOI.placement` is additive audit metadata: role, horizontal side,
hemisphere, landmark surface ID, usable approach, and optional parent compound
ID. Existing collision/render consumers still use the same solids, indices,
footprints, and traversal IDs. Standalone `placePOI` calls are unchanged.

## Acceptance And Cost Bounds

The existing hard limits remain 56 solids, 24 candidates, and eight trials per
socket. Optional sockets remain capped at two for compact maps and four for
full-size maps. Placement, reservations, and validation run during round
construction, not in physics or rendering ticks. No new mesh types, textures,
asset imports, per-frame searches, or rendering passes were introduced.
Existing shell details use the existing material batcher.

Acceptance checks nonoverlapping solids, disjoint POI reservations, bounds,
both authored midfield routes, accessible POI approaches from both halves,
lane exposure/retreat clearance and reachability, and five hidden separated
bot spawns. Lane anchors/exits retain at least 0.6 m clearance from solids.
Every ground-level traversal entry, exit, and boost dismount must fit the
unchanged standing hull and be reachable from **both** halves. Bidirectional
validation rejects a navigator edge case that a north-only check missed.
The reserved midfield corridors must also avoid water-volume footprints.

The deterministic emergency layout retains its static template selection and
packing relationships, with the southern compound moved inward for its rear
spawn row. It receives the same placement annotations, two-route validation,
and bidirectional approach checks. It can be symmetric and has no optional
support clusters. Forced-fallback tests retain bounded generation coverage.

## Focused Validation

Run only the owned arena suites while the parent performs broad verification:

```text
npm test -- --run src/range/duel/arena-layout.test.ts src/range/duel/arena-pois.test.ts src/range/duel/arena-props.test.ts
```

Final focused result: all three suites passed, 242 tests total. The final
run took 129.38 seconds; this is suite wall time, not a construction or
per-frame benchmark. The scoped `git diff --check` also passed. Windows
sandbox cache-renaming restrictions required the approved external runner.

Coverage includes the existing 240-seed sweeps at seven scales, large and
negative seeds, theme overrides, full-size parts, nonintersection, spawn
visibility, reachable lane segments, and forced fallback. Added checks cover:

- Two distinct midfield bypasses, with either one blocked while the other
  stays usable without opening or breaking anything.
- Physically covered entry anchors and exposed exits, checked against both
  combat rays and the actual rendered meshes.
- Six usable compound spawn candidates, purposeful role/side relationships,
  inward-facing traversal, reachable POI approaches, and parented supports
  with actual side-cover/exposure rays.
- Ground bypasses and reachable traversal entries for every environment
  template under all four mirrors, without mutating authored templates.
- Existing decoration bounds, stable dynamic groups, coplanar-face checks,
  and static material batching.

Compact catalog coverage permits four fitting static templates per theme
instead of requiring five; tactical constraints take priority over adding
an otherwise ill-fitting support merely to meet a variety quota. Coarse
topology, asymmetry, environment variety, and seeded reproducibility gates
remain in place.

## Limits And Handoff

These are trainer-authored tactical layouts, not measured CS2 maps or a claim
of competitive balance. The tests establish geometric access and useful cover
sectors, not equal travel times, optimal routes, encounter pacing, or human
preference. Support cover may be crouch-height; an elevated or interactive
assembly is still optional to the guaranteed dry ground circulation.

The existing bot controller receives additional support off-angles through
the existing lane API. Its selection probabilities, team congestion, combat
outcomes, and visual framing still need parent-level playtesting. No movement,
perception, navigation algorithm, or tactical policy was changed here.

Full unit tests, production build, browser screenshots, Dust2/routes/tips,
and packaging are the parent owner's verification work. This focused change
does not make a ZIP, commit, deployment, or exact-CS2-accuracy claim.

Parent integration on 2026-10-11 passed 3,163 tests / 134 files and the production
build. Compact/full-size AI Duel browser checks passed; roof-excluded QA-only
overviews of all six themes showed the actual assemblies with no browser errors.
Those checks confirm access/rendering, not measured encounter balance or human
preferences. See `prefire-map-case-study.md` for the integrated verification.
