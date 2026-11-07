# Wall Contact And Loading Deployment: November 7, 2026

- Production: https://spraylab.pages.dev/
- Deployment: https://9f377dac.spraylab.pages.dev/
- Cloudflare deployment ID: `9f377dac-5b26-490f-91d5-5bb05ce97776`.
- Deployed source: `4580896186102160dc40dffa95cb10a96b44f1a9`, branch `main`.
- Gameplay fix: `eb6c4d3`; faster loading: `a5c1a40`.
- Entry: `/assets/index-zyZNkiwv.js`.
- Entry SHA-256: `3702355d31ad004dff5c055e7fe292b49435e0cde8c9cf2deb4f76c228611d05`.
- Uploaded 3,396 changed files; Cloudflare reused 6,989 existing files.

The implementation passed 7,007 regression tests in two complete coverage shards,
212 Mirage native admission cases, all ten Dust 2 shipped-pool approaches and
desktop/mobile browser regressions. Mirage remains a labeled Beta and Dust 2
provisional; existing fidelity gaps are not closed by this deployment.

A fresh production build, runtime asset verification (94 verified combat-model
deliveries and 691 audio events / 920 unique samples), and source-only policy
checks passed before publishing. The append-only changelog retains earlier
releases and includes the loading and wall/floor-contact updates.

The first upload was rejected before deployment because a redundant raw Dust 2
grenade snapshot exceeded Pages' 25 MiB per-file limit. The new tested
`tools/prepare-pages-deploy.mjs` verifies the pinned compressed manifest, delivered
bytes and decoded snapshot identity before omitting only that generated raw copy
from `dist`. The 42,298,070-byte authoring snapshot remains in local source assets;
the application's exact-byte compressed delivery is unchanged. Four packaging
regressions passed. Follow the updated README sequence after future builds.

Post-deployment isolated Chromium contexts checked the production entry path and
SHA-256, enabled entry controls, nonblank canvas images, no horizontal overflow,
and no uncaught page or same-origin HTTP errors:

- Desktop Mirage Mid Duel: ready in 5.09 seconds.
- Desktop Dust 2 Mid Duel: ready in 4.38 seconds.
- Pixel 7 profile, Mirage A Ramp Prefire: ready in 5.25 seconds.
- Pixel 7 profile, Guided Spray: ready in 2.55 seconds.

These are single smoke-test samples, not comparative performance or physical-phone
benchmarks. An initial ad-hoc mobile emulation check failed navigation/readiness;
the standard Pixel 7 contexts were rerun and passed. Desktop Duel and mobile range
screenshots were visually inspected. Tests used new isolated profiles; no existing
user progress, cookies, settings or storage were read or cleared.

This receipt changes documentation only. The deployed application is the source
commit above, not the subsequent receipt commit. Runtime game assets remain local
and deployed, not committed to Git.
