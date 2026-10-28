# CS2-Bot-Improver: research and adaptation plan

Research only. No runtime changes, installation, game hooks or deployment.
Reviewed against the local SprayLab source on October 25, 2026. This is static
source analysis, not a benchmark of the upstream plugin running inside CS2.

## Executive conclusion

Use this project as a catalog of bot failure modes and decision policies, not
as a replacement AI engine or a set of authentic human-performance constants.
Its apparent fidelity also benefits from running inside CS2, where Valve
already provides movement, animation, perception and navigation machinery.
SprayLab must independently preserve its browser simulation and its shared
player/bot weapon and movement kernels.

The best immediate opportunities are explicit gaze priority, full-frustum
vision, weapon-aware visible-part targeting, threat-aware reload/sidearm
decisions, and progress-aware navigation recovery. Existing sight memory,
hearing, trading, peeking and rank-dependent variation should be extended,
not replaced or advertised as newly missing systems.

## Source revisions

The parent revision is
[`dd1306606f7a34ef6e7ab31bc3105825c1e9b6d8`](https://github.com/ed0ard/CS2-Bot-Improver/tree/dd1306606f7a34ef6e7ab31bc3105825c1e9b6d8).
Submodules were resolved from that revision, not from their current main heads:

| Component | Pinned revision | Files inspected |
| --- | --- | --- |
| Bullseye Bot | `c5a2e0f402f151336c820b7efc1b895aa087a953` | `BotAimImprover.cs` |
| Smarter Bot | `6b5781f85391816c08154a9c1d5b5dd6e898a2f5` | Combat, Behavior, Movement, Weapons, CustomFov, Tick, BotFov |
| NadeSystem | `7605f272d0500a7bad5b6294555485c7721a40da` | Decision, Information, Audio, README |
| BotVision | `df8f0707c7590cd55d9ffb8f6824ec9f3c959f5f` | README and published configuration scope |

Also inspected the parent's Medium/Low `botprofile.db` and the four Dust 2
grenade JSON files. Sources were read with GitHub's API; no plugin code ran.

## Findings and recommendations

### 1. One explicit owner for gaze and engagement

**Upstream evidence.** Combat handling disables pathfinder eye-angle control
while attacking and attempts to recover an aim-without-attack state.
[Combat source](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotState.Combat.cs).

**SprayLab now.** `tactics.ts` already prioritizes current sight, remembered
openings, sounds, shadow cues and scanning. Its large `command()` method also
combines travel, attack, recoil, team assignments and recovery. Multiple
conditions can make a reasonable local choice that defeats the overall duel.
This is a candidate explanation to test, not a reproduced bug diagnosis.

**Adaptation.** Produce an explicit `AimIntent` before motor commands. Give it
an owner, evidence timestamp, confidence, target point and expiry. Suggested
priority: confirmed combat threat; recent reachable re-peek; urgent hostile
audio; assigned support angle; ordinary clearing; travel orientation.
Deliberate disengagement must be a named decision rather than an accidental
fallback. Preserve reaction, aim alignment, weapon cooldown and movement gates.

Add `gazeOwner` and `fireBlockedReason` to the existing decision/replay
diagnostics. This makes 'looking away' and 'wide peeking without firing'
debuggable without simply forcing bots to shoot.

**Acceptance.** Path following cannot override an acquired visible threat;
nearby cover preserves the likely re-peek angle; shoulder/jump information
peeks can intentionally avoid firing; disengagement and readiness exceptions
are reported explicitly.

### 2. Full horizontal and vertical bot vision

**Upstream evidence.** CustomFov caches eye/angle-based geometric frustums;
`BotFov.cs` supports independent horizontal/vertical bounds and special wide
modes. Its default options are 180 degrees on both axes, not a human-screen
calibration. [Frustum source](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotFov.cs),
[frame caching](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotState.CustomFov.cs).

**SprayLab now.** Player contact sensing passes `SensorView`, but normal bot
observations in `simulation.ts` omit it. The fallback in `shadows.ts` tests a
horizontal +/-60-degree cone without a vertical limit. `actor-visibility.ts`
then evaluates visible pose points, so some useful geometry already exists.

**Adaptation.** Supply a canonical bot camera frustum to ordinary sight and
shadow sensing. Use actual eye height, pitch and any scoped state. Keep this
independent of the visitor's monitor aspect ratio; changing browser width must
not change bot skill. Model peripheral recognition through confidence and
reaction delay, not an omnidirectional elite vision mode.

**Acceptance.** Vertical and horizontal edge cases agree with the configured
camera; no direct vision behind the observer; sounds can draw attention from
outside the frustum but do not count as sight; recognition remains bounded by
the existing skill model.

### 3. Weapon-aware visible-part selection

**Upstream evidence.** Bullseye ranks 17 derived aim points and chooses a
visible one using weapon-dependent head/jaw or trunk preference. Its point
positions are approximated from live eye height and lateral offsets.
[Aim source](https://github.com/ed0ard/CS2-Bullseye-Bot/blob/c5a2e0f402f151336c820b7efc1b895aa087a953/BotAimImprover.cs).

**SprayLab now.** We already sample native actor capsules. However,
`visibleActorPoints()` collapses visibility into a head point and the first
non-head point; `tactics.ts` chooses body aim mostly from skill tendency and
a close-range, elapsed-spray rule. This loses distinctions between exposed
torso, arm and leg, and does not fully exploit the active weapon.

**Adaptation.** Return a bounded set of visible candidates with hitgroup,
exposure margin and sample age. Score candidates by estimated hit probability,
weapon damage, range, recoil/spread state and target-switch cost. AWP can favor
an exposed torso; shotguns can favor the largest exposed area; a head-only
opening must remain hittable. Use native capsules rather than replacing them
with upstream fractional-height approximations.

Do not read hidden enemy HP/armor to optimize damage. Use ordinary assumptions
and evidence-based estimates. Add hysteresis so targets do not jump between
body points every sensing update. Rank influences imperfect choices and aim,
not the physical bullet distribution.

### 4. Threat-aware reload and sidearm decisions

**Upstream evidence.** Weapons handling interrupts a reload on visible contact,
prefers an available firearm, and has a cooldown against repeated switching.
It also repairs idle knife use while enemies remain.
[Weapons source](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotState.Weapons.cs).

**SprayLab now.** `TacticalBrain` retreats/reloads and waits for usable ammo.
Actors have inventory storage and reload state machinery, but slot switching
in the simulation is player-specific; bots do not yet have a general tactical
primary/sidearm selection policy. This is a concrete integration gap.

**Adaptation.** Add an explicit bot inventory/action interface, not player-slot
assumptions. On recognized danger, choose among continuing safely behind
cover, interrupting with usable rounds, drawing a loaded sidearm, or retreating.
Use remaining reload time and available evidence; the decision must obey the
same holster, ammo-commit and deployment rules as the player. Do not emulate
the upstream one-frame knife-switch sequence as an instant ready-gun shortcut.

**Acceptance.** Exposed empty-rifle bots can use their sidearm; protected bots
can finish reloading; no ammo duplication, skipped deploy time, or weapon-swap
oscillation; low-level bots may make plausible delayed decisions.

### 5. Progress-aware recovery instead of random movement

**Upstream evidence.** Recovery monitors elapsed time, displacement and peak
speed, treats door/ladder transitions separately, and repaths idle bots.
Some corrective actions directly modify velocity.
[Movement source](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotState.Movement.cs).

**SprayLab now.** We cache native routes, throttle failed searches, check
segments and apply local teammate repulsion. That is not the same as tracking
whether the actor is making useful progress toward its intended waypoint.
A geometrically valid path can remain unproductive beside a teammate or door.

**Adaptation.** Track route progress only while movement is intended. Escalate
from yielding to a teammate, to a small collision-tested backoff, then a
rate-limited replan or alternate lane. Reserve narrow passages briefly for one
actor rather than letting several repeatedly push against each other. Preserve
gaze at likely threats while feet/path choice changes. Never move a legitimate
angle holder just because it has been stationary.

Recovery must issue legal movement inputs through the shared movement kernel,
not teleport or inject velocity. Test doorway congestion, corner wedges,
ramps, jump/crouch links and returning to the original tactical task.

### 6. More coherent personalities without fake FACEIT statistics

**Upstream evidence.** The profiles separate aggression/teamwork archetypes,
weapon preferences and normal-versus-attacking look parameters. Their base
profile also sets reaction and attack delay to zero; profile overrides can
change inherited settings. These are tuning inputs, not measured human tiers.
[Medium profile](https://github.com/ed0ard/CS2-Bot-Improver/blob/dd1306606f7a34ef6e7ab31bc3105825c1e9b6d8/overrides/Medium/botprofile.db),
[Low profile](https://github.com/ed0ard/CS2-Bot-Improver/blob/dd1306606f7a34ef6e7ab31bc3105825c1e9b6d8/overrides/Low/botprofile.db).

**SprayLab now.** `skill.ts` already supplies stable per-bot timing/aim traits,
rank-dependent peek eligibility and requested crouch tendencies. The tactical
personality still concentrates behavior into holder/patient/aggressive.

**Adaptation.** Extend those existing seeded traits with patience, risk
tolerance, trade willingness and flank commitment. Keep a plan long enough to
be coherent, but allow fresh evidence to interrupt it. Separate careful
clearing/holding motor behavior from acquired-target tracking, while retaining
finite turn acceleration and reaction time. Do not copy pro names or native
spring constants as proof of FACEIT-level realism.

Beginner profiles must keep beginner peek eligibility, poorer pre-aim and more
errors. Personality diversity must not accidentally give level 1 bots advanced
coordinated peeks or erase the user's existing skill-dependent crouch rates.

### 7. Authored utility opportunities, later

NadeSystem replays authored lineups and applies combat, information, scheduling
and cooldown checks. BotVision addresses smoke density, HE openings and bullet
tunnels using native engine functionality. These are useful future design
references, not browser-ready implementations.
[Utility decisions](https://github.com/ed0ard/CS2-Bot-NadeSystem/blob/7605f272d0500a7bad5b6294555485c7721a40da/NadeSystemPlugin.Decision.cs),
[information gates](https://github.com/ed0ard/CS2-Bot-NadeSystem/blob/7605f272d0500a7bad5b6294555485c7721a40da/NadeSystemPlugin.Information.cs),
[BotVision](https://github.com/XBribo/CS2-Bot-Vision/tree/df8f0707c7590cd55d9ffb8f6824ec9f3c959f5f).

Parent-repository Dust 2 JSON counts at the pinned revision:

| Type | Rows | Distinct IDs |
| --- | ---: | ---: |
| Flash | 136 | 106 |
| HE | 51 | 49 |
| Molotov | 94 | 78 |
| Smoke | 121 | 100 |
| Total | 402 | 333 |

Within each file, repeated-ID groups are exact duplicate records, not
conflicting variants. These files provide projectile origin, velocity and
landing point; projectile origin must not be confused with player feet.
[Dust 2 data directory](https://github.com/ed0ard/CS2-Bot-Improver/tree/dd1306606f7a34ef6e7ab31bc3105825c1e9b6d8/addons/counterstrikesharp/data/NadeSystem/grenades).

They contain neither encounter counts nor player holding frequencies. Do not
turn their density into spawn weights. Future import requires deduplication,
coordinate conversion, current-map trajectory/collider validation, release
versioning and licensing review. Emit a setup opportunity such as support
flash -> delayed peek, not a perfect throw at a hidden player's live position.

## Things not to transfer

- Direct velocity zeroing or boosts on weapon fire: not human counterstrafing.
- The Behavior module's permanent alert/no-surprise overrides: not human
  recognition. [Behavior source](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotState.Behavior.cs).
- Per-shot weapon-only crouch rolls: conflict with skill-dependent, coherent
  engagement choices already requested for SprayLab.
- Bullseye's visibility-error fallback that returns visible: use fail-closed
  sensing rather than allowing sight after a failed query.
- Utility decisions based on all enemies' live hidden positions: evaluate
  sensed beliefs and authored default setups instead.
- Native memory patches, engine hooks, installation/launcher mechanisms or
  inventory/profile spoofing. None belong in this browser trainer.
- Describing native-plugin tuning or HLTV-inspired profiles as measured FACEIT
  reaction-time distributions. The reviewed source does not establish that.

The parent README identifies AGPL-3.0, with a different Panel license. Several
components carry their own notices. Direct code/data reuse needs a component-
level license review; the default proposal is an independent implementation
of behavior policies, not copying native integration code.
[License statement](https://github.com/ed0ard/CS2-Bot-Improver/tree/dd1306606f7a34ef6e7ab31bc3105825c1e9b6d8#license).

## Recommended delivery order

1. Extend the existing decision/replay trace with gaze ownership, firing veto,
   sensor age, route progress and reload intent. Establish failing fixtures
   before changing tactics.
2. Add canonical full-frustum sensing and explicit aim arbitration. Verify
   partial visibility, re-peek memory, hostile/friendly audio separation and
   stale perception without changing weapon or movement formulas.
3. Improve visible-part selection, then threat-aware reload/sidearm actions.
4. Add progress-based recovery and passage reservations. Retain current team
   coordination and trading rather than introducing a second planner.
5. Enrich persistent personalities and context-specific aim motor behavior.
   Calibrate difficulty with measured trainer metrics and human testing.
6. Only after grenade physics/perception is supported, validate and author
   utility setups. This is separate work, not required for the first AI pass.

## Browser performance and validation gates

Keep motor/shared physics at 128 Hz, existing sensing around 32 Hz, and the
current lower-frequency tactical/path work. Stagger expensive bot decisions;
cache candidate geometry and reuse native pose/sensor results. Do not raytrace
every body candidate for every bot on every physics tick. Do not perform live
HTTP inference, fetch these GitHub files at runtime, add an LLM to the game
loop, or increase map loading/caching work.

Proposed tests and measurements:

- Visible threat versus route steering and idle scanning, with explicit legal
  exceptions for information-only peeks and retreat.
- Occluded/partially exposed bodies, crouch transitions, vertical FOV, scope
  transitions and stale sensor frames.
- Exposed reload, hidden reload, empty primary/loaded sidearm, reload ammo
  commit and repeated threat/weapon-switch cancellation.
- Dynamic teammate congestion versus legitimate camping; no illegal position,
  velocity or collision changes during recovery.
- Same seed reproducibility, rank-specific distributions, friendly audio
  immunity and no dependence on hidden target movement.
- Reaction/first-damage distributions, visible-but-idle time, unintended gaze
  switches, shots while inaccurate, route progress stalls, trade conversion
  and failed/redundant reloads. Compare with controlled baseline fixtures,
  not raw win rate alone.
- Profile five bots on native chunks and a throttled desktop. Treat unchanged
  frame-time distributions and zero new map/network work as release gates;
  measure before promising a particular millisecond overhead.

No gameplay parity or human-indistinguishability claim follows from this source
review. Those require actual behavioral measurements and blind playtesting.
