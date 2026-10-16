# Category search: DBA review of the new queries

Reviewer: aabha-dba, 2026-10-17. Scope: the uncommitted change in `haper-backend` (`git diff` on `dev`):
`packages/shared/repositories/category-search.repository.js` (new), `packages/shared/utils/taxonomy.utils.js`
(extracted predicate), `packages/shared/repositories/item.repository.js` (`getSearchDocsByIds`),
`packages/user/src/routes/item/controller.js`. Plan: `haper-misc/plans/category-search-plan.md`.

No database was connected. Evidence comes from three places:
1. `explain("executionStats")` on an in-memory mongod 8.2.6, using the real schema indexes
   (`createIndexes()` on the models from `packages/shared/models`). Harness:
   `/Users/office/haper-logs/category-search-explain/explain.js` (outside the repo).
   Seed: 3 stores x 5,000 items, 60 categories, 300 sub-categories, 20% of items in one big category,
   15% of items with a second taxonomy pair, 5% legacy items (empty `taxonomy`), ~55% buyable.
2. The offline prod dump's index metadata (`prod-dump/haper-prod/*.metadata.json`, dump 2026-10-15,
   server 8.0.34). This is a file read, not a DB query.
3. The new tests: `item-search-category.test.js` + `category-search.utils.test.js` gave 66/66 green.

**Verdict: APPROVE as is.** There is no CRITICAL or HIGH finding. Every new query uses an index and is
bounded by the size of one store. No new index is needed. The taxonomy index is **present on prod**
(dump of 2026-10-15). For dev, the user should run the read-only check in §6.

---

## 1. Explain results (taxonomy index PRESENT)

"Docs examined" means documents read from disk or cache. "Returned" means documents sent back.

| Query | Plan | Keys / docs examined → returned |
|---|---|---|
| Q1 buyability aggregation, 1 category | OR(taxonomy idx, cover idx) → FETCH | 60 / 44 → 22 |
| Q1 buyability aggregation, 3 categories (incl. the big one) + 3 subs | cover idx only, `category._id` **unbounded** | 3,112 / 2,540 → 625 |
| Q1 buyability aggregation, 20 categories | same as above | 3,112 / 2,540 → 1,260 |
| Q2 ids, 1 small category chip | OR(taxonomy, cover) → SORT top-300 | 60 / 44 → 22 |
| Q2 ids, 1 big category chip | OR(taxonomy, cover) → SORT top-300, 266 KB, no disk | 1,209 / 1,094 → 300 |
| Q2 ids, 1 sub chip (`$elemMatch` pair) | OR(taxonomy, cover), **both pair fields bounded** | 24 / 20 → 10 |
| Q2 ids, category + 2 sub chips | OR of 6 index scans | 1,564 / 1,607 → 300 |
| Q2 ids, 8 chips (the maximum) | OR of 16 index scans | 2,005 / 2,060 → 300 |
| Q3 `getSearchDocsByIds`, 10 ids | `_id_` IXSCAN | 19 / 10 → 10 |
| Q4 disabled-category read | `storeId_1_categoryId_1` (unique) | 4 / 2 → 2 |
| Q5 snapshot: categories / sub-categories | `status_1_…` IXSCAN | 60 / 60, 300 / 300 |

There is no COLLSCAN in any shape. Every items scan has `storeId` bounded to one store.

### Taxonomy index ABSENT (what dev looks like if the index was never built)
Every Q2 shape and the 1-category Q1 fall back to `storeId_1_quantity_1_lowQty_1_status_1`. That
means "read every in-stock item of this store, then filter": 2,754 keys / 2,707 docs examined at
5k items per store, about 35 ms in memory. It is still not a COLLSCAN, and the results are still
correct, so "slower but correct" holds. Today's prod has about 800 buyable items per store, so the
cost there would be about a third of this.

## 2. `$or` + `$elemMatch` on the multikey index
It works as hoped. For the pair branch the bounds are
`storeId [S,S], status [1,1], taxonomy.categoryId [C,C], taxonomy.subCategoryId [X,X], quantity (0,inf], sellingPrice (0,inf]`,
so the bounds on both array fields are combined under `$elemMatch`. Keys examined (12) equal the
items in that pair. It does **not** degrade to scanning the whole store. The category-only branch
bounds `taxonomy.categoryId` and leaves `subCategoryId` as `[MinKey,MaxKey]`, which is correct.

## 3. Cost per request under load
Real volumes (prod dump, 2026-10-15): 2 stores, about 2,040 items each, of which 712 and 866 are
buyable. 18 active categories, 74 active sub-categories. The biggest category in one store has 165
buyable items. The review seed (5k / 60 / 300) is about 2.5x to 4x today's size.

| Path | DB work |
|---|---|
| No category matches (most product searches) | 0 extra queries on a warm cache. Same as today |
| Category matches, any page | Q1 + Q4 in parallel, then `search4User(limit 100)` + Q2 in parallel, then Q3. That is 3 sequential round-trip waves and 5 queries. Worst case about 5k docs examined at 5k items per store, about 1k today |

At the stated peak (50 searches/min, all hitting a category, which is the pessimistic case), that
is under 250k docs read per minute. All of them are in memory: the whole `items` collection is
about 5 MB in prod. Pool use is about 2 connections for about 30-50 ms per request, so the average
is far below 1 of the 5 connections. Reads go to secondaries (`secondaryPreferred`), so stock can
lag the primary by milliseconds. That is the same as today's search. **Not a load concern.**

**The 100-name-hit Atlas fetch** is acceptable now, but see M1. At 2 stores it fetches about 100-200
docs per request (about 100 KB over the wire to the app, of which 10 are used). The regex fallback
with limit 100 is store-bounded (`storeId_1` + in-memory name sort), which is fine.

## 4. Snapshot cache safety
- **Memory:** about 360 small objects at the review size, under 200 KB. Today it is 92 entries.
  The size is limited by the master collections, not by traffic. Acceptable.
- **Staleness:** at most 60 s per process. PM2 runs 1 instance per service, so there is one copy.
  If the service is ever scaled to N instances, each instance is stale on its own for up to 60 s,
  so a chip can show on one request and not on the next. That is harmless.
- **Admin edits:** a rename shows up within 60 s. Membership is by id, so the products are always
  right and only the name used for matching lags. **A category or sub-category set to INACTIVE can
  still produce chips and products for up to 60 s.** The status is only checked in the snapshot,
  not live. The per-store disable (`store-category-settings`) is read live, so it takes effect at
  once. A 60-second window on a merchandising change is **acceptable** (see L4).
- **Failure:** if a reload fails, the old snapshot is served. If there is no snapshot, the error
  goes to the controller's fail-open path, which returns today's result. Single-flight means one
  load at a time. Correct.

## 5. New index? No.
- The existing taxonomy index, cover index and `{storeId,'category._id',status}` serve every shape.
- The SORT `{isSuggested:-1,_id:-1}` limit 300 is a top-k sort. It sorts the fetched docs, because
  projection runs after the sort, but it is capped at 300 docs: 266 KB measured, about 360 KB at
  prod's 1.2 KB average doc. That is far below the 100 MB in-memory sort limit, with no disk spill.
  An index that provides this order (`{storeId,status,taxonomy.categoryId,isSuggested,_id}`) would
  only pay off at thousands of buyable items per category. **Not proposed.**
- **Do NOT add `ItemModel` to `ensureIndexesFor`** (user/admin `mongo.js`, `__tests__/setup.js`).
  That would build all 19 item indexes at every boot on a big collection. The repo leaves items out
  on purpose (`mongo-index.utils.js` header). Item indexes ship as scripts, and the taxonomy index
  is step 14 in `scripts/migrations/run.js`.

## 6. Prod/dev missing-index risk
- **Prod:** the dump's `items.metadata.json` (2026-10-15) lists **both** `idx_items_store_status_taxonomy`
  and `idx_items_store_status_cat_subcat_cover`. **No action is needed.**
- **Dev:** not known. Read-only check for the user to run (mongosh, connected to the **dev** db):
  ```js
  db.items.getIndexes()
    .filter(i => ["idx_items_store_status_taxonomy", "idx_items_store_status_cat_subcat_cover"].includes(i.name))
    .map(i => ({ name: i.name, key: i.key }))
  ```
  Expect 2 rows. Key order for the taxonomy index:
  `storeId, status, taxonomy.categoryId, taxonomy.subCategoryId, quantity, sellingPrice`.
- **If the taxonomy index is missing (user-run, this is a write):** from `haper-backend` with the env
  pointing at dev:
  `node scripts/migrations/build-taxonomy-index.js` (dry run: check that the printed DB HOST/NAME is
  dev), then `node scripts/migrations/build-taxonomy-index.js --apply`. It is idempotent and builds
  over about 4k docs in under a second.
- **If the cover index is missing:** `node haper-misc/haper-sync/migrate-item-indexes-category-meta.js`.
  Note that this script has **no dry-run**: it writes when started.

---

## Findings

**CRITICAL:** none. **HIGH:** none.

**M1 (MEDIUM): the change makes the existing "store filter after `$search`" cost 10x larger on category-matched queries.**
`search4User` filters by store *after* `$search` (audit B3/F7). A limit of 100 instead of 10, and
re-running it on every page, means Atlas looks up about 100 x (number of stores) docs per
request. At 2 stores that is about 200, which is fine. It grows with each store you add.
Fix: none needed for this change. Raise the priority of the existing follow-up: move the store
scope into `$search` `compound.filter` (`storeId` must be mapped in `item_search`). The repeated
per-page fetch is needed for dedupe (C minus A), so keep it.

**L1 (LOW): a multi-category Q1 picks an unbounded cover-index scan.** With `$in` over 2 or more
categories, the planner's trial prefers `cover` with `category._id [MinKey,MaxKey]`. That reads the
store's whole active+priced key range: 2.5k docs at 5k items, about 800 today, about 10 ms. It is
bounded by store size. Fix comes with L2. No hint is needed now.

**L2 (LOW): the legacy branch doubles the docs examined.** `{"taxonomy.0":{$exists:false}}` cannot
use an index. So for every member of the category, the legacy branch fetches the doc a second time
only to find that its `taxonomy` is not empty (for example 1,094 docs examined for about 550 unique
docs). The prod dump has **0** legacy items in both stores. Fix (separate change, it also touches
the aisle): run `verify-taxonomy-go-gate.js` on dev and prod. If both are 0, drop
`LEGACY_TAXONOMY_FILTER` from `categoryMembershipOr`. Then Q1 and Q2 become one bounded
taxonomy-index scan.

**L3 (LOW): a page can come back short.** `getSearchDocsByIds` re-checks buyability and drops an id
that went out of stock between Q2 and Q3, or that differs between two secondaries. That page then
has 9 items, and the clients' `items.size >= 10` rule **stops "load more"**. The window is
milliseconds, so it is rare. Fix, if it is ever seen: fetch the window plus 3 spare ids and trim to 10.

**L4 (LOW): a deactivated category or sub-category can still match for up to 60 s.** The snapshot
TTL is the only status check. This is accepted, and should be written into the test guide (the
guide already notes rename lag). If it ever matters: add `status: ACTIVE` to a cheap live
`CategoryModel.find({_id:{$in:catIds}})` next to Q4. It runs in parallel, so it adds no extra
round-trip wave.

**L5 (LOW / info): one legacy sub-pair branch uses the global `{subCategory._id, status}` index.**
This happens in the 3+ chip shapes. That branch's cost grows with the number of stores, not with
one store. It is tiny (about 30 keys), and it disappears with L2.

## Failure analysis (what breaks first at 10x)
At 10x traffic (500 category searches/min) the Mongo reads are still trivial: about 2.5M in-cache
doc reads per minute on a 5 MB collection, and under 1 pool connection on average. What breaks first
is **M1**. At 10x **stores**, every category-matched search page makes Atlas walk about 1,000+ hits
to find 100 local ones, on every page. The fix is the `compound.filter` follow-up. Second is
**L1/L2** at 10x **catalogue** (about 20k items per store): Q1 would read about 10k docs per request.
Removing the legacy branch (L2) brings it back to bounded taxonomy-index scans. The kill switch
`SEARCH_CATEGORY_MATCH=off` removes all of this instantly.

STATUS: done
OUTPUT: DBA review of category-search queries (all IXSCAN, store-bounded, no new index; prod taxonomy index present per 2026-10-15 dump) — approve; 0 critical/high, 1 medium, 5 low
NEXT: sumit-backend (or the B4 engineer) — optional L3/L4 tweaks + test-guide note on 60 s deactivation lag; USER — run the §6 read-only dev index check
