# Dust2 Prefire Source Crosscheck

Research handoff, 2026-10-10. No runtime, routes, schema, existing datasets, or UI edits. No additional independently authored, redistributable hold-coordinate dataset was cleared. The actionable additions below are **unused indices in the two already licensed datasets**, not a third coordinate source. Guides corroborate coverage, never numeric hold frequency.

## Integrate First

All `profile/index` references mean `openprefire:profile/index` at the pinned revision below. Indices are one-based angle records, not physical text-file line numbers. `retakes:dust2/index` refers to the existing pinned retakes bundle. Keep original XYZ, rotation, and stance. Descriptive regions below are local crosschecks; upstream OpenPrefire records have no callout names.

`C` = native placement, spawn upper-body extrema cover, sampled walking-path head visibility, and >=40-unit same-floor path separation passed the existing candidate audit. **C does not certify dense cover, 64-unit margin, first-32 movement protection, or head LOS in both player stances.** Parent owns those final gates and `route.alternatives` integration. `W` = additional retakes inspection passed native placement, center extrema cover, and later authored-waypoint head visibility only.

| Priority | Missing Coverage / Exact New IDs | Existing Approach Evidence | Recommendation |
| --- | --- | --- | --- |
| P0 | Closet-side close-right B: `b_tunnel/26` crouched, `/27` standing | C: `b-tunnels`, `b-backsite`; `/27` also B-door variants | First genuine new close-pocket choices. Same corner: do not spawn both or inflate prevalence by counting source variants. STYKO explicitly discusses close holds on either side of tunnels [S]. |
| P0 | Deeper close-right B: `b_tunnel/21` crouched | C: `b-tunnels`, `b-backsite`, `b-doors`, `b-door-detail`, `b-site-retake`, `b-retake-boxes` | Distinct deeper pocket. Use descriptive labeling until the precise closet boundary is confirmed in the current 3D view. |
| P0 | Elevated near-tunnel box: `b_tunnel/22`; high near-exit box: `/20`, both standing | C: the same six B approaches as `/21` | Useful box-top changes supported qualitatively by [S]. **Do not label either as B site double-stack**: these are near the tunnel exit, not the back-site stack. Preserve their different heights. |
| P0 | B site stack/elevated site box: `retakes:dust2/13` | W: `b-doors`, `b-retake-boxes`; head-visible waypoint indices 4, 5, 8, 9, zero-based | Exact source XYZ `[-1589.59, 2758.31, 65.03]`, rotation `[0, -68.12, 0]`, standing. Native support adjustment was -0.030 units. No head-visible waypoint found on current `b-tunnels`; do not assume that approach can clear it. This is authored **T postplant** data, not measured CT use. Stack-region naming is consistent with the independent radar [Y], but precise double-stack naming needs current 3D confirmation. |
| P0 | Catwalk edge: `mid_to_b/13` standing | C: `ct-mid-push`, `lower-tunnels`, `lower-detail`, `upper-detail` | A genuinely omitted catwalk viewpoint. `a_short/3` is a near alternative about 50 units away; prefer one representative/exclusion group rather than two coverage tickets for the same pocket. [D1] explicitly calls for checking close catwalk, but is legacy tactical evidence. |
| P0 | Second catwalk position: `mid_to_b/14` standing | C: `lower-tunnels`, `lower-detail`, `upper-detail` **only** | Not a coarse candidate for current `ct-mid-push`. Add only to an approach that passes the parent's stronger gates. |
| P0 | Lower back-wall/floor: `mid_to_b/11`; lower entrance/front-wall: `/15`, standing | C: `ct-mid-push`, `mid-doors`, `mid-lower-check`, `lower-tunnels`, `lower-detail`, `upper-detail` | Distinct unused lower checks. Course direction/holder side must stay explicit: CT-mid push/lower clearing uses T preplant evidence; a T approach into CT uses CT evidence. |
| P1 | Outside-long anti-push: `ct_push_mid/17`, `/18`, `/20` (the latter crouched) | C: `ct-mid-push` | First additions beyond its existing five top-mid/cat/Xbox/long targets. `/17` and `/18` are standing. They cover T-side approach corners, not a newly proven main T-spawn sniper position. |
| P1 | Rear outside-long wall: `ct_push_mid/15`, `/16`, crouched | C: `ct-mid-push` | Useful authored anti-push alternatives. Facing/stance differ from an open-standing default; preserve both. Independent guide support is regional, not exact-point popularity. |
| P1 | B closet retake alternative: `retakes:dust2/15` | W: `b-tunnels`, `b-doors`, `b-retake-boxes` | XYZ `[-1672.21, 1620.03, 2.53]`, standing; only about 36 units from `b_tunnel/27`. One closet family, not an additional common-angle region. Prefer T postplant B-door use; assigning a CT training role must not inherit T statistics. |
| P1 | B back-box floor: `b_tunnel/24` standing | C: `b-doors`, `b-door-detail`, `b-site-retake`, `b-retake-boxes` | Back-site floor alternative to existing box/platform samples. Not present in the current tunnel-entry candidate set. |
| P2 | B default gap: `mid_to_b/41` standing | C: `b-tunnels`, `b-backsite` | Alternate near the already active `mid_to_b/46`, about 51 units away. Same-family variation, not genuinely new coverage. |
| P2 | A front-site alternative: `retakes:dust2/17` | W: `long-a`, `short-a`, `a-retake`, `a-retake-boxes` | XYZ `[1235.97, 2460.97, 97.9]`, standing. Front/default-box variation, **not ninja or elevator**. Retakes provenance is T postplant. |

Grouping order: B close pockets/box tops; CT-mid push catwalk/lower; CT-mid push outside-long; B-door stack/back-site retake. Leave Learn's canonical five unchanged. Weighted mode can draw from each validated larger pool while retaining its actor limit. Keep spatial duplicates and same-corner stance variants mutually exclusive. The parent's new 96-XY/24-Z unique-round local `n/d` plus one coverage-ticket policy and default four requested opponents are separate statistical/training policies; no guide claims should enter `n` or `d`.

## Explicit Gaps And Rejections

| Requested Region | What Exists / What Is Missing |
| --- | --- |
| Elevator / under A | Reject `a_long/26`, `a_short/17`, `a_short/20`: all fail current native support/hull placement. These are plausible regional leads, **not usable elevator coordinates**. No horizontal nudge, floor snap, or improvised replacement. |
| Ninja | No exact, native-valid, newly sourced ninja record was verified. Existing `a_long/21`, `a_short/14`, and `retakes:dust2/21` are labeled back-box/platform in this app; do not rename one ninja to claim coverage. Need a separately authored current-build point or a licensed creator export. |
| A boost / box-top | Existing `a_short/11` and `/14` already supply elevated box samples. Their upstream source does not name a boost. Additional boost-specific coverage needs verified support and a labeled source; no stacked-player mechanics were investigated. |
| Deep pit | Already active: `a_long/13,14,16,18`; unused `a_short/31` is a pit-platform/lip variation, not a new deep-pit region. `a_long/17` fails native placement. |
| Top mid | Already active: `ct_push_mid/1,3,11,12,13`. `mid_to_b/16` is only about 53 units from `/1`; `ct_push_lower/1,3` duplicate `/1,3` exactly. `ct_push_mid/2` and `/14` fail native placement. No new distinct supported sniper/palm/T-spawn point was established. |
| Main T spawn / deep T ramp | `ct_push_mid/19` is C-visible from `ct-mid-push`, but has weak common-hold corroboration; keep low priority. `ct_push_mid/22,23` fit native geometry but are not reachable/covered candidates on the audited current approaches. `ct_push_lower/23,24` are C-visible late from lower variants and may support a separate upper-to-T-side flank course; mere distant visibility is not a recommendation to add them to short lower clearing. |
| B window boost | `mid_to_b/28,29,33` are C candidates from `b-door-detail`; `/28` and `/29` also from mid approaches. Native height/floor changes matter. They are window-area samples, not evidence of an unmodeled two-player boost. Window coverage already exists. |

## Cross-Source Coverage

Quality is qualitative: **strong** = independent contemporary creator/coach explicitly discusses the holding family plus a usable authored point; **regional** = contemporary area/path relevance only; **legacy** = old tactical concept, not current map geometry; **lead** = metadata/marketing without inspected exact holds. No rating represents a measured frequency or confidence percentage.

| Family | Licensed Coordinates | Independent Corroboration | Quality / Remaining Boundary |
| --- | --- | --- | --- |
| B close-left/right, closet-side | [O] `/21,26,27`; [R] `/15` | [S] 0:46-1:03 recommends close tunnel holds on either side; [Y] labels Closet, Tunnel, Jump Box | Strong family evidence; exact per-point closet label and popularity unmeasured. [R] is another authored configuration, not a match sample. |
| B box-top / stack | [O] `/20,22`; [R] `/13` | [S] 1:03-1:11 discusses box-top play; [Y] distinguishes Jump Box and Stack | Strong box-top family; tunnel-entry boxes and site-stack must not be conflated. |
| B platform / site / car | Already active [O] and [R] back-platform/site points | [S] 0:11-0:18 and 1:13-1:42; [D1] discusses clearing back platform | Strong family evidence. Most of this is already covered; add variety, not a false missing-region claim. |
| Catwalk / lower | [O] `mid_to_b/11,13,14,15` | [F2] explains Xbox and mid-to-B sightline relevance; [Y] labels Cat, Lower, Stairs; [D1] explicitly checks catwalk/lower pressure | Regional contemporary plus explicit legacy tactical corroboration; exact modern prevalence unverified. |
| CT-mid push / outside-long anti-push | [O] `ct_push_mid/15..20` | [D1] discusses an outside-long/top-mid lurker denying pushes; [D2] discusses CT-mid aggression; [V] exposes Long, Short, Mid/B chapters only | Legacy explicit motivation plus contemporary chapter-level coverage. Do not claim [V] verifies these exact points: transcript unavailable. |
| Long / pit / car / A ramp | Existing [O] samples | [F2] Long and CT-cross sections; [D3] names pit/car/ramp/goose; [Y] area labels | Regional current / legacy specific. No new deep-pit source accepted. |
| Ninja / elevator / A boost | Partial existing A-box samples only | [Y] separately labels Ninja, Elevator, Boost | Naming evidence only. Ninja has no newly verified point; likely elevator records are rejected. |
| Variable same-approach pool | [O] authored positions, parent-authored walking courses | [F1] creator explains randomized positions within an arena/path | Independent training-design corroboration, **not occupancy statistics or coordinate-export permission**. |

## Source Register

| ID | Primary Source / Revision | Rights And Permitted Role |
| --- | --- | --- |
| O | [lengran/OpenPrefirePrac, `44fb66eab70fb3b1b7112ed3c30cc68fb977dd26`](https://github.com/lengran/OpenPrefirePrac/tree/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26/maps/de_dust2); [pinned MIT notice](https://raw.githubusercontent.com/lengran/OpenPrefirePrac/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26/LICENSE) | MIT; retain full copyright/permission notice. Six profiles, 202 records. Author-collected practice coordinates, not competitive hold statistics. Imported bundle already retains per-file SHA-256. |
| R | [B3none/cs2-retakes, `2fde4a9cc21e791d6909b98bacc833aa5c54bdad`](https://github.com/B3none/cs2-retakes/tree/2fde4a9cc21e791d6909b98bacc833aa5c54bdad); [pinned Dust2 file](https://raw.githubusercontent.com/B3none/cs2-retakes/2fde4a9cc21e791d6909b98bacc833aa5c54bdad/RetakesPlugin/map_config/de_dust2.json) | Existing bundle/license notice: GPL-3.0. Preserve it and source attribution. 27 authored retake spawns, not statistics. Unused `/13,15,17` require no new importer. |
| S | [STYKO, How to Play B on Dust2 in 100 Seconds](https://www.youtube.com/watch?v=8IXNR00pYqo), immutable video ID `8IXNR00pYqo`; public CS2 video, timestamped English auto-captions inspected | No coordinate/data redistribution grant found. Cite and paraphrase the inspected family-level advice only. Captions occasionally misrecognize words; no numeric XYZ was extracted or inferred from footage. |
| F1 | [Refrag / simba, Angle Trainer](https://refrag.gg/blog/refrags-angle-trainer-level-up-your-cs2-crosshair-placement-pathing/), 2024-08-27 | Primary creator explanation of random arena positions/pathing. Proprietary product, no exported coordinate license found. Article date/URL plus access date identify the reviewed text, not an immutable content revision. |
| F2 | [Refrag / Samuel Allen, Dust2 Utility Secrets](https://refrag.gg/blog/cs2-utility-secrets-5-must-know-nades-for-dust2/), 2025-03-06 | Primary contemporary Dust2 area/sightline guidance. No numeric frequency or coordinates imported. Same organization as F1: count as **one** independent source family. |
| Y | [Yesber / Yprac, CS2 radar callouts](https://yprac.com/cs2-callouts-guide-radar-overviews), exact linked Dust2 diagram visually inspected | Primary practice-creator naming corroboration. No reusable-data/art license found. Do not bundle the radar or infer exact pawn-foot XYZ from its pixels. Public page gives 4 Feb without a reliably pinned year/revision. |
| D1 | [Dignitas / tam0w, The Xizt Call](https://dignitas.gg/articles/strat-talk-the-xizt-call-dust-2-ct-mid-to-b-guide), 2020-05-06 | Primary team-published tactical guide, **CS:GO legacy**. Only durable region/clearing concepts used; no old coordinates, utility lineups, geometry, or reported success claims transferred. |
| D2 | [Dignitas / homebound, CT Mid Aggression](https://dignitas.gg/articles/unexpected-aggression-pushing-middle-on-de_dust2-as-a-ct), 2017-11-13 | Legacy personal tactical guide, not a modern coach measurement. Ignore its anecdotal percentages completely. Same organization as D1/D3, not three independent corroborations. |
| D3 | [Dignitas / JKC, CT Defense](https://dignitas.gg/articles/a-guide-to-ct-side-defense-on-dust-2), 2015-12-06 | Legacy authored setup guide. Supports only broad pit/car/ramp/goose/platform vocabulary and historical tactical relevance. Old boost geometry is not accepted. |
| V | [voocsgo, You're STILL Playing Dust2 WRONG](https://www.youtube.com/watch?v=AcQGOr9rC9k), video ID `AcQGOr9rC9k` | First-party CS2 guide found through the verified channel. Long/Short/Mid-B chapter names inspected; transcript unavailable. Discovery/chapter evidence only, not exact-angle corroboration. |

OpenCS2 remains the separate observed-demo source described in `prefire-statistics.md`, pinned to `8d7deddcd30c081fb197b75f58b4a0fba1117b9d`. Its declared metadata CC BY 4.0 and unresolved underlying tournament-demo rights remain qualified. Neither its regional centroids nor any guide/Workshop bot count is a pawn spawn or population hold probability.

## Additional Source Leads, Not Imports

| Lead | Revision / Licensing Result | Action |
| --- | --- | --- |
| [lmtlss / leander Dust 2 Prefire, Workshop `3295650711`](https://steamcommunity.com/sharedfiles/filedetails/?id=3295650711) | Creator description advertises 240 possible dynamic bot positions. Posted 2024-07-23; inspected listing says updated 25 Sep, 15 change notes. No immutable coordinate manifest, explicit reuse license, or verified ancestry found. | Best permission-request lead for labeled current-build common-angle exports. Do not decompile/copy Workshop point tables. 240 is authored pool size, not 240 observed common holds. |
| [5EPlay / 7ychu5 / Ba1eno, Workshop `3244203953`](https://steamcommunity.com/workshop/filedetails/?id=3244203953) | Primary description: eight breakthrough/defense routes; posted 2024-05-11, inspected update label 26 Apr, 32 change notes. No coordinate reuse grant found. | Request explicit permission plus labeled export/revision. Independent creator material at route level only; source-point independence not proven. The fetched Steam pages include compatibility/removal boilerplate, so they are not evidence of current native-map compatibility. |
| [Dust2 Holding creator post](https://www.reddit.com/r/GlobalOffensive/comments/1unz1h7/promting_dust2_holding_training_workshop_map_and/) / [CS2-holding-map repository](https://github.com/lijhbigviyvfyhg/CS2-holding-map) | Creator describes recorded bot movement paths. Public root inspected: template/examples/scripts, default Nuke example, no license grant visible. Immutable commit could not be retrieved in this run. | Permission/unverified lead only; neither a cleared Dust2 static-hold dataset nor measured competitive movement/occupancy evidence. Do not execute its tools. |
| [a2Labs SwiftlyS2 Retakes](https://github.com/a2Labs-cc/SwiftlyS2-Retakes) | README explicitly credits **all spawns as based on B3none/cs2-retakes**. | Not independent coordinate corroboration. Same applies to unmodified OpenPrefire forks. |
| [CounterStrike2MapLocationDataset](https://github.com/Programming-with-Julius/CounterStrike2MapLocationDataset) | August 2024 Source 2 Viewer screenshot samples; documentation includes jumping/boosted locations. No suitable static-hold provenance/reuse clearance established. | Not common hold coordinates or observed hold statistics; rejected for this task. No large download. |
| [CS2-Spawns](https://github.com/sneakybikimeh/CS2-Spawns) | Official round-start teleport positions, not holding-angle records. | Not a solution for missing common holds. No config/scripts executed or imported. |

## Native Audit Record

The pre-integration snapshot had 24 routes and **103 distinct active OpenPrefire IDs + 10 retakes IDs** at runtime, whereas the earlier handoff/document said 106 + 10. Counts and unused status are snapshot-specific; re-deduplicate through `prefireCandidates(route)` after parent integration.

- Complete read-only `node tools/audit-prefire-candidates.mjs` run: all 24 routes emitted, exit 0; no `--save`. Existing `research/dust2/prefire-candidates.json` contained only eight earlier approaches, so it was not treated as current 24-course evidence. Audit JSON rounds XYZ for printing; use the original dataset values when integrating.
- Current collision build `2000927`, collision SHA-256 `395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396`. Native support corrections stay within six Source units; no target was relocated.
- Before parent took over sibling auditing, a read-only dense check finished Long doors and Long-to-A. It checked both target body envelopes, all spawn-eye samples, nine +/-64-unit spawn offsets, and every <=32-unit initial walking sample. Remaining duplicate work was stopped at the user's request. No other course is claimed dense-verified here.
- Long doors, spawn `[615,188,1]`: `a_long/1..11,13..16,18` and `a_short/31` passed. The unused `/15` and `/31` are lower-priority ledge/platform variants, not new core regions.
- Long-to-A, spawn `[1734,902,-11]`: unused `a_short/26,28,29,30`, `mid_to_b/26` passed the above dense gates. `/26` physically duplicates already active `a_long/27`; `/29` is near the Goose family. Rejected at 64-unit extrema margin: `a_long/22,24`, `a_short/19,24,25`, `mid_to_b/32`. Do not transplant them from sibling courses with revised starts.
- Source-placement inspection independently rejected the elevator-region records listed above, plus `a_long/12,17`, `a_short/12,27`, `ct_push_mid/2,14,24`. Native-valid but uncovered/unreachable samples remain distinct from placement failures.
- Additional `/13,15,17` retakes results are W-level only. Parent must still check dense 64 margin, first-32 protection, head LOS from standing/crouched player views, overlap/exclusion, and source-facing behavior before enabling them.

Routes snapshot SHA-256: `2cb699acd454800fcfaeb8ca3d3d4572598e05b8eb6174d6e60f007aef2c353d`; OpenPrefire bundle SHA-256: `d27958364b642d52af0a31847d488556146fa04b5c309ec50f90368e96de39de`; retakes bundle SHA-256: `a7e620bbceb52599d651ad06227f4408a9b8681e834b4a2a43e7bb2a58e52e55`. New approaches/revisions require new validation, regardless of these older pass results.

Repository validation: `npm run build` passed, retaining the large-chunk warning. `npm test -- --run` could not execute tests: all 129 suites failed during import with `EPERM` renaming Vitest's temporary SSR transform-cache files. This is not a passing test result or an assertion failure. No runtime/tooling fix or deployment was attempted. Document table-column/ASCII checks passed.

[O]: https://github.com/lengran/OpenPrefirePrac/tree/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26/maps/de_dust2 "Pinned MIT practice coordinates"
[R]: https://raw.githubusercontent.com/B3none/cs2-retakes/2fde4a9cc21e791d6909b98bacc833aa5c54bdad/RetakesPlugin/map_config/de_dust2.json "Pinned GPL retake placements"
[S]: https://www.youtube.com/watch?v=8IXNR00pYqo "STYKO's CS2 B-hold guide"
[F1]: https://refrag.gg/blog/refrags-angle-trainer-level-up-your-cs2-crosshair-placement-pathing/ "Refrag's randomized arena/path design"
[F2]: https://refrag.gg/blog/cs2-utility-secrets-5-must-know-nades-for-dust2/ "Refrag's Dust2 sightline guidance"
[Y]: https://yprac.com/cs2-callouts-guide-radar-overviews "Yesber's independent callout diagram"
[D1]: https://dignitas.gg/articles/strat-talk-the-xizt-call-dust-2-ct-mid-to-b-guide "Legacy Xizt-call tactical coverage"
[D2]: https://dignitas.gg/articles/unexpected-aggression-pushing-middle-on-de_dust2-as-a-ct "Legacy CT-mid push concepts"
[D3]: https://dignitas.gg/articles/a-guide-to-ct-side-defense-on-dust-2 "Legacy broad defensive families"
[V]: https://www.youtube.com/watch?v=AcQGOr9rC9k "Voo CS2 guide, chapter-level evidence only"
