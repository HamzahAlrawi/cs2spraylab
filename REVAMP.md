# Range Architecture And Asset Pipeline

## Runtime

React renders the application chrome and updates HUD state at 10 Hz. Three.js runs independently through requestAnimationFrame. The simulation uses a bounded 128 Hz accumulator. Long browser suspensions pause instead of emitting a backlog of shots.

The world camera uses 73.739795-degree vertical FOV, equivalent to 90 horizontal degrees at 4:3. Input is 0.022 degrees per raw mouse count times sensitivity; DPI is informational, never multiplied into browser movement counts. The separate viewmodel camera converts a 68-degree horizontal reference at 4:3 to vertical FOV. Its bottom-right viewport clamps aspect to 4:3..16:9, preserving weapon/hand proportions on portrait, ultrawide and stretched-world displays.

The target line stays at z=-100 m. The player starts 12 m away and can walk from roughly 2.2 to 105 m distance. Transfer lanes share depth at x=-2/+2 m. Moving targets reverse at constant configured speed without endpoint easing. This predictable training reversal is not a claim that native counter-strafing has instantaneous acceleration.

Target GLBs retain native metre-scale transforms. Never resize them to a nominal player height using initial pose bounds: the 2.039 m loading bounds previously shrank the actual 1.822 m idle player by 10.26%. `tools/verify-scale.mjs` checks the shipped animation against independent native dimensions. The custom architecture shares the same world units but is not a replica of a particular CS2 map.

Ground movement uses Source wish-direction acceleration/friction and weapon speed caps. Jumping uses gravity 800 u/s^2, impulse 301.993 u/s and air acceleration 12. Subtick command processing, complex hull collisions, jump stamina and networking are omitted.

Shots intersect animated target triangles and static obstacles. Only the required transfer target scores. Head/body classification uses a height threshold, not native CS2 hitbox damage groups. Compensation cues invert recoil around the current target angle, with fixed pixel sizes for distance readability. Decorative architecture is not an additional navigation obstacle.

Each primary burst is recorded as an attempt, but recoil and firing inaccuracy persist between trigger presses and decay over simulation time. There is no reload-length lockout; only the native weapon cycle limits actual shot frequency. Touch completes the selected burst. Guided spray, Free spray and Spray transfer are retained alongside Peeking practice, Counterstrafing practice and Burst & reposition. Retired tracking settings migrate to Guided spray without deleting or relabeling historical tracking results. Follow recoil uses the recovering pre-spread trajectory.

Two world-fixed backstop displays animate the active weapon's impact pattern and inverse mouse path at its firing cadence. Both default on with separate Settings toggles. Mouse compensation is linear in angular mouse counts, not a mirror of the perspective-projected impact plot; inverted Y flips its vertical component. Paths are normalized shape previews and do not alter shots, scoring or impacts. Reduced-motion preferences disable path and first-visit hint animation. The Settings hint is shown once, only when no saved settings exist, with safe storage fallbacks.

## Drill And Equipment Contracts

`drills.ts` produces four fixed peeking stations and randomized targets. The regular spray modes use four additional side-lane walls from `RANGE_WALLS`. Rendering, ray occlusion, head-visibility probes and horizontal hull collision consume the same cover boxes. Elevated targets use an explicit platform and target-relative head height. Native target dimensions are unchanged. Cover collision is an axis-resolved training approximation, not a native stair/step/hull solver.

`DrillCoach` samples movement at 128 Hz. The accuracy threshold is 34% of the held weapon's unmodified running cap, with feet grounded. Counter-strafe evidence requires an opposite lateral input while moving above that threshold, a subsequent threshold crossing, and a first shot within 350 ms. Pausing clears braking evidence. Stop alignment uses a nominal 0.115 m head radius; actual scoring still uses the rendered target mesh. Mouse travel is advisory: initial reveal error is subtracted before reporting excess correction. These thresholds are authored coaching choices, not professional-player measurements.

Precision ends after one shot; reposition bursts end at exactly six total shots, including partial trigger presses. A clean burst needs at least four hits and settled movement for all six shots. Peeking has no headshot/five-shot completion limit: its configurable 0.5..10 s window starts at the first shot (default 1 s), permits repeated magazines, and advances immediately at expiry. Accurate-shot totals are live. The coach persists first-shot timing/aim metrics and aggregate hit/accuracy counts. Precision/burst feedback lasts at least 1.4 s; peeking feedback persists into the next angle. Burst progression additionally needs 0.9 m lateral displacement in the previous firing frame. Precision/burst exposure timers start at line of sight. All timers pause with the simulation. Drill summaries are validated when loaded from localStorage.

Slots 1/2/3 hold the chosen primary, USP-S and butterfly knife; Q restores the previous slot. Each is lazy-loaded through the existing bounded three-assembly cache. Active switches have a one-second draw period, while paused previews render immediately. The USP-S retains its 12-round magazine across swaps, fires once per press, and reloads in 2.2 s. Swapping cancels its reload. Knife swings produce short-range feedback but do not enter bullet/drill statistics. The knife is a simplified practice interaction with a 48-unit ray reach and 0.4 s swing interval, not native melee simulation.

The coach occupies a separate desktop column or scrollable mobile strip, never the aiming canvas. Shot text is centred 28..40 px below the screen-centre crosshair. A range-height container query compacts the score HUD below it on short viewports. Original spray guidance is hidden in the new drills and while holding secondary/melee equipment.

Peeking exposure is 65% lateral half-cover (split equally left/right), 15% head-only behind high cover and 20% open. Cover edges are aligned from the intended firing lane before being fixed in world space. Head probes and pre-aim account for the exposed side. These are authored scenario proportions, not sampled match statistics.

`settledShots` counts grounded shots below the movement gate; `accurateShots` counts their intersection with actual target hits. Legacy history lacking that intersection retains settled counts and marks accuracy unverified. All modes share the Practice spread toggle and unchanged recoil/shot-direction formula. Regression tests compare guided and peeking shots across all primary weapons and multiple distances.

`rep-feedback.ts` selects a short in-range verdict and adds a targeted tip after three matching mistakes in the same mode. It remains visible for four seconds unless the user fires or shot-hit feedback is active. The central score is hidden while the verdict is shown to prevent overlap; persistent details remain in the coach and Session history.

## Local Asset Pipeline

The development workspace already contains assets. To reproduce them:

1. Install CS2 locally; set `CS2_PATH` if outside the default Steam Windows path.
2. Put the official [Source 2 Viewer CLI](https://github.com/ValveResourceFormat/ValveResourceFormat/releases) at `.local-tools/vrf/Source2Viewer-CLI.exe`. Release 20.0 was used.
3. Open Blender with Blender MCP listening on localhost:9876. Blender 5.2 was used.
4. Run `npm ci`, then `npm run assets:build`.

The read-only pipeline extracts VPK weapon definitions, native models, first-person gloves/sleeves, weapon-specific idle clips, world idle/strafe clips and shot WAVs. It does not load game DLLs or access a running game.

`art/build_native.py` evaluates native finger/wrist poses, retargets weapon part poses through the actual translated weapon bind root, and attaches each weapon to `character.wpn`. It exports complete `view-<weapon>.glb` assemblies and checks both hand grips against the gun surface. The SAS target retains a skinned rig with idle and left/right strafe cycles. `art/verify_target_grips.py` checks the held rifle at five samples per clip. Three.js uses skeleton-aware cloning for independent transfer targets.

`art/build_range.py` creates original trusses, columns, baffles, cabinets, lamps and rails in metres. Architecture is independent of target movement.

`tools/import-equipment.mjs` extracts suppressed USP-S and knife definitions into `equipment-data.json`, their models, sound samples and native `idle_pistol`/`idle1_butterfly` arm clips. `art/build_equipment.py` reuses the bind-space assembler and authors the emerald blade material. Only the knife's holding hand is checked against the blade/handle surface; its other hand is intentionally free. The shared KV3 reader lives in `tools/kv3.mjs`.

The optimizer embeds WebP textures and simplifies geometry without a remote decoder. Weapon loads are lazy and same-origin; the GPU cache retains three assemblies and disposes evicted geometry, materials and textures. Editable local workspaces are `art/spraylab-native-workshop.blend` and `art/spraylab-range.blend`. These, raw research, and extracted Valve assets are excluded from Git.

Valve assets remain proprietary. This repository grants no redistribution rights to them. A code build is not sufficient for deployment; run `npm run assets:check` first.

## Validation

`npm run check` runs unit tests plus TypeScript/Vite build. `npm run assets:check` validates weapon/viewmodel GLBs, pose/grip metadata, embedded textures, target animations, thumbnails and WAVs. `npm run test:browser` exercises canvas output, all 17 primary viewmodels plus USP-S/knife, responsive framing, audio decode, touch bursts, retries, settings/storage failures, tracking retirement, movement, wall-guide animation/toggles, onboarding, feedback and links. Expansion coverage includes peeking entries, coaching persistence, slot switching, semi-automatic taps and portrait/landscape coach layout.

Actual Brave/Opera GX projects are enabled when isolated binaries exist at `.local-tools/brave/brave.exe` and `.local-tools/opera-gx/opera.exe`. Mobile profiles emulate viewports/input, not physical devices. Windows WebKit may omit Web Audio; the range remains usable without sound.

Imported angular captures need one `{yaw,pitch}` point per magazine round, degrees relative to a zero first shot, plus `weapon`, `source` and `build`. Positive yaw is right; positive pitch is up. Imports stay separate from bundled data.

See [RESEARCH.md](RESEARCH.md) for verified parameters and remaining parity limits.
