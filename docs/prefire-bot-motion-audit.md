# Prefire Bot Motion Audit

The 2026-10-19 [active-bot update](prefire-active-bots.md) supersedes this
historical audit's permanent move-out/take-angle policy and four-point sensing.

## Scope

2026-10-10. Browser training AI only. Changes are confined to `bot-controller.ts`,
`bot-behavior.ts`, their tests, `bot-peek-regression.test.ts`, and this audit.
Session, route catalog, configuration, occupancy, map assets, physical movement,
collision, weapon simulation, shot rays, and rendering remain parent-owned.
No game process access, hooks, memory reading, or in-game automation is involved.

## Diagnosis

The previous controller already inherited `walk: false` from `idleCommand()`.
The perceived Shift-walking was not an unconditional walk-key bug. Short lanes,
crouched source stances, endpoint settling, and unconditional recurring swings
made different tactical roles look similar. Move-out bots returned after every
short exposure/burst. Waiting bots could see the player yet still be excluded
from return fire until their peek timer expired. Quick-plan scoring also favored
long excursions, and an authored endpoint could bypass the actual cover-change
requirement.

## Current Decisions

- Unspecified sourced angles remain holds. Existing catalog entries remain keyed
  by source identity. `moving` or an authored `peek` requests planning, not a
  guaranteed motion plan; unsupported requests become holds.
- Move-out defaults to taking an angle: run to the validated fighting endpoint,
  counterstrafe, and hold it. It does not repeat a timer-driven out/back loop.
  Reloading can still require a physical return to its home endpoint.
- Periodic checks run to a validated endpoint, settle for a short exposure or
  burst, then recover behind cover. Idle intervals are seeded 1.8-4.5 seconds,
  with some 5-8.5-second holds. Recent observed contact uses 1.2-2.8 seconds.
  These are local training parameters, not measured competitive player timings.
- A waiting bot that sees the player holds and fights there. It does not abandon
  a genuine firing angle just because a navigation timer expires. A reversed
  plan starting at an exposed source anchor also fights there if it already sees
  the player, rather than immediately walking away. With combat disabled, it
  still physically withdraws before checking again.
- Quick checks prefer shorter qualifying lanes; wide/crouch commitments prefer
  larger qualifying lanes. Sightline usefulness has priority over distance.
- A periodic peek needs a hidden upper-body endpoint and a usable firing-eye
  sightline at the other endpoint for the same route view. Reversed plans use
  the source anchor as the fighting point. An authored endpoint is not exempt.
- Every command explicitly leaves `walk` false. Travel and braking produce
  normalized world-space wishes transformed through the post-turn yaw. Brake
  distance and opposite-key release use the existing `groundVelocity` motor,
  including optional weapon speed and damage velocity modifier. Position and
  velocity are never assigned by the controller.

## Sensory And Integration Contract

Existing exports, call signatures, behavior kinds, and snapshot fields remain.
`PrefireBotPlan.intent` optionally selects `check-recover` or `take-angle`;
`watchPoint` is a copied, offline route sightline for pre-aiming. Neither field
contains hidden/live player coordinates. Legacy plans without these fields keep
kind-derived behavior and source-facing fallback.

`prefireBotKey()` accepts `source.datasetId` or the generic schema's
`source.dataset`. Missing or `openprefire` datasets retain `profile/index`.
Other datasets use `dataset:profile/index`, preventing catalog/seed collisions.
New datasets do not inherit old OpenPrefire motion overrides accidentally.

Live aim uses only a visible, yaw-aware player head or the immutable last-seen
point for 1.2 seconds. Hidden pose/position changes do not update memory. Idle
sensing remains roughly 11 Hz; firing opportunities and post-movement guards
recheck native LOS. Continuous-sight reaction time resets on occlusion. The
configured reaction delay is unchanged; there is no added peek/settling timer
before shooting. Actual motor speed, grounded state, physical stance transition,
aim alignment, and the existing weapon recovery/cooldown still gate shots.
Waiting holds use normal short bursts, not queued pressed shots. Sight loss,
reload, death, and disabled return fire retain their shot-safety checks.

## Evidence

[OpenPrefirePrac at the pinned revision](https://github.com/lengran/OpenPrefirePrac/tree/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26)
is the provenance for static position, orientation, and stance samples. Its
plugin behavior is not imported or installed by this work.

[Dignitas: The Ultimate Guide to Peeking](https://dignitas.gg/articles/the-ultimate-guide-to-peeking-a-cs-go-guide)
distinguishes information checks from wide and crouch peeks and cautions against
overusing repeated jiggles.
[Dignitas: Peeking in CS2](https://dignitas.gg/articles/peeking-in-cs2-why-you-keep-losing-duels)
discusses intentional info/commit peeks, pre-aim, and opposite-key braking before
accurate fire. These inform local policy; they do not validate the numerical
cadence or prove a faithful reproduction of Valve's bot AI.

## Verification

- Focused command: `npm test -- --run src/range/prefire/bot-controller.test.ts src/range/prefire/bot-behavior.test.ts src/range/prefire/bot-peek-regression.test.ts`.
  Latest completed run: 115/115 tests passed, including installed native Dust 2.
  Native fixtures explicitly request `population: 'all'`; cache tests separately
  exercise random occupancy. Tests no longer require exactly eight routes or
  forty active angles.
- Tests cover running rifle speed, counterstrafing in world space while turning,
  tagged 180/225/250-unit weapon speeds without reversal oscillation, stable
  holds, contact at waiting/source-anchor holds, stance-gated shots, physical
  returns, bounded bursts, reaction/occlusion resets, immutable sensory memory,
  dataset keys, coherent hiding/firing endpoints, and native support/spacing.
  A 12-second native Long doors combat regression moves the player through
  normal commands and checks emitted shots from both peeking and holding bots
  for grounded/stopped state, full reaction time, and actual native head LOS.
- Repository-wide `npm test -- --run` was executed while the parent expanded the
  catalog/default occupancy; early all-roster fixture assumptions were corrected
  only in the owned tests. Latest combined `npm run check`: 3164 passed / 9 failed
  in five parent-owned suites; none of the owned bot tests failed. Remaining
  failures in that concurrent snapshot were shared air-crouch acceleration,
  tagged walk/crouch caps, an old 8-route assertion, a session motion fixture,
  and five route movement/cover checks. The combined check stopped before its
  build stage; this is not a claim that the full tree is green.
- Route failures in that snapshot: B doors / close corners stalled toward
  `[-564,2090,-118]`; Mid doors / CT cross exposed its 64-unit start margin;
  Lower / stairs clearing had three failures toward `[-395,1580,-126]` (walking,
  full-speed steering, and route-to-head reachability). Parent owns these routes.
- `npm run build` passed after parent schema integration (production chunk-size
  warnings only). Earlier schema/prop errors were resolved by the parent.
- The parent updated `tools/audit-prefire-bots.mjs` for dynamic catalog size,
  source identities, route-point pre-aim, visible waiting holds and committed
  angle takes. An all-course native planning run covers 24 courses / 120 slots:
  99 holds, four crouch-hide plans, ten information-peek plans and seven angle
  takes. No planning, source-placement, coverage or cache failures were found.
- A 12-second, seed-7 native combat run through Long doors, Long to A and B
  tunnels passes physical support, stopped fire, LOS, reaction and hidden-memory
  checks with 16, 60 and 27 shots respectively. No Shift-walk commands occur.
  These are bounded scenario checks, not complete 180-second course traversals.
  Some crouched silhouettes become visible from later route views; genuine hide
  views are verified separately rather than claiming universal invisibility.
- A subsequent all-course seed-7 run simulates 60 seconds on each of 24 courses
  (184,320 total 128-Hz ticks) with no bot/control failures. Passive audit actors
  do not kill blockers: B door/default holders can prevent its waypoint walker
  from completing, and several long walking passes exceed the 60-second budget.
  Those diagnostics are retained; this is not a claim that every passive
  all-bots-alive route traversal completes. Independent native movement and
  physical route-clearing tests verify the intended playable approaches.
- Final parent integration: `npm run check` passes 129 files / 3,181 tests plus
  the production build, including all 153 native route/source validation tests.
  Earlier concurrent failures listed above were corrected, not hidden or skipped.

## Limits

This is native-map-validated movement through the trainer's shared motor, not
Valve's native bot decision system. Bots use one reversible short lane per plan,
not global navigation, utilities, sound inference, team trades, or new live
repositioning endpoints. Checks remain repeatable with a known seed; variable
timing does not make them human or remove all predictability. Source-crouched
holders preserve their stance and therefore correctly move slower than running
standing holders. There are no player-position-based lane changes through cover.
Dynamic pawn obstruction still leads to physical backoff/retry, never relocation.
Native tests validate support, hulls, and combat logic; this work does not claim
browser animation quality, full-round tactical realism, or exact CS2 accuracy.
