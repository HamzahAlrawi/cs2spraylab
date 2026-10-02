# Weapon Effects And Input Capture

## Static Native Sources

`src/range/weapon-fx-data.json` records local CS2 build 2000922, compiled weapon
data SHA-256, tracer cadence by fire mode, suppressed state, particle references,
and muzzle texture provenance. `tools/import-weapon-fx.mjs --verify` checks those
inputs and the exported texture. Extraction does not inspect a running game.

The native muzzle texture is decoded at its original 128x128 resolution. Its
additive black background is converted to straight alpha, not replaced with
generated artwork. This trainer uses pooled camera-facing sprites rather than
implementing Source 2's particle graph. Flash size, 45ms lifetime and fades are
presentation approximations; native particles include shorter lifetimes.

## Shot Presentation

Damage and impact scoring happen synchronously in the existing simulated shot
path. Tracers are cosmetic snapshots from the animated barrel to that physical
endpoint, not traveling projectiles and not a second damage calculation. They
cannot move old impacts when the camera moves. Native cadence is used for visible
tracers; USP-S, M4A1-S and MP5-SD produce no tracer. Suppressed muzzle flashes are
smaller, not an unsuppressed flame.

The common renderer bounds allocation to 64 tracer segments, 192 temporary
impacts, eight world muzzle sprites and two first-person sprites. Firing does
not construct geometry or materials. Native weapon-bone barrel anchors follow
firing/reload motion; Dual Berettas select the correct separate barrel. The
physical ray still originates at the existing eye/shot model.

All 30 firearms have native fire clips. All knife families use their own native
draw/inspect/attack clips. Additional procedural knife rotation was removed to
avoid rotating an already-authored attack twice. Refer to the native animation
and knife inventory audits for source hashes and assembly verification.

## Input Capture

Pointer lock is requested before fullscreen consumes transient activation. Entry
waits for the actual canvas owner, including browsers with legacy void-return
APIs. A raw-input NotSupportedError retries standard capture; late error events
from the failed raw request cannot reject a modern standard retry. Revisions
prevent a disposed/switched engine from acquiring stale input. Desktop denial
pauses with a retry message instead of silently switching to drag aim.
Touch entry bypasses desktop capture and fullscreen entirely. Browsers with no
capture API retain an explicitly labeled drag-aim fallback; an API that exists
but rejects capture does not silently fall back.

Fullscreen plus Keyboard Lock protects Ctrl+W only where the browser grants
that API. Escape remains available. C is the alternate crouch binding elsewhere.
Neither JavaScript key handlers nor this change can bypass browser policy.

Sources: [W3C Pointer Lock](https://www.w3.org/TR/pointerlock/) and
[Chrome Keyboard Lock](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock).

## Verification Boundaries

Tests cover fixed allocation, silent tracers, copied endpoints, minimum-one-frame
flashes, barrel placement, immediate marks, modern/legacy capture, raw fallback,
denial, mode switching, owned finishes and native inventory previews. Assets are
loaded on demand; the full catalog is not downloaded when a range opens.

The Windows Playwright WebKit build on this host lacks Web Audio and independently
rejects standard pointer lock with WrongDocumentError on an active root document.
Capability-gated tests record these limitations; negative/unavailable paths still
run. They do not establish full Safari support. Chromium/Firefox exercise real
native audio and pointer lock. Testing on old CPUs/iGPUs and real iOS remains
necessary; CPU throttling on an RTX 4080 is not an old-hardware guarantee.
