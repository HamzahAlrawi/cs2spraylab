# Arsenal, Progression And Map Audit

## Evidence And Boundaries

The current installed data snapshot is CS2 build **2000922**, patch 1.41.8.8, SourceRevision 11064488. All inspection is offline against local VPKs and DLL bytes. There is no game-process access, hook, memory reading, automation or CS2 connection.

- `game-data.json` contains 30 gun definitions with primary/alternate accuracy, cycle, movement, recovery, recoil, damage, scope and burst fields. Suppressed M4A1-S/USP-S use the suppressed data mode by default.
- `verify-weapon-data.mjs` independently re-exports the installed archive, checks both modes and control fields for every firearm, and records `native-weapon-stats-fixture.json`. Damage tests cover every gun at 0, 12.7, 25, 50 and 100 meters with naked/armored/helmet/low-armor cases. This verifies the definition fields and the trainer's explicit hitgroup/falloff/armor arithmetic, not native damage-function emulation or penetration through surfaces.
- `native-table-fixture.json` and `native-alternate-table-fixture.json` contain 64 recoil entries per gun, independently produced with the pinned current native table routine and tier0 RNG. The current client SHA-256 is `9ddf30d68b8ef66607783d418c4f74a6004cf2104572e6c630625e52c1c1202d`; tier0 is `4e0dcb0af3f6953f37ddaed0f4e67a56d031f1e84964a262148f8a6f80547791`.
- This validates table generation, not every subsequent punch/recovery integration step or live CS2 bullet trajectory. The full integration audit remains build 2000908; damage-tagging arithmetic remains build 2000919. Current vdata imports retain that separation.
- R8 primary windup is **200 ms estimated**, clearly separate from native definitions. Range and Duel share cancellation/held alternate-fire behavior and the extracted mode-specific cadence/accuracy. Idle/alternate movement uses 220 units/s, primary cocking uses 180 units/s. Native charge/fire/alternate/dry-fire clips are available; the authored charge clip does not prove the engine-side attack delay.
- Scope FOV and the ordinary-crosshair visibility flag come from native fields; the four sniper rifles hide the normal unscoped crosshair. Sensitivity scaling and browser projection remain trainer calculations. Spread RNG, Euler integration, subtick movement, collision hulls, ragdolls, IK and audio mixing are not bit-for-bit Source 2 implementations.

## Native Animation Pipeline

`tools/native-view-clips.mjs` selects exact viewmodel paths, never similarly named world clips. `build-reload.mjs` exports the native clips and uses isolated background Blender to assemble native SAS arms and weapon skeletons. `art/build_reload.py` corrects each weapon bind root before retargeting moving parts, then bakes at 30 Hz. Every sampled part matrix must agree within 0.0001. `weapon-animation-inventory.json` records build, paths, checksums, durations, matrix error and final GLB hashes.

The 32 standard first-person assemblies comprise 30 guns, the default CT knife and unlockable butterfly knife, with 15 additional legacy UV assemblies. Each has idle, draw and inspect. Guns also have reload and optional empty reload. Deagle, Dual Berettas, R8 and all four snipers additionally use native firing clips; AWP/SSG bolt cycles are part of their firing clips, not invented separate actions. Dualies alternate barrel actions and empty poses; R8 charge is held until fire/cancel. The v5 assembly export selects exactly one HD/legacy bodygroup, excluding the Dualies holster. Runtime disables skinned frustum culling for first-person assemblies so the Deagle's draw-start bounds cannot hide its later hand poses. Actions are cancelable; reload has priority, firing cancels inspect, and holstering cancels pending bursts/scopes/charges. Reload playback follows native weapon attack availability rather than adding a post-animation delay. `F` inspects; icon controls remain available without pointer lock.

Pickup uses the native draw clip intentionally: no distinct pickup clip exists in the selected native view sets. Killed bots drop their gun/ammunition; `E` or the pickup control requires reach, line of sight and an active living player. Slot replacement preserves the dropped ammunition and imposes the extracted deploy delay, including alternate fire.

The world animation library contains 93 native clips: rifle/pistol eight-direction gaits, continuous crouch/jump poses, weapon-specific pistol idle layers and death poses. Weapon idle layers are `RelativeToFrame` additives; they must not replace locomotion. Secondary weapon-skeleton tracks are excluded from character bindings. `weapon-mounts.json` derives each gun's attachment from its own native bind root. Dual Berettas use a small analytical two-bone IK correction to the native second-hand anchor, not a claim of Source 2 solver parity.

Automated geometry checks measure first-person idle finger-to-weapon contact and action travel for every assembly. World checks cover standing, crouching, running and crouch-moving right-hand contact; Dual Berettas also check the second hand. These are presentation regression checks, not measurements of grip force, every animation frame, or every limb intersection.

## Cosmetic Ownership

The catalog now has 324 paid cosmetics: 300 gun finishes (ten per firearm), ten butterfly finishes, eight gloves and six bot agents. All use native item/paint-kit names, source paths and hashes. Fifteen guns additionally have legacy-body first-person assemblies for finishes authored against the old UVs. The butterfly uses native blade weights, pattern and palette with a simplified PBR shader. Gun finishes use native albedo or native pattern/palette data with simplified factory-new materials. Wear, paint-seed variation and Valve's complete composite-material system are not reproduced. See `native-cosmetic-actors-audit.md` for glove/agent bindings and rendering limitations.

Cosmetic materials/textures belong to an exclusively owned first-person assembly. Old owned materials/maps are disposed on replacement. The range retains at most three first-person assemblies; Duel retains its current assembly. World-weapon caching is capped at eight unless more are still needed by current actors/drops; retired sources dispose their shared resources only after old actor clones are removed. XP-only changes do not reload models. Each bot binds only its weapon family's character actions. Native binary assets/audio remain ignored by Git; a fresh source clone requires a local asset build. The source license does not grant rights to Valve assets.

## XP Rules

Progression is local-only, versioned in `spraylab.progression.v1`, with in-memory fallback if browser storage fails. Unsupported future save versions are preserved. It is not server-secured, cross-device, or a real CS2 item economy.

For level L, total required XP is `150 * (L - 1) + 35 * (L - 1)^2`, through level 100. Butterfly Emerald is purchase-eligible at level 75 for 75,000 credits; the standard knife is always available. Version 2 replaces automatic level unlocks with owned purchases and a wallet. Migration retains only the eleven old implicit unlocks and previous equipped choices, not all newly added level-eligible cosmetics. See `progression-economy.md` for costs, milestone rules and pacing.

A completed Duel earns:

```text
floor((55 + 95 * coachingScore / 100)
      * effectiveOpposition
      * outcomeWeight
      * playerHealthHandicap)
```

Skill weights range from 0.7 at level 1 to 1.375 at level 10 and 1.5 at 10+. Each opponent's threat also considers armor (1 or 0.8), health capped at 100, and configured accuracy capped at 1.15. Effective opposition uses actual health damage fractions and a sublinear roster denominator (`max(1, rosterThreat)^0.38`). Untouched opponents and one-HP targets cannot inflate rewards just by increasing nominal bot count. Win/loss/draw weights are 1.2/0.65/0.75. Player health above 100 reduces rewards by `100 / health`; lower health does not create a farming bonus.

Drill rewards are much smaller: `floor(5 + 9 * score / 100)` for guided/free spray or `floor(7 + 9 * score / 100)` for other drills. Objectives require real hits, adequate duration, and movement/transfer/burst evidence appropriate to the mode. Resets, abandoned/config-changed attempts, no damage, impossible results and duplicate callbacks do not award XP. One active attempt token is settled once; it is not restored across browser reloads.

## Map Variety And Performance

Six template families vary architecture rather than merely jittering identical blocks: Freight yard, Service lanes, Courtyard, Switchback, Loading bays and Workshop. Each gets distinct cover sizes, cargo orientations, lanes and prop accents, then a new round seed. Choosing one template preserves variation between its rounds. Spawn pairs are sampled behind validated cover, with connected usable routes. New crates, pallets, vents, cabinets, generators, barriers and concrete courses are static and batched with shared materials. Decoration does not promise openings that collision treats as solid.

The current headless simulation benchmark measured five-bot ticks at approximately 0.10 ms p95 and 0.19 ms p99 on this machine (20 simulated seconds, 2560 ticks). This excludes GPU rendering, texture decode, audio and asset loading; it is not an FPS claim. Native assets are lazy-loaded, but total local models/audio are about 230 MB, not the first-page transfer size. Glove/agent template caches contain at most two selected models; previews are lazy images. Physical older devices still need testing.

## Reproduce

```sh
node tools/import-game.mjs
node tools/import-equipment.mjs --data-only
node tools/import-tagging.mjs
node tools/build-assets.mjs
node tools/check-assets.mjs
npm run check
npx playwright test
```

Native recoil verification additionally requires the pinned DLL build and local `pefile`/`unicorn` dependencies:

```sh
python tools/verify-native-recoil.py
```

Do not change pinned engine hashes to make an audit pass after a game update. Re-audit the code or preserve and label the older evidence instead. See the animation inventory and existing mechanics audits for the remaining engine-specific limitations.
