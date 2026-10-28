# Accuracy And Prefire Peeks

Audit date: 2026-10-09. Offline training only; no game process, DLL loading,
memory hooks or game-input automation.

## Numeric Evidence

Fresh installed build **2000930**, client SHA-256
`44af2aa0d2c64f90d273444cb393b8b679094f0b02136dbdb89d4ec82a560008`.
`tools/verify-native-accuracy.py` emulates only inspected, hash-pinned instruction
ranges with Unicorn and rejects unverified paths. Native math imports are
substituted with Python math rounded to float32; owner/MoveType lookups are
explicitly stubbed. This is isolated arithmetic verification, not engine parity.

- Horizontal velocity length: inspected float32 squares, sum and square root,
  client RVA `81c3e0`. Both simulators now use the shared `accuracySpeedUnits`.
- Movement remap: `80b9a5..80b9ed` and `280040..280091`; weapon cap separately
  multiplied by float32 `.34`/`.95`, followed by float32 subtraction, division
  and clamping. Running applies a fourth root; walking does not. The old double
  remap incorrectly produced a penalty at `.3400000000000001` and
  `.340000000001`, where the native calculation still gives zero. The correction
  follows native rounding order, not an arbitrary cutoff epsilon.
- Recovery time: `80c5d0..80c6bc`, including integer recoil-index transitions
  and four times initial crouch recovery in the air.
- Penalty recovery: `8274ab..827522`, including the supplied baseline floor.
  Two 128-Hz integration steps agree with one native 64-Hz step at a fixed
  baseline within the fixture's rounding tolerance. No material decay-rate
  discrepancy was found; stance-flag transitions remain unverified.
- Firing increment: `803553..803566`, retaining firing error between taps.
- Landing slice: `81f370..81f398` adds coefficient times an input. Its caller's
  input transformation is **not verified**; landing accuracy is not newly
  implemented from an assumed raw fall speed.

The independent fixture has 130 movement, 105 recovery-time, 80 penalty,
25 landing-slice and 15 firing-increment outputs. The tests add near-cutoff,
velocity-length and split-step cases. Landing slices are evidence only.

A fresh `scripts/weapons.vdata_c` export checks 35 retained weapons in both
modes: **2,030 combat-field comparisons, zero differences** from the runtime's
build-2000924 snapshot. Export SHA-256:
`46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b`.
The runtime provenance label is not silently replaced. This field audit excludes
noncombat controls, command/subtick seed derivation, complete firing state and
actual impact trajectories. Existing native spread-radius transforms remain.

## Visual And Hit Geometry

The imported actor's crouched head leans forward, whereas the old analytic
head stayed above the feet. A local browser pose audit at 15 m found two missed
head rays in 45 standing/partial-crouch/full-crouch, facing and movement poses.
Facing-aware anchors, the same smooth crouch blend as animation, and a native-
pose forward offset now make all 45 sampled rays hit the head. Head radius stays
`.135 m`; this does not broaden the head to conceal a mismatch. Native animated
capsules/bones are still not reconstructed: the sampled head-center discrepancy
is at most `.074 m`, and other poses/agents can differ.

Combat entry/exit tracing and visual sensing use the same head anchor. Physical
impacts are calculated once and remain fixed after actor/camera movement. Native
map head reachability is checked against the actual physical head-ray entry,
not the obsolete eye center. All 40 sourced positions remain unchanged.

The world camera no longer applies an additional stair-height lag on top of
the presented actor eye. The old extra offset could reach 18 game units while
shots still originated at the physical eye. A small cosmetic viewmodel offset
retains stair easing without shifting the aiming origin. Ordinary fixed-step
frame interpolation and the existing estimated recoil-view fraction remain.

## Prefire Behavior

The full-speed shared motor replaces always-on shift walking. Geometry planning
considers reversible oblique/lateral lanes and wider swings, verifies native
support/hull clearance and keeps the protected route start concealed. Short
controlled bursts use actual weapon ordinals, not repeated command counts.
Counterstrafe prediction avoids opposite-key chatter near zero. Visible contacts
receive stable pre-aim and incomplete, seeded recoil compensation; hidden
contacts remain immutable and expire. Return fire keeps the user's configured
continuous-visibility reaction delay and post-movement LOS check.

Quick/wide/crouch assignments are local training heuristics, not measured
professional-player probabilities or a FACEIT equivalence claim. Static targets
remain available. These opponents train angle clearing rather than importing
Dust 2's full navigation/tactics engine.

The qualitative approach follows [Refrag's counterstrafe coaching](https://refrag.gg/blog/counter-strafing-the-key-to-precision-aim-in-counter-strike-2/)
and [Prefire training design](https://refrag.gg/blog/refrag-update-bringing-prefire-to-the-next-level/):
prepare the threat angle, strafe decisively, stop before the accurate burst and
use controlled exposure rather than slow, indiscriminate swings.

## Verification Results

- `npm run check`: **2,685 tests in 118 files**, TypeScript and production build
  passed. Vite still reports large bundle sizes; this is not a cold-load or
  old-hardware performance guarantee.
- Native-map controller audit: eight courses, two seeds and 180 seconds per run,
  with **zero bot-behavior failures**. The eligible mix is 19 holds, four
  crouch-hiders, ten genuine cover-changing peeks and seven move-outs.
- Four B-doors traversal diagnostics belong to the passive audit walker: it
  cannot pass a live defender occupying the doorway without killing that bot.
  Low-cover silhouettes can still be exposed from other viewpoints; the audit
  verifies a genuine hiding angle, not invisibility from every possible angle.
- Rendered head-pose audit: **45/45 head rays hit**, without increasing the head
  radius. See the hit-geometry limitations above.
- Chromium desktop/mobile workflows: **10 passed**, ten intentionally skipped
  for the other viewport, no page errors. The prefire test checks rendered
  full-speed bot excursions, all eight covered starts, native player grounding,
  physical camera-eye agreement, firing, settings and switching back to Duel.
  Mobile checks cover an emulated viewport, not a physical phone.
- Local browser CPU samples on three courses: median 3.2-5.0 ms, p95 5.1-6.6 ms,
  91 frames each while active at the concealed start, with no page errors. These
  samples do not represent an extended battle or a guaranteed FPS target.

## Reproduction

```text
python tools/verify-native-accuracy.py
npx vitest run src/range/native-accuracy.test.ts src/range/ballistics.test.ts src/range/shot-model.test.ts src/range/duel/weapon-state.test.ts
node tools/audit-aim-presentation.mjs --assert
npm run audit:prefire
npm run audit:prefire:bots
npm run check
npx playwright test tests/prefire.spec.ts tests/duel.spec.ts --project=chromium --project=mobile-chromium
```

The native verifier needs `pefile`, `capstone`, `unicorn` and the local Source2
Viewer CLI. The browser pose audit needs the local dev server and imported
assets. Generated native-map reports stay ignored under `research/dust2`.

## Training Follow-Up: 2026-10-10

See `dust2-prefire.md` for the deliberate-practice presets, independent opening
coach, score/goal definitions, readable review timing and local progress rules.
No shot formula, recoil impulse, collision geometry or hit radius changed in
this follow-up. Coaching now uses the actual firing-mode cap and native float32
movement-accuracy cutoff, including scoped weapons and crouch-speed rounding.

- **2,763 tests / 121 files**, TypeScript and production build passed. There are
  78 additional tests compared with the October 9 verification above, including
  chest-level versus head-height pre-aim at 10, 50 and 100 meters.
- Native return-fire audit: eight courses, two seeds, 180 seconds each; zero
  behavior failures. Retained report: `research/dust2/prefire-bots-training.json`.
  The passive-walker B-doors diagnostics and low-cover observations remain.
- A separate firing clearance audit completed **all 16 seeded courses**, killing
  all 80 targets using native collision, physical movement and real simulated
  ammunition/spread/damage. No player teleports or target-health edits are used.
  It reports zero event/stat mismatches and no airborne/moving shots. This proves
  clearance for that driver, not that every human approach is safe or optimal.
  Retained report: `research/dust2/training-clearance.json`.
- Chromium desktop/mobile: ten existing workflows and three new training
  workflows passed (eleven viewport-specific skips). New coverage verifies
  presets, persistence, canvas pixels, native hit-derived coaching below the
  crosshair, five-target clearance, exactly one saved result, angle review and
  the independent five-second result timer. Mobile is viewport emulation.
- Visible-combat CPU samples on three courses: median **3.4-5.4 ms**, p95
  **4.6-7.8 ms**, 90-91 frames per course, with two bot contacts per course and
  no page errors. Other tests were running concurrently; this is diagnostic
  evidence, not a clean benchmark or a guaranteed FPS target for old machines.
  Retained report: `research/dust2/profile-training.json`.
- A separate 4x Chromium CPU-throttle diagnostic measured median **20.4-21.1 ms**
  and p95 **37.6-46.5 ms**, with 54-57 rendered frames in 1.5 seconds and no page
  errors. This does **not** meet a guaranteed 60-FPS budget. It is not a specific
  old-machine/GPU model; use Performance quality and a lower frame cap on weaker
  devices. Retained report: `research/dust2/profile-training-cpu4.json`.

The native firing audit initially caught its own over-braking driver, which
could oscillate instead of stopping; it now releases the opposite input before
velocity crosses zero. Long sustained-fire diagnostics also exposed overly
generous training promotion, so uncontrolled low-hit sprays no longer satisfy
the clean-route goal. Separate tests cover single-miss forgiveness.
