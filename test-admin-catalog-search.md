# Test: admin catalogue search — multi-word + iId (items & products)

**Area:** Backend admin catalogue search + admin FE item list.
- `packages/shared/utils/common.utils.js` (`tokenizedSearchClauses`)
- `packages/shared/repositories/item.repository.js` (`getAdminCatalogPage`, `getAdminCatalogSummary`)
- `packages/shared/repositories/product.repository.js` (`list`)
- `haper-admin/src/pages/Items/ItemsList.tsx` (show `iId` in each row)

**PR/deploy:** backend → `dev` (`dapi.haper.in`); admin FE → `damin.haper.in`. No client-app change.

## Why
Two gaps in admin search:
1. **Word order mattered.** Search was a single regex, so a product named
   **"Amul Lassi"** was found by `lassi` or `amul` but **not** by `lassi amul`
   (the literal substring "lassi amul" doesn't exist in the name). Staff type
   words in any order, so the useful match ("all these words appear") was missed.
2. **iId display.** The **product** list already showed the `iId` (e.g. `BI35814`)
   under the name; the **item** list did not, so staff couldn't read an item's
   product identity at a glance (needed it to spot/annotate duplicates).

Searching *by* `iId` already worked in both lists (it was one of the regex `$or`
fields) — that behaviour is unchanged.

## What changed
- New shared helper **`tokenizedSearchClauses(search, fields)`** splits the query
  into words and requires **every** word to match (case-insensitive substring)
  **at least one** field — different words may hit different fields. Returns
  `$and` clauses (composes with the missing-cost/missing-barcode filters instead
  of clobbering `$or`). One word → identical to the old single regex (backward
  compatible; full-iId search unchanged).
- **Item list** (`getAdminCatalogPage`) + **item counts** (`getAdminCatalogSummary`)
  now use the helper over the SAME field set (`name, brand, barcode, iId,
  location, tags, category.name, subCategory.name`) so the count always matches
  the rows shown.
- **Product list** (`ProductRepository.list`) uses the helper over
  `name, brand, barcode, iId`.
- **ItemsList.tsx** renders a monospace `iId` line under the name (mirrors
  `ProductsList`), shown only when `item.iId` exists.

## Steps — backend jest (in-memory)
`cd packages/admin && NODE_ENV=test npx jest items.test.js product-master-crud.test.js`

Item list — seed an item `name:"Amul Lassi", brand:"Amul", iId:"BI900111"` plus a
decoy `name:"Amul Butter"` (shares only "amul"):
- ✅ `q=lassi` → returns Amul Lassi.
- ✅ `q=amul` → returns Amul Lassi.
- ✅ `q=lassi amul` **and** `q=amul lassi` → returns Amul Lassi (order-independent).
- ✅ `q=amul lassi` → **excludes** "Amul Butter" (AND, not OR — "butter" lacks "lassi").
- ✅ `q=BI900111` → returns Amul Lassi (search by iId).
- ✅ `q=amul zzznope` → returns nothing (a word matching no field kills the row).

Product master list — same matrix via `GET /admin/product?search=` (masters
`BI900222 "Amul Lassi"`, `BI900333 "Amul Butter"`):
- ✅ single word / reversed order / by iId all find `BI900222`.
- ✅ `amul lassi` excludes `BI900333`.

Regression: full `items.test.js` + `product-master-crud.test.js` (85 tests) green.

## Steps — admin FE (`damin.haper.in`, manual)
- ✅ Items page → each row shows the `iId` (e.g. `BI35814`) in monospace under the
  name, above `brand • weight unit`. Items with no `iId` show no extra line.
- ✅ Items search box: type `lassi amul` → "Amul Lassi" still listed. Type an
  `iId` → that item listed.
- ✅ Products page: unchanged display; `lassi amul` finds the master.

## Edge cases / notes
- Query capped at 64 chars and **6 words** (`maxWords`) — extra words are ignored,
  not errored. Each word is `escapeRegex`-escaped (no regex injection / ReDoS).
- Different words may match different fields — e.g. an item `name:"Lassi"`,
  `brand:"Amul"` is still found by `amul lassi` (word→field mapping is free).
- **Not touched:** the Atlas `$search` autocomplete (`GET /admin/item/search` →
  `ItemRepository.search`, index `item_search`). That dropdown is a separate
  surface and the index has been stale/absent on dev — revisit separately if the
  autocomplete needs the same multi-word behaviour.
- Item list & summary share one field list on purpose; if you add a searchable
  field, add it to `ADMIN_ITEM_SEARCH_FIELDS` (one place) so counts stay in sync.
