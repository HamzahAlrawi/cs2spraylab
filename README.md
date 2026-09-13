# SprayLab

A browser Counter-Strike recoil trainer. React + TypeScript + Three.js, built with Vite. No server, account, telemetry or connection to the game process.

## Run

Requires Node 20.19+ and npm; development uses Node 24.

```sh
npm ci
npm run assets:check
npm run dev -- --host 0.0.0.0
```

Open the URL printed by Vite. Phones on the same network can use the LAN address. Tap the range to fire a selected burst. Desktop controls: mouse firing, WASD, Shift walking, Ctrl/C crouching, Space jumping, R reset, Esc exit. Distance is determined by your position.

**A fresh clone needs assets.** Extracted Valve models, textures and audio are intentionally excluded from this source repository. See [REVAMP.md](REVAMP.md#local-asset-pipeline) for the reproducible local conversion. The development workspace already has these files. Do not deploy an asset-less build.

## Training

- Guided spray, the default: mint NOW and pink NEXT compensation cues.
- Free spray: no compensation assistance.
- Spray transfer: switch from lane A to B at the selected burst's midpoint.

Tracking is retired. Older tracking preferences open Guided spray; previous tracking results remain accessible in history.

Seventeen automatic weapons: AK-47, M4A4, M4A1-S, Galil AR, FAMAS, SG 553, AUG, MP9, MP7, MP5-SD, MAC-10, UMP-45, P90, PP-Bizon, M249, Negev and CZ75-Auto. Scopes and alternate burst-fire modes are not implemented.

Native weapon-specific first-person poses and SAS target animations, colored head/body/miss feedback, moving targets, crosshair editor, follow recoil, replay and local session history are included. Defaults: 800 eDPI, 20% audio, yellow Compact crosshair with 2 px strokes, follow recoil OFF. Existing custom crosshair settings are preserved; selecting Compact applies the updated preset.

All modes show the active weapon's impact pattern on the left backstop and the compensating mouse path on the right. Both are on by default and can be disabled independently in Settings. The mouse path respects inverted Y. These are shape previews at the native firing cadence, not sensitivity-calibrated mouse-distance diagrams; reduced-motion preferences show static paths. The muted backstop keeps the guides readable. Hands and weapons keep their proportions on portrait, ultrawide and stretched-world views.

First-time visitors receive a dismissible animated Settings hint for sensitivity, crosshair and audio. Donate is in the top header beside Settings.

## Architecture

For a data engineer: React is the view layer, TypeScript supplies static contracts, and Vite serves/builds static files. Three.js owns the 3D world and rendering loop. React updates the HUD separately rather than rebuilding the scene each frame.

- `src/range/simulation.ts`: fixed-step movement, target motion, shot timing and drill state.
- `src/range/recoil.ts`: deterministic seed table and angular recoil integration.
- `src/range/engine.ts`: cameras, GLB assets, animation, input, ray intersection and feedback.
- `src/range/viewmodel.ts`, `spray-demonstration.ts`: responsive weapon projection and the world-fixed pattern display.
- `src/range/RangeApp.tsx`: UI, settings, history and replay.
- `src/range/game-data.json`: extracted weapon parameters and build provenance.
- `art/build_native.py`, `art/build_range.py`: Blender asset assembly and original architecture.

The world uses metres, with one Source unit represented by 0.0254 m. Shots are world-space rays, not screen-space dots. Target mesh intersections determine hits. A second camera renders the weapon independently of world clipping. Browser localStorage retains settings/history, with an in-memory fallback when blocked.

Targets preserve their native 1.822 m rifle-idle dimensions. The scale audit corrected an initial-pose resize that made them about 10% too small; asset checks now guard against regression. The custom range is not a recreation of a specific CS2 map. Fullscreen provides a fairer size comparison than an embedded browser viewport.

## Accuracy

Weapon definitions come from installed CS2 build 2000908. The seed generator and recoil recurrence were inspected in that build's offline client binary; every entry of all 17 recoil tables is tested against independent machine-code emulation. The active trainer no longer uses mouse-macro-derived curves. New game builds require revalidating the math and its provenance before updating the bundled snapshot.

**This is not a bit-for-bit CS2 engine reproduction.** Practice bursts reset immediately, without the old artificial reload delay. Partial-burst native recoil-index recovery is not simulated. Browser Euler interpolation, spread RNG/accumulated firing inaccuracy, collision hulls, subtick movement, animation blending and the audio mixer still differ. See [RESEARCH.md](RESEARCH.md) for evidence and limitations.

## Verify And Build

```sh
npm run check
npm run assets:check
npx playwright install
npm run test:browser
npm audit
```

Browser tests cover Chromium, Firefox, WebKit, mobile viewports and optional isolated Brave/Opera GX installations. Physical phone behavior still requires device testing.

Cloudflare Pages serves `dist`; `npm run deploy:cloudflare` explicitly publishes it. Building or pushing this repository does not deploy to [spraylab.pages.dev](https://spraylab.pages.dev/).

On Windows, `tools/package-release.ps1 -Output <absolute-path.zip>` packages tracked source. Add `-IncludeGameAssets` for a local test ZIP containing the converted runtime assets. Both are lean archives without node_modules, Git history, research scratch files or agent notes; run `npm ci` after extraction. Valve-inclusive archives are not uploaded to GitHub by this tool.

## Assets And License

Code follows the repository's existing GPL-3.0 [LICENSE](LICENSE). Original range architecture belongs to this project. Valve character/weapon geometry, animation, textures and sounds are separate proprietary content, not relicensed here. Obtain appropriate rights before redistributing extracted assets. No live memory access, hooks, game input automation or game modifications are used.

Conversion uses [Source 2 Viewer / ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat) and Blender. Older version notes describe archived implementations. The current entrypoint is `src/main.tsx` -> `src/range/RangeApp.tsx`.
