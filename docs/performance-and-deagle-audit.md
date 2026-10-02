# Rendering and Guided Deagle audit

## Reported closure

The user reported the localhost tab disappearing during Guided spray with Desert
Eagle, possibly after Ctrl+W. Repeated firing and reloads did not reproduce a
JavaScript exception. Tab closure and WebGL context loss are different failures;
the evidence does not establish a Deagle-specific crash.

The range requests confirmed pointer lock before fullscreen plus Keyboard Lock
for W on supported desktop browsers. Desktop capture denial pauses with a retry
message rather than silently entering drag aim. Keyboard Lock denial still shows
the C-to-crouch reminder when mouse capture succeeds. Pause, settings, disposal,
and a late asynchronous permission result release owned locks. Escape is not
reserved. Mobile entry does not request fullscreen or keyboard lock.

API constraints: [Chrome Keyboard Lock documentation](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock)
and [MDN Keyboard.lock](https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/lock).
Preventing a DOM keydown alone cannot reliably intercept a browser tab shortcut.
Range and Duel use the same capture handshake and shortcut guard, with independent preferences.

## Changes

- Persistent impacts use one bounded InstancedMesh per wall/target parent rather
  than a mesh per shot. Capacity remains 200 wall points and 60 per target.
  The original world-to-local hit conversion, physical coordinates, hit colors,
  distance scaling, and impact-size control are unchanged.
- Static fixtures sharing a material and shadow/render-order flags are batched.
  Original collision geometry and baked world matrices remain available to the
  raycaster. Visual geometry's float32 baking can differ by sub-micrometre rounding.
- Range shadows are cached for stationary targets; moving targets refresh them at
  15 Hz (30 Hz High). Hidden target animation mixers are skipped.
- Native pose evaluation is presentation-rate limited, not physics-rate limited.
  Positions, camera interpolation, movement, recoil, ammo, hit tests, and AI still
  use the existing simulation. Render caps do not change the 128 Hz physics step.
- Canvas wall guides no longer regenerate mipmaps on every animated upload. Their
  presentation cadence follows quality; animation can be disabled independently.
- Range viewport dimensions come from resize handling instead of forced layout
  reads after per-frame DOM writes. Unused cue projections are skipped.
- Idle previews render at 15 FPS. Hidden tabs pause and skip rendering.

## Controls

Settings > Game > Graphics contains quality, frame limit, and Show FPS counter.
The counter is off by default and updates at 2 Hz, outside React gameplay status
updates. Its tooltip includes CPU frame cost and render density. It works in Duel
and every range drill.

| Quality | Maximum density | Longest buffer axis | Pose cadence | Shadows |
| --- | --- | --- | --- | --- |
| High | 2x | 2560 px | 120 Hz | Yes |
| Adaptive | 1.5x, then 50-100% adaptive scale | 1920 px | 60 Hz | Yes |
| Low | 1x | 1280 px | 45 Hz | No |
| Performance | .75x | 960 px | 30 Hz | No |

Density is also bounded by device pixel ratio. Performance selection sets a
60 FPS cap, which the user can change. Caps: refresh rate, 30, 60, 120, 144, 240.
Adaptive resolution waits through a three-second active warmup, lowers resolution
only under sustained overload, and recovers slowly after sustained headroom.
Idle rendering and an intentionally lower frame cap do not count as overload.
Antialiasing is a renderer-creation option: an existing renderer keeps its original
AA setting until a reload or mode switch. Resolution, shadows, caps, and pose
cadence change immediately without reloading native models.

## Measurement

`node tools/profile-gameplay.mjs <label>` profiles Guided shots at 1440x900, with
Chrome CDP 4x CPU throttling by default (`CPU_RATE` overrides it). Hardware here is
an RTX 4080, not an old integrated GPU. Percentiles measure CPU-side frame work,
not GPU time, and are not a promise of a particular FPS on untested hardware.

| Scenario | Draw calls p50, before / after | CPU frame p50, before / after | CPU frame p95, before / after |
| --- | --- | --- | --- |
| Deagle Adaptive | 86 / 48 | 8.4 / 7.1 ms | 11.1 / 9.1 ms |
| AK Adaptive | 120 / 50 | 9.4 / 7.0 ms | 12.8 / 9.0 ms |
| AK Low | 165 / 50 | 9.6 / 6.8 ms | 13.6 / 9.0 ms |

Before, impact meshes accumulated across shots and preset changes. After, those
draw calls stay bounded. Performance rendered a 960x430 buffer and averaged
approximately 60 presented frames per second during the same throttled run.
All four measured scenarios had no page errors.

An additional 8x CPU-throttled stress run also had no page errors, but the
Performance preset averaged only about 18 presented FPS. Severe CPU starvation
remains a limitation; the preset is not a universal 60 FPS guarantee. The later
shared static-material pass further reduced draw calls from 60 to 50, as reflected
in the final 4x measurements above. Native texture/animation assets remain intact.

The later authored-POI Duel run (`node tools/profile-duel.mjs`, same 4x CPU
throttle, Performance preset and 60 FPS cap) measured the following. Normal
spawn views had their bots occluded; the synthetic stress variant deliberately
forces all five animated models visible while retaining rendered scenery.

| Scenario | CPU frame p50 / p95 | Draw calls p50 | Presented frame interval p50 / p95 |
| --- | --- | --- | --- |
| One bot, compact .65 arena | 2.3 / 2.9 ms | 25 | 16.7 / 16.8 ms |
| Five bots, regular arena | 2.8 / 3.7 ms | 22 | 16.7 / 16.8 ms |
| Five bots, forced-visible stress | 4.3 / 6.2 ms | 65 | 16.7 / 16.8 ms |

All three runs had no page errors. These are short CPU-throttled measurements
on this RTX 4080 host, not an old-iGPU hardware guarantee.

## Regression coverage

- Impact-cloud tests: immutable stored positions, target-local motion, resizing,
  ring overwrite, color, bounded count, and clear/reuse.
- Static batching: retained collider intersections and separate shadow flags.
- Frame pacing: 30/60/120 FPS scheduling, stalls, and cap changes.
- Adaptive policy: warmup, overload, slow recovery, bounds, intentional caps,
  and backwards-compatible settings migration.
- Shortcut guard: permission denial, unsupported browsers, owned/user fullscreen,
  and cancellation while fullscreen or keyboard permission is pending.
- Browser regressions: real repeated Deagle taps, reloads, rapid click cooldown,
  knife switching, visible canvas pixels, mobile touch, opt-in FPS persistence,
  both render engines, and actual Chromium Ctrl+W protection.
- Short landscape viewports use a single-row compact header rather than letting
  Donate/Changelog consume the firing viewport. A 844x390 touch viewport retains
  over 240px of range/duel height, with project links and settings still visible.

Final existing-mechanics browser run: 43 passed and 21 intentional platform
skips. Four initially failing integration checks were corrected and re-run:
compact arena selection, ready-state cue measurement, and both mobile landscape
layouts all passed. Touch entry also verifies zero desktop capture requests and
actual fired shots after switching from Duel to Guided.

Actual old-CPU/iGPU hardware and the user's specific browser/extensions still need
field testing. Recoil and ballistic formulas were deliberately not modified by
this performance work.
