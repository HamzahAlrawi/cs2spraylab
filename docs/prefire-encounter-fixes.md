# Prefire Encounter Fixes, October 13

## Confirmed Defects

- Return fire OFF disabled all perception and erased contact memory. Default
  non-shooting bots could not turn toward a visible player.
- Head-only detection missed a shoulder/body exposed around a native corner.
- A 1.2-second contact timeout snapped a defender back toward its original
  entrance during a re-peek. Merely lengthening that timer still left a Long
  case after a roughly seven-second cover break.
- Generated excursions included forward/backward walks and rewarded the number
  of unrelated visible route points, not a coherent threat/cover relationship.
- Some apparently usable late-route firing views presented the bot's back to
  an earlier approach from which the bot was already hittable.
- A several-degree fire-alignment allowance was particularly poor at long range.
- Repeated sound events postponed the hearing response deadline repeatedly.

## Runtime Changes

Awareness runs independently of damage permission. Native head, chest and two
shoulder probes are bounded to perception cadence; a post-movement sight guard
and shot-time verification preserve actual cover and reaction delays. No shot
formula, collision capsule, recoil, player motor or Source-unit conversion is
changed by these Prefire corrections.

Contact retains an immutable observed point for 3.5 seconds. For up to 12
seconds after observation, pre-aim can retain the nearest static validated
approach view instead of resetting to the original entrance. Without authored
views it retains a half-metre-quantized old point. Hidden player movement never
updates either memory; unseen opponents cannot authorize a shot. These durations
are declared training policy, not extracted CS2 AI parameters.

Excursions must have at least 0.7 lateral alignment to their own cover/firing
view, retain native hull clearance/support and endpoint cover margins, and may
not present their backs (over 75 degrees) to an earlier hittable approach.
Invalid excursions become purposeful holds at the unchanged source coordinates.
Quick peeks acquire contact, counterstrafe and then burst. Wide swings retain
their validated commitment. Both use the shared physical motor; neither uses
position snapping or forced shift-walking. Firing alignment is distance-aware.
Lazy plan-time body checks reduce redundant native queries; repeat roster plans
remain cached. The native encounter audit measures actual visibility and motion,
not whether a controller agrees with its own desired aim.

## Presentation

The native-map scene now has restrained sky/fill lighting and cached static
cover shadows. The occasional shadow bake includes native casters outside the
current PVS in a separate 1x1 shadow-only render, then restores every visibility
flag and render target before the normal color pass, including on exceptions.
Movement inside the cached region does not render another map shadow pass.
Auto/High enable it; Low and
Performance add no shadow pass. Moving targets retain their existing separate
contact shadows. This is a Three.js lighting approximation, not an import of
Source 2's complete baked lighting pipeline.

The animation audit separately checks moving weapon/head axes and hand mounts.
See `prefire-presentation-audit.md` for frame evidence and remaining limitations.
The native reversal/contact-IK experiment remains disabled: mesh-level testing
found boot penetration during its blend. No improved foot planting is claimed.

## Training Policy Sources

- Dignitas, [Peeking in CS2: Why You Keep Losing Duels](https://dignitas.gg/articles/peeking-in-cs2-why-you-keep-losing-duels):
  purposeful information checks versus committed swings, prepared aim and
  counterstrafing. This supports qualitative behavior, not probabilities,
  exact timings or map coordinates.
- Refrag, [Bringing Prefire to the Next Level](https://refrag.gg/blog/refrag-update-bringing-prefire-to-the-next-level/):
  varied positions and micro-adjustments rather than memorizing a fixed spawn.
  No proprietary positions, assets or implementation are copied.

## Evidence

`prefire-encounter-quality.md` records reproducible native fixed/weighted runs,
source hashes, independently measured gaze, cover exits, grounding, reversals,
reaction and unencountered/stalled cases. `tests/prefire-encounters.spec.ts`
exercises the actual browser map, animated actors, physical approach, silent
awareness, cached shadows, restored PVS and graphics fallback. Screenshots live
locally under `research/dust2/prefire-lighting-*`.

Successful structural tests are not a claim that every route, animation, bot
decision or graphical detail is indistinguishable from CS2. The full engine's
animation graph, map lightmaps and professional-human behavior remain outside
the verified scope.
