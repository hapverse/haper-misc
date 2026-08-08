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

---

## Fix (2026-08-09): catalog search wasn't store-scoped — duplicate rows on Warehouse → Stock Transfers

**Area:** same endpoint as above (`GET /admin/item/catalog`), plus the admin FE screens that call it.
- `packages/admin/src/routes/items/controller.js` (new `resolveCatalogStoreId(req)` helper)
- `packages/admin/src/routes/items/validator.js` (new optional `storeId` query param)
- `packages/shared/repositories/item.repository.js` (catalog query can now filter on a **list** of
  store ids `$in`, not just one)
- `haper-admin/src/pages/Warehouse/useItemSearch.ts`
- `haper-admin/src/pages/Warehouse/ReplenishmentPage.tsx`

**PR/deploy:** needs **both** sides on `dev` — backend (`dapi.haper.in`) **and** admin FE
(`damin.haper.in`). If only the FE ships, the old backend rejects the new `storeId` param and the
search errors. If only the backend ships, the FE still isn't sending `storeId` and the duplicate
rows remain. Deploy them together.

### The bug (what the user saw)
Warehouse → **Stock Transfers** ("Move stock from a warehouse to a store. Store stock only rises
on receipt.") → **New transfer** → Source warehouse **"Chhapra - Warehouse (Bihar)"** → Target
store **"Haper - Bhagwan Bazar"** → type/scan barcode `8901052030316` → the item-search dropdown
returned **"Tata Agni Leaf Tea - 250gm" TWICE**, each with its own "+ add" button.

### Why (plain explanation)
This was never duplicate data. In Haper, **every store keeps its own item record for the same
physical product** — same barcode, different store, by design. Example: barcode `8901052030316`
exists once for "Haper Mart" and once for "Haper - Bhagwan Bazar" — that's correct and expected
(an offline check of the real data found **zero** same-store duplicates across 3383 items; the
database already enforces one record per store per barcode).

The real problem: the search wasn't filtered to the store you'd picked. The screen told the server
"only show me Bhagwan Bazar items" via a request **header** — but the server's login/permission
layer **ignored that header** for warehouse roles (`warehouse_manager`, `warehouse_staff`), and also
whenever a super admin had no store selected in the top switcher. With no store to filter on, the
search ran across **every store**, so a product that exists in two stores came back once per store.

### What changed
- New backend helper `resolveCatalogStoreId(req)` works out which store(s) to filter the catalog
  search on for the logged-in role.
- The catalog query can now filter on a **list** of store ids (`$in`) — needed for "every store my
  warehouse serves", not just a single store.
- Admin FE (`useItemSearch.ts`) now sends the store id as a **query parameter** as well as the
  existing header — the header alone was being dropped by the backend.
- `ReplenishmentPage.tsx`'s "Request stock" item picker is now scoped to the requesting store the
  same way.
- Fixed in passing: a store id typed in **UPPERCASE hex** used to be wrongly rejected with "Store is
  not served by this warehouse" — it now works.

### Rules now enforced

| Who is logged in | Store selected in top switcher? | What the item search returns |
|---|---|---|
| Store admin / manager / support | (always has one) | Their own store's items ONLY — even a hand-crafted request naming another store is ignored. |
| Super admin | yes | That store's items. |
| Super admin | no, but the screen names a target store (Transfers) | That target store's items. |
| Super admin | no, and no target store | Every store's items (global) — unchanged, intended. |
| Warehouse manager / staff | (no store switcher) | On Transfers/Replenishment where a store is chosen: that store's items only. |
| Warehouse manager / staff | picks a store their warehouse does NOT serve | ❌ Blocked — "Store is not served by this warehouse." |
| Warehouse manager / staff | no store named at all | **NEW:** only the stores their warehouse serves — no longer the whole company's catalogue. |
| Warehouse that serves ZERO stores | — | Empty list. Never a global list. |

### Steps — backend jest (in-memory)
`cd packages/admin && NODE_ENV=test npx jest item-catalog-store-scope.test.js`
- ✅ 14 cases, one per row of the table above plus the uppercase-hex case, all green.
- Helper added: `packages/admin/__tests__/testUtils.js`.

### Steps — admin FE (`damin.haper.in`, manual)
1. ✅ **Reported repro:** log in as a warehouse manager/staff → Warehouse → **Stock Transfers** →
   **New transfer** → Source **"Chhapra - Warehouse (Bihar)"** → Target store **"Haper - Bhagwan
   Bazar"** → search/scan barcode `8901052030316` → exactly **ONE** row for "Tata Agni Leaf Tea -
   250gm" (not two).
2. ✅ Same barcode, target store set to the **other** store instead → still exactly **one** row, and
   it's that other store's record (different item id/price/stock than step 1's row).
3. ❌ Pick a store the logged-in warehouse does **not** serve as the target → blocked with **"Store
   is not served by this warehouse."**
4. ✅ Log in as a warehouse whose warehouse serves **no** stores → item search returns an **empty
   list**, not the whole company's catalogue.
5. ✅ A store id typed in **UPPERCASE** hex (where lowercase used to be required) → no longer
   wrongly rejected.

### Regression checks (same search, must stay unchanged)
These screens call the same catalog search — re-check each still returns the correct, unaffected
results:
- ✅ Items list
- ✅ Categories
- ✅ Inventory Group modal
- ✅ Shelf Labels
- ✅ POS → New Sale
- ✅ Warehouse → Replenishment → "Request stock" item picker (now also store-scoped — confirm it
  shows only the requesting store's items, not global)

### Edge cases / notes
- A **deactivated** store that the warehouse serves quietly disappears from the list; naming it
  explicitly gives "Store is not served by this warehouse." — known, accepted behaviour, not a new
  bug.
- **Known limitation:** once a second store goes live (e.g. Chapra), a warehouse user who opens the
  search **without** choosing a target store will see **one row per served store** for the same
  product. That's safe and by design (they only ever see stores their warehouse serves) but it is
  **not de-duplicated**. In normal use this shouldn't surface — both real screens (Transfers,
  Replenishment) force a store to be picked first.

### Not fixed in this pass (flagged for a future session)
1. **Security, separate change needed:** the transfer **list** endpoint
   (`packages/admin/src/routes/transfer/controller.js`, lines ~29-38) lets a `?storeId=` /
   `?warehouseId=` query param **override the tenancy lock for every role** — a store admin can read
   another store's transfers, a warehouse user another warehouse's discrepancy report. Deferred here
   only because that file already carries unrelated unreviewed work-in-progress. — **FIXED
   2026-08-09, see the section below.**
2. `getAdminCatalogSummary` (the counts endpoint next to this list) was **not** given the same store
   scoping. Harmless today, but counts could contradict the rows shown if someone adds the parameter
   there later.
3. A shared `assertStoreServedByWarehouse` helper should be extracted — the same check is copied
   across several controllers, and one remaining copy still has the uppercase-hex bug fixed here.

---

## Fix (2026-08-09): Stock Transfers list & Transfer Discrepancies report weren't locked to your own store/warehouse

**Area:** two admin API endpoints — same class of bug as the fix above, different endpoints.
- `GET /admin/transfer` — Warehouse → **Stock Transfers** list
- `GET /admin/transfer/discrepancies` — Warehouse → **Transfer Discrepancies** report
- `packages/admin/src/routes/transfer/controller.js`

**PR/deploy:** backend only, `dapi.haper.in`. **No admin FE change** — neither screen sends
`storeId`/`warehouseId` today, so nothing on screen changes for anyone. Already committed and
pushed to `dev`, inside commit `45be680` — it got swept into an unrelated feature commit by a
parallel commit of the whole tree, so it doesn't have its own commit; look inside `45be680` for the
diff.

### The bug (what a hand-crafted web address could do)
Both endpoints support optional `?storeId=` and `?warehouseId=` filters, meant only for the super
admin to narrow results. The code applied them for **every** role, and they **overwrote** the normal
lock that keeps you inside your own store or warehouse. Nothing had to be hacked — just a different
id typed into the browser address bar.

Two real examples of what used to work:
- A **store admin** for one store could open `.../admin/transfer?storeId=<another store's id>` and
  read **that other store's** transfer list — item names, SKUs, quantities, the other store's name.
- A **warehouse staff** member could open
  `.../admin/transfer/discrepancies?warehouseId=<another warehouse's id>` and read that other
  warehouse's shortfall report — **which shows rupee values**.

### Rules now enforced (identical on both endpoints)

| Who is logged in | What they can filter to |
|---|---|
| Super admin | Anything — unchanged. Any store, any warehouse, or no filter (sees everything). |
| Store admin / manager / support | Always locked to their own store. Their **own** store id works exactly like passing no filter at all. Another store's id → ❌ "You do not have access to this store." |
| Warehouse manager / staff | Always locked to their own warehouse. Their **own** warehouse id works; another warehouse's id → ❌ "You do not have access to this warehouse." They may narrow further to a store their warehouse **serves**; a store served by a **different** warehouse → ❌ "Store is not served by this warehouse." |

Fixed in passing: a store id typed in **UPPERCASE** used to be wrongly rejected — it now works the
same as lowercase (the same underlying quirk as the catalog-search fix above).

### Steps — backend jest (in-memory)
`cd packages/admin && NODE_ENV=test npx jest transfer-list-scope.test.js`
- ✅ 24 cases covering both endpoints (one set per row of the table above, ×2 endpoints, plus the
  uppercase-id case), all green.
- Full backend regression: **66 suites / 1139 tests** passing.

### Manual verification (API only — neither screen sends these params)
Since no screen sends `storeId`/`warehouseId` today, there's nothing to click through in the admin
FE for the fix itself. Verify with a direct API call (Postman/curl, logged-in session) against
`dapi.haper.in`:
1. ✅ **The original attack, store side (most important):** log in as a store admin → call
   `GET /admin/transfer?storeId=<a different store's id>` → blocked: "You do not have access to this
   store."
2. ✅ **The original attack, warehouse side (most important):** log in as warehouse staff → call
   `GET /admin/transfer/discrepancies?warehouseId=<a different warehouse's id>` → blocked: "You do
   not have access to this warehouse."
3. ✅ Same store admin → call with **their own** store id → identical rows to calling with no
   `storeId` at all.
4. ✅ Same warehouse staff → call with `storeId=<a store their warehouse serves>` → narrowed to that
   store, still succeeds.
5. ❌ Same warehouse staff → call with `storeId=<a store a DIFFERENT warehouse serves>` → "Store is
   not served by this warehouse."
6. ✅ Log in as super admin → call either endpoint with any `storeId`/`warehouseId`, or with none at
   all → unchanged, works exactly as before.

### Regression check — normal screens must look untouched
None of these send `storeId`/`warehouseId`, so nothing on screen should change for anyone:
- ✅ Warehouse → **Stock Transfers** list
- ✅ **Warehouse Dashboard**
- ✅ Warehouse → **Transfer Discrepancies**

### Edge cases / notes
- A store a warehouse serves but which is currently **deactivated** quietly disappears from the
  allowed list — naming it explicitly still gives "Store is not served by this warehouse." This is
  known, existing behaviour (same as the catalog-search fix above), not a new bug — don't re-report
  it.

### Not fixed in this pass (flagged for a future session; reviewer-rated)
1. **HIGH — same bug, stock-movement ledger:** `packages/admin/src/routes/ledger/controller.js:28-29`.
   `VIEW_LEDGER` is held by both warehouse manager and warehouse staff, so
   `GET /admin/ledger?storeId=<another store>` returns another tenant's full stock-movement history.
2. **HIGH — same bug, worse, in replenishment:**
   `packages/admin/src/routes/replenishment/controller.js:63-67`. The lock is wrongly applied even to
   the **super admin** (narrows them by mistake), and then every role can override both filters.
   Reachable by store roles and warehouse roles.
3. **MEDIUM — no tenancy check at all on "get one by id":**
   `packages/admin/src/routes/replenishment/controller.js:75-83` and
   `packages/admin/src/routes/transfer/controller.js:665-673`. Knowing a record's id is enough to
   read it, regardless of which tenant it belongs to.
4. The role-check logic is now hand-copied in **four places** (this fix, ledger, replenishment ×2).
   It should become one shared helper — the day one copy drifts, one endpoint is wrong.
