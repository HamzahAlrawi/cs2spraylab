# Duel Bot Behavior Improvement Audit

Scope: `tactics.ts`, `brain.ts`, `awareness.ts`, `skill.ts` and deterministic tests. No changes to shot rays, native weapon values, shared movement/stance physics, arena geometry, animation, rendering or UI. Existing dirty work was preserved.

## Evidence And Design Boundary

Valve's public [NextBot known-entity interface](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/NextBot/NextBotKnownEntity.h) distinguishes remembered observations from current visibility. Its [TF bot attack action](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/tf/bot/behavior/tf_bot_attack.cpp) separates getting into fighting position from aiming/firing, uses temporally consistent choices, and pursues last-known positions when sight is lost. These support observation-limited memory, latched intent and bounded replanning as architectural principles, not CS2 numeric constants. The repo's existing rank-repertoire design and game-extracted weapon/physics data remain the basis for execution.

New commitment, cover-hold and recovery timings are training heuristics. They are not measured FACEIT reaction/decision distributions or extracted CS2 human behavior. Human indistinguishability has not been established.

## Concrete Changes

- A fight keeps `contest` or `hold-angle` intent across multiple bursts. It no longer automatically returns to its opening cover waypoint after every burst.
- Burst plans are sampled once at an action boundary using weapon, observed range, ammunition and existing crouch-spray habit. Skilled long-range rifles favor 2-4 rounds with longer recovery; close rifles/SMGs commit longer; bolt snipers, pump shotguns and Zeus use single-shot plans; heavy pistols favor fewer deliberate shots. Native cadence/recovery/spread remains authoritative.
- Ammunition decreases confirm that a real shot happened before a burst can expire. A blocked/deploying/cocking/cooling weapon no longer consumes its attack window merely because the controller requested a trigger press.
- Open exchanges can make a purposeful lateral displacement, then brake and shoot again. Displacement direction tends to alternate, with persistent sampled width, rather than re-rolling movement every tick.
- Covered firing holds are initially steady but bounded (4.4-6 seconds from engagement start); damage, exhausted ammo, stale information and prolonged exchanges can change the angle. Nearby authored cover is preferred over an unrelated distant opening waypoint.
- A healthy angle-change reset that remains exposed stops and contests the visible threat instead of silently walking past it. Explicit serious-damage retreats and shoulder/jump information peeks remain distinct; they are not overridden by universal shoot-on-sight.
- Visited angles receive a repeat penalty, and experienced bots favor plausible clear firing lanes toward their sensed belief. Known recent contacts reduce redundant shoulder/jump information peeks. Beginners retain their restricted repertoire, low pre-aim and imperfect stopping.
- A recent sighting remains expected through occlusion; fresher recognized audio can supersede it. Repeated nearby sounds update a smoothed uncertain bearing instead of jumping to a newly randomized location on every step. Recognition deadlines, expiry and copied observations remain enforced; sounds/shadows never grant permission to fire at a hidden actor.
- Routine skilled angle checks reject wholly blocked candidates. Both controllers reacquire a different observed enemy with a fresh recognition deadline; the fallback controller now uses the existing acceleration-limited aim motor.
- Crouch-spray/tap probabilities and recoil skill curves are unchanged. The sampled habit/control variation persists across short re-peeks instead of being re-rolled on each brief occlusion.
- Stationary attacks/holds no longer accrue a stuck timer that falsely interrupts the next retreat. Repeated knife commands no longer reset their route/action each motor tick.

## Work Budget

- Motor, physical braking, aim and fire gates still execute each simulation tick.
- Cover utility, alternate lane choice, reset shelter and burst plans are evaluated at action boundaries, not per command tick.
- Useful covered-hold rays are cached at 5 Hz; hypothetical hidden-exit visibility and route shortcut checks at at most 8.34 Hz; sound-driven route decisions at at most 2.86 Hz.
- Search points and side-specific scan candidate arrays are built once per brain. Combat style and peek-distance tables are reused rather than allocated every command.
- These caches affect tactical hypotheses only. Actual sight and shot collision remain uncached and authoritative in the parent-owned perception/simulation modules.

## Focused Validation

`human-engagement.test.ts` adds deterministic coverage for ranged burst plans, persistent variation/native-data isolation, multi-burst commitment, moving/braking/re-firing, bounded covered holds, actual-shot readiness, exposed failed repositions, serious-damage escapes, fresh-audio priority, hidden-contact isolation, low-rate geometry checks, and knife-route persistence.

The focused existing suites cover acquisition/skill ordering, all selectable firearm trigger cadence, reaction continuity, occluded memory, sound recognition and expiry, independent sound uncertainty, quiet travel, novice repertoire, peeking engagement, native shared movement, coordinated staging, crouch priors and native recoil calibration.

Parent integration must run full tests/build/browser checks and `tools/audit-duel-behavior.mjs`, and profile the five-bot workload. This scoped worker intentionally did not start a server, perform browser testing, commit, push or deploy. No integration API change is required; `decisionSnapshot()` only adds `intent` and `burstRounds` diagnostic fields.

## Limitations

The controller is still a rule-based training opponent, not a learned human policy. No permissioned human-demo dataset or blind human-likeness evaluation was added. A conservative current-visibility fire gate is preserved, so the existing prefire action remains an anticipatory pre-aimed exposure rather than blind shooting through stale memory. Weapon selection, bot perception, team coordination, traversal, animation and map authorship were not expanded here. Tactical caches can retain a cover hypothesis for up to 0.2 seconds; they cannot make a blocked shot hit. Rendering/FPS counter work belongs to the parent performance integration.
