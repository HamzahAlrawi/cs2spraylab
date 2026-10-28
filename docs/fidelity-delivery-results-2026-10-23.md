# Fidelity delivery results

Local implementation/verification, October 23, 2026. Not a deployment or a claim
of complete CS2 parity. Full scope/status remains in
`fidelity-implementation-checkpoint.md`.

## Subsequent follow-up

The tables below are the earlier delivery baseline. The follow-up now fully
prepares one next scene on capable devices, including collision, navigation,
radar, GPU uploads and retained shaders. Small frame-paced GPU batches took
about 0.48-0.51 seconds in final desktop/mobile browser witnesses, rather than one idle
wait per mesh (about 34 seconds in the initial experiment). Foreground render
state and frame counters are preserved. Zero-vertex uploads use the normal
framebuffer/shader configuration with clearing disabled; pixel-for-pixel checks
prove the visible frame is unchanged during preparation.

Compressed content-addressed map/model/image bytes persist locally, separately
bounded at up to 512 MiB with quota-aware eviction. RAM remains capped at 80 MiB.
Worker-built collision snapshots persist separately (128 MiB cap) without new
network payload. Sampled owning-thread restores ranged from 41 to 168 ms across
worker/disk and first-WASM-use cases; this is not a <=100 ms guarantee. Prepared
map adoption took 47-95 ms with no new requests.
An HTTP-cache-disabled fresh page loaded the previously played chunk with zero
`/objects/` network downloads. Browser eviction/private mode can still require
downloads; immediate rounds/low-memory/data-saver devices are not guaranteed to
have a fully prepared next scene.

Live profiling caught two additional preparation defects after the isolated
tests: an offscreen framebuffer forced an unintended shader variant, and browser
`CompressionStream` performed approximately one second of snapshot deflate on
the gameplay thread. Zero-vertex draws retain the normal shader configuration;
compact collision-worker replies reuse the checked index; a separate 1.65 kB
worker now compresses and writes local snapshots. Denied workers skip this
optional write rather than doing expensive fallback compression during combat.

The final 10-second five-bot Performance sample prepared Catwalk successfully
while Mid was playable: 4.2 ms median / 6.5 ms p95 game-frame CPU work, no browser
errors. Background preparation still produced 56-192 ms main-thread tasks;
weak-CPU task targets remain open. The trace confirms the one-second deflate is
on the cache worker, not the gameplay thread. Different random encounters and
competing machine workloads prevent a controlled whole-game FPS claim.

Dust 2 expands to 197 unique admitted positions / 347 approach assignments.
Seven exact reviewed combat-source coordinates augment the pinned practice
profiles; kill locations are not presented as measured holding probabilities.
Range shot origin/target sampling and historical stance recovery are corrected.
Native-rig locomotion transition/contact witnesses were added; the full Source 2
graph remains out of scope of these blends.

**Verification correction:** the old exporter could silently reuse stale output.
Its earlier "fresh fields unchanged" result below is superseded by a real VRF
20.1 export: AUG primary/alternate reload changed to 3.2 s; the other audited
static fields matched. Current fields are corrected and a new unique-directory
audit passes. Historical native instruction fixtures are not relabeled. See the
[checkpoint erratum](fidelity-implementation-checkpoint.md#source-verification-erratum)
and [position sources](position-source-followup-2026-10-23.md).

### Follow-up validation

- Full `npm run check`: 3,975 tests / 205 files and production build passed.
  Later scoped cache/worker/shader changes passed all 27 focused regressions and
  a fresh production build. Actual-package/synthetic admission checks passed
  another five tests; offline chunk/evidence tools passed 18 tests.
- Desktop/mobile GPU preparation: both passed, including unchanged framebuffer
  pixels, renderer counters/state, geometry draw ranges and nonblank next frames.
- HTTP-cache-disabled fresh-page witness: zero asset-object requests; snapshot
  source is disk. Final prepared adoption sample: 50 ms, zero new requests.
  The expanded witness owns exactly current/replay/prepared maps (three), renders
  only the current one, and proves a changed selection disposes the prepared map.
- Asset audit passed: 75 exact-byte delivered models, 615 events / 828 samples.
- Worker-equivalent snapshot/native geometry comparison passed all eight chunks:
  1,890 support/hull checks, 2,520 sweeps, 6,496 rays and 1,273,439 source faces;
  maximum subset-BVH sweep difference remains 0.446 mm (2 mm tolerance).
- Twelve map transitions passed with one attached scene and at most two owned
  current/replay maps in this fixed-sequence witness. The final repeated pair
  retained about 131 MiB JS heap / 540 MiB backing storage. This witness does not
  measure the maximum three-scene prepared-state footprint.
- CSV importer: three tests passed; 2,242 complete pairs from 17 matches, with
  385 incomplete pairs excluded. Coverage diagnostics do not change holding odds.
- Strict admission regenerated and independently hash/dependency-validated for
  all ten approaches / 347 assignments, including 72 native material witnesses.
  The first browser run exposed an old admission certificate and correctly
  refused entry. Its replacement was generated through the strict audit, not
  edited to bypass the gate. A new actual-package test prevents recurrence.
- Final Prefire browser run: all four passed (physical approaches, silent
  responsive defenders, exact native holds, animated head hits, standing CT
  head-only exposure). Final production smoke: all nine modes on desktop/mobile
  layouts, 18 checks, no browser/asset errors or horizontal overflow.
- Changelog history is preserved with a new follow-up entry. Final whitespace
  check passed. Local server remains http://127.0.0.1:5176/; no push/deployment.

## Earlier implementation

- Verified compressed chunk/model resources, twelve shared image bundles,
  bounded compressed-byte caches, overlapping critical downloads and one-next-map
  byte prefetch. No extra decoded map is retained for prefetch.
- Baked collision columns/planes; versioned query restore and exact native-source
  comparisons. Full snapshots were evaluated and rejected for transfer cost.
- Native chunk visibility, per-chunk round metadata, lazy detailed cosmetics,
  critical rig/viewmodel/shader readiness and safer late weapon attachment.
- Scheduled firing-time recovery/pose sampling, shared scope ordering, matching
  Range guidance prediction and individual pellet aim-punch contributions.
- Map-relative tactical comparisons and differentiated native-map lane roles.
- Sixteen native rifle/pistol flinch layers, sampled on the shared render/hitbox
  clock. Direction-aware death impulses/view collapse and native corpse contact.
- Twenty-nine native combat/contact sound events, independent child layers,
  compiled-FPS action timing, shared navigation-derived sound routing.
- Append-only changelog, source/asset/lifetime regression tests and audit tools.

## Measurements

Headless Chromium, i7-13700K, Performance quality, 1440x1000. One sample per case;
synthetic throttling is not testing a real older laptop. Readiness now includes
actor rig, selected first-person weapon and shaders, unlike the old early-entry
measurement. Compare transfer sizes more confidently than entry times across
those different contracts.

| Case | Ready | Map wire bytes |
| --- | ---: | ---: |
| Mid cold | 2.036 s | 20.81 MB |
| Mid browser reload | 2.895 s | 300 revalidation bytes |
| Catwalk, 20 Mbps / 50 ms | 16.021 s | 25.82 MB |
| Mid, 4x CPU | 6.980 s | 20.81 MB |

The intermediate Catwalk version took 19.05 s before critical model compression
and overlap. Motion GLB transfer falls from 5.85 MB to 0.98 MB. Across 75 models,
152.2 MB of raw files become 91.1 MB; the browser loads only requested models.

Five-bot live sample: CPU frame cost 4.1 ms median / 8.9 ms p95, 170 median draw
calls and 469,075 triangles in that view. This does not prove a universal FPS gain
against a different encounter or physical hardware.

Twelve native-map transitions passed. Repeating the final two chunks retained
roughly 130-131 MiB collected JS heap and 544 MiB backing storage. These are still
substantial memory costs; GPU textures and lower-memory rendering remain work.

## Verification

- Full `npm run check`: 3,940 tests / 199 files plus production build passed.
- Final focused eight-file regression set: 51 tests passed, including three later
  real-rig/unprotected-leg witnesses; fresh production build passed afterward.
- Asset audit passed; all 75 delivered models decode exactly to current originals.
- Eighteen importer/provenance tests passed; 34 combat/contact WAVs verified.
- Native model export: 5,844 additive composition samples, max error 1.30e-7 rad.
- Native-map browser workflows passed on desktop and mobile; native loader
  cancellation/disposal and repeated-round ownership passed.
- All nine modes in desktop/mobile production layouts: 18 checks, no page/asset
  errors, nonblank canvases and no horizontal overflow.
- All-eight geometry checks: 1,482 support/hull checks, 1,976 sweeps, 3,909 rays,
  1,273,439 exact source faces. Maximum subset-BVH sweep difference 0.446 mm,
  within the predeclared 2 mm tolerance.
- Fresh static weapon-field comparison passed against installed build 2000935
  without relabeling older engine-function fixtures. No output exceeds 25 MiB.

## Still Open

Cold <=12 MB transfer, <=100 ms collision setup and weak-CPU task targets are
not met. KTX2/visual LOD, complete timestamped input/Range-origin sampling, native
landing input verification, measured movement/recoil trajectories, single-shell
attack/silent-reload semantics, start/stop/foot-plant blending, Source 2 acoustic
portals/HRTF and native lighting remain incomplete. Utility-aware round context
and measured human conditional behavior calibration are separate substantial
work. Native flinch clips do not reproduce the entire Source 2 animation graph;
death physics remains a cosmetic bounded solver.

Raw reports/screenshots are retained in ignored `research/fidelity-*` files.
