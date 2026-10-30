# SprayLab

A browser Counter-Strike recoil and movement trainer with AI Duels and Dust2 Prefire. React + TypeScript + Three.js, built with Vite. No server, account, telemetry or connection to the game process.

## Run

Requires Node 20.19+ and npm; development uses Node 24.

```sh
npm ci
npm run assets:check
npm run dev -- --host 0.0.0.0
```

Open the URL printed by Vite. Phones on the same network can use the LAN address. Tap the range to fire a selected burst or one semi-automatic shot. Desktop controls: mouse firing, WASD, Shift walking, Ctrl/C crouching, Space jumping, 1/2/3/4 for primary/sidearm/knife/Zeus, Q for the previous slot, R to reload (hold for slower silent reload), F to inspect, E to use a door or pick up a dropped weapon, G to drop, right click for scope/burst/R8 alternate fire/knife stab, Esc exit. Distance is determined by your position.

**A fresh clone needs assets.** Runtime models, textures, audio, generated runtime manifests and icons are excluded from Git, including past published asset commits after the October 30 history cleanup. Your local workspace retains its copies. Follow [source-only setup and extraction](docs/source-only-assets.md); the original range and icon are generated from project source, while game media comes from your own CS2 installation. `npm run source:check` guards the source boundary. Do not deploy an asset-less build.

## Training

Every mode now has a skill-specific review with measured evidence, a next-rep action and a repeatable goal. The local scores distinguish shot timing, preparation, recoil control and angle isolation rather than converting hit rate into a rank. Body-focused weapons and unexpected mouse corrections are handled contextually; old unmeasured attempts are not assigned new quality scores. See [coaching criteria and research](docs/skill-coaching.md).

- Guided spray: mint NOW and pink NEXT compensation cues.
- Free spray: no compensation assistance.
- Spray transfer: switch from lane A to B after a configurable bullet count or after killing A.
- Peeking practice: four cover stations, alternating left/right entries, common angles, deep holds, off-angles and elevated targets. Exposure is sampled independently: 65% left/right half exposed, 15% head-only behind high cover, and 20% open.
- Counterstrafing practice: build lateral speed, brake with the opposite key, then fire one deliberate shot. Its 0-100 movement component weights entry speed, speed at the shot and observed braking; stationary-only movement scores zero. The overall quality score also includes opening aim and impact.
- Burst & reposition: six shots per rep, then at least 0.9 m of lateral displacement before the next target.
- Hearing practice: locate hidden native footsteps/shots on an overhead board. Direction/distance feedback, replay, calibration, native distance curves and headphone/stereo/mono profiles are available beside the drill.
- Dust2 Prefire: ten landmark approaches, 24 compatible fixed lineups and 141 source identities across native-validated Weighted pools. Covered starts, full-speed counterstrafed peeks, route-facing holds and optional return fire. Sampling blends 50% physical-family coverage with 50% match-balanced nearby-hold support from 32 competitive matches / 256 complete sampled rounds; these are training weights, not exact corner occupancy rates. Bots per run is configurable from one to five, default four. Completed routes advance by default, with an independent Repeat route option. Optional teammate-death trading uses recognized sight/sound evidence, physical cover lanes and ordinary firing gates in both Duel and Prefire. Opening quality, preparation, isolation and per-angle next steps are measured separately. See [position evidence](docs/prefire-statistics.md), [trading](docs/bot-trading-and-facing.md) and the [reusable map case study](docs/prefire-map-case-study.md) for provenance and limits.

AI Duel is the first-run default: one to five opponents with configurable skill, weapons, health and armor. It now uses random native Dust 2 chunks by default: Long doors/pit, B tunnels/site and Mid doors/CT. Exact-scale map geometry, sourced holding positions, full Duel bots and optional floor route arrows are included without loading the whole map. Under Arena, select a fixed chunk or opt into Generated arenas; only generated arenas expose the size slider. Six generated map families remain available. Bots combine sound cues, visible observations, angle checks, varied peeks and rank-conditioned aim control. Recent sightings take priority over unrelated scans; hidden player positions are not queried by sighting memory. The skill labels are training presets, not measured FACEIT equivalents. See [real-map Duel and rebuild steps](docs/real-map-duel.md).

An equipped empty magazine reloads automatically once attack is released and existing cycle/draw/reload gates permit it; holding attack suppresses idle reload. Native ammo-commit and fire deadlines are preserved. Current closed-engine CS2 idle timing has not been measured live; see the [empty-magazine audit](docs/empty-magazine-reload-audit.md).

The arenas expand the existing 54 authored cover bundles and 15 traversal/environment bundles with 12 new cover clusters and 11 new prop assemblies. Asymmetric central-cover layouts vary player and bot sides while retaining covered starts and reserved walkways. Traversal bundles include stairs, ramps, ladder lofts, partner-boost platforms, shallow-water crossovers, use-operated sliding gates, breakable glass/vents and movable cases. Player/bot movement, damage, acoustics and rendering consume the same resolved environment state. Experienced bots can use safe elevated routes and coordinate boosts, trades, entries and crossfires without hidden-player position access. Projected shadow cues are low-cost ground silhouettes, not native shadow maps. Covered starts and navigation are checked at generation. One/two-bot arenas can be reduced to 0.65 scale without shrinking players or props. Bots travel more quietly in small duels; novice advanced peeks are capped. See [environment mechanics](docs/environment-mechanics-audit.md), [bot tuning](docs/bot-behavior-rebalance-2026-10-02.md) and [integration boundaries](docs/gameplay-integration-audit.md).

Dust2 Prefire uses collision extracted from the installed map at the exact Source-unit scale (1 unit = 0.0254 m), not collision inferred from its simplified visuals. Native visuals and map collision load only when entering Prefire. Bots use authored holds and short peek paths; there is no imported Dust2 navigation engine or native bot AI. Native map cover is currently opaque to bullets, so this mode does not reproduce Dust2 wallbangs or material penetration. Imported bot rigs now use the 19 extracted SAS bone-local hit capsules, sampled at the authoritative firing state rather than the last rendered pose. The local player and headless/unloaded-rig fallback retain analytic shapes; native animation blending and camera prediction are not fully reproduced. Imported geometry does not make the browser simulation an exact CS2 engine reproduction.

Fullscreen play uses the entire viewport, without the setup column shifting the screen center or narrowing the projection. ESC restores setup and detailed reviews. Prefire captures each shot's actual speed, retained recoil and accuracy-recovery state; a compact cue stays visible during fullscreen play and the detailed readout is in its settings panel.

Peeking practice starts behind a wall with a near-head pre-aim and a small randomized correction to make. Its target remains shootable for one second after the first shot by default, adjustable from 0.5 to 10 seconds in Settings. Headshots do not end the rep; accurate-shot totals update live until the timer advances to the next angle. Pausing freezes the timer. Precision/burst practice and challenge exposure limits remain 8/1.5 seconds from head visibility. The coach measures reveal-to-shot time, speed at firing, opposite-key braking, distance-normalized alignment and actual opening impacts. Mouse travel remains descriptive: an off-angle correction or a settled diagonal path is not inherently bad. Feedback is retained in Session history. These are training heuristics, not measured FACEIT-rank benchmarks. Peeking and repositioning require a keyboard; mobile tap-to-shoot remains available for the other drills.

The three regular spray modes also have four side-lane cover walls for free peeking, with matching movement and bullet collision. The initial central and transfer firing lanes remain open.

Tracking is retired. Older tracking preferences open Guided spray; previous tracking results remain accessible in history.

Thirty-four weapon definitions are selectable, including all ten pistols, four sniper rifles, four shotguns and Zeus x27. Slots 2/3/4 provide a configurable sidearm (USP-S by default), standard CT knife and rechargeable Zeus. Turn off "Carry a primary weapon" in Loadout for pistol-only practice; a Duel pickup can add a primary again. Native definitions supply primary/alternate accuracy, cadence, recovery, speed, scope FOV, pellets and reserves. Scoped rifles, sniper zoom levels, bolt-action unscoping/rezoom, Glock/FAMAS bursts and R8 alternate fire share one action model between range and Duel. Finite-ammo reload states support magazines, interruptible shell insertion and slower hold-R silent reloads. Range objective restocking remains a training policy.

The range and generated Duel arenas carry residual damage through material-aware cover and subsequent opponents; native Dust2 cover is currently opaque to bullets. Imported Duel/Prefire bot rigs use native bone-attached capsules with an analytic fallback; range collaterals use actual target-mesh entry/exit intersections without replacing physical scoring coordinates. Pellet damage consumes armor sequentially, while accuracy and coaching count one discharge. Combat runs locally with immediate input and hit feedback, without simulated network latency or shot rewind. Duel also has a compact rotating radar and independent Kevlar, helmet and armor-condition controls.

The Armory saves local XP, levels, earned credits, purchased cosmetics and equipped choices. Completed AI Duels are the main reward source, weighted by coaching score, actual damaged/killed opponents, skill, outcome, armor, accuracy and player-health handicap. Difficulty has twice its previous per-level XP slope. Credits continue after level 100. Completed drill objectives award smaller rewards. Resets, abandoned rounds, no-damage rounds and duplicate callbacks do not award rewards. Choose purchases from 347 native weapon finishes, 557 knife choices across all 20 special families and stock T, eight glove families and six bot agents. Each new shotgun has ten finishes; Zeus has seven real native pairings instead of invented skins. Stock CT is free. Collections show only owned choices; the knife shop filters to a specific family. Level gates give purchase eligibility, not automatic ownership. Previously earned v1 cosmetics are preserved. Cosmetics never change weapon stats. Progress is browser-local, not a CS2 inventory, account or secured economy. See [the economy details](docs/progression-economy.md).

The Armory includes 42 [achievements](docs/achievements.md) for duels, shooting discipline, all six drills, collecting cosmetics, and player levels. Each shows progress and earned dates, with category/status filters and a nonblocking unlock notification. Badges do not change XP, credits, or weapon stats; existing saves and owned items are preserved.

Native weapon-specific first-person poses and SAS target animations, colored head/body/miss feedback, moving targets, crosshair editor, follow recoil, replay and local session history are included. Defaults: 800 eDPI, 20% audio, yellow Compact crosshair with 2 px strokes, follow recoil OFF. Existing custom crosshair settings are preserved; selecting Compact applies the updated preset.

The three spray modes show the equipped gun's impact pattern on the left backstop and the compensating mouse path on the right, including a pistol-only loadout. Both are on by default and can be disabled independently in Settings; other drills and the knife slot hide them. The mouse path respects inverted Y. These are shape previews at the native firing cadence, not sensitivity-calibrated mouse-distance diagrams; reduced-motion preferences show static paths. The muted backstop keeps the guides readable. Hands and weapons keep their proportions on portrait, ultrawide and stretched-world views. Hit captions sit just below the centre crosshair in every mode, with a compact score HUD on short viewports to avoid overlap.

First-time visitors receive a dismissible animated Settings hint for sensitivity, crosshair and audio. "Donate unwanted CS2 skins" is in the top header beside Settings.

The top Changelog lists the October 8 changes since baseline `af175145e581bd4cc853440af1a529856f0a5057`, followed by the unchanged October 5 release and all earlier entries. A changelog entry is not a deployment notice. Selecting a Loadout weapon with purchased finishes keeps its finish selector open; stock-only selection still closes the panel.

Each completed drill rep shows a short verdict below the crosshair, with targeted tips for repeated mistakes. Stationary-only counterstrafe attempts and excess mouse correction receive immediate tips. Common angles favor movement-led pre-aim; unexpected positions still need deliberate mouse correction. Peeking shows a left/right arrow until the exposed head has a clear firing lane. "Settled shots" measures movement readiness; "Accurate shots" counts target hits made while settled. Old history without that intersection displays an unknown accurate-hit count instead of inventing one.

Practice spread includes movement and accumulated firing inaccuracy. Changing drills applies the mode recommendation: OFF for Guided spray, ON otherwise. Users can override it in the range; Duel always applies spread to both sides. Bullet impact size is adjustable from 0.5x to 4x in Settings (default 1.5x), including already-fired marks, without moving their physical coordinates.

Settings > Game > Graphics includes a Performance preset for older PCs, frame caps and adaptive render resolution. The toolbar gauge toggles a persistent FPS/frame-time counter for the 3D modes, off by default. Automatic quality also reduces visual pose sampling from 60 to 30 Hz after sustained CPU overload and restores it slowly; physics, aiming and shot timing are unchanged. Bullet marks and static fixtures are batched, range shadows are cached, and idle previews render at 15 FPS. Only contributing native animation actions run, distance-only cover rays avoid contact allocations, Duel setup controls are memoized, and repeated-round dropped weapons have one render owner. Desktop pointer-locked range play also reserves Ctrl+W in supported fullscreen browsers; when protection is unavailable, use C to crouch. See [the performance and Deagle audit](docs/performance-and-deagle-audit.md) and [the bot/render performance audit](docs/bot-render-performance-audit.md) for measurements and browser limitations.

The real-map Duel performance pass also budgets native bot path queries, removes temporary terrain-clipping allocations, reuses the previous chunk, and shares decoded textures. Rebuilt Duel chunks should pass through `node tools/optimize-duel-visuals.mjs --apply` before deployment; see [real-map rebuild steps](docs/real-map-duel.md) and [measured results and limitations](docs/real-map-performance.md).

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
- `src/range/prefire/`: lazy native Dust2 map/collision loading, authored routes, local configuration, practice sessions and scorecard UI.
- `src/range/lesson-model.ts`, `MovementTutorial.tsx`: interactive movement lessons.
- `src/range/view-animation.ts`, `art/build_reload.py`: native first-person idle/draw/inspect/reload clips and deterministic playback.
- `src/range/weapon-actions.ts`: scopes, alternate modes, burst state and bolt cycling shared by both simulations.
- `src/range/progression.ts`, `ProgressionPanel.tsx`, `cosmetics.ts`: XP settlement, unlocks and exclusively owned cosmetic materials.
- `src/range/achievements.ts`, `AchievementPanel.tsx`: validated-result badges, persistent counters, progress and filters.
- `src/range/game-data.json`: extracted weapon parameters and build provenance.
- `art/build_native.py`, `art/build_range.py`: Blender asset assembly and original architecture.

The world uses metres, with one Source unit represented by 0.0254 m. Shots are world-space rays, not screen-space dots. Range target-mesh intersections and imported bot hit capsules determine hits, with analytic fallback for unavailable rigs and the local player. A second camera renders the weapon independently of world clipping. Browser localStorage retains settings/history, with an in-memory fallback when blocked.

Targets preserve their native 1.822 m rifle-idle dimensions. The scale audit corrected an initial-pose resize that made them about 10% too small; asset checks now guard against regression. The custom range is not a recreation of a specific CS2 map. Fullscreen provides a fairer size comparison than an embedded browser viewport.

## Accuracy

Weapon definitions were re-exported from installed CS2 build 2000924. All 35 retained definitions (AUG remains unselectable), primary/alternate recoil tables, four shotgun angle/radius tables, spread transforms and penetration scalar-loss fixtures have fresh offline checks. Current landing-factor arithmetic has 32 hash-pinned server fixtures. Full punch/recovery integration was inspected on build 2000908, and damage-tagging/crouch-fatigue arithmetic remains pinned to server build 2000919. Fresh data does not relabel older audits. See [combat verification](docs/combat-physics-audit.md), [weapons](docs/weapons-combat-audit.md), [terrain/contact](docs/terrain-contact-audit.md) and [integration boundaries](docs/gameplay-integration-audit.md).

The October 9 audit independently checks build 2000930's movement/firing accuracy arithmetic and compares 2,030 combat fields against a fresh weapon export (no differences). Float32 rounding now preserves the native crouch-speed cutoff. Prefire uses faster cover-safe peeks, counterstrafed bursts and pre-aim; head geometry follows facing/crouch and the native-map world camera no longer adds a misleading stair-height offset. See [accuracy and peeking evidence](docs/accuracy-and-peeks-audit.md) for numeric fixtures, visual checks and remaining limits.

The October 12 spread recheck repeats the fresh 35-weapon export and all 355 native accuracy cases. A newly inspected current-build spread sampler adds 24 independent cases for ordinary shots, R8 alternate fire and early Negev transforms, without reducing or amplifying gameplay spread. See [spread audit](docs/spread-current-build-audit.md) for exact provenance and limits; native command/subtick seed parity is not claimed.

**This is not a bit-for-bit CS2 engine reproduction.** Recoil index, punch and accumulated firing inaccuracy now survive trigger release and recover using formulas inspected in the installed client. Only the weapon cycle limits consecutive shots, without an artificial reload delay. Browser Euler integration, recovery update timing, spread RNG, collision hulls, subtick movement, animation blending and the audio mixer still differ. See [RESEARCH.md](RESEARCH.md) for evidence and limitations.

Pistols use native magazine, cadence, movement, cone and recovery parameters with persistent punch and one-shot-per-press scheduling where applicable. The R8 primary windup is a separate 200 ms trainer estimate, not an extracted engine constant. R8 movement is 220 units/s idle or alternate-firing and 180 while cocking the primary trigger. Knife combat includes slash/stab, hit/miss cooldowns and backstabs, using a documented Source-family approximation pending current native fixtures. Zeus uses extracted range, no recoil and 30-second recharge; its special native lethal-distance curve remains unresolved. Bots can equip all selectable weapons or knife. Pickup presentation reuses the native draw clip because there is no exported distinct pickup animation.

Selecting a drill applies its recommended spread setting: off for Guided spray, on for the other range modes. The range setting remains adjustable. Duel always applies movement, firing and airborne inaccuracy to both sides. Movement is graded separately, so a lucky moving hit is not a clean rep.

The Fundamentals tutorial introduces stopping, movement-based alignment and cover with interactive exercises. Duel adds a local 50-round scorecard, configurable arena size, directional damage feedback and per-round coaching. Scores are training heuristics, not FACEIT or Leetify ratings. See `docs/learning-combat-audit.md` for sources, measurements and limits.

Tutorial examples begin with reading time and play at 0.35x speed; manual practice uses the same ground-velocity calculation as the range. Results stay visible until the learner continues. The requested sustained crouch-spray chances are 60% at levels 1/2, 33% at level 5, and 2% at level 10; brief fighting crouch taps are 0% through level 3, 10% at level 5, and 33% at level 10. Intermediate levels interpolate. These are encounter choices, not guarantees that a bot survives long enough to perform them.

Every gun has native first-person draw, inspect, firing and reload clips, including empty-reload variants where available; knives and Zeus have their supported native actions (Zeus does not reload). Skinned SAS hands and weapon parts are retargeted in Blender, with per-frame part-matrix checks. Shell reloads sample native start/insert/finish windows. Rebuild with `node tools/build-reload.mjs`, then `npm run assets:build`. Native pistol/rifle directional movement and crouch/jump poses remain the bot locomotion base; 36 lazy animation-only packs add 219 supported upper-body weapon clips without duplicating character meshes/textures. Native event-timed foley follows reload phases and suppresses silent reload audio. Missing native gestures use the locomotion fallback. Death bodies use lightweight constrained joint physics against arena geometry, not native VPhysics. Asset checks cover hand travel, grip contact, skeletal height and desktop/mobile nonblank moving renders.

Every firearm has a native firing action; all knife families have native draw/inspect/attack presentation. Muzzle sprites use an extracted native texture and follow animated barrel anchors. Hits resolve instantly; short pooled tracers are cosmetic and suppressed weapons produce none. These are browser render approximations, not the complete Source 2 particle system. See [effects and input capture](docs/weapon-fx-audit.md).

Native audio events are generated with `node tools/import-audio.mjs` (Source2Viewer CLI and FFmpeg required). This converts extracted compressed tracks to actual PCM WAVs and preserves sample variation, event gain/pitch and attenuation knots. It does not reproduce Source 2's whole mixer, distant layers or reverb. `npm run assets:check` validates the complete manifest and sample bank.

## Verify And Build

Commit and push each completed iteration after validation, including its code, tests and relevant documentation. Deploy only when explicitly requested.

The October 23 fidelity update adds native flinch layers and separate hit/kill/helmet/body-contact audio, fractional shot/recovery sampling, per-pellet aim punch and map-relative tactical comparisons. A fresh VRF 20.1 export against installed build 2000935 corrected AUG's retained primary/alternate reload fields to 3.2 seconds; the 35-weapon static comparison then passed. Unique export directories now prevent silent parser failures from reusing stale files. Historical engine-function fixtures retain their original builds and are not all revalidated against the current DLL. Death physics, movement transitions and navigation-derived acoustic routing are still approximations.

Duel delivery uses hash-checked gzip resources and shared image bundles. Compressed bytes persist in browser CacheStorage (up to 512 MiB, quota-aware) independently of the 80 MiB RAM budget. Worker-built collision snapshots are stored locally under a separate 128 MiB limit and engine/source hashes; they require no extra network download. Previously played chunks reuse checked local assets across page reloads. Browser eviction, private mode, storage denial or changed content may require a download again. CacheStorage is origin-specific, so localhost, 127.0.0.1 and production do not share it.

Capable devices prepare one complete next chunk during the current round and retain bounded older chunks in addition to the active/previous/next owners. Initial and prefetched chunks finish GPU preparation before play. Constrained devices retain byte-only prefetch; data saver/2G disable it. Short rounds or slow connections can still finish before preparation. Native chunk visibility reduces render work without changing collision. See [current loading contracts and limits](docs/local-chunk-loading-2026-10-29.md). After changing converted assets, regenerate delivery manifests so stale compressed copies cannot hide the update:

```sh
node tools/build-combat-model-delivery.mjs
node tools/build-duel-delivery.mjs
```

For source-audio maintenance, run `node tools/import-combat-feedback.mjs`. Native flinch export/verification uses `node tools/build-duel-flinches.mjs` / `--verify-only` and its build-pinned inventory. Detailed implementation evidence and remaining work are in [the fidelity checkpoint](docs/fidelity-implementation-checkpoint.md).

After editing Prefire pools/routes, regenerate the native admission certificate as well as Duel rounds/navigation/delivery. A stale certificate intentionally blocks entry. The full commands, reviewed position sources and actual-package regression are in [the position-source follow-up](docs/position-source-followup-2026-10-23.md#package-maintenance).

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

For Dust2, install a current Source 2 Viewer CLI build and use a local CS2 installation containing `game/csgo/maps/de_dust2.vpk`. Map conversion was verified with `20.0.7379+09124ab`; current weapon/reload KV3 export requires official `20.1` at `.local-tools/vrf-20.1/Source2Viewer-CLI.exe`. Set `CS2_MAP_CLI` for another map CLI location. Older releases cannot decode all current metadata; a zero exit code alone does not verify a successful export. After `npm ci`, run:

```sh
node tools/import-dust2.mjs
```

Set `CS2_PATH` to the CS2 installation directory if it is not at the default Windows Steam location. The importer extracts installed-game collision and builds detailed, compressed native visuals with native visibility data in `public/revamp/maps/dust2/`; its intermediate files stay in `research/dust2/`. These local assets and extraction files are Git-ignored, like the existing converted game models, textures and audio. A source clone does not include them. This imports map geometry, not a Dust2 navigation engine or the CS2 gameplay engine. Common prefire positions come from pinned [OpenPrefirePrac](https://github.com/lengran/OpenPrefirePrac) profiles, with its MIT notice included locally.

Additional reviewed Dust2 coordinates come from [Dust2 Duel Density](https://github.com/GameOperator13/cs2-dust2-duel-density), attributed to GameOperator13 and Julien Blanchon/OpenCS2 under CC BY 4.0. Exact coordinates, event IDs, exclusions and authored stance/facing adaptations are recorded in [the source follow-up](docs/position-source-followup-2026-10-23.md) and Prefire's Angle sources disclosure. Combat endpoints are coverage evidence, not measured probabilities of holding an angle.

Code follows the repository's existing GPL-3.0 [LICENSE](LICENSE). Original range architecture belongs to this project. Valve map/character/weapon geometry, animation, textures and sounds are separate proprietary content, not relicensed here. Obtain appropriate rights before redistributing extracted assets. SprayLab is an unofficial, independent training project, not affiliated with or endorsed by Valve and not an official CS2 product. No live memory access, hooks, game input automation or game modifications are used.

Conversion uses [Source 2 Viewer / ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat) and Blender. Older version notes describe archived implementations. The current entrypoint is `src/main.tsx` -> `src/range/RangeApp.tsx`.
