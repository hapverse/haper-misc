# Print-on-demand — security re-audit round 3 (final, targeted)

- Date: 2026-10-12. Auditor: navjot-security. Read-only.
- Tree: haper-backend working tree, uncommitted.
- Scope: the round-2 fixes. R-H1 decode budget, upload file names, admin guards, file-name redaction, purge alert tier, and anything new.
- Method:
  - Read the code.
  - `npm ci --dry-run` against a scratch copy of package.json, the lockfile and the workspace manifests.
  - Small local probes that call `normalise()` with hand-built PDFs. These lived in the scratchpad only. No repo test suites were run.

## Verdict

**READY for a single-store pilot (Bheldi)** once the human checklist below is done.

- No CRITICAL, HIGH or MEDIUM findings remain.
- R-H1 is closed.
- Four LOWs and some carry-overs remain. None blocks a pilot.

## R-H1 — PDF "stream bomb" defence: FIXED (verified by probe)

Plain words: a PDF can hold a tiny compressed blob that grows into gigabytes when it is unpacked, like a 2 MB zip that expands to 2 GB. Before this fix, the server unpacked those blobs with no limit, and the memory sat outside the worker's heap cap. Now every unpack is metered. Once a file uses its allowance, the upload is refused with "file too complex".

### What was checked

- **Patch** (`packages/shared/utils/print-normalise.utils.js:171-192`):
  - It wraps `DecodeStream.prototype.ensureBuffer`. I confirmed in `node_modules/@cantoo/pdf-lib/cjs/core/streams/` that every decoder grows its output only through that method: Flate, LZW, ASCII85, ASCIIHex, RunLength and Decrypt. No subclass overrides it.
  - The per-stream check uses the requested size. The total check uses the real power-of-two allocation.
  - `minBufferLength` cannot be pushed up by the file. `decode.js` never passes a length, and DecryptStream's length is capped at the 20 MB input.
- **Fail-closed:**
  - If the method or the file path is missing (for example after a pdf-lib upgrade), `installDecodeBudget` throws. The worker's `.catch` then fails the upload (`print-normalise.worker.js:16-20`).
  - The patch is applied before any parsing.
  - The "tripped" flag is sticky. It is re-checked after load (`:214`), in the copy catch (`:203`), and after save (`:276`, `:280`). So pdf-lib swallowing errors per object cannot hide a trip.
- **Same module instance:**
  - `require.resolve("@cantoo/pdf-lib")` points to `cjs/index.js`, so the patched file is the one the decoders load.
  - `npm ls` shows a single copy at 2.11.1.
- **Pin and lockfile:**
  - `package.json` has `"@cantoo/pdf-lib": "2.11.1"` (exact).
  - The lockfile entry matches: version 2.11.1, and the integrity hash equals the registry's `npm view` value.
  - `npm ci --dry-run` on a scratch copy exited 0 ("added 1359 packages"). **`npm ci` will not fail.**
- **Probe results** (worker run, default budgets; each line is a hand-built PDF):

| Case | Result | Time |
|---|---|---|
| ObjStm that unpacks to 2 GB (2 MB file) | 422 FILE_TOO_COMPLEX | 0.2 s |
| Filter chain `[/FlateDecode /FlateDecode]` bomb (4 KB file) | 422 FILE_TOO_COMPLEX | 0.2 s |
| Page-content bomb | 422 (pre-check) | 0.1 s |
| 9 object streams x 60 MB (540 MB > 512 total) | 422 | 2.3 s |
| 7 object streams x 60 MB (420 MB, under budget) | accepted; worker peak about 190 MB RSS | 2.1 s |
| Page tree as a DAG, 2^26 leaves | 422 (heap cap) | 3.9 s |
| Cyclic page tree | 422 FILE_CORRUPT | 0.1 s |
| 200k flat page refs | 422 TOO_MANY_PAGES | 0.1 s |
| Legit 60 pages x 2 MB content / 100 pages / 4 x 30 MB | all OK, about 1.2 s each, even with TOTAL=128 MB | |

### Other decode paths checked

- **Image XObjects, inline images, DCT/JPX/JBIG2/CCITT:** never decoded. Pages are embedded by reference and written raw on save. Inline images are just bytes inside the content stream.
- **Predictors / PNG / TIFF:** pdf-lib does not implement predictors, so there is no expansion step.
- **Non-Flate filter on page content:** rejected by the pre-check. Unknown filters throw `UnsupportedEncodingError`.
- **`/Length` lies:** the parser rescans to `endstream`, so the size stays bounded by the 20 MB input.
- **fflate `unzlibSync` (upng):** only reachable from PNG embedding, which this path never uses. Images go through sharp and then `embedJpg`.
- **L-a from round 2 is fixed:** `decodedSize` now throws on any inflate error (`:136`).

### Worker, queue and gate interaction

- The N1 slot-leak fix is correct.
  - The slot is released exactly once, after the worker has stopped (`stopped.then(releaseSlot)` inside a once-only `settle`).
  - If the constructor throws synchronously, the slot is released through `started=false` (`:371-378`).
  - A waiter that times out is removed from the queue. A waiter that gets a slot handed over has its timer cleared.
- `uploadGate` (`packages/user/src/routes/print/middleware.js:95-109`) caps multer buffering per process. It releases on `finish` or `close`, guarded so it runs only once.

### Residual risk after R-H1: LOW

Worst-case memory per worker is about:
- heap 256 MB, plus young generation 32 MB,
- plus the decode budget (about 1.5x while a buffer is being copied),
- plus up to about 200 MB of native sharp memory for a 40 MP image.

The cost is CPU and print-queue time, not a server crash. Each bad file holds a slot for at most the timeout. See L1.

## (2) Upload file names: FIXED

- `defParamCharset: "utf8"` is set (`middleware.js:67`). multer 2.4.0 passes it to busboy 1.6.0 (`multer/lib/make-middleware.js:241`).
- multer 2.4.0 is clear of every 2026 multer advisory I found (CVE-2026-2359/3304/3520/5038/5079; the newest fix line is 2.2.0).
- `sanitizeFileName` (`packages/user/src/routes/print/controller.js:17-21`) was probed with:
  - RTL override U+202E: stripped (`"inv‮fdp.exe"` becomes `"invfdp.exe"`).
  - Zero-width characters: stripped.
  - NUL, CR, LF and tab: stripped.
  - `../` and `..\`: only the base name is kept.
  - HTML and quote characters (`<>="`;): stripped.
  - Leading dots: stripped.
  - Hindi and Arabic names: kept intact.
- Nothing dangerous can reach a header or the HTML. The staff download name is `<orderId>.pdf` and never uses the customer's file name.
- One cosmetic gap remains: see L2.

## (3) Admin guards and privacy: FIXED

- **mark-status-admin** (`packages/admin/src/routes/order/controller.js`):
  - Pre-check: `:1021-1027`.
  - Write filter: `:1158` uses `$and:[{$or:[orderType≠print, status≠OPEN]}]`, so it cannot clash with the `$or`/`$nor` keys of the other filters.
  - The `orderType` field never changes after creation, so the guard flag cannot be wrong.
  - A stale secondary read on attempt 1 fails the filtered write. The retry then re-reads the primary (`:930-932`) and refuses.
  - Reopen of a print order is blocked (`reopen.service.js:75-77`). Edit is blocked (`:526-531`). Convert-to-COD is blocked (`:1354-1356`).
- **Assign and reassign:**
  - Pre-checks: `:1733`, `:1897`.
  - The same filter is repeated in the write: `:1778`, `:1910`.
  - On stores without picking, PACKED was added to the statuses an order can be assigned from. Only print orders can reach PACKED there.
- **Other ways to move an OPEN print order forward:** none found.
  - Print orders get no pick tasks (`pick-task.utils.js:153`, `pick-task-reconcile.js:46`), so the picker app cannot pack one.
  - Rider writes only touch ASSIGNED orders.
- **Reject:**
  - Needs both `print.manage` and `orders.change_status` (router `:19`).
  - The cancel runs through `markOrderAdmin`.
  - The refund amount is re-read from the primary (`print/controller.js:300-301`).
  - Exactly one request writes the audit row and sends the push (`:296-311`).
- **Redaction** (`packages/shared/utils/print-privacy.utils.js:12-27`):
  - It now strips `fileName`/`originalName` from any `print` object at any depth, with or without `lineType`. This fixes round-2 L-b.
  - The body is JSON-cloned first, so Mongoose documents and populated paths are flattened.
  - Coverage checked:
    - Admin order router (`router.js:17`) and admin user router (`router.js:10`).
    - Rider: the whole delivery order router (`delivery/src/routes/order/router.js:10-28`), the only delivery router that returns orders.
    - Admin print routes: role-gated to the same audience as `canSeePrintFileNames`.
    - Invoice PDF (`res.send`): uses the generic line name.
    - Order-created email: generic `item.name`.
    - Realtime events: ids and status only.
    - Analytics, delivery-boy, POS and picker: no item lists from orders.
  - **No remaining path leaks the file name.**
- **Purge alert:** `print.purge_bucket_unset` is now in the urgent tier (`payment-alert-codes.js:139`).
  - Effect: while the bucket is unset and live files exist, super admins get one grouped email per hour (:40 write, :25 send).
  - That is acceptable. It only fires when customer documents are really not being deleted, and it stops as soon as the variable is set.

## Findings

### CRITICAL / HIGH / MEDIUM
None.

### LOW

- **L1. One account can hold the print upload queue busy.**
  - Location: `packages/user/src/routes/print/middleware.js:95-109`, `print-normalise.utils.js:294-299`.
  - What an attacker can do: fire 6 parallel uploads of "slow" PDFs. Each holds a slot until the timeout, and other customers get "busy, try in a minute" (503). It is capped at 20 uploads per hour per account. It affects the print feature only, not money or data.
  - Fix:
    - Add a per-user in-flight limit of 1. For example, a `Set` of userIds checked inside `uploadGate`, released on the same `finish`/`close` events.
    - Keep `PRINT_NORMALISE_TIMEOUT_MS=10000`.
- **L2. Unlimited combining marks in file names.**
  - Location: `user/src/routes/print/controller.js:19`.
  - What happens: a name made of 1 letter plus 199 accent marks ("Zalgo text") renders as a tall smear over neighbouring rows in the admin print queue. Cosmetic only.
  - Fix: after the replace, run `.normalize("NFC").replace(/(\p{M}{3})\p{M}+/gu, "$1")`.
- **L3. A rider declining a print order sends it back to "To print".**
  - Location: `delivery/src/routes/order/controller.js:556`.
  - What happens: staff may print it a second time. Recovery works: "Mark printed" re-packs the order cleanly.
  - Fix: either have rider-decline restore PACKED for `orderType: "print"`, or show a "Printed" badge on the To-print row when every job is already PRINTED.
- **L4. New tuning variables are undocumented.**
  - Location: `.env.example:38-39`.
  - What is missing: `PRINT_NORMALISE_*`, `PRINT_DECODE_*` and `PRINT_UPLOAD_MAX_IN_FLIGHT` are not listed, so ops cannot find them. The defaults in code are safe.
  - Fix: add them with the pilot values below.

### Carry-overs (unchanged, not pilot blockers)

- Round-1 L1: there is still no boot check that `PRINT_S3_BUCKET` differs from `AWS_S3_BUCKET_NAME`. This is a human checklist item.
- Round-1 L5: on dev only, 5xx error text is not masked.
- Round-1 L4: the price-config audit is best-effort.
- Round-1 L7: `npm audit` reports critical/high advisories in `fast-xml-parser` (pulled in by `@aws-sdk`), `express`/`body-parser`/`qs`, `proxy-addr`, `mongoose` and `websocket-driver`. These are older than print and need a separate dependency pass.
- Out of print scope, but it affects the print API: `packages/user/src/middleware/error.js:44-45` echoes any `Origin` back with `Allow-Credentials: true` on error responses.

## Recommended pilot env (user API process)

```
PRINT_S3_BUCKET=<dedicated private bucket, NOT equal to AWS_S3_BUCKET_NAME>
PRINT_NORMALISE_CONCURRENCY=1
PRINT_NORMALISE_QUEUE=2
PRINT_NORMALISE_TIMEOUT_MS=10000
PRINT_NORMALISE_HEAP_MB=256
PRINT_DECODE_STREAM_MAX_MB=64
PRINT_DECODE_TOTAL_MAX_MB=256
PRINT_UPLOAD_MAX_IN_FLIGHT=4
```

- The cron service needs the same `PRINT_S3_BUCKET`.
- Budget each user-API process at about 1 GB of headroom for print.
- Caps are per process: N cluster processes means N times this.

## Human pre-enable checklist (top to bottom)

1. **[anuj-devops] S3 bucket:**
   - Use a dedicated private bucket.
   - Turn Block Public Access on.
   - Set Object Ownership to "bucket owner enforced".
   - Never enable versioning.
   - Use SSE-S3, with a bucket policy that denies unencrypted puts and non-TLS access.
   - Add a lifecycle rule on `print/`: expire after 15 days, and abort incomplete multipart uploads after 1 day.
   - Write access logs to a separate bucket.
   - IAM: the API key gets only `s3:PutObject`/`GetObject`/`DeleteObject` on `arn:...:<bucket>/print/*`. The cron key gets only `DeleteObject` (plus `GetObject`/`ListBucket` if the job needs them).
2. **[anuj-devops] Env:** set the values above on the user API, and `PRINT_S3_BUCKET` on cron. Check by hand that it is not the catalog bucket. Make sure the processes auto-restart on crash or OOM (PM2/systemd) and have a memory alarm.
3. **[anuj-devops] Deploy:**
   - Run `npm ci` from the repo root. Do not use `npm install`; that keeps pdf-lib pinned at 2.11.1.
   - Then on the server:
     - `npm ls @cantoo/pdf-lib multer sharp` must show 2.11.1 / 2.4.0 / 0.35.5.
     - `node -e "require('sharp')"` must load the Linux libvips binary.
   - Restart user, admin, delivery and cron.
   - Confirm the next cron `:40` run logs `candidates=` and not "NOT being deleted".
4. **[admin owner] Permissions:**
   - Only the Bheldi store admin and the chosen manager(s) hold `print.view` and `print.manage`.
   - Whoever rejects jobs also needs `orders.change_status`.
   - Support and warehouse roles get none of these.
   - Price edits stay super-admin only.
5. **[super admin]** Enable print on Bheldi only, with both per-side prices above ₹0.
6. **[QA] Smoke test on dev, then on the pilot:**
   - Upload a PDF and a JPG.
   - Upload a file named with RTL or emoji characters. The admin should see the cleaned name.
   - Order, download (check that an audit row appears), mark printed, then assign a rider. The rider app must show "B&W print" with no file name.
   - Try "mark status → Delivered" on an unprinted print order. Expect 400 PRINT_NOT_PRINTED.
   - Reject a second order. It must be refunded once and get one push.
   - Log in as support. No file names should be visible.
   - Upload a deliberately huge or odd PDF. Expect a "too complex" message, and the API must stay up.
   - After 24 h, check that the purge removed the never-ordered draft.

STATUS: done
OUTPUT: CRITICAL 0, HIGH 0, MEDIUM 0, LOW 4 (+ carry-overs). R-H1 closed and verified by probe; pin and lockfile pass `npm ci`.
NEXT: rahul — L1, L2, L4 to sumit-backend; L3 to sumit-backend or the admin platform engineer; checklist items 1-3 to anuj-devops; items 4-6 to USER. Re-audit is optional and covers only L1/L3 if they are changed.
