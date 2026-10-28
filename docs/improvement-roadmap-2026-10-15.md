# SprayLab improvement roadmap

Assessment date: 2026-10-15. This is a proposal, not a record of implemented fixes.
Scope: current source, existing local verification reports, and the primary sources below.
No fresh FPS benchmark, live-CS2 comparison, or gameplay changes were made for this assessment.

Implementation follow-up, 2026-10-16: the eight workstreams below have now been
integrated. See [implementation and verification](training-quality-implementation.md)
for delivered behavior, checks, and remaining measurement limits. The assessment
below is retained as the original rationale, not a description of current defects.

## Recommendation

Prioritize agreement between what the player sees, what the simulation hits, what bots perceive,
and what coaching reports. More modes, cosmetic assets, or higher bot accuracy will not resolve
disagreement between these systems. Preserve the physical shot/world-impact coordinate model.

Effort labels are relative: S = localized, M = several connected modules, L = cross-system or data work.

## 1. Make visibility and shot geometry agree (P0, M)

Evidence:
- `src/range/duel/DuelEngine.ts` samples animated native hit poses at firing time.
- `src/range/duel/perception.ts:29` uses four approximate head/body visibility probes instead.
- Non-head offsets are along world X, not rotated with the opponent. Player coaching also consumes
  this observation path. Prefire's separate shoulder probes already rotate; do not regress them.

Risk: first-seen timing, visible-target selection, and coaching can disagree with the hittable pose.
This is a source-level mismatch, not a newly reproduced browser symptom.

Plan: derive a small, bounded set of silhouette samples from the same pose definition used for hits.
Use orientation-correct analytic samples when no native rig exists. Keep distance/FOV broadphase
and cache at sensor cadence; do not update every skeleton at every simulation tick.

Acceptance: automated left/right cover, 0/90/180-degree yaw, standing/crouching, and firing/reload
pose cases; compare actual visible geometry, sensor permission, and shot outcome. Never give bots
hidden-player coordinates through an otherwise occluded sample. Preserve shot-time pose authority.

## 2. Explain misses with a short combat replay (P0, M/L)

Existing session export is summary-oriented, not an authoritative combat replay.

Plan: a bounded local ring buffer of inputs, simulation version, RNG state, shots, collision results,
stance/speed, recoil/spread/aim punch, and bot evidence/decision reasons. Freeze the shot to show
the actual ray, pre-spread aim direction, target hit shape, and first intersected surface.

Explain separately: aim was off, movement increased inaccuracy, this random spread sample missed,
cover intercepted, or the visible pose needs investigation. Do not infer a definitive cause solely
from the crosshair screenshot. Offer explicit export of a small reproducible bug report.

Acceptance: replay reproduces recorded hits/damage for a pinned simulation version; old exports
retain authoritative shot results rather than silently resimulating under new rules. Bounded memory,
no automatic upload, and no game-process access. Measure recording overhead before enabling it.

## 3. Give native maps real surface semantics (P0, L)

Evidence: `src/range/duel/penetration.ts:175` turns a native-map intersection into impenetrable
concrete with no meaningful exit thickness. Material-aware penetration exists for generated solids,
but not equivalently for imported Dust 2. Native collision manifests do not carry material metadata.
Native-map footsteps also lack the generated-solid wood/metal selection information.

Plan: preserve source surface IDs/materials during extraction; implement validated entry/exit
traversal and thickness. Share surface lookup between penetration, impact effects, and footsteps.
Do not guess bullet permeability from texture names or blindly penetrate open triangle meshes.

Acceptance: known doors, wood, metal, and thick masonry; one/two intervening surfaces; both ray
directions; range falloff; surface seams; the same weapon/shot must follow the same rules in both modes.
Tie fixtures to the extracted game build and document remaining native-engine assumptions.

## 4. Validate movement and animation end to end (P0, L)

Evidence: `docs/movement-native-recheck.md` documents verified arithmetic and remaining air,
subtick, hull-transition, slope, and landing gaps. Correct constants alone do not establish trajectory
parity. `docs/prefire-presentation-audit.md` records a failed foot-plant prototype; it remains disabled.
Body root rotation still follows actor aim directly rather than a complete native locomotion graph.

Plan: versioned reference scenarios using offline captures and manually performed CS2 inputs.
Compare speed-time curves, stopping distance, eye/hull height, landing displacement, feet, and body
turning. Cover reversal, walk/run, crouch while spraying, jump+crouch, slopes, edges, and landings.
Then fix measured discrepancies individually, including start/stop/reversal animation transitions
and independent lower-body turning where justified. Do not enable unverified foot IK.

Acceptance: publish comparison plots and tolerances chosen from capture precision before tuning.
Test visible pose and hit pose together. Maintain existing wall-impact invariance tests.
Native parameter fixtures and synthetic tests are necessary, but not proof of complete CS2 parity.

## 5. Establish frame-time and loading budgets (P1, M)

Evidence: `src/range/RangeApp.tsx` eagerly imports several major modes/panels; only Prefire is lazy.
`src/range/prefire/map.ts` serially loads visual groups. The existing performance meter tracks short
window averages, not tail latency. Adaptive quality and scheduled animation already exist.
Vite serves assets from `public/revamp`, not `public`; asset audits must use the configured root.

Plan: split mode code and large cosmetic metadata; measure cold/warm loading; use bounded parallel
asset loading and a bounded decoded-resource cache. Precompile shaders after scene lighting setup.
Consider GPU-compressed textures only after visual comparison. Add p95/p99 frame times, long-frame
counts, and a small diagnostic export to the existing optional FPS display.

Profile collision, animation, shot-pose sampling, and per-tick allocations before pooling or moving
work to workers. Do not replace the simulation or renderer speculatively.

Acceptance: record named hardware/browser/preset, bot count, route, and cold/warm state; test older
integrated graphics as well as a desktop. CPU throttling alone is not an old-PC substitute. Set a
target frame budget, then report percentiles and worst representative encounters, not average FPS only.

## 6. Make bot decisions contextual and testable (P1, L)

Memory, hearing, trades, quiet travel, peek repertoires, and varied traits already exist.
`src/range/duel/awareness.ts` still cycles eligible cover exits on a timed schedule.
`src/range/duel/skill.ts` explicitly labels rank curves as training heuristics, not measured FACEIT data.
Current calibration scenarios are much narrower than real cover fights.

Plan: retain weighted hypotheses over reachable exits, with negative evidence from cleared angles.
Update confidence from sight, sound, teammate information, elapsed travel time, and weapon context.
Use stable commitments and explainable switches rather than periodic scanning or extra randomness.
Review Prefire aim transitions against Duel's existing acceleration-limited aim motor.

Acceptance: scenario suite for occlusion/re-peek, empty-angle clearing, shot bait, trades, low ammo,
and close/long engagements. Assert no hidden knowledge and no indefinite exposed inaction. Log why
the bot held, swung, retreated, or changed aim. Add blinded human evaluations.

Calibrate conditional distributions where reliable demos/data exist. Time to damage is not raw
reaction time, and aggregate rank averages do not define a population distribution. Preserve the
heuristic label until evidence supports stronger claims. Do not restore artificial network delays.

## 7. Turn coaching into measurable practice (P1, S/M)

Evidence: `CoachingReview.tsx` has next-rep advice but no action to launch it. Prefire history stores
compact route outcomes, not persistent per-angle diagnoses. `MovementTutorial.tsx` starts at lesson
zero; completion returns to a fixed mode rather than the player's originating task.

Plan:
- A contextual "Practice this" action starts 3-5 relevant reps with an explicit success criterion.
- Save compact angle-level mistakes and retry the failed entry from a validated covered start.
- Open the relevant tutorial lesson and restore the previous mode/weapon/route afterward.
- Compare only compatible settings and show sample counts for skill trends.
- Progress from guided to unassisted, varied-angle, and pressure reps. Offer later retention checks.

Acceptance: measure the specific skill before/after; do not award full-route records for isolated
angle retries or allow easy XP farming. Missing measurements remain unknown, not zero. Adapt
between practice blocks, never secretly change weapon physics. Keep advice optional and concise.

## 8. Improve encounter evidence before adding maps (P1/P2, L)

Evidence: `src/range/prefire/occupancy.ts` deliberately mixes training coverage with broad regional
evidence. It does not represent measured probabilities for every exact pocket. Existing diagnostics
identify support/provenance gaps; a nearby centroid can lie on the other side of a wall.

Plan: retain a coverage-focused learning option. For realistic encounters, condition defender setups
on side, round phase, equipment, arrival timing, and the same physical holding pocket. Model joint
setups, not independent rolls that produce implausible teams. Validate on held-out matches and show
sample support/confidence. Never relabel authored weights as measured frequencies.

Extend the existing generic catalog schema with map adapters for geometry/materials, routes,
validated entry starts, cover pockets, and evidence provenance. Add an authoring preview and route
playback checks. Require visibility, traversal, and shot tests before accepting another map.

## Delivery sequence

1. Visibility consistency, bounded shot diagnostics, and reproducible frame-time baselines.
2. Native materials and measured movement/animation discrepancies; retain small regression fixtures.
3. Contextual bot attention, targeted coaching actions, and compatible skill histories.
4. Evidence-backed encounter sets and the next map through the same acceptance pipeline.

For each gameplay batch: focused tests, `npm test`, `npm run build`, ideally `npm run check`, plus
desktop/mobile visual checks and representative interaction tests. Separate correctness gates from
performance gates. A passing synthetic test suite must not be described as proven human realism.

## Primary references

- [Leetify: improved hitbox-based aim statistics](https://leetify.com/blog/aim-stat-calculation-hitboxes-improved/amp/)
  explains why approximate visibility geometry changes first-seen and aim metrics.
- [Leetify statistics glossary](https://leetify.com/blog/leetify-stats-glossary/)
  distinguishes time to damage, crosshair placement, and counterstrafe metrics.
- [Leetify performance metric methodology](https://leetify.com/blog/performance-metric-tool-guidelines/)
  describes aggregation; it is not a source of complete conditional FACEIT behavior distributions.
- [Refrag Smart Mode](https://refrag.gg/blog/refrags-smart-mode-the-smartest-way-to-improve-at-counter-strike-2/)
  and [Bootcamp](https://refrag.gg/blog/how-to-use-refrags-bootcamp/) provide product precedents for
  adaptive practice and demonstration-to-repetition flows, not controlled proof of learning gains.
- [Refrag Prefire update](https://refrag.gg/blog/refrag-update-bringing-prefire-to-the-next-level/)
  motivates validated encounter variation instead of memorizing fixed spawn points.
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
  documents asynchronous shader compilation; check the installed Three version before integration.
- [W3C Long Animation Frames](https://www.w3.org/TR/long-animation-frames/)
  provides optional diagnostics. Feature-detect it; ordinary game-frame percentiles are still necessary.
