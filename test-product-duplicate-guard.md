# Test: duplicate-product guard (Product Master create)

**Area:** Backend admin — Product Master creation.
`packages/admin/src/routes/product/controller.js` (`create`) + `packages/shared/repositories/product.repository.js` (`findDuplicate`).
**PR/deploy:** backend-only → `dev` (`dapi.haper.in`). No client change.

## Why
Prod had **13 duplicate product groups** — the same product entered twice (e.g. two
"Sugar - 500gm", two "Lizol 500 ml", the Goldiee masalas), each minted its own `iId`,
so it showed **twice in the app at different prices**. Root cause: `products` has a
DB-unique index on **barcode** and on **iId**, but **none on name+weight+unit** — so a
human re-adding an existing product (instead of editing it) created a second master,
which then fanned out a second per-store item. Brand typos in the dupes (`Reckit` vs
`Reckitt`, `NIne` vs `Nine`) confirm they were accidental re-entries.

## The guard
`POST /admin/product` now calls `ProductRepository.findDuplicate(fields)` **before**
creating. It blocks (HTTP **409**) when an existing master clashes by:
- **Catalogue identity** — same `name` (case/whitespace-insensitive) **+ weight + unit**, or
- **Barcode** — same non-empty barcode (also DB-unique, but this gives a friendly message
  pointing at the existing product instead of a raw E11000).

Message names the existing product + `iId` ("… already exists as iId BIxxxxx. Edit it
instead of creating a duplicate.") so the admin edits the real one.

## Steps (backend jest, in-memory — `cd packages/admin && NODE_ENV=test npx jest product-master-crud.test.js`)
- ✅ **Blocks name+weight+unit dup** — create "Sugar - 500gm / 500 / g", then create
  "  sugar - 500GM  / 500 / g" → **409**, message matches `already exists`.
- ✅ **Different size is allowed** — "Sugar - 500gm / 1 / kg" after the above → **200**
  (different weight+unit ≠ duplicate).
- ✅ **Blocks barcode dup** — create with `barcode 8901234567890`, then create a
  differently-named product with the same barcode → **409**, message matches `barcode`.
- ✅ Regression: all 6 product-master-crud + 101 product/items admin tests still pass.

## Edge cases / notes
- Guard is **create-only**. Renaming an existing product into a clash via edit
  (`PATCH /admin/product/:id`) is NOT yet guarded — follow-up if needed.
- `assign` already skips creating a second item when `{storeId, iId}` exists, so the
  duplicate item path is only via a duplicate *master* — which this closes.
- **Existing** dupes are not auto-removed — clean them from the audit CSV
  (`~/Downloads/haper-duplicate-items.csv`: per copy → KEEP/DELETE + reason + image).
  For each group: keep the copy with barcode + valid cost + real shelf, move any stock
  off the copies you delete, then delete/deactivate the losers at **both** the item and
  the Product-Master level (they map 1:1 by `iId`).
