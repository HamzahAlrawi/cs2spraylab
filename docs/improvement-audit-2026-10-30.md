# Improvement Audit: October 30, 2026

## Scope And Confidence

Baseline: deployed `a2f1b6e` before the source-only history rewrite.
This is a source/document/test inspection, not a new performance capture, native
extraction or gameplay-parity certification. Historical measurements below are
explicitly dated; none should be represented as measurements of this HEAD.
Asset removal and local extraction are documented separately in
[source-only setup](source-only-assets.md). This audit does not implement the
recommended gameplay/performance features.

P1 means high-impact next work; P2 means worthwhile follow-through. There is no
evidence here of a P0 outage. Recommendations preserve the physical shot/impact
coordinate model, frontend-only deployment and current weapon selection.
Network-delay simulation and the intentionally removed tracking mode stay
removed. Bot perception work below does not mean restoring that training mode.

## Top Recommendations

### 1. P1: Finish Cold-Preparation Main-Thread Budgeting

**Evidence.** `src/range/prefire/map.ts:199` parses JSON on the owning thread;
`:204` yields before, not within, `GLTFLoader.parseAsync` at `:206`. Material/
texture processing and scene traversals continue at `:210` and `:255`.
`src/range/prefire/background-work.ts:34` provides cooperative stage budgets,
but cannot preempt a single expensive parser operation. The October 23 sample
recorded 56-192 ms background tasks (`docs/fidelity-delivery-results-2026-10-23.md:37`).
The newer doc still explicitly leaves cold-construction long tasks open
(`docs/local-chunk-loading-2026-10-29.md:50`). This is a remaining architectural
gap, not proof that the older maximum recurs on every current load.

**Next work.** Attribute remaining tasks by parse, decode, scene construction,
collision restore and shader stage; move transferable preparation off-thread or
split oversized visual sectors only where measurements justify it.

**Acceptance.** Publish same-seed cold-next-chunk and prepared-next-chunk traces
for all eight chunks, 1/3/5 bots, including first three seconds after handoff.
Meet or explicitly revise the existing <=100 ms preparation-task target
(`docs/fidelity-loading-roadmap-2026-10-22.md:176`), report long-task counts and
active-fight p95/p99, and test cancellation/retry. Include a physical weak-CPU
device; throttling alone is not hardware validation. Do not count warm/disk-byte
reuse as eliminating cold reconstruction.

### 2. P1: Deliver GPU-Compressed Textures And Evaluate Visual-Only LOD

**Evidence.** Current map delivery creates WebP blobs and configures Meshopt,
not a KTX2 texture loader (`src/range/prefire/map.ts:186`, `:205`, `:225`).
`src/range/duel/gpu-readiness.ts:25` budgets decoded RGBA plus mipmaps;
`src/range/duel/scene-preparation.ts:35` uploads each whole texture before
checking the 4 MiB / 2 ms batch thresholds. Pacing therefore does not make a
large individual upload small. The older roadmap explicitly distinguishes WebP
transfer savings from GPU compression (`docs/fidelity-loading-roadmap-2026-10-22.md:152`),
and the latest loading doc says that pipeline remains absent
(`docs/local-chunk-loading-2026-10-29.md:53`).

**Next work.** Benchmark a limited KTX2/Basis texture conversion first, with
device-format fallback, then assess distant decorative LOD independently.
Native PVS already exists; it is not the missing feature.

**Acceptance.** Compare cold bytes, transcode CPU, decoded/GPU-memory estimates,
upload stalls and rendered frame cost against unchanged representative scenes.
Check normal/data color spaces, mipmaps, grate alpha, scoped views and cover
silhouettes on desktop/mobile. Preserve exact collision and shot geometry.
Retain cancellation/disposal and unchanged-foreground checks from
`tests/map-gpu-preparation.spec.ts:25`. Do not claim a memory win from smaller
download bytes alone, or call estimated backing storage measured VRAM.

### 3. P1: Close Measured Gameplay-Parity And Build-Provenance Gaps

**Evidence.** The conformance format supports manual captures
(`src/range/movement-conformance.ts:14`), but inspected regression fixtures are
explicitly trainer-generated (`src/range/movement-conformance.test.ts:5`).
`docs/movement-conformance-and-frame-diagnostics.md:57` says those repeats never
create a native measurement. Landing caller semantics and complete trajectories
remain open (`docs/movement-native-recheck.md:127`,
`docs/accuracy-native-recheck.md:126`). Shell insertion remains at the simulated
loop boundary (`src/range/weapon-actions.ts:132`), while the native audit calls
start/finish, insertion and silent-rate semantics estimates
(`docs/native-reload-timing-audit.md:122`).

The most recent documented resource/client inspection is build 2000938;
server grenade fixtures intentionally remain 2000935
(`docs/grenade-presentation-audit-2026-10-29.md:7`, `:40`). Dust 2 collision has
its own older provenance (`docs/native-grenade-fidelity-2026-10-28.md:16`). Mixed
builds are an evidence-maintenance obligation, not proof that mechanics changed.

**Next work.** Maintain a mechanic-to-build/hash/code-location ledger. Diff
affected installed static resources before changing formulas; preserve older
fixtures. Use the existing importer for authorized manually supplied references,
without adding game automation or process access. Trace unresolved landing and
shell-reload state paths rather than substituting cosmetic markers.

**Acceptance.** Predeclare precision and tolerances for stopping/reversal,
jump-crouch/landing, burst recovery, recoil group distributions and reload
interrupt/readiness boundaries. Include raw reference hashes, measured versus
synthetic labels, held-out cases and explicit failures. Compare scheduled shots
at varied frame rates/within-step offsets without changing impact coordinates.
An arithmetic fixture match must remain distinct from end-to-end CS2 parity.

### 4. P1: Calibrate Bots Beyond A Single Internal AK Scenario

**Evidence.** Difficulty curves are expressly heuristic
(`src/range/duel/skill.ts:119`, `:134`). October 29 tuning already softened
levels 1-6 and preserved levels 7-10+; repeating that request would rediscover
completed work. Its witness used 32 seeds, an aggressive AK bot, open arena,
stationary/lateral targets and five-second encounters
(`docs/beginner-bot-tuning-2026-10-29.md:22`). Timing medians exclude encounters
without the event (`:46`), so they are not unconditional reaction distributions.

**Next work.** Expand conditional internal calibration before further global
tuning: weapon class, distance, head/limb-only exposure, pre-aim, cover, utility,
role and teammate count. Separately obtain licensed/authorized human reference
samples with compatible visibility definitions if population claims are desired.

**Acceptance.** Report no-shot/no-damage rates alongside censored timing
distributions, confidence intervals, trade opportunity/attempt/success and
exposed-idle time. Use held-out seeds/maps and human review of decision replays.
Preserve high-level golden baselines unless an intentional change is approved;
never rebalance difficulty by changing shared damage, spread or movement.
Keep FACEIT labels described as heuristics until empirical calibration exists.

### 5. P2: Connect Visible-Part Selection To Actual Own Uncertainty

**Evidence.** Candidate selection accepts current spread/inaccuracy and residual
aim/recoil uncertainty (`src/range/duel/perception.ts:19`), but falls back to
stance baseline plus spread when omitted (`:38`). The live Duel call passes FOV
and previous visibility, not `angularUncertainty`
(`src/range/duel/simulation.ts:532`). The isolated uncertainty test supplies it
directly (`src/range/duel/perception-improvement.test.ts:126`); that does not
establish live integration. Candidate support is deliberately a lower bound:
the algorithm stops after a visible sample per group and records coverage
(`src/range/duel/actor-visibility.ts:130`, `:155`). It is not measured exposed area.

**Next work.** Feed bounded, current own-weapon/aim uncertainty into the live
selector, and validate how sparse probe support influences head/body choices.
Treat this as an integration improvement, not evidence that bots currently see
through cover or that the selector is a calibrated hit-probability model.

**Acceptance.** Add simulation-level witnesses where identical visible geometry
but different own recovery/aim error changes the choice appropriately; preserve
head-only and limb-only engagement, hysteresis and stale-sight expiry. Retain
the 24-probe ceiling and unknown-versus-occluded distinction. Hidden opponent
HP/armor/position changes must not alter decisions without new observations.

### 6. P2: Validate Audio Propagation And Cadence, Not Just Native Samples

**Evidence.** Native-map sound routing already uses a navigation-derived graph
(`src/range/duel/native-acoustics.ts:13`), so the old claim that native chunks
have no doorway route is obsolete. Rendering still uses browser HRTF/inverse
distance (`src/range/spatial-audio.ts:42`), fixed routed gain/filter values
(`:94`) and authored reverb taps (`:135`), not Source 2 acoustic portals/mixers.
Latest audio evidence explicitly excludes equivalent envelopes, buses, tinnitus
and propagation (`docs/grenade-presentation-audit-2026-10-29.md:65`).

**Next work.** Audit representative tunnel/door/stair/vertical paths with the
shared audible-evidence path, then verify footstep cadence and flash/deafening
behavior separately. Do not replace working native banks or redo the fixed
60-Hz importer issue as though it were still outstanding.

**Acceptance.** Compare known-position sounds for rendered audibility and AI
hearing across occluded/direct paths, teammate filtering, walk/run/landing and
height changes. Record reference build, device/headphone calibration and timing
uncertainty. Bound voices and graph work, retain pause/loop ownership, and
explicitly label remaining HRTF/propagation approximations.

### 7. P2: Target Remaining Grenade Adapters, Not Already-Fixed Presentation

**Evidence.** Smoke radius/lifetime, bloom and decoy lifetime are authored
constants (`src/range/duel/utilities.ts:31`); decoy end damage and cadence are
separate trainer branches (`:223`, `:272`). Smoke HE clearing is explicitly a
5 m / one-second browser envelope (`src/range/duel/smoke-density.ts:9`). Binary
HE obstruction rays remain an approximation (`src/range/duel/utilities.ts:310`).
The latest limitations distinguish these from verified launch/flash arithmetic
and native particle assets (`docs/native-grenade-fidelity-2026-10-28.md:41`,
`docs/grenade-presentation-audit-2026-10-29.md:87`).

**Next work.** Prioritize references for smoke clearing/refill, fire support/
smoke suppression, moving-entity contacts, decoy lifecycle and fractional HE
cover. Keep server mechanics, client compositing and bot response as separate
workstreams. Do not tune gameplay from animation/sound markers.

**Acceptance.** Pin build/module/resource hashes and active code paths for each
promoted rule; add isolated native fixtures where feasible, then full-size
browser scenarios for cover, floors, overlaps and replay. Retain CPU/GPU hole
agreement and post-result simulation. Leave unknowns labeled unknown when only
an asset or matching constant is available; do not promise native fluid parity.

### 8. P2: Prove Multi-Map Authoring End To End Before Expanding The Catalog

**Evidence.** A generic lazy registry and admission gate exist
(`src/range/prefire/map-registry.ts:15`, `:37`), but the default adapter registers
only Dust 2 (`src/range/prefire/map-adapters.ts:10`). Duel directly imports
`loadDust2`/`dust2Catalog` (`src/range/duel/real-map.ts:5`) and uses that catalog
for courses/density (`:62`, `:69`). This is partial reusable infrastructure,
not an implemented multi-map experience. Manual lineup authoring/export is
already available and collision-bound (`docs/manual-duel-lineups.md:13`).

**Next work.** Exercise a second small map package through the existing contract
and identify the remaining Duel coupling before committing to a large content
expansion. Require source rights, build/hash identity, coordinate conversion,
native cover/walking/hittability checks and evidence review for every package.

**Acceptance.** A second package loads lazily and passes admission without
Dust 2 route fallbacks; settings/history/cache/manual-lineup identities stay
isolated across maps and revisions. No warm-start download of unrelated maps.
Distinguish authored coverage, hold-frequency evidence and combat endpoints:
the 2,242 complete combat pairs include four overlapping matches with the hold
corpus (`docs/position-source-followup-2026-10-23.md:32`), not independent new
holding-frequency denominators. License/access gates remain prerequisites.

### 9. P2: Make Existing Backups Safer To Recognize And Restore

**Evidence.** Export/import, confirmation and persistent-storage controls already
exist (`src/range/ProgressionAccount.tsx:136`, `:196`, `:202`). Export records time
and origin (`src/range/progression.ts:632`), but selection only reads/parses JSON
before a generic replacement confirmation (`src/range/ProgressionAccount.tsx:40`,
`:150`, `:203`); full backup validation occurs on restore
(`src/range/progression.ts:640`). Recovery, quota and cross-tab protections have
browser witnesses (`tests/progression-recovery.spec.ts:59`, `:73`, `:122`).

**Next work.** Validate and preview backup date/origin, level, wallet and
collection changes before enabling replacement; make cancellation/export of
current progress straightforward. Clarify that progression backup is not a
whole-app backup: manual lineups use a separate local library/export
(`docs/manual-duel-lineups.md:18`). This is UX follow-through, not a finding
that damaged imports currently overwrite valid progress.

**Acceptance.** Preview old/different-origin backups, reject bad checksums/future
schemas before replacement, preserve claimed gifts, and test keyboard/mobile
focus plus failed saves. A download may be reported as started, never guaranteed
written to disk. Site-data deletion must still be described as destructive to
all local copies; persistence permission is not cloud sync or external backup.

### 10. P2: Resolve The Known Mobile Landscape Layout/Test Contract

**Evidence.** `tests/duel.spec.ts:218` opens 844x390 and requires a <=40 px header
at `:227`, with the first-visit hint contained in that header at `:230`.
`src/range/ux.css:232` defines 44 px in landscape; `:29` makes the hint a
separate relative full-width element. Earlier compact rules remain in
`src/range/range.css:135` and `:159`. The October 29 bot delivery explicitly
records this browser failure as unfixed (`docs/beginner-bot-tuning-2026-10-29.md:67`).
This is a source-confirmed conflicting contract and previously reported failure,
not a new browser reproduction or proof that gameplay is unusable.

**Next work.** Decide the intended current header/hint layout, then align CSS
and assertions. Do not merely relax the height check or delete the onboarding
containment check without replacing its user-visible protection.

**Acceptance.** At 844x390 and narrower landscape sizes, test first visit and
dismissed hint, reachable Enter/setup/exit controls, unobscured HUD, no horizontal
overflow and a usable canvas. Screenshot desktop/mobile and verify actual
playability, rather than treating the green unit/build checks as coverage here.

## Already Fixed: Do Not Rediscover

- Persistent verified map bytes survive a fresh JS realm; cache eviction is
  separate from progression (`tests/duel-disk-cache.spec.ts:46`,
  `docs/local-chunk-loading-2026-10-29.md:5`). This is not offline installation
  of the entire app or a guarantee against browser eviction.
- One-next-chunk preparation, initial/prefetched GPU completion and bounded
  older-scene residency exist (`src/range/duel/scene-preparation.ts:31`,
  `src/range/duel/gpu-readiness.ts:11`,
  `docs/local-chunk-loading-2026-10-29.md:25`). They do not settle items 1-2.
- Scheduled shot sampling, mixed-pellet aim punch and map-relative tactical
  choices have regressions (`src/range/duel/shot-time.test.ts:8`,
  `src/range/duel/aim-punch.test.ts:23`,
  `src/range/duel/tactics-translation.test.ts:37`). Do not reintroduce the old
  crosshair-only impact or world-X lane defects.
- Smoke is now a depth-aware volume, not the old legacy sprite; HE clears the
  full trainer cloud, and radar uses the native overview with persistent reuse
  (`docs/grenade-presentation-audit-2026-10-29.md:77`,
  `src/range/duel/smoke-density.ts:11`, `tests/native-radar-delivery.spec.ts:5`).
- Grenades continue after competitive results; pause still freezes world time
  (`src/range/duel/simulation.ts:479`, `:487`,
  `tests/post-round-grenades.spec.ts:3`). No repeat result/XP is intended.
- Mouse chords, rear-flash normal whiteout, native utility loops, animated
  groundfire and compact scorecard were recently repaired
  (`docs/grenade-presentation-audit-2026-10-29.md:28`, `:50`, `:65`,
  `docs/radar-utility-review-2026-10-29.md:83`, `:112`). Their remaining limits
  should not be described as absence of those features.
- Recovery copies/IndexedDB, save warnings, gifts and portable progression
  backups already exist (`docs/progression-recovery-gifts.md:12`,
  `src/range/ProgressionPanel.tsx:96`, `tests/progression-recovery.spec.ts:24`).

## Documentation Drift And Handoff

- The six-rifle AGENTS feature list is historical. Current selection is 34
  weapons, with AUG intentionally excluded and its legacy data retained
  (`src/range/config.ts:30`, `:38`, `:39`). Do not remove newer weapons or restore
  AUG while following the older list.
- `docs/fidelity-loading-roadmap-2026-10-22.md:145` says Duel PVS is disabled;
  `:301` describes the old audio routing, and `:320` says utility context is
  absent. Those are historical problem statements, superseded by the checkpoint,
  native acoustic graph and October 26-29 utility deliveries.
- The delivery doc's final open list still calls Range-origin sampling and
  utility-aware context incomplete (`docs/fidelity-delivery-results-2026-10-23.md:159`),
  despite its own follow-up describing corrected Range sampling at `:47` and
  later utility implementation (`docs/bot-improver-implementation-2026-10-26.md:75`).
  Read the narrower remaining limits, not the old omnibus list.
- `docs/native-grenade-fidelity-2026-10-28.md:38` still says legacy smoke sprite
  rendering; October 29 supersedes it. Its missing full client-whiteout statement
  at `:51` is now partial: the normal helper is verified, but afterimage/HDR/
  composition are not (`docs/grenade-presentation-audit-2026-10-29.md:35`).
- `docs/prefire-map-authoring.md:20` still reports 141/165 identities/assignments;
  the later source follow-up reports 197/347
  (`docs/position-source-followup-2026-10-23.md:67`). Counts and source support
  must be attached to revisions, not merged as independent populations.
- The old missing-FPS audio-import note
  (`docs/native-reload-timing-audit.md:135`) is superseded by the delivery record
  (`docs/fidelity-implementation-checkpoint.md:119`). Shell-state verification
  is still open; these are different issues.

Suggested order: reproduce item 10 as a small reliability task; address 1-2
with controlled performance witnesses; close 5 with simulation integration;
then use 3-4 to guide fidelity/bot tuning. Items 6-9 are focused follow-through,
with map expansion gated on rights and package quality. A future status index
should link historical findings to superseding evidence, rather than erasing
dated reports. This audit leaves those source documents unchanged.
