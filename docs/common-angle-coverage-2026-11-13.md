# Common-Angle Coverage Expansion

## Scope And Evidence

This iteration expands existing maps; it does not approve either map as complete.
Dust 2 remains provisional and Mirage remains an explicitly labeled beta.
Positions, training coverage and encounter probabilities are separate concerns.
The existing Dust 2 regional-support policy is unchanged; Mirage still has no
measured encounter-frequency corpus. No match percentages were invented.

Independent references reviewed on November 13:

- [Total CS Dust 2 callouts](https://totalcsgo.com/callouts/dust2) and
  [Mirage callouts](https://totalcsgo.com/callouts/mirage): spatial coverage and
  authored labels, not reusable numeric coordinates or popularity estimates.
- [Refrag's map callouts](https://refrag.gg/blog/cs2-map-callouts/) and
  [Mirage B-anchor guide](https://refrag.gg/blog/how-to-anchor-b-on-mirage/):
  distinct approaches, passive/active site cover and rotation context. No media,
  proprietary training coordinates or descriptive passages are copied.
- [EliGE's Mirage prefire guide](https://www.youtube.com/watch?v=S9fe6AgxVHs)
  remains an expert-review lead in the independent map brief. This iteration
  does not invent a frame-by-frame VOD or native-capture review.

Callout references establish areas to inspect, not exact pawn feet. The actual
new coordinates come from the following pinned reusable sources:

| Source | Identity And Use |
| --- | --- |
| [OpenPrefirePrac](https://github.com/lengran/OpenPrefirePrac/tree/44fb66eab70fb3b1b7112ed3c30cc68fb977dd26/maps) | MIT, `44fb66eab70fb3b1b7112ed3c30cc68fb977dd26`; checked latest upstream revision is unchanged. Additional compatible profile/approach assignments retain exact XYZ, rotation and stance. Forks with the same profiles are not counted as independent evidence. |
| [CS2 Retakes](https://github.com/B3none/cs2-retakes/tree/2fde4a9cc21e791d6909b98bacc833aa5c54bdad/RetakesPlugin/map_config) | GPL-3.0, `2fde4a9cc21e791d6909b98bacc833aa5c54bdad`; latest revision is unchanged. Mirage's 33 records are now imported with its own source ID. Dust 2 adds previously unused coordinates. Their original team/site remain in the source bundle; reuse as defensive holds is an explicit authored adaptation. |
| [Dust 2 Duel Density](https://github.com/GameOperator13/cs2-dust2-duel-density/tree/04f94b0ad6600c39f019bf65f46a08b13cdce3f1) | CC BY 4.0 metadata, derived from OpenCS2; eight additional exact event/role coordinates. Combat locations are not hold-frequency measurements. Source and prior-corpus overlap remain as documented in the October 23 audit. |

Mirage retakes input SHA-256:
`0cd61abe8f89e0c397638795b105d99a9112aa91ec49d0ee3feca8a125609fd6`.
Dust 2 retakes input SHA-256:
`14be96e805553f9bf6026ddbecb51b56c4bfe2b55b185ce946e76a9c2968c3de`.
Dust 2 combat CSV SHA-256:
`61d1471513107aa511cb395c7954a618e351087f3f527c9b35edff090c15b134`.
Complete source license notices remain available through Angle sources. Names
and tactical behavior are trainer annotations, not labels supplied by the exports.

## Coverage Changes

| Map / Approach | Before | Now |
| --- | ---: | ---: |
| Dust 2 Outside Long / pit | 28 | 29 |
| Dust 2 Long to A | 53 | 58 |
| Dust 2 Catwalk to A | 50 | 58 |
| Dust 2 Upper tunnels to B | 36 | 37 |
| Dust 2 B retake | 37 | 37 |
| Dust 2 Mid to CT | 28 | 35 |
| Dust 2 Lower tunnels | 31 | 34 |
| Dust 2 A retake | 50 | 51 |
| Dust 2 CT mid push | 22 | 24 |
| Dust 2 Upper tunnels | 12 | 12 |
| Mirage Ramp to A | 18 | 26 |
| Mirage Palace | 29 | 40 |
| Mirage Apartments | 21 | 21 |
| Mirage Top mid to Short | 46 | 53 |
| Mirage Underpass to Connector | 33 | 45 |
| Mirage Market retake | 53 | 54 |
| Mirage Short to B | — | 65 |
| Mirage Jungle to A retake | — | 37 |

These counts are **approach/hold assignments**, not independent population
observations or necessarily distinct physical corners. Dust 2 now has 212 source
identities / 375 assignments (previously 197 / 347). Mirage now has 197 source
identities / 341 assignments (previously 151 / 200). Existing source anchors and
walking approaches are retained; the two new Mirage approaches are separately
authored, native-supported walking spines rather than new random rosters on an
old route. No geometry, movement, aim, spread or grenade physics was retuned.

Dust 2 additions include Short stairs/platform, Xbox ledges, CT under-A corners,
the B tunnel exit lip and Side Pit crossing. Mirage additions include site-box
variants, Stairs, Ticket, Jungle, Connector and Short. Four named five-bot Mirage
lineups make the additions selectable directly. Nearby overlapping Mirage
variants share an authored exclusion family so a corner does not earn additional
selection tickets just because another source recorded it.

The new Short-to-B approach begins before the Catwalk corner and walks into B.
The Jungle retake begins in Jungle cover and clears onto A. These also become
eligible Duel courses when their complete paths fit inside a native chunk.
The shared five-opponent cap remains; source discovery, lane search and
navigation baking happen offline, not on a browser frame or round-start scan.

## Native Authority And Admission

Installed CS2 **2000943 / 1.41.9.7**, SourceRevision **11228971**, November 11.
Only static files are inspected. No game process, DLL execution, hooks or
automation are used. The map archives remain byte-identical to the existing
exports; their older build labels are preserved rather than relabeled:

- Mirage VPK: `e66cdf1ae6a976f6f6ba510a2addd04b25a4c1cfd811f51f1ef13f0954e6e350`.
- Dust 2 VPK: `51d6bb432b6553bfae6c38219a527c5de2464a2b107080f2b8be7d8427ebb885`.

New candidates must retain source XY/stance/rotation, meet the existing bounded
six-unit support adjustment, fit the native hull, stay concealed at the protected
entry and offer a supported standing head-shot lane. New Mirage additions also
use the conservative 64-unit entry margin. Both walking stances and the shared
full-speed motor are exercised. Unsupported candidates remain rejected; there
is no horizontal nudging, new invisible cover or relaxed contact threshold.
The legacy Mirage beta's existing holds are retained under its basic gates,
not retroactively claimed to have passed the stricter discovery margin.

Palace dropping and the full CT Palace push remain outside guided coverage.
Some source positions cannot be used from the current Apartments balcony walk.
Common-angle completeness, measured occupancy and matched-build human/native
capture review remain open; a successful static ray is not a completed map.

## Reproduction

```powershell
node src/range/prefire/data/import-retakes.mjs --map=mirage
node tools/expand-mirage-coverage.mjs --apply
node tools/expand-mirage-coverage.mjs --add-approaches --routes=short-b,jungle-a --apply
node tools/expand-mirage-coverage.mjs --metadata-only --apply
node tools/build-prefire-pools.mjs --save
node tools/audit-native-materials.mjs
node tools/build-prefire-pools.mjs --quality-output=public/revamp/maps/dust2/quality.json
node tools/validate-prefire-map.mjs --quality=public/revamp/maps/dust2/quality.json --artifacts=public/revamp/maps/dust2/quality.json.artifacts.json
```

Then regenerate each changed map's index, Duel round data, navigation and
content-addressed delivery. Refresh Mirage's native/beta proof only after the
final source and package hashes are stable. Do not rerun the original Mirage
authoring recipe over reviewed paths. Assets and raw corpora remain ignored.
The normal Mirage asset-package command now consumes the committed reviewed
catalog; it no longer silently replaces it with the original six-route baseline.
The browser packaging test caught the old Dust 2 quality bundle after the
catalog revision changed. The newly audited report and its original hashed
native/material artifacts are now published together; no route keys or proof
hashes were relabeled to bypass the gate.

The native bot diagnostic was also corrected: hidden pre-aim must come from
retained evidence/static course openings, with finite bounded motor commands;
supported dense route views are valid watch points; an exposed body can be seen
even with its head occluded. The old fixed-turn/head-only mirror produced false
failures and is retained in the earlier local report, not advertised as a bot
regression or silently labeled passed. Dedicated unit tests check these audit
contracts. The short combat run is diagnostic, not the complete map-admission
skill/count/seed matrix or a native-CS2 AI certificate.

## Validation Results

- `npm run check`: 308 Vitest files / 7,046 tests, five map-tool tests,
  admission source checks, TypeScript and the production build passed.
- Dust 2: all 375 delivered holds passed the strict pool/native admission;
  the published quality bundle and its hashed native/material artifacts passed
  the independent package validator. The material audit covered 72 cases.
- Mirage: 357 native admission cases completed without findings. The refreshed
  beta receipt is source/package pinned; it does not promote the map to approved.
- Four 30-second combat diagnostics across the two new approaches and seeds
  7/42 completed without failures. This is not the full acceptance matrix.
- Fresh Chromium contexts entered both new Mirage routes and Dust 2 Mid;
  mouse/keyboard movement, route arrows and live actors worked without page or
  HTTP errors. A Pixel 7 viewport also entered Short to B without horizontal
  overflow. Screenshots were inspected; mobile locomotion was not claimed.
- Four source-corpus regression tests and four audit-contract tests passed.
  Raw data, game assets, screenshots and diagnostic reports remain local/ignored.
