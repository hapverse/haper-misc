# Test: Delete product (Product Master hard delete)

**Area:** Backend admin — Product Master.
`packages/admin/src/routes/product/router.js` + `controller.js` (`remove`) + `validator.js` (`remove`).
Tests: `packages/admin/__tests__/product-delete.test.js`.
**PR/deploy:** backend-only → `dev` (`dapi.haper.in`). Admin UI button still TO BUILD
(haper-admin) — until then the endpoint is callable from the API only.

## Why
Product Master had **no delete at all** — only Edit, Barcode, Assign and
Activate/Discontinue (a soft status flag). Two junk test masters
("Test product 1" barcode `87654321`, "Test Product" barcode `12345678`) need real
removal, and direct DB deletes on prod are against project rules, so the cleanup has
to go through app code.

## What it does
`DELETE /admin/product/:productId` — **super_admin only**, **one product per call**
(deliberately no bulk endpoint). Irreversible.

### Hard safety gate (runs BEFORE anything is deleted)
Blocked with **409** `{ msg, code: "HAS_HISTORY", data: { reason } }` if the product was
ever part of real business activity. Reasons, in check order:

| reason | what is checked | how the product is referenced there |
| --- | --- | --- |
| `orders` | `orders` | `items[].itemId` (ObjectId → `items`) **or** `items[].iId` (String) |
| `cart` | `carts` | `items[].itemId` — a **String**, not an ObjectId |
| `stock_movements` | `stock-movements` (append-only ledger) | `sku` (= barcode), `iId`, `itemId` |
| `stock_transfers` | `stock-transfers` | `items[].sku`, `items[].storeItemId` |
| `replenishment_requests` | `replenishment-requests` | `items[].sku`, `items[].storeItemId` |
| `gift_tier` | `store-gift-tiers` | `giftItemId` (ObjectId → `items`) |
| `warehouse_batches` | `warehouse-batches` | `sku` (= barcode), `iId` |
| `store_batches` | `store-batches` | `itemId` (ObjectId → `items`) |
| `has_stock` | `items`, `warehouse_stocks` | live `items.quantity > 0` / `warehouse_stocks.availableQty > 0` |

Transfers/replenishments are checked separately because a **DRAFT/PENDING** request can
exist *before* any ledger row is written — the ledger check alone would miss it.

**Gift tiers** are checked because configuring a gift-with-purchase tier writes **nothing**
to orders/carts/the ledger — a gift product can be "clean" by every other check while a live
promotion depends on it. Deleting it would not crash (`giftUtils.selectGiftForCart` treats a
missing item as unavailable and falls through) — the promotion would just **silently stop**.

**Live stock** is checked because `PUT /admin/items/:itemId` (permission `items.edit`, so a
store admin/manager can do it) writes `quantity` straight onto a **non-batch** store's item
with **no ledger row** — real shelf stock can exist with zero movement history. It is checked
last only so the more specific history reasons win when both apply.

### Two identity keys are REQUIRED (both 400, not 409)
Empty `barcode`/`iId` clauses are never queried (`sku` and `iId` default to `""` on the
ledger, so an empty value would match every legacy row — and, worse, delete unrelated data).
- A master with no **`iId`** → **400** rather than a wildcard delete.
- A master with no **`barcode`** → **400**. Warehouse history (`stock-movements`,
  `warehouse_stocks`, `warehouse-batches`) is findable **only** by the product's *current*
  sku/barcode — none of the five `recordWarehouse()` call sites write an `iId`. So if the
  barcode is cleared (`DELETE /admin/items/:itemId/barcode` → `fanOutBarcode`) first, the
  warehouse half of the gate matches **nothing** while real stock and history still sit
  under the old code. Requiring a non-empty barcode is what makes the sku-based checks
  trustworthy. Fix: put the barcode back, then delete — or use Discontinue.

### Identity is pinned at the final delete
The gate reads `iId`/`barcode` **before** the transaction opens. The master delete is
therefore `deleteOne({ _id, iId, barcode })` — if either key moved in that window, the whole
gate was answered about a product shape that no longer exists, nothing matches, and the
`deletedCount !== 1` throw aborts the transaction (item/warehouse deletes roll back with it).

## Barcode changes now MOVE the warehouse rows (root-cause fix)
**The real bug this endpoint exposed:** warehouse inventory is keyed on `sku` = the
**barcode**, a field admins can edit. Changing a barcode therefore stranded every
`warehouse_stocks` / `warehouse-batches` / `stock-movements` row under the OLD code — the
stock, its cost basis and its ledger vanished from every view of that product. That was true
**with or without** the delete endpoint; delete just made it destructive (rename → the gate
looks under the new code, sees nothing, deletes the master → orphan rows left behind → the
next product created with the old code silently **inherits** that quantity and cost, which
feeds COGS/profit).

**New rule: a product's current barcode is the only sku its warehouse rows may be under.**
Every barcode write path either moves the rows or refuses. Implemented in
`packages/shared/utils/sku-identity.utils.js` and wired into:

| path | behaviour |
| --- | --- |
| `PATCH /admin/product/:id/barcode` (`setBarcode`) | **Moves** `warehouse_stocks`, `warehouse-batches`, `stock-movements` from the old sku to the new one, in the SAME transaction as the barcode write + item fan-out (`store_batches.barcode` refreshed too). Response carries `data.movedWarehouseRows`; an audit row `product.barcode.change` records old → new + counts. |
| same, but the NEW code already has warehouse rows | **409** — that would be a stock **merge** (sum qty, weighted-average cost), not a rename. Refused rather than guessed at. |
| same, but an **open** transfer (CREATED/DISPATCHED) or replenishment (PENDING/APPROVED/PARTIALLY_APPROVED) references the old sku | **409** — those documents drive warehouse mutations by `line.sku` and the physical cartons carry the old label. Receive/cancel first. |
| same, but barcode set to **""** while warehouse rows exist | **409** — there is no sku to move them to (`sku: ""` is a wildcard shared by every barcodeless product). |
| `POST /admin/item/:id/enroll-barcode`, `DELETE /admin/item/:id/barcode` (shelf-walk) | **409** when warehouse stock/history exists under the code being replaced/cleared, pointing at **Product Master → Barcode** (the only path that can move the rows atomically). Enrolling onto a product with no code yet — the normal case — is unchanged. |

**Store side is NOT affected:** `items` are keyed by `iId` (immutable) and `store_batches` by
`itemId`; their `barcode` fields are denormalised copies that the fan-out already keeps in
step. Nothing on the store side detaches when a barcode changes.

**New-product safety net:** auto-provisioning (`ensurePlaceholder`) still never touches an
existing warehouse row, but if that row already holds stock/cost it is now reported as
`adopted` and the create response carries a **warning** ("… already had stock/cost before this
product was created"). That is the visible signal for orphans created by renames that happened
*before* this fix.

### Race window (check-then-act)
The gate runs **twice**: once before the transaction, and again **inside** it against the
session, immediately before the deletes (store item ids are re-read too). Mongo has no
predicate locks, so the window can only be narrowed — but an order/cart/gift-tier that does
land in it now aborts the transaction and returns the same **409** instead of committing
over it.

### The delete (only when all checks are clean)
One Mongo transaction (`session.withTransaction`, same style as
`procurement/controller.js`'s `receive`):
1. `warehouse_stocks` rows for the barcode (`sku`) — may be 0
2. `items` rows for the `iId` across **all** stores — may be 0
3. the `products` master itself
4. an **atomic** audit row (`auditUtils.logAtomic`, action `product.delete`) — the audit
   entry is the only durable record of a delete, so it commits or rolls back with it

Success → **200** `{ msg: "Product and N item(s), N warehouse row(s) deleted",
data: { deleted: { product: true, items: N, warehouseStocks: N } } }`.
Missing product → **404**. Transaction failure → **500** "nothing was deleted… try again"
(nothing is left half-deleted).

## Steps (backend jest, in-memory — `cd packages/admin && NODE_ENV=test npx jest product-delete.test.js`)
- ✅ **Bare master** (no items, no warehouse row, no history) → 200, `deleted.items === 0`,
  `deleted.warehouseStocks === 0`, product gone from `products`.
- ✅ **Master + 2 store items + 1 warehouse row** → 200, counts `items: 2,
  warehouseStocks: 1`, all 4 docs actually gone.
- ✅ **Audit row** written with `action: "product.delete"`, `metadata.iId/barcode/counts`,
  `before` snapshot, `after: null`.
- ✅ **Order history (by `items.itemId`)** → 409 `reason: "orders"`, product + item +
  warehouse row all still there.
- ✅ **Order history (by `items.iId` only, no item row)** → 409 `reason: "orders"`.
- ✅ **In a customer cart** → 409 `reason: "cart"`, nothing deleted.
- ✅ **Ledger row (PURCHASE_IN) even at qty 0** → 409 `reason: "stock_movements"`.
- ✅ **Open stock transfer, no ledger row yet** → 409 `reason: "stock_transfers"`.
- ✅ **Replenishment request** → 409 `reason: "replenishment_requests"`.
- ✅ **Store admin (non-super)** → 403, before any delete logic runs.
- ✅ **Unknown product id** → 404.
- ✅ **Mid-transaction failure** (items delete forced to reject *after* the warehouse row
  was deleted) → 500, warehouse row + items + product all still present, no audit row.
- ✅ **No barcode** → 400 "no barcode", nothing touched.
- ✅ **Cleared-barcode bypass**: real warehouse stock + ledger row under the barcode, then
  barcode cleared on master + items, then delete → **400** at the barcode guard (the blind
  history checks never even run); stock row, ledger row, item and master all survive.
- ✅ **Barcode put back** → 200, deletes normally.
- ✅ **Store item `quantity: 5`, zero movement history** → 409 `reason: "has_stock"`.
- ✅ **`warehouse_stocks.availableQty: 3`, zero movement history** → 409 `reason: "has_stock"`.
- ✅ **Configured as a gift tier's `giftItemId`** (no order/cart/ledger rows at all) → 409
  `reason: "gift_tier"`.
- ✅ **Warehouse batch row** → 409 `reason: "warehouse_batches"`; **store batch row** → 409
  `reason: "store_batches"`.
- ✅ **Race**: gate pass 1 clean, pass 2 (inside the transaction) sees order history →
  409 `reason: "orders"`, transaction aborted, nothing deleted, **no audit row**.
- ✅ **Both passes clean** → 200 (proves the second pass doesn't block a normal delete).
- ✅ **Stale identity**: master's barcode changed *inside* the transaction (mocked, fires
  before the deletes) → **404**, transaction aborted, product + item + warehouse row all
  still present, **no audit row**.

### Changed-barcode bypass (new — `product-delete.test.js`)
- ✅ Warehouse stock + ledger + batch under barcode B → `PATCH …/barcode` to C → **200** with
  `movedWarehouseRows { warehouseStocks: 1, warehouseBatches: 1, stockMovements: 1 }`;
  **nothing** left under B; DELETE then → **409** `reason: "stock_movements"`, nothing deleted.
- ✅ The rename writes an audit row `product.barcode.change` (before/after barcode + counts).
- ✅ Target code C already has a warehouse row → PATCH **409** "already exist under barcode",
  master keeps B, rows untouched, DELETE still **409**.
- ✅ Clearing the barcode while warehouse rows exist → PATCH **409** "cannot be removed".
- ✅ Open stock transfer on the old code → PATCH **409** "open stock transfer".
- ✅ No warehouse footprint at all → rename **200** (fan-out intact) and the clean product
  still deletes normally — the guard doesn't block ordinary barcode corrections.

### Shelf-walk guard (`product-barcode.test.js`)
- ✅ Enroll a *different* code over one the warehouse holds stock under → **409** pointing at
  Product Master; master + item keep the old code, warehouse row untouched.
- ✅ Clear a code the warehouse holds stock under → **409**, nothing changed.
- ✅ Product the warehouse knows nothing about → enroll / re-enroll / clear all still **200**.

- ✅ Regression: full admin suite **83 files / 1353 tests, all green** (29 in this file,
  22 in `product-barcode.test.js`).

## Manual check on dev (after deploy)
1. Log in as **super admin** on `damin.haper.in`.
2. `DELETE https://dapi.haper.in/admin/product/<productId>` for a junk master
   (e.g. "Test Product", barcode `12345678`).
3. Expect **200** + the deleted counts; re-open Product Master → the product is gone.
4. Try the same on a real, previously-sold product → expect **409** with a message telling
   you to use **Discontinue** instead. Nothing is removed.

## Edge cases / notes
- ❌ **Not** reversible and **not** bulk — one product at a time, on purpose.
- ❌ Does not delete `warehouse_batches` / `store_batches` — it **refuses** instead (their
  own reasons). A batch row normally implies a ledger row, so these are cheap insurance for
  the odd case where it doesn't.
- ❌ A product with an empty barcode can no longer be deleted at all (see the 400 above).
- ⚠️ **Pre-existing orphans in prod are NOT retro-fixed.** Warehouse rows stranded by barcode
  renames that happened *before* this change still sit under codes no master owns. Recommended
  follow-up: a **read-only** audit that lists `warehouse_stocks` / `warehouse-batches` /
  `stock-movements` skus matching no product master, so ops can reattach or write them off
  deliberately. (Not written yet — deliberately not a silent auto-fix.)
- 🔎 Residual (accepted): a goods receipt that *inserts* a brand-new row under the OLD sku in
  the microsecond after the rename's `updateMany` would recreate an orphan. Mongo transactions
  cannot range-lock a key that doesn't exist yet; the delete gate is separately protected by
  the barcode-required rule, so the blast radius is a stray row, not a bad delete.
- Still deferred (NOT in this pass): `stock_alerts` cleanup, `discount_rules` handling,
  richer audit content, audit rows for *blocked* attempts, rate limiting.
- The admin FE "Delete product" button + confirm dialog (showing the 409 message when
  blocked) is still **TO BUILD** in haper-admin.
