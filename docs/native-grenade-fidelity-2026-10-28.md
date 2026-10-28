# Native Grenade Fidelity Audit

October 28, 2026. Installed CS2 build **2000935**, patch **1.41.9.2**,
source revision **11162119**. Only static files and isolated arithmetic were
inspected. Nothing attaches to CS2, loads a game DLL, reads a running game or
automates gameplay. The app remains a frontend-only training simulator.

## Source Authority

- Client SHA256: `ccaf4e4926babc052994502b19ec61198a11008a39dce712921b93dd993be9f5`.
- Server SHA256: `2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c`.
- Fresh VPK/CFG fields: `src/range/duel/native-utility-rules.json`.
- Compiled default registrations: `src/range/duel/native-utility-defaults.json`.
- Arithmetic fixtures: `src/range/duel/native-grenade-*-fixture.json` and
  `native-inferno-arithmetic-fixture.json`. No proprietary binary is bundled.
- Existing Dust 2 collision remains pinned to build 2000932. This pass does not
  relabel that geometry as a freshly exported 2000935 map.

## Implemented Corrections

| Area | Change | Primary evidence |
| --- | --- | --- |
| Launch | Native pitch remap, clamped speed, strength-scaled height, forward 16u cube sweep, 1.25 velocity inheritance | client `0x7c7b10` |
| Input | Independent 100ms release clock; smooth strength changes and middle-strength snap; no cosmetic pin-completion gate | client `0x7d7730`, `0x7df2c0`, `0x903580` |
| Collision | 128Hz integration, biased clipping, clamped elasticity, support/slope stop gates, fast floor attenuation; continuous authored hull sweep | server `0x9d1a00`, `0xe94610`, `0x9d3e60` |
| Fuse | Separate native deadline and tick-quantized periodic checks, not a universal detonation-age constant | server `0x9bd730`, `0x3f1eb0` |
| Smoke eligibility | Minimum spawn age 1.188s and <=0.1u/s speed | server `0x9da000` |
| HE | Extracted 99 damage/350u radius, exponential curve, five exposure weights, ordinary blast armor branch | server `0x95ad30`, `0x92bf80`, `0xa8e500` |
| Flash | 3000u reach, four 3D facing bands, clipped alternative visibility paths, hold/fade/network duration and nonadditive stacking | server `0x3ad840`, `0x3ad2d0`, `0x1fafd0` |
| Fire | Spawn-relative two-second raw-damage ramp; incremental parent/child timers and extracted propagation caps/defaults | server `0x358550`, `0x3506bb`, `0x34c290` |
| Presentation | Separate native-parameter HE/flash pools and dropped-model scales; corrected provenance and asset pipeline order | active resource audit |
| Bot setups | Rebuilt against current kernel; stale physics fingerprints rejected; representative collision replays across all eight chunks | `utility-setup-trajectories.test.ts` |

## Remaining Differences

This is not an exact Source 2 grenade port. The remaining differences are material:

- Smoke still uses connected coarse cells and legacy sprite rendering, with an
  approximate bloom/lifetime. Native volume build, voxel dynamics, lighting,
  visibility, bullet turbulence and HE clearing are not fully reproduced.
- Fire terrain projection, random candidate generation, per-flame lifetime
  variation, flame contact volumes and smoke suppression remain adaptations.
  Native timing/defaults do not certify the trainer's placement adapter.
- Grenade contacts with moving entities, breakables, specialized support flags,
  contact damage and complete engine residual-motion handling remain incomplete.
- Native first-think dispatch phase is not measured; the trainer explicitly uses
  nearest outer-tick creation scheduling. No universal 1.625s fuse claim is made.
- HE BodyTarget RNG, fractional obstruction, alternate explosion sources and exact
  entity-shape selection remain simplified. Generic fractional-health handling
  and cross-effect player modifiers are not certified native.
- Flash trace-filter/material semantics, client whiteout/afterimage/compositing,
  native bot cognition and deafening still need separate verification.
- Cosmetic clips remain native assets, not the complete animation/timing graph.
  Automatic post-throw re-equipment timing is still an integration adaptation.
- Decoy shot cadence, lifetime and terminal blast remain trainer approximations;
  this audit did not establish those native branches.

## Reproduce

Use the Blender-bundled Python or a Python with `pefile`, `capstone` and `unicorn`.
Tools use `CS2_PATH` when set and refuse a mismatching pinned binary hash.

```powershell
$py = 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe'
& $py tools/verify-native-grenades.py
& $py tools/verify-native-grenade-input.py
& $py tools/verify-native-grenade-blast.py
& $py tools/verify-native-grenade-flight.py
& $py tools/verify-native-grenade-flash.py
& $py tools/verify-native-utility-defaults.py
& $py tools/verify-native-inferno.py
node tools/build-utility-opportunities.mjs
npm run check
npx playwright test tests/utilities.spec.ts tests/utility-models.spec.ts --project=chromium --project=mobile-chromium
```

Do not regenerate fixtures simply to accept a failure. Reinspect changed code
and source semantics first. Browser and trainer tests establish integration,
not measured equivalence with CS2. Further details: [flight](native-grenade-flight-findings.md),
[HE](native-he-findings.md), [flash](native-flash-findings.md),
[inferno](native-inferno-findings.md), [defaults/input](native-utility-default-findings.md).

## Validation Result

- `npm run check`: **251 test files, 4,834 tests passed**; TypeScript and production build passed.
- Desktop/mobile Chromium: **9 passed, 3 intentionally skipped**. Includes native
  hands/models, throw/loadout controls, pickups, replay/backward seeking, visible
  smoke and growing fire with retained GPU buffers. Screenshots inspected locally.
- All seven pinned native reference/verifier scripts passed against installed files.
- 132 bot setups regenerated across eight chunks; representative per-kind throws
  replayed against each chunk's saved collision and kernel version.
- Existing production bundle-size warnings remain. No broad old-hardware FPS or
  Brave/Opera/Firefox/WebKit parity claim was established by this pass.
- Changelog history retained with a new October 28 entry. No deployment performed.
