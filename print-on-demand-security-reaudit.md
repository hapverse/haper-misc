# Print-on-demand: security re-audit (r2)

Auditor: navjot-security. Date: 2026-10-12. Scope: the fixes made after r1 (`print-on-demand-security-audit.md`), plus any new issues those fixes introduced. The working tree is uncommitted haper-backend. This was a read-only review. I read the code, ran the print test suites under Node 24 (user 150, admin 71, delivery 2 and cron 27 tests, all green), and ran two small benign component probes in a scratch directory.

## Verdict

**Not ready yet, but close.** One HIGH remains. It is what is left of H1, and the fix is about 10 lines. Once that lands and the checklist below is done, the feature is **ready for a single-store pilot**.

Counts: CRITICAL 0, HIGH 1, MEDIUM 0, LOW 6. Every other r1 item in scope (H2, M1, M2, M3, M4) is fixed and verified.

---

## HIGH

### R-H1. A crafted PDF can still exhaust memory, because the worker's memory limit does not cover decoded data (residual of H1)
- **Location:**
  - `packages/shared/utils/print-normalise.utils.js:167`: `PDFDocument.load` runs before any size check.
  - `print-normalise.utils.js:290`: the `resourceLimits` setting.
  - Inside pdf-lib: `node_modules/@cantoo/pdf-lib/cjs/core/parser/PDFParser.js:128,132` decodes object and xref streams eagerly. `cjs/core/streams/DecodeStream.js:127-139` grows the output with `new Uint8Array(size)` and has no limit.
- **What an attacker can do:**
  - A PDF can pack its objects into compressed "object streams". These are compressed blobs that the parser unpacks the moment it opens the file.
  - A 20 MB upload made of such blobs can unpack to many gigabytes.
  - This happens inside the worker. The worker's limit only covers the JavaScript heap. The unpacked data lives in typed-array buffers, which are outside that heap, so the limit never fires.
  - The whole API process can grow until the operating system kills it, and every customer request on that process goes down.
- **Evidence (component probes, benign data):**
  1. A worker started with `maxOldGenerationSizeMb: 64` allocated and kept 2 GB of `Uint8Array`s. It exited normally (code 0). No out-of-memory error was raised.
  2. pdf-lib's own flate decoder unpacked 512 MB of zeros (a 510 KB input) in 1.3 s, with peak RSS of about 1.1 GB, because buffer doubling copies the data.

  Within the 20 s timeout, one worker can therefore reach several GB of RSS. Two workers can run per process.

  The page-content pre-check (`decodedSize`, line 123) correctly blocks the obvious "zip bomb in the page content" case, and the new test covers it. Object and xref streams are unpacked earlier, during `load`, before that check runs.
- **Rating:** HIGH. Any logged-in customer can trigger it (sign-up is free). The impact is a crash of the customer API. It is harder to craft than r1's naive bomb, but the technique is well known.
- **Cheap fix (worker-only, about 10 lines):** add a decode budget in `print-normalise.worker.js`, before `normaliseInProcess` runs. The worker is its own isolate, so this patch never touches the main API:
  ```js
  const DecodeStream = require(path.join(path.dirname(require.resolve("@cantoo/pdf-lib")), "core/streams/DecodeStream.js")).default;
  let decoded = 0;
  const grow = DecodeStream.prototype.ensureBuffer;
  DecodeStream.prototype.ensureBuffer = function (requested) {
      if (requested > 64 * 1024 * 1024 || (decoded += Math.max(0, requested - this.buffer.byteLength)) > 512 * 1024 * 1024) {
          throw Object.assign(new Error("decode budget"), { statusCode: 422, reason: "FILE_TOO_COMPLEX" });
      }
      return grow.call(this, requested);
  };
  ```
  - Every pdf-lib decoder (Flate, LZW, RunLength, ASCII85/Hex, Decrypt) grows its output through `ensureBuffer`, so this one patch covers all of them.
  - The thrown error has to survive `copyPdfPages`. That function turns non-`errorUtils` errors into FILE_CORRUPT, and either 422 is acceptable. Using `errorUtils` keeps the reason as FILE_TOO_COMPLEX.
  - Pin `@cantoo/pdf-lib` to exactly `2.11.1`, because this relies on an internal class.
  - Add a test that checks a decode budget is enforced during `load`.
- **Interim ops mitigation:** set `PRINT_NORMALISE_CONCURRENCY=1` and `PRINT_NORMALISE_TIMEOUT_MS=8000`. Make sure the user API restarts automatically after an OOM (PM2 `max_memory_restart` or a systemd restart policy). The caps are per process, so N cluster processes give N times the exposure.

## MEDIUM

None.

## LOW

- **L-a. The decode-size check fails open on inflate errors.** Location: `print-normalise.utils.js:134-136`.
  - On any zlib error other than "too large", `decodedSize` returns the compressed length, so the stream is treated as small.
  - It is not exploitable as written, because pdf-lib stops at the same corruption. It is still the wrong default.
  - Fix: `throw tooComplex()`. The R-H1 patch also makes this moot.
- **L-b. Redaction depends on `lineType` being in the same object.** Location: `packages/shared/utils/print-privacy.utils.js:18`.
  - `stripPrintFileNames` only removes `print.fileName` when the item also carries `lineType: "PRINT"`.
  - Any future projection that selects `items.print` without `items.lineType` would leak the name.
  - The middleware also wraps only `res.json`.
  - Today no route uses `res.send` with order JSON, and no projection drops `lineType`. I checked every `$lookup` into orders, every items sub-projection, and every `res.send`/`res.write`/export.
  - Fix: strip `fileName` from any `print` sub-object, whatever its `lineType`.
- **L-c. `mark-status-admin` can skip printing.** Location: `packages/admin/src/routes/order/controller.js:905-916` (`markOrderAdmin`).
  - Assign and reassign now refuse OPEN print orders.
  - But `PATCH /admin/order/mark-status-admin` can still move an OPEN print order straight to ASSIGNED, OUT_FOR_DELIVERY or CLOSED. That breaks the rule "printed before it goes to a rider".
  - It needs `orders.change_status`, and no rider is attached, so this is a workflow-integrity gap, not a data leak.
  - Fix: in `markOrderAdmin`, refuse any status other than ADMIN_CANCELED for an OPEN print order.
- **L-d. The purge alert is slow, and the health hook is unused.**
  - `print.purge_bucket_unset` (`packages/cron/src/lib/payment-alert-codes.js:93`) goes to the **daily digest** tier, so someone may learn about it up to about 24 h late. That is as long as the whole privacy promise.
  - `module.exports.health` (`print-file-purge.js:159`) has no caller.
  - Fix: move `print.purge_bucket_unset` to the urgent tier.
- **L-e. Uploads are buffered in memory before the concurrency cap applies.** Location: `packages/user/src/routes/print/middleware.js:64-73`.
  - multer `memoryStorage` holds up to 20 MB per in-flight request before the semaphore is reached.
  - Each account can have up to 20 uploads in flight (the hourly cap).
  - This is minor next to R-H1. Consider a per-user in-flight limit of 1.
- **L-f. Some r1 LOWs are still open (seen while reviewing, not fully re-audited):**
  - **L1:** there is still no boot assertion that `PRINT_S3_BUCKET` differs from `AWS_S3_BUCKET_NAME` (`print-s3.utils.js:13-20`). This is now a human checklist item.
  - **L5:** 5xx responses are masked only when `NODE_ENV=production` (`user/src/middleware/error.js:56-59`). Worker errors that are not domain errors become a raw `Error(message)` (`print-normalise.utils.js:283,308`) and reach dev clients unmasked.
  - **L4:** the price-config audit is still best-effort (`admin/src/routes/print/controller.js:369`).
  - **L7:** the `@aws-sdk` range is still 3.600, and `npm audit` reports critical findings in `fast-xml-parser` through it.
  - **L6 is fixed:** `no-store` is set on the upload and job reads.

## Verified fixed (with the bypass attempts made)

- **H1 (main path):**
  - The worker is in place, with `resourceLimits`, a wall-clock kill and a process-wide semaphore. The semaphore hands its slot directly to the next waiter and releases it only after the worker exits, so a stuck worker keeps counting against the cap. Busy returns 503 with reason BUSY.
  - Page-content flate is measured with native zlib and `maxOutputLength`. Unknown filter chains are refused.
  - Images go through sharp inside the worker, with `limitInputPixels` 40 MP.
  - Errors cross the worker boundary as the fixed reason enum only. `printErrors` replaces any non-string `reason` with a mapped code, so driver objects never reach the client.
  - What remains is R-H1.
- **H2:**
  - The lockfile and the installed copy are both `multer@2.4.0`, which uses `busboy@1.6.0`. There is no nested 1.x copy.
  - 2.4.0 is past every known multer advisory, including CVE-2026-5079 (fixed in 2.2.0) and CVE-2026-3520 (fixed in 2.1.1).
  - `npm audit` flags `@fastify/busboy`, but that comes from firebase-admin and is not on the upload path.
- **M4:**
  - The lockfile and the installed copy are both `sharp@0.35.5`, with `@img/sharp-libvips-*` at 1.3.4.
  - GHSA-f88m-g3jw-g9cj is fixed from 0.35.0. `npm audit` reports nothing for sharp.
  - Optional hardening: `sharp.block({ operation: ["VipsForeignLoadNsgif","VipsForeignLoadTiff","VipsForeignLoadVips"] })` in the worker.
- **M1:**
  - The reject route now requires `print.manage` and `orders.change_status` (`admin/src/routes/print/router.js:19`). Print routes no longer include SUPPORT.
  - The redaction gate requires both a store role and `print.view`, so SUPPORT with `print.view` granted still sees no names.
  - Race and idempotency logic:
    - Rejecting twice, or a retry after a crash halfway through, refunds exactly once. `markOrderAdmin` is itself idempotent, and `isRejectCancel` allows the retry.
    - When reject and mark-printed race, the transaction in `markPrinted` aborts if the order is already cancelled.
    - The `owner` rule sends exactly one audit row and one push.
  - The tests cover the double-click, Orders-page cancel, the race, store B and the switched-in super-admin.
- **M2:** I grepped every reader of `fileName`/`originalName`.
  - **Rider API:** a router-wide `res.json` wrapper scrubs every delivery-order route and method. The stand-in `itemId` shows the job id and the server-built line name only.
  - **Admin:** the order and user routers are redacted. Print routes are gated to print staff.
  - **Other readers:**
    - Picking skips print orders (`pick-task.utils.js`).
    - The invoice and the order email use the server-built line name (`"B&W print …"`, no file name).
    - Realtime SSE payloads carry ids and status only.
    - The admin push says "N file(s)".
    - Razorpay notes and wallet logs carry no name.
    - Analytics and user `$lookup`s aggregate only.
    - There are no CSV or Excel exports.
    - No log line prints whole orders.
  - **Scrubbing:** purge (`print-job.repository.js:82-104`) scrubs the order line, `originalName` and `sha256`. Account purge calls `expireUserJobs` and `scrubUserFileNames` (`cron/src/jobs/account-purge.js:55-56`).
- **M3:** when the bucket is unset, the cron logs at error level and writes an alert row that has a real consumer (the payment-alert digest). Overdue LIVE files also raise an alert. See L-d for the tier.
- **New items:**
  - Assign and reassign refuse OPEN print orders, in both the pre-read and the atomic update filter (`order/controller.js:1725,1770,1889,1902`). The `$and`, `$or` and `$nor` keys do not collide.
  - ₹0 guards: `enableBlocker` and `assertPayable` (`print-pricing.utils.js:20-27,107,163`).
  - The customer `print` object holds only `stage`, `downloaded`, `filesPurged`, `rejectReason` and `rejectCode`. It has no keys, hashes or staff ids.
  - The customer stand-in `itemId` is the customer's own job id.
  - `Cache-Control: no-store` is set on upload, job reads and staff download.

**Notes (not print findings):**
- Functional: when a rider declines an assignment, a PACKED print order goes back to OPEN (`delivery/src/routes/order/controller.js:556`). Staff must press "Mark printed" again, which re-packs the order cleanly.
- Outside this re-audit's scope, flagged for a separate pass: `user/src/middleware/error.js:44-45` reflects any `Origin` with `Allow-Credentials: true` on error responses. `npm audit` also lists critical advisories in `express`/`proxy-addr`/`mongoose`.

## Pre-enable checklist (for the human, top to bottom)
1. [sumit-backend] Land the R-H1 decode budget in `print-normalise.worker.js`, plus a test, and pin `@cantoo/pdf-lib` to exactly `2.11.1`. Optionally fix L-a and L-c in the same change.
2. [anuj-devops] User API env:
   - `PRINT_S3_BUCKET` points to the dedicated private bucket and is **not** equal to `AWS_S3_BUCKET_NAME`.
   - `PRINT_NORMALISE_CONCURRENCY=1`.
   - `PRINT_NORMALISE_TIMEOUT_MS=10000`.
   - The process auto-restarts on OOM, with a memory alarm.
3. [anuj-devops] Set the same `PRINT_S3_BUCKET` on the cron service. Confirm the next `:40` run logs `candidates=` and not the "NOT being deleted" error.
4. [anuj-devops] Bucket settings from r1:
   - Block Public Access on.
   - Bucket owner enforced.
   - Versioning never enabled.
   - SSE-S3 with a deny-unencrypted policy.
   - TLS-only policy.
   - Lifecycle on `print/`: 15 days, plus abort incomplete multipart uploads after 1 day.
   - IAM scoped to `print/*` (Put/Get/Delete only; the cron role gets Delete only).
   - Access logs written to a separate bucket.
5. [anuj-devops] Deploy with `npm ci`. On the server, `npm ls multer sharp` must show 2.4.0 and 0.35.5, and the Linux libvips binary must load.
6. [admin owner] On the Team page, check that only the intended managers hold `print.view`/`print.manage`, and that rejecters also hold `orders.change_status`.
7. [super admin] Enable print on the one pilot store only, with both per-side prices above ₹0.
8. [QA] Smoke test on dev:
   - Upload a PDF and a JPG.
   - Order the print and download it. Check that an audit row appears.
   - Mark it printed, then assign a rider. The rider app must show "B&W print", with no file name.
   - Reject a second test order and check that it is refunded once.
   - Check that a support login sees no file names.
   - After 24 h, check that the purge removed the draft.

STATUS: done
OUTPUT: CRITICAL 0, HIGH 1 (R-H1 residual object-stream decode), MEDIUM 0, LOW 6. H2/M1/M2/M3/M4 + new guards verified fixed.
NEXT: rahul — route checklist item 1 (+L-a, L-c, L-b) to sumit-backend, items 2-5 + L-d to anuj-devops, item 6-8 to USER; then reschedule navjot to re-audit R-H1 only.
