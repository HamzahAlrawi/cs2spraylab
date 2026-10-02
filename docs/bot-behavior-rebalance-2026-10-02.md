# Bot Behavior Rebalance - 2026-10-02

Skill levels are hand-tuned training heuristics, not measured FACEIT reaction,
accuracy, movement or rank-population statistics.

## Changes

- Beginners retain mostly simple peeks. Level 3 advanced-peek probability is
  capped at 2.5%, with shoulder peeks capped at 0.6%, after weapon, geometry
  eligibility and context weights. Ferrari, jump and crouch-wide peeks remain
  unavailable at levels 1-3. Basic options being blocked does not promote an
  advanced option; the bot holds instead.
- Novices have worse preaim, a greater low-aim tendency, less reliable opening
  role selection, and more wasted checks of occluded angles.
- At levels 5-8, recognition and settling times increase 8%, endpoint error
  increases 16%, preaim error increases 15%, and brake error increases 12%.
  Stop probability is modestly reduced and low-aim tendency increases.
  Level 10/10+ identity curves, weapon-family peek priors and recoil-control
  tuning are unchanged, with pre-change golden fixtures in the tests.
- Fresh audible steps/shots cause aggressive investigation, patient flank
  selection, or holder angle selection after recognition. Newer auditory
  information can supersede stale visual memory. A sound is not identification
  and never grants permission to fire at an unseen target.
- Simulation audibility uses extracted weapon-specific event volume/distance
  curves rather than a generic gunshot radius. Suppressed shots are tested both
  inside and outside their audible range. User audio volume cannot mute AI ears.
- Localization uses a separate seeded RNG so hearing cannot perturb tactic
  rolls before recognition. Estimates remain noisy, especially through cover.
  Rapid steps preserve the initial reaction deadline; future and expired cues
  are not actionable.
- Quiet travel is more common with one/two live bots than with many bots.
  Aggressive bots keep long opening approaches fast and can quiet down near
  cover. Recent damage interrupts quiet retreat. Walking changes input only;
  existing acceleration and footstep-emission rules remain authoritative.
- A useful firing hold requires a clear sensed angle, a nearby covered retreat,
  a suitable posture and no recent damage. These holds remain steady between
  bursts. Stale camps re-evaluate their route; blind searches no longer interrupt
  committed cover returns. Exhausted exposed exchanges can return to cover
  instead of repeatedly resetting attack at the same point. Close or recently
  threatened exposed fights favor short between-burst displacements; useful
  covered holds are still exempt.

This behavior pass adds no game hooks or hidden-player queries and does not
change recoil, ballistics, movement physics, scoring or impact coordinates.

## Regression Coverage

- `src/range/duel/skill.test.ts`: 10/10+ pre-change fixtures, unchanged recoil
  tuning and family priors, moderate 5-8 penalties, and 10,000 seeded draws for
  each novice level across four weapon families under advanced-favoring context.
- `src/range/duel/bot-behavior-regression.test.ts`: all three behavior roles
  reacting to steps/shots, unchanged pre-deadline decisions, 128-seed noisy
  localization, coalescing/expiry, newer sound priority, 256-seed count-dependent
  stealth and novice angle choices, prompt sound reactions during quiet
  one/two-bot approaches, shared-physics quiet speed, useful holds,
  64-seed stale-camp decisions, and executed acquisition across levels 5-10+.
- `src/range/duel/bot-audibility-regression.test.ts`: FOOTSTEP_RANGE across five
  skill settings and three map seeds, silent walk/crouch versus running, identical
  bot output for divergent unseen silent player positions, actual emitted steps
  per bot across 24 seeds and three roster sizes, and the existing 12-seed
  engagement/route-diversity population, plus weapon-specific gunshot ranges.

## Validation

Focused behavior run: 90 tests passed across eight files:

```text
npm test -- --run src/range/duel/bot-behavior-regression.test.ts src/range/duel/bot-audibility-regression.test.ts src/range/duel/skill.test.ts src/range/duel/brain.test.ts src/range/duel/awareness.test.ts src/range/duel/hearing.test.ts src/range/duel/bot-memory.test.ts src/range/duel/bot-firearm.test.ts
```

`npm run build` passed. `git diff --check` passed for the behavior-owned files.
Seven additional tactical behavior regressions passed using a name filter to
leave unrelated map/geometry assertions to their owner.

Final integrated `npm run check`: 1,311 tests across 73 files passed, followed by
a successful production build. The earlier seed-1 five-bot spawn failure was
repaired in generation/validation. Tactical variety now verifies six semantic
POI assemblies rather than requiring four arbitrary material kinds. The native
asset check also verifies AI sound metadata against the audio manifest.

The focused behavior tests do not import rendering engines or depend on
temporary generated asset manifests. On this host, the PowerShell npm shim
failed; runs used the installed Node/npm CLI directly.
