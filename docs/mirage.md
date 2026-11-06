# Mirage Beta

The owner explicitly authorized a visibly labeled beta on November 6, 2026.
This is not a full approval under [map onboarding](map-onboarding.md). The
separate beta receipt admits only a namespaced, content-pinned package with
passing basic native route, protected-entry and hold-hittability checks.
The full independent [coverage brief](mirage/coverage-plan.json) remains pending,
as do the [listed limitations](mirage/limitations.json). No human sign-off or
exact encounter probabilities have been invented.

## Scope

- Prefire: Ramp to A, Palace balcony, Apartments to B, Top mid to Short,
  Underpass to Connector and Market retake. Standing/crouched paths and the
  full-speed shared actor motor are checked. Palace drops are not a guided
  traversal, and the full CT Palace push is not included yet.
- Duel: A/Palace, Mid/Short/Connector and B/Apartments/Market native chunks.
  Covered starts, alternate holds, source-facing approaches and local peek lanes
  are baked offline. Player/bot physics and ballistics use the shared implementation,
  with no Mirage-specific aim, sensitivity, scale or recoil multiplier.
- Sound Awareness: the whole native map, not a chunk; supported continuous source
  neighborhoods use the Mirage catalog. Uniform physical-family training coverage
  is not measured holding frequency. Movement is free across the full map.

There are 200 approach/hold assignments from the pinned candidate profiles, not
200 independent encounter observations. Twenty-one upstream candidate positions
fail the current native standing/crouch hull and are excluded without relocating
their horizontal coordinates. Player paths are explicitly authored adaptations:
many upstream arrow coordinates are above ground, and several straight-line
segments cross obstacles. Native navigation resolves the walking spine, then the
standing/crouch walk and full-speed motor must pass. Source enemy XYZ, facing and
stance are retained exactly.

## Sources And Provenance

1. Installed CS2 **2000942**, native `maps/de_mirage.vpk`,
   `maps/de_mirage/world_physics.vmdl_c`, visibility and native overview metadata.
   [The plan](mirage/coverage-plan.json) pins the resource and extractor SHA-256.
   Geometry uses `[Source.x, Source.z, -Source.y] * 0.0254` metres, unchanged origin.
   Movement, shot and grenade-only attributes remain separate. Native extraction
   is static: no process attachment, memory reading or game DLL execution.
2. [OpenPrefirePrac](https://github.com/lengran/OpenPrefirePrac/tree/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26/maps/de_mirage),
   pinned commit `44fb66eab70fb3b1b7112ed3c30cc68fb977dd26`, MIT. Seven profiles,
   260 coordinate candidates, per-file SHA and full license notice are stored in
   `openprefire-mirage.json`. These are authored practice positions, not match
   probability measurements. Not all candidates belong to every approach.
3. [EliGE's Mirage prefire guide](https://www.youtube.com/watch?v=S9fe6AgxVHs)
   and [Refrag's entry-training guidance](https://refrag.gg/blog/4-ways-i-improved-my-entry-fragging-skill-with-refrag/)
   are independent scope/training references. They support reviewing common
   defensive angles and entry clearing, not assigning numerical occupancy rates.
   Per-pocket expert/capture review is still pending; references alone do not pass it.

Native visuals retain material/texture associations, cutouts/blending and native
PVS. Three chunks keep combat geometry exact; only the distant backdrop is a
visual approximation with no collision. Cached delivery objects are content-addressed,
texture bundles are shared across chunks, and navigation/collision indexes are
prepared offline. Source hashes and catalog/package identities invalidate stale
beta proof. The map selector and setup show **Mirage (Beta)** and its open gaps.

## Rebuild Locally

Use your own licensed CS2 installation and a compatible Source 2 Viewer CLI.
No map media is committed to the repository. Review publication rights separately.

```sh
npm run assets:mirage:package
node tools/build-mirage-plan.mjs
npm run maps:native -- --map=de_mirage --plan=docs/mirage/coverage-plan.json --out=research/mirage/native-<new-revision>.json
npm run maps:beta -- --map=de_mirage --plan=docs/mirage/coverage-plan.json --report=research/mirage/native-<new-revision>.json --limitations=docs/mirage/limitations.json --out=docs/map-beta/de_mirage/<new-revision>.json
```

Import the new beta receipt in the map descriptor only after inspecting failures
and changes. The build command does not approve/relabel changed game resources.
`--pack-only` rebuilds delivery/context from already-authored chunk files.
Do not run `author-mirage.mjs` to overwrite reviewed path changes accidentally;
it is a reproducible current authoring recipe, not an automatic expert reviewer.

## Beta Verification

The [source-pinned native report](map-beta/de_mirage/2026-11-06-v2.json) passed
212 basic checks: six route motor/stance checks, six protected starts and 200
approach/hold assignments. All three chunk navigation bakes passed a fresh-world
install/no-rebuild roundtrip. Chunk PVS slices matched the whole-map rows at 245
sampled positions per chunk. Texture deduplication leaves 14.44 MB of unique
optimized image bundles across the three chunks, rather than downloading each
chunk's overlapping textures again.

Desktop and mobile Chromium passed all six Prefire routes, native Duel loading
and switching back to Dust 2; desktop also exercised physical movement/firing. Desktop Sound Awareness
loaded the whole native map/radar; it was not a chunk substitute. A fresh JS page
revisited the fixed Mirage Mid chunk with **zero map HTTP requests**, retaining
the same native collision identity from CacheStorage. Source geometry/texture
pixel checks and screenshots were nonblank. These are functional checks, not a
full performance or fidelity certificate.

The initial planning diagnostic covered 30 selected Prefire bots without failures.
A three-second headless contact diagnostic in each Duel chunk recorded bot firing,
damage and displacement; it does not certify every hold/skill/seed scenario.
Browser traces and raw diagnostic output remain local under ignored `research/`
and `test-results/`. The common-map authoring tool and source tests retain the
reproducible checks; no binary assets or screenshots are committed.

The final `npm run check` passed 6,942 tests in 303 files, five admission-tool tests
and the production build. The separate existing Node tooling suite passed 79 tests;
the two new map-namespace/header tests also passed. Four applicable browser checks
passed (desktop/mobile route flow, desktop whole-map Awareness and persistent chunk
cache); the duplicate mobile Awareness case is intentionally skipped.

Content-addressed map cache headers are generated per map, respecting
[Cloudflare Pages' single-wildcard rule](https://developers.cloudflare.com/pages/configuration/headers/).

## Remaining Acceptance Work

Native-capture image and trajectory comparisons, individual pocket/callout/peek
review, additional CT/retake routes, measured encounter data, complete bot skill/
count/seed scenarios, grenade trajectories and broad-device memory/frame-time/
handoff acceptance remain open. Basic hull/shot rays and a successful browser run
do not establish complete Source 2 physics, lighting, animations or bot parity.
