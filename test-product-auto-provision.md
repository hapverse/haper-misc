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
Adding a product with a barcode now provisions it in one go (create → stores + warehouse). But what if the barcode comes later (manual barcode, generated, or bulk generate)? Before this fix, three actions left a product stranded: setting a barcode manually, auto-generating one, or using **Assign to stores** — none of them completed the warehouse provisioning. Now all three correctly provision when a barcode transitions from empty to set, making the product scannable and receivable immediately. Real example: *Anda Tilauri* has no barcode → gets one via generate → now automatically appears in stores and warehouse, ready for stock-in.

## What happens now

### On Product creation (`POST /admin/product`, super admin only)
- **Barcode present** → item row (qty 0, price 0, sellingPrice 0, costPrice 0) in every **active** store, **and** a `warehouse_stocks` placeholder (availableQty 0, costPrice 0) in every warehouse that serves one of those stores.
- **No barcode** → **nothing** is provisioned (not even stores). `warehouse_stocks` is keyed by `sku` = the barcode, so two barcodeless products would collide on the unique `{warehouseId, sku}` index. One gate for both halves — no half-onboarded state.
- `autoProvision: false` in the body → deliberate opt-out, nothing provisioned, no warning.

Response gains `data.provisioning`: `{ status: "complete" | "partial" | "skipped", stores, warehouses, warnings[] }`. `stores`/`warehouses` are the usual `{ assigned, skipped, failed, total }` counters.

### When a barcode is added later (PATCH `/:id/barcode`, `generate-barcode`, `generate-missing-barcodes`)
- Transition from **empty → set** (first barcode added): provisioning runs automatically. The product is added to all active stores + serving warehouses (idempotent — skips rows that already exist).
- Transition from **existing → different** (barcode changed): provisioning does NOT run. The warehouse rows migrate to the new SKU (separate code path). If a product is already stranded (has a barcode but zero store presence), editing the barcode again won't auto-fix it — use **Assign** instead.

### When Assign to stores is used (`POST /admin/product/:id/assign`)
- Adds/skips/retries store rows as before (quantity 0, seeded prices).
- **Now also triggers warehouse provisioning** if the product lacks warehouse rows. If warehouse provisioning fails (or is skipped), a warning toast is shown separately from the store success toast.

**Best-effort by design:** provisioning can never fail any create/assign. A partial result comes back as `status: "partial"` + warnings; retrying is always safe (both halves skip rows that already exist).

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

### Creation (always works)
1. Product Master → **Add product** with a barcode → save → **Expect:** a success toast.
2. Store catalogue (each active store) → the product is there at quantity 0.
3. Warehouse → Inventory → search the barcode → a row exists with 0 available, cost 0.
4. Repeat without a barcode → the product exists only in Product Master; stores/warehouse are untouched.

### Barcode added later (the fix)
1. Create a product with **no barcode** → verify it's NOT in any store or warehouse (expected).
2. Open its **Barcode** action → type a real barcode or click **"or Generate one"** → save/generate.
3. **Expect** a success toast: **"Barcode saved/Generated barcode XXXXX — provisioned to N store(s) and warehouse."**
4. Verify the product now appears in each store catalogue at quantity 0.
5. Verify the warehouse shows the product with 0 available quantity (search the barcode in Inventory).
6. In Product Master, open **Assign** on the product that now has a barcode → choose some stores → assign → **Expect** a success toast, and a follow-up warning toast **"Store assignment done, but warehouse provisioning didn't complete. [reason]"** (if applicable).
7. After clicking **Assign**, verify the warehouse has a placeholder row now (if it didn't before).

## Barcode added later — now triggers auto-provision (new as of 2026-08-15)

Three actions that add/change a barcode on a **barcode-less** product now correctly auto-provision it to stores + warehouse (idempotent — safe to run multiple times):

### ✅ A. PATCH `/admin/product/:id/barcode` (Barcode modal)
1. Create a product with **no barcode** (visible only in Product Master).
2. Open its **Barcode** action → the input is empty, with an **"or Generate one"** button.
3. Type a barcode and save.
4. **Expect** a success toast: **"Barcode saved — provisioned to N store(s) and warehouse."** The product now appears in each store and the warehouse (if it had no rows before).
5. If partial (e.g. the product has no serving warehouse): **"N store(s) have no serving warehouse: <names> — no warehouse row created for them."**
6. If partial (e.g. one store write fails): **"N store(s) failed to provision — press Assign on this product to retry."**

### ✅ B. `POST /admin/product/:id/generate-barcode` (Barcode modal Generate button OR single-row Generate)
1. Open the **Barcode** modal on a product with no barcode.
2. Click **"or Generate one"** → a button labeled **"Generate one"** appears, or use the per-row Generate action in the list.
3. **Expect** a toast: **"Generated barcode 2000000XXXXX — provisioned to N store(s) and warehouse."** (same provision logic as the manual set, above).
4. If the product already has a barcode: **"This product already has a barcode."** — generation is refused (409).

### ✅ C. `POST /admin/product/generate-missing-barcodes` (Bulk, via API or script)
1. Run the bulk endpoint (or use the filter + per-row Generate in the UI — the old toolbar button is hidden since 2026-08-14).
2. **Expect** the response to report `{ generated: N, skipped: M, failed: L, remaining: R }`.
3. Each newly-generated product is provisioned to its stores + warehouse (creating qty-0 placeholder rows if they don't exist).
4. **Warning:** this can create many warehouse `warehouse_stocks` rows in one call if the product batch was large — check Stock Health afterward to see the new rows.

### ✅ D. `POST /admin/product/:id/assign` now provisions warehouse too (new as of 2026-08-15)
1. Create a product with a barcode.
2. It appears in Product Master and (if it has an already-set barcode) in stores + warehouse.
3. Open the **Assign** modal (to manually assign it to a specific store after the fact).
4. Click **Assign**.
5. **Expect** first a success toast: **"Assigned"** (for store rows).
6. **If** the warehouse half had any warnings (e.g. no serving warehouse, or a partial failure), a second toast: **"Store assignment done, but warehouse provisioning didn't complete. {warning}."**
7. **Result summary** shows: **Assigned N · skipped M [· failed L] of Z store(s).** (this counts store rows only, not warehouse; warehouse results are shown in the warning toast only.)

## Replication-lag fix — "Product created, but not auto-provisioned" (fixed 2026-08-25)

**Symptom (dev/prod, intermittent):** creating a product with a barcode returned
*"Product created, but not auto-provisioned. Product not found — nothing was provisioned."*
even though the product clearly existed. And adding a barcode later sometimes said
*"No barcode set — nothing was auto-provisioned"* one line after the barcode saved fine.

**Real example:** you save "Atta 1kg" with a barcode. The write goes to the Mongo primary.
The very next line asked for that product back by its id — and the admin connection reads from a
**secondary** (`readPreference: secondaryPreferred`). That secondary was a fraction of a second
behind, so it answered "no such product". Provisioning believed it and created nothing: 0 store
rows, 0 warehouse rows, until someone pressed **Assign**.

**Fix:** the two call sites now hand provisioning the product document they already have (instead of
just its id), and the repository's id/iId lookup is pinned to the **primary**, so any future caller
is safe too.

- ✅ `cd packages/admin && NODE_ENV=test npx jest product-provision-secondary-read` — 5 tests
  (own 3-node in-memory replica set with replication frozen on the secondaries, so the lag is
  deterministic, not flaky): create call site, `POST /admin/product`, the already-correct
  loaded-doc control, a pin that the master lookup never uses `secondaryPreferred`, and
  `PATCH /admin/product/:id/barcode`.
- ✅ Manual on dev: create 5-10 products with barcodes back to back → **every** one reports
  "provisioned to N store(s) and warehouse", none reports "Product not found".
- ❌ Should never appear again: "Product not found — nothing was provisioned." right after a
  successful create.

## Edge cases / notes
- **Barcode changed to a different value** — `PATCH /admin/product/:id/barcode` with a **different** code does NOT re-trigger provision (that's a SKU migration, separate code path; warehouse rows move instead). If a product is already stranded (barcoded but zero store presence — a real edge case), editing the barcode again won't fix it; use **Assign to stores** as the manual repair.
- **"Already has barcode"** (409) — single or bulk generate refuse if the product already has a code. This is correct, not a bug (the code is already set; use the barcode modal to change it).
- **No backfill** for existing products — only new creations and barcode additions are affected.
- **No transaction** by design: best-effort + idempotent beats an all-or-nothing write that could roll back a good master.
- When `POST /admin/item` creates a new item and, as a side effect, backfills a Product Master (that path calls `ProductRepository.create` directly), the store/warehouse auto-provision fan-out does **NOT** run — it lives only in the product controller's `POST /admin/product` create path.
- "Active store" is one shared definition (`ProductRepository.ACTIVE_STORE_FILTER`) used by all provision callers — they can't drift apart.

## Nightly reconciliation cron job (backend `product-master-reconcile`)

A background job runs nightly at 4 AM IST (configurable in the cron package) to detect genuinely stranded products:

- **`[product-reconcile] STRANDED`** — a product with a barcode set but **zero** rows in any store's `items` collection. This is a real problem — manual repair via **Assign** is required. Monitor pm2 logs for these.
- **`[product-reconcile] NOT-YET-RECEIVED`** — a product with store presence but the warehouse has not received it yet (0 `warehouse_stocks` rows). This is **normal** and expected (stock comes in later); the log is informational, not an error. Count of products in this state is logged as a one-line summary, not per-product spam.

(To check for stranded products in real time outside the nightly job, grep the backend logs for `STRANDED` or check the nightly cron log for `[product-reconcile] STRANDED` lines.)

## What deploy this needs
- **Backend → `dapi.haper.in`** (provision-on-barcode logic in product controller + the new nightly cron job logs).
- **Admin → `damin.haper.in`** (updated toast messages showing accurate store/warehouse counts + "or Generate one" button always visible for barcode-less products).
- **No DB schema changes.** No new dependencies.
- Deploy backend first (so admin calls the updated endpoints), then admin.
