# Native Wall And Floor Contact

## Scope And Authority

Fix trainer query/contact errors affecting diagonal movement, not map art or
weapon mechanics. No collision mesh is simplified, smoothed, rescaled or replaced.
Installed `steam.inf` was read on November 7: build 2000942, patch 1.41.9.6,
SourceRevision 11206718. The installed `server.dll` SHA-256 was rechecked:
`70c66e850b2ce72c8c7ca026de6989ef4de7f12dad64ec503645fbd2a7f06d9f`.
Inspection was offline/static only; no game process, DLL execution or hooks.

Native mesh provenance retained by the regression witnesses:

| Export | Recorded Build | `sourceSha256` | `collisionSha256` |
| --- | --- | --- | --- |
| Mirage `maps/de_mirage/world_physics.vmdl_c` | 2000942 | `c0c1423bf3ade3e5e65495299a4cb76147ef0487ec31170c9ee0d3acb5968a9b` | `6253487f363acf4b1b5bd2e8af0468a8fc29814ec36e564a8643f4645da88352` |
| Dust 2 existing native export | 2000932 | `d31ef6c5ae4c60d1b2d242ecb9e938b7bad5ab72015c6523109f697f2c6abd41` | `395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396` |

The existing importer/export manifests supply those fields. The older Dust 2
export is not relabeled as current-build evidence. This iteration does not
retune native movement arithmetic or claim complete Source 2 contact parity.

## Reproduced Defects

1. `NativeMapCollision.sweep` backed away along the movement direction after a
   wall hit. This does not maintain a reliable perpendicular gap. Subsequent
   float32 mesh casts could repeatedly return near-zero time-of-impact and
   triangle-edge normals, consuming all slide iterations. A clear square hull
   moving diagonally against a tessellated 1.57-radian wall traveled only
   0.594 m of the requested 4 m tangent displacement, with 136 near-stalled
   updates out of 160. The corrected witness travels 4.001 m with no stalls.
   Across six angles and two world-coordinate offsets all twelve simple-wall
   witnesses retain progress without crossing the wall.
2. `moveOnTerrain` accepted footprint support as sufficient to lower the body.
   A real Mirage witness then placed the hull inside nearby geometry. Ground
   snapping now requires full hull clearance at the destination, except for
   unchanged-height support within the existing contact epsilon.
3. A rejected ground snap can expose an earlier missed tiny uphill contact:
   the vertical query selects a lower plane because the correct one is just
   above its support tolerance. Recovery uses the actual up/forward/down step
   path, with wall, ceiling, height, actor-support and landing-fit checks.
   It may replace an invalid ordinary result at equal horizontal progress;
   it does not teleport the player upward or enlarge the 18-unit step limit.
   Grounded step probes also accept a blocking contact with a slightly negative
   Y normal: a crouched Mirage Apartments floor seam returned such a normal and
   previously suppressed the valid step path entirely. Ceiling and landing
   clearance still decide whether that path is usable.

## Boundaries

- Wall queries keep a one-millimetre **perpendicular** clearance. This is a
  measured trainer numerical tolerance, not an extracted CS2 convar. The square
  hull remains 16 units half-width with 72/54-unit stance heights.
- Floor/ceiling query retreat, vertical support tolerance and standable-normal
  thresholds are retained. A trial with nonzero cast target distance regressed
  uphill support and was rejected; it is not part of the delivered change.
- Bullet rays/penetration, grenade sweeps/snapshots, corpse queries, mesh assets,
  physics masks, sensitivity, acceleration, friction and jump constants are
  unchanged. Cached map resources and prepared collision worlds remain reusable.
- Rapier provides static queries only; the existing shared motor still owns
  movement. Its [character-controller documentation](https://rapier.rs/docs/user_guides/javascript/character_controller/)
  explains why contact clearance matters, but does not establish CS2 parity.
  No generic Rapier controller or unrelated movement tuning was substituted.

## Validation

New regressions cover diagonal slides at six wall angles at zero and world-scale
offsets, standing/crouched subdivided floor seams and small lips, denied/accepted
ground snaps, and full shared-motor native Mirage/Dust 2 witnesses. The native
witnesses assert hull clearance through the movement sequence, not just final
distance. Existing native slopes, stairs, crouch transitions, Mid-box support,
bot excursions and route admission remain required checks.

The exploratory native-wall scan also encounters real corners and intentional
obstacles; its stalled totals are not a count of bugs and are not used as a
success metric. Raw local probes stay under ignored `research/`. Remaining
native-capture trajectory/contact comparisons and map acceptance gaps are not
closed by these trainer regressions.

The complete strict shipped-pool audit was rerun with:

```powershell
node tools/build-prefire-pools.mjs --quality-output=research/wall-slide-pool-quality.json
```

All ten approaches and 347 route/position memberships passed; none were rejected.
Only the two changed implementation hashes in the shipped pool certificate were
refreshed after comparing them with the new native report. Coordinates, routes,
selection weights and pool membership are unchanged. This is a
revalidation of the shipped pool, not a new candidate-discovery pass or a claim
that encounter probabilities are measured. The separate broader material and
empirical-evidence gates remain missing/authored-only; Dust 2 stays provisional.

Final validation passed: 6,932 tests in the main shard plus all 75 slow route
tests (7,007 total across 308 files), five admission-tool tests, all 212 Mirage
native admission cases, the production build and the source-only asset check.
Desktop/mobile Chromium passed nine applicable map-flow, movement, render,
cache and cancellation cases; five desktop-only duplicates were skipped.
Earlier failing trials were corrected and the affected checks rerun; they are
not used as acceptance evidence.
