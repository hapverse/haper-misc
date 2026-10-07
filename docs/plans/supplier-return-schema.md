# Supplier Return — data model sign-off (aabha-dba)

Reviews `supplier-return.md` §4 against the real code (2026-10-05). No database was touched;
everything below is from reading `haper-backend/packages/shared` and `admin/src`.
Installed: mongoose 8.4.1, mongodb driver 6.6.2.

**Verdict:** the plan's shape is right (one new collection, embedded lines, claim-first
idempotency). Six changes are required before Phase 1 task 2 — listed in §1. The credit part of
§4.1 (`credit` block + `creditHistory`) is replaced by the `refunds[]` design in §3.

---

## 1. Required changes to the plan (blocking)

1. **Register the model in FOUR places, not two.** The plan lists the two arrays in
   `admin/src/connections/mongo.js`. `admin/__tests__/setup.js` holds a second, separately
   hard-coded copy of both lists (pre-create array AND its own `ensureIndexesFor([...])`).
   Skip it and the tests either fail on first transactional insert or pass without the
   unique index that IS the idempotency guarantee.
2. **Tell the two E11000s apart.** Inside create, a duplicate key can come from
   `clientRequestId` (a replay) OR from `returnId` (counter drift, see A5). The plan treats
   "E11000" as a replay; a `returnId` collision would then look up a doc that does not exist and
   500. Branch on `err.keyPattern`: `clientRequestId` → replay path; `returnId` → fast-forward the
   counter and retry once.
3. **Scope the idempotency key to the actor**: unique `{ createdBy: 1, clientRequestId: 1 }`, not
   `{ clientRequestId: 1 }` alone. The key is made by the browser; a global key lets admin B's
   request replay admin A's return (and return A's document to B). Replay lookup uses both fields.
4. **Batch mode must send `batchId`, and the server must resolve the lot by `_id`.** The
   `warehouse-batches` unique `(warehouseId, sku, batchNo)` index is declared in the schema but the
   model is NOT in any `ensureIndexesFor` list, so on dev/prod it exists only if someone built it
   by hand (cannot verify — no DB access). If duplicates exist, `findOne` by `batchNo` picks one
   at random. Resolve by `_id`, then assert `warehouseId`, `sku`, `batchNo` match (else
   `LOT_NOT_FOUND`).
5. **Do not add the new update to `migrateWarehouseSku`'s `Promise.all`.** That function runs three
   `updateMany` calls in parallel on one transaction session; the Node driver documents parallel
   operations inside a transaction as unsupported. Add the `supplier-returns` update as a separate,
   awaited statement after it (A4).
6. **Cancel needs one more condition**: no live refunds (`receivedAmount === 0`). With partial
   refunds allowed while `creditStatus = PENDING`, the plan's "cancel only while PENDING" would let
   a return be cancelled after money arrived. Cancel also moves `creditStatus` to `NOT_EXPECTED`
   (§3.4) so a cancelled return can never show up in a "credit pending" total.

---

## 2. Collection `supplier-returns` — final schema

```js
// shared/models/supplier-returns.schema.js
const lineSchema = new mongoose.Schema({
    sku:               { type: String, required: true, trim: true },
    name:              { type: String, default: "" },
    iId:               { type: String, default: "" },
    batchId:           { type: ObjectId, ref: "warehouse-batches", default: null }, // null when batchMode false
    batchNo:           { type: String, default: "" },
    lotStatusAtReturn: { type: String, enum: ["AVAILABLE", "HOLD", "RECALL", null], default: null },
    expiresAt:         { type: Date, default: null },
    qty:               { type: Number, required: true, min: 1, validate: Number.isInteger },
    lotCostPrice:      { type: Number, default: 0, min: 0 },
    creditUnitPrice:   { type: Number, default: 0, min: 0, max: 100000 },
    lineCredit:        { type: Number, default: 0, min: 0 },
}); // keeps _id (FE row key)

const refundSchema = new mongoose.Schema({
    amount:     { type: Number, required: true, min: 0.01, max: 10000000 }, // rupees, round2 at write
    receivedAt: { type: Date, required: true },        // business date the money moved (as stated)
    mode:       { type: String, enum: ["CASH", "BANK", "CREDIT_NOTE_ADJUSTED"], required: true },
    reference:  { type: String, default: null, trim: true, maxlength: 100 }, // credit-note no. / UTR
    note:       { type: String, default: "", maxlength: 500 },
    recordedBy: { type: ObjectId, ref: "admins", required: true },
    recordedAt: { type: Date, required: true },        // server clock
    undone:     { type: Boolean, default: false },
    undoneBy:   { type: ObjectId, ref: "admins", default: null },
    undoneAt:   { type: Date, default: null },
    undoReason: { type: String, default: null, maxlength: 500 },
}); // keeps _id = refundId (the undo target)

const schema = new mongoose.Schema({
    returnId:        { type: String, required: true },          // "SR000007"; unique via schema.index below
    clientRequestId: { type: String, required: true },          // browser UUID
    requestHash:     { type: String, required: true },
    warehouseId:     { type: ObjectId, ref: "warehouses", required: true },
    supplierId:      { type: ObjectId, ref: "suppliers", required: true },
    invoiceNumber:   { type: String, default: null },           // normalizeInvoiceNumber(); null = not bill-linked
    reason:          { type: String, enum: REASONS, required: true },
    note:            { type: String, default: "" },
    batchMode:       { type: Boolean, required: true },
    status:          { type: String, enum: ["RETURNED", "CANCELLED"], default: "RETURNED", required: true },
    lines:           { type: [lineSchema], validate: (v) => v.length >= 1 && v.length <= 100 },
    totalUnits:           { type: Number, default: 0 },
    expectedCreditAmount: { type: Number, default: 0, min: 0 },  // fixed at create

    // ---- credit (replaces plan's `credit` + `creditHistory`) ----
    creditStatus:   { type: String, enum: ["PENDING", "RECEIVED", "NOT_EXPECTED"], default: "PENDING", required: true },
    refunds:        { type: [refundSchema], default: [] },       // append-only, max 20 entries incl. undone
    receivedAmount: { type: Number, default: 0, min: 0 },        // CACHE = round2(Σ amount of refunds where !undone)
    creditNote:          { type: String, default: null },        // why NOT_EXPECTED / why settled short / cancel text
    creditStatusBy:      { type: ObjectId, ref: "admins", default: null },
    creditStatusAt:      { type: Date, default: null },
    rev:            { type: Number, default: 0, min: 0 },        // bumped by EVERY post-create user write (CAS key)

    createdBy:    { type: ObjectId, ref: "admins", required: true },
    cancelledBy:  { type: ObjectId, ref: "admins", default: null },
    cancelledAt:  { type: Date, default: null },
    cancelReason: { type: String, default: null },
}, { timestamps: true, versionKey: false });
```

Notes:
- `shortfall` is NOT stored. It is `round2(expectedCreditAmount - receivedAmount)` in the response
  mapper (positive = still owed, negative = supplier credited more). `expectedCreditAmount` never
  changes after create, so this cannot drift.
- `receivedAmount` IS stored, as a declared cache, because the list tiles `$sum` it. It is never
  `$inc`-ed (float drift: 0.1 + 0.2). Every refund write recomputes it from `refunds[]` in one shared
  pure function (`foldReceived(refunds)`) and `$set`s it under the `rev` check (§3.3). The array is
  the truth; a test asserts `receivedAmount === foldReceived(refunds)` after every operation.
- `mode` vocabulary deliberately differs from `receipt-payments.mode` (`CASH | ONLINE | OWNER`):
  different fact, different record. FE must not share one label map between them.
- `version`-style CAS field is called `rev` (Mongoose's own `versionKey` stays off, matching every
  other schema here).
- No change to `warehouse-batches`, `warehouse-stocks`, `stock-movements`, `receipt-payments`,
  `sequences`. New collection starts empty — no migration, no backfill.

---

## 3. Refunds — rules, validation, concurrent-safe updates

### 3.1 Plain-words model
A **refund** here = one payment from the supplier for a return. Example: return SR000007 expects
Rs 216. Supplier gives a Rs 150 credit note on Monday (refund #1) and Rs 66 cash on Friday
(refund #2). `receivedAmount` = 216, shortfall = 0, `creditStatus` = RECEIVED.

### 3.2 State rules (one pure function `nextCreditState`, unit-tested)

| Action (endpoint) | Allowed when | Result |
|---|---|---|
| Record refund `POST /:id/refunds` | `status RETURNED`, `creditStatus` PENDING or RECEIVED, < 20 entries | push entry; recompute `receivedAmount`; `creditStatus = RECEIVED` if `settle === true` OR `receivedAmount >= expectedCreditAmount`, else unchanged |
| Undo refund `POST /:id/refunds/:refundId/undo` | entry exists and `undone false`; `status RETURNED` | mark entry undone (never delete); recompute; `creditStatus = RECEIVED` if still `receivedAmount >= expected && receivedAmount > 0`, else `PENDING` |
| Mark not expected `POST /:id/credit/not-expected` | `creditStatus PENDING`, `receivedAmount === 0` | `NOT_EXPECTED`, `creditNote` required |
| Reopen `POST /:id/credit/reopen` (= plan's "undo") | `status RETURNED`, `creditStatus` RECEIVED or NOT_EXPECTED | `PENDING`; refunds untouched |
| Cancel `POST /:id/cancel` | `status RETURNED`, `creditStatus PENDING`, `receivedAmount === 0` | `CANCELLED`, `creditStatus NOT_EXPECTED`, `creditNote = "Return cancelled: <reason>"`; reopen refused afterwards |

`settle: true` = "close this even though it's short" (Q5's simple version). Settling short
requires `note`. FE default: ticked when the typed amount is the whole remaining amount.

Invariants (asserted by `assertCreditInvariants(doc)` before every write, and in tests):
- `NOT_EXPECTED` ⇒ `receivedAmount === 0`
- `CANCELLED` ⇒ `receivedAmount === 0` and `creditStatus === NOT_EXPECTED`
- `receivedAmount === foldReceived(refunds)`
- `refunds.length <= 20`

### 3.3 Validation (validator.js, then server-side recompute)
- `amount`: number, finite, `> 0`, `<= 10,000,000`, `round2` before storing. More than expected is
  allowed (GST-inclusive credit, Q10) — FE warns, server does not block.
- `receivedAt`: required ISO date; not later than today (IST, same day-boundary helper the
  `paidAt` path uses); no lower bound (supplier can pre-credit).
- `mode`: required, one of the three. `reference`: optional, trimmed, max 100. `note` max 500.
- `undoReason`: required, 1..500.
- `expectedRev`: required integer on EVERY post-create write (refund, undo, not-expected, reopen,
  cancel).

### 3.4 Concurrency — compare-and-set on `rev`
Every post-create write runs inside `session.withTransaction(..., { readPreference: "primary" })`
together with `auditUtils.logAtomic` (money record), and inside the callback:

1. Read the doc in-session (primary). If `doc.rev !== expectedRev` → 409 `STALE` with the current
   doc (the FE refreshes). Doing this read INSIDE the callback matters: `withTransaction` re-runs
   the callback on a transient error, and the retry must see fresh data.
2. Compute the new `refunds` entry / `receivedAmount` / `creditStatus` in JS; run
   `assertCreditInvariants`.
3. Conditional write — the filter repeats the expected state, so a racer always loses cleanly:

```js
// record refund
findOneAndUpdate(
  { _id, rev: expectedRev, status: "RETURNED", creditStatus: { $in: ["PENDING", "RECEIVED"] } },
  { $push: { refunds: entry }, $set: { receivedAmount, creditStatus, creditStatusBy, creditStatusAt, creditNote }, $inc: { rev: 1 } },
  { new: true, session })

// undo refund
findOneAndUpdate(
  { _id, rev: expectedRev, status: "RETURNED", refunds: { $elemMatch: { _id: refundId, undone: false } } },
  { $set: { "refunds.$[r].undone": true, "refunds.$[r].undoneBy": by, "refunds.$[r].undoneAt": now,
            "refunds.$[r].undoReason": reason, receivedAmount, creditStatus }, $inc: { rev: 1 } },
  { arrayFilters: [{ "r._id": refundId }], new: true, session })
```
   `null` result → 409 `STALE`. Never use `modifiedCount` as the signal (timestamps make it
   always 1).

Why the client sends `expectedRev`: it makes a double-click or a network retry of "Record refund"
safe. Both clicks carry the same `rev`; the first wins, the second gets 409 and the FE shows the
refreshed doc with the one refund. Without it, two clicks = two refunds (Rs 432 for a Rs 216 return).

### 3.5 Read side
- List summary: `receivedAmount`, `shortfall` (mapper), `liveRefundCount`. Detail: full
  `refunds[]` incl. undone (greyed in UI).
- Tiles (not narrowed by `creditStatus` filter): `pendingAmount = Σ max(0, expected − received)`
  over `creditStatus PENDING`; `receivedAmount = Σ receivedAmount` over `status RETURNED`.
  Because cancel forces `NOT_EXPECTED` and `receivedAmount 0`, no extra `status` filter is
  needed for correctness.

---

## 4. Index list (A1)

Volume: tens of returns/month/warehouse → under 1,000 docs/year total. Every list query is
an in-memory sort at this size; only correctness indexes really matter.

| Index | Keep? | Correctness-critical? |
|---|---|---|
| `{ returnId: 1 }` unique | yes | yes (human id) |
| `{ createdBy: 1, clientRequestId: 1 }` unique | yes — REPLACES `{ clientRequestId: 1 }` | **yes** (idempotency) |
| `{ warehouseId: 1, createdAt: -1 }` | yes | no (list) |
| `{ warehouseId: 1, supplierId: 1, invoiceNumber: 1 }` | yes — used inside the create txn (bill cap), `correctReceiptSupplier` guard, Phase 3 join | no |
| `{ "lines.sku": 1 }` | yes — keeps the barcode-rename `updateMany` inside its transaction from scanning | no |
| `{ warehouseId: 1, creditStatus: 1, createdAt: -1 }` | **drop** — redundant at this volume; tiles/filters run fine off the warehouse prefix | — |

No index on `refunds.*` (nothing queries by refund). Declare uniques via `schema.index(...,
{ unique: true })`, not field-level `unique: true`, so names are stable for the boot check.

Registration (all four):
1. `shared/models/index.js` → `SupplierReturnModel`.
2. `admin/src/connections/mongo.js` pre-create array (written inside transactions).
3. `admin/src/connections/mongo.js` `ensureIndexesFor([...])`.
4. `admin/__tests__/setup.js` — both its pre-create array and its `ensureIndexesFor` list.

Boot visibility check (copy the referral one, log CRITICAL, never exit):
```js
constant.SupplierReturnConstants.indexSpecs = [
  { name: "returnId_1", key: { returnId: 1 }, unique: true },
  { name: "createdBy_1_clientRequestId_1", key: { createdBy: 1, clientRequestId: 1 }, unique: true },
];
```

---

## 5. Answers A2–A5

**A2 — embedded `lines` (max 100): yes, embedded.** Lines are written once at create, read only
with their return, and only bulk-touched by the sku rename. Size: ~350 B/line × 100 + 20 refunds
× ~300 B ≈ 41 KB worst case, far under 16 MB. A line collection would add a second write target
to every transaction for no query benefit. The length check lives in the schema validator — it
runs on the claim insert; the later snapshot `$set` (`lines.<i>.lotCostPrice` etc.) does not
re-run validators, so build those paths from the server's own line index only.

**A3 — race-proof bill cap: already free, no counter document needed.** Every return line for a
sku writes that sku's `warehouse-stocks` row in the same transaction (batch mode:
`recomputeRollup` → `findOneAndUpdate` with `$set` + auto `updatedAt`, always a real write; flag
off: `decrementFreeToPromise`). Two concurrent returns against the same bill + sku therefore write
the same document; MongoDB aborts the later one with a WriteConflict, `withTransaction` re-runs it
on a fresh snapshot, and its "already returned" sum now includes the first return. The cap is hard
as long as (a) the sum is read inside the transaction (it is, step 2) and (b) every line still
writes its `warehouse-stocks` row. Pin (b) with a deterministic two-session repository test
(session A reads the sum and pauses; session B commits a return; A's write must fail with
WriteConflict) plus a one-line comment at the cap read. A counter doc would be a second copy of
"returned qty" that cancel and sku rename would also have to maintain — more drift surface for
nothing.

Two cap caveats for Q3 (not blockers):
- `findReceiptRowsByInvoice` reads `PURCHASE_IN` only. `RECEIPT_CORRECTION` rows carry
  `refLabel "Receipt correction"`, no invoice and no supplier, so a downward receipt correction
  does NOT lower "billed" — the cap is on the bill's gross qty. The lot guard still stops any
  physical over-return.
- That lookup runs before the transaction on the `secondaryPreferred` connection, so a bill
  received seconds ago may read as missing (`SKU_NOT_ON_BILL`). Use `.read("primary")` for it.

**A4 — `arrayFilters` rename inside the barcode transaction: fine, with two conditions.**
```js
await SupplierReturnModel.updateMany(
  { "lines.sku": from },
  { $set: { "lines.$[l].sku": to } },
  { arrayFilters: [{ "l.sku": from }], session });
```
- Run it as its own awaited statement after the existing `Promise.all`, not inside it (§1.5). The
  existing three-way `Promise.all` on one session is a pre-existing risk (follow-up, not this
  feature).
- It must not bump `rev` (a rename is not a user edit, and would 409 a manager mid-refund for no
  reason). `updatedAt` will change; nothing should sort or filter returns on `updatedAt`.
- New key in the returned object (`supplierReturns`) is additive; its only caller
  (`admin/src/routes/product/controller.js` L476) reads named keys for a log line and the audit
  metadata. Cancel restores by `lines.batchId`, so a renamed sku never affects which lot gets
  stock back.
- Product delete is already safe: every return writes `SUPPLIER_RETURN_OUT` ledger rows, and
  `findBlockingHistory` refuses to delete a product with stock movements.

**A5 — counter fast-forward: yes, from day one.** Copy the transfer hook (its
`Sequence.findByIdAndUpdate` runs WITHOUT the session, which is good: the counter commits outside
the transaction, so the `sequences` doc never becomes a write-conflict hot spot; aborted
transactions just leave gaps). Add, at admin boot after `ensureIndexesFor`:
```js
const last = await SupplierReturnModel.findOne({}, { returnId: 1 }).sort({ returnId: -1 }).read("primary").lean();
const n = last ? parseInt(last.returnId.slice(2), 10) : 0;
await SequenceModel.updateOne({ _id: "supplierReturnId" }, { $max: { seq: n } }, { upsert: true })
  .catch((e) => { if (e.code !== 11000) throw e; });
```
`$max` never moves the counter backwards, so it is safe on every boot and from several admin
processes at once. Plus the runtime retry from §1.2 (on a `returnId` E11000: fast-forward, retry
once). The string sort is correct while ids stay 6 digits (`SR999999`); unreachable at this volume.

---

## 6. Failure analysis (what degrades under load)

At this volume nothing is load-bound. The real failure modes are silent ones: (1) the unique
indexes not building (secondaryPreferred makes `init()` a no-op) — then a double-click deducts
stock twice; mitigated by the four registrations + boot spec check. (2) A refund recorded twice by
a retry — mitigated by client-sent `expectedRev`. (3) Someone "optimises" `recomputeRollup` to skip
unchanged writes — the bill cap quietly goes soft; mitigated by the two-session test. The only
contention point is the per-sku `warehouse-stocks` row shared with dispatch/replenishment, which
already serialises today; a return adds one more short transaction to it.

## 7. Pre-existing, not in scope (follow-ups)
- `warehouse-batches`, `warehouse-stocks`, `stock-transfers`, `stock-movements` are not in any
  `ensureIndexesFor` list; their unique keys exist on dev/prod only if built by hand. Worth a
  read-only `db.<coll>.getIndexes()` check by the user on dev.
- `migrateWarehouseSku` runs parallel ops on one transaction session.
