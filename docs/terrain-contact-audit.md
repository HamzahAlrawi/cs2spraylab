# Terrain, contact and current jump audit

Date: 2026-10-04. All game inspection is offline, static-file only. No game
process is opened, no native DLL is loaded and no runtime game hooks exist.
The aiming/impact coordinate model and all parent runtime files are unchanged
by this movement worker.

## Evidence and limits

Installed `game/csgo/steam.inf`: build **2000924**, patch **1.41.8.8**, revision
11076591, Oct 02 2026. Inspected `server.dll` SHA-256:
`098d4ddd57e2fbe9a73623a2bf68ebaff86f7b6342ddb3d5a0f69cd6335b31cc`.

`research/convars.txt` records gravity 800 u/s^2, jump impulse 301.993 u/s,
ground accelerate 5.5, friction 5.2, stop speed 80, air accelerate 12, air wish
cap 30, step size 18, square hull half-width 16 (existing shared hull), and
standable normal 0.7. Standing/duck hull heights remain 72/54, eye heights
64/46 and one unit remains 0.0254 metres. Existing 240-case acceleration
fixtures and crouch-fatigue arithmetic from build 2000919 are preserved;
these older fixtures do not certify the entire newer movement engine.

Valve's [January 21/22, 2026 release notes](https://store.steampowered.com/news/posts/?appids=730&enddate=1770248032&feed=steam_announce/1000)
establish subtick landing, removal of jump/landing stamina, a centered bhop
window, spam rejection and the follow-up dependence on landing velocity.
Current defaults are `sv_legacy_jump=false`, `sv_bhop_time_window=0.0078125`,
`sv_jump_spam_penalty_time=0.015625`, `sv_autobunnyhopping=false`, and
`sv_enablebunnyhopping=false`. The full window is centered on landing: the
accepted interval is +/-0.00390625 seconds, not +/-0.0078125. The installed
window helper at server RVA `0xabf350` explicitly multiplies it by 0.5.
Spam rejection is inclusive: elapsed time <=0.015625 is rejected. There is
no legacy jump/landing stamina accumulator in the shared motor.

Inspected current native landing factors, with impact velocity `v` in u/s
(negative down) and contact age `t` in seconds:

```text
b = clamp(1 + v * 0.0005000000237487257, 0.2, 1)
jump factor   = min(1, b + clamp(t, 0, 1) * 0.6000000238418579)
ground factor = min(1, b*b + max(0, t) * 1.111189365386963)
```

Jump-factor function: RVA `0xab21a0`; arithmetic block `0xab2251..0xab2295`.
Ground-factor function: RVA `0xadbbd0`; arithmetic block `0xadbc95..0xadbcb7`.
`tools/verify-terrain-contact.py` uses hash-pinned Unicorn emulation to verify
32 arithmetic outputs, stored in `src/range/native-terrain-fixture.json`.
Time conversion helpers and initial landing state are supplied by the
fixture. This verifies isolated float arithmetic, **not** native timestamp
selection, collision traces, movement scheduling or a complete jump.

Ladder convars: scale 0.78, incidence threshold -0.707, damping 0.2. Native
detach block `0xacf5e8..0xacf613` multiplies the ladder normal by **270 u/s**;
the fixture also verifies that static constant. The motor uses it, not a
guessed ground-jump impulse. Reattachment is prevented until leaving the
volume. The simplified view-vector-to-ladder projection, top transitions and
server scheduling are not native-verified; the incidence/damping branches
are not reproduced in full.

Water convars: speed scale 0.9, accelerate 10, drag 1. Immersion sampling,
input-directed swimming and linear drag are an authored training motor,
**not measured water parity**. Neutral-input buoyancy, water-jump ledge exits,
water currents, shallow-water slowing and native water entry/exit timing are
not verified. No guessed sink impulse or gravity retuning was added to hide
these limits. Authored per-volume water settings are overrides, not extracted
map measurements.

## Geometry and contact behavior

The pure modules use metres, X/Z horizontal, positive Y up. `position.y` in
`ActorKinematics` stays the eye coordinate. `feet` is the physical world Y of
the hull bottom; the 3D collision helpers take `{x, y: feet, z}` instead.
Impacts, recoil and crosshair coordinates are never read or modified.

`TerrainSolid` is structural: `{center: Vec, size: Vec, id?, traversal?}`.
Boxes need no metadata. Ramp metadata is `{kind:'ramp', axis:'x'|'z', rise,
direction?:-1|1}`. `rise` is in metres and cannot exceed `size.y`; the wedge
rises from its low top to `center.y + size.y/2`. The hull uses the highest
point under its square footprint. Ladder/water volumes are triggers, never
blocking boxes. `TerrainWorld` has `solids`, optional `bounds`, and `floor`
(default 0; `null` removes the implicit ground plane, allowing negative Y).

Continuous convex hull sweeps, contact-plane sliding, ceiling stops and a
grounded up/forward/down step comparison handle boxes and wedges. A 19-unit
stair is not silently treated as the extracted 18-unit step. Standing or a
raised boost stack must clear the entire expanded hull. Steep ramp contacts
below normal-Y 0.7 slide without grounded jump support. Grounded ramp traversal
does not repeatedly shrink horizontal momentum. Contact epsilons and the
four-plane sweep iteration bound are numeric solver choices, not CS2 convars.
This analytic convex solver is not Source 2 collision-mesh/edge parity.

Air crouch keeps the previous stable eye trajectory while tucking feet;
unducking checks the full standing hull. Existing duck edge fatigue,
recovery, cooldown, smooth eye/hull transition and damage-tagged ground
acceleration remain in place. Flat callback and environment-context paths
are regression-tested through repeated jumps and crouch transitions.

Actor collision is full 3D: different vertical levels do not impose planar
blocking. Living actor heads can support a rider; dead actors cannot. Pair
separation resolves side overlap without manufacturing a teleport-to-head
boost. Actors cannot be used as automatic stairs. A crouched base may stand
and raise its connected stack only if all raised hulls clear terrain and
unrelated living actors. No launch impulse is added. Moving-support carry
uses previous/current snapshots and validates that the rider was actually
on the old support. This is a deterministic kinematic support model, not
native player mass, pushaway or simultaneous-contact impulse parity.

Collision broad phase rejects only solids whose expanded box bounds cannot
intersect the full swept hull. Remaining candidates still use the same
convex planes, sliding, ramp and ceiling checks. Contact hulls are rebuilt
from current poses; no identity-only cache can freeze a moving/crouching or
newly dead actor. Stack clearance shares its stationary and raised hulls
within one call, not across simulation slices. Footprint-only support tests
avoid allocating a full hull. These reduce allocation without skipping
living-actor collisions or lowering movement frequency.

## Integration Contract

`advanceActor(actor, input, speedMetresPerSecond, dt, resolve?, canOccupy?,
vertical?, environment?)` keeps the existing first seven arguments. Passing
argument eight selects shared terrain collision instead of the legacy three
callbacks. Do not apply the old planar actor resolver a second time.

`ActorEnvironment` extends `TerrainWorld` with `actors?: ContactActor[]`,
`selfId?`, `time?`, `pitch?` (radians), and `jumpRules?`. Recommended rules:

```ts
import {DEFAULT_JUMP_RULES} from '../actor-jump';
// bhopWindow: 1/128, spamTime: 1/64, autoBhop: false,
// enableBunnyhopping: false. No legacy stamina mode.
```

The parent already supplies `arenaMovementEnvironment` in the authoritative
actor step and `DuelSimulation.predictPlayer`. Both must keep using the same
adapted world and physical stance/weapon speed. The adapter should filter
inactive/passable solids, map `shape.axis/highSide` to ramp axis/direction
with `rise=size.y`, and map ladder axis/facing to its outward normal.
For water, also forward `surfaceY`, `speedScale`, and `drag`; the helper now
accepts these optional traversal fields. Trigger volume `kind` must not be
copied into the box's unrelated material `kind` field.

The parent's `arenaTerrain` cache keys the arena and its `solids` and
`traversalVolumes` arrays. Replace the relevant array when changing
active/passable filtering, shape or traversal settings; in-place metadata
edits do not invalidate a reference-keyed adapter cache. Do not apply that
cache pattern to mutable actor poses without a complete pose/version key.

`time` is the **start** of the movement slice. Otherwise `movementTime`
advances locally. `jumpPressed` is a one-shot wheel/edge pulse;
`jumpPressOffset` is seconds within `[0, dt]`. Held jump alone does not
autobhop. Authority and prediction must consume/reset the pulse and offset
after their one applicable slice, not replay a pulse every predicted tick.
Prediction must use historical/local body snapshots rather than copying
authoritative support displacement repeatedly across a replay.

Copy the full **kinematics-only** result after movement; it deliberately
does not spread unrelated `CombatActor` fields such as `stepDistance`, health
or command. Preserve `movementTime`, `lastJumpPressTime`,
`pendingJumpPressTime`, `landedAt`, `landingVelocity`, `landingVelocityXY`,
`supportId`, `moveMode`, `waterLevel`, `ladderDetached`, and all existing
stance fields. Clear history on respawn/teleport using
`resetActorMovementHistory` after resetting the pose/velocity; do not clear
it each frame or on weapon switches.

Boost integration helpers in `actor-contact.ts`:

- `actorHeight`, `actorHull`, `actorContactSolids`: shared stance-aware hulls.
- `classifyActorContact`: none, side, a-on-b or b-on-a.
- `findActorSupport`: returns support ID/top, velocity and grounded flag.
- `separateActorPair`: returns updated A/B poses and `separated`; optional
  immovable flags and occupancy guard preserve pinned actors.
- `supportedActorStack`, `resizeSupportedStack`: find connected riders and
  return collision-checked raised poses (or undefined).
- `supportDisplacement`: previous/current support displacement, no impulse.

Advance a base before its riders, supplying the base's previous pose to the
rider's environment once. For multi-level stacks, process in support order
or apply the collision-checked poses from `resizeSupportedStack` immediately.
Do not also add the same top displacement manually after the carry helper.
`separateActorPair` is only a spawn/overlap correction; normal travel uses
the continuous actor hull sweep. Boost assignment/tactics remain owned by
the coordination worker; these helpers grant no aim or game automation.

## Range Migration Notes

Range's weapons owner should pass the same environment for the current
drill covers (or `RANGE_WALLS`) to `Simulation.step`'s `advanceActor` call,
forwarding `pitch` and slice-start time. Range has no teammate bodies by
default. Existing X/Z limits clamp the **actor center**; `TerrainBounds`
instead bounds the full hull. Preserve the old center limits by authoring
`minX=-11.3-16*UNIT`, `maxX=11.3+16*UNIT`,
`minZ=TARGET_Z+2.2-16*UNIT`, `maxZ=5+16*UNIT`, not by passing the old
center limits unchanged. This avoids narrowing the playable range by 16 u.

The old selective stance-only assignments are insufficient for repeated
jumps; copy all new history fields or the full result. Preserve any existing
position-object identity used by the renderer when applying `next.position`.
Reset history when a drill/rep genuinely resets the physical pose, not when
only shot/recoil/reload bookkeeping resets. Forward one-shot jump input
edges with the same consumption rules as Duel. Keep the impact formula and
stored wall marks untouched.

The existing all-mode movement parity suite passes for AK/M4A4/MP9 and the
shared callback-vs-terrain repeated-jump test passes. That is flat-world
motor parity, not a claim of exact native gameplay or authored arena parity.

## Validation

- Latest focused regression: **260 tests in 13 files pass** (978 ms Vitest
  duration), including actor/terrain/contact/jump/native-acceleration,
  Range/Duel movement parity, hearing, environment, coordination, prediction
  integration and both simulations. No global test command was run.
- New checks cover one second of six living actors versus the legacy flat
  motor, string support IDs, fresh hulls after in-place pose/life changes,
  distant-collider plane-allocation rejection, ceilings and long sweeps.
- Strict standalone type-check of all five shared movement modules passes.
- Latest `npm run build` passes TypeScript and Vite. Vite reports the existing
  large-chunk warning. This does not certify browser frame-time performance.
- `python tools/verify-terrain-contact.py` re-verifies 32 hash-pinned native
  landing-factor cases and the static 270 u/s ladder-detach constant.
- Parent remains responsible for final global tests/check after concurrent
  edits settle, and whole-app/browser QA.
