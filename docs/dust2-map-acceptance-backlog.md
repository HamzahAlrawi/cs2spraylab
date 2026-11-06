# Dust 2 Acceptance Migration Backlog

Status: **provisional**, not fully certified by the new map admission process.
Existing gameplay remains available; no new visual/native/gameplay parity claims
were made by adding that process. No new map is included in this iteration.

This is an independently scoped review backlog from reported problem classes,
not a pass list generated from today's coordinate catalog. It must be expanded
and signed against current-build native reference captures and at least two
independent angle references per area. Presence in a catalog does not resolve a
row. Prior fixes are useful evidence to retest, not blanket acceptance.

| Area/approach | Required pockets and review focus | State |
| --- | --- | --- |
| T spawn / Long doors | Natural protected entry landmark, doors/corner widths, entry facing and exposed bot silhouettes | Pending reference review |
| Long / Pit | Deep/near pit, platform edge, multiple car-side holds, long crossing and long-to-site approaches | Pending reference review |
| A site / Ramp | Boxes looking Short, ramp looking Short, Ninja, default/goose/site crossfires; left/right half and head-only stances | Pending reference review |
| Catwalk / Short | Top mid-to-Cat, lower/upper Cat, stairs beside/above, short close/off-angle holds before site | Pending reference review |
| Mid / Xbox | Top-mid holds, Xbox stair/ramp contact, no repeated falling/landing or duplicate steps, approach cover | Pending reference review |
| CT spawn | Head-only box holds below A; stance/facing, geometry support, footstep transitions and return shot lanes | Pending reference review |
| Mid to B | Outside window trap, window, car and doors; route-specific distances and protected player entry | Pending reference review |
| B site | Default/backsite/box/window/car pockets, site entry and retake directions, contextual exclusions | Pending reference review |
| Upper / Lower tunnels | Close/deep/elevated holds, stairs, roof/context, visual lighting/color seam at B exit, audio propagation | Pending reference review |
| CT rotations / all connectors | Missing spaces/world leaks, hidden playerclip versus shots/grenade masks, chunk exits and radar alignment | Pending reference review |

## Evidence To Reuse, Not Overstate

- [Prefire case study](prefire-map-case-study.md): coordinate/route evolution,
  protected starts, failure classes and native audit commands.
- [Position source follow-up](position-source-followup-2026-10-23.md) and
  [statistics](prefire-statistics.md): sourced coordinates versus match-balanced
  regional support. The current weights are **not exact per-pocket encounter rates**.
- [Chunk startup audit](chunk-startup-performance-2026-11-04.md): useful measured
  cache/worker/handoff baselines, not a guarantee for every route/device/build.
- Native collision manifest currently labels build 2000932; later static-source
  freshness audits found matching physics resources. Preserve both original
  extraction identity and later comparison evidence, rather than relabeling the
  old manifest as a new extraction.

Before promoting Dust 2, build an independent plan with accepted/excluded pockets,
run all admission cases, compare rendered head shots and movement/utility traces
against native captures, measure every chunk/profile/handoff, and archive the
actual results. Do not add an approved receipt merely to silence the provisional
notice. The new native diagnostic may expose remaining start/route/hold failures;
those are actionable debt, not reasons to weaken the gate.

## Onboarding Tool Verification (November 6)

The new dense offline audit passed 367 basic checks: ten full-speed/stance route
checks, ten protected-start checks and 347 approach/hold assignments against the
exact collision bytes pinned by the whole-map delivery manifest. Concealed heads
also test actual controller-supported standing/peek combat poses; a deliberately
crouched hider is not rejected merely because its hidden pose cannot be shot.
These checks do not certify rendered hitboxes, native movement trajectories,
all grenades, missing-angle coverage, bot intelligence or visual fidelity.

The repaired selected-map bot tool passed a planning-only Long doors diagnostic;
that is explicitly not a completed combat audit. Desktop Chromium passed the
existing all-ten-route Prefire-to-Duel integration; mobile Chromium passed the
route-panel regression. The full unit suite (6,935 tests at that run), production
build and subsequent targeted admission/lineup/package tests passed. New tool
tests cover tampered bytes/dependencies and refused overwrites. An incomplete
plan/report was rejected and produced no acceptance files. Local raw diagnostics
remain ignored under `research/map-onboarding/2026-11-06/`.
