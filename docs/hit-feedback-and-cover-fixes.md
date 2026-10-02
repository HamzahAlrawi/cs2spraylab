# Hit Feedback And Cover Fixes

## Cover Tops

The generic cover cap and authored bench/dock/planter tops occupied the same
plane, causing z-fighting. `addArenaCover` now omits that cap when a prop owns
its top panel, including generator/vent panels. A planter trim was also
narrowed to prevent an overlap with an adjacent bench in the bicycle court.
Collision boxes are unchanged. Shared materials still use static batching.

`arena-props.test.ts` checks all 54 authored POIs for overlapping upward faces
of different materials and preserves the draw-call batching limit.

## Immediate Damage Feedback

Damage remains hitscan on the same fixed simulation tick as firing; no travel
delay or ballistic/coordinate changes were introduced. The HUD previously
waited for its 100 ms polling interval. Hit/round events now publish status on
that render frame. Lethal events register before actor synchronization and
bypass the pose-throttling interval for the first death frame.

Tests cover same-tick hits at 2, 20, 60 and 100 metres, plus HUD health/damage
and first-death-pose publication at 30/240 FPS in Chromium.

## Death Presentation

The first timing fix compressed bot clips into 0.55 seconds. A subsequent
audit found severe joint discontinuities in those extracted tracks, so the
current fix replaces them with constrained, offline-baked falls sampled at
their actual speed. See `aim-punch-and-death-audit.md`. The 0.08 second hit-pose
blend, prompt weapon drop, automatic restart and pause behavior remain.

Captured hit poses blend through the animation mixer, not by editing bone
transforms after mixer sampling. Direct edits caused unchanged native tracks
to keep partially blended poses indefinitely. Regression tests cover constant
tracks and live deaths, including native crouch variants and raised surfaces.

These timings are presentation choices, not a claim of exact CS2 ragdoll
physics. The existing floor contacts and support checks remain in use.
