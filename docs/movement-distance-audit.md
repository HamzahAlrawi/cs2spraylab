# Movement, crouch and distance audit

Date: 2026-09-30. Installed CS2 build: **2000919**, patch **1.41.8.6**.
All inspection/emulation is offline. No game process is opened or hooked.

## Findings and corrections

- New AI Duel configurations use level 3. Existing saved selections are preserved.
- Ground acceleration previously used reduced wish speed as its acceleration
  reference. Native `Accelerate` separates them. Running uses the weapon factor;
  crouching uses 34% of a minimum 250-unit reference, walking 52%, with a
  five-unit taper near walking speed. Damage tagging caps wish speed/momentum
  but does not multiply this acceleration reference. The old implementation
  could not reach AK crouch speed from rest because friction exceeded acceleration.
- Crouch movement speed follows raw duck amount, not the camera's smoothstep.
- Rested duck/unduck rates are 6.4/s and 8/s, respectively. These are maximum
  rates, not fixed transition durations: every crouch input edge consumes 2
  from duck speed, which recovers by 3/s toward 8. The additional 6/s recovery
  after travelling 64 units at an endpoint, minimum 1.5 unduck rate, and
  0.4-second completed-duck cooldown are represented. State is shared by
  range players, Duel players and bots. A new rep resets it.
- Rifle crouch clips used a tuned 76.5 u/s stride reference instead of the
  native locomotion graph's 96 u/s anchor. This sped up the feet. Single-frame
  idle poses now sample time zero rather than taking modulo zero. Timed idle
  clips respect the graph's 0.167 playback multiplier; the current exported
  world-idle clips are fixed poses, so that multiplier has no visible effect.
- Spread was added directly to Euler yaw/pitch. This compressed horizontal
  spread at steep pitch and treated a cone slope as radians. It now uses a
  normalized forward/right/up ray. No distance-dependent aim correction,
  recoil rescaling, enlarged hitbox or relocation of existing impacts is used.

## Evidence

`tools/verify-native-movement.py` emulates server RVA `0xab1ff0` with pawn,
weapon and water-state lookups stubbed. The 240 numeric fixtures cover five
weapon speeds, running/walking/crouching, tagged/untagged wish speeds,
forward/reverse/near-cap velocity and two timesteps. They do not emulate the
whole movement engine. Server SHA-256:
`f95fe0dcd7b526137a8b305dd76a72f624e0508ad42bb5949d05c77a37e1bd70`.

Crouch arithmetic was inspected at server RVAs `0xab8230` (input-edge penalty),
`0xabd7ef` (recovery), `0xabd9e7` (stand-up), `0xabdbed` (duck-down),
`0xabdce8` (movement scaling) and `0xabfd04` (last completed duck time).
The renderer still uses native skinned clips with lightweight stance blending;
it is not a reproduction of the entire Source 2 animation graph/IK system.
Animation references came from `worldmodel_locomotion.vnmgraph`'s rifle
variation: run 225, walk 136, crouch 96 u/s and idle multiplier 0.167.

`node tools/import-game.mjs --data-only` freshly exported all 17 primary
definitions. Every exported parameter is unchanged. After auditing the changed
DLL layout, `tools/verify-native-recoil.py` re-emulated the current RNG and
64-entry tables: all existing numeric fixtures matched exactly. Current offsets,
hashes and verification scope are in `src/range/recoil-provenance.json`.
The current punch integrator at client RVA `0x84e880` still has a 128 Hz cache,
18 degrees/s linear angle recovery and 4.5/s velocity damping.

`node tools/verify-scale.mjs --native` compares the shipped rig against the
local native export: standing idle height **1.821906 m / 71.729 units**,
with a measured delta below 0.001 mm. There is no runtime height normalization.
Camera standing/crouch heights remain 64/46 units and one unit remains 0.0254 m.

The shot-basis correction is consistent with Valve's published
[Source SDK shot construction](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/shot_manipulator.h).
That source establishes the vector construction, not CS2's random distribution.
The trainer's existing two radial samples remain an approximation of CS2 spread.

## Validation and limits

Tests compare native acceleration arithmetic, complete crouched travel, braking,
crouch fatigue/recovery, ceiling clearance, crouch-jump continuity and all-mode
movement parity. Ray tests cover normalized spread at steep pitch, Source-unit
conversion, exact projection slopes and full-magazine recoil compensation at
10/30/80/100 metres. Browser tests additionally fire the visible guided cue at
the actual head mesh at 4/15/90 metres, at three eye heights, with follow-recoil
on/off, and inspect rendered standing/crouching/airborne poses.

This does **not** establish exact CS2 gameplay parity. Native subtick scheduling,
collision/step resolution, jump stamina, quaternion recoil-cache interpolation,
special weapon spread transforms, recoil camera animation and complete native
animation graph/foot IK are not fully reproduced. A synchronized native shot
capture would still be needed to validate complete angular trajectories and
perceived handling end to end. Verified tables must not be arbitrarily scaled
to compensate for those remaining differences.
