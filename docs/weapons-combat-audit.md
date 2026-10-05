# Weapons Combat Audit

Date: 2026-10-03. Offline/static imports only; no game process access, hooks,
memory reads, runtime DLL loading, input injection, or CS2 automation.

## Extracted Data

Fresh installed build: **2000924**. Archive resource: `scripts/weapons.vdata_c`.
Decompiled-text SHA256:
`3289d4dba65b1ef3f884c389448c8a6c6db8691442c18a7aaddb28434aaf250d`.
`tools/verify-weapon-data.mjs` independently re-exports the installed archive and
compares primary/alternate parameters, controls, pellet counts, reserves, and
shell-reload flags. This verifies extraction, not complete gameplay parity.

| ID | Native Key | Clip / Reserve Rounds | Pellets | Damage Per Pellet | Cycle Seconds | Reload Type |
| --- | --- | --- | --- | --- | --- | --- |
| nova | weapon_nova | 8 / 32 | 9 | 26 | 0.88 | Single shell |
| xm1014 | weapon_xm1014 | 7 / 32 | 6 | 20 | 0.35 | Single shell, automatic fire |
| mag7 | weapon_mag7 | 5 / 15 | 8 | 30 | 0.85 | Magazine |
| sawedoff | weapon_sawedoff | 7 / 32 | 8 | 32 | 0.85 | Single shell |
| zeus | weapon_taser | 1 / 0 | 1 | 500 | 0.15 | Recharge, not reload |

Reserve values encoded as clip counts are multiplied by native magazine size:
AK-47's `3` becomes 90 rounds; MAG-7's `3` becomes 15. Reserves count rounds,
not spare physical magazines. Partial magazine reloads retain remaining bullets.
Every pre-existing weapon also gets its extracted reserve/pellet/shell fields.
All previous weapon data remains; AUG is removed only from `weaponIds`, with its
name/stats and legacy saved setting retained. No other old saves are rewritten.

`m_flDisallowAttackAfterReloadStartDuration` is retained as `reload`. Its values
are 0.466667 for Nova/Sawed-Off, 0.6 for XM1014, and 2.5 for MAG-7. The field's
attack-lock duration does **not** independently establish the precise ammo-insert
event, empty-reload chamber timing, or every animation transition.

## Explicit Estimates

- `SILENT_RELOAD_MULTIPLIER = 2` is a configurable trainer estimate, not a native
  value. Valve confirms hold-R silent/slower reloads but publishes no multiplier
  in the inspected release notes; weapons.vdata has no dedicated timing field.
  Hold/release changes reload work rate prospectively, without restarting or
  retroactively accelerating elapsed work. Input/hold threshold is not measured.
- Single-shell start is estimated at 0.5 s and finish at 0.2 s. Native `reload`
  is used as shell insertion interval, an unverified mapping of attack-lock data.
  Magazine ammo commits at attack-lock completion, also a trainer policy pending
  native reload-event measurements. Reload cancellation never inserts unfinished
  shells or creates ammunition. Pump availability is the native shot cycle, not
  a separately measured pump event; reload/holster cannot shorten that cooldown.
- Zeus recharge is 30 s, supported by installed `research/convars.txt`'s
  `mp_taser_recharge_time` and Valve's release notes. Zeus range is the installed
  120 units (3.048 m). Armor/hitgroup bypass is modeled separately from bullet
  arithmetic. Its special engine distance curve is unresolved: the current
  fallback uses extracted damage/rangeModifier with generic distance falloff.
  This must not be described as exact native Zeus lethal-distance parity.
- Knife damage table is a Source-family training model, **not extracted from
  weapons.vdata**: primary first/follow-up/back 40/25/90; secondary front/back
  65/180. Vdata's generic knife damage 50 and cycle 0.15 do not describe these
  attack branches. Armor uses the extracted 1.7 ratio (0.85 health fraction),
  including armor exhaustion. Damage remains fractional; native integer rounding
  is not independently verified. No headshot or leg multiplier is applied.
- Knife ranges are estimated 48 units primary and 32 secondary; miss cooldowns
  0.5/1.0 s and actor-hit cooldowns 0.4/1.1 s. First slash resets after the prior
  ready timestamp plus 0.4 s; misses/secondary attacks also affect this window.
  Backstab uses a horizontal victim-facing dot threshold 0.475. Main's 16-unit
  sweep hull is estimated, not a measured native CS2 hull/trace fixture. Main
  owns surface occlusion, hull geometry and immediate hit/miss classification.

Sources: [Valve's hold-R update and subsequent shotgun timing fixes](https://steamcommunity.com/app/730/announcements),
[Valve's Zeus recharge release notes](https://store.steampowered.com/news/posts/?appids=730&enddate=1707350489&feed=steam_announce%2F1000).

## Integration Contract

`NativeReloadState` is exported from `weapon-actions.ts`. Construct with equipment
ID and optional silent-duration multiplier. `ammo` and `reserve` are mutable
round counts. `phase` is `idle | magazine | start | shell | finish`.

- `start(time, silent = false): boolean` rejects full/no-reserve/knife/Zeus states.
- `advance(time, reloadHeld?)` consumes elapsed simulation time, inserts completed
  shells/magazines and updates rate. Omitted `reloadHeld` retains current mode.
- `interrupt(): boolean` requests shell-reload finish only with loaded ammo;
  it cannot interrupt an empty gun before the first insertion, or a magazine.
- `cancel()` cancels incomplete work while preserving all committed ammunition.
- `active`, `until`, `empty`, `silent`, `startedAt`, `phaseDuration`, `progress`
  expose state for UI/animation. `until` is the **next phase** deadline for shell
  reloads, not an estimate of the whole refill. `phaseDuration` is unscaled work
  seconds; multiply by silent multiplier for playback duration as appropriate.
- `drainActionEvents()` returns each event once: `reload-start`, `reload-shell`,
  `reload-end`, `reload-cancel`, `reload-mode`. Events include `at`, `silent`,
  `phase`, `ammo`, `reserve`; use the **event's** silent flag for audio, not a
  later state snapshot. Completion can clear state before events are consumed.

`DuelWeaponState.reload` is this controller. Compatibility properties `ammo`,
`reserve`, `reloadUntil`, `reloadEmpty`, `reloadPhase`, `reloadSilent` are exposed.
`reloadUntil` and `reloadEmpty` are now getters, not externally writable timers.
`advance` accepts `ActorCommand` plus optional `reloadHeld`.
`drainActionEvents` adds `zeus-discharge`/`zeus-ready`; those carry `at`, not a
silent flag. `pumpUntil`, `rechargeUntil`, and `nextShotAt` are absolute simulation
times. Recharge is not canceled by holster. First advancement after re-equip
materializes an expired recharge. `advancePassive(time, dt, crouch?, airborne?)`
provides safe inactive recovery/recharge advancement, including zero-recovery
Zeus. Main should use it instead of directly advancing inactive recovery kernels.
The active Zeus path also resets the stance penalty to recover from a legacy
inactive caller that produced a zero-recovery NaN.

Constructor third argument supports `{spread?: boolean, silentReloadMultiplier?:
number}`. The explicit no-spread option is used by recoil/cadence parity tests;
native Negev transforms and authored shotgun spread no longer vanish merely
because a test random callback returns zero.

`FiredRound` retains `origin`, `direction`, `weapon`, `ordinal` and adds:
`kind: bullet | pellets | melee | zeus`, `attack: primary | secondary`,
`maxDistance` in world meters, optional `pelletDirections: Vec[]`, optional
`firstSlash`. Pellet zero is the compatibility `direction`, not an additional
bullet. One discharge consumes one round and one recoil impulse, irrespective
of pellet count. Origin is copied when fired and does not follow later movement.

Duel uses the combat worker's shared `shotDirections`: weapon ID, alternate
mode, recoil index, and ordinal seed fallback are passed. Injected actor RNG
still governs command spread; ordinal is not a verified CS2 command seed.
The shared kernel owns native shotgun tables/Negev/R8 spread math and provenance.

Main must trace `pelletDirections ?? [direction]` once per ray, bounded by
`maxDistance`, with shared discharge identity. Reduce provisional armor between
pellets and other staged hits; `resolvePelletDamage` is available for direct
nonpenetrating groups. `resolveDamage` accepts optional `{attack, firstSlash,
backstab}`. `isKnifeBackstab(attackerPosition, victimPosition, victimYaw)` is
exported. After knife trace resolution, call `resolveMeleeHit(ordinal, hit)` on
the firing state to set actor-hit/miss cadence. Stale ordinals are ignored.
Main owns independent player/bot armor/helmet UI, snapshots, reserves on drops,
pickup conservation, bot reload intentions, action presentation and sound.

Zeus is supported in slot 4 by `equipmentForSlot`; slots 1/2/3 retain their old
meaning. Main decides selector visibility, independent equipment slot/input, and
whether saved primary `zeus` should remain loadable. No DuelConfig/UI edits here.

## Native Assets

Imported raw and rigged static meshes for the five new IDs. Zeus resource uses
`taser`, while runtime asset files consistently use `zeus`. Public world GLBs
contain only authored HD bodies, embedded textures, and no generated stand-ins.
Native inventory PNGs are 480x240 transparent previews. Source/output hashes,
geometry counts and preview resource paths are in `combat-asset-inventory.json`.
Native weapon-root inverse binds are in `weapon-mounts.json`.

Commands:

```text
node tools/import-game.mjs --only=nova,xm1014,mag7,sawedoff,zeus --no-audio --bind-only
node tools/import-combat-assets.mjs
node tools/verify-combat-assets.mjs
node tools/import-tagging.mjs
node tools/import-weapon-fx.mjs
node tools/verify-weapon-data.mjs --write-fixture
```

No shared viewclip/animation tooling or manifests are edited. Animation worker
owns native shotgun shell-start/insert/finish, pump/fire and Zeus charge view
assemblies. Audio worker owns `weapon_taser` sound mapping, reload-event silencing,
and recharge sounds. `check-assets.mjs` must account for Zeus not having a reload
action and for stock-only new weapons having no imported skin pack. Existing skin
counts/assets must not be truncated or relaxed. Cosmetics already derive stock
entries from equipment IDs; cosmetics/progression are unchanged by this worker.

The old hash-pinned recoil verifier refused the installed changed client hash:
`d7db25d48f1d10c5e0b0296e20ed803426eb9509da41760daeda39dd35ba89b9`.
It did not write regenerated fixtures. New native arithmetic/provenance is the
combat worker's audit responsibility, not inferred by copying old RVA offsets.

## Validation

Focused weapon validation: seven files, **171 tests passed** after shared-kernel
integration. Covers all new stats, legacy settings/slots, reserve exhaustion,
partial magazines, silent mode changes, shell interruption/cancellation,
pellet/recoil cardinality, pump cooldown protection, full knife table and attack
timing, stale trace replies, Zeus recharge and armor bypass, and existing weapon
cadence/recoil parity. Archive verifier passed for all 35 firearm/equipment data
entries, including retained AUG data. Asset verifier is separate from in-browser
first-person rendering validation. Full build/check belongs to main after the
parallel workers finish integration; no global test run, commit, push or deploy.
`npm run build` was attempted during integration and stopped at the audio worker's
missing new-weapon sound metadata entries in `sound-model.ts`/its test. No owned
weapon-module TypeScript errors remained in that attempt.

## Exact Files Changed By This Worker

```text
src/range/config.ts
src/range/equipment.ts
src/range/equipment-data.json
src/range/game-data.json
src/range/weapon-actions.ts
src/range/duel/weapon-state.ts
src/range/duel/damage.ts
src/range/duel/weapon-state.test.ts
src/range/native-weapon-stats.test.ts
src/range/native-weapon-stats-fixture.json
src/range/equipment-combat.test.ts
src/range/native-reload.test.ts
src/range/duel/combat-weapons.test.ts
src/range/duel/damage.test.ts
src/range/tagging-data.json
src/range/weapon-fx-data.json
src/range/weapon-mounts.json
tools/import-game.mjs
tools/import-equipment.mjs
tools/import-tagging.mjs
tools/import-weapon-fx.mjs
tools/verify-weapon-data.mjs
tools/import-combat-assets.mjs
tools/verify-combat-assets.mjs
docs/combat-asset-inventory.json
docs/weapons-combat-audit.md
```

Generated native binaries/previews (ignored by Git): for each of `nova`,
`xm1014`, `mag7`, `sawedoff`, `zeus`, both `research/raw-models/{id}.glb` and
`research/raw-models/{id}-rigged.glb`, `public/revamp/models/{id}.glb`, and
`public/revamp/models/{id}.png`. Offline extraction intermediates remain under
ignored `research/`. Existing model/audio/skin files were not removed. FX import
also refreshes the existing shared muzzle-flame texture/manifest using its
existing importer; it does not edit audio or animation source tooling.
