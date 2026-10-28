# Native Map Performance: October 20

## Changes

- Native bot path failures retry at most every 0.5 seconds, rather than at the 128 Hz motor rate. Valid routes are checked every 0.2 seconds, with immediate replanning for large horizontal or height changes. Motor, aiming, shot and perception updates retain their existing rates.
- Native triangle/hull clipping uses fixed Float64 scratch buffers and visited stamps instead of temporary polygons and Sets. Exact, unquantized XZ caching is bounded to 256 entries. The independent pre-change reference produces identical complete results across generated and native fixtures, including seams, slopes, ceilings, crouching, tie order and caller mutation.
- Render-only asset optimization keeps every triangle and preserves collision/navigation bytes. Equivalent materials are consolidated, opaque meshes are spatially batched, and geometry is meshopt-compressed. Referenced UVs remain present; repeating UV normalization compensates with texture transforms.
- Ordinary color images are bounded to 512px; text/sign-like materials retain up to 1024px. Existing 256px normal/packed/AO images remain byte-identical. One hash-verified texture pack replaces hundreds of image requests, with independently checked image slices.
- Live map chunks share decoded texture sources through reference-counted leases. The final consumer leaving cancels queued decodes; already-started late results are freed. A map cancellation never cancels another map's lease. Idle images retain the existing 32 MiB/20-second budget.
- Opponent/loadout edits no longer change maps. The current and previous replay chunk form a bounded two-slot cache. Returning to the previous chunk needs no fetch or decode; loading a third releases the older one first.

## Measurements

`tools/profile-real-map-duel.mjs` uses fresh Chromium contexts, the Mid/CT chunk, five skill-8 bots, a native-certified encounter point, 1440x1000 viewport and a 60 FPS cap. It records six seconds after a 1.5-second warmup. Source reports are local ignored research outputs, not shipped assets.

| Metric | Before | After |
| --- | ---: | ---: |
| Native map requests | 390 | 8 |
| Native map response bytes | 51,713,311 | 24,475,316 |
| Local cold entry ready | 2,978 ms | 1,942 ms |
| Median rendered-frame CPU | 4.9 ms | 4.0 ms |
| 95th-percentile frame CPU | 14.7 ms | 5.7 ms |
| Simulation CPU over six seconds | 1,900 ms | 521 ms |

Hardware: i7-13700K / RTX 4080. These are individual local samples, not controlled hardware benchmarks or Internet download times. Bot/camera positions evolve during combat, so visible draw/triangle counts are not a fixed-view render comparison. Competing workloads are not controlled. Frame CPU is not GPU frame time or an FPS multiplier.

| Chunk | Cold Payload | Unique Decoded Images, Before/After |
| --- | ---: | ---: |
| Long doors | 21.39 MB | 487.81 / 178.44 MiB |
| B entry | 15.61 MB | 411.81 / 136.56 MiB |
| Mid/CT | 24.48 MB | 553.69 / 203.06 MiB |

Payload includes collision, navigation, metadata and visuals. Physical folders are larger because original image copies remain for compatible tooling alongside the pack. Shared image decoding does not eliminate downloading a different chunk's pack. All packs are below the Pages 25 MiB per-file limit.

A separate five-bot 4x Chromium CPU-throttled Performance-preset sample recorded 17.2 ms median / 35.4 ms P95 frame CPU and 254 rendered frames in six seconds. It did not sustain 60 FPS. CPU throttling is not validation on a real older CPU or integrated GPU. Use Performance graphics and fewer bots on constrained hardware; do not infer universal smoothness from the normal-speed sample.

## Verification

- Full regression suite: 185 files / 3,746 tests passed; TypeScript and production build passed.
- Visual exporter/optimizer: 20 focused checks passed, including exact protected gameplay files, transforms, referenced UVs, texture packs, deterministic fixture output and idempotent publication.
- All ten native route pools were strictly re-audited. Accepted positions, coordinates, gates and paths are identical to the previous pools. Native material revalidation passed 72 cases. The combined map-quality report passed provenance validation before publication.
- Independent full-map/chunk comparison passed 984 shot rays, 616 sweeps and 462 support/hull checks. Every exported collision triangle retains the original floats and winding.
- Live five-bot combat fired and dealt damage in all three chunks; the existing seed-1 first-shot fixtures remain 0.414-0.492 seconds. These are regression cases, not human reaction calibration.
- Desktop/phone browser checks passed packed loading with no individual WebP requests, nonblank textured pixels, route arrows and generated-map opt-in. Desktop checks also passed pointer-lock continuity, previous-fight replay, edits during loading, no reload on opponent edits and zero-network previous-chunk reuse.
- Browser loader checks passed exact rendered pixels across disposal/reload, complete Blob URL cleanup, shared source reuse and cancellation before queued decoding starts. Changelog history/layout checks passed.
- Production smoke passed all nine modes at desktop and phone sizes: 18 checks, zero browser/asset errors.

## Reproduce

```powershell
node tools/optimize-duel-visuals.mjs --apply
node --test tools/tests/duel-visual-optimization.test.mjs tools/tests/duel-map-chunks.test.mjs
npm test -- --run
npm run build
npx playwright test tests/real-map-duel.spec.ts --project=chromium --project=mobile-chromium
npx playwright test tests/native-map-loading.spec.ts --project=chromium
node tools/smoke-production.mjs
$env:REPORT='research/real-map-repeat'
node tools/profile-real-map-duel.mjs
```

The profiler expects the development server on port 5176. `CPU_RATE`, `BOTS`, `QUALITY`, `SAMPLE_MS` and `DUEL_URL` override its fixture. Reconstruct from original render inputs using `--rebuild-visuals --apply` when changing optimizer policy; do not repeatedly recompress lossy outputs. See `docs/real-map-duel.md` for the full import/navigation pipeline.
