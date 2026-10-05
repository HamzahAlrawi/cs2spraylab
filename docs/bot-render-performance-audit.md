# Bot and rendering performance audit

## Changes

- Nearest-cover and distance-only box tests reject misses with scalar slabs. Full entry/exit contacts, materials, thickness and wedge clipping remain unchanged for penetration and scoring. Dynamic doors and breakables are resolved on each query, not held in a stale geometry cache.
- Native clip libraries stay cached, but only contributing actions remain scheduled in Three's mixer. Disabled actions previously kept active bindings. Replacements start before old actions stop so shared bone channels never restore an intermediate pose.
- Procedural weapon aim updates only the necessary bone chains. The renderer performs the full skeleton update; repeated full hierarchy traversals are removed without changing joint pitch or wrist-relative anchors.
- A lethal event used to add a second dropped weapon after `syncDrops` had already created one. Only the latter was tracked, leaking orphaned scene nodes into subsequent rounds. `syncDrops` now owns all drop creation.
- Cosmetic corpse contacts reject boxes without allocating per-axis bound arrays. The solver retains the same edge order and strict ties. A sleeping corpse no longer remaps joints until its root transform changes; falling bodies still solve and render normally.
- Duel setup controls are memoized, with stable callbacks, instead of rebuilding on every 10 Hz combat report. Live HUD and scorecard updates remain intact.
- Automatic quality can lower visual pose sampling from 60 to 30 Hz after sustained CPU pressure, with warmup and slow restoration. Low/high/performance presets keep their fixed policies. GPU-only slow frames and intentionally capped/idle frames do not trigger CPU adaptation. Physics, sight evidence, input, camera movement, recoil, damage and weapon cadence are not throttled.
- The toolbar gauge controls the existing persistent FPS/frame-time monitor. It remains optional and updates outside React at 2 Hz.

## Measurements

`npm run bench:duel`: default level 3, Freight yard seed 431, 20 simulated seconds, stationary high-health player. Current local Node measurements:

| Bots | Total CPU | Tick median | Tick p95 | Tick p99 |
| --- | --- | --- | --- | --- |
| 1 | 247.4 ms | 0.0431 ms | 0.2783 ms | 0.6232 ms |
| 5 | 623.8 ms | 0.1408 ms | 0.7113 ms | 1.0310 ms |

These are simulation costs on this workstation, not total frame times or old-machine FPS guarantees.

The final unsampled Chromium development profile (`research/duel-poi-profile-final-auto/results.json`, automatic quality, 1x CPU) measured 1.4/3.1 ms median/p95 CPU frames with one bot, 2.5/4.9 ms with five normally occluded bots, and 3.4/5.7 ms with all five forced visible. The last case used 75-77 draw calls. There were no page errors. The local RTX 4080 remained about 97% utilized after the profile browser closed; the user confirmed another GPU-heavy application was running. A minimal WebGL-only reference also had irregular frame scheduling. Consequently these runs do not establish an FPS improvement percentage or a clean hardware ceiling; automatic resolution fell in response to that shared-GPU frame pressure.

The browser profiling tool reports simulation, actor presentation, rendering, event processing, draw calls and frame cadence separately. `PROFILE_LABEL` keeps runs separate, `PROFILE_QUALITY` selects a preset, `CPU_RATE` selects Chromium CPU throttling, and optional `PROFILE_CPU=1` captures a diagnostic CPU profile. CPU sampling itself causes substantial overhead: do not compare sampled and unsampled frame timings as an optimization percentage. Development React, shader warmup, browser compositor scheduling, concurrent background activity and software GPU rendering also affect results.

## Regression coverage

- 3,000 seeded box queries and 800 mixed-solid/wedge scenes compare fast query results with the complete slab/nearest-hit reference, including finite limits, inside origins, malformed inputs and active/inactive geometry.
- A 100-clip synthetic library schedules one active action/binding while preserving exact shared-channel outputs. First-person inspect/fire/reload transitions stay bounded.
- Existing native grip, gait, aim-chain, crouch/jump and death presentation tests remain required.
- 2,000 seeded corpse/box contact cases compare full outputs against the array-based reference; settled-pose tests verify no joint remapping and correct compensation when the root moves.
- Browser regression repeats lethal feedback plus round reset twelve times, requiring one owned drop and no leftover scene nodes after reset.
- Browser FPS tests cover toolbar/settings synchronization, persistence and mode changes on desktop and mobile. Memoized setup tests exercise weapons, per-bot overrides and radar editing.

## Integration validation

- `npm run check`: 1,957 unit tests in 107 files, TypeScript and production build passed.
- Desktop Chromium: Duel play/configuration, spatial audio/barrel tracers, round/death flow and immediate damage feedback passed (17 tests; one mobile-only case skipped).
- Desktop/mobile Chromium: final resource, native pose/death, Deagle, FPS/onboarding and setup-control regressions passed (20 tests; four desktop-only cases skipped on mobile).
- Pre-capture FPS controls passed in desktop Chromium, Firefox, WebKit, mobile Chromium and mobile WebKit (five tests). These checks include settings synchronization and range-mode switching without relying on browser-specific mouse capture.
- `npm run audit:duel`: twelve seeded 25-second default-level rounds, zero zero-shot rounds and twelve multi-route rounds. A stationary high-health player is not a human-likeness or rank-calibration test.
- `git diff --check` passed. The dev server remains local; no commit, push or deployment is implied by this audit.

This work improves avoidable CPU/resource costs. It does not promise a particular FPS on untested hardware or claim indistinguishable human opponents.
