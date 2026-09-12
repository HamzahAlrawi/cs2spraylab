# Technical Research / 2026-09-12

## Evidence And Scope

The installed game is client build **2000908**, patch 1.41.8.1, source revision 10981323 (Sep 09 2026). Mining was read-only: VPK resources and offline PE instructions. No game DLL was loaded into a native process, no live process was inspected, and no input automation or anti-cheat bypass was used.

| Primary evidence | Establishes | Does not establish |
| --- | --- | --- |
| Local scripts/weapons.vdata_c, decompiled with Source 2 Viewer 20.0 | Weapon intervals, capacities, speed caps, spread/inaccuracy/recovery parameters, recoil seeds and distributions | A list of bullet impacts or the full firing state machine |
| Local client.dll recoil code | Table generation, lookup wrapping, punch impulses and the 128 Hz recovery recurrence | End-to-end browser/game trajectory equivalence |
| Local tier0.dll, isolated Unicorn emulation | Float-exact shuffled RNG output and complete recoil-table fixtures | Native spread RNG or network shot timing |
| Native weapon, SAS and sound resources | Geometry, bones, first-person grip poses, world locomotion and source shot samples | Source 2 materials, animation blending, mixing or redistribution rights |
| [Valve Source SDK movement](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp) | Wish-direction acceleration and ground-friction structure | Current CS2 subtick, stamina or collision parity |
| [MDN Pointer Lock](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API) and [Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) | Raw/standard input fallback, user-gesture audio restrictions | Hardware/OS-independent input or audio latency |
| [Source 2 Viewer CLI](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md) | Offline VPK/resource conversion | A license for Valve assets |

The decompiled weapon-data SHA-256 is stored in src/range/game-data.json. Binary hashes, RVAs and inspected constants are in src/range/recoil-provenance.json. Offsets apply only to those hash-pinned binaries.

## Recoil Reconstruction

The active trainer no longer reads the legacy mouse-macro curves. It constructs an angular profile from installed weapon parameters:

1. Park-Miller 16807/modulo 2147483647, with a 32-entry shuffle and 40 warmup iterations.
2. Native float32 range conversion. Angle and magnitude each consume a random value, even when variance is zero.
3. Full-auto smoothing retains 45% of the previous angle/magnitude and adds 55% of the new value.
4. The first four full-auto magnitudes are multiplied by 0.75, 0.8125, 0.875 and 0.9375. The suppressed magnitude is retained for the next smoothing iteration.
5. Each mode has 64 entries. The installed lookup masks the shot index with 0x3f, including machine-gun magazines longer than 64 rounds.
6. Angle/magnitude becomes a sine/cosine impulse. The punch cache uses 1/128-second steps, exponential angle damping with coefficient 8, linear angular recovery of 18 degrees/second, and velocity damping with coefficient 4.5.
7. Velocity is integrated with half-step/trapezoidal contributions; tiny velocities below 1/32 are zeroed. The firing trajectory uses a scale of 2.

Relevant RVAs: table generator 0x7a9b80, numeric loop 0x7a9c1b, lookup 0x7abd80 (mask at 0x7abeeb), punch integrator 0x827220 and impulse application 0x835850. tier0 RNG constructor is 0x15ea30 and RandomFloat is 0x15eb10.

The historical [csgo-recoil-dumper](https://github.com/sebastian-nawrot/csgo-recoil-dumper) suggested a candidate recurrence. Its old constants were not accepted as current-game evidence: the installed instructions were inspected separately. The requested [spary.nut](https://github.com/7ychu5/vscript_csgo/blob/0d95be8b1d7955cdd99732267c35fe45444e2762/playmaster/mode/spary.nut) is a CS:GO map-training script, not an authoritative current CS2 angular capture.

### Independent Numeric Verification

tools/verify-native-recoil.py maps the offline PE images into separate Unicorn emulators. It executes only bounded numeric ranges. The two RNG call sites are redirected to the isolated tier0 emulator; resource lookup is skipped and receives the audited weapon parameters. There is no DLL loading, OS import execution or live-game dependency.

The fixtures contain 64 RNG floats and **1,088 angle/magnitude pairs** across all 17 weapons. TypeScript tests require exact equality for every pair, including float32 rounding, smoothing and suppression.

To recheck with the same installed build:

```sh
python -m pip install pefile unicorn
python tools/verify-native-recoil.py
```

The verifier refuses different DLL hashes. --write regenerates numeric fixtures only after hash validation. The complete angular punch recurrence has been inspected, but is not independently emulated end-to-end.

### Recovery Versus Independent Attempts

Within an uninterrupted spray, the generated profile includes the recovered punch recurrence between shots. This is different from preserving weapon recoil index between interrupted bursts.

**Partial-burst recoil-index recovery is not implemented.** Each release/completed burst ends an independent attempt and resets the trajectory. A 400 ms pause is not advertised as native recovery. The inaccurate previous decay behavior and artificial reload-length lockout are removed. Only the weapon's firing interval limits the next shot.

The native client interpolates cached orientations as quaternions; the browser currently interpolates Euler angles. Floating-point transcendental functions and fixed-step shot scheduling can also differ. A native full-magazine impact capture is still needed to establish a measured error bound.

## Installed Weapon Values

Values below use the selected primary/unscoped automatic mode, except M4A1-S uses suppressed mode.

| Weapon | Magazine | Interval (s) | Move cap (u/s) | Recoil seed | Magnitude |
| --- | ---: | ---: | ---: | ---: | ---: |
| AK-47 | 30 | 0.1 | 215 | 223 | 30 |
| M4A4 | 30 | 0.09 | 225 | 38965 | 23 |
| M4A1-S | 20 | 0.1 | 225 | 38965 | 21 |
| Galil AR | 35 | 0.09 | 215 | 51191 | 21 |
| FAMAS | 25 | 0.09 | 220 | 39623 | 20 |
| SG 553 | 30 | 0.11 | 210 | 43500 | 28 |
| AUG | 30 | 0.1 | 220 | 24204 | 24 |
| MP9 | 30 | 0.07 | 240 | 50729 | 21 |
| MP7 | 30 | 0.08 | 220 | 61649 | 16 |
| MP5-SD | 30 | 0.08 | 235 | 61649 | 16 |
| MAC-10 | 30 | 0.075 | 240 | 34079 | 18 |
| UMP-45 | 25 | 0.09 | 230 | 59299 | 23 |
| P90 | 50 | 0.07 | 230 | 6213 | 16 |
| PP-Bizon | 64 | 0.08 | 240 | 36387 | 18 |
| M249 | 100 | 0.08 | 195 | 50310 | 25 |
| Negev | 150 | 0.075 | 150 | 57966 | 20 |
| CZ75-Auto | 12 | 0.1 | 240 | 9788 | 31 |

Damage, range falloff, armor ratio, headshot multiplier, stand/crouch/move/fire/jump/land inaccuracy and recovery transitions are also retained in game-data.json. They are not all simulated. Optional spread uses standing/crouching/movement cones plus spread, but not accumulated firing inaccuracy, native spread RNG, Negev's early-shot spread transformation or airborne accuracy. Spread defaults OFF and is labeled approximate.

## Scale, Movement And Targets

One Source unit is represented by 0.0254 m. Standing eye height is 64 units; crouched eye height is 46. Mouse input is 0.022 degrees per count times sensitivity. DPI is informational and is not multiplied into already-scaled mouse events. Vertical FOV is 73.739795 degrees, equivalent to horizontal 90 degrees at 4:3.

Reference defaults from the [GameTracking-CS2 convar dump](https://github.com/SteamTracking/GameTracking-CS2/blob/master/DumpSource2/convars.txt): acceleration 5.5, friction 5.2, stop speed 80, gravity 800, jump impulse 301.993 and air acceleration 12. This is an extracted snapshot, not a claim about every live server configuration.

The player starts 12 m from a fixed target line and can walk from roughly 2.2 to 105 m. Target movement uses the selected weapon cap, MP9's 240 u/s, or knife's 250 u/s. Target reversals are constant-speed training reflections without easing, not a native acceleration simulation. The backstop and architecture are stationary.

Ground/air wish-direction acceleration, crouching and jumping are included. Subtick input, stamina, native hull collisions, surfing and networking are not. Shots use animated triangles; head/body classification uses height, not native hitbox damage groups. Compensation cues and hits share world-space rays, so distance does not introduce a separate screen-pixel spray multiplier.

## Browser And Asset Review

The user-supplied deployed site was inspected against the restored ZIP. The current range retains inversion, follow recoil, crosshair editing, moving targets, tracking, history and replay. Retired modes migrate to Guided spray. Old history is retained separately; current hit rate is not the legacy composite score.

Native first-person gloves/sleeves are baked in weapon-specific grip poses. The SAS target retains idle and both strafe clips, with its rifle attached through the native weapon bone. Original Blender architecture is independent of the target groups.

A discovered WebKit readiness race was fixed: loading the target alone cannot enable firing before the weapon is ready. Readiness is tagged with the selected weapon so switching cannot inherit the previous weapon's ready state. Raw Pointer Lock falls back to standard lock, then drag aiming. Touch bursts do not require Pointer Lock or Web Audio. Missing/blocked storage and unavailable audio do not stop training.

Automated browser profiles include real isolated Brave/Opera GX binaries, Chromium, Firefox and WebKit, plus portrait/landscape mobile emulation. Pixel checks establish nonblank rendering and motion, not identical graphics. Physical Android/iOS device testing, native spray captures and exact engine parity remain outstanding.

Valve-derived models, textures, sounds, raw research and editable Blender workspaces stay local and are excluded from Git. The original range-kit geometry is included with source. Republishing Valve assets requires the appropriate rights.
