# Category / sub-category search — implementation plan

Status: Approved; build starting; Android first, iOS/web later. Author: Shavinder (planner), 2026-10-17.
Scope: backend first (works for old apps), then Android chips. iOS / web later on the same backend.
No database was queried while writing this. Everything below comes from reading the code and docs.

---

## APPROVED DECISIONS (2026-10-17)

The six open questions in §12 are resolved. These decisions win over any older wording below.

1. **Order:** name hits come first (today's order, unchanged), then category products.
2. **Minimum query length:** category matching starts at **3 letters**.
3. **Typo tolerance:** **one typo** allowed, only for words of **5+ letters**. No two-typo rule.
4. **Multi-word rule:** **every word must match** a category or sub-category name. `amul milk` gets
   no category products.
5. **Chips:** show the **parent name AND the item count** (e.g. `Biscuits & Cookies · 42`).
6. **Kill switch:** ship with env switch `SEARCH_CATEGORY_MATCH`, **default on**.

**Rollout and deploy order**
- Build order: **backend first** (the chips need it), then **Android**, then iOS and web.
- Deploy order: **backend to dev → test → user deploys backend → old apps benefit immediately → Android release after.**
- "Android first" means Android comes before iOS and web. It does not mean Android before backend.

---

## 1. Goal

A customer who types a category or sub-category name ("biscuit", "dairy", "cream biscuits")
should see that category's products. Today they get "We couldn't find …, here are some popular
picks" or a few products that happen to have the word in their name.

**Part 1 (backend only, no app update).** When the search text matches a category or sub-category
name, the existing response `data.item` also contains that category's in-stock products. Old
Android/iOS/web builds only render `data.item`, so they show the fix without an update.

**Part 2 (Android, Play Store release).** A row of tappable chips above the results
(`Categories: [Biscuits & Cookies] [Cream Biscuits]`), shown only when something matches. Tapping a
chip opens the same aisle screen the home page opens. With no match, the screen looks exactly as it
does today.

### Acceptance criteria (user-visible)
- [ ] Searching `biscuit`, `biscuits`, `Biscuits`, `biscut` (typo) or `bisc` (prefix) on an
      **old** app build lists the in-stock products of "Biscuits & Cookies" (and of "Cream Biscuits"
      etc.), with no app update.
- [ ] An item tagged under a category **only as a secondary tag** (in `taxonomy`, not in the
      singular `category` field) is found by that category's name.
- [ ] Product-name searches that work today (`amul`, `maggi`, `milk`) return the **same first
      results in the same order** as today.
- [ ] A category or sub-category whose products are all out of stock, unpriced or inactive at the
      user's store is never matched: no products from it, no chip.
- [ ] A category the store has disabled (store-category-settings `enabled:false`) is never matched.
- [ ] No product appears twice across pages 1..N.
- [ ] If nothing matches (no product name, no category), the screen shows exactly what it shows
      today (`isFallback: true` + popular picks).
- [ ] Android (new build): chips appear above the results only when a category matches. Tapping
      a sub-category chip opens the parent aisle with that sub-category already selected. Tapping a
      category chip opens the aisle on "All". The item list there equals the products the search
      showed for that chip.
- [ ] An old Android build receiving the new response behaves exactly as before. The extra
      `categories` key is ignored.

---

## 2. Current state (with evidence)

| What | Where |
|---|---|
| Route `GET /user/item/search/:query/:page` | `haper-backend/packages/user/src/routes/item/router.js:13`, validator `validator.js:24-32` (page ≥ 1) |
| Controller | `packages/user/src/routes/item/controller.js:77-109` |
| Repo search | `packages/shared/repositories/item.repository.js:1066-1167` (`search4User`) |
| Regex fallback (index missing / `$search` throws) | `item.repository.js:70-105`, searches **name + brand only** (`:86`) |
| Category drill-down predicate (aisle item list) | `item.repository.js:597-657` `getPaginatedItemsBasedOnCatSubCat` |
| Sub-category tile predicate (aisle chip row) | `packages/shared/repositories/sub-category.repository.js:105-182` |
| Home category tile list + counts | `packages/shared/repositories/category.repository.js:144-226` (`getAll`), `:243-350` (`getStoreCategoryMeta`) |
| Taxonomy helpers (`LEGACY_TAXONOMY_FILTER`, `EFFECTIVE_TAXONOMY_STAGE`, `stripTaxonomy`) | `packages/shared/utils/taxonomy.utils.js:208-260` |
| Item schema (`category`, `subCategory`, `taxonomy[]`) + indexes | `packages/shared/models/items.schema.js:79-95`, `:139-181` |
| Category / sub-category masters (global, no storeId, name unique among ACTIVE) | `models/categories.schema.js`, `models/sub-categories.schema.js` (`category: [ObjectId]`, i.e. one sub can have several parents) |
| Per-store hide switch | `models/store-category-settings.schema.js` (a row exists only when disabled) |
| Safe tokenizer | `packages/shared/utils/common.utils.js:75-85` `tokenizedSearchClauses` |
| Android API | `haper-android/app/src/main/java/com/bheldi/data/api/ApiService.kt:72-76` |
| Android model | `data/model/HomeModels.kt:324-327` `SearchResultData(item, isFallback)` |
| Android screen | `ui/screens/search/SearchScreen.kt` (local Compose state, 800 ms debounce `:168`, page-2 append with id-dedupe `:477-478`, `hasMore = items.size >= 10` `:668`) |
| Android aisle | route `aisle/{categoryId}` in `MainActivity.kt:848-869`; `ui/screens/category/AisleListingScreen.kt:128`; `HomeViewModel.onCategorySelected` `:772` (always resets `selectedSubCategory = null`) |
| iOS | `haper-ios/haper/Views/SearchView.swift:265-313` (same contract, dedupes on append) |
| Web | `haper-web/services/api.ts:402-403`, `pages/Home.tsx:132` (page 1 only) |

### Behaviour today for "biscuit"
1. `search4User` runs Atlas `$search` with `should` clauses: `autocomplete`/`phrase` on `name` only
   (`:1072-1103`), plus one `text` clause at boost 2 on
   `["type","brand","tags","category.name","subCategory.name"]` (`:1106-1112`).
2. Results are store-filtered **after** `$search` (`:1124-1133`), then `$skip`/`$limit`.
3. If page 1 is empty, the controller swaps in recommended items with `isFallback: true`
   (`controller.js:90-94`). Android then shows "We couldn't find 'biscuit'. Here are some popular
   picks" (`SearchScreen.kt:401-443`). From the customer's side, the search failed.

### Most likely root causes (in order of confidence)
1. **`text` is exact-word matching.** The Atlas `text` operator with the default analyzer
   (lucene.standard) splits "Biscuits & Cookies" into the words `biscuits`, `cookies`. The query
   `biscuit` is a different word, so it does not match. No prefix, no plural handling, no typo
   tolerance. (`dairy` would match, but only if the index maps that field. See 2.)
2. **The index may not map category fields at all.** `haper-backend/docs/plans/multi-category-items.md:656`
   says the index "indexes name/brand, not category". The audit (`docs/audit/haper-backend-audit-2026-08-30.md:90,1020`)
   notes that the `item_search` definition is not in the repo, so nobody can confirm.
3. **Secondary tags are not searched.** `taxonomy.categoryName` / `taxonomy.subCategoryName` are
   not in any clause, so an item whose category is only a secondary `taxonomy` tag can never match
   on category name. This is the briefed hypothesis. It is real, but only for secondary tags: the
   singular `category`/`subCategory` is always the primary tag (`taxonomy[0]`, `taxonomy.utils.js:76-115`).
4. **The regex fallback searches only name + brand** (`item.repository.js:86`). The `item_search`
   index has been deleted on dev before, and in that state category search can never work.

### Pre-existing bugs found on the same path (they matter to this design)
- **B1. Pagination skip is wrong.** `controller.js:82` passes `page - 1` as the **skip count**
  (page 2 → skip 1, page 3 → skip 2), while `search4User` treats it as a raw skip (`:1134`). Page 2
  returns items 2..11, which overlap page 1. Android and iOS dedupe by id, so each "load more" adds
  only **one** new product. The merge in §3 needs correct offsets, so this is fixed in task B3.
  Old clients benefit: page 2 now adds ten new products instead of one, and their id-dedupe keeps
  this safe.
- **B2. Home category tiles count out-of-stock items.** `CategoryRepository.getAll` membership
  (`category.repository.js:169`) has no `quantity > 0`. The aisle (`item.repository.js:609`) and
  the sub-category tiles (`sub-category.repository.js:131`) do have it, so a home tile can open an
  empty aisle. This is the open "tile vs drill-down" mismatch. **Not fixed here** (it changes home).
  Search uses the stricter aisle rule, per decision 5. Listed as a follow-up.
- **B3. Store filter applied after `$search`** (audit, Critical). This is out of scope, and the new
  category path is store-scoped from the start, so category queries are not affected by it.

---

## 3. Proposed design (Part 1, backend)

**Decision: do not depend on an Atlas index change.** Match the query against the category and
sub-category **masters** in application code, then fetch that store's buyable items by id-based
membership. This is the same predicate the aisle uses. Merge the result after today's name results.

Why: Atlas index edits are made outside the repo, are not reviewable, are not testable in
in-memory Mongo, and are not in the repo (D12). The masters are small global collections, so a
cached in-memory match is cheap and fully unit-testable. Fuzzy matching ("biscut", "bisc", plural)
written in plain JS also needs no regex built from user input, so there is no ReDoS risk.

### 3.1 Data flow (one request)
```
GET /user/item/search/:query/:page
  │
  ├─ (unchanged, parallel) CartRepository.getCartForItems
  │
  ├─ 1. matchCategories(query)            ← in-process snapshot, 0 DB queries on a warm cache
  │        → candidate category ids C*, candidate (parent, sub) pairs P*
  │        (empty → STOP: run exactly today's path, zero extra cost)
  │
  ├─ 2. buyableCategoryHits(storeId, C*, P*)   ← 1 aggregation (live, never cached)
  │        drops candidates with 0 buyable items, disabled-for-store, inactive
  │        → chips[] with itemCount
  │        (chips empty → STOP: today's path)
  │
  ├─ 3. A = search4User(0, CAP_A=100, query, storeId)     ← existing fn, UNCHANGED
  │     Cids = categoryItemIds(storeId, chips, cap CAP_C=300) ← 1 find, ids only
  │     merged = A ++ (Cids − ids(A))
  │
  ├─ 4. window = merged[(page-1)*10 , page*10)
  │     docs for the window's C-part fetched by _id (1 find); A-part docs already in hand
  │
  ├─ 5. page 1 && window empty → today's fallback (isFallback true, categories [])
  │
  └─ 6. same decoration as today: attachPricePerUnit → attachDiscounts → stripTaxonomy
        response { item, cart, isFallback, categories }
```

### 3.2 Matching rules (`matchCategories`), pure function, unit-tested
- **Normalise** both sides: lowercase, Unicode NFD with accents removed, `&`/`,`/`-`/`/` and other
  punctuation → space, collapse spaces. Drop stop-words `and`, `of`, `the`, `&`. Cap the query at 64
  characters and 6 words (the same caps as `tokenizedSearchClauses`).
- **Light singular form** on each word: `ies→y` (cookies→cooky for both sides, consistently),
  `es→` only after `s/x/z/ch/sh/o` (tomatoes→tomato), else a trailing `s` is dropped when the word
  is longer than 3 letters. Both sides get the same treatment, so `biscuit` ≡ `biscuits`.
- **A name matches when EVERY query word matches some name word**, in any order:
  - prefix: the name word starts with the query word (query word ≥ 2 letters), e.g. `bisc` → `biscuit`;
  - typo: for query words ≥ 5 letters, Damerau-Levenshtein distance ≤ 1 (approved: one typo only, no two-typo rule).
    Example: `diary` → `dairy` (two letters swapped = distance 1). Word length is capped at 30
    characters, so each comparison is bounded.
- **Whole-query minimum: 3 letters after normalising.** `mi` matches no category; it still
  searches products as today.
- "Every word" stops brand + product queries flooding: `amul milk` does not match the "Milk"
  category because `amul` is in no category name, so it gets today's results.
- **Score**, used to order the chips: exact full-name match 3 > all words by prefix 2 > any typo
  match 1. Ties go to the higher `itemCount`. At most **8 chips**.
- Sub-category names are globally unique among active ones (partial unique index), but one
  sub-category can have **several parents**. Each (parent, sub) pair with buyable stock becomes its
  own chip, labelled with the parent's name, e.g. `Chocolates · Snacks` and `Chocolates · Gifting`.

### 3.3 The membership predicate (single source)
Extract one shared builder, e.g. `taxonomyUtils.buyableMembershipFilter({ storeId, categoryId, subCategoryId })`,
holding exactly the condition now at `item.repository.js:607-644`:
`storeId`, `status ACTIVE`, `quantity > 0`, `PRICED_FILTER`, plus the taxonomy-or-legacy `$or`, with
the `$elemMatch` pair for (cat, sub). `getPaginatedItemsBasedOnCatSubCat` is changed to call it as
a **pure refactor** (task B2). The search expansion uses the same builder. The search's category
products are therefore, by construction, the same products the aisle shows for that chip.

On top of the item predicate, a chip also needs everything the aisle tile path checks:
- the category is `status: ACTIVE` and has no `store-category-settings` row with `enabled:false`
  for this store (same rule as `category.repository.js:177-200`);
- for a sub-category chip: the sub-category is ACTIVE **and its `category[]` lists the parent**
  (same rule as `sub-category.repository.js:112`). Otherwise the aisle's sub-category row would not
  contain it and the pre-selected chip would land on nothing.

### 3.4 Ranking and pagination
- **Today's name results first, in today's order; category products after them.** Reason: for
  product-name queries the first results stay exactly what they are today (no ranking change), and
  for a pure category word like "biscuit" there are usually few name hits, so category products fill
  the page immediately. Inside the category part, the order is the aisle's order
  (`isSuggested -1, _id -1`, `item.repository.js:649`) across all matched chips.
- Pages are recomputed from scratch on every request (no server state): the list is A (≤100) then
  C minus A (≤300), and page N is the slice `[(N-1)*10, N*10)`. The rule that holds: **if today's
  results have at least N×10 hits, page N is identical to today's corrected page N.**
- Every page is 10 items except the last, so the clients' existing `items.size >= 10 → load more`
  rule works unchanged.
- No duplicates within one response, because C is filtered against all of A, not just the current
  page. Across pages, stock can change between requests and shift an item by one position. All
  three clients already dedupe by id when appending (Android `SearchScreen.kt:477`, iOS
  `SearchView.swift:301`).
- Caps: A = 100, C = 300 (≤ 40 pages). If A hits 100, name results beyond 100 are not shown when
  a category matched. That is very unlikely at about 3.7k items per store. Logged once as a counter.

### 3.5 Performance and cost
| Case | Extra DB work vs today |
|---|---|
| No category matches (most product searches) | **0 queries.** Snapshot is in memory; matching is under 1 ms of CPU for a few hundred names |
| Category matches | +1 aggregation (buyability/counts), +1 `find` (C ids, `_id` only), +1 `find` (≤10 docs by `_id`). `search4User` runs with limit 100 instead of 10 |

- **Indexes:** the C query and the buyability `$match` use `idx_items_store_status_taxonomy`
  (`items.schema.js:178-181`) through the `$or` branches, and `{storeId, category._id, status}`
  (`:145`) for the legacy branch. That taxonomy index is **not auto-built** (comment at `:176-177`).
  The user must confirm it exists on dev before ship (§9 step V3). Without it the queries fall back
  to `{storeId, status}`, which is still fine at this catalogue size.
- **Snapshot cache:** in-process, 60 s time-to-live, single-flight load (one shared promise), from
  `CategoryModel.find({status:1},{name,icon,isSuggested,seq})` and
  `SubCategoryModel.find({status:1},{name,category,icon})`, with normalised words worked out in
  advance. No invalidation: category changes are made from the admin service, a different process,
  so a renamed or new category shows up in search within 60 s. This is boring and safe. Redis is
  not needed (one global snapshot key would be the pattern if it ever is).
  `pm2 instances: 1` per service means one copy.
- **Stock is never cached.** Step 2 is live, so a chip disappears the moment its last item goes out
  of stock.
- **Rate limit:** the existing app-level limiter (`packages/user/index.js:28`) plus the client's
  800 ms debounce is enough. No new limiter.
- **Kill switch:** env `SEARCH_CATEGORY_MATCH` (default `on`, documented in `.env.example`). When
  `off`, the controller skips steps 1–4, which is exactly today's path. The whole expansion is also
  wrapped **fail-open**: any error is logged and today's response is returned.

### 3.6 Edge cases
| Case | Behaviour |
|---|---|
| `Biscuits`, `BISCUIT`, `biscuit`, `bisc`, `biscut` | All match "Biscuits & Cookies" |
| `Crème` vs `creme` | Accents removed on both sides |
| `cream biscuits` | Matches sub "Cream Biscuits" (both words). Does not match "Biscuits & Cookies" (no `cream`) |
| `biscuits & cookies` | `&` is a stop-word; matches the category exactly (score 3) |
| Query matches products and a category (`milk`) | Name results first (unchanged), then dairy products not already listed |
| Sub-category under 2 parents | One chip per parent that actually has buyable items in that pair |
| Category inactive / disabled for store / not carried by store | Not in the snapshot / dropped in step 2 / dropped in step 2 |
| All items out of stock or unpriced | Dropped in step 2: no chip, no products |
| 1–2 letter query | No category matching; today's behaviour |
| Hindi/Devanagari or a local word (`atta` for flour) | No match unless the category name contains it. Synonyms are a follow-up |
| Regex specials `a+b*(c)?[` | No regex is built from user input; strings are compared as plain text |
| Atlas index missing (dev) | A comes from the existing regex fallback; the category part works independently |
| Page 2+ | `categories: []` (chips are a page-1 concept); items continue the merged list |

### 3.7 Response contract (additive only)
Unchanged: `msg`, `data.item` (same item shape: projection, price-per-unit, discount keys,
taxonomy stripped), `data.cart`, `data.isFallback`.

`isFallback` means the same thing as today: `true` **only** when page 1 has no real results
(neither name nor category) and the recommended list is shown.

**New key `data.categories`.** It is always present: an array on every response, `[]` when nothing
matches and on page 2+.
```json
"categories": [
  { "categoryId": "64f…", "subCategoryId": null,   "name": "Biscuits & Cookies", "parentName": null,                 "icon": "cat/biscuits.png", "itemCount": 42 },
  { "categoryId": "64f…", "subCategoryId": "650…", "name": "Cream Biscuits",     "parentName": "Biscuits & Cookies", "icon": "sub/cream.png",    "itemCount": 9 }
]
```
`categoryId` is always the id the aisle route needs. For a sub-category chip it is the parent.
`itemCount` is distinct buyable items (same counting as `getStoreCategoryMeta`'s two-pass group).
Old Android builds ignore the key (Gson skips unknown keys). iOS `Decodable` skips unknown keys.
Web ignores it.

---

## 4. Data model changes
**None.** No new collections, fields or migrations. Everything is read-only.
Index dependency: `idx_items_store_status_taxonomy` (already declared, not auto-built). Only
verification is needed; nothing is created.

## 5. API contract
`GET /user/item/search/:query/:page`. Auth: user JWT (unchanged, `router.js:9`). Params are
unchanged. Response as in §3.7. No new endpoint. The aisle endpoints `GET /user/home/sub-category/:categoryId`
and `GET /user/home/items/:categoryId/:subCategoryId/:page` are reused as they are by the chip tap.

---

## 6. Build order (one task = one reviewable change)

### Backend, haper-backend (≈ 3 days), specialist: backend platform engineer + aabha-dba (index check, review of queries)
- **B0. Repro test first (RED).** New `packages/user/__tests__/item-search-category.test.js`
  (in-memory Mongo). Seed category "Biscuits & Cookies" + sub "Cream Biscuits", and three in-stock
  items at store A: (i) name "Good Day" with primary = Biscuits; (ii) name "Choco Bar" with primary
  Snacks and **secondary** taxonomy pair Biscuits→Cream Biscuits; (iii) out-of-stock "Marie Gold" in
  Biscuits. Call `GET /user/item/search/biscuit/1`. Today it returns `isFallback: true` without
  (i)/(ii), which reproduces the bug. The test asserts the target behaviour, so it fails before B4
  and passes after. (In-memory has no Atlas, so `$search` throws and the regex fallback runs. That
  is the "index missing" production state, and it proves the category part works without Atlas.)
- **B1. Pure refactor: shared membership predicate.** `packages/shared/utils/taxonomy.utils.js`
  (add `buyableMembershipFilter`), and `item.repository.js:597-657` calls it. No behaviour change:
  existing `category-subcategory-listing-gap`, `multi-category-items`, `home` tests stay green.
- **B2. Matcher.** New `packages/shared/utils/category-search.utils.js`: `normalise`, `singular`,
  `wordMatches` (prefix / bounded Damerau-Levenshtein), `matchCategories(query, snapshot)`. Pure
  functions; unit tests in `packages/user/__tests__/category-search.utils.test.js`. Export through
  `packages/shared/utils/index.js`.
- **B3. Pagination skip fix.** `controller.js:82` → `(page - 1) * 10`. Its own commit, with a test
  that pages 1 and 2 share no ids (seeded so the regex fallback returns > 10).
- **B4. Snapshot + buyability + merge.** New `packages/shared/repositories/category-search.repository.js`
  (or methods on `CategoryRepository`): `getSnapshot()` (60 s, single-flight, fail-open),
  `buyableCategoryHits(storeId, cands)`, `categoryItemIds(storeId, chips, cap)`. Controller
  `controller.js:77-109`: steps 1–6 of §3.1, kill switch, try/catch fail-open, `categories` key.
  Export in `packages/shared/repositories/index.js`.
- **B5. Docs.** `.env.example` (`SEARCH_CATEGORY_MATCH`), new `haper-misc/test-category-search.md`,
  row in `haper-misc/client-followups.md` (Android/iOS/web chips pending).
- Gate: `cd packages/user && NODE_ENV=test npx jest` green; same for `packages/shared` if it has tests.

### Android, haper-android (≈ 2 days + 0.5 day design), specialists: chanchal-designer FIRST, then Android platform engineer
- **D0. chanchal-designer: short UI spec for the chip row before any code** (design-first rule):
  label text, chip style (reuse the aisle's sub-category chip component if it fits,
  `AisleListingScreen.kt:471-515`), horizontal scroll, whether to show `itemCount` / `parentName` /
  icon, placement relative to the "N results for …" line (`SearchScreen.kt:388-400`), loading state.
  Content is already decided (approved decision 5: parent name AND item count shown). The designer
  decides layout and style only.
- **A1. Model.** `data/model/HomeModels.kt`: `SearchResultData` gets
  `val categories: List<SearchCategoryMatch>? = null`. New `SearchCategoryMatch` with **all fields
  nullable** (Gson writes null for missing keys).
- **A2. Aisle can open on a sub-category.** `MainActivity.kt:848`: route becomes
  `aisle/{categoryId}?sub={subCategoryId}&name={name}` with optional args, default null. The existing
  `navigate("aisle/$id")` callers (`:747`, `:770`) keep working, and `startsWith("aisle/")` checks
  (`:231`, `:597`, `:1164`) are unaffected. `AisleListingScreen`: new optional
  `initialSubCategoryId`, `fallbackName`. The title uses `fallbackName` when the category is not in
  `homeVM.categories`; that list is the home page's first 30 only (`h=1`), so a search-matched
  category may be missing from it and the title would read "Aisle". `HomeViewModel.onCategorySelected(categoryId, initialSubCategoryId = null)`:
  after the sub-categories load, if that id is in the list, set `selectedSubCategory` and call
  `fetchItemsByCategory(categoryId, it)`. Otherwise open "All". Keep the generation guard (`categoryReqId`).
  `LaunchedEffect` key includes the sub id.
- **A3. Search chips.** `SearchScreen.kt`: new state `matchedCategories` (cleared with `results`
  at `:159`, `:295`, `:190`). `performSearch` callback passes `data?.categories.orEmpty()` (page 1
  only; page-2 callback ignores it). Chip row is the first `LazyColumn` item, only when the list is
  non-empty and `!isFallback`. New param `onCategoryClick(categoryId, subCategoryId, name)`, wired
  in `MainActivity.kt:838` to `navigate("aisle/${Uri.encode(id)}?sub=…&name=…")`.
- **A4. Analytics.** `AnalyticsTracker.logEvent("search_category_chip_tap", {query, category_id, sub_category_id, position})`.
  Nothing on show. Existing `trackSearch` is unchanged.
- Gate: `./gradlew assembleDebug`; manual run against dev.

### Later: iOS (≈ 1.5 days) and web (≈ 1 day)
- iOS: `SearchView.swift` (state + chip row), the `SearchResultData` model (optional `categories`),
  navigation to the existing aisle view with an optional sub-category. Never trigger the iOS
  pipeline; the user does.
- Web: `pages/Home.tsx` search block + `services/api.ts` type. Verify with `tsc --noEmit` + `vite build`.

---

## 7. Edge cases, risks and backward compatibility

| Existing functionality | How it stays unchanged |
|---|---|
| Product-name search ranking | `search4User` is not edited. The merge only appends after today's list. No category match = byte-identical path (asserted by test) |
| Response shape | Same keys and item shape; one new key that is always an array |
| `isFallback` + popular picks | Same condition (page 1, no real results) |
| Old Android/iOS/web | Ignore `categories`; get category products in `item`; page 2 now adds 10 new items (they already dedupe) |
| Aisle / home listing | B1 is a pure refactor guarded by the existing parity tests; home `getAll`/meta untouched |
| Admin item search (`ItemRepository.search`) | Not touched |
| Discount / price-per-unit / taxonomy strip | Same decoration chain, same order (`controller.js:99-101`) |
| Home performance | Not on the home path. Snapshot loads lazily on first search, not at boot |

Risks:
- **R1. A generic word floods results** (e.g. `food` → "Packaged Food" adds ~300 items after the
  name hits). This is intended. Capped at 300.
- **R2. Typo tolerance gives a wrong match** (`salt` vs `malt`: 4 letters, so no typo matching
  below 5 letters). The thresholds are constants; tune them from analytics.
- **R3. Snapshot up to 60 s stale after an admin rename.** Acceptable; documented in the test guide.
- **R4. Missing taxonomy index on dev/prod** → slower but correct. Verify (V3).
- **R5. The skip fix (B3) changes page 2+ for everyone.** Strictly better, but it is a visible
  change. Separate commit so it can be reverted alone.
- **Rollback:** set `SEARCH_CATEGORY_MATCH=off` + restart, or revert B4. No data was written, so
  rollback is instant and complete. Nothing in this plan is hard to reverse.
- **Security:** no regex from user input in the new code; query capped at 64 characters / 6 words;
  `costPrice` stays out (C docs are fetched with the `search4User` projection: `-quantity -costPrice -status`).

Deploy order: **backend to dev → test with the old Play Store Android build → user deploys backend
→ Android release → iOS/web.** Old apps benefit as soon as the backend is live.

---

## 8. Test strategy (in-memory Mongo only, never the real DB)
Unit (`category-search.utils.test.js`): normalise/singular table (biscuits/biscuit, cookies,
tomatoes, Crème); prefix; typo threshold (one typo, 5+ letters only); `diary`→`dairy`; 1–2 letter query → none;
`amul milk` → no category; `cream biscuits` → only the sub; stop-words; 64-character cap; specials.

Integration (`item-search-category.test.js`, via supertest on the user app):
- B0 repro (primary tag, secondary-only tag, out-of-stock excluded).
- **Guards that must break a test if removed** (each has a named test):
  `quantity > 0` (OOS item never appears, OOS-only category gives no chip); `PRICED_FILTER`;
  `status ACTIVE` item / category / sub; disabled `store-category-settings` row; the sub's
  `category[]` lists the parent; `$elemMatch` pairing (an item Snacks→Namkeen + Gifting→Chocolates
  must not appear for chip Snacks→Chocolates); store isolation (store B's biscuits never shown
  at A); dedupe (item hit by name and category appears once, at its name position); skip fix
  (pages 1/2 disjoint); fail-open (make the snapshot load throw → response equals today's);
  kill switch off → response equals today's apart from `categories: []`.
- **Parity:** for each chip, the ids the search adds = ids from
  `GET /user/home/items/:cat/:sub/1..N` (the aisle).
- **No-change proof:** with no category seeded, the `item` array and `isFallback` equal the
  pre-change output for `milk`, `Amul`, `nothingmatches`.
- **Contract:** response keys exactly `item, cart, isFallback, categories`; no `taxonomy`/`costPrice` in items.

Regression (must stay green): `item.test.js` (mocks `search4User` → []), `item-search-fallback.test.js`,
`unpriced-item-hidden.test.js`, `discount-browse-margin.test.js`, `discount-browse-wiring.test.js`,
`multi-category-browse-discount.test.js`, `multi-category-items.test.js`,
`category-subcategory-listing-gap.test.js`, `home.test.js`.

Android: `assembleDebug`. Manual: old build vs new build against dev (test guide).

---

## 9. Verify first on dev (read-only, run by the user; agents do not query any DB)
- **V1.** Atlas UI → `item_search` → view the index definition JSON. Do the mappings include
  `category.name` / `subCategory.name` / `taxonomy.*`? Paste it into `docs/search/item_search.json`
  (audit D12). This confirms root cause 2. The design does not depend on the answer.
- **V2.** Dev app: search `dairy` and `biscuit`. Note whether you get `isFallback` (popular picks)
  or real hits. This is the baseline for the test guide.
- **V3.** `db.items.getIndexes()` on dev: does `idx_items_store_status_taxonomy` exist? If not, run
  `scripts/migrations/build-taxonomy-index.js` yourself (it is a write, so the user runs it).

## 10. Test guide to add
`haper-misc/test-category-search.md`: steps for old build vs new build (`biscuit`, `biscuits`, `bisc`,
`biscut`, `cream biscuits`, `dairy`, `amul`, `mi`), out-of-stock and disabled-category cases, page-2
"no duplicates", chip tap opens the aisle with the sub selected, kill-switch check, needed deploys
(backend dev deploy; Android release).

## 11. Follow-ups (not in this plan)
- Fix B2: home tile membership has no `quantity > 0` (changes home; needs its own parity tests).
- Store filter inside `$search` (audit F7, Critical before a second store's traffic).
- Check in the `item_search` definition; optionally add `taxonomy.*Name` (multi-category Phase 4).
- Synonyms table (`atta` → Flour, `doodh` → Milk) for Hinglish searches.

---

## 12. Open questions (all resolved, 2026-10-17)
1. **Order:** name hits first, then category products. **Resolved.**
2. **Minimum query length:** 3 letters (`mi` does not match "Milk"). **Resolved.**
3. **Typo tolerance:** one typo, for words of 5+ letters (`biscut`, `diary`). **Resolved.**
4. **Multi-word rule:** every word must match, so `amul milk` gets no category products. **Resolved.**
5. **Chip content:** parent name AND item count (`Biscuits & Cookies · 42`). **Resolved.**
6. **Kill switch:** env var `SEARCH_CATEGORY_MATCH`, default on; ship with the switch. **Resolved.**

---

## Specialist routing
- Backend B0–B5: backend platform engineer. **aabha-dba** reviews the two new queries and the
  index dependency (V3).
- D0: **chanchal-designer** (chip-row spec) before A1–A4.
- A1–A4: Android platform engineer.
- iOS / web: the respective platform engineers, later.
- Not needed: hemant-payments, stas-realtime, deepanshu-data, rohit-ai.

STATUS: done
OUTPUT: plan at haper-misc/plans/category-search-plan.md
NEXT: rahul — brief backend engineer (B0–B5) + aabha-dba review, then chanchal-designer (D0) before the Android engineer (A1–A4). Plan approved 2026-10-17; §12 resolved.
