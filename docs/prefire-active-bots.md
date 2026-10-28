# Active Prefire Bots

2026-10-19. Browser-only training behavior. This supersedes the permanent
move-out/take-angle policy in the earlier motion and peek-quality audits.

## Source Diagnosis

- `bot-behavior.ts:createPrefireBotPlan` assigned every `move-out` the
  `take-angle` intent. `bot-controller.ts` exempted that intent from both the
  exposure deadline and post-burst recovery. Reversed plans started `exposed`,
  so some non-static bots never moved at all. This was intentional old policy,
  not a walk-key, native-collision, or render interpolation bug.
- Ordinary excursions required lateralness >= 0.7 and considered no forward
  direction. Only trade planning could request a forward exit. A permanently
  exposed move-out plus that restriction could not produce controlled pressure.
- Hearing changed pre-aim but did not bring an appropriate planned check
  forward. Prefire also maintained its own four-point visibility proxy despite
  Duel exposing bounded, stance/yaw-aware silhouette samples.

## Policy

Generated peeks and move-outs now use `check-recover`. Wide move-outs keep their
longer commitment/exposure; they counterstrafe, fight briefly, physically recover,
wait a seeded interval and check again. Reversed plans preserve the original
source position, then retreat physically before repeating. A currently visible
opponent at the initial fighting point is engaged before recovery. Explicit
legacy `intent: 'take-angle'` is still supported, but the planner no longer
generates it. No constant side-to-side jitter or new global movement timer is
introduced.

Active idle checks wait 0.7-1.8 seconds and recent-contact checks 0.4-0.95
seconds. Static holds are unchanged. Terrain-certified fine route views can
recover a narrow pre-aim sightline missed by coarse samples; they are cached
at course creation, not recomputed by the motor or perception ticks.

Existing source-keyed `hold` overrides remain holds. Unlisted angles explicitly
marked `moving` request a wide recurring move-out; `peek` without `moving`
requests a periodic check. Both must pass all geometry gates. Unhinted local
Ninja/pit/crouched samples remain holds. Non-OpenPrefire explicit IDs, including
`spraylab:dust2/<slug>` / `spraylab-authored`, are stable behavior/seed identities;
they do not inherit OpenPrefire overrides by profile/index or depend on pool size.
Static mode ignores motion hints. `returnFire` still gates damage, not sensing.

A fresh, recognized local sound/sight report can shorten a pending planned
check to 0.15-0.35 seconds. Distant/unrecognized reports cannot. Recognition and
continuous-sight fire delay are unchanged. Reports never author new endpoints.

## Controlled Pressure

Eligible move-outs can have one optional continuation from their fighting
endpoint. Planning considers 32/56/80-unit advances toward the known route
opening, including oblique directions up to 45 degrees. It requires:

- Bidirectional native swept hull clearance, supported interior samples every
  eight units, <= 3-unit floor variation, and active-roster spacing.
- The same opening visible throughout the continuation in the fighting stance.
- Retained standing/crouched spawn concealment and no newly backward-facing
  exposure to earlier relevant approach views.

Runtime pressure requires a sighting recognized for the configured reaction
delay, lost for at least 0.15 seconds and no older than 1.5 seconds. The immutable
report must lie ahead of the certified corridor, with at least 48 units of
remaining separation and bounded range/height/direction. A visible opponent is
fought instead of chased. Sound alone never authorizes a push. A 10-14-second
cooldown prevents repeated blind commitments. Trades retain priority; a pending
trade waits for an active pressure recovery rather than taking an invalid chord.

The bot runs to the endpoint or counterstrafes on reacquired contact, uses the
ordinary bounded exposure, then returns via the fighting endpoint before going
home. Stalls retain bounded physical recovery attempts. No teleport, direct
position/velocity write, hidden-position destination, dynamic pathfinding, stair
chase, or unsupported full-map navigation is added. Geometry can reject every
pressure candidate for a particular hold or fixed lineup; that remains a peek
or legitimate hold, not an invented forward path.

## Shared Contracts

The behavior module remains separate from native placement, controls and
reload state. The combined follow-up also adds route coverage, wheel bindings
and native reload timing; see `prefire-requested-coverage-v7.md` for integration.

Perception reuses Duel's `actorVisibilitySamples`; only an actually visible
sample enters memory/aim. Hidden acquisition keeps four representative
head/chest rays per perception. Once acquired, bounded shared silhouette-edge
samples retain legitimate partial contact. The same native rays guard contact
after movement and at shot opportunities. Hidden pose/position changes cannot
update the copied report. Normal sensing remains roughly 11 Hz; there is no
per-frame planning. Isolated limb-only first contact can still be missed; this
is not Duel's complete sensor/attention/navigation system.

Movement/braking reuse `groundVelocity` and the existing physical actor motor.
Aim reuses `aimStep`. Shots retain grounded, <0.12 m/s speed, physical stance,
alignment, recoil, reaction, cooldown and actual weapon-state gates. Existing
trade return and optional return-fire behavior are regression-tested.

## Verification

Focused command:

```text
npm test -- --run src/range/prefire/bot-active-regression.test.ts src/range/prefire/bot-behavior.test.ts src/range/prefire/bot-controller.test.ts src/range/prefire/bot-peek-regression.test.ts src/range/prefire/bot-trading.test.ts src/range/prefire/native-trading.test.ts --maxWorkers=1
```

New policy fixtures cover recurring reversed move-outs, fresh local cue timing,
pressure evidence, visible-contact stopping, pressure cooldown/recovery, absent
corridors and divergent hidden coordinates. Native regressions cover repeated
24-second B-tunnel, lower-tunnel and B-door checks, fixed holders, grounded
non-teleporting travel, hidden-spawn shot safety, candidate-pool corridor
certification and shared-motor pressure-lane arrival/return. Native lane motor
tests isolate travel from policy; they do not claim every pressure opportunity
has been reached by a human-like full-route player. Existing approached native
combat and native trade suites check actual LOS/reaction/stopped shots.

Production build passed (existing chunk-size warnings). The six-suite focused
run passed 135/135 before the full-suite compatibility follow-up. The full run
identified two regressions: generic source-less IDs changing legacy keys, and
hidden acquisition exceeding the four-ray budget. Both were fixed locally and
their two targeted integration tests passed. A final focused rerun follows.
That was an intermediate behavior-only run. Final combined checks supersede it;
the route/map-data regeneration is documented in the combined audit. No push or
deployment was requested for this follow-up.

Native checks require the
locally imported Dust 2 assets. These are conservative training heuristics, not
Valve bot AI, measured competitive timings or exact live-CS2 equivalence.
