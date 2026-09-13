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

The user-supplied deployed site was inspected against the restored ZIP. The current range retains inversion, follow recoil, crosshair editing, moving targets, history and replay. Tracking has since been removed at the user's request. Retired modes migrate to Guided spray. Old history is retained separately; current hit rate is not the legacy composite score.

Native first-person gloves/sleeves are baked in weapon-specific grip poses. The SAS target retains idle and both strafe clips, with its rifle attached through the native weapon bone. Original Blender architecture is independent of the target groups.

A discovered WebKit readiness race was fixed: loading the target alone cannot enable firing before the weapon is ready. Readiness is tagged with the selected weapon so switching cannot inherit the previous weapon's ready state. Raw Pointer Lock falls back to standard lock, then drag aiming. Touch bursts do not require Pointer Lock or Web Audio. Missing/blocked storage and unavailable audio do not stop training.

Automated browser profiles include real isolated Brave/Opera GX binaries, Chromium, Firefox and WebKit, plus portrait/landscape mobile emulation. Pixel checks establish nonblank rendering and motion, not identical graphics. Physical Android/iOS device testing, native spray captures and exact engine parity remain outstanding.

Valve-derived models, textures, sounds, raw research and editable Blender workspaces stay local and are excluded from Git. The original range-kit geometry is included with source. Republishing Valve assets requires the appropriate rights.

## Viewmodel And Guidance Refinement

The native weapon model's `weapon` bind bone is translated, unlike the zero-origin secondary animation skeleton. Using the secondary skeleton's inverse alone left some guns floating above their grips. The importer now retains each weapon's actual bind skeleton, retargets its part pose, and assembles through `character.wpn * inverse(weaponBindWorld)`. Blender bakes the complete hands/gun assembly together. The target's corrected rifle remains bone-parented through all three world clips. Export checks measure authored finger-bone probes against the gun surface on both sides (not a claim of zero mesh intersection).

Viewmodel projection uses a 68-degree horizontal reference at 4:3, converted to Three's vertical FOV. The horizontal-reference convention and separate viewmodel projection are documented in [Valve's Source SDK view setup](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/view.cpp#L988). Visual references include [Valve's CS2 weapon presentation](https://www.counter-strike.net/cs2#weapons) and its [first-person M4 smoke demonstration](https://cdn.fastly.steamstatic.com/apps/csgo/images/csgo_react/cs2/smokes_vid2.webm), viewed as rendered video frames. Weapon-specific idle poses come from the installed assets. This is a Source-style presentation, not a claim that this browser reproduces CS2's complete camera animation graph.

Part bones are evaluated parent-first before baking, with a matrix agreement assertion for every mapped bone. This fixes the Negev ammunition belt: assigning child matrices against stale parent evaluations previously left it looping above the receiver. The target grip verifier samples both strafe cycles as well as idle.

The viewmodel has a square-pixel, bottom-right viewport: 4:3 minimum on portrait screens and 16:9 maximum on ultrawide screens. Stretching the world no longer stretches the hands or gun. The training camera, sensitivity, ray calculations and physical impact locations are unchanged. This portrait adaptation is deliberately not a native CS2 feature.

The left backstop has a repeating active-weapon impact-pattern demonstration in all modes. It uses the current native or imported profile, perspective-projects its angular directions, fits the shape uniformly and traces it at the weapon's firing interval. The right board shows mouse compensation: negative recoil yaw and positive recoil pitch in screen-down coordinates, with the latter reversed for inverted Y. Unlike impact projection, mouse counts are linear in angles. Both boards are labeled shape previews, not metrically sized impact groups or sensitivity-calibrated mouse travel. A test cancels every generated shot across all 17 weapons at two sensitivities and both Y conventions, without spread or target motion.

Both displays default on with independent persisted Settings toggles. They stay fixed to the muted green-grey backstop and stop animating with reduced-motion preferences. NOW/NEXT guides use mint/pink; the yellow Compact crosshair defaults to 2 px strokes. Saved custom crosshairs remain intact. First-time visitors see a dismissible Settings hint; its short arrow animation respects reduced motion and does not repeat after reload. Donate sits in the top header.

The renderer bounds the viewmodel GPU cache to three complete assemblies, disposes evicted resources, and allows revisiting evicted weapons. Browser coverage includes a complete arsenal sweep followed by reloading the initial weapon.

## Player And Map Scale Audit

The September 13 audit found a real target-scale error. Three.js measured the target's initial loading-pose bounds as **2.039217 m**, then the renderer scaled that whole hierarchy to 1.83 m. Independent Blender evaluation of the native SAS rifle-idle clip measured **1.821906 m**. The runtime multiplier `1.83 / 2.039217 = 0.897403` therefore made the standing player about **10.26% too small**, exaggerating the apparent map size. The renderer now preserves the exported native transforms and ground origin, for both the main and transfer targets. No world-distance, sensitivity or impact-coordinate multiplier was changed.

[ValveResourceFormat's coordinate conversion](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/IO/Gltf/GltfModelExporter.Conversion.cs) explicitly converts Source inches to glTF metres using 0.0254. This agrees with the trainer's movement and geometry conversion. The native idle mesh is approximately 71.729 Source units tall; its stance is not identical to a nominal 72-unit standing collision hull. The two authored eyeball bones are at 1.629/1.646 m in this tilted-head idle pose, consistent with the trainer's 64-unit (1.6256 m) standing camera. Camera height is a gameplay reference, not a claim that the camera follows an animated eyeball bone.

`tools/verify-scale.mjs` evaluates the shipped optimized GLB's actual idle animation, checks height against the independent native measurement within 2 mm, and checks the native ground origin. It runs with `npm run assets:check`. Unit tests prevent target-loading code from resizing either clone, verify 64/46-unit camera heights, 90-degree horizontal FOV at 4:3 (106.2602 at 16:9), Source-unit/metre projection equivalence at 5/12/25/50/100 m, and each weapon's steady movement distance per second.

The custom map is 24 m wide with 5 m floor intervals; its 6.1 m roof structure is industrial architecture, not a copied CS2 level. It uses the same metre coordinates as the native assets and movement. There is no single universal CS2 map scale multiplier to apply. A smaller embedded browser viewport also produces fewer target pixels than a full-screen game at the same vertical FOV. Use the existing range Fullscreen control for an equal-resolution comparison; changing player size or sensitivity to compensate would corrupt physical scale. This audit does not establish pixel-perfect agreement with a live CS2 capture.
