# Position sources and additional Dust 2 coverage

The user supplied a separate research conversation. Its source claims were
checked rather than treated as a ready-made dataset or probability table.

## Source decisions

- [PureSkill](https://docs.pureskill.gg/datascience/) has player telemetry and events,
  but needs an approved AWS Data Exchange subscription. Its CC BY-NC-SA 4.0
  conditions and AWS export costs require a separate rights/access decision. No
  PureSkill records or invented FACEIT percentages are shipped.
- [Xtrimis](https://xtrimis.com/heatmaps) documents player-specific positioning,
  duels, damage and phase filters. Its public page is not an openly licensed
  aggregate coordinate export. Thermal concentration is not probability.
- [CS2.CAM](https://cs2.cam/en/wiki/heatmaps) exposes useful contextual heatmap
  analysis, not a verified reusable common-angle CSV on its documentation page.
- [Awpy](https://awpy.readthedocs.io/en/latest/) can extract events and player
  snapshots from supplied demos. It is tooling, not an additional population.
- [CS2 Meta Engine](https://github.com/Twoos123/cs2-meta-engine) is a demo-analysis
  application. Its implementation is not evidence for a particular angle's
  measured frequency; no live-game integration is imported into this trainer.
- [Dust2 Duel Density](https://github.com/GameOperator13/cs2-dust2-duel-density)
  provides a public coordinate CSV attributed to OpenCS2 under CC BY 4.0. It is
  usable as paired combat-location evidence, not holding frequencies.

## Pinned combat-location audit

Repository revision: `04f94b0ad6600c39f019bf65f46a08b13cdce3f1`.
Input: `cs2_dust2_data/dust2_kills_with_coords.csv`.
SHA-256: `61d1471513107aa511cb395c7954a618e351087f3f527c9b35edff090c15b134`.

The actual file has 2,627 events. 385 lack at least one endpoint coordinate, so
only 2,242 complete pairs from 17 matches enter this audit. Four matches overlap
the existing hold corpus. Neither the README's rounded headline nor the number
of endpoints is used as an independent-match count.

`tools/audit-position-source.py` uses Python's CSV parser, validates IDs/teams/map,
pins the file checksum, rejects invalid values, and reports incomplete pairs.
Within 96 horizontal / 64 vertical Source units, 2,404 of 4,484 endpoint samples
are near an admitted practice point. Unmatched 128-unit cells retain an actual
source sample and its engagement ID for review, never a centroid invented as a
spawn. `tools/survey-position-leads.mjs` checks support and feasible cover peeks.

Raw inputs/reports remain in ignored `research/position-sources/`. These are
coverage diagnostics, not encounter probabilities or automatic placement rules.

## Runtime coverage expansion

All relevant pinned OpenPrefire practice profiles are now considered as offline
proposals, with near-duplicate additions suppressed. Existing canonical lineups
remain unchanged. Every admitted point still passes native clearance, covered
entry, first-32-unit protection, both walking stances and hittable-head checks.

| Approach | Previous | Expanded |
| --- | ---: | ---: |
| Outside Long / pit | 19 | 28 |
| Long to A | 36 | 53 |
| Catwalk to A | 33 | 50 |
| Upper tunnels to B | 19 | 36 |
| B retake | 27 | 37 |
| Mid to CT | 14 | 28 |
| Lower tunnels | 19 | 31 |
| A retake | 24 | 50 |
| CT mid push | 15 | 22 |
| Upper tunnels | 7 | 12 |

This is 197 unique holds and 347 approach assignments, previously 160 / 213.
Five-actor limits, explicit training-coverage weighting, collision geometry and
source coordinates are preserved. Duel starts, hold lanes, navigation and delivery
manifests are regenerated. New positions are not assigned made-up match odds.

Seven additional points in `combat-dust2-leads.json` preserve exact reviewed CSV
coordinates and event/role attribution: Blue exit, low A-ramp cross, front Short
platform, A-Short ramp edge, rear A default, back B default and CT/B ramp wall.
Stance/facing/movement are explicitly authored training adaptations. A location
is admitted only to approaches passing the native audit; the CT/B-ramp point is
rejected for B doors because it is exposed at spawn. Source notice and adaptation
context are visible in Prefire's existing Angle sources disclosure.

## Package maintenance

Changing pools invalidates the runtime admission certificate even if geometry
is unchanged. The real browser gate caught a stale certificate during this
follow-up; do not bypass it or copy old route keys. Regenerate against every
published candidate with the full native cover/walk/motor/head-visibility gates:

```sh
node tools/audit-native-materials.mjs
node tools/build-prefire-pools.mjs --quality-output=public/revamp/maps/dust2/quality.json
node tools/validate-prefire-map.mjs --quality=public/revamp/maps/dust2/quality.json --artifacts=public/revamp/maps/dust2/quality.json.artifacts.json
node tools/build-duel-rounds.mjs
node tools/build-duel-navigation.mjs
node tools/build-duel-delivery.mjs
```

Quality publication audits the already published pool; proposal discovery and
`--save` still test all proposals. `delivery-quality.test.ts` now checks the
actual public package against the current runtime catalog, in addition to the
synthetic gate fixtures and independent native placement/movement tests.
