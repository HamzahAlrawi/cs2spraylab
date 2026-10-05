# Combat Physics Audit

Audit: 2026-10-04. Installed build: **2000924**. This is an offline browser
trainer, not game integration. No game process, memory, DLL loading, or OS
imports are involved in the numeric verification tools.

## Evidence

| Area | Source and verification | Limit |
| --- | --- | --- |
| Uniform RNG | `tier0.dll`, SHA-256 `4e0dcb0af3f6953f37ddaed0f4e67a56d031f1e84964a262148f8a6f80547791`; constructor RVA `15e660`, float RVA `15e740`; hash-pinned Unicorn fixtures include zero, negative and boundary seeds | Numeric seeds only; native command/subtick seed derivation is not implemented |
| Recoil tables | `client.dll`, SHA-256 `d7db25d48f1d10c5e0b0296e20ed803426eb9509da41760daeda39dd35ba89b9`; loop `7cb72b..7cb903`; all 35 primary and alternate tables, including retained AUG data and Zeus | These are impulse tables, not measured impact trajectories |
| Shotgun tables | Same client, `7cba49..7cbb4a`; all four 64-entry angle/radius tables match offline emulation | JavaScript trigonometry and final ray directions are not float-exact native captures |
| Spread transforms | Same client, sampler `d23970`; radius/angle order and R8 alternate/early-Negev radial transforms inspected; weapon references resolve to `weapon_revolver` and `weapon_negev` | Branches were inspected, not the complete engine firing state machine emulated |
| Surface parameters | Fresh `scripts/surfaceproperties_game.txt` and `surfaceproperties/surfaceproperties.vsurf_c`; hash-pinned extracted fixture with inherited bases | Generic trainer material names map to selected native surfaces, not arbitrary native map triangles |
| Penetration scalar loss | Same client, `8a2129..8a21d2`; seven numeric fixtures match the actual float32 instructions and local max helpers; five stop/count fixtures from `8a2276..8a22b5` | Geometry, entity lookups, material selection, armor, and full damage flow are excluded |
| Punch recovery/camera | Existing older build-2000908 recurrence retained; full physical recoil remains separate from view tuning | No current-build end-to-end capture parity; `.45` camera and `.22` weapon fractions remain estimates |

The extracted surface files have SHA-256 hashes
`c66a59952bfdeda1df4b49b6b332510f6ac4fdbd95e2fda49b76a03f49188f40`
(game text) and
`40212500c5aa7392558cb125ad7642c1242bb66689c5813860891c77d3476797`
(decompiled physics/base properties).

## Corrections

- Base penetration modifiers now come from native extraction: concrete `.5`,
  metal `.4`, wood `.9`, plastic `.75`, glass `.99`, grate `.95`, water `.3`,
  flesh `.9`. Earlier Source-family priors were removed.
- The inspected homogeneous-material branch promotes wood to `3` and plastic
  to `2`. Glass/grates are promoted to `3` with `.05` proportional loss only
  below six Source units of thickness; thicker panes retain their base values.
- Modern scalar loss uses a `.16` proportional loss by default. The extracted
  `bulletPenetrationDamageModifier` property is preserved as evidence, but is
  not substituted for that inspected engine constant.
- With thickness `t` in Source units, power `p`, and effective modifier `m`,
  the verified arithmetic is `damage * loss + 11.25 / (p * m) + t*t / (24*m)`.
  Intermediate operations follow the inspected float32 order. The initial
  `3.75/(p*m)` implementation omitted an additional native multiplication by 3.
- The inspected handler disables further penetration after 3000 Source units
  of travelled distance. A speculative hard 90-unit thickness cap was removed.
- The handler subtracts loss and requires at least one remaining damage before
  consuming a penetration count (`8a2276..8a22b5`). Sub-one damage stops at entry
  in the trainer; no surface/flesh exit or downstream hit is invented.
- Negev transforms both radii by repeated squaring and `1-r`, for recoil index
  below 3. R8 alternate fire transforms both by `1-r*r`; primary fire does not.
- Native shotgun pattern mode resamples inaccuracy per pellet. Pattern-disabled
  random mode shares the first inaccuracy sample. Lookup uses
  `floor(recoilIndex)*pelletCount + pelletIndex`, without wrapping at 64.
  Out-of-table pattern fallback draws angle before radius.
- Zeus has zero recoil but an extracted `.05` firing penalty and zero recovery
  duration. Zero-time recovery/prediction now preserves that penalty without
  evaluating `0/0`; positive time returns it to the stance baseline. This is
  the limiting case of the retained recovery formula, not a new native capture.

## APIs And Integration

`resolveBulletRay(request)` / `resolvePenetratingRay(request)`:

```ts
const result = resolveBulletRay({
  origin, direction, range, equipment, stats,
  arena: {solids: environmentSolids(arena, environmentState)},
  actors: snapshots, shooterId, shooterSide, maxPenetrations: 4,
});
```

Positions, `range`, distances, and thickness are in metres. Direction is
normalized internally. Native `stats.range` remains in Source units. `stats`
overrides equipment lookup; its `penetration` field is native `m_flPenetration`.
Missing penetration fails closed. The result contains ordered `contacts`,
`surfaces` with entry/exit phases, `hits` with raw residual damage and separate
health/armor damage, and a world-space endpoint. It does not mutate snapshots.
Apply damage/events in the parent, and retain physical impact points.

Optional solid fields: `material`, `active`, `health`, `shotBlocking`, `id`,
`shape`, `penetrable`, `penetrationModifier`, `damageLoss`, and
`maxPenetrationThickness`. Moved/open/destroyed props must be resolved by the
environment first; source indices are preserved. `passable` alone does not
make a surface bullet-transparent.

Range scoring must keep the actual Three target-mesh raycast. Use its distance
as `range`, pass cover solids and `actors: []`, and accept damage only when
`result.stopped === 'range'`. Alternatively,
`damageThroughSurface(remainingDamage, equipmentOrStats, {entry, exit}, material,
options)` applies only material loss; it does not add travel falloff or a count
budget. Cover can come from scenario covers or `RANGE_WALLS`. Neither API
replaces the mesh intersection or changes the scoring sample's hit point.

`shotDirection(aim, random?)` accepts optional `weaponId`, `alternateFire`,
pre-shot `recoilIndex`, and numeric `seed`. An explicit random callback takes
precedence over `seed`. `sourceRandom(seed)` supplies a persistent Source RNG
closure, without global RNG state. Callers must pass weapon identity to enable
Negev/R8 branches; weapon recoil seeds are not shot seeds.

`shotDirections(aim, pelletCount, random?, pattern?)` / `pelletDirections` returns
one ray per pellet. Extracted `aim.weapon.spreadSeed` activates native pattern
tables; `aim.shotgunPatterns = false` selects random shared-inaccuracy mode.
Externally supplied patterns have one `{horizontal, vertical}` normalized spread
slope per pellet. Do not call `recovery.fire()` once per pellet: it is one
trigger event. `shotgunSpreadTable(seed, pelletCount)` exposes the audited table.

## Remaining Approximations

- Duel actors use the existing analytic hit zones, not extracted animation
  hitboxes. Their flesh chord includes intervening gaps between those zones.
- Solids are authored axis-aligned boxes or ramp wedges; native contents flags,
  mixed-material exits, breakable exception branches, and nested native trace
  merging are not reconstructed. Each authored solid consumes its own count.
- Four allowed penetrations are an explicit trainer default, not a newly
  verified native initialization fixture. Teammates never receive health/armor
  damage. Friendly flesh consumes penetration using the flesh modifier by
  default; `friendlyFleshPenetration: 0` makes it opaque. This is trainer policy,
  not the native friendly-fire convar's default behavior.
- Full chord loss is deducted at entry. Travel falloff is applied once per
  incremental distance, using the existing range-modifier formula. Complete
  native segment ordering, range falloff, and armor damage are not emulated.
- Recovery evaluation remains fixed-step; imported captures use fitted impulses.
  Camera/viewmodel fractions, quaternion interpolation, and subtick timing are
  not measured parity.

## Verification

```text
python tools/verify-native-recoil.py
python tools/verify-native-penetration.py
node tools/verify-native-surfaces.mjs
npm run test:run -- src/range/recoil.test.ts src/range/shot-model.test.ts src/range/ballistics.test.ts src/range/view-recoil.test.ts src/range/duel/penetration.test.ts
```

The Python tools reject changed DLL hashes. Regeneration uses `--write` only
after offsets are independently inspected. Surface verification re-extracts
the installed archive and compares a fixture rather than trusting runtime
constants. Full project tests/build belong to the parent after shared edits
settle; focused worker checks are not a full-application parity claim.

Final scoped check on 2026-10-04: all 249 tests in the five owned suites plus
`duel/extended-combat.test.ts` passed. `npx tsc --noEmit` passed. All three native
verification commands above passed against the installed build-2000924 files.
The parent integration cases now pass with extracted AK penetration `2`, AWP
`2.5`, and Zeus `0`; these equipment fields are weapon-worker-owned.

## Owned Change Manifest

Runtime and tests:

- `src/range/ballistics.ts`
- `src/range/ballistics.test.ts`
- `src/range/recoil.ts`
- `src/range/recoil.test.ts`
- `src/range/shot-model.ts`
- `src/range/shot-model.test.ts`
- `src/range/view-recoil.test.ts`
- `src/range/duel/penetration.ts`
- `src/range/duel/penetration.test.ts`

Evidence and tools:

- `src/range/recoil-provenance.json`
- `src/range/native-rng-fixture.json`
- `src/range/native-table-fixture.json`
- `src/range/native-alternate-table-fixture.json`
- `src/range/native-shotgun-table-fixture.json`
- `src/range/duel/native-penetration-fixture.json`
- `src/range/duel/native-surface-fixture.json`
- `tools/verify-native-recoil.py`
- `tools/verify-native-penetration.py`
- `tools/verify-native-surfaces.mjs`
- `docs/combat-physics-audit.md`

Surface verification also regenerates ignored static research exports
`research/ballistic-surface-game.txt` and
`research/ballistic-surface-properties.vsurf`. They are not runtime dependencies.
`view-recoil.ts` was inspected but not changed. No parent-owned simulation,
engine, equipment, config, geometry, UI, style, or README file was edited by this
worker. No commit, push, deployment, or live-game access was performed.

[Valve's public RNG interface](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/vstdlib/random.h)
is background documentation only. It is not evidence that Source 1 code equals
the current CS2 engine.
