# Moving Prefire Presentation Audit

Date: 2026-10-13. Scope: the default native SAS rig's animated head and mounted
weapon during locomotion. No controller, planner, session, physics, collision,
catalog, damage or shot-formula changes were made by this sidecar.

## Concrete Defect And Fix

`DuelAnimator` distributed physical pitch across spine_0 (20%), spine_1 (30%),
spine_2 (35%) and head_0 (15%). The face chain therefore received 100%, but both
arm chains branched before the head and received only 85%. The weapon follows
the right wrist, so this was also an 85% barrel-pitch response, not just head bob.

The fix applies the missing 15% to both clavicles. It does not rotate the gun
independently of the hands, change head aim, smooth away actor movement, or alter
the existing reload attenuation. Original native locomotion and gesture clips
remain intact. This is a correction to the app's estimated aim layer, not a
recreation of Source 2 Aim IK.

## Native Frame Evidence

`tools/audit-prefire-presentation.mjs` loads the same target, motion and equipped
gesture packs as the app, uses the actual inverse-bind weapon mount, and calls
the production `DuelAnimator`. It reproduces the production root transform
`actor.yaw - Math.PI`; it does not execute `syncActors` or a renderer.

- AK-47, M4A1-S and USP, all eight directions, standing run/walk and crouch move.
- Physical pitch -0.5, 0 and +0.5 radians; at least one full evaluated stride per
  profile, including slowed walks; a changing-yaw/crouch/braking sequence.
- 14,112 pose frames. 1,254 same-phase neutral/aimed comparisons verify the
  complete pitch contribution without confusing native gait bob with aim.
- Maximum pitch-contribution error: 0.000068 degrees.
- Maximum correction-induced right-hand grip shift: 0.000000174 m. Maximum
  support-hand shift: 0.003312 m. These are anchor checks, not proof of zero mesh
  intersection or anatomical grip quality for every weapon.
- Current maximum total barrel-angle errors: AK 3.29 degrees, M4A1-S 2.30,
  USP 2.75. These retain authored pose/barrel offsets; the audit does not force
  every decorative gun pose to be a mathematically perfect ray.
- Current maximum barrel yaw errors: AK 3.72 degrees, M4A1-S 2.56, USP 1.90.
  No sampled direction points the gun backwards. Head-axis errors peak near
  13.04 degrees for rifles and 4.25 for USP, not a 90/180-degree wrong-way turn.
  The head axis is calibrated once at idle; it is not an extracted eye-gaze axis.

Before the fix, the initial 10,728-frame audit reached total barrel errors of
5.80 degrees (AK), 5.56 (M4A1-S) and 6.86 (USP). The final larger sweep is not an
identical phase sequence; the same-phase pitch test is the direct regression
gate proving the correction.

Local evidence, deliberately not public native-asset exports:

- `research/prefire-presentation-before.json`: initial native frame records.
- `research/prefire-presentation-after.json`: final frames, per-profile summaries,
  selected FK joint positions and input/asset hashes.
- `research/prefire-presentation-frames.png`: four FK bone-frame side projections,
  physical aim in green and mounted barrel in pink. This is a diagnostic diagram,
  not a textured gameplay screenshot.

Reproduce in PowerShell:

```powershell
$env:PREFIRE_PRESENTATION_REPORT = 'research/prefire-presentation-after.json'
$env:PREFIRE_PRESENTATION_FRAMES = 'research/prefire-presentation-frames.png'
node tools/audit-prefire-presentation.mjs --assert
npx vitest run src/range/duel/animation.test.ts src/range/duel/presentation.test.ts src/range/animation-actions.test.ts src/range/duel/actor-hitboxes.test.ts
```

## Remaining Presentation Gaps

These findings must not be presented as fixed by the pitch correction:

1. Planted reversal clips exist in the motion pack, but their experimental
   recovery/contact layer is explicitly disabled and they are not registered by
   the runtime. Eight-direction gait-phase blending alone is not the game's
   full start/stop/reversal graph. See the failed contact experiment below.
2. `syncActors` sets the body root directly from physical aim yaw. There is no
   distinct planted-foot/body-yaw turn state. This can look rigid during turns;
   this audit does not impose a cosmetic delay on hit-relevant bones.
3. Idle-calibrated head facing is not perfect native gaze. The modest authored
   deviations above do not explain a bot genuinely aiming at an unrelated angle.
   Those cases still require controller-attention/route traces from the parent.
4. Native reload/fire/hand IK, alternate agent rigs, geometry penetration and
   actual gameplay render cadence are outside this numerical moving-pose sweep.
   No browser was launched while the parent's runtime edits were in progress.

The cached native root graph explicitly contains `CNmGraphDocAimCSNode` (Aim IK),
with horizontal/vertical aim and crouch inputs, plus foot IK; the runtime's small
distributed aim layer is not equivalent to that native graph. Exact animation
parity requires native graph evaluation or matched in-game reference footage.

## Scoped Validation

43 tests passed across animation, presentation, action lifecycle and hitbox pose
test files. The native audit's finite-pose, complete-pitch, grip-shift and
mounted-yaw guards passed. Full-suite/build/browser validation is intentionally
left to the parent integration task to avoid concurrent heavy runs.

## Contact Experiment: Not Released

A masked native reversal clip with two-bone leg IK was evaluated against the
shared physical motor for releases, counterstops and direction reversals. The
initial 24-case, 4,320-frame sweep kept its toe anchors and hand mounts coherent,
but a mesh-level probe found a boot vertex 65.4 mm below the floor while the
baseline vertex remained 19.1 mm above it. The original cached sole probes did
not contain that vertex. `research/prefire-plant-floor-witness.json` preserves
this failure; passing toe-bone checks did not validate the mesh.

Expanding the probes and attempting bounded vertical support correction did not
establish a safe blend for every fade. Consequently `nativePlantVerified` is
false: no contact objects are constructed, reversal clips are skipped, and no
IK or recovery weight is applied. The verified pitch correction is independent
and remains active. This is an explicit fallback, not a successful foot-plant
implementation or a claim that the native animation graph has been reproduced.

The disabled-path regression must compare the production animator with the same
native pack excluding reversal clips. It checks coincident bones, hand mounts,
unchanged authoritative actor/root state and zero active recovery frames. The
positive `--plant-recovery --assert` gate is intentionally not a passing release
gate while the layer is disabled. Do not enable it based only on synthetic rig
tests, toe positions, or a lowered floor threshold.

```powershell
$env:PREFIRE_PRESENTATION_REPORT = 'research/prefire-plant-disabled.json'
node tools/audit-prefire-presentation.mjs --plant-disabled --assert
```

The final disabled-path audit passed all 24 cases / 4,320 frames. Recovery and
contact scans never activated; maximum bone-position delta and hand-mount shift
versus the baseline were both zero. Minimum sampled sole height was -2.614 mm,
also the unchanged baseline, within the declared 5 mm mesh tolerance. This does
not validate the enabled experiment. Evidence is in
`research/prefire-plant-disabled.json`.

The normal moving-pitch audit was independently rerun against the final source
and passed 14,112 frames / 1,254 pitch comparisons with the measurements above.
Its final source/asset hashes are in
`research/prefire-presentation-release.json`. Parent integration passed 80
focused tests across the final animation, presentation, action, hitbox, lighting,
trade and changelog files, plus the production TypeScript/Vite build. The earlier
full-suite checkpoint passed 3,275 tests; that checkpoint predates the disabled
contact fallback and final scoped lighting/trade repairs, which these focused
regressions cover.
