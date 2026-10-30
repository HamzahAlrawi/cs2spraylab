# Map Packages Deployment: October 31, 2026

- Production: https://spraylab.pages.dev/
- Deployment: https://6d7656ad.spraylab.pages.dev/
- Cloudflare deployment ID: `6d7656ad-04eb-41ab-9aaa-9ed2c2f17d4b`
- Source: `b7d28b69ae27ae891ed697f390db5616dff83356`, branch `main`.
- Entry module: `/assets/index-ufrlyxvN.js`, verified on the production domain.
- Uploaded 22 changed files; Cloudflare reused 6,836 existing files.
- Local extracted runtime media was deployed, not added to Git.

Fresh production build and source-only policy checks passed. The implementation
previously passed 6,589 unit tests, native map audits and desktop/mobile browser
regressions; see [implementation and validation](native-map-packages-2026-10-30.md).

Post-deployment isolated Chromium checks loaded Duel and Prefire at 1440x1000 and
412x915. All four scenes reached enabled entry controls and nonblank canvas
renders, without horizontal overflow, uncaught page errors or same-origin HTTP
errors. These checks used fresh browser contexts and did not access, modify or
clear the user's browser profile or progress. The first smoke attempt used the
default five-second assertion timeout and stopped while Prefire was still
loading; the rerun used an explicit native-map timeout and passed.

The existing changelog was preserved and includes the map-package/bot update.
Dust 2 remains the only shipped native map. This receipt changes documentation
only; the deployed application is the source commit listed above.
