# Utility And AI Completion Audit

Historical functional audit. The [October 28 fidelity audit](native-grenade-fidelity-2026-10-28.md)
supersedes numerical assumptions below, including pin-animation release gating,
the old radial HE curve, smooth flash exposure and generic reflection. Passing
these functional tests never established equivalence with CS2.

Local implementation, October 26, 2026. Not a deployment or Source 2 parity claim.

## Functional Gaps Closed

| Area | Runtime implementation | Regression coverage |
| --- | --- | --- |
| Prefire parity | Shared sensed-contact reload, sidearm and utility policy; queued throws survive controller handoff; unsafe uncommitted plans cancel | `prefire/bot-policy.test.ts`, controller/session fixtures |
| Grenade inventory | Drop/pickup, four-slot/two-flash/fire limits, LOS/range checks, death selected/best drop or live release | `utility-completion.test.ts`, `utility-integration.test.ts`, real HUD browser test |
| Utility review | Recorded flight/bounces, smoke/fire/holes, flash, drops and native held/throw poses; absolute seeking; bounded nested copies | `utility-replay.test.ts`, `playback-scene.test.ts`, browser backward-seek test |
| Environment | Six-connected .8 m smoke fill, 768-cell bound; native grenade-only collision and separate trace mask; actor hull bounces | Smoke partition/opening tests, native-mask snapshot roundtrip, actor contact tests |
| Presentation | Native view/world models, frame atlases, continuous throw-strength poses, graph completion clocks, interrupted audio ownership, flash low-pass | Native hashes/timing fixtures; desktop/mobile model and particle render checks |
| Team utility | Sensed-report reservations, duplicate-area prevention, callout delay, actual-pop release of covered support | `utility-completion.test.ts`, shared policy tests |
| Map setups | 127 independent trajectory-tested opportunities, all eight Dust 2 chunks, geometry SHA/version and exact source stance/position tolerance | `build-utility-opportunities.mjs`, opportunity tests |
| Decision continuity | Expiring FIFO passage reservations, checked backoff, persistent flank evidence, correlated personality preferences, contextual finite aim motors | `passage-reservations.test.ts`, `contextual-bot-behavior.test.ts` |

The setup catalog is independently authored from native-map training approaches.
It does not copy AGPL lineup data, confuse projectile source with player feet,
derive holding probabilities from lineup density, or target hidden actors.

## Static Native Evidence

Installed build **2000935**: native model/clip/graph/vdata provenance remains in
`utility-models.json` and `utility-presentation-native.json`; particle definitions,
channels and output hashes are in `utility-particles-native.json`.

- Deploy gates: 1 second from vdata; graph draw completion is .8 seconds and
  does not replace the independent gameplay gate.
- Pin completion: 23/30 seconds, Molotov 28/30, from graph Charge state events.
- Sound markers are sound only. The separate .1-second launch gap is explicitly
  a trainer fallback, not a native projectile-release event.
- `build-grenade-clips.mjs` extracts static `csgo_grenadeclip`: 689 vertices /
  2,320 triangles from the pinned map build 2000932 (not the newer weapon build).
  Raw physics and parent geometry hashes must match before attachment. Movement/shot
  maps and downloaded resource hashes stay unchanged.
- Main optional utility bank: 63 events, 113 WAVs, 23,906,530 bytes. The separate
  presentation bank is an extraction reference, not another runtime download.
  Three native atlases total 611,136 bytes.

## Resource And Performance Contract

No runtime GitHub fetches, inference, game-process access or per-frame asset
requests. Reuse content-addressed model delivery and native-map storage. Static
smoke cells are copied/indexed once, not serialized at every replay sample.

Limits: 32 projectiles, 64 effects, 16 fire cells/effect, 16 smoke holes/effect,
2,048 visible smoke puffs total, 64 loot clones. Smoke construction performs
bounded geometry work once per detonation. Native particles share three atlases
and retained buffers. Later clouds can lose cosmetic puffs at saturation;
physical visibility is not discarded.

The profiler places stress actors AFTER async restart and rejects non-advancing
fights. A five-visible-bot sample under 4x CPU throttling had median 16.7 ms frames
and 20.9 ms p95 on this RTX 4080 machine, not an old-device FPS guarantee. Utility
stress additionally rejects runs unless actual smoke and fire instances render.
Detailed reports/screenshots remain local in `research/`.

The smoke/fire run rendered 323 smoke and 4 fire instances with five visible
bots. Under the same 4x throttle, CPU median rose from 11.7 to 12.1 ms; frame
median/p95 stayed 16.7/20.8 ms. It is one controlled generated-arena sample,
not a native-map or old-integrated-GPU certification.

Separate native-collider construction samples across all eight chunks produced
263-348 smoke cells in .798-4.880 ms per one-time fill (32 fills, this machine,
unthrottled). This bounds the tested detonation work, not every possible cloud.

## Rebuild

```powershell
node tools/build-grenade-clips.mjs
node tools/build-utility-opportunities.mjs
node tools/audit-utility-presentation.mjs
node tools/import-utility-particles.mjs
node tools/import-utility-audio.mjs
node tools/build-combat-model-delivery.mjs
```

The main asset pipeline includes presentation/audio extraction after native
utility models. Grenade clips/opportunities are map-owned offline rebuilds and
require existing native exports. Do not regenerate map content or replace
verified cache hashes merely to add utility visuals.

## Final Verification

- `npm run check`: 241 files / 4,387 tests passed, TypeScript and production
  build passed. Existing large-bundle warnings remain.
- `tests/utilities.spec.ts` and `tests/utility-models.spec.ts`: seven desktop/
  mobile Chromium cases passed; three duplicate mobile exclusions were skipped.
- Additional native particle desktop/mobile audit: nonblank pixels, visible
  animated flames, changing frame hashes, stable geometry counts, no page errors.
- Native model delivery: 94 exact-byte entries verified. No per-throw downloads.
- All ten Dust 2 pool audits rerun after grenade-mask changes. Accepted routes
  hash stayed `183d5aadd6385d59af2d4bf3be5ca4282995894eafc1e06fcf2b97211f99b395`;
  no player path, accepted angle list or shot visibility was changed by masks.
- Post-review audio cancellation/duration rerun: 27 tests passed.
- Local server checked HTTP 200 at `http://127.0.0.1:5176/`, including particle
  atlas content delivery. No deployment, commit or ZIP was requested/performed.

## Fidelity Boundaries

The functional systems above are integrated, but **identical CS2 is not
established**. Three.js does not execute Source 2 particle graphs, volumetric
shaders or native animation IK. Rapier/hull probes are not Rubikon. Blast curve,
material elasticity, flash exposure/deafening, fire propagation and release gap
remain explicit approximations. Skill/personality distributions are authored
training policies, not measured FACEIT population statistics. Human testing and
measured native trajectory/behavior captures are necessary for parity claims.
