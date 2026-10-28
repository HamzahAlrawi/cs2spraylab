# Dust2 Empirical Hold Statistics

This is an offline aggregate of observed low-speed player episodes with recorded firearm state from a bounded tournament-demo subset. Its primary runtime signal is unique nearby-round support: a union of cell round keys, intersected with the matching side/phase sampled denominator. It supplies descriptive regional sample frequencies and course-relative training weights, not `P(enemy present)`, exact angle popularity, FACEIT ranks, or an exhaustive map distribution. Episode, anchor, and dwell counts remain diagnostics. No game process, hooks, input automation, videos, or kill-coordinate density is used.

## Current Training Policy

The 2026-10-11 coverage revision supersedes the historical `1+n` selection rule
below, **not the published observations or importer**. Policy ID:
`match-balanced-regional-coverage-v1`. Before each compatible roster draw:

1. Union distinct supported rounds within each authored physical family.
2. Calculate `s_f = mean_matches(supported rounds in match / sampled side-phase rounds in match)`.
   Include zero-support sampled matches; do not use only supporting matches.
3. For `F` feasible families and positive total support, allocate
   `w_f = 0.5/F + 0.5*s_f/sum(s)`. With no support, use `1/F`.
4. Split each family weight among variants using the same half-uniform,
   half-match-balanced-support mixture; with no variant support, split uniformly.
   Compatibility/density checks and the five-actor cap still apply.

The 50% coverage choice is explicit conservative training policy, **not fitted
or statistically calibrated probability/confidence**. Unknowns cannot disappear
just because sparse, round-pooled evidence dominates. Equal-match fractions
avoid extra influence from matches with more sampled postplant rounds. This
does not make matches independent or resolve event/sample-selection bias.
Course-normalized draw shares are not marginal inclusion chances when drawing
multiple constrained opponents, and certainly not encounter probabilities.

`holdingEvidence()` preserves broad `roundKeys`, `rounds`, `sampleRounds`,
`matches`, `sampleMatches`, episodes and dwell. Its old `.weight = 1+n` remains a
legacy diagnostic; `selectionWeights()` uses `trainingSupport` and the policy
above. The immutable aggregate and its historical method text are unchanged;
the current sampler is authoritative for training policy. No local-pocket mask,
kill heatmap, inferred stance or source facing supplies numeric weights.

Raw-cache feasibility was checked offline on all ten POVs of match `2392197`,
round 1: 25,922 ticks, 11 retained episodes, 10.859375 retained seconds. All four
metadata/README hashes and those ten tick hashes were verified; the existing
episode/identity/clock rules were reused. Actual interval feet are recoverable,
but the inspected match/tick schemas have no source map-build identifier or
measured stance. Reviewed pocket boundaries, map compatibility and full-corpus
round/dwell conservation are not established. No raw-point pocket weights were
published, and no cache observations were promoted to extra independent matches.

### Measured Policy Comparison

The regenerated offline report compares both rules on **the same current pools
and current authored families**, isolating the policy effect from added points.
These are first-draw normalized shares before compatibility constraints, not
before/after marginal inclusion rates across different releases. Broad support
and supporting-match counts are identical for both columns.

| Approach / Source | Broad Rounds / Sample | Supporting Matches / Sample | Old Ticket Share | Coverage Policy Share |
| --- | --- | --- | --- | --- |
| Long / car off-angle `a_short/28` | 3/256 | 3/32 | 2.44% | 3.54% |
| Short / corner `a_short/10` | 33/256 | 23/32 | 19.21% | 13.01% |
| A retake / front site `retakes:dust2/17` | 2/143 | 2/32 | 4.69% | 5.95% |
| CT mid / outside Long `ct_push_mid/12` | 53/256 | 25/32 | 25.35% | 17.35% |
| CT mid / close Top Mid variant `mid_to_b/16` | 5/256 | 5/32 | 2.19% | 3.44% |

Lower-support holds gain deliberate practice coverage; dominant broad-radius
holds lose some selection mass. Postplant support additionally uses equal-match
fractions rather than pooled rounds with unequal phase denominators. No
accepted/blocked centroid count explains these changes. For example,
`ct_push_mid/20` keeps 24 broad rounds / 16 supporting matches even though the
diagnostic accepts only four rounds; no subtraction or probability claim is made.

The report is ignored `research/dust2/hold-pocket-audit.json`, with 437 unique
geometry pairs, 165 assignments and 38 reduced-support flags. Report SHA-256:
`50d93f2069e39cfe672f933237c97d3d4855daa296dfb18cd4b191ac0d5074a2`.
The density remains byte-identical:
`848ba3e53cf490479c5ce034f8efd6030aa1b07dbd40f2f147e4c201f7d13cf7`.

## Source And Rights

Author: Julien Blanchon. Work: **OpenCS2 Dataset** (2026), published on Hugging Face. Primary [storage bucket](https://huggingface.co/buckets/blanchon/opencs2_dataset); downloaded through its [dataset mirror at pinned revision](https://huggingface.co/datasets/blanchon/opencs2_dataset/tree/8d7deddcd30c081fb197b75f58b4a0fba1117b9d).

Revision: `8d7deddcd30c081fb197b75f58b4a0fba1117b9d`. The bucket is not treated as a versioned Git revision; the mirror revision and individual downloaded SHA-256 hashes pin the actual inputs. The generated `source.files` records every README/index/tick input as `[relativePath, actualBytes, sha256]`. The ignored cache also contains `sample-manifest.json`.

The pinned [README](https://huggingface.co/datasets/blanchon/opencs2_dataset/blob/8d7deddcd30c081fb197b75f58b4a0fba1117b9d/README.md) declares `license: cc-by-4.0` and releases renders/metadata under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It separately cautions that HLTV demo sources remain subject to original tournament terms. This verifies the publisher's declaration, not independent clearance of every underlying right. Preserve attribution, the source link, the license link, and this qualification when distributing derived weights.

Changes from source: filtered tick intervals, contiguous-episode estimation, Source-coordinate binning, and aggregate-only release. No raw player names or Steam identities are exported.

| Input | SHA-256 |
| --- | --- |
| README.md | `cb08b2d18f6fa70f0c7d500740daa5156e4c040b68e602a0ae174a2d35a478da` |
| index/matches.parquet | `b4d83ba3413d35a7f5da6d04f8d5c41597caddb4fb29b4a3a865f5446945a685` |
| index/rounds.parquet | `d0770b59df6dc5bbcc16772476464101e3558682e4294e9eed105f27b7c24d16` |
| index/pov_rounds.parquet | `17f77dcc4677fd19b0cd6b4f2742bb0930c3f544206b06b879106b8e66bb5ff5` |

## Input Schema

Only `index/matches.parquet`, `index/rounds.parquet`, `index/pov_rounds.parquet`, and selected `rounds/match_id=.../map_name=de_dust2/round=.../player=.../ticks.parquet` are read. The README is retained for provenance/license evidence. No events or media downloads are permitted by the importer's path whitelist.

- Match index: `match_id`, `map_name`, `match_date`, `event`, teams, and `match_url`.
- Round index: match/map/round, `freeze_end_tick`, `round_end_tick`, `bomb_plant_tick`, `has_bomb_plant`.
- POV index: match/map/round/slot, `player_side`, capture/death boundaries, `sidecar_bytes`, `ticks_parquet_path`.
- Ticks: `tick`, `t`, `team_num`, `is_alive`, `health`, `x/y/z`, `velocity_x/y/z`, `input_weapon`, `input_weapon_id`, `active`, and match/map/player/round identity.

The actual sidecar schema has `input_weapon`/`input_weapon_id` and no separate equipped-weapon column. The importer does not substitute kill-event weapons or assume an input field is independently verified equipment state. `source_diagnostics.eligible_alive_weapon_rows` exports the measured name/ID pairs, alive-row counts, firearm membership, and whether the previous allowlist excluded a recognized firearm. Counts are observations, not weapon-conditioned popularity.

`input_weapon_id` is a dataset code, not an assumed Valve item-definition index. The old cached sidecars report AK-47 as ID 1, AWP as 3, and M4A4 as 27; ID 0 is shared by C4, HE grenades, M9 bayonets, and Shadow Daggers. Classification therefore uses exact recorded names, never the numeric ID alone. The README describes tick weapon state but does not independently establish whether that field always tracks the equipped weapon rather than a captured input state; this remains a source-semantic limitation.

The previous 18-name allowlist omitted AUG (`aug`), SG 553 (`sg556`), PP-Bizon, P90, MP5-SD, UMP-45, M249, Negev, G3SG1, SCAR-20, Nova, XM1014, MAG-7, Sawed-Off, CZ75-Auto, and R8 Revolver. The importer now recognizes all 34 standard firearm names. Zeus/taser, knives, utility, C4, null, and unknown names remain excluded. M4A4 is `m4a1`, M4A1-S is `m4a1_silencer`, and SG 553 is `sg556`; browser weapon IDs are not source names. This statistical classification does not change selectable weapons or runtime data. In the old 48-round cached sample, none of the omitted names occurred in alive rows, so this omission did not explain that sample's sparse cells by itself.

`team_num=3` is checked against index side CT, `team_num=2` against T. Timestamps are checked against `(tick - capture_start_tick) / 64`; `t` is relative to that POV's capture, not the global demo clock. Cross-map joins always include `de_dust2`.

**Source anomaly:** all 1,699 planted Dust2 rounds in the pinned round index have `bomb_site="bombsite_b"`; every site ID is zero, including unplanted rounds. Those labels are unusable. No A/B site conditioning is claimed. Phase labels use the explicit plant tick, independently of the bad site label. Plant timing was checked for index consistency, not independently replay-verified against demos.

The index's sidecar byte estimates also exceed observed file sizes. They are conservative download reservations, not actual byte claims. Actual sizes and hashes, plus discrepancy counts, are exported.

## Observed Sample

Acquired on 2026-10-10 UTC (`2026-10-10T20:20:24.106133+00:00`). The release reached the full bounded target: **32 matches, 256 complete sampled rounds, 2,560 player POVs**, including 143 rounds with a plant. It contains **10,828,564 tick rows**, of which 10,795,352 were alive/in-round; 1,508,852 rows met the firearm/no-movement-or-busy-input screen before speed/duration filtering. The resulting **8,118 episodes contribute 13,291.625 seconds in 1,835 side/context cells**. All selected POVs passed identity, clock, side, and capture-coverage validation before publication; this is not a partial expansion.

Actual selected source size is **437,122,443 bytes (416.9 MiB)**, including 2,560 tick files (428,763,179 bytes), three indexes, and the README. All 2,564 inputs have SHA-256 provenance. The old 480 tick inputs were reused from cache and 2,080 additional tick files were collected. No media or event files were downloaded. The compact JSON is approximately 826 KiB including complete input hashes and round-support sets. All 2,560 sidecar size estimates differed from actual bytes, but actual sizes were below their reserved caps. The 1024 MiB cap was not reached.

Dates/events below are the match index's reported values, not independently certified tournament records. Full URLs, UTC timestamps, and selected tick boundaries are in `sample`.

| Match ID | Reported Date (UTC) | Teams | Event | Sampled Rounds |
| --- | --- | --- | --- | --- |
| 2393170 | 2026-04-17 | TDK / Oxuji | NODWIN Clutch Series 7 | 1, 3, 4, 5, 9, 10, 14, 15 |
| 2392209 | 2026-04-08 | KOLESIE / M1X KS | LORGAR RANKINGS Season 1 Closed Qualifier | 2, 4, 7, 11, 12, 14, 19, 23 |
| 2392202 | 2026-03-28 | Qual4 / BASEMENT BOYS | LORGAR RANKINGS Season 1 Closed Qualifier | 2, 4, 9, 15, 16, 18, 20, 21 |
| 2393240 | 2026-04-17 | Spirit / MOUZ | IEM Rio 2026 | 2, 3, 8, 9, 10, 13, 16, 17 |
| 2392952 | 2026-04-04 | R2 / paiN Academy | ESL Challenger League Season 51 South America Cup 3 | 1, 3, 5, 9, 10, 12, 13, 16 |
| 2392307 | 2026-04-03 | Keyd Stars / Fake do Biru | PGL Astana 2026 South America Closed Qualifier | 4, 5, 7, 8, 18, 19, 21, 23 |
| 2392213 | 2026-04-10 | KOLESIE / UNiTY | LORGAR RANKINGS Season 1 Closed Qualifier | 1, 2, 3, 5, 6, 7, 8, 13 |
| 2393238 | 2026-04-15 | FURIA / MOUZ | IEM Rio 2026 | 7, 9, 12, 13, 14, 15, 21, 22 |
| 2392909 | 2026-04-06 | Skele / Rooster | ESL Challenger League Season 51 Oceania Cup 3 | 4, 6, 7, 10, 11, 12, 13, 15 |
| 2392906 | 2026-04-05 | Rooster / Ground Zero | ESL Challenger League Season 51 Oceania Cup 3 | 3, 4, 5, 6, 12, 15, 16, 18 |
| 2392655 | 2026-04-01 | 3DMAX / WAZABI | Parken Challenger Championship Season 3 | 1, 3, 4, 7, 12, 15, 16, 19 |
| 2393242 | 2026-04-18 | Falcons / Spirit | IEM Rio 2026 | 5, 6, 7, 10, 11, 16, 17, 18 |
| 2392620 | 2026-04-01 | Monte / M80 | Digital Crusade DraculaN Season 6 | 1, 2, 7, 8, 12, 19, 20, 22 |
| 2393425 | 2026-04-20 | insane players / Akimbo | Dust2.us Eagle Masters Series 7 | 3, 5, 7, 14, 15, 18, 19, 22 |
| 2393398 | 2026-04-19 | Sashi Academy / INFINITE | Parken Challenger Championship Season 5 | 1, 3, 5, 7, 9, 10, 13, 16 |
| 2392550 | 2026-03-26 | Isurus / MIBR Academy | PGL Astana 2026 South America Open Qualifier 2 | 5, 6, 8, 12, 14, 15, 16, 17 |
| 2393162 | 2026-04-15 | Acend / Ursa | NODWIN Clutch Series 7 | 4, 5, 6, 7, 10, 11, 16, 17 |
| 2393272 | 2026-04-11 | LAGUNA / Eclipse | Parken Challenger Championship Season 4 | 1, 3, 4, 7, 12, 13, 16, 18 |
| 2392665 | 2026-04-02 | BESTIA / 3DMAX | Parken Challenger Championship Season 3 | 5, 7, 8, 9, 10, 11, 14, 15 |
| 2393031 | 2026-04-07 | PARIVISION / 3DMAX | PGL Bucharest 2026 | 2, 5, 7, 11, 13, 15, 18, 21 |
| 2392197 | 2026-03-26 | ASTRAL / DALUYONG | LORGAR RANKINGS Season 1 Closed Qualifier | 1, 6, 7, 8, 11, 17, 20, 30 |
| 2392900 | 2026-04-03 | Mindfreak / Time Waves | ESL Challenger League Season 51 Oceania Cup 3 | 2, 5, 7, 12, 14, 15, 16, 17 |
| 2392744 | 2026-03-30 | Just Players / IDoPieca | ESL Challenger League Season 51 Europe Cup 3 | 6, 9, 10, 13, 15, 17, 21, 24 |
| 2392942 | 2026-04-09 | FengDa / Chinggis Warriors | ESL Challenger League Season 51 Asia-Pacific Cup 3 | 2, 3, 4, 5, 6, 12, 14, 20 |
| 2392933 | 2026-04-05 | BMZ / FengDa | ESL Challenger League Season 51 Asia-Pacific Cup 3 | 2, 4, 7, 8, 12, 13, 15, 19 |
| 2392908 | 2026-04-05 | Time Waves / Arcade | ESL Challenger League Season 51 Oceania Cup 3 | 1, 10, 14, 15, 17, 21, 22, 23 |
| 2393332 | 2026-04-16 | Young Ninjas / Fire Flux | United21 League Season 47 | 1, 2, 3, 7, 8, 9, 14, 17 |
| 2393113 | 2026-04-07 | Aether / Outfit 49 | Dust2.us Eagle Masters Series 7 | 3, 5, 8, 10, 11, 13, 14, 18 |
| 2392605 | 2026-03-30 | Eternal Fire / aimclub | Digital Crusade DraculaN Season 6 | 2, 3, 5, 8, 10, 11, 12, 13 |
| 2393087 | 2026-04-13 | Aurora / HOTU | IEM Rio 2026 | 1, 6, 12, 13, 14, 22, 24, 27 |
| 2393406 | 2026-04-20 | zajezdzacze / INFINITE | Parken Challenger Championship Season 5 | 2, 3, 5, 6, 7, 14, 16, 17 |
| 2392928 | 2026-04-03 | Last Bullet / NEXVOID | ESL Challenger League Season 51 Asia-Pacific Cup 3 | 1, 7, 8, 12, 13, 15, 17, 18 |

| Holder Side / Phase | Episodes | Dwell Seconds | Sampled Rounds | Rounds With Holds | Cells | Cells With >=2 Matches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CT preplant | 3694 | 6553.484375 | 256 | 250 | 713 | 329 |
| T preplant | 3431 | 5091.078125 | 256 | 247 | 713 | 345 |
| T postplant | 640 | 1028.9375 | 143 | 110 | 235 | 67 |
| CT postplant | 353 | 618.125 | 143 | 80 | 174 | 24 |

Preplant layers have holds in all 32 matches; each postplant layer has holds in 31. Only **765/1,835 cells** have support from multiple matches; CT postplant has only 24 such cells. Thirty-two match clusters, repeated teams, correlated players/episodes, and only eight selected rounds per match do not justify a population confidence interval or exact angle probability. Confidence remains **low/exploratory**, especially for CT postplant. Per-cell `matches/rounds` are finite evidence counts, not confidence percentages. Unsampled and unsupported regions are unknown, not zero-popularity. In this release, every sampled side/phase round has at least one observed adjacent alive interval, so each layer's `observedRoundKeys` equals its sampled `roundKeys`; this equality is measured, not assumed by the importer.

Quality checks found **32 nonadjacent/timestamp-gap intervals**, zero nonfinite state rows, and zero missing input lists. Gaps split runs and contribute no interpolated dwell or exposure. The displacement cross-check rejected 176 otherwise screened low-speed intervals. Exclusion counts overlap: 3,247,307 alive rows carried non-firearm/unknown weapons; 8,823,412 had movement input; 102,256 had busy input. These must not be summed as disjoint categories. Generic observed-alive exposure across layers was 168,624.5 seconds.

The expanded weapon audit found **5,921 alive rows wrongly excluded by the previous firearm list**: AUG 4,002; MAG-7 289; XM1014 1,630. This is an alive-row screen discrepancy, not a count of added qualifying episodes. Other newly recognized firearms, including SG 553, P90, and MP5-SD, did not occur in eligible alive rows in this selected sample. Their zero observations do not establish competitive unpopularity. Including AUG in this offline statistical screen does not reintroduce it into the selectable weapon list.

The initial verified subset was 4 matches / 12 rounds / 120 POVs, with 420 episodes, 602.125 seconds, and 180 cells. The previous release was 8 matches / 48 rounds / 480 POVs, with 1,845 episodes, 2,898.21875 seconds, and 649 cells. That actual aggregate remained published while the new sample was collected; replacement happened only after complete expanded validation.

### Historical Sensitivity

Same 8/48/480 inputs, no further download, same movement/weapon/phase rules:

| Maximum Speed | Minimum Dwell | Episodes | Seconds | Cells |
| ---: | ---: | ---: | ---: | ---: |
| 10 u/s | 0.5 s | 1792 | 2842.84375 | 634 |
| 20 u/s (previous release) | 0.5 s | 1845 | 2898.21875 | 649 |
| 30 u/s | 0.5 s | 1898 | 2944.46875 | 679 |
| 20 u/s | 1.0 s | 842 | 2203.4375 | 388 |

Dwell changed by about 2% across the 10/20/30 speed screens, but a one-second episode cutoff removed many short stops. This is historical method sensitivity for the previous 48-round sample, not a confidence interval or a measured sensitivity result for the current unique-round support weights. Outputs are retained only in the ignored cache.

## Selection And Method

The seed is `dust2-holds-v1`. Eligible matches have enough complete rounds: ten unique POV slots, five CT/five T, valid phase bounds, and each POV captured from freeze end through its indexed death or round end. Matches are ranked by `SHA256(seed + ':' + match_id)`. Within each selected match, complete rounds are ranked by `SHA256(seed + ':' + match_id + ':' + round)`. Selection does not inspect positions, kills, plant outcomes, or wins. Both initial and expanded selections use this rule; expanding counts retains the original subset.

The pinned indexes contain 164 Dust2 matches and 3,327 complete rounds. Fixed-count rounds per match do not weight longer matches more heavily. This deterministic selection is reproducible, not a demonstrated representative random sample of competitive play.

1. Require alive and positive health, `freeze_end_tick <= tick < round_end_tick`, and tick before any indexed death. Freeze and post-round time are never counted.
2. Keep explicit `side` and `context`: `ct` or `t`, and `preplant` or `postplant`. A postplant window begins at the indexed plant tick. A plant/phase boundary splits episodes, even if the player stays still.
3. Require a recognized firearm at both endpoints. Knife variants, utility, C4, null, and unknown weapons are excluded. The firearm allowlist is recorded in `method`.
4. Require an available `active` input list and no `forward`, `back`, `move_left`, `move_right`, or `jump` input. Reload, use, and weapon-inspection inputs are also excluded. Stationary crouch/walk modifiers are allowed; attack inputs are allowed. These are recorded demo fields, never live inputs.
5. Both consecutive endpoints must have finite position/time/velocity and 3D speed <=20 Source units/s. Require adjacent ticks and a 1/64-second timestamp interval, with 0.0001-second float tolerance. Also require position-derived 3D displacement speed <=21 units/s, guarding against stationary-velocity teleports.
6. An episode is a maximal connected run of qualifying intervals, retained only if observed duration >=0.5 seconds. Gaps, excluded inputs/weapons, phase changes, movement, invalid states, and deaths split runs. No terminal tick duration is extrapolated.
7. Allocate each retained interval's seconds to its left endpoint's `[floor(x/64), floor(y/64), floor(z/32)]` bin. Origin is `[0,0,0]`; negative coordinates use floor, not truncation. Do not convert to browser/world coordinates or normalize height.
8. Count each episode once per bin visited. Assign exactly one episode anchor to the bin with most dwell, with a lexicographic tie-break. Dwell and anchored counts conserve global totals; visited-episode counts need not.

An episode may move slightly without movement input, cross bins, include a fight, or represent a pause/save rather than intentionally holding an angle. Slow-speed observations do not establish tactical intent. CT postplant includes retakers and savers; T preplant includes attacking pauses. Neither is silently reinterpreted as a defensive-only population.

## Output Contract

`src/range/prefire/data/dust2-hold-density.json` is compact generated JSON. Its stable adapter-facing fields are:

```ts
type HoldCell = {
  position: [number, number, number]; // Native Source XYZ dwell centroid, not a spawn.
  side: 'ct' | 't';
  context: 'preplant' | 'postplant';
  episodes: number;       // Distinct retained episodes visiting this cell.
  seconds: number;        // Retained dwell allocated to this cell.
  rounds: number;         // Distinct match/round support with dwell here.
  roundKeys: readonly string[]; // Unique match_id/round support; union nearby cells.
  matches: number;        // Distinct match support with dwell here.
  episodeAnchors: number; // Unique greatest-dwell anchor counts, globally additive.
  bin: [number, number, number];
};
type HoldDensity = {
  schemaVersion: 1;
  mapId: 'de_dust2';
  source: { url: string; revision: string; license: 'CC-BY-4.0' };
  sample: { matches: number; rounds: number; povs: number };
  method: Record<string, unknown>;
  cells: HoldCell[];
  layers?: readonly HoldLayer[]; // New exports include round-key denominators.
  totalEpisodes: number;
  totalSeconds: number;
};
type HoldLayer = {
  side: 'ct' | 't';
  context: 'preplant' | 'postplant';
  rounds: number;
  roundKeys: readonly string[]; // Sampled phase-potential denominator; length = rounds.
  observedRounds: number;
  observedRoundKeys: readonly string[]; // At least one valid adjacent alive interval.
  roundsWithHolds: number;
  holdingRoundKeys: readonly string[]; // Union of this layer's cell roundKeys.
};
```

The actual JSON includes additional attribution/input hashes, exact sampled match dates/events/round boundaries, `layers`, `quality`, `source_diagnostics`, and `confidence`. Do not discard these from the attribution/evidence source merely because the runtime adapter consumes fewer fields.

`position` is the dwell-weighted centroid of observed tick `x/y/z`, rounded to 0.001 Source units. It has no standing-eye/head-height adjustment and is intended for native pawn-foot candidate comparison. It is not a measured canonical holding spot or a collision-validated spawn: means can lie between observed points or across geometry.

`schemaVersion` remains `1`; existing fields and Source pawn-foot XYZ semantics are unchanged. Round-key fields are additive. Keys are stable strings `match_id/round`, sorted by numeric match ID then round number, with no player identity. A round can support many episodes, players, and bins but occurs only once in a cell/layer key array. A match ID with a different round is a different key, and the same round number in another match is also distinct.

`layers` supplies distinct global episodes/seconds and generic observed-alive exposure for each side/phase. Layer `matches/rounds/povs` and `roundKeys` are sampled potential coverage, including POVs that died before that phase. Preplant covers all selected complete rounds; postplant covers only rounds with a plant. `observedRoundKeys`/`observedRounds` is a separate actual-coverage denominator: at least one finite adjacent alive interval on that side in that phase, regardless of weapon, movement, or whether a retained hold exists. `holdingRoundKeys` is the exact union of all cell support in that layer; its length is `roundsWithHolds`. These sets deliberately do not discard rounds merely because no hold was found. Alive exposure is not conditioned on holding a firearm and is not an enemy-presence probability denominator.

## Parent Mapping

The parent owns mapping to validated candidates and runtime behavior. This aggregate intentionally contains no route/course/angle IDs and no changes to routes, session logic, or runtime configuration.

- Compare candidate native-floor XYZ to matching side/context cell `position`, using at most 96 Source units of horizontal Euclidean distance and 24 of vertical distance in the parent's current mapping. This is a spatial/binning assumption, not an empirical tactical probability or a parameter applied by the aggregate itself.
- `ct_push_*` clearing T holders should use `side='t', context='preplant'`; ordinary T clearing CT uses CT preplant. Retakes clearing postplant T use T postplant separately. Do not blend these layers without explicitly labeling the blend.
- For unique regional round support, form `new Set(matchedCells.flatMap(cell => cell.roundKeys))` and intersect with the matching layer's `roundKeys`. Its size is the numerator `n`; never sum cell `rounds`, cell `matches`, or visited `episodes`. The exported sets now provide the exact pooled union instead of the previous maximum-cell lower bound. Cells with zero `episodeAnchors` remain valid: secondary-bin visits have real round support.
- For the agreed sampled-round display, use the matching layer's `roundKeys`/`rounds` as denominator and show `n / denominator sampled rounds with an observed qualifying hold nearby`. If explicitly reporting only alive-observed coverage, intersect support with `observedRoundKeys` and label that separate denominator. Do not call either quantity opponent-presence probability or FACEIT popularity. Nearby-centroid/bin matching remains a spatial estimation assumption.
- The historical parent family weight was `1 + n_family`, with variant tickets split proportionally to `1 + n_candidate`. This rule is superseded by **Current Training Policy** above; it remains only as a diagnostic comparison. Family union/deduplication still applies. Do not substitute episode anchors, visit counts or dwell for distinct-round support. Raw episode/dwell diagnostics describe acquisition and method sensitivity, not independent observations.
- Exact configurable bots per run (parent default four) is a separate training setting, not a Bernoulli presence probability estimated from these samples. Neither normalized training weights nor `n / denominator` claims opponent-presence probability.
- Deduplicate identical native coordinates/canonical IDs across profiles and courses before regional normalization. Optional dataset/profile/index IDs preserve provenance, not extra independent evidence. Repeating a coordinate in 24 courses/120 slots must not multiply its observed weight.
- Do not relocate candidates to centroids, infer orientation/stance from these cells, move between floors, or bypass collision/visibility validation. Keep sparse/unobserved angles through parent smoothing; no observed cell is not evidence that an angle is unused.

## Reproduction

Python 3.11 and DuckDB 1.4.4 were used. The reader is local and ignored, not a project/runtime dependency:

```powershell
python -m pip install --target .local-tools/prefire duckdb==1.4.4
python tools/import-prefire-holds.py --download --matches 32 --rounds 8 --max-mib 1024 --workers 4
python tools/import-prefire-holds.py --matches 32 --rounds 8 --max-mib 1024 --workers 4
python -m unittest discover -s tools/tests -p test_import_prefire_holds.py -v
```

Network requires explicit `--download`. The CLI defaults and hard upper limits are 32 matches, eight complete rounds per match, 1024 MiB of total selected inputs, and four workers. Four workers reserve disjoint per-file byte caps from the pinned index; the whole sample, including cached inputs and README/index bytes, is bounded before scheduling. The selected 32/8 tick reservations total 444,960,786 bytes, plus 8,359,264 README/index bytes, safely below the 1024 MiB cap. No video or event path can pass the whitelist. Subsequent runs verify local hashes from the manifest. Raw parquet remains under ignored `research/prefire-statistics`; the reader stays under ignored `.local-tools/prefire`.

The importer writes the aggregate atomically only after every selected POV is downloaded, fingerprinted, identity/clock/coverage checked, and aggregated. The manifest is also atomically serialized after tick validation, rather than before validation. A blocked expansion leaves the prior actual aggregate in place; it never writes invented observations or fills gaps. Failed hash/cap checks do not promote partial downloads. Valid completed downloads remain cached for a bounded retry. Run without `--download` for offline reproduction. Acquisition timestamps are preserved for unchanged input sets, and compact JSON output ordering is deterministic.

For the initial subset, use `--matches 4 --rounds 3`; set `--output research/prefire-statistics/initial-subset.json` to avoid replacing the expanded published artifact. The previous 8/6 subset is also retained by the larger deterministic selection. Sensitivity outputs should go to the ignored cache, using `--speed 10`, `--speed 30`, or `--min-dwell 1` with the same 32/8 selection. The historical sensitivity table above describes only the previous 8/6 inputs, not the larger release.

## Validation

### Scoped Coverage Revision

- `npm test -- --run src/range/prefire/routes.test.ts src/range/prefire/occupancy.test.ts src/range/prefire/density.test.ts src/range/prefire/hold-pocket-audit.test.ts`: **95 tests / four suites passed**, including installed native geometry; no skips. Sandbox SSR-cache renames initially failed before assertions; the permissioned retry passed.
- `python -m unittest discover -s tools/tests -p test_import_prefire_holds.py -v`: **33 passed**. Importer and density were not edited.
- `npm run build`: passed, with the existing large-chunk warning.
- Full `node tools/build-prefire-pools.mjs --save`: ten approaches, 141 identities / 165 assignments, all 24 old lineups compatible. Collision/support, dense both-envelope 64-unit cover, protected first 32 units, both supported walking stances, full-speed motor and standing head reachability gates retained. Manifest hashes pin source/helper inputs; partial/diagnostic runs cannot publish.
- `node tools/audit-prefire-hold-pockets.mjs`: regenerated, still diagnostic. No full `check`, browser suite, whole-corpus reimport, commit, packaging or deployment was performed in this owned-scope revision.

### Prior Parent Integration

The 2026-10-11 approach follow-up passes **3,163 tests / 134 files plus the
production build**, 12 desktop/mobile browser checks (four intentional skips),
and all 33 importer tests. Ten approaches retain the 24 old fixed lineups;
native pools contain 130 source identities / 143 approach assignments. Native
planning has no failures, and active render-tick CPU samples measure median
4.1-5.0 ms / p95 5.4-6.2 ms with no browser errors. The separate local-pocket
diagnostic flags spatial uncertainty but is not promoted to runtime weights.
See `prefire-evidence-followup.md` and `prefire-map-case-study.md` for the
independent-source review, remaining rights/conditioning issues and next-map gates.
This supersedes integration failure snapshots, not the recorded importer method
or evidence artifact. No new telemetry corpus was imported in this follow-up.

The completed 2026-10-10 integration supersedes the concurrent failure snapshots
below: **`npm run check` passed 3,202 tests / 131 files and the production build**.
The existing large-chunk build warning remains. All 33 importer tests pass, and
the final offline export retains the byte-identical SHA-256 recorded below.
The native weighted-pool generator admitted 130 source identities across
24 courses; the all-course planning audit reports zero failures. Final
desktop/mobile prefire browser suites pass 10 tests, with four intentional
platform-specific skips. Selected-only planning, bounded roster caching,
duplicate-corner family weights and one-to-five bot density are covered by
runtime tests. Active shooting profiles on three courses report zero browser
errors and 3.9-4.6 ms median render-tick CPU work; this is not GPU frame time or
an old-hardware performance guarantee.

These checks establish reproducibility and tested training behavior, not exact
competitive opponent-presence probabilities. No commit or deployment was
performed for this integration.

### Current 32/8 Expansion

- Importer tests: **33 passed**, none skipped. Includes cross-cell/player/episode union deduplication, exact phase denominators, zero-anchor secondary-cell support, measured weapon-name/ID audits, 32-match/eight-round deterministic selection, hard caps, explicit download opt-in, and preservation of published output/manifest on tick-validation failure.
- Final offline regeneration: **byte-identical SHA-256** `848ba3e53cf490479c5ce034f8efd6030aa1b07dbd40f2f147e4c201f7d13cf7`. Both runs verified all 2,564 cached input hashes and regenerated all 2,560 POVs without network access. The acquisition timestamp, selection, 20 u/s speed screen, 0.5 s dwell threshold, 64/64/32 bins, side/phase split, and measured totals were unchanged. The final JSON is 845,767 bytes. `probability_claim` and method interpretation now describe unique sampled-round support, not episode/dwell-only weights; raw episodes, anchors, and dwell remain diagnostics.
- `npm run build`: passed after the larger artifact was published, with the existing large-chunk warning. The earlier transitional build failed because the parent had already required layer `roundKeys` while the prior aggregate was still published.
- `npm test -- --run`: sandbox cache rename was denied; approved retry recorded 3,189 passes and one parent-owned occupancy fixture failure during concurrent integration.
- Final `npm run check` snapshot with the 32/8 artifact: 3,194 passes and one parent-owned `routes.test.ts` failure because the generated weighted-pool collision hash was empty where a native hash was expected. Its build stage was skipped; the separate production build passed. No runtime/pool fixture was edited by this importer work.

These repository runs are shared-worktree snapshots, not a claim that concurrent parent integration is finished. The four assigned source files were edited; raw source cache and build outputs are generated/ignored. No commit or deployment was performed.

### Historical Integration

- Importer synthetic/input/published-artifact tests: 22 passed. Coverage includes side/phase isolation, freeze/death/end filtering, knife/utility/movement exclusions, threshold duration, gaps, teleports, negative-coordinate bins, support deduplication, path whitelist, hash/cap checks, deterministic all-player selection, and conservation.
- Offline regeneration: all cached fingerprints checked; identical input/method sets preserve the acquisition timestamp and deterministic output ordering.
- `npm run build`: passed, with the existing large-chunk warning.
- `npm test -- --run`: first blocked by sandbox temporary-cache rename permissions; approved retry ran 3,156 tests, with 3,129 passing and 27 failing in untouched shared-worktree route/movement/session code.
- `npm run check`: approved retry later ran 3,172 tests, with 3,162 passing and 10 failing in untouched route, native-collision, movement, tagging, and session tests; its build stage was skipped because tests failed. Shared files changed during these runs, so the differing counts are snapshots, not importer regressions or a clean baseline claim.

The statistics/importer do not change or import those runtime modules. No attempt was made by the importer agent to fix concurrent runtime work. No commit or deployment was performed.

Parent integration for the earlier 8/6 release subsequently corrected the route/motor fixtures and completed
`npm run check`: 129 test files / 3,181 tests passed, then the production build
passed. The 22 importer tests and 782 current-binary movement arithmetic samples
also passed. Those earlier results superseded only the historical failure snapshots,
not the current 32/8 expansion snapshot above; they did not establish exact match probabilities.
