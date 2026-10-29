# HE explosion smoke

## Source evidence

Installed CS2 build **2000938**, patch **1.41.9.3**, revision **11181008**.
Offline Source2Viewer 20.1 extraction only; no game process access.

- `game/csgo/pak01_dir.vpk` SHA-256:
  `b32a45c66eff785aa4b9b4e5564e36ac0639942074a9c27b765eab74e5066cdb`.
- Parent `particles/explosions_fx/explosion_hegrenade.vpcf_c`:
  `6e91963270ccbf0b45d1660e075ddf43f183bad32164bc64f9f75c8749e703b5`.
- Child `explosion_hegrenade_smoke_core.vpcf_c`:
  `c524a5ac4dd49ae4f372acd8964d30897280183ba26a067b97b667b06a3d0a5d`.
- Child `explosion_hegrenade_smoke_ground.vpcf_c`:
  `feab375d0a60d79bdb42f4dc5ecf35feaca659b89f8eec400018b6522216c975`.
- Texture `materials/particle/explosion_fireballs/smoke/explosion_fireball_01_smoke.vtex_c`:
  `82db52f28029cb35818e10a311afa080a911cd37855a52af820243cd7f42fb95`.

`tools/import-he-explosion.mjs` verifies the archive/build, extracts compiled
children, parses their DATA blocks, decodes the shared texture and records exact
source hashes and fields in `he-explosion-native.json`.

The smoke core emits at 0, 0.05 and 0.1 seconds, with 1-2 second particle lives
and 90-180 Source-unit radii. Ground dust uses the authored four-particle LOD0
count, 1.5-6 second lives, 75-125 unit radii and a ring-wave initializer. Both
use fitted-lifetime frame animation. Initial offsets/speed, growth bias, alpha,
fade and color-scale fields are recorded. The compressed atlas retains five
native sequences, resampled to at most 24 frames each, at 128px per frame.

## Implementation and limits

The old renderer displayed only the central 0.25-second flare. A separate
pooled instanced smoke draw now adds expanding core billows and spreading dust.
The effect uses absolute age, so pause and backward fight-review seeks are
deterministic. All seven particles per HE share one atlas and draw; buffers
and transforms are retained, and texture upload happens before range entry.

The HE `burst` snapshot lives through the longest cosmetic tail. Damage still
happens once on the detonation tick; flash/core animation still stops at its
original time. The after-effect does not become a smoke grenade, alter bullet
coordinates, add repeat damage, or change HE clearing of smoke grenades.
Existing utility replay snapshots retain it without a new save format.

Native assets/static parameters do not establish full runtime parity. Drag,
lighting, fade interpretation, billboard motion and deterministic native-range
sampling are browser adapters. Source 2 motion-vector warping, particle shadows,
depth feathering, debris and additional blast trails are not ported. Cosmetic
HE smoke does not change the AI's smoke-grenade visibility-density model.

## Verification

Unit coverage checks native hashes/ranges, emitter timing, growth/expiry,
deterministic seeks, world anchoring, fixed buffers, disposal, instantaneous
damage and no accidental smoke-grenade density. Desktop/mobile browser tests
read actual pixels to check visible smoke after the flare, animation, a fading
tail, full disappearance and opaque wall occlusion without shader errors.

Pre-deployment results: `npm run check` passed **265 files / 6,425 tests**
and the production build. Six desktop/mobile effect, smoke-clearing and
post-death browser checks passed, followed by two enhanced live-engine checks
confirming the smoke mesh appears after a dead thrower's HE detonates.
The atlas is 931,382 bytes and 1024x1920 pixels, within a 2048px texture limit.
