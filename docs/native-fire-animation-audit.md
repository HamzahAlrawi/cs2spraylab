# Native Fire Animation Audit

## Scope

Static local CS2 build **2000922** (`pak01_dir.vpk`), inspected with the existing
Source2Viewer CLI. No game process, memory reading, hooks, firing automation, or
CS2 connection is involved. The available catalog contains 30 firearms. Every
one has an authored first-person firing clip. The selected set contains 46
distinct firing resources, including last-shot, Dual Berettas, R8 alternate, and
two scoped variants. No guessed animation poses are used.

`native-fire-animation-audit.json` records the exact clip paths, compiled clip
SHA-256/CRC, durations, frame counts, primary/secondary skeletons, native graph
references, and assembly paths. `weapon-animation-inventory.json` retains the
existing pipeline's bind/source hashes, sampled matrix errors, and final GLB
hashes. Binary assets remain local and Git-ignored.

## Selection

- All 30 primary fire mappings are enabled, not only the seven expanded guns.
- M4A1-S uses `_default_rifle/shoot1_rifle`; USP-S uses
  `_default_pistol/shoot1_pistol`. These are the exact resources referenced by
  their native graphs. Suppressed/unsuppressed particle tags do not imply a
  separate firing motion. MP5-SD uses its authored `shoot1_mp5sd`.
- CZ75-Auto, USP-S, Glock, P2000, P250, Deagle, Five-SeveN, Tec-9, Negev and
  SCAR-20 have `fire-last`. Tec-9 and Negev have no matching slide-back idle
  resource; none is fabricated. Other single-barrel guns reuse ordinary fire
  on their final round because no distinct final-round fire exists.
- Dual Berettas retain four side/final-round clips and two native empty poses.
  The caller supplies the authoritative barrel side and ammunition state.
- R8 retains native primary/alternate firing, charge, dry-fire and alternate
  draw. Firing animation does not determine its attack delay.
- AUG/SG 553 export `fire-scoped` from `ironsight_shoot`. Callers must pass
  `zoomed: true` to `playFire`. `alternate` remains R8 alternate-fire state and
  is deliberately not treated as zoom state. Both render engines pass zoom state.
- AWP/SSG 08 bolt cycles are included in fire. Separate bolt, pull and sniper
  scope clips are not invented. SSG 08 also has authored `_lgcy` resources,
  but the current cosmetic catalog has no SSG legacy assembly to rebuild.

## Export Math And Playback

The existing `build-reload.mjs` CLI/spec and background Blender pipeline remain
compatible. The baker still selects one HD/legacy weapon bodygroup, attaches it
to native SAS `wpn`, and samples authored weapon-part motion at 30 Hz:

```text
part = bindWorld^-1 * bindWeaponRoot * nativeWeaponRoot^-1
       * secondaryWorld * authoredPart
mount = characterWorld * wpnPose * bindWeaponRoot^-1 * bindWorld
mount * part = characterWorld * wpnPose * nativeWeaponRoot^-1
               * secondaryWorld * authoredPart
```

Both part and mount matrix errors must stay below `1e-4`. Baked quaternions stay
in a continuous hemisphere without changing their represented rotations. Native
four-decimal seconds/float32 timestamps within 0.002 frames of a 30 Hz sample are
snapped to that sample, preventing Blender NLA flooring from dropping a full
frame. The native duration regression tolerance is `1e-4` seconds.

Fire replaces the prior transient with **one** mixer evaluation, including
repeated high-RPM fire. It does not evaluate a redundant idle pose first or
recreate mixer/actions. Short presentations retain full weight before their
tail blend; last-shot tails blend into the available empty idle, not a loaded
slide pose. Gameplay still owns cadence, ammunition, recoil and ballistics.

Weapon skeletons and moving parts are preserved. Existing `bolt`, `bolt_action`,
`slide`, `silencer`, and Dualies `weapon_l/r` / `slide_l/r` remain native bones.
No muzzle attachment node is introduced. The integrated FX use front-mesh anchor
scans attached to the animated native weapon bones, with separate Dualies
barrels, rather than adding an independent guessed attachment pose.

## Reproduce

```powershell
node tools/build-reload.mjs ak47 m4a4 m4a1s galil famas sg553 aug mp9 mp7 mp5sd mac10 ump45 p90 bizon m249 negev cz75a usp glock hkp2000 p250 deagle elite fiveseven tec9 revolver awp ssg08 g3sg1 scar20 --reuse-source
node tools/build-reload.mjs sg553 aug mp7 mp5sd ump45 bizon m249 negev cz75a hkp2000 elite fiveseven revolver g3sg1 scar20 --legacy --reuse-source
node docs/animation-tests/audit-native-fire.mjs --refresh
node --test docs/animation-tests/native-fire.test.mjs
node docs/animation-tests/render-native-fire.mjs
npm test -- --run src/range/native-view-actions.test.ts src/range/view-animation.test.ts
npm run check
```

The independent geometry tests compare native arm and mounted weapon matrices
against optimized GLBs at nine fractions of every firing variant, including
legacy assemblies. The maximum allowed optimized matrix-element error is
`0.002`, separately from the much tighter pre-optimization baker checks. The
browser render audit exercises every variant at desktop/portrait viewports,
checks nonblank canvas pixels and visible motion, and records screenshots under
`research/fire-animation-audit/screenshots`. Its isolated server/browser close
when the audit finishes; it is not a performance benchmark.

## Limits

Native twist/IK solvers, full graph transitions/overlays, particle event dispatch,
and Source 2 material rendering are not reproduced. Native animation samples and
explicit provenance do not establish pixel-identical live CS2 presentation.
The Negev optional empty reload remains unreferenced by the exported agent model
and is omitted by the existing exporter; this is not a missing firing clip.
