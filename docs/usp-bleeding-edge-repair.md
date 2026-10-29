# USP-S Bleeding Edge material repair

## Failure

The existing `usp-ht_red_edges` finish selected a uniformly magenta exported
`g_tPattern` texture and had four `[null, null, null]` palette entries. The current
Source2Viewer decoder also exports that pattern as magenta. It is not a usable
finished albedo, and invalid colors made the generic painter fall back to it.

## Installed-file evidence

`usp-bleeding-edge-audit.json` records installed build 2000938, archive/tool hashes,
compiled and decoded material hashes, compiled mask hash and deployed asset hash.
`node tools/repair-usp-bleeding-edge.mjs` reproduces the scoped extraction offline.
No game process is opened. Native material fields select custom paint-by-number
masks (`g_bUsePaintByNumberMasks`, `g_bOverrideDefaultMasks`) and copy
`g_tPaintByNumberMasks` into `g_tMasks`. Four `m_cValueColor4` byte palettes are
normalized explicitly. The mask uses the model's unscaled UVs, not pattern scale 3.

## Scope and limits

The renderer keeps stock surface textures, normals and roughness; the mask and
authored palette provide the finish color. This remains a simplified browser
compositor, not full CS2 halftone, wear or seed parity. The broader catalog retains
its original build provenance; only this repaired row records the newer source.
Its ID, cost, unlock requirement, preview and model selection are unchanged, so
existing owned/equipped saves need no migration or repurchase. The small repair
mask is tracked and content-addressed to bypass old cached magenta exports.

The shared importer now recognizes custom paint-by-number masks and rejects
invalid palettes and magenta missing-texture exports. Tests cover real owned
save rendering in Guided Spray and AI Duel, untouched hands, resource disposal,
native-input parsing, asset integrity and unchanged progression identity.
