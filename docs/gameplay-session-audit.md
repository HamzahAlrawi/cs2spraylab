# Shared movement, animation and continuous-round audit

Date: 2026-09-28. Installed CS2: ClientVersion 2000918, PatchVersion 1.41.8.5,
SourceRevision 11039926 (`game/csgo/steam.inf`). This app uses static game data
and local asset exports only. No game process, memory or live input integration.

## What changed

- Range and duel share the same actor physics. Air crouch raises the feet by
  the 18-unit hull reduction while reducing eye offset by the same amount.
  Unduck requires full standing clearance. Crouch no longer reduces the air
  acceleration budget, and both modes sweep vertically against prop geometry.
  The grounded flag now drives spread, recovery, coaching, sound and animation,
  including when standing on a raised surface. Render interpolation also runs
  in the original range modes; authoritative aim/impacts stay in world space.
- Duel automatic fire previously rounded every shot interval up to 1/128 s.
  It now carries the remaining cycle fraction exactly as the range does.
  Tap/reload gaps cannot accumulate a catch-up burst. Complete-magazine tests
  compare shot times and recoil directions for all 17 primary weapons.
- The camera and weapon now track a fraction of physical recoil in both modes.
  **0.45 camera and 0.22 weapon fractions are presentation tuning priors**, not
  measured current-CS2 constants. The physical shot ray still uses full recoil
  once. Follow recoil projects the full trajectory through the rendered camera;
  it does not add a second recoil offset. The recovery kernel is unchanged.
- Native eight-way locomotion and crouch-jump clips replace four-direction-only
  blending. Stride speed follows actual velocity. Three native death clips blend
  from the last live pose, with a crouch-compatible entry and floor correction.
  Corpses and the player death camera respect prop tops. This is deliberately a
  lightweight presentation, not a ragdoll simulation or wall-contact solver.
- Rounds automatically restart after 1-3 seconds (default 2). A compact result
  notice replaces the click-to-restart interruption; fullscreen, pointer lock
  and viewport size persist. Escape/blur pause the countdown. Player health is
  independently configurable from 1 to 500, default 100.
- The central wall remains, with varied flanks, cargo, crates, low barriers,
  camp pockets and short returns. Seeded layouts reject overlap, inaccessible
  lanes and disconnected routes. Bots recover from navigation-margin traps,
  look along their approach, and seek real exposure before a committed peek.
  This improves variety but does not establish human-equivalent behavior.

## Static data and source boundaries

Re-extracted `scripts/weapons.vdata_c` from installed `pak01_dir.vpk` and parsed
the exported KV3 with `tools/kv3.mjs`. Compared these 18 normalized fields across
all 17 weapon entries to `src/range/game-data.json`:

`cycle`, `speed`, `stand`, `crouch`, `move`, `fire`, `spread`, `recoilSeed`,
`recoilAngle`, `recoilVariance`, `recoilMagnitude`, `recoilMagnitudeVariance`,
`recovery`, `recoveryFinal`, `recoveryCrouch`, `jump`, `jumpInitial`, `jumpApex`.

All matched; no weapon-data values were changed. This does **not** revalidate
the earlier recoil-DLL emulation, every weapon statistic, engine movement,
damage, interpolation or current recoil-camera behavior. Movement constants
remain the documented prior measurements, not a fresh CS2 executable trace.

References and their scope:

- [Valve's Source SDK movement code](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp)
  explains the hull-origin adjustment for airborne ducking. This is Source 1,
  useful architectural evidence but not proof of current CS2 timing or stamina.
- [Valve's recoil presentation update](https://www.counter-strike.net/newsentry/508485755865137963)
  motivates keeping visible recoil separate from physical shot trajectories;
  the browser's camera fractions above are not extracted from that post.
- [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)
  provides the static Source 2 export pipeline and coordinate-conversion code.
- [Blender Source Tools DMX parser](https://github.com/Artfunkel/BlenderSourceTools/blob/master/io_scene_valvesource/datamodel.py)
  reads the exported version-9 DMX used for the shared death animations.

## Reproducing the animation library

The local `public/revamp/models/duel-motion.glb` contains 40 animation clips and
is approximately 2.56 MiB. Native meshes/textures are stripped from this library;
it animates the existing target rig. It is Git-ignored like the other locally
derived game assets. Do not assume redistribution rights from access to CS2.

Prerequisites:

1. Install CS2 locally. Set `CS2_PATH` if it is not at the usual Steam path.
2. Place Source2Viewer CLI at `.local-tools/vrf/Source2Viewer-CLI.exe` using the
   existing asset-pipeline setup.
3. Use Blender 5.2's bundled Python, or set `BLENDER_PYTHON` to a suitable Python
   executable. The configured default is the installed Windows Blender path.
4. Place the unmodified `io_scene_valvesource/datamodel.py` file from Blender
   Source Tools at `.local-tools/datamodel.py`; retain its upstream license.
5. Run `npm run assets:duel-motion -- --refresh`, then `npm run assets:check`.
   `npm run assets:build` also invokes this refreshed motion export.

The builder exports locomotion from `ctm_sas.vmdl_c`. Shared death clips require
separate `vnmclip_c` -> DMX export. `tools/read-native-motion.py` reads those
channels; `tools/native-motion-conversion.mjs` applies VRF's documented root and
child axis conversion and Source-unit-to-meter scaling. A separately exported
`run_e_rifle` fixture compares root, pelvis, spine and head transforms against
the native glTF export before accepting converted death tracks. This catches
coordinate/scale errors; it is not a complete frame-by-frame animation audit.

## Validation

- Final `npm run check`: 403 unit tests across 35 files passed; TypeScript and
  Vite production build passed. `npm run assets:check` verified all runtime
  models/audio, including 40 motion clips and the native target scale.
- Unit tests cover shared movement parity, air crouch, clearance, platforms,
  vertical collision, automatic cadence, no catch-up firing, camera/shot
  separation, health, countdown pause and death settling.
- 100 seeded layouts are checked for determinism, overlaps, reachability and
  diversity. The 12-seed behavior audit had no zero-shot rounds, multiple routes
  in all 12 rounds, and multiple exposed peek types in 9 of 12 rounds. These are
  regression checks, not an estimate of human realism or FACEIT calibration.
- The broader Chromium/mobile suite passed 43 tests with 13 intentional skips,
  covering the existing range, recovery, expansion, duel, audio and presentation
  paths. Additional round/animation regressions exercise persistent fullscreen,
  pointer lock, unchanged bounds, mobile entry, saved health, paused restart,
  corpse settling, continuous stance and native crouch-jump head height.
  Final targeted Chromium/mobile Chromium/Brave/Opera GX run: 14 passed, six
  intentional skips (the detailed pose/resource suite runs once in Chromium).
  It also checks all selected death variants from standing and crouched poses
  on a raised prop, preventing head-height pops and falling through support.
- Local five-bot profile on RTX 4080, 1656x907 drawing buffer, audio active:
  frame interval p50/p95/p99 4.2/4.3/4.4 ms; CPU work 1.5/2.5/4.8 ms;
  median/p95 draw calls 60/69. One bot: CPU .5/.7/.9 ms, 25 draw calls.
  This is one hardware sample, not a paired performance-improvement claim or
  proof of acceptable performance on an older device.

## Remaining limits

Exact CS2 subtick behavior, stamina, native collision/step handling, full view
animation, foot IK, bone-attached hitboxes and ragdoll/weapon release are not
reproduced. The renderer settles dead airborne actors vertically without their
full pre-death momentum. Bot behavior and FACEIT curves remain hand-tuned;
they are not measured per-rank human distributions. Native art does not make
the browser simulation equivalent to the game. Large JS-chunk warnings and
low-end hardware profiling remain outstanding performance work.
