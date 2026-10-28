# Native Prefire Map Case Study

## Evidence Register

Use three separate evidence classes for every future map:

- **Geometry:** extracted static art, hull/shot masks and collision at an exact
  installed build. Dust 2 collision build 2000927 is pinned to SHA-256
  `395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396`.
  Geometry establishes fit and sightlines, not tactical frequency.
- **Authored positions:** licensed pawn-foot XYZ, facing and stance. Dust 2 uses
  MIT OpenPrefirePrac `44fb66eab70fb3b1b7112ed3c30cc68fb977dd26` and GPL-3.0
  cs2-retakes `2fde4a9cc21e791d6909b98bacc833aa5c54bdad`. Source hashes and full
  notices ship with the datasets. Preserve exact XY and allow only six native
  units of local floor correction. An unsupported point is rejected, not moved.
- **Observed usage:** bounded, fingerprinted complete demo rounds. Current
  OpenCS2 metadata revision is `8d7deddcd30c081fb197b75f58b4a0fba1117b9d`;
  aggregate covers 32 matches / 256 rounds / 2,560 POVs. Distinct-round support,
  side and phase are retained. Metadata licensing does not independently clear
  all underlying tournament-demo rights. Do not distribute raw demos here.

Creator/coach guides are qualitative crosschecks for missing regions, naming and
clearing order, not numeric frequencies or permission to copy proprietary
coordinates. See `prefire-source-crosscheck.md`, `prefire-evidence-followup.md`
and `prefire-statistics.md` for URLs, exclusions, bias and reproduction commands.

## How Dust 2 Improved

1. Imported current static art and exact collision instead of approximate boxes.
   Preserved unit scale, surface masks, alpha materials and lazy visibility
   culling. Unsupported visual/material features remain documented.
2. Retained licensed source orientation and stance. Tested floor support and
   actual head rays; removed silent spawn relocation and inflated hit zones.
3. Required real cover at player starts independently of camera orientation.
   Dense head, shoulder and crown samples caught false center-ray concealment.
   Protected the first 32 units of movement and tested both player stances.
4. Validated continuous walking and the shared full-speed motor. Contact,
   grounded accuracy and crosshair/camera checks addressed apparent aiming
   mismatches without adjusting recoil to hide geometry bugs.
5. Expanded region coverage through exact unused source records, rejecting
   unsupported elevator points and unsourced ninja replacements. Counts of
   source records are not counts of unique physical pockets.
6. Replaced arbitrary bot-count coin flips with an explicit one-to-five budget.
   Repeated pauses/cells union by round identity; mutually exclusive corner
   variants share evidence tickets. The panel exposes observed numerator and
   denominator. These remain relative training weights, not match probabilities.
7. On 2026-10-11, consolidated 24 duplicate approach/roster entries into ten
   distinct approaches. Compatible old sets are fixed-lineup options, and old
   saved IDs migrate. Starts are tied to named landmarks and every new start
   uses a 64-unit cover margin. A proposed shorter B-retake connector passed
   slow sweeps but stalled the running motor; it was rejected for the supported
   CT-spawn approach around the intervening wall. Full-speed motor validation is
   now mandatory inside the pool generator, not only the subsequent test suite.
8. Peek plans must demonstrate meaningful supported cover/exposure. Do not
   require movement merely because a source record has a moving annotation.
   Shared movement, sight checks, counterstrafing and actual shot-time state
   remain authoritative. Avoid hidden-player tracking or invented path endpoints.

## Required Next-Map Gates

- Record build/tool versions, collision checksum, conversion and license notices.
- Enumerate region/angle gaps before choosing coordinates; label rejected leads.
- Pin raw source inputs and reject malformed, mixed-player or incomplete rounds.
- Do not mix CT opening holds with T post-plant holds, nor kill hotspots with
  holding behavior. Keep sampled denominators and disclose small/correlated data.
- Author a small number of distinct landmark approaches; put roster variation
  inside them. Validate all candidates on the exact approach, not a nearby one.
- Regenerate pool manifests after start/path/collision changes. Test exact XY,
  stance, dense covered starts, first movement, supported walking, full-speed
  steering, native shot hittability and duplicate-corner exclusion.
- Test held angles, actual peek commits, return fire and no-through-wall aim.
  Open-ground fake cover cycles must fall back to holds. Only active opponents
  reserve space. Selected-roster planning is bounded to 16 cached rosters.
- Exercise fixed lineups, weighted density, saved-ID migration, scoring, tips
  opt-out, mobile layout, centered shots, pointer lock and mode transitions in
  browser tests. Record failures and exclusions, not just successful screenshots.
- Run full tests/build, offline native audits and active local CPU profiles.
  Separate simulation/render CPU cost from GPU frame time. Never promise old-PC
  or complete Source 2 engine parity from one machine's measurements.

## Reproduction

```powershell
node tools/build-prefire-pools.mjs --save
node tools/audit-prefire-bots.mjs --planning-only --report=research/dust2/planning.json
node tools/audit-prefire-hold-pockets.mjs
npm run check
npx playwright test tests/prefire.spec.ts tests/prefire-training.spec.ts tests/prefire-aim.spec.ts tests/tips-setting.spec.ts --project=chromium --project=mobile-chromium
python -m unittest discover -s tools/tests -p test_import_prefire_holds.py -v
```

Raw caches and generated research reports stay ignored. The licensed coordinate
bundles, compact evidence artifact, generator, tests and source reports stay in
the repository. Future changes must preserve physical impacts, native unit
conversion and shared player/bot accuracy rather than inventing mode-specific
aiming compensation.

## Previous Approach Integration: 2026-10-11

- `npm run check`: 3,163 tests / 134 files passed, followed by a successful
  production build. The existing large-chunk warning remains. Consolidated
  route-parameterized tests run ten approaches rather than 24 duplicated sets;
  retained lineups and source identities have explicit coverage.
- Desktop/mobile browser checks: 12 passed, four intentional platform skips.
  Includes manual route advance followed by lineup selection and persisted
  tips opt-out. Separate AI Duel compact/full-size checks passed.
- Importer: 33 tests passed. No new dataset was imported or runtime weight
  artifact regenerated for this follow-up.
- Native pool generation: ten approaches, 130 source identities and 143
  assignments admitted; the unhittable B-door `b_tunnel/26` proposal remains
  rejected. All starts and complete paths pass the mandatory full-speed gate.
- Native planning: zero failures; 32 holds, four crouch-hides, nine periodic
  peeks and five move-outs in the canonical roster audit. Six partial silhouette
  observations remain diagnostics with other qualifying covered views.
- Local-pocket diagnostic: 391 geometry pairs, 143 assignments, 33 reduced
  support counts. This diagnostic does not change runtime weights or certify
  route-conditioned probabilities from binned means.
- Active shooting profile: median CPU work 4.1-5.0 ms, p95 5.4-6.2 ms across
  Long Doors, B Tunnels and CT Mid Push; zero browser/map-resource errors.
  Performance preset, local machine, three short samples; not GPU frame time
  or a general old-machine guarantee.
- All six AI Duel themes render their purposeful assemblies in roof-excluded
  QA overviews, with no browser errors. The gameplay camera/roof is unchanged.
- `git diff --check` passed. No commit, push, deployment or ZIP was requested.

The accepted route/pool hashes and geometry-helper hashes live in the generated
reports. Research artifacts remain ignored, while the tools, tests, compact
evidence and source documentation are reproducible repository inputs. These
checks establish tested trainer behavior, not complete Source 2 or human-AI parity.

Final input/report snapshot SHA-256 (planning timing reports are not byte-stable):

```text
routes.ts                0f95e99e2f8fee7d4e79471c97120720f46638baae0ffcbe871d0d839d303f0d
dust2-weighted-pools.json 2da12c25f9215d55283af5f72d9d9c7000f89fbb4a09b287bf53c43995983e2e
dust2-hold-density.json   848ba3e53cf490479c5ce034f8efd6030aa1b07dbd40f2f147e4c201f7d13cf7
hold-pocket-audit.json   f4e565ff879abb455f56f7219dde4c4a32f8a451c901cf3a17fa4dc65a8427ae
```

## Coverage, Trading And Spread Follow-up: 2026-10-12

This preserves the earlier integration snapshot rather than relabeling it.

- Coverage-v4 adds eleven pinned source identities / 22 approach assignments:
  **141 identities / 165 assignments**, retaining ten approaches, all 24 old
  fixed lineups, native starts and paths, exact source XY/stance, and the five-bot
  cap. Extra Long car, A-site, Short, pit and Top Mid variants are included only
  on compatible approaches. Exposed/unhittable source proposals remain rejected.
- Sampling now mixes 50% physical-family coverage and 50% match-balanced
  regional support from the same 32-match / 256-round sample. Counts remain
  observed support, not corner probabilities. No new telemetry was imported.
  The expanded pocket diagnostic covers 437 pairs / 165 assignments, with 38
  reduced-support diagnostics; it is not promoted to replacement probabilities.
- New installs advance after completed routes. Presets preserve the explicit
  Next route / Repeat route choice; saved explicit repeat choices stay intact.
  Physical native clears verify both automatic behaviors after the review timer.
- Configurable Duel/Prefire death trading uses copied, recognized sight/sound
  reports, delayed skill-dependent attempts and final damage-batch survivors.
  Same-tick casualty order, knife responders, stale-memory priority, expiry,
  disabled combat/trading, reloads and temporarily blocked excursions have
  regressions. Prefire trades use prevalidated physical local swings and return;
  no hidden killer position or teleport is used. Effective combat conditions and
  the sampling-policy ID isolate comparable Prefire history.
- Held Prefire targets now pre-aim a reachable authored approach rather than
  reusing a facing for a different upstream course. Raw source orientation is
  retained as provenance. Duel scans avoid unrelated rear corners, with actual
  visual/audio/shadow evidence still able to redirect attention.
- Armor-aware physical damage punch was already connected. Paused/result camera
  sampling now shares the correct clock, and Prefire correction uses bounded
  input. The earlier server fixture remains build 2000922: the installed server
  hash changed and its verifier correctly rejects old offsets. No current-server
  damage-punch parity claim or artificial flinch amplification is made.
- Fresh build-2000930 weapon export: **35 weapons / 2,030 comparisons / zero
  differences**. All 355 current-client native accuracy cases pass. A newly
  inspected sampler produces 24 independently emulated spread cases, passing
  runtime comparisons without retuning spread. Native command seeds and complete
  engine parity remain unverified; see `spread-current-build-audit.md`.
- Final serial unit run: **3,250 tests / 141 files passed**, then production build
  passed. Existing large-chunk warnings remain. An earlier concurrent run had a
  timing failure and a now-corrected forward-sector fixture; the final run does
  not raise or weaken the arena test's timeout.
- Final reviewed-source desktop/mobile browser run: **16 passed / two intentional
  mobile keyboard/pointer-lock skips**. Includes actual default-next/repeat route
  clears, trading persistence/gates, damage-punch rendering, followed physical
  rays, pause/result clock and actual shot-state reporting. Both new-control
  screenshots were visually inspected. Earlier frozen-source full-route/projection
  rerun passed three cases with one intentional platform skip.
- One early browser startup failed during concurrent source/HMR edits with
  `Practice position 210, -297, 2 does not fit this map revision`. Native placement
  and three later frozen-source runs did not reproduce it. HMR lifetime is a
  hypothesis, not an established production root cause. The expanded pool-count
  expectation was updated from 15 to 17; geometry thresholds were not relaxed.
- Native planning remains zero failures, with the six partial low-cover
  observations still diagnostic. Importer coverage remains 33 passing tests;
  publication guards and strict full-speed pool generation passed. New native
  trade tests prove grounded cover excursions/returns with actor contacts.
- `git diff --check` passed. No commit, push, deployment or ZIP was requested.

Current reproducible input snapshot:

```text
routes.ts                  de1266c391de8368f2a50d08ccfeef08877b6dc5d6f1f62e5933a7d264d41d46
dust2-weighted-pools.json   e1d35bae4e19b871e37a592d3542c4c596522b4014c6fe6530d2b01246779894
native-spread-fixture.json  8ccca127ab2fbf27e5f5dbe36be7689fffbb15168c30693dd00841d3e1456e32
```

Final verification commands:

```powershell
npm test -- --run --maxWorkers=1
npm run build
npx playwright test tests/aim-punch.spec.ts tests/prefire-progression-trading.spec.ts tests/prefire-training.spec.ts tests/prefire-aim.spec.ts --project=chromium --project=mobile-chromium --grep "armored damage|presentation time|presets keep|saved repeat-route|Duel migrates|physical route clears|actual firing state" --output=test-results-encounter-reviewed
python tools/verify-native-accuracy.py
python tools/verify-native-spread.py
```
