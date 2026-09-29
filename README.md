# SprayLab

A browser Counter-Strike recoil trainer. React + TypeScript + Three.js, built with Vite. No server, account, telemetry or connection to the game process.

## Run

Requires Node 20.19+ and npm; development uses Node 24.

```sh
npm ci
npm run assets:check
npm run dev -- --host 0.0.0.0
```

Open the URL printed by Vite. Phones on the same network can use the LAN address. Tap the range to fire a selected burst or one USP-S shot. Desktop controls: mouse firing, WASD, Shift walking, Ctrl/C crouching, Space jumping, 1/2/3 for primary/USP-S/knife, Q for the previous slot, R to reload, Esc exit. Distance is determined by your position.

**A fresh clone needs assets.** Extracted Valve models, textures and audio are intentionally excluded from this source repository. See [REVAMP.md](REVAMP.md#local-asset-pipeline) for the reproducible local conversion. The development workspace already has these files. Do not deploy an asset-less build.

## Training

- Guided spray: mint NOW and pink NEXT compensation cues.
- Free spray: no compensation assistance.
- Spray transfer: switch from lane A to B after a configurable bullet count or after killing A.
- Peeking practice: four cover stations, alternating left/right entries, common angles, deep holds, off-angles and elevated targets. Exposure is sampled independently: 65% left/right half exposed, 15% head-only behind high cover, and 20% open.
- Counterstrafing practice: build lateral speed, brake with the opposite key, then fire one deliberate shot. Its 0-100 score weights entry speed and speed at the shot; stationary-only reps score zero.
- Burst & reposition: six shots per rep, then at least 0.9 m of lateral displacement before the next target.

AI Duel is the first-run default: one to five opponents, configurable skill, weapon pool, health, armor and arena size. Randomized cover positions and covered starts create different routes each round. Bots combine sound cues, visible observations, angle checks, varied peeks and rank-conditioned aim control. The skill labels are training presets, not measured FACEIT equivalents.

Peeking practice starts behind a wall with a near-head pre-aim and a small randomized correction to make. Its target remains shootable for one second after the first shot by default, adjustable from 0.5 to 10 seconds in Settings. Headshots do not end the rep; accurate-shot totals update live until the timer advances to the next angle. Pausing freezes the timer. Precision/burst practice and challenge exposure limits remain 8/1.5 seconds from head visibility. The coach measures reveal-to-shot time, speed at firing, opposite-key braking, head alignment at the stop, angular aim error and mouse correction. Appropriate off-angle correction is not penalized as unnecessary movement, and excess correction is flagged only above 2.4 degrees. Feedback is retained in Session history. These are training heuristics, not measured FACEIT-rank benchmarks. Peeking and repositioning require a keyboard; mobile tap-to-shoot remains available for the other drills.

The three regular spray modes also have four side-lane cover walls for free peeking, with matching movement and bullet collision. The initial central and transfer firing lanes remain open.

Tracking is retired. Older tracking preferences open Guided spray; previous tracking results remain accessible in history.

Seventeen automatic primaries: AK-47, M4A4, M4A1-S, Galil AR, FAMAS, SG 553, AUG, MP9, MP7, MP5-SD, MAC-10, UMP-45, P90, PP-Bizon, M249, Negev and CZ75-Auto. Every loadout also has a suppressed USP-S and a butterfly knife with a custom emerald-style blade finish. Scopes and alternate burst-fire modes are not implemented.

Native weapon-specific first-person poses and SAS target animations, colored head/body/miss feedback, moving targets, crosshair editor, follow recoil, replay and local session history are included. Defaults: 800 eDPI, 20% audio, yellow Compact crosshair with 2 px strokes, follow recoil OFF. Existing custom crosshair settings are preserved; selecting Compact applies the updated preset.

The three spray modes show the active primary's impact pattern on the left backstop and the compensating mouse path on the right. Both are on by default and can be disabled independently in Settings; the other drills and equipment slots hide them. The mouse path respects inverted Y. These are shape previews at the native firing cadence, not sensitivity-calibrated mouse-distance diagrams; reduced-motion preferences show static paths. The muted backstop keeps the guides readable. Hands and weapons keep their proportions on portrait, ultrawide and stretched-world views. Hit captions sit just below the centre crosshair in every mode, with a compact score HUD on short viewports to avoid overlap.

First-time visitors receive a dismissible animated Settings hint for sensitivity, crosshair and audio. "Donate unwanted CS2 skins" is in the top header beside Settings.

Each completed drill rep shows a short verdict below the crosshair, with targeted tips for repeated mistakes. Stationary-only counterstrafe attempts and excess mouse correction receive immediate tips. Common angles favor movement-led pre-aim; unexpected positions still need deliberate mouse correction. Peeking shows a left/right arrow until the exposed head has a clear firing lane. "Settled shots" measures movement readiness; "Accurate shots" counts target hits made while settled. Old history without that intersection displays an unknown accurate-hit count instead of inventing one.

Practice spread includes movement and accumulated firing inaccuracy. Changing drills applies the mode recommendation: OFF for Guided spray, ON otherwise. Users can override it in the range; Duel always applies spread to both sides. Bullet impact size is adjustable from 0.5x to 4x in Settings (default 1.5x), including already-fired marks, without moving their physical coordinates.

## Architecture

For a data engineer: React is the view layer, TypeScript supplies static contracts, and Vite serves/builds static files. Three.js owns the 3D world and rendering loop. React updates the HUD separately rather than rebuilding the scene each frame.

- `src/range/simulation.ts`: fixed-step movement, target motion, shot timing and drill state.
- `src/range/drills.ts`, `drill-scene.ts`, `DrillPanel.tsx`: scenario geometry, coaching evidence and review UI.
- `src/range/equipment.ts`, `equipment-data.json`: loadout slots and extracted sidearm/knife parameters.
- `src/range/recoil.ts`: deterministic seed table and angular recoil integration.
- `src/range/ballistics.ts`: persistent punch, recoil-index recovery and accuracy penalties.
- `src/range/engine.ts`: cameras, GLB assets, animation, input, ray intersection and feedback.
- `src/range/viewmodel.ts`, `spray-demonstration.ts`: responsive weapon projection and the world-fixed pattern display.
- `src/range/RangeApp.tsx`: UI, settings, history and replay.
- `src/range/duel/`: shared-physics combat, perception, tactical AI, animation and scorecards.
- `src/range/lesson-model.ts`, `MovementTutorial.tsx`: interactive movement lessons.
- `src/range/view-animation.ts`, `art/build_reload.py`: native first-person idle/reload clips and deterministic playback.
- `src/range/game-data.json`: extracted weapon parameters and build provenance.
- `art/build_native.py`, `art/build_range.py`: Blender asset assembly and original architecture.

The world uses metres, with one Source unit represented by 0.0254 m. Shots are world-space rays, not screen-space dots. Target mesh intersections determine hits. A second camera renders the weapon independently of world clipping. Browser localStorage retains settings/history, with an in-memory fallback when blocked.

Targets preserve their native 1.822 m rifle-idle dimensions. The scale audit corrected an initial-pose resize that made them about 10% too small; asset checks now guard against regression. The custom range is not a recreation of a specific CS2 map. Fullscreen provides a fairer size comparison than an embedded browser viewport.

## Accuracy

Weapon definitions were re-exported from installed CS2 build 2000918. All 33 exported fields for all 17 primaries are unchanged from build 2000908. The seed generator and recoil recurrence were inspected on that older build; all table entries still match its independently emulated fixtures. The current DLL hashes differ and have not been re-emulated. Weapon data and recoil-math provenance are tracked separately; matching weapon data does not prove that current engine behavior is identical.

**This is not a bit-for-bit CS2 engine reproduction.** Recoil index, punch and accumulated firing inaccuracy now survive trigger release and recover using formulas inspected in the installed client. Only the weapon cycle limits consecutive shots, without an artificial reload delay. Browser Euler integration, recovery update timing, spread RNG, collision hulls, subtick movement, animation blending and the audio mixer still differ. See [RESEARCH.md](RESEARCH.md) for evidence and limitations.

The USP-S uses native magazine, cadence, movement, cone and recovery parameters with the shared persistent punch model; it is not a complete native pistol state machine. The knife has a short-range practice swing, not complete native melee damage, backstabs or inspection animations. Its finish is authored here, not an extracted Gamma Doppler paint kit. Both are available in player slots 2 and 3 in Duel as well as the range. Bot loadouts remain primary weapons.

Selecting a drill applies its recommended spread setting: off for Guided spray, on for the other range modes. The range setting remains adjustable. Duel always applies movement, firing and airborne inaccuracy to both sides. Movement is graded separately, so a lucky moving hit is not a clean rep.

The Fundamentals tutorial introduces stopping, movement-based alignment and cover with interactive exercises. Duel adds a local 50-round scorecard, configurable arena size, directional damage feedback and per-round coaching. Scores are training heuristics, not FACEIT or Leetify ratings. See `docs/learning-combat-audit.md` for sources, measurements and limits.

Tutorial examples begin with reading time and play at 0.35x speed; manual practice uses the same ground-velocity calculation as the range. Results stay visible until the learner continues. The requested sustained crouch-spray chances are 60% at levels 1/2, 33% at level 5, and 2% at level 10; brief fighting crouch taps are 0% through level 3, 10% at level 5, and 33% at level 10. Intermediate levels interpolate. These are encounter choices, not guarantees that a bot survives long enough to perform them.

All 18 guns have native first-person reload clips, retimed to their weapon reload duration, with skinned hands and moving weapon parts. Rebuild with `node tools/build-reload.mjs`, then the normal asset optimization pipeline in `assets:build`. Third-person bot reload gestures and complete event-timed reload audio are not yet implemented. Asset checks verify native hand contact and animated hand travel; only the selected weapon is loaded on demand.

Native audio events are generated with `node tools/import-audio.mjs` (Source2Viewer CLI and FFmpeg required). This converts extracted compressed tracks to actual PCM WAVs and preserves sample variation, event gain/pitch and attenuation knots. It does not reproduce Source 2's whole mixer, distant layers or reverb. `npm run assets:check` validates the complete manifest and sample bank.

## Verify And Build

```sh
npm run check
npm run assets:check
npx playwright install
npm run test:browser
npm audit
```

Browser tests cover Chromium, Firefox, WebKit, mobile viewports and optional isolated Brave/Opera GX installations. Windows Playwright WebKit currently loses visible WebGL output after a canvas resize, also reproduced with a standalone canvas without this app. The resized-canvas visual assertion is an explicit expected failure only on Windows WebKit; framebuffer and interaction checks still run. This does not verify Safari rendering on Apple hardware. Physical phone behavior still requires device testing.

Cloudflare Pages serves `dist`; `npm run deploy:cloudflare` explicitly publishes it. Building or pushing this repository does not deploy to [spraylab.pages.dev](https://spraylab.pages.dev/).

To update the existing Pages project from this asset-complete Windows workspace, run in Command Prompt:

```bat
cd /d C:\Users\Ham\Desktop\cs2-spray-trainer-mvp
npm run assets:check
npm run check
npx wrangler login
npx wrangler pages deploy dist --project-name=spraylab --branch=main
```

Stop if either check fails. Skip login when already authenticated. `main` must match the project's configured production branch; otherwise use that branch to avoid creating only a preview. This uploads the built folder, not the source ZIP. See [Cloudflare's Direct Upload instructions](https://developers.cloudflare.com/pages/get-started/direct-upload/).

On Windows, `tools/package-release.ps1 -Output <absolute-path.zip>` packages tracked source. Add `-IncludeGameAssets` for a local test ZIP containing the converted runtime assets. Both are lean archives without node_modules, Git history, research scratch files or agent notes; run `npm ci` after extraction. Valve-inclusive archives are not uploaded to GitHub by this tool.

## Assets And License

Code follows the repository's existing GPL-3.0 [LICENSE](LICENSE). Original range architecture belongs to this project. Valve character/weapon geometry, animation, textures and sounds are separate proprietary content, not relicensed here. Obtain appropriate rights before redistributing extracted assets. No live memory access, hooks, game input automation or game modifications are used.

Conversion uses [Source 2 Viewer / ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat) and Blender. Older version notes describe archived implementations. The current entrypoint is `src/main.tsx` -> `src/range/RangeApp.tsx`.
