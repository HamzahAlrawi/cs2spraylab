# Aim profile and engagement metrics

## Scope and reference

These are browser-simulation measurements, not a CS2 match-demo analysis service.
No account connection, process hook or aim automation is involved. Combat rays,
recoil, movement and weapon timing are unchanged by these collectors.

Leetify's [glossary](https://leetify.com/blog/leetify-stats-glossary/)
defines spotted accuracy, head-hit accuracy (excluding AWP), uncrouched rifle
stop accuracy, rifle spray accuracy, eye-angle adjustment to first damage, and
contact-to-damage timing. Its comparison TTD omits events lasting at least one
second and uses medians. Those public definitions inform our six dimensions.
Uncrouched stop accuracy uses its published 34% weapon-speed rule, not inferred
opposite-key input; native movement inaccuracy remains a separate technique
measurement. Rapid same-target rifle sequences of three or more shots qualify
as sprays; our grouping cutoff is max(180 ms, 1.6 weapon cycles).

Leetify's [benchmark explanation](https://leetify.com/blog/cs2-benchmarks/)
describes equal weighting and z-scores against its wider player population.
The exact current population distributions and final score mapping were not
verified. Its [August 2026 hitbox update](https://leetify.com/blog/aim-stat-calculation-hitboxes-improved/amp/)
also changes comparison baselines. Do not label our output as the Leetify Aim
Rating, FACEIT equivalence or a player percentile.

## Captured timing

- **Contact to first shot:** first gunshot after this encounter's visible
  appearance; includes weapon gates and deliberate waits.
- **Time to damage:** first visible contact to first gun damage in the same
  encounter. Raw display retains long holds. The aim component separately
  excludes TTD >= 1,000 ms, as publicly documented by Leetify.
- **Time to kill:** visible contact to lethal gun damage, for completed kills.
  A survivor or no-damage contact is missing, never an invented zero. Display
  damaged/killed contacts alongside timing to expose this success-only bias.
- **First damage to kill:** interval between first landed shot and lethal shot.
  This is zero for one-shot kills; total contact-to-kill still includes aiming.
- **Reaction (input estimate):** visible contact to the first new trigger press
  near a target, or mouse input toward the nearest visible target. Exclude
  held-prefire, unready weapons, already-continuous mouse input, under-80-ms
  anticipations and responses >= 1,000 ms. A shot timestamp by itself never
  invents a reaction sample. These authored exclusion windows produce a useful
  response proxy, not a laboratory reflex measurement or a Leetify metric.

Visibility is sampled at 32 Hz and input at the physics step. Device/display
latency and visual attention are not observable. One input is attributed only to
the nearest aimed visible enemy, not all on-screen bots. No hidden position or
new visibility/penetration query enters this collector.

Crosshair adjustment is the wrapped yaw/pitch endpoint difference from first
appearance to the first damage shot. It is not angular aim gap on reveal, total
mouse path or a pure recoil-only metric. Unknown first damage is unscored.

## Local aim score

The UI labels this **Aim skill / Practice targets**. Authored goals are:

| Dimension | Goal | Minimum samples |
| --- | --- | --- |
| Spotted accuracy | >= 45% | 10 spotted shots |
| Head accuracy | >= 35% | 5 eligible landed shots |
| Rifle stop accuracy | >= 95% | 10 uncrouched rifle shots |
| Spray accuracy | >= 40% | 9 qualifying rifle bullets |
| Crosshair adjustment | <= 5 degrees | 5 first-damage contacts |
| Comparison TTD | <= 500 ms | 5 sub-second first-damage contacts |

These are disclosed training goals, NOT measured population averages. A rate
component scores min(100, value / goal * 100). A lower-is-better component scores
min(100, goal / value * 100), with zero adjustment receiving 100. Missing or
undersampled dimensions stay null. The score is the equally weighted mean of
qualified components, requiring five contacts and three qualified dimensions.
100 means displayed practice goals are met, not pro-level or perfect aim.
All-shot accuracy, reaction and kill times are not rating inputs. AWP-only play
does not get invented head/spray/stop zeros. Spotted/spray outcomes include actual
dispersion; the separate technique score still distinguishes spread from aim.
The displayed head-hit statistic keeps its public AWP exclusion. The *local
practice score* additionally omits head hunting as a goal when the window
contains shotgun, Zeus or auto-sniper fire, where center-mass hits are valid.
Prefire exposes the same current-run metrics in its optional aim/timing section,
without mixing route practice into Duel history or inventing a route baseline.

At most three adequately sampled components below 85% of their practice goal
become weaknesses, ordered by goal attainment. Each shows its actual value,
denominator, goal and specific practice. Slow TTD plus a quick measured response
points toward first-hit connection rather than indiscriminate faster firing.

## History and personal form

New Duel history stores its existing bounded setup fingerprint. Changed bot
skill/count, armor/health, loadout or map configuration are not pooled. Legacy
entries without a compatible key stay readable but cannot contaminate a new
baseline. Random chunks remain one mixed-map setup rather than a false
map-specific population benchmark.

Pool the current recording and up to nine previous same-setup rounds by raw
numerators, denominators and timing samples. Never average percentages or
medians-of-medians. Skip the saved copy of the current round. Timing arrays cap
at 1,024 recent values per metric per round; summaries cache between measurement
events. The unchanged 50-round local history bounds storage.

Personal form compares that recent window with up to twenty *older*, disjoint
same-setup rounds. For each adequately sampled dimension, obtain the baseline
round mean and sample standard deviation from at least five observations.
Standard-deviation floors are one percentage point, 0.1 degree, or 31.25 ms, to
avoid division by zero or claiming precision beyond the visibility clock.
Reverse the sign for lower-is-better values, equally average at least three
available z-scores, and map with 50 + 50*tanh(meanZ/2). 50 is the player's older
baseline, not average CS2 ability. This transparent mapping is ours, not a claim
to reproduce Leetify's undisclosed final mapping.

## Validation

The full `npm run check` passed 4,082 tests in 215 files and the production build.
The final focused pass passed 141 tests, including all 22 new metric/profile
regressions. Coverage includes timing origins, one-shot kills, no-damage contacts,
input exclusions, wrapped angles, weapon eligibility, rifle/spray denominators,
raw-sample pooling, malformed history, goal weighting and personal-baseline
direction. Desktop/mobile scorecard audits cover sample counts, weaknesses,
same-setup filtering, saved-current-round deduplication and text bounds. Native
Prefire workflow and desktop/mobile Duel restart checks passed too; the native
Prefire workflow intentionally runs only in desktop Chromium.
