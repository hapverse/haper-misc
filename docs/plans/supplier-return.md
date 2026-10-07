# Return to Supplier — send warehouse stock back to the supplier and track the money owed back

Status: **APPROVED** — ready for implementation (2026-10-05)
Author: Shavinder (planner) · Date: 2026-10-05 · Scope: dev only (prod is user-driven)

Repos touched: `haper-backend` (packages `shared`, `admin`), `haper-admin` (FE), `haper-misc` (docs + test guide).
No change to: `user`, `picking`, `delivery`, `cron` packages, or any mobile app.

Read first: `haper-misc/docs/reference/goods-flow.md` (Stage A and section 11). Everything below was
re-checked against the code on 2026-10-05; file paths are relative to
`haper-backend/packages/` and `haper-admin/src/` unless they are absolute.

---

## 0. Plain-words glossary (for this doc)

- **Supplier return** = the warehouse hands goods back to the company it bought them from. Example:
  we received 100 packs of biscuits on bill INV-0042; 12 are crushed, so 12 go back on the
  supplier's van.
- **Credit** = the money the supplier now owes us for those 12 packs. Example: 12 x Rs 18 = Rs 216.
  The supplier settles it as a **credit note** (a paper saying "Rs 216 off your next bill"),
  cash, a bank transfer, or by reducing an unpaid bill.
- **Lot / batch** = one delivery of a product with its own expiry and cost (`warehouse-batches`).
- **Free-to-promise** = stock that is not already promised to a store. Example: 40 on the shelf,
  15 promised to Store A by an approved replenishment, so only 25 are free. A return may only take
  free units.
- **Batch flag** = `warehouse.batchesEnabled` (default false). Off = one number per product, no lots.

---

## 1. Goal

Give a warehouse manager or super admin a proper "Return to supplier" action. They pick the
warehouse, the supplier, optionally the original bill (invoice number), then the exact lots and
quantities going back, and a reason. In one atomic step the system removes that stock from those
lots, writes one ledger row per lot (`SUPPLIER_RETURN_OUT`), keeps the warehouse totals correct,
and records how much credit we expect from the supplier. The return then sits in a list as
"Credit pending" until someone marks the credit received (amount, date, how, reference). This
replaces today's workarounds (write-off, receipt correction, recall) which remove the stock but
lose the link to the bill/lot and track no money.

Store-held stock is NOT returned directly: it first comes back to the warehouse through the
existing store-to-warehouse return (`POST /admin/transfer/return`), then goes to the supplier from
here.

### Acceptance criteria (done = all ticked)

- [ ] A warehouse manager or super admin can open **Supplier Returns** in the admin sidebar, click
      **New return**, choose warehouse + supplier (+ optional bill), add lines (product -> lot -> qty),
      choose a **reason (mandatory, from dropdown)**, review the expected credit, and confirm. Warehouse
      staff can view the list (read-only; no create/edit/cancel buttons). Store roles have no access (403).
- [ ] **Validation**: every line validated for qty vs lot remaining, bill cap if referenced, supplier match
      (legacy null-supplier lots allowed), reserved stock, lot status. Server validates; FE mirrors server rules.
      Refund amount >= 0 and sane. Reason is always required per line.
- [ ] After confirm, the chosen lots' `qtyRemaining` drop by exactly the returned quantities, the
      warehouse total (`warehouse-stocks.availableQty`) matches the sum of open lots, and the
      nightly batch reconcile reports no drift.
- [ ] The ledger shows one `SUPPLIER_RETURN_OUT` row per lot line with batch no., supplier, unit cost,
      reason and the return id (e.g. `SR000007`) as its reference.
- [ ] Lots on HOLD or RECALL can be returned (that is the recall use case). Their quantity leaves the
      lot; the sellable total does not change (those lots were already excluded).
- [ ] A return can never take units that are promised to stores: if it would, it is refused with a
      message naming the product and how many are free.
- [ ] Asking for more than a lot holds is refused with a message naming lot + available qty; nothing
      moves (whole return is all-or-nothing).
- [ ] Double-clicking Confirm, or a network retry, creates ONE return and deducts stock ONCE (the
      second call returns the same return).
- [ ] On a warehouse with the batch flag OFF, a return is per product (no lot picker) and decrements
      the single number with the same free-to-promise guard.
- [ ] When a bill is referenced, a product that is not on that bill, or a quantity above what that
      bill delivered minus what was already returned against it, is refused.
- [ ] Expected credit defaults to qty x lot cost per line, can be edited per line before confirming,
      and is stored with the return.
- [ ] The manager can mark credit **Received** with amount, date, mode (CASH/BANK/CREDIT_NOTE_ADJUSTED),
      reference, and (optionally) note. Shortfall vs expected amount shown. Can also mark **Not expected**
      (supplier refused; note required). Undo supported. Each change is audit-logged with recordedBy/recordedAt.
- [ ] A return recorded by mistake can be **cancelled** while its credit is still pending: the exact
      units go back into the exact same lots, with a `SUPPLIER_RETURN_REVERSAL` ledger row.
- [ ] The Supplier Returns list shows filters (status, credit status, supplier, date range, search by
      return id / invoice) and summary tiles: credit pending, credit received.
- [ ] Phase 3: the Verify Bill page shows, per bill, "Returned: N units, credit Rs X (pending/received)".
- [ ] Phase 3: the Recall page offers "Return to supplier" for a warehouse lot on HOLD/RECALL.
- [ ] No regressions: existing backend test suite (jest, in-memory Mongo) all pass; admin FE eslint + tsc -b
      report no new errors; all callers of touched models/constants/repos verified; new fields nullable/defaulted;
      new routes separate from existing ones.
- [ ] UX is minimal-click: start from a bill (prefilled lines/lots), search by product, smart defaults
      (oldest/selected lot, cost default for credit), one clear reason dropdown, inline validation messages,
      confirm summary before submit, mobile-friendly layout.
- [ ] No existing endpoint, response field, enum value, or screen behaviour changes (section 7.6).
- [ ] `haper-misc/test-supplier-return.md` walkthrough created; `goods-flow.md` updated.

### Non-goals

- Returning straight from a store to a supplier (use the existing store return first).
- A supplier payables ledger (due dates, partial payments across bills). Credit is tracked per
  return only.
- GST credit-note document generation / e-invoicing.
- Changing how bill payment status (Paid / Not paid) works.
- Any profit/COGS change (see 3.8).

---

## 2. Current state (verified)

| Area | What exists | File |
|---|---|---|
| Goods receipt | `receive`: per line, `WarehouseBatchRepository.stockIn` (batch on) or `WarehouseStockRepository.receive` (flag off); ledger `PURCHASE_IN` with `refType goods_receipt`, `refLabel` = normalised invoice, `supplierId`, `costPrice`, `batchNo` | `admin/src/routes/procurement/controller.js` L249-539 |
| Receipt correction | lot-anchored; guards NEGATIVE (below consumed), RESERVED (`availableQty < reservedQty` after recompute), COLLISION | same file L552-660; repo `correctReceipt` |
| Supplier correction | rewrites `supplierId` on `PURCHASE_IN` rows only; does **not** re-key `receipt-payments` (pre-existing gap, see 7.7) | same file L678-759 |
| Mark bill paid | `receipt-payments` keyed `(warehouseId, supplierId, invoiceNumber)`, role gate super/warehouse_manager + `warehouse.manage` | same file L774-903, `shared/models/receipt-payments.schema.js` |
| Write-off | FEFO (`stockOutFEFO`) or flat `decrementIfAvailable`; ledger `DAMAGE`/`MANUAL_ADJUST`; **no reserved-stock guard** (pre-existing, 7.7) | `admin/src/routes/warehouse/controller.js` L307-375 |
| Recall | `PATCH /admin/procurement/batch/status` HOLD/RECALL/AVAILABLE; trace `GET /batch/:batchNo` | procurement controller L909-966, `pages/Warehouse/RecallPage.tsx` |
| Lot listing | `GET /admin/warehouse/:id/stock/:sku/batches` -> `listForSku` returns ALL lots (any status, incl. qty 0) with cost/expiry | warehouse controller L262 |
| Batch repo | `stockIn`, `stockOutFEFO` (AVAILABLE only, guarded `$inc`), `recomputeRollup` (open = AVAILABLE & qty>0), `correctReceipt`, `returnToBatch` (calls `stockIn`, which also bumps `qtyReceived`), `setBatchStatus`; **no "take from a named lot" method** | `shared/repositories/warehouse-batch.repository.js` |
| Flat repo | `decrementIfAvailable` (`availableQty >= n`, ignores reserved), `reserve` (`$expr available-reserved >= n`), `increment` | `shared/repositories/warehouse-stock.repository.js` |
| Ledger | `stock-movements`, enum = `InventoryConstants.movementType`; writer `stockLedgerUtils.recordWarehouse`; every bill reader filters `movementType: "PURCHASE_IN"` explicitly | `shared/models/stock-movements.schema.js`, `shared/utils/stock-ledger.utils.js`, `shared/repositories/stock-movement.repository.js` |
| Ledger UI | hard-coded `TYPES` list (already missing `RETURN_OUT`/`RETURN_IN`) | `pages/Warehouse/LedgerPage.tsx` L8 |
| Barcode rename | `migrateWarehouseSku` rewrites `sku` on warehouse-stocks, warehouse-batches, stock-movements | `shared/utils/sku-identity.utils.js` L183-205 |
| Human ids | `sequences` counter + pre-validate hook (`TR000051`) | `shared/models/stock-transfers.schema.js` L142-155 |
| Index build | `secondaryPreferred` disables autoIndex; correctness indexes must be listed in `createCollection/init` AND `mongoIndexUtils.ensureIndexesFor` | `admin/src/connections/mongo.js` L35-113 |
| Permissions | `warehouse.manage` in warehouse_manager preset only (staff lacks it); FE mirror `utils/permissions.ts` already lists warehouse roles | `shared/constants/permission.constant.js` L108-281, `admin/src/middleware/permission.js` |
| Admin FE | Verify Bill (1505 lines), CorrectReceiptModal, MarkAsPaidModal, RecallPage, shared `Modal`/`PageHeader`/`StatusPill`/`btn` in `ui.tsx`; API client `api/inventory.ts`; routes in `App.tsx`; menu in `hooks/useMenu.ts` | `pages/Warehouse/*` |
| Idempotency | no generic idempotency-key mechanism exists in admin | — |

Finding that shapes scope: the existing **store -> warehouse return takes store stock with
`sellFEFO`, which only touches AVAILABLE store lots**. A lot on HOLD/RECALL at a store therefore
cannot be sent back to the warehouse today (and even if released, FEFO may pick a different lot).
That is a gap in the store return, not in this feature — raised as Q8.

---

## 3. Proposed design

### 3.1 Decision: new `supplier-returns` collection, one-step, credit tracked on the same document

- **New collection, not a reuse.** `stock-transfers` is store<->warehouse with reserved/in-transit
  semantics and a receive leg; a supplier has no receive leg in our system and no store. Reusing it
  would put a third direction through every transfer guard, report and the barcode-change blocker
  (the reverse-direction traps). `receipt-payments` is keyed per bill and one bill can have many
  returns. A small dedicated collection is the boring choice.
- **One step (create = stock leaves).** Recommended over DRAFT -> DISPATCHED. A two-step flow would
  need to *hold* units between draft and dispatch, i.e. a new reservation bucket on
  `warehouse-stocks` (or reuse of `reservedQty`, which would corrupt free-to-promise and the 7-day
  reservation-expiry cron). The physical event is "supplier's person takes the goods"; the manager
  records it at that moment. Mistakes are fixed with **Cancel** (3.6). If the user wants a
  printable "pending pickup" note first, that is Q2 and can be added later as a no-stock DRAFT.
- **Two independent status fields (one field, one fact):**
  - `status`: `RETURNED` -> `CANCELLED` (stock fact).
  - `creditStatus`: `PENDING` -> `RECEIVED` | `NOT_EXPECTED`, and back to `PENDING` via undo
    (money fact). Cancel is allowed only while `creditStatus = PENDING`.

```
            create (stock leaves, ledger OUT)
  (none) ───────────────────────────────────► RETURNED ──cancel (credit PENDING only)──► CANCELLED
                                                 │                                  (stock back to same lots,
                                                 │                                   ledger REVERSAL)
                                     creditStatus: PENDING ⇄ RECEIVED
                                                   PENDING ⇄ NOT_EXPECTED
```

### 3.2 Create — data flow (one MongoDB transaction)

Request: `POST /admin/supplier-returns` with `clientRequestId` (UUID made by the browser when the
modal opens; stays the same across retries of that submit).

Before the transaction (reads, fail fast, no writes):
1. `resolveWarehouseId` + `assertWarehouseAccess` (same as every warehouse handler).
2. Warehouse exists; supplier exists (inactive suppliers allowed — you often return to a supplier
   you stopped buying from).
3. `batchMode = isWarehouseBatchEnabled(warehouseId)`. Batch on: every line must carry `batchNo`
   (and optionally `batchId`). Flag off: no line may carry one. Mismatch -> 409
   `BATCH_MODE_CHANGED` ("this warehouse's lot tracking changed — reload").
4. Reject duplicate lines (same sku+batchNo twice) -> 400.
5. If `invoiceNumber` given: normalise with `commonUtils.normalizeInvoiceNumber`; require
   `StockMovementRepository.findReceiptRowsByInvoice({warehouseId, invoiceNumber, supplierId})`
   to return rows (else 404, same wording as mark-paid). Build `billedQtyBySku` from those rows.
6. Compute the payload fingerprint `requestHash` (sha256 of canonical JSON of the body minus
   `clientRequestId`).

Inside `session.withTransaction(..., { readPreference: "primary" })`:
1. **Claim first:** insert the `supplier-returns` doc (status RETURNED, creditStatus PENDING,
   `clientRequestId`, `requestHash`, lines without cost yet). The unique index on `clientRequestId`
   makes a duplicate submit fail HERE, before any stock moves.
2. If bill referenced: `alreadyReturnedBySku` = sum of non-cancelled return lines for the same
   `(warehouseId, supplierId, invoiceNumber)` (read in-session). For each sku:
   `requested + alreadyReturned <= billed`, else 400 `EXCEEDS_BILL` naming the product (Q3).
   (Two concurrent returns against the same bill could both pass this read — acceptable: it is a
   fat-finger guard, not a stock guard; stock is still lot-guarded. Noted in 7.1.)
3. Per line, batch on: `WarehouseBatchRepository.stockOutFromLot(warehouseId, sku, {batchNo, batchId}, qty, session)`:
   - finds the lot (`warehouseId, sku, batchNo` — by `_id` when `batchId` sent, and checks both agree);
   - lot status may be AVAILABLE, HOLD or RECALL;
   - lot `supplierId` set and different from the return's supplier -> `SUPPLIER_MISMATCH` (Q4);
   - guarded `updateOne({_id, qtyRemaining: {$gte: qty}}, {$inc: {qtyRemaining: -qty}})`; 0 matched ->
     `INSUFFICIENT_LOT` with the lot's current qty;
   - returns `{ batchId, batchNo, statusAtReturn, costPrice, expiresAt }` (snapshot for the line).
   `qtyReceived` is NOT changed (history of what arrived).
4. Per sku touched (batch on): `recomputeRollup` once, then **free-to-promise guard**:
   `availableQty >= reservedQty`, else throw `RESERVED` ("Only N of <product> are free; M are promised
   to stores"). Same check `correctReceipt` uses. For HOLD/RECALL lots `availableQty` does not move,
   so the guard passes by construction.
5. Flag off: new `WarehouseStockRepository.decrementFreeToPromise(warehouseId, sku, qty, session)` —
   one conditional `findOneAndUpdate` with `$expr: available - reserved >= qty`. Unit cost snapshot =
   `warehouse-stocks.costPrice`.
6. Per line: ledger via `stockLedgerUtils.recordWarehouse` — `type SUPPLIER_RETURN_OUT`,
   `quantityDelta -qty`, `balanceAfter` (rollup availableQty), `supplierId`, `costPrice` (lot cost
   snapshot), `batchNo`, `refType "supplier_return"`, `refId` = return `_id`, `refLabel` = `SR000007`,
   `reason`, `note`, actor.
7. `$set` the line snapshots + `lotCostPrice`, `creditUnitPrice` (client value if sent, else lot
   cost), `lineCredit = round2(qty x creditUnitPrice)`, `expectedCreditAmount = round2(sum)`,
   `totalUnits`.
8. `auditUtils.logAtomic(req, {action: "warehouse.supplier_return.create", ...}, session)` — money
   record, so the audit commits with it (same as correctReceipt field-only edits).

Any failure aborts everything, including the claim, so there is never a half-applied return.

After the transaction: if the error was E11000 on `clientRequestId`, read the existing doc from the
primary: same `requestHash` -> 200 with it and `replayed: true`; different -> 422
`IDEMPOTENCY_KEY_REUSED` (same semantics as the IETF `Idempotency-Key` draft; we carry the key in
the body because the admin API has no header-based mechanism).

### 3.3 Why the guards sit in the repository (choke point)

`stockOutFromLot` and `decrementFreeToPromise` are the only new stock-moving primitives. Both
refuse to run without a session (like `stockOutFEFO`). Every future caller (e.g. the recall entry
point) inherits the lot guard; the reserved guard lives in one shared helper
(`assertFreeToPromise(stockRow)`) used by both paths so it cannot drift.

### 3.4 Concurrency (what happens when two things hit the same stock)

| Race | Outcome |
|---|---|
| Two clicks / retry of the same submit | 2nd insert hits unique `clientRequestId` -> nothing moves -> replay returns the first return |
| Return vs transfer dispatch FEFO on the same lot | both use guarded `$inc`; Mongo write conflict aborts one, `withTransaction` retries it on fresh data; loser either succeeds on what is left or fails INSUFFICIENT_LOT / "Insufficient warehouse stock" — never negative |
| Return vs replenishment approve (reserve) | both write the same `warehouse-stocks` row -> conflict serialises them; whichever runs second sees the other's effect (reserve fails "not enough free", or return fails RESERVED) |
| Return vs receipt correction on the same lot | correction's guarded filter / NEGATIVE check sees the returned units as "already left the lot" |
| Return vs lot status change (HOLD/RECALL/AVAILABLE) | `setBatchStatus` writes the lot + rollup; conflict -> retry; return accepts any of the three statuses so the result is the same |
| Batch flag flipped between page load and submit | server re-reads flag (cached 5s) and returns 409 BATCH_MODE_CHANGED |

### 3.5 Credit tracking

- `expectedCreditAmount` is fixed at create (sum of line credits). Default unit = lot `costPrice`
  (what we paid per unit, weighted average if the lot merged several deliveries). Editable per line
  at create only, `0 <= creditUnitPrice <= 100000`; UI warns (does not block) when it differs from
  lot cost by more than 20%.
- `POST /:id/credit` with `status: RECEIVED` + `receivedAmount` (required, >= 0), `receivedAt`
  (optional, never defaulted — same rule as `paidAt`), `mode` (`CREDIT_NOTE | CASH | ONLINE |
  ADJUSTED_ON_BILL`, optional), `reference` (credit-note no. / UTR, optional), `note`.
  `receivedAmount` may differ from expected; the UI shows the shortfall (Q5).
- `status: NOT_EXPECTED` requires a `note` (why the supplier will not pay).
- `POST /:id/credit/undo` -> back to PENDING; the previous credit block is kept in `creditHistory[]`
  (never deleted), mirroring how un-mark-paid never deletes.
- All credit writes are conditional on the current `creditStatus` (compare-and-set in the filter),
  so two managers cannot both apply a transition; the loser gets 409 with the current state.
- Credit is **not** linked to `receipt-payments`. A bill's Paid / Not paid flag is unchanged by a
  return. Phase 3 shows "net payable = bill cost - return credit" as display only (Q6).

### 3.6 Cancel ("recorded by mistake")

`POST /:id/cancel` with `reason` (required text). Allowed only when `status = RETURNED` and
`creditStatus = PENDING`; CAS on both in the filter. In one transaction:
- batch on: new `WarehouseBatchRepository.restoreToLot(batchId, qty, session)` — `$inc
  qtyRemaining` by `_id` (survives a lot rename; keeps the lot's current status; does **not** bump
  `qtyReceived`, unlike `returnToBatch`), then `recomputeRollup`.
- flag off: `WarehouseStockRepository.increment`.
- ledger `SUPPLIER_RETURN_REVERSAL` (+qty) per line, same ref fields.
- `status CANCELLED`, `cancelledBy/At/Reason`; audit `warehouse.supplier_return.cancel` atomic.
If the batch flag changed since the return was created, cancel uses the mode stored on the return
(`batchMode` snapshot); if that is batch mode but the warehouse is now flag-off, the lot still
exists and `restoreToLot` + `recomputeRollup` still keep the totals consistent (the rollup is the
same `warehouse-stocks` row) — covered by a test.

### 3.7 Recall integration

- Recall flow stays as is: set lot to RECALL (it leaves sellable stock), then create a supplier
  return with reason RECALL picking that lot. Phase 3 adds a "Return to supplier" button on Recall
  page warehouse rows (status HOLD/RECALL, qty > 0) that opens the create modal pre-filled
  (warehouse, supplier = lot supplier, sku, lot, qty = qtyRemaining, reason RECALL).
- Units at stores: store admins first send them back with the existing store return; for recalled
  store lots this is currently blocked by the FEFO gap in section 2 (Q8).

### 3.8 Money invariant (profit/COGS) — unaffected

Profit/COGS reads the order-time `orders.items.costPrice` snapshot only (goods-flow section 9). A
supplier return never touches orders or store items, and `recomputeRollup` only re-averages
`warehouse-stocks.costPrice` over the lots that remain — the same thing a dispatch does today. Past
profit cannot change. The return's own `lotCostPrice` is a snapshot on the return doc and ledger row.

### 3.9 Visibility

- Ledger page: new types appear with labels "Returned to supplier" / "Supplier return cancelled";
  filterable (the API already accepts any `movementType` string).
- All bill/receipt reports filter `movementType: "PURCHASE_IN"` explicitly, so the new rows never
  leak into Verify Bill totals, receive lookup, "repeat last", or payment stats (verified:
  `stock-movement.repository.js` L85-331).
- Stock-health, low-stock alerts and auto-replenishment read `availableQty`; a return lowering it is
  the correct real-world signal.

---

## 4. Data model changes

### 4.1 New collection `supplier-returns` (`shared/models/supplier-returns.schema.js`)

```
returnId            String, required, unique          // "SR000007", sequence "supplierReturnId", pre-validate hook (copy of transfer hook)
clientRequestId     String, required, unique          // idempotency key from the browser (UUID)
requestHash         String, required
warehouseId         ObjectId(warehouses), required
supplierId          ObjectId(suppliers), required
invoiceNumber       String, default null              // normalised (trim+UPPERCASE); null = not bill-linked
reason              String enum SUPPLIER_RETURN_REASONS, required
note                String, default ""
batchMode           Boolean, required                 // flag value used at create (drives cancel)
status              enum RETURNED | CANCELLED, default RETURNED
lines: [{
  sku               String, required
  name              String, default ""                // from warehouse-stocks, display only
  iId               String, default ""
  batchId           ObjectId(warehouse-batches), default null   // null when flag off
  batchNo           String, default ""
  lotStatusAtReturn String, default null              // AVAILABLE | HOLD | RECALL
  expiresAt         Date, default null
  qty               Number, required, min 1
  lotCostPrice      Number, default 0                 // snapshot
  creditUnitPrice   Number, default 0
  lineCredit        Number, default 0                 // round2(qty x creditUnitPrice)
}]
totalUnits          Number, default 0
expectedCreditAmount Number, default 0
creditStatus        enum PENDING | RECEIVED | NOT_EXPECTED, default PENDING
credit: { receivedAmount Number|null, receivedAt Date|null, mode enum|null, reference String|null,
          note String, recordedBy ObjectId|null, recordedAt Date|null, shortfallAmount Number|null }
creditHistory       [ same shape + status + undoneBy/undoneAt ]   // append-only
createdBy           ObjectId(admins), required
cancelledBy / cancelledAt / cancelReason   default null
timestamps: true, versionKey: false
```

### 4.2 Indexes

| Index | Why | Correctness-critical? |
|---|---|---|
| `{ returnId: 1 }` unique | human id | yes |
| `{ clientRequestId: 1 }` unique (plain, field is required — no partial filter, avoids the null/partial-filter planner trap) | double-submit = one return | **yes** |
| `{ warehouseId: 1, createdAt: -1 }` | list default sort | perf |
| `{ warehouseId: 1, creditStatus: 1, createdAt: -1 }` | "credit pending" filter + tiles | perf |
| `{ warehouseId: 1, supplierId: 1, invoiceNumber: 1 }` | per-bill already-returned sum; Verify Bill join | perf |
| `{ "lines.sku": 1 }` | barcode-rename fan-out | perf |

**Must** be added to both lists in `admin/src/connections/mongo.js`: the `createCollection()/init()`
list (the collection is written inside a transaction; Mongo cannot create a collection inside one)
and `mongoIndexUtils.ensureIndexesFor([...])` (secondaryPreferred builds nothing otherwise, and the
`clientRequestId` unique index IS the idempotency guarantee). Add a boot visibility check like the
referral one (`missingIndexes` -> `console.error` CRITICAL, no exit).

### 4.3 Altered (additive only)

- `shared/constants/inventory.constant.js` `movementType`: add `SUPPLIER_RETURN_OUT`,
  `SUPPLIER_RETURN_REVERSAL`. Mongoose enforces enums on write only, and only admin writes these,
  so older builds of other services reading the ledger are unaffected.
- New `shared/constants/supplier-return.constant.js`: `status`, `creditStatus`, `creditMode`
  (`CASH | BANK | CREDIT_NOTE_ADJUSTED`), `reasons` enum (MANDATORY, one per line) =
  `[DAMAGED, EXPIRED, RECALL, WRONG_ITEM, QUALITY, EXCESS, OTHER]` (note required when OTHER),
  `MAX_LINES = 100`.
- No change to `warehouse-batches`, `warehouse-stocks`, `stock-movements` schemas, or
  `receipt-payments`.
- **No migration, no backfill.** New collection starts empty.

---

## 5. API contract

All under `/admin/supplier-returns` (new router `admin/src/routes/supplier-return/router.js`,
mounted in `admin/src/routes/index.js`). Router-level: `authenticate` +
`requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_STAFF)` (blocks store roles — store_admin
bypasses permissions, so the role gate is the real control). Write routes additionally
`requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER)` + `requirePermission(warehouse.manage)` (money record,
same double gate as mark-paid). **No new permission string** -> no FE/BE permission-mirror change.
Warehouse scoping inside handlers via `resolveWarehouseId` / `assertWarehouseAccess` /
`applyListScope`.

| Method + path | Gate | Body / query | Response `data` |
|---|---|---|---|
| `GET /` | read gate (Q7: default `warehouse.view_ledger` OR `warehouse.manage`) | `warehouseId, status?, creditStatus?, supplierId?, q? (returnId/invoice), fromDate?, toDate?, page, limit<=100` | `{ returns:[summary], total, page, limit, stats:{ pendingAmount, receivedAmount, pendingCount } }` (stats not narrowed by creditStatus filter, same rule as Verify Bill) |
| `GET /:id` | read gate | — | full doc + `supplierName`, `createdByName` |
| `GET /bill-context` | read gate | `warehouseId, supplierId, invoiceNumber` | `{ lines:[{sku,name,billedQty,alreadyReturnedQty,returnableQty}] }` — powers the "from a bill" prefill and the cap |
| `POST /` | write gate | `{ clientRequestId (uuid), warehouseId, supplierId, invoiceNumber?, reason, note? (required when reason OTHER), lines:[{ sku, batchNo? , batchId?, qty, creditUnitPrice? }] (1..100) }` | 201 full doc; 200 + `replayed:true` on an identical retry |
| `POST /:id/credit` | write gate | `{ status: RECEIVED|NOT_EXPECTED, receivedAmount? (req. for RECEIVED), receivedAt?, mode?, reference?, note? (req. for NOT_EXPECTED) }` | updated doc |
| `POST /:id/credit/undo` | write gate | `{ note? }` | updated doc |
| `POST /:id/cancel` | write gate | `{ reason (1..500) }` | updated doc |

Lot choices for the UI reuse the existing `GET /admin/warehouse/:warehouseId/stock/:sku/batches`
(already returns every lot with status, qty, cost, expiry) — no new endpoint. Product search reuses
the warehouse stock list endpoint.

Errors: 400 with machine `code` field (new endpoint, so codes are free to choose; the FE shows `msg`):
`INSUFFICIENT_LOT`, `RESERVED`, `EXCEEDS_BILL`, `SKU_NOT_ON_BILL`, `SUPPLIER_MISMATCH`,
`LOT_NOT_FOUND`, `DUPLICATE_LINE`; 404 bill/supplier/warehouse not found; 409 `BATCH_MODE_CHANGED`,
`INVALID_STATE` (cancel/credit on wrong state); 422 `IDEMPOTENCY_KEY_REUSED`; 403 role/permission.

---

## 6. Step-by-step build order

Each task = one reviewable change. Owners are exclusive per file within a phase.

### Phase 0 — design (chanchal-designer) — must finish before Phase 2 FE

Design-first applies (new page + modals). Chanchal must spec, reusing `pages/Warehouse/ui.tsx`
`Modal`, `PageHeader`, `StatusPill`, `btn`, `card`:
1. **Supplier Returns list page**: columns (Return id, date, supplier, bill/invoice, reason, units,
   expected credit, credit status pill, status pill), filters, the two summary tiles, empty state,
   row click -> detail.
2. **New return modal**, two entry modes: "From a bill" (pick supplier + invoice -> lines prefilled
   with returnable qty) and "Free" (search product -> pick lot). Lot picker row: lot no., status
   pill (AVAILABLE/HOLD/RECALL), expiry (expired highlighted), qty left, unit cost. Flag-off variant
   (no lot column). Per-line credit unit price edit + the "differs from cost" warning. Reason
   dropdown (+ note required for OTHER). Review step showing total units + expected credit before
   Confirm. Error states for each error code (inline on the offending line).
3. **Detail drawer/modal**: lines, ledger reference, audit trail, credit block, actions.
4. **Mark credit modal** (model on `MarkAsPaidModal`): Received vs Not expected, amount (prefilled
   expected), date, mode, reference, note; shortfall display.
5. **Cancel confirm** copy (states clearly the units go back to the same lots).
6. Phase 3 hooks: Verify Bill row badge/line ("Returned 12 · Rs 216 pending"), Recall row button,
   hint text on the warehouse write-off modal ("Sending it back to the supplier? Use Return to
   supplier").
7. Status/credit colour + `StatusLegend` entries for `statusMeta.ts`.

### Phase 1 — backend (one backend platform engineer owns all files below)

1. `shared/constants/supplier-return.constant.js` (new) + `shared/constants/index.js` export;
   `shared/constants/inventory.constant.js` add the two movement types.
2. `shared/models/supplier-returns.schema.js` (new) + `shared/models/index.js`
   (`SupplierReturnModel`). Pre-validate id hook copied from the transfer schema with its own
   sequence key `supplierReturnId`.
3. `shared/repositories/warehouse-batch.repository.js`: add `stockOutFromLot`, `restoreToLot`.
   `shared/repositories/warehouse-stock.repository.js`: add `decrementFreeToPromise`. Shared
   `assertFreeToPromise` helper next to them. No existing method changes.
4. `shared/repositories/supplier-return.repository.js` (new) + `shared/repositories/index.js`:
   `create(session)`, `findById`, `findByClientRequestId` (primary read), `list` + `stats`,
   `sumReturnedForBill(session)`, `transitionCredit` (CAS), `markCancelled` (CAS).
5. `shared/utils/sku-identity.utils.js`: `migrateWarehouseSku` also `updateMany` on
   `supplier-returns` `{"lines.sku": from}` with arrayFilters (`lines.$[l].sku`), return count
   `supplierReturns`. (Additive key in the returned object; check its callers' tests.)
6. `admin/src/routes/supplier-return/{validator,controller,router}.js` (new) +
   `admin/src/routes/index.js` mount.
7. `admin/src/connections/mongo.js`: add `SupplierReturnModel` to both lists + index visibility check.
8. `admin/src/routes/procurement/controller.js` `correctReceiptSupplier`: refuse with 409
   `BILL_HAS_SUPPLIER_RETURNS` when non-cancelled returns reference (warehouse, old supplier,
   invoice) — otherwise the returns' bill link silently orphans. Small additive guard, no shape change.
9. Tests in `admin/__tests__/supplier-return-*.test.js` (section 8).

### Phase 2 — admin FE (one admin-web platform engineer)

1. `src/types/warehouse.ts` (types), `src/api/inventory.ts` (client calls; new functions only).
2. `pages/Warehouse/SupplierReturnsPage.tsx` (new), `NewSupplierReturnModal.tsx` (new),
   `SupplierReturnDetailModal.tsx` (new), `MarkCreditModal.tsx` (new), pure helpers
   `supplierReturn.ts` (+ `.test.ts`) for credit maths/line validation (mirror server round2).
3. `App.tsx` route `/warehouse/supplier-returns`; `hooks/useMenu.ts` entry
   (`requireAnyRole: super_admin, warehouse_manager, warehouse_staff` per Q7) + `useMenu.test.ts`;
   `pages/Warehouse/statusMeta.ts` new meta.
4. `pages/Warehouse/LedgerPage.tsx` `TYPES`: add `SUPPLIER_RETURN_OUT`, `SUPPLIER_RETURN_REVERSAL`
   (and the already-missing `RETURN_OUT`, `RETURN_IN`).
5. Vitest for the new page/modal (button hidden for staff, double-click sends one request with one
   `clientRequestId`, error code rendering).

### Phase 3 — integrations (after Phase 1+2 ship to dev)

- BE (backend engineer): `admin/src/routes/procurement/controller.js` `listReceipts` — after the
  existing repository call, ONE batched query on `supplier-returns` for the page's bill keys; add
  additive fields per receipt `returnedUnits`, `returnCreditExpected`, `returnCreditReceived`
  (default 0). Repository aggregate untouched; stats tiles untouched.
- FE (admin engineer): `VerifyBillPage.tsx` badge + "Return items" action on a bill row (opens the
  modal in "from a bill" mode); `RecallPage.tsx` "Return to supplier" button; write-off modal hint
  in `WarehousesPage.tsx`.
- Data/report (deepanshu-data, optional): supplier-return totals by supplier/month if the owner
  wants a report (Q9).

### Docs (same session as each phase — whoever ships the phase)

- `haper-misc/test-supplier-return.md` (new): steps with expected pass/fail for: batch-on create
  from a bill; free create; HOLD lot; RECALL lot; over-lot qty (fail); reserved stock (fail);
  qty above bill (fail); double-click; flag-off warehouse; mark credit received / not expected /
  undo; cancel (lot qty restored, ledger reversal row); cancel after credit received (fail); staff
  login (no button, 403); store admin (no menu, 403); supplier correction blocked when returns
  exist; nightly reconcile shows no drift; which deploy is needed (admin API + admin web).
- `haper-misc/docs/reference/goods-flow.md`: Stage A table + section 11/12 updates.
- `haper-misc/client-followups.md`: one row (admin only; mobile apps none).

---

## 7. Edge cases & risks

### 7.1 Stock correctness
- **Over-return** of a lot: guarded `$inc` filter; whole transaction aborts.
- **Reserved stock**: post-recompute `availableQty >= reservedQty` (batch) / `$expr` (flag off).
  In-transit stock is already out of `availableQty`, so it is untouchable automatically.
- **HOLD/RECALL lots**: allowed; do not change `availableQty`; the reserved guard passes.
- **LEGACY lot** (pre-batch stock, `supplierId` null): allowed, supplier check skipped (null lot
  supplier never mismatches).
- **Lot pooled from several deliveries** (auto-batch merges same expiry): cost is the blended
  average — the default credit may not equal any one bill's price. That is why per-line credit is
  editable; referenced bill's `PURCHASE_IN.costPrice` is shown next to it in the UI as a hint.
- **Same bill, two concurrent returns**: the bill cap read can be passed by both (count-then-insert
  is not race-safe in Mongo). Consequence is only a soft over-return against the bill's paperwork;
  physical stock is still lot-guarded. Accepted; if Q3 says the cap must be hard under races, add a
  per-bill counter doc with conditional `$inc` (aabha question A3).
- **Receipt correction after a return**: returned units count as "already left the lot", so the
  correction cannot lower received qty below `consumed` — correct behaviour, documented in the test
  guide so nobody files it as a bug.
- **Expired lots**: allowed; no expiry gate.
- **Zero-qty lot** chosen: `INSUFFICIENT_LOT`.

### 7.2 Idempotency
- Unique `clientRequestId` claimed as the first write in the transaction; replay returns the
  original; reused key with a different body -> 422. The modal mints one id per open, and keeps it
  for retries; closing and reopening mints a new one (a deliberate second return).
- Sequence numbers burned by aborted transactions leave gaps in `SR` ids — cosmetic.
- Credit/cancel transitions are CAS on current state -> idempotent under double-click (second gets
  409 INVALID_STATE with the current state; FE treats it as "already done" and refreshes).

### 7.3 Money / security
- Write routes: role gate super/warehouse_manager AND `warehouse.manage` (store_admin bypasses
  permissions; role gate is the real control). Scoping via `assertWarehouseAccess` so a manager of
  warehouse A cannot return warehouse B's stock.
- All amounts validated `>= 0`, finite, 2dp; server recomputes line credit and totals (never trusts
  a client total).
- Audit rows written atomically inside the transaction for create, cancel, credit mark, credit undo.
- Cost visibility: warehouse roles already see unit cost on Receive Goods / Verify Bill / lot list;
  no new exposure. Store roles cannot reach these routes.

### 7.4 Flag-off / flag flip
- Flag off: per-sku flat decrement with free-to-promise, unit cost = `warehouse-stocks.costPrice`.
- Flip between load and submit: 409 BATCH_MODE_CHANGED.
- Cancel uses the return's stored `batchMode`; tested both ways.

### 7.5 Barcode change
- `migrateWarehouseSku` gains the `supplier-returns` fan-out so a return's lines follow a product's
  barcode change. Returns are never "open stock in flight", so they do NOT block a barcode change.

### 7.6 Backward compatibility (existing functionality this touches)

| Existing thing | How it keeps working unchanged |
|---|---|
| `POST /procurement/receive`, lookup, last, Verify Bill list/stats | untouched in Phases 1-2; every reader filters `PURCHASE_IN` explicitly. Phase 3 adds only defaulted fields to `listReceipts` |
| Mark/unmark paid, `receipt-payments` | untouched; return credit is a separate record |
| `correctReceipt` | untouched; returned units naturally count as consumed |
| `correctReceiptSupplier` | one new refusal (409) only when returns exist for that bill; existing tests unaffected (they have no returns) |
| Write-off, recall `setBatchStatus`, transfers, replenishment, reservation-expiry cron, store return | untouched; new repo methods are additions, no existing method edited |
| `stock-movements` enum | two values added; enum validated on write only; no reader matches "all types except" |
| Ledger API | accepts any `movementType` string already; FE list gets new labels |
| Batch reconcile cron | totals kept in lock-step by `recomputeRollup` in the same transaction |
| `migrateWarehouseSku` | returns one extra count key; existing keys unchanged |
| Permission constants / FE mirror | no new permission string; mirror unchanged |
| Mobile apps / customer APIs | not touched |

Rollback: Phase 1 is additive (new collection, new routes, new enum values). Rolling back the
admin API leaves `supplier-returns` docs and ledger rows behind; old code ignores them (unknown enum
value in a read is fine). **Hard-to-reverse point:** once a return is created on dev/prod, the stock
really left those lots; rolling back code does not put it back — only Cancel does (so do not roll
back while returns are PENDING without cancelling the mistaken ones first).

### 7.7 Pre-existing issues found (follow-ups, NOT in this scope)
1. Warehouse **write-off has no reserved-stock guard** — it can drop `availableQty` below
   `reservedQty`, so a later dispatch fails. Fix: reuse the new `assertFreeToPromise`.
2. `setBatchStatus` to HOLD/RECALL can likewise strand reservations.
3. `correctReceiptSupplier` does not re-key `receipt-payments`, so changing a bill's supplier makes a
   Paid bill read Not Paid (its own code comment says it must re-key).
4. Store return cannot send HOLD/RECALL store lots (FEFO takes AVAILABLE only) — Q8.
5. `returnToBatch` (transfer cancel / return receive) bumps `qtyReceived`, inflating "received" and
   shifting the receipt-correction floor.
6. Ledger page type list misses `RETURN_OUT` / `RETURN_IN` (fixed in Phase 2 task 4).

---

## 8. Test strategy

Backend (jest, **in-memory Mongo only**, `cd packages/admin && NODE_ENV=test npx jest`), new files
`admin/__tests__/supplier-return-create.test.js`, `-credit.test.js`, `-cancel.test.js`,
`-flagoff.test.js`, `-gates.test.js`, plus additions to `warehouse-batch-ledger.test.js` (new repo
methods) and `procurement-supplier-correct.test.js` (new 409):

Unit-level (repository):
- `stockOutFromLot`: AVAILABLE/HOLD/RECALL lots; insufficient; wrong supplier; lot by `batchId`
  after rename; `qtyReceived` unchanged; no session -> throws.
- `restoreToLot`: restores to same `_id`, keeps status, does not change `qtyReceived`.
- `decrementFreeToPromise`: blocks when `available - reserved < qty`.

Integration (HTTP through the router):
- Create batch-on, multi-lot multi-sku: lots, rollup, ledger rows (type, sign, refLabel, costPrice,
  supplierId, batchNo), totals, audit row.
- **Duplicate submit**: same `clientRequestId` twice (sequential and `Promise.all`) -> one return,
  stock deducted once, second response `replayed:true`; same id + different body -> 422.
- **Over-return** of a lot -> 400, nothing moved (all lines rolled back incl. earlier lines).
- **Reserved stock**: approve a replenishment, then return more than free -> 400 RESERVED; return
  within free -> ok.
- **HOLD/RECALL lots**: return succeeds, `availableQty` unchanged.
- **Flag-off warehouse**: per-sku return; batchNo sent -> 409; reserved guard.
- Flag flipped mid-flow -> 409.
- Bill-linked: sku not on bill -> 400; qty over remaining billed -> 400; second partial return
  counts the first; cancelled returns do not count.
- Credit: RECEIVED (amount differs), NOT_EXPECTED needs note, undo keeps history, concurrent marks
  -> one wins + 409.
- Cancel: restores exact lots + reversal rows; refused after credit received; refused twice.
- Gates: staff 403 on writes; store_admin 403 at router; manager of another warehouse 403.
- `migrateWarehouseSku` moves return line skus.
- Reconcile: `reconcileWarehouse` reports no drift after create and after cancel.
- Existing suites stay green: `warehouse-*`, `procurement-*`, `transfer-return-*`, `ledger-*`.

Admin FE (Vitest; baseline = the 5 known-failing OrderDetailsModal tests stay exactly 5):
- helpers: credit maths round2 matches server; line validation.
- page: staff sees list but no New/credit/cancel buttons; double-click Confirm sends one request.
- `tsc -b` + `eslint` no new errors.

Manual: `haper-misc/test-supplier-return.md` on dev (`damin.haper.in`).

---

## 9. Decisions (approved 2026-10-05)

**Q1. Reasons list.** DECIDED: mandatory reason per line, enum = `[DAMAGED, EXPIRED, RECALL,
WRONG_ITEM, QUALITY, EXCESS, OTHER]`. When reason is OTHER, note is required (explain why it doesn't
fit the list). Encoded in `shared/constants/supplier-return.constant.js`.

**Q2. One step or two?** DECIDED: one-step return. Stock leaves immediately when the manager confirms
(reflects the physical moment: "supplier's person takes the goods now"). Mistakes are fixed by **Cancel**
(undoes stock + ledger in one atomic step, allowed while credit is PENDING). No draft state or
shelf-hold reservation needed.

**Q3. Bill cap.** DECIDED: yes, refuse over-return. When a bill (`warehouseId`, `supplierId`,
`invoiceNumber`) is referenced, for each SKU: `requestedQty + alreadyReturnedQty <= billedQty` (already
returned = non-cancelled return lines for the same bill). Soft cap (not race-proof under concurrent returns
against the same bill; acceptable as a fat-finger guard, stock still lot-guarded). Exception: null
`invoiceNumber` (no bill link) has no cap.

**Q4. Supplier must match the lot.** DECIDED: yes, enforce `lot.supplierId == return.supplierId`.
Exception: lots with `supplierId` null (pre-batch LEGACY stock) always allowed. Refuse with 409
`SUPPLIER_MISMATCH` if they differ.

**Q5. Partial credit.** DECIDED: simple version. UI shows `expectedCreditAmount` vs `receivedAmount` and
computes shortfall = max(0, expected - received) on display. No separate "Partly received" state — one
credit status (PENDING/RECEIVED/NOT_EXPECTED). When marked Received, `receivedAmount` and shortfall are
recorded; both shown in the UI.

**Q6. Credit vs the bill's Paid flag.** DECIDED: no change to mark-paid logic. Verify Bill Phase 3 shows
"net payable = bill cost - return credit received" as display-only (no changes to the Paid/Not paid flags).
Returns are tracked on their own collection, independent of `receipt-payments`.

**Q7. Warehouse staff read-only.** DECIDED: yes. Staff can view the Supplier Returns list (read-only),
see filters, and click detail view. Buttons for Create, Cancel, Mark credit, Undo credit are hidden (403 if
forced). Only warehouse_manager + super_admin can create/edit. Enforced by route-level
`requirePermission(warehouse.manage)` (same gate as mark-paid).

**Q8. Recalled stock at stores.** DECIDED: out of scope. Store-held stock on HOLD/RECALL cannot be sent
back to the warehouse yet (store return only takes AVAILABLE lots via FEFO). This is a pre-existing gap in
the store return, not this feature. File as a separate follow-up after this ships.

**Q9. Monthly-by-supplier report.** DECIDED: later. Not in Phase 3. If requested later, deepanshu-data
builds on-demand (simple aggregate: return qty + credit by supplier, month, warehouse).

**Q10. Credit price default.** DECIDED: default credit unit price = lot `costPrice` (what we paid per unit,
already weighted average if the lot merged deliveries). This is editable per line before confirming. GST
handling is an open question for the user (does your supplier credit at cost-only or cost+GST?); it does
not block this build. Store cost-inclusive vs cost-only in a future design doc if needed.

### Architecture review questions (answered in plan)

**For rajit-backend-arch:**
- R1. One-step create with Cancel-as-undo vs DRAFT/DISPATCHED: **AGREED** — no new reservation bucket
  needed. Cancel undoes atomically while `creditStatus = PENDING`.
- R2. Body `clientRequestId` + `requestHash` vs `Idempotency-Key` header: **DECIDED** — use body
  `clientRequestId` (admin API has no header-based idempotency mechanism yet). Can generalize later for
  POS sale / receive if needed.
- R3. Credit on return doc vs separate collection: **DECIDED** — same return doc. One credit note settles
  one return; multi-return credit is not real yet. Keep it simple.
- R4. `/admin/supplier-returns` (new module) vs nested in `/admin/procurement`: **DECIDED** — separate
  module. Procurement controller is already 1186 lines; return logic is a separate domain (consume stock,
  track credit; no goods receipt receive leg).
- R5. `correctReceiptSupplier` block or re-key: **DECIDED** — add a small blocking guard in §6 Phase 1
  task 8. If returns exist for the bill, refuse 409 (does not re-key; preserves the return's bill link).

**For aabha-dba (indexes & schema):**
- A1. Index set in 4.2 — sufficient at tens of returns/month/warehouse? **Yes, proceed.**
- A2. `lines` embedded array (max 100) vs separate collection: **Embedded is fine.**
- A3. Race-proof bill cap (Q3 soft cap): **Accept the soft cap** (fat-finger guard + lot-level guard).
  If race-proof is needed later, add a per-bill counter doc with conditional `$inc`.
- A4. `migrateWarehouseSku` `updateMany` with `arrayFilters` on `lines.sku`: **No concerns.**
- A5. Sequence-counter drift: **Add `$max` fast-forward** for `supplierReturnId` from day one (seen `TR`
  collisions on dev Sep 2026; same fix as transfers).

---

## 10. Phase gating checklist (gates to clear before moving to the next phase)

```
Phase 0: Design (chanchal-designer)
  Screens: Supplier Returns list, New return modal (from-bill + free), Detail drawer,
  Mark credit modal, Cancel confirm, Phase 3 hooks (Verify Bill badge, Recall button).
  Gate: Design doc + Figma mockups signed off by product/user.

  ↓ (gates R1-R5, A1-A5 must be answered; ✓ all answered in §9)

Architecture review (rajit-backend-arch + aabha-dba)
  rajit R1-R5 (one-step + idempotency + credit doc + routing + correctReceiptSupplier guard):
  all answered in §9, accepted.
  
  aabha A1-A5 (indexes, schema, race safety, barcode fan-out, sequence drift):
  all answered in §9, accepted. ✓ Add $max fast-forward for supplierReturnId.

  Gate: Backend architect sign-off on R1-R5; DB architect sign-off on A1-A5.

  ↓

Phase 1: Backend (one backend platform engineer)
  shared/constants + models + repositories + sku-identity update + routes + mongo.js + 
  procurement guard + tests (§6 Phase 1).
  
  Gate: All Phase 1 tasks complete; test suite passes (in-memory Mongo only); no regressions
  in existing warehouse/procurement/transfer tests; code review approved; docs updated.

  ↓

Phase 2: Admin FE (one admin-web platform engineer)
  Types + API client + pages/modals + routes + menu + statusMeta + LedgerPage update + Vitest
  (§6 Phase 2).
  
  Gate: Page loads; buttons hidden/shown by role; double-click sends one request; error codes render;
  eslint + tsc -b pass (no new errors); vitest suite green (baseline 5 failing OrderDetailsModal
  tests unchanged); code review approved.

  ↓

Phase 3: Integrations (both engineers, after Phase 1+2 ship to dev)
  BE: Verify Bill list join (additive fields). FE: Verify Bill row actions + Recall button + write-off hint.
  
  Gate: Verify Bill shows return stats and badge; Recall page has "Return to supplier" button;
  Phase 1+2 already in dev.

  ↓

Tests: Full walkthrough (haper-misc/test-supplier-return.md)
  Manual on dev (damin.haper.in): batch-on/flag-off creates, bill cap, reserved guard, credit
  mark/undo, cancel, staff/store permissions, reconcile drift check.
  
  Gate: All steps ✓; no regressions in other warehouse workflows.

  ↓

Review: Code + docs
  Phase 1 & 2 code reviewed; test guide + goods-flow.md + client-followups.md updated;
  no secrets in commits; no git history rewritten.
  
  Gate: All review comments addressed; docs match code.

  ↓

Docs: Finalize
  haper-misc/test-supplier-return.md (steps, edge cases, deploy needed).
  haper-misc/docs/reference/goods-flow.md §11/§12 (Stage A + return flow).
  haper-misc/client-followups.md (admin only, no mobile changes).
  
  Gate: Docs are current with shipped code; next engineer can run tests without asking.
```

---

## 11. Specialist routing (who builds what after approval)

| Part | Desk |
|---|---|
| Phase 0 screens (section 6 list) | chanchal-designer |
| Phase 1 backend (shared + admin routes + mongo.js + procurement guard + tests) | backend platform engineer (single owner) |
| Phase 2 admin FE | admin-web platform engineer (single owner) |
| Phase 3 Verify Bill join (BE) / Verify Bill + Recall + write-off hint (FE) | same two engineers, disjoint files |
| Schema/index review (A1-A5) | aabha-dba, before Phase 1 task 2 |
| Credit state-machine review (optional, money record but no gateway) | hemant-payments, light review |
| Supplier-return report (Q9) | deepanshu-data, only if requested |
| Not needed | stas-realtime, rohit-ai |

---

## STATUS
✓ APPROVED (2026-10-05) — all decisions made, Phase gating gates clear, architecture reviewed by rajit + aabha.
Ready for Phase 0 (chanchal-designer) to start design work; Phase 1 backend build can start in parallel once
designs are reviewed.

## OUTPUT
`haper-misc/docs/plans/supplier-return.md` — updated with user approvals, Decisions section, Phase gating
checklist, acceptance criteria (validation + UX + regression gates), and schema updates (shortfallAmount,
creditMode enum, mandatory reasons).

## NEXT
Delegate to **chanchal-designer** to start Phase 0 design (Supplier Returns list page, modals, Figma mockups,
status colors). Coordinate with **rajit-backend-arch** on R1-R5 confirmation and **aabha-dba** on A1-A5 sign-off
in parallel. Once design is approved, **backend platform engineer** starts Phase 1 build.
