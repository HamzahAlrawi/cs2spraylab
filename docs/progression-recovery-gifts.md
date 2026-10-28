# Progress recovery and owner gifts

## Storage audit

No progress-clearing call was found in the map-asset cleanup. Asset eviction is
scoped to named Cache API entries, not the progression key or profile database.
The previous progression controller did have two loss risks: a stale tab could
save its old profile over a newer one, and the only save could be replaced after
a parse failure. These are plausible causes, not proof of any particular user's
loss. Browser/private-session cleanup and changing origins remain other causes.

The primary key remains `spraylab.progression.v1`, with profile version 2, so
existing profiles migrate without changing their origin or resetting collections.
The controller now keeps checksummed `backup.latest` / `backup.previous` copies,
preserves damaged primary bytes in a bounded `.corrupt` slot before repair, and
has an independent IndexedDB copy in `spraylab-profile-backups-v1` / `profiles`.
Unknown future schemas are protected, not migrated back to an older schema.

Startup compares the local copies with IndexedDB before mounting a drill or
issuing reward tokens. Normal writes remain synchronous and small; only the tiny
independent mirror is queued asynchronously. No map downloads or scene data are
included. Storage events refresh other tabs, and mutations refresh the current
saved revision before computing awards or purchases. Gift claims use a Web Lock
where available. This is not a server-backed transactional account system, and
ordinary simultaneous cross-tab writes cannot be guaranteed fully serializable.

If every synchronous profile-copy write fails (for example, full localStorage),
the new session remains explicitly memory-only and exportable. A failed commit
is not promoted into the mirror or described as saved. This keeps another stale
tab from promoting old localStorage over an independent mirror-only reward.
Gift claims require a successful synchronous commit; a failed claim is retryable.

The Armory's **Save & gifts** section exports/imports a complete JSON backup,
including wallet, cosmetics, milestones, achievements and gift receipts. Import
requires confirmation; bad checksums and newer schemas are rejected. Importing
an older backup retains already-redeemed gift IDs from the current profile.
Checksums detect accidental damage; they are not an anti-cheat signature.

Persistent storage is requested only from an explicit button. A denial is not
reported as protection. Browser storage is origin-specific: `localhost:5176`,
`127.0.0.1:5176`, preview deployments and `spraylab.pages.dev` are separate saves.
Use export/import to move between them. **Clearing all site data, changing browser
profiles, private browsing or deleting the browser profile can remove every local
copy. Only an exported file or a future account backup can survive that.**

Primary references:
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist

## Level-50 recovery gift

Short code: `SPRAYLAB-L50-045794E5F92C1EAF`

The signed form and shareable owner note are in
`.local-tools/gifts/level50-recovery.txt` (intentionally gitignored).

The reward is a **top-up**, not an additive grant of 50 levels:

- Minimum total XP: **91,385** (`xpForLevel(50)`).
- Estimated play credits: **50,261**, using an XP-weighted **80% AI Duel / 20%
  other-drill mix**, from the existing 0.60 / 0.35 credit rates.
- Level-10/20/30/40/50 milestone allowance: **22,500**.
- Minimum lifetime earned credits: **72,761**. Previous spending stays spent.
  For example, 1,000 previously earned and 500 spent means a 71,761-credit top-up
  and a resulting wallet of 72,261, not 72,761 plus a refund of every purchase.
- No fabricated rounds, wins, kills, skill metrics or combat achievements.
  Genuine level-based achievements can unlock. Level milestones through 50 are
  marked as included so the next completed round cannot award them again.
- Players already above either floor are never reduced; purchases and cosmetics
  are preserved. Attempt-count milestones are not estimated because level alone
  does not establish how many rounds a person played.

Real earnings vary with scores, bot skill, duration caps and per-round rounding;
this is a transparent compensation estimate, not a reconstructed match history.
The code becomes available to deployed users only after deploying this version.

## Issue more gifts

The browser has **only public P-256 verification keys**. Issuing is offline:

```powershell
# Already initialized in this checkout; safe to rerun without replacing the key.
node tools/gift-codes.mjs init

# New signed grant. The existing public key must already be deployed.
node tools/gift-codes.mjs issue --xp 5000 --credits 3000 --label "Community gift" --out .local-tools/gifts/community.txt

# Minimum-level recovery, optionally expiring (ISO date).
node tools/gift-codes.mjs issue --level 50 --duel-share 0.8 --label "Progress recovery" --out .local-tools/gifts/recovery-new.txt

# Add --short for a short alias; its updated alias registry requires deployment.
```

`init` registers the public key in `src/range/gift-public-keys.json`. Signed codes
from that issuer do not require another deployment for every new gift. `--short`
adds a SHA-256-indexed alias in `src/range/gift-code-aliases.json`; short aliases do
require the updated registry to be deployed. Keep both public registries in Git.
Keep old public keys while previously issued codes must remain valid.

**Back up `.local-tools/gifts/issuer-private-key.pem` privately. Never commit,
upload or serve it.** The whole `.local-tools` directory and PEM files are ignored.
The issuer key is not a CS2 asset and is not included in the browser build.

Signatures prevent arbitrary unsigned rewards from being accepted as owner gifts.
Redemption receipts and rewards are saved together; failed writes do not consume
a code. Each gift ID is redeemable once **per local profile**, not once worldwide.
Sharing a code allows multiple users to redeem it. Clearing all local data or
editing a local profile can bypass local limits. Truly single-recipient/global
vouchers need an authenticated backend and a transactional redemption ledger.

## Verification

`progression-recovery.test.ts` covers damaged/missing primaries, both backup slots,
quota failures, stale tabs, independent-copy startup ordering, future-schema
protection, top-up accounting, duplicate receipts and portable imports.
`gift-codes.test.ts` verifies ECDSA signatures, tampering, expiry and the shipped
campaign. `tests/progression-recovery.spec.ts` exercises real downloads/imports,
IndexedDB recovery, multiple tabs and persistence denial in desktop/mobile
Chromium. Run `npm run check` and these browser tests before deployment.

Validation completed October 29, 2026:
- `npm run check`: 254 test files / 4,893 tests passed; TypeScript and production build passed.
- Chromium desktop/mobile and Firefox: 18 browser tests passed, including real
  downloads/imports, quota failures, duplicate claims, tab updates and future-format
  IndexedDB write protection. Mobile layout screenshots inspected.
- A separate read-only review found startup ordering, future-format and reserved-ID
  issues; these were corrected and regression-tested. No further concrete issues
  were found in the follow-up review. Simultaneous cross-tab limitations remain.
- Private issuer key is gitignored; no private issuer markers in client JS.
- Existing bundle-size warnings remain. No deployment was performed.
