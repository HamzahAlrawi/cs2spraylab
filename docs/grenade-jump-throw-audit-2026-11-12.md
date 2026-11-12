# Stationary Jump-Throw Investigation

## Report And Status

The reported case is Mirage T spawn: back into the corner beside the steps,
aim at the hanging rug, then perform a **stationary left-click jump throw**.
The same setup sometimes succeeds; aiming several degrees higher can change
the outcome. The supplied screenshots identify the reference, not numeric
launch state or input timestamps.

**The reported lineup is not certified fixed by this audit.** No aiming offset,
gravity adjustment, fixed jump velocity or widened timing window was applied.
This iteration adds current-build arithmetic evidence and broader regression
coverage. Identical launch states in a synthetic arena do not establish native
map endpoints, browser event timing or complete CS2 movement parity.

## Installed Authority

Offline static-file inspection and isolated Unicorn arithmetic execution only.
No game process access, DLL loading, hooks or gameplay automation.

- Build **2000943**, patch **1.41.9.7**, SourceRevision **11228971**;
  `steam.inf` VersionDate November 11, 2026, 10:20:41.
- `client.dll` SHA-256:
  `99a6720b29d8b477d55f0a2d7fd4333b5df13f354ba723804e996bead1231aa8`.
- `server.dll` SHA-256:
  `84d596644ad574ac70f427777c89f9006a8023f493c46f4c215f40bceef13cbb`.
- Mirage VPK:
  `e66cdf1ae6a976f6f6ba510a2addd04b25a4c1cfd811f51f1ef13f0954e6e350`.
- Dust 2 VPK:
  `51d6bb432b6553bfae6c38219a527c5de2464a2b107080f2b8be7d8427ebb885`.

Both map VPKs remain byte-identical to the preceding audit. This does not
certify the completeness or runtime behavior of the trainer's collision export.
Historical 2000942 fixtures and their provenance remain unchanged. New 2000943
fixtures live under `tests/fixtures`, outside the runtime source fingerprint.

## Current Native Paths

Locations were found through PE schema references, primary grenade vtable slots,
instruction signatures and Capstone disassembly, not by substituting new hashes
into an old uninspected RVA list.

| Path | Client RVA / Field |
| --- | --- |
| Launch arithmetic | `0x7c14c0..0x7c18ca` |
| Primary grenade vtable | `0x1bcb438` |
| Input, slot 403 | `0x7d15d0` |
| Release scheduler | `0x7d9160..0x7d91f9` |
| Jump capture deadline | `0x8e3b12..0x8e3b61` |
| Movement capture dispatch | `0x8c710e..0x8c7205` |
| Capture vectors | `0x8e1740..0x8e18a4` |
| Cache elapsed-age gate and copy | `0x8c8a7c..0x8c8b2c` |
| Look-ahead predicate | `0x8d46b0..0x8d4722` |
| One-time early release deferral | `0x7d13f3..0x7d145d` |
| `m_fStashGrenadeParameterWhen` | movement `+0x684` |
| `m_grenadeParameterStashTime` | pawn `+0x1f50` |
| `m_bGrenadeParametersStashed` | pawn `+0x1f54` |
| `m_angStashedShootAngles` | pawn `+0x1f58` |
| `m_vecStashedGrenadeThrowPosition` | pawn `+0x1f64` |
| `m_vecStashedGrenadeThrowPawnCenter` | pawn `+0x1f70` |
| `m_vecStashedVelocity` | pawn `+0x1f7c` |

The cache gate still accepts strictly positive elapsed age up to float32(.2).
The jump schedule and release scheduler still use float32(.1). The capture
copies velocity from the pawn getter; it does **not** itself supply a magic
standing/crouched vertical-velocity constant. Native launch retains pitch lift,
the +16-unit hull trace, +/-2.02-unit cube, strength-height offset, .9 velocity
scale and 1.25 pawn-velocity inheritance. There is no basis here for importing
the old CS:GO six-unit hand retreat.

## Executed Checks

```powershell
python tools/verify-native-grenade-latch.py
python tools/verify-native-grenades.py
npx vitest run src/range/duel/grenade-jump-latch.test.ts src/range/duel/native-grenade-launch.test.ts src/range/duel/grenade-native-input.test.ts
```

Both Python tools reject unknown module hashes and select independently audited
build-specific code locations. They preserve the old fixture filenames on the
old build and write separate new fixtures with `--write` on 2000943.

- Ten current native elapsed-age/copy cases execute actual native instructions.
  Elapsed age and cached vectors are explicit inputs, not results of emulating
  the native movement engine or its complete capture scheduler.
- Fifteen current native launch-arithmetic cases execute actual instructions.
  AngleVectors trigonometry and world trace results are explicit stubs. They
  do not prove native hull contact or the source pose supplied by movement.
- Existing trainer arithmetic passes both historical and current fixtures.
- The added trainer integration sweep covers **37 release offsets per stance**:
  12 ticks before takeoff through 24 ticks after takeoff at 128 Hz, approximately
  -94 through +188 ms. Standing and crouching each retain identical launch
  origins and inherited velocities across this sweep. These are 74 synthetic
  throw executions, not 74 native gameplay captures or map landing comparisons.
- An isolated Chromium context also exercised the actual `DuelEngine` mouse
  and Space-key handlers at requested 0, 20, 60, 100, 150 and 180 ms release
  delays. All six produced identical launch origins, directions, strength and
  inherited velocity, with no page errors. The harness substituted a clean
  synthetic-arena simulation between cases; this is a browser input regression,
  not a reproduction or certification of the pictured Mirage corner. Browser
  event delays are requested wall-clock delays, not native subtick timestamps.

The sweep supports the limited conclusion that a one-frame release requirement
was not reproduced in the shared simulation's normal window. It does not rule
out browser input ordering, visual/authoritative pose differences, movement
capture phase, a release outside the native window, or collision divergence.

Validation: `npm run check` passed all 7,036 Vitest cases across 308 files, five
map-admission tool tests, native map source admission, TypeScript and the Vite
production build. The existing large-output-chunk build warning remains. No
production gameplay source or generated asset was changed, and no deployment
was performed.

## Remaining Work

Reproduce the pictured corner through the actual browser adapter and compare
successful and failed throws' starting state, accepted jump time, capture pose,
release time and contact sequence. Verify the complete current native movement
capture phase before changing the source pose or jump integration. Existing
launch-to-rest corpus checks begin at an already-launched projectile and cannot
replace that investigation. Do not label the reported lineup fixed merely
because these timing and arithmetic tests pass.

Valve explicitly describes reliable manual jump throws in
[Side-stepping Skill](https://store.steampowered.com/news/posts/?appids=730&enddate=1724103958&feed=steam_community_announcements).
That establishes the design intent, not a numeric timing fixture. Older
[Memorin jump-throw measurements](https://memorin.app/mechanics/jump-throw) remain
research leads, not installed-build authority or a source of fitted constants.
