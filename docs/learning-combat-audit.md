# Learning, audio and combat audit

Date: 2026-09-28. This supplements `gameplay-session-audit.md`.

## Implemented behavior

- Native sound-event bank: 64 events and 117 unique PCM samples. Concrete,
  wood and metal steps/landings; weapon variants; available draw/clip-out
  actions; attacker/victim body, armor, head and helmet feedback; deaths.
  Browser voices are capped at 24, decode concurrency at four, and decoded
  samples and spatial mono conversions are cached. No new sound per frame.
- Footstep hearing uses the exported attenuation knots ending at 1100 units
  (27.94 m), with occlusion and rank-conditioned detection thresholds. Shift
  walking remains quiet. Hearing supplies uncertain sound positions, not
  live player tracking or permission to shoot through cover.
- Idle/setup navigation can check other geometrically plausible angles and
  return to its expected angle. High-skill checks are shorter and more frequent.
  The recency priority prevents repeatedly choosing only the same two angles.
- Directional red damage arcs remain outside the crosshair, fade in 0.85 s,
  rotate with view direction, cap at four, and clear on pause/restart.
- Duel arena width/depth scale from 24 x 32 m to 36 x 48 m. Props and actors
  retain their physical dimensions. Positions, spawn depths, lanes and outer
  shell expand; navigation goals use the selected arena bounds.
- Player slots 1/2/3 provide primary, USP-S and a practice knife. Ammo and
  recovery survive switching; deployment prevents immediate firing. USP is
  semiautomatic. The knife is a simplified 48-unit slash, not a complete native
  melee system. Bots still use the configurable primary-weapon pool.
- Duel scorecard measures hits/shots, head hits, firing speed, grounded settled
  shots, air/moving shots, damage, visibility-to-damage, initial aim gap, multiple
  visible enemies and kills. Airborne moving shots count once in the settled
  percentage. Damage is capped to remaining health/armor. Player visibility
  uses the actual viewport aspect, pitch and line of sight. History is bounded
  to 50 rounds, validated on load, and exportable as JSON.
- Training score: 40% shot discipline, 35% hit rate, up to 15 points for initial
  aim gap and 10 for limiting multi-enemy exposure. This is an app heuristic,
  NOT a FACEIT estimate or an implementation of Leetify's rating.
- Each round gives one prioritized action: land, stop before firing, isolate
  angles, improve initial aim, shorten unsuitable sprays or prepare head height.
  Coaching remains available in the scorecard after the short round transition.
- Guided rings invert the physical shot, then apply the CURRENT rendered
  camera/crosshair recoil, not the NEXT shot's camera recoil. This distinction
  fixes over-compensation/body hits when aiming at the guide. Ray origins and
  world-fixed impacts are unchanged.
- Spray transfer can switch after a specified bullet count or after A takes
  100 unarmored damage. A/B health is visible. Health resets per new attempt;
  recoil does not reset on the transfer. A count is capped before the burst's
  last bullet to retain a second-target shot.
- Switching drills sets the recommended spread: Guided off, other modes on.
  Range users can override it. Duel always applies spread to both sides.
  Disabling practice spread does not disable recoil or movement grading.
- Mode descriptions and a three-part interactive Fundamentals tutorial teach
  braking, strafe alignment and clearing cover. Keyboard and pointer controls
  share the actual ground-velocity equation. Demonstrations do not teleport
  the player onto the target or unlock lesson completion for the user.
- Small portrait screens scroll rather than collapsing the 3D viewport.
  Short landscape screens compact the description band. Feedback and hit
  captions stay below the crosshair, with space reserved for HUD information.

## Fresh static verification

`node tools/import-game.mjs --data-only` re-exported `scripts/weapons.vdata_c`
from the installed `pak01_dir.vpk`, build 2000918. Every one of the 33 exported
fields for all 17 primaries is unchanged from the earlier build 2000908.
The re-export changes only build metadata and the raw-file SHA256. Equipment
data was also refreshed, including USP damage/range/armor parameters.

The newer client and tier0 DLL hashes DO NOT match the existing emulation
fixture's pins. We did not bypass those pins or claim to re-emulate the newer
DLL. The original RNG/table fixtures and recovered recurrence remain from
2000908. `recoil-provenance.json` now distinguishes the two audits and tests
pin the exported weapon parameter hash independently of the math version.

Existing regression tests retain rapid-tap recovery, interrupted recoil,
movement inaccuracy and shared range/Duel shot scheduling. Added a wide-strafe,
brake, crouch and retreat test during uninterrupted fire: origins, recoil and
cadence match the range kernel. Crouching does not cancel running velocity or
reset recoil; lowering eye height requires the player's aim adjustment.

This does NOT verify the whole engine against current CS2. Camera recoil
fractions, Source 2 mixer/reverb, collision/step handling, stamina, native spread
RNG, Negev spread transformation, subtick timing, bone hitboxes and bot rank
curves remain approximations. A synchronized native capture is still required
to establish full spray/feel parity. No live game process is accessed.

## Training sources

- [Leetify glossary](https://leetify.com/blog/leetify-stats-glossary/): the
  distinction between movement-qualified shots, head-hit percentage and
  visibility-to-damage. Their counter-strafe metric is rifle-only and excludes
  crouched movement. Our broader settled-shot metric is deliberately named
  differently. Our initial angular aim gap and mean timing are not their
  median mouse-travel metric or filtered match statistics.
- [Dignitas with f0rest](https://dignitas.gg/articles/how-to-practice-recoil-control-with-dignitasvie-player-f0rest):
  inspect uncorrected wall patterns, practice at different distances, and choose
  shorter fire at long range. These inform the low-hit-rate coaching rule.
- [Dignitas counter-strafing guide](https://dignitas.gg/articles/basics-to-counter-strafing):
  opposite-key braking and pre-aimed versus unexpected engagements inform the
  tutorial. Older CS:GO guidance is not used as proof of current CS2 constants.
- [Dignitas crosshair placement](https://dignitas.gg/articles/what-is-good-crosshair-placement-a-cs-go-guide):
  preparing likely positions versus reacting to an unexpected opponent informs
  the aim feedback. Mouse correction is allowed, not universally discouraged.

## Asset reproduction and limits

`node tools/import-audio.mjs` requires the configured Source2Viewer CLI, an
installed game and FFmpeg (or `FFMPEG` environment override). Exports stage in
the ignored research folder. Some native tracks contain MP3 bytes, so the
importer converts those to PCM instead of merely labeling them `.wav`.
`assets:build`, `assets:check` and the release packager include the event bank.
Native assets remain Git-ignored; access to game files is not redistribution
permission. Source-only checkouts require the local asset pipeline.

## September 29 follow-up

- All 17 primaries plus USP-S now use native first-person idle and reload
  animation. `tools/build-reload.mjs` exports static game resources and runs
  `art/build_reload.py` in background Blender. Both the hands and weapon parts
  are skinned; weapon-part transforms are baked from the native skeleton at
  30 Hz. The runtime samples the clip against the weapon reload timer, with
  short entry/exit blends, and restores idle when cancelled or switched.
  R reloads primary guns as well as the USP. Third-person bot reload gestures
  and the full magazine/rack sound-event timeline are still absent.
- `combatStyle()` implements the requested per-encounter probabilities:

  | Level | Sustained crouch spray | Brief fighting crouch tap |
  | --- | --- | --- |
  | 1 / 2 | 60% | 0% |
  | 3 | 51% | 0% |
  | 5 | 33% | 10% |
  | 10 / 10+ | 2% | 33% |

  Intermediate levels interpolate. Choices are mutually exclusive for an
  encounter; actual execution depends on visibility and surviving long enough
  to fight. A tap starts 0.12-0.24 s into firing and stays latched for 0.24 s
  even if the bot begins a microstrafe. Crouch peeks may still lower a bot during
  exposure but do not silently force every subsequent spray into crouch.
  These percentages are the user's design targets, NOT measured rank data.
- Recoil compensation has separate rank-dependent response and variation.
  Level 5 learned control is 0.84 rather than the previous roughly 0.46;
  level 10 is 0.98 with small encounter variation. These are internal control
  gains, not expected hit percentages. First-shot gating uses the predicted
  bullet angle relative to the observed target, not the leading motor goal.
  This removes a case where a correctly tracking bot would withhold fire.
  Bots retain physical movement/firing spread and imperfect aim.
- Arena layouts start from a fresh random seed per session and change per
  round. Central, camp and cargo walls have broader position/size variation;
  north/south pairs retain balance. Spawn selection shuffles hull-safe points
  behind large walls, checks mutual occlusion, bot separation and reachability.
  Ninety seeded layouts across three arena sizes validate five covered bot
  starts and an off-center covered player start. Blind bots eventually search
  plausible opposing cover positions, not the hidden player's coordinates.
- Lessons 2/3 now accept a visible head hit inside their drawn head region,
  allow a 1.25 s brake-to-shot window, and retain results until continuing.
  Lesson 1 no longer freezes velocity at the accuracy threshold: actual
  friction continues until stopped. Examples start after two seconds of
  reading time and run at a labeled 0.35x speed. The manual simulation still
  uses the range's ground movement function at normal speed.
- Peeking starts include up to 0.35 degrees of yaw offset and a signed
  0.65-1.1 degree pitch offset. Movement gets near the head, but no longer
  guarantees an exact head-height shot with no mouse adjustment.

### Scale and spray checks

Freshly exported installed-game SAS world idle height: **1.821906 m**.
Runtime target idle height: **1.821906 m**, about 71.729 Source units.
The measured difference is 0.0003 mm; loading-pose bounds are intentionally
not used to rescale the animated model. `node tools/verify-scale.mjs --native`
checks the comparison against `research/raw-models/reload-arms.glb`.

All 17 primary sprays have angular/world-space regression checks at 5, 10,
25, 50 and 90 m, including equivalent Source-unit conversions. Browser checks
fire the scheduled guide shot into the native target head at 4, 15 and 90 m,
with eye heights of 46, 55 and 64 units and follow recoil both on and off.
This verifies our projection and physical scale, not full current-CS2 engine
parity. The weapon-data/math-version distinction above still applies.

### Bot calibration

`npm run calibrate:duel -- final-learning-combat` uses 32 seeded, five-second
open-arena encounters at 16 m with a high-health target. Results are app-only
measurements, not population benchmarks:

| Preset | Stationary target hits | Moving target hits | Moving median first damage |
| --- | --- | --- | --- |
| 1 | 5.3% | 4.2% | 656 ms |
| 5 | 17.5% | 13.3% | 539 ms |
| 10 | 58.2% | 44.9% | 414 ms |
| 10+ | 62.3% | 50.7% | 383 ms |

First-damage timing excludes encounters without damage: 11/32 at level 1,
4/32 at level 5, zero at level 10/10+. It includes observation, aim, movement
and firing, not just reflex latency. The separate 12-layout behavior audit
had zero no-shot rounds, 11 rounds with multiple routes, eight with multiple
peek types, and 126 total hits. This does not prove human indistinguishability.

## Final validation

### Visible engagement fix

Combat peeks now brake and engage a recognized opponent before reaching a
distant waypoint. Wide/crouch-wide swings retain 0.12 s of movement after
recognition; fast wide swings retain 0.20 s. Shoulder and jump peeks preserve
their information-gathering return. An unfired attack no longer expires while
the target remains visible. A normal retreat that stays exposed for 0.20 s
reengages; low-health/damage-driven withdrawals and reloads remain deliberate.
Aim prediction includes the bot's own strafe, and first-shot tolerance accounts
for the target's angular size at close range.

Twelve new regression cases cover all eight combat peeks, the two information
peeks, aiming after residual recoil, and exposed versus injured retreats.
They use the real movement/weapon simulation; nine failed before the fix.
Afterward `npm run check` passed **483 tests**, TypeScript and build. The Duel
and round-flow Chromium suite passed **nine tests**, with one mobile-only test
skipped. Asset checks passed. The same 12-layout audit produced 239 hits
(previously 126), with zero no-shot rounds and 11 rounds using multiple routes.
Variety checks accept combat strafes during a sustained fight instead of
requiring a bot to abandon that fight to perform another scripted peek.

### Earlier full sweep

- `npm run check`: **471 tests / 43 files passed**, TypeScript and production
  build passed. Main JS is 955.90 kB (269.04 kB gzip); Vite's >500 kB chunk
  warning remains. No build error was suppressed.
- Integrated Chromium/mobile Chromium suite: **41 passed, five skipped**.
  Brave/Opera GX learning, audio/tracer and round-flow suite: **20 passed,
  four skipped**. Skips are desktop-only interactions on mobile and redundant
  deep projection/audio sweeps that run once in Chromium. Safari on physical
  Apple hardware and physical phone performance were not verified this pass.
- Browser checks include rendered-pixel variation, moving reload bones and
  return to idle, guide-to-head rays, 117 decoded non-silent audio samples,
  manual completion of all lessons, non-overlapping HUD controls on desktop,
  portrait and short landscape viewports, damage arcs, equipment switching,
  scorecard persistence and continuous round transitions.
- `npm run assets:check`: all runtime assets passed. Eighteen animated gun
  viewmodels have native clips, idle hand probes within 1.63 cm of the weapon
  surface, and more than 5 cm of reload hand travel. Forty world-motion clips
  and the full audio bank passed. Runtime models/audio total **107.63 MB**;
  individual animated viewmodels are 2.01-4.08 MB and load on demand. Total
  asset size increased from static viewmodels; it is not the initial download.
- `git diff --check` passed; only Git's Windows line-ending notices appeared.

### Performance capture

`DUEL_URL=http://127.0.0.1:5179 npm run profile:duel -- learning-combat`
(environment assignment uses PowerShell syntax on Windows). Chromium on
NVIDIA RTX 4080, D3D11, 1656 x 825 rendered canvas. Seed 104, level 5, audio
running, stationary high-health player. Each round warmed up for 12 seconds
so covered spawns could develop into combat, then captured 6.5 seconds.

| Active bots | Visible bots p95 | CPU frame p95 | GPU p95 | RAF interval p95 | Draw calls p95 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1.20 ms | 3.11 ms | 4.30 ms | 33 |
| 5 | 3 | 1.60 ms | 2.44 ms | 4.30 ms | 49 |

Both captures remained in active combat and took damage; browser errors were
empty. The five-bot capture is not five simultaneously visible bots. Different
visible geometry explains why its GPU measurement is not higher. These short
development-server captures do not predict integrated-GPU/old-PC performance,
full-screen extremes, long-session memory use or cold-load latency.
