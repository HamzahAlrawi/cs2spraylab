# Positional audio, tracers and combat control

## Presentation fixes

- Enemy footsteps, landings and gunshots use world-space Web Audio HRTF
  panners. The listener follows the rendered camera's position, yaw and pitch.
  Gunfire is downmixed once at decode time for positional playback; the local
  weapon keeps its original stereo buffer. Quiet walk/crouch footsteps remain
  silent in the shared simulation. Running footsteps are louder than before.
- Distance attenuation and a simple solid-cover low-pass/gain filter apply to
  enemy sounds. There is no acoustic portal/reverb simulation, material-specific
  surface sound set or claim of matching CS2's sound engine. Headphones/stereo
  output are needed to perceive the full directional effect. At most 24 voices
  are retained; ending/stolen voices disconnect their panners and filters.
- First-person tracers begin at the visible barrel, mapped from the separate
  view-model viewport to the world camera. Bot tracers begin at their held mesh.
  Imported node-name sanitization previously prevented weapon replacement on
  bots; the sanitized attachment name is now supported. Barrel positions are
  estimated from the forward end of weapon geometry, not native attachment data.
- Tracers last 65 ms and are suppressed if the cosmetic segment crosses solid
  cover. The ballistic origin remains the simulated eye ray. Hit testing, recoil,
  spread and already-created impact points are unchanged. Muzzle presentation
  never feeds back into hit registration. Impact size now respects the setting.

## Combat changes

Previously a bot kept the same acquisition bias throughout contact and tracked
the current observed location with a lagging motor. Recoil compensation passed
through the same acquisition delay. Experienced bots also had a 72% chance to
retreat on any hit, even during an otherwise favorable duel.

The controller now:

- Corrects its acquisition bias toward a smaller, slowly changing residual error.
  Rank, identity variance and the accuracy control still affect the result.
- Estimates horizontal target motion from successive visible samples only.
  Rank-dependent short-horizon prediction offsets motor/perception latency;
  prediction is reset on occlusion and cannot query hidden target velocity.
- Applies imperfect, smoothed recoil compensation as separate mouse deltas,
  leaving target acquisition under bounded angular acceleration. No forced hits,
  reduced bot spread, damage multiplier or zero-delay reaction was introduced.
- Chooses weapon/range-dependent bursts, with pauses and counter-strafe
  displacements between bursts. Close committed sprays can move to visible body
  aim. Low-rank opponents keep longer, less disciplined bursts and weaker control.
- Usually contests a visible fight after light damage; critical health or repeated
  damage makes retreat more likely. Unseen attacks still encourage repositioning.

These are explicit trainer heuristics, not learned human behavior. The
[Leetify glossary](https://leetify.com/blog/leetify-stats-glossary/) defines time
to damage as a combined outcome, not pure reaction time; its headshot accuracy
denominator is hits. Public FACEIT aggregate statistics are useful sanity checks,
but do not establish reaction-time distributions, per-rank variance, or a 10+
cohort. Do not describe this controller as empirically equivalent to a rank.
The audio implementation follows the browser's
[PannerNode API](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode),
not a reverse-engineered CS2 acoustic pipeline.

## Controlled calibration

`npm run calibrate:duel -- label` runs paired seeds 1-32 at 16 metres with an
AK-47, one aggressive bot, armor, and either a stationary target or a target
strafing between +/-1.6 metres. Each encounter runs for five seconds with extra
target health so the complete burst sequence can be measured. These are open
test-lane outcomes, **not directly comparable** to all-map ranked-match averages.

| Level | Moving target hit rate before | After | Median first damage before | After |
| --- | ---: | ---: | ---: | ---: |
| 1 | 4.3% | 3.0% | 820 ms | 742 ms |
| 5 | 5.6% | 6.7% | 539 ms | 547 ms |
| 10 | 9.3% | 25.7% | 625 ms | 484 ms |
| 10+ | 9.4% | 43.8% | 1281 ms | 445 ms |

First-damage medians exclude encounters with no damage. After the change,
no-damage encounters were 18/32, 8/32, 0/32 and 0/32 respectively. This censoring
is why low-skill first-damage medians should not be read as overall effectiveness.
The 12-seed cover-arena audit also produced shots in every round, multiple route
roles in 11/12 rounds and multiple exposed peek types in 10/12 rounds.

## Validation

- Unit coverage checks rank-separated moving-target outcomes with nonzero
  reaction delays and imperfect accuracy; estimator reset on occlusion; damage
  responses; listener axes; and muzzle projection at 16:9, stretched 4:3,
  ultrawide and portrait aspects.
- Browser audio tests actually render a stereo signal through HRTF panners and
  check left/right energy, ear reversal when turning, distance attenuation and
  cover filtering. Desktop/mobile live-model tests verify both barrel origins
  and unchanged physical endpoints, with screenshots of the resulting tracers.
- With positional audio running, the local RTX 4080 capture at a 1656x907 drawing
  buffer measured five-bot main-thread frame work at 1.1 ms median / 2.0 ms p95,
  and 4.4 ms p99 frame intervals. Median draw calls were 58. This short sample is
  not a low-end hardware guarantee or a reliable GPU speedup comparison. Browser
  audio-thread work is not included in the main-thread timer.

Raw calibration/profile JSON and screenshots are in ignored `test-results/`.
Native upper-body weapon/aim animation layers, exact hand grips per weapon,
bone-attached hit volumes and independently measured human equivalence remain
outside what these changes establish.
