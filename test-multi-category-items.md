# Test: multi-category items — Phase 1 (`taxonomy` field + normaliser + backfill)

**Area:** Backend only — item/product write paths.
`packages/shared/models/items.schema.js`, `packages/shared/models/products.schema.js`,
`packages/shared/utils/taxonomy.utils.js` (new),
`packages/shared/repositories/item.repository.js` (`add`, `addOrUpdate`, `updateItem`, `copyItemsToStore`),
`packages/shared/repositories/product.repository.js` (`masterFieldsFromItem`, `projectionFieldsFromProduct`, `create`, `updateByIId`),
`packages/admin/src/routes/product/controller.js` (`update`),
`scripts/migrations/migrate-categories-global.js`,
`haper-misc/haper-sync/backfill-item-taxonomy.js` (new).
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
`haper-misc/haper-sync/backfill-item-taxonomy.js` fills `taxonomy` on rows written BEFORE
this shipped. It calls the same `normaliseTaxonomy` the app uses (no reimplementation).

```bash
cd haper-sync
npm run backfill-item-taxonomy             # DRY RUN — report only (default)
npm run backfill-item-taxonomy -- --apply  # write
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
