# Return to Supplier — FINAL BUILD SPEC (authoritative)

Status: **FINAL** (2026-10-05) — tie-break by akshay-principal. **Amended 2026-10-06** after the
security + code review (user-approved): below-cost credit note, bill ↔ lot tie + receipt corrections in
the bill cap, refund-undo permissions, flag re-check inside the write, flag-off retry safety, Verify Bill
totals placement. Amendments are marked "(amended 2026-10-06)". A second review round the same day added:
corrections may only LOWER a bill cap, zero-cost lots need a price or note (`CREDIT_PRICE_REQUIRED`),
database write failures are typed (`WRITE_FAILED`), invisible-only notes count as empty — marked "(amended 2026-10-06 r2)".
Supersedes, where they conflict: `supplier-return.md` §3.5, §4, §5, `supplier-return-schema.md` §2–§4,
`supplier-return-design.md` §4 (credit modes), §6.3–§6.5 (credit + cancel), §7 (error keys), §13.
Everything those docs say that this file does NOT contradict still stands (UX look, copy tone,
layout, a11y, responsive rules, Phase 3 hooks).
Condensed architecture review + verdicts: `supplier-return-arch-review.md`.

Paths: backend relative to `haper-backend/packages/`, FE relative to `haper-admin/`.
All example values are fictional.

---

## 0. The decisions in one screen

| # | Question | Decision | Deciding principle |
|---|---|---|---|
| D1 | Refunds: separate `supplier-return-refunds` collection (rajit) vs embedded `refunds[]` (aabha) | **Embedded `refunds[]` on the return doc**, append-only, entries voided never deleted, `rev` compare-and-set | One fact, one document: a refund write is a single atomic update. A separate collection still needs summary fields + a CAS counter on the return, i.e. two copies of the same money that must be kept in step. |
| D2 | Refund states | `creditStatus` = `PENDING \| RECEIVED \| NOT_EXPECTED` only. Several refunds may be recorded; "part received" is a DISPLAY label (`PENDING` and `receivedAmount > 0`), not a stored state | Approved Q5 (no extra state). Rajit's PARTIAL/SETTLED are derivable. |
| D3 | Close short | `settle: true` + note on a refund closes the return as `RECEIVED` although short | aabha's design; matches Q5 "shortfall recorded and shown" |
| D4 | Over-refund | **Refused by default** (`OVER_REFUND`); allowed only with `confirmOver: true` + a note | A typo (₹2,160 for ₹216) is the real risk; a supplier crediting GST on top (Q10, open) is legitimate and must not be impossible. |
| D5 | Shortfall | Never stored. `shortfallAmount = round2(max(0, expected − received))` in the response mapper | `expectedCreditAmount` never changes after create, so a derived value cannot drift. |
| D6 | `receivedAmount` | Stored cache = `foldReceived(refunds)`; always recomputed and `$set`, never `$inc` | Float drift; list tiles need it for `$sum`. |
| D7 | Idempotency key | Unique `{ createdBy, clientRequestId }`; replay lookup by both; E11000 branched on `err.keyPattern`; a `returnId` collision is a counter-drift retry, never a replay | A key minted by one browser must not replay (and reveal) another admin's return. |
| D8 | Lot addressing | Batch mode: each line sends **`batchId`**; server loads the lot by `_id` and asserts `warehouseId` + `sku` | The `(warehouseId, sku, batchNo)` unique index is not force-built on dev/prod; `_id` is unambiguous and survives a lot rename. |
| D9 | Supplier match | Allowed suppliers of a lot = distinct non-null `supplierId` on **`PURCHASE_IN`** rows for `(warehouseId, sku, lot.batchNo)`; if none, fall back to `lot.supplierId`; if still none → "supplier not recorded" → allowed | Lots merge across receipts (AUTO-EXP lots merge same-expiry stock from different suppliers) and `correctReceiptSupplier` rewrites only the ledger, so `lot.supplierId` is not the truth. |
| D10 | Reserved-stock guard | Reject only if **`after.available < after.reserved` AND `after.available < before.available`** — one shared pure helper | Returning a HOLD/RECALL lot does not lower `available`, so it must work even when the sku is already stranded. |
| D11 | Cancel | Allowed iff `status RETURNED` AND **no ACTIVE refund**; refused `409 BATCH_MODE_CHANGED` if the warehouse batch flag differs from the return's `batchMode`; `restoreToLot` must not push `qtyRemaining` above `qtyReceived`. Cancel does NOT change `creditStatus`. | Rolling a lot back into a flat-mode total (or vice versa) corrupts `availableQty`; refusing is safe and reversible (flip the flag back). "Cancelled" is a stock fact — it lives in `status`, not in `creditStatus`. |
| D12 | Credit modes | `CASH \| BANK \| CREDIT_NOTE_ADJUSTED` (labels: Cash / Bank transfer / Credit note adjusted). Plan §3.5's `CREDIT_NOTE/ONLINE/ADJUSTED_ON_BILL` and the design's `ONLINE` mapping are void. | Same vocabulary as plan §4.3 + both reviews. Different from `receipt-payments.mode` on purpose: don't share the label map. |
| D13 | Refund date | **Required, never defaulted** by server OR FE (design §6.4 "prefill today" is overridden) | "When the money moved" is a fact the human states; same rule as `paidAt`. |
| D14 | Reason | Per LINE: `lines[].reason` (required enum) + `lines[].reasonNote` (required when `OTHER`). Return-level `note` optional. No return-level `reason`. | Hard user requirement. |
| D15 | Error envelope | House envelope: `errorUtils(msg, status, { errorType: "SUPPLIER_RETURN", reason, details })` → body `{ code:<HTTP number>, error, data:null, message, errorType, reason, details }`. FE keys off `reason` + `details.lineIndex`, never `code` (numeric here) or message text. | `admin/src/middleware/error.js` only emits `reason` when `errorType` is a string. |
| D16 | Return id | `SR` + 6 digits, minted EXPLICITLY by the repository (`sequences` id `supplierReturnId`, `$inc` without session) before the ledger rows are written; on a `returnId` E11000 → `$max` fast-forward + rerun the whole create once (same as `stock-transfer.repository.js`). No pre-validate hook, no boot hook. | The ledger rows need the id before the insert; a hook cannot provide it. |
| D17 | Lot list | New read endpoint `GET /admin/supplier-returns/lots` (supplier match computed server-side by the SAME function create uses). The existing `GET /admin/warehouse/:id/stock/:sku/batches` is NOT changed. | One rule, one place; no change to an existing response. |

The approved plan decisions Q1–Q10 and R1–R5/A1–A5 stand, except where D1–D17 refine them.

---

## 1. Data model

### 1.1 Constants — `shared/constants/supplier-return.constant.js` (NEW), exported as `SupplierReturnConstants`

```js
status:       { RETURNED: "RETURNED", CANCELLED: "CANCELLED" }
creditStatus: { PENDING: "PENDING", RECEIVED: "RECEIVED", NOT_EXPECTED: "NOT_EXPECTED" }
refundStatus: { ACTIVE: "ACTIVE", VOIDED: "VOIDED" }
creditMode:   { CASH: "CASH", BANK: "BANK", CREDIT_NOTE_ADJUSTED: "CREDIT_NOTE_ADJUSTED" }
reasons:      { DAMAGED, EXPIRED, RECALL, WRONG_ITEM, QUALITY, EXCESS, OTHER }   // value === key
MAX_LINES = 100, MAX_REFUNDS = 20, MAX_QTY = 100000, MAX_UNIT_PRICE = 100000, MAX_REFUND_AMOUNT = 10000000
SEQUENCE_ID = "supplierReturnId", ID_PREFIX = "SR"
errorType = "SUPPLIER_RETURN"
indexSpecs = [
  { name: "returnId_unique",            key: { returnId: 1 },                       unique: true },
  { name: "createdBy_clientRequestId_unique", key: { createdBy: 1, clientRequestId: 1 }, unique: true },
]
```

`shared/constants/inventory.constant.js` `movementType`: ADD `SUPPLIER_RETURN_OUT`, `SUPPLIER_RETURN_REVERSAL`
(append only; nothing else in the file changes).

### 1.2 Collection `supplier-returns` — `shared/models/supplier-returns.schema.js` (NEW), `SupplierReturnModel`

```js
lineSchema (keeps _id):
  sku               String, required, trim
  name              String, default ""             // from warehouse-stocks at create
  iId               String, default ""
  batchId           ObjectId(warehouse-batches), default null   // null ⇔ batchMode false
  batchNo           String, default ""             // lot's batchNo AT RETURN TIME (snapshot)
  lotStatusAtReturn String enum [AVAILABLE, HOLD, RECALL, null], default null
  expiresAt         Date, default null
  qty               Number, required, min 1, integer
  reason            String enum reasons, required
  reasonNote        String, default "", maxlength 200       // required (non-blank) when reason OTHER (validator + pre-validate check)
  lotCostPrice      Number, default 0, min 0       // snapshot (batch: lot.costPrice; flag-off: warehouse-stocks.costPrice)
  creditUnitPrice   Number, default 0, min 0, max 100000
  lineCredit        Number, default 0, min 0       // round2(qty × creditUnitPrice)

refundSchema (keeps _id = refundId):
  amount      Number, required, min 0.01, max 10000000   // round2 at write
  receivedAt  Date, required                              // business date, as stated by the user
  mode        String enum creditMode, required
  reference   String, default null, trim, maxlength 100
  note        String, default "", maxlength 500
  status      String enum [ACTIVE, VOIDED], default ACTIVE
  recordedBy  ObjectId(admins), required
  recordedAt  Date, required                              // server clock
  voidedBy    ObjectId(admins), default null
  voidedAt    Date, default null
  voidReason  String, default null, maxlength 500

schema:
  returnId             String, required               // "SR000007"
  clientRequestId      String, required               // browser UUID v4
  requestHash          String, required               // sha256 hex, see §3.1
  warehouseId          ObjectId(warehouses), required
  supplierId           ObjectId(suppliers), required
  invoiceNumber        String, default null           // commonUtils.normalizeInvoiceNumber(); null = not bill-linked
  note                 String, default "", maxlength 300
  batchMode            Boolean, required              // flag value used at create; cancel must match
  status               enum status, default RETURNED, required
  lines                [lineSchema], validate 1..100
  totalUnits           Number, default 0
  expectedCreditAmount Number, default 0, min 0       // fixed at create, NEVER updated
  creditStatus         enum creditStatus, default PENDING, required
  refunds              [refundSchema], default []      // append-only, ≤ 20 incl. voided
  receivedAmount       Number, default 0, min 0       // CACHE = foldReceived(refunds)
  creditNote           String, default null, maxlength 500   // why NOT_EXPECTED / why settled short / reopen note
  creditOverrideNote   String, default null, maxlength 500   // (amended 2026-10-06) why a credit price is below cost / 0
  creditStatusBy       ObjectId(admins), default null
  creditStatusAt       Date, default null
  rev                  Number, default 0, min 0       // +1 on EVERY post-create user write; never on sku rename
  createdBy            ObjectId(admins), required
  cancelledBy          ObjectId(admins), default null
  cancelledAt          Date, default null
  cancelReason         String, default null, maxlength 500
  { timestamps: true, versionKey: false }
```

No `shortfallAmount` field (D5). No `credit` / `creditHistory` blocks (replaced by `refunds[]`).

### 1.3 Indexes (declared with `schema.index(..., { name })`, not field-level `unique`)

| Name | Key | Unique | Why |
|---|---|---|---|
| `returnId_unique` | `{ returnId: 1 }` | yes | human id |
| `createdBy_clientRequestId_unique` | `{ createdBy: 1, clientRequestId: 1 }` | yes | **idempotency (correctness)** |
| `warehouse_createdAt` | `{ warehouseId: 1, createdAt: -1 }` | no | list |
| `bill_key_status` | `{ warehouseId: 1, supplierId: 1, invoiceNumber: 1, status: 1 }` | no | bill cap, supplier-correction guard, Phase 3 join |
| `lines_sku` | `{ "lines.sku": 1 }` | no | barcode-rename fan-out |

### 1.4 State invariants (asserted by `assertCreditInvariants(doc)` before every credit write AND in tests)

- `receivedAmount === foldReceived(refunds)` where `foldReceived = round2(Σ amount of ACTIVE refunds)`.
- `NOT_EXPECTED ⇒ receivedAmount === 0`.
- `PENDING ⇒ receivedAmount < expectedCreditAmount`.
- `RECEIVED ⇒ receivedAmount > 0`.
- `CANCELLED ⇒ receivedAmount === 0` (no ACTIVE refund).
- `refunds.length ≤ 20`.
- At create, if `expectedCreditAmount === 0` → `creditStatus = NOT_EXPECTED`, `creditNote = "Expected credit was ₹0.00 at return time."` (keeps `PENDING ⇒ received < expected` true).

### 1.5 Unchanged

`warehouse-batches`, `warehouse-stocks`, `stock-movements` (schema), `receipt-payments`, `sequences`.
No migration, no backfill. New collection starts empty.

---

## 2. API (`/admin/supplier-returns`, new router `admin/src/routes/supplier-return/router.js`)

Mounted in `admin/src/routes/index.js` as `router.use('/supplier-returns', supplierReturnRoutes)` BEFORE
`router.use(errorHandler)`. Do NOT mount `redactCostPrice` (warehouse roles see cost elsewhere already).

Gates:
- Router: `authenticate` + `requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_STAFF)` (store_admin bypasses
  permissions, so the role gate is what keeps store roles out).
- READ = `requireAnyPermission(WAREHOUSE.VIEW_LEDGER, WAREHOUSE.MANAGE)`.
- WRITE = `requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER)` + `requirePermission(WAREHOUSE.MANAGE)`.
- Every handler: warehouse scope via `resolveWarehouseId` / `assertWarehouseAccess`. Every `/:id` handler
  loads the doc first and calls `assertWarehouseAccess(req, doc.warehouseId)` BEFORE any state check
  (IDOR; deny order: visibility first).
- `:id` and `:refundId` validated as 24-hex ObjectIds (400 `VALIDATION`), unknown → 404 `NOT_FOUND`.
- Validators forward the parsed Joi value (`req.body = value` / `req.query = value`), `stripUnknown: false`,
  unknown keys rejected.

**Route order matters:** register `GET /bill-context` and `GET /lots` BEFORE `GET /:id`.

Success envelope: `res.json({ msg, data })` like every admin route.

| # | Method + path | Gate | Request | Success `data` |
|---|---|---|---|---|
| A1 | `GET /` | READ | query `warehouseId?` (required for super), `status?` (RETURNED\|CANCELLED), `creditStatus?`, `voidedRefunds?` (bool; true = only returns with an undone refund — amended 2026-10-06), `supplierId?`, `q?` (≤60, matches returnId or normalised invoice, prefix, regex-escaped), `fromDate?`, `toDate?` (IST calendar days on `createdAt`), `page=1`, `limit=20 (≤100)` | `{ returns: [Summary], total, page, limit, stats }` |
| A2 | `GET /bill-context` | READ | `warehouseId?`, `supplierId` (req), `invoiceNumber` (req, ≤60) | `{ invoiceNumber, supplierId, lines: [{ sku, name, billedQty, alreadyReturnedQty, returnableQty, billUnitCost, batchNos: [] }] }` — 404 `BILL_NOT_FOUND` when no PURCHASE_IN rows |
| A3 | `GET /lots` | READ | `warehouseId?`, `sku` (req), `supplierId?` | `{ batchMode, stock: { sku, name, availableQty, reservedQty, freeQty, costPrice } \| null, lots: [Lot] }` (lots = `[]` when batchMode false) |
| A4 | `GET /:id` | READ | — | `Detail` |
| A5 | `POST /` | WRITE | see §2.1 | 201 `{ return: Detail, replayed: false }`; replay 200 `{ return: Detail, replayed: true }` |
| A6 | `POST /:id/refunds` | WRITE | `{ expectedRev, amount, receivedAt, mode, reference?, note?, settle?, confirmOver? }` | `{ return: Detail }` |
| A7 | `POST /:id/refunds/:refundId/void` | WRITE | `{ expectedRev, reason }` | `{ return: Detail }` |
| A8 | `POST /:id/credit/not-expected` | WRITE | `{ expectedRev, note }` | `{ return: Detail }` |
| A9 | `POST /:id/credit/reopen` | WRITE | `{ expectedRev, note? }` | `{ return: Detail }` |
| A10 | `POST /:id/cancel` | WRITE | `{ expectedRev, reason }` | `{ return: Detail }` |

### 2.1 `POST /` body

```json
{
  "clientRequestId": "uuid-v4",
  "warehouseId": "<24hex, optional for warehouse roles>",
  "supplierId": "<24hex>",
  "invoiceNumber": "INV-0042 | null",
  "batchMode": true,
  "note": "",
  "creditOverrideNote": "",
  "lines": [
    { "sku": "8901234500012", "batchId": "<24hex, required iff batchMode true, forbidden otherwise>",
      "qty": 12, "reason": "DAMAGED", "reasonNote": "", "creditUnitPrice": 18.00 }
  ]
}
```
`creditUnitPrice` optional (absent → lot/stock cost). `batchMode` is what the client believed; server compares (D11/§3.1).
`creditOverrideNote` optional, ≤500 (amended 2026-10-06): REQUIRED (non-blank) when any line SENDS a
`creditUnitPrice` that is 0 or below that line's `lotCostPrice` → else 400 `CREDIT_OVERRIDE_NOTE_REQUIRED`.
A price left to default never needs it; at/above cost never needs it. Stored on the return and returned in Detail.

### 2.2 Response shapes

- **Summary**: `_id, returnId, createdAt, warehouseId, supplierId, supplierName, invoiceNumber, reasons (distinct line reasons, enum order), totalUnits, expectedCreditAmount, receivedAmount, shortfallAmount, creditStatus, status, liveRefundCount, rev`.
- **Detail**: full doc (incl. `creditOverrideNote`, null when none) + `supplierName, warehouseName, createdByName, cancelledByName, creditStatusByName, shortfallAmount, liveRefundCount`, and per refund `recordedByName, voidedByName`. Ids as strings.
- **stats** (filtered by warehouse/supplier/q/date — NOT by `status`/`creditStatus`; always `status: RETURNED`):
  `{ pendingAmount: Σ max(0, expected − received) over creditStatus PENDING, pendingCount, receivedAmount: Σ receivedAmount, receivedCount: count creditStatus RECEIVED }`.
- **Lot**: `{ batchId, batchNo, status, qtyRemaining, qtyReceived, costPrice, expiresAt, supplierIds: [], supplierNames: [], supplierMatch: "MATCH" | "UNKNOWN" | "OTHER" | null (null when no supplierId in query), returnable: qtyRemaining > 0 && supplierMatch !== "OTHER" }`. Sorted expiry asc, then `_id`.

### 2.3 Error reasons (all `errorType: "SUPPLIER_RETURN"`; `details` values JSON-safe, ids as strings)

| reason | HTTP | When | details |
|---|---|---|---|
| `VALIDATION` | 400 | Joi failure | `{ field, lineIndex? }` (lineIndex = Joi path[1] when path[0] === "lines") |
| `DUPLICATE_LINE` | 400 | same `(sku, batchId)` (batch) / same `sku` (flag-off) twice | `{ lineIndex, sku }` (lineIndex = the second occurrence) |
| `WAREHOUSE_NOT_FOUND` / `SUPPLIER_NOT_FOUND` / `BILL_NOT_FOUND` / `NOT_FOUND` / `REFUND_NOT_FOUND` | 404 | — | `{}` |
| `BATCH_MODE_CHANGED` | 409 | create: `body.batchMode` ≠ current flag; cancel: `doc.batchMode` ≠ current flag | `{ batchMode: <current> }` |
| `SKU_NOT_ON_BILL` | 400 | bill-linked, sku not on bill | `{ lineIndex, sku }` |
| `EXCEEDS_BILL` | 400 | Σ requested for sku + alreadyReturned > billed | `{ lineIndex (first line of sku), sku, billed, alreadyReturned, returnable }` |
| `LOT_NOT_FOUND` | 400 | batchId missing / other warehouse / other sku | `{ lineIndex, sku, batchId }` |
| `SUPPLIER_MISMATCH` | 400 | D9 set non-empty and excludes supplier | `{ lineIndex, sku, batchId, batchNo, lotSupplierIds, lotSupplierNames }` |
| `INSUFFICIENT_LOT` | 400 | guarded lot `$inc` matched 0 | `{ lineIndex, sku, batchId, batchNo, available }` |
| `INSUFFICIENT_STOCK` | 400 | flag-off: no row or `availableQty < qty` | `{ lineIndex, sku, available }` |
| `RESERVED` | 400 | D10 violated (batch) / flag-off `$expr` failed with enough on hand | `{ lineIndex (first line of sku), sku, available, reserved, free }` (values BEFORE the return) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | same `(createdBy, clientRequestId)`, different `requestHash` | `{ returnId }` |
| `STALE` | 409 | `expectedRev ≠ doc.rev`, or CAS filter matched nothing | `{ currentRev }` |
| `INVALID_STATE` | 409 | action not allowed in current `status`/`creditStatus` | `{ status, creditStatus }` |
| `HAS_REFUNDS` | 409 | cancel / not-expected with ≥1 ACTIVE refund | `{ liveRefundCount, receivedAmount }` |
| `OVER_REFUND` | 400 | new received > expected and not (`confirmOver` && note) | `{ expected, alreadyReceived, maxWithoutConfirm }` |
| `REFUND_LIMIT` | 409 | already 20 refund entries | `{ max: 20 }` |
| `LOT_RESTORE_CONFLICT` | 409 | cancel: lot gone / restore would exceed `qtyReceived` | `{ lineIndex, sku, batchId, batchNo }` |
| `BILL_HAS_SUPPLIER_RETURNS` | 409 | `PATCH /admin/procurement/receipt/supplier` when live returns reference the bill | `{ returnIds: [] }` |
| `CREDIT_OVERRIDE_NOTE_REQUIRED` | 400 | (amended 2026-10-06) a sent `creditUnitPrice` is 0 or < `lotCostPrice` and `creditOverrideNote` blank | `{ lineIndex, sku, lotCostPrice, creditUnitPrice }` |
| `LOT_NOT_ON_BILL` | 400 | (amended 2026-10-06) bill-linked, batch mode: the line's lot `batchNo` was not received on this bill (LEGACY lot allowed only if the bill was received before the LEGACY lot was seeded) | `{ lineIndex, sku, batchId, batchNo, billBatchNos }` |
| `CREDIT_PRICE_REQUIRED` | 400 | (amended 2026-10-06 r2) a line's lot cost is 0, no `creditUnitPrice` sent and `creditOverrideNote` blank | `{ lineIndex, sku }` |
| `WRITE_FAILED` | 500 | (amended 2026-10-06 r2) an untyped (database/driver) error from a write transaction AFTER `withTransaction` finished its transient retries; message is a fixed retry sentence, never driver text | `{}` |
| `VOID_NEEDS_SUPER_ADMIN` | 403 | (amended 2026-10-06) non-super admin undoing a refund recorded by someone else, or a CASH refund recorded > 24h ago | `{ refundId, recordedBy, mode, recordedAt }` |

Raw E11000 must NEVER reach `error.js` from this module (it would become `400 "Duplicate entry"`).
(amended 2026-10-06 r2) Nor may any other untyped write error: `error.js` defaults it to 400 with the raw
driver text (its prod scrub only covers ≥500), so create and every `/:id` write wrap it as `WRITE_FAILED`.
`error.js` itself is unchanged (app-wide). `LOT_NOT_ON_BILL`'s message names the bill's lots and says to
record the return without the bill if the lot was renamed.
403s come from the existing middleware unchanged.

---

## 3. Algorithms (each write = ONE `session.withTransaction(fn, { readPreference: "primary" })` with `auditUtils.logAtomic` inside)

Helpers (NEW, pure, `shared/utils/supplier-return.utils.js`, exported as `supplierReturnUtils`):
`round2`, `foldReceived(refunds)`, `shortfall(expected, received)`, `nextCreditStatusAfterRefund(...)`,
`nextCreditStatusAfterVoid(...)`, `assertCreditInvariants(doc)`, `canonicalJson(value)` (sorted keys),
`requestHash(parsedBody)` = sha256 hex of `canonicalJson(body without clientRequestId)`, `toSummary`, `toDetail`.

`shared/utils/free-to-promise.utils.js` (NEW, `freeToPromiseUtils`):
`violation({ before, after })` → `null` or `{ available, reserved, free }`, where violated ⇔
`after.availableQty < after.reservedQty && after.availableQty < before.availableQty` (missing numbers = 0).
Returns, never throws (callers shape their own error). Later reusable by write-off (plan §7.7 #1).

Inside every transaction callback, re-read anything you branch on (withTransaction re-runs the callback
on transient errors; the retry must see fresh data). Never use `modifiedCount` as a CAS signal (timestamps
make it 1) — use `findOneAndUpdate` returning `null`, or `matchedCount`.

### 3.1 Create (`POST /`)

Before the transaction (no writes):
1. `warehouseId = resolveWarehouseId(req, body.warehouseId)`; `assertWarehouseAccess`.
2. **Replay pre-check**: `findOne({ createdBy: req.admin._id, clientRequestId }).read("primary")`. Found →
   same `requestHash` → 200 replay; else 422 `IDEMPOTENCY_KEY_REUSED`. (So a retry is a replay even if the
   flag flipped or the stock moved since.)
3. Warehouse exists; supplier exists (inactive allowed).
4. `current = isWarehouseBatchEnabled(warehouseId)`; `body.batchMode !== current` → 409 `BATCH_MODE_CHANGED`.
   Validator already enforced line shape vs `body.batchMode` (batchId required iff true).
5. Duplicate lines → 400 `DUPLICATE_LINE`.
6. `invoiceNumber = normalizeInvoiceNumber(body.invoiceNumber)`; `hash = requestHash(parsedBody)`.

Transaction callback:
1. `returnId = await SupplierReturnRepository.mintReturnId()` (sequence `$inc`, NO session — commits outside the txn; aborts leave gaps; cosmetic). `_id = new ObjectId()`.
0. (amended 2026-10-06) After the replay check: re-read the flag UNCACHED in-session
   (`WarehouseBatchRepository.isWarehouseBatchEnabledInSession`) → differs from `body.batchMode` → 409 `BATCH_MODE_CHANGED`.
2. **Bill cap** (if `invoiceNumber`): `rows = StockMovementRepository.receiptRowsForBill({warehouseId, supplierId, invoiceNumber}, session)` (NEW method: `movementType: "PURCHASE_IN"` explicit, same case-insensitive anchored regex as `findReceiptRowsByInvoice`, in-session). None → 404 `BILL_NOT_FOUND`.
   (amended 2026-10-06) Billed qty is NET of receipt corrections: per `(sku, batchNo)` of the bill, `billed = max(0, Σ PURCHASE_IN + Σ RECEIPT_CORRECTION deltas on that lot dated at/after the bill's first receipt of it)` (`StockMovementRepository.receiptCorrectionsForLots`, pure `supplierReturnUtils.billedLots`); flag-off matches corrections by sku only (legacy corrections carry the `LEGACY` sentinel). `billed[sku] = Σ` over its lots. Corrections are lot-anchored, so a lot shared by two bills has each correction counted against both — therefore (amended 2026-10-06 r2) corrections may only LOWER a bill's cap: per lot `billed = max(0, min(billQty, billQty + Σ corrections))`. Example: bills A (10) and B (5) share lot `SH`; the lot is corrected to 25 → A's cap stays 10, B's 5. Flag-off: a count correction up (on hand set to 40 after a bill of 10) leaves the cap at 10. Per sku, after `SKU_NOT_ON_BILL` and before `EXCEEDS_BILL`: batch mode → each line's lot `batchNo` must be one of the bill's batchNos for that sku → else `LOT_NOT_ON_BILL`. Known gap: a lot RENAMED via receipt correction no longer matches its bill — return it without linking the bill. `returned[sku] = SupplierReturnRepository.sumReturnedForBill({warehouseId, supplierId, invoiceNumber}, session)` (status RETURNED only). Per sku in request: not in billed → `SKU_NOT_ON_BILL`; `Σ requested + returned > billed` → `EXCEEDS_BILL`. (Comment at this read: the cap is race-hard ONLY because every line also writes the sku's `warehouse-stocks` row in this txn — do not remove that write.)
3. **Batch mode**, per sku group (request order):
   - `before = WarehouseStockRepository.getBySku(warehouseId, sku, session)` (read BEFORE any lot change).
   - per line: `lot = WarehouseBatchRepository.stockOutFromLot({ warehouseId, sku, batchId, qty }, session)`:
     - requires session (throws 500 without one); loads `{_id: batchId, warehouseId, sku}` in-session → none: `{ ok:false, reason:"NOT_FOUND" }`;
     - any status (AVAILABLE/HOLD/RECALL) allowed;
     - `updateOne({ _id, warehouseId, sku, qtyRemaining: { $gte: qty } }, { $inc: { qtyRemaining: -qty } }, { session })`; `matchedCount === 0` → `{ ok:false, reason:"INSUFFICIENT", available: lot.qtyRemaining }`;
     - `qtyReceived` NOT changed; returns `{ ok:true, batchId, batchNo, status, costPrice, expiresAt, supplierId, iId }` (values read before the `$inc`).
     - controller maps `NOT_FOUND` → `LOT_NOT_FOUND`, `INSUFFICIENT` → `INSUFFICIENT_LOT`.
   - per line, supplier check (D9): `ids = SupplierReturnRepository.lotSupplierIds({ warehouseId, sku, batchNo: lot.batchNo, lotSupplierId: lot.supplierId }, session)` → non-empty and not containing `supplierId` → `SUPPLIER_MISMATCH`. (Same function powers `GET /lots`.)
   - once per sku: `after = WarehouseBatchRepository.recomputeRollup(warehouseId, sku, session)`; `v = freeToPromiseUtils.violation({before, after})` → `RESERVED` with `before` numbers.
   - snapshot per line: `batchNo, lotStatusAtReturn, expiresAt, lotCostPrice = round2(lot.costPrice || 0)`, `name/iId` from the stock row.
4. **Flag-off**, per line (one line per sku): `row = WarehouseStockRepository.decrementFreeToPromise(warehouseId, sku, qty, session)` (NEW; requires session; `findOneAndUpdate({ warehouseId, sku, $expr: { $gte: [ { $subtract: ["$availableQty", { $ifNull: ["$reservedQty", 0] }] }, qty ] } }, { $inc: { availableQty: -qty } }, { new: true, session })`). `null` → read the row in-session: missing or `availableQty < qty` → `INSUFFICIENT_STOCK`, else `RESERVED`. `lotCostPrice = round2(row.costPrice || 0)`, `batchId null`, `batchNo ""`.
5. Per line: `creditUnitPrice = round2(body value ?? lotCostPrice)`, `lineCredit = round2(qty × creditUnitPrice)`; `expectedCreditAmount = round2(Σ lineCredit)`, `totalUnits = Σ qty`.
   (amended 2026-10-06) A sent price that is 0 or < `lotCostPrice` with a blank `creditOverrideNote` → `CREDIT_OVERRIDE_NOTE_REQUIRED` (whole txn rolls back).
   (amended 2026-10-06 r2) `lotCostPrice === 0` (e.g. a LEGACY lot seeded from stock with no price) and NO price sent and blank `creditOverrideNote` → `CREDIT_PRICE_REQUIRED` (otherwise the credit silently became ₹0 / NOT_EXPECTED, which cannot be reopened).
6. Per line ledger: `stockLedgerUtils.recordWarehouse({ warehouseId, sku, warehouseStockId, type: SUPPLIER_RETURN_OUT, quantityDelta: -qty, balanceAfter: <sku's availableQty after the return>, supplierId, costPrice: lotCostPrice, refType: "supplier_return", refId: _id, refLabel: returnId, reason: line.reason, note: line.reasonNote || body.note, batchNo, iId, actorId: req.admin._id, actorType: "admin" }, session)`.
7. Insert the COMPLETE doc once: `SupplierReturnModel.create([{ _id, returnId, clientRequestId, requestHash: hash, ..., rev: 0, creditStatus: expected === 0 ? NOT_EXPECTED : PENDING }], { session })` (schema validators see the whole doc).
8. `auditUtils.logAtomic(req, { action: "warehouse.supplier_return.create", metadata: { returnId, warehouseId, supplierId, invoiceNumber, totalUnits, expectedCreditAmount, creditOverrideNote, lines: [{ sku, batchNo, qty, reason, lotCostPrice, creditUnitPrice }] } }, session)` (price fields + note amended 2026-10-06).

After the transaction, on error:
- E11000 with `keyPattern.clientRequestId` (concurrent identical submit lost the race) → primary read by `{createdBy, clientRequestId}` → same hash: 200 replay; else 422.
- E11000 with `keyPattern.returnId` → `fastForwardReturnIdCounter()` (`$max`, primary read, copy of the transfer one) and rerun the WHOLE transaction once; a second collision → 500 "Couldn't create the return, please try again."
- Any other E11000 → rethrow wrapped as 500 (never let it become "Duplicate entry").
Everything rolls back together on any failure — no half-applied return.

### 3.2 Record refund (`POST /:id/refunds`)
Validator: `amount` > 0, ≤ 10,000,000, ≤ 2 dp; `receivedAt` required date, ≥ 2020-01-01, ≤ end of today IST;
`mode` required enum; `reference` required (1..100) when mode BANK or CREDIT_NOTE_ADJUSTED, optional for CASH;
`note` ≤ 500; `settle` bool; `confirmOver` bool; `expectedRev` int ≥ 0.
Txn: read doc in-session → access check → `rev ≠ expectedRev` → `STALE`; `status ≠ RETURNED` or
`creditStatus = NOT_EXPECTED` → `INVALID_STATE`; `refunds.length ≥ 20` → `REFUND_LIMIT`.
`newReceived = round2(receivedAmount + amount)`. If `newReceived > expected` and not (`confirmOver` and note
non-blank) → `OVER_REFUND`. If `settle` and `newReceived < expected` and note blank → `VALIDATION` (field note).
Next status: `RECEIVED` if `newReceived ≥ expected` or `settle` or current is `RECEIVED`; else `PENDING`.
`creditNote` = note when settling short or confirming over, else unchanged. Recompute `receivedAmount =
foldReceived([...refunds, entry])`, `assertCreditInvariants`, then
`findOneAndUpdate({ _id, rev: expectedRev, status: RETURNED, creditStatus: { $in: [PENDING, RECEIVED] } },
{ $push: { refunds: entry }, $set: { receivedAmount, creditStatus, creditStatusBy, creditStatusAt, creditNote }, $inc: { rev: 1 } }, { new: true, session })`
→ `null` → `STALE`. Audit `warehouse.supplier_return.refund.record` (amount, mode, reference, receivedAt, before/after status + receivedAmount).

### 3.3 Void refund (`POST /:id/refunds/:refundId/void`)
`reason` required 1..500. Txn: read → access → `STALE` check → `status ≠ RETURNED` → `INVALID_STATE`;
entry missing → `REFUND_NOT_FOUND`; entry `VOIDED` → `INVALID_STATE`. (amended 2026-10-06) Not super_admin
and (entry `recordedBy` ≠ caller, or entry is `CASH` with `recordedAt` > 24h ago) → 403 `VOID_NEEDS_SUPER_ADMIN`.
When the void moves `RECEIVED → PENDING` the settle-short / paid-over `creditNote` is cleared (`null`). Recompute received without it;
status = `RECEIVED` if `received ≥ expected && received > 0`, else `PENDING` (a void always drops a
"settled short"). `findOneAndUpdate({ _id, rev, status: RETURNED, refunds: { $elemMatch: { _id: refundId, status: ACTIVE } } },
{ $set: { "refunds.$[r].status": VOIDED, "refunds.$[r].voidedBy", "refunds.$[r].voidedAt", "refunds.$[r].voidReason", receivedAmount, creditStatus, creditStatusBy, creditStatusAt }, $inc: { rev: 1 } },
{ arrayFilters: [{ "r._id": refundId }], new: true, session })`. Audit `warehouse.supplier_return.refund.void`.

### 3.4 Mark not expected (`POST /:id/credit/not-expected`)
`note` 1..500. Allowed: `status RETURNED`, `creditStatus PENDING`, no ACTIVE refund (`HAS_REFUNDS`).
CAS filter `{ _id, rev, status: RETURNED, creditStatus: PENDING, "refunds.status": { $ne: ACTIVE } }`;
set `NOT_EXPECTED`, `creditNote`, by/at; `rev+1`. Audit `warehouse.supplier_return.credit.not_expected`.

### 3.5 Reopen (`POST /:id/credit/reopen`) — the design's "Undo" on a closed credit
Allowed: `status RETURNED` and either `NOT_EXPECTED` with `expected > 0`, or `RECEIVED` with
`receivedAmount < expected` (settled short). A fully-received return is reopened by VOIDING a refund
instead (keeps `PENDING ⇒ received < expected`). Otherwise `INVALID_STATE`. Set `PENDING`,
`creditNote = note || null`, by/at; `rev+1`. Refunds untouched. Audit `warehouse.supplier_return.credit.reopen`.

### 3.6 Cancel (`POST /:id/cancel`)
`reason` 1..500. Before txn: `current = isWarehouseBatchEnabled(doc.warehouseId)`; `≠ doc.batchMode` →
409 `BATCH_MODE_CHANGED`. Txn: read → access → `STALE` → `status ≠ RETURNED` → `INVALID_STATE`; ACTIVE
refund → `HAS_REFUNDS`; (amended 2026-10-06) uncached in-session flag re-read ≠ `doc.batchMode` → 409 `BATCH_MODE_CHANGED`.
- Batch mode, per line: `WarehouseBatchRepository.restoreToLot({ warehouseId, batchId, qty }, session)` (NEW; requires session):
  `findOneAndUpdate({ _id: batchId, warehouseId, $expr: { $lte: [ { $add: ["$qtyRemaining", qty] }, "$qtyReceived" ] } }, { $inc: { qtyRemaining: qty } }, { new: true, session })`;
  keeps the lot's current status and `qtyReceived`; `null` → `LOT_RESTORE_CONFLICT`. Then `recomputeRollup` once per sku (sku = lot's CURRENT sku).
- Flag-off, per line: NEW `WarehouseStockRepository.incrementInTransaction(warehouseId, line.sku, qty, session)` (amended 2026-10-06; same update as `increment`, requires a session, does NOT re-wrap driver errors so a write conflict is retried by `withTransaction`; `increment` itself stays byte-identical). Same rule for `decrementFreeToPromise`: driver errors propagate untouched.
- Ledger per line: `SUPPLIER_RETURN_REVERSAL`, `quantityDelta: +qty`, `batchNo` = lot's current batchNo (flag-off ""), same `refType/refId/refLabel`, `reason: "CANCELLED"`, `note: cancel reason`, `costPrice: line.lotCostPrice`, `supplierId`.
- CAS: `findOneAndUpdate({ _id, rev, status: RETURNED, "refunds.status": { $ne: ACTIVE } }, { $set: { status: CANCELLED, cancelledBy, cancelledAt, cancelReason }, $inc: { rev: 1 } })` → `null` → `STALE`.
- `creditStatus` NOT touched; every credit query/tile filters `status: RETURNED`.
- Audit `warehouse.supplier_return.cancel` (lines restored).

### 3.7 Supplier-correction guard (existing `correctReceiptSupplier`, additive)
Inside its existing transaction, BEFORE `updateReceiptSupplier`: if `oldSupplierId` is non-null,
`SupplierReturnRepository.findLiveForBill({ warehouseId, supplierId: oldSupplierId, invoiceNumber: normalizeInvoiceNumber(invoiceNumber) }, session)`
(status RETURNED); any → throw `errorUtils("This bill has supplier returns (SR000007). Cancel them before changing the supplier.", 409, { errorType: "SUPPLIER_RETURN", reason: "BILL_HAS_SUPPLIER_RETURNS", details: { returnIds } })`.
Nothing else in that handler changes. (Known accepted gap: a return created concurrently with a
supplier change is not serialised — read-only on both sides; vanishingly rare; documented in test guide.)

### 3.8 Barcode rename (`shared/utils/sku-identity.utils.js` `migrateWarehouseSku`)
AFTER the existing `Promise.all` (not inside it), one awaited statement:
`SupplierReturnModel.updateMany({ "lines.sku": from }, { $set: { "lines.$[l].sku": to } }, { arrayFilters: [{ "l.sku": from }], session })`;
add `supplierReturns: modifiedCount` to the returned object AND to `empty`. Does not bump `rev`. Do not
reorder or touch the existing three updates.

---

## 4. Validation matrix (server is the authority; FE mirrors to save a round trip)

| Field / rule | Server | FE (inline, before Review/Save) |
|---|---|---|
| clientRequestId | UUID v4 required | minted once per modal open (`crypto.randomUUID()`), reused for retries |
| warehouseId | 24-hex; scope check | WarehousePicker, required |
| supplierId | 24-hex, exists | required select |
| invoiceNumber | ≤60, normalised; must have PURCHASE_IN rows for (wh, supplier) | from bill combobox only |
| batchMode | bool, must equal current flag | from `/lots` response; on 409 show reload banner |
| lines | 1..100 | ≥1 ticked/added |
| line.sku | 1..64 | from search/bill |
| line.batchId | required iff batchMode; must be that wh+sku | lot chosen; only `returnable` lots selectable |
| line duplicate | (sku,batchId) / sku unique | prevent by construction ("Added") |
| line.qty | int 1..100000; ≤ lot qtyRemaining (guarded); bill cap | int ≥1; ≤ lot qtyRemaining; ≤ bill `returnableQty` minus other lines of same sku |
| reserved | D10 guard | hint only ("N promised to stores"), never blocks |
| supplier match | D9 | lots with `supplierMatch OTHER` hidden |
| line.reason | required enum | required select ("Reason for all" helper) |
| line.reasonNote | required non-blank (1..200) when OTHER, else ≤200 | required when OTHER |
| line.creditUnitPrice | 0..100000, ≤2dp | same; amber warning if differs from lot cost by >20% (non-blocking) |
| note | ≤300 | ≤300 |
| refund.amount | >0, ≤10,000,000, ≤2dp; over-expected needs confirmOver+note | same; live "short / matches / more" line |
| refund.receivedAt | required, 2020-01-01..today IST | required, blank by default, `max=today` |
| refund.mode | required enum | required radio, none preselected |
| refund.reference | required for BANK / CREDIT_NOTE_ADJUSTED (≤100) | same; label adapts to mode |
| refund.settle | short + settle ⇒ note required | checkbox "Close this return — supplier will not pay the rest" shown only when short |
| refund.confirmOver | over ⇒ confirmOver + note | checkbox "Yes, supplier paid more than expected" shown only when over |
| void reason / cancel reason / not-expected note | 1..500 | required textarea |
| all free-text notes (reasonNote, note, creditOverrideNote, refund note, reopen note, void/cancel reason, not-expected note) | (amended 2026-10-06 r2) zero-width / format chars (`\p{Cf}`, e.g. U+200B) stripped, then trimmed, BEFORE the empty/required check — an invisible-only note counts as blank | trim + same strip before the required check |
| expectedRev | required int on every post-create write | always sent from the loaded doc; on `STALE` refetch + banner |

FE rounding: `round2` identical to server (`Math.round(v*100)/100`), pinned by a shared-vector test (same
inputs/outputs table in `shared/utils` jest test and the FE vitest).

---

## 5. Do-not-break checklist (reviewer ticks every line)

- [ ] `stockOutFEFO`, `returnToBatch`, `stockIn`, `correctReceipt`, `recomputeRollup`, `setBatchStatus`, `listForSku` — byte-identical (only NEW methods added to `warehouse-batch.repository.js`).
- [ ] `decrementIfAvailable`, `reserve`, `releaseReserved`, `markDispatched`, `releaseInTransit`, `increment`, `receive`, `correctReceiptLegacy` — byte-identical.
- [ ] (amended 2026-10-06) Supplier-return repository reads never pass raw driver text to the client: fixed sentence (500) + server-side `console.error`; a `TransientTransactionError` is rethrown untouched.
- [ ] `receipt-payments` model/repo/routes untouched; `markReceiptPaid`/`unmarkReceiptPaid` untouched.
- [ ] Every new ledger query filters `movementType` explicitly; no existing PURCHASE_IN reader changed; `findReceiptRowsByInvoice` untouched (new in-session method added beside it).
- [ ] `movementType` enum only gains two values; `stock-movements.schema.js` untouched.
- [ ] `correctReceiptSupplier`: only the guard added, inside the existing transaction, before the update.
- [ ] `migrateWarehouseSku`: existing `Promise.all` unchanged; new update awaited after it; return gains one key; `product-delete.test.js` (`toMatchObject`) still green.
- [ ] `SupplierReturnModel` registered in FOUR places: `admin/src/connections/mongo.js` pre-create list + `ensureIndexesFor` list; `admin/__tests__/setup.js` pre-create list + `ensureIndexesFor` list. Boot `missingIndexes(SupplierReturnModel, SupplierReturnConstants.indexSpecs)` → `console.error("[supplier-returns] CRITICAL: ...")`, no exit.
- [ ] Existing GET `/admin/warehouse/:warehouseId/stock/:sku/batches` response unchanged.
- [ ] No new permission string → FE/BE permission mirror unchanged.
- [ ] No change in `user`, `picking`, `delivery`, `cron` packages or any mobile app.
- [ ] Jest suites green: `warehouse-*`, `procurement-*`, `transfer-return-*`, `ledger-*`, `warehouse-reservation`, `product-delete`, `product-barcode`, `receipt-payment-index-registration` + full admin suite.
- [ ] FE: `VerifyBillPage.tsx`, `RecallPage.tsx`, `WarehousesPage.tsx`, `ui.tsx` (`Modal`, `StatusPill`), `ALL_STATUSES`, `api/inventory.ts`, `MarkAsPaidModal.tsx` untouched in Phase 2.
- [ ] FE `apiErrorCode` unchanged (new helpers added beside it).

---

## 6. Tests

### 6.1 Backend (jest, in-memory Mongo only: `cd haper-backend/packages/admin && NODE_ENV=test npx jest`)

New files only (no existing test file edited):
- `admin/__tests__/supplier-return-repo.test.js` — `stockOutFromLot` (AVAILABLE/HOLD/RECALL; insufficient; wrong warehouse/sku → NOT_FOUND; `qtyReceived` unchanged; no session throws); `restoreToLot` (same `_id`, status kept, `qtyReceived` unchanged, above-`qtyReceived` refused); `decrementFreeToPromise` (blocks `available − reserved < qty`; no session throws); `freeToPromiseUtils.violation` table incl. stranded HOLD case; `supplierReturnUtils` (round2 vectors, foldReceived, state transitions, invariants).
- `supplier-return-create.test.js` — batch-on multi-sku multi-lot happy path (lots, rollup, ledger rows: type/sign/refLabel/costPrice/supplierId/batchNo/reason, totals, audit row); over-lot → 400 and NOTHING moved (earlier lines rolled back); HOLD + RECALL lots succeed with `availableQty` unchanged; stranded-sku HOLD return succeeds; reserved: approve a replenishment then return > free → `RESERVED`, ≤ free → OK; supplier: lot merged from two suppliers matches both, third supplier → `SUPPLIER_MISMATCH`, legacy null → allowed, ledger-corrected supplier wins over `lot.supplierId`; `LOT_NOT_FOUND` for a batchId from another warehouse; `DUPLICATE_LINE`; `reason OTHER` without note → `VALIDATION` with `details.lineIndex`; `expected 0` → `NOT_EXPECTED`; reconcile shows no drift.
- `supplier-return-idempotency.test.js` — same key twice sequential → one doc, stock once, `replayed:true`; `Promise.all` of two identical → one doc; same key + different body → 422; **same key, different admin → two returns**; forced `returnId` collision (seed `SR000001`, counter 0) → created as `SR000002`, not a replay.
- `supplier-return-bill.test.js` — sku not on bill; over cap; second partial counts first; cancelled not counted; two concurrent returns jointly over the cap → exactly one 201 (cap is race-hard via the stock-row write); bill-context numbers; `BILL_NOT_FOUND`.
- `supplier-return-flagoff.test.js` — per-sku return; `batchId` sent → `VALIDATION`/`BATCH_MODE_CHANGED`; reserved; `INSUFFICIENT_STOCK`; flag flipped between load and submit → 409; cancel after flag flip (both directions) → 409 and nothing moved.
- `supplier-return-credit.test.js` — refund partial stays PENDING; second refund reaching expected → RECEIVED; settle short needs note → RECEIVED; over without confirm → `OVER_REFUND`, with confirm+note OK; reference required for BANK; future date refused; void → status re-derived, entry kept as VOIDED; not-expected with refunds → `HAS_REFUNDS`; reopen rules; stale `expectedRev` → `STALE`; **double-click (two parallel records, same rev) → exactly one refund**; 21st entry → `REFUND_LIMIT`; invariant `receivedAmount === foldReceived(refunds)` after every step.
- `supplier-return-cancel.test.js` — restores exact lots (+ reversal rows, rollup, reconcile clean); refused with an ACTIVE refund; allowed after voiding it; allowed when NOT_EXPECTED; twice → `INVALID_STATE`/`STALE`; lot renamed between return and cancel → restored by `_id`; `LOT_RESTORE_CONFLICT` when `qtyReceived` lowered under it.
- `supplier-return-gates.test.js` — staff: list/detail/lots/bill-context 200, every write 403; store_admin 403 on all; manager of warehouse B → 403 on A's `/:id` reads and writes; route order (`/bill-context`, `/lots` not captured by `/:id`).
- `supplier-return-procurement-guard.test.js` — supplier change blocked 409 `BILL_HAS_SUPPLIER_RETURNS` with a live return; allowed after cancel; allowed for bills without returns.
- `supplier-return-sku-rename.test.js` — barcode change moves `lines.sku`, does not bump `rev`; cancel afterwards restores the right lot.
- `supplier-return-index-registration.test.js` — copy of `receipt-payment-index-registration.test.js` against the real `connectDb()`: duplicate `(createdBy, clientRequestId)` insert fails.

**Mutation gate (required for sign-off):** for each guard — idempotency unique index, replay pre-check,
keyPattern branch, lot `$gte` filter, `lotSupplierIds`, `violation()` both clauses, bill-cap read,
`rev` in each CAS filter, `"refunds.status": {$ne: ACTIVE}` in cancel, `restoreToLot` `$expr`,
batch-mode check in cancel, `assertWarehouseAccess` in `/:id` — revert the line, run the suite, record
red/green in a mutant table in the PR/commit notes. Every mutant must go red.

### 6.2 Admin FE (Vitest; baseline = the known-failing tests measured BEFORE starting stay exactly the same)
- `supplierReturn.test.ts` — round2 vectors (same table as backend), shortfall, line validation, refund form validation, error-to-line mapping (`reason` + `details.lineIndex`).
- `SupplierReturnsPage.test.tsx` — staff sees list, no New/Record/Cancel buttons; chip filters map to `status`/`creditStatus`; tiles ignore chip.
- `NewSupplierReturnModal.test.tsx` — double-click Confirm sends ONE request; Try again reuses the same `clientRequestId`; `replayed:true` shows success; `INSUFFICIENT_LOT` renders on the right line; `BATCH_MODE_CHANGED` banner.
- `useMenu.test.ts` — Supplier Returns visible to the three warehouse roles, hidden for store roles.
- `tsc -b` + `eslint` no NEW errors vs the pre-start baseline.

---

## 7. PHASE 1 — backend (single owner; files are disjoint from Phase 2)

All paths exist today unless marked NEW (verified 2026-10-05).

| # | File | Change |
|---|---|---|
| 1 | `shared/constants/supplier-return.constant.js` NEW; `shared/constants/index.js` | constants §1.1; export `SupplierReturnConstants` |
| 2 | `shared/constants/inventory.constant.js` | +2 `movementType` values |
| 3 | `shared/models/supplier-returns.schema.js` NEW; `shared/models/index.js` | schema §1.2–1.3; export `SupplierReturnModel` |
| 4 | `shared/utils/supplier-return.utils.js` NEW; `shared/utils/free-to-promise.utils.js` NEW; `shared/utils/index.js` | pure helpers §3; export `supplierReturnUtils`, `freeToPromiseUtils` |
| 5 | `shared/repositories/warehouse-batch.repository.js` | ADD `stockOutFromLot`, `restoreToLot` (no existing method edited) |
| 6 | `shared/repositories/warehouse-stock.repository.js` | ADD `decrementFreeToPromise` |
| 7 | `shared/repositories/stock-movement.repository.js` | ADD `receiptRowsForBill(…, session)` and `purchaseSuppliersBySkuBatch({warehouseId, sku}, session)` (both `movementType: "PURCHASE_IN"`) |
| 8 | `shared/repositories/supplier-return.repository.js` NEW; `shared/repositories/index.js` | `mintReturnId`, `fastForwardReturnIdCounter`, `isReturnIdDuplicate`, `isClientRequestIdDuplicate`, `create(doc, session)`, `findById`, `findByClientRequest` (primary), `list`+`stats`, `sumReturnedForBill`, `findLiveForBill`, `lotSupplierIds`, CAS updaters for §3.2–3.6 |
| 9 | `shared/utils/sku-identity.utils.js` | §3.8 |
| 10 | `admin/src/routes/supplier-return/router.js`, `validator.js`, `controller.js` NEW; `admin/src/routes/index.js` | §2, §3; mount |
| 11 | `admin/src/connections/mongo.js` | pre-create + `ensureIndexesFor` + CRITICAL check |
| 12 | `admin/__tests__/setup.js` | pre-create + `ensureIndexesFor` |
| 13 | `admin/src/routes/procurement/controller.js` | §3.7 guard only |
| 14 | `admin/__tests__/supplier-return-*.test.js` NEW (11 files, §6.1) | tests + mutant table |
| 15 | `haper-misc/test-supplier-return.md` NEW; `haper-misc/docs/reference/goods-flow.md`; `haper-misc/client-followups.md` | API-level steps (✅/❌), edge cases, deploy needed (admin API) |

Gate: full admin jest green; mutant table all red; §5 backend lines ticked; `git diff` shows no edits to
any existing function body other than §3.7/§3.8.

## 8. PHASE 2 — admin FE (single owner; starts after Phase 1 is on dev)

| # | File | Change |
|---|---|---|
| 1 | `src/types/supplierReturn.ts` NEW | DTO types from §2.2 |
| 2 | `src/api/supplierReturns.ts` NEW | A1–A10 clients (do NOT edit `api/inventory.ts`) |
| 3 | `src/utils/apiError.ts` | ADD `apiErrorReason(e)`, `apiErrorDetails(e)` (string-typed, like `categoryTaxonomy.ts`); existing exports unchanged |
| 4 | `src/pages/Warehouse/supplierReturn.ts` + `.test.ts` NEW | pure helpers §6.2 |
| 5 | `src/pages/Warehouse/SupplierReturnChip.tsx` NEW | chips per design §4 (labels: Credit pending · Part received ₹X · Credit received · Received · ₹X short · No credit expected · Cancelled) |
| 6 | `src/pages/Warehouse/SupplierReturnsPage.tsx` + `.test.tsx` NEW | design §6.1 |
| 7 | `src/pages/Warehouse/NewSupplierReturnModal.tsx` + `.test.tsx` NEW | design §6.2; lots from `/lots`; bill lines from `/bill-context`; sends `batchId`, `batchMode`, per-line reason |
| 8 | `src/pages/Warehouse/SupplierReturnDetailModal.tsx` NEW (contains CancelReturnModal) | design §6.3 with the deltas below |
| 9 | `src/pages/Warehouse/RecordRefundModal.tsx` NEW (replaces the design's MarkCreditModal) | design §6.4 with the deltas below |
| 10 | `src/pages/Warehouse/statusMeta.ts` | new exports only: `SUPPLIER_RETURN_REASONS`, `SUPPLIER_CREDIT_STATUSES`, `SUPPLIER_CREDIT_MODES` |
| 11 | `src/App.tsx` | route `/warehouse/supplier-returns` in the existing warehouse role-gated group |
| 12 | `src/hooks/useMenu.ts` + `useMenu.test.ts` | menu entry after Verify Bill (design §3) |
| 13 | `src/pages/Warehouse/LedgerPage.tsx` | `TYPES` += `RETURN_OUT`, `RETURN_IN`, `SUPPLIER_RETURN_OUT`, `SUPPLIER_RETURN_REVERSAL` |
| 14 | `haper-misc/test-supplier-return.md` | add UI steps |

Write gate in the UI: `canWrite = can.role('super_admin','warehouse_manager') && can(PERMISSIONS.WAREHOUSE.MANAGE)` — mirrors the server exactly.

**Design deltas (override `supplier-return-design.md`):**
1. Credit modal → **Record refund**: several refunds per return; amount prefilled with the REMAINING amount (expected − received); date blank + required; mode required, no default (Cash / Bank transfer / Credit note adjusted → `CASH`/`BANK`/`CREDIT_NOTE_ADJUSTED`); reference required for bank + credit note; "Close this return as settled" checkbox + note when short; "Supplier paid more than expected" checkbox + note when over. "Supplier won't give credit" stays as the second radio → A8 (hidden once any refund exists).
2. Detail credit block lists every refund (voided ones greyed, with who/when/why). Per-refund **Undo** = A7 with a required short reason (inline). **Reopen** (A9) shown for settled-short / not-expected.
3. **Cancel return** enabled whenever there is no active refund (also when "No credit expected"); disabled text: "To cancel, first undo the recorded refunds."
4. History is built from create/cancel stamps + `refunds[]` (recorded / voided) + `creditStatusAt`.
5. Every write sends `expectedRev`; `STALE` / `INVALID_STATE` → banner "This return was just updated by someone else. Showing the latest." + refetch.
6. Inline errors map by `reason` + `details.lineIndex` (fallback `details.sku`), never by message text or numeric `code`.
7. Lot list = `GET /lots`; hide `returnable: false`; label `supplierMatch: "UNKNOWN"` lots "supplier not recorded".
8. Bill hint "On bill INV-0042 this was ₹20.00 a unit" uses `billUnitCost`; lot auto-pick uses `batchNos`.

Gate: page/modals work on dev for manager + staff + store login; vitest/tsc/eslint as §6.2; double-click
sends one request; every reason in §2.3 reproduced inline.

Phase 3 (Verify Bill badge + Return button, Recall button, write-off hint, `listReceipts` additive fields)
stays as in `supplier-return.md` §6 Phase 3, with this (amended 2026-10-06) rule for the `listReceipts`
fields (already built): totals are per BILL (`supplierId` + normalised invoice), so they are put on the
bill's FIRST row of the page only; other rows of the same bill (individual view, or historic rows whose
invoice differs only in case in the aggregated view) carry `0/0/0`. A failure of the extra
`supplier-returns` read never fails the list (logged, all zeros).

---

## Known limitations / follow-ups (amended 2026-10-06 r2)
- A lot renamed via receipt correction (`newBatchNo`) is refused `LOT_NOT_ON_BILL` on its own bill. Workaround: record the return without picking the bill. Not fixed to keep `correctReceipt` / `WarehouseBatchRepository` untouched.
- Bill cap is per SKU, not per lot within a bill: a bill bringing two lots of one SKU caps their SUM, so more than one lot's billed qty can be taken from that lot (stock guards still apply). Follow-up.
- `WarehouseStockRepository.getBySku` (shared, many callers) re-wraps any driver error as a typed 400 with the raw text and drops its labels, so a transient error inside the create transaction is neither retried nor turned into `WRITE_FAILED`. Left as is (shared contract); follow-up.
- Verify Bill list return totals go on a bill's first row of the CURRENT page; a bill split across pages shows them once per page. Follow-up.
