# Playable wins and network-free map revisits

## Behavior

Winning ends the scored fight exactly once. The winner can continue moving,
aiming, jumping, crouching, shooting, reloading, switching equipment and using
the environment during the result countdown and while the next native chunk
is loading. The existing physics, shot coordinates and weapon calculations
are reused; there is no separate approximate movement implementation.

Coaching, XP, kill/damage totals, completion time and the fight recording stop
at the result. The final firing tick retains its authoritative result pose;
later free-play frames interpolate normally. Losses and draws do not restart
combat. Escape suspends both free play and the countdown.

Native next-round preparation is now separate from activation:

1. Keep the active map/simulation attached and playable.
2. Await the existing prepared slot, or load and warm the selected next chunk
   without consuming or attaching it. Do not download a second copy of an
   already in-flight preparation.
3. Once ready, perform the existing brief staged actor/shader handoff, retaining
   capture and the previous framebuffer rather than a blocking loading overlay.
4. Resume the new fight. Settings changes/disposal cancel the pending stage;
   pause is preserved through activation.

A failed preparation leaves the current range playable. Automatic transition
and background-preload retries stop; an explicit Retry next round action is
required. This avoids a frame-by-frame or periodic request loop on failures.
The final actor/scene activation still requires a brief bounded handoff; it is
not claimed that browsers can simultaneously simulate two rounds without any
frame-time cost.

## Map traffic

The large content-addressed resources already had verified memory/disk caches,
but `chunk.json` was requested again whenever a chunk needed decoding, and
`context.json` was requested once per page. These small requests still count
as network traffic even when browsers return 304 responses.

`map-manifests.json` now ships the eight small root chunk manifests and shared
context metadata with the application release. `localChunkManifest` and
`localMapContextManifest` perform synchronous, validated, network-free lookup.
Geometry, navigation, visibility, radar, round data and texture bundles remain
separate SHA-256-addressed assets, loaded through the existing quota-aware
verified byte cache. No verification or geometry data is weakened.

Both the delivery and distant-context authoring tools regenerate the snapshot.
To refresh or check it explicitly:

```powershell
node tools/build-map-manifests.mjs
node tools/build-map-manifests.mjs --check
```

The application release pins which assets it uses; changed map bytes get new
hash URLs. Revisited chunks with intact verified storage require no map HTTP
requests, even after a page restart. A genuinely new asset version, cleared or
browser-evicted data, unavailable/private-mode storage, corruption, or quota
exhaustion can require downloading missing bytes again. This is a browser
cache, not a promise of permanent storage or zero application-update traffic.

## Verification

- Unit tests cover post-win input/weapons, immutable completion/score/replay,
  pause, losses/draws, non-consuming prepared-map ownership and cancellation.
- Existing immediate-combat tests verify same-tick lethal results and the
  authoritative first result pose.
- Manifest tests cover pinned native fields, version/corruption rejection,
  zero metadata I/O and export freshness. Eight authoring tests verify exact
  compressed/decoded pins and that public geometry is never rewritten.
- `tests/next-map-preloading.spec.ts` downloads all eight chunks, disposes their
  decoded scenes, waits for local writes, disables HTTP caching, reloads the
  page and blocks **every** `/maps/` request. All eight then load in reverse
  order with matching collision hashes and visible context: **zero requests**.
- Browser tests deliberately delay next-round preparation and exercise mouse
  aim, movement, fire, reload, equipment changes, pause/resume, retry and capture.
  A mobile case taps to shoot while preparation is pending. Completed scores
  and recording counts are compared before/after free play.

Changelog additions preserve historical entries. This task does not deploy.

Final validation: `npm run check` passed (219 files / 4,137 tests, followed by
the production build). Eight manifest-authoring tests passed. The clean final
desktop/mobile chunk and lifecycle run passed 13 cases; 11 platform-specific
cases were explicitly skipped. A separate final delayed-win visual capture
also passed and showed the live range without a blocking loading overlay.
