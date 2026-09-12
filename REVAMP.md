# Range Architecture And Asset Pipeline

## Runtime

React renders the application chrome and updates HUD state at 10 Hz. Three.js runs independently through requestAnimationFrame. The simulation uses a bounded 128 Hz accumulator. Long browser suspensions pause instead of emitting a backlog of shots.

The world camera uses 73.739795-degree vertical FOV, equivalent to 90 horizontal degrees at 4:3. Input is 0.022 degrees per raw mouse count times sensitivity; DPI is informational, never multiplied into browser movement counts. A separate 54-degree viewmodel camera prevents world clipping.

The target line stays at z=-100 m. The player starts 12 m away and can walk from roughly 2.2 to 105 m distance. Transfer lanes share depth at x=-2/+2 m. Moving targets reverse at constant configured speed without endpoint easing. This predictable training reversal is not a claim that native counter-strafing has instantaneous acceleration.

Ground movement uses Source wish-direction acceleration/friction and weapon speed caps. Jumping uses gravity 800 u/s^2, impulse 301.993 u/s and air acceleration 12. Subtick command processing, complex hull collisions, jump stamina and networking are omitted.

Shots intersect animated target triangles and static obstacles. Only the required transfer target scores. Head/body classification uses a height threshold, not native CS2 hitbox damage groups. Compensation cues invert recoil around the current target angle, with fixed pixel sizes for distance readability. Decorative architecture is not an additional navigation obstacle.

Each burst is an independent attempt. There is no reload-length lockout; only the native weapon cycle limits actual shot frequency. Touch completes the selected burst. Tracking runs for thirty seconds without entering the shot path. Follow recoil uses the pre-spread trajectory and resets on completion.

## Local Asset Pipeline

The development workspace already contains assets. To reproduce them:

1. Install CS2 locally; set `CS2_PATH` if outside the default Steam Windows path.
2. Put the official [Source 2 Viewer CLI](https://github.com/ValveResourceFormat/ValveResourceFormat/releases) at `.local-tools/vrf/Source2Viewer-CLI.exe`. Release 20.0 was used.
3. Open Blender with Blender MCP listening on localhost:9876. Blender 5.2 was used.
4. Run `npm ci`, then `npm run assets:build`.

The read-only pipeline extracts VPK weapon definitions, native models, first-person gloves/sleeves, weapon-specific idle clips, world idle/strafe clips and shot WAVs. It does not load game DLLs or access a running game.

`art/build_native.py` evaluates native finger/wrist poses and attaches each weapon through its skeleton basis, exporting complete `view-<weapon>.glb` assemblies. The SAS target retains a skinned rig with idle and left/right strafe cycles. Three.js uses skeleton-aware cloning for independent transfer targets.

`art/build_range.py` creates original trusses, columns, baffles, cabinets, lamps and rails in metres. Architecture is independent of target movement.

The optimizer embeds WebP textures and simplifies geometry without a remote decoder. Weapon loads are lazy and same-origin. Editable local workspaces are `art/spraylab-native-workshop.blend` and `art/spraylab-range.blend`. These, raw research, and extracted Valve assets are excluded from Git.

Valve assets remain proprietary. This repository grants no redistribution rights to them. A code build is not sufficient for deployment; run `npm run assets:check` first.

## Validation

`npm run check` runs unit tests plus TypeScript/Vite build. `npm run assets:check` validates weapon/viewmodel GLBs, embedded textures, target animations, thumbnails and WAVs. `npm run test:browser` exercises canvas output, all 17 viewmodels, audio decode, touch bursts, retries, settings/storage failures, tracking, movement, feedback and links.

Actual Brave/Opera GX projects are enabled when isolated binaries exist at `.local-tools/brave/brave.exe` and `.local-tools/opera-gx/opera.exe`. Mobile profiles emulate viewports/input, not physical devices. Windows WebKit may omit Web Audio; the range remains usable without sound.

Imported angular captures need one `{yaw,pitch}` point per magazine round, degrees relative to a zero first shot, plus `weapon`, `source` and `build`. Positive yaw is right; positive pitch is up. Imports stay separate from bundled data.

See [RESEARCH.md](RESEARCH.md) for verified parameters and remaining parity limits.
