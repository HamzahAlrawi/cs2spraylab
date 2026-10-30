# Source-Only Repository And Local Assets

## What Is In Git

Application code, extraction/build tools, source licenses, evidence manifests,
hashes, numeric gameplay/animation audit fixtures and deployment headers remain.
Models, textures, icons, sounds and generated runtime files under `public/` do
not. Native media must not be embedded as base64 in source JSON either.
`npm run source:check` enforces this; its unit tests also run with `npm test`.
The project-owned range/icon are generated from source, not extracted from CS2.

All existing runtime files remain in the owner's working directory. Removing
them from Git does not remove them from local Vite/build outputs or the existing
Cloudflare deployment. Source cleanup is not authorization to redistribute Valve
content; use an appropriately licensed local installation and review rights
before publishing converted assets.

## New Checkout

1. Install Node >=20.19 and run `npm ci`.
2. Install CS2 locally. Set `CS2_PATH` if it is outside the default Steam path.
3. Obtain official [Source 2 Viewer / VRF](https://github.com/ValveResourceFormat/ValveResourceFormat/releases).
   Current resource parsing requires 20.1 or compatible newer tooling. Some
   historical exporters still use `.local-tools/vrf/Source2Viewer-CLI.exe` and
   newer ones use `.local-tools/vrf-20.1/Source2Viewer-CLI.exe`. Install the complete
   CLI package at both locations for the current mixed pipeline; do not silently
   use the old 20.0 binary on current KV3. Tools support differing environment
   overrides; there is not yet a unified tool locator.
4. Install FFmpeg on PATH. Run Blender with the Blender MCP bridge listening on
   localhost:9876, as required by `tools/blender-command.mjs`.
5. Run `npm run assets:build` for the ordinary game/range assets. It includes
   utility atlases/audio, HE smoke, native flinches and the USP finish repair.
   `node tools/build-brand-assets.mjs` can regenerate the original icon alone.
6. Build the native map packages separately, using the current commands below.
7. Run `npm run source:check`, `npm run assets:check`, `npm run check`, then
   `npm run dev`. Native asset integration tests require these local assets;
   a source-only `npm run build` is not proof of a playable complete package.

Imports use static game files only. Do not attach to the game or read process
memory. A different installed build can change generated definitions/provenance;
review differences and rerun native audits rather than relabeling old evidence
or weakening hash/admission checks to make a build pass.

## Dust 2 Packages

Start with `node tools/import-dust2.mjs`. Build chunk geometry, rounds, navigation,
optimized visuals, overview/context data and verified delivery in the order
documented in [dynamic rounds](dynamic-duel-rounds.md#asset-build-order),
[real-map Duel](real-map-duel.md#rebuild) and
[position-source maintenance](position-source-followup-2026-10-23.md#package-maintenance).
Those native cover/walk/hittability audits are required after route/pool changes.
Do not copy stale quality certificates or bypass an admission failure.

Current delivery publication also uses `node tools/build-duel-query-cache.mjs`,
`node tools/build-duel-context.mjs`, `node tools/import-native-radar.mjs` and
`node tools/build-duel-delivery.mjs`; inspect each tool's documented inputs before
running it. Run asset writers serially. The full clean-install extraction chain
has not been executed as part of the source-removal change; historical tools and
their build-specific prerequisites remain a reproducibility improvement area.

## Git History Migration

At the owner's request, published history is rewritten to remove runtime asset
paths and literal embedded media. A local recovery bundle is retained privately
under ignored `research/`, never pushed. Commit IDs change; old hashes in dated
audit records/changelog entries identify their original evidence and are not
rewritten to pretend those audits ran on the new commits.

Existing collaborators should re-clone, preserving their local work and assets
first. Do not merge or force-push the old history back. Existing forks, prior
clones and GitHub cached old-commit views cannot be erased by a branch rewrite.
The cleanup verifies the new reachable history and a fresh remote clone; it is
not a promise that every historical copy on GitHub or another computer is gone.
See [GitHub's history-removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

`tools/package-release.ps1` defaults to a source-only ZIP and rejects runtime
media in that archive. `-IncludeGameAssets` explicitly includes complete local
runtime packages for private testing, not for committing or public distribution.
