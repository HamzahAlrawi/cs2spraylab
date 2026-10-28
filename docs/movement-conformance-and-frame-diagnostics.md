# Movement Conformance And Frame Diagnostics

Date: 2026-10-16. Roadmap items 4/5, integrated into the live engines.
No game process access, game input automation, or measured CS2 capture was added.

## Movement Evidence

Read `movement-native-recheck.md` and `prefire-presentation-audit.md` first.
The existing build/hash-pinned native arithmetic fixtures remain untouched.
This change does not retune the motor: no new whole-trajectory CS2 discrepancy
was established. Existing native arithmetic is not a whole-engine reference.

`src/range/movement-conformance.ts` defines schema
`spraylab.movement-reference/v1` and motor comparison version
`shared-actor-motor/trajectory-v1`. Seven repeatable scenarios cover run release,
reversal, walk/run, crouch-moving, jump+crouch, slope landing and edge landing.
The slope/platform are explicitly authored diagnostic primitives, not Dust2.
Commands replace the previous command at each timestamp and start at zero.
Command boundaries split integration steps rather than being rounded to ticks.

Samples contain seconds, horizontal x/z, feet elevation, horizontal vx/vz and
speed, verticalSpeed, eye offset above feet, hull height, and observed grounded
state. All linear values use Source units (conversion 0.0254 metres/unit);
velocities use units/second. Axes are the trainer's x/z horizontal, positive-up
vertical convention; yaw is physical trainer yaw in radians. Capture conversion,
origin, input timing, and any manually authored matching geometry must be stated
in provenance. Do not silently fit alignment or tolerances after seeing errors.

The comparator interpolates simulated numeric samples at reference timestamps,
without extrapolation or interpolation of grounded state. It reports maximum
position/vector-speed/vertical-speed/eye/hull errors, curves, stopping time and
horizontal stopping displacement, contact transitions and landing positions.
Release stop is the first observed speed <= the declared stop threshold;
reversal stop interpolates the first velocity projection crossing through zero.
Landing/contact time is the first recorded changed contact state. Choose time
tolerance to include that observation cadence; sparse capture cannot establish
subtick event precision. Missing stops and mismatched contact counts fail rather
than passing through an empty comparison. A landing position is compared in the
scenario's fixed coordinate frame, not by fitting a landing displacement away.

Every imported reference requires kind, source, build, ISO date, method, evidence
SHA-256, precision description, explicit numeric tolerances and their rationale.
Kinds distinguish `synthetic-regression` from `manual-cs2-capture`; neither a hash
nor a user-supplied label independently authenticates a capture. The import CLI
checks that the evidence file hash matches. Original references/evidence cannot
be overwritten by import. Input is bounded to 16 MiB, 32 scenarios, 8,192 samples
per scenario, 256 commands, and 30 seconds. Unknown schemas fail; reports retain
both reference and current motor version so comparisons are not silently relabeled.

```powershell
node tools/movement-conformance.mjs synthetic tmp/movement-synthetic-v1.json
node tools/movement-conformance.mjs import tmp/movement-synthetic-v1.json tmp/movement-imported-v1.json src/range/actor-physics.ts
node tools/movement-conformance.mjs report tmp/movement-imported-v1.json tmp/movement-comparison-v1.json
```

`report` writes JSON plus a speed/feet/eye comparison SVG and exits nonzero on
failure. `synthetic` generates clearly labeled trainer-only output; it NEVER
creates a native measurement. Real references must be prepared from authorized,
manually performed offline observations, with tolerances chosen from their
precision before tuning. There is no automatic CSV field/unit inference.

The seven synthetic scenarios repeat with zero comparison error. Pinned
trainer-only regression witnesses at 1/128 s: run-release stop at 1.3828125 s,
32.2880471499 units after release; reversal zero crossing at 1.1187206767 s,
10.9918506879 units after reversal input. These are NOT measured CS2 values.

## Lower Body API

`duel/body-turn.ts` exports `LowerBodyTurn`, `BodyTurnTimeline` and
`bodyYawDelta`. Transition labels start/stop/reverse last at most .12/.16/.18 s;
turn rates and 30-degree moving / 45-degree stationary torso limits are bounded
presentation heuristics, not extracted native timings. Discontinuous aim changes
can require a safety snap. Air/death/new generations/long gaps reset to aim yaw.
No foot-contact layer is constructed or enabled: `nativePlantVerified` stays false.
Native start/stop clips are not present in the shipped pack. Its planted reversal
clips still fail the existing release criterion and remain disabled. No claim of
native start/stop/reversal graph parity is made.

Live lower-body integration:

```ts
// Once at reset, then only after each fixed tick's movement/aim updates:
bodyTurns.get(actor.id)!.record(actor, simulationTime);

// Read-only at the requested snapshot time; never records render-ahead state:
const bodyYaw = bodyTurns.get(snapshot.id)!.sample(snapshot, poseTime);
model.rotation.y = bodyYaw - Math.PI;
animator.update(snapshot, poseDt, undefined, {...frame, bodyYaw});
```

If `this.time` has advanced before movement, a sensor using the previous actor
snapshot queries `this.time - STEP`. Seed missing history at that previous time,
not under the new tick timestamp. Record the new time only after movement/aim.
Duplicate record timestamps retain the first checkpoint. Queries use the latest
checkpoint not later than the requested time and evaluate a temporary copy;
render-ahead, repeated shots, and out-of-order sensors cannot change history.
There are 256 checkpoints (~2 s at 128 Hz). Queries older than history or for a
different generation fall back to aim yaw. Same-tick changed aim is bounded
without rewriting the checkpoint. This fallback is explicit, not reconstructed
historical movement.

`DuelPresentationFrame.bodyYaw` is opt-in. Locomotion directions use that body
frame. The animator restores the base pose, completes residual world-yaw across
head/arm chains, then applies physical pitch about the aim-right axis. Mounted
weapons follow the corrected hands. Default callers retain the previous path.

`duel/pose-clock.ts` supplies the additional authoritative locomotion clock.
`DuelSimulation.actorPoseTick` records scalar gait/idle/air checkpoints after each
fixed tick, without evaluating a skeleton. `DuelAnimator.recordPose` computes the
native clip rates and `update(..., {poseTime})` samples those checkpoints read-only.
Gestures use recorded action/reload timestamps. Repeated or out-of-order render,
shot and sensor queries cannot advance gait. The engine samples interpolated
presentation time for displayed bodies and the requested simulation time for
shot/sensor capsules. Sensors share one pose per actor at their 32 Hz cadence
after the distance/FOV broadphase; they do not tick skeletons at 128 Hz.
Single-convex-cover rejection uses the full shot-query envelope before native
posing. Radar consumes the same player contacts instead of resampling them.
After sensor/shot queries, visible shared rigs are restored at presentation time
even when the normal visual animation cadence would otherwise skip that frame.

`tests/combat-replay.spec.ts` also loads the actual 19-capsule native rig, samples
a shot pose, queries both future and earlier poses, and verifies the original pose
is unchanged. Death animation remains a separate presentation timeline. This
establishes deterministic sampling, not native animation-graph parity.

`tools/audit-body-turn.mjs` evaluates the actual local native rig/motion/mount
assets, retaining input hashes. Across AK, M4A1-S and USP, eight directions,
standing/crouched motion, four residual yaws and changing pitch, 6,144 frames
passed. Maximum residual aim error: 0.000050 degrees; maximum right-hand grip
matrix delta: 0.000007314; foot displacement introduced by the aim layer: zero.
Duplicate zero-dt head orientation error: 6.67e-8 radians. These are same-phase
numerical contribution checks, not textured mesh clearance, planted feet, live
shot/render integration, or a comparison against the native animation graph.

```powershell
$env:BODY_TURN_REPORT = 'tmp/body-turn-audit.json'
node tools/audit-body-turn.mjs
node tools/audit-prefire-presentation.mjs --plant-disabled --assert
```

## Frame-Time API

Existing `FrameMetrics.sample(rawDtSeconds, cpuMs, adaptive, active, cap)` remains
compatible. Supply RAW elapsed time separately from simulation-clamped dt.
Visible active stalls above 250 ms are included, including stalls longer than
the 10-second rolling window. Do not infer background suspension from duration.
Pause/preview intervals are excluded from tail diagnostics; the first active
interval after a transition is excluded because it straddles states. Idle FPS
and CPU averages remain available for the existing overlay/quality behavior.

Call `metrics.setVisible(!document.hidden)` on visibility edges even if hidden
rAF is fully suspended. `PerformanceMeter` also handles visibility changes and
removes its listener on disposal. First resumed interval is excluded. Hardware
suspension without any visibility/active signal is indistinguishable from a real
foreground stall; hosts must signal suspension explicitly.

The rolling ring contains at most 2,048 intervals / trailing 10 active seconds
(one long stall may exceed 10 s). Sampling allocates no arrays/objects; nearest-
rank percentile sorting uses preallocated scratch storage at the existing ~2 Hz
update, not every frame. `p95Ms`, `p99Ms`, `onePercentLowFps`, `longFrames`
(strictly >50 ms), `framesOver100Ms`, and `framesOverBudget` are available on the
metrics. Budget is 1000/(cap || 60) ms; CPU adaptation remains a separate policy.
1% low is 1000 divided by the mean of the slowest ceil(N*.01) frame times, not
the reciprocal of p99. A small window is not a statistically stable benchmark.

```ts
const performance = metrics.report({quality: settings.quality,
  frameLimit: settings.frameLimit, mode: 'duel', botCount: 5,
  hardware: 'user-entered hardware', browser: 'user-entered browser',
  route: 'named encounter', loading: 'warm', intervalSource: 'raw'});
const summary = metrics.snapshot();
const withIntervals = metrics.report({intervalSource: 'raw'}, true);
```

`report` / `exportReport` return the versioned bounded local JSON object;
`snapshot()` returns its current summary. No upload/download side effect occurs.
Labels are whitelisted and capped at 160 characters; raw samples are opt-in and
detached from the ring. Export recalculates tails synchronously, so a shot/replay
report is current even between overlay updates. The optional FPS meter includes
tails/1%-low/long-frame counts; narrow layouts ellipsize without growing the HUD,
and its title retains full diagnostics. No hardware target or loading budget is
invented. `tools/profile-prefire.mjs` records local headless browser context,
active frame intervals, pose counts, draw calls, asset loading and CPU percentiles.
It supports `CPU_RATE` but explicitly does not treat throttling as old-PC proof.
The integrated map loader has a 32 MiB / 20-second idle ImageBitmap cache,
content-hashed reuse and bounded fetch/decode concurrency. Shader warmup uses
temporary material owners so fast model/mode disposal cannot invalidate Three's
asynchronous program polling. See the implementation report for browser results.

## Validation

Focused tests cover bounded histories, invalid timings, >250 ms stalls, visibility
and pause edges, slowest-tail arithmetic, deterministic timeline queries,
simultaneous physical yaw/pitch and hand aim, synthetic trajectory repeats,
explicit provenance and capture-shape rejection. On this Windows sandbox, set
`TEMP` and `TMP` to `.local-tools/test-tmp` if Vite's default temp rename returns
EPERM. This is a test-process environment override, not a project setting.

Full-suite/build outcomes and any concurrently changing parent-owned failures
are recorded in the completion message; passing synthetic/reference arithmetic
does not certify exact CS2 contact, subtick, hull-transition or air trajectories.
