# Native collision CPU checkpoint

## Status

- Phase: complete; focused collision/equivalence tests and optional microbenchmark passed. Repository and coordinate/aiming/movement instructions read.
- Ownership: `src/range/prefire/native-collision.ts`, narrowly scoped collision equivalence/CPU tests, and this checkpoint only.
- No actor motor, map/session/navigation/loading, engine, asset, or shot-formula changes.
- Existing hot path clips every candidate triangle into allocating object polygons, recomputes triangle normals, allocates a candidate Set, and scans all clipped surfaces per vertical query. Exact-position surface cache is bounded to 64 FIFO entries.
- Before optimization: preserve a test-only reference of the original clipping/vertical broadphase/order/formulas and establish deterministic fixture/native-map equivalence plus a focused microbenchmark.
- Independent original reference added in `native-collision-cpu.test.ts`; 3 equivalence tests pass before runtime edits. Generated geometry: 2,688 queries in forward/reverse order. Native Dust 2: 2,880 route/box/ramp/ceiling/crouch queries.
- Baseline optional CPU benchmark (five alternating runs, median): 21,504 generated calls reference 193.19 ms vs unchanged runtime 202.17 ms; 23,040 native moving calls reference 280.20 ms vs runtime 266.43 ms. Ratios near 1 validate the reference as a useful baseline. Stationary 192-call samples are too short for reliable performance claims.
- Full-suite validation belongs to the integration owner. Browser profile supplied by main independently confirms `clipTriangle`/`vertical` cost under TacticalBrain navigation; no renderer changes required by this task.

## Implementation Checkpoint

- Replaced temporary object polygons/plane tuples/map/spread extrema with two instance-owned 24-double scratch buffers (384 bytes). Four convex half-plane clips cannot exceed seven vertices; each buffer has room for eight. Interpolation expression/plane/vertex order is unchanged and all coordinates remain float64 during clipping.
- Added exact triangle XZ bounds rejection before normal/clipping work, using original float32 vertex values promoted to JS numbers. No approximation or expanded/shrunk support.
- Replaced per-query candidate Sets with per-triangle uint32 visited stamps. Candidates are clipped in their original first-seen column traversal order, preserving tie selection. Wraparound clears stamps before version reuse.
- Exact XZ FIFO surface cache remains unquantized and now holds at most 256 positions instead of 64. Returned normals are still copies. Original normal formulas/thresholds and vertical selection formulas/tolerances are unchanged.
- Added memory is 4 bytes per movement triangle plus 384 scratch bytes: ~1.59 MiB for the current whole Dust 2, ~0.48 MiB for the Long Doors chunk. No dense triangle plane/vertex duplicates or unbounded query cache.
- No changes to Rapier sweep/fit, raycasting, native surface IDs, shot groups, solid validation, or penetration code.
- First optimized benchmark: generated 21,504 calls 208.22 -> 32.21 ms (6.46x); Dust 2 moving 23,040 calls 267.15 -> 40.89 ms (6.53x). Both timing samples are paired medians of five alternating runs after warmup; checksums and per-query results match exactly. These are query-kernel timings, not browser FPS claims.

## Final Verification

- Added 128 deterministic arbitrary triangles to the generated fixture, alongside slopes, undersides, degenerate/near-vertical faces, signed-zero vertices, and normal/contact threshold cases. Generated queries run forward and reverse, with subnanometre hull/cell-boundary offsets.
- Tests cover caller mutation isolation, changed crouch heights/upward and downward queries at the same cached XZ, tied support normal order, bounded cache eviction, and forced uint32 visited-stamp wraparound.
- Exact results match the independent original reference for all generated and native queries. Tests compare the full returned objects, not merely a numeric tolerance or final checksum.
- Final optional benchmark (same process, warmup then five alternating paired runs, median):

| Workload | Calls Per Sample | Original Reference | Optimized | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Generated, arbitrary triangles added | 21,504 | 820.22 ms | 201.41 ms | 4.07x |
| Dust 2 moving, mixed vertical states | 23,040 | 250.79 ms | 38.14 ms | 6.58x |
| Dust 2, all cold coordinates | 3,840 | 242.48 ms | 29.55 ms | 8.20x |
| Dust 2, stationary cache hits | 48,000 | 10.33 ms | 10.20 ms | 1.01x |

- Optional benchmark tests: **5 passed**. An earlier enriched generated benchmark exceeded Vitest's default 5-second case timeout; its optional CPU case now has a 30-second budget and passes. This did not change runtime geometry or equivalence expectations.
- Final normal focused command: **3 files / 36 tests passed**, including existing native movement/crouch/box-seam/wall-slide/stair tests and material/ray/penetration tests.
- Scoped `git diff --check` passed. No full suite/build was run by this task; main owns integration validation.

```powershell
$env:TEMP=(Resolve-Path .local-tools/test-tmp).Path
$env:TMP=$env:TEMP
$env:NATIVE_COLLISION_BENCH='0'
npm test -- --run src/range/prefire/native-collision-cpu.test.ts src/range/prefire/native-collision.test.ts src/range/prefire/native-surfaces.test.ts

$env:NATIVE_COLLISION_BENCH='1'
npm test -- --run src/range/prefire/native-collision-cpu.test.ts --silent=false --reporter=verbose
```

## Integration And Residual Risks

- No API or call-site changes: reload the local app normally to pick up the implementation. Navigation retry/replan budgeting and scene loading remain main's separate work.
- Browser FPS and frame-time improvements must be measured in main's active-five-bot scenario; kernel speedup is not a whole-application speedup claim.
- CPU timings are machine/load dependent, intentionally not hard pass/fail thresholds in CI. Numerical equivalence is asserted regardless of the benchmark environment flag.
- Scratch buffers are instance-owned and used only in synchronous, non-reentrant static queries; there are no callbacks/awaits inside clipping. Each worker/scene instance has its own buffers.
- Cached normals are not exposed for mutation; returned normals remain fresh copies. The map is static, and no approximate/quantized position cache or plane shortcut was added.
- Added stamp memory is proportional to movement triangle count; existing GPU/Rapier geometry allocation is unchanged. Cache storage is capped at 256 XZ entries and released on disposal.

## Invariants

Preserve hull radius, skin/contact tolerances, `.001` vertical-surface rejection, `.7` support and `-.5` ceiling thresholds, polygon clipping interpolation/order, original candidate tie order, floor/ceiling extrema, seams/slopes, disposal behavior, and all ray/surface/penetration contracts. No quantized approximate coordinate cache.

## Recovery

Update this checkpoint after baseline, implementation, and validation. Keep the old reference test independent so interrupted work can be recovered and compared without relying on a changed runtime implementation.
