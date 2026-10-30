# Independent Progress Saving: October 30, 2026

## Report And Diagnosis

The user reported Chrome on `https://spraylab.pages.dev/` returning to an older
level after refresh, with the armory's session-only warning. A clean isolated
production browser did not show that warning. We did not inspect or modify the
user's Chrome profile, so the exact browser-side trigger remains unconfirmed.

Source inspection identified reproducible failure paths:

- A localStorage read exception discarded its handle for the entire session and
  prevented the default IndexedDB mirror from being created.
- When all synchronous copy writes failed, ordinary new progress was deliberately
  not sent to IndexedDB; that independent store was recovery-only in this case.
- The persistent-storage button requested eviction protection, not a save retry.
  Granting or denying that permission could not repair either path.

Chrome quota exhaustion and blocked-read browser tests reproduce those conditions.
The fix preserves the existing key, profile schema and database. No site data is
cleared, no map-cache eviction is added, and gameplay mechanics are unchanged.

## Behavior

- Construct IndexedDB independently of localStorage availability. Retry transient
  localStorage access instead of permanently disabling it.
- Queue ordinary XP, wallet, collection and equipment changes to IndexedDB even
  if localStorage fails. Show `saving`, then `saved` only after transaction commit.
  Failure of both stores remains visible and exportable, never falsely successful.
- Gifts and confirmed backup imports can commit through either store, including
  gift receipts in the same document. Imports are now asynchronous; all callers
  await their result. Account operations cannot overlap an in-flight import.
- Compare the expected IndexedDB revision atomically before writing. A missed
  existing save or unexpected newer writer is not silently replaced. A committed
  newer local copy may repair an older mirror using an observed revision.
- Preserve future schemas and damaged primary bytes. Failure to quarantine a
  damaged local key blocks that local write, not a safe independent database save.
- Probe real writes at startup. Retry is available in Save & gifts; failed saves
  expose that section automatically. Focusing the window retries memory-only saves.
  The eviction permission request starts a retry too and shows explicit results.

## Verification

Focused unit coverage includes legacy saves after transient read failures, XP and
cosmetic persistence with full/inaccessible localStorage, pending/failed database
transactions, gift retry, imports, corrupt local bytes and future-schema safety.
Existing idempotent reward and achievement tests are retained, not relaxed.

`tests/progression-recovery.spec.ts` runs on desktop/mobile Chromium and includes:

- Real browser localStorage quota exhaustion, followed by redemption and refresh.
- IndexedDB recovery of level, credits, purchased finish and equipped finish while
  profile localStorage writes throw; duplicate gifts remain rejected after reload.
- Throwing localStorage reads, rotating-copy repair, independent-store recovery,
  cross-tab gift receipts, export/import and honest persistence-permission denial.
- Failure of both stores, visible retry guidance, recovery without deleting data,
  and an actual database compare-and-swap witness with a previously unseen save.

These are local browser/injected failure witnesses, not a claim to have recovered
the user's already-lost XP or reproduced their specific Chrome profile. No web
deployment is included in this iteration. Runtime assets remain ignored.

## Limits And User Recovery

Browser storage is still local to one origin/profile. Private sessions, explicit
site-data deletion, browser eviction and device loss can remove all local copies;
an exported backup remains necessary. A storage permission cannot override blocked
site-data settings. Ordinary simultaneous localStorage mutations are not a
server-backed transactional account system; divergent unsaved copies remain
protected rather than being guessed together. Already-unsaved session progress
cannot be reconstructed after it has been discarded by refresh.

Until deployment, keep any affected tab open and export its current profile from
Armory > Save & gifts. Do not clear site data. After deployment, existing valid
copies are compared automatically and Retry saving progress performs a real save.

References: [StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
requests eviction protection, subject to browser policy;
[browser storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
separate Web Storage limits from other storage mechanisms.
