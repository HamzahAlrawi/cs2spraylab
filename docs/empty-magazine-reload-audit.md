# Empty-magazine idle auto-reload audit

## Checkpoint

- Phase: complete; focused validation and production build passed. Repository instructions and coordinate/aiming/movement contracts read.
- Scope: shared deterministic empty-magazine policy, range simulation, combat weapon state, and focused tests only.
- Combat integration needs no call-site edit: `DuelWeaponState.advance` reads optional `actor.equipReadyAt`, already present on actors passed by `DuelSimulation`. This task does not edit that file or engine/UI/map files.
- Preserve native reload ammo-commit and attack-gate timing, reserve handling, and existing manual reload behavior.
- Installed build checked: `2000933`, SourceRevision `11133601`, `steam.inf` dated October 15, 2026. Static vdata contains reload attack locks but no auto-reload/idle-delay field.
- Primary Valve Source SDK evidence confirms an empty-clip idle path gated by primary/secondary attack readiness. It does not establish current closed-engine CS2 timers or universally prove held-trigger suppression; its separate repeated-empty-fire path can call reload too.
- Selected trainer policy: suppress automatic reload while an attack input or queued burst is active; otherwise reload on the first eligible simulation tick after existing draw/cycle/mode/reload gates. No added universal idle/dry-fire delay.
- Implemented shared policy and range/combat callers. Added physical-trigger latch in range, cleared on release/cancel/switch/restock but not ordinary attempt completion. Exhausted burst queues are cleared to avoid stranding auto-reload.
- Existing precommit knife/back tests now expect a new idle reload at the return draw deadline rather than an extra empty trigger pull. A failed trigger attempt during draw is explicitly released in the range fixture; otherwise it correctly suppresses idle reload. The focused `weapon-actions.test.ts` empty-AWP case also now releases its trigger before expecting automatic reload/unscoping.
- Validation: six focused files / 268 tests passed; `npm run build` passed (TypeScript and Vite); scoped `git diff --check` passed. Full `npm run check` deliberately not duplicated by this task.

## Recovery

This document is the task checkpoint. Update it after research, implementation, and tests so partial work is recoverable if the execution limit interrupts the task.

## Primary Evidence

- [Valve Source SDK weapon implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/basecombatweapon_shared.cpp): `ItemPostFrame` no-buttons branch calls `ReloadOrSwitchWeapons`; the latter checks clip empty, auto-reload permission, and both attack deadlines. `DefaultDeploy` gates both attacks on draw completion. `HandleFireOnEmpty` is a separate legacy path, so this is policy evidence, not a current-CS2 held-input measurement.
- Installed `research/reload-timing-audit/weapons.vdata`, exported from `scripts/weapons.vdata_c`: existing native reload events/locks remain authoritative for this trainer's reload transaction. See `docs/native-reload-timing-audit.md`. Cached export SHA256: `46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b`; archive-directory SHA256: `f0943b4d5a86fe8f4891ab98983b9d132b4450b9b7401a03a530bcd63f293f99`.
- [Valve's March 18, 2026 update](https://www.counter-strike.net/newsentry/532126482488623360) changed magazine discard/reserve accounting. This task deliberately preserves existing finite bullet-reserve accounting rather than expanding into that separate overhaul. No full current-CS2 reserve-system parity is claimed.

## API And Integration

`shouldAutoReloadEmptyMagazine(time, state)` in `src/range/empty-magazine.ts` is pure/stateless. Pass the currently active weapon, exact zero ammo, reserves, reload/attack/burst flags, and `readyAt = max(draw, shot/pump cycle, secondary-mode gate, retained reload fire gate)`. It only decides eligibility; the caller starts its existing native reload transaction once.

`DuelWeaponState.advance(time, dt, command, actor)` now accepts optional `actor.equipReadyAt`. Existing `DuelSimulation` actors already supply it, so **no additional combat tick call is required**. External callers passing a reconstructed pose must retain that field during deployment. Holstered `advancePassive` updates intentionally do not initiate reloads. Manual reload remains separate and is not blocked by held attack.

Range's `start` latches attack even when an empty shot cannot start. `release` clears that latch for mouse/touch while preserving the existing touch-completes-burst behavior. `finish` does not pretend the trigger was physically released. Idle reload runs only while the range is active and the drill is not finished.

## Verification

```powershell
$env:TEMP=(Resolve-Path .local-tools/test-tmp).Path
$env:TMP=$env:TEMP
npm test -- --run src/range/empty-magazine.test.ts src/range/duel/weapon-state.test.ts src/range/range-weapon-actions.test.ts src/range/simulation.test.ts src/range/native-reload.test.ts src/range/weapon-actions.test.ts
npm run build
```

Coverage includes passive empty hold, held primary/secondary and one-tick press, release before/after cycle readiness, draw and mode gates, cancelled reload/knife-return, native ammo commitment and retained fire gate, shell reload phases, depleted burst queues, touch burst completion, manual reload while held, exhausted/partial finite reserves, paused/holstered state, and knife/Zeus exclusions. Existing ballistic-parity and cadence tests remain unchanged and pass.

The shared policy performs no allocations internally and consumes no random values. Callers short-circuit nonempty magazines before constructing its input, keeping the normal per-tick path cheap.

## Remaining Limits

- Current CS2 held-trigger behavior and engine-side idle/dry-fire subtick timing were not measured live. Suppression while held is the explicit trainer policy requested here, not claimed as a verified closed-engine constant.
- No universal extra delay or dry-click lock was invented from anecdotes. Existing cycle/draw/mode gates provide the natural wait.
- Range input currently supplies one combined firing trigger through `start`/`release`; standalone scope-button hold duration is not exposed by its engine. Secondary mode readiness is respected, while combat additionally receives raw secondary-held input. Engine/input ownership is unchanged.
- Full current magazine-discard accounting, single-shell transition estimates, and silent reload estimates remain outside this patch; the native reload transaction is not modified.
