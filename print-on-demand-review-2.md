# Print on demand — code review 2 (re-review of fixes, 2026-10-12)

Scope: print-related changes only (haper-backend uncommitted on dev, haper-admin Print pages, light pass on web/android/ios print models). Unrelated WIP not reviewed.

## What I ran (all in-memory Mongo)
- user jest: print-* + order* + oos-* + delete-account + discount-order + payment → 20 suites, 374/374 pass
- admin jest: print-* + order* + product-master-thumbnail + product-upload-image-limit + admin-gaps-upload + banner + items → 31 suites, 557/557 pass. print-* re-run in parallel mode: 71/71 (no flake seen)
- cron jest: print-file-purge + pick-task-reconcile* + payment-initiated + account* → 4 suites, 67/67 pass
- delivery jest: whole package → 9 suites, 163/163 pass
- haper-admin: `tsc -b` clean; Print + PrintServiceCard + permissions.print vitest 18/18 pass
- Runtime probes (plain node, no jest): real worker normalise (4 parallel calls, corrupt PDF, timeout, recovery all fine); sharp 0.35.5 resize chain from s3.utils (PNG with alpha, JPEG with EXIF rotation) fine; multer 2.4.0 with the s3.utils config (array, fileFilter, size limit, too many files) behaves the same as before.

## Previous findings
- H1 FIXED. `admin/src/routes/order/controller.js:1725` (assignOrder) and `:1889` (reassignDeliveryBoy) refuse an OPEN print order, and `notUnprintedPrintFilter()` is in both update filters (`:1770`, `:1902`). It does not collide with the other `$or`/`$nor` keys. Tested for picking on and off, plus reassign.
- M1 FIXED. All orderId lookups go through `byOrder()` (`print-job.repository.js:10`), which adds `$eq` + `$type`. An explain/profiler test checks it (`print-job-model.test.js:102-128`).
- M2 FIXED. The reject route needs `print.manage` + `orders.change_status` (`print/router.js:19`). The FE mirror (`PrintQueuePage.tsx:25`) is tested.
- M3 FIXED. `markPurged` replaces the name on the job and on the order line. `scrubUserFileNames` runs in account-purge before the user is anonymised. Both are idempotent (they write the same constant every time, so a retry is safe). The redact middleware hides file names from non-print roles on the admin order and user routes, and the delivery router strips them for riders.
- M4 ADDRESSED. A "ship the whole web print set together" note is at the top of `test-print-customer-web.md`.
- L1/L2 FIXED (owner logic + `isRejectCancel`). L3 FIXED (`enableBlocker` + `assertPayable`). L5 FIXED. L6 FIXED (`[200,409]`). L7 FIXED (rider stand-in itemId). L4 partly done (see N5). L8 unchanged (whole-rupee wallet; still a client check).

## MEDIUM

### N1. If the worker fails to start, its upload slot is never given back. After 2 such failures, every upload returns 503 until the process restarts
- `shared/utils/print-normalise.utils.js:288` and `:318-324`: `new Worker(...)` runs inside the Promise executor. If it throws synchronously (ERR_WORKER_INIT_FAILED when a thread can't be created, a DataCloneError, and so on), the promise rejects. But `started = true` is already set, so `finally` never calls `releaseSlot()`.
- Probe: I patched Worker to throw twice, then let it work. Result: call 1 and call 2 errored, and call 3 (with a healthy Worker) got `503 BUSY`. The 2 slots (the default `PRINT_NORMALISE_CONCURRENCY`) were gone for good.
- Fix: create the worker before the promise. Or wrap `new Worker` in try/catch that calls `releaseSlot()` and rethrows. Add a jest case that mocks the Worker constructor to throw once, then checks the next upload succeeds.

## LOW

### N2. A double-click Reject can write a `print.rejected` audit row with refundAmount 0
- `admin/src/routes/print/controller.js:290-302`. Request A's cancel does the refund. If request B (its cancel came back `alreadyInStatus`, refund 0) wins `rejectOrderJobs`, then B is the owner. It audits and responds with `refundAmount: 0`. The money itself is correct.
- Fix: the owner re-reads `order.refundedAmount` for the audit and response, instead of using its own cancel's `refundAmount`.

### N3. The print checkout response has no `order.print` block
- `user/src/routes/print/checkout.controller.js:280` uses `sanitizeOrderForCustomer` without `attachPrintStatus`. Every other customer order endpoint adds it.
- The client models treat it as nullable, so nothing crashes. But a client that reads `order.print.stage` right after checkout gets null.
- Fix: export `attachPrintStatus` and await it here.

### N4. Non-English file names are stored garbled
- multer/busboy decode the filename as latin1. A UTF-8 name like "रवि.pdf" arrives as "à¤°à¤µà¤¿.pdf". `sanitizeFileName` (`user/src/routes/print/controller.js:17`) keeps these characters (they match `\p{L}`), so the customer's file list and the staff queue show garbage.
- This is not a multer 2 regression: 1.4.5-lts does the same.
- Fix: `Buffer.from(raw, "latin1").toString("utf8")` before sanitising (fall back to the raw name if the result contains U+FFFD).

### N5. Leftovers from L4 (dead code)
- `file.sourceKey` is still required and always equals `printKey` (`print-jobs.schema.js:21`).
- `PrintJobRepository.missingIndexes` (`print-job.repository.js:461`) is only called by a test; boot calls `mongoIndexUtils` directly.
- Remove both, or leave them knowingly.
- The removed `job_store_status` index, `CANCELLED` and `reprints` have no references left (grep clean).

### N6. Deploy check: sharp 0.35.5 needs Node >= 20.9.0
- CI uses `node-version: '20'` (latest 20.x).
- Confirm `node -v` on the EC2 host before deploying.
- The lockfile has the `@img/sharp-linux-x64` 0.35.5 binaries.

## Checked and clean
- **Worker:**
  - The timeout, OOM, early-exit and error-message paths each settle exactly once and release the slot only when the worker exits.
  - Queue hand-off keeps the active count correct, and a waiter that times out removes itself.
  - Jest runs the real worker (hardening suite). Plain node shows the same behaviour.
- **print-privacy.utils direct-path require:** resolves through the `node_modules/shared` symlink from admin and delivery. Same pattern as the existing `require("shared/models")`.
- **redactPrintFileName:**
  - Only wraps `res.json`, so streaming and downloads are untouched. Bodies that are not objects pass through.
  - Response shape only loses `items[].print.fileName` on print lines.
  - It is mounted only on the admin order and user routers; no other admin controller returns order items.
  - Cost: one extra JSON clone per response, only for roles without print access.
- **`file.sha256` optional:** schema default is null, and it is nulled on purge/scrub. Nothing reads it.
- **Customer `print` block:** additive and only on print orders. Android/iOS/web models decode every field as optional.
- **Rider stand-in:** the name is the line label, which has no file name.
- **₹0 guards:** a zero price is refused when printing is enabled, and quotes require a total above 0.
- **Comments:** no worklog text, no leaked agent/process names, no dangling doc references.

## Not mine / pre-existing (FYI)
- Delete-account `PENDING_ORDER_STATUSES` (`user/src/routes/profile/controller.js:13`) does not include PACKED. This predates print, but a printed, waiting print order no longer blocks account deletion.

## Verdict
REQUEST CHANGES. Every finding from review 1 is fixed. N1 is a small fix, but without it a short burst of worker-start failures disables printing uploads until a restart.

STATUS: done
OUTPUT: REQUEST CHANGES — 0 critical, 0 high, 1 medium, 5 low (all review-1 H/M items verified fixed)
NEXT: rahul — route N1 (then N2–N4) to the print-on-demand backend engineer; after the N1 fix, kiran-git
