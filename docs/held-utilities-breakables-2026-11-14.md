# Held Grenades and Mirage Breakables

## Native Reference

Installed CS2 build **2000943**, patch **1.41.9.7**, SourceRevision **11228971**
(November 11, 2026). All inspection was offline: VPK extraction, compiled-resource
decoding and browser tests. No game DLLs or live process access were used.

- Main VPK directory SHA-256:
  `50226f207f0a90b2b85c095717bd42bfa3804a801149903cb6f7262d000d6b5d`.
- Mirage VPK SHA-256:
  `e66cdf1ae6a976f6f6ba510a2addd04b25a4c1cfd811f51f1ef13f0954e6e350`.
- Current compiled hold-pose resources for all six grenades, plus Smoke pullpin,
  match the 19 SHA-pinned animation fixtures. See
  [the resource inventory](held-utility-native-source-2026-11-14.json).
- Mirage entity/model hashes, origins, health, initial state and linked outputs
  are recorded in [the breakable inventory](mirage-breakable-source-2026-11-14.json).
  Geometry and textures remain ignored, locally generated assets.

## Held Model Defect

The native charge poses are static. The Blender glTF exporter discarded their
constant weapon-object transforms while retaining the arm pose. At the end of
pullpin, the throwing hand moved behind the camera but the grenade reverted to
its idle position in front of the player. A local native Smoke reproduction
measured about **0.68 m** of attachment displacement.

The exporter now keeps constant object tracks and duplicate samples for static
poses. All six utility views were rebuilt from their previously audited inputs;
their original source-build labels were retained. The runtime also follows the
native `wpn` socket using its exported idle bind relationship, so old cached GLBs
are repaired too. Secondary weapon-bone tracks remain native. Launch position,
velocity, jump timing, strength, fuses, recoil and aiming were not retuned.

Regression checks cover every utility, five strengths and times through a
30-second hold. A simulation regression separately verifies that holding Smoke
does not create a world projectile, start a smoke effect or consume inventory.

## Mirage Objects

`maps/de_mirage/entities/default_ents.vents_c` supplies `classname`, `model`,
`origin`, `angles`, `scales`, `health`, `solid`, `startdisabled`,
`hammeruniqueid` and `@OnBreak Enable` outputs. Referenced model `DATA` supplies
`m_modelInfo.m_keyValueText.prop_data.health`; `PHYS` supplies the actual hull
faces/mesh triangles. No render bounding boxes replace native combat geometry.

Twelve native entities are retained separately: ten destructibles and two
initially disabled shutter remnants. The main openings are the Window/underpass
sheet-metal covers and Window shutter. The tiny authored breakable and six
fragile bottle props are included as well.

Visual batching and chunk optimization preserve `nativeEntityId`. A small,
separate mutable collision world handles the retained PHYS shapes. Shots,
knife hits and visible HE blast damage remove the entity; visibility culling
cannot resurrect it. Starting a new simulation restores the native initial
state. Native `solid=0` remnants never acquire collision. Linked remainders
appear only when the recorded break output enables them. Distant context omits
mutable entities to avoid unbreakable visual duplicates.

Entity metadata travels inside the existing content-addressed visual manifest,
including chunk subsets. It needs no uncached extra request. Rebuilt models and
maps use new content hashes; unrelated cached resource bytes remain reusable.

## Verification and Limits

Run `npm run check`, `node --test tools/tests/native-map-entities.test.mjs
tools/tests/duel-map-chunks.test.mjs`, and `node tools/audit-native-breakables.mjs`.
The browser audit checks actual native mesh identity, shot removal, reset and
grenade passage through both sheet-metal covers. Unit tests also cover live Duel
shot integration, opaque blast occlusion, disabled remnants and immutable query
cache preservation. Native asset attachment tests skip in source-only checkouts
until assets are generated; they ran with all six local models here.

This is not the complete Source 2 breakable runtime. Unknown native penetration
and exit modifiers remain opaque rather than invented; the breaking bullet can
stop at the prop. Detached native debris, full entity I/O, physics-prop motion,
damage tables and model-specific break audio remain fidelity gaps. Fight-review
seeks do not yet reconstruct a separate native-prop destruction timeline. Small
`prop_physics_multiplayer` objects do not become immovable player obstacles in
this trainer; their shot/grenade PHYS remains active. This is an explicit trainer
policy, not a verified native player-contact rule. HE uses the existing native
blast curve with a single center visibility test, not complete engine exposure
sampling. Matched-build gameplay captures remain pending; Mirage stays Beta.
