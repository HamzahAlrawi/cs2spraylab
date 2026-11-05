# Rewards and Cover Deployment: November 5, 2026

- Production: https://spraylab.pages.dev/
- Deployment: https://1e3c697c.spraylab.pages.dev/
- Cloudflare deployment ID: `1e3c697c-037a-4d7f-a308-3cfd36b73b83`.
- Deployed source: `1232522105b908843aed93c6cbffdb6544f43972`, branch `main`.
- Entry: `/assets/index-BvFZ6T6f.js`.
- Entry SHA-256: `439f8b10d6a8d82cb7b86a9b7ccab41cd3cc452b3a7c5544e58ab4368be55c7c`.
- Uploaded 17 changed files; Cloudflare reused 6,843 existing files.

The source iteration passed `npm run check`: 294 files / 6,882 tests and the
production build. A fresh production build and full runtime asset validation
passed again immediately before deployment. Runtime assets remain local and
deployed, not committed to Git. The existing large-bundle warning remains.

Isolated Chromium desktop (1440x1000) and mobile (412x915) contexts verified the
served entry hash, visible enabled entry controls and nonblank rendering for AI
Duel, Prefire and Guided Spray. Training reserve HUDs show infinity. The Armory
opens on the rewards overview and lists 172 achievements. The new changelog and
the retained November 4 entry were checked. All six mode-readiness checks passed
without horizontal overflow, uncaught page errors or same-origin HTTP errors.
Desktop range and mobile achievement screenshots were visually inspected.

These are deployment smoke checks, not exhaustive production combat or FPS
benchmarks. No existing user profiles, progress, cookies or site data were read
or cleared. Gameplay limits and implementation details are recorded in
[the iteration notes](rewards-cover-2026-11-05.md).

This receipt is documentation only. The deployed app is the source commit above,
not the later receipt commit. Changelog history was preserved.
