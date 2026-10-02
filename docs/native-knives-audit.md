# Native Knife Cosmetic Audit

Offline browser-training assets only. Nothing reads a running game, hooks a process, or automates CS2 input.

## Scope

The installed build is recorded in `knife-asset-inventory.json` and `knife-cosmetics-inventory.json`. The importer discovers the twenty `melee_unusual` item definitions directly from Valve's installed `scripts/items/items_game.txt`, rather than expanding game combat weapon types. All choices retain `equipment: "knife"` and `category: "knife"`, so slot 3 and the trainer's knife stats stay unchanged.

The existing CT default remains `knife-standard` / asset `knife`. The additional default T knife uses `knife-default-t`. Default CT/T and the duplicate GunGame T knife definition have no native paint-kit inventory pairings; no fabricated skins are assigned to them. Event-only/spectral props are not inventory knife types.

Every skinnable type gets all paint kits with an exact authored `default_generated/{inventoryName}_{kitName}_light_png.vtex_c` image in the installed VPK. Each has more than ten distinct skins. Unsupported knife/finish combinations are not synthesized. Phase 1-4, Ruby, Sapphire, Black Pearl, and Emerald receive distinct labels and images where Valve actually supplies that pairing. For example, butterfly Phase 2 uses kit 618 (`am_doppler_phase2_b`), not generic kit 419; butterfly Black Pearl uses kit 617. Existing butterfly cosmetic IDs, including `knife-butterfly-emerald`, are retained for saved purchases. Only the historical butterfly Emerald receives the knife migration grant; adding Emerald to other types does not silently grant them to old level-100 saves.

## Assets and Integration

Native cosmetic keys:

`knife-bayonet`, `knife-classic`, `knife-flip`, `knife-gut`, `knife-karambit`, `knife-m9-bayonet`, `knife-huntsman`, `knife-falchion`, `knife-bowie`, `knife-butterfly`, `knife-shadow-daggers`, `knife-paracord`, `knife-survival`, `knife-ursus`, `knife-navaja`, `knife-nomad`, `knife-stiletto`, `knife-talon`, `knife-skeleton`, `knife-kukri`, `knife-default-t`.

- `/models/{assetKey}.glb`: native skinned world bind, retaining UVs, materials, skeleton, and meter scale.
- `/models/view-{assetKey}.glb`: native first-person arms plus matching knife-part skeleton, with `idle`, `draw`, `inspect`, `fire` (light miss/slash), and `fire-alt` (heavy miss/slash). Authored secondary draw/inspect variants are exported when available. These are presentation clips, not changes to hit detection or knife damage.
- `docs/knife-asset-inventory.json`: source model CRC/bytes/SHA-256, skeleton, clips, world inverse bind, export hashes/bytes, and per-action retarget matrix audit.
- `/textures/cosmetics/{id}-preview.webp`: the matching Valve-authored inventory preview, with compiled-source and converted-image SHA-256 in the catalog.
- `/textures/cosmetics/knife-kit-{kitId}-pattern.webp`: shared native paint pattern, bounded to 512px.
- `/textures/cosmetics/{assetKey}-paint-mask.webp`: lossless native composite-input RGB mask, bounded to 512px.

Existing Range/Duel view loaders already resolve `cosmeticAsset(profile, 'knife')` and lazily load the selected `view-{assetKey}.glb`. No engine, `RangeApp`, progression, or view-animation changes are needed for cosmetic selection. Native attack playback requires the main animation dispatcher to route `knife` to `fire` / `fire-alt`; the assets alone do not change that dispatcher. `inspect-alt` is exported but the current dispatcher only requests the primary inspect. Existing `prepareNativeViewAssembly` must still run after load.

World attachments must use the selected knife's `inverseBind` from the knife manifest, not a rifle bind or default-knife offset. The baseline engine does not select these world cosmetic attachments yet; integration stays with main. The Shadow Daggers are one asset containing both authored blades, not a new combat equipment type.

Main's asset pipeline should add the commands below. The generic checker currently knows only `knife` and `knife-butterfly`; use the new checker for the full knife set and sync its existing butterfly animation audit from `knife-asset-inventory.json.knives['knife-butterfly'].viewAudit`, adding the view export's `bytes` and `sha256`. Do not call the generic `build-reload.mjs` for arbitrary new knife keys; its supported-ID table is deliberately untouched. `tools/import-cosmetics.mjs` now delegates the knife rows to the dedicated importer after its unchanged firearm import.

## Rebuild

```powershell
node tools/import-knives.mjs
node tools/build-knives.mjs
node tools/import-knife-cosmetics.mjs
node tools/check-knife-assets.mjs
```

Model import/build accept `--only=knife-key,knife-key` and `--refresh`. Skin import accepts `--refresh`. `CS2_PATH`, `SOURCE2VIEWER`, and `BLENDER` override local tool paths. The build reuses the existing, unmodified `art/build_reload.py` native arm/secondary-skeleton retargeter, selecting the actual exported native bodygroup (currently `legacy` for knives). It never substitutes world animations for view actions. Intermediates and logs stay under ignored `research/knives`, `research/knife-cosmetics`, `research/raw-models`, and `research/weapon-actions`. Public generated assets follow the repository's existing ignored-asset convention and must be included in packaged/deployed builds separately.

## Runtime and Fidelity Limits

Each knife has one shared view GLB for every skin, not a GLB per paint kit. The largest individual view asset is checked against a 4 MiB budget; embedded model textures are at most 1024px. Only the selected pattern and selected UV mask are loaded by `applyCosmetic`. The importer adds no GLB preload list or runtime model cache. Shader textures are exposed as direct material properties so the existing resource disposer can deduplicate and release them, including failure/no-mesh paths.

The old `blade`-bone requirement is removed. Knife finishes sample the native composite-input red-channel UV blade region and preserve stock albedo, normal, metalness, and roughness elsewhere. This also supports fixed blades and both native Shadow Daggers without repainting first-person gloves or sleeves. Mask and palette-pattern channels are linear data; inventory previews/direct albedos are sRGB. Some native VTEX alpha channels encode compositor data and are zero despite valid RGB, so conversion explicitly preserves RGB instead of treating those textures as transparent images.

The PBR paint remains an approximation: extracted native palettes/patterns and authored pattern rotation/scale/offset are used with a fixed mapping, but Valve's position-based projection, randomized paint seed, wear/grunge, detailed layer combiners, finish-specific handle treatments, glitter, pearlescence, anisotropy, runtime IK, and twist solvers are not reproduced. Inventory previews show the genuine Valve-authored finish, not a promise of shader parity in this trainer. The local Source2Viewer reports compiled shader version 72 as unsupported; geometry, materials, texture resources, and authored action extraction succeed, but full Source 2 shader fidelity is not claimed.

## Validation

`cosmetics.test.ts` covers type/slot isolation, more-than-ten skins per native type, exact native preview paths, unique phase images/labels, saved butterfly IDs, migration grants, mesh/action existence, shader branch keys, handle preservation, and texture disposal. `check-knife-assets.mjs` verifies every runtime file/hash, native clip namespace and matrix error, embedded skins/textures, finite inverse binds, preview nonblankness, phase-image uniqueness, and resource size bounds. Final test/build results are recorded in the delivery report.
