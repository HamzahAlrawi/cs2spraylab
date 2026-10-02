# Native Cosmetic Actors

Offline training assets only. No game-process access or gameplay changes.

## Integration Contract

`src/range/actor-cosmetics.ts` exports:

- `actorCosmetics`: metadata for six native agents and eight native glove families.
- `loadAgent(id, catalog?, loader?)`: lazy native GLB load, returning `{scene, animations, dispose()}`. Each instance has independently disposable geometry, textures, materials, and bones. The default LRU contains at most two selected templates. The parent can supply its own `ActorCosmeticLoader` and dispose it at engine teardown.
- `applyGloves(viewScene, profileOrId, catalog?, loader?)`: asynchronous, race-safe replacement returning a `GloveApplication` or `undefined` for defaults. Call before constructing `ViewAnimation` or after loading the complete skinned assembly. `profileOrId` accepts `{equipped: {gloves: id}}` or a direct ID.
- `disposeGloves(viewScene)`: cancel pending applications and dispose replacements **before** the parent's `disposeResources([viewScene])` or viewmodel swap. The handle's `dispose()` is idempotent.
- `bindGloves(viewScene, ownedSource, id)`: synchronous low-level binding for tests/custom loaders. Ownership transfers on success. On failure the caller disposes `ownedSource`.

Agent GLBs exclude all held weapons. Attach the parent's selected world weapon directly to `model.getObjectByName('wpn')`, using `weapon-mounts.json` inverse bind. Do not require the baseline target's `held_weapon_target` node, including for M4A1-S. Pass the parent's shared `duel-motion.glb` clips to `DuelAnimator`; exported agents also carry baseline idle/run clips. The original bone names, native proportions, and meter scale are retained. Animation clip filtering already handles agent-specific extra bones.

Gloves contain the **native first-person viewmodel**, including bare forearms/fingers where authored, not the duplicate world mesh. They use the canonical SAS transformed bind space and map all glove bone indices to the existing animated bones by name, retaining native inverse binds. Moto's unanimated `attachHand_L/R` helper weights are folded into their native hand parents during export; the expected hierarchy is checked before baking. No competing skeleton or extra animation mixer is added. Only `firstperson_default_gloves_arms` meshes are hidden; sleeves, weapon parts, and animation tracks remain untouched. Legacy static hand assemblies are intentionally rejected instead of pretending to animate replacements.

Catalog metadata has `equipment/category: 'agent' | 'gloves'`, `price`, `unlockLevel`, `imageUrl`, `assetKey`, `modelUrl`, native resource paths/CRC/bytes/SHA-256, export hashes, mesh/bone audit, and explicit rendering limitations. Parent merges these rows into its catalog and owns purchases/equipment rules. Runtime asset URLs follow the project's `/models/...` convention.

## Rebuild

Run `node tools/build-cosmetic-actors.mjs` from the repository root. `--only=id,id` rebuilds a subset, `--refresh` re-extracts resources, and `--extract-only` prepares native inputs without replacing the public exports/catalog. Environment overrides: `CS2_PATH`, `SOURCE2VIEWER`, `BLENDER`.

Source2Viewer reads the installed VPK; background Blender runs `art/build_cosmetic_actors.py`. Existing assembly builders, animation pipelines, gun importers, engines, and progression modules are not modified. Generated intermediates stay under ignored `research/cosmetic-actors`; public agent/glove GLBs and PNG previews are covered by existing ignore rules. glTF Transform performs WebP texture compression/resizing with mesh simplification disabled.

## Rendering Limits

The native glove shader uses a layered material compositor. This pipeline approximates its authored palette, RGB layer masks, fixed UV pattern, surface shading, and normal map as a baked albedo plus simplified PBR. It does **not** reproduce randomized seed/wear, damage, cloth microdetail, anisotropy, or the exact Source 2 compositor. Bare skin retains its native material. Preview images show the actual exported approximation, not a misleading inventory image. Native agent materials likewise use glTF PBR rather than Valve's character shader. The installed Source2Viewer reports unsupported version-72 compiled shader metadata; geometry and material resource extraction still succeed, but shader parity is not claimed.
