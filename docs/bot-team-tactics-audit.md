# Bot Team Tactics Audit

## Boundary And Provenance

This is browser trainer AI only. No process hooks, game memory, live-game input,
or runtime game-file access was added. Shot rays, recoil, impacts, movement
physics, geometry, navigation, audio and rendering remain their owners' systems.

Weapon cycle, speed, magazine, range, pellet count and sniper identity are read
from the repository's existing offline-extracted static data. This pass did not
extract or independently measure those fields. Tactical timings, role scores,
hearing localization, shadow confidence/visibility thresholds, range preference,
boost feasibility limits and skill gates are training heuristics, not measured
CS2 bot behavior, FACEIT statistics, or an exact parity claim. Existing trait
curves, peek priors, novice advanced caps and 10/10+ golden fixtures are unchanged.

## Implemented Behavior

- Team roles: healthy/equipped entry, nearby delayed trader, separated crossfire,
  and sniper/fragile anchor. Role hysteresis avoids continuous leader swapping.
  Paired swings wait for both staging positions; a sensed allied shot/down cue
  can release the trader. A dead reporter's already observed contact remains
  evidence briefly; it is never replaced with the killer's hidden position.
- Novices below level 6 receive no advanced team assignment. Boosts require
  level 7 or higher. Novices below level 4 do not use shadow-only angle inference.
  Existing identity variation, motor error, reaction deadlines and poor novice
  preaim remain intact. No numerical difficulty retuning was performed.
- Sound estimates nominate nearby, physically accessible openings. Geometry
  ranking runs at most 5 Hz; deadlines/expiry are checked each command. High
  skill holds cue-driven checks while evidence remains useful rather than
  resuming unrelated free scanning. Hearing retains its independent RNG.
- Anticipation is derived from actual sight memory and geometry-reachable cover
  exits. `SightingMemory.anticipation()` exports a copied point, observation time,
  confidence, uncertainty and prefire-plan eligibility. Prefire means a prepared
  peek/preaim here, not firing blindly: current recognized sight is still required.
- Equipment handling follows the currently equipped firearm after pickups.
  Shotguns/Zeus close distance only while contact is recognized and visible.
  Weapon range gates firing; Zeus does not receive impossible reload commands.
  Empty reserve suppresses reload commands. Knife snapshots request primary
  equipment instead of being treated as rifles. Own armor/health inform exposure.
- Shadow cues are surface samples checked individually against observer FOV,
  geometry LOS, contrast and bounded range. A cue contains only the exposed sample,
  timestamp and uncertainty, not caster position, stance, velocity or aim point.
  It can prompt a short delayed check; it cannot identify an enemy or authorize fire.
- Out-of-order observations/hearing do not replace newer evidence. All new
  assignments and cue points are copied at module boundaries.

## Parent Integration

Create one `TeamTacticsPlanner` and one `BoostPlanner` per side per round. Recreate
them on restart/generation changes. Methods use simulation seconds, not wall time.

```ts
const assignments = teamPlanner.plan(time, peers, arena.lanes ?? [], contacts);
brain.coordinate(assignments.find(a => a.actorId === bot.id) ?? null);
const normalCommand = brain.command(bot, time, recoil, alliedSnapshots);
const boost = boostPlanner.plan(time, peers, boostPOIs, feasible);
```

`TacticalPeer` is `{actor, level, behavior?, lastShotAt?, lastHurtAt?, lastDownAt?,
contactAt?, busy?}`. `actor` contains allied snapshots only. `TeamContact` is
`{reporterId, point, observedAt, source: 'sight'|'callout'|'sound'|'shadow'}`.
Use `contactReport(time)` or already delivered sensory evidence, never hidden
opponent snapshots. `contactAt` on peers is the last delivered combat cue, so
active boosts cancel promptly. `busy` excludes reserved/otherwise occupied actors.
Recent damage, low health, death, reload, generation changes, vanished POIs,
invalidated feasibility and timeouts also cancel boosts immediately.

Team output has `actorId`, `generation`, `role`, optional `partnerId`, copied
`lane`, copied evidence `point`, `contactAt`, `peekAt`, `expiresAt`, and optional
`waitForPartner`. Call `coordinate(null)` when unassigned. Assignment validation
occurs before any callout/hearing side effect. Personal visibility and recognition
are not bypassed by assignments, partner releases or shared contacts.

### Boost POI Adapter

`BoostPOI` is `{id, base, mount, perch, dismount, lookAt}`. The first four are
world-space feet waypoints. `lookAt` is a static/common angle, never an unseen
actor position. Suggested adapter for the environment's partner-assisted links:

1. Select world-transformed traversal links with `kind === 'boost'` and
   `requiresPartner === true`; ordinary single-player jump links are not boosts.
2. `id = link.id`, `base = link.from`, `perch = link.to`.
3. Let the horizontal approach direction be the normalized vector from `to` to
   `from`. Candidate `mount = from + direction * .9` in X/Z. Keep the source feet
   height only if that candidate is supported there. Try lateral/opposite offsets
   when the approach candidate is not walkable. Both actors must fit and reach
   their staging points; do not assume that a narrow step fits two player hulls.
4. Choose `dismount` as a validated safe landing/walkable point near the perch or
   back approach. Use a known lane edge/common angle at appropriate eye height for
   `lookAt`. Parent validates these points against actual geometry and headroom.

The environment's inspection-loft `partner-boost` link is a suitable candidate:
its local source is `(2.45, .95, -1.15)` and destination `(.4, 2.4, .5)` before
placement/mirroring. Derive from the placed world link, not these local literals.
Source height is important: the climber cannot jump from ground directly onto a
crouched partner standing on a raised step. Assembly requires the authored mount
feet height before jumping.

`BoostFeasible(poi, basePeer, climberPeer)` is a required parent callback. It must
validate reachability, clear approach, support surfaces and jump/head clearance;
it is also called on active plans to catch environment changes. Partner contact
is intentionally allowed during mount; ordinary actor avoidance must not repel
the reserved pair. The planner is not a collision solver and cannot make an
unreachable POI reachable.
Cache static feasibility by environment revision; avoid a full navigation search
inside this callback every motor tick. Assembly movement is direct local steering,
so select a clear staging approach rather than promising an unseen detour route.

Boost output is `null` or `{poiId, phase, mountStage?, lookAt, assignments, commands}`.
Phases are `assemble`, `mount`, `hold`, `release`; mount stages are `partner` then
`perch`. Each assignment has `actorId`, `generation`, `role: 'base'|'climber'`,
and a copied `goal`. Each command is `{actorId, command: Partial<ActorCommand>}`.
Overlay movement fields only after normal brain commands. Commands deliberately
contain no aim/fire/equip fields. Preserve normal sight/aim/fire permission and
cancel the plan on new contact. Use `lookAt` through the existing bounded aim
controller during quiet setup if needed, not by snapping yaw/pitch.

The base crouches and brakes through normal input. The climber receives one jump
edge onto actual partner support, waits at least .08 s grounded, then receives
one jump edge toward the perch. `supportingActor` from the parent snapshot is
used when available; the fallback requires grounded feet at the ally's hull top.
Mount stages time out at 1.8 s; full workflow at 10 s. Hold lasts at most 2.5 s,
release at most 2 s, and cancelled/completed attempts have a 4 s cooldown. No
positions, velocities, collision layers or vertical impulses are assigned.
The permissive vertical candidate bound uses the shared jump model plus crouched
partner height with an .08 m margin; actual route/landing feasibility still belongs
to the parent. This allows useful lofts above solo-jump height without claiming
that every point below this bound is reachable.

### Shadow Sensor Adapter

```ts
observeBot(time, self, opponents, arena, view, shadowProxies);
observeShadows(time, self, shadowProxies, arena, view);
```

Existing observation fields stay unchanged. Optional `shadowCues` is added only
when proxies are supplied. Proxies are `{id: string, side, samples: Vec[], contrast}`;
`samples` must be actual exposed shadow surface points from the renderer's
directional sun projection (currently source `(-9,18,8)`). Project against the
same geometry/surfaces that render the shadow; do not pass the hidden caster's
feet or make the brain invert the light vector to find the caster. The sensor
accepts no enemy/caster pose at all. Parent applies the same delayed observation
delivery policy to shadows as to sight. Supply the real camera frustum when
available; fallback shadow FOV is a conservative estimate.

Work per shadow scan is bounded to 24 proxies and 12 samples per proxy. Samples
over 35 m, contrast below .18, nonfinite points, allied shadows, out-of-frustum
samples and blocked LOS are rejected. Cue lifetime in tactics is .85 s, and the
recognition deadline is not continually restarted by consecutive shadow frames.
No radar contact or team visual report is generated from a shadow-only cue.

## Validation

Validation is intentionally scoped while parallel agents edit the shared tree.
Final owned regression run: **114 tests passed across eight files**:

```text
npm.cmd run test:run -- src/range/duel/coordination.test.ts src/range/duel/shadows.test.ts src/range/duel/tactical-workflows.test.ts src/range/duel/skill.test.ts src/range/duel/awareness.test.ts src/range/duel/bot-memory.test.ts src/range/duel/bot-behavior-regression.test.ts src/range/duel/bot-firearm.test.ts
```

Three existing tactical damage/reload/aiming tests also passed with the name filter
`falls back|reloads behind|allows a slower` in `tactics.test.ts` (8 unrelated cases
skipped). Scoped `git diff --check` passed. Vitest runs required approved escalation
because the Windows sandbox rejected temporary compiled-file renames.

At the interruption recovery checkpoint, TypeScript passed. A later production
build attempt during ongoing parallel edits failed before Vite in non-owned files:
`actor-physics.ts:121/124` passes/reads possibly undefined terrain `world`, and
`arena-layout.test.ts:164` supplies `() => number` where `ClonableRandomStream` is
required. No owned-file TypeScript errors were reported. Full integrated build
and global tests must be rerun by the parent after those edits settle. No global
suite, commit, push, deploy, server startup or ZIP packaging was performed here.

The firearm fixture keeps original rifle/sniper distances, places newly added
short-range weapons inside their intended engagement range, and tests Zeus's
single discharge/recharge separately from repeatedly firing semi-auto firearms.
This preserves native cadence/trigger intent rather than asking a taser to fire
twice during its 30-second recharge.

A broader focused run including `brain.test.ts` and `hearing.test.ts` passed 126
of 128 tests before the last boost-bound addition. Two integrated failures remain
for the parent; their assertions were not weakened:

- `brain.test.ts:97`, `lets an autonomous bot damage an idle player in an open
  duel`: bot fire events exist but the expected shooter-1/victim-0 hit is absent.
- `hearing.test.ts:117`, `keeps settled shift movement quiet but exposes running
  footsteps`: the running-player fixture emits zero footstep events.

An earlier `combat-style.test.ts` arena-spawn population sweep also timed out
during parallel geometry edits. It was not rerun or edited by this owner.

## Exact Files Changed

- `src/range/duel/tactics.ts`
- `src/range/duel/brain.ts`
- `src/range/duel/perception.ts`
- `src/range/duel/awareness.ts`
- `src/range/duel/coordination.ts` (new)
- `src/range/duel/shadows.ts` (new)
- `src/range/duel/coordination.test.ts` (new)
- `src/range/duel/shadows.test.ts` (new)
- `src/range/duel/tactical-workflows.test.ts` (new)
- `src/range/duel/bot-firearm.test.ts`
- `docs/bot-team-tactics-audit.md` (new)

`skill.ts`, `motor.ts`, shared types/config, geometry/navigation, simulation,
Engine, Stage, animations/audio, README and common styles were not edited by
this owner. The shared tree contains other agents' unrelated changes.
