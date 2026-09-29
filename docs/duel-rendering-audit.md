# Duel movement and rendering audit

## Reproduced issues and changes

- At a 240 Hz display cadence, the old renderer reused 128 Hz actor positions,
  producing repeated frames even with a high FPS count. `renderSnapshot()` now
  interpolates the last two physics states. Its maximum interpolation delay is
  one tick (7.8125 ms); local camera yaw/pitch include pending mouse input
  immediately. Physics, shot rays and already-created impacts stay authoritative.
- Discrete animation selection restarted clips at direction/gait changes and
  switched crouch at a boolean threshold. `DuelAnimator` blends cardinal clips
  using local velocity, actual speed and continuous stance. Cycles share a
  distance-driven phase. Native run/walk reference speeds (225/136 u/s) came
  from the inspected rifle graph; the 76.5 u/s crouch stride reference is tuning.
  This does not reproduce native foot IK, starts/stops, upper-body aim layers,
  weapon actions or every diagonal clip. Measured source contact/phase matching
  remains necessary for exact animation fidelity.
- Navigation returned one smoothed bend followed by raw grid points. Bots could
  brake at intermediate waypoints and repeatedly start/stop near a destination.
  Routes now remove unnecessary bends along clear segments, brake on the final
  approach and latch arrival. Movement inputs use the actor's post-turn yaw,
  avoiding sideways drift caused by turning between input construction and use.
- Aim changes now have bounded angular acceleration and settling, and unalerted
  preaim generally stays on the approached lane. These are trainer heuristics,
  not extracted human or FACEIT motion distributions.
- A short attack could expire before a slower bot's motor delay. A regression
  fixture reproduced this. Burst duration now starts with firing; unseen angles
  and unsuccessful aiming retain bounded timeouts.
- Each static fixture/trim previously had a separate draw submission. Meshes
  sharing a material are merged once, following the
  [Three.js geometry batching approach](https://threejs.org/manual/en/optimize-lots-of-objects.html).
  The physical solid list is unchanged. A conservative oversized body/weapon
  box is culled only when all corners are occluded by the same convex solid;
  separate walls cannot hide an open gap. Offscreen animation also skips work.
- Rebuilding actors leaked their skeleton bone textures. Replacing a first-person
  weapon also left old GPU assets alive. Both lifetimes now release their owned
  resources while preserving shared character geometry/materials.

## Measurement

`npm run profile:duel -- label` launches GPU-backed Chromium against
`http://127.0.0.1:5178` (override with `DUEL_URL`). It warms assets, runs 1/5-bot
scenes and writes JSON/screenshots to `test-results/`. Optional trailing width
and height allow larger viewports, e.g. `npm run profile:duel -- large 3840 2160`.
Do not run another GPU benchmark/browser suite concurrently. GPU timer queries
and JS wrappers add measurement overhead. This is a short local sample, not a
guarantee for other browsers, power modes or GPUs.

The RTX 4080 / ANGLE D3D11 capture at a 1656 x 907 drawing buffer measured:

| Metric | Before | After rendering/motor fixes |
| --- | ---: | ---: |
| 1 bot: median draw calls | 175 | 31 |
| 1 bot: median frame CPU work | 1.3 ms | 0.7 ms |
| 5 bots: median draw calls | 200 | 50 |
| 5 bots: median frame CPU work | 2.1 ms | 1.4 ms |
| 5 bots: p95 frame CPU work | 2.6 ms | 1.9 ms |
| 5 bots: p99 frame interval | 4.3 ms | 4.3 ms |

At a 3576 x 1987 drawing buffer, five bots measured 1.5 ms median / 2.0 ms p95
CPU work and 4.3 ms p99 frame intervals. Both old and new normal captures were
already near the display's 240 Hz cadence. The important visual correction is
removing repeated physics poses and clip restarts; the performance result is
reduced CPU work and draw calls, not a demonstrated increase in maximum FPS.
GPU timings varied between runs and did not establish a GPU-time improvement.

## Regression coverage

- Uniform presented motion at 240 Hz, shortest-path yaw interpolation, immediate
  mouse input without double application, and render reads leaving physics intact.
- Normalized continuous diagonal/stance weights, bounded aim acceleration,
  full-cover culling versus a visible edge or low wall, and slow-bot aim timing.
- Browser test with every bot visible: eight round rebuilds retain stable texture
  and geometry counts; native ankle motion is nonzero; native head height descends
  continuously through five crouch fractions. Screenshots cover stand/half/full
  crouch, plus canvas pixel variance and browser errors.
- Existing keyboard/pointer lock, firing, follow recoil, mode switching, five-bot
  persistence, traversal and mobile landscape smoke tests.

These checks do not establish native CS2 equivalence. Analytic hit volumes,
native action layering, foot contact and skill calibration remain limitations.
