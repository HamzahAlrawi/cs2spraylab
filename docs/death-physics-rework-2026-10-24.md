# Articulated Death Presentation

## Source Verification

`node tools/export-native-ragdoll.mjs` reads the static PHYS block of
`agents/models/ctm_sas/ctm_sas.vmdl_c` from the installed CS2 VPK. It does not
access the game process. Installed ClientVersion: **2000935**.

PHYS export SHA-256:
`8993e5f611bc537ff60c994b3b0c49345cfcb7ae379de9b91fb8e271c1f62ce9`.
This is unchanged from the older build 2000922 extraction. Runtime data lives
in `src/range/duel/native-ragdoll.json`: 15 capsules/spheres, 14 joints, native
masses, angular damping, inertia scales, local anchors, joint frames and limits.
Source units convert to meters at 0.0254. The default SAS physics are also used
for compatible cosmetic rigs; alternate-agent-specific physics are not claimed.

## What Changed

- The complete native rig uses Rapier articulated bodies, not the old set of
  point masses pulled through prerecorded positional trajectories.
- Each body transfers its complete position and rotation to the skin. Native
  joint-frame offsets, rather than unconstrained point links, bound articulation.
  Rotations-only transfer was rejected: it displaced visible head/ankles from
  their physical contacts by several centimeters. Small local-origin shifts at
  offset hinges are necessary; nonphysical helper bones retain the captured pose.
- The captured pose and running/jumping velocity are retained. A directional
  local head/chest impulse plus coherent angular momentum releases support.
  There are no persistent positional animation motors fighting the constraints.
- Neighbor and initial-overlap pairs are excluded from self-contact; other
  limbs may contact one another. Restitution is zero, with bounded sleep time.
- Native corpses use a local copy of the actual movement triangles. Grounding
  columns cannot be reused here: they intentionally exclude vertical faces.
  Copies include cover sides, walls and stair risers and use an eight-entry /
  four-MiB cache. They never mutate live collision worlds or shot geometry.
- Corpse visibility uses its physical center, not the victim's old standing
  occlusion test. A world-root change does not drag the settled corpse.
- Player deaths create a visible corpse using the already loaded model. The
  camera prefers the native 76-unit chase distance but orbits/clips against
  cover and playable bounds. The first-person weapon promptly disappears.
- Runtime initialization happens before entry, not on the first death. Worlds,
  event queues and cloned skeletons are freed on reset/dispose. Replay rewinds
  of the physics subsystem reconstruct the same initial conditions, suppressing
  rewind contact audio. Existing fight-review clip playback remains a fallback;
  it is not a recording of live ragdoll body transforms.

## Fidelity Boundaries

This is not Valve's Rubikon solver or its animation graph. Native cones become
two bounded Rapier swing axes; flex limits are recentered around the captured
pose. Friction, release impulses, contact tolerances and camera interpolation
are authored. This should be described as source-informed, not exact CS2 parity.
Raw unsafe death clips and the head-pose bank are not played as continuous
animations. Incomplete rigs retain the older fallback path.

Combat movement, recoil, aiming, spread and live hitboxes are unchanged.

## Regression Coverage

- Native topology/provenance, exact initial pose, bounded bone-origin changes
  and exact visible/physical body alignment.
- Deterministic 60/240 Hz presentation and replay rewind.
- Rewinds shorter than one physics step cannot retain a future state.
- Running/jumping momentum, raised-floor and native-triangle contacts.
- Sleep, repeated disposal and root-transform remapping.
- Actual movement-mask extraction, vertical wall faces, cache reuse and disposal.
- Camera goal selection in open, blocked and fully enclosed spaces.
- Browser screenshots: standing/crouching, head/body, side/front/back hits,
  moving/airborne victims and raised platforms, plus unchanged round restart,
  pointer lock, fullscreen and viewport size.

Run `npm run check` and
`npx playwright test tests/rigid-death.spec.ts tests/duel-rounds.spec.ts --project=chromium`.

## CPU Audit

`node tools/audit-death-physics.mjs` checks native contact at Long, B and CT.
One local run against the full-source collision (not reduced chunk collision):

| Work | Measured range |
| --- | --- |
| First regional triangle copy | 9-13 ms |
| Cached regional copy | 0.007-0.05 ms |
| Corpse world/body setup | 5-11 ms |
| 60 Hz simulation + skin update, median, one corpse | 0.22-0.27 ms |
| Same, p95 | 0.29-0.45 ms |

The initial copy/setup is still a one-time cost, not a claim of zero first-death
stall. Measurements are machine-specific CPU timings, not FPS or low-end-device
guarantees. Geometry is copied only locally, reused within the bounded cache,
and no game assets or whole-map collision worlds are cloned per corpse.
