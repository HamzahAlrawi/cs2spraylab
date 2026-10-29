# Grenade Presentation and Duel Entries: Evidence and Limits

## Installed Source

Offline static inspection only. No game process, DLL loading, memory hooks or in-game automation.

Installed Steam build **2000938**, patch **1.41.9.3**, revision **11181008**, dated October 28, 2026.

| Resource | SHA-256 |
| --- | --- |
| `game/csgo/bin/win64/client.dll` | `08a741030c1e569d8b854c5886a87fcafc21d0d0e2f05dfd380e8a351171501d` |
| `game/csgo/bin/win64/server.dll` | `3788afaa2dbce98a7b2fa1e15b6b1a304759dd5b0f05802268952341b40777c4` |
| `game/csgo/pak01_dir.vpk` | `b32a45c66eff785aa4b9b4e5564e36ac0639942074a9c27b765eab74e5066cdb` |
| `game/csgo/steam.inf` | `2214452bae5fc335cc4848b1a522e149072d108820c727a17563383e55cb8f74` |

Static resource inventory: `docs/utility-active-resource-audit-2026-10-26.json`, refreshed against this build.
The filename remains stable for existing references; its build and hashes identify the current audit.

## Flash Strength

The old trainer invented a fully white plateau lasting half the server's network duration.
That was not a native client rule and made rear flashes unrealistically opaque.

`tools/verify-native-flash-client.py` maps **static file bytes** into isolated Unicorn memory and
executes the unmodified scalar helper at client RVA **0x8d0780..0x8d08e6**, including its pure callees.
The caller is at **0xc6a26d**. No renderer, game clock, entity system or game DLL is loaded.

The 1,440-case fixture covers different start clocks, durations, alpha caps, buildup states,
expiry boundaries and large clocks. `grenade-flash-client.ts` matches these float32 outputs exactly:

- Normal white overlay: capped square of remaining seconds divided by three, scaled by maximum alpha.
- Screenshot contribution: capped remaining time divided by total duration.
- Buildup helper: capped elapsed time divided by extracted float32 **0.09444444626569748**.

The runtime white overlay now uses the verified normal helper. A 1.0714-second rear exposure
starts around 0.128 white opacity, not full white for half a second. This does not certify the
entire client postprocessing path: screenshot capture, afterimage composition, buildup state
selection, HDR and overlapping flash rendering are not fully ported.

Server distance, facing bands, occlusion and overlap arithmetic retain their independently
verified **2000935** fixtures. Their labels/hashes were not changed to imply a newer code audit.
This iteration changes client presentation, not those server formulas.

## Throws

Current client input path: slot 403 at **0x7d7de0**, attack masks at **0x7d7ec8..0x7d7f18**.
The original isolated approach/release arithmetic fixture remains explicitly pinned to 2000935.
The current viewmodel graph selects Underhand for float32 strength **<= 0.33**; clip speed is 1.

Browser pointerdown/up only describe transitions between no buttons and some buttons, not
every chord edge. Reconciled `mousedown`, `mouseup` and `pointermove.buttons` samples now preserve
left, right and combined holds, without re-emitting duplicate press edges. Touch remains tap-to-shoot.
Focus loss clears input without manufacturing a throw. Gameplay release remains independent
of cosmetic animation/sound markers. Throw clips retain native elapsed seconds rather than
stretching shortened GLTF tracks to a different duration.

## Native Sounds

`tools/import-utility-audio.mjs` freshly extracts `soundevents/game_sounds_weapons.vsndevts_c`
(compiled hash **43783bf047a6ad803a4bffd6980fc53ec7f4dcefd3a00d674e4c3ba260ff49a1**).
It publishes 75 events / 118 unique WAVs, including viewmodel cues, draws, pins, throws, impacts,
detonations, inferno sustain/ignite/fade and extinguish samples. Provenance includes individual
source/archive hashes, WAV signal summaries and per-sample VSND loop boundaries.

The runtime now resolves case-insensitive native names, can preload before the first weapon
unlock, retries failed manifests/samples and separates world-effect loops from actor cues.
Inferno sustain is owned by the effect and stops on expiration, interruption or pause.
`Molotov.IdleLoop` is deliberately **not** made an infinite loop: its native sample says LoopStart=-1.
The actual `Inferno.Loop` sample does have a valid loop. Tests verify audible nonzero data,
not merely filenames. Native envelopes, mixer buses, tinnitus selection and propagation are
not fully equivalent to the game; imported samples alone do not establish runtime audio parity.

## Smoke and Fire Rendering

[Valve's smoke overview](https://www.counter-strike.net/cs2?l=english) and
[Valve's responsive-smokes demonstration](https://www.youtube.com/watch?v=_y9MpNcAitQ)
establish volume smoke with bullet/HE interactions. The old legacy S1 smoke atlas is no longer rendered.

The browser replacement uses a bounded 48-cubed occupancy texture made only from reachable
kernel cells, a world depth texture, Beer-Lambert integration, spatial turbulence and analytic
capsule/spherical holes. Bullet holes no longer depend on whether a coarse cell center happens
to intersect the shot. Holes refill smoothly. Camera-inside views use the same volume, not a
DOM blanket that hides carved paths. Foreground walls stop the march. HDR world color is retained
before final tone mapping. No extra world pass runs without active smoke; quality limits the
march to 32/48/64 steps. Textures and framebuffer resources are retained and disposed explicitly.

This is **not** Source 2's smoke fluid solver, lighting model or compiled volume shader.
Grid size, extinction, noise, bloom, bullet/HE hole size/duration and refill are documented
trainer approximations, not extracted gameplay constants. Existing radius/lifetime defaults
are not promoted to verified measurements by this renderer change.

`tools/import-inferno-presentation.mjs` follows the installed groundfire child references to
`fire_small_sim_a`, `fire_small_sim_b`, `fire_onsurface`, incendiary `fire_small_sim_a_v02`,
and `fleks_glow`. `inferno-presentation-native.json` records compiled particle/texture hashes,
frame selection, native gradients and atlas hashes. The renderer now has grounded surface,
center/edge flame and ember layers instead of a single legacy burning-character billboard.
Source 2 motion vectors, snapshot emission, scorch projection, water-silt selection and exact
per-particle dimensions/lighting remain outside this browser presentation port.

## Fully Blinded Characters

The installed `animation/anims/world/shared/flashed` and `flashed_crouch` resources are **single
poses**, not timed animations. They are extracted and converted to native upper-body tracks,
with separate rifle/pistol additive bases and continuous standing/crouch blending.
`native-flash-animation.json` records source hashes and the generated animation asset hash.
Eye-cover poses are selected only at effectively complete whiteout, not for a weak rear flash.
This follows [Valve's visibility-cue requirement](https://store.steampowered.com/news/posts/?appids=730&enddate=1732746561&feed=steam_community_announcements).
The full Source 2 animation graph's visibility transitions are not reproduced.

## Duel Training Entries and Authoring

[Refrag's Prefire documentation](https://wiki.refrag.gg/en/Prefire) and
[entry-fragging discussion](https://refrag.gg/blog/4-ways-i-improved-my-entry-fragging-skill-with-refrag/)
describe common defensive holds along coherent clearing paths, with some holds left empty to
avoid memorized target order. These sources do **not** provide measured Dust 2 encounter probabilities.
No new statistical claims or fabricated population weights were added.

The default Duel course now uses the chunk's standard route and earliest validated covered
entry. Explicit shuffle preserves course/start variety. Existing common-angle data is retained.
Manual lineups let users add precise local setups rather than waiting for another global catalog
revision. Saved setups are bounded, collision-revision bound, hull/floor checked and require
explicit acknowledgment of immediately visible enemies. Walk authoring skips combat and rewards.
See `manual-duel-lineups.md` for the workflow and export format. Data remains local; no accounts,
server storage or automatic upload are added.

## Verification

- `npm run check`: 259 test files / 6,361 tests passed, TypeScript and production build passed.
- Native offline flash replay: all 1,440 current-client arithmetic cases verified.
- Nine desktop browser checks: real mouse chords, manual capture/save/apply, smoke pixel/depth/HDR
  tests, native fire buffers, native models, loadout persistence and replay seeking.
- Four mobile Chromium checks passed; desktop-only cases are explicitly skipped on touch.
- Real Web Audio: all 118 utility samples decoded; native pin/loop playback, deduplication and
  independent actor/effect cancellation passed. This checks actual AudioBuffers, not only mocks.
- Three native WAV metadata/signal checks passed. `npm run assets:check` verified 94 model deliveries,
  690 audio events and 923 total native samples. Existing bundle-size warnings remain.

These results establish the tested trainer behaviors, not complete CS2 runtime parity or
performance guarantees for physical old/mobile hardware.
