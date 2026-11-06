# Map Onboarding And Release Acceptance

This is the canonical admission procedure for **every new native map**, across
Prefire, real-map AI Duel and Sound Awareness. A catalog is not a completed map.
Importing native geometry is not evidence of identical Source 2 runtime behavior.
The existing [authoring guide](prefire-map-authoring.md),
[Dust 2 case study](prefire-map-case-study.md) and
[package contract](native-map-packages-2026-10-30.md) provide implementation detail;
this document determines when the work is ready to expose to players.

## 1. Draft First, Coverage Before Coordinates

Register a lazy descriptor in `src/range/prefire/maps/` with
`onboarding: {state: 'draft', note: '...specific remaining work...'}`. Production
map selectors and runtime `get/loadCatalog` reject drafts. Offline tools use
`forAuthoring/loadCatalogForAuthoring`. Do not add another legacy exception.
Tests that deliberately register synthetic maps can use an isolated registry.
The dedicated offline bot audit and synthetic map-switch browser fixture use
Vite test mode to exercise draft entries without granting production approval.

Author a whole-map area/approach/pocket brief **independently of the existing
spawn list**. A checklist generated from the current coordinates cannot discover
missing coordinates. Cover each bombsite, entrances, transit lanes, elevation,
defender rotations, post-plant/retake directions and plausible off-angles. Then
map each pocket to the routes from which it should be trained. A hold valid on
one approach is not automatically safe on another.

For each required pocket retain: callout, side/phase, approach, source citations,
standing/crouched/head-only/left-half/right-half visibility, hold or peek rationale,
and reviewer decision. Accepted pockets must map to real catalog angle IDs.
Excluded pockets need an explicit reason and references. Pending pockets block
approval. Every live approach/hold must be covered. A reviewer signs the **scope**
of the independent brief, not only a list of coordinates that already exists.

Use at least two genuinely independent reference groups per area. Mirrors,
forks and multiple pages quoting one coordinate pack count as one group. Useful
roles are native geometry, licensed prefire coordinates, expert/pro VOD angle
reviews, and licensed complete-round tick data. Pin source revision, rights,
provenance and extraction method. Do not introduce a new map by copying Dust 2's
behavior-key strings; new angle IDs start with `<mapId>:` and coordinate dataset
names must be explicitly map-scoped (not the legacy bare `openprefire`).

## 2. Native Source Manifest

Record installed game build, resource/module SHA-256, archive/resource paths,
extractor version/commit, commands and field/code locations. Record coordinate
transform, orientation, units, surface tables and separate movement/shot/grenade
collision masks. Include a reference-capture index from the same native build.
The plan's `native` block requires these fields; unknown values stay unresolved.

Only inspect static files or isolated offline arithmetic. Never attach to CS2,
read process memory, run game DLLs or infer readiness from a sound marker.
Distinguish extraction facts, active code paths, native arithmetic fixtures,
measured gameplay and trainer approximations. If the installed build differs,
compare actual resource hashes before reusing old evidence. No old SDK/convar
substitution without an explicit unresolved fidelity note.

Export exact collision first. Native geometry owns scale; never fix aim or
movement by resizing players/maps or shifting shots. Keep art, collision,
navigation, acoustic paths and radar in the same Source coordinate frame.
Keep generated media local/ignored; publish source, metadata, hashes and recipes,
not Valve assets. A new map still needs its own extraction adapter; this workflow
does not make the old Dust 2 importer a universal map extractor.

## 3. Geometry, Collision And Utility Matrix

Review the full map and every chunk, not just selected routes:

| Area | Required observations |
| --- | --- |
| Visuals | Native reference views at fixed landmarks/yaws/FOV; material coverage, alpha fences, doors, stairs, prop pivots, light transitions, roof/void leaks, z-fighting and chunk context. Missing materials are failures, not magenta placeholders. |
| Movement | Full-speed forward/diagonal/reverse, both stances, jump-crouch and landing across ramps, stair lips, doorframes, ledges and props. Include standing clearance and unclipping. Compare complete trajectories with native captures, not constants alone. |
| Contact/audio | One grounded locomotion sequence on ramps/stairs; no repeated landing or 5x footstep spam. Check CT-like height transitions, material boundaries and tunnels. |
| Shots | Shared native collision mask, reference occluders and thin/alpha surfaces, physical impact coordinates. Head rays and rendered bone hitboxes must agree at close/long range and both stances. No recoil compensation or enlarged hitboxes to mask a map mismatch. |
| Utility | Independently captured throw setups against floors, steps, corners, slants, rails, playerclip and grenade-only clip; both elevations, jump/crouch throws, bounce planes, blast/flash cover, smoke openings and fire spread. A visual match does not certify grenade collision. |
| Chunks | Preserve exact combat geometry, all playable exits/edges and required background context. Artificial chunk limits must be outside the encounter and must not create invisible cover. Test both directions across connectors. |

Native source geometry that is unsupported by the trainer must be recorded as a
gap and blocks the affected acceptance case. Do not silently replace it with a
box and call that native collision. The automated route audit checks trainer
hulls against extracted geometry; it is **not** a CS2 trajectory comparison.

## 4. Routes, Starts And Bot Holds

Choose landmark starts that lead naturally into a clearing exercise. No arbitrary
hidden cupboard, immediate enemy silhouette or backwards-facing spawn. Verify
standing/crouch/transition views and an initial protected 32 Source units of
movement. The offline audit uses dense silhouette samples plus the shared
full-speed actor motor, not a teleported camera or a slow sweep alone.

Keep sourced horizontal coordinates exact. The shared placement helper permits
only its bounded local support correction; reject unsupported/wrong-floor holds.
Every pooled alternative, not only the default lineup, needs an actual approach
head-shot lane. Record shoulder/head-only exposure and reasonable peek/retreat
lanes. Alternatives in one physical pocket need exclusion groups and hull-safe
multi-bot reservations. Distinct rosters belong in lineups, not duplicate routes.

Bot review must include every individual hold and each route at skill 1/5/10,
one/three/five bots, seeds 7 and 42. Duel layouts cover the same skill/count
matrix per chunk. These are minimum deterministic scenarios, not population
measurements. Run full-duration traversal and actual live combat, including:

- initial facing toward the covered approach, observed sound and re-peek memory;
- correct physical peek/retreat, counterstrafe, shooting readiness and LOS;
- an unobstructed enemy must not be ignored by a firing bot;
- quieter information peeks versus committed duels, appropriate to skill/weapon;
- no shoulder leakage while holding cover at high skill, foot sliding or stuck loops;
- team trade, path reservations, casualty responses and no teammate-audio confusion;
- realistic low-skill mistakes without giving every beginner advanced peeks;
- route-arrow progression, completion, repeat/advance and head-only angles.

Planning-only, filtered, shortened or non-traversed simulations are diagnostic.
Do not turn a route-completion diagnostic into a passed behavioral certificate.
Current `audit:prefire:bots` produces diagnostics and observations; it does not
automatically satisfy this full acceptance matrix. Human inspection and additional
scenario fixtures are required before issuing `bot-combat` evidence.

## 5. Occupancy Evidence Is Not Spawn Authoring

Coordinates answer *where a bot can stand*. Statistics answer *how often to show
it in a particular encounter*. Maintain separate fields and tests for each.

- `authored-coverage`: explicit training coverage priorities; no match probability claim.
- `regional-support`: nearby complete-round holding evidence with match-balanced
  denominators. It does not measure the exact corner's encounter rate.
- `measured-encounters`: complete defender snapshots at the approach arrival,
  side/phase/equipment context, raw-feet local-pocket proof, empty rosters and
  match-disjoint train/held-out data. Existing encounter validators still apply.

Do not use kill locations as player-holding frequency, nearest-cell centroids as
spawn positions, or silently label sparse professional demos as FACEIT rates.
Retain zero-support rounds, sample counts, uncertainty and uncovered pockets.
Use held-out distribution/conservation checks before upgrading a probability
claim. A statistical gap is preferable to an invented percentage.

Sound Awareness must sample continuous supported/hull-clear neighborhoods of
common pockets and routes across the whole map, not a finite random-angle list.
For each independently reviewed area, audit final **heard** positions, density
weights, close/medium/far cues, both elevations, audible range/occlusion, retries,
recent-region repetition and cooperative preparation time. Exact-float uniqueness
alone is not evidence of useful variety. Keep placement weights separate from
cue loudness and respect headphone/stereo/mono configuration.

## 6. Browser, Aim, Radar And Performance

Capture desktop landscape, narrow/mobile, ultrawide and stretched-world views.
Use native landmark/radar pairs to check origin, scale, rotation, height and
chunk clipping. Review route arrows at starts and turns, not just at the end.
Use screenshots plus physical firing tests at multiple distances to check screen
center, render pose/hit capsules, head/body visibility and impacts. No map-specific
sensitivity/recoil tuning. A screenshot by itself is not a shot test.

Performance evidence is mandatory for full map and **each chunk** under desktop,
mobile and CPU-throttled profiles. Record browser/version, hardware, DPR, quality,
throttle and measurement script revision. Check cold, warm-memory and
warm-persistent-cache starts, offline revisits, cancellation and content changes.
Capture network requests as well as bytes: a repeated unchanged chunk should
cause **zero** asset HTTP requests, including revalidation requests. Invalidated
content should fetch only changed content-addressed resources. Test cache quota
and unavailable storage without corrupting progress.

For every ordered chunk handoff (and a one-chunk self-handoff), measure at least
the first five seconds after activation. Require warm handoff **under 500 ms**,
zero warm network requests, p95 frame time <=20 ms desktop / <=50 ms mobile or
CPU-throttled, p99 <=50 ms desktop / <=100 ms other profiles. Record positive
peak resident MiB and check a bounded plateau over repeated rotations; never
preload all maps indefinitely. These are project admission budgets, not claims
about CS2. A handoff case uses the non-desktop budget unless the scope explicitly
ends in `/desktop`; attach all profile captures to the report.

Required result `measurements` keys for loading/handoff cases:
`warmNetworkRequests`, `warmHandoffMs`, `observedSeconds`, `p95FrameMs`,
`p99FrameMs`, `peakResidentMiB`. All must be finite/nonnegative. The validators
enforce the numeric minimums; reviewers still check cold-loading UX, CPU/GPU
allocation traces, bounded memory, oldest target hardware and unmeasured outliers.
Do not accept a median FPS number that hides first-round shader/texture stutter.

Mode-isolation checks include moving between range, Prefire, Duel and Awareness,
save migration, map ID namespace/cache separation, cancel/retry and fresh source-only
builds. Scoring, sounds and movement must use the selected map, never fall back
silently to Dust 2. Private media must stay outside Git.

## 7. Tools And Evidence Format

```sh
npm run maps:status
npm run maps:init -- --map=de_newmap --out=research/map-onboarding/de_newmap/plan.json
# Author and review the independent plan; extraction adapter/assets are required.
npm run maps:cases -- --map=de_newmap --plan=research/map-onboarding/de_newmap/plan.json --out=research/map-onboarding/de_newmap/pending-cases.json
npm run maps:native -- --map=de_newmap --plan=research/map-onboarding/de_newmap/plan.json --out=research/map-onboarding/de_newmap/native.json
npm run audit:prefire:bots -- --map=de_newmap --report=research/map-onboarding/de_newmap/bots-diagnostic.json
npm run maps:check -- --map=de_newmap --plan=research/map-onboarding/de_newmap/plan.json --reports=research/map-onboarding/de_newmap/native.json,research/map-onboarding/de_newmap/review.json --out=docs/map-acceptance/de_newmap/v1.json
npm run maps:test
npm run check
npm run source:check
```

`de_newmap` is a placeholder for an actually registered draft, not an included map.
`maps:native --routes=<id>` is a useful partial diagnostic, never full approval.
Outputs refuse overwrites; use revisioned files. `maps:check` fails until **all**
cases from `requiredMapCases` have exactly one passing, correctly typed result.
Failed checks print a bounded summary; `--diagnostics=<new-file.json>` preserves
the complete rejection list without creating an approval receipt.
That function is the authoritative case manifest, including all holds, routes,
chunks, skill/count/seeds, area reviews, browser profiles and ordered handoffs.

Each JSON report uses this envelope (identities come from the native report;
`dependencies` must be captured when the evidence is produced, never relabeled):

```json
{
  "schemaVersion": 1,
  "mapId": "de_newmap", "revision": "v1", "packageKey": "identity key",
  "catalogSha256": "64 hex", "planSha256": "64 hex",
  "complete": true, "findings": [],
  "dependencies": {"src/range/...ts": "64 hex"},
  "inputs": {"captures": "immutable capture index + hashes", "method": "actual test procedure"},
  "reviewer": "named human for reference/browser/source reviews",
  "results": [{
    "id": "visual-reference:yard", "gate": "visual-reference", "scope": "yard",
    "kind": "reference-review", "status": "passed", "assertions": 12,
    "note": "What was compared, tolerances, where the trace/captures are recorded"
  }]
}
```

`kind` must match `MAP_ACCEPTANCE_GATES`; do not label authored review as a native
regression. Native audits only emit the checks they actually execute; they cannot
pass materials, grenade collision, rendered aim or bot intelligence by implication.
Manual reports must index the actual captures/measurements; a hash only detects
changes, it cannot establish that an observation was honest or complete.

Successful `maps:check` saves a source-like evidence archive with exact report
bytes and a separate receipt. Import that receipt into the map descriptor with
`state:'approved'`. `npm run build` runs `maps:source`: it rechecks the plan,
case completeness, original report bytes, current implementation hashes and
catalog/package pins without requiring game media. Draft maps stay hidden.
Runtime repeats descriptor and catalog checks. This is a fail-closed development
admission process, not a signing/anti-tamper system.
Source dependency hashes and the outer text archive normalize CRLF to LF for
portable Git checkouts. Embedded report bodies, native resources and delivered
assets retain byte-exact SHA-256; no binary data is newline-normalized.

## 8. Changes Invalidate Evidence

| Change | Revalidation |
| --- | --- |
| Native map/build, masks, extraction, units, art or collision | All geometry/material/utility/trajectory/visual evidence, starts, holds, navigation/acoustics and browser playtests. Compare source resource differences first. |
| Routes, starts, holds, stance, peek policy, source/weights | Independent coverage review, all affected holds/starts, full bot matrix, occupancy conservation and Awareness distributions. Catalog SHA changes even without a revision bump. |
| Chunk bounds, packaging, texture/context/radar pins | Native chunk checks, all affected handoffs, cache/network/memory/frame traces and radar/browser references. |
| Shared movement, shots, bots, audio or rendering | Re-run/review dependent native and browser evidence. Current tooling deliberately invalidates broadly rather than retaining a stale pass. |

Never regenerate hashes over old observations and call that revalidation. Preserve
the old archive for audit and produce a new reviewed revision. Complete current
[Dust 2 debt](dust2-map-acceptance-backlog.md) before using it as a gold reference.
