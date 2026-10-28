# Duel chunk export checkpoint

## Scope

Offline Dust 2 geometry exports only. Runtime/catalog integration belongs to the main agent. The exporter preserves existing world coordinates (`x=SourceX*.0254`, `y=SourceZ*.0254`, `z=-SourceY*.0254`) and uses `src/range/duel/real-map-catalog.json` without editing it.

## Progress

- Checkpoint created before implementation.
- Inspection complete: source collision is v2 (433,063 triangles, 8,208,372 bytes, four movement/shot groups). Visuals are six meshopt glTFs, 91,681,127 bytes including shared PBR textures.
- Implementation complete in `tools/build-duel-map-chunks.mjs`: collision triangle subsets with complete convex hulls; padded render subsets with original materials/textures. Both collision and rendering retain the padded context, while play bounds stay separately recorded in `chunk.json`.
- First focused run: six helper/round-trip tests passed, generated-artifact inventory test skipped until exports exist. Command: `node --test tools/tests/duel-map-chunks.test.mjs`.
- Full three-chunk export complete: Long doors 45.02 MB / 793,650 render triangles; B entry 36.13 MB / 545,812 triangles; Mid/CT 51.59 MB / 911,704 triangles. Full source is 101.26 MB / 2,810,080 render triangles. No generated file exceeds 25 MiB.
- All seven focused helper/artifact tests pass. Independent native-kernel comparison also passes with `node tools/check-duel-map-chunks.mjs`.
- Worker implementation is complete; runtime integration remains with the main agent.
- A second complete rebuild reproduced identical primary manifest hashes and collision binaries (deterministic export confirmed).

## Recovery

Owned files are `tools/build-duel-map-chunks.mjs`, added helper tools/tests, `public/revamp/maps/dust2/duel/*`, and this document. Do not revert concurrent runtime changes. No full-project check will be run by this worker.

## Offline navigation follow-up

- Requested: add `tools/build-duel-navigation.mjs`, then generate each chunk's `navigation.json` and update `chunk.json` with `navigationSha256` and exact output bytes.
- Readiness signal received: all three chunk integration tests pass and Long/Mid links are certified both directions. Exporter implemented and all three navigation files are now generated successfully.
- Runtime API owned by main: `createRealMapArena(mapStub, chunk, sanitizeDuelConfig({botCount:5}), 1)`, then `exportNativeNavigation(arena)` returning `{version:1,nodes:[{point:{x,y,z},links:number[]}]}`.
- Preserve existing collision/visual manifest hashes and all source coordinates. This worker will not edit any `src` files.
- Tool validates at most 15,000 finite, inbounds nodes and at most 64 links/node with valid link IDs. It reloads each baked graph into a fresh native collision, installs before arena creation, and fails if arena creation enters expensive navigation preparation queries. It checks reuse across seeds 1/19, unchanged source/manifests during bake, and exact final folder byte totals.

### Navigation results

| Chunk | Nodes | Directed links | Max links/node | Navigation bytes |
| --- | ---: | ---: | ---: | ---: |
| dust2-long-doors | 1,779 | 8,934 | 12 | 194,743 |
| dust2-b-entry | 1,314 | 7,006 | 12 | 148,008 |
| dust2-mid-ct | 1,169 | 6,486 | 12 | 127,258 |

`node tools/build-duel-navigation.mjs` succeeded. Each graph was JSON round-tripped, installed into a newly loaded native collision instance before arena creation, and reused unchanged at seeds 1 and 19. A stack guard on native support queries rejected any attempt to enter graph preparation during these creates; no regeneration occurred. Existing collision/visual manifest hashes were verified and preserved. All final chunk folder byte totals include `navigation.json` and the updated `chunk.json`.

Post-export metadata checks also passed for all chunks: navigation digests match, collision/visual digests are unchanged, and running the metadata calculation again produces byte-identical `chunk.json` (no cumulative output-byte drift). Final totals are 45,211,954 / 36,283,708 / 51,713,311 bytes for Long / B entry / Mid-CT respectively. No full suite or duplicate graph connectivity audit was run by this worker.

Rebuild sequence after source asset/navigation changes:

```text
node tools/build-duel-map-chunks.mjs
node tools/build-duel-navigation.mjs
```

Both commands accept optional catalog chunk IDs. Run the second command after any base chunk re-export: the base exporter intentionally does not claim old navigation is current. Navigation metadata is deterministic (fixed seed 1, five-bot coverage; no timestamps or durations). Its builder source hashes capture the runtime navigation inputs used for the bake.

## Export contract

- Catalog IDs become directories under `public/revamp/maps/dust2/duel/`.
- Collision manifests keep their native group flags, surface table, primitive IDs and triangle surface IDs. Whole intersecting convex hulls remain whole; open mesh primitives are subset and explicitly remain meshes.
- Render primitives preserve their original world matrices and raw typed vertex attributes. Recompression is lossless relative to decoded source attributes (no new simplification or quantization).
- `visual.json` is compatible manifest v2 with local `visual-N.gltf`, local content-addressed texture resources, byte counts and SHA-256 inventory.
- `chunk.json` has top-level `collisionManifestSha256` and `visualManifestSha256` for runtime admission, plus the source collision identity, build, Source/play/padded bounds, geometry counts and exact total output byte count.
- No PVS files are exported. The runtime must disable whole-map PVS for these subsets.

## Validation results

Both commands succeeded:

```text
node --test tools/tests/duel-map-chunks.test.mjs
node tools/check-duel-map-chunks.mjs
```

| Chunk | Total MB | Render triangles | Collision triangles | Closed hulls | Route/hold fixtures | Shot rays | Hull sweeps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dust2-long-doors | 45.02 | 793,650 | 131,366 | 3,120 | 28 | 378 | 224 |
| dust2-b-entry | 36.13 | 545,812 | 133,939 | 2,967 | 30 | 435 | 240 |
| dust2-mid-ct | 51.59 | 911,704 | 173,443 | 4,226 | 19 | 171 | 152 |

The full source is 101.26 MB, 2,810,080 render triangles and 433,063 collision triangles. Chunk render reductions are 67.6%-80.6%; total transfer reductions are 49.1%-64.3%. Existing high-resolution PBR images are retained, not downscaled or replaced, so texture bytes remain a substantial part of the bounded exports. The largest generated file is 10,890,768 bytes (well below Pages' 25 MiB limit).

The independent audit checks every exported collision triangle against the original source floats, winding and surface ID. It additionally compares native support, standing/crouching hull fits, short movement sweeps and all pairwise bounded sight/shot rays at the admitted route/hold fixtures. The maximum sweep-position difference was 0.000446 m (0.018 Source units), attributable to Rapier's rebuilt subset BVH/contact skin; all geometry values are exactly preserved. The audit allows less than 0.002 m for this contact-order noise, not changed map geometry.

Build identity is 2000932; source collision SHA-256 is `395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396`.

## Changed paths

- `tools/build-duel-map-chunks.mjs`
- `tools/check-duel-map-chunks.mjs`
- `tools/tests/duel-map-chunks.test.mjs`
- `public/revamp/maps/dust2/duel/dust2-long-doors/*`
- `public/revamp/maps/dust2/duel/dust2-b-entry/*`
- `public/revamp/maps/dust2/duel/dust2-mid-ct/*`
- `docs/duel-chunk-export-checkpoint.md`

The existing ignore rules exclude the generated map assets from Git status, just like the full native map. They are present locally for runtime use. Rebuild all chunks with `node tools/build-duel-map-chunks.mjs`, or give one or more catalog IDs as arguments to rebuild a subset. No source catalog, runtime files, package metadata or other concurrent work was edited.
