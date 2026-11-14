# Held Utilities And Breakables Deployment: November 15, 2026

- Production: https://spraylab.pages.dev/
- Deployment: https://b62602dc.spraylab.pages.dev/
- Cloudflare deployment ID: `b62602dc-99ef-4ff4-bfd3-7aba6b7a5851`.
- Deployed runtime source: `8a77fa694994d5ee831b37092c1606c33d1f43fa`, branch `main`.
- Entry: `/assets/index-DXCKYDaI.js`.
- Entry SHA-256: `cffca7bcecbf86d380bb5b132ef70f017c4719df65578356b6526df0dfd8b882`.
- Uploaded 170 changed files; Cloudflare reused 10,221 existing files.

This publishes the sourced common-angle and pocket coverage updates, extended
Mirage clears, held-grenade attachment repair and mutable Mirage breakables.
The append-only changelog retains prior releases. Dust 2 remains provisional and
Mirage remains a labeled Beta; this deployment does not close their acceptance
or full CS2 fidelity gaps.

The unchanged runtime source had passed 7,066 regression tests and 428 Mirage
native admission cases in the implementation iteration. Deployment reran the
production build, TypeScript and map-source admission checks, full runtime asset
validation, and four deployment-packaging regressions. Asset validation included
94 exact-byte combat-model deliveries and 691 audio events / 920 unique samples.

The checked packaging step omitted only the redundant 42,298,070-byte raw Dust 2
grenade snapshot from generated `dist`. Its verified compressed delivery and all
local source assets remain intact. No game media was added to Git.

Post-deployment isolated Chromium contexts verified the production entry path and
SHA-256, enabled entry controls, nonblank canvas images, no horizontal overflow,
and no uncaught JavaScript or failed same-origin HTTP responses:

- Desktop Mirage Mid Duel: ready in 9.900 seconds.
- Desktop Dust 2 Mid Duel: ready in 5.044 seconds.
- Pixel 7 profile, Mirage A Ramp Prefire: ready in 6.517 seconds.
- Pixel 7 profile, Guided Spray: ready in 2.171 seconds.

The live Smoke viewmodel delivery was decompressed and checked against the local
model inventory SHA-256. The live Mirage full-map visual manifest was verified
through its pinned compressed delivery and contains all 12 mutable/linked native
entities. The latest changelog and retained history were checked in production.
Desktop Duel and mobile range screenshots were visually inspected.

These timings are single readiness smoke samples, not performance comparisons or
physical-phone benchmarks. Tests used fresh isolated profiles; existing user
progress, cookies, settings and storage were neither read nor cleared.

This receipt changes documentation only. The deployed runtime is the source
commit above, not the subsequent documentation commit. Runtime assets remain
local and deployed, not committed to Git.
