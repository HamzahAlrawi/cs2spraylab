# Native Grenade Presentation

Local implementation, October 26, 2026. Source: installed CS2 build 2000935.

## Replaced

All six first-person placeholder grenades now use their native weapon models,
native textured SAS arms, and nine authored view actions: draw, idle, inspect,
pull pin, three throw-strength poses, overhand throw and underhand throw.
The Molotov retains its bottle, rag and animated lighter in first person.
Equipped glove cosmetics use the same native hand skeleton as the firearms.

The secondary weapon skeleton is retargeted in Blender using the existing
validated first-person assembly pipeline. Every action records source resource,
CRC, duration, sample count, and maximum part/mount matrix error. Short,
explicit aliases avoid Blender's 63-byte action-name truncation accidentally
merging the three throw-charge clips. The original animation hashes remain
separate from the aliased assembly input.

Native world geometry replaces the identical flying spheres and bot-held balls.
World meshes retain their original dimensions. Static exports omit the Molotov's
view-only lighter; projectile exports additionally omit detached pins, rings
and levers. That omission is cosmetic, not new pin/lever debris simulation.
Projectile geometry is centered once around its visual bounds and instanced
at the existing kernel position. Render transforms never move a physical shot.

## Bot Grips And Poses

The grenade's `ag1_hand_r` native bind transform maps its mesh onto the actor's
`hand_R`, rather than reusing a rifle `wpn` attachment or an eyeballed offset.
This is important because grenade additive clips do not necessarily retain a
usable rifle weapon anchor. Twenty upper-body native world clips cover grenade
and Molotov idle/draw/pull/throw actions, including crouched variations.

The four world idle poses explicitly use the installed `+non_additive` variants.
The ordinary `RelativeToFrame` idle contains deltas, not an absolute hand pose;
treating that delta as a complete pose produced neutral or twisted arms. Native
DMX basis/unit conversion reuses the existing verified conversion helper, and
the runtime subtracts its locomotion reference only once. Absolute gesture start
timestamps prevent prior rifle actions from expiring grenade actions instantly.

## Runtime And Delivery

- Models load only in the Duel/Prefire engine when utilities are enabled, not
  in gun-only range drills. All six presentations are prepared before initial
  entry so the first grenade switch does not parse a model during combat.
- Compressed, content-addressed model delivery uses the existing verified local
  disk cache. Repeated throws do not fetch anything or clone a new model.
- First-person rigs/actions are retained; only the active grenade mixer samples.
  Bot grip clones share their immutable static geometry and textures. Flying
  grenades use bounded instances, with one draw per native material primitive.
- The release hides the entire grenade assembly, including multi-material groups,
  without hiding its separate hands. Its arm follow-through persists briefly
  instead of immediately popping back to the rifle.
- Native smoke/fire/flash atlases replace primitive effects in bounded instance
  pools. Smoke consumes connected, world-clipped cells. Asset failures clean up partial
  loads, and disposal releases shared resources once rather than per bot clone.

## Rebuild

```powershell
node tools/import-utility-models.mjs --reuse-source
node tools/build-utility-gestures.mjs
node tools/audit-utility-presentation.mjs
node tools/import-utility-particles.mjs
node tools/import-utility-audio.mjs
node tools/build-combat-model-delivery.mjs
```

The dedicated importer does not rewrite firearm data or exports. It requires
the installed game, Source2Viewer CLI, Blender and existing glTF tooling.
`--world-only` rebuilds held/projectile variants without rebaking view actions.
`src/range/duel/utility-models.json` is the portable provenance inventory; game
archives and intermediate exports remain local/ignored.

## Fidelity Boundaries

The geometry and authored tracks are native assets, not newly invented shapes.
No geometry simplification is applied. First-person textures are capped at 1024,
world textures at 512. Source 2's lighting, weapon shader, twist/IK solvers,
volumetric smoke and particles are not replicated by Three.js. The current VRF
build reports unsupported VCS 72 shader introspection and falls back to its
material mappings; actual color/normal/packed textures are still exported and
checked in the browser. Metallic/roughness and glass response can consequently
differ from CS2.

Draw/pin presentation now uses native deploy data and graph completion times.
The launch gap, projectile solver and effect emission remain browser adaptations,
not native engine or pixel-identical behavior. Grenade pickups and complete
trainer-effect playback are implemented in the follow-up; see
`utility-completion-audit-2026-10-26.md` for integration and validation.

## Checks

Unit tests cover source hashes, all six separate models, nine actions per model,
retarget errors, native left/right hand bones, absolute world idles, instancing,
physical position stability, inspect/prime/release and resource lifetime.
Browser tests check the actual textured meshes, framing and nonblank canvas on
desktop and portrait mobile, native bot palm contact, and zero model requests
while repeatedly drawing flying grenades. Screenshots remain in `research/`.

Final verification: `npm run check` passed 235 files / 4,308 tests and the
production build. `tests/utilities.spec.ts` plus `tests/utility-models.spec.ts`
passed six Chromium desktop/mobile cases; two duplicate mobile-only exclusions
were intentionally skipped. The combat-delivery verifier accepted 94 exact-byte
model entries, including the 19 utility-owned resources. Existing Vite bundle
size warnings remain; this is not an old-device FPS certification.
