# Map Packages And Bot Decisions: October 30, 2026

## Scope

This iteration separates shared Duel/Prefire code from Dust 2's data, while keeping
Dust 2 as the only real shipped map. Synthetic packages prove isolation; they are
not substitute maps or evidence of another map's gameplay fidelity. Runtime media
remains locally extracted and Git-ignored. No deployment is part of this iteration.

Movement, physical shot coordinates, damage, recoil, spread randomness, skill
constants and native collision contents are unchanged. New bot policies are
authored training heuristics, not extracted CS2 AI or measured FACEIT behavior.

## Package Boundary

`src/range/prefire/native-map-schema.ts` defines a small native-map descriptor and
registry. `prefire/maps/index.ts` registers descriptors; `maps/dust2.ts` owns the
current map's paths, asset ID, chunk metadata, release pins, radar and lazy catalog
loader. Shared consumers no longer import the Dust 2 catalog or JSON roots.

Each descriptor provides:

- A canonical map ID, display name, asset namespace/base and catalog revision.
- Native chunk bounds, standard route IDs and a lightweight route/lineup index.
- Release-pinned chunk/context manifests and optional native radar metadata.
- A lazy full catalog containing map-owned routes, sourced holds and density.

Registration validates descriptor/index identity, unique IDs, finite chunk bounds,
safe paths and route references. Catalog loading checks map/revision/density
identity and memoizes by map. Unknown map/chunk selections fail closed at runtime;
they do not fetch Dust 2 as a fallback. Config sanitizers retain explicit legacy
migration separately from runtime admission.

`loadNativeMap(signal, options)` consumes explicit paths and delivery settings.
The deprecated `loadDust2` wrapper exists only for older offline/browser audit
callers and resolves the Dust 2 adapter explicitly. Normal map selection never
uses it. Shared coordinate/lineup helpers live in `route-helpers.ts`, so importing
placement or bot planning does not pull in the full Dust 2 evidence dataset.

`RealMapSession` binds to one map. Changing the map creates a new session; changing
chunks keeps the existing bounded preparation/replay lifecycle. Loaded runtimes
carry their own catalog association. Arena creation requires matching map,
catalog and configuration; offline callers pass the catalog explicitly.
Prefire requires real finite native collision bounds instead of guessed map bounds.

## Cache And Save Identity

- Prepared/resident chunk keys include map ID, catalog revision, chunk ID and
  pinned delivered-content identity. Equal chunk names on two maps cannot alias.
- Radar leases are keyed by map and manifest/projection identity, not one global
  bitmap. Unused entries are released. Context retains active leases and at most
  one idle decode, with per-map content keys and independent clipping materials.
- Verified compressed bytes still use content-addressed delivery and the existing
  bounded browser cache. This refactor does not clear that cache or progression.
- Manual lineups identify map, chunk and collision revision. Library merge,
  filtering, deletion and application compare map IDs. Missing historical IDs
  mean `legacyNativeMapId`, even if a future default changes.
- Prefire history, diagnoses, practice keys and retention checks distinguish map,
  catalog revision, native build and geometry hash. Saving one namespace preserves
  other namespaces. Untagged legacy records can only belong to their original map.
- Duel configuration now carries map ID, including in existing setup/replay data.
  Progression and cosmetics remain one account rather than resetting per map.

Map names in loading states, HUD, setup and accessibility labels come from the
selected package. Map selection appears when multiple maps are registered. Rapid
route edits during GPU preparation queue a final restart rather than disappearing.
Retained shader compilation now defers material disposal until Three's program
polling finishes. Map and smoke warmup use the same ownership guard; smoke still
compiles both its density and blit variants. This prevents a mode switch from
disposing the program that an in-flight compile is polling.

## Authoring

Generate a lightweight index without loading geometry in the UI:

```powershell
node tools/build-map-index.mjs /src/range/prefire/routes.ts src/range/duel/real-map-catalog.json src/range/prefire/maps/dust2-index.json dust2Catalog
```

The command accepts a catalog module, chunk-catalog JSON, output and export name;
it is not tied to Dust 2. Validate the generated index against the full catalog.
Offline `buildRealMapCourses(map, chunk, catalog)` now requires its own catalog.
`tools/build-duel-rounds.mjs` accepts a registered map ID and explicit output for
non-default maps. Existing navigation/audit callers pass catalogs explicitly.

Adding a real map still requires native extraction, provenance, admitted quality
reports, validated entry/hold/traversal geometry and a map-owned offline authoring
adapter. Some older extraction/navigation commands remain dedicated Dust 2 tools;
their existence is not a shared runtime fallback or a completed second-map pipeline.
Do not copy Dust 2 collision, positions, radar coordinates or probabilities into a
new descriptor. Follow the source-rights and measured-evidence requirements in
`prefire-map-authoring.md` and `prefire-map-case-study.md` where applicable.

Helper extraction changes source hashes in the weighted-pool certificate. The
strict pool builder must re-audit native supported walks, starts, visibility and
placements before publishing refreshed hashes. `route-helpers.ts` is now an
explicit authoring dependency. Do not merely bless stale certificates.

## Bot Changes

Live perception now passes current weapon dispersion from a fork of the same
recovery/accuracy kernel used by firing. Sensing does not advance recovery or
consume shot RNG. The current pre-spread aim ray includes compensated recoil and
damage punch. Candidate selection accounts for residual error, maintains a
revalidated visible endpoint during head/body transfers, and does not fabricate
aim points between exposed parts.

Sight memory uses an actually visible point rather than a potentially hidden
actor root. Hidden opponent health, armor and pose changes cannot grant new
knowledge. Sensor cadence and `MAX_VISIBILITY_RAYS` remain bounded; head-only and
limb-only engagement remains physically hittable. Expected-utility selection is
still a heuristic, not calibrated hit probability.

Tactical bots remember their own recent damage at a corner. Repeated punishment
reduces that corner's weight on a later lane choice, more strongly at higher
skills. Pressure decays over eight seconds, stores at most 64 entries and never
changes a live firing commitment by itself. Existing hurt/disengagement behavior
still applies. Fallback search/aim points use map bounds or lane evidence rather
than assuming useful positions around the world origin.

## Verification And Limits

Key regressions cover full synthetic two-map Duel creation with equal route/chunk
IDs, lazy catalogs, rejected foreign catalogs, pinned metadata, saved-lineup
isolation, map-aware Prefire configuration/history and aborted map switching.
Bot witnesses exercise the actual simulation sensor path, current weapon/stance
states, residual aim, generation changes, physical partial-body hits and probe
budgets. Corner tests check preference changes, decay and unchanged live phases.

Native browser checks retain all-route Prefire gameplay, radar projection, prepared
chunk handoffs, replay/paused handoffs and disk reuse with HTTP caching disabled.
The all-chunk network test blocks only root `/maps/` media URLs, not development
source modules inside `prefire/maps/`. This preserves the zero-native-download
assertion rather than weakening it.

The isolated browser witness for changing maps during a pending load runs with:

```powershell
npx playwright test --config=tests/prefire-map-switch.playwright.config.ts
```

It mounts the real Prefire lifecycle with two synthetic packages and a lightweight
stage double; it is not a second-map graphics or native gameplay test. Ordinary
Playwright runs skip this witness unless its dedicated fixture server is active.

Synthetic coverage proves package separation, not native fidelity. Every future
real map still needs its own geometry/material, hull, grenade and hold validation.
No extra real map, GPU texture compression, measured human bot calibration or
complete Source 2 equivalence is claimed here.

### Completed Checks

- `npm run check`: 277 files, 6,589 unit tests passed; production build passed.
- Final focused metadata/shader tests: 28 passed, including the added index-alignment witness.
- Browser assertions passed for all-route Prefire, all-eight-chunk disk reuse,
  native radar, Duel replay/setup/handoffs, mobile Prefire and mobile post-win play.
  The dedicated two-map lifecycle harness passed both witnesses.
- Complete strict pool re-audit and published-pool quality re-audit passed.
  Routes, approaches and collision hash exactly match the pre-refactor snapshot.
  Native material gate and final report/dependency validation passed; encounter
  evidence remains explicitly authored-only, not measured holding probabilities.
- `npm run source:check` and staged whitespace checks passed; no media added.

Initial browser runs exposed two test-environment conflicts: concurrent trace
cleanup removed a recording file, and an authoring/development dependency
optimizer race returned a 504 before app startup. Isolated-output reruns and the
radar rerun passed after authoring work ended. These are not suppressed gameplay
assertions. Simulation-only timing remains separate from browser/GPU performance.
