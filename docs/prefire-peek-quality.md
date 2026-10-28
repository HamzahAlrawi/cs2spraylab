# Prefire Peek Quality

The 2026-10-19 [active-bot update](prefire-active-bots.md) supersedes the
permanent take-angle behavior described below. Generated move-outs now recover
and re-peek; explicit legacy take-angle plans remain supported.

## Scope

2026-10-11. Browser training behavior only. Changes are confined to
`src/range/prefire/bot-behavior.ts`, `bot-controller.ts`, their two test files,
`bot-peek-regression.test.ts`, and this document. Routes, configuration, session,
schema, occupancy, collision, shared movement, weapons, and map assets are not
modified. No game hooks, memory access, or in-game automation are involved.

## Root Causes And Fixes

1. Move-outs could qualify on an open firing sightline without a cover change.
   Both moving roles now require a hidden upper-body home and a usable fighting
   sightline for the same authored route view. Unsupported plans become holds,
   including authored peek requests. Catalog holders stay holders regardless of
   generic movement flags. A move-out already at its source fighting endpoint
   holds that angle; it does not retreat just to initialize an information loop.
2. Route-view interpolation tested isolated fitting positions, not traversal
   between them. It could invent a pre-aim point across a wall or at another
   floor. Intermediate views now come from grounded, eight-unit steps through
   the existing `moveOnTerrain` helper. The entire chord must be traversable and
   end on the authored floor before any intermediate view is admitted. Authored
   waypoints remain intact; invalid authored placement still throws, rather
   than silently dropping or moving it.
3. Fighting visibility used source eye height even for crouch-at-contact peeks.
   Planning now checks the actual fighting stance. Crouched sources previously
   stayed crouched throughout travel despite available standing clearance.
   Optional plan-local `travelCrouched` permits standing travel only after the
   standing hull and spawn concealment are validated. Fighting/source stance is
   restored at rest. Low ceilings or a standing spawn leak retain crouched
   travel. Legacy plans without that field retain their old travel stance.
4. The previous 0.14-meter arrival tolerance was about 5.5 Source units, enough
   to stop outside thin cover or before a firing edge. Arrival is now within two
   units; braking starts a unit before the predicted shared-motor stopping
   distance. Planning verifies both the endpoint and its approach-side arrival
   margin. Home concealment is also checked at the lane pre-aim facing.
5. Repeated sight loss/reacquisition could keep extending an information peek.
   Checks now have an absolute exposure budget, including the configured
   reaction delay. A quick check has at most delay + 0.85 seconds; a wide check
   has delay + 1.5 seconds. The deadline interrupts even a stalled burst. These
   are training policies, not measured CS2 timings. Take-angle holds remain
   deliberate holds, not recurring timers.
6. A blocked return could retry indefinitely. A stalled outbound attempt now
   cancels further excursions. The physical return gets at most two retry
   attempts after its first stall, then the bot holds/fights at its actual
   position. A temporary obstruction can still clear during those retries. A
   persistent obstruction never causes relocation or endless A/D oscillation.
7. Turning was disabled with return fire off, and retreat eventually discarded
   lane pre-aim. Validated offline `watchPoint` now guides silent practice and
   cover returns as well. Static holders without such a point retain sampled
   orientation with combat off. Hidden/live player coordinates never become
   navigation endpoints or pre-aim updates.

## Context And Movement Contract

There is no new hidden-player proximity trigger. Geometry supplies the movement
context: a supported short lane, meaningful cover, and a coherent route threat
view. Seeded checks remain possible without combat; sensing is still disabled
with return fire off. A bot observing a player from a waiting hold fights there
instead of abandoning it just because its peek timer expires. Other aim updates
use only an observed head or immutable, expiring last-seen memory. Firing
opportunities and post-movement guards still verify native LOS and continuous
reaction time.

Travel uses normalized world-space wishes and explicitly leaves `walk` false.
Acceleration, counterstrafing, friction, stance transitions, tagging, hull
contacts, position, and velocity remain the shared motor's responsibility.
There is no controller interpolation, teleport, or velocity assignment. The
unobstructed regressions require full rifle running speed; native contact
clipping may reduce the physical peak in a particular lane. Longer public
approaches do not imply every bot must move within the first two seconds.

## Parent Fixture Handoff

`session.test.ts`'s "only authored peeking bots move" fixture uses `flatMap()`
with an always-open ray. Both endpoints are exposed, so a `hold` fallback is
intentional. Making that bot move again without cover would restore the original
unrealistic behavior. That test should use a cover-changing collision fixture,
assert the first decision is `move-out`, then test physical displacement and the
second holder's unchanged position. Keep a separate always-open fallback check.

The owned behavior regression "accepts the authored session lane when its
fixture supplies cover rather than an always-open ray" provides a compatible
ray stub for the existing `[0,200,0]` anchor and `[60,200,0]` exit: conceal the
entire lane from spawn, hide the anchor from the later `[0,100,0]` route view,
and open that view only after the bot crosses the cover edge. It demonstrates
the intended fixture contract without modifying the parent-owned session test.

The native `training-quality-regression.test.ts` six-second B-tunnels motion
assertion has the same role-versus-action distinction. At seed `20261010`,
`b_tunnel/11` is `move-out` + `attackFromAnchor: true` + `intent: take-angle`.
Its anchor is the fighting point; `exposure` is the historical field name for
the concealed endpoint in this reversed plan. Native sight to `watchPoint` is
open from the anchor and blocked from that endpoint. With the player stationary
behind the upper-pillar start, all 768 ticks remain `exposed`, with zero
horizontal displacement, no observed player, and no shots. The other two
periodic B bots each travel about 1.439 meters. This is an already-taken angle,
not a stuck outbound state or a far-player activation timer.

That parent assertion should require displacement for periodic checks and
forward move-outs, but require a stationary source fighting endpoint for a
reversed take-angle plan. Reconstruct the plan using the same route views and
active reserved anchors and inspect intent/orientation; do not exempt B by route
name or simply lower the movement threshold. The owned native `b_tunnel/11`
regression reproduces this exact seed and validates the two endpoint sightlines,
stationary fighting phase, grounding, and hidden-spawn shot safety.

## Verification

Focused command (serial workers to avoid competing with parent validation):

```text
npm test -- --run src/range/prefire/bot-controller.test.ts src/range/prefire/bot-behavior.test.ts src/range/prefire/bot-peek-regression.test.ts --maxWorkers=1
```

Completed three-suite run: three files passed, 100/100 tests passed, 26.68 seconds.
Installed native Dust 2 checks ran, including the direct sourced return-to-cover
case (`ct_push_lower/8`) and physically approached Long combat (`a_long/2`).
Windows sandbox transform-cache renames initially failed with `EPERM`; focused
runs used the approved unsandboxed test command. No full `check` or build was
started in this shared workstream; parent consolidation owns those checks.
Follow-up exact-seed `b_tunnel/11` native regression: one passed, 17 unrelated
cases skipped by the focused name filter, 2.05 seconds total. This follow-up
adds only an owned regression and documentation; no runtime or parent-fixture
change was needed.

Coverage includes open-stroll rejection, explicit holder preservation, supported
standing/crouched travel, firing stance, two-unit arrival, normalized running
input and counterstrafe braking, finite information exposure under flickering
LOS, bounded obstruction retries, silent/retreat pre-aim, hidden-memory safety,
continuous reaction/shot LOS, native support and spacing, and approached native
Long combat from both peeking and holding actors. Native planner checks include
the retained internal clearing routes and current public approach families.
Assertions use source identities and actual eligible plans, not a fixed public
route count or a requirement that every catalog role always finds a valid lane.

Native checks require locally imported Dust 2 collision. They validate the
trainer's geometry and controller, not Valve's native bot AI, complete tactical
navigation, imported animation fidelity, or exact live-CS2 equivalence.

Parent integration on 2026-10-11 corrected the open-ground and already-taken-angle
fixtures according to the handoff above. Full verification passed 3,163 tests /
134 files and the production build. Ten-approach native planning reports zero
failures; six low-cover silhouette observations remain disclosed diagnostics.
The final browser checks include route/lineup transitions and actual native hits.
