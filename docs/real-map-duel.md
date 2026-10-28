# Real-map Duel

## Scope

October 20 expansion: the live catalog now has eight chunks and offline-baked round variants for all ten Prefire approaches. See [Dynamic Duel Rounds](dynamic-duel-rounds.md) for the current spawn, cover, radar, audio and serial rebuild workflow. The original three-chunk implementation and its historical verification are recorded below.

AI Duel now defaults to a random native Dust 2 chunk. The first catalog contains Long doors/pit, B tunnels/site and Mid doors/CT. Generated arenas are an explicit, saved opt-in. Real-map dimensions are never stretched by the generated-arena size slider. Floor route arrows default on and can be hidden independently.

This is a browser training simulation, not the CS2 engine. Native geometry and extracted weapon parameters do not establish exact closed-engine gameplay parity. Holding-position selection reuses the existing disclosed Prefire training-coverage policy, not invented encounter probabilities.

## Architecture

- `src/range/duel/real-map-catalog.json` defines small playable Source-coordinate bounds and a padded render/collision context, keyed to admitted Prefire approaches. Source inches retain their existing 0.0254-metre conversion, unchanged orientation and world origin.
- `tools/build-duel-map-chunks.mjs` exports real triangle/resource subsets. Closed native convex hulls remain complete, while mesh triangles retain exact floats, winding, material/surface IDs and collision masks. Visuals retain original decoded attributes and PBR textures. No full-map visual, collision or PVS request is needed in chunk mode.
- `tools/build-duel-navigation.mjs` prepares a bounded multilevel graph offline using the shared hull/step solver. Both directions of every link are certified. Exact, physically walked route nodes bridge narrow doors missed by a coarse grid. No imaginary y=0 floor or unsupported cliff links are introduced.
- `RealMapSession` loads a hash-verified chunk and graph before simulation creation, selects compatible in-bounds common holds, initializes native feet/stance/facing before brain construction and supplies map-relative approach/scan/search points. There are still at most five bots.
- The simulation uses full `TacticalBrain`/Duel perception, hearing, health/armor, movement, recoil, damage, counterstrafing, memory, trading and coaching. It does not substitute Prefire's deliberately limited defender controller. No hidden live player positions are supplied to the planner.
- Map replacement is cancellable. Automatic rounds retain the canvas, fullscreen and pointer lock; Escape during loading remains a pause. At most one detached prior chunk is retained for the previous fight's replay. Returning to that chunk swaps the two existing maps; loading a third releases the older one first. Opponent/loadout edits keep the current chunk. Inactive maps do not render or simulate.
- Chunk sessions own their GPU/physics resources. Engine teardown detaches their scene rather than double-disposing externally owned map resources. Warm bitmap caching remains bounded by the existing map loader budget.
- Normal Duel progression, scorecards and recording remain enabled. Only actual Prefire sessions take the Prefire-specific reporting/XP path.

## Rebuild

After the ordinary native Dust 2 import:

```powershell
node tools/build-duel-map-chunks.mjs
node tools/build-duel-navigation.mjs
node tools/optimize-duel-visuals.mjs --apply
node --test tools/tests/duel-visual-optimization.test.mjs
node --test tools/tests/duel-map-chunks.test.mjs
node tools/check-duel-map-chunks.mjs
node tools/audit-real-map-duel.mjs
npm run check
```

Generated files live in `public/revamp/maps/dust2/duel/` and follow the existing map-asset Git exclusions. `npm run build` includes these local files in `dist`. A clean source checkout must regenerate/import assets before deployment; no downloaded Valve asset ownership or redistribution rights are implied by the exporter.

## Adding Maps

1. Import a pinned map build with exact collision masks/surfaces and a textured visual export; preserve its coordinate conversion.
2. Admit covered starts, physical routes, holds and stance with the existing native hull/shot audits. Keep sourced coordinates and local adaptations separately attributed.
3. Add a catalog adapter/catalog entry, compatible-hold population and map-relative tactical context. Do not make a new copy of combat or movement physics.
4. Export bounded geometry with enough context for sightlines/penetration. Bake the graph, pin hashes and verify resource sizes against the Pages file limit.
5. Compare full-map versus chunk support/hull/sweep/shot fixtures. Test one through five bots, seed variety, covered entry, connected push paths and scene/replay lifecycle.
6. Browser-test real requests, textures/nonblank pixels, controls, round transitions and phone layout. Do not infer correctness from a successful TypeScript build alone.

## Evidence And Limits

Native geometry build: `2000932`; original collision SHA256: `395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396`. Full/subset validation is recorded in `docs/duel-chunk-export-checkpoint.md`. Chunk geometry is identical, although rebuilt Rapier BVHs can produce submillimetre contact-order differences.

The original chunks transferred roughly 36-52 MB versus 101 MB for the full source inventory. Run the visual optimizer after rebuilding chunks/navigation: it right-sizes textures, preserves signage at a higher tier, batches render-equivalent opaque geometry spatially, and meshopt-compresses the geometry without deleting triangles. Collision and navigation bytes are hash-guarded. The image pack replaces hundreds of image requests with one verified request per chunk; original local image files remain available for older manifest-compatible tooling. Live chunks share decoded texture sources; idle caching remains bounded to 32 MiB. This does not make downloads instantaneous or establish performance on every GPU.

Only Dust 2 is currently supported; the catalog/session boundary is prepared for future map adapters. Graph planning is conservative and does not plan deliberate jump/boost routes across disconnected floors. The shared player physics still permits normal terrain traversal. Bots remain configurable simulated opponents, not measured FACEIT humans.

Empty-magazine behavior and primary-source research are documented separately in `docs/empty-magazine-reload-audit.md`. Existing cycle/draw/reload gates are retained; no extra universal idle delay was invented. Current CS2's engine-side exact idle timing has not been measured live.

## Verification On October 19

- Full Vitest run: 182 files, 3,729 tests passed. TypeScript and production Vite build passed.
- Chunk exporter: seven tests passed, including exact typed-attribute/material preservation and complete file/hash inventory. Independent full/subset comparison passed 984 shot rays, 616 sweeps and 462 support/hull checks; every exported collision triangle also matches the original.
- Native integration covers three chunk identities, varied seeds, five configured bots, native feet/stance, source positions, map scale and connected clearing paths. Synthetic navigation tests reject wall-crossing and unsupported-gap routes and validate installed graphs.
- Browser checks: real-map default/toggle/arrows/rendering passed on desktop and phone. Automatic random-chunk transition preserved the same canvas/pointer lock, retained the previous chunk for replay and restored the live chunk afterward. Edits to bot count/skill during initial chunk loading reached the first round. Legacy generated-arena size/control and first-visit playability checks passed.
- Production smoke: all nine modes at desktop/phone sizes, 18 checks, zero browser/asset errors. Pixel checks and screenshots verified nonblank native textures.
- Live native combat audit: skill-8 rosters fired and dealt damage at a certified approach sightline in all three chunks; observed first shots were 0.414-0.492 seconds in these specific seed-1 fixtures. These are regression fixtures, not human reaction-time calibration or universal performance guarantees.
- Final `dist`: 3,759 files, no file over 25 MiB, all three chunk/navigation manifests present. Local development server remains on port 5176. Nothing was pushed or deployed.
