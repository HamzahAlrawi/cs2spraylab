# Prefire progression and bot trading

## Configuration contract

- `PrefireConfig.autoAdvance` remains default `true`. The setup shows an
  "After clearing a route" segmented choice: "Next route" (`true`) or
  "Repeat route" (`false`). Existing saved boolean choices remain authoritative.
- Learn, Entry and Pressure presets no longer contain `autoAdvance`. Selecting
  a preset preserves progression, and either progression choice still identifies
  the preset correctly. A historical saved `false` cannot be distinguished from
  an intentional repeat choice, so it is not silently migrated to `true`.
- `DuelConfig.tradeEnabled` and `PrefireConfig.tradeEnabled` are required booleans,
  default `true`. Missing/malformed values use the default; explicit `false`
  survives sanitization and persistence. Existing storage keys stay unchanged:
  `spraylab.duel.v1` and `spraylab.prefire.v1`.
- Both setups expose "Bots trade teammates" (`aria-label="Bot trading"`). The
  Prefire checkbox is disabled and labeled "requires return fire" when
  `returnFire === false`. Its checked value is retained, not forced off.
- Prefire presets also leave `tradeEnabled` unchanged. Trading does not change
  the identified training preset. Duel and Prefire preferences are independent.

## Original UI Handoff / Completed Parent Integration

The original UI subtask owned configuration, setup UI and tests only. Parent
integration now implements both modes' trade reactions; see
`bot-trading-and-facing.md` for their evidence, geometry and firing contract.

The existing `PrefireSession.beforeRestart(outcome, continuous)` advances only
when `continuous && outcome === 'won' && config.autoAdvance`. `next()` wraps
through catalog routes. Failed runs and manual repeats stay on the current
route. `DuelEngine.restart(continuous)` calls that scenario hook before creating
the next simulation; its automatic round flow calls `restart(true)` after the
review delay. No progression-hook change is needed for normal completed wins.

Parent-owned integration points observed at implementation time:

- `prefire/session.ts`: pass the effective flag
  `practice.returnFire && practice.tradeEnabled` into the derived `DuelConfig`.
  Prefire has its own bot-controller command path, so forwarding the flag alone
  does not implement Prefire trade reactions. Gate those reactions as well.
- `duel/simulation.ts` / team tactics: honor `config.tradeEnabled` when assigning
  and releasing trade behavior. Disabling trading should not disable unrelated
  bot behavior, return fire, movement or other tactical roles.
- `prefire/session.ts` history key: include effective trading when combat is
  enabled, so differing combat conditions do not share same-setup statistics.
- Automatic progression currently changes the session's `routeIndex`, not the
  stored `routeId`. The stage reports the live route and includes it with setup
  updates. Persisting automatic route position itself would need a parent-owned
  stage/session hook; this patch persists the progression choice only.

## Focused verification

```powershell
npm test -- --run src/range/prefire/config.test.ts src/range/duel/config.test.ts src/range/prefire/session.test.ts
npm run test:browser -- tests/prefire-progression-trading.spec.ts --project=chromium --project=mobile-chromium
npm run build
```

Unit coverage checks default migration, strict flags, explicit repeat/trade-off
persistence, preset independence and the existing win-only progression hook.
Browser coverage checks the real setup controls, reloads, return-fire gating,
independent mode preferences, and segmented-control layout on desktop/mobile.
Gameplay trade behavior has separate shared-event, physical movement and native
collision regressions in `duel/trade-integration.test.ts`,
`prefire/bot-trading.test.ts` and `prefire/native-trading.test.ts`.

## Native route-clear follow-up

Added `physical route clears advance by default after review and repeat when
selected` in `tests/prefire-training.spec.ts`. It clears the five fixed Long
Doors opponents twice using the existing `clearNativeAngles` native walking,
counter-stopping and physical shot helper. No actor health, position, damage,
spread or recoil values are edited. Only the helper's waypoint cursor resets
when the engine creates a different simulation.

Both runs select the Learn preset and a two-second review through the real UI.
The first leaves the default "Next route" selected and advances from
`long-doors` to the next catalog route (`long-a`). The second selects Long Doors
and "Repeat route" through the UI, then verifies a new fighting round starts
on `long-doors` after another complete clear.

A test-only observer delegates unchanged to the real engine restart and records
its review elapsed time. Both automatic restarts must occur after at least two
review seconds and no later than one maximum frame step afterward (2.25 s).
The case also checks visible route-cleared feedback/countdown, the original
route during review, the restarted route afterward, exactly one saved winning
history entry per clear, and no page errors. The final settings assertion exits
pointer lock first because active play intentionally hides the setup panel.

Focused result: **1 desktop Chromium case passed, 1 mobile Chromium case
intentionally skipped** (19.4 s total). Other browser cases, unit suites, build
and fullcheck were not rerun for this follow-up. Separate generated artifacts
avoid sharing the parent's default Playwright output directory:

```powershell
npm run test:browser -- tests/prefire-training.spec.ts --project=chromium --project=mobile-chromium --grep "physical route clears advance by default" --output=research/prefire-native-progression-results
```

Parent runtime now wires `tradeEnabled`; the earlier integration checklist is
historical handoff context. This follow-up validates real route progression
without changing runtime files or replacing completion with a forced result.
No session advancement change is needed.
