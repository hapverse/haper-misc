# Test: multi-category items — Phase 1 (`taxonomy` field + normaliser + backfill)

**Area:** Backend only — item/product write paths.
`packages/shared/models/items.schema.js`, `packages/shared/models/products.schema.js`,
`packages/shared/utils/taxonomy.utils.js` (new),
`packages/shared/repositories/item.repository.js` (`add`, `addOrUpdate`, `updateItem`, `copyItemsToStore`),
`packages/shared/repositories/product.repository.js` (`masterFieldsFromItem`, `projectionFieldsFromProduct`, `create`, `updateByIId`),
`packages/admin/src/routes/product/controller.js` (`update`),
`scripts/migrations/migrate-categories-global.js`,
`haper-backend/scripts/migrations/backfill-item-taxonomy.js` (new).
**PR/deploy:** backend-only → `dev` (`dapi.haper.in`). No client change, no API-shape change.
Plan: `haper-backend/docs/plans/multi-category-items.md` (§1, §2 = this phase).

## Why
Today a product sits in exactly ONE category and ONE sub-category. Merchandising wants a
product in several places at once — a box of chocolates is both *Snacks → Chocolates* and
*Gifting → Gift Packs*, so a customer finds it wherever they look and a "20% off Snacks"
promo still applies.

Phase 1 only adds the storage and keeps it filled. **It ships invisible** — no customer,
admin or client behaviour changes. Phase 2 gives admins the multi-select UI; Phase 3
switches the customer read paths onto the new field.

## What changed
`items` and `products` gain:

```js
taxonomy: [{ categoryId, categoryName, subCategoryId, subCategoryName }]   // default []
```

The old `category` / `subCategory` fields are **unchanged in shape** and are now the
DERIVED PRIMARY = `taxonomy[0]`. One shared normaliser
(`packages/shared/utils/taxonomy.utils.js`) owns the rules — dedupe pairs, drop pairs with
no category, cap at **5 pairs** (the approved max), derive from the legacy singular fields
when the array is empty — and every write path routes through it.

Phase 3 will query `taxonomy` with NO fallback to the singular fields, so its GO gate is
"every item/product with a category has a non-empty taxonomy". That is why every write
path had to be covered, plus a one-off backfill for rows written before this shipped.

## Steps (backend jest, in-memory only)
`cd packages/admin && NODE_ENV=test npx jest taxonomy`

- ✅ **Normaliser — dedupe** — the same (category, sub-category) pair twice collapses to one;
  the same category under TWO different sub-categories stays as two pairs.
- ✅ **Normaliser — cap at 5** — 7 pairs submitted → first 5 kept in submitted order,
  `truncated: true`. Duplicates that pushed it over the cap do NOT flag truncation.
- ✅ **Normaliser — drop bad pairs** — pairs with a null/missing `categoryId` are removed.
- ✅ **Normaliser — derive from legacy** — `{ category, subCategory }` with no taxonomy →
  one pair built from them (this is the shape every existing row has).
- ✅ **Normaliser — primary always = taxonomy[0]** — a stale singular `category` never wins
  over the first pair.
- ✅ **Normaliser — empty input** — returns `taxonomy: []` and `{_id: null, name: null}`
  primaries, and does not throw on no arguments.
- ✅ **Item create (real route)** — `POST /admin/item` with a category + sub-category →
  the stored item has `taxonomy` of length 1 matching them, and `category`/`subCategory`
  are byte-identical to before.
- ✅ **Item create with no category** — `taxonomy` stays `[]` (nothing invented).
- ✅ **Item update** — `PUT /admin/item/:id` changing `categoryId` moves BOTH the singular
  field and the pair. A legacy row with no `taxonomy` is repaired on its first edit.
- ✅ **Unrelated edit leaves taxonomy alone** — a price-only update does not prune a
  second tag.
- ✅ **Legacy `categoryId`-only edit keeps SECONDARY pairs** — an item tagged
  `[Snacks/Chocolates, Dairy]` saved from the admin form (which re-sends `categoryId` every
  time) with a new category comes back as `[Gifting/Chocolates, Dairy]` — slot 0 replaced,
  the Dairy tag untouched. ❌ before this fix: the Dairy tag was silently deleted.
- ✅ **Dedupe on promotion** — if the new primary is already one of the secondary pairs it is
  promoted, not duplicated (result has 1 pair, not 2).
- ✅ **Clearing the category clears everything** — `category: null` on a multi-pair item gives
  `taxonomy: []`; a leftover secondary is NOT promoted into the primary slot.
- ✅ **An explicit `taxonomy` array is still fully authoritative** (Phase 2 multi-select edit
  replaces the whole array — decision #2 unchanged).
- ✅ **Product master create + edit** — `POST /admin/product` fills `taxonomy`;
  `PATCH /admin/product/:id` moves it AND fans it out to every store's item copy.
- ✅ **Materialise** — a master built from an item carries the item's taxonomy up, including
  a MULTI-pair item (both pairs survive). ❌ before this fix: `materializeMissing`'s lean
  projection omitted `taxonomy`, so the master collapsed back to one derived pair.
- ✅ **Assign to store** — the item projection created by assign is stamped with the
  master's taxonomy.
- ✅ **Store clone** — `cloneStoreCatalog` copies multi-pair taxonomy as-is, and derives
  one pair for a legacy source row that has none.
- ✅ **GO-gate invariant** — after creating an item the normal way (through the route),
  `countDocuments({ "category._id": {$ne: null}, $or:[{taxonomy:{$exists:false}},{taxonomy:{$size:0}}] })`
  is 0 on both `items` and `products`.
- ✅ Regression: the `items`, `product*`, `store*`, `category` admin suites stay green —
  no response shape or category behaviour changed.

## Backfill (one-off, dev — run by the user)
`haper-backend/scripts/migrations/backfill-item-taxonomy.js` fills `taxonomy` on rows written
BEFORE this shipped. It calls the same `normaliseTaxonomy` the app uses (no reimplementation).

```bash
cd haper-backend
node scripts/migrations/backfill-item-taxonomy.js            # DRY RUN — report only (default)
node scripts/migrations/backfill-item-taxonomy.js --apply    # write
```

- Reads `NEW_DB_URI` from `.env`; **aborts** if the db name/host looks like production.
- Idempotent: only selects rows with a `category._id` and an absent/empty `taxonomy`.
- Only ever ADDS `taxonomy` — the singular fields are never written.
- Rollback: `db.items.updateMany({}, { $unset: { taxonomy: "" } })` (same for `products`).

## Manual check (admin UI, dev) — expect NO visible change
1. Item list / item edit / product master: everything looks and saves exactly as before.
2. Customer app: category tiles, drill-down and search are unchanged (nothing reads
   `taxonomy` yet).
3. In the dev DB, a freshly saved item now also has a `taxonomy` array of one pair.

## Notes / deliberate limits
- **No index yet.** `idx_items_store_status_taxonomy` (plan §3.1.4) belongs to Phase 3 and
  is NOT added here — this phase only writes the field.
- **No read path touched.** `category.repository.js`, the item drill-down,
  `discount.utils.js` and `sub-category.repository.js` are untouched by design.
- **Null shape preserved.** The normaliser rewrites the singular primary only when it
  actually points somewhere else, so a `subCategory: null` stays literally `null` rather
  than becoming `{_id: null, name: null}` in API responses. That is what keeps Phase 1
  invisible; Phase 2 (reordering pairs) is the case that genuinely re-points the primary.
- **Singular fields win on a legacy-shaped update — for the PRIMARY SLOT ONLY.** When an
  update carries only `category`/`subCategory` (every write path today), slot 0 is rebuilt
  from them and the existing secondary pairs are carried over (`[newPrimary, ...rest]`, then
  re-normalised so dedupe/cap still apply). Without the rebuild the stored pair would
  re-derive the primary straight back and the edit would silently no-op; without carrying the
  rest, every ordinary admin save would delete an item's extra tags once Phase 2 can create
  them. When an update carries `taxonomy` explicitly (Phase 2), that array wins outright.
- **Orphan category↔sub-category pairs (data, not code).** 74 items + 37 products on prod have
  a `subCategory` whose own `category[]` does not contain the item's `category._id`. Phase 1
  bakes these in as-is on purpose. Phase 2's validator would make those rows un-saveable — the
  count must be reviewed and the data decided on BEFORE Phase 2 ships. Reproduction query +
  detail: `haper-backend/docs/plans/multi-category-items.md` §3.0 "Gate check 2".
- `migrate-categories-global.js` (the category dedupe-merge migration) now remaps
  `taxonomy.categoryId` / `taxonomy.subCategoryId` alongside the singular fields, so a
  merged-away category id can't survive inside a pair.
- The product master collection was already out of that migration's scope and still is —
  unchanged, not a regression introduced here.

---

# Test: multi-category items — Phase 2 (admin API can tag MULTIPLE pairs)

**Area:** Backend only — admin API validation + controller wiring.
`packages/admin/src/middleware/taxonomy-input.js` (new),
`packages/admin/src/routes/items/validator.js` (`addItem`, `updateItem`),
`packages/admin/src/routes/items/controller.js` (`add`, `updateItem`),
`packages/admin/src/routes/product/validator.js` (`create`, `update`),
`packages/admin/src/routes/product/controller.js` (`create`, `update`),
`packages/admin/__tests__/taxonomy-admin-api.test.js` (new),
`packages/admin/src/middleware/error.js` + `packages/shared/utils/error.utils.js` (structured
`errorType`/`reason`/`details` on the wire — review fix round).
**PR/deploy:** backend-only → `dev` (`dapi.haper.in`). No customer-app change, no read path
touched. The haper-admin multi-select UI is a SEPARATE task built against this API.
Plan: `haper-backend/docs/plans/multi-category-items.md` §2 (Phase 2).

## What changed (request shape)
Both item and product-master create/update now accept an OPTIONAL `taxonomy` array. Client
sends **ids only**; names are resolved server-side, exactly like the existing `categoryId`.

```jsonc
// POST /admin/item (multipart — send `taxonomy` as a JSON STRING, like `meta`)
// PUT  /admin/item/:itemId
// POST /admin/product , PATCH /admin/product/:productId  (JSON)
{
  "taxonomy": [
    { "categoryId": "<24-hex>", "subCategoryId": "<24-hex|null>" },   // pair 0 = PRIMARY
    { "categoryId": "<24-hex>", "subCategoryId": "<24-hex>" }
  ]
}
```

Response: the item/product doc gains the resolved array (names filled in), and the existing
`category` / `subCategory` objects keep their shape as the derived primary = `taxonomy[0]`.

```jsonc
"taxonomy": [{ "categoryId": "…", "categoryName": "Snacks",
               "subCategoryId": "…", "subCategoryName": "Chocolates" }],
"category":    { "_id": "…", "name": "Snacks" },
"subCategory": { "_id": "…", "name": "Chocolates" }
```

Rules (all return **400** with a readable message **plus structured fields** the form can use
to put the error under the exact dropdown that failed):

```jsonc
{ "code": 400, "message": "Sub-category \"Sweets\" does not belong to category \"Snacks\".",
  "errorType": "TAXONOMY_INVALID",
  "reason": "TAXONOMY_SUBCATEGORY_NOT_IN_CATEGORY",   // also: TAXONOMY_PARSE_ERROR,
  //  TAXONOMY_SHAPE_INVALID, TAXONOMY_DUPLICATE_PAIR, TAXONOMY_TOO_MANY_PAIRS,
  //  TAXONOMY_EMPTY, TAXONOMY_CATEGORY_INACTIVE, TAXONOMY_SUBCATEGORY_INACTIVE
  "details": { "index": 0, "categoryId": "…", "subCategoryId": "…" } }
```

`details.index` is the 0-based ROW of the `taxonomy` array that failed — **`0` is a real value**
(the primary row), never "no index".

- at most **5** pairs (`MAX_TAXONOMY_PAIRS`, reused from the Phase-1 normaliser) — duplicates
  are reported FIRST, so six copies of one pair is a "duplicate" error, not "at most 5";
- `categoryId` must be a real **ACTIVE** category;
- `subCategoryId` must be a real ACTIVE sub-category whose OWN `category[]` contains that
  `categoryId` (only checked for pairs this edit actually CHANGES — see below);
- no duplicate (categoryId, subCategoryId) pairs in one request;
- `taxonomy: []` is refused unless the same request also carries a legacy category — an item
  must always end up in at least one category.

`taxonomy` **present ⇒ authoritative** (it beats `categoryId`/`subCategoryId` in the same
request). `taxonomy` **absent ⇒ nothing changes** — the single-category flow is byte-for-byte
what it was, so an admin client that has not been updated keeps working.

## Steps (backend jest, in-memory only)
`cd packages/admin && NODE_ENV=test npx jest taxonomy`

- ✅ Create an item with two pairs → 200, both pairs stored with names resolved, and
  `category`/`subCategory` = pair 0.
- ✅ Send `taxonomy` AND `categoryId` together → the array wins (primary = pair 0).
- ✅ Six DISTINCT pairs → 400 "at most 5 category pairs"; six copies of the SAME pair → 400
  "duplicate" (`reason: TAXONOMY_DUPLICATE_PAIR`, `details.index: 1`).
- ✅ Pair with an INACTIVE category → 400 "does not exist or is not active".
- ✅ Pair whose sub-category isn't a child of that category (the "Haldiram's Soanpapdi"
  shape from the Phase-1 review) → 400 "does not belong to category"; the same sub-category
  paired with its REAL parent still saves.
- ✅ The same pair twice in one request → 400 "duplicate".
- ✅ Create/update with NO `taxonomy` key → legacy behaviour unchanged (one derived pair).
- ✅ Edit that sends only `categoryId` on an item that already has 2 stored pairs → primary
  re-pointed, the SECOND pair survives (Phase-1 contract, re-proved at the API layer).
- ✅ `details.index` attribution: the FIRST of two pairs being the bad one returns
  `details.index: 0` (the falsy-zero case), the second returns `1`.
- ✅ A stored orphan pair is EXEMPT even when the form re-submits it verbatim: price edit that
  re-sends the stored orphan pair → 200; re-sending it alongside a genuinely new valid pair →
  200; but editing THAT row into a different orphan pair → 400 with `details.index: 0`.
- ✅ `taxonomy: []` with no category in the request → 400.
- ✅ Item that HAS a product master: a taxonomy edit routes to the master (super-admin only,
  same rule as a category edit) and fans back onto the store item.
- ✅ Audit: `item.taxonomy.change` / `product.taxonomy.change` rows carry before+after pair
  lists; an unrelated edit (price, brand) writes NO row — the audit baseline is read
  UNCONDITIONALLY, so a brand-only master PATCH no longer logs a phantom `[] → stored pairs`
  change (was 1 row, now 0).
- ✅ Regression: `items`, `product-master-crud`, `taxonomy-utils`, `taxonomy-write-paths`
  suites stay green.

## Manual check (dev, via API client until the admin UI lands)
1. `POST /admin/product` with two pairs → the master shows `taxonomy` with both, primary =
   pair 0; the auto-provisioned store items carry the same pairs.
2. `PATCH /admin/product/:id` reordering the pairs → `category` flips to the new pair 0 and
   the change fans out to every store item.
3. `PUT /admin/item/:id` with `categoryId` only (what today's admin form sends) → nothing
   about the extra pairs is lost.
4. Customer app: **still unchanged** — nothing reads `taxonomy` until Phase 3.

## Notes / deliberate limits
- **Only the pairs the edit CHANGES are validated.** An incoming pair that is identical
  (same categoryId + same subCategoryId) to one already stored is passed through with its
  stored names and never re-checked. This matters because the admin multi-select re-submits
  the item's whole taxonomy on every save: legacy rows carry orphan pairs (74 items / 37
  products on the prod dump) and validating "everything in the request" would make those rows
  permanently un-saveable the day the FE ships. This is the fallback the plan calls out in
  §3.0 "Gate check 2" — the data cleanup is still a separate, product-owner decision.
- **Taxonomy is master-owned**, like `category`: on an item whose product master exists, a
  taxonomy edit is routed to the master (403 for non-super-admins) and fanned out. Otherwise
  the next master fan-out / nightly reconcile would silently revert a per-store tagging.
- **No read path touched** — `category.repository.js`, the item drill-down,
  `discount.utils.js`, `sub-category.repository.js` and the admin FE are Phase 3 / a separate
  FE task.
- The admin multi-select UI (chip list, first chip = primary) is NOT part of this change.

---

# Test: multi-category items — Phase 3 (customer reads switch to `taxonomy`)

Branch: `dev` (backend only). Plan: `haper-backend/docs/plans/multi-category-items.md` §3–§4.
Scope of THIS slice = plan build tasks 3.2–3.5. Discount targeting (task 3.6,
`discount.utils.js` + the admin discount-rule preview) is a **separate change by another
engineer** and is not covered here.

## Why
Phases 1–2 wrote `taxonomy` and let admins tag several (category, sub-category) pairs, but
nothing read it — so tagging a chocolate box as *Gifting → Gift Packs* as well as
*Snacks → Chocolates* still did nothing on the app. Phase 3 points the customer browse paths
at the pair array, so the item is findable under both.

## What changed
- **New index** `idx_items_store_status_taxonomy` on `items`
  (`{storeId, status, taxonomy.categoryId, taxonomy.subCategoryId, quantity, sellingPrice}`).
  The old `idx_items_store_status_cat_subcat_cover` is **kept** — admin catalog filters and
  warehouse rollups still read the singular fields.
- **Drill-down** (`GET /user/home/items/:cat/:sub/:page`) filters on
  `taxonomy: { $elemMatch: { categoryId, subCategoryId } }`, so the pair stays AND-ed.
- **Home category list** membership + `itemsCount` / `cheapestPrice` / `subCategoriesCount`
  read the pair array; counts are **distinct items** (two sub-categories under one category
  is still one item).
- **Sub-category tiles** (`GET /user/home/sub-category/:categoryId`) resolve the reachable
  sub-categories from the item taxonomy, re-filtered on the browsed category after unwind.
- **`taxonomy` is stripped from customer responses at the RESPONSE BOUNDARY** (user
  item/home controllers + `stripCartCostPrice`), never in the repository projection — the
  discount engine must still see the full pair array. Customer wire format is byte-identical
  to before Phase 3; admin responses still carry `taxonomy`.

## Deploy step (must run BEFORE the code deploy)
```
cd haper-backend
node scripts/migrations/build-taxonomy-index.js            # dry run — lists indexes
node scripts/migrations/build-taxonomy-index.js --apply    # background build
```
Idempotent (safe to re-run). Confirm the output shows both `idx_items_store_status_taxonomy`
and `idx_items_store_status_cat_subcat_cover`.

## Steps (backend jest, in-memory only)
```
cd packages/user && NODE_ENV=test npx jest multi-category-items category-subcategory-listing-gap home
```
✅ expect 52 passed / 3 suites.

- ✅ `multi-category-items.test.js` A — an item tagged `Snacks→Chocolates` + `Gifting→Gift
  Packs` gives `itemsCount: 1` on **both** tiles; `Snacks→Chips` + `Snacks→Namkeen` gives
  Snacks `itemsCount: 1`, `subCategoriesCount: 2`; `cheapestPrice` is per-category; a category
  reachable only via a **secondary** tag still appears; out-of-stock is excluded under every
  tag; tiles never leak the item's other tag.
- ✅ `multi-category-items.test.js` B — item tagged `Snacks→Namkeen` + `Gifting→Chocolates`:
  browsing **`Snacks→Chocolates` is EMPTY**, `Snacks→Namkeen` returns it, `Gifting→Chocolates`
  returns it. Item never returned twice. Customer item objects carry **no** `taxonomy` key.
- ✅ `multi-category-browse-discount.test.js` (run with
  `NODE_ENV=test npx jest multi-category-items home item discount` → 232 passed / 19 suites) —
  a rule on the item's SECONDARY category discounts the price on home, drill-down, item list,
  item detail and search, and no response body contains a `taxonomy` key.
- ✅ `category-subcategory-listing-gap.test.js` and `home.test.js` pass unchanged — single-tag
  data behaves exactly as before (Phase 3 is a no-op for today's data).

❌ Failure modes these guard (each verified by deliberately breaking the code):
- Replacing `$elemMatch` with two top-level `taxonomy.*` conditions → the cross-pair test fails.
- Dropping the post-`$unwind` re-match in the tile query → a tile from the item's other tag leaks.
- Collapsing the counts pipeline to a single `$group` → `itemsCount` double-counts.

## Manual check (dev app, after the index build + deploy)
1. Tag one item with two pairs in different categories (Phase-2 API). Both category tiles show
   it, and the item opens from either drill-down.
2. Tile numbers match the list behind them (`subCategoriesCount` === tiles returned).
3. Disable one of the two categories for the store → that tile disappears, the item is still
   browsable under the other category.
4. Customer item JSON has **no** `taxonomy` key; `category` / `subCategory` are unchanged.

## Notes / deliberate limits
- **Explain/perf pass still owed.** The new index cannot COVER (multikey never does), so the
  home counts aggregation now pays a FETCH. Run `explain("executionStats")` on
  `getStoreCategoryMeta` against a dev store with production-like item counts and confirm the
  winning plan uses `idx_items_store_status_taxonomy` with **no COLLSCAN**. This cannot be
  proved on the in-memory jest fixtures (too few docs — the planner picks a scan regardless).
- No `$or` fallback to the singular fields anywhere: the §3.0 GO gate (0 rows with a category
  and no taxonomy, verified on dev) is what makes that safe. Re-run
  `scripts/migrations/verify-taxonomy-go-gate.js` before the deploy.
- **Latent risk:** the counts/membership pipelines `$unwind: "$taxonomy"` **without**
  `preserveNullAndEmptyArrays`, so an item with an empty/missing `taxonomy` is silently dropped
  from every count and tile — safe today (GO gate + the Phase-2 normaliser always writes at
  least one pair), but any FUTURE write path that bypasses `taxonomy.utils` would make such
  items invisible rather than obviously broken.
- **Membership is a PRE-PASS, not a `$lookup`** (`CategoryRepository.getAll`): a `$in` on the
  `taxonomy.categoryId` array inside `$expr` cannot use the index, and that sub-pipeline ran
  once per global category. Measured on a 3000-item / 50-category in-memory fixture:
  3000 docs examined per NON-matching category (~147k per home request) → 0 per category plus
  one 3000-doc index-bound pre-pass (~3k per request). Keep any future membership test in this
  plain, index-bound shape.
- `taxonomy` is also stripped from every **order** response (`sanitizeOrderForCustomer`), which
  populates the master item with a negative select — the one place the strip was missing.
- Warehouse / ops stock reports and the admin catalog **summary** stay primary-only on purpose
  (plan §3.5) — grouping on an unwound taxonomy would count the same physical stock twice.
- Admin catalog list filters and the product list (plan task 3.7) are **not** in this slice.
- Rollback is a plain revert: `taxonomy` stays on the documents, reads fall back to primary.
  The index can be left in place.

---

# Test: multi-category items — Phase 3, task 3.6 (DISCOUNT targeting)

Branch: `dev` (backend only). Plan: `haper-backend/docs/plans/multi-category-items.md` §3.3.
Scope of THIS slice = `packages/shared/utils/discount.utils.js` +
`packages/admin/src/routes/discount-rule/controller.js`. The browse/listing slice (tasks
3.2–3.5) is the section above.

## Why
A discount rule targeting *Snacks* used to look only at the item's PRIMARY category. A
chocolate box tagged *Snacks + Gifting* whose primary happens to be Gifting missed the Snacks
promo. Decision (user, locked): **a category rule matches if the item is tagged with that
category through ANY `taxonomy[]` pair** — "practically, it's still Snacks".

## What changed
- `matchSpecificity` matches on the UNION of `taxonomy[].categoryId` and the singular
  `category._id`. The rank is `CATEGORY` either way — a secondary-tag match is **not**
  "less specific". Stacking, exclusivity, priority, caps and the margin guard are untouched.
- `buildMatchViews` (the checkout-side batch projection) now fetches and carries `taxonomy`,
  and treats a line missing **either** `category` **or** `taxonomy` as needing the DB fill.
- Admin preview (`buildTargetItemFilter`) filters on `taxonomy.categoryId`, so
  "affects N items" / sample prices / below-cost + zero-price warnings see the real blast radius.

## Steps (backend jest, in-memory only)
```
cd packages/user  && NODE_ENV=test npx jest discount coupon order cart --coverage=false
cd packages/admin && NODE_ENV=test npx jest discount coupon pos order --coverage=false
```
✅ expect user 640 passed / 38 suites, admin 428 passed / 32 suites.

- ✅ `discount.utils.test.js` — a rule on the item's SECONDARY tag returns `SPECIFICITY.CATEGORY`
  (same rank as a primary match); a category the item carries in neither place returns `NONE`;
  the union still matches a partial projection carrying only the primary, and a lean view
  carrying only taxonomy; a malformed `taxonomy` never throws.
- ✅ `discount-multi-category-targeting.test.js` — **the cart/checkout agreement suite**:
  a rule on the SECONDARY tag discounts the cart line, and the placed order's `salePrice`
  equals *the number the cart previewed* (compared against each other, not two hard-coded
  values), with `appliedDiscounts` populated on both the response and the persisted order.
- ✅ same file — the cart preview body and **all four order responses** (place, detail, list,
  history) are asserted to contain no `"taxonomy"` key anywhere in the serialized body; deleting
  either strip (`stripCartCostPrice` / `sanitizeOrderForCustomer`) fails this suite.
- ✅ same file — `buildMatchViews` fills `category` + `taxonomy` for a line carrying neither,
  **and for a line that already carries `category`** (the asymmetry that would have shipped a
  cart-discounted / checkout-full-price order); a line carrying both does zero DB reads.
- ✅ `discount-rule-multi-category-preview.test.js` (admin) — preview counts an item matched
  only via a secondary tag, its below-cost warning fires, and the create gate blocks the save.
- ✅ CONTROL tests in both files — a single-tag item behaves exactly as before. Phase 3 is a
  **no-op for today's data** (every item has exactly one pair after the Phase-1 backfill).

❌ Failure modes these guard (verified by deliberately breaking the code):
- Updating `matchSpecificity` but not `buildMatchViews` → the cart-vs-checkout test fails
  (cart ₹80, charged ₹100).
- Leaving the fill test as `!v.category` → the "line already carries category" test fails.
- Leaving the admin preview on `category._id` → the below-cost warning goes silent for a
  secondary-tag item and a below-cost rule saves cleanly.

## 📢 Release note — SOME PRICES GO UP (expected, not a bug)
Under **exclusive** (non-stackable) rules the winner is highest `priority` first; a bigger
discount is only a tie-break. An item that now matches a SECOND category can therefore win a
higher-priority rule that discounts **less** than the one it used to get — a visible price
**increase** for that item the moment this ships. Example: item tagged Snacks + Gifting,
"Snacks 30% off" at priority 1 and "Gifting 5% off" at priority 9 → the item goes from ₹70 to
₹95. This is correct given the configured priorities (asserted explicitly in
`discount.utils.test.js` → "§3.3.4"). **Merch must sanity-check live rule priorities before
the deploy.**

## ✅ Cross-slice gap — FIXED (2026-09-14)
The listing slice used to strip `taxonomy` in the customer item **projections**
(`getPaginated4User` / `getDetail4User` / the drill-down / `$search` / the regex fallback), so
browse and item-detail prices were decorated from already-stripped docs and matched
**primary-only**, while the cart (exclusion-based populate, keeps `taxonomy`) and checkout
matched on all tags — browse card ₹100 / item detail ₹100 / **cart ₹80** for an item whose
only matching rule targets a secondary tag.

The strip now happens at the **response boundary** instead: customer reads fetch `taxonomy`
normally, discount decoration sees the full pair array, and
`taxonomyUtils.stripTaxonomy` / `stripTaxonomyFromList` drop it in the controller right before
`res.json`. Same for the cart lines (inside `stripCartCostPrice`). No extra reads; the customer
wire format is still taxonomy-free. Covered by
`packages/user/__tests__/multi-category-browse-discount.test.js` (7 tests: home suggested,
drill-down, item list, item detail, search, plus a "no matching rule is still null" guard —
each asserting the discounted price AND that `"taxonomy"` appears nowhere in the response body).
❌ Re-adding `taxonomy: 0` to any customer projection fails 2+ of those tests (verified by
deliberately putting it back).

## Manual check (dev, after deploy)
1. Tag an item with two categories; put a live rule on the SECONDARY one. Cart price and the
   placed order's line price must be the same number.
2. Admin → discount rule preview for that category: the item appears in the affected count and,
   if the rule breaches its cost, in the below-cost list.
3. Single-tag items: prices identical to before the deploy.

## Notes / deliberate limits
- Real checkout order lines carry neither `category` nor `taxonomy`, so the widened fill test
  adds **no** extra query at checkout — it is the same single batched read as before.
- Coupons do not target categories at all, so nothing in the coupon engine changes.
- Rollback is a plain revert of `discount.utils.js` + the admin controller; rules fall back to
  primary-only matching and nothing needs a data change.
