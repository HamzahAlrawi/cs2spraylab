# Coaching Tips Display

Settings > Game > Training exposes **Show coaching tips**. The shared
`Settings.showTips` boolean defaults to `true` and is saved in the existing
`spraylab.range.v2` record. Only explicit `false` opts out; old or malformed
saves keep the default. Restoring defaults turns tips back on.

## Hidden When Off

- Automatic mode briefs, settings nudges and the first-time duel setup hint.
- Drill instructions, peek prompts and coaching-only rep advice.
- Review focus, next-rep actions, goals, strengths and expanded metric prose.
- Prefire live angle coaching, shot advice, per-angle tips and preset goals.
- Hearing device advice and practice reminders.

## Preserved

- Hits/headshots/bodyshots/misses, shot state, health, ammo, scores and results.
- Rep pass/fail labels, timing, movement measurements and exposure state.
- Factual coaching evidence, sample confidence, metric values and score meters.
- Position evidence, source notices, scoring definitions and accuracy limits.
- Entry/resume/reload/setup controls, browser shortcut warnings and ESC exit.
- Manually opened fundamentals lessons, including their explanatory content.

`TipsDisplay` in `DrillPanel.tsx` scopes shared-review prose visibility through
CSS without editing `CoachingReview.tsx` or `DuelScorecard.tsx`. It is a fragment
when tips are on, preserving the default DOM. The opt-out wrapper uses
`display: contents`; prefire setup itself retains its original root so existing
direct-child/mobile sizing rules still apply. Hidden prose is not visible or
available to assistive technology. No scoring or simulation behavior changes.

## Prefire Integration

`PrefirePractice` passes the shared flag through `DuelStage` to the optional
`PrefireSetup.showTips` prop, whose default is `true`. There is no second
persisted prefire-specific tips setting.

The setup also displays the route's `startLabel`, labels population `all` as
**Fixed lineup**, and offers **Practice lineup** only for fixed practice with
multiple lineups. Canonical angles come from `prefireLineup(route, lineupId)`;
weighted candidates and `holdingEvidence` calculations are unchanged. Choosing
the default lineup or changing routes clears `lineupId`. The parent retains
ownership of prefire route/config migration, session resolution and map data.

## Focused Verification

```text
npm test -- --run src/range/config.test.ts src/range/DrillPanel.test.ts src/range/tips-display-setting.test.ts
```

These tests cover persistence/migration, all-mode brief suppression, onboarding,
manual lesson access, drill measurements, hearing controls, prefire evidence and
lineup visibility. Full builds and broader integration checks remain with the
parent task, as requested.
