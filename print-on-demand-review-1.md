# Print on demand — code review 1 (uncommitted diff, 2026-10-12)

Scope: the print-related files only in haper-backend (dev, uncommitted), haper-admin, and haper-web OrderDetail/Orders. Unrelated WIP in these trees was not reviewed.

## What I ran
- user jest: `__tests__/print-*` + order-supersede-unpaid + delete-account → 6 suites, 144/144 pass
- admin jest: `__tests__/print-*` → 55/55 pass in 3 of 4 runs; 1 failure once (see L6)
- cron jest: print-file-purge + pick-task-reconcile → 38/38 pass
- haper-admin: `tsc -b` clean; print vitest suites 15/15 pass
- haper-web: `tsc --noEmit` clean
- Index probe (mongodb-memory-server, mongod 8.2.1): an equality filter `{orderId: <ObjectId>}` does NOT use the partial index `job_order`. The query does a full collection scan (COLLSCAN). Only `{orderId: {$in:[..], $type:"objectId"}}` uses it (IXSCAN).

## HIGH

### H1. In a store without picking, an unprinted print order can be assigned to a rider. After that, nobody can download it or mark it printed.
- `packages/admin/src/routes/order/controller.js:1741-1744`: when picking is off, `assignableFrom` still includes `OPEN` for every order, print orders included.
- Once the order is ASSIGNED:
  - Download is refused: `print/controller.js:21,182` only allows OPEN/PACKED.
  - Mark printed is refused: `print/controller.js:221`.
  - The job also leaves the "To print" tab (`TAB_STATUSES.to_print = [OPEN]`).
- Example: the customer paid ₹40. Staff press "Assign" on the normal Orders page out of habit. The rider leaves with nothing, and the file can't be reached again until someone cancels the order.
- The plan allows turning print on for more stores "with no code change", so any store with picking off is exposed.
- Fix: in assignOrder, for `orderType === "print"`, take OPEN out of `assignableFrom` (require PACKED). Put the same condition in the update filter as well as the pre-check, so a race can't skip it. Add a guard test in `print-order-guards.test.js`.
- Lower to MEDIUM only if every print-enabled store is guaranteed to have `pickingEnabled: true`.

## MEDIUM

### M1. Four `orderId` equality queries skip the `job_order` partial index and scan the whole collection (proven by the probe)
- `shared/repositories/print-job.repository.js`:
  - `:189-192` `countUnprintedForOrder` (runs inside the mark-printed transaction)
  - `:203-213` `rejectOrderJobs`
  - `:386-387` `setOrderDisplayId` (runs inside the checkout transaction)
  - `:390-407` `releaseForOrder` (runs inside every unpaid-release / user-cancel transaction)
- Job rows are never deleted, so each of these full scans gets slower over time, inside transactions.
- `listByOrderIds` (`:34`) already does it correctly.
- Fix: filter with `orderId: { $eq: toId(orderId), $type: "objectId" }` (the `$type` must be written literally). Add one explain-based test so a later edit can't silently remove it.

### M2. "Reject" cancels and refunds without the order-status permission
- The reject route needs only `print.manage` (`print/router.js:19`).
- It then calls `orderController.markOrderAdmin` directly (`print/controller.js:98-124`). The normal route for that function needs `P.ORDERS.CHANGE_STATUS` (`order/router.js:88-95`).
- Result: a support or custom member who has `print.manage` but no order permissions can cancel a paid order and credit the wallet.
- The manager preset has both permissions, so default managers are unaffected.
- Fix: add `requirePermission(P.ORDERS.CHANGE_STATUS)` to the reject route, or check it in `rejectJob`. Mirror it in the FE (hide Reject unless the user has both).
- Escalate to Navjot (money + authz).

### M3. Customer file names are kept forever, even after the 24h file purge and account anonymisation
- `print-jobs.file.originalName` and `orders.items[].print.fileName` are written at upload/checkout (`user/src/routes/print/controller.js:111`, `checkout.controller.js:176`).
- Nothing ever scrubs them:
  - `markPurged` keeps the name.
  - `account-purge.js:53` only moves `purgeAfter`.
- A name like "Ravi_Kumar_Aadhaar.pdf" is personal data (PII). Approved decision 9 promises the document is gone after 24h, but its name stays on the order for good.
- Fix: in the account-purge cron, also blank out the print file names for that user (both collections, in the same per-user step). Consider replacing the name with "document" on purge too.
- Escalate to Navjot (PII).

### M4. haper-web: the OrderDetail crash fix now depends on the untracked print pages
- `pages/OrderDetail.tsx` now imports `./PrintOrderDetail`, which is untracked, together with `pages/Print*.tsx`, `components/print/*`, `context/PrintContext.tsx` and `services/printApi.ts`.
- Plan decision 15 says the crash fix ships first, alongside the backend. Committing only OrderDetail.tsx + Orders.tsx (the explicit-path staging rule) would break the web build.
- Fix: either ship the whole web print set in one commit, or split it: commit the `item.itemId?.name || item.name` fallbacks now and the `PrintOrderDetail` branch later.

## LOW

### L1. Reject racing Mark printed can cancel and refund with no audit and no customer push
- Sequence: `rejectJob` reads the order as OPEN (`print/controller.js:275-278`). A concurrent Mark printed moves it to PACKED. `markOrderAdmin` then cancels the PACKED order and refunds it. `rejectOrderJobs` matches 0 rows, because every job is now PRINTED.
- Result: the response says `alreadyRejected: true`, and no audit row or push is written, even though the order was just cancelled.
- Fix: after the cancel, re-check whether the cancel moved the status (`cancelled.data.alreadyInStatus`), and write the audit + push based on that rather than on `matchedCount`.

### L2. Reject also works on an order already cancelled through the normal Orders page
- `ADMIN_CANCELED` is accepted at `print/controller.js:276`. On such an order, Reject sends the customer "Print order rejected … payment is being refunded" and writes `print.rejected` with refund 0.
- Fix: accept ADMIN_CANCELED only when the cancel reason starts with `Print rejected:` (this function's own retry case).

### L3. The ban on enabling printing with ₹0 prices exists only in the FE
- Backend `updateConfig` (`admin/src/routes/print/validator.js:62-80`) accepts `enabled:true` with zero prices.
- If prices, minimum and delivery charge are all 0, the total is 0. `checkout.controller.js:222-239` then turns a "RAZORPAY" request into a free WALLET order at OPEN.
- Fix: enforce prices > 0 on the backend when the saved config ends up enabled, and refuse checkout when the total is 0.

### L4. Dead or unused code
- `job_store_status` index: no query on print-jobs uses it.
- `jobStatus.CANCELLED` and `reprints` are never written.
- `PrintJobRepository.missingIndexes` has no caller.
- `file.sourceKey` always equals `printKey`.
- Remove these, or note where they come from (e.g. a planned v2).

### L5. Comments point to documents that aren't in the repo
- `print-job.repository.js:109` ("see the queue design notes") and `:242` ("see the purge design notes").
- Drop the references, or name the actual file in haper-misc.

### L6. Flaky admin test
- `print-admin.test.js` failed 1 test once, when run with the other two print suites in parallel. It could not be reproduced in 8 later runs, including 6 isolated loops of the double-click reject test.
- That test expects `[200, 200]` from two concurrent rejects. The loser's status code depends on how the two requests interleave, so this is the likely cause.
- Fix: allow `[200, 200]` or `200 + 409`, and assert on the money and job state, which is what actually matters.

### L7. The rider app shows "Item" for print lines
- haper-delivery `DeliveryHomeScreen.kt:1492` uses `itemId?.name ?: "Item"`.
- The stand-in name from `presentPrintLine` is only applied on customer endpoints, so riders never see it.
- Fix: fill the same stand-in in the delivery order API, or fall back to `line.name` in the app.

### L8. A wallet-only payment can never cover a total ending in .50
- `splitWallet` uses whole rupees only (`checkout.controller.js:25-30`). Example: total ₹42.50 with 500 coins → `paymentMethod: "WALLET"` gets a 400.
- Clients must offer RAZORPAY + redeemWallet in this case. Confirm the apps do; otherwise round print totals to whole rupees.

## Checked and clean
- **Tenancy / IDOR** (one user reaching another user's or store's records):
  - Customer job reads are filtered by userId; checkout is filtered by user + store.
  - Admin `loadScopedJob` returns a 404 that looks the same as "missing" for a job in another store.
  - Queue scoping goes through `applyListScope`.
- **Claim races:** checkout claim, draft delete and purge each use a guarded flip, so exactly one wins. The payment window + 5-minute margin means the purge can't delete a file during checkout. Releasing a job happens only after the guarded PAYMENT_CANCELLED write.
- **Grocery back-compat:** supersede, pick-task, reconcile, COD conversion, reopen, edit and `applyItemEdit` guards; email null-safe; 3 analytics pipelines use `$ne: null`; restock is a no-op for a null itemId; capture cart cleanup with the "print" note matches no cart; the capture path cannot reopen a released print order (PAYMENT_INITIATED → failed only records the attempt).
- **Old app versions:** the Android/iOS `itemId` models are nullable; admin FE uses optional access everywhere; customer list/detail/history all go through `sanitizeOrderForCustomer`.
- **Permission mirror:** backend preset, FE `TeamMemberModal` preset and `PermissionGrid` match; `hasPermission` role list is unchanged and still matches the backend.
- **Signed URLs, S3 keys and file names:** none appear in logs.
- **Test guides:** `test-print-*.md` are present.

## Verdict
REQUEST CHANGES. H1 lets a paid print order get stuck with no way to print it. M1–M3 are a proven index miss, a permission bypass on refunds, and file names (PII) kept forever.

STATUS: done
OUTPUT: REQUEST CHANGES — 0 critical, 1 high, 4 medium, 8 low
NEXT: rahul — route H1, M1, M2, M3, M4 (in that order) to the print-on-demand backend/web engineer; brief navjot-security on M2 + M3
