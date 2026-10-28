# Training Quality Implementation

Integrated 2026-10-16. Follow-up to the eight-part improvement roadmap.
The app remains frontend-only. There are no game-process hooks, automatic CS2
inputs, network-delay simulation, or automatic diagnostic uploads.

## Delivered Workstreams

1. **Shared visibility and hit geometry.** Duel sensors use bounded samples from
   the same native capsule pose used for firing. Orientation-correct analytic
   body shapes provide the fallback. Distance/FOV checks precede native posing;
   sensor poses are reused within the 32 Hz sensor cycle. Coaching consumes the
   same observations. Native and generated surface IDs now have separate handling.
   A single-convex-cover test can reject the complete shot-query envelope before
   posing; it never combines separate walls or treats empty ramp space as solid.
   Radar reuses these sensed contacts instead of repeating analytic sight queries.
2. **Recorded-shot review.** Duel and Prefire expose `Review recent shots`.
   It pauses the simulation, displays authoritative bullet and pre-spread rays,
   shot-time capsules, contacts and movement history, and reports bot decisions.
   Diagnosis distinguishes off-target aim/recoil, sampled spread, cover and an
   unexplained overlap. Local JSON export includes setup/build, inputs, seed/RNG
   state, recorded damage and frame diagnostics. Ring storage is bounded to
   ten seconds / 321 frames / 160 shots / 8,192 changed inputs. This is geometry
   review, not a cinematic replay or a claim to resimulate arbitrary old builds.
3. **Native map surfaces.** Dust 2 imports source material/physics IDs and
   penetration modifiers. Closed validated convex solids provide entry/exit
   thickness; open/unverified geometry remains opaque. Penetration, footsteps
   and impact audio share the source lookup. The regenerated build-2000932
   package has 31 surfaces, 8,268 validated solids and 1,837 opaque primitives.
4. **Movement/animation conformance.** Seven versioned trajectory scenarios,
   provenance/hash requirements, explicit tolerances and comparison plots provide
   a repeatable capture pipeline. The motor was not tuned to guessed curves.
   Lower-body turning is bounded independently of aim; scalar pose histories
   prevent render/sensor/shot queries from changing native locomotion phase.
   Live rendered and shot poses now share explicit times. Sensor/shot sampling
   marks the shared rig for restoration before rendering, even when visual
   animation sampling is throttled. Foot IK remains disabled.
5. **Loading/frame-time performance.** Major modes, tutorial and changelog load
   lazily. Native sectors parse two at a time; fetch/decode concurrency is bounded
   to four. Hash-checked images share decoded sources; only idle bitmaps enter a
   32 MiB / 64-entry / 20-second warm cache. Cancellation drains work and releases
   owned resources. Shader prewarming survives model/mode teardown. The optional
   FPS counter includes p95/p99, 1% low and long-frame counts; export retains raw
   intervals. Fractional canvas dimensions now agree with the crosshair overlay.
6. **Contextual bot attention.** Reachable cover-exit hypotheses retain confidence,
   source and reason. Sight, hearing, teammate evidence and cleared-angle negative
   evidence influence stable commitments instead of timed exit cycling. Prefire
   uses acceleration-limited aim transitions. A multi-seed scenario tool measures
   first-visibility-to-shot/damage with censored no-damage cases reported separately.
7. **Actionable practice.** Coaching launches three measured reps for a diagnosed
   skill, deep-links the relevant tutorial and restores the originating task.
   Saved Prefire angle diagnoses retry from a validated covered route point,
   separately from full-route records. Compatible-only skill trends show sample
   counts; missing measurements do not count as zero. Guided/unassisted, varied
   angle and pressure blocks are offered where applicable, with local retention
   bookmarks. Neither isolated retries nor practice UI award full-route XP.
8. **Encounter evidence and map admission.** Contextual data schemas require
   match-balanced joint rosters, build/provenance/rights, exact holding-pocket
   checks and held-out evaluation. Sparse/absent data falls back explicitly to
   whole authored setups, not fabricated frequencies. `Setups` exposes this in
   Prefire. A lazy map registry plus shared authoring/playback/quality tools gates
   geometry, materials, routes, covered starts, visibility, traversal and shots.
   Existing coverage weights remain a separate teaching policy.

## Verification

- `npm run check`: passed 3,386 tests / 162 files, TypeScript and production Vite build.
- Desktop/mobile Playwright: real native assets, nonblank canvas pixels,
  hash-checked map loading, cancellation/disposal, identical warm-reload pixels,
  shot review/export/pause, native pose seeking, aspect-ratio/fractional-frame
  crosshair alignment, measured practice/tutorial flow, Prefire retries, physical
  route clears and automatic progression, settings persistence and tips opt-out.
- `tools/audit-native-materials.mjs`: 72 source/thickness/penetration checks.
- Actual route pools regenerated with `tools/build-prefire-pools.mjs --save`;
  the public quality report and dependency-pinned artifacts were revalidated.
- Offline movement-reference, source metadata and encounter/evidence CLI tests.
- Actual native rig body-turn contribution audit: 6,144 frames. This checks
  yaw/pitch/grip consistency, not foot planting or the complete native graph.
- Brave and Opera GX: coaching blocks, recorded-shot review/export and
  crosshair/aspect checks passed. Chromium additionally covers native pose
  restoration, damage punch, physical Prefire clears and map resource lifecycle.
- Production preview: all nine modes passed on desktop and mobile (18 checks),
  with nonblank canvas pixels, no horizontal overflow and no browser/asset errors.
  `tools/smoke-production.mjs` repeats this against `dist`, without dev imports.

Useful commands (run from the repository root):

```powershell
npm run check
node tools/smoke-production.mjs
npx playwright test tests/combat-replay.spec.ts tests/coaching-workflow.spec.ts tests/native-map-loading.spec.ts --project=chromium --project=mobile-chromium
node tools/audit-native-materials.mjs
node tools/validate-prefire-map.mjs --quality=public/revamp/maps/dust2/quality.json --artifacts=public/revamp/maps/dust2/quality.json.artifacts.json
$env:PREFIRE_ROUTES = 'long-doors,b-tunnels'
$env:PREFIRE_REPORT = 'research/dust2/profile-quality-roadmap.json'
node tools/profile-prefire.mjs --active --combat --shoot
node tools/calibrate-contextual-bots.mjs
```

For Windows sandbox TEMP rename failures, set `TEMP` and `TMP` to the existing
`.local-tools/test-tmp` directory for the test process. This is not an app setting.

## Local Performance Captures

Headless Chromium 153.0.8010.12, Windows, i7-13700K / RTX 4080, Performance
preset, 60 FPS cap. Other application load was not controlled. The Dust 2 capture
uses a 1440x1000 viewport; Duel uses 1440x900. High player health keeps the
automated workload alive, and shooting/movement are trainer-only test inputs.

| Workload | CPU throttle | Window | CPU p95 | Frame p95 / p99 | Frames >50ms |
| --- | --- | --- | --- | --- | --- |
| Dust 2 Long doors, return fire and player shooting | 1x | 10s | 8.5ms | 16.9 / 20.9ms | 0 |
| Dust 2 B tunnels, return fire and player shooting | 1x | 10s | 8.8ms | 20.7 / 20.9ms | 0 |
| Duel, one bot, compact arena | 4x | 4.5s | 11.3ms | 20.9 / 29.0ms | 0 |
| Duel, five bots, ordinary occlusion | 4x | 4.5s | 30.0ms | 37.5 / 49.9ms | 0 |
| Duel, five bots forced visible to stress animation | 4x | 4.5s | 42.8ms | 50.0 / 54.2ms | 3 |

Reports: `research/dust2/profile-quality-roadmap.json` and
`research/duel-poi-profile-roadmap-final/results.json` (local, ignored). No page
errors occurred. Recorded-method timing averaged 0.052-0.054ms per rendered frame
in Dust 2; this excludes shared pose preparation. The stress case is still above
a 60 FPS CPU budget under 4x throttle; throttling is not an old-PC/iGPU substitute.
Earlier same-seed captures exposed large sensor/radar stalls and motivated the
conservative visibility optimization. These short, uncontrolled captures are not
a general percentage FPS-improvement claim or a human playtest.

## Measurement Limits

- No genuine full CS2 trajectory captures were available for the new conformance
  suite. Native arithmetic fixtures and synthetic trajectories do not prove full
  subtick, slope, hull-transition, landing or bunnyhop parity.
- Lower-body timing is a documented presentation heuristic. Failed foot-plant
  prototypes remain disabled; no complete native locomotion-graph claim is made.
- No certified contextual match corpus ships for Dust 2. Exact pocket frequencies
  are not invented. Rank curves and simulated bot calibration are not measured
  FACEIT human distributions or proof that bots are indistinguishable from people.
- Native material checks establish source identity and trainer geometry, not every
  game-engine penetration branch. Unverified/open primitives remain opaque.
- Large cosmetic metadata and existing vendor chunks still need further splitting.
  Local headless profiling is not controlled old integrated-GPU hardware testing,
  and no percentage FPS improvement is claimed without a comparable baseline.
