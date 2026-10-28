# Native Grenade Flight, Contact, and Fuse Findings

Audit completed 2026-10-28. Static installed-file evidence only; no game process,
memory, hooks, or DLL loading. No app code changed. This is a training-simulation
reference, not a claim of measured gameplay parity.

## Identity and Method

- Installed `ServerVersion=2000935`, patch `1.41.9.2`, source revision `11162119`,
  compiled October 22, 2026 at 14:13:16, from `game/csgo/steam.inf`.
- Module: `C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/bin/win64/server.dll`.
- SHA-256: `2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c`.
- Image base `0x180000000`; every code/data address below is an RVA, not a live
  process address. Native coordinates use Z-up; units are native units/seconds.
- Tools: existing `tools/audit-native-grenade-code.py` and new
  `tools/native-flight-audit.py`, using pefile/Capstone with Blender's bundled
  Python. Logs reside in `research/native-flight-*.log` and include module hashes.
- Member/RIP-reference scans produce candidates, including overlapping-prefix
  decodes. Conclusions below use reviewed contiguous instruction listings, not
  a byte-pattern hit alone. PE exception entries can split one function: e.g.
  `0x9d3e60` continues past its first unwind-fragment end `0x9d4391` to `0x9d502e`.

## Implementation Summary

| Topic | Verified result | Evidence RVAs |
| --- | --- | --- |
| Flight subdivision | `1/128 s` substeps for ordinary `1/64 s` outer frames | `9d1a00`, `9d1acd`, `9d1af3`, `9d1b53`, `9d1bfe` |
| Default dry-flight gravity | `800 * 0.4 = 320 units/s^2`, configurable world gravity | `78370`, `3f1200`, `3e6010`, `e94020` |
| Custom contact handler | Primary vtable slot 163 (`+0x518`), `9d3e60` | `17ccec0`, `e92c30` |
| Elasticity | Clamp projectile elasticity to `[0, 0.9]`; default `0.45` | `9d4385` through `9d43be` |
| Clipping | `v + n * (max(-2*dot(v,n), 0) + 0.03125)`, then elasticity | `e94610`, `9d4498` through `9d44c7` |
| Stop | Strict candidate speed squared `<400`, conditionally on support/slope | `9d4619` through `9d479c` |
| Smoke normal detonation gate | Full 3D speed `<=0.1` AND spawn age `>=1.188 s` | `9da0bc` through `9da116` |
| HE/default flash deadline | `now + 1.5 s`; timer checks strict `now > deadline` | `9d6030`, `9bd730`, `17e2c0` |
| HE/flash repeat think | Request `now + float32(0.2)`; scheduler rounds to 64 Hz ticks | `9bd777`, `3f1eb0` |

Use the formulas below with their branch conditions. Do not replace the native
contact routine with unconditional `reflect(v,n)*0.45`, or smoke with a generic
"resting after 0.2 seconds" rule.

## Flight and Dispatch

`research/native-flight-method-inventory.log` inventories every primary base and
smoke slot and lists each entry's initial unwind fragment. The base table
`0x17ccec0` has **324 executable entries**, slots 0-323, not 330 methods. Entry
324 is RTTI data; a secondary interface vtable starts at `0x17cd8e8`. Smoke's
primary table `0x18ee818` likewise has 324 entries. HE has additional methods;
do not apply the base count indiscriminately to derived tables.

The important shared methods are slot 163 (`0x9d3e60`, contact), slot 228
(`0x9d1a00`, physics wrapper), and slot 319 (`0x9bd730`, deadline timer).
HE and flash RTTI tables independently confirm the shared contact/timer slots.
The initially suspected `9dc270`/`9d62f0` and `9c5050`/`9d3210` are not the
custom velocity response located here.

At `0x9d1a00`, the wrapper switches to fly-gravity/custom-contact behavior,
computes a subdivision count from frame duration times 128, and calls generic
physics `0xe95b30` inside temporary time contexts. For a `1/64 s` outer frame,
this is two `1/128 s` calls. Each context (`0x9b57a0`) sets current time and
frame duration, then restores them through `0x9b6330`. Nonmultiple frame lengths
have a separate count/remainder path; do not claim every possible outer frame
is universally rounded up to 128 Hz. Native source-location strings at
`9d1b35`/`9d1bdf` identify `basecsgrenade_projectile.cpp:554` and `:565`.

Collision dispatch `0xe92c30` reads the contact-mode byte `this+0x2f2`; mode 2
dispatches `[vtable+0x518]`. The grenade wrapper sets that mode before calling
generic physics. Thus the elasticity consumer is connected to flight, not just
an unused method containing a familiar constant.

In ordinary dry free flight, `0xe94020` performs:

```text
g = sv_gravity * effectiveGravityScale
vzNext = vz - g*dt
delta = ((vx + baseVx)*dt,
         (vy + baseVy)*dt,
         ((vz + vzNext)*0.5 + baseVz)*dt)
velocity.z = vzNext
```

`0x3e6010` copies the requested scale `+0x3fc` to effective scale `+0x40c`
unless the disabling flag `+0x408` intervenes. Creation/spawn sets `0.4` through
`0x3f1200`; the current installed `sv_gravity` registration at `0x78370` supplies
800. Therefore 320 is supported for the default enabled-gravity case, not for
all server configurations or water branches. Grounded behavior bypasses gravity.
Default spawn also constructs an axis-aligned `[-2,+2]` hull at `9d8801` onward;
the alternate spawn branch uses different collision setup. This does not prove
that a radius-2 sphere reproduces native hull contacts.

Evidence: `native-flight-physics-wrapper.log`, `native-flight-substep-context.log`,
`native-flight-integration.log`, `native-flight-flight-dispatch.log`,
`native-flight-final-support.log`, `native-flight-gravity-registration.log`,
`native-flight-spawn-gravity.log`, `native-flight-he-flash-tables.log`.

## Contact Formula and Stop

Main routine: `0x9d3e60` through return `0x9d502e`, fully retained in
`research/native-flight-custom-contact.log`. For the ordinary nonbreakable,
nonmoving surface case, with normalized native contact normal `n`:

```text
e = clamp(projectile.elasticity, 0, float32(0.9))
clipped = v + n * (max(-2*dot(v,n), 0) + 0.03125)
localOut = clipped * e
candidate = localOut + baseVelocity
candidateSpeed2 = dot(candidate, candidate)
```

The clipping helper is `0xe94610`; the caller passes 2 as its fifth argument.
There is no old-style component-by-component +/-0.1 zeroing in this helper.
The `0.03125` term is a **velocity normal bias**, not evidence for a positional
push-out of that size. Elasticity scales the whole clipped vector, including
tangential components. This custom path reads the grenade's `+0x3f8` directly;
it does not multiply by a surface-elasticity field. The nearby generic routine
`0xe98ac0` does use a second elasticity input: do not confuse the two paths.
The constructor friction value `+0x3f4 = 0.2` is not an extra multiplier in this
custom reflection block.

The support/slope branch is explicitly:

```text
eligibleSlope = n.z > float32(0.7)
             || (n.z > float32(0.1) && candidateSpeed2 < 400)
supportBranch = hitEntity != null && eligibleSlope && supportPredicate(hitEntity)

if supportBranch:
    if candidateSpeed2 > 96000:
        d = dot(normalize(localOut), n)
        if d > 0.5:
            localOut *= 1.5 - d
    setLocalVelocity(localOut)
    if candidateSpeed2 < 400:
        setGroundEntity(hitEntity)
        setLocalVelocity((0,0,0))
        setAngularVelocity((0,0,0))
    else:
        continueRemainingMovement(...)
else:
    setLocalVelocity(localOut)
    continueRemainingMovement(...)
```

`supportPredicate` here names a branch, not a recovered native symbol: at
`9d4670` through `9d469e` it accepts `helper_3e65d0(hit)`, either successful RTTI
cast to `CBasePlayerWeapon` or `CBaseCSGrenadeProjectile`, or hit vcall `+0x570`.
The precise semantic names/flags inside `helper_3e65d0` remain unresolved.
Keep this uncertainty explicit when implementing non-world contact behavior.

The stop comparison is strictly `<400`, i.e. `<20 units/s`, not `<=20`, and is
not an unconditional wall-contact stop. The tested squared speed is computed
**before** the optional `96000` high-speed attenuation and is not recomputed
after that adjustment. The 96000 comparison is squared speed, not 96000 units/s.
The slope test uses the possibly adjusted stored normal `this+0xb2c/+0xb34`.

Additional verified branches that the simple formula excludes:

- `9d43dc` onward may replace the trace normal with a normalized vector from a
  hit entity's reference position to contact position, gated by hit vcall `+0x558`.
- A hit entity with flag `+0x388 & 0x1000000` contributes `0.3 *` its vcall
  `+0x688` velocity to `localOut` before the candidate speed calculation.
- Breakable/damage contact logic runs before elasticity. A destroyed breakable
  branch scales the current velocity by `0.4` and exits early (`9d42e8` onward).
- Remaining-time movement uses trace fraction and frame duration; the non-support
  path can perform a second clip/trace when a subsequent fraction is `<0.5`
  (`9d48e9` through `9d49b2`). A one-contact-per-step implementation is not equal.
- At `9d4f7b`, an existing bounce count `>=21` forces velocity/move-state changes,
  a vcall at `+0xa10`, and a think request at `now` when applicable. Otherwise
  the stored bounce count increments. This is not simply "21 bounces allowed".

Evidence: `native-flight-custom-contact.log`, `native-flight-contact-helpers.log`,
`native-flight-verification.log`. Reflection formula assumes finite operands;
NaN/error paths and specialized entity interactions are not a parity fixture.

## Smoke Timing

The named callback `CSmokeGrenadeProjectileThink_Detonate` is mapped to
`0x9da000` by native name-to-function/function-to-name code at `0x9c07a0` and
`0x9c0940`. Creation `0x9bd390` installs it and requests first think at `now`
(`9bd428`, `9bd460`). Spawn `0x9d8730` stores spawn time at `this+0xb08`;
smoke's spawn override `0x9d8d50` tails into that base spawn.

For finite ordinary values, the normal callback is:

```text
speed = sqrt(vx*vx + vy*vy + vz*vz)
if speed <= float32(0.1) && now - spawnTime >= float32(1.188):
    virtualDetonate()  // vtable +0x9a8, smoke RVA 0x9be560
else:
    requestNextThink(now)
```

`0x2134f0` contains the square root, so this is **speed**, not squared speed.
The age constant is `1.187999963760376` and speed threshold
`0.10000000149011612` in float32. No 0.2-second delay or 0.2-second polling
increment occurs in this callback. It also maintains position-history samples;
the separate `400` comparison near `9da09c` is **position distance squared**,
not this smoke detonation speed threshold.

The gate starts volume work in `0x9be560` and changes the callback to
`CSmokeGrenadeProjectileThink_BuildingSmokeVolume` (`0x9d9ce0`). Therefore this
proves the normal detonation/volume-build eligibility, **not** the exact instant
of visible smoke, sound, final voxel availability, or full bloom. Those stages
must not be collapsed into the same timestamp without further tracing.

Conditional arithmetic: with spawn time and callback execution on an exact
64 Hz time grid, a stationary smoke first reaches the age gate at tick 77,
`1.203125 s`, because tick 76 is `1.1875 s`, still below the constant. This is
not a runtime measurement or a universal smoke fuse: speed can delay it, and
the actual first/due-think dispatch phase was not established here.

Evidence: `native-flight-smoke-registration.log`, `native-flight-smoke-create.log`,
`native-flight-smoke-think.log`, `native-flight-spawn-gravity.log`,
`native-flight-final-support.log`, `native-flight-verification.log`.

## HE and Flash Fuse

Verified chain, including the requested first-think check:

1. HE create `0x3aac40` passes float32 `1.5` to `0x9d6030` at `3aac8f`.
   Flash spawn `0x3ae390` passes `this+0xb40`; the default factory initialization
   stores `1.5` there at `3ac5cf`. A modified flash fuse is not necessarily 1.5.
2. `0x9d6030` obtains entity time through `0x92db00`, adds the argument through
   `0x17dc60`, and stores the resulting absolute float deadline at `+0xa88`.
3. Both install callback `0x3aa9cc` and explicitly request first think at `now`
   through `0x3f1eb0`: HE at `3aad75`, flash at `3ae408`.
4. `0x3aa9cc` jumps through vtable `+0x9f8` (slot 319), `0x9bd730` in both.
5. `0x9bd730` uses comparator `0x17e2c0`: only a positive result detonates
   through vtable `+0x9a8`. Equality does not detonate: **`now > deadline`**.
6. Otherwise it requests `now + 0.20000000298023224` through `0x3f1eb0`.

The scheduler converts a positive requested absolute time to an integer tick:

```text
dueTick = trunc(float32(float32(requestedTime * 64) + 0.5))
```

See `3f1ef7` through `3f1f0c`. Disabled-time/sentinel handling is separate.
On exact 64 Hz callback times, the repeat interval is consequently 13 ticks,
`0.203125 s`, not exactly `0.2 s`.

The offline float32 fixture uses a tick-aligned spawn time of 1000 seconds:

| Assumed first callback | Subsequent checks, relative to spawn | First strict deadline pass |
| --- | --- | --- |
| Same tick as creation | `0, .203125, .40625, ... 1.421875, 1.625` | `1.625 s` |
| One outer tick later | `.015625, .21875, ... 1.4375, 1.640625` | `1.640625 s` |

These are **conditional arithmetic examples**, not measured outcomes or a bound
on all runtime behavior. Scheduling at `now` is proven; whether that first
callback executes in the creation tick or later still requires tracing the
outer think dispatcher and spawn ordering. Entity-time contexts, spawn phase,
float precision, and forced contact/stop paths can matter. In particular,
**neither exactly 1.5 s nor exactly 1.6 s is established as the actual fuse**.
Do not select 1.625 as a universal constant either; preserve deadline and
scheduling semantics separately.

Evidence: `native-flight-he-create.log`, `native-flight-flash-spawn.log`,
`native-flight-final-support.log`, `native-flight-timing-dispatch.log`,
`native-flight-smoke-scheduler.log`, `native-flight-think-scheduler-full.log`,
`native-flight-verification.log`.

## Validation and Remaining Work

`tools/native-flight-audit.py verify` passes module-hash checks, contact/timer
vtable assertions, selected instruction/branch checks, embedded-float checks,
and isolated float32 scheduler examples. It reads PE bytes; it does not execute
native machine code, emulate the complete collision routine, or compare an app
implementation. No measured gameplay evidence was gathered.

Reproduce from repository root in PowerShell:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' tools/native-flight-audit.py verify
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' tools/native-flight-audit.py range 0x9d3e60 0x9d502f
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' tools/native-flight-audit.py range 0x9da000 0x9da143
```

App `npm test`, `npm run build`, and `npm run check` were not run for this
read-only research handoff; no app changes or app-validation claims are made.
The parent implementation must run those checks and add native-reference
regressions. Prioritize biased clipping, strict stop boundary and slope gates,
high-speed floor attenuation, smoke speed/age gates, and independent think-tick
quantization. Leave specialized contact predicates, exact first think dispatch,
and smoke-volume completion latency explicitly unresolved until traced.
