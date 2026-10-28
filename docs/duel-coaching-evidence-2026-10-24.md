# Duel coaching: evidence rather than generic advice

## Measurement decisions

- Keep all combat, movement, impact and recoil calculations unchanged. Coaching
  reads the existing fractional shot, resolved penetration result and exact
  target pose (native animated capsules when available).
- Timestamp the pre-step player visibility sample at `time - STEP`, not the end
  of the step. Previously some valid fractional shots were older than their own
  visibility sample and were excluded from measured encounters.
- Visibility is sampled at 32 Hz. A coach only uses past samples up to 100 ms
  old, never future observations or hidden bot positions. Unrelated peripheral
  enemies do not turn blind spam into spotted accuracy.
- Associate spray targets with the pre-spread aim/recoil ray. A player pulling
  down correctly must not lose their encounter merely because their raw view
  angle has moved away from the target.
- Count gunshots once, including shotgun pellets and collateral hits. A fight
  records hits and health damage against its intended enemy separately.
- Capture opening speed, recent movement and actual opposing movement input.
  Opposing input is evidence of a brake attempt, not proof of a successful
  counterstrafe. Valid holding and close-range mobile weapons remain valid.
- Separate missed aim/recoil rays, random dispersion, blocking cover and unknown
  cases. Do not diagnose a recoil-only failure from an aim/recoil ray miss.
  A geometrically intersecting ray with no hit and no proven blocker stays
  unknown, rather than inventing an explanation.
- For new evidence-bearing rounds, the aim component of the local technique
  score uses pre-spread aim on the actual model, not random hit outcomes. Actual
  hit rate is still displayed. Blocked lines are firing-line decision errors,
  not classified as aim misses.
  This is a local process score, not a FACEIT rank or a Leetify rating.
- Summarize contact-to-shot and contact-to-damage descriptively, using medians.
  Deliberate holding is not scored as slow reflexes. No rank reaction-time
  benchmarks are invented.
- Rifle sprays require at least three rapid shots at one target. For six-shot
  or longer sequences, inspect later pre-spread rays for loss of control. Do not
  call pistol taps, shotgun shots or sniper follow-ups a rifle spray.

## Useful output

Rank observed issues by repeated frequency and opening impact, rather than
always selecting the first matching rule (one airborne bullet should not hide
nine early moving shots). Include reload punishment and damage from enemies
outside current visible contacts; stale sight does not prove an awareness error.
Show a measured positive result when openings actually connected.

The scorecard shows primary evidence without expansion, at most two additional
findings, a miss-cause breakdown and the most recent six fight records. Each
record includes opening speed, first-shot result, hits/head hits, damage and
contact timing. Round-end feedback now includes its supporting measurement.
Advice can be hidden without hiding the measurements. Old saved reviews remain
readable and malformed optional details are dropped.

No extra world visibility or penetration queries are added. Only the local
player's associated shot gets target-shape ray checks; these reuse the pose
already captured for actual hit resolution. Summary building is cached between
shot/damage events. There is no replay export or model evaluation per HUD render.

## Primary sources consulted

- [Leetify statistics glossary](https://leetify.com/blog/leetify-stats-glossary/amp/):
  spotted accuracy, rifle spray eligibility, crosshair placement and median
  contact-to-damage definitions. Our preparation and local scoring formulas are
  not claimed to reproduce Leetify's ratings.
- [Leetify: Enemy actually spotted](https://leetify.com/blog/enemy-actually-spotted/):
  visibility and field of view matter; contact-to-damage is not a pure reflex
  measurement.
- [Leetify metric tool guidelines](https://leetify.com/blog/performance-metric-tool-guidelines/):
  distinguish eligible samples and denominators rather than showing a generic
  hit percentage as an aim rating.
- [Refrag Coach](https://refrag.gg/blog/what-is-refrag-coach/): assess distinct
  components such as counterstrafing, placement, control and engagement timing.
- [Refrag counterstrafing guide](https://refrag.gg/blog/counter-strafing-the-key-to-precision-aim-in-counter-strike-2/):
  actual stopping before the accurate shot matters, not merely a keypress.

## Regression coverage

Focused tests cover fractional visibility clocks, actual animated hit poses,
penetration blockers, compensated spray association, random dispersion versus
aim scoring, opening input/speed, repeated-issue priority, per-fight pellet and
collateral accounting, reload damage, stale sight and malformed old history.
Browser checks cover visible evidence, detailed fight rows, multiple findings,
tips-off behavior and narrow desktop/mobile text bounds.

Validation: the full `npm run check` passed 4,061 tests across 214 files and a
production build. The final focused pass passed 81 tests, including all 16 new
feedback tests and the follow-up-shot case added during review. Ten desktop/
mobile round lifecycle, animation and scorecard checks passed; the final two
scorecard audits passed again after the presentation adjustments. A final
production rebuild validates the reviewed scoring wording and calculation.

The lifecycle/animation browser fixtures explicitly select generated arenas:
their hard-coded local coordinates are not valid Dust 2 chunk coordinates.
Native-map loading/culling remains covered by its separate integration tests;
no live map or animation behavior was changed to satisfy those fixtures.
