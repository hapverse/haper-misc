# Goods flow — how physical stock moves through Haper

Verified against code on dev (2026-10-05). Where this disagrees with older docs, **the code wins** (see "Stale docs" at the end).
All backend paths are under `/Users/office/Documents/haper/haper-backend/packages/` (short form below: `admin/`, `shared/`, `user/`, `picking/`, `delivery/`, `cron/`). Admin UI paths are under `/Users/office/Documents/haper/haper-admin/src/`.

Plain-words glossary
- **SKU** = the product barcode. It is the identity used at the warehouse (`warehouse-stocks.sku`) and to match a store item (`items.barcode`).
- **Batch (lot)** = one delivery of a product with its own expiry + cost. Example: 100 milk packs expiring 1 Sep at Rs 20, and 50 expiring 15 Sep at Rs 22 are two batches.
- **FEFO** = first-expiry-first-out: always sell/ship the lot that expires soonest.
- **Ledger** = an append-only history of every stock change (`stock-movements`), like a bank statement.
- **Batch flag** = `warehouse.batchesEnabled` / `store.config.batchesEnabled` (both default `false`). Off = old single-number stock; On = lots + FEFO. Every stock function branches on it.

---

## 1. Overview diagram

```
 SUPPLIER
    |  (bill / invoice)
    v
 [A] GOODS RECEIPT  POST /admin/procurement/receive   (warehouse staff/manager/super)
    |   writes: warehouse_batches (lot) -> warehouse-stocks (total) -> stock-movements PURCHASE_IN
    |   side effect: selling price / MRP fan-out to every store the warehouse serves
    |   later:  correct receipt | change supplier | mark bill PAID | write-off | recall (HOLD/RECALL)
    v
 WAREHOUSE STOCK  (availableQty, reservedQty, inTransitQty)
    |
    |  store (or cron "auto-replenishment", hourly) raises a REPLENISHMENT REQUEST  (PENDING)
    |  warehouse approves -> reservedQty += n   (APPROVED / PARTIALLY_APPROVED)   [or REJECTED / EXPIRED after 7d]
    |  "fulfill" -> draft TRANSFER (CREATED)
    v
 [B] TRANSFER warehouse -> store
    |   DISPATCH : warehouse lots taken FEFO, lots stamped on the line, reserved -> inTransit   (TRANSFER_OUT)
    |   RECEIVE  : store scans barcode, store_batches created per lot (real cost+expiry)         (TRANSFER_IN)
    v
 STORE STOCK  items.quantity = sum of open store_batches   (costPrice = weighted avg, expiresAt = earliest)
    |  ^  manual Stock-In / adjust-down (PATCH /admin/items/:id/quantity)
    |  |  POS counter sale (admin) -> FEFO
    |  |
    |  +--[D] STORE RETURN  store -> warehouse (CREATED / PENDING_APPROVAL if >50 units) --> warehouse RECEIVE (RETURN_IN)
    v
 [C] CUSTOMER ORDER  POST /order/place (user svc)
    |   stock is taken AT PLACEMENT (FEFO), per-lot cost stamped on each order line (batchAllocations, costPrice)
    v
 PICKING (picker app)  PICKING -> PACKED       short pick / out-of-stock => line reduced + refund, shelf set to 0
    v
 ASSIGNED -> OUT_FOR_DELIVERY -> CLOSED          rider marks UN_DELIVERED => stock restocked
    v
 cancel / payment-fail / admin cancel / refund => RESTOCK (merged into a RESTOCK/LEGACY lot at current item cost)
    v
 PROFIT: reads orders.items.costPrice (sale-time snapshot), never live item cost
```

Statuses at a glance
- Replenishment: `PENDING -> APPROVED | PARTIALLY_APPROVED | REJECTED | CANCELLED`, then `FULFILLED` (on transfer receive) or `EXPIRED` (cron, 7 days undispatched). `shared/constants/inventory.constant.js`
- Transfer: `PENDING_APPROVAL (returns only) -> CREATED -> DISPATCHED -> RECEIVED`, or `CANCELLED`.
- Batch: `AVAILABLE | HOLD | RECALL` (HOLD/RECALL are excluded from totals and FEFO).
- Order (numeric codes): `OPEN 0, PAYMENT_INITIATED 6, PICKING 18, PACKED 19, ASSIGNED 10, OUT_FOR_DELIVERY 11, CLOSED 1, UN_DELIVERED 12, CANCELED 2, ADMIN_CANCELED 17, REFUND_SUCCESS 16` (`shared/constants/order.constant.js`).

---

## 2. Core building blocks (reuse these, do not write new stock code)

| Piece | File | Job |
|---|---|---|
| Store batch repo | `shared/repositories/store-batch.repository.js` | THE chokepoint for store stock: `stockIn` (create/merge by batchNo, weighted-avg cost, earliest expiry), `stockOutFEFO` (needs a DB session, refuses without), `recomputeItemRollup`, `setAbsoluteQuantity`, `setBatchStatus`, `reconcileStore`, flag gate `isStoreBatchEnabled` (cached ~5s) |
| Warehouse batch repo | `shared/repositories/warehouse-batch.repository.js` | Same for warehouse: `stockIn`, `stockOutFEFO`, `recomputeRollup` (writes `warehouse-stocks`), `correctReceipt`, `returnToBatch`, `setBatchStatus`, `reconcileWarehouse`, `isWarehouseBatchEnabled` |
| Item repo mutators | `shared/repositories/item.repository.js` | Flag-aware wrappers callers use: `sellFEFO` (sale + per-lot cost), `decrementIfAvailable`, `incrementQuantity` (generic restock), `findOneAndUpdateAtomicQty` (+/- delta), `applyStockIn` (explicit lot), `updateQuantity` (absolute set, picker OOS), `updatePricingByBarcode` |
| Warehouse stock repo | `shared/repositories/warehouse-stock.repository.js` | Flat path + buckets: `receive`, `decrementIfAvailable`, `increment`, `reserve`, `releaseReserved`, `markDispatched`, `releaseInTransit`, `correctReceiptLegacy` |
| Ledger writer | `shared/utils/stock-ledger.utils.js` (`recordStore`, `recordWarehouse`) -> `shared/models/stock-movements.schema.js` | one row per change: type, signed qty, balanceAfter, batchNo, ref, actor |
| Batch naming | `shared/utils/batch.utils.js` | `autoBatchNo` -> `AE-YYYYMMDD` (by expiry) or `AR-YYYYMMDD` (by receive date, no expiry); `returnBatchNo` -> `RETURN-TR000051` |
| Scoping | `admin/src/middleware/inventory-context.js` | `resolveWarehouseId/StoreId`, `assertWarehouseAccess/StoreAccess`, `applyListScope` |
| Permissions | `admin/src/middleware/permission.js`, `shared/constants/permission.constant.js` | see section 9 |

Rule: every quantity change goes through the item repo / batch repos inside a transaction. Never `$inc` `items.quantity` or `warehouse-stocks.availableQty` directly.

---

## 3. Stage A — Supplier -> warehouse goods receipt

**Trigger (admin UI):** Warehouses page -> Receive Goods (`pages/Warehouse/WarehousesPage.tsx`, routes `/receive-goods`, `/warehouses`); bill list = Verify Bill (`pages/Warehouse/VerifyBillPage.tsx`, `/warehouse/verify-bill`); suppliers = `pages/Warehouse/SuppliersPage.tsx`; lot corrections = `CorrectReceiptModal.tsx`, `ChangeSupplierModal.tsx`, `MarkAsPaidModal.tsx`, `RecallPage.tsx`.

**API:** `admin/src/routes/procurement/router.js` (all behind `requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_STAFF)`).

| Route | Permission (+ role) | What |
|---|---|---|
| `POST /admin/procurement/receive` (multipart, optional `bill` file) | `warehouse.receive_goods` | receive a bill |
| `GET /receive/lookup`, `GET /receive/last` | receive_goods | find a bill / "repeat last" for supplier |
| `GET /receipt/list` | receive_goods | Verify Bill list (grouped lines, payment badge) |
| `POST /receipt/correct` | `warehouse.manage` | fix qty (up/down), expiry, batch code, cost of a past lot |
| `PATCH /receipt/supplier` | `warehouse.manage` | fix the supplier of a past bill |
| `POST /receipt/mark-paid`, `/unmark-paid` | `warehouse.manage` AND role super/warehouse_manager | supplier payment flag |
| `GET /batch/:batchNo`, `PATCH /batch/status` | view_ledger / manage | recall trace; set HOLD/RECALL/AVAILABLE on warehouse or store lot |
| `POST /admin/warehouse/:id/stock/:sku/write-off` | `warehouse.manage` | remove damaged/expired/count-difference stock (reason DAMAGE/EXPIRY/COUNT/OTHER) |

Code: `admin/src/routes/procurement/controller.js` (`receive`, `correctReceipt`, `correctReceiptSupplier`, `markReceiptPaid`, `syncStorePricingFromReceipt`), `admin/src/routes/warehouse/controller.js` (`writeOff`).

**What `receive` does (one transaction, per line):**
1. Gates before any write: selling price is **manager/super only** (staff sending it = 403; whole bill rejected); for manager/super the selling price is **required only for a SKU the warehouse has never priced** (400 naming the item).
2. Duplicate bill check: same warehouse + supplier + invoice (normalised trim+UPPERCASE via `commonUtils.normalizeInvoiceNumber`) = 409 `DUPLICATE_INVOICE` unless `confirmDuplicate` (appending more lines to the same bill).
3. Batch-on warehouse: lot code = supplier's `batchNumber`, else **auto-named** (`AE-<expiry>` / `AR-<today>`; same expiry merges, different expiry = own lot). `WarehouseBatchRepository.stockIn` creates or merges the lot (weighted-average cost rounded to 2dp, earliest expiry kept) and `recomputeRollup` rewrites the `warehouse-stocks` total.
4. Batch-off warehouse: legacy `WarehouseStockRepository.receive` (single number; no lots).
5. Ledger row `PURCHASE_IN` with `refType goods_receipt`, `refId = receiptId` (one id per call), `refLabel = invoice`, `batchNo`, `supplierId`, `billUrl`, `mrp`, `costPrice`.
6. After commit (best effort, never fails the receipt): **pricing fan-out** — MRP/selling price from the bill is pushed to every ACTIVE item with the same barcode in every store this warehouse serves (`WarehouseRepository.resolveStoresServedBy` -> `ItemRepository.updatePricingByBarcode`). Result returned as `storePricingSync {stores, updated, skipped, failed, warnings}`. **Cost is never fanned out** (store cost only comes from transfer lots).

**Data written:** `warehouse_batches` (`warehouseId, sku, batchNo, qtyRemaining, qtyReceived, costPrice, expiresAt, status, source, supplierId`), `warehouse-stocks` (`availableQty, reservedQty, inTransitQty, costPrice, mrp, sellingPrice, expiresAt, lowQty, maxStock, reorderQty`), `stock-movements`, S3 bill file.

**Payment status:** `receipt-payments` (`shared/models/receipt-payments.schema.js`), keyed by bill `(warehouseId, supplierId, invoiceNumber)`. No row = NOT_PAID. Mark-paid sets PAID (+ optional `transactionId`, `paidAt`, `mode` CASH/ONLINE/OWNER, `paidBy`); un-mark flips back and never deletes. The unique index is what makes it idempotent and is force-built at boot (`mongoIndexUtils.ensureIndexesFor`; do not remove it from the service's mongo.js list).

**Receipt correction:** anchored on the lot `(warehouseId, sku, batchNo)`, not on one invoice line (a lot can pool several deliveries). Original `PURCHASE_IN` stays untouched; a quantity change writes one signed `RECEIPT_CORRECTION` row; field-only edits (cost/expiry/rename) write an audit entry only. Refused when new qty < units already consumed (`NEGATIVE`), would strand reserved units (`RESERVED`), or rename collides (`COLLISION`). Cost revalues prospectively (remaining units). Past ledger/COGS rows are not rewritten.

**Warehouse write-off / "stock count":** write-off goes FEFO (batch on) or flat decrement; reason COUNT writes `MANUAL_ADJUST`, others `DAMAGE`. There is **no in-app stock-count screen**. Count fixes so far were one-off scripts in `/Users/office/Documents/haper/haper-backend/scripts/migrations/fix-warehouse-stock-count-*.js` (guides: `haper-misc/test-warehouse-stock-count-fix*.md`).

**Gotchas**
- Warehouse stock can only go UP via receipt (or a correction) and DOWN via dispatch / write-off / correction. There is no "adjust up" other than receiving.
- Auto-batch is **per expiry day**, so a supplier delivering the same expiry on two different days merges into one lot (cost is blended).
- Fan-out reaches stores by `resolveServingWarehouse` (explicit `servingWarehouseId`, else oldest ACTIVE warehouse in the same `region`) — a store with neither gets nothing (counted `skipped`).
- Fan-out skips non-ACTIVE items and blank barcodes by design.

---

## 4. Stage B — Replenishment and warehouse -> store transfer

**Triggers**
- Store admin/manager: Replenishment page (`pages/Warehouse/ReplenishmentPage.tsx`, `/replenishment`).
- Cron `cron/src/jobs/auto-replenishment.js` (hourly :30): for every warehouse-enabled store drafts a PENDING request (`source AUTO`) for items at/below `lowQty` that have a barcode and no open request; qty = `reorderQty`, else top up to `maxStock`, else enough to clear `lowQty`. It never ships stock.
- Warehouse: Transfers page (`pages/Warehouse/TransfersPage.tsx`, `/transfers`), discrepancies (`TransferDiscrepanciesPage.tsx`), item lookup / stock health (`ItemLookupPage.tsx`, `StockHealthPage.tsx`).

**Replenishment API** (`admin/src/routes/replenishment/router.js` + `controller.js`)
- `POST /` create (permission `replenishment.request`; store resolved from the caller, warehouse via `resolveServingWarehouse`). `POST /:id/cancel` (only PENDING).
- `POST /:id/approve` (`warehouse.approve_replenishment`, warehouse roles): sets `approvedQty` per line, then **reserves** `warehouse-stocks.reservedQty += approved` in one transaction with the status change. Reserve only succeeds if `availableQty - reservedQty >= qty` (server-enforced free-to-promise; error names the item). Status APPROVED (all full) or PARTIALLY_APPROVED. `POST /:id/reject`.
- `POST /:id/fulfill` (`warehouse.manage_transfers`): creates the draft transfer (status CREATED) from approved lines (lines with no SKU are dropped) and links it. One transfer per request.
- Cron `cron/src/jobs/inventory-reservation-expiry.js` (3:45 AM IST): APPROVED/PARTIALLY_APPROVED with no dispatched transfer older than `RESERVATION_EXPIRY_DAYS` (default 7) -> release reserved, status EXPIRED, cancel any lingering CREATED transfer.

**Transfer API** (`admin/src/routes/transfer/router.js` + `controller.js`; model `shared/models/stock-transfers.schema.js`, id like `TR000051`)
| Step | Route | Gate | Stock effect |
|---|---|---|---|
| Create (forward) | `POST /admin/transfer` | role warehouse/super + `warehouse.manage_transfers` | none (draft holds no stock; no stock check) |
| Edit lines | `PATCH /:id/items` | warehouse roles, CREATED only | none |
| Dispatch | `POST /:id/dispatch` | warehouse roles (store admin allowed at router but 403 inside for forward) | warehouse: FEFO-take lots (`stockOutFEFO`, stamps `line.batchAllocations [{batchNo,qty,costPrice,expiresAt}]`) or flat decrement; ledger `TRANSFER_OUT`; `markDispatched` (reserved -> inTransit) |
| Receive | `POST /:id/receive` | `replenishment.receive_transfer` or `warehouse.manage_transfers`; actor must have access to the **store** | store item +qty per lot (`applyStockIn` with real cost/expiry/source TRANSFER); ledger `TRANSFER_IN`; `releaseInTransit`; linked replenishment -> FULFILLED |
| Cancel | `POST /:id/cancel` | dispatch/cancel roles | CREATED: nothing moves (reserved released by cancel path); DISPATCHED: lots returned to their own warehouse batches, inTransit released, ledger row; RECEIVED cannot be cancelled |

**Receive rules:** the receiver must scan a barcode matching the line SKU for every line received > 0 (API-enforced, validated up front so a mismatch moves no stock). Partial receive allowed: `receivedQty <= dispatched qty`; a partial qty is spread across lots in FEFO order. Short quantity is **shrinkage**: it is neither returned to the warehouse nor ledgered — it only shows in the discrepancy report (`GET /admin/transfer/discrepancies`).

**Pricing:** a transfer carries **cost + expiry only** (via lots), never selling price. Selling price/MRP reaches stores from the goods-receipt fan-out (Stage A), not from transfers.

**Bulk operations (one-off scripts, not app features):** `scripts/migrations/bulk-transfer-warehouse-to-bhagwan-bazar.js` (all warehouse stock to one store as one transfer, via real create/dispatch/receive), `bulk-receive-dispatched-transfers.js`, `bulk-return-bhagwan-bazar-to-warehouse.js`, `bulk-set-bhagwan-bazar-qty-20.js`. Guides: `haper-misc/test-bulk-*.md`. All dry-run by default, `--apply` to write.

**Gotchas**
- A transfer created directly (not from an approved request) has **no reservation**; dispatch then caps the reserved release at 0 and only raises inTransit. Over-commit is only blocked at dispatch (`Insufficient warehouse stock`), which aborts the whole transaction.
- Dispatch of a batch-on warehouse needs lots; legacy stock was seeded as a `LEGACY` lot (`seed-warehouse-batches.js`).
- Turn the **warehouse** batch flag on before store flags, otherwise store lots get no real cost/expiry.

---

## 5. Stage C — Store stock, batches, ledger

**Store stock** = `items` row per `(storeId, product)` with `quantity` (derived = sum of open `store_batches`), `costPrice` (weighted average of open lots), `expiresAt` (earliest open lot), `price` (MRP), `sellingPrice`, `lowQty/maxStock/reorderQty`. Batch-off stores just keep the number.

Ways stock enters/leaves a store:
| Event | Entry point | Ledger type |
|---|---|---|
| Transfer receive | transfer controller (Stage B) | `TRANSFER_IN` |
| Manual **Stock-In** (delta, optional batchNo/cost/expiry) | `PATCH /admin/items/:itemId/quantity`, permission `items.adjust_stock`, `admin/src/routes/items/controller.js#updateItemQuantity` | `MANUAL_ADJUST` (+) |
| **Adjust-down** (damage/correction; negative qty) | same endpoint | `MANUAL_ADJUST` (-) |
| POS counter sale | `POST /admin/pos/sale` (`admin/src/routes/pos/controller.js`, permission `orders.create_pos`; UI `pages/POS`) | `SALE` |
| Customer order | Stage D | **no ledger row** |
| Store return out | Stage F | `RETURN_OUT` |

Stock-In on a batch store with no batch number is auto-named (`AE-`/`AR-`) like the warehouse. Adjust-down is FEFO and rejected ("exceeds available stock") rather than going negative. New items with an opening quantity get an `INITIAL`-source lot (`ItemRepository.add`).

**FEFO** (`store-batch.repository.js`): sort by earliest `expiresAt`, lots with no expiry last, ties by `receivedAt` then `_id`. Each lot decrement is guarded (`qtyRemaining >= take`) so concurrent sales cannot oversell.

**Recall:** `PATCH /admin/procurement/batch/status` sets HOLD/RECALL; those lots drop out of quantity and FEFO. `GET /batch/:batchNo` lists warehouses and stores holding the lot.

**Integrity:** cron `inventory-batch-reconcile.js` (3:15 AM IST) checks `items.quantity == sum(open lots)` and `warehouse-stocks.availableQty == sum(open lots)` and alerts on drift. Stock alerts (red/low groups, daily digest) live in `inventory-evaluation-sweep` (every 15 min) and `inventory-daily-digest` (9 AM IST); design in `haper-docs/Inventory_Stock_Alerts.md`. Product-master reconcile `product-master-reconcile.js` (4 AM IST) re-syncs catalogue fields (not stock).

**Stock count:** no feature. A store "count" is done as manual Stock-In / adjust-down. The only warehouse count tooling is the one-off scripts in Stage A.

**Gotchas**
- Flag-off stores ignore batchNo/expiry on Stock-In (only cost blends into `items.costPrice`).
- Customer apps read only `items.quantity`; `expiresAt`/lots never reach them.
- Ledger is **not complete** for stores: online sales, restocks, picker OOS and write-offs are not ledgered (see Open gaps).

---

## 6. Stage D — Customer order placement (stock is taken immediately)

**Trigger:** customer apps (android/ios/web) -> `POST /order/place` (and a scheduled variant) in `user/src/routes/order/router.js` -> `controller.js#prepareOrderItemsAndInventory`.

For each cart line, inside the order transaction:
1. Reject unpriced items (no Rs 0 sale), then `ItemRepository.sellFEFO(itemId, qty, session)`.
2. Order line stores `itemId, iId, name, quantity, salePrice` (frozen), `costPrice` (real FEFO cost of the lots sold; item snapshot cost when batch off), `batchAllocations [{batchNo,qty,costPrice,expiresAt}]` (always emitted; `[]` when batch off). Schema: `shared/models/orders.schema.js`.
3. Any line short -> the whole checkout fails and names every offending item; the transaction rolls back earlier decrements.

Online-paid orders start `PAYMENT_INITIATED` and **already hold stock**. Stock comes back on payment failure/cancel/expiry (`shared/utils/unpaid-order-release.utils.js`, razorpay controller, order cancel) guarded by `orders.stockRestored` so it is never restored twice. COD orders go straight to `OPEN`.

POS sales (admin) use the same `sellFEFO` and stamp the same fields.

**Gotcha:** gifts / free items also reserve through `sellFEFO` (`shared/utils/gift.utils.js`).

---

## 7. Stage E — Picking, packing, delivery

**Pick task creation:** when an order reaches `OPEN` and `store.config.pickingEnabled` is true, `shared/utils/pick-task.utils.js#ensurePickTaskForOrder` creates a `pick-tasks` doc (one per order, unique `orderId`; reactivated on admin reopen). Scheduled orders get no task until released (`cron/src/jobs/scheduled-release.js`). `cron/src/jobs/pick-task-reconcile.js` (every minute) backfills missing tasks. Cancelled/failed orders cancel their task.

**Picker app** (`/Users/office/Documents/haper/haper-picker/app/src/main/java/com/hapverse/picker/ui/tasks/`, e.g. `PickerTaskDetailScreen.kt`, `OosReasonDialog.kt`) calls `picking/src/routes/task/router.js`:
`GET /queue`, `GET /my`, `GET /history`, `GET /:id`, `POST /:id/claim`, `POST /:id/line/:itemId/verify` (scan), `.../pick`, `.../oos`, `.../reset`, `POST /:id/complete`.

- **Pick (full qty):** only flips the line to PICKED. **No stock or money change** (stock was taken at placement). Items with a barcode need a scan, or a manual override with a reason.
- **Short pick** (`pickedQty < required`): order edit via `orderEditUtils.applyItemEdit` with `restock:false`: line reduced, prepaid -> wallet refund of the difference, COD -> total drops; customer-visible `adjustments[]`; then `ItemRepository.updateQuantity(itemId, 0)` — the shelf is declared empty. Audited as `order.line.short_pick`; push to customer + store admin.
- **Out of stock:** same, line removed; if it was the last line the order is cancelled (`cancelEmptiedOrder`, fees refunded, slot released).
- **Reset:** PICKED lines only. OOS cannot be undone (would need refund reversal + stock restore; not built).
- **Complete:** all lines must be resolved; order `PICKING -> PACKED` (or `CANCELED` if empty).

**Assign / deliver** (admin `admin/src/routes/order/controller.js` assign; rider app `/Users/office/Documents/haper/haper-delivery`, API `delivery/src/routes/order/router.js`): pick-enabled stores may assign only from `PACKED` (plus ASSIGNED/UN_DELIVERED/PROCESSING); other stores from `OPEN`. Rider: accept/reject, `PATCH /mark-status` -> `OUT_FOR_DELIVERY`, `CLOSED` (delivery OTP, 3-attempt lock) or `UN_DELIVERED`.

**Gotchas**
- Picker OOS/short pick sets quantity to 0 via `setAbsoluteQuantity` -> on batch stores this **depletes all open lots** (any real remaining units are written off silently) and writes no ledger row.
- A picker never sees lots/FEFO (design decision: guidance only, no hard scan gate).

---

## 8. Stage F — Returns

### F1. Customer-side "returns" (no post-delivery return feature exists)
Only these paths put order stock back on the shelf (`restockStatuses = ADMIN_CANCELED, UN_DELIVERED, REFUND_SUCCESS` in `admin/src/routes/order/controller.js`; `delivery/src/routes/order/controller.js` for the rider's UN_DELIVERED; user cancel and payment-failure paths in `user/src/routes/order/controller.js`, `user/src/routes/razorpay/controller.js`):
- customer cancel, payment failed/cancelled, admin cancel, rider UN_DELIVERED, admin REFUND_SUCCESS.
- Each restocks with `ItemRepository.incrementQuantity` and sets `stockRestored: true` in the same write.
- Admin **reopen** (`admin/src/routes/order/reopen.service.js`) re-decrements stock (`decrementIfAvailable`; aborts "insufficient stock"), claws back the refund, clears `stockRestored`.
- Order edits (admin/picker) move stock with `shared/utils/order-edit.utils.js` (`atomicAdjustStock`).

### F2. Store -> warehouse return (built and live in code)
**Trigger:** Transfers page -> "Return to warehouse" (`pages/Warehouse/ReturnToWarehouseModal.tsx`, `TransfersPage.tsx`, helpers `direction.ts`). Plan doc: `haper-misc/store-return-to-warehouse-plan.md` (now implemented; the plan text still says "no code until approved"). Walkthrough: `haper-misc/test-inventory.md` (Store Return section).

**API** (`admin/src/routes/transfer/router.js`)
- `POST /admin/transfer/return` — roles super_admin/store_admin + `replenishment.return_stock`. Body has no direction/warehouseId: direction forced `STORE_TO_WAREHOUSE`; warehouse = the store's `servingWarehouseId` (fails closed if unset/inactive; does NOT use the region fallback). Needs a reason (`shared/constants/return-reason.constant.js`: EXCESS, NEAR_EXPIRY, DAMAGED, WRONG_ITEM, OTHER).
- Approval rule: total units across this request + the store's other open returns in the last 24h **> 50** -> status `PENDING_APPROVAL`; else `CREATED`. Max 10 open (pending/created) returns per store. `POST /:id/approve` is super_admin only (`replenishment.approve_return`) -> CREATED. Cron `return-approval-expiry.js` (3:50 AM IST) auto-cancels PENDING_APPROVAL after 7 days (no stock effect).
- `POST /:id/dispatch` / `/cancel` — store admin (own store) dispatches; stock **leaves the store here**: `sellFEFO` on the store item, lots stamped on the line (non-batch store gets one synthetic `RETURN-<transferId>` lot), ledger `RETURN_OUT`. Warehouse reserved/inTransit buckets are NOT touched (return is inbound).
- `POST /:id/receive` — warehouse roles at the destination warehouse; barcode scan required; warehouse lots restored per allocation (`returnToBatch`, exact cost+expiry; zero-cost lots fall back to the warehouse's own cost) or flat increment; ledger `RETURN_IN`. Short receipts appear in `/discrepancies` (returns included; filter by `direction`).
- Cancel after dispatch puts stock back on the store (`cancelReturnToStore`, ledger `MANUAL_ADJUST`, reason `return_cancelled_restock`).
- Super admin can also create a return through `POST /admin/transfer` with `direction` (migration path).

**Gotchas**
- `store_admin` and `super_admin` bypass permission checks (implicit `*`): the **only real control is `requireRole`**. Never remove a role gate trusting the permission beside it (`admin/src/middleware/permission.js`).
- Transfers created before the `direction` field have none: always test "is a return" with `isReturnTransfer` (`shared/utils/transfer-direction.utils.js`), never `direction === WAREHOUSE_TO_STORE`, and remember `.lean()` skips schema defaults.
- Open transfers (incl. PENDING_APPROVAL returns) block a company-wide barcode change for their SKUs (`shared/utils/sku-identity.utils.js`).


### F3. Warehouse -> supplier return (Return to Supplier)
**API** `admin/src/routes/supplier-return/` (`/admin/supplier-returns`). Reads: warehouse roles + super (`warehouse.view_ledger` or `warehouse.manage`); writes: warehouse manager / super + `warehouse.manage`. Spec: `haper-misc/docs/plans/supplier-return-final-spec.md`; walkthrough `haper-misc/test-supplier-return.md`.
- Create = one transaction: batch mode takes each line from the exact lot by `_id` (`WarehouseBatchRepository.stockOutFromLot`, any lot status, `qtyReceived` untouched) then `recomputeRollup`; flag-off uses `WarehouseStockRepository.decrementFreeToPromise` (free stock only). Reserved guard = `freeToPromiseUtils.violation` (refuse only when it lowers on-hand below what is promised). Ledger `SUPPLIER_RETURN_OUT` per line (refType `supplier_return`, refLabel `SR000001`, lot cost, supplier).
- Supplier check: a lot may go to any supplier on its `PURCHASE_IN` rows for that batchNo (ledger wins over `lot.supplierId`); none recorded = allowed.
- Bill-linked returns are capped by billed minus already returned (live returns only); race-hard because every line writes the sku's `warehouse-stocks` row.
- Idempotent per admin (`createdBy + clientRequestId` unique); replay returns 200 `replayed:true`.
- Money: `expectedCreditAmount` fixed at create; refunds embedded and append-only (voided, never removed); `receivedAmount` recomputed; every write CAS on `rev`.
- Cancel puts units back into the same lot by `_id` (`restoreToLot`, never above `qtyReceived`), ledger `SUPPLIER_RETURN_REVERSAL`; refused while a refund is active or if the batch flag flipped since create.
- Profit/COGS unaffected (section 9): returns never touch orders or store items.

---

## 9. Stage G — costPrice snapshot and profit

- Sale time: order line `costPrice` = FEFO-weighted cost of the lots actually sold (`sellFEFO`), `batchAllocations` keep the per-lot detail. Batch-off store: the `items.costPrice` at that moment.
- Profit/COGS reads **only that snapshot**: `shared/repositories/order.repository.js` (product COGS aggregate), `shared/repositories/profit-snapshot.repository.js`, cron `daily-profit-snapshot.js` (1 AM IST), `GET /admin/analytics/profit`, `GET /admin/analytics/product-cogs` (`admin/src/routes/analytics/`). Lines with `costPrice` 0 are **excluded** from margin and surfaced as "cost unknown" (`costKnownRevenue` is the margin denominator).
- Why this matters: changing live `items.costPrice` or `warehouse-stocks.costPrice` (receipt correction, 2dp rounding) never rewrites past profit. Re-verify this before changing cost storage (memory: `reference_costprice_money_invariant`).
- Separate field `marginCostPrice` (item-master cost) is used only to clamp discounts and is deleted before the order is saved (`user/src/routes/order/controller.js`).
- Cross-store analytics group by `iId` (`CROSS_STORE_KEY`).

---

## 10. Roles and permission gates (summary)

Roles: `super_admin` (company), `store_admin` (per store), `manager`/`support` (store, permission snapshot), `warehouse_manager`, `warehouse_staff` (per warehouse). Presets in `shared/constants/permission.constant.js`.

| Action | Who |
|---|---|
| Receive goods | warehouse staff, manager, super |
| Set selling price on receipt | warehouse manager, super only |
| Correct receipt, change supplier, write-off, recall, set warehouse stock policy | `warehouse.manage` (manager, super) |
| Mark/unmark bill paid | manager, super (role AND permission) |
| Approve/reject replenishment | warehouse manager, super (`warehouse.approve_replenishment`) |
| Create/dispatch/cancel forward transfer, fulfill request | warehouse roles, super |
| Receive forward transfer at the store | store roles with `replenishment.receive_transfer` (and warehouse roles pass the route gate but 403 on a forward transfer inside the handler) |
| Create/dispatch/cancel store return | store admin (own store), super |
| Approve a return > 50 units | super only |
| Receive a return at the warehouse | warehouse roles (own warehouse), super |
| Stock-In / adjust-down at a store | `items.adjust_stock` |
| POS sale | `orders.create_pos` |
| Pick | picker app users (separate `pickers` accounts, store-scoped) |
| Add/assign product master, global categories | super_admin only (warehouse manager can create/assign to served stores, per CH-11) |

Warehouse roles get their preset as a guaranteed floor (`resolveEffectivePermissions`), so old accounts keep core permissions.

---

## 11. Gotchas / things that can break

1. **Batch flag mix-ups.** Every stock function has a flag-off legacy path. Test both. Flip warehouse flag before store flags; run `npm run migrate:apply` seeds (`seed-warehouse-batches.js`, `seed-store-batches.js`) before enabling, else stock has no lot and sales fail.
2. **Never bypass the chokepoints.** FEFO decrement throws without a session; a bare `$inc` on `items.quantity` drifts the roll-up and the nightly reconcile will alert.
3. **Restock loses the lot.** Cancel/refund/undelivered restock merges into a `LEGACY`/`RESTOCK` lot at the item's current cost (`incrementQuantity`), not the lot it came from (`batchAllocations` is not used). Expiry order and lot cost drift after returns.
4. **`stockRestored` guard.** Any new path that returns order stock must set it in the same write as the status change, or a late payment webhook restocks twice. Admin reopen clears it.
5. **Order-edit COGS drift.** Editing an order's quantity moves real stock but keeps the old `batchAllocations`/`costPrice` (known limitation in `shared/utils/order-edit.utils.js`); line cost is preserved, not re-averaged.
6. **Short receipts are silent shrinkage** (forward and return): units leave the source, never arrive, and no ledger row records the loss. Only `/transfer/discrepancies` shows it.
7. **Picker OOS wipes the shelf record** (qty set to 0, all lots depleted, no ledger row). Next Stock-In recreates stock.
8. **Pricing fan-out misses stores** with no resolvable serving warehouse and non-ACTIVE items; `storePricingSync.skipped` is the signal. Cost is intentionally not synced.
9. **Duplicate-invoice guard needs a supplier.** Without a supplier id the 409 check is skipped; blank invoice number also skips it.
10. **Warehouse receive and bill payment key on the normalised invoice number.** Write new invoice numbers only through `commonUtils.normalizeInvoiceNumber`; old rows have mixed case and matching must stay case/whitespace tolerant.
11. **Seven-day timers:** approved-but-undispatched replenishment expires (releases reservation); PENDING_APPROVAL return auto-cancels. Both by cron, both silent to users.
12. **Reads use `secondaryPreferred`**, which disables autoIndex. New unique indexes (e.g. `receipt-payments`) must be registered with `ensureIndexesFor` or they will not exist.
13. **Android Gson:** new order/item JSON fields must be nullable or always emitted (`iId` and `batchAllocations` are always emitted).
14. **Barcode drives everything at the warehouse.** An item without a barcode cannot be in a transfer, replenishment line, or auto-replenishment; changing a barcode company-wide is blocked while open transfers exist.
15. **Tests:** backend jest uses in-memory Mongo only (`cd packages/admin && NODE_ENV=test npx jest`). Relevant suites in `admin/__tests__/`: `store-batch-ledger`, `warehouse-batch-ledger`, `warehouse-reservation`, `warehouse-receipt-correction`, `procurement-*`, `transfer-return-*`, `pos-sale`, `warehouse-writeoff`.

---

## 12. Open gaps

- No in-app **stock count / stocktake** for store or warehouse; only manual Stock-In/adjust-down and one-off scripts.
- Store ledger omits online `SALE`, `SALE_RESTOCK`, picker `OOS_ZERO`, and any store write-off type (types exist in `inventory.constant.js` but are not written; only POS, transfers and manual adjust are). Store stock history therefore cannot be rebuilt from the ledger alone.
- No **customer return after delivery** flow (damaged/wrong item): only UN_DELIVERED and admin REFUND_SUCCESS restock, and REFUND_SUCCESS restocks without checking the goods physically came back.
- Restock does not return to the original lot; order edits do not re-allocate lots (section 11, items 3 and 5).
- Short-receipt shrinkage has no ledger entry or write-off workflow.
- Supplier returns: no payables ledger or GST credit-note document; a return made at the same moment as a bill supplier change is not serialised against it (rare; cancel + recreate).
- No multi-warehouse fallback; one serving warehouse per store; no interstate GST / e-way bill on cross-state transfers (`inventory-v2-design.md` section 9).
- Picker has no lot/expiry guidance (FEFO is accounting only); OOS undo not built (`haper-misc/picker-backend-backlog.md`).
- Supplier payment status is a flag per bill, not a payables ledger (no due dates, partial payments).
- Admin and client follow-ups per backend change are tracked in `haper-misc/client-followups.md` (CH-2..CH-12); picker barcode-master change (CH-12) still pending.
- Batch flags and the prod migration are rollout decisions owned by the user; this doc does not state their current prod values.

---

## 13. Stale docs found while verifying

- `haper-misc/store-return-to-warehouse-plan.md` — says no code until approval and describes gates as "to build"; the route, approval threshold (50 units/24h), 10-open cap, PENDING_APPROVAL status, expiry cron and admin modal all exist.
- `haper-misc/inventory-v2-design.md` header — says "PR not opened / prod migration pending" and the `feat/inventory-v2` branch; work is now on `dev`. Its section 11 build log for Phases 2-4 is still accurate.
- Memory note `project_warehouse_auto_batch` says `AUTO-EXP-<expiry>` / `AUTO-RCV-<today>`; the real format is `AE-YYYYMMDD` / `AR-YYYYMMDD` (`shared/utils/batch.utils.js`).
- `warehouse-stocks.schema.js` header comment still says "no batches / FEFO (Phase 1)"; the fields and `warehouse-batch.repository.js` show batches are real.
- `haper-docs/Inventory_Stock_Alerts.md` says multi-warehouse and reorder automation are out of scope (v1 PRD); auto-replenishment and warehouses now exist.
