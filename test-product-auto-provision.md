# Test: auto-provision a new Product Master (stores + warehouses)

**Area:** Backend admin — Product Master creation.
`packages/admin/src/routes/product/controller.js` (`create` + `autoProvisionNewProduct`),
`packages/admin/src/routes/product/validator.js` (`create`),
`packages/shared/repositories/product.repository.js` (`provisionWarehouses`),
`packages/shared/repositories/warehouse.repository.js` (`resolveServingWarehouseIds`),
`packages/shared/repositories/warehouse-stock.repository.js` (`ensurePlaceholder`).
**PR/deploy:** backend-only → `dev` (`dapi.haper.in`). No client change required
(admin FE can optionally show `data.provisioning.warnings`).

## Why
Adding a product used to be two steps: create the master, then remember to press
**Assign** so each store gets a row — and the warehouse SKU only appeared when someone
received stock. Real example: a new "Amul Butter" existed in Product Master but was
invisible in both stores' catalogue and un-receivable at the warehouse until two extra
manual actions. Now creating it does all of that in one go, at zero quantity/cost.

## What happens now
`POST /admin/product` (super admin only), **after** the master is saved:
- **Barcode present** → item row (qty 0, price 0, sellingPrice 0, costPrice 0) in every
  **active** store, **and** a `warehouse_stocks` placeholder (availableQty 0, costPrice 0)
  in every warehouse that serves one of those stores.
- **No barcode** → **nothing** is provisioned (not even stores). `warehouse_stocks` is
  keyed by `sku` = the barcode, so two barcodeless products would collide on the unique
  `{warehouseId, sku}` index. One gate for both halves — no half-onboarded state.
- `autoProvision: false` in the body → deliberate opt-out, nothing provisioned, no warning.

Response gains `data.provisioning`:
`{ status: "complete" | "partial" | "skipped", stores, warehouses, warnings[] }`.
`stores`/`warehouses` are the usual `{ assigned, skipped, failed, total }` counters.

**Best-effort by design:** provisioning can never fail the create. A partial result comes
back as `status: "partial"` + warnings; pressing the existing **Assign** button is always
a safe retry (both halves skip rows that already exist).

## Steps (backend jest, in-memory — `cd packages/admin && NODE_ENV=test npx jest product-auto-provision`)
- ✅ **With barcode** — 2 stores served by 1 warehouse → 2 item rows (qty/price/cost all 0)
  + 1 warehouse row (availableQty 0, costPrice 0); `provisioning.status === "complete"`.
- ✅ **Without barcode** — 0 items, 0 warehouse rows; `status: "skipped"` and the warning
  mentions the missing barcode.
- ✅ **`autoProvision: false`** — 0 items, 0 warehouse rows; `status: "skipped"`, warnings empty.
- ✅ **Idempotent** — a manual `POST /admin/product/:id/assign` with `"ALL"` afterwards
  returns `{ assigned: 0, skipped: 2 }` (no duplicates).
- ✅ **Never clobbers real stock** — a pre-existing warehouse row for that SKU (qty 42,
  cost 99.5, lowQty 7, older name/brand) is byte-identical after the create, including
  `updatedAt`; the warehouse half reports `skipped: 1`.
- ✅ **Store with no serving warehouse** — still 200, that store's warehouse is simply not
  provisioned, `status: "partial"` and the warning names the store.
- ✅ **A failing store write** — still 200, product exists, `stores.failed === 1`,
  `status: "partial"`; the warehouse half is unaffected.
- ✅ **Non-super-admin** → 403 before anything is created.
- ✅ **Duplicate-name guard fires first** → 409, nothing provisioned.
- ✅ Regression: full admin jest suite + `packages/cron` suite (auto-replenishment) green.

## Manual check on dev (damin.haper.in)
1. Product Master → **Add product** with a barcode → save.
2. Store catalogue (each active store) → the product is there at quantity 0.
3. Warehouse → Inventory → search the barcode → a row exists with 0 available, cost 0.
4. Repeat without a barcode → the product exists only in Product Master; nothing else changes.

## Edge cases / notes
- **Barcode added later** is NOT provisioned automatically — `PATCH /:id/barcode`,
  `generate-barcode` and `generate-missing-barcodes` are untouched. Use **Assign** after
  setting a code (deliberate, deferred).
- **No backfill** for existing products — only new creations are affected.
- **No transaction** by design: best-effort + idempotent beats an all-or-nothing write that
  could roll back a good master.
- When `POST /admin/item` creates a new item and, as a side effect, backfills a Product
  Master (that path calls `ProductRepository.create` directly), the store/warehouse
  auto-provision fan-out does **NOT** run — it lives only in the product controller's
  `POST /admin/product` create path.
- "Active store" is one shared definition (`ProductRepository.ACTIVE_STORE_FILTER`) used by
  both `assignToStores("ALL")` and the auto-provision caller — they can't drift apart.
