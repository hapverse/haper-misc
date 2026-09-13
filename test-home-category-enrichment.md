# Customer home category-list enrichment — Test Guide

Covers the enrichment fields added to **`GET /user/home/category`**: `itemsCount`,
`subCategoriesCount` ("aisles"), and `cheapestPrice` per category tile. Against **dev**
(`dapi.haper.in`). Each step says **what to do** and **what to expect** (✅ good / ❌ should
be blocked).

> **Backend only — no client (Android/iOS/web) consumer wired up yet.** This endpoint needs a
> backend deploy to dev before any app team can start integrating against it. There is nothing
> to click through in the customer app for this yet — verify via the API directly (curl/Postman)
> or via the automated tests below.

> **Requires the index migration `haper-misc/haper-sync/migrate-item-indexes-category-meta.js`
> to be run against dev before this performs as designed** — otherwise every category-list
> request does an uncovered document fetch (IXSCAN + FETCH on every active item in the store)
> instead of being answered straight from the index.

---

## 0. Prerequisites
- Backend on **dev**, deployed with the enrichment fields
  (`packages/shared/repositories/category.repository.js#getStoreCategoryMeta` +
  `packages/user/src/routes/home/controller.js#getAll`).
- The covering index created via `node migrate-item-indexes-category-meta.js`
  (`idx_items_store_status_cat_subcat_cover` on the `items` collection).
- A logged-in customer's auth token + a store's `x-store-id` header (same auth as every other
  `/user/home/*` route).
- A store with a few active categories, sub-categories, and items, including at least one item
  with no `subCategory` set.

---

## 1. Fields show up correctly
1. Call `GET /user/home/category?page=1` for a store with active items.
   ✅ Each category object has `itemsCount`, `subCategoriesCount`, and `cheapestPrice` present
   (never omitted, even when 0/null — clients decode these directly, no `?? 0` fallback needed).
   ✅ `itemsCount` = count of this store's ACTIVE, **IN-STOCK** (`quantity > 0`) items whose own
   `category._id` matches this category. An active-but-out-of-stock item does NOT count — the
   item-list screen the tile leads to (`ItemRepository.getPaginatedItemsBasedOnCatSubCat`) hides
   out-of-stock items from customers, so counting them would show a tile like "4 items" that leads
   to an empty (or partly empty) list.
   ✅ `cheapestPrice` = the lowest `sellingPrice` among those **in-stock** items only (raw catalog
   price — **not** discount-adjusted; the item list one tap later may show an even lower price via
   an active discount, but never a higher one). An out-of-stock item's price, even if cheaper, must
   never surface here.
   ❌ An inactive (soft-deleted / disabled) item must never count towards `itemsCount` or
   `cheapestPrice`.
   ❌ An active but out-of-stock item (`quantity <= 0`) must never count towards `itemsCount` or
   set `cheapestPrice` — e.g. a category with 3 active items where only 1 is in stock must show
   `itemsCount: 1` and `cheapestPrice` equal to that one item's price, even if one of the 2
   out-of-stock items is cheaper.
   ✅ Edge case: a category where EVERY active item is out of stock still shows up in the list
   (membership only checks `status: ACTIVE`, not stock) but with `itemsCount: 0`,
   `cheapestPrice: null` **and `subCategoriesCount: 0`** — nothing behind it is buyable, so no
   aisle tile is offered either (see §2, `subCategoriesCount` is stock-aware too).

## 2. `subCategoriesCount` matches the drill-down screen exactly
This is the field that shipped wrong once — verify it carefully.
1. Tap a category tile (`GET /user/home/category`) and note its `subCategoriesCount`.
2. Open that category's drill-down (`GET /user/home/sub-category/:categoryId`).
   ✅ The `subCategories` array length on the drill-down **must equal** the tile's
   `subCategoriesCount` — always, not "roughly."
3. **The semantics that make this true**: a sub-category counts under a parent category ONLY when
   a real, buyable item is filed under **both** — i.e. there is ≥1 item in this store with
   `status: ACTIVE` **and** `quantity > 0` **and** `item.category._id` = this category **and**
   `item.subCategory._id` = this sub-category, and the sub-category master itself is active and
   lists this category in its own `category[]` array. That AND-predicate is exactly what the
   drill-down tile list (`SubCategoryRepository.getAll`) and the item list one tap later
   (`ItemRepository.getPaginatedItemsBasedOnCatSubCat`) enforce — which is why the three always
   agree.
   ✅ Edge case (**changed** — this used to behave the opposite way and was a bug): a sub-category
   X whose master record lists `category: [C, D]` counts towards C's `subCategoriesCount` only if
   some in-stock item has its OWN `item.category` set to C. If every item referencing X is filed
   under D, X counts for D **only** — it must NOT appear under C, because tapping it under C would
   open an empty item list.
   ✅ Edge case: a sub-category Z where the item is filed correctly under both the category and Z,
   but every such item is **out of stock** (`quantity <= 0`), must NOT be counted and must NOT show
   as a tile — customers can't buy anything behind it, so the tile would lead to an empty list.
   One in-stock item is enough to bring the tile back.
   ✅ Edge case: a sub-category Y whose master record lists `category: [D]` only must NOT count
   towards C's `subCategoriesCount`, even if some item under C's own `category` field happens to
   reference Y as its `subCategory` (a stale/inconsistent item-level tag). This can mean
   `itemsCount > 0` while `subCategoriesCount === 0` for the same category — that is CORRECT, not
   a bug, because the drill-down for that category would genuinely list 0 sub-categories.
   ❌ A soft-deleted (inactive) sub-category must never be counted, even if items still reference
   it.

## 3. Pagination — page 2+ still enriched
1. Seed 10+ categories so the list spans multiple pages, call
   `GET /user/home/category?page=1` then `?page=2`.
   ✅ Every category on page 2 (and beyond) has correct, non-zero `itemsCount`/`cheapestPrice`
   for that specific category — not defaults/zeros just because it wasn't on page 1.

## 4. Fail-open behavior
1. Simulate `getStoreCategoryMeta` throwing (aggregation failure, index missing, DB hiccup, etc).
   ✅ `GET /user/home/category` still returns **200** with the base category list — never a 5xx.
   ✅ Every category defaults to `itemsCount: 0`, `subCategoriesCount: 0`, `cheapestPrice: null`
   instead of surfacing the error.
   ✅ The failure is logged (`console.error`) but never re-thrown — this holds even if the
   rejection isn't an `Error` instance (e.g. a thrown string/null), since the catch handler uses
   safe optional-chaining access on the error message.

---

### Notes for devs
- Route: `GET /user/home/category` → `packages/user/src/routes/home/router.js` →
  `controller.getAll` → `CategoryRepository.getAll` (base list) +
  `CategoryRepository.getStoreCategoryMeta` (enrichment, run in parallel, fail-open).
- `getStoreCategoryMeta` in `packages/shared/repositories/category.repository.js` aggregates this
  store's active items once, grouped by the item's own `category._id`, and derives **all three**
  fields from that same item-side grouping — `itemsCount`, `cheapestPrice` and the
  `subCategoryIds` set behind `subCategoriesCount`. The count and the tile list are therefore in
  LOCKSTEP by construction: `SubCategoryRepository.getAll` (the drill-down tile list) applies the
  same AND-predicate — `item.category._id` = parent, `item.subCategory._id` = the sub-category,
  `storeId` = this store, `status: ACTIVE`, `quantity > 0` — inside its `$lookup`'s `$expr`, and
  `getStoreCategoryMeta` reproduces it item-side, then intersects the result with the active
  sub-category masters whose own `category[]` array lists that parent. **Any change to one of
  these two predicates must be mirrored in the other**, or the tile count and the tile list drift
  apart again (that drift is exactly the bug this guide's §2 documents).
- All three fields get their stock-awareness from a `$cond` on `quantity` INSIDE the `$group`
  accumulators — `$sum`/`$min`/`$addToSet` each wrap `{ $cond: [{ $gt: ["$quantity", 0] }, …] }`
  (`$addToSet` contributes `null` for an out-of-stock item, which the JS loop below skips). The
  outer `$match` stays `{storeId, status}` only, with **no** `quantity` predicate, on purpose:
  moving the quantity check up into the `$match` would drop all-out-of-stock categories out of the
  aggregation entirely and regress `itemsCount: 0` / `cheapestPrice: null` for them. Keep the
  check in the accumulators.
- ₹0-priced items are NOT excluded from `cheapestPrice` — there is no existing convention in this
  codebase for filtering `sellingPrice > 0` out of customer-facing item queries (checked
  `item.repository.js`), so an in-stock ₹0 item is treated as a genuine (if unusual) price, same as
  the item-list screen it leads to would show.
- Covering index: `idx_items_store_status_cat_subcat_cover` on
  `{ storeId, status, "category._id", "subCategory._id", sellingPrice, quantity }` (in
  `packages/shared/models/items.schema.js`, mirrored by the one-time migration
  `haper-misc/haper-sync/migrate-item-indexes-category-meta.js`, run via that separate repo — NOT
  auto-built at boot, this collection is not in `ensureIndexesFor`). `sellingPrice` and `quantity`
  are both part of the key because the aggregation's accumulators read both — verified via
  `explain("executionStats")` on `mongodb-memory-server`: without `quantity` in the key, the query
  planner drops to an uncovered FETCH of every matched document (`totalDocsExamined` = every active
  item in the store) instead of a covered index-only scan (`totalDocsExamined: 0`).
- Covered by `packages/user/__tests__/home.test.js` (`GET /user/home/category — enrichment
  fields` and `— enrichment edge cases` describe blocks): itemsCount/cheapestPrice/
  subCategoriesCount happy path, store isolation, always-present keys, no-subCategory items,
  soft-deleted sub-category exclusion, the sub-category-drill-down-parity mismatch case (own
  `category[]` array vs. item's `category` field), pagination page-2+, fail-open on a
  simulated aggregation failure, stock-awareness (in-stock vs. out-of-stock trap price), and the
  all-out-of-stock case (itemsCount 0 / cheapestPrice null / subCategoriesCount 0, cross-checked
  against the drill-down tile list).
- Also covered by `packages/user/__tests__/category-subcategory-listing-gap.test.js` — end-to-end
  tile-vs-drill-down parity across both causes of the "tile leads to an empty list" symptom:
  (a) the category mismatch (multi-parent sub-category whose only item is filed under the other
  parent) plus its correctly-filed counterpart, and (b) the stock gap (all items out of stock →
  no tile and `subCategoriesCount: 0`; one in-stock item → tile returns, drill-down lists it).
