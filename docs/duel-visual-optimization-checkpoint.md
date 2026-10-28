# Duel visual optimization checkpoint

## Scope and mutation gate

Render-only offline chunk optimization. Owned files are `tools/optimize-duel-visuals.mjs`, focused helper tests, this checkpoint, and (only after main captures the baseline) the generated chunk visual assets/metadata under `public/revamp/maps/dust2/duel/*`.

**Baseline captured; main has authorized live-asset writes once the tool/tests are ready.** Collision binaries/manifests and navigation files must remain byte-identical. No runtime, original exporter, game files, or source coordinate changes are permitted.

## Progress

- Checkpoint created before implementation.
- Baseline measured: Long/B/Mid visuals 42.07/33.21/47.74 MB; unique decoded RGBA images 487.81/411.81/553.69 MiB; 619/452/662 primitive draws; 793,650/545,812/911,704 triangles. Texture bytes dominate (27.18/22.37/30.40 MB).
- Render-equivalent materials can be consolidated without flattening PBR differences: Long has 361 material records but 170 render-unique material definitions. Source material names/provenance differ; native overlay state must remain distinct.
- Implemented `tools/optimize-duel-visuals.mjs`: global render-material consolidation, 32m horizontal/64m vertical spatial batching (Y origin shifted to avoid cutting ground-level geometry at zero), transparent/decal separation, texture bounds and meshopt output. No triangle simplification.
- All ten focused tests pass (`node --test tools/tests/duel-visual-optimization.test.mjs`), including protected gameplay bytes, deterministic serialized output, inherited/nonuniform/reflected transforms, UV/colors, sampler/material distinctions, shared copies and repeat-application no-op behavior.
- First dry run exposed excessive height-cell splitting that increased draw calls; this was corrected before live publication. Only unreferenced UV streams are removed (all actual native material samplers use UV0); referenced UV sets, including extension texture-transform overrides, remain intact. Exact-attribute welding reduces duplicate vertices without removing triangles.
- Revised Mid/CT dry run: visuals 47,744,839 -> 29,756,773 bytes; decoded image bytes 580,583,448 -> 272,695,320; batches 662 -> 512; materials 337 -> 185; every one of 911,704 triangles retained. Authorized publication is starting.
- The first pass was published for all three chunks. Main then requested more aggressive reasonable compression plus single-request texture packs. Final pass is now in dry-run tuning; no second live publish yet.
- Pack support is implemented: `texturePack={name:'textures.bin',bytes,sha256,images:[{name,offset,length}]}`. Four-byte aligned slices are independently checked against existing resource SHA-256s; original local/shared files and resource inventory remain compatible. Pack bytes stay separate from `visual.resources`, and physical chunk totals include the duplicate compatibility files plus pack.
- Current v2 policy: 14-bit positions, standard high meshopt/oct vertex-normal compression, unchanged existing 256px normal/packed image maps, ordinary/foliage albedo max512 and actual text/sign-like materials max1024. Broad alpha/overlay heuristics were removed because generic vegetation/stains do not justify 1K textures.
- Added UV-frame normalization with equivalent `KHR_texture_transform` compensation: glTF Transform otherwise leaves repeating/out-of-[0,1] UVs as Float32. Only non-rotated frames with <=64 UV repeats are normalized; rotated/large frames are retained unchanged for safety. All used UV coordinates continue sampling the original location.
- Final render reconstruction uses the original full-map *render* inputs offline to avoid cumulative lossy recompression. `--rebuild-visuals` never re-exports collision/navigation. Protected gameplay assets remain independently hash-checked.

## Final publication status

**V2 and packs are fully published for all three chunks. There is no active exporter/session or remaining sidecar blocker. Main can run browser QA, build and final profiling now.** No further tuning is planned.

The successful final command was `node tools/optimize-duel-visuals.mjs --rebuild-visuals --apply`. It reconstructed original render subsets, optimized once, and emitted packs; it never regenerated collision/navigation. An initial attempt rejected an in-memory zero-scale native batch with an undefined decomposed rotation before writing anything. The bounded fix preserves that batch collapsed at its exact original translation; its triangles remain present and a regression test covers it.

All 20 focused checks passed:

```text
node --test tools/tests/duel-visual-optimization.test.mjs tools/tests/duel-map-chunks.test.mjs
```

Additional actual-asset checks verified every packed slice, local/shared image bytes, all manifest hashes, exact folder totals and unchanged navigation digests. Every normal/packed/AO image used by the final glTF matches its original full-map resource SHA-256 (Long 162, B 138, Mid 196 distinct data images). Re-running the final optimizer with `--apply` is an idempotent no-op. Fixture-based fresh rebuilds serialize deterministically. No full suite/browser work was duplicated by this sidecar.

| Chunk | Before visuals MB | Final visuals MB | Geometry MB | Image pack MB | Decoded images MiB before/after | Draws before/after | Materials before/after | Triangles retained |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| Long doors | 42.07 | 18.21 | 8.42 | 8.46 | 487.81 / 178.44 | 619 / 550 | 361 / 170 | 793,650 |
| B entry | 33.21 | 12.51 | 5.90 | 5.76 | 411.81 / 136.56 | 452 / 337 | 265 / 126 | 545,812 |
| Mid/CT | 47.74 | 20.48 | 9.74 | 9.38 | 553.69 / 203.06 | 662 / 512 | 337 / 185 | 911,704 |

Cold payload estimates including collision, navigation and metadata are 21,388,210 / 15,612,056 / 24,475,316 bytes (Long/B/Mid), with **8 requests each**, including one image-pack request. These are the network figures; physical chunk folders are larger (29,849,036 / 21,368,572 / 33,856,918 bytes) because compatibility image copies intentionally remain alongside the pack. `visual.bytes` retains the manifest-v2 inventory convention and does not double-count the pack's duplicate image contents. Mid did not meet the aspirational 15 MB visual target without removing geometry; further exploration was explicitly stopped in favor of publishing the validated intact scene.

Navigation SHA-256s remain:

- Long: `6c7cfdbfa33716010a8e583fa958684644df2feeae60538dc95a5aabecb86b8b`
- B: `3bec2c86adca081f01a3246e214a1348248da85786c50a1d9c164de7900604e1`
- Mid: `15571c526bc2d6607c03b1155b63bb3723a2da9a7a336843a7c03c2009b3fd43`

## Final manifest/quality contract

- Preserve manifest v2 and all local resource copies/inventory. Add `textureBase: "/maps/dust2/duel/shared/"` for texture-only network reuse; buffers/glTF stay chunk-local. Shared images have the exact same hash/content as their local copies. Main owns loader support.
- Ordinary albedo/emissive/foliage maximum 512px; actual text/sign-like materials retain up to 1024px. Only downscaled ordinary images are re-encoded at WebP quality 80, alpha quality 100. Already-bounded images and all existing maximum-256px normal/packed/AO maps remain unchanged.
- Merge only rendering-identical materials, accounting for all PBR/sampler/UV/render-state differences. Batch opaque/cutout triangles by spatial cells; do not merge alpha-blended nodes, preserving transparent sorting and decal behavior.
- Keep every source triangle. Bake world transforms correctly, retain referenced UV/color/normal/tangent attributes, then use 14-bit positions, standard high meshopt octahedral vertex-normal compression, 16-bit UV quantization and compensated repeating-UV frames. Collision/navigation are separately hash-guarded and unchanged.
- `texturePack={name:'textures.bin',bytes,sha256,images:[{name,offset,length}]}` is present in every final `visual.json`. It is intentionally outside `visual.resources`; original local/shared image copies and their resource hashes remain available. All packs are below 25 MiB. Metadata primary visual hash and physical output-byte totals include the new pack files correctly.

## Commands

```text
node tools/optimize-duel-visuals.mjs --help
node tools/optimize-duel-visuals.mjs --rebuild-visuals --apply
node tools/optimize-duel-visuals.mjs --pack-only --apply
```

The first rebuild flag reconstructs only original render inputs, without changing gameplay assets or accumulating previous lossy passes. Pack-only rebuilds image packs without geometry/quality changes. Omit `--apply` for a no-write dry run. All modes accept optional catalog chunk IDs. Source/runtime/original exporter files were not edited.

## Recovery

The pre-optimization assets are reproducible using `node tools/build-duel-map-chunks.mjs` followed by `node tools/build-duel-navigation.mjs`. Do not rerun either while main profiles the baseline. No full suite or browser run belongs to this sidecar.
