# Grenade Lineup Follow-Up

## Installed Authority

Static-file inspection only. Installed CS2 2000942 / 1.41.9.6, SourceRevision
11206718, November 4. No process access, game DLL loading or hooks.

- `client.dll` SHA-256:
  `9279421852772522121be2f13409dd37436e8c809ff48898c8c3d41b09e77844`.
- `server.dll` SHA-256:
  `70c66e850b2ce72c8c7ca026de6989ef4de7f12dad64ec503645fbd2a7f06d9f`.
- Grenade primary vtable `0x17c7660`, contact slot 163 `0x9ce4b0`, physics
  wrapper slot 228 `0x9cc050`.
- Dry-flight integration `0xe8e9b0..0xe8eb36`; clipping
  `0xe8efa0..0xe8f02a`; ordinary contact/residual block
  `0x9ce9d5..0x9cf007`; residual push helper `0xe8f7d0..0xe8f8e5`.
- Current wrapper `0x9cc11d..0x9cc24e` still subdivides ordinary 64 Hz frames
  into 128 Hz physics calls. Retain this installed behavior; do not substitute
  an external solver's claimed 64 Hz integration rate.

`verify-native-grenade-motion.py` executes eight isolated integration and eight
ordinary contact examples and seven smoke age/speed gates from these static bytes. Engine getters/setters,
support eligibility, trace results and normalization are explicit inputs/stubs.
It is not a complete engine emulator. The fixtures exclude breakables, moving
supports, live contact dispatch and first-spawn scheduling.

## Corrected Defects

1. **Prefire did not install the complete grenade query archive.** Its adapter
   bypassed the content-addressed full-map delivery. The archive installation
   in `map.ts` consequently never ran in Prefire. It did run in Duel and
   Awareness. All three now use the verified full-map delivery and persistent
   asset cache. Regression checks include a thin native Mirage grenade clip
   through the actual browser Prefire adapter, not only standalone collision.
2. **Repeated residual restitution.** The previous generic four-contact loop
   treated every residual hit as another full grenade response. Native ordinary
   floor support uses one residual push. The wall branch performs one residual
   push; when that trace's fraction is strictly below .5 it clips the remaining
   displacement and pushes again. That second clip does not replace stored
   velocity or multiply it by .45 again. The native fixture tests include .2,
   .5 and .7 secondary fractions and supported/unsupported floor responses.
3. **Integration precision.** Gravity, velocity updates and movement deltas now
   use native float32 arithmetic in Source units, with metre conversion at the
   API boundary. Gravity/elasticity/pitch were not fitted to endpoint errors.
4. Saved authored bot setups are regenerated using the complete grenade query
   world and the new kernel fingerprint. Their replay test installs the same
   query world; a sliced chunk replay can no longer falsely certify the setups.
5. **Premature removal of legitimate high throws.** Live simulation and replay
   discarded every projectile at eight seconds. In the recorded corpus, 53
   Dust 2 and six Mirage throws had not yet reached rest at that time. All 59
   now remain alive and settle. Current smoke think `0x9d4721..0x9d4793` only
   dispatches normal detonation at the age/speed gate; it does not introduce an
   eight-second expiry. Native-executed cases include moving smoke at 8, 12 and
   30 seconds. The bot's eight-second candidate search budget is independent
   of live lifetime and stays unchanged. Bounded projectile counts and round
   reset remain; escaped-world cleanup is not claimed native.

## Measured External Cross-Check

Secondary evidence: numeric launch/rest records in
[CS2 smoke solver validation data](https://github.com/NC1107/cs2-smoke-solver/tree/7ebba5b0443292886d2b2134e67b44736752d82d/data/validation).
The local ignored corpus pins that repository revision. The September 9 records
identify server build **2000908**, not the installed 2000942. They are useful
regressions, **not matched-build certification**. No external simulator code,
fitted constants or game binary/geometry is copied into this repository.

For 424 detonated Dust 2 launch states and 180 Mirage launch states:

| Map | Median rest error (units) | 90th Percentile | Maximum | Within 8 units | Unsettled |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dust 2 | 0.043 | 0.335 | 426.69 | 422 / 424 | 0 |
| Mirage | 0.037 | 0.125 | 117.11 | 179 / 180 | 0 |

The preceding kernel already had similar median errors; these corrections are
not advertised as a broad measured accuracy improvement. Three large outliers
remain. Their older geometry/entity state and trace normals need resolving;
do not hide them, weaken thresholds, or nudge their landing points. These
replays start from recorded projectile position/velocity and do not test a
human's mouse reference, movement, release clocks or native smoke volume.
Before removing the expiry, the corresponding counts within 8 units were
370/424 and 173/180, with 53 and six unsettled throws. Missing endpoints count
as failures; never compute a success rate from only the finite-error subset.

## Reproduce And Diagnose

```powershell
python tools/verify-native-grenade-motion.py
npm run audit:grenades -- --map=de_mirage --input=research/throws.json --out=research/throw-report.json --max-error=8
```

Input is a JSON object with `map` and `cases`, or a JSON/JSONL array of records.
Each case has `id`, `position`, `velocity`, `expectedRest`: three-element arrays
in native X/Y/Z-up Source units. Include the capture's game `build` or
`serverBuild`. The command also accepts the secondary corpus's explicit
`Pos`/`Vel`/`RealRest` fields. It performs no downloads or game access.
The report pins source file hashes, native archive build, world and snapshot
hashes, kernel identity and each contact. It stops at first physical rest.

To validate a manual Window/door lineup, retain its exact native feet position,
pitch/yaw, button strength, crouch/jump/run input times and native trajectory
capture from the same game build/map revision. The user's specific failures
are not reproduced merely by passing the arithmetic fixtures or the older
external launch-state corpus. Rapier query numerics, dynamic/breakable states,
first-spawn scheduling, command-phase capture and browser smoke bloom still
prevent a justified claim of universal exact CS2 lineup parity.

## Validation

- `npm test -- --run`: 307 files / 6,992 tests passed.
- `npm run build`: map admission, TypeScript and production build passed. The
  existing large-bundle warning remains.
- `npm run maps:test`: five passed; tool extraction tests: 84 passed.
- Offline current native references: 15 launch, ten latch and 23 motion/contact/
  smoke-gate cases passed.
- Desktop and mobile Chromium exercised all six Mirage Prefire routes, the
  supplemental grenade clip, six-chunk Duel setup and switching back to Dust 2.
  A separate desktop browser check passed left/right/combined-button throws.
- Mirage basic native map audit: 212 cases without findings. Its new Beta proof
  retains full native-capture, dynamic-state and expert-review limitations;
  this is not full map acceptance or lineup certification.
