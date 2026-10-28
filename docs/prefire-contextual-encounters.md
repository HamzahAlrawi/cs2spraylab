# Contextual Encounters And Map Admission

## Runtime Integration

Owned runtime entry point: `src/range/prefire/encounters.ts`.

```ts
const selection = choosePrefireEncounter(catalog, route,
  randomStream(seed, 'prefire-contextual-encounter'), {
    build: {
      mapId: catalog.id, catalogRevision: catalog.revision,
      gameBuild: collisionManifest.build,
      geometrySha256: collisionManifest.collisionSha256,
    },
    // Optional source-defined equipment class and arrival window.
    // Do not derive them from player loadout, elapsed practice time or route names.
    context: suppliedEncounterContext,
  });
const selected = selection.angles;
```

The session/UI expose `population: 'contextual'` as **Setups** alongside the
weighted coverage option; `population: 'all'` and fixed learning lineups remain
unchanged. The existing `choosePrefireAngles(..., density, botsPerRun)` API and
50% family coverage / 50% broad match-balanced support policy are unchanged.
Do not silently relabel that mode as realistic encounters.

For the contextual option, preserve the returned complete roster: do not trim,
pad or independently re-roll it to satisfy Bots per run. Show `selection.label`,
`fallbackReason`, `conditionedOn`, `unavailableFields` and `evidence` support.
Persist the mode/policy/build/evidence revisions in comparison keys. Context
fields omitted by the caller are not claimed as conditioned. Side and phase
default only from explicit course metadata; conflicting requests fall back.

**Zero defenders are valid complete observations.** The shared Duel config
sanitizer clamps bot count to at least one, so Prefire explicitly removes that
placeholder for an observed empty roster. Its outcome is a draw, not a cleared
route or a reward. The session records neither a phantom opponent nor a full
route history entry for it.

No `send_input` tool was available in the evidence agent environment. This
handoff and the in-progress API message are for the session and parent UI owners;
those files were not edited by this workstream.

## Evidence Contract

`PrefireCatalog.encounters?: EncounterEvidence` is optional. Dust 2 currently
has **no certified contextual corpus**. No synthetic fixture, new demo, fabricated
weight, inferred equipment label or local research centroid was attached to it.
The local `research/prefire-statistics/sample-manifest.json` and prior research
notes pin exploratory source files, but do not establish source-build identity,
measured stance, a reviewed approach-arrival definition or raw-foot pocket proofs.
The existing density artifact remains broad regional coverage support.

Each encounter is one complete defender snapshot at a source tick and a
predeclared approach-arrival sampling event. Canonical match IDs must remain
stable across sources; the same match cannot be renamed to evade heldout
separation. Retain at most one snapshot per route/round. Exclude a whole snapshot
if an actor is unknown, unmappable, in an unverified stance/pocket or omitted.
Include empty complete rosters in the denominator. Do not use kills, separately
timed pauses or independent per-pocket draws to construct a team.

The schema records:

- Corpus revision, map/catalog/game build and geometry SHA-256.
- Source URL, immutable revision, content hash, license, explicit rights review,
  extractor revision/hash, raw-foot position kind and recorded field definitions.
- Source-defined side, phase, team equipment class and arrival window, only when
  available. A requested missing field causes fallback, not silent backoff.
- Actor identities, authored angle IDs, physical pocket IDs, original observed
  feet and stance, plus per-observation geometry-proof report hashes.
- A frozen match-disjoint training/heldout split. Repeated snapshots and leaking
  match IDs are rejected. Source/stance variants do not become independent matches.

The sampler fits complete joint-roster signatures from training matches only,
giving each sampled match equal mass and each retained round within it equal
mass. Heldout distributions never enter fitted weights. It reports match-balanced
total variation and unseen-setup share, or `null` when not measurable. Support is
shown for both the filtered pool and selected setup. Confidence is an explicit
support/heldout gate tier, **not a calibrated probability or population claim**.

`PREFIRE_ENCOUNTER_POLICY` sets conservative training gates: at least three
training matches / twelve observations, two heldout matches / four observations,
and total variation and unseen setup share no greater than 0.5. These are policy
thresholds, not measured CS2 accuracy. Freeze policy and split before inspecting
the heldout results. Evaluate equipment/arrival slices as well as route totals;
the runtime rechecks the exact requested slice. Failed/sparse slices use authored
coverage and expose the reason. No smoothing invents unseen teams.

Fallback samples whole compatible authored lineups uniformly, including the
canonical lineup, deduplicated by roster. It retains source stance/positions and
the five-actor cap. It never synthesizes a crossfire from independent holds.
Existing weighted coverage is still a separate explicitly authored training mode.

## Offline Evidence Validation

Create normalized evidence only from rights-reviewed offline sources, not from
a running game or game-process hooks. Native geometry is checked offline only.

```powershell
node tools/validate-prefire-evidence.mjs --map=de_dust2 --input=research/encounters/normalized.json --artifacts=research/encounters/artifacts.json --split-seed=frozen-study-v1 --output=research/encounters/validated.json
```

If `split` already exists, omit `--split-seed`; the command refuses to re-split an
existing artifact. Without `--output`, it validates and prints diagnostics only.
The artifacts JSON maps each referenced SHA-256 to a local file path relative to
that JSON. Source and extractor files, pocket surveys and raw-foot reports must
all exist and match their hashes. Rights marked unknown/restricted can be audited
but cannot enter runtime evidence sampling; audit success does not clear rights.

A raw-foot report is `{schemaVersion: 1, geometrySha256, records: [...]}`. Each
record binds `sourceId`, `matchId`, `roundId`, `tick`, `actorId`, `angleId`,
`pocketId`, `observedFeet`, `crouched`, `sourceSha256`, `extractorSha256` and
`status: 'accepted-local'`. The validator requires exactly one matching record
and re-runs native raw-foot-to-authored-hold local-corridor checks. Thin walls,
wrong floors, unsupported endpoints and broken corridors fail even within 96
horizontal / 24 vertical Source units. A shared pocket label alone is not proof.
The local corridor check cannot recover missing arrival, stance or build data.

Structural/provenance success is separate from heldout/support acceptance. The
report lists each route's effective mode/fallback; do not promote low-support
data merely because its JSON was valid. Keep large/private raw sources offline.

## Multi-map Pipeline

`createPrefireMapRegistry()` in `map-registry.ts` accepts lazy map-owned adapters.
`load()` inspects a package; `activate()` requires pinned quality gates before
admission. The registry never imports Dust 2, native geometry or a renderer.
`loadRuntime` remains map-owned and lazy. Failed loads are retryable.

`tools/prefire-map-adapters.mjs` provides the parallel offline adapter contract.
Add a loader there for another map; shared pool building, evidence validation,
schematic preview and route playback need no new map-specific paths. The loader
supplies exact placement, Source units, walking/motor/visibility audits, native
pocket checks, proposal pools, build identity and material quality. Do not resize
maps or relocate source holds to make gates pass.

```powershell
node tools/author-prefire.mjs --map=de_dust2 --route=long-doors --preview=research/dust2/authoring.html --playback
node tools/build-prefire-pools.mjs --map=de_dust2 --route=long-doors
node tools/build-prefire-pools.mjs --map=de_dust2 --quality-output=research/dust2/map-quality.json
node tools/validate-prefire-map.mjs --map=de_dust2 --quality=research/dust2/map-quality.json --artifacts=research/dust2/map-quality.json.artifacts.json
```

The preview is a Source-XY schematic with height, routes, holds and scrub/play
controls, **not native geometry playback**. `--playback` separately checks both
supported walking stances and the full-speed actor motor. Authoring proposals
are printed, not written into runtime routes. Unreachable segments fail the
command. Filtered/diagnostic audits cannot publish pools or quality reports.
Run pool publication separately, then audit the published catalog for quality.

Required quality gates: geometry, materials, routes, entry starts, cover,
visibility, traversal, shots and evidence. Each route gets its own route/start/
cover/visibility/traversal/shot gate. Build and serialized geometry inputs pin
the report against changes to spawn, look, path, stance, candidate IDs/positions
and lineups. Gate reports are content-hashed and carry dependency hashes; the
offline validator checks both before accepting results. A missing, failed,
duplicate or stale gate fails admission.

Coverage permits an explicit `authored-only` evidence gate when no contextual
corpus exists. Contextual admission requires structural/provenance checks plus
heldout/support success for every route. This does not certify every optional
context slice; the runtime slice gate remains authoritative. Material semantics
require native surface and bidirectional entry/exit/thickness fixtures, never
texture-name guesses. Dust 2 now supplies this gate using
`tools/audit-native-materials.mjs`: 72 bidirectional native-convex thickness and
shared-penetration checks, pinned to the actual imported package. Build 2000932
contains 31 source surfaces and 8,268 validated closed solids; 1,837 unverified
primitives remain conservatively opaque. These checks validate trainer geometry
and material propagation, not live-engine damage equivalence.

`map-adapters.ts` registers Dust 2's lazy runtime loader and its public quality
report. `PrefirePractice` activates it through the registry's coverage gates.
The shipped contextual option is labeled **Setups** and reports **Authored
defender setups**, because no certified contextual corpus is currently shipped.
It chooses compatible whole authored lineups. Coverage weights remain a separate
learning policy and are not promoted to exact match-position probabilities.

## Checks

```powershell
npx vitest run src/range/prefire/encounters.test.ts src/range/prefire/map-registry.test.ts src/range/prefire/occupancy.test.ts
node --test tools/tests/prefire-evidence.test.mjs
npm test -- --run
npm run build
```

New fixtures are synthetic and test-only: seeded complete-roster draws, exact
context filters, missing/sparse fallback, match balancing, heldout leakage/unseen
setups, provenance/build/rights gates, empty teams, thin-wall physical separation,
lazy independent map adapters, stale geometry inputs and required quality gates.
