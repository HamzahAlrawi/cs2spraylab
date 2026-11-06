# Sound source variety without losing common-position weighting

Follow-up to `sound-awareness-density-2026-11-06.md`. The previous sampler was
continuous mathematically, but its final heard positions remained too repetitive.
Checking only unique floating-point coordinates was insufficient validation.

## Causes

- The mandatory hidden-from-player filter discarded valid open playable space,
  funneling trials into a small number of covered corners.
- A 0.65-meter hold bandwidth was mostly small jitter around the same hold.
- Avoiding only the previous centimeter-rounded coordinate did not avoid the
  same small area, nor different sources heard through the same corner.

## Current policy

- Continuous Gaussian neighborhoods now use 1.8-meter hold and 2.8-meter corridor
  bandwidths, truncated at 2.5 standard deviations. Nothing snaps to an anchor.
- Proposal mass is 65% common holds and 35% corridor coverage when both are
  available locally. Existing match-balanced regional evidence still weights
  the hold components. Duplicate courses cannot inflate their priority.
- All offsets still require supported player-hull traversal from admitted
  playable anchors. Removing the hidden-only condition does not permit arbitrary
  listener-centered positions, detached scenery, wall crossing or voids.
- A weighted random race softly penalizes proximity to the last eight heard
  regions and repeated perceived bearings/ranges. Older entries decay. No region
  is permanently banned, so common areas remain more likely over longer play.
- Perceived direction uses the acoustic path, not a fake panning angle. This
  avoids selecting many different coordinates that all sound like the same
  doorway whenever other audible choices are available.
- A source enters history only after its audible travel time, once per trial.
  Extra footsteps/bounces and deliberate Replay do not create extra entries.
- Changing assistance or requesting the next sound does not clear the recent
  region history. A new map/session starts a fresh history.

These are exercise-spacing and smoothing choices, not new measurements of exact
CS2 sound-event or encounter probabilities. The original pinned 32-match regional
evidence and its limitations remain unchanged. A weighted 200-trial regression
verifies that the more common region remains more frequent with repetition
control enabled, rather than silently flattening the distribution to uniform.

## No visual shortcuts

Open playable positions may now be used. In unaided/hint stages, the demonstrator
model stays hidden until an answer. Assisted model/marker reveals still require
an audible cue. Awareness-only presentation suppresses demonstrator shadows,
muzzle flashes, tracers and bullet-impact clues. Native gun reports, footsteps,
reloads and movement are retained; player shot visuals are unchanged.

This is deliberately audio-training presentation, not a change to visibility or
effects in AI Duel, Prefire or the range. Physical player shots still provide the
answer ray; no game aiming or recoil coordinate formula changed.

## Frame cost

The initial wider search cost roughly 30-43 ms per selection in a local native
audit. It is now resumable work: proposal generation, each 0.3-meter hull-walk
increment, acoustic ranking and cue admission yield between bounded steps.
Presentation advances at most eight work units or a two-millisecond target slice
per frame, whichever comes first. One native query can exceed that target; it is
not a hard real-time guarantee. Pause, Next, configuration changes and disposal
cancel unfinished work. Source validation rechecks the listener's current range
before admitting a trial. No new geometry, network resources or workers are added.

## End-to-end audit

The regression drives final played sources on the complete pinned Dust 2
collision, not just the proposal sampler. It measures one-meter occupied cells
and consecutive cues closer than 1.5 meters over 100 trials per listener area.
The previous default Outside Long run visited 48 cells with 17 near repeats.
The expanded audit covers Outside Long, Mid and Upper tunnels/B with deterministic
seeds. Results are diagnostics for those fixtures, not a guarantee that an
audible constrained room can always provide 100 different positions.

Final resumable-work audit, 100 heard cues per area:

| Listener area | Distinct one-meter cells | Adjacent cues within 1.5 m |
| --- | ---: | ---: |
| Outside Long | 86 | 0 |
| Mid slope | 91 | 0 |
| Upper tunnels to B | 85 | 0 |

Median maximum preparation slices per trial were 1.2-1.7 ms in this local run;
95th percentiles were about 6-7 ms. These are local diagnostics, not hardware-
independent frame-time promises. The prior synchronous selector measured roughly
30-43 ms medians. Native queries, garbage collection and competing CPU work can
exceed a target slice.

Tests also cover continuous offsets beyond the old small hold footprint,
common-position weighting, spatial/perceived novelty, uncovered sources, no
history inflation on Replay, preparation cancellation and native support/hull
clearance. Desktop/mobile browser tests require real remote gunfire with zero
demonstrator flash/tracer/impact effects, hidden unaided models, persisted answers
and zero map requests on a cached reload.

Final verification: `npm run check` passed 301 files / 6,925 tests and the
production build. Both desktop/mobile browser tests, asset verification,
tracked-source asset policy and whitespace checks passed. The existing large
JavaScript bundle advisory remains.

No deployment is included. Commit and push only.
