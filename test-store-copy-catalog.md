# Test: Copy catalog from another store (on store create)

**Area:** Admin panel → **Stores → New store** (`/stores`, `damin.haper.in` on dev).
**Who:** **super-admin** (store creation is super-admin only).
**Backend:** `POST /admin/store` with `copyFromStoreId`; clone logic in
`store-clone.utils.js` → `ItemRepository.copyItemsToStore`. **Needs BOTH deploys** — backend
`dapi.haper.in` **and** admin `damin.haper.in`.

## What this is (real example)

When you open a new store, you usually want the **same product list** as an existing one instead of
re-adding hundreds of items by hand. The **Create Store** modal has an optional **"Copy catalog from
store"** dropdown: pick a source store and the new store is born with that store's whole catalogue —
at **0 stock**, ready to receive.

**Example:** open **"Chapra 2"** and copy from **"Chapra 1"** → Chapra 2 instantly has every Chapra 1
product (same names, prices, categories, barcodes) at quantity 0, plus the same inventory groups. You
then just start receiving stock.

## What is copied vs reset

| Thing | Copied? | Detail |
|---|---|---|
| **Items** | ✅ | All source items at **quantity 0**. Name, brand, **prices**, images, `iId`, and **barcode** carried over (same product). |
| **Inventory groups** | ✅ | Per-store; copied and remapped onto the new items. Alert state reset to HEALTHY. |
| **Categories / sub-categories** | ➖ | **Global master** — shared by all stores, so nothing per-store to clone (result count = 0). Items still point at the same global category. |
| **Stock quantity** | ❌ reset | Everything starts at **0**. |
| **Shelf location** | ❌ reset | **Not copied** — physical placement is per-store (R1 in store A may be S6 or Z1 in store B). New items start with a **blank** location. |
| **Barcode enrollment audit** | ❌ reset | The barcode *value* is copied, but *who physically scan-bound it* is reset — re-enroll per store. |
| **Stock-alert records** | ❌ | Runtime artifacts; the evaluator regenerates them from the copied groups. |

**Safety:** the clone is **best-effort** — if it fails, the store is **still created** (error logged),
and the response returns a `copied` count `{ categories, subCategories, inventoryGroups, items }`.
Copy is offered on **create only**, never on edit.

## The walkthrough

### ✅ A. Copy a catalog into a new store
1. `damin.haper.in` as **super-admin** → **Stores → New store**.
2. Fill the required fields (name/email/phone/address/serving warehouse). Under **"Copy catalog from
   store (optional)"** pick a source store.
3. Save → **Expect** the store is created and the new store's **Items** list shows the source's
   products at **quantity 0**.

### ✅ B. Prices, categories and barcodes carry over
1. Open an item in the new store → **Expect** the same **price**, **category/sub-category**, and
   **barcode** as the source item (same product identity / `iId`).

### ✅ C. Shelf location is NOT copied (the fix)
1. In the **source** store, an item has a shelf location (e.g. **R1**).
2. In the **new** store, open the same item → **Expect** its **location is blank** (not "R1"). Set it
   per store from the picker/item edit.

### ✅ D. Stock starts at 0
1. Every copied item shows **quantity 0** — you stock it via goods-receive / stock-in, not the copy.

### ✅ E. Don't-copy path
1. Leave the dropdown on **"— Don't copy —"** → the new store is created **empty** (no items/groups).

### Edge cases
- **Source store has no items** → store still created; `copied.items = 0`.
- **Clone failure** (rare) → store is created anyway; the failure is logged, not surfaced as a 500.
- **Categories are global** → the copied item shares the *same* category id as the source (by design),
  so a later category rename shows everywhere.

## What deploy this needs
- **Backend → `dapi.haper.in`** (clone logic) **AND admin → `damin.haper.in`** (the modal helper text).
  Deploy backend first, then admin.

## Source (for reference)
- Clone orchestration: `haper-backend/packages/shared/utils/store-clone.utils.js` (`cloneStoreCatalog`).
- Item copy (drops per-store `location`, resets qty + enrollment): `haper-backend/packages/shared/repositories/item.repository.js` (`copyItemsToStore`).
- Store-create wiring: `haper-backend/packages/admin/src/routes/store/controller.js` (`createStore`, `copyFromStoreId`).
- Admin UI: `haper-admin/src/pages/Stores/StoreModal.tsx` (the "Copy catalog from store" dropdown + helper text).
- Backend test: `haper-backend/packages/admin/__tests__/store.test.js` ("clones per-store rows …", incl. the location-not-copied assertion).
