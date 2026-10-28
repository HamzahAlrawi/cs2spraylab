# Beginner difficulty adjustment

Baseline: `fbeefb2`. Only AI identity tuning changes; these are training heuristics,
not measured FACEIT population values or changes to native game mechanics.

For levels 1-6, assistance is `(7 - level) / 6`. Existing seeded identity variation
is retained, without drawing extra random values. Apply:

- Recognition time: multiply by `1 + .28 * assistance`.
- Aim settling and brake error: multiply by `1 + .20 * assistance`.
- Aim endpoint error: multiply by `1 + .45 * assistance`.
- Pre-aim error: multiply by `1 + .25 * assistance`.
- Low-aim tendency: add `.05 * assistance`.
- Stop tendency: subtract `.06 * assistance` with a .05 floor.

Levels 7, 8, 9, 10 and 10+ return their original identity traits untouched. No
changes to perception access, navigation, peek repertoire, crouch/recoil styles,
weapon damage/spread/recovery, movement physics, armor, health or XP formulas.
The common trait factory covers both Duel brains; high-skill Prefire presets are
unchanged. No extra frame-loop work or additional assets are introduced.

## Measured internal scenarios

Run against the same 32 seeds, AK-47 aggressive bots, a fixed open test arena,
five seconds per encounter, stationary and laterally moving targets:

```powershell
node tools/calibrate-duel.mjs before-low-rank 1,2,3,4,5,6,7,8,9,10,10+
# Apply the tuning before running the after capture.
node tools/calibrate-duel.mjs after-low-rank 1,2,3,4,5,6,7,8,9,10,10+
```

Reports remain in ignored `test-results/duel-calibration-*.json`. These tests are
repeatable trainer encounters, not CS2 captures or human win-rate measurements.

| Level / moving target | First shot median, before -> after | Hit rate, before -> after | First damage median, before -> after |
| --- | --- | --- | --- |
| 1 | 758 -> 969 ms | 4.7 -> 3.7% | 719 -> 2633 ms |
| 2 | 703 -> 867 ms | 6.1 -> 3.8% | 766 -> 1000 ms |
| 3 | 648 -> 758 ms | 7.4 -> 5.8% | 688 -> 906 ms |
| 4 | 578 -> 641 ms | 11.3 -> 12.3% | 617 -> 680 ms |
| 5 | 555 -> 602 ms | 26.1 -> 24.5% | 617 -> 641 ms |
| 6 | 523 -> 531 ms | 39.2 -> 38.5% | 594 -> 594 ms |

All twelve lower-rank rows opened fire later. Hit and lethality outcomes remain
stochastic and need not decrease for every scenario. Timing medians exclude
encounters where the corresponding event never occurs; they must not be read as
uncensored population reaction times. There is no promise that a bot can never
win an individual duel.

All ten scenario rows for levels 7-10+ matched the baseline exactly across every
recorded metric (shots, hits, headshots, lethality counts and timing).
Golden identity tests cover levels 7-10+, while cohort tests preserve ordered,
bounded lower-rank traits and existing combat tests verify the bots still engage.

## Validation

- `npm run check`: 254 files / 4,897 tests passed, followed by TypeScript and the
  production build. Existing bundle-size warnings remain.
- The reload regression now allows twelve seconds instead of nine. A trace
  confirmed the beginner bot reloaded, followed its covered search route,
  reacquired the target and fired at 9.4297 seconds; all behavioral assertions
  remain, and the loop exits once the post-reload shot occurs.
- Desktop first-visit Duel browser smoke passed. The existing mobile-landscape
  test failed before gameplay because it expects a header at most 40px tall,
  while the current layout is 44px (`tests/duel.spec.ts:227`). Layout/CSS is
  unchanged in this iteration; that separate UI mismatch is not fixed here.
- Changelog history is retained. No push or deployment performed.
