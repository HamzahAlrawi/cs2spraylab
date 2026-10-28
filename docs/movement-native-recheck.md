# Movement native recheck

Date: 2026-10-10. Scope: the shared actor motor used by Range, Duel and Dust2
Prefire. Route starts, occupancy, collision placement, native map adaptation,
accuracy, rays, recoil and camera/impact coordinates are outside this change.
No game process, live memory, native DLL loading or automated game input was
used. Unicorn runs isolated instructions against a private synthetic image.

## Evidence

Installed `game/csgo/steam.inf`: build **2000930**, patch **1.41.9.0**,
SourceRevision **11106093**, Oct 08 2026, 14:54:05.

- `server.dll` SHA-256:
  `9f31fc84164f7822e015dcd95ea958f9dd33d02308a646a2bee5c9b39bd6fc28`.
- `research/convars.txt` SHA-256:
  `5f7d0b3e965fc9aa5260f7ef084f86f46557e8ed87835fe6e4d6644121f9a079`.
  Its filesystem timestamp is September 11; it is not a version-tagged capture
  of the currently installed build. Relevant numeric defaults were therefore
  checked against the current static registration literals, not assumed fresh.
- Historical acceleration fixture: build 2000919, hash
  `f95fe0dcd7b526137a8b305dd76a72f624e0508ad42bb5949d05c77a37e1bd70`.
  Historical landing fixture: build 2000924, hash
  `098d4ddd57e2fbe9a73623a2bf68ebaff86f7b6342ddb3d5a0f69cd6335b31cc`.
  Neither old fixture was overwritten or relabeled as current native proof.

Static registered defaults in the current DLL:

| Name | Native float | Data RVA |
| --- | ---: | --- |
| sv_accelerate | 5.5 | 0x17b7c80 |
| sv_friction | 5.199999809265137 | 0x19c2378 |
| sv_stopspeed | 80 | 0x178bffc |
| sv_airaccelerate | 12 | 0x17b7c88 |
| sv_air_max_wishspeed | 30 | 0x178bfe0 |
| sv_gravity | 800 | 0x17aaa40 |
| sv_jump_impulse | 301.9933776855469 | 0x191e744 |

Registration references include `0x1043aa`, `0x10477a`, `0x10525a`,
`0x10444a`, `0xc96ba`, `0x78b3a` and `0xc9eae`, respectively. The verifier
checks these float defaults against the snapshot allowing its printed
three-decimal rounding, not arbitrary gameplay calibration.

`tools/verify-movement-recheck.py` is hash-pinned for numeric execution and
rejects unexpected instruction paths. Read-only disassembly remains usable
on changed builds; old offsets cannot silently become new numeric evidence.
Its generated fixture has **782 samples**:

- 720 acceleration outputs: five weapon speeds, three stances, two tagging
  wish-speed factors, three surface-friction factors, four initial velocities,
  and two timesteps. Pawn/weapon/water-state lookups and dot/min/max helpers
  are supplied. The complete `Accelerate` arithmetic/control-flow region is
  `0xaaf850..0xaafdb5`; scoped, water and moving-ground branches are excluded.
- 42 friction outputs: seven speeds, three surface factors and two timesteps.
  The sub-0.1-u/s early exit is exercised at `0xabdebc`; the grounded drop
  block is `0xabdefc..0xabdf64`, velocity retention is
  `0xabe0b7..0xabe123`. Ground support, initial speeds and the additional pawn
  friction multiplier (1) are supplied. This is not native contact tracing.
- Five duck input/cap outputs from `0xabb4e8..0xabb53b` at raw duck amounts
  0, .25, .5, .75 and 1. Input components and the maximum speed are scaled
  by the same factor. Duck-transition scheduling/hulls are not emulated.
- 15 walk-cap outputs from `0xab5b65..0xab5b8d`, covering both sides of
  the cap-plus-25 threshold, including equality. The preceding native vector
  length helper `0x24f840` includes all three velocity components; pawn
  velocity retrieval itself is not emulated.

Valve's published [Source SDK movement code](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp)
was consulted as architectural context only. None of the current-build
numerical claims above are based on SDK analogy.

## Corrections

1. **Contact friction.** The old motor ignored existing explicit
   `solid`/`ramp` traversal friction. Ground friction and acceleration now
   receive the support factor, defaulting to 1 when not supplied. Native
   acceleration reads surface friction at `0xaafb75`; friction reads it at
   `0xabdf14`. A 215-u/s release at 1/128 s retains about 206.265625 u/s on
   factor-1 contact and 210.6328125 u/s on factor-.5 contact. No material-name
   heuristic or guessed Dust2 surface coefficient was added.
2. **Very low speed.** Native ground friction exits below .1 u/s rather
   than applying an 80-u/s minimum drop to every nonzero velocity. The same
   cutoff now precedes friction. It does not add a new stopping impulse.
3. **Walk activation.** The native walk cap applies only when the current
   three-dimensional speed is strictly below `weaponSpeed * .52 + 25` u/s.
   The cap and comparison use float32 rounding to match the equality branch.
   The separate acceleration stance still follows the walk button and its
   verified five-unit taper. Damage tagging remains a grounded modifier.
4. **Airborne stance.** Previously, air steering always received full weapon
   running speed, ignoring crouch/walk command scaling. It now receives the
   same untagged stance cap as the native input block. Existing airborne
   momentum is not multiplied down when crouch is pressed, and tagging does
   not become airborne drag. This corrects a supplied input, not the entire
   native air integration algorithm.
5. **Jump inputs/state.** Saved pre-landing horizontal momentum is restored
   only for an accepted, supported bhop, before the new air command. Previously
   an already-airborne near-landing press could restore it without jumping,
   and a supported press discarded fresh steering by overwriting the resulting
   velocity. These are shared-motor state-order regressions, not new native
   trajectory measurements. Held jump, spam rejection, centered window and
   existing timestamped-edge behavior remain unchanged.
6. **Jump impulse precision.** Use the current registered 301.9933776855469
   u/s literal instead of rounded console text 301.993. Gravity remains 800.

Existing weapon acceleration, raw duck-amount movement scaling, counterstrafe
direction, gradual braking, normalized diagonal commands, duck fatigue,
standing clearance and ballistic coordinate model are retained. No
velocity-based accuracy thresholds or weapon data were changed.

## Integration and limits

The parent's existing `world.native` argument in the support/vertical query
was preserved. No collision production file was edited. The only collision
test edit replaces uncrouched/crouched air-velocity equality with its actual
anti-exploit condition: crouching must not grant extra acceleration.

Explicit support friction works for authored terrain and supported jump
takeoff. Native-map surfaces currently need the parent to supply a contact
factor; this patch does not infer one from materials. Native inherited surface
friction throughout unsupported flight is not represented as actor state.

Native air acceleration uses half-step contributions and extra acceleration/
displacement bookkeeping (`0xaaff40..0xab01b9`, caller near `0xadc348`), while
the trainer still uses a simplified velocity update and displacement. Its
12-coefficient formula was not retuned from a single intermediate native
value. Exact subtick input scheduling, analog command magnitude, slope/base
velocity semantics, step/edge/contact resolution, crouch hull timing,
water/ladder control, moving support velocity and complete jump/landing
trajectories remain unverified. Existing landing-factor fixtures are still
older-build isolated arithmetic; this audit does not certify their current
timestamp selection or the full jump motor.

This is **not exact CS2/Dust2 movement parity**. Complete native movement
proof would need synchronized trajectory/contact/input observations in an
authorized offline capture, with no process hooks or in-game automation.
Route occupancy and cover corrections remain with the parent.

## Reproduction and validation

```powershell
python tools/verify-movement-recheck.py
python tools/verify-movement-recheck.py --rva 0xaaf850 --size 0x565
python tools/verify-movement-recheck.py --rva 0xab5b65 --size 0x28
npm test -- --run src/range/movement-native-recheck.test.ts src/range/actor-physics.test.ts src/range/native-movement.test.ts src/range/actor-jump.test.ts src/range/actor-collision.test.ts src/range/actor-contact.test.ts src/range/terrain.test.ts src/range/duel/movement-parity.test.ts
npm run build
```

Numeric verification: 782 samples passed. Expanded focused suite: 8 files,
133 tests passed. Build passed with the existing large-chunk warning.

The initial complete `npm test -- --run` had 3159 passes / 12 failures.
One stale air-crouch equality assertion has since been corrected and passed.
The other movement assertion is outside this worker's ownership:
`src/range/tagging.test.ts`, "combines tagging with walking and crouching
caps", expects an immediate walk cap while starting at 225 u/s. The native
gate leaves that first tagged slice at 225 * .3 = 67.5 u/s; the following
slice is below the walk gate and caps at 225 * .52 * .3 = 35.1 u/s. Its
fully crouched case still caps at 225 * .34 * .3 = 22.95 u/s. The new focused
test covers both walk slices; the parent must update the old assertion or
start its actor below the walk gate.

The complete run also reported 10 prefire route/cover/population/session
failures in parent-owned files. No route positions, cover margins, population
expectations or collision placement were altered to make those tests pass.
Parent changes continued in the shared dirty tree during the audit. The final
`npm run check` completed with **3168 passes / 5 failures**, so it did not
reach its build step; the standalone build was run separately and passed.
The remaining failures at that check were:

- The stale high-speed walk/tagging assertion described above.
- `prefire/native-collision.test.ts`: expected 8 routes, found 24.
- `prefire/session.test.ts`: authored moving bot remained stationary.
- `prefire/routes.test.ts`: B doors full-speed steering stalled toward Source
  waypoint `[-564, 2090, -118]`, 4.544503 metres from the waypoint.
- `prefire/routes.test.ts`: Mid doors / CT cross exposed the 64-unit cover
  margin at offset `[64, 0]`.

These are reported for the parent, not suppressed. The full project check
is not claimed green, and no browser/native whole-trajectory parity test was
performed by this worker.

Changed paths: `src/range/actor-physics.ts`,
`src/range/actor-collision.test.ts`,
`src/range/movement-native-recheck.test.ts`,
`src/range/native-movement-recheck-fixture.json`,
`tools/verify-movement-recheck.py`, and this document. Existing unrelated
dirty work was preserved. No commit, push, deploy or packaging was performed.

## Final Parent Integration

The concurrent snapshots above are superseded by the parent integration:
`npm run check` passes 129 files / 3,181 tests and the production build. The
tagged walk fixture now checks both native-gated slices; route starts/connectors
and old roster assertions were corrected without weakening native concealment,
continuous walking or motor tests. A fresh verifier run again matches all 782
installed-build arithmetic samples. Complete contact/subtick trajectory parity
is still unverified; passing these checks does not establish exact CS2 movement.
