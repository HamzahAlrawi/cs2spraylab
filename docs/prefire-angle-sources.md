# Dust 2 Prefire Angle Sources

## Current Coverage Follow-up

October 19 coverage-v7 has 160 identities / 213 approach assignments. Nine local
Pit/car/A-site/Ninja holds and a covered Catwalk entry are documented in
[the coverage-v7 audit](prefire-requested-coverage-v7.md). Original imported
coordinates remain unchanged. Local positions do not claim upstream or measured
popularity provenance.

October 18 coverage-v6 had 149 identities / 186 approach assignments, including
an explicitly recorded standing adaptation of the original CT-box crouch sample.
See [the CT/site coverage audit](prefire-ct-site-coverage.md) for the added IDs,
native exposure tests, four focused lineups and unchanged rejection gates. Counts
in the historical coverage sections below describe their earlier revisions.

## Primary Source

Static training positions are adapted from [lengran/OpenPrefirePrac](https://github.com/lengran/OpenPrefirePrac), revision [`44fb66eab70fb3b1b7112ed3c30cc68fb977dd26`](https://github.com/lengran/OpenPrefirePrac/tree/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26/maps/de_dust2). This is an MIT-licensed practice project. Its author documents collecting positions through CS2's `getpos` command, converting standing eye height to pawn-foot coordinates, and recording whether a target crouches.

The six profiles contain 202 position/rotation/stance samples. The catalog exposes ten distinct walking approaches. The former 24 five-position clearing sets / 120 slots are retained as fixed lineups inside those approaches: 103 distinct OpenPrefire source indices plus 10 cs2-retakes source indices, with some reused across lineups. (The earlier 106-index figure was a counting error.) Weighted pools expose 141 distinct source identities: 128 OpenPrefire and 13 retakes, across 165 approach/hold assignments. The coverage revision adds 11 identities / 22 assignments to the prior 130 / 143 release. Per-approach pool sizes range from five to 27, still spawning at most five opponents. Source identities are not necessarily unique physical points across profiles. Positions and rotations are copied without rounding, horizontal relocation, or height normalization. Individual angles retain their dataset/profile name and one-based source index. Local callout labels describe the selected position; the source files do not provide callout labels.

## Additional Source And Frequency Evidence

[B3none/cs2-retakes](https://github.com/B3none/cs2-retakes/tree/2fde4a9cc21e791d6909b98bacc833aa5c54bdad), pinned to `2fde4a9cc21e791d6909b98bacc833aa5c54bdad`, supplies 27 authored Dust 2 retake spawns. Thirteen collision-validated T post-plant holds are used for A/B site-box clearing, including the elevated B site box, closet alternative and A front-site `/17`. Its GPL-3.0 notice is included in `data/Retakes.LICENSE.txt` and the deployed Angle sources disclosure; this repository is already GPL-3.0. These are retake configurations, not measurements of competitive position popularity.

[OpenCS2](https://huggingface.co/datasets/blanchon/opencs2_dataset/tree/8d7deddcd30c081fb197b75f58b4a0fba1117b9d) supplies observed demo-tick holds, not spawn coordinates. Thirty-two matches / 256 rounds / 2,560 POVs yield 8,118 low-speed firearm episodes, replacing the earlier eight-match subset. Separate CT/T and preplant/postplant layers inform relative sampling weights. Metadata is declared CC BY 4.0; original tournament-demo rights have not been independently cleared. Full attribution, hashes, selection rules, anomalies and limitations are in `prefire-statistics.md`.

Displayed evidence still unions distinct observed round identities within 96 Source units horizontally and 24 vertically, for the route's enemy side and pre/post-plant phase. Repeat stops and multiple nearby cells in one round do not inflate support. The panel's `n / eligible sampled rounds` and supporting/sampled match counts are unchanged. These are broad centroid-neighborhood observations, not enemy-present percentages.

Selection now uses `match-balanced-regional-coverage-v1`: **50% uniform physical-family coverage / 50% match-balanced nearby hold support**, recomputed over the feasible families at each draw. The evidence component averages each sampled match's supported-round fraction, including zero-support matches. Fifty percent is a deliberately conservative training allocation, not a fitted coefficient, calibrated confidence level, or popularity estimate. It limits how much uncertain regional evidence can dominate newly sourced or unknown holds. Without support, selection is uniform across families. `holdingEvidence().weight` retains the old `1+n` diagnostic for compatibility; it is no longer the sampling input. `PREFIRE_WEIGHT_POLICY` exports the current label and interpretation for parent-owned UI integration.

Weighted practice uses a native-validated pool of holds from compatible clearing-course variants rather than only five learning samples. The player chooses **Bots per run**, from one to five (default four). Weighted sampling is without replacement and excludes overlapping/mutually exclusive positions; feasibility checks preserve the requested count when enough compatible candidates exist. **Fixed lineup** exposes the compatible old five-position sets without duplicating the walking approach. This replaces the earlier independent `.55` binomial count draw and episode-smoothing weights. Kill-coordinate heatmaps are not substituted for holding statistics.

Same-pocket variants share one family weight: union their broad round keys before computing match-balanced support. Split that family share with the same half-uniform/half-support rule across its variants; only one can spawn. Adding another source record cannot multiply a corner's coverage tickets. Explicit additional families cover tight-car duplicates, the short-ramp edge, the Goose back-wall alternatives, close Top Mid and close catwalk. Family labels describe authored training exclusions, not measured tactical equivalence or joint opponent setups.

See `prefire-source-crosscheck.md` for the independent STYKO, Refrag, Yprac and team-guide coverage review, exact unused source indices, failed elevator placements, unsourced ninja gap and rights restrictions. No guide or Workshop position count contributes numeric observations to the telemetry.

The 2026-10-11 follow-up in `prefire-evidence-followup.md` reviews independent datasets and their access, overlap and rights limitations. CounterStrike-1K is a promising separate corpus but carries noncommercial restrictions; it has not been imported. The prior local-pocket diagnostic found reductions in 33 of 143 assignments. Centroid filtering still cannot certify original observations or condition them on route arrival, facing or tactics, and is **not used by the revised sampling policy**. The regenerated report pins geometry helpers/source hashes and compares the old ticket rule with the coverage policy separately from pocket acceptance. No telemetry was downloaded or modified.

## Coverage Revision

All OpenPrefire indices below use the existing pinned revision. The starts/paths and 24 old lineups remain intact.

| Approach | Existing Relevant Coverage | Newly Admitted Assignments |
| --- | --- | --- |
| Long corner to A | Car `a_long/19,20,27`; site `a_long/21,23,24,25,34,37` | `a_short/19,25,26,28,29`; `mid_to_b/26,32` |
| Catwalk to A | Stairs/platform `a_short/8,9,10,13,14,15,16`; boxes/Goose `/11,18,25`; close `a_long/38` | `a_short/19,26,28`; `mid_to_b/26`; `a_long/37` |
| CT ramp to A retake | Default, Goose, Long ramp/car, Short edge; five retakes site points | `a_short/25,28,29,30`; `mid_to_b/26`; `retakes:dust2/17` |
| CT push / mid to top mid | `ct_push_mid/1,3,11,12,13,15,16,17,18,20`; lower/cat `mid_to_b/11,13,15` | `mid_to_b/16` close-Top-Mid variant; `a_short/3` close-catwalk variant |
| Outside Long to pit | Existing pit platform/edge/deep holds | `a_long/15`; `a_short/31` ledge/platform alternatives |

Truly absent source IDs in the previous published pools were `a_long/15`,
`a_short/3,26,28,29,30,31`, `mid_to_b/16,26,32`, and `retakes:dust2/17`.
Some are near variants, not new regions: notably `a_short/26` duplicates tight
car `a_long/27`, and `mid_to_b/16` is near `ct_push_mid/1`.

Remaining gaps are explicit, not repaired: `a_short/3,5,6` fail Catwalk-to-A's
64-unit covered start; `/30` fails Long-to-A's covered start; `/29,30` have no
standing head shot on Catwalk-to-A; `ct_push_mid/21,22,23` have no standing head
shot on CT-mid push. `/26` fails the A-retake covered start. The broader Short
start search did not produce a proven covered/connected replacement and was
not integrated. Invalid elevator coordinates and the unsourced ninja gap remain
as recorded in `prefire-source-crosscheck.md`. No invented coordinates or XY
nudges were used to close these gaps.

## Adaptations

- Walking segments are authored locally and tested against the installed Dust 2 world collision. They are not claimed to reproduce the upstream full courses, which use larger rotating bot pools.
- At most five enemies are loaded per segment. This preserves the shared rendering/simulation actor budget.
- Sampled stance is applied on spawn and held throughout the segment. Crouched heads are tested at their actual crouched height, not at standing height.
- A small vertical support correction of at most six Source units is permitted. Horizontal nudging, changing floors, and accepting blocked hulls are not permitted for targets. Unsupported samples from this map revision are not selected.
- Optional moving holders retain the sampled anchor and use only excursions that pass native standing/crouched hull and continuous support checks. Full-speed angle takes commit to the firing endpoint; periodic information checks require a genuinely concealed endpoint. This is local training behavior, not recorded player AI. Angle-specific behavior and weighted occupancy are the fresh-visit defaults; saved settings are retained.
- Native collision tests walk every segment and resolve actual physical head shots against every selected angle. Stationary holders are then advanced through two seconds of the shared actor motor to check support and stance.

## Files And Reproduction

- `src/range/prefire/data/openprefire-dust2.json`: pinned source data and per-file SHA-256 fingerprints.
- `src/range/prefire/data/OpenPrefirePrac.LICENSE.txt`: complete upstream copyright, permission notice and disclaimer.
- The same complete notice is embedded in the deployed coordinate bundle and available under the drill's **Angle sources** disclosure.
- `src/range/prefire/data/import-openprefire.mjs`: regenerates only the static coordinate dataset and license from the pinned revision.
- `src/range/prefire/routes.ts`: active angle selections and locally authored walking segments.
- `src/range/prefire/data/dust2-weighted-pools.json`: admitted source identities per approach, pinned to the collision checksum.
- `tools/build-prefire-pools.mjs --save`: regenerate pools offline from exact proposed source points, dense standing/crouched start silhouettes, 64-unit cover margins, the protected first 32 units, both walking stances, full-speed actor steering and standing-view head reachability. The manifest records approach starts/paths so stale geometry validation fails tests. Crouched walking need not provide a head shot at every elevated hold; the player may have to stand, as in the native geometry. Targets that would block the walking path before a hittable head are rejected.
- `tools/audit-prefire-hold-pockets.mjs`: diagnostic only; does not replace the evidence artifact or feed its centroid acceptance into sampling. Includes first-draw policy comparisons on the current pool, not inclusion probabilities.
- `docs/prefire-map-case-study.md`: improvement history, required next-map gates and final integration results.

Run `node src/range/prefire/data/import-openprefire.mjs` to reproduce the dataset. This does not install a CS2 plugin or control CS2. Only offline coordinate data is used in the browser trainer.

Authored coordinates identify useful holds; bounded telemetry supplies exploratory relative regional weights, not exact per-angle competitive probabilities. Native geometry and animated bot hit capsules are checked separately; the browser does not reproduce Valve's complete server engine.
