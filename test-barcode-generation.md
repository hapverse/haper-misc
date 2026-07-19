# Test: Generate internal barcodes — for products with no barcode

**Area:** Admin panel → **Catalog → Product Master** (`/products`, `damin.haper.in` on dev).
**Who can use it:** **super-admin OR warehouse-manager** (same as the existing "Barcode" action — the
buttons are hidden for everyone else; the API is `requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER)`).
**Backend:** new endpoints on the **product-master** router; a shared EAN util. **Needs BOTH deploys** —
backend `dapi.haper.in` **and** admin `damin.haper.in`.

## What this is (real example)

Many products (loose / repacked goods) ship with **no barcode**, so they get **skipped** on shelf
labels and can't be scanned at the counter. This lets a super-admin or warehouse-manager **mint an
internal barcode** for them from the **Product Master** — one product at a time or all-missing at once.
The barcode is a **product-master property**: the code is written to the master **and fanned out to
every store's copy** of that item, so it immediately prints on shelf labels and scans at POS and in the
picker.

**Example:** *Anda Tilauri* has a blank barcode. On Product Master, click **Generate** → the system mints
`2000000047126` → saves it to the master **and all stores** → the item now prints a scannable label and
beeps at the POS scanner.

## The barcode scheme (standard EAN-13, derived from the iId)

```
EAN-13 = "2"  +  <the product's iId digits, left-padded to 11>  +  <check digit>
```
- **`2`** — the GS1 "in-store" range: real manufacturer barcodes never start with it, so an internal
  code **can never collide with a real scanned barcode**.
- **iId digits** — the product's own unique `iId` with the letters dropped (`BI4712` → `4712`),
  left-padded to 11 digits. Because the `iId` is unique per product, **no two products ever get the
  same code** (uniqueness inherited from the iId — no counter, fully deterministic).
- **check digit** — the standard EAN-13 check digit (catches scan errors).

Worked example: `BI4712` → digits `4712` → payload `200000004712` → check `6` → **`2000000047126`**.

## Endpoints (super-admin OR warehouse-manager)

- `POST /admin/product/:productId/generate-barcode` — loads the master by `_id`; mints + applies the
  code **only if the product has no barcode** (else **409** "already has a barcode"). Returns
  `{ barcode, product, syncedItems }` (`syncedItems` = how many store copies got the code).
- `POST /admin/product/generate-missing-barcodes` — **GLOBAL** over the product master (not per-store):
  pages every master with an empty barcode (`limit` default 200 / max 500 per call). Returns
  `{ generated, skipped, failed, remaining, failures }`. `remaining > 0` means "run again for the rest"
  (no auto-loop).

Both write through the same **transactional** path `setBarcode` uses: it pre-checks uniqueness (no
other product / store item may hold the code) and **fans the code out to the master + every store's
item** in one transaction. Legacy rows (an `iId` with no materialised master) still fan onto the item
rows; the missing master is skipped, not 404'd.

---

## The walkthrough

### ✅ A. One product from the Barcode modal
1. Log in to `damin.haper.in` as **super-admin** (or **warehouse-manager**), open **Catalog → Product
   Master**.
2. Open the **Barcode** action on a product that has **no barcode**. Beside the "Scan or type" input
   there's an **"or Generate one"** button.
3. Click it → **Expect** a toast **"Generated barcode 2000000… — updated N store item(s)."** and the
   list refreshes with the barcode filled in. (`N` = number of stores that stock the product = the
   fan-out.)

### ✅ B. Per-row Generate
1. In the Product Master list, a product with **no barcode** shows a per-row **Generate** action.
2. Click it → same toast + refresh. Row actions disable while a generate is in flight.

### ✅ C. The code is a real EAN-13, on master + all stores
1. The generated code is 13 digits starting with **`2`**, with the product's `iId` in the middle.
2. It fans out: check the same product's item in each store — **Expect** the **same barcode** everywhere
   (that's what `syncedItems` counted).
3. On the **Shelf Labels** page the item now **prints** (it was skipped before), as a real **EAN-13**;
   scanning it at POS resolves the item.

### ✅ D. Bulk "Generate missing barcodes" (global)
1. Click the toolbar **Generate missing barcodes** button → confirm the prompt.
2. **Expect** a toast like **"Generated 180, skipped 0, failed 0"**, and the list refreshes. It's
   **global** (all product masters missing a barcode, not one store). If more than one batch remains it
   appends **"— run again for the rest"** (`remaining > 0`); click again to continue. It **never
   silently truncates**.

### ✅ E. Already has a barcode → no-op (409)
1. Trigger Generate on a product that **already has a barcode**.
2. **Expect:** a clear error toast **"This product already has a barcode."** — the existing (real)
   barcode is **never overwritten**.

### ❌ F. Not a super-admin / warehouse-manager → nothing to see
1. Log in as a **store admin** (neither super-admin nor warehouse-manager). Note: the Product Master
   page itself is already gated to super-admin + warehouse-manager, so a store admin can't reach it.
2. Even if the API is called directly, generation returns **403**.

### ✅ G. Shelf-label rendering unaffected for non-EAN codes
1. On the Shelf Labels page, an item with a **real EAN-13** barcode (e.g. a generated `2000000047126`)
   renders as **EAN-13** symbology; an item with an **alphanumeric / non-EAN** barcode still renders as
   **Code 128 exactly as before**.

### Edge cases
- **iId with more than 11 digits** (extremely unlikely at this scale): generation returns a clear error
  for that product; in bulk it's counted under **failed** with the reason — never truncated.
- **Rare collision** (the derived code somehow already exists): reported for that product (not silently
  changed); in bulk it's a **failed** with reason.
- The old **item-scoped** paths (`POST /admin/item/:itemId/generate-barcode`, `/generate-missing-barcodes`)
  were **removed** — they now 404. Generation lives only on the Product Master.

---

## What deploy this needs
- **Backend → `dapi.haper.in`** (the new endpoints + EAN util) **AND admin → `damin.haper.in`** (the
  Generate buttons + EAN-13 label rendering). Deploy the **backend first**, then admin.

## Source (for reference)
- EAN util: `haper-backend/packages/shared/utils/ean.utils.js` (`buildEan13FromIId`, `checkDigit`, `isValidEan13`).
- Repo fan-out + missing-master helpers: `haper-backend/packages/shared/repositories/product.repository.js` (`generateBarcodeForIId`, `missingBarcodeMasters`, `countMissingBarcodeMasters`).
- Endpoints: `haper-backend/packages/admin/src/routes/product/{controller,router,validator}.js`.
- Admin UI: `haper-admin/src/pages/Products/{ProductsList,BarcodeModal}.tsx`, `haper-admin/src/api/products.ts`.
- EAN-13 label rendering: `haper-admin/src/utils/shelfLabelPrint.ts` (`isValidEan13` / `optionsFor`).
- Backend tests: `haper-backend/packages/admin/__tests__/product-barcode.test.js`, `ean.utils.test.js`.
