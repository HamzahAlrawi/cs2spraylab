# Dust 2 CT Boxes and Site Coverage

October 18, 2026. Catalog `2026-10-18-coverage-v6`, installed collision build
`2000932`, SHA-256 `395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396`.
This is browser-only training. No game process or input automation is used.

## Coverage Defect

CT spawn, not the Mid-door boxes, was the reported missing headglitch. Two pinned
OpenPrefire samples were never proposed: `mid_to_b/24` (box ledge, crouched) and
`mid_to_b/25` (standing under A). Existing floor-level `a_long/30` did not cover
the raised box. A/B box coordinates already present on other courses were also
unavailable from the relevant approach. Upper-tunnels-to-B ended before clearing
the back-site box, so admitting that holder alone would have created an
unhittable enemy.

## Accepted Additions

All indices are one-based, pinned records. Source XY and height are unchanged;
the existing maximum six-unit native support adjustment still applies.

| Approach | Additional Admitted IDs | Increase |
| --- | --- | --- |
| Long corner to A | `a_short/11,14`, `retakes:dust2/17,21`, `mid_to_b/24`, `a_long/31` | 6 |
| Catwalk to A | `retakes:dust2/17,21` | 2 |
| Upper tunnels to B | `retakes:dust2/13,15`, `b_tunnel/18,24` | 4 |
| Mid slope to CT | `mid_to_b/24,25`, plus explicit `/24:standing` | 3 |
| CT ramp to A retake | `a_short/11,14` | 2 |

Total: **149 identities / 186 approach assignments**, up from 145 / 169. This is
17 additional assignments, not 17 new physical places: many are useful reuse of
a source hold from another approach. Three previously unused source identities
and one explicitly adapted stance account for the four additional identities.

The B approach keeps its covered tunnel start and proceeds from the original
front-site endpoint through native-supported site-floor nodes at
`[-1690,2460,11]`, `[-1688,2584,7]`, `[-1640,2820,16]`. It does not teleport the
player or move the back-site holder out of cover. Ten approaches and at most
five active bots remain. Four optional fixed lineups make CT boxes, Long/Short
A boxes and B back-site boxes deliberately selectable without waiting for a
weighted draw. Old lineup IDs are preserved.

## Standing CT Headglitch

`mid_to_b/24` is `[79.034294,2370.320801,-67.564819]`, authored crouched. The
original record remains unchanged. `/24:standing` is a local training stance
adaptation at exactly that coordinate, with `source.stanceOverride='standing'`.
It is not falsely described as an upstream standing record or a measured match
observation. Native tests require standing hull clearance, supported feet,
route-facing hittable physical heads and views where the head is clear while
torso probes through shoulder height remain behind cover.

Both variants share the `ct-spawn-box` exclusion family. They cannot spawn
together; selection coverage is allocated per family, so adding the stance
does not double the corner's coverage tickets. Their default behavior is a
stationary hold, not an invented running excursion off the ledge.

## Rejected Proposals

`b_tunnel/28` remains rejected for native placement. `mid_to_b/25` is accepted
for Mid-to-CT but rejected from Long-to-A because its head is not hittable on
that supported approach. Earlier exposed-start and unhittable proposals remain
rejected. The 64-unit cover margin, protected first 32 units, both walking
stances and full-speed motor gates were not weakened to inflate coverage.
Ninja/elevator gaps from earlier audits are not claimed solved by relabeling
unrelated holds.

## Route Arrows

Hints retain ordered checkpoints and never read enemy positions. Arrival is now
0.35 m horizontally with the existing 0.7 m vertical tolerance. Continuous
movement samples cannot clear checkpoints backwards or interpolate a vertical
teleport into success. Nearby distance labels retain decimal precision.
Off-route or wrong-level positions get a non-directional recovery cue instead
of a confident arrow through unvalidated cover. These recovery tests are
geometric heuristics, not a new navigation mesh or obstacle planner.

The floor line and batched arrow instances hide completed legs at a checkpoint
change. Static buffers are reused; no floor raycasts, model creation or geometry
rebuild is added to per-frame guidance. Reporting an old simulation cannot
change the newest round's guide. Floor arrows and HUD directions stay separately
configurable.

## Provenance

- [OpenPrefirePrac, pinned revision 44fb66e](https://github.com/lengran/OpenPrefirePrac/tree/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26/maps/de_dust2): MIT practice coordinates, orientation and stance; full local/deployed notice retained.
- [cs2-retakes, pinned revision 2fde4a9](https://github.com/B3none/cs2-retakes/tree/2fde4a9cc21e791d6909b98bacc833aa5c54bdad): GPL-3.0 authored site holds; full notice retained. Retake coordinates are not empirical CT opening probabilities.
- [Dignitas' 2019 off-angle guide](https://dignitas.gg/articles/the-ultimate-guide-to-unorthodox-positions-for-dust-ii-inferno-mirage-and-cache): historical family-level description of CT-box and B-box head-only angles. This is **CS:GO**, not evidence of current CS2 coordinates or prevalence. Current native collision and physical tests establish the implemented exposure.

Existing regional selection evidence and its limitations are unchanged. No
encounter probabilities, player-spawn statistics or live-game parity are inferred
from these authored additions. Browser startup now limits Vite dependency
discovery to the real `index.html`, avoiding authoring HTML as an application
entry; [Vite documents this development-only option](https://vite.dev/config/dep-optimization-options.html#optimizedeps-entries).

## Reproduction

1. `node tools/build-prefire-pools.mjs --save`
2. `node tools/audit-native-materials.mjs`
3. `node tools/build-prefire-pools.mjs --quality-output=research/dust2/coverage-v6-quality.json`
4. `node tools/validate-prefire-map.mjs --quality=research/dust2/coverage-v6-quality.json --artifacts=research/dust2/coverage-v6-quality.json.artifacts.json`
5. Publish only the validated generated quality report to `public/revamp/maps/dust2/quality.json`.
6. `npm run check`, plus desktop/mobile navigation, fixed-lineup and native physical-shot browser checks.

## Verification Results

October 18, 2026 local validation:

- `npm run check`: 3,507 tests across 170 files passed; TypeScript and production build passed.
- Current native pool and map quality revalidation passed with no errors; the material audit passed all 72 cases.
- Focused desktop/mobile Playwright regression run: 11 passed, one intentionally skipped mobile physical-clear workflow. Both viewport projects passed the new fixed-lineup persistence and 19-capsule standing CT headglitch checks.
- Built-bundle smoke: all nine modes on desktop and mobile, 18 checks with no recorded errors.
- Route guidance keeps existing buffers and updates visibility only on checkpoint changes. These checks establish correctness, not a measured FPS improvement or exact parity with the live CS2 engine.

This revision is local until explicitly deployed.
