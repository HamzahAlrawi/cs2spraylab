# Native Utility Defaults: Build 2000935

Static research audit, 2026-10-27. No app source, existing research tools, or utility fixtures were edited. No game launch, DLL loading, native execution, process access, memory inspection, hooks, or online convar lists were used. `research/convars.txt` was not used as evidence.

## Source Identity

Installed root: `C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive`.

| Source | SHA-256 |
| --- | --- |
| `game/csgo/steam.inf` | `67bb5f38cdcfb57331eea7dbcf2d337f46ea6ed998d3482e2637f830f7210a06` |
| `game/csgo/bin/win64/server.dll` | `2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c` |
| `game/csgo/bin/win64/client.dll` | `ccaf4e4926babc052994502b19ec61198a11008a39dce712921b93dd993be9f5` |

`steam.inf`: client/server version `2000935`, patch `1.41.9.2`, source revision `11162119`, version date `Oct 22 2026`, time `14:13:16`. Both PE image bases are `0x180000000`. Every address below is a module-relative RVA, not a live-process address.

## Verified Registration Defaults

These are compiled registration defaults, not observations of a running server and not proof of effective values after CFG/map/server overrides. Decimal shorthand below preserves the intended value; exact binary32 values and bytes are in `research/native-default-values.json`.

| Convar | Default | Server initializer | Constant RVA or immediate-store RVA | Little-endian f32 bytes / immediate |
| --- | ---: | --- | --- | --- |
| `inferno_damage` | 40 | `0x5a790` | `0x17b2e44` | `00002042` |
| `inferno_damage_ct` | 40 | `0x5a830` | `0x17b2e44` | `00002042` |
| `inferno_damage_timer` | 0.2 | `0x5c070` | `0x178adf8` | `cdcc4c3e` |
| `inferno_flame_lifetime` | 7 | `0x5a980` | `0x17b8460` | `0000e040` |
| `inferno_flame_lifetime_incendiary` | 5.5 | `0x5aa20` | `0x17c5710` | `0000b040` |
| `inferno_max_range` | 150 | `0x5adf0` | `0x17b84b0` | `00001643` |
| `inferno_max_range_ct` | 110 | `0x5ae90` | `0x17c5730` | `0000dc42` |
| `inferno_max_flames` | 16 | `0x5ad40` | store `0x5adbe` | int32 `0x10` |
| `molotov_throw_detonate_time` | 2 | `0xb2ca0` | `0x1786584` | `00000040` |
| `weapon_molotov_maxdetonateslope` | 30 | `0xb49e0` | `0x17a088c` | `0000f041` |
| `inferno_ct_experiment` | true | `0x5a6e0` | store `0x5a75b` | bool `1` |
| `cl_smoke_origin_height` | 68 | `0xb1360` | `0x17a08a4` | `00008842` |
| `cl_smoke_torus_ring_radius` | 61 | `0xb1400` | `0x18ef84c` | `00007442` |
| `cl_smoke_torus_ring_subradius` | 88 | `0xb14a0` | `0x18ef850` | `0000b042` |
| `cl_smoke_edge_feather` | 21 | `0xb1220` | `0x18ef840` | `0000a841` |
| `cl_smoke_lower_speed` | 1 | `0xb12c0` | `0x1786580` | `0000803f` |

### Why These Are Defaults, Not Nearby Constants

The float initializers load the convar name into `RDX`, binary32 default into `XMM2`, flags into `R9`, then call server `0x17ba40`. That helper saves `XMM2`, initializes type `7`, stores the saved scalar at descriptor `+7` (`0x17ba8d`), sets descriptor `+4 = 1` (`0x17ba92`), and calls registration helper `0x16a4a30`. The name and populated descriptor are passed together. `0x16a4a30` copies that descriptor into registration data and either dispatches registration or queues it.

The integer/bool initializers populate the same descriptor directly: `[rsp+0x34] = 1`, default at `[rsp+0x37]`, type at `[rsp+0x90]`, and call `0x16a4a30`. For max flames the type is `3` and the default store is `c744243710000000`. For CT experiment the type is `0` and the store is `c644243701`.

The slope initializer also loads `90` while constructing its constraint descriptor. That is not its default: the `XMM2` registration argument is `30`. Likewise, the lifetime help explicitly says **average lifetime of each flame**, not total area duration. Damage help says **damage per second**; this audit does not establish the complete damage ramp/application formula from that label alone. Range help says maximum spread distance from initial ignition point, not final volume radius.

Primary logs: `native-default-registrations.log`, `native-default-smoke-helpers.log`, `native-default-value-bytes.log`, `native-default-schema-final.log`, `native-default-smoke-shape-registrations.log`, all under `research/`.

## Smoke Detonation

The binary's callback-name map at server `0x9c07a0` identifies:

| Callback | Function RVA |
| --- | --- |
| `CSmokeGrenadeProjectileThink_Detonate` | `0x9da000` |
| `CSmokeGrenadeProjectileThink_Update` | `0x9da180` |
| `CSmokeGrenadeProjectileThink_Remove` | `0x9da150` |
| `CSmokeGrenadeProjectileThink_BuildingSmokeVolume` | `0x9d9ce0` |

`Think_Detonate` performs both checks before calling projectile virtual slot `309` (`[vtable+0x9a8]`):

1. At `0x9da0bc..0x9da0e1`, obtain absolute velocity via `0x3dd480`, take its full 3D length via `0x2134f0`, and require `length <= float32(0.1)`. The threshold is at `0x1795d58` (`cdcccc3d`, exact `0.10000000149011612`). This is **speed**, not squared speed or displacement. Schema associates `m_vecAbsVelocity` with `+0x38c`; the getter also supports a physics-body path.
2. At `0x9da0e3..0x9da116`, require `now - [projectile+0xb08] >= float32(1.188)`. The threshold at `0x18ef818` is `6210983f`, exact `1.187999963760376`. Schema associates `+0xb08` with `m_flSpawnTime` (`0x1e12400..0x1e12418`).

Failure schedules another think using current game time; there is no fixed `0.2 s` addition in this callback. Exact dispatcher cadence/ordering and launch-to-first-check delay have not been established. Do not implement a fixed-delay airborne smoke detonation from this evidence.

Earlier code compares sampled-position displacement squared with `400` at `0x9da09c`, to decide whether to append a position sample. That is not the detonation-speed threshold. It corresponds to a 20-unit displacement magnitude, not 400 u/s.

Evidence: `native-default-smoke-think-map.log`, `native-default-smoke-detonate-full.log`, `native-default-smoke-threshold-helpers.log`, `native-default-schema-final.log`.

## Smoke Lifetime, Bloom, And Height

No separately named smoke lifetime/bloom/detonation-threshold convar was established. The following are **hardcoded callback constants**, not registration defaults:

| Effect age, seconds | Observed update operation |
| ---: | --- |
| 12.5 | Enter the branch that computes a scalar remap and passes its integer result to `0xb7c6b0`. |
| 17.049999237060547 | Upper endpoint supplied to that remap; the output is multiplied by 255. |
| greater than 19 | Set smoke-volume byte `+0x10b008` when the volume exists. Byte semantics remain unverified. |
| 21.049999237060547 or later | Pass zero to `0xb7c6b0`, schedule next think `now + 1`, switch callback to `Think_Remove`. |

`Think_Update` derives effect age from `(currentTick - m_nSmokeEffectTickBegin) * 0.015625` at `0x9da1d1..0x9da1f7`. Schema descriptor `0x1e12cb0` associates that named field with `+0xb68`. The effect-start path at `0x9d8230..0x9d8266` sets it to the current tick, and later installs the update callback at `0x9d8623`. Thus these are effect-relative times, not time since throw.

The zero-to-255 scalar pattern is consistent with render alpha/fade, but `0xb7c6b0` and remap helper `0x1d2200` were not fully audited. Do not treat the 17.05 endpoint, 19-second byte change, or 21.05 removal scheduling as a fully verified gameplay-opacity lifetime. The earliest scheduled final removal is approximately effect age 22.05, subject to think cadence; persistence of the entity is not persistence of opaque smoke.

`cl_smoke_origin_height = 68` is a verified registration default. Its mapping to a fixed deploy-origin offset or actual plume center/extent is not yet proven here. Ring radius `61`, subradius `88`, edge feather `21`, and lower speed `1` are likewise registration-level facts, not proof of a spherical analytic envelope.

Bloom duration, volume growth curve, density/visibility threshold, and exact deployment geometry remain unresolved. No one-second bloom or 20-second opacity lifetime is asserted.

Important rejected lead: at `0x9b9bcd`, `20` is passed with `640` to `0x9b9f60`. That helper uses `640 * 0.5 / 20` for grid dimension calculations and uses `20` in extent arithmetic. This is grid sizing, not evidence for a 20-second lifetime. See `native-default-smoke-schema-volume.log` and `native-default-smoke-volume-parameters.log`.

Other evidence: `native-default-smoke-thinks.log`, `native-default-smoke-clock.log`. The latter deliberately dumps a fixed span; code after that span has not been implicitly audited.

## Input Release Gate Follow-Up

**Conclusion:** the two located client callers invoke grenade input-frame slot `403` without a next-attack-time or pin-animation-completion gate. This is positive static control-flow evidence that release handling is eligible during pin-pull once the pin flag is set. It is not an exhaustive proof of all upstream scheduler/input-delivery behavior or a runtime measurement of minimum click duration.

Fresh vtable reads from client `C_BaseCSGrenade` primary table `0x1bd4bc8`:

| Slot | Table entry RVA | Function RVA |
| ---: | --- | --- |
| 302 (`+0x970`) | `0x1bd5538` | `0x818760`: `mov al,1; ret` |
| 403 (`+0xc98`) | `0x1bd5860` | `0x7d7730` |
| 404 (`+0xca0`) | `0x1bd5868` | `0x818a10` |
| 405 (`+0xca8`) | `0x1bd5870` | `0x7d7460` |

Caller A, timing-graph path:

- PE chained unwind data resolves fragment `0x9035d0` to primary entry `0x903580`. Entry checks/obtains its associated pawn, then obtains the active weapon through `0xa80190`.
- `0x903663..0x903679`: call slot 302; if true, call slot 403. Grenade slot 302 returns true unconditionally. No next-attack comparison precedes this call in the inspected entry path.
- Only **afterward**, at `0x90368f..0x9036ef`, compare current game time against timing-graph `+0xd0` and dispatch slots 404/405. That gate cannot prevent the earlier slot-403 invocation in the same path.
- The same path embeds `CCSPlayerWeaponTimingGraph::RunTick` and `cs_player_weapontiminggraph.cpp` at `0x9037aa..0x9037d9`.

Caller B, `0x915090..0x9150ca`: obtain active weapon, call slot 302, and tail-call slot 403 if true, with no time comparison.

Connecting this to the previously supplied body traces:

- Pin-start `0x7c7580` schedules action 200 with `r8d = 0`; at `0x7c7637` it sets `+0x1f23` (pin pulled) immediately. The subsequent `+0x1fb4/+0x1fb8` state tracks timing used elsewhere in the frame body.
- Input-frame release branch `0x7d7bc3..0x7d7c26` requires the pin flag **true** and both primary/secondary attack buttons absent. It schedules action 202 with flags 3, calls `0x7df2c0` at `0x7d7c11`, then clears the pin flag at `0x7d7c1f`. It does not compare pin age before that call. Pin-false is the result, not the entry condition of this branch.
- `0x7df2ea` loads binary32 `0.1`; the release scheduler stores `now + 0.1` into throw time `+0x1f28`. That is release-to-scheduled-throw delay, not a 23/30-second minimum hold.

The visible caller evidence does not justify a `nativeanimChargeComplete = 23/30` release gate. Animation event duration alone is not proof of a gameplay gate. However, this audit has not exhausted callers of the timing graph, same-frame input-edge sampling, equip restrictions, or the server-side counterpart. No app changes were made based on this finding.

Fresh logs: `native-default-input-slot403.log`, `native-default-input-callers.log`, `native-default-input-gate.log`, `native-default-input-vtable.log`, `native-default-input-unwind.log`, `native-default-input-entry.log`. Existing body evidence read only: `native-grenade-release-frame.asm`, `native-grenade-release-schedule.asm`, `native-grenade-action-schedule.asm`, `native-grenade-pin-start.asm`.

## Reproduction And Validation

Bundled Python: `C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe`. Dependencies are the existing `.local-tools/analysis-python` copies of `pefile` and `capstone`. New tools never import/load the native DLL and do not use Unicorn or any process API.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' research/native-default-extract.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' research/native-default-inspect.py --module server --asm 0x5a790 0x17ba40
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' research/native-default-inspect.py --module server --asm 0x9da000 --span 0x143
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' research/native-default-inspect.py --module client --asm 0x903580 --span 0x180
```

`native-default-extract.py` asserts the server hash, float-default wrapper layout, convar name, default load/store, exact bytes, and registration helper for every recovered default, then checks the stored JSON. Its first creation used `--write`, which refuses to overwrite a file. `native-default-inspect.py --log native-default-NAME.log` also creates logs exclusively. Xref scanning can report overlapping instruction candidates; conclusions above use boundary-aligned disassembly, not xref candidates alone. Automatic exception-table ranges may be only one chained fragment; explicit `--span` and `--unwind` were used where required.

Validation results:

- Hash-pinned static extraction/verifier: passed (16 defaults).
- `npm run build -- --outDir "$env:TEMP/native-default-build-2000935"`: passed. Output stayed in temporary storage; existing app build output was not replaced. Log: `research/native-default-build.log`.
- `npm test -- --run`: blocked before executing tests by `EPERM` renaming Vitest's temporary `ssr/.tmp-*` module files. All 244 suites failed to import, with no tests executed. Log: `research/native-default-tests.log`.
- Retry with `--experimental.fsModuleCache=false`: same sandbox rename failure, no tests executed. Log: `research/native-default-tests-no-cache.log`.
- `npm run check` not additionally run: it repeats the same tests/build. No passing test-suite claim is made.

No ZIP or app build is delivered for this research-only task. Unrelated dirty-worktree changes were left alone.
