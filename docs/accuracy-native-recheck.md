# Native Accuracy Recheck

Audit date: 2026-10-10. Read-only installed artifacts and isolated arithmetic;
no game process, DLL loading, hooks or live-game input.

## Concrete Correction

`WeaponRecovery.setParameters` used to replace the stored penalty with
`max(newStand, oldPenalty - oldStand + newStand)`. This was not the native
recovery operation. Switching zoom/burst/alternate parameters could instantly
remove accumulated error, or introduce standing error while crouched.

It now retains the absolute penalty. The following `advance` clamps it to the
new stance/mode baseline if necessary, or decays its excess toward that
baseline. Recoil angle, velocity, index and timing are not reset by a mode
switch. The normal unscoped rifle formula and physical ray geometry are
unchanged.

Evidence in installed client build **2000930**, SHA-256
`44af2aa0d2c64f90d273444cb393b8b679094f0b02136dbdb89d4ec82a560008`:

- `827422..827474`: chooses the current mode's crouched/standing baseline from
  owner flags and current mode; airborne baseline follows the separate branch.
- `8274ab..827522`: compares that baseline with the previously stored absolute
  penalty, then clamps or exponentially recovers the excess. There is no
  subtraction of a previous mode's standing baseline in this slice.
- Direct weapon-field references at offset `1a18` were inspected. Constructor/
  deploy reset, firing additions, landing addition and this recovery update
  were found; no direct mode-change rebasing operation was found. This scan is
  supporting evidence, not a proof about every indirect/native state path.

The 80 pre-existing independently emulated native penalty cases now also run
through `setParameters`, with the previous absolute penalty supplied as the
old state's baseline. No numeric fixture was regenerated. Separate actual
weapon tests cover AWP, SSG 08, G3SG1, SCAR-20 and SG 553 zoom, crouched scoped
recovery, unscoping and repeated mode toggling.

## Rechecked Without Tuning

`python tools/verify-native-accuracy.py` passed against the installed hash:
130 movement-remap, 105 recovery-time, 80 penalty-recovery, 25 isolated landing
and 15 firing-addition fixtures. Fresh archive export retained **35 weapons /
2,030 primary/alternate combat-field comparisons / zero differences**. Runtime
data provenance remains build 2000924; it was not relabeled to imply complete
build-2000930 parity.

The firing path samples the pre-shot accuracy/recoil before adding this shot's
firing penalty and advancing recoil index: the inspected bullet-dispatch call
at `8034f5` precedes penalty addition `803553..803566`, recoil application
`803578`, and index increment `803592..8035ac`. This agrees with the shared
shot-before-`fire()` ordering; no artificial first-shot penalty was added.

The inspected index-decay slice `8275b9..82763f` retains exponential
`10^(-2*dt)` recovery and the approximately `0.1` zero cutoff. Existing rapid
tap tests retain recoil and firing inaccuracy. Shot seeds progress at actual
shot ordinals; supplied RNG streams are persistent rather than restarted by
each trigger press. Those browser seeds are not CS2 command/subtick seeds.

## Native Recoil Signs And Camera

Follow-up inspection traces the actual table angle/magnitude into
`CCSPlayer_AimPunchServices`:

- `7cc875..7cc889` copies table angle and magnitude without negation.
- `8221c9..8221e7` passes angle in XMM2, magnitude in XMM3 to `85cc70`.
- `85cddE` calls import `V_sinf` at IAT RVA `1aa7898`; `85cdf6` subtracts
  `sin(angle) * magnitude` from the previous Source yaw velocity.
- `85cdff` calls `V_cosf` at IAT RVA `1aa78a0`; `85ce13` subtracts
  `cos(angle) * magnitude` from the previous Source pitch velocity.
- `85ce67..85ce84` stores those pitch/yaw velocities in the aim-punch service.

An isolated, hash-checked Unicorn run of `85cdde..85ce18`, with float32 Python
sin/cos import substitutes and zero initial velocity, gives:

| Angle | Source Pitch Velocity | Source Yaw Velocity |
| --- | --- | --- |
| -90 | 0.0000000437113883 | 1 |
| -30 | -0.8660253882 | 0.5 |
| 0 | -1 | 0 |
| 30 | -0.8660253882 | -0.5 |
| 90 | 0.0000000437113883 | -1 |

The trainer deliberately stores the opposite kick offsets (`+cos`, `+sin`).
Its physical shot subtracts that stored yaw and adds its up-positive pitch.
This is equivalent to adding native Source aim punch: Source pitch is
down-positive; Source yaw and trainer yaw are left-positive. Dust 2 converts
Source `(X,Y,Z)` to world `(X,Z,-Y)`, and trainer yaw zero corresponds to Source
yaw 90 degrees. **Changing the stored yaw sin term to negative would mirror the
physical spray, not correct it.** Ten regressions lock down the native impulse
signs and independent [Valve AngleVectors](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/mathlib/mathlib_base.cpp)
geometry over 45 rotated shot samples. The SDK is used for the documented
coordinate convention, not as evidence of CS2 recoil implementation.

Camera path `8813b0` starts with eye origin/base eye angles and obtains aim
punch at `88155e` through `8522a0`. Instructions `881563..8815a0` apply the
literal float32 **0.44999998807907104** to all three returned angle components
and add them to the camera-angle output. A second camera branch at `8818d3`
uses the same `8522a0` call and `0.45` literal at `8818d8`.

The angle evaluator `84cf90` doubles each cached component in
`84d897..84d8c6` when its final boolean is true. Both camera evaluator calls
inside `8522a0` pass that boolean true (`8523e1`, `852431`); the firing-context
evaluation `851aa0` forwards true from `80da29` as well. Thus the observed
camera multiplier is **0.45 of the doubled physical aim-punch angle**, not
0.45 of the undoubled impulse-cache angle. This supports the trainer's current
`recoilView` fraction; no camera code or recoil magnitude changed here.

## Remaining Limits

No `view_recoil_tracking`, `weapon_recoil_scale`, `weapon_recoil_decay`,
`weapon_recoil_suppression` or `weapon_recoil_variance` string was found in the
installed client image. The saved convar dump contains `cl_crosshair_recoil`,
but no view-recoil tracking value. The camera fraction above was therefore
verified through instructions and owner-field references, not a convar-name
guess. The verified fraction is named in `view-recoil.ts` without retuning it;
the separate integration fixes presentation-time crosshair alignment.
Quaternion interpolation, external damage punch, camera smoothing
and other presentation contributions are not completely reproduced by that
one multiplier.

The recoil/RNG-table verifier rejects the current installed client/tier0
hashes; its existing numeric fixtures belong to an earlier hash-pinned build.
Their current unit matches do not prove current-build command seeding or
complete spread parity. No fixtures or verifier hash guards were weakened.
Native CRT trigonometry, quaternion-cache interpolation, complete zoom/stance
timing, animated hitboxes, actual native impacts and landing-caller input
semantics remain outside this isolated check.

## Focused Verification

`npx vitest run src/range/ballistics.test.ts src/range/shot-model.test.ts
src/range/native-accuracy.test.ts src/range/duel/weapon-state.test.ts`:
**663 tests / four files passed**. Parent integration owns full-suite,
rendered Dust 2 projection, crosshair and physical-hit checks.
