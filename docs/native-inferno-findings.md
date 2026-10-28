# Native Inferno: Damage And Propagation

Static research pass, 2026-10-28, bounded to 20 minutes. Writes are restricted to this document and new `research/native-inferno-*` evidence/tools/fixtures. No app source, promoted defaults/verifier, or prior findings were changed. No game execution, process access, game DLL loading, hooks, or legacy Source/CS:GO values were used.

## Source And Confidence

Installed build: **2000935**, patch `1.41.9.2`, source revision `11162119`, `steam.inf` version date Oct 22 2026, 14:13:16.

Primary source: `C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/bin/win64/server.dll`.

SHA-256: `2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c`. `steam.inf` SHA-256 from the preceding defaults audit: `67bb5f38cdcfb57331eea7dbcf2d337f46ea6ed998d3482e2637f830f7210a06`.

All code addresses below are **server RVAs**, image base `0x180000000`, not live memory addresses. The binary embeds `game/server/cstrike15/effects/inferno.cpp`, `CInferno::InfernoThink`, and separate spread/damage profiling labels. Those labels, RTTI/vtable association, field accesses, and caller control flow were used together. This is not measured gameplay.

Evidence levels:

- **Registration:** name/default/helper association in the installed binary.
- **Active static path:** traced caller, branches, field initialization and arithmetic.
- **Offline fixture:** isolated instructions emulated in Unicorn with explicit inputs and restricted helper paths. No entity/world/game scheduler is executed.
- **Unresolved:** final player modifiers/HP sequence, exact engine think dispatch quantization, and complete terrain-dependent flame placement.

## Actionable Summary

1. The damage ramp is **inferno-wide, starts at entity spawn**, and has a default **2-second duration**. It does not start afresh when each victim enters fire.
2. Raw per-event damage is `selectedDps * damageInterval * rampFactor`, not always 8. With default 40 DPS and 0.2 seconds, it rises approximately `0.8, 1.6, 2.4, ... 8` at inferno ramp ages `0.2, 0.4, 0.6, ... 2` seconds.
3. Damage has its own periodic timer. Its first inactive poll arms a deadline and does not deal damage; overdue polls advance the old deadline by one interval, and the inferno caller loops to catch up.
4. Propagation has a separate nominal pass interval: **0.1 s molotov / 0.01 s incendiary** under registered defaults. Per-flame timers grant spawn-attempt credit; there is no immediate layout of 16 equally spaced angular patches.
5. Raw damage must not be independently rounded to an integer per fire tick. A downstream generic damage path includes fractional carry, with player modifiers before that step.

## Damage Ramp Reference And Default

`CInferno` constructor `0x347e80` installs vtable `0x17c3fc8` and constructs timers at `+0x13c0` (damage cadence), `+0x13d8` (damage ramp), `+0x1440` (spread cadence), and `+0x1458` (another spread-related gate).

Timer constructor `0xca8130` initializes duration `+8 = 0`, expiry `+0xc = -1`, rate `+0x10 = 1`, and clock-slot selector `+0x14`. These are timer internals, not inferred animation timings.

Spawn function `0x358550` resets fire count and starts the damage-ramp timer:

| Code | Operation |
| --- | --- |
| `0x358598` | Load float32 `2` from `0x1786584`. |
| `0x3585a0..0x3585cc` | Locate timer `+0x13d8`; set its duration to `2 / timerRate`. |
| `0x3585d4..0x35861b` | Read the timer's game clock and set expiry to `now + duration`. |
| `0x358627..0x35865d` | Install `InfernoThink` (`0x34f9d0`) and schedule it using current game time. |

Thus the default ramp is **2 seconds at timer rate 1**, with reference **spawn's clock read**, not first damage, first victim contact, first child flame, or a sound/animation marker. Burning is established separately through the ignition/root-flame path (`0x359af0` calls flame creation `0x34c290`). Exact elapsed time between entity spawn and successful initial ignition was not measured. Do not silently redefine the ramp reference as the first burning frame without preserving that distinction.

The inspected inferno code uses this ramp timer in spawn and damage calculation; no per-victim entry reset appears in that path. Offline fixtures do not prove arbitrary external code can never alter timer rate/state.

Primary logs: `research/native-inferno-constructor-clock.log`, `research/native-inferno-region.log`.

## Raw Damage Formula And Application

At `0x35069d..0x3506d2`, `InfernoThink` obtains the damage-type value and selected DPS through virtual calls, reads `inferno_damage_timer`, and multiplies DPS by that interval. Primary vtable slots 271/272 map to `0x34ebe0` / `0x34eba0`: the former returns literal `8` as the damage-type value, not the damage amount. The latter selects `inferno_damage` or `inferno_damage_ct` according to inferno type and `inferno_ct_experiment`. Both registered defaults are 40.

At `0x3506d6..0x35077f`, the code reads the ramp timer and applies this float32 computation:

```text
baseAmount = selectedDps * interval
if now < rampExpiry:
    if rampExpiry > 0 and rampDuration != 0:
        factor = clamp(((now - rampExpiry) + rampDuration) / rampDuration, 0, 1)
    else:
        factor = 1
    amount = baseAmount * factor
else:
    amount = baseAmount
```

The native clamp helper `0x17b8c0` was inspected and executed in the isolated fixture. The subtraction helper `0x1f8150` is `a - b`. Clock getter `0xcbad30` resolves the timer's own clock slot. **Current time is used**, not the cadence timer's historical deadline; catch-up iterations therefore evaluate the ramp at their current clock read.

| Ramp age | Approximate raw amount at 40 DPS / 0.2 s |
| ---: | ---: |
| 0.2 | 0.8 |
| 0.4 | 1.6 |
| 0.6 | 2.4 |
| 0.8 | 3.2 |
| 1.0 | 4.0 |
| 1.2 | 4.8 |
| 1.4 | 5.6 |
| 1.6 | 6.4 |
| 1.8 | 7.2 |
| 2.0 and later | 8.0 |

These are samples of a continuous linear ramp, **not a measured or hardcoded integer tick sequence**. Exact float32 results are in `research/native-inferno-arithmetic-fixture.json`; for example age float32(0.2) produces `0.8000001907348633` with ramp start zero and duration two.

The damage phase builds candidates, calls `0x353660` for contact/coverage, and appends qualifying entities. That predicate scans live/nonexpired flames and performs geometric/trace checks. At `0x3507a1..0x3508dd`, each qualifying candidate receives a damage-info object constructed by `0xfbfa10`, with the ramped float amount passed on the stack, followed by application through `0x3f3ae0`. The amount is not multiplied by the number of overlapping flames in this loop. Virtual eligibility slot 278 (`0x34a6d0`) returns true in the inspected `CInferno` table.

This does not establish stacking policy across distinct inferno entities, all candidate-query deduplication guarantees, armor/team/self-damage modifiers, or final HP loss. Those belong to later/shared paths.

Evidence: `research/native-inferno-damage-getters.log`, `research/native-inferno-damage-routing.log`, `research/native-inferno-spread-contact-helpers.log`, full region log. Offline arithmetic tool: `research/native-inferno-arithmetic.py`.

## Damage Cadence And Initial Delay

At `0x350159..0x350191`, the inferno calls periodic helper `0xcbd110` on timer `+0x13c0`, with the registered damage interval (0.2 s). That helper does the following for positive intervals:

- Inactive expiry (`-1` initially): call timer-start helper `0x291440`, setting duration `interval / rate` and expiry `now + duration`; return false.
- Active but `now < expiry`: return false.
- Due (`now >= expiry`): update stored interval if needed, set `expiry = previousExpiry + storedDuration`, and return true.

At `0x350b41..0x350b68`, after damage processing, the caller polls again and branches back into damage processing while due. This is a catch-up loop, not simply `lastDamage = now`. The isolated timer fixture demonstrates two due returns at the same time 0.65 after an earlier deadline 0.4, advancing deadlines to 0.6 then 0.8.

**Initial delay:** there is no immediate damage on the cadence timer's first inactive poll. At rate 1, its first deadline is 0.2 seconds after that poll. This is not proof of exactly 0.2 seconds after detonation: timer initialization, ignition ordering, and engine dispatch determine the alignment. A victim entering an already-running inferno uses the existing inferno phase, rather than waiting a new victim-specific 0.2 seconds.

Expired/covered/extinguished state can suppress damage. The code separately checks expiry and smoke effects before damage; no raw timer fixture simulates those conditions.

Evidence: `research/native-inferno-timer-helpers.log`, `research/native-inferno-damage-timer-full.log`, `research/native-inferno-timer-fixture.json`.

## Fractional Damage Application

The generic damage application routine calls further virtual processing before its integer/fraction step at `0x3f40bc..0x3f4100`:

```text
whole = floor(postModifierDamage)
carry = (postModifierDamage - whole) + priorVictimAccumulator
if carry >= 1:
    whole += 1
    carry -= 1
```

The native floor helper at `0x16c9c64` was disassembled and executed in the isolated fixture. Schema name `m_flDamageAccumulator` at `0x181a830` is associated with member `+0x2dc` by static descriptor `0x1de35f0`; that is the member read by the fraction step. The result stores a new accumulator value later in the routine.

`research/native-inferno-health-arithmetic-fixture.json` verifies this arithmetic with ramp outputs as **explicit post-modifier inputs** and initial carry zero. It is not a native gameplay HP fixture: player modifiers, the branches preceding this arithmetic, flags following it, and final health commit are excluded. Do not promote its conditional integer outputs to a fixed CS2 fire-damage table. Preserve fractional damage or a documented accumulator policy in any trainer approximation.

Evidence: `research/native-inferno-application-full.log`, `research/native-inferno-round-helper.log`, `research/native-inferno-accumulator-schema.log`.

## Propagation Defaults

Fresh registration evidence is in `research/native-inferno-registrations.log`. Float initializers associate the named string and `XMM2` default with registration helper `0x17ba40`; integer defaults are stored in the registration descriptor before `0x16a4a30`.

| Convar | Default | Initializer RVA | Constant RVA / immediate store |
| --- | ---: | --- | --- |
| `inferno_per_flame_spawn_duration` | 3 s | `0x5af30` | `0x178ae08` |
| `inferno_initial_spawn_interval` | 0.02 s | `0x5ac00` | `0x17b8400` |
| `inferno_child_spawn_interval_multiplier` | 0.1 | `0x5a590` | `0x1795d58` |
| `inferno_max_child_spawn_interval` | 0.5 s | `0x5aca0` | `0x178657c` |
| `inferno_child_spawn_max_depth` | 4 | `0x5a630` | int store `0x5a6aa` |
| `inferno_spread_speed_mult` | 1 | `0x5b070` | `0x1786580` |
| `inferno_spread_speed_mult_ct` | 10 | `0x5b110` | `0x178ae0c` |
| `inferno_max_trace_per_tick` | 16 | `0x5c1b0` | int store `0x5c227` |
| `inferno_flame_spacing` | 42 units | `0x5aac0` | `0x17a0898` |
| `inferno_spawn_angle` | 45 | `0x5afd0` | `0x17a089c` |
| `inferno_surface_offset` | 15 units | `0x5b1b0` | `0x17a9cb0` |
| `inferno_forward_reduction_factor` | 0.9 | `0x5c110` | `0x1795d78` |

Registration values are not proof of effective CFG overrides or of a complete placement algorithm. Decimal values above stand for their stored binary32 values.

### Global Spread Pass

Getter `0x34f0b0` returns `float32(0.1) / max(selectedSpreadMultiplier, float32(0.1))` while fire count is below 64. It selects multiplier by inferno type: molotov uses the T convar; nonzero type uses the CT convar. At count 64 or above, the divisor falls back to 1. The `max` helper `0x1783a0` was directly inspected.

Default nominal periods are therefore **0.1 s T / 0.01 s CT**, subject to engine think dispatch. The outer `InfernoThink` spread gate uses timer `+0x1440` and helper `0xcb70a0`. That helper starts on first poll, advances by a stored interval when due, and skips any additional already-missed spread periods to a nonpast deadline. Unlike the damage caller, this path does not run one spread pass per missed period in a catch-up loop.

Do not equate a nominal 0.01-second period with measured sub-tick execution cadence. The engine scheduler was not run.

### Root And Child Timers

Creation helper `0x34c290` allocates one 0x88-byte flame record. Relevant fields:

| Flame field | Observed role |
| --- | --- |
| `+0x24` | active/burning flag, set true at successful creation |
| `+0x28` | generation/depth input |
| `+0x2c` | pending spawn-attempt credit, initialized zero |
| `+0x30` | parent flame pointer (null for root) |
| `+0x38` | spawn-window timer |
| `+0x50` | child-attempt interval timer |
| `+0x68` | flame-lifetime timer |

Root creation starts `+0x38` with `inferno_per_flame_spawn_duration = 3` and `+0x50` with `inferno_initial_spawn_interval = 0.02` (`0x34c567..0x34c596`). It sets the active flag immediately; no separate visual-marker activation delay was found here.

Child creation (`0x34c527..0x34c596`) reads its parent's **stored duration** using `0x34eb60`, then starts the child's spawn-window timer with that duration. **This helper does not return remaining time.** Thus default children get a fresh 3-second spawn window from birth, not just the remainder of their parent's window. Child-attempt interval is `min(parentStoredInterval * 0.1, 0.5)`, then started at child birth. Nominal intervals by depth are approximately `0.02`, `0.002`, `0.0002`, `0.00002` seconds; they are only tested during global passes.

At `0x3588a0..0x358931`, each global spread pass scans flames. If active, lifetime not expired, spawn window not expired, and child-attempt timer due, it restarts the child-attempt timer from **now** (`0x33f280`) and increments pending credit once. There is no per-flame while-loop granting every missed tiny interval. Credit can remain pending after the spawn window ends; the later attempt stage tests credit and flame lifetime rather than requiring the spawn window still be open.

The later attempt stage (`0x358c22` onward) requires credit, consumes it, computes proposed child depth = parent depth + 1, and rejects it when that value is **>= 4** at the default depth limit (`0x358cc0..0x358cd1`). With root depth zero, this permits child depths 1, 2, 3 on this path.

### Placement Is Not A Golden-Angle Layout

The spread path seeds randomness from inferno state, chooses a randomized quadrant/order, and tests up to four directional candidates. For root/no-parent candidates it uses a random angle within a quadrant plus quadrant offsets (`0x358d31..0x358db1`). Parent-linked candidates also use parent-relative direction, angular perturbation and inherited motion terms. Ground/LOS traces, smoke/water-related checks, range, and placement rejection affect success.

The trace budget comes from `inferno_max_trace_per_tick` and is decremented by trace operations. Successful creation and certain rejection statuses terminate further candidate attempts for that parent pass. No fixed golden-angle construction was found in the inspected native spread path.

Fire-count limiting uses the entity's cap field `+0x1434` (initialized from `inferno_max_flames`, default 16) and a hard upper limit 64. The native code creates a growing parent-linked set, not all 16 patches at ignition. This audit does not provide a complete terrain-independent placement replacement; any simplified trainer placement should remain explicitly approximate.

Evidence: full region log, `research/native-inferno-spread-getters.log`, `research/native-inferno-spread-divisor.log`, `research/native-inferno-spread-timer-full.log`, `research/native-inferno-spread-timer-tail.log`.

## Validation And Remaining Work

New isolated native fixtures passed against their float32/reference calculations: ramp (15 cases), damage timer (9 polls), conditional fraction carry (10 cases). Re-run without `--write` to verify the saved JSON:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' research/native-inferno-arithmetic.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' research/native-inferno-arithmetic.py --timers
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' research/native-inferno-arithmetic.py --health
```

`research/native-inferno-inspect.py` is a hash-pinned read-only PE disassembler. Logs are created exclusively under its owned prefix. Its member/xref scans can report overlapping candidate instructions; conclusions use boundary-aligned code listings. PE exception entries may be chained fragments, so explicit spans and the adjacent fragments were inspected for timer/application paths.

App validation was attempted as required by AGENTS, without source edits: `npm test -- --run` failed before executing tests because sandbox temporary SSR-file renames returned `EPERM` (248 import failures, no tests run). `npm run build -- --outDir "$env:TEMP/native-inferno-build-2000935"` passed with existing chunk-size warnings. Output was kept in temporary storage; logs are `research/native-inferno-tests.log` and `research/native-inferno-build.log`. `npm run check` was not repeated because it runs those same checks.

Still unresolved: exact scheduler quantization and ignition/spawn clock alignment; complete player-specific modifier/health-commit path; cross-inferno stacking; exact world-query candidate multiplicity; full terrain/trace/velocity propagation parity; special inferno types and authored timer-rate overrides. The conditional health fixture must not be described as measured HP damage. No app change or exact-parity claim is made.
