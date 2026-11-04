# Chunk Preparation Deployment: November 4, 2026

- Production: https://spraylab.pages.dev/
- Deployment: https://552d2c99.spraylab.pages.dev/
- Cloudflare deployment ID: `552d2c99-2f47-4111-aee8-85f8880a3865`
- Source: `057cc4b0771f57a863b42ca274ce5ff650072600`, branch `main`.
- Production entry module: `/assets/index-Z6Yy8O8H.js`, matched against the local build.
- Uploaded 19 changed files; Cloudflare reused 6,841 existing files.
- Local runtime media was deployed, not added to Git.

Git push was confirmed before deployment. A fresh TypeScript/production build
and source-only policy checks passed. This exact implementation previously
passed `npm run check`: 287 files / 6,679 tests, plus native browser and production
smoke checks. See [implementation, measurements and limits](chunk-startup-performance-2026-11-04.md).

Post-deployment isolated Chromium contexts verified Duel, Prefire and Guided
Spray at 1440x1000 and 412x915: all six reached enabled entry controls and nonblank
canvas renders, with no horizontal overflow, uncaught page errors or same-origin
HTTP errors. Both viewports showed the November 4 changelog. The production domain
successfully loaded the new inflation/geometry workers and the collision/cache
workers. No existing user browser profile or saved progress was accessed or cleared.

The append-only changelog retains the previous update, including the previously
undeployed October 31 combat/utility work. No new gameplay changes were made in
this deployment-only iteration. First-entry CPU and indivisible Rapier restore
limits remain as documented; readiness checks are not a universal FPS guarantee.

This receipt is documentation only. The deployed application is the source
commit listed above, not the subsequent receipt commit.
