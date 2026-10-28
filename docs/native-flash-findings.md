# Native Flashbang Findings

Research completed 2026-10-28. Static-file inspection and isolated arithmetic
fixtures only; no application changes, process attachment, game-memory reading,
DLL loading, hooks, or live-game execution. No old CS:GO formula was used.

## Provenance

- Installed `game/csgo/steam.inf`: ClientVersion/ServerVersion **2000935**,
  PatchVersion **1.41.9.2**, SourceRevision **11162119**,
  VersionDate Oct 22 2026, VersionTime 14:13:16.
- `game/csgo/bin/win64/server.dll` SHA-256:
  `2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c`.
- Preferred image base `0x180000000`; **all addresses below are RVAs**.
- Extraction: `research/native-flash-audit.py`, pefile and Capstone, reading
  installed bytes. Python: Blender 5.2's bundled Python; modules in
  `.local-tools/analysis-python`.
- Arithmetic verification: `research/native-flash-replay.py` copies sections
  into Unicorn's isolated emulated memory. Actual x64 arithmetic is replayed;
  time lookup/network-dirty callbacks are stubbed, eye/view inputs supplied.
  This is not a DLL loaded/executed by Windows and not measured gameplay.

## Verified Call Chain

| Stage | RVA |
| --- | --- |
| Flash constructor installs primary table | `0x3ac57b` -> `0x17cd908` |
| CFlashbangProjectile primary table, slot 309 | `0x17cd908 + 309*8` -> `0x3aaeb0` |
| Detonate passes strength float 3 | `0x3ab028`; call `0x3ab074` -> `0x3ad840` |
| Radial flash -> visibility helper | `0x3ada10` -> `0x3ad2d0` |
| Distance/facing arithmetic | `0x3ada63` through `0x3adc93` |
| Blind virtual call, alpha 255 | `0x3adcc3` through `0x3adcde`, slot 410 |
| Concrete CCSPlayerPawn table, slot 410 | `0x179a8d8` -> `0x1faf60` |
| Concrete wrapper preserves args and tail-calls base | `0x1fafbf` -> `0x1fafd0` |
| Base player state update | `0x1fafd0` through `0x1fb20f` |

Evidence: `native-flash-entry.log`, `native-flash-radius.log`,
`native-flash-classes.log`, `native-flash-player-wrapper.log`,
`native-flash-helpers.log` (all under `research/`). Existing constructor evidence
is `research/native-grenade-contact.asm`.

## Actionable Formula

The radial routine adds **1 Source unit to explosion Z** (`0x3ad8a4`,
`0x3ad8b5`). Use the adjusted point consistently for eye distance, facing and
visibility. Candidate radius is **3000 Source units**, loaded at `0x3ad95b`
and `0x3adf3d` from file-initialized float `0x1dae828`.

For an eligible player and positive visibility V:

```text
P = explosionOrigin + (0, 0, 1)       // Source coordinates: Z up
D = length(P - eye)                  // full 3D eye distance, Source units
Q = 3 - D * (3 / 3000)               // preserve native float32 order
if Q <= 0: no flash
C = dot(viewForward, normalize(P - eye))

if      C >=  0.6: hold = Q * 1.25 * V; fade = Q * 2.5  * V
else if C >=  0.3: hold = Q * 0.8  * V; fade = Q * 1.75 * V
else if C >= -0.2: hold = Q * 0.5  * V; fade = Q * 1.0  * V
else:             hold = Q * 0.25 * V; fade = Q * 0.5  * V

// Fresh, non-overlapping flash:
blindUntil = now + hold + fade * 0.5
blindStart = now
flashDuration = fade / 1.4
flashMaxAlpha = 255
```

Distance division: `0x3ad91b`; Euclidean distance: `0x3ada63` to `0x3adab9`;
dot: `0x3adbf9` to `0x3adc1d`; bands: `0x3adc22` to `0x3adc85`;
visibility multiplies: `0x3adc8e`, `0x3adc93`. View-forward helper `0x1475f80`
uses eye pitch and yaw, so a horizontal-only comparison is not equivalent.

Facing bands are discrete, not a smooth cosine exposure curve. Dot thresholds
correspond to approximately **53.13, 72.54, 101.54 degrees** off the eye-to-flash
direction; equality takes the stronger band. Native thresholds are float32
`0.6000000238418579`, `0.30000001192092896`, `-0.20000000298023224`.
Zero-length normalization produces zero direction (third band), not front-facing.

At the project's 0.0254 m/Source-unit conversion the radius is **76.2 m**, not
30 m. The DLL proves 3000 units, not the SI conversion itself. At D >= 3000
the verified arithmetic produces no positive effect. Broad-phase boundary
details are not established.

### Practical Numbers

Fresh flash, direct visibility, limiting near-zero **nonzero** distance:

| Facing C | Raw hold s | Raw fade s | Network flashDuration s | blindUntil-now s |
| --- | ---: | ---: | ---: | ---: |
| >= 0.6 | 3.75 | 7.5 | **5.357143** | 7.5 |
| >= 0.3, < 0.6 | 2.4 | 5.25 | **3.75** | 5.025 |
| >= -0.2, < 0.3 | 1.5 | 3 | **2.142857** | 3 |
| < -0.2 | 0.75 | 1.5 | **1.071429** | 1.5 |

Strongest facing band, direct visibility:

| Eye distance units | Project metres | Network flashDuration s |
| ---: | ---: | ---: |
| 500 | 12.7 | **4.464286** |
| 1000 | 25.4 | **3.571429** |
| 2000 | 50.8 | **1.785714** |
| 2999 | 76.1746 | about **0.001786** |
| >= 3000 | >= 76.2 | **0** |

These are network duration values, **not proven opaque-white plateaus**.
The player routine divides raw fade by float32 1.4 at `0x1fb094`.
`player_blind` publishes **m_flFlashDuration**, not raw fade or blind-until,
at `0x3adeea` through `0x3adefc`.

Schema records identify the state members:

| Member | Offset | Schema record / name string |
| --- | --- | --- |
| m_blindUntilTime | `0xd38` | `0x1da6150` / `0x1797b00` |
| m_blindStartTime | `0xd3c` | `0x1da6170` / `0x1797b18` |
| m_flFlashDuration | `0xe04` | `0x1da6250` / `0x1797bb0` |
| m_flFlashMaxAlpha | `0xe08` | `0x1da6270` / `0x1797bc8` |

See `native-flash-types.log`, `native-flash-apply-links.log`. Base update
additions/stores are `0x1fb025` to `0x1fb126`.

### Overlap

Not additive. Preserve the later old/new blind-until deadline and reset
blind-start to now. On the active-blind branch, network duration becomes
`max(newFade/1.4, oldBlindStart + oldFlashDuration - now)`; alpha becomes
max(old,new). If chosen duration equals the old value, the routine adds 0.01
before storing. The branch condition is **now > oldBlindUntil**, not network
duration expiry. Source: `0x1fb0b9` to `0x1fb1ed`, max helper `0x1783a0`.
The replay verifies a weaker flash after one second preserves the stronger
deadline and remaining network duration.

## Visibility

`0x3ad2d0` rejects a non-player check and player state `+0xd40 == 8` (state name
not proved here). It traces eye -> adjusted explosion point. Fraction exactly
**1** returns **V=1** (`0x3ad625` to `0x3ad64e`). If blocked, it tests three
alternate paths. Each successful path contributes **0.16699999570846558**,
literal bits `0x3e2b020c` stored at `0x3ad36a`.

Basis vectors L (lateral) and U (up) are constructed from eye minus explosion
direction by `0x14778c0` and `0x1477b30`. Offset destinations are:

```text
P + U*50
P - L*75 + U*10
P + L*75 + U*10
```

Offsets are Source units, **not target-body samples**. They depend on the
eye/flash geometry, not target facing. L's sign does not affect the paired sides.

Helper `0x3aa880` first traces explosion -> proposed offset, then eye -> the
first trace's reached endpoint (`trace + 0x84`). Only the **second** fraction
must equal 1 (`0x3aa997` to `0x3aa9b0`). Do not simply require both rays clear,
or trace to an offset endpoint on the far side of a wall.

Blocked-direct V is therefore **0, about 0.167, 0.334 or 0.501**, never 1 even
with all three alternate paths successful. Both hold and fade are multiplied by
V; requested alpha stays 255. Up to **7 rays/player**: one direct plus 3 pairs.
Sampling calls: `0x3ad6be`, `0x3ad759`, `0x3ad7d4`; accumulation `0x3ad7d9`.

Specialized filter RTTI: **CTraceFilterNoPlayersAndFlashbangPassableAnims**,
vtable `0x17ce3f0`. Predicate `0x3ae2f0` rejects casts to CCSWeaponBase,
CBaseGrenade and CHostage. Initialization uses mask `0x2800100001`, ORs
exclusions `0x140000`, and passes grenade/target to `0x1d5690`.
See `native-flash-visibility.log`, `native-flash-helpers.log`,
`native-flash-filter.log`. Raw masks do not establish full material semantics.

No separate smoke-density multiplier appears in the radial/visibility helper.
That does **not** prove all smoke behavior inside scene-query internals.

## Verification And Gaps

- `native-flash-replay.log`: **315 arithmetic cases plus an overlap case**,
  checking float32 facing boundaries, distance cutoff and visibility factors.
  V=0 cases test multiplication only: native radial code skips those targets
  before calling Blind. Collision queries themselves are not emulated.
- Concrete player wrapper preserves arguments; when present, its bot callback
  `0x2de170` also updates separate bot decision state. Diagnostic string at
  `0x17b7fe0` names args holdTime/fadeTime/alpha. Bot cognitive timing was not
  fully traced and must not be assumed identical to network duration.
- Exact contents/material/animated-entity policy in scene query `0xc34a20`
  remains unresolved. A trainer collision adapter remains an approximation.
- Client overlay, afterimage, tonemapping and deafening/audio were not traced.
  Server helper `0xace220` has flash-related alpha math, but its client renderer
  use is not proved. Do not infer full-white time from the raw hold argument.
- No live server measurement. Runtime overrides, special view/pawn states and
  broad-phase behavior remain gaps. Static defaults and isolated arithmetic
  are not claims of complete runtime parity.
- App test attempt (`npm test -- --run`) failed before collecting tests:
  sandbox temporary-cache rename EPERM, all 245 files, no tests executed.
  See `research/native-flash-tests.log`; this is not an assertion failure.
- `npm run build` passed (TypeScript and Vite); existing large-chunk warnings
  remain. See `research/native-flash-build.log`. `npm run check` was not repeated
  because it reruns the same app tests/build; app tests remain blocked as above.

Parent can replace arbitrary 30 m/5 s exposure with the verified **3000-unit
linear distance term, four 3D-facing bands, raw hold/fade pair, fade/1.4 network
duration and weighted alternate-path visibility**. Keep the separate timer
meanings and explicitly label geometry/renderer approximations.

## Reproduce

```powershell
$py = 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe'
& $py research/native-flash-audit.py --rvas 0x3aaeb0 --output native-flash-entry.log
& $py research/native-flash-audit.py --rvas 0x3ad840 --size 0x8d6 --output native-flash-radius.log
& $py research/native-flash-audit.py --rvas 0x3ad2d0 --size 0x566 --output native-flash-visibility.log
& $py research/native-flash-audit.py --rvas 0x1faf60 --size 0x2b0 --output native-flash-player-full.log
& $py research/native-flash-replay.py
```

Win64 unwind records split some logical functions into multiple ranges. Explicit
`--size` is needed for a full body, otherwise a dump can stop at the prologue.
