# Grenade Collision And Jump-Throw Audit

See the [follow-up](grenade-lineup-followup-2026-11-06.md) for the subsequently
found Prefire loader omission, eight-second expiry and residual-contact fixes.

## Source And Method

Installed CS2 build **2000942**, patch 1.41.9.6, SourceRevision 11206718,
November 4, 2026. Static-file inspection and isolated arithmetic only: no game
process access, DLL loading, hooks or gameplay automation.

- Client SHA-256: `9279421852772522121be2f13409dd37436e8c809ff48898c8c3d41b09e77844`.
- Dust 2 VPK: `51d6bb432b6553bfae6c38219a527c5de2464a2b107080f2b8be7d8427ebb885`.
  It is byte-identical to the VPK used by the existing 2000932-tagged world export;
  that older export is not relabeled as a freshly extracted world.
- Dust 2 PHYS: `d31ef6c5ae4c60d1b2d242ecb9e938b7bad5ab72015c6523109f697f2c6abd41`.
- Missing Dust 2 clip: `maps/de_dust2/entities/unnamed_2_23513_7490.vmdl_c`,
  SHA `ec34fd1e34c812cedb2885744de98f711f802be345e93153fd0c67d3e37befb6`.
- Mirage native VPK/PHYS/extractor identities remain in `mirage/coverage-plan.json`.
  Every supplemental brush model, entity-lump SHA, source transform and extractor
  SHA is recorded in its generated, ignored `grenade-collision.json` manifest.

`build-grenade-map-collision.mjs` statically decompiles the native entity lump,
selects enabled solid brushes outside skybox groups, extracts each model's PHYS,
transforms hull/mesh vertices by native origin/angles/scale and then converts
`[x,z,-y]*.0254`. It refuses a world/VPK identity mismatch. Native entity geometry,
the query snapshot and other assets remain outside Git. Triggers are not solids.

## Corrections

1. The old importer used world PHYS without separate brush-entity physics. The
   grenade archive adds enabled `func_brush` and `func_clip_vphysics` models.
   Initial extraction includes three Dust 2 brushes and nineteen Mirage brushes.
2. Duel grenades previously queried the sliced combat world. Long/high throws
   could leave its padded bounds and miss native roof/clip surfaces. Grenades now
   query complete-map geometry, independent of player/bullet chunk collision.
3. Grenade masks also honor the native `csgo_thrown_grenade` exclusion. The active
   extracted map groups do not currently use this exclusion; no measured landing
   improvement is attributed to that defensive correction.
4. The old release path always sampled the live delayed-release pose. The native
   jump path schedules a pose capture at jump time + float32(.1), then uses the
   cached vectors for strictly positive age up to float32(.2). The early-release
   branch can defer once by another .1 s. The shared motor now reports actual
   accepted takeoff time; airborne jump presses do not schedule a fake latch.

Current native code locations: jump schedule `0x8e9b32..0x8e9b7a`; capture
`0x8e7760..0x8e78c4`; cache gate/copy `0x8cea9c..0x8ceb4c`; look-ahead predicate
`0x8da6d0`; one-time early deferral `0x7d7d33..0x7d7d9d`.
Schema fields: movement `m_fStashGrenadeParameterWhen` (+0x684); pawn
`m_grenadeParameterStashTime` (+0x1f20), `m_bGrenadeParametersStashed` (+0x1f24),
`m_angStashedShootAngles` (+0x1f28), `m_vecStashedGrenadeThrowPosition` (+0x1f34),
`m_vecStashedVelocity` (+0x1f4c).

`verify-native-grenades.py` rechecks fifteen launch cases against current client
`0x7c82f0..0x7c86fa`. `verify-native-grenade-latch.py` executes ten isolated native
age-gate/vector-copy cases and records the constants/fields above. It supplies
elapsed time and cached vectors explicitly, not a whole native movement session.
The trainer samples its authoritative motor at capture time; no guessed fixed
vertical speed, launch compensation, changed gravity or landing-point nudge is used.

## Loading And Regression Coverage

Query worlds are built offline, engine-versioned and content-addressed. Resident
chunks share one reference-counted restored world per map, not a new full-map
triangle build every round. Persistent CacheStorage retains these bytes.
The snapshot is fetched/decoded lazily only when its query world is not already
resident; later chunks borrow that world without decoding its large buffer again.
Original combat collision snapshots, movement and physical shot calculations are unchanged.
Tests cover retained query lifetime, foreign/corrupt snapshots, separate movement/
bullet masks, transformed brush filtering, real native clip probes, boundary-free
grenade queries, late/early jump releases and single/multiple-map round selection.

## Remaining Limits

This is not a claim that every smoke lineup now matches CS2. The reported Mirage
instant/regular Window and Dust 2 T-base door throws still require matched-build
captures with exact start, view and input clocks. Current native cache fixtures
do not certify the complete command-backlog or movement/collision state machines.
Rapier shape queries are not Rubikon; dynamic doors, moving supports, breakable
glass, special contact branches and native residual-contact ordering remain gaps.
The complete-map query world also does not make out-of-chunk visuals/movement
playable. Smoke volume/bloom remains a browser approximation.

Independent research leads, not installed-build authority:
[CSNADES Window setups](https://csnades.gg/guides/mirage-instant-window-smokes),
[Memorin's jump-latch measurements](https://memorin.app/mechanics/jump-throw),
and [the offline smoke-solver design](https://github.com/NC1107/cs2-smoke-solver/blob/master/DESIGN.md).
The latter two helped identify where to inspect; their historical measurements
were not substituted for current installed code or used as fitted constants.
