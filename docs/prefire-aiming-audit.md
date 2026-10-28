# Prefire Aiming Audit

2026-10-10. Local browser QA and static game-file inspection only; no game
memory, process hooks or input automation in CS2.

## Confirmed Defects And Corrections

- The resting crosshair was centered within the canvas. Browser DOM/camera
  measurements across desktop, portrait and stretched-aspect views found no
  resting ray offset. Fullscreen still reserved 264 pixels for the settings
  column, however: at 1440 pixels wide, play was centered at x=588 instead of
  x=720 and used a narrower projection. Fullscreen now hides that column and
  uses the full viewport; ESC restores setup and detailed reviews. This layout
  change applies to the range and Duel too, without resizing at round results.
- Follow Recoil read the last physics-tick recoil while the camera used a
  predicted presentation-time value. Both now use the same value. Guided cues
  use that value too; authoritative recoil and already-created impacts do not
  change.
- Scope/alternate parameter changes rebased stored inaccuracy. Native recovery
  preserves that absolute penalty. See [native evidence](accuracy-native-recheck.md).
- Positive-up physical aim was applied as positive-X native skeletal rotation.
  Native actors face local +Z, so that made their visible guns point downward.
  The corrected sign is verified by actual imported barrel/hand positions.
- The old analytic head proxy did not follow pitched locomotion poses. Imported
  bot rigs now use the 19 original `cstrike` capsules from the static SAS model
  export, transformed through their current animated bone matrices. The head
  radius is 4.3 Source units, not a widened training sphere.

Pose sampling runs on the authoritative firing tick and reuses existing rigs
and capsule buffers. Conservative ray broad-phase checks avoid evaluating rigs
that cannot intersect a shot. There is no second animated skeleton, per-frame
target-ray sweep, aim assistance or shot-delay mechanism. Range mesh scoring,
bullet spread/recoil and world-fixed impact storage are preserved. Neck-to-head
pass-through does not promote shots through nearer arms/chest to headshots.

## Training Readout

Prefire's last-shot panel captures state before that bullet adds new recoil or
firing inaccuracy. It reports actual float32 movement speed, ground contact,
movement inaccuracy, retained recoil and recovery excess. A settled shot can
still have recoil and random spread. Cone radius is the maximum possible
random deviation, not a hit-probability estimate or a claim that the crosshair
marks every impact. The values are not persisted as a new score or FACEIT rank.
Fullscreen keeps a compact last-shot state cue away from the crosshair, while
the detailed speed/recoil/cone readout remains available after ESC.

## Evidence And Limits

`tools/audit-prefire-crosshair.mjs --assert` checks 144 combinations of actual
viewport, projection, recoil-follow state and fixed-tick remainder.
`tools/audit-aim-presentation.mjs --assert` checks 180 stance/facing/speed/pitch
poses and the monotonic native barrel pitch. Head-bone pivots are not assumed
to be the visible face center; native nearer body capsules remain valid blockers.
Unit tests additionally cover arbitrary transformed capsule rays, narrow head
edges, flesh entry/exit, firing-tick sampling and immutable shot metadata.

`tests/prefire-aim.spec.ts` covers desktop/mobile projection, full-viewport
fullscreen centering, ESC restoration and actual browser firing feedback.
`tests/prefire-training.spec.ts` clears a native route with
real simulated shots, spread, damage, ammo and movement, without fabricated
kills.

Final local verification: `npm run check` passed 2,986 tests across 127 files,
TypeScript and the production build. Targeted Chromium desktop/mobile suites
passed 47 tests (19 intentionally skipped opposite-device workflows), covering
Prefire projection/training/courses, input capture, shared Duel/range behavior,
lessons, damage punch and the append-only changelog. The explicit native-wall
occlusion addition passed its focused integration test. Both 144/180-case
audits passed again, with zero browser errors and zero capsule-intersection
misses in the tested pose sweep. These are targeted regressions, not a claim
that every browser suite or every native-game situation was tested.

Current CPU-only active/fire profiles: Long doors median 5.5 ms / p95 7.2 ms;
Short A median 6.3 ms / p95 8.1 ms on this host, performance preset. Both included
player and bot fire. These measurements do not guarantee GPU frame rate or
performance on older CPUs.

The local player's unseen body, offline/headless simulation, incomplete rigs,
perception/coaching visibility proxies and knife hull traces retain their
documented approximations. Imported animation clips are not a reproduction of
Valve's entire native animation graph. Full command/subtick RNG seeding, native
quaternion interpolation, Dust 2 wallbang materials and native dynamic entities
are not supplied by these fixes. Do not claim exact live-CS2 equivalence.

The .45 weapon-recoil camera factor and recoil signs were verified in static
installed-build instructions. That isolated path is not evidence to reduce
external damage-punch camera motion: Valve documents that behavior separately
in its [April 21 update](https://store.steampowered.com/news/posts/?appids=730%2C240%2C10%2C80&enddate=1776897650&feed=steam_community_announcements).
Existing external-damage behavior is preserved.
