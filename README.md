# SprayLab

A browser Counter-Strike recoil trainer. React + TypeScript + Three.js, built with Vite. No server, account, telemetry or connection to the game process.

## Run

Requires Node 20.19+ and npm; development uses Node 24.

```sh
npm ci
npm run assets:check
npm run dev -- --host 0.0.0.0
```

Open the URL printed by Vite. Phones on the same network can use the LAN address. Tap the range to fire a selected burst or one semi-automatic shot. Desktop controls: mouse firing, WASD, Shift walking, Ctrl/C crouching, Space jumping, 1/2/3/4 for primary/sidearm/knife/Zeus, Q for the previous slot, R to reload (hold for slower silent reload), F to inspect, E to use a door or pick up a dropped weapon, G to drop, right click for scope/burst/R8 alternate fire/knife stab, Esc exit. Distance is determined by your position.

**A fresh clone needs assets.** Extracted Valve models, textures and audio are intentionally excluded from this source repository. See [REVAMP.md](REVAMP.md#local-asset-pipeline) for the reproducible local conversion. The development workspace already has these files. Do not deploy an asset-less build.

## Training

- Guided spray: mint NOW and pink NEXT compensation cues.
- Free spray: no compensation assistance.
- Spray transfer: switch from lane A to B after a configurable bullet count or after killing A.
- Peeking practice: four cover stations, alternating left/right entries, common angles, deep holds, off-angles and elevated targets. Exposure is sampled independently: 65% left/right half exposed, 15% head-only behind high cover, and 20% open.
- Counterstrafing practice: build lateral speed, brake with the opposite key, then fire one deliberate shot. Its 0-100 score weights entry speed and speed at the shot; stationary-only reps score zero.
- Burst & reposition: six shots per rep, then at least 0.9 m of lateral displacement before the next target.
- Hearing practice: locate hidden native footsteps/shots on an overhead board. Direction/distance feedback, replay, calibration, native distance curves and headphone/stereo/mono profiles are available beside the drill.

AI Duel is the first-run default: one to five opponents, configurable skill, weapon pool, health, armor and arena size. Six map families (Freight yard, Service lanes, Courtyard, Switchback, Loading bays, Workshop) vary cover, props, routes and covered starts each round. A chosen family still changes its seed. Bots combine sound cues, visible observations, angle checks, varied peeks and rank-conditioned aim control. Recent sightings take priority over unrelated scans; possible re-peek exits widen only as enough travel time passes. Hidden player positions are not queried by sighting memory. The skill labels are training presets, not measured FACEIT equivalents.

The arenas draw from 54 authored cover bundles plus 15 traversal/environment bundles with reserved walkways. New bundles include stairs, ramps, ladder lofts, partner-boost platforms, shallow-water crossovers, use-operated sliding gates, breakable glass/vents and movable cases. Player/bot movement, damage, acoustics and rendering consume the same resolved environment state. Experienced bots can use safe elevated routes and coordinate boosts, trades, entries and crossfires without hidden-player position access. Projected shadow cues are low-cost ground silhouettes, not native shadow maps. Mirrored placement, covered starts and navigation are validated at generation. One/two-bot arenas can be reduced to 0.65 scale without shrinking players or props. Bots travel more quietly in small duels; novice advanced peeks are capped. See [environment mechanics](docs/environment-mechanics-audit.md), [bot tuning](docs/bot-behavior-rebalance-2026-10-02.md) and [integration boundaries](docs/gameplay-integration-audit.md).

Peeking practice starts behind a wall with a near-head pre-aim and a small randomized correction to make. Its target remains shootable for one second after the first shot by default, adjustable from 0.5 to 10 seconds in Settings. Headshots do not end the rep; accurate-shot totals update live until the timer advances to the next angle. Pausing freezes the timer. Precision/burst practice and challenge exposure limits remain 8/1.5 seconds from head visibility. The coach measures reveal-to-shot time, speed at firing, opposite-key braking, head alignment at the stop, angular aim error and mouse correction. Appropriate off-angle correction is not penalized as unnecessary movement, and excess correction is flagged only above 2.4 degrees. Feedback is retained in Session history. These are training heuristics, not measured FACEIT-rank benchmarks. Peeking and repositioning require a keyboard; mobile tap-to-shoot remains available for the other drills.

The three regular spray modes also have four side-lane cover walls for free peeking, with matching movement and bullet collision. The initial central and transfer firing lanes remain open.

Tracking is retired. Older tracking preferences open Guided spray; previous tracking results remain accessible in history.

Thirty-four weapon definitions are selectable, including all ten pistols, four sniper rifles, four shotguns and Zeus x27. Slots 2/3/4 provide a configurable sidearm (USP-S by default), standard CT knife and rechargeable Zeus. Turn off "Carry a primary weapon" in Loadout for pistol-only practice; a Duel pickup can add a primary again. Native definitions supply primary/alternate accuracy, cadence, recovery, speed, scope FOV, pellets and reserves. Scoped rifles, sniper zoom levels, bolt-action unscoping/rezoom, Glock/FAMAS bursts and R8 alternate fire share one action model between range and Duel. Finite-ammo reload states support magazines, interruptible shell insertion and slower hold-R silent reloads. Range objective restocking remains a training policy.

Shots carry residual damage through material-aware cover and subsequent opponents. Duel uses its analytic hit zones; range collaterals use actual target-mesh entry/exit intersections without replacing physical scoring coordinates. Pellet damage consumes armor sequentially, while accuracy and coaching count one discharge. Combat runs locally with immediate input and hit feedback, without simulated network latency or shot rewind. Duel also has a compact rotating radar and independent Kevlar, helmet and armor-condition controls.

The Armory saves local XP, levels, earned credits, purchased cosmetics and equipped choices. Completed AI Duels are the main reward source, weighted by coaching score, actual damaged/killed opponents, skill, outcome, armor, accuracy and player-health handicap. Difficulty has twice its previous per-level XP slope. Credits continue after level 100. Completed drill objectives award smaller rewards. Resets, abandoned rounds, no-damage rounds and duplicate callbacks do not award rewards. Choose purchases from 347 native weapon finishes, 557 knife choices across all 20 special families and stock T, eight glove families and six bot agents. Each new shotgun has ten finishes; Zeus has seven real native pairings instead of invented skins. Stock CT is free. Collections show only owned choices; the knife shop filters to a specific family. Level gates give purchase eligibility, not automatic ownership. Previously earned v1 cosmetics are preserved. Cosmetics never change weapon stats. Progress is browser-local, not a CS2 inventory, account or secured economy. See [the economy details](docs/progression-economy.md).

The Armory includes 42 [achievements](docs/achievements.md) for duels, shooting discipline, all six drills, collecting cosmetics, and player levels. Each shows progress and earned dates, with category/status filters and a nonblocking unlock notification. Badges do not change XP, credits, or weapon stats; existing saves and owned items are preserved.

Native weapon-specific first-person poses and SAS target animations, colored head/body/miss feedback, moving targets, crosshair editor, follow recoil, replay and local session history are included. Defaults: 800 eDPI, 20% audio, yellow Compact crosshair with 2 px strokes, follow recoil OFF. Existing custom crosshair settings are preserved; selecting Compact applies the updated preset.

The three spray modes show the equipped gun's impact pattern on the left backstop and the compensating mouse path on the right, including a pistol-only loadout. Both are on by default and can be disabled independently in Settings; other drills and the knife slot hide them. The mouse path respects inverted Y. These are shape previews at the native firing cadence, not sensitivity-calibrated mouse-distance diagrams; reduced-motion preferences show static paths. The muted backstop keeps the guides readable. Hands and weapons keep their proportions on portrait, ultrawide and stretched-world views. Hit captions sit just below the centre crosshair in every mode, with a compact score HUD on short viewports to avoid overlap.

First-time visitors receive a dismissible animated Settings hint for sensitivity, crosshair and audio. "Donate unwanted CS2 skins" is in the top header beside Settings.

The top Changelog lists unreleased changes since baseline 49d8ea6. Selecting a Loadout weapon with purchased finishes keeps its finish selector open; stock-only selection still closes the panel.

Each completed drill rep shows a short verdict below the crosshair, with targeted tips for repeated mistakes. Stationary-only counterstrafe attempts and excess mouse correction receive immediate tips. Common angles favor movement-led pre-aim; unexpected positions still need deliberate mouse correction. Peeking shows a left/right arrow until the exposed head has a clear firing lane. "Settled shots" measures movement readiness; "Accurate shots" counts target hits made while settled. Old history without that intersection displays an unknown accurate-hit count instead of inventing one.

Practice spread includes movement and accumulated firing inaccuracy. Changing drills applies the mode recommendation: OFF for Guided spray, ON otherwise. Users can override it in the range; Duel always applies spread to both sides. Bullet impact size is adjustable from 0.5x to 4x in Settings (default 1.5x), including already-fired marks, without moving their physical coordinates.

Settings > Game > Graphics includes a Performance preset for older PCs, frame caps and adaptive render resolution. The toolbar gauge toggles a persistent FPS/frame-time counter for the 3D modes, off by default. Automatic quality also reduces visual pose sampling from 60 to 30 Hz after sustained CPU overload and restores it slowly; physics, aiming and shot timing are unchanged. Bullet marks and static fixtures are batched, range shadows are cached, and idle previews render at 15 FPS. Only contributing native animation actions run, distance-only cover rays avoid contact allocations, Duel setup controls are memoized, and repeated-round dropped weapons have one render owner. Desktop pointer-locked range play also reserves Ctrl+W in supported fullscreen browsers; when protection is unavailable, use C to crouch. See [the performance and Deagle audit](docs/performance-and-deagle-audit.md) and [the bot/render performance audit](docs/bot-render-performance-audit.md) for measurements and browser limitations.

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
- `src/range/view-animation.ts`, `art/build_reload.py`: native first-person idle/draw/inspect/reload clips and deterministic playback.
- `src/range/weapon-actions.ts`: scopes, alternate modes, burst state and bolt cycling shared by both simulations.
- `src/range/progression.ts`, `ProgressionPanel.tsx`, `cosmetics.ts`: XP settlement, unlocks and exclusively owned cosmetic materials.
- `src/range/achievements.ts`, `AchievementPanel.tsx`: validated-result badges, persistent counters, progress and filters.
- `src/range/game-data.json`: extracted weapon parameters and build provenance.
- `art/build_native.py`, `art/build_range.py`: Blender asset assembly and original architecture.

The world uses metres, with one Source unit represented by 0.0254 m. Shots are world-space rays, not screen-space dots. Target mesh intersections determine hits. A second camera renders the weapon independently of world clipping. Browser localStorage retains settings/history, with an in-memory fallback when blocked.

Targets preserve their native 1.822 m rifle-idle dimensions. The scale audit corrected an initial-pose resize that made them about 10% too small; asset checks now guard against regression. The custom range is not a recreation of a specific CS2 map. Fullscreen provides a fairer size comparison than an embedded browser viewport.

## Accuracy

Weapon definitions were re-exported from installed CS2 build 2000924. All 35 retained definitions (AUG remains unselectable), primary/alternate recoil tables, four shotgun angle/radius tables, spread transforms and penetration scalar-loss fixtures have fresh offline checks. Current landing-factor arithmetic has 32 hash-pinned server fixtures. Full punch/recovery integration was inspected on build 2000908, and damage-tagging/crouch-fatigue arithmetic remains pinned to server build 2000919. Fresh data does not relabel older audits. See [combat verification](docs/combat-physics-audit.md), [weapons](docs/weapons-combat-audit.md), [terrain/contact](docs/terrain-contact-audit.md) and [integration boundaries](docs/gameplay-integration-audit.md).

**This is not a bit-for-bit CS2 engine reproduction.** Recoil index, punch and accumulated firing inaccuracy now survive trigger release and recover using formulas inspected in the installed client. Only the weapon cycle limits consecutive shots, without an artificial reload delay. Browser Euler integration, recovery update timing, spread RNG, collision hulls, subtick movement, animation blending and the audio mixer still differ. See [RESEARCH.md](RESEARCH.md) for evidence and limitations.

Pistols use native magazine, cadence, movement, cone and recovery parameters with persistent punch and one-shot-per-press scheduling where applicable. The R8 primary windup is a separate 200 ms trainer estimate, not an extracted engine constant. R8 movement is 220 units/s idle or alternate-firing and 180 while cocking the primary trigger. Knife combat includes slash/stab, hit/miss cooldowns and backstabs, using a documented Source-family approximation pending current native fixtures. Zeus uses extracted range, no recoil and 30-second recharge; its special native lethal-distance curve remains unresolved. Bots can equip all selectable weapons or knife. Pickup presentation reuses the native draw clip because there is no exported distinct pickup animation.

Selecting a drill applies its recommended spread setting: off for Guided spray, on for the other range modes. The range setting remains adjustable. Duel always applies movement, firing and airborne inaccuracy to both sides. Movement is graded separately, so a lucky moving hit is not a clean rep.

The Fundamentals tutorial introduces stopping, movement-based alignment and cover with interactive exercises. Duel adds a local 50-round scorecard, configurable arena size, directional damage feedback and per-round coaching. Scores are training heuristics, not FACEIT or Leetify ratings. See `docs/learning-combat-audit.md` for sources, measurements and limits.

Tutorial examples begin with reading time and play at 0.35x speed; manual practice uses the same ground-velocity calculation as the range. Results stay visible until the learner continues. The requested sustained crouch-spray chances are 60% at levels 1/2, 33% at level 5, and 2% at level 10; brief fighting crouch taps are 0% through level 3, 10% at level 5, and 33% at level 10. Intermediate levels interpolate. These are encounter choices, not guarantees that a bot survives long enough to perform them.

Every gun has native first-person draw, inspect, firing and reload clips, including empty-reload variants where available; knives and Zeus have their supported native actions (Zeus does not reload). Skinned SAS hands and weapon parts are retargeted in Blender, with per-frame part-matrix checks. Shell reloads sample native start/insert/finish windows. Rebuild with `node tools/build-reload.mjs`, then `npm run assets:build`. Native pistol/rifle directional movement and crouch/jump poses remain the bot locomotion base; 36 lazy animation-only packs add 219 supported upper-body weapon clips without duplicating character meshes/textures. Native event-timed foley follows reload phases and suppresses silent reload audio. Missing native gestures use the locomotion fallback. Death bodies use lightweight constrained joint physics against arena geometry, not native VPhysics. Asset checks cover hand travel, grip contact, skeletal height and desktop/mobile nonblank moving renders.

Every firearm has a native firing action; all knife families have native draw/inspect/attack presentation. Muzzle sprites use an extracted native texture and follow animated barrel anchors. Hits resolve instantly; short pooled tracers are cosmetic and suppressed weapons produce none. These are browser render approximations, not the complete Source 2 particle system. See [effects and input capture](docs/weapon-fx-audit.md).

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
