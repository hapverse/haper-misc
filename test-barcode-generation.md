# Test: Generate internal barcodes — for products with no barcode

**Area:** Admin panel → **Catalog → Product Master** (`/products`, `damin.haper.in` on dev).
**Who can use it:** **super-admin ONLY** (since 2026-08-13 — the whole Product Master is super-admin
only; a warehouse-manager can no longer reach it. The buttons are hidden for everyone else and the
API is `requireRole(SUPER_ADMIN)`).
**Backend:** new endpoints on the **product-master** router; a shared EAN util. **Needs BOTH deploys** —
backend `dapi.haper.in` **and** admin `damin.haper.in`.

## What this is (real example)

Many products (loose / repacked goods) ship with **no barcode**, so they get **skipped** on shelf
labels and can't be scanned at the counter. This lets a super-admin **mint an
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

## Endpoints (super-admin only)

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

> **CHANGING an existing barcode also moves the warehouse rows** (`warehouse_stocks`,
> `warehouse-batches`, `stock-movements` are keyed by `sku` = the barcode), and is **refused (409)**
> when they cannot be moved safely — target code already has warehouse rows, stock in flight on an
> open transfer/replenishment, or the barcode is being cleared. The shelf-walk enroll/clear endpoints
> refuse outright in those cases and point here. Generation is unaffected: it only ever applies a code
> to a product that has none. Full rules + test steps: **test-product-delete.md → "Barcode changes now
> MOVE the warehouse rows"**.

---

## The walkthrough

### ✅ A. One product from the Barcode modal
1. Log in to `damin.haper.in` as **super-admin**, open **Catalog → Product Master**.
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

### ✅ D. Filter to products with **no barcode** ("Missing barcode only")
1. In the Product Master toolbar, tick **"Missing barcode only"** → the list narrows to products that
   still have **no barcode** (barcode **absent, null, or empty** all count). Untick to show everything
   again. Combines with the search box and the status dropdown.
2. Typical use: tick it to see exactly what needs a code, then mint each with the per-row **Generate**
   action (B). The empty-state reads "No products match the filters" when nothing is missing a barcode.
3. **Note — the bulk button is hidden.** The old toolbar **"Generate missing barcodes"** button is
   **no longer shown**. The backend `POST /admin/product/generate-missing-barcodes` endpoint is
   **unchanged and still works** (see below) — it's just not surfaced in the UI. The current workflow is
   **this filter + per-row Generate**. (To bring the button back, restore the toolbar block in
   `ProductsList.tsx` — it's in git history.)

### ✅ E. Already has a barcode → no-op (409)
1. Trigger Generate on a product that **already has a barcode**.
2. **Expect:** a clear error toast **"This product already has a barcode."** — the existing (real)
   barcode is **never overwritten**.

### ❌ F. Not a super-admin → nothing to see
1. Log in as a **store admin** or a **warehouse-manager**. Note: the Product Master page itself is
   gated to super-admin only (since 2026-08-13), so neither can reach it.
2. Even if the API is called directly, generation returns **403** — for a warehouse-manager too.

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
- **`missingBarcode` list filter:** `product/controller.js` `list` reads `?missingBarcode=true`;
  `product.repository.js` `list` applies `{ barcode: { $in: [null, ""] } }` (matches absent/null/empty).
- Admin UI: `haper-admin/src/pages/Products/{ProductsList,BarcodeModal}.tsx`, `haper-admin/src/api/products.ts`
  (the "Missing barcode only" toggle + `missingBarcode` param; the bulk-generate toolbar button is hidden).
- EAN-13 label rendering: `haper-admin/src/utils/shelfLabelPrint.ts` (`isValidEan13` / `optionsFor`).
- Backend tests: `haper-backend/packages/admin/__tests__/product-barcode.test.js`, `ean.utils.test.js`,
  and `product-master-crud.test.js` (the `missingBarcode` filter).
