# Prefire Encounter Quality

## Latest Result

The final integration snapshot is
`tmp/prefire-encounters-integration-freeze.json`: **20 stable native runs,
zero bot-quality flags, three unchanged player-walker stall flags**. The Long
warning documented below is historical and verified resolved in the final
rerun, without changing any audit thresholds. See the final section for evidence.

## Purpose

`tools/audit-prefire-encounters.mjs` measures actual Prefire behavior independently
of the controller's desired aim. It uses the installed native Dust 2 collision,
`PrefireSimulation`, actual fixed/weighted selections (at most five bots), and
ordinary actor commands. No browser, route teleporting, substituted clear-LOS
fixture, controller monkeypatch, or production per-frame diagnostic work is used.

The player walks the authored approach, brakes and dwells at each waypoint.
Native-supported local detours are attempted around live actor hulls. A survival
fixture sets initial player health to 1e9: bot shots, damage, tagging, punch,
recoil, reloads and the full actor motor still run normally. The player does not
shoot. Combat results therefore represent a passive encounter audit, not duel
difficulty, kill times or a human clear of the route.

Public analytic head/chest/shoulder hit geometry and native blocker rays establish
visibility. Controller FOV, visibility, watch point and contact memory do not
define that truth. The watch point is used only for the separately labelled
planned-lane alignment metric. Browser animated hitboxes/rendering are outside
this headless audit; absence of a warning does not establish visual fidelity.

## Reproduce

From the repository root:

```powershell
node --test tools/tests/prefire-encounters.test.mjs
node tools/audit-prefire-encounters.mjs --routes=long-doors,short-a,b-tunnels --population=all,random --seconds=60 --report=tmp/prefire-encounters-after.json
node tools/audit-prefire-encounters.mjs --routes=lower-tunnels,mid-doors --population=all --seconds=60 --report=tmp/prefire-encounters-lower-mid.json
```

Default runs use seed 7, both fixed and weighted rosters, Return fire OFF and ON,
750 ms reaction time and 3-second waypoint dwells. `--seeds=7,42`,
`--return-fire=off`, `--reaction-ms=300`, `--dwell=5` and `--seconds=90` narrow
or extend a run. `--enforce` gives a nonzero exit code for quality flags.
Without it, reports are diagnostic; an unstable source snapshot is always an
error. Vite runs headlessly with HMR and WebSockets disabled.

Reports contain native build/checksum, audit/source hashes, stable-snapshot
status, selected roster IDs, physical waypoint progress/detours, planning cost
and native query counts. Source files changing during import or execution make
the snapshot explicitly unstable. Do not compare edited runtime runs by their
filenames alone: compare their recorded hashes.

## Measurements And Boundaries

- Visible-contact yaw/pitch errors, worst source IDs/ticks/positions, first aim
  settling and first shots are measured against independently visible geometry.
- Long wrong/opposite gaze is retained even if the controller reports no sight.
  An opponent behind an unaware bot is not an omniscient response obligation;
  contacts record whether they entered a conservative 106-degree horizontal view.
  `noticed-contact-aim-drift` specifically identifies drift after that opportunity.
- Planned radial fraction above 0.65 is flagged. Actual visible velocity radial
  fraction is reported separately, especially during outbound travel. Lateral
  alignment is 1 for a pure side strafe and 0 for forward/back movement.
- Physical distance, maximum offset from the home endpoint, movement legs,
  exposure changes, completed swings/returns, grounded support, speed and
  repeated velocity reversals are recorded. A reversed take-angle actor starts
  away from home: maximum home offset is not proof that it moved. Use accumulated
  physical distance and phase history instead.
- Holds are not required to roam. Crouch-hide is measured as posture/exposure,
  not a horizontal swing. A committed take-angle need not retreat during contact.
- Settled aim threshold is 5 degrees; opposite gaze is above 90 degrees after
  reaction time plus 250 ms. Braking/endpoint flags use physical velocity, not
  the controller's desired endpoint as a correctness oracle. No thresholds were
  lowered to make the runtime pass.
- Visibility probes run at 16 Hz offline. A no-response flag is a candidate for
  review, not proof of a continuously open shot: short intervening occlusions can
  reset the actual reaction timer between probes. Reports include that timer,
  ammunition, reload/equip state, stance and issued commands for diagnosis.
  Shoulder-only sightings are distinguished by the reported hitgroup/point;
  a perception implementation probing fewer body points may legitimately differ.
- Route stalls/incomplete approaches remain visible. Under passive Return fire,
  repeated tagging can impede the diagnostic walker. These are not automatically
  attributed to bot movement. Unencountered positions have an explicit no-quality-
  claim observation rather than silently passing.

## Native Findings, 2026-10-13

All three completed snapshots used native build 2000927, collision SHA-256:
`395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396`.

The pre-edit baseline was loaded before parent runtime edits and finished with
`snapshotStable: true`. It covers six 50-second fixed-roster runs:
`tmp/prefire-encounters-baseline.json`. Controller hash:
`cfd38870ed5acf9125132c94df7d1075aad32d0abe7342906ee5b1f414f98438`.
Planner hash:
`acda877935c5822766e18d5c868032de46b1418c95192afb82aaeab15724b27e`.

| Baseline Source | Case | Independent Evidence |
| --- | --- | --- |
| `a_short/10` | Short, Return fire OFF | 30.25 s opposite gaze; settled yaw p95 179.16 degrees |
| `a_short/13` | Short, OFF | 20.94 s opposite gaze; settled yaw p95 101.08 degrees |
| `b_tunnel/11` | B, OFF | 20.63 s opposite gaze; settled yaw p95 150.47 degrees |
| `b_tunnel/9` | B, OFF | 20.69 s opposite gaze despite actual periodic side peeks |
| `a_long/11` | Long, OFF | 16.69 s opposite gaze; yaw reaches 175.23 degrees |
| `a_long/2` | Long, ON | Tick 1072 / 8.375 s: visible player, stopped bot, roughly 135-degree error and no shot |

The first after-edit run covers twelve 60-second fixed/weighted runs of Long,
Short and B. All six OFF runs physically completed their approaches and all 60
actor-run slots were encountered. No prolonged opposite-facing flag remains in
those runs. Representative fixed silent yaw p95 changed from 175.23 to 1.69
degrees (`a_long/11`), 179.16 to 1.47 (`a_short/10`), and 150.47 to 3.20
(`b_tunnel/11`). This is measured improvement, not a claim of complete human AI.

After-edit snapshots (`tmp/prefire-encounters-after.json` and
`tmp/prefire-encounters-lower-mid.json`) both remained stable. Controller hash:
`87321d658efa4197fdb9fd1c51ecaed963ec738f8be60331944d0c2841e99907`.
Planner hash:
`043df980fb5759f1a6ac7741dc80c246845cec59fa43b47217549eadd52258d0`.
Baseline used the earlier audit revision; common yaw/time and physical-movement
metrics remain comparable, but it lacks later reaction/ammo annotations.

### Physical Regression Pins

| Source | Actual 60-second Fixed Silent Run | Planned Lateral Alignment |
| --- | --- | --- |
| `b_tunnel/9` | 5 swings, 6 returns; approximately 32-unit excursion | 0.9990 |
| `ct_push_lower/16` | 7 swings, 7 returns; 447.95 units total physical travel | 0.9822 |
| `a_long/33` | 6 swings, 7 returns; 736.32 units total physical travel | 0.9925 |

Use one of these actual native information-peek cases to pin physical
outbound/braking/exposure/return behavior. Initial retreat can account for one
more return than outbound swing. All these cases kept native support and did
not trigger nonphysical-displacement, repeated-reversal or settled-jitter flags.

`a_long/2` is now a reversed, already-taken take-angle plan: all silent ticks stay
`exposed`, physical distance is zero, and home is 112 units away. Requiring it to
move in that situation is an incorrect regression expectation. With Return fire
ON it makes three reload-driven retreats/returns in 60 seconds; it is not a
stuck movement controller.

`ct_push_lower/8` now resolves to a hold in the actual fixed native roster. The
current audit does not certify whether its old lane was axial or whether a valid
lane was lost. Do not declare its old regression obsolete solely because the
new planner rejects it; retain a separate planner/fallback review. Pin a proven
current information lane for the movement regression in the meantime.

### Remaining Cases For Parent Runtime Review

- `mid_to_b/27`, Mid: tick 3960 / 30.9375 s OFF shows 155.85-degree error,
  and tick 4936 / 38.5625 s ON shows 165.29 degrees. Planned lane is lateral
  (0.9712), but the chosen watch direction misses the physically incoming player.
  Subsequent aim-never-settled/no-response flags reproduce the same contact.
- `ct_push_lower/7`, Lower, ON: tick 5848 / 45.6875 s sees a native-clear
  shoulder/chest point while controller sight is false, despite a stopped loaded
  actor. At tick 6064 / 47.375 s, the actor turns 91.38 degrees away. Verify
  body-point perception and recent-threat expiry, not only head-center LOS.
- `a_short/10`, Short, ON: tick 2496 / 19.5 s is a sampled no-response flag,
  but the actual reaction timer restarted at 19.0 s. Its 750 ms delay has not
  expired; this frame alone is not a confirmed firing bug.
- Most fixed ON passive runs did not complete within 60 s; some stalled while
  repeatedly tagged. The weighted Short ON run completed despite a temporary
  stall flag. Do not convert these into a claim that every approach was cleared.

### Planning Cost

Cold fixed/weighted Long/Short/B construction: 66.6-205.7 ms in this Node process.
Lower: 594.9 ms / 54,028 rays. Mid: 697.2 ms / 73,217 rays. Repeated same-roster
construction issued **zero planning rays/sweeps** (only actor placement queries).
The cold Lower/Mid work is material and warrants parent optimization. These are
local construction timings, not browser frame time, GPU cost or old-CPU FPS.

## Initial Validation And Scope

Focused diagnostic helper tests: **5 passed**. Actual native work was six
baseline, twelve Long/Short/B after-edit and four Lower/Mid after-edit runs
(22 runs, three stable snapshots).
No full npm suite, production build, browser run, existing audit/golden change,
runtime edit, source-coordinate relocation or assertion relaxation was performed
in this disjoint sidecar. Parent owns runtime fixes and final integrated checks.

## Pre-Memory Frozen-Snapshot Follow-Up

After the parent's first-hittable-body pre-aim, early rear-exposure rejection,
bounded shoulder probes and body-visibility cache changes, the complete matrix
was rerun on the same native build/checksum. Final artifact:
`tmp/prefire-encounters-final-stable.json`.

```powershell
node tools/audit-prefire-encounters.mjs --routes=long-doors,short-a,b-tunnels,mid-doors,lower-tunnels --population=all,random --seeds=7 --seconds=60 --report=tmp/prefire-encounters-final-stable.json
```

It records **20 runs**, 100 actor/run slots, and **99 encountered slots**.
All 10 silent approaches physically completed, including weighted seed-7
variants. Only one of the 10 passive firing-enabled approaches completed inside
60 seconds; nine incomplete passes are not represented as clear-route successes.
Weighted Lower ON did not encounter `ct_push_lower/19` before the run ended.

All pre-import, post-import and final tracked source hashes match:
`snapshotStable: true`. The preceding `tmp/prefire-encounters-final.json` has
`snapshotStable: false` because planner optimization overlapped its execution;
do not use it as the final artifact. The tool now records all three hash sets
explicitly and captures its own hash at audit start, not after execution.

Final controller SHA-256:
`ded2b28b4f0171b884dfeb9ff54f086cace562f5c8894af47f4d5c4d31b9c010`.
Final planner SHA-256:
`960e9f472550cedf1dc9760c7f863658df052b9c80657adbee3d961198441df4`.
Final session SHA-256:
`5970e4f644c633d0d274f948e198284bdce93c97946c796aeca71fa01c34ab7a`.

### Quality Figures

These are independent physical-geometry measurements, not browser animation
scores or proof of human-equivalent bot behavior. Settled-contact yaw p95:

| Source / Fixed Approach | Silent | Return Fire ON | Outcome |
| --- | --- | --- | --- |
| `mid_to_b/27` / Mid | 3.26 degrees | 1.08 degrees | Prior 155-172-degree facing defect no longer reproduced |
| `ct_push_lower/7` / Lower | 3.10 degrees | 1.35 degrees | Prior shoulder-contact/no-response flags no longer reproduced |
| `b_tunnel/9` / B | 1.21 degrees | 0.66 degrees | Valid periodic information peek retained |
| `a_long/33` / Mid | 2.12 degrees | 2.19 degrees | Valid periodic information peek retained |
| `ct_push_lower/16` / Lower | 1.92 degrees | 0.65 degrees | Valid periodic information peek retained |

Of the 100 actor/run slots, 96 have post-grace yaw samples; all of their p95
values are below 5 degrees. This does **not** erase worst-tail flags: p95 can
hide brief poor contacts. No nonphysical displacement, native support loss,
settled-endpoint jitter, repeated velocity reversal or forward/back planned-peek
flag occurred. Silent B's `b_tunnel/9` still performs five swings/six returns,
with planned lateral alignment 0.9990. Lower's `ct_push_lower/16` performs seven
swings/seven returns at 0.9822. No holder was forced to roam to achieve these
figures.

### Historical Long Warning Before Area Memory

The report retains **nine flags**: six Long bot-quality candidates (three flags
for the same episode in each roster) and three walker-stall flags. There are
no bot-quality flags on the other four approaches.

`a_long/2` now resolves to a **hold**, not the earlier reversed take-angle plan.
It has zero physical travel in both modes. Fixed ON tick 5720 / 44.6875 s shows
110.79-degree yaw error; weighted ON tick 5632 / 44.0 s shows 110.68 degrees.
Each roster has 0.75 seconds of post-grace opposite-facing geometry. This is a
rear-side reappearance outside the controller's 1.9-radian perception half-angle,
not a recognized target that the bot declines to shoot.

For the fixed episode, independent body visibility starts at 43.6875 s, the
controller's sight timer starts at 45.3046875 s, conservative front-view contact
begins at 45.5625 s, aim settles at 45.75 s and the first shot is at 46.0625 s.
The last interval is about **758 ms after recognized sight**, consistent with
750 ms configured reaction. Treat the earlier quality flag as a watch-direction/
expectation coverage candidate, not proof of broken fire timing or a requirement
to track an unseen player through cover. `noticed-contact-aim-drift` did not fire.

Remaining walker stalls are fixed Short tick 4400, weighted Short tick 5351
(this pass subsequently completes), and fixed B tick 7232. They stay separate
from bot movement/facing findings.

### Timing And Validation Limits

Final cold fixed-roster construction took roughly 234 ms Long, 214 ms Short,
299 ms B, 525 ms Mid and 399 ms Lower in this local Node run. Cached same-roster
construction again issued zero planning rays/sweeps. CPU contention and the
different source revision prevent attributing timing differences solely to the
cache optimization. No browser FPS, GPU or old-machine performance claim is made.

Focused helper tests were rerun: **5 passed**. Including earlier work there are
42 native runs in four stable snapshots, plus the discarded 20-run unstable
snapshot. No full suite/build/browser or runtime edits were performed by this
sidecar. No assertion thresholds were weakened.

## Final Two-Tier-Memory Verification

The parent identified the actual Long failure: precise contact ended around
36.9 seconds, its 3.5-second memory expired around 40.4 seconds, and the holder
reverted to the original entrance before the player reappeared at 43.7 seconds.
The fix retains precise contact for 3.5 seconds and a coarse known-approach area
for 12 seconds. That area is the nearest static validated route view to the
last observed contact (or the old contact quantized to 0.5 m without route views).
Code inspection confirms it updates only after visible-point perception succeeds,
not from hidden live player movement; it still expires. This is not a permanent
exact-position tracker.

The identical five-approach, fixed/weighted, seed-7, Return fire OFF/ON matrix
was rerun for 60 seconds per case. The artifact is:
`tmp/prefire-encounters-memory-final-stable.json`.

```powershell
node tools/audit-prefire-encounters.mjs --routes=long-doors,short-a,b-tunnels,mid-doors,lower-tunnels --population=all,random --seeds=7 --seconds=60 --report=tmp/prefire-encounters-memory-final-stable.json
```

All recorded pre-import, post-import and final hashes match:
**`snapshotStable: true`**. Final controller SHA-256:
`a5d740e97c6c2f877e60835c0856d4725bcddd10d21791cf2756fa75fc9c72e6`.
Final planner SHA-256:
`fbdd9ad5063df5e9190752fb3a5daa4a3562415d54277d7b8a8b1c91ea28d5d7`.
Session remains:
`5970e4f644c633d0d274f948e198284bdce93c97946c796aeca71fa01c34ab7a`.
Native collision build/checksum are unchanged.

### Long Resolved, Not Waived

| `a_long/2`, Return Fire ON | Before Area Memory | Final Fixed | Final Weighted |
| --- | --- | --- | --- |
| Post-grace opposite-facing time | 0.75 s per roster | 0 s | 0 s |
| Post-grace yaw above 5 degrees | 1.0625 s fixed / 1.125 s weighted | 0 s | 0 s |
| Settled-contact yaw p95 | 1.10 degrees fixed / 1.15 degrees weighted | 0.74 degrees | 0.74 degrees |
| Bot-quality flags | 3 per roster | 0 | 0 |

For the fixed contact, independently sampled visibility still starts at
**43.6875 s**, but the final bot is already watching that approach. It settles
at **43.75 s**, within one 62.5 ms diagnostic sample, and fires at
**44.4296875 s**, versus the previous **46.0625 s**. Sample-based first-shot
latency is about 742 ms; the diagnostic samples visibility at 16 Hz, so this is
not evidence that the configured 750 ms continuous-sight timer was shortened.
The weighted contact starts at **43 s**, settles at **43.0625 s**, and first
fires at **43.7734375 s**. Native movement, visibility truth and thresholds were
unchanged; no exception for this source ID was added to the audit.

### Final Coverage And Limits

- **20 runs, 100 actor/run slots, 99 encountered slots.** Weighted Lower ON's
  `ct_push_lower/19` remains unencountered; no quality claim is made for it.
- All **10 silent approaches completed**. One passive ON approach completed
  within 60 seconds; the other nine are still incomplete, not certified clears.
- **Zero bot-quality flags** across all five approaches and both roster modes.
  The 96 slots with post-grace samples have yaw p95 below 5 degrees; highest is
  4.25 degrees. Short transient tracking error still exists and is reported.
- No nonphysical displacement, support loss, settled-endpoint jitter, repeated
  velocity reversal or axial planned-peek flag occurred. Valid periodic peeks
  remain; holds are not forced to roam.
- **Three unchanged walker-stall flags** remain: fixed Short tick 4400,
  weighted Short tick 5351 (subsequently completes), fixed B tick 7232. These
  are not waived or converted to bot-quality successes.

Focused helper tests: **5 passed**. The sidecar changed only its owned diagnostic
tool/test/documentation, not production runtime or thresholds. This final report
is physical behavior evidence, not complete map coverage, browser animation QA,
old-CPU performance validation or proof of human-equivalent behavior. Parent owns
the separate browser and full-suite validation.

## Final Integration Re-Audit

The final planner revision permits purposeful axial exits only for trade plans,
and exempts those fresh-threat trades from the unrelated original-approach
rear-exposure veto. Normal information-peek constraints and native cover, hull
and support requirements remain. This encounter audit keeps
`tradeEnabled: false`; it does not certify trade-ON behavior, which needs the
separate native trade regressions.

After these changes the complete 20-case matrix was freshly loaded and rerun:

```powershell
node tools/audit-prefire-encounters.mjs --routes=long-doors,short-a,b-tunnels,mid-doors,lower-tunnels --population=all,random --seeds=7 --seconds=60 --report=tmp/prefire-encounters-integration-freeze.json
```

Final artifact: **`tmp/prefire-encounters-integration-freeze.json`**.
`snapshotStable: true`, with no changed tracked source hashes across startup,
import and completion. Controller and session hashes match the two-tier-memory
snapshot above. Final planner SHA-256:
`ab92027c1e32ab6d18b47f9f144dcf5fbcae5923f982c80c15affc4632944a1b`.

A structural deep-equality assertion compared all 20 run records, quality
limits, flags and observations against the stable memory snapshot. Only the
per-run `planningMs` and `wallMs` fields were excluded; physical coordinates,
contacts, velocities, native query counts, shots, visibility/gaze metrics,
phase histories, movement/return evidence and every warning were retained.
**The comparison passed.** SHA-256 of that normalized encounter payload:
`5efda5b775c76896a7a464e4ee78b34cafdacff5f18fb56e53db97784feb696c`.

All final quality figures and coverage limits in the two-tier-memory section
therefore remain verified against the final integration revision: zero
bot-quality flags, the same three walker stalls, 99/100 encountered placements,
all 10 silent approaches completed, and the Long case resolved rather than
waived. No flags or thresholds were removed. Local timing variation is not a
performance result.

`tmp/prefire-encounters-integration-final-stable.json` was the preceding run
that overlapped the last planner edit. Despite its filename, it explicitly
records `snapshotStable: false` and must not be used as the final artifact.

## Posture And Render Integration Snapshot

The final repeat of the same 20-case matrix is
`tmp/prefire-encounters-posture-final-stable.json`. All 16 tracked source hashes
match the working files, and `snapshotStable` is true. Controller SHA-256:
`d9f68d51f1eec9b0a0297b370996b54472278edfd7aaf1943618cd680fcc5443`.
Planner and session retain the hashes above. No bot-quality flags were added;
the same three passive walker stalls and incomplete firing-enabled approaches
remain recorded, not waived.

This matrix still has trades disabled. Separate native trade and controller
regressions cover the active trade posture, including preserving a validated
crouched firing hull when a crouch-hide defender trades. The browser encounter
test covers the final shadow-only bake: native PVS visibility is restored before
the color pass, and Low/Performance adds no shadow render. Neither the matrix nor
these scoped tests certify every possible roster, seed, animation or old CPU.
