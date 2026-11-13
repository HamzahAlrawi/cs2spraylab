# Named Common Pockets, Not Just More Records

## What Was Missing

The previous expansion reused many nearby coordinates without proving that each
important **tactical pocket** was represented in a useful clear. More records
were not sufficient. The independent checklist now names 23 Dust 2 and 24 Mirage
pockets and maps them to specific approaches and admitted source anchors.
`common-angle-pockets.json` contains the references and authored native review
volumes. `common-pocket-coverage.json` contains the reproducible route/angle
mapping and explicit per-approach gaps. Neither is a match-frequency dataset or
a substitute for the separate full map-acceptance brief.

Two concrete problems were found:

- Mirage Ramp ended at the entrance to A. It could not see several Shadows,
  under-Palace, Ninja and deep-box holds. The walking clear now continues through
  the site, with 13 native-supported waypoints instead of five. This admits 35
  additional approach/hold assignments after the initial source expansion.
- Underpass started after the House stairs, already in the long exposed
  corridor. Its covered start now precedes those stairs and includes the native
  walking descent. Market also continues toward Bench instead of ending in the
  middle of the site. No jump/drop exception or movement constant was introduced.

The roster selector had a separate coverage problem: only the first few named
groups received reserved slots when there were more groups than bots. A seeded
shuffle now rotates the named pockets between reps. Up to three of the default
four slots are drawn from feasible common-pocket groups; the last remains a
free weighted draw. This is explicit **training coverage**, not an assertion
that a real opponent occupies one of those pockets every round. Overlapping
community variants share a family ticket; the five-opponent cap is unchanged.

## Sources And Rights

The checklist was written from callout/tactical references before matching
admitted coordinates. Source descriptions and images are not copied into the
app. These references identify what to check, not exact pawn feet:

- [Total CS Dust 2 callouts](https://totalcsgo.com/callouts/dust2) and
  [Mirage callouts](https://totalcsgo.com/callouts/mirage): common named geography.
- [Dignitas Dust 2 defending setups](https://dignitas.gg/articles/ct-side-defending-tactics-for-de_dust2)
  and [A-site attacking/holding](https://dignitas.gg/articles/dust-2-offensive-strategies-taking-a-site):
  Pit/car/site/Goose, B headshot cover and doors/Window, Short and rotations.
- [Dignitas Mirage defensive setups](https://dignitas.gg/articles/dominating-on-mirage-advanced-ct-side-setups):
  Window, under Palace, site boxes, Van/Bench/back pillar and arches.
- [Refrag's Mirage B-anchor guide](https://refrag.gg/blog/how-to-anchor-b-on-mirage/):
  Apps/Short approaches and Bench, Van, GeT_RiGhT and Jail cover.

The Dignitas articles are historical CS:GO strategy references, not evidence of
current CS2 geometry, timings, mechanics or exact popularity. Current native
collision determines whether a coordinate can be used. Several pages or forks
from the same author are not counted as independent observation corpora.

Additional numeric candidates come from two pinned GPL-3.0 repositories:

| Map | Repository / Revision | Records / Input SHA-256 |
| --- | --- | --- |
| Dust 2 | [NeuTroNBZh/CS2-RETAKE](https://github.com/NeuTroNBZh/CS2-RETAKE/blob/9123adca1371ff4cbe90a4630a1ff113124ae8df/CS2Retake/spawns/de_dust2.json), `9123adca1371ff4cbe90a4630a1ff113124ae8df` | 52 candidates; `d0fd8a0319408f02296923d0806f28529806d60a42b0e79bd90a12c24da6cf4c` |
| Mirage | [splewis/csgo-retakes](https://github.com/splewis/csgo-retakes/blob/9aae1570ff4c13b2b501a6f336562486c40d3c81/configs/retakes/de_mirage.cfg), `9aae1570ff4c13b2b501a6f336562486c40d3c81` | 38 legacy coordinate candidates; `aa2a2361a6b8d5b5026b5547e950a85ad2c8d2eeb2ffc655877cedc71cadabf2` |

The full notices, source file paths, original team/site, record indices and exact
XYZ/rotation remain in the imported bundles and Angle sources disclosure. Reusing
retake positions as preplant defenders is an authored tactical adaptation, not a
recorded opening setup. Legacy Mirage **coordinates only** were considered;
no CS:GO mechanics/constants were substituted for CS2.

The other CS2-RETAKE Mirage file was also surveyed: only eight of its 52 records
fit the current same-floor native hull. Static `MapManager.cs` teleports those
positions directly and provides no authority to subtract an eye-height offset.
Its unsuitable records were rejected, not moved down 64 units to manufacture a
pass. The rejected survey remains local, outside Git.

## Delivered Coverage

| Map | Previous identities / assignments | Now |
| --- | ---: | ---: |
| Dust 2 | 212 / 375 | 256 / 453 |
| Mirage | 197 / 341 | 221 / 412 |

Identities are source records, not necessarily distinct physical corners. New
Dust 2 variants include CT under Short, B default/big-box faces, B back platform,
Window-side cover, car/cross, A site/Goose and Catwalk/Mid. Mirage adds independent
site-box, Chair/Mid, Connector, Bench/GeT_RiGhT and archway records, and admits
existing source anchors that become useful along the longer Ramp/Underpass clears.

All 47 checklist pockets have at least one mapped approach. The committed gap
list deliberately retains the following unfulfilled **approach-specific** views:

- Palace balcony: Sandwich and rear Firebox.
- Jungle retake: the selected Palace balcony pocket.
- Underpass-to-Connector: the selected Ladder-room pocket.
- Market retake: the selected raised Van pocket.
- Apartments balcony: GeT_RiGhT, Short arches, Market Window and Market Door.

Those pockets have coverage from other listed approaches. In particular, staying
on the Apartments balcony is not the same exercise as dropping into B. Palace
and Apps drops remain a separate traversal/admission task, not a reason to relax
the standing-head-visibility gate or create invisible cover. Other off-angles,
native-capture comparisons and full-map acceptance remain open. Dust 2 stays
provisional and Mirage stays Beta.

## Native Authority And Reproduction

Rechecked installed CS2 **2000943 / 1.41.9.7**, SourceRevision **11228971**, November
11, 2026. Static archive hashes are unchanged from the earlier exports:

- Dust 2: `51d6bb432b6553bfae6c38219a527c5de2464a2b107080f2b8be7d8427ebb885`.
- Mirage: `e66cdf1ae6a976f6f6ba510a2addd04b25a4c1cfd811f51f1ef13f0954e6e350`.

Existing export build labels are preserved. No running game, process memory,
DLL execution or hooks are used. New sourced XY, rotation and stance remain
unchanged; only the existing bounded six-unit local support correction is allowed.
Walking paths are explicitly authored. Both stances, the shared full-speed actor
motor, protected entry, native hull/support and standing head-shot visibility
are checked before publishing holds.

```powershell
node tools/import-community-retakes.mjs
node tools/extend-mirage-clears.mjs --apply
node tools/expand-mirage-coverage.mjs --apply
node tools/build-prefire-pools.mjs --save
node tools/build-common-pocket-coverage.mjs --apply
node tools/audit-native-materials.mjs
node tools/build-prefire-pools.mjs --quality-output=public/revamp/maps/dust2/quality.json
node tools/pack-prefire-quality.mjs public/revamp/maps/dust2/quality.json public/revamp/maps/dust2/quality.json.artifacts.json
node tools/validate-prefire-map.mjs --quality=public/revamp/maps/dust2/quality.json --artifacts=public/revamp/maps/dust2/quality.json.artifacts.json
```

Then rebuild changed indexes, Duel courses, navigation and content-addressed
delivery, followed by fresh Mirage native evidence and a new beta receipt.
Keep the old receipts and changelog entries. Do not relabel stale proof.
Placement/LOS search, navigation baking and source processing are offline; no
map geometry, texture detail or maximum live bot count is increased in this work.
Game assets, raw inputs, screenshots and diagnostic output remain ignored.

## Validation And Limits

- `npm run check`: 7,051 Vitest tests in 309 files, five map-tool tests,
  admission source checks, TypeScript and the production build passed. Six
  additional Node audit/packaging tests and four source-corpus tests passed.
- Dust 2: all 453 published assignments passed strict exact-placement, entry,
  walking, full-speed motor and head-visibility checks. The separate material
  audit passed 72 cases. The complete hashed proof bundle passed the independent
  validator, including after packaging its unchanged proof bytes for delivery.
- Mirage: the new source-pinned beta receipt has 428 passing basic native cases.
  Old receipts are retained. This does not grant full map approval.
- Six 180-second canonical-roster combat diagnostics covered Ramp, Underpass and
  Market at seeds 7/42. All completed their routes, with zero reported failures,
  observations or diagnostics. This is not every hold/skill/count combination.
- The deep-site lineup also passed bot contracts, but its non-shooting audit
  walker stops behind the living Ninja holder in the narrow box lane. This is
  retained as an incomplete-traversal diagnostic, not silently marked passed.
  A player must clear that holder before continuing. The native supported path
  and pre-contact head-shot admission remain independently checked.
- The first short combat report exposed an obsolete rifle-only 225-unit speed
  audit limit: equipped utility uses 245 in the current trainer. The audit now
  bounds displacement using actual active equipment and previous switch momentum,
  with malformed/unbounded commands still rejected. No gameplay movement was
  retuned; this is not a measurement of native CS2 utility movement.
- Five fresh browser contexts exercised the extended Ramp/deep-site lineup,
  House stairs, Market, Dust 2 Short and mobile Ramp. Physical movement, route
  arrows, nonblank canvas pixels and no horizontal overflow were checked, with
  no page/HTTP errors. A real simulated rifle shot registered a headshot on the
  Shadows holder from a supported route view. Mobile locomotion and complete
  native-CS2 rendering/trajectory parity are not claimed.
