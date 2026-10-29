# Persistent chunks and round readiness

## Storage contract

Map resources use `spraylab-map-bytes-v1` CacheStorage, not localStorage. Content
hashes, sizes and decoded hashes come from release-pinned manifests. An unchanged
hash is served locally without an HTTP request, even after a page reload or code
deployment. A changed object gets a new key; compatible objects are not wiped on
deployment. Updates therefore download changed objects, not whole unchanged maps.

The compressed-byte cache remains quota-aware, up to 512 MiB. RAM bytes have a
separate 80 MiB budget. Cache maintenance now inventories keys once per page and
batches recency into a small metadata record, rather than scanning every body or
rewriting multi-megabyte assets on each touch. The existing cache name is retained
for migration. Quota recovery only evicts our own oldest asset bodies, never XP,
settings or other caches. Cross-tab recency is best-effort; hashes remain checked.
Safe map-slug namespaces no longer hardcode Dust 2 in the generic asset validator.

Browser storage is not an unconditional permanent installation. User-cleared site
data, private browsing, denied storage or eviction can require another download.
The existing Armory > Save & gifts > Request persistent storage control can ask
the browser for stronger retention; loading assets never triggers a permission
prompt. See [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## Readiness and bounded memory

Disk bytes still need decompression, collision restoration, scene construction and
GPU uploads. These are distinct from downloading. The current/replay map and one
prepared next map keep their existing ownership. Capable devices additionally
retain up to two older scenes within a 384 MiB conservative estimated budget;
low-memory devices do not. The estimate includes CPU/GPU geometry, decoded texture
storage and collision overhead, but is not a driver-memory measurement. Entry
limits also bound unmeasured resources. Eviction frees their collision and render
owners. Active/replay/next resources cannot be evicted by the older-scene LRU.

Native maps preserve their already-computed world transforms and glTF bounds.
No collision, navigation coordinates, triangle floats or shot/movement arithmetic
were changed. Reusable chunk shadows transfer with retained maps instead of being
rebaked on every return.

Initial chunks now receive the same complete GPU preparation as prefetched chunks.
Uploads are paced by decoded RGBA/mipmap bytes as well as CPU time. Cached Blob
creation and background image work are bounded. A WebGL2 fence is polled between
frames, without `finish()` or synchronous waits, before readiness is reported.
This distinguishes submitting uploads from completing them. Actor warmup also
settles before a new round starts. A short settling interval separates a new
fight from the next background preload. Continuous losses and wins retain the
range frame during handoff instead of replacing it with a full loading overlay.

Cold entry can take longer because work previously deferred into play now happens
before Enter. Slow downloads, storage denial and full scene reconstruction after
memory eviction remain real costs; this is not a promise of zero latency on every
device. Background cold construction can still produce long tasks; paced uploads
are not a complete off-thread glTF parser or a GPU-compressed texture pipeline.

## Verification

- `tests/duel-disk-cache.spec.ts` closes the original page, disables HTTP caching,
  bypasses service workers, and blocks every `/maps/` network request. The new
  page must enter rendered native-map combat using disk bytes and restored query
  snapshots, preserve saved data, and reuse bytes from a distinct code module.
- `tests/real-map-duel.spec.ts` covers winning freeplay, errors, capture continuity,
  setup edits, staged actor readiness, previous-map reuse and fight review.
- Unit tests cover content updates, corrupt/denied storage, bounded quota errors,
  metadata batching, LRU ownership/eviction, GPU completion/cancellation, render
  state restoration and immutable native world transforms.
- `node tools/audit-chunk-handoffs.mjs` measures the destination chunk, not a
  pre-transition frame, and samples its first three seconds. Optional CPU
  throttling remains synthetic, not validation on an actual older machine.

One final local five-bot Auto-graphics run measured prepared Mid-to-Catwalk and
Catwalk-to-B-entry handoffs at 144.9 ms and 101.4 ms. Maximum frame CPU work over
each destination's first three seconds was 11.3 ms and 11.5 ms. Hardware was an
i7-13700K / RTX 4080; competing workloads were not controlled. These are two
prepared-chunk samples, not cold-download timings, GPU frame times or a guarantee
for random cold chunk construction on all devices.
