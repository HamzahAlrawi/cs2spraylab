# Bot Repository Comparison And Follow-Up Recommendations

Research date: 2026-11-04. Local baseline: `01c1376b7063e066b93310f6678c38c59856c80a`.

Local source references describe that baseline unless marked implemented. The companion `chunk-startup-performance-2026-11-04.md` records the completed performance work and measured limits. Unless qualified otherwise, local module basenames resolve under `src/range/duel/`; `performance.ts` is `src/range/performance.ts`, and loading helpers are under `src/range/prefire/`.

## Executive Decision

**A1 implemented after review: release a cancelled grenade setup's team claim.** At the research baseline, the defensive override in `DuelSimulation.step()` cancelled the bot's utility planner and holstered an uncommitted grenade without cancelling its `TeamUtilityCoordinator` setup. Partners could continue waiting for a grenade that would never be thrown. The approved follow-up now cancels that setup and invalidates copied tactical waits; its five focused files passed 48 tests. See A1 for scope and evidence. This is independent of map decoding, collision restoration, aim coordinates, and native weapon arithmetic.

**Performance audit:** traces identified approximately 38 ms main-thread Meshopt work and a 96 ms collision restore/tree/query-cache task. The companion audit documents off-thread decoding, cooperative restoration, route caching, measured handoffs and remaining first-combat-frame costs. These fixes are not AI improvements; further shader or resolution changes need separate evidence.

SprayLab already implements much of the useful repertoire found in these projects. The best next steps are narrow correctness and perception-policy improvements, not a bot framework replacement. All suggested probabilities, delays, and budgets below are proposed trainer policies or engineering acceptance targets, not measured FACEIT distributions.

## Scope And Method

- Compared current source, tests, the October 26 AI delivery report, October 31 combat/utility report, and chunk-loading/performance documents against the clean Git baseline.
- Read public upstream source as text through GitHub search, the GitHub REST API, and pinned `raw.githubusercontent.com` files. Resolved default-branch commits once, then inspected those immutable trees. Bot Improver's active submodules were resolved from the parent tree's gitlinks, not their current branch tips.
- No foreign code was copied, compiled, installed, or executed. No game attachment, memory access, DLL loading, hooks, or in-game integration occurred. No installed CS2 files or gameplay mechanics were changed.
- A1's implementation and focused tests are recorded below. Other AI proposals are not shipped changes. The companion performance audit and iteration delivery record the broader implementation and validation.
- Findings are classified as **observed code gap**, **static defect**, or **hypothesis requiring profiling**. Static inspection establishes a reachable policy branch, not its frequency in real sessions.

## Pinned Sources And License Checks

All upstream links below contain actual commit SHAs. These are reproducible research snapshots, not claims that a project is maintained forever or that its runtime behavior matches current CS2.

| Project | Inspected Commit | Committer Date (UTC) | License Evidence And Reuse Boundary |
| --- | --- | --- | --- |
| [ed0ard/CS2-Bot-Improver](https://github.com/ed0ard/CS2-Bot-Improver/tree/825aa4d2a345098e37c195c099f7b2b9d6bdfcce) | `825aa4d2a345098e37c195c099f7b2b9d6bdfcce` | 2026-11-01 | Root [LICENSE](https://github.com/ed0ard/CS2-Bot-Improver/blob/825aa4d2a345098e37c195c099f7b2b9d6bdfcce/LICENSE) is AGPL-3.0 text. Active policy submodules checked separately below. No copying, translation, patch import, or lineup-data import proposed. |
| [yapb/yapb](https://github.com/yapb/yapb/tree/6444ce3099cdc4a5a4a53bd543011609c59abf5c) | `6444ce3099cdc4a5a4a53bd543011609c59abf5c` | 2026-11-03 | [UNLICENSE](https://github.com/yapb/yapb/blob/6444ce3099cdc4a5a4a53bd543011609c59abf5c/UNLICENSE); inspected `src/combat.cpp` also declares `SPDX-License-Identifier: Unlicense`. This does not license every dependency: [.gitmodules](https://github.com/yapb/yapb/blob/6444ce3099cdc4a5a4a53bd543011609c59abf5c/.gitmodules) includes separate linkage/ystl projects. No dependency imports proposed. |
| [rehlds/ReGameDLL_CS](https://github.com/rehlds/ReGameDLL_CS/tree/12a19be20c348594051bd4811bf89947c95e2f05) | `12a19be20c348594051bd4811bf89947c95e2f05` | 2026-11-04 | Root [LICENSE](https://github.com/rehlds/ReGameDLL_CS/blob/12a19be20c348594051bd4811bf89947c95e2f05/LICENSE) is MIT; [transition notice](https://github.com/rehlds/ReGameDLL_CS/blob/12a19be20c348594051bd4811bf89947c95e2f05/LICENSE-TRANSITION.md) asserts a July 2025 transition. However inspected bot source retains GPL-2.0-or-later notices and an HL-engine exception. Treat this discrepancy as unresolved for reuse, not blanket MIT clearance. |
| [EfeDursun125/CS-EBOT](https://github.com/EfeDursun125/CS-EBOT/tree/23335620127198c82e060a4215b8d812de28bb24) | `23335620127198c82e060a4215b8d812de28bb24` | 2026-06-02 | Root [LICENSE](https://github.com/EfeDursun125/CS-EBOT/blob/23335620127198c82e060a4215b8d812de28bb24/LICENSE) is MPL-2.0; inspected `source/navigate.cpp` retains a permissive MIT-style header. Do not assume that header grants permission for all later modifications. No copying proposed. |

Repository identity was verified as `yapb/yapb`; neither guessed `hzqst/YaPB` nor `hzgzh/yapb` was silently treated as that project. E-Bot here means `EfeDursun125/CS-EBOT`, not its separately licensed `CS-EBOT-LEGACY` repository and not the unrelated eBot match-management software. The candidate `APGRoboCop/botrix` returned 404; unrelated Discord projects named Botrix were excluded. Four relevant implementations were available without substituting them.

### Bot Improver Submodule Provenance

The parent's [.gitmodules](https://github.com/ed0ard/CS2-Bot-Improver/blob/825aa4d2a345098e37c195c099f7b2b9d6bdfcce/.gitmodules) maps these paths to their repositories; the parent's recursive Git tree supplies these exact gitlink SHAs:

| Parent Path | Actual Source Repository And Pinned Commit | Checked License |
| --- | --- | --- |
| `addons/counterstrikesharp/plugins/BotState` | `ed0ard/CS2-Smarter-Bot` at `6b5781f85391816c08154a9c1d5b5dd6e898a2f5` | [AGPL-3.0 text](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/LICENSE) |
| `addons/counterstrikesharp/plugins/NadeSystem` | `ed0ard/CS2-Bot-NadeSystem` at `7605f272d0500a7bad5b6294555485c7721a40da` | [AGPL-3.0 text](https://github.com/ed0ard/CS2-Bot-NadeSystem/blob/7605f272d0500a7bad5b6294555485c7721a40da/LICENSE) |
| `addons/counterstrikesharp/plugins/BotAimImprover` | `ed0ard/CS2-Bullseye-Bot` at `c5a2e0f402f151336c820b7efc1b895aa087a953` | [AGPL-3.0 text](https://github.com/ed0ard/CS2-Bullseye-Bot/blob/c5a2e0f402f151336c820b7efc1b895aa087a953/LICENSE); license verified, aim implementation not used as behavioral evidence here |

The parent also pins BotController at `6a418f81ec96445068155b844c22f0e41935afb7` and BotVision at `df8f0707c7590cd55d9ffb8f6824ec9f3c959f5f`. Their internals were not needed for this comparison and are not claimed as inspected. Disabled Linux patch files in the parent are not evidence of the active cross-platform policy. This report recommends independently specified behavior and tests, not importing AGPL implementations. License discrepancies above require separate resolution before any future reuse.

## What The Code Actually Does

### 1. CS2 Bot Improver: Contextual Overrides, Not A Standalone Human Model

Active `BotState.Tick.cs::OnTick()` calls combat, movement, and recovery policies. `BotState.Combat.cs::UpdateBotCombat()` manages attack/gaze ownership and adds a reverse lateral velocity impulse after certain sniper shots. `BotState.Movement.cs::RecoverStuckBot()` tracks elapsed time/displacement before forcing recovery. These are modifications of an existing engine bot, not an independently implemented perception/navigation stack. [Tick dispatch](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotState.Tick.cs#L10), [combat](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotState.Combat.cs#L120), [recovery](https://github.com/ed0ard/CS2-Smarter-Bot/blob/6b5781f85391816c08154a9c1d5b5dd6e898a2f5/BotState.Movement.cs#L150).

NadeSystem's `PassesSituationalCheck()` considers recent firing, grenade type, smoke overlap, and flash/team scheduling. It also filters actual live enemy positions around proposed landings and can admit throws probabilistically without its information gate passing. That is not an acceptable sensory contract for SprayLab. Take the concept of contextual admission/cancellation, not those private-state reads or numeric settings. [Situational policy](https://github.com/ed0ard/CS2-Bot-NadeSystem/blob/7605f272d0500a7bad5b6294555485c7721a40da/NadeSystemPlugin.Decision.cs#L47).

**Comparison:** SprayLab already has gaze arbitration, progress-based recovery, native-input braking, and stronger belief-only utility admission. Its team claim cleanup still has A1's lifecycle hole. Do not port velocity writes, permanent alertness, runtime patches, or recorded grenade datasets.

### 2. YaPB: Notice Accumulation And Focus Commitment

`Bot::NoticeRate()` and `IsEnemyNoticed()` accumulate notice from distance, motion, visible parts, and skill with a bounded elapsed step. `EnemyMemorySpan()` varies retention. `ShouldSwitchFocus()` introduces a score margin and considers teammates already engaging a candidate; `LookupEnemies()` also retains an eligible current target. [Notice](https://github.com/yapb/yapb/blob/6444ce3099cdc4a5a4a53bd543011609c59abf5c/src/combat.cpp#L349), [memory and focus](https://github.com/yapb/yapb/blob/6444ce3099cdc4a5a4a53bd543011609c59abf5c/src/combat.cpp#L442), [lookup](https://github.com/yapb/yapb/blob/6444ce3099cdc4a5a4a53bd543011609c59abf5c/src/combat.cpp#L510).

`AttackMovement()` considers weapon class, range, reload, and fight style; `CheckGrenadesThrow()` throttles decisions and applies task/state restrictions. These are useful policy categories, not CS2 physics references. `EngagementScore()` reads enemy health and weapon inventory; those inputs must not be transplanted. [Movement](https://github.com/yapb/yapb/blob/6444ce3099cdc4a5a4a53bd543011609c59abf5c/src/combat.cpp#L1146), [grenades](https://github.com/yapb/yapb/blob/6444ce3099cdc4a5a4a53bd543011609c59abf5c/src/combat.cpp#L1734).

**Comparison:** current SprayLab already has human-scale reaction/motor delay and weapon-aware combat steps. Partial-exposure-sensitive recognition remains a real gap (A4). Multi-enemy target selection is not a leading current improvement: standard Duel constructs one human-side actor and all bots on the opposing side, so each bot normally has only one enemy. Nearest-target selection is a future multi-side concern, not evidence of present target-switch jitter.

### 3. ReGameDLL_CS: Recognition Queue And Separate Fast/Slow Updates

`CCSBot::FindMostDangerousThreat()` collects visible opponents; `UpdateReactionQueue()` stores a threat-state snapshot and selects an older queue entry according to reaction time. `IsNoticable()` uses visible parts, range, and movement. These are authored legacy bot heuristics, not human measurement. [Threat selection](https://github.com/rehlds/ReGameDLL_CS/blob/12a19be20c348594051bd4811bf89947c95e2f05/regamedll/dlls/bot/cs_bot_vision.cpp#L670), [queue](https://github.com/rehlds/ReGameDLL_CS/blob/12a19be20c348594051bd4811bf89947c95e2f05/regamedll/dlls/bot/cs_bot_vision.cpp#L1041), [notice](https://github.com/rehlds/ReGameDLL_CS/blob/12a19be20c348594051bd4811bf89947c95e2f05/regamedll/dlls/bot/cs_bot_vision.cpp#L1158).

`Upkeep()` handles frequent aiming separately from `Update()`. `AttackState::OnUpdate()` includes range-driven backup-weapon choices. The queue stores engine-owned reload/shield state; the aim path reads live velocity. Keep the temporal separation idea, not those privileged state accesses or GoldSrc thresholds. [Upkeep](https://github.com/rehlds/ReGameDLL_CS/blob/12a19be20c348594051bd4811bf89947c95e2f05/regamedll/dlls/bot/cs_bot_update.cpp#L32), [attack weapon choice](https://github.com/rehlds/ReGameDLL_CS/blob/12a19be20c348594051bd4811bf89947c95e2f05/regamedll/dlls/bot/states/cs_bot_attack.cpp#L310).

**Comparison:** SprayLab already separates 128 Hz motor/physics from four-tick sensing and slower geometry/team checks. It should preserve that separation while fixing synchronized CPU bursts. A7 is a narrower inventory-completion gap than reimplementing the legacy attack state.

### 4. E-Bot: Useful Recovery Diagnostics, Wrong Combat Population

`Bot::CheckStuck()` samples progress, maintains an eight-position history, detects confined oscillation, and coordinates local avoidance. This supports intent/progress-based diagnostics rather than a raw low-speed test. SprayLab already does much of this. [Recovery](https://github.com/EfeDursun125/CS-EBOT/blob/23335620127198c82e060a4215b8d812de28bb24/source/navigate.cpp#L2652).

`BlindUpdate()` chooses stop/strafe/fire responses by personality and ignores collision temporarily. `ThrowHEUpdate()` overwrites the spawned grenade's velocity. `FindFriendsAndEnemiens()` contains a zombie-specific hidden-target option. These are explicit reasons not to treat the project as a human competitive-CS2 benchmark. [Blind state](https://github.com/EfeDursun125/CS-EBOT/blob/23335620127198c82e060a4215b8d812de28bb24/source/ssm/blind.cpp#L8), [throw state](https://github.com/EfeDursun125/CS-EBOT/blob/23335620127198c82e060a4215b8d812de28bb24/source/ssm/throwhe.cpp#L8), [enemy search](https://github.com/EfeDursun125/CS-EBOT/blob/23335620127198c82e060a4215b8d812de28bb24/source/combat.cpp#L77).

**Comparison:** keep SprayLab's collision-valid escape inputs, finite flash turn motor, and shared projectile kernel. Do not import semiclip, wall awareness, projectile velocity replacement, or zombie rush assumptions. Useful recovery telemetry does not justify a behavior-engine rewrite.

## Negative Findings: Features Already Present

| Area | Current Local Implementation | Conclusion |
| --- | --- | --- |
| Bounded awareness | `awareness.ts::SightingMemory.observe/focus/anticipation`: expiry, brief occlusion, reachable exits, confidence, and negative sight evidence | Do not recommend adding generic last-seen memory or magically tracking behind cover. |
| Sound/shadow attention | `TacticalBrain.hear/perceive`, `CueAngleChecks`, `native-acoustics.ts`: noisy localization and reaction deadlines | Hearing and shadow attention already exist; do not present them as new features. |
| Partial visibility | `actor-visibility.ts::visibleActorPoints`, `perception.ts::selectVisibleAimCandidate` | Exposed body-part selection, margin heuristics, and short part hysteresis already exist. A4 is recognition, not adding head/body targeting. |
| Gaze/fire ownership | `aim-intent.ts::arbitrateGaze/firingVeto`, `TacticalBrain.command` | Combat/trade/memory/travel arbitration and inspectable firing vetoes already exist. |
| Coordination | `coordination.ts::TeamTacticsPlanner.plan`, `PassageReservations.request`, `trading.ts`, `team-utility.ts` | Entry/trade/crossfire roles, delayed reports, FIFO passage claims, and detonation-timed support already exist. A1 is cleanup, not new teamwork. |
| Human combat motion | `combat-movement.ts::combatMovement`, `TacticalBrain.dodge/finishBurst` | Latest baseline already adds weapon/range-aware policies, burst caps, bounded steps, and real opposite braking inputs. |
| Repositioning | `TacticalBrain.hurt/chooseLane`, `flank-plan.ts`, `tactical-personality.ts` | Damage pressure, recent-lane penalties, persistent flanks, and personality are not missing. |
| Stuck recovery | `travel-progress.ts::TravelProgress.update`, `TacticalBrain.recoverTravel` | Useful progress, intentional holds, passage waits, backoff, yield, and throttled replans already handled. Do not add random jumping or teleport recovery. |
| Backup/reload policy | `bot-loadout.ts::botLoadoutDecision`, `simulation.ts::applyBotCombatPolicy` | Exposed empty reload switching and reload cancellation already exist; A7 addresses dry, unthreatened completion. |
| Grenade safety | `utility-tactics.ts::predict/safeOutcome/command` | Current kernel replay, covered setup, bounded evidence, ally safety, final replay, draw cancellation, and committed-release ownership already exist. |
| Loading | `RealMapSession`, `PreparedRound`, `ResidentChunks`, `prepareSceneGpu`, collision preparation workers | Disk/RAM caching, bounded residency, staged actors, GPU fences, and prefetch are implemented. Prepared bytes/scenes do not prove every CPU consumer is ready. |
| Diagnostics | `performance.ts::FrameMetrics`, replay decisions, `tools/audit-chunk-handoffs.mjs` | Existing percentiles/export/auditor should be extended, not replaced by a new telemetry platform. |

## Actionable AI Findings

Priority means recommended implementation order within AI work. G1-G4 describe performance follow-ups beyond the completed preparation fixes.

### A1. Cancel The Team Claim When Defense Abandons A Draw

**P1, implemented and focused tests passed on 2026-11-04.** Baseline evidence follows; other proposals remain research only.

Implementation: the utility-defense branch in `simulation.ts` releases the pending team setup. `team-utility.ts` revokes a shared setup marker before removing an unthrown claim. `coordination.ts::TeamAssignment` carries that read-only marker through ordinary assignment copies; `TacticalBrain.command()` drops a revoked copy on its next command, rather than waiting for the previous TTL. Unrelated assignments and already released projectiles are not revoked.

Focused validation passed **5 files / 48 tests**. New tests exercise actual flash-turn/fire-escape defense commands, unchanged stock/no throw, partner release, immediate area reclaim, copied tactical invalidation, unrelated setup isolation, non-resurrection after reclaim, and projectile/detonation preservation. Existing committed-release tests also passed. Command: `npx vitest run src/range/duel/team-utility.test.ts src/range/duel/bot-utility-handoff.test.ts src/range/duel/utility-completion.test.ts src/range/duel/utility-defense.test.ts src/range/duel/coordination.test.ts --maxWorkers=1`.

Local evidence:

- `simulation.ts:256`, `applyBotCombatPolicy()` claims a team setup once a utility command is admitted.
- `simulation.ts:615`, `step()` permits defense only when no release has been committed. Its defense branch cancels `BotUtilityPlanner` and calls `selectActorUtility(actor.id, null)` but does not call `utilityTeam.cancel(actor.id)`.
- `simulation.ts:282`, `selectActorUtility(null)` only deletes held state, sets deploy readiness, and cancels weapon input. It does not release the team claim.
- `team-utility.ts::claim()` gives an unthrown setup five seconds. `assignment()`/`waiting()` retain partner waits; pruning checks lifetime/liveness, not whether the planner still exists. `cancel()` already preserves setups with an actual projectile.
- Existing `bot-utility-handoff.test.ts` tests defense not cancelling a committed throw. `utility-completion.test.ts` tests detonation release. Neither inspected test checks defensive cancellation clearing an unthrown team reservation.

The implementation releases that bot's unthrown team setup in the defensive cancellation path. It does not broaden cancellation to already committed releases or projectiles, or change native draw/release time.

Acceptance: two experienced allies, accepted covered setup, no committed release; trigger flash avoidance and separately fire escape. After one simulation tick, no held grenade, stock unchanged, no projectile, no team setup/wait/area reservation from that abandoned throw. A second thrower can claim the area immediately. Retain existing exactly-once committed-release and actual-detonation partner tests. Observe assignment polling too: a copied assignment must not retain an abandoned wait until its old five-second TTL.

Budget/limit: use the existing bounded cancellation operation, no geometry or trajectory work. This is a lifecycle defect with a static witness, not a measured explanation for the entry stutter or a claim that bots always wait five seconds.

### A2. Do Not Interpret An Aim-Part Switch As Enemy Translation

**P1, observed code gap.** `perception.ts::observeBot()` deliberately publishes a visible aim sample as bot-visible `position`, not the hidden actor root. `SightingMemory.observe()` estimates XZ velocity by differencing that position with the preceding same-ID sample. `TacticalBrain.command()` then uses that estimate for lead. Switching from a head/torso sample to a lateral arm, or between silhouette samples, can therefore create apparent translation even when the actor root is stationary. The speed clamp limits magnitude, not the false correspondence.

Propose estimating motion only from corresponding, currently visible samples, with discontinuity rejection/decay when a part changes. Add generation matching. Do not fix this by exposing hidden root position or native enemy velocity. YaPB/ReGameDLL's live-velocity reads are specifically not transferable.

Acceptance: a stationary posed target alternates visible head/chest/arm candidates; the estimator must not create a lateral lead spike. A truly translating, consistently sampled target must retain smooth finite lead. Occlusion, candidate loss, and a changed generation reset/decay motion without granting fire permission. Extend `awareness.test.ts`, `perception-improvement.test.ts`, and actual motor-level regression fixtures.

Budget/limit: bounded arithmetic over existing samples; no additional visibility rays, pose evaluations, or navigation. Treat articulated movement as uncertain rather than claiming access to perfect target motion.

### A3. Reconsider Combat Movement When The Range Regime Changes

**P2, observed code gap after the latest iteration.** `TacticalBrain.command()` initializes `combatMotion` only when identified and unset; `perceive()` clears it for a new/non-recent engagement, and equipment changes also reset it. Range itself does not invalidate it. A close SMG moving-fire choice can persist as a continuously visible target backs into a long-range engagement; the reverse mismatch is possible too.

Propose range bands with hysteresis and reconsideration only at an existing burst/step boundary. Preserve a current firing commitment and crouch-spray choice. Use the bot's fresh visible sample, not hidden distance. The source comparisons support contextual weapon/range policies, not their thresholds.

Acceptance: scripted 6 m -> 25 m -> 6 m continuous sight; policy changes at bounded action boundaries, not every sensor frame. Threshold-edge oscillation cannot repeatedly reroll RNG. Long-range precision still brakes normally; movement spread and novice rifle commitments remain unchanged. Extend `combat-movement.test.ts` and `bot-behavior-regression.test.ts`.

Budget/limit: one policy evaluation per eligible boundary, no new collision search. This refines an existing feature; it does not mean latest weapon-aware movement is absent.

### A4. Make Recognition Sensitive To Confirmed Exposure

**P2, observed code gap.** `TacticalBrain.perceive()` samples recognition delay using rank/traits, recent sighting, and randomness, but not the visible candidate's angular extent or sustained exposure. A tiny distant exposed part starts essentially the same recognition clock as a clear centered body at that skill. Body-part utility selection is already present and is not the missing piece.

Propose a small deterministic exposure accumulator from already-confirmed samples, angular size, and observed motion, followed by the existing reaction/motor gates. YaPB's `NoticeRate/IsEnemyNoticed` and ReGameDLL's `IsNoticable` establish the architectural idea, not calibrated constants. Do not consume their private velocity/buttons or assume probe `exposure` is a measured full-body fraction; `sampleCoverage` explicitly leaves untested areas unknown.

Acceptance: fixed-seed cohorts distinguish a sustained centered torso from a transient peripheral sliver without making either permanently invisible. More probes cannot by themselves confer faster recognition. Repeated sub-threshold peeks, full blindness, and smoke must not accumulate impossible evidence. Preserve existing rank ordering and test actual first permissible fire, not just a helper score.

Budget/limit: constant storage per tracked identity and arithmetic per existing sensor sample; zero extra rays. Suggested delay envelopes need trainer tuning and explicit labels, not FACEIT claims.

### A5. Resolve Utility Target Support Instead Of Subtracting A Body Offset

**P2, observed and already documented gap.** `utility-tactics.ts::BotUtilityPlanner.command()` places unauthored damage/fire targets at `report.point.y - 1.2` and smoke targets near the thrower's feet height. This is explicitly an approximation in the current code and October 31 report. On ramps, platforms, or another floor it can reject useful throws or aim at the wrong support layer. Kernel outcome checks reduce harm but do not make the guessed target height correct.

Propose a bounded support query at the remembered horizontal area, constrained to a plausible map layer and evidence uncertainty. Authored geometry/kernel-versioned opportunities keep their supplied targets. If support is ambiguous, abstain or retain an area candidate; do not query a hidden enemy's feet.

Acceptance: same-level flat floor, upward ramp, raised platform, overhang, and stacked-floor fixtures; no through-floor fire, no silent snapping to another storey. Predicted/live release remains the same kernel. Floor rejection must retain the previous safe no-throw result.

Budget/limit: at most two support candidates per planning attempt, within the existing four-trajectory admission cap, cached by collision/world revision and target region. No per-motor-tick floor search or changed gravity/fuse constants.

### A6. Give Smoke An Explicit Tactical Purpose Beyond Low Health

**P3, observed missing repertoire; defer until stutters are resolved.** The planner's `permitted()` only admits smoke below 40 own health, including authored opportunities. Thus a healthy bot cannot use an information-backed smoke to cover a known crossing/disengagement. `TeamUtilityCoordinator` synchronizes existing throws but does not create such objectives.

Propose an optional smoke intent from a known map crossing, own/allied route commitment, and a recent sensed threat corridor. Keep the current low-health defensive case. Never use smoke to react to an unseen enemy's current coordinates. NadeSystem's contextual checks are inspiration only; its runtime enemy filtering is rejected.

Acceptance: a healthy bot has a safe, evidenced crossing case with a positive admitted throw; an identical scene with no threat evidence does not precision-target hidden actors. Preserve friendly clear-lane rejection, stock/readiness rules, fire extinguishing, geometry safety, and cancellation on live contact. Assert an actual crossing or purposeful hold after bloom, not merely a thrown grenade.

Budget/limit: shortlist existing map opportunities, at most one smoke candidate within the current total cap. No route-by-route full trajectory optimization. This is authored training variety, not a claimed optimal execute system.

### A7. Complete The Dry-Weapon Fallback Without Requiring Sight

**P2, observed edge-case policy gap; secondary small candidate.** `botLoadoutDecision()` only chooses a loaded backup when a recognized visible threat is within 28 m and the current weapon is empty/reloading. Without visible contact, an empty primary with zero reserve and a loaded backup has no fallback. `TacticalBrain.command()` enters reload at zero ammo, but `reloadPressed` requires nonzero reserve. The bot can keep an unusable weapon until contact reappears. Rifle bots already carry a backup in `DuelSimulation` construction.

Propose a purely own-inventory fallback for an empty, non-reloadable firearm, while preserving deploy/decision commitment and committed reload floors. Normal reloadable empty guns should retain the existing no-hidden-threat behavior. ReGameDLL's range switching is broader than needed; do not import it wholesale.

Acceptance: primary ammo/reserve both zero, no sight, loaded legal backup -> one legal switch after readiness. Primary empty with reserve -> existing safe reload behavior. No loaded alternatives -> stable abstention, no equip loop. Preserve the existing test that ordinary out-of-sight reloads do not switch just because a hidden enemy exists.

Budget/limit: bounded inventory scan only; no sensor or geometry work. Its occurrence rate is unmeasured and probably lower in short fights than A1's cancellation case.

## General App Improvements And Entry/Handoff Follow-Up

These are scoped additions to current modules, not framework rewrites. Do not reopen Main's Meshopt/collision fixes without evidence that work remains.

### G1. Attribute The Literal First Frame Separately From First Combat Work

**P0 diagnostics.** `DuelEngine.enter()` and the end of `activateRound()` set `last = 0`. Consequently the literal next rendered `tick()` computes `frameDt = 0`, and `DuelSimulation.advance(0)` performs no fixed steps. A 46 ms literal first tick cannot automatically be blamed on first sensing/pathfinding. Conversely the first nonzero-dt tick can run sensors, route queries, and several 128 Hz steps. Record which one is slow.

`tick()` starts `cpuStart` after prefetch dispatch and loading/pacing checks, and samples before the subsequent HUD `report()`. `FrameMetrics.sample()` rejects `dt <= 0` and excludes the active-state boundary. Its trailing ten-second summary can therefore omit precisely the entry witness. The separate handoff auditor wraps all of `tick()`, which is a different CPU interval. Neither proves GPU time.

Propose a fixed-size opt-in trace spanning input/entry, async activation, the first rendered tick, first nonzero-dt tick, and first 3 seconds of the destination round. Include map ID, round/seed, readiness epoch, dt, step count, sensor count, pose/route/query counters, and phase spans for simulation, actors, shadow/radar, audio/events, render submission, and HUD reporting. Keep out-of-tick async work in separate task spans.

Acceptance/budget: a synthetic 46 ms dt-zero witness appears in entry diagnostics while active FPS semantics stay unchanged. Counters reconcile with actual calls. Bounded ring, no hot-path console or JSON serialization; target instrumentation overhead below 0.2 ms P95 on the profiling machine. Targets are proposed, not measured here.

### G2. Make CPU First-Use Readiness Explicit

**P1, profile before moving work.** Map GPU preparation does not exercise every CPU consumer. Initial construction does not call the same full spawn-camera/`syncActors(snapshot, 0)` sequence as handoff. `loadWorldWeapons()` calls `loadGesturePack()` without awaiting its fire-and-forget loader; its returned promise only covers world weapon model jobs. A late gesture completion calls `addGestureClips()` on current animators during play. `sampleActorHitPose()` can run animation/world-matrix work on authoritative sensor/shot ticks even after map preparation.

Propose a revision/cancellation-safe CPU-readiness list for current spawn poses and current actor gesture packs. Prime only demonstrated first-use costs under the loading gate; await or explicitly defer gesture attachment. `prepareSceneGpu`, existing per-actor preparation, clip conversion caches, and retained GPU resources must stay intact. Do not advance a throwaway live simulation or consume recognition/RNG to warm it.

Acceptance/budget: no current-loadout gesture binding task after readiness in the first 3 seconds; cancelled/old-round completions cannot modify new actors. Warm/cold first-pose counters explain differences. No altered initial ammo, RNG state, sensor timestamp, replay, XP, or shot pose. Suggested CPU preparation turns <=2 ms with explicit indivisible-stage reporting; a yield before a 38/96 ms unit is not a bound on that unit.

### G3. Budget Background CPU Work Against Active Play

**P1, partly addressed; shared admission remains future work.** `prefetchResumeAt` is set to wall time plus 1.8 seconds at readiness, not first active input; the user can wait longer before entering. The prefetch condition in `tick()` does not require inactive play. At baseline, `backgroundTurn/backgroundBudget` could not preempt GLTF parsing, collision restoration or tree construction. This iteration moves inflation/geometry decoding off-thread and makes the tree cooperative; Rapier restoration and some scene construction remain indivisible. `parseAsync` alone is not proof that CPU work runs on a worker.

Propose a shared admission budget for optional scene construction and expensive AI planning, keyed to actual active entry/handoff time and observed recent CPU headroom. Preserve compressed-byte fetch and current round deadlines; defer cold reconstruction if it cannot be sliced/off-thread safely. Bot planners must retain bounded beliefs and receive deterministic fallback inputs, not miss movement/shot ticks. `BotUtilityPlanner.predict()` already caps candidates but runs whole trajectory replays synchronously; simultaneous eligible bots can still produce a CPU burst.

Acceptance/budget: slow decoder/query-restore fakes plus five bots cannot admit multiple optional long CPU jobs in one active frame. Start with <=2 ms optional CPU admission per rendered frame, one resumable utility candidate at a time, and a 250 ms maximum planning wait before abstention/retry. Wall-clock exhaustion must not change native shot/physics clocks or seed outcomes unpredictably; use deterministic work quotas for gameplay choices. Main's measured indivisible costs require subdivision/off-thread work, not just timers around them.

### G4. Turn The Handoff Auditor Into An Entry-Tail Regression Gate

**P1, concrete verification gap.** `tools/audit-chunk-handoffs.mjs` currently begins collection after initial Enter, forces two prepared destinations, reports maximum CPU in the destination's first 3 seconds, and asserts handoff latency <500 ms. It does not assert a first-frame/maximum-CPU budget. A 46 ms gameplay frame can therefore be reported without failing this auditor. Its preparation timing wrappers also omit `rebuildActorsPrepared`; synchronous wrappers do not measure async continuation work.

Propose extending this existing tool, not launching another competing Vite/browser runner. Include initial entry, first nonzero-dt combat, prepared handoff, resident return, and cold fallback; enable phase spans from G1 and assertions with explicit hardware/preset labels. Volume is currently forced to zero: keep that case and add a separately controlled audio-enabled case when Main is ready. Do not run this concurrently with current profiling.

Future acceptance target on Main's declared reference setup: 30 transitions, first active-frame CPU P95 <=12 ms, destination first-3-second maximum <=25 ms, no >50 ms active CPU tasks, and no regression from Main's fixed baseline. Report failures, max, P95/P99, cold/warm mode, and end-to-end handoff latency separately. These are suggested engineering gates, not present results or guarantees for an old CPU. Four-times CPU throttling is a stress case, not real low-end validation.

### G5. Investigate Duplicate CPU Shadow Work Only If Spans Justify It

**P2 hypothesis.** `DuelSimulation.step()` creates `actorShadows()` on each sensor pass; `DuelEngine.tick()` computes them again for rendering at 50 ms intervals. `shadow-scene.ts::actorShadow()` performs support/sun/outline traces and allocates polygon data. Scene preparation does not prime that work. This is CPU geometry work even with negligible GPU load, but it is not established as the 46 ms cause.

Propose a versioned shared result only where actor poses, arena revision, and sample time match; otherwise reuse a bounded-age sample for presentation only. Never feed a render-time or stale shadow result back into authoritative perception. Current native radar overviews are already preferred, so a mesh-traversal radar fallback is a conditional diagnostic, not the default explanation.

Acceptance/budget: count native rays and per-consumer milliseconds before/after; equal sensory observations for identical seeds/times, no hidden caster exposure, correct render cleanup after death/restart. No extra sensor rays and no more than one computation per identical cache key. Do not change the current 24-probe actor-visibility ceiling or loosen collision to meet a frame budget.

## Broader Product Follow-Ups

These are proposals, not additional shipped features or claims that the existing metrics, backups and drills are absent.

- **A short adaptive session, not more independent toggles.** Build on existing shot/duel metrics to select one weakness and two drills, then a controlled retest. Require a minimum encounter count and comparable weapon/distance/movement conditions before describing a weakness. Success: the recommendation explains the actual measured error and a retest measures the same skill, rather than XP or win rate alone.
- **A held-out human behavior benchmark.** Use opt-in replay captures or appropriately licensed demo data to measure exposure-to-first-damage, stop-to-shot timing, re-peek intervals, spacing, hit locations, and utility outcomes. Split evaluation by weapon/range and reserve unseen encounters. Do not label arbitrary rank curves as measured FACEIT distributions. Blind user ratings should supplement timing metrics before making human-likeness claims.
- **A mechanics differential harness.** Reuse the existing build-pinned native arithmetic fixtures, then add measured trajectory captures for complete stopping/reversal, jump-crouch/landing and sustained fire. Show provenance and unresolved differences per mechanic/build. Equal constants alone are insufficient, and browser-to-browser agreement is not proof of game parity.
- **A visible loading/storage health view.** Extend current monitoring with active/prepared map identity, cold versus cached status, main-thread stalls and optional-cache failures. Progress and map caches must remain separately owned. Build on existing backup export/import with a clear recovery check; don't suggest local browser storage guarantees survival after site-data deletion.
- **A reproducible low-end quality contract.** Define real reference devices, resolution and memory limits, plus acceptance budgets for cold entry, warm transitions, sustained fights and effects. Keep exact combat collision in every preset; lower visual detail and preparation concurrency first. CPU throttling is only a stress test, not a substitute for old hardware.

## Fidelity And Realism Limits

- Bot Improver is a CS2 plugin over engine-owned mechanics. A policy calling engine functions is not public proof of the complete current movement, accuracy, grenade, or readiness state machine.
- YaPB, E-Bot, and the inspected ReGameDLL bots target GoldSrc-era environments. They provide decision-architecture examples, not current CS2 constants, recoil, movement, sound propagation, or utility authority. This is not CS:GO/Source SDK parity evidence either.
- Keep SprayLab's installed-file/native-fixture authority hierarchy. Any later mechanic change must independently record installed build, module/resource hashes, code/field provenance, extraction method, and unresolved values. This research performed no fresh installed-build audit and supplies no replacement constants.
- Distinguish static field extraction, traced active code, isolated native arithmetic replay, measured gameplay, and trainer policy. A trajectory matching the browser kernel proves internal consistency, not current Source 2 parity.
- There is no demo dataset, FACEIT cohort, blind human evaluation, or controlled player study in this task. Existing rank labels remain authored training difficulty. Do not advertise these proposals as human-indistinguishable, FACEIT-calibrated, or superior to all four upstream bots.
- Preserve simulated-shot impact coordinates and permanent world-space marks. None of the proposals needs `TrainerCanvas.tsx` changes, aim automation, hidden enemy state, or integration with a running game.

## Recommended Sequence And Validation Boundary

1. Use the companion performance audit as the completed preparation baseline. G1/G4 cover the remaining entry-tail verification; do not infer a GPU problem from prepared-map terminology.
2. A1 is implemented with cancellation/team-wait regressions. Retain its committed-release invariants during subsequent changes.
3. A2 and A3 improve current aiming/movement coherence without importing new tactical systems. Then evaluate A4/A5 with focused positive and negative fixtures.
4. A7 is a small inventory edge case; A6 is optional repertoire expansion. Neither should block entry smoothness. G5 remains conditional on measured cost.

Future work needs focused tests, full `npm run check`, native fixtures where relevant, and browser workflows. Keep authoring/dev optimizer jobs and performance captures isolated so measurements and dependency URLs remain meaningful.

## Research Delivery Check

- Four upstream bot implementations inspected at immutable commits; active Bot Improver submodules pinned to the parent's exact versions.
- Exact source files/functions and primary-source permalinks recorded above; root licenses and relevant conflicting source headers checked.
- Seven AI proposals, five scoped app/performance proposals, explicit existing-feature negatives, future acceptance tests, and proposed work budgets recorded.
- A1 is implemented; six other AI proposals remain explicit follow-up work. Five broader product proposals complement the five detailed performance proposals.
- Source links and licensing boundaries are research evidence, not proof of native gameplay parity or measured human-likeness.
