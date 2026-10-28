# Weapon Switches and Dust 2 Guidance

## Weapon Presentation

Duel/Prefire previously parsed a new GLTF, prepared cosmetics, rebuilt animation actions,
and disposed the old first-person rig on every slot switch. Range already cached rigs,
but still repeated shader warmup for hot switches and removed the visible weapon before
a cold replacement was ready.

Both engines now retain up to three prepared GPU assemblies. A hot selection attaches
the existing rig synchronously. Cold replacements attach only when ready, and stale
selection requests cannot overwrite a newer one. Concurrent requests for one weapon
share its pending load. Cosmetic revisions reject and dispose stale completions.

Carried primary, sidearm and knife prepare sequentially during menu/paused time, using
browser idle callbacks where available. They do not all decode at once, and no new
background preparation begins while training is active. An already-started browser
decode is not cancellable. Zeus, pickups and newly chosen loadout weapons can still
have a cold-load cost; this is not a promise of zero first-use latency.

Only newly prepared assemblies warm shaders. Inactive models leave the render scene.
LRU eviction, cosmetic invalidation and engine shutdown dispose rigs, native animation
mixers, skeletons and GPU resources. Late loads cannot revive a disposed engine.

Ammo, recoil, movement, deploy/fire permissions and native animation timing remain owned
by the existing simulation. Inspection can still interrupt weapon presentation without
making the weapon fire before its gameplay draw delay expires.

## Floor Arrows

Clean entries and Under pressure presets previously forced `routeGuide: false`. Route
guidance is now independent of all difficulty presets, on by default, and its checkbox
is beside the route selector rather than inside an advanced disclosure.

Legacy saved configurations matching those presets get their arrows restored once.
Old explicit opt-outs cannot be distinguished from the former preset side effect.
New saves include a storage-only `routeGuidePreference: 1` marker so subsequent explicit
opt-outs persist. Custom legacy setups and unrelated combat/progression settings remain
unchanged. The marker is excluded from simulation configuration and setup scoring keys.

## Regression Coverage

- Unit checks: deduplicated/cancelled idle queues, no active-session preloads, optional
  load failures, synchronous hot rigs, stale selection/cosmetic loads, bounded eviction,
  exact-once resource disposal, preset independence and storage migration.
- Browser checks: actual native cached assemblies in Range/Duel on desktop and phone,
  no additional model requests on repeated hot switches, inspect during draw, remaining
  fire delay, actual Dust 2 arrow geometry, preset changes and persisted opt-out.
- Existing cosmetic, glove, muzzle/tracer, cache-limit and route-preset workflows are
  rerun alongside the full unit/build check. Screenshots are in ignored `research/`.

No push or deployment is included in this change.

## Validation Results

- `npm run check`: 177 files / 3,569 tests passed, then production build passed.
- Desktop switch, native inspect/readiness, controls and navigation checks: six passed.
- Phone switch/navigation/preset checks: seven passed, three desktop-only cases skipped.
- Native cosmetic/glove, world-cache bounds, firing effects and preset workflows: five
  checks passed. The cosmetic helper now waits for the lazy engine import and enlarges
  the timing buffer rather than racing a cold page load.
- Installed Brave and Opera GX: six additional switch/guidance checks passed.
- `git diff --check`: clean. Existing large production-chunk warnings remain.
