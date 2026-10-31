# Combat Movement And Safer Utility: October 31, 2026

## Scope

This iteration changes independent browser AI input policies, not native weapon,
player movement, recoil, spread, damage or grenade-physics constants. It is not
extracted CS2 bot code or measured FACEIT population behavior. The previously
reviewed [CS2-Bot-Improver](https://github.com/ed0ard/CS2-Bot-Improver) remains a
reference for situational decisions, not a source of copied plugin code or
native-runtime parity claims. No game process is accessed.

## Combat Movement

`combat-movement.ts` chooses an encounter policy from weapon family, distance,
skill and the existing crouch-spray choice:

- Suitable close-range SMGs and some light-pistol engagements prefer moving
  fire. Long-range SMGs, heavy pistols and snipers prefer stopped shots.
- Experienced rifles cap firing windows and step between bursts instead of
  repeatedly extending a useful angle hold. Novice rifle commitments and the
  requested crouch-spray probabilities remain unchanged.
- Precision weapons use the same acceleration/braking inputs as other actors.
  Actual speed still gates firing; there are no position/velocity writes or
  special bot spread exemptions. Snipers can continue moving while cycling.

`TacticalBrain` changes direction at action boundaries rather than rolling every
frame. Nearby reachable lateral steps are preferred before a longer reset.
Short steps can fit tighter angles; collision checks reject walls, unsupported
native traversal and allied bodies along the step. Four consecutive combat
steps lead back into the existing cover/reposition decisions. Failed moving-fire
step searches are throttled. Bots can still hold when no safe step exists, when
unidentified, or during an intentional committed/crouched firing window.

Authored static Prefire holds and its dedicated controller are not turned into
free-roaming Duel opponents. Shared grenade safety applies to both modes.

## Grenade Handoff

The previous live handoff could queue release while the grenade was still being
drawn. That prematurely made the action uncancellable. The planner now receives
actual held-utility readiness. Draw preparation can be abandoned on a live
contact, recent own damage, lost cover, stale evidence or an invalidated plan.

After a validated native release is committed, ordinary defensive AI cannot
erase it or turn its validated throw pose into a different trajectory. The
shared action clock still creates the projectile and consumes inventory once.
Player controls and native draw/pin/release timing are unchanged.

## Utility Decisions

Plans require fresh recognized evidence, real cover and a settled thrower.
An already accepted setup retains its own sight observation for at most three
seconds (two for uncertain sound-area setups), so the caller's shorter report
horizon cannot erase a native draw in progress. This is bounded remembered
information, not a refreshed or extrapolated hidden enemy position.
Sound is an uncertain area cue, not an exact enemy coordinate for damage or
precision flashes. Candidate trajectories and final release use the same
projectile kernel as live throws, including launch correction, contacts, bounce,
fuse think ticks and the simulation's release tick. The ideal ballistic solution
alone is no longer treated as proof of useful placement.

Self/allied damage, unsafe flash exposure, future fire spread and smoke blocking
a friendly clear firing lane can reject a throw. HE/flash outcomes must also
reach the reported angle rather than merely detonate nearby behind a wall.
Solver results are retained during preparation; changed positions, allies,
evidence, stock or world state
invalidate them. A bounded rotating candidate shortlist prevents one grenade
family from permanently starving the others.

These checks are conservative training policies. They do not predict hidden
opponent movement, guarantee a grenade kill or model every future teammate
decision. Planned utility can be cancelled rather than thrown into a live duel.
Offensive smoke tactics and broader tactical planning remain separate work.
Unauthored target heights remain a body-point offset approximation, not an exact
platform/ramp floor query; the actual predicted outcome and height tolerance
still gate admission. This is a known remaining placement limitation.

## Verification

- Live simulation witnesses cover rifle/pistol/sniper firing stops, real opposite
  braking inputs, weapon cadence and moving SMG shots retaining movement spread.
- Native movement witnesses use extracted Mid/CT and Long Doors collision plus
  sourced course/hold metadata, asserting real hull fit, shots and movement.
  Source-only checkouts explicitly skip these local-asset witnesses.
- The Mid/CT collision fixture records build `2000932`, SHA-256
  `f8155888b03b6e2320adcbb77dc3985a3fdb9c7b79533c218d78fbe828e53ef7`.
  Existing extracted geometry and source metadata are unchanged; this is not a
  fresh claim that all trainer mechanics match the current installed CS2 build.
- Handoff witnesses cover cancellable draws, actual deploy readiness, exactly
  one release, recent-damage cancellation and committed-throw ownership.
- Utility policy witnesses require successful safe HE, fire, flash and smoke
  uses as well as rejection/cancellation cases. Cadence, replayed trajectory,
  evidence independence and bounded preparation work are checked separately.
- The 64-seed skill cohort compares hit rate, reaction, time to first damage and
  executed damage. Moving and firing sooner need not produce a strictly higher
  raw hit percentage. Elite behavior must retain stronger executed performance;
  aiming/skill constants were not retuned to satisfy a stationary-style metric.

Native Mid/CT planning samples on this machine took about 1 ms for a positive
setup, 3-4 ms for a rejected four-candidate batch and 4-7 ms when smoke was in the
batch during concurrent tests. These are local samples, not old-CPU guarantees.
The planner retains results during draw and performs one final release replay;
it does not solve full trajectories every simulation tick.

No new media is added to Git. No deployment is included in this iteration.

## Completed Checks

- Final `npm run check`: 282 files / 6,644 tests passed, followed by a successful
  production build. The 64-seed calibration has a scoped timeout for its larger
  cohort; neither global timeouts nor production skill constants were relaxed.
- Eighteen production-bundle smoke combinations passed across nine drills and
  desktop/mobile sizes with no browser or asset errors. The smoke tool now waits
  for enabled entry controls before assessing/screenshotting a canvas, avoiding
  false positives during shader preparation.
- Fourteen desktop native Duel/character/grenade workflow cases and the mobile
  post-win firing case passed. Two initial dev-server cases were interrupted by
  source reloads during implementation and passed on the settled-code rerun.
- Source-only asset policy and staged whitespace checks passed. Runtime media,
  captures and local research remain ignored; player progress was not migrated
  or cleared by this iteration.
