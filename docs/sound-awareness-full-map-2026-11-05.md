# Whole-map sound awareness

Follow-up to `sound-awareness-audit-2026-11-05.md`. This changes map scope and
source placement, not native sound constants or player movement mechanics.

The radial source probes described below were subsequently replaced by
[continuous playable-space density](sound-awareness-density-2026-11-06.md).

## Map ownership

- Awareness loads the complete selected native map, including full collision,
  native visibility/PVS and the native radar overview. No Duel chunk, chunk bounds
  or round catalog controls the play area. The area picker is removed.
- `awareness-map.ts` owns one native scene/collision world and radar lease.
  Cancellation/error/disposal releases those resources. Independent catalog,
  geometry and radar tasks load concurrently.
- The map registry supplies the asset base, catalog and optional full delivery
  pin. Only Dust 2 is currently installed; the runtime does not branch on its ID.
- A bounded sparse acoustic graph follows supported catalog paths and nearby
  intersections. Work yields during loading, rather than flood-filling a full
  player-navigation grid on the main thread. This remains the browser acoustic
  approximation documented in the earlier audit, not native acoustic portals.
- Native collision content is unchanged. The complete collision binary has
  SHA-256 `395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396`.
  Its source resource SHA-256 still matches the installed-build audit.

## Listener-relative cues

Each new trial uses the player's current position, not the initial spawn:

1. Filter authored supported locations to within 28 meters, excluding the
   immediate two-meter personal space. Sample at most 32 of these.
2. Add at most 32 local floor probes around the listener at 3, 6, 10, 16 and
   24 meters. Reject unsupported or blocked hulls and out-of-world placements.
3. Require hidden placement and event-specific audible gain after acoustic
   routing. A 28-meter search bound does not override a quieter cue's shorter
   native distance curve.
4. Running requires a short supported, hull-walkable excursion. If the authored
   point lacks one, test bounded local alternatives through shared collision.
5. Moving more than eight meters from the unanswered trial's listener position
   cancels the old source, clears the marker and starts another local trial.

These radii and sampling choices are authored training policies, not native bot
spawn probabilities. Sources do not teleport to follow the listener during a
cue. A heard marker stays at the last heard point. Mono, replay, pause, physical
shot-ray scoring and no-combat-XP rules are unchanged. Old chunk results are
preserved but excluded from whole-map comparison statistics.

## Local delivery and caching

`node tools/build-full-map-delivery.mjs [assetId]` packages exact existing map
bytes without simplifying combat geometry. Geometry and metadata are gzip
encoded; 474 Dust 2 textures are bundled into 20 bounded packs instead of
hundreds of separate requests. The current full-map package is 81,928,564
transport bytes including its delivery index (radar is a separate shared asset).
There are 17 non-texture resources. All runtime payloads remain ignored assets.

The small checked-in map descriptor pins a hash-addressed compressed delivery
index. Payloads use the existing immutable object store and persistent Cache
Storage implementation, including checksums, quotas, eviction and in-flight
deduplication. No large data is put into localStorage or progression storage.
Updated content receives new hashes; unchanged resources keep their cache keys.
As long as the browser retains valid cached bodies, repeat loads need no network
request or revalidation. Browser eviction, disabled storage or explicit clearing
can still require downloading again. CPU decode and GPU upload are not permanent
browser storage and still run when recreating a scene.

The full-map extractor and standard asset build refresh this package. Duel
delivery cleanup retains objects referenced by the full-map pin, so rebuilding
chunk packages cannot silently delete Awareness's shared-store files.

## Regression coverage

- Full native bounds and source coverage across separate routes.
- Nearby pools follow the listener after moving far from the initial spawn.
- No sources in native voids/blocked hulls; running requires supported movement.
- Moving away invalidates an unanswered cue and does not award a false answer.
- The actual complete Dust 2 collision is exercised at every current route start
  for steps, jumping, gunfire, reload and utility source availability.
- Desktop/mobile browser tests verify the full collision hash, absence of the
  old area picker, reveal/hint/unaided behavior, physical-shot scoring and saved
  results. A page reload after flushing cache writes must issue zero `/maps/`
  requests while still reaching a playable full map.

Validation: `npm run check` passed 300 files / 6,915 tests and the production
build. A subsequent focused run passed 30 tests, including the added full-package
byte-equivalence regression. Both desktop/mobile browser tests passed, including
zero map requests on reload. Asset checks, source policy, eight map-manifest
tooling tests and whitespace checks passed. The existing build-size advisory
remains; this change does not claim native Source 2 audio-engine parity.

No deployment is included; this iteration is committed and pushed only.
