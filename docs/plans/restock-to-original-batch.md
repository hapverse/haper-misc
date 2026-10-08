## Status

- 2026-10-08: phases A/B/C are built and tested. Under review. Uncommitted on `haper-backend` dev.
- Section 8 (no-averaging, batch-specific CP) is DESIGN ONLY. Not built. Awaiting user decisions U1-U6.
- Test guides updated: `test-inventory.md` (section 17), `test-order-edit-cost-snapshot.md`,
  `test-store-stockin-cost.md`, `test-bad-lot-cost-repair.md`.

# Restock to the original batch (design)

Status: DESIGN — ready to implement. Repo: `haper-backend` (paths below are under `packages/`).
Author: rajit (backend arch), 2026-10-08.

## 0. The bug in one line + corrections to the debug report

A cancelled order's unit goes back into the **LEGACY** lot at the item's **average** cost, and the lot
merge then re-averages that lot's cost. Example: LEGACY 4 units @ ₹45, lot B 30 @ ₹5, item average 9.71.
Cancel 1 unit that was sold from LEGACY @45 → LEGACY becomes (4×45 + 1×9.71)/5 = **37.94**.

- Blend site confirmed: `shared/repositories/item.repository.js:1291-1307` → `store-batch.repository.js:303-321` (merge at 308-316).
- **Wider than reported:** `stockIn` with no `batchNo` always targets LEGACY (`store-batch.repository.js:301`), so *every* batch-mode restock lands in LEGACY, even units sold from a named lot (AE-…, transfer lots).
- **Missed second path:** order edits return stock through `findOneAndUpdateAtomicQty` delta>0 (`item.repository.js:1646-1658`), same LEGACY-at-average blend. Called from `shared/utils/order-edit.utils.js:286,339`.
- `user/src/routes/order/controller.js:1353` is **not** the user cancel. It is the "Razorpay order-create failed" rollback. The user self-cancel is `:2535`.
- The LEGACY lot doc is built at `store-batch.repository.js:131-143`. Line 112 is `resolveSeedCosts`.
- Lot statuses are only `AVAILABLE | HOLD | RECALL` (`shared/constants/inventory.constant.js:143-147`). EXPIRED and QUARANTINED do not exist.
- App code never deletes store lots. A drained lot stays at `qtyRemaining: 0` (`stockOutFEFO` only `$inc`s, `:375-379`). Product delete refuses when lots exist (`admin/src/routes/product/controller.js:182`). So "lot missing" is a defensive case; the normal case is putting units back into a 0-qty lot.
- After the fix, the HP532016285 item's average becomes **10.71** (= (5×45 + 30×5)/35), not 9.71. That is correct: a ₹45 unit came back.

## 1. Caller matrix (every order-driven restock)

| # | Site | Trigger | Session | Idempotency guard today |
|---|------|---------|---------|-------------------------|
| 1 | `user/src/routes/order/controller.js:1353` | placeOrder: Razorpay order-create failed | txn | `stockRestored` set in same txn `:1404` |
| 2 | `user/src/routes/order/controller.js:1945` | scheduled booking twin of #1 | txn | `:1976` |
| 3 | `user/src/routes/order/controller.js:2535` | user self-cancel (OPEN) | txn, **Promise.all** | filtered write `:2513-2530` |
| 4 | `shared/utils/unpaid-order-release.utils.js:55` | cron (`cron/src/jobs/payment-initiated-orders.js:14`), supersede (`user/.../order/controller.js:983`), user cancel of unpaid (`:2462`) | txn | filtered write `:88`. **`:53` drops `batchAllocations`** |
| 5 | `user/src/routes/razorpay/controller.js:284` | `payment.failed` webhook | txn for restock only | **`stockRestored` written OUTSIDE the txn (`:299-303`)**. A crash in between lets a replay restock twice |
| 6 | `admin/src/routes/order/controller.js:1140` | admin → ADMIN_CANCELED / UN_DELIVERED / REFUND_SUCCESS (`:904`) | txn, **Promise.all** | status transition + `:1121` |
| 7 | `delivery/src/routes/order/controller.js:304` | rider UN_DELIVERED | **no session** (deliberate, `:217-222`) | status-filtered claim `:282-290` |
| 8 | `shared/utils/order-edit.utils.js:286` (reduce), `:339` (remove) | admin edit (`admin/.../order/controller.js:648`, restock=true); picker OOS (`picking/src/routes/task/controller.js:383,587`, restock=false) | txn | edit write itself |

These do not restock: `picking/.../task/controller.js:117` (sets the flag only), `admin/src/routes/order/reopen.service.js:183` (re-deducts stock and resets the flag at `:207`). `admin/src/routes/order/helper.js:64 atomicAdjustStock` is imported at `admin/.../order/controller.js:136` but never used.

## 2. Decision

**One shared function routes every order restock.** It returns each sale allocation to its own lot with an
atomic `$inc`. It **never writes `costPrice` on an existing lot**. Anything without an allocation goes to a
per-order restock lot costed at the line's sale-time snapshot.

Rejected options:
- *Fix `stockIn`'s merge.* Receipts genuinely need the weighted merge, so this would change goods-receipt behaviour.
- *Reuse `applyStockIn` with batchNo.* It still re-averages on cost drift, bumps `qtyReceived` and does a read-modify-write. The transfer code does this today (`admin/src/routes/transfer/controller.js:59,279`), and it is the same flaw.
- *Proportional split across lots.* Units are whole numbers, so a proportional split would need fractional units.

### 2.1 Target behaviour (batch-ON store)
For each order line and a quantity `q` (default `line.quantity`):

1. **Plan** with `planLineRestock(line.batchAllocations, q)`, a pure function. Walk the allocations **from last to first**, taking `min(remaining, alloc.qty)` from each. Skip any allocation with qty ≤ 0 or a blank batchNo. Output:
   - `toLots[]`: `{batchNo, qty, costPrice, expiresAt}`
   - `remainder` = q − Σ toLots. It is > 0 when the line was increased by an edit or a reopen, or for pre-batch lines.
   - `allocationsLeft`: the allocations reduced by what was taken, with zero entries dropped.

   The walk is deterministic, so total returned can never exceed `q`. If Σ allocations > `line.quantity` (a stale trail from an edit made before this fix), only `q` is returned.
2. **Each `toLots` entry** goes through `StoreBatchRepository.returnToLot` as **one** `updateOne({itemId, batchNo}, {$inc:{qtyRemaining}, $setOnInsert:{…}}, {upsert:true, session})`:
   - **Lot exists** (any qty, including 0): only `qtyRemaining` changes. `costPrice`, `expiresAt`, `status` and `qtyReceived` stay as they are. The returned units take the **lot's stored cost**, which is what the brief asks for.
   - **Lot missing:** it is created from the allocation:
     - `costPrice` = `round2(alloc.costPrice)`, or `round2(item.costPrice)` when the allocation cost is ≤ 0 (same rule as `transfer/controller.js:237`)
     - `expiresAt` = `alloc.expiresAt`
     - `status` AVAILABLE, `source` RESTOCK
     - `qtyReceived` = qty
     - storeId / iId / barcode taken from the item

     Upsert and the unique `(itemId, batchNo)` index (`store-batches.schema.js:59`) make a create race safe.
   - **HOLD / RECALL lot:** the units are returned into it and the status is kept, so they stay unsellable and outside `items.quantity`. A recalled unit coming back must not become sellable. → **Open decision D1.**
   - Expired-but-AVAILABLE lot: units return to it. FEFO has no expiry floor (an existing gap). Out of scope.
3. **Remainder** goes to a fallback lot `RST-<order.orderId || order._id>` via the same `returnToLot`:
   - On insert, `costPrice` = `round2(line.costPrice)` if > 0, else `round2(item.costPrice)`.
   - On insert, `expiresAt` = `item.expiresAt` (the earliest open expiry, which is conservative).
   - A second restock for the same order and item only `$inc`s, so it can never re-average.
   - Why the line snapshot: inventory value going back in equals the COGS that went out (₹ conserved). Using LEGACY is rejected because it is the blend this fix removes.
4. Run `recomputeItemRollup(itemId, session)` (`:261-275`) **once per line**, then `triggerInventoryEvaluation`. That is the existing qty-weighted 2dp rule, reused unchanged.

**Batch-OFF store** (decided per item by `resolveBatchMode`, `item.repository.js:168-178`): plain `$inc items.quantity` by `q`, exactly as today (`:1311-1318`). The flag-off path never touched `costPrice`, so it has no blend to fix. `allocationsLeft` is still computed. If a line was sold with batches ON and the store is now OFF, the allocations are ignored and stock goes back as plain quantity.

### 2.2 Partial quantities (edit reduce / remove, picker OOS)
`applyItemEdit` calls `restockOrderLine({order, line, qty: removed, session, move: restock && moveStock})` and stores the returned `allocationsLeft` into `costSnapshotByItem[key].batchAllocations`, so it is persisted in the same order write as the quantity change.

- `move:false` (picker OOS, or an already-restored unpaid order) trims the trail without moving stock. The unit is lost from the shelf, so Σ allocations stays equal to quantity.
- `line.costPrice` is **not** re-derived. The sale snapshot stays frozen (§3).
- `refunds[]`, `refundedAmount` and `hasPartialRefund` (`order-edit.utils.js:561`) are **money only**. Restock quantity comes from line quantity, never from `refunds[].items`. A cancel refund lists full items even after partial edits (`admin/.../order/controller.js:1101-1105`).
- Duplicate lines for one itemId: `consolidateItems` keeps only the first line's trail (`order-edit.utils.js:250`). **Concatenate** the trails instead, otherwise the second line's lots are lost.

### 2.3 Idempotency and concurrency
- The order-level `stockRestored` claim (already written in the same filtered or transactional write at #1, 2, 3, 4, 6, 7) remains the guard against restocking twice. For edits, the trimmed `batchAllocations` written in the edit's own txn acts as the per-line marker. **No new field.**
- **Fix #5:** move the order write into the restock txn as `updateWithOpsFiltered({_id, stockRestored:{$ne:true}}, …)`. If nothing matches, throw to abort. Today a crash between `:298` and `:299` lets a webhook replay restock twice.
- Transactions are already standard here (`withTransaction` + `readPreference:"primary"`). `returnToLot` is a single atomic `$inc` upsert, so it cannot lose an update. That is strictly safer than `stockIn`'s read-then-`$set` merge (`:303-321`, a known lost-update hazard), which **stays untouched** for receipts.
- `restockOrderLines` runs lines **sequentially**. It replaces the `Promise.all` at #3 and #6, because parallel operations on one transaction session are unsafe and two lines for the same item (paid line + gift line) would race the roll-up.
- #7 keeps `session:null`, as today: each `$inc` is atomic, but the per-item roll-up is not transactional with it. Same exposure as now. To keep delivery's `matchedCount` check (`:312`), return `{matchedCount}`.

### 2.4 Cost integrity
- `orders.items[].costPrice` and the line's sale trail are **never** changed by a restock. Profit and COGS read that snapshot. Edit trims touch `batchAllocations` only.
- Existing lot `costPrice` is never written. New lots are 2dp-rounded at write. `items.costPrice` comes only from `recomputeItemRollup`.
- Known accepted gap: if a lot's cost was corrected after the sale, the returned unit takes the corrected lot cost, so inventory value differs from reversed COGS by (lotCost − allocCost) × qty. → **D3.**

## 3. API shape
```
// shared/utils/batch.utils.js (pure)
planLineRestock(allocations, qty) -> { toLots, remainder, allocationsLeft }
restockBatchNo(orderRef) -> `RST-${orderRef}`
// shared/repositories/store-batch.repository.js
returnToLot(itemId, { batchNo, qty, costPrice, expiresAt, storeId, iId, barcode }, session=null) -> { created }  // no roll-up
// shared/repositories/item.repository.js
restockOrderLine({ order, line, qty=line.quantity, move=true, session=null }) -> { matchedCount, restocked, allocationsLeft }
restockOrderLines({ order, lines=order.items, session=null }) -> [{ itemId, matchedCount, restocked, allocationsLeft }]   // sequential
```
As built (phase A, 2026-10-08):
- The "allocation cost ≤ 0 → item cost" fallback lives in `restockOrderLine`; `returnToLot` only rounds the cost it is given.
- `restocked` = units actually moved (0 for `move:false`, `q=0` or no itemId; those no-ops also report `matchedCount: 0`). Delivery (#7) should flag "item not found" only when `restocked > 0 && matchedCount === 0`.
- `restockOrderLine` does not wrap errors in `errorUtils`, so a `TransientTransactionError` keeps its label and `withTransaction` can retry.
- `planLineRestock` accepts hydrated mongoose subdocs (`toObject()`); `allocationsLeft` drops every entry with qty ≤ 0 and keeps blank-batchNo entries with qty > 0.
Callers pass the order and its full lines (with `batchAllocations`). #4 must pass `fresh.items`, not the `:53` projection. #1 and #2 pass `orderItems` / `orderItemsForRestock`, which already carry allocations from `sellFEFO` (`user/.../order/controller.js:292`, gift `shared/utils/gift.utils.js:263`). `incrementQuantity` stays exported, but after the change no order path calls it. Migration: **none**. No schema change; existing orders already carry the trail and older lines use the fallback.

**Phase B (same PR if capacity allows; it closes the trail-drift sources):**
- `order-edit.utils.js:283,305`: increase or add via `ItemRepository.sellFEFO` and append its allocations to the line trail. Today these discard which lots were taken (see the KNOWN LIMITATION at `:349-360`).
- `reopen.service.js:183`: use `sellFEFO` and `$set items.<i>.batchAllocations` in the reopen write at `:198`.

Without Phase B, a cancel after a reopen returns units to the *first* sale's lots. Lot costs still stay intact, but which lot gets each unit can be wrong. → **D2.**

## 4. Files to change (disjoint by engineer)
- **A (do first):**
  - `shared/utils/batch.utils.js`
  - `shared/repositories/store-batch.repository.js`
  - `shared/repositories/item.repository.js`
  - new `admin/__tests__/restock-to-original-lot.test.js`
- **B (after A):**
  - `shared/utils/unpaid-order-release.utils.js`
  - `user/src/routes/order/controller.js` (#1, #2, #3)
  - `user/src/routes/razorpay/controller.js` (#5 + flag inside the txn)
- **C (after A):**
  - `shared/utils/order-edit.utils.js`
  - `admin/src/routes/order/controller.js` (#6)
  - `delivery/src/routes/order/controller.js` (#7)
  - Phase B: `admin/src/routes/order/reopen.service.js`
- Docs: `haper-misc/test-inventory.md` (restock section) and `test-order-edit-cost-snapshot.md`.

## 5. Failing-first tests
Run from each package dir: `PATH=/opt/homebrew/opt/node@24/bin:$PATH NODE_ENV=test npx jest <file>`. In-memory replica set only. Reuse `enableBatches`, `seedBatch` and `withTxn` from `admin/__tests__/store-batch-ledger.test.js:28-60`. Fictional store "Tulsi Mart", items "Moonbeam Biscuits" etc.

1. **cancel returns the unit to its sold lot at the lot cost (HP-style).**
   - Setup: LEGACY 4 @45 (exp E1), LOT-B 30 @5. Item qty 34, cost 9.71. Line `{qty:1, costPrice:45, batchAllocations:[{batchNo:'LEGACY',qty:1,costPrice:45,expiresAt:E1}]}`.
   - Assert: LEGACY qtyRemaining 5 **costPrice 45**, qtyReceived unchanged. LOT-B 30 @5 untouched. Item qty 35, **costPrice 10.71**. Line costPrice is still 45. No RST lot.
   - Current code gives 37.94 → test is red.
2. **unit sold from a named lot does not touch LEGACY.** Allocation from `AE-20270101` @12. LEGACY is unchanged and AE gets +1 at its own cost.
3. **multi-allocation line.**
   - Setup: A 2 @10 (Jan), B 5 @20 (Mar). Sell 4 (allocations A2, B2).
   - Assert after cancel: A 2 @10, B 5 @20, item 7 @17.14.
4. **drained lot (qty 0) is refilled, not recreated.** One doc per (item, batchNo) and the cost is unchanged.
5. **missing lot is recreated.** Delete the lot doc in the fixture. Then: a lot with batchNo, cost, expiry from the allocation, source RESTOCK, qty 1. Allocation cost 0 → uses item cost.
6. **HOLD lot.** The returned unit stays in HOLD. `items.quantity` does not include it.
7. **no-allocation fallback.**
   - Batch-ON, line costPrice 8, `[]`, LEGACY 4 @45 present.
   - Assert: LEGACY untouched, `RST-<orderId>` 1 @8, roll-up recomputed.
   - Second restock for the same order with a different cost: only `$inc`, cost stays 8.
8. **partial trail.** Line qty 3, allocations [A1]. A +1, RST +2.
9. **stale over-trail.** Line qty 2, allocations sum 4. Exactly 2 returned, taken from the end.
10. **edit reduce.**
    - Line qty 4, [A2 @10, B2 @20], line cost 15. Admin edits to 1.
    - Assert: B +2, A +1, persisted trail `[A1@10]`, line costPrice still 15.
    - Then cancel: A +1. Total returned 4.
11. **picker OOS** (restock:false). No lot moves, trail trimmed.
12. **flag-OFF store.** `items.quantity` +q, costPrice unchanged, no lot created.
13. **idempotency.**
    - User cancel twice → LEGACY +1 once.
    - `payment.failed` delivered twice → restock once.
    - #5 crash: stub the order write to throw → no stock moved (the txn aborted).
14. **concurrency.** Two `returnToLot` calls in parallel on one lot → qtyRemaining +2 (no lost update).
15. **gift line.** The gift's allocation goes back to its own lot.
16. **caller smoke tests**, one per site #1–#8, in the existing files:
    - `user/__tests__/order-gateway-failure-rollback.test.js`, `order-cancel-reason.test.js`, `order-cancel-unpaid-release-fixes.test.js`, `order-supersede-unpaid.test.js`, `razorpay-payment-failed-retry.test.js`
    - `cron/__tests__/payment-initiated-orders.test.js`
    - `admin/__tests__/order-undelivered-refund-handoff.test.js`, `order-edit-unpaid-status.test.js`
    - `delivery/__tests__/order.test.js`

    Each asserts that the sold lot cost is unchanged and the qty is returned.
17. **planner unit tests** (pure): q=0, empty trail, blank batchNo → remainder, reverse order.

## 6. Risks for the reviewer
- Every `$inc` must use `qtyRemaining`, never `$set`. `returnToLot` must never `$set` costPrice outside `$setOnInsert`.
- #4 passing the `:53` projection silently drops the trail, and every unpaid release would fall back to RST lots. Test 16 must catch this.
- #6 and #3 lose their `Promise.all`. Check latency on large orders (sequential, but only a handful of lines).
- RST lot count grows by about one per pre-batch or edited order line. These are bounded and visible in the admin batch list.
- `seedPass` resync (`store-batch.repository.js:150-231`) only touches LEGACY and runs only while the flag is OFF, so it does not interact with RST lots.

## 7. Out of scope (separate small follow-ups)
- The ₹45 LEGACY cost typo for the Haper Mart item: a data correction, done by the user.
- `admin/src/routes/items/controller.js:595-601`: `costPrice` (`:598`) and `quantity` (`:596`) are directly editable on items. In batch mode that bypasses the lot chokepoint. Add a cost > MRP warning and audit, and block these edits for batch stores.
- Same blend in non-order inflows: `findOneAndUpdateAtomicQty` delta>0 for transfer remainder and manual adjust (`admin/src/routes/transfer/controller.js:75,79,294`, `admin/src/routes/items/controller.js:951`), and the `setAbsoluteQuantity` top-up (`store-batch.repository.js:407-420`).
- Transfer cancel/receive via `applyStockIn` re-averages on cost drift (`transfer/controller.js:59,279`).
- FEFO has no expiry floor, so expired AVAILABLE lots get sold first.
- Admin manual-session cancel (#6) has no retry on WriteConflict. This already exists today.

## Open decisions (user)
- **D1:** Units returned to a HOLD/RECALL lot stay quarantined. Recommended: yes.
- **D2:** Ship Phase B (edit-increase and reopen record their lots) in the same change. Recommended: yes. `line.costPrice` stays frozen (recommended).
- **D3:** When a lot's cost changed after the sale, the returned unit takes the lot's current cost (as the brief asks), not the sale cost. Recommended: accept.

## 8. No-averaging addendum (batch-specific CP)

Requirement: "cp should not be averaged. it should be batch specific." Example: B1 = 100 @ ₹11 and B3 = 100 @ ₹12 must stay two lots at 11 and 12.
Scope: batch-ON stores. All paths below are under `packages/` unless they start with `scripts/`.
Line numbers in `store-batch.repository.js` and `item.repository.js` are pre-A and shift while Engineer A edits; anchor on the function names.

**Supersedes in §0–§7:**
- §2 "Rejected: fix `stockIn`'s merge": that merge is now exactly what we fix.
- §2.1 step 4 and §2.4: the roll-up keeps its single chokepoint, but its cost rule changes (8.B).
- §2.3, last bullet: `stockIn` stops doing a read-then-`$set`.
- §0, last bullet, and the §5 test numbers: these change (8.F).
- §7, bullets 2–4: now in scope (8.D, 8.E).
- D3 is nearly moot, because a store lot's cost can no longer change after it is created.

### 8.A Lot identity: a lot is the pair (batch number, cost)
**Decision.** A receipt only merges into a lot with an equal cost. Equal means `round2(a) === round2(b)`; costs are rounded to 2dp (paise) before the write.
When the cost differs, the units go into a **cost-named sibling lot** `<base>@<cost.toFixed(2)>`. Example: `B1` holds 100 @ 11; a receipt of 50 @ 12 creates `B1@12.00`; a later receipt @ 12 merges into `B1@12.00`.
The name is a pure function of the inputs: no counter, no sequence, no new field.

Pure helpers in `shared/utils/batch.utils.js`:
- `baseBatchNo(bn)` removes a trailing `@\d+\.\d{2}`, so a transferred `B1@12.00` resolves against `B1`.
- `lotNoForCost(base, c)`
- `pickTargetLot(family, {base, cost})`. Its rule:
  - The base lot is absent → create the base lot.
  - The incoming cost is ≤ 0 (unknown), or it equals the base lot's cost → merge into the base. The base lot keeps its known cost, which is today's "a 0 never drags" rule.
  - Otherwise → use `base@c`. Merge into it if it exists, else create it.
  - A base lot at cost 0 that receives cost 12 also goes to `base@12.00`. A lot's cost is never rewritten.

**`stockIn` changes** (`store-batch.repository.js` `stockIn`):
- Read the two candidate docs: `{itemId, batchNo:{$in:[base, base@c]}}`.
- Then do one `updateOne(..., {$inc:{qtyRemaining:q, qtyReceived:q}, $setOnInsert:{…, costPrice:c}}, {upsert:true, session})`. When creating with c > 0, `costPrice:c` is also in the filter.
- Then set the earliest expiry with a guarded `$set` (filter on expiry null or later). Same rule as today.
- Two concurrent receipts at different costs can then never blend. The loser gets a WriteConflict and `withTransaction` retries it. Outside a transaction, it retries once on E11000 and is then re-resolved to the sibling lot.
- Share one private `$inc`-upsert helper with Engineer A's `returnToLot` (DRY). `stockIn` stops doing a read-then-`$set`, which also closes the lost-update hazard noted in §2.3.
- New `stockInLot(...)` returns `{item, batchNo}` (the batch number actually written). `stockIn` returns `.item`, exactly as today.
- Same pair in `item.repository.js`: new `applyStockInLot`; `applyStockIn` wraps it. No caller's return shape changes.

**Rejected alternatives:**
- Rejecting the receipt. A mid-lot supplier price change is legitimate, so this would block receiving goods.
- A unique index on `(itemId, batchNo, costPrice)`. This is a one-way index change, and every `{itemId, batchNo}` single-doc read or write becomes ambiguous: `setBatchStatus`, `returnToLot`, `pickLot` in the repair script.

**Readers of `batchNo`:**
- FEFO sorts by expiry and receivedAt, not by name, so it is unaffected.
- Order `batchAllocations` record the real lot name, and §2's `returnToLot` upserts by that exact name, so restock composes for free.
- Unique index `store-batches.schema.js:59`: unchanged.
- Recall trace (`findByBatchNo`, used by `procurement/controller.js:929`) must return the **family**: `{$or:[{batchNo:X},{batchNo:{$regex:'^'+esc(X)+'@\\d+\\.\\d{2}$'}}]}`. The anchored regex uses the `batchNo` index. → **U6**.
- `sourceTransferId`, `supplierId`: set on insert only, as today.
- Stock ledger: callers must record the lot name actually written:
  - `items/controller.js:983` (manual stock-in)
  - transfer receive `transfer/controller.js:127`
- Admin batch list (`warehouse/controller.js:601`) shows names as stored.

**Auto-batch features (d091126 warehouse goods receipt, 967b72c store manual stock-in):** `autoBatchNo` itself is unchanged. It only supplies the base name, so `AR-20261008` with a second cost becomes `AR-20261008@6.00`. Update the doc comments at `batch.utils.js:13-18,24`: the merge is no longer weighted-avg, and the name can now exceed 12 chars.

### 8.B What `items.costPrice` means now
**Decision:** the cost of the **head lot**, i.e. the first open lot in FEFO order (`fefoCompare`) with cost > 0. Skipping 0-cost lots stops a cost-unknown lot from switching off the margin guard.
- When there are no open lots, the last known cost is kept, as today (`:266`).
- `expiresAt` = min open expiry, as today. This equals the head lot's expiry whenever the head lot has one.
- Move `fefoCompare` into `batch.utils.js` as `headLotRollup(openLots)` (pure). Both `recomputeItemRollup` (`:261`) and the repair-script mirror use it. → **U2**.

| Consumer of `items.costPrice` | Verdict |
|---|---|
| Margin guard. Preview: `getCostPriceMap`, user `home`/`item`/`cart` controllers, `discount.utils.js:659-704`. Checkout: `user/.../order/controller.js:287` `marginCostPrice`, `discount.utils.js:852`. Also POS `pos/coupon.js:51` and the below-cost preview `discount-rule/controller.js:168-244`. | **Fine.** Preview and checkout keep the same basis. Accepted risk: an order spanning a lot boundary can sell the units from the next lot at up to (next lot cost − head lot cost) under cost. |
| Sale-time fallback cost when the store is batch-OFF: `user/.../order/controller.js:275`, `gift.utils.js:261`, `pos/controller.js:312`, `order-edit.utils.js:319` | Fine. Only reached when sellFEFO returns a null cost (batch-OFF), where the number is the batch-OFF average. |
| Cost for units with no known origin: `setAbsoluteQuantity` top-up, §2 RST fallback, returned lot with cost 0 | Fine. "Next-to-sell" cost is the honest guess. |
| **Valuation:** `item.repository.js:502` (`getAdminCatalogSummary`) and `:852` (`getTotalStockValue`), and admin `ItemsList.tsx:800` (cost × qty per row) | **Wrong under head-lot.** For batch-ON stores, sum over open lots: Σ `qtyRemaining × lot cost` via one `$lookup` on `store-batches` `{itemId, status, …}`, switched by `$in:["$storeId", batchStoreIds]`. Add a nullable `stockValue` to the admin item-list rows; FE uses `stockValue ?? costPrice*quantity`. Add `stockValue` to `redactCostPrice.js:28`. Do **not** add it to `items`, because customer projections exclude fields rather than whitelist them, so the cost would leak. |
| Admin item display (`ItemModal`, `ItemDetailsModal:158`, `warehouse/controller.js:533`) | Fine. Label it "Cost (next batch)". |
| Profit, COGS, `order.repository.js:2905`, `profit-snapshot` | Unaffected: they read the order-line snapshot. |
| Transfer return from a batch-OFF store (`transfer/controller.js:148`) | Fine (batch-OFF average). |

Replenishment, cart-limit, shelf labels and the Android/web/iOS apps never read `costPrice` (it is stripped from customer projections).

### 8.C Batch-OFF stores
Only one cost number exists per item, so averaging is the only rule that keeps total ₹ value correct.
- **Leave `weightedCostStockInPipeline` (`item.repository.js:184`) as is.** Document it in the schema comment.
- Batch mode is decided per item via `resolveBatchMode` (`:167`) → `isStoreBatchEnabled` → `stores.config.batchesEnabled` (cached for 5s). It is not inferred from data.

### 8.D Other averaging and blending sites
| Site | Action |
|---|---|
| `store-batch.repository.js:303-321` `stockIn` merge | Fixed (8.A). |
| `:261-275` `recomputeItemRollup` | Head lot (8.B). |
| `setAbsoluteQuantity` top-up; `item.repository.js` `findOneAndUpdateAtomicQty` with delta > 0 (transfer remainder `transfer/controller.js:75,79,294`); `incrementQuantity` | No caller change. They go through `stockIn`, which no longer blends: LEGACY when the cost is equal, else `LEGACY@c`. (`items/controller.js:951` is adjust-**down** only.) |
| `transfer/controller.js:59` receive via `applyStockIn` | Fixed by 8.A. Switch to `applyStockInLot` so the ledger records the real lot. |
| `transfer/controller.js:270-292` `cancelReturnToStore` | Use `returnToLot` + roll-up. These are the same units going back, so `qtyReceived` must not grow. |
| `item.repository.js` `sellFEFO` line cost = Σ(qty·cost)/qty | Leave. This is the order line's COGS, not a stored lot cost; the per-lot costs stay in `batchAllocations`. |
| `:60-87` `receivedTransferCosts`; `:189-196` seed `knownCost` | Leave. Seeding only runs while the flag is OFF, where `items.costPrice` is the batch-OFF truth. |
| `transfer/controller.js:1161` shortfall ₹ | Leave (report only). |
| `scripts/migrations/store-batches-stale-and-cost.core.js:38-52` `computeRollup` mirror (also used by `bad-lot-cost.core.js:5`) | Import `headLotRollup`; otherwise the plans fight the live roll-up. `--sync-seed-cost` (`:247-251`) compares a lot cost with the item cost and becomes meaningless under head-lot: keep it off by default. |
| `warehouse-batch.repository.js:96-113` merge, `:50-66` roll-up, `returnToBatch` `:299` | → **U3**. Transfers copy warehouse lot costs into store lots, so a warehouse blend leaks into store lots. |

### 8.E Item-form cost edits plus the cost guard
- **Batch-ON, `items/controller.js:595-601`:**
  - `costPrice` equal to the stored value → strip it, as `quantity` is stripped at `:640-645`.
  - Changed → `400 COST_IS_PER_BATCH` ("Cost comes from batches; receive stock at the new cost").
  - FE: `ItemModal.tsx:656` disables the field for batch stores, with hint "Cost comes from batches". → **U4**.
- **Guard** (item create, batch-OFF item edit, manual stock-in cost `:964`), computed **before** the write:
  - cost > MRP (`price`) → `400 COST_ABOVE_MRP`.
  - sellingPrice < cost ≤ MRP → `409 COST_ABOVE_PRICE` unless `confirmCostAbovePrice: true`. A confirmed save writes an audit row via `auditUtils.logAtomic(req, {action:"item.cost_above_price", metadata:{itemId, name, costPrice, sellingPrice, price}}, session)`. Use `auditUtils.log` where there is no transaction.
  - Item ids go in `metadata`, because the strict `target` sub-schema only has admin fields and would drop them.
  - Item create matters because opening stock seeds LEGACY at the item cost (`item.repository.js:673`), which is how ₹45 got in.
  - FE copy (one line, reuses the BelowCostConfirm pattern): "Cost ₹22 is above selling price ₹20. Save anyway?" → **U5**.

### 8.F Composition with §2–§5 and sequencing
`restock-to-original-lot.test.js` assertions that change once head-lot lands (E1 < E2; ties go to the earlier lot):
- `:199` 9.71 → **45**
- `:213` 10.71 → **45**
- `:242` 17.14 → **10**
- `:254` 18.33 → **10**
- `:312` 37.6 → **45**
- `:415` 15 → **10**
- Unchanged: `:301` 10, `:279` 20, `:324` 15, `:439` 9.5 (batch-OFF).

Also changing:
- `store-batch-ledger.test.js:127-138` and `:140-151` (merge → two lots)
- `:400-414` (ledger becomes `[code1, code1@14.00, code2]`)

| Order | Engineer | Files (disjoint) |
|---|---|---|
| 1 (running) | A | §4 list |
| 2 (parallel) | B, C | §4 lists (no hot files) |
| 2 (parallel with B/C, after A) | **N1 core** | `shared/utils/batch.utils.js`, `shared/repositories/store-batch.repository.js`, `shared/repositories/item.repository.js`, `shared/models/store-batches.schema.js` (comment), `admin/__tests__/store-batch-ledger.test.js`, `admin/__tests__/restock-to-original-lot.test.js`, new `admin/__tests__/store-batch-no-averaging.test.js` |
| 3 (after N1) | **N2 admin** | `admin/src/routes/items/controller.js`, `items/validator.js`, `admin/src/routes/transfer/controller.js`, `admin/src/middleware/redactCostPrice.js`, new `admin/__tests__/item-cost-guard.test.js`, transfer tests |
| 3 (after N1) | **N3 scripts** | `scripts/migrations/store-batches-stale-and-cost.core.js`, `bad-lot-cost.core.js`, `admin/__tests__/repair-*.test.js` |
| 4 (if U3) | **N4 warehouse** | `shared/repositories/warehouse-batch.repository.js`, `admin/src/routes/procurement/controller.js` (`:461-521` record the resolved lot; receipt lookups `:1017,:1059` key on it), `admin/src/routes/supplier-return/controller.js:172-173` (compare `baseBatchNo`), `admin/__tests__/warehouse-batch-ledger.test.js` (`:132,:145,:278-307`) |
| 4 | FE | haper-admin `ItemModal.tsx`, `ItemsList.tsx`, `ItemDetailsModal.tsx`; `haper-misc/client-followups.md` |
| 4 | Docs | `haper-misc/test-inventory.md`, auto-batch guides |

### 8.G Failing-first tests (`store-batch-no-averaging.test.js` unless noted; Tulsi Mart, Moonbeam Biscuits)
1. **User example.**
   - Setup: receive B1 100 @ 11 (exp Jan), B3 100 @ 12 (exp Mar).
   - Assert: two lots, 11 and 12. Item 200 @ **11**. Store value **2300** (not 2200).
   - Sell 150 → allocations [B1 100 @ 11, B3 50 @ 12], COGS 1700. Item 50 @ **12**.
2. **Same batchNo, different cost.** LOT1 10 @ 40 then 10 @ 60 → `LOT1` 10 @ 40 and `LOT1@60.00` 10 @ 60. Item 20 @ 40. A third receipt @ 60 → `LOT1@60.00` 20; still 2 docs.
3. **Same batchNo, same cost.** 10 @ 40 + 5 @ 40.001 → one lot, 15 @ 40, `qtyReceived` 15.
4. **Rounding.** 60 @ 7.30 + 40 @ 7.32 → two lots, 7.3 and 7.32. Item 7.3. Replaces ledger `:140`.
5. **Zero cost.**
   - Base 10 @ 40, then +5 @ 0 → 15 @ 40, no sibling.
   - Base 5 @ 0, then +10 @ 40 → `LOT1@40.00` created, base untouched. Item cost **40** (first lot with cost > 0).
6. **Head lot and out of stock.** SOON 10 @ 40 (d2), LATER 10 @ 50 (d60), NOEXP 10 @ 60.
   - Item cost 40 → sell 10 → 50 → sell 10 → 60 → sell 10 → qty 0, cost **60** kept.
   - HOLD head lot 100 @ 10 (d1) + OK 5 @ 40 → item 40.
7. **Roll-up consistency.** After every step of tests 1–6: `reconcileStore` drifted = [], and item cost = `headLotRollup(open)`.
8. **Blank batch twice the same day** (store manual stock-in endpoint, no expiry). 12 @ 5 then 8 @ 6 → `AR-<today>` 12 @ 5 and `AR-<today>@6.00` 8 @ 6. Ledger `[AR-x, AR-x@6.00]`. With an expiry: ledger test `:400` → code1 30 @ 10, `code1@14.00` 20 @ 14, code2 5 @ 30.
9. **Transfer in at a different cost.** Store W1 10 @ 11; receive alloc W1 5 @ 12 → W1 10 @ 11 and `W1@12.00` 5 @ 12, item 11. Return-direction cancel → `returnToLot`: `qtyReceived` unchanged.
10. **Race.** Two parallel `withTxn` stockIns on an absent LOT1, at 11 and at 12 → 2 docs, costs {11, 12}, none at 11.5.
11. **Recall family.** `findByBatchNo('LOT1')` → LOT1 and `LOT1@60.00`, not `LOT10`.
12. **Margin guard.** Lots 100 @ 11 / 100 @ 12, selling price 12, 10% off rule → price stays ≥ 11 (clamped). Preview and checkout agree.
13. **Cost guard** (`item-cost-guard.test.js`).
    - Batch-ON, cost changed → 400. Cost unchanged → 200 and the name edit is saved.
    - Batch-OFF, cost 45, SP 20, MRP 25 → 400.
    - Cost 22 → 409. Cost 22 + confirm → 200 and 1 audit row.
14. **Regressions.**
    - Batch-OFF `applyStockIn` 10 @ 40 + 10 @ 60 → item 20 @ **50** (unchanged).
    - Flag-off auto-batch test (`ledger :428`) unchanged.
    - Warehouse `AE`/`AR` tests unchanged unless U3.

**Migration and back-compat.**
- No schema change and no data migration. Existing blended lots keep their stored cost; fixing a wrong lot uses `repair-bad-lot-cost`, run by the user.
- Each item's `costPrice` switches to head-lot at its next stock movement. An optional user-run roll-up refresh makes this uniform.
- Response shapes: unchanged. Only additive: a nullable admin-only `stockValue` and new 400/409 codes. Lot names gain an `@cost` suffix only in new data.
- Android, iOS and web never see lots or cost.

### 8.H User decisions
- **U1 (lot identity):** different cost under the same batch number → a cost-named sibling lot `B1@12.00`. Recommended. Alternatives: reject, or merge (today).
- **U2 (item cost meaning):** head-lot cost (the next batch to sell, skipping cost-0 lots). Recommended. Alternative: the highest open-lot cost (safest margin guard, but blocks more discounts).
- **U3 (warehouse):** apply the same no-averaging to warehouse lots as N4. Recommended **yes**, shipped last.
- **U4 (item-form cost, batch-ON):** reject a changed value, strip an unchanged one; FE disables the field. Recommended.
- **U5 (guard):** cost > MRP → hard reject; cost > selling price → confirm + audit. Recommended.
- **U6 (recall):** the trace lists the whole family; HOLD/RECALL stays per lot. Recommended. Alternative: a recall on the base name cascades to its sibling lots.
