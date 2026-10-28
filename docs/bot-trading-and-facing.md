# Bot Trading And Held Angles

## Evidence Contract

Death trading is a configurable trainer policy in AI Duel and Prefire. Both
settings default on, independently persisted. Prefire requires Return fire; a
silent target drill never starts reacting to hidden player position.

After the complete tick's damage batch, each lethal-hit event offers at most two
nearby surviving allies a trade. Casualties are processed in stable actor-ID
order, so a bot killed later in the same batch cannot consume a responder slot.
Recognized reports are copied before damage callbacks/orders mutate brains. Inputs
are the deceased ally's already recognized sighting or a surviving ally's
audible shot estimate, allied state and skill. The killer's live actor position
is not queried. Evidence older than 1.5 seconds, future sightings, nonfinite
reports, distant allies, reloads and critically injured allies are rejected.

Eligible range is 18 m; level-dependent attempt chance ranges from 20% to 95%.
Responses have a 120-900 ms policy delay, respect any hearing-recognition
deadline and expire after 3.5 seconds. These are explicit training choices, not
measured FACEIT probability/timing tables. Newer recognized reports override
older hidden sightings, while a current visible target remains authoritative.
Knife responders may approach a report, but cannot attack without their own
visual recognition and contact range. Local visual recognition, physical
movement, recoil, spread and weapon firing gates still decide the actual shot.
There is no guaranteed trade, aimed ray redirection, teleport or free damage.

[Refrag's entry-training explanation](https://refrag.gg/blog/4-ways-i-improved-my-entry-fragging-skill-with-refrag/)
describes a defender swinging to trade after another defender is killed. It
supports this training situation, not the numeric bot policy above.

## Geometry And Movement

AI Duel stages a trade through an existing reachable cover lane with a firing
sightline to reported evidence. A trade briefly overrides an unrelated search
or coordinated staging wait, but never reload safety or personal firing sight.
Trading actors are excluded from simultaneous boost/traversal assignments.
Disabling trading preserves crossfires, independent movement and hearing.

Prefire caches local trade excursions at round construction, only with combat
and trading enabled. Only selected actors are planned. Each proposed excursion
uses the same native hull/support, reserved-anchor, covered-start, exposure and
arrival-margin checks as normal peeks. Plans without a usable excursion can
watch the reported angle but do not invent a route. Valid swings use the shared
motor and counterstrafe before firing. After expiry they return physically to
their original hold. Blocked excursions are abandoned without relocation;
successful stopped return clears temporary blockage for a subsequent attempt.

Planning remains bounded by five actors and the 16-roster cache. No dense
silhouette grid, nav search or evidence scan is added to per-frame simulation.
Death selection runs only on a lethal-hit event. Prefire gunshot cues use
audible range/attenuation and native occlusion with independent seeded noise;
they do not perturb movement rolls before their recognition deadline.

## Facing Corrections

Stationary Prefire plans previously returned before assigning an approach watch
point. Source orientations belonged to larger upstream courses, so a valid
target in a shorter approach could face away. All holders now watch a reachable
authored route view, chosen using native sight, including at initial placement.
Raw pinned XYZ, facing and stance data are preserved; runtime facing is an
intentional tactical adaptation. Without a reachable view, source facing remains.
Hidden player movement cannot change this pre-aim point.

AI Duel primary checks use forward, reachable approach corners instead of
random corners behind the bot's own compound. Secondary angle checks stay in
the expected threat sector. Actual sight, remembered exits, a fresh sound or
shadow may still turn a bot away from its old angle when evidence warrants it.

Prefire additionally senses its own displaced damage-punch view. Correction is
bounded mouse input, not instant cancellation; a badly displaced view cannot
pass the firing gate. Player/bot physical shot calculations remain shared.

## Verification

Focused regressions cover fresh/stale evidence, delayed recognition, skill
variance, at-most-two responses, generation expiry, trade-off behavior, actual
lethal-hit dispatch, physical swing/counterstrafe/return, obstruction guards,
source-coordinate preservation, unseen-player independence and aim-punch
correction. Native bot/route tests and browser progression/aim-punch checks are
part of final integration. Passing them does not establish native CS2 AI or
animation parity.
