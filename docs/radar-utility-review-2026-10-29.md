# Radar, post-round utilities and compact Duel review

## Authority and boundaries

Installed CS2: build **2000938**, patch **1.41.9.3**, Source revision
**11181008**, October 28, 2026. Static inspection only. No game process,
memory, hooks or loaded game libraries were used.

Resource archive directory `game/csgo/pak01_dir.vpk` SHA-256:
`b32a45c66eff785aa4b9b4e5564e36ac0639942074a9c27b765eab74e5066cdb`.
Source2Viewer 20.1 CLI SHA-256:
`ef9f6fb3943c30b73f0991bce6654128727b0807968f7997a6bb014efbec8830`.

This iteration repairs trainer lifecycle and presentation defects. It does
not establish complete Source 2 fluid/particle or native HUD parity. Earlier
server launch/damage arithmetic fixtures remain pinned to build 2000935;
they have not been relabeled as current code-path verification.

## Radar

`tools/import-native-radar.mjs` extracts these exact installed resources:

- `resource/overviews/de_dust2.txt`: SHA-256
  `97947e99bc7930fc06dc15af3dcf942dbca5ca1c6f36119a089615fd4b383620`.
- `panorama/images/overheadmaps/de_dust2_radar_psd.vtex_c`: SHA-256
  `86c0669d0081aa5ba44954dcbde5e414dc33d2555ffebb6f538458343695e9fc`.

Metadata is parsed as KeyValues: `pos_x=-2476`, `pos_y=3239`, `scale=4.4`.
The Source reference overview is 1024 units across. Trainer coordinates are
`x=Source.x*.0254`, `z=-Source.y*.0254`. The authored `rotate` field is not a
player yaw. The delivered lossless WebP is 105,760 bytes, shared across all
chunks by content hash and the existing persistent verified byte cache.
Decoded bitmap leases coalesce loads and release the image with the last map.
The collision floor atlas remains the fallback if the overview is unavailable.

The radar renders at 216 logical pixels, with responsive smaller sizes,
circular clipping, heading cone, offscreen bearings, remembered contacts and
height chevrons. Its 48m default view span, five-second contact memory and
height tolerance are trainer presentation choices, not recovered native HUD
runtime parameters. Only actually observed hostile contacts are drawn.

## Grenades after death

The defect was an early return from `DuelSimulation.advance/step` when the
round was no longer playable. Results now stop competitive inputs and scoring,
not world time. Dropped primed and already-airborne utility continues to fall,
bounce, detonate, expire and affect surviving actors. Explicit pause still
pauses the world. The completed result, coaching and competitive recording
remain frozen; post-result events do not award a second result or XP attempt.
Next-map staging also runs after losses without immediately freezing the old
world while downloads/preparation complete.

Tests use an actual lethal shot, not just a manually toggled actor flag, for
both primed and airborne HE cases. They check falling, detonation, stable
result timestamps, no further weapon combat and explicit pause.

## Smoke displacement

The old 3m spherical cutout was smaller than the 4.2m trainer cloud, so it
removed the core but left a dense shell. Old tests used endpoints inside that
shell and a smaller synthetic render cloud, missing the visible failure.

The bounded browser adapter now uses a 5m HE cutout, one-second lifetime and
the shared smooth refill tail. Bullet holes cannot evict a larger active HE
window from the 16-hole budget. World cover still gates explosions affecting
a smoke. Both CPU visibility and GPU rendering consume the same hole data.
Regression tests put both ray endpoints outside a full-size cloud at standing
eye height, and check refill, sustained-fire budget and a sealed wall.

**The 5m/one-second envelope is an explicit approximation.** Static strings
confirm `SmokeVolumeHEGrenadeTrail_t` in the current client, but do not expose
its complete displacement solver. Neither the HE damage radius nor a particle
resource proves that solver's radius or timings. Valve documents gunfire and
explosion-responsive smoke, not these numerical values:
[official CS2 overview](https://www.counter-strike.net/cs2).

## Fire presentation

The manifest `inferno-presentation-native.json` records hashes of the exact
five groundfire child particles and their textures. The importer now retains
up to eight authored sequence variants per layer (24 frames per sequence),
native lifetime ranges, output blend/overbright values and fade/radius
operators. Center/edge/incendiary use native manual-frame progression over
particle age. Frame interpolation clamps at sequence ends instead of mixing
the final frame back into the first. Separate overlapping bounded emitters
prevent synchronized cycling; surface layers stay on supplied fire cells.
Texture URLs are content-hashed to avoid stale atlases after an update.
Atlas RGB uses WebP quality 90 with full-quality alpha (about 2.93MB total for
five layers), and textures upload during preparation rather than the first
detonation. Integer hashing replaces repeated trigonometric particle noise.

The previous color bake indexed the gradient with the red channel and averaged
the result over the source. Fire red is frequently saturated, wrongly selecting
white. The revised bake uses gamma-space BT.709 luminance and multiplicative
RGBA layer contribution in linear light, based on the maintained renderer's
interpretation of spritecard defaults:
[VRF spritecard shader](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Renderer/Shaders/particle_spritecard.frag.slang),
[layer defaults](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Renderer/Particles/Renderers/ParticleTextureLayer.cs).
This is research from the primary tool implementation, not an executed Valve
shader. No VRF code is redistributed; the small adaptation has independent
regression fixtures for color/luminance and alpha.

Remaining differences: no native motion-vector warp, complete snapshot emitter
interpreter, Source 2 volumetric light/bloom or scorch decal system. Emission
density, size/placement and the browser tone-mapped additive pass are adapted.
Do not describe the visual result as identical without measured side-by-side
gameplay captures. Browser tests verify actual colored animated pixels, no
white sheet, shader errors, retained buffers and desktop/mobile rendering.

## Scorecard

The first view contains measured Aim/Movement/Positioning counts, at most two
distinct evidenced weaknesses with the recorded context-specific action, and
six headline stats. Detailed findings, six-part aim profile, totals, export and
history remain accessible. Small opening samples are provisional; unavailable
measurements use `--`, never invented zeros. Scoring math is unchanged.

Leetify's terminology separates visible-target accuracy, opening/crosshair
preparation and contact-to-damage timing; time to damage is not pure reaction
time. The trainer preserves its own measurement definition (including deliberate
holds) rather than claiming a proprietary Leetify rating or population rank:
[Leetify stats glossary](https://leetify.com/blog/leetify-stats-glossary/),
[measurement guidelines](https://leetify.com/blog/performance-metric-tool-guidelines/).

## Validation

- Full Vitest suite: **264 files / 6,420 tests passed**. Native Dust 2 route,
  hitbox, movement and bot-controller integration fixtures were included.
- Production TypeScript/Vite build passed. Existing large-bundle warnings remain.
- Final desktop/mobile Chromium suite: **12 passed**, covering scorecard bounds,
  corrupt/legacy data, animated fire pixels, full-size smoke, persistent radar
  reuse with requests blocked, and live post-result grenade motion.
- Real-map Duel integration: **5 passed**, including production native radar,
  playable winner handoff, failed preparation retry and pause-preserving staging.
- Radar-specific cross-browser/viewport tests: **18 passed**, two intentional
  live-app skips. Cache ownership has 11 focused unit fixtures.
- Fire importer arithmetic: **2 passed**; final fire/changelog subset: **35 passed**.
- Runtime assets: **94 verified model deliveries / 690 sound events / 923 samples**.
- Local preview HTTP 200 at `http://127.0.0.1:5176/`. No deployment performed.
