# Fidelity implementation checkpoint

Started October 22, 2026. Implements the accepted fidelity/loading roadmap and
additional hit/death/headshot animation and audio request. Preserve existing dirty
work, physical shot coordinates and frontend-only deployment. No deployment yet.

## October 23 follow-up (current status)

This section supersedes older loading and source-verification claims below;
those measurements describe the earlier implementation, not the final follow-up.

- L2: separate 80 MiB compressed RAM and quota-aware, up-to-512 MiB persistent
  asset caches. Content-addressed map/model/shared-image bytes survive page and
  browser lifetimes while browser storage remains available. Last-used eviction,
  corruption repair and denied/quota-exhausted storage fallback are tested.
- L3: build collision worlds in a cancellable worker; restore the owning-thread
  world from a snapshot. Locally generated, gzip-compressed snapshots use a
  separate 128 MiB bounded cache, keyed by source hash, schema and actual Rapier
  WASM digest. No snapshot download is added. Snapshot compression/persistence
  also runs in a small separate worker: browser native deflate was a one-second
  gameplay-thread stall before this correction. Sampled main-thread restores
  ranged from 41 to 168 ms including first-use cases; <=100 ms/weak-CPU guarantees
  remain open.
- L4: capable devices prepare one complete next map, navigation, round catalog,
  radar and retained GPU resources while the current map is playable. Current,
  previous replay and one prepared next map are the ownership ceiling. Devices
  below 8 GiB use byte-only preparation; unknown memory needs eight CPU threads.
  Data saver/2G disable preparation. Cancellation, retry and adoption are tested.
  Prepared transitions took 47-95 ms without requests in sampled browser runs.
  Early round completion or slow hardware/network can still outrun preparation.
  Zero-vertex GPU uploads preserve visible pixels and the normal shader variant;
  renderer counters/state and draw ranges are restored. Final five-bot live
  preload sample: 4.2/6.5 ms median/p95 frame CPU, but 56-192 ms loading tasks
  remain. It is not a no-hitch or old-PC guarantee.
- G1: Range now samples moving shot origins, speed, stance and reflected moving
  target position at scheduled firing time. Duel recovery uses the sampled
  firing stance and the end-of-step remainder separately. This is not a complete
  timestamped input/subtick implementation.
- G7: timestamped start/stop/reversal/stance blends and bounded rotational foot
  contact correction share shot/render pose history. Actual shipped rifle/pistol
  rig repeat/rewind tests pass at 0.01 mm position tolerance. Blend durations are
  authored trainer parameters, not an extracted Source 2 animation graph.
- G8: source-reviewed coverage expands from 160 unique holds / 213 approach
  assignments to 197 / 347, including seven exact combat-source points. Native
  admission, spawn cover and both movement stances remain mandatory. See
  [position-source evidence](position-source-followup-2026-10-23.md).

### Source-verification erratum

The old Source2Viewer CLI silently failed on current KV3 type 26 while returning
success and leaving old exported files. Therefore earlier claims below that a
fresh 2000934/2000935 static comparison proved *all fields unchanged* were not
valid evidence. Verification now exports into a new unique directory, requires
the new file and reports all differences before failing. Official VRF 20.1
supports the current format; its release archive digest was checked.

The real fresh 2000935 / 1.41.9.2 export changed only AUG primary/alternate reload
from 3.766667 to 3.2 seconds. Those retained fields and explicit update provenance
are corrected; AUG is not reintroduced into selection. The 35-weapon field audit
then passed. A fresh 34-firearm compiled reload audit also passed. Reports are
`research/weapon-fields-build-2000935-fresh.json` and
`research/reload-build-2000935-fresh.json`. Historical native recoil/accuracy/
movement instruction fixtures retain their original hashes and builds; they
have **not** all been revalidated against the current DLL. Current observed
server DLL SHA-256 is
`ccaf4e4926babc052994502b19ec61198a11008a39dce712921b93dd993be9f5`.

### Remaining roadmap work

GPU-compressed textures/visual-only LOD, full timestamped input ordering, native
landing caller semantics, measured CS2 movement/recoil trajectories, shell-reload
attack/silent-reload gates, full native locomotion graph, acoustic portals/HRTF,
native lighting and conditional human-bot calibration remain incomplete. Exact
CS2 parity is not claimed. No deployment has been performed for this follow-up.

### Follow-up verification

Full check passed 3,975 tests / 205 files plus build; later scoped worker/cache/
shader changes passed 27 focused tests, the actual-package admission group passed
five, and a fresh final production build passed. Asset audit, 18 Node tool tests,
three CSV-import tests and all-eight worker-equivalent snapshot comparisons pass.
Desktop/mobile GPU and disk-reuse witnesses pass, including unchanged visible
pixels and current/replay/prepared ownership/cancellation. All four native Prefire
browser checks pass. All nine modes pass desktop/mobile production smoke (18
checks, no browser/asset errors). Native report publication had initially been
missed after expanding pools; the resulting admission failure was fixed by a
complete strict published-pool audit plus independent artifact verification,
not a gate bypass. A new shipped-package regression checks route-key freshness.
See [follow-up results](fidelity-delivery-results-2026-10-23.md) for measurements.

## Earlier work status (superseded where noted above)

- [x] L1: compressed assets and overlapping critical resource loading; production cold/warm/throttled comparison completed.
- [x] L2: twelve shared immutable texture bundles; 80 MiB compressed memory/persistent caches, corruption checks and quota fallback.
- [x] L3: baked columns/convex-plane indexes, exact-query comparison and versioned snapshot restoration. Full snapshots rejected for shipping cost; CPU/transfer targets are not yet met.
- [x] L4: background compressed-byte prefetch for one deterministic next chunk, with data-saver/cancellation handling. Browser interaction validation pending.
- [ ] L5: native chunk PVS implemented and checked at 1,960 source points; GPU texture/visual LOD evaluation remains.
- [x] L6: per-chunk rounds, compact cosmetic catalog/lazy detailed finishes, critical rig/weapon/shader readiness.
- [ ] G1: fractional firing/recovery/target sampling and common scope ordering implemented. Complete timestamped input and Range origin interpolation remain.
- [ ] G2: landing accuracy and movement trajectory verification.
- [x] G3: individual pellet aim-punch contributions retained before combined feedback; mixed-pellet armor depletion witnesses passed.
- [ ] G4: build 2000934 and now 2000935 static fields match all 35 firearms. Fresh source hash recorded separately; historical runtime labels unchanged. Native instruction and measured end-to-end parity remain unverified.
- [ ] G5: compiled source FPS fixed and action assets regenerated (M249 60 Hz). Build 2000934 reload runtime values match existing fixture exactly. Single-shell attack gates and silent reload remain explicit estimates.
- [x] G6: local tactical coordinates/meaningful lane roles; round/navigation assets rebaked and translation tests passed. Measured human conditional calibration remains outside this fix.
- [ ] G7: timestamped native flinches, head/body death impulses, native corpse contact, direction-aware player collapse, 29 native combat/contact audio events, navigation-derived shared sound routing implemented. Foot plants/start-stop graph parity remains.
- [ ] G8: native scene readability and further encounter context.
- [x] Batch validation: full check, asset audit, desktop/mobile native-map workflows, repeated rounds, source geometry comparison, all-mode production smoke and loading/live-combat measurements completed.

Record completed files, commands, failures and remaining limitations here as work
progresses. Pending items are not delivered features. Never replace real-source
verification with a synthetic fixture labeled as game evidence.

## Current evidence / commands

- `node tools/build-duel-delivery.mjs`: shared bundles emitted; compressed raw resources have content-addressed URLs and immutable headers.
- Full Rapier snapshot trial: Mid snapshot 29.95 MB raw / 8.75 MB gzip. Rejected for cold delivery cost; snapshots retained only in ignored `research/query-snapshots/`.
- `build-duel-query-cache.mjs`: compact columns/convex-plane metadata emitted instead; static world snapshot restore remains available for verified local experiments.
- `check-duel-map-chunks.mjs` compares prepared chunk queries against original full-map geometry. Final all-eight check passed; individual subset BVH sweeps retain the predeclared 2 mm tolerance (some sub-millimetre differences), exact source triangles/hulls retained.
- Audio importer preserves combat/footstep metadata across reimports. M249 60 Hz now retains eight reload cues. Combat events extracted from build 2000935; 34 unique WAVs including body contacts. Child events keep independent gain/pitch/delay, including silent lethal-helmet primaries.
- Timestamped hit reactions restore the base before mixer/aim sampling; shot/render hit capsules share the same posed rig. Native corpse sweeps are assigned directly by lethal hits, avoiding an event-order bypass.
- `research/native-presentation-inventory.json`: 51 native world clips inspected, 42 not in the current motion pack. Head death resources are pose banks, not continuous collapses; ordinary crouch entry/exit uses graph blending.
- Native acoustics uses a bounded navigation-derived approximation (512 node visits, cached at 100 ms), not extracted Source 2 acoustic portals/HRTF. AI and playback share the algorithm; existing hostile-only audio filtering remains.
- Browser: all four `real-map-duel.spec.ts` Chromium tests passed, including entry, native radar/arrows, capture through restart, previous-fight replay and zero-fetch previous-map reuse.
- New checksum/decompression/lease tests include overlapping cancelled consumers and bounded decompression. Obsolete generated delivery objects are removed only after all manifests finish writing.
- Native flinch asset: 180,864 bytes, 16 hit layers plus two reference idles, all rotation-only. Builder independently compared 5,844 composed/delta samples (maximum error 1.30e-7 rad). Runtime subtracts asset bind rotation, not idle; repeat/rewind tests preserve pose authority.
- Combat model delivery compresses 75 common GLBs from 152.2 MB to 91.1 MB cumulatively; only needed models load. Motion alone falls from 5.85 MB to 0.98 MB. Critical byte prefetch overlaps map loading, without early rig parsing or another decoded model cache.
- Full `npm run check` passed 3,940 tests / 199 files and the production build. Afterward, two additional real-rig flinch witnesses and one unprotected-leg audio witness were added; the complete final focused eight-file set passed 51 tests, followed by a fresh production build.
- Native asset audit passed (615 audio events / 828 samples); all 75 compressed models decode exactly to their current original GLBs; 18 audio importer/provenance tests passed. No output file exceeds the 25 MiB Pages single-file limit.
- Native Duel desktop workflows (4), mobile native Duel entry (1), native loader/disposal/cancellation workflows (3) passed. Twelve transitions across eight chunks passed without errors; the repeated final pair retained roughly 130-131 MiB collected JS heap and 544 MiB backing storage rather than another scene per switch. This is bounded desktop evidence, not a constrained-device memory guarantee.
- Final production measurements: Mid cold 2.036 s ready / 20.81 MB map; same-browser reload 2.895 s / 300 revalidation bytes; Catwalk 20 Mbps / 50 ms 16.021 s / 25.82 MB map; 4x CPU Mid 6.980 s. Readiness includes actor/viewmodel/shaders, unlike the old early-entry baseline. Targets <=12 MB and <=100 ms collision / weak-CPU task targets remain unmet.
- Final five-bot Performance sample: 4.1 ms median / 8.9 ms p95 CPU frame cost, 170 median draw calls, 469,075 triangles in that encounter; browser/asset errors zero. Source screenshot inspected. Encounters and competing machine workloads are not controlled for a strict before/after FPS claim.
- Final geometry comparison: 1,482 support/hull checks, 1,976 sweeps, 3,909 shot rays and 1,273,439 source triangle faces across eight chunks passed. Largest subset BVH sweep difference was 0.446 mm, below the existing 2 mm tolerance.
- Final production smoke: all nine modes on desktop and mobile Chromium layouts (18 checks) passed with no browser/asset errors or horizontal overflow. Final production build passed; historical changelog entries remain intact. Local dev server: http://127.0.0.1:5176/ . No deployment performed.
- Initial production comparison: Mid cold 2.07 s ready / 20.81 MB map; browser reload 2.94 s / zero map transfer; Catwalk 20 Mbps 19.05 s / 25.82 MB map; 4x CPU Mid 7.63 s. Readiness now includes rig/weapon/shaders and is not the previous early-entry contract. This exposed serial uncompressed model downloads; compressed/overlapping model fix added afterward, new measurements pending.
- First isolated timing (with other tests active): Mid 1.44 s / 308 ms collision, warm rebuilt Mid 716 ms / 261 ms collision; 4x CPU Mid 4.43 s / 889 ms collision. These do not establish a cold-local speedup. PVS download was still a visual-request dependency and has since been removed; final controlled comparison pending.
