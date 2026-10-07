# Return to Supplier — architecture review (rajit-backend-arch), condensed, with final verdicts

Source: rajit's review summary as handed to akshay-principal on 2026-10-05 (the full review text was not
filed; this is the condensed record). Verdicts are final; the build follows
`supplier-return-final-spec.md`. Plan: `supplier-return.md`. DBA sign-off: `supplier-return-schema.md`.

| # | Rajit's point | Verdict | Where in final spec |
|---|---|---|---|
| 1 | Refunds in a separate append-only `supplier-return-refunds` collection (kind REFUND / NOT_EXPECTED, status ACTIVE / VOIDED + voidReason, isFinal), summary fields `refundStatus PENDING/PARTIAL/SETTLED/NOT_EXPECTED`, `refundedAmount`, `shortfallAmount`, `refundVersion` CAS on the return | **Overridden → embedded `refunds[]`** (aabha). Kept from rajit: ACTIVE/VOIDED + voidReason vocabulary, append-only, void-never-delete, a CAS counter (`rev`). Dropped: PARTIAL/SETTLED (derived for display), stored shortfall, NOT_EXPECTED as a refund kind (it is a status). | D1–D6, §1.2, §3.2–3.5 |
| 2 | Mode `CASH \| BANK \| CREDIT_NOTE_ADJUSTED` | **Accepted** | D12 |
| 3 | Refuse over-refund by default | **Accepted, with an explicit override** (`confirmOver` + note) so a GST-inclusive credit stays recordable | D4 |
| 4 | Body `clientRequestId`; branch E11000 on `err.keyPattern`; a `returnId` collision must not be treated as a replay | **Accepted**; key scoped to `{createdBy, clientRequestId}` (aabha); replay pre-check added before the transaction | D7, D16, §3.1 |
| 5 | Batch-mode request sends `batchId`; server finds the lot by `_id` | **Accepted** (also asserts warehouseId + sku) | D8 |
| 6 | Cancel only with zero active refunds; 409 `BATCH_MODE_CHANGED` if the flag flipped since create; `restoreToLot` must not exceed `qtyReceived` | **Accepted**; cancel does not change `creditStatus` | D11, §3.6 |
| 7 | Reserved guard = reject only if `after.available < after.reserved AND after.available < before.available`, in a shared helper | **Accepted** (`freeToPromiseUtils.violation`, returns instead of throws) | D10 |
| 8 | Supplier match from distinct `supplierId` on `PURCHASE_IN` rows for (warehouse, sku, batchNo), not `lot.supplierId` | **Accepted**, fallback to `lot.supplierId` only when no ledger supplier exists (e.g. renamed lot) | D9 |
| 9 | House error envelope (`errorUtils` errorType/reason/details{lineIndex,…}); admin `code` is numeric HTTP status, text in `message` | **Accepted**; `errorType: "SUPPLIER_RETURN"`; FE adds `apiErrorReason`/`apiErrorDetails` | D15, §2.3 |
| 10 | Block supplier change (409) when non-cancelled returns reference the bill; normalised invoice; primary read | **Accepted** (read inside the existing transaction) | §3.7 |
| 11 | Register the model in 4 places + CRITICAL missing-index log | **Accepted** | §5, §7 #11–12 |
| 12 | `migrateWarehouseSku` arrayFilters update sequential, not inside `Promise.all` | **Accepted** | §3.8 |
| 13 | `GET /bill-context` registered before `/:id` | **Accepted** (also `/lots`) | §2 |
| 14 | `assertWarehouseAccess(req, doc.warehouseId)` on every `/:id` route | **Accepted** — reads too, before any state check | §2 |

Deciding principle for #1 (so it does not come back): when a summary must be stored next to the
facts anyway (tiles need `receivedAmount`), put the facts in the same document. Two documents
holding one money fact need a cross-document invariant; one document gets it from a single atomic
update.
