# Test: Generate internal barcodes (super-admin) — for products with no barcode

**Area:** Admin panel → **Catalog → Items** (`damin.haper.in` on dev). Super-admin only.
**Who can use it:** **super-admin only** (buttons are hidden for everyone else; the API is `requireRole(SUPER_ADMIN)`).
**Backend:** new endpoints on the items router; a shared EAN util. **Needs BOTH deploys** — backend
`dapi.haper.in` **and** admin `damin.haper.in`.

## What this is (real example)

Many products (loose / repacked goods) ship with **no barcode**, so they get **skipped** on shelf
labels and can't be scanned at the counter. This lets a super-admin **mint an internal barcode** for
them — one product at a time or all-missing at once. The code is written to the **product master and
every store's copy**, so it immediately prints on shelf labels and scans at POS and in the picker.

**Example:** *Anda Tilauri* has a blank barcode. Super-admin clicks **Generate barcode** → the system
mints `2000000047126` → saves it to the master + all stores → the item now prints a scannable label
and beeps at the POS scanner.

## The barcode scheme (standard EAN-13, derived from the iId)

```
EAN-13 = "2"  +  <the product's iId digits, left-padded to 11>  +  <check digit>
```
- **`2`** — the GS1 "in-store" range: real manufacturer barcodes never start with it, so an internal
  code **can never collide with a real scanned barcode**.
- **iId digits** — the product's own unique `iId` with the letters dropped (`BI4712` → `4712`),
  left-padded to 11 digits. Because the `iId` is unique per product, **no two products ever get the
  same code** (uniqueness is inherited from the iId — no counter, fully deterministic).
- **check digit** — the standard EAN-13 check digit (catches scan errors).

Worked example: `BI4712` → digits `4712` → payload `200000004712` → check `6` → **`2000000047126`**.

## Endpoints (super-admin only)

- `POST /admin/item/:itemId/generate-barcode` — resolves item → its product (`iId`); mints + applies
  the code **only if the product has no barcode** (else **409** "already has a barcode"). Returns
  `{ barcode, product, syncedItems }`.
- `POST /admin/item/generate-missing-barcodes` — for the **current store's** barcode-less products
  (deduped by product, paged; `limit` default 200 / max 500 per call). Returns
  `{ generated, skipped, failed, remaining, failures }`. `remaining > 0` means "run again for the rest"
  (no auto-loop).

Both write through the same **transactional** path `setBarcode` uses: it pre-checks uniqueness (no
other product / store item may hold the code) and **fans the code out to the master + every store's
item** in one transaction. Legacy rows (an `iId` with no materialised master) still fan onto the item
rows; the missing master is skipped, not 404'd.

---

## The walkthrough

### ✅ A. Per-item generate (super-admin, barcode-less item)
1. Log in to `damin.haper.in` as **super-admin**, open **Catalog → Items**, pick a store.
2. Find an item with **no barcode** (use the **Missing Barcode** filter). In its Actions cell you'll
   see a **Generate barcode** button (only shows when you're super-admin AND the item has no barcode).
3. Click it. **Expect:** a toast **"Generated barcode 2000000…"**, the row refreshes, and the barcode
   is now filled in. A spinner shows on the active row while it runs.

### ✅ B. The code is a real EAN-13, on master + all stores
1. Note the generated code — it's 13 digits starting with **`2`**, and the middle digits are the
   product's `iId`.
2. Switch to another store that stocks the same product (if any) — **Expect** the **same barcode**
   there (it fanned out).
3. Scan/print: on the **Shelf Labels** page the item now **prints** (no longer skipped), rendered as a
   real **EAN-13** barcode; scanning it at POS resolves the item.

### ✅ C. Already has a barcode → no-op (409)
1. Click Generate (via the modal, below) on an item that **already has a barcode**.
2. **Expect:** a clear error toast **"This product already has a barcode."** — the existing (real)
   barcode is **never overwritten**.

### ✅ D. In-modal Generate button
1. Open an item's edit modal (**Edit**). The barcode field is read-only.
2. For a **barcode-less** item as super-admin, a **Generate** button sits beside the field.
3. Click it → **Expect** the code toast, and the modal closes/refreshes so the field shows the new code.

### ✅ E. Bulk "Generate for all missing"
1. Turn on the **Missing Barcode** filter. Beside it, a **Generate missing barcodes (N)** button appears
   (super-admin only; the `(N)` count shows while the Missing Barcode filter is on).
2. Click it → confirm the prompt. **Expect:** a toast like **"Generated 180, skipped 0, failed 0"**, and
   the list refreshes. If more than one page-worth remain, it appends **"— run again for the rest"**
   (`remaining > 0`); click again to continue. It **never silently truncates**.

### ❌ F. Not a super-admin → nothing to see
1. Log in as a **store admin** (not super-admin).
2. **Expect:** **no** Generate buttons anywhere (per-row, modal, or bulk). The API also rejects them
   with **403** if called directly.

### ✅ G. Shelf-label rendering unaffected for non-EAN codes
1. On the Shelf Labels page, an item with a **real EAN-13** barcode (e.g. a generated `2000000047126`)
   renders as **EAN-13** symbology; an item with an **alphanumeric / non-EAN** barcode still renders as
   **Code 128 exactly as before**. (No change to existing labels.)

### Edge cases
- **iId with more than 11 digits** (extremely unlikely at this scale): generation returns a clear error
  for that item; in bulk it's counted under **failed** with the reason — it is never truncated.
- **Rare collision** (the derived code somehow already exists): reported for that item (not silently
  changed); in bulk it's a **failed** with reason.

---

## What deploy this needs
- **Backend → `dapi.haper.in`** (the new endpoints + EAN util) **AND admin → `damin.haper.in`** (the
  Generate buttons + EAN-13 label rendering). Deploy the **backend first**, then admin.

## Source (for reference)
- EAN util: `haper-backend/packages/shared/utils/ean.utils.js` (`buildEan13FromIId`, `checkDigit`, `isValidEan13`).
- Repo fan-out: `haper-backend/packages/shared/repositories/product.repository.js` (`generateBarcodeForIId`).
- Endpoints: `haper-backend/packages/admin/src/routes/items/{controller,router,validator}.js`.
- Admin UI: `haper-admin/src/pages/Items/ItemsList.tsx`, `ItemModal.tsx`.
- EAN-13 label rendering: `haper-admin/src/utils/shelfLabelPrint.ts` (`isValidEan13` / `optionsFor`).
- Backend tests: `haper-backend/packages/admin/__tests__/items.test.js`.
