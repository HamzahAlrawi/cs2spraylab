# Aim-Punch Verification

Audit date: 2026-10-11. This is browser training simulation work only. No
game process access, hooks, input automation, or DLL loading was used.

## Findings And Fix

The ordinary survivor-hit connection is present in both modes:

1. `DuelSimulation` applies `victim.punch.hit` after resolving the tick's shots.
   It uses pre-armor raw damage and armor present before the hit.
2. `DuelWeaponState` reads `shotFor(recovery.angle)` and passes the damage
   offset separately to the physical shot kernel. Both actors use this path.
3. `DuelEngine` adds full external punch to the world camera, while retaining
   the separate 0.45 weapon-recoil camera fraction. Follow Recoil includes the
   physical punch once, not as another recoil impulse.
4. Prefire inherits this simulation/rendering path. The parent also added
   punch-aware, bounded Prefire aim correction and firing gating. A focused
   regression verifies that a head hit is not cancelled instantly by that motor.

The concrete scoped correction is in `DuelEngine`: paused/result snapshots
were authoritative, and damage punch predicted with remainder zero, but weapon
recoil still predicted with the leftover active-frame accumulator. Both now use
one `aimRemainder`: the active remainder while fighting, zero while paused or
in results. Camera and followed shot ray use the same sampled components.
Neither cache, base actor aim, weapon RNG, nor existing impact matrices change
when rendering this state.

No flinch multiplier, minimum visible shake, longer recovery, changed recoil
table, artificial spread, or muzzle-based physical ray was added.

## Armor And Helmet Behavior

The existing offline native arithmetic fixture is build **2000922**, server
SHA-256 `3541e46a3193fcf1151e97ce19cd4daf86c5fdb2889033c2bab1d4cc7f555b9c`.
Its 64 hitgroup cases and 49 recovery samples are unchanged.

For distance/hitgroup-scaled damage before armor absorption, that fixture gives:

| Hit | Cache pitch, before the 2x physical conversion |
| --- | --- |
| Chest/stomach, armor present | `min(12, rawDamage * .005 * 3)` |
| Chest/stomach, no armor | `min(12, rawDamage * .033 * 3)` |
| Head, no helmet | `min(36, rawDamage * .2 * 3)`, with bounded random roll |
| Head, helmet | Zero pitch/roll |
| Arm/leg | Zero punch |

Kevlar reduces torso punch rather than eliminating it: 36 raw damage gives
about **1.08 degrees** of physical pitch with armor, versus **7.128 degrees**
without armor. At rest the armored example is gone after four 128 Hz recovery
ticks, about 31 ms. A slow rendered frame can miss much of that brief motion.
Active recoil changes the shared radial recovery, so this lifetime is not a
universal duration during a spray.

Helmet suppression is independent of remaining armor points in the imported
arithmetic. Torso reduction checks armor present at impact, including the hit
that depletes it. Reduced/zero punch does not imply zero damage or zero tagging.

The installed `server.dll` currently hashes to
`9f31fc84164f7822e015dcd95ea958f9dd33d02308a646a2bee5c9b39bd6fc28`.
The read-only verifier rejected it with `Build changed: re-audit before updating
offsets`. No offsets, hash guards, or fixture provenance were changed. Passing
the existing numeric fixtures does **not** establish current-installed-build
or complete live-CS2 presentation parity.

## Target Facing

The imported target faces local +Z. Rendering it with `actor.yaw - Math.PI`
maps that axis to `(-sin(yaw), 0, -cos(yaw))`, the physical horizontal aim
direction. Both `syncActors` and `sampleActorHitPose` use this transform.

The browser regression checks four rotated headings against the actual model
and mounted AK-47 muzzle. Model-forward dot product is 1, barrel-forward dot
product exceeds 0.9, and authoritative hit-pose sampling moves no capsule
endpoint by more than `1e-8` meters in the fixed-pose comparison. It also takes
a rendered screenshot and checks nonblank pixels.

No 180-degree renderer correction is warranted by these samples. Flipping the
root would turn the verified gun/model away and change hit-pose coordinates.
`animation.ts` remains untouched; its estimated skeletal pitch distributes
up-positive physical pitch as negative rotation around the rig's lateral axis.
These checks do not prove every gesture, cosmetic agent, or weapon mount.

## Parent Integration

No additional ordinary damage-to-camera or damage-to-weapon hook is required.
The parent's Prefire controller hook is now present and tested; this task did
not edit `simulation.ts`, `prefire/session.ts`, controllers, configs, or
`animation.ts`.

The parent-owned `tests/prefire-aim.spec.ts` fractional-recoil harness now freezes
simulation while leaving presentation active:
`e.sim.pause(); e.sim.phase = 'fighting'; e.paused = false;`. This deliberately
tests active frame remainder; a real paused view instead predicts with zero
remainder. Separate regressions exercise both conditions and round results.

An earlier expanded run encountered three parent-owned Prefire facing/session
expectation failures while parent source changes were in progress. Those tests
were not edited here. Final focused results are recorded below; they are not a
claim that the full shared workspace suite passed.

## Verification

- Focused physical suite: 220 tests passed in five files, including unchanged
  native arithmetic fixtures, player/bot armor and head/torso hit matrices in
  Duel and Prefire, stable world impacts, active recoil sampled once, pause,
  reset, weapon-state isolation, head-roll RNG isolation, and the parent's
  bounded Prefire motor response. The mode hit matrices inject deterministic
  commands to isolate the inherited mechanics from route/AI selection.
- Browser regression checks use real Duel/Prefire rendering, with authored
  cover, native hit poses, and controllers disabled only in the deterministic
  damage setup. Separate target-facing checks use the actual rig/mount/capsules.
- All 16 desktop/mobile Chromium cases passed across the final run and one
  focused rerun: the combined run had 15 passes and one desktop browser-context
  closure during teardown; that case passed when rerun alone. All eight mobile
  cases passed together. Both target-facing screenshots were visually inspected,
  in addition to the automated nonblank-pixel checks.
- `npm run build` passed. Existing large-chunk warnings remain.
- Full `npm run check` and the full unit/browser suites were deliberately not
  run. Focused Vitest/Playwright commands required execution outside the Windows
  sandbox because its temporary-cache rename/browser launch was blocked.

Commands:

```powershell
npm test -- --run src/range/aim-punch.test.ts src/range/duel/aim-punch.test.ts src/range/duel/weapon-state.test.ts src/range/duel/animation.test.ts src/range/duel/actor-hitboxes.test.ts
npm run test:browser -- tests/aim-punch.spec.ts --project=chromium --project=mobile-chromium --output=test-results-aim-punch-final
npm run test:browser -- tests/aim-punch.spec.ts --project=chromium --grep 'duel: armored damage' --output=test-results-aim-punch-rerun
npm run build
```

Files changed by this task: `src/range/aim-punch.test.ts`,
`src/range/duel/DuelEngine.ts`, `tests/aim-punch.spec.ts`, and this document.
Pre-existing dirty edits in other scoped files were preserved.
