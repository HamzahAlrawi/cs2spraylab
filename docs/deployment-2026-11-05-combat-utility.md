# Combat and Utility Deployment: November 5, 2026

- Production: https://spraylab.pages.dev/
- Deployment: https://b7408baa.spraylab.pages.dev/
- Cloudflare deployment ID: `b7408baa-b43b-47e0-b862-6f8ba1413d0e`.
- Source: `d47e439382043930cfab46a93679592db353c294`, branch `main`.
- Production entry: `/assets/index-DiKFFGSw.js`; served bytes matched the local
  build's SHA-256 in isolated desktop and mobile browser contexts.
- Uploaded 21 changed files; Cloudflare reused 6,839 existing files.
- Local runtime assets were deployed, not added to Git.

The source was already committed and pushed. A fresh TypeScript/production build,
full runtime asset validation, and source-only policy check passed before deploy.
The deployed implementation previously passed `npm run check`: 290 test files /
6,733 tests, plus the selected browser and native arithmetic checks recorded in
[the implementation audit](combat-utility-audit-2026-11-05.md).
The existing large-bundle warning remains.

Post-deployment checks used isolated Chromium contexts at 1440x1000 and 412x915.
AI Duel, Dust 2 Prefire and Guided Spray each reached visible, enabled entry
controls after loading completed and rendered nonblank maps. All six checks
passed without horizontal overflow, uncaught page errors or same-origin HTTP
errors. Screenshots were visually inspected. The initial screenshot check had
captured Prefire's loading overlay; it was corrected to wait for visible entry
controls and absence of the loading indicator, then rerun successfully.

Both viewports verified the November 5 changelog and retained November 4 entry.
No existing user profile, progress, cookies or site storage was accessed or
cleared. These readiness checks are not an exhaustive production gameplay or
performance benchmark; fidelity limits remain in the implementation audit.

This receipt is documentation only. No gameplay code changed in this deployment
iteration. The deployed application is the source commit above, not the later
receipt commit.
