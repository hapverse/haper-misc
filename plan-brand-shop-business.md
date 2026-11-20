# Plan: Shop by Brand for Haper Business (wholesale) buyers

Status: **APPROVED 2026-11-19 — Phase 1 (backend + Android) BUILT, reviewed and security-checked 2026-11-20; awaiting commit; enable on dev via BRAND_SHOP_ENABLED=true (owner)**
Scope: dev only. Design spec (wins on all UI questions): `haper-misc/design-brand-shop-business.md`
+ mockup `design-brand-shop-business-mockup.html`.

Plain words: a **brand** is the name on the pack (Amul, Dabur). Every product has a free-text `brand` field typed
by staff. "Shop by brand" = see the brands this store sells wholesale, tap one, see and buy its items.

---

## 1. Decisions (owner, 2026-11-19)

| # | Decision | What it means in the build |
|---|---|---|
| 1 | Letter badges now, logo upload later | API sends `logoUrl: null` in Phase 1. App shows the logo when present, else the badge. Logos arrive with the Phase 2 admin screen, no app release. |
| 2 | Hide catch-all names | Server-side hidden list: `generic, genric, na, n/a, unbranded, local, none` + any name with no letter or digit (blank, "-", "."). Hidden from list, brand page and search chips. Items stay in categories and search. (`n/a`, `none` added as same-meaning variants.) |
| 3 | Auto-merge only case/space differences | Key = `variantRulesUtils.normaliseBrand` (trim, collapse spaces, lowercase; already in the code). **No alias map in Phase 1.** Real misspellings are fixed once by staff in Product Master (Phase 0). Aliases come with the Phase 2 overlay. |
| 4 | Home strip = most wholesale items | App sorts the list by `itemCount` high to low, ties A to Z, takes 8. "Most ordered" later. |
| 5 | Admin Brands screen = Phase 2 | After Phase 1 is on dev. |
| 6 | Brand shop in normal Haper shop later | Not built now. Retail view always gets `[]`. A later flag (`BRAND_SHOP_RETAIL`) is a small change because every read is already audience-driven. |
| - | Company vs pack brand | Keep company names ("HUL", "Reckitt") at launch. |
| - | 1-item brands | Shown. Not hidden. |

Quality bar: "neat, clean and easy to use."

Architecture calls made in this revision:
- **itemCount = number of cards**: distinct size groups (`variantGroupId`, or the item itself when it has no group)
  among this store's Business-buyable items of that brand. It is exactly the number of cards the brand page shows
  with no search text, so "12 items" on a tile never opens 9 cards. Strip, grid, chips and brand-page header all
  use this one number.
- **Brand page matches raw spellings, not a computed expression.** The list keeps, per brand, the raw spellings
  that merged into it ("Amul", "AMUL", "Amul "). The brand page filters `brand: { $in: spellings }`. One
  normaliser (in JS) decides merging; Mongo never re-implements it. Also makes "hidden" and "unknown key"
  automatic: not in the list = no page.
- **Brand page uses query params** (`?key=&page=&q=`), not path segments: brand keys contain `&`, `'`, `/`, and a
  new route with its own validator is the place to accept `q` explicitly.
- **"Search in Amul" = escaped regex on `name` within the brand**, via the existing
  `commonUtils.tokenizedSearchClauses(q, ["name"])` (escapes regex, caps 64 chars / 6 words, every word must
  match). Atlas `$search` is not used: it would need a compound filter on brand and costs more; the regex only
  scans one brand's buyable items at one store, already narrowed by the `{storeId, status}` index.
- **PlumScreenHeader is NEW** (`ui/components/PlumScreenHeader.kt`), not an extension of `HaperTopBar`.
  `HaperTopBar` is a flat bar on the page background (fixed 16 sp title, onBackground/InkTertiary colours) used by
  25 screens. Adding a gradient, white text and a search field would grow its API for 2 screens and risk all 25.
  The new header reuses existing pieces: `HaperIconButton` (back), `Modifier.cssGradientBackground` (155 deg
  WholesaleInk -> BusinessDeep, same stops as the Business hero), `HaperRadius.headerBottomCorners`.

---

## 2. Acceptance criteria (done = all true)

- [ ] Business home shows a "Shop by brand" strip after "Shop by category": up to 8 brands (most items first,
      ties A-Z) + "See all" tile when 3+ brands; tiles only for 1-2; section hidden at 0 or on error.
- [ ] "See all" opens All brands: plum header, "N brands", on-device "Search brands" filter, A-Z with sticky letter
      headers ("#" group last, headers hidden at <= 12 brands or while filtering), 3 columns at 360 dp
      (2 at font >= 1.5x, 5 at 600-839 dp, 6 at >= 840 dp).
- [ ] Every brand shown has >= 1 buyable wholesale item (active, priced, in stock) at the current store.
- [ ] "Amul", "AMUL", "Amul " are one brand. Generic/Genric/NA/-/blank/Unbranded/Local never show anywhere in brand UI.
- [ ] Brand page: header with tile, name, "N wholesale items"; "Search in <brand>" (server, 300 ms debounce,
      min 2 chars); aisle cards unchanged; paging; add to cart; size sheet.
- [ ] Business search: "amul" or "amu" shows up to 3 brand chips above the category chips (page 1, non-fallback).
- [ ] "Under Rs 50" chip is hidden in Business mode (aisle screen).
- [ ] Haper mode / non-retailer / store wholesale off / flag off: `brands: []`, `brand: null`, no chip; no wholesale
      item or brand ever leaks.
- [ ] Business mode lost while on a brand screen -> Haper home + existing snackbar.
- [ ] Old Android/iOS/web builds unchanged (only additive keys).
- [ ] Backend jest green (in-memory Mongo); Android unit tests + `./gradlew assembleDebug` green; manual guide
      `haper-misc/test-brand-shop-business.md` passes.

---

## 3. Current state (verified in code)

| Area | What exists | File |
|---|---|---|
| Brand data | `brand: String, default ""` on products and store items (fan-out). Packs re-derive brand from base on every reconcile. | `shared/models/products.schema.js`, `items.schema.js`, `product.repository.js` (`derivePackFields`) |
| Brand normaliser | `normaliseBrand` = trim + collapse spaces + lowercase | `shared/utils/variant-rules.utils.js:78-81` |
| Brand edit | Product Master (super admin), fans out. **Blocked with 409 on a product in a size group** ("Remove from size group first"). | `variant-rules.utils.js` `assertVariantEditAllowed` |
| Audience gate | `shopMode` middleware + `viewerUtils.wholesaleAudience(req)`; fails closed to RETAIL; sets `Vary` and `Cache-Control: private, no-store` in Business | `user/src/middleware/shop-mode.js`, `shared/utils/viewer.utils.js` |
| Buyable filter | `taxonomyUtils.buyableItemFilter(storeId, {wholesale})` = ACTIVE + audience + priced + qty > 0 | `shared/utils/taxonomy.utils.js` |
| Collapsed list | `getCollapsedPage4User({...})` groups by `variantGroupId`; legacy `getPaginated4User(page, limit, storeId, {wholesale})`; `loadListPage` picks one | `shared/repositories/item.repository.js:778,843`, `user/src/utils/present-items.js:140` |
| Search | `search4User` + category chips on page 1 (`categories`), fail-open | `user/src/routes/item/controller.js` |
| Escaped regex | `commonUtils.tokenizedSearchClauses` | `shared/utils/common.utils.js:75` |
| Cache | `distributedCacheUtils` (Redis, node-cache fallback). **`get()` throws on Redis error** | `shared/utils/distributed-cache.utils.js` |
| Read-only report pattern + prod guard | `report-variant-candidates.js`, `guardTarget` | `haper-backend/scripts/migrations/` |
| Android | `HomeScreen.kt` private `SectionHeader` (no trailing slot), `CategoriesQuickGrid`; `SearchCategoryChips.kt`; `AisleListingScreen.kt` (`UnderFiftyFilterChip` shown in both modes); `ShopModeState` (`mode`, `changeSignal`, `BUSINESS_UNAVAILABLE_NOTICE`); `ProductCard` + `cardWiring`; `encodeRouteArg` | `haper-android/app/src/main/java/com/bheldi/...` |
| Logos / brand API / brands collection | None | |

Real data (offline prod copy): 482 raw spellings -> 403 keys; ~37 real misspelling pairs; Generic + Genric = 368
products; 0 wholesale items in prod today (Business counts only known once wholesale stock exists).

---

## 4. Data flow

```
GET /user/brand (x-shop-mode: business)
  authenticate -> shopMode -> flag on AND wholesaleAudience(req)?
     no  -> 200 { brands: [] }                          (no DB read)
     yes -> BrandRepository.listForStore(storeId)
              Redis CACHE_BRANDS_v1:<storeId>:business (TTL 120 s; get/set errors -> compute directly)
              miss -> aggregate items:
                        $match buyableItemFilter(store, {wholesale:true}) + brand non-empty string
                        $group {brand, groupKey: variantGroupId ?? _id}     (distinct pairs)
                        $group by brand -> groups[]
                   -> brandUtils.buildBrandList(rows): key = normaliseBrand, drop hidden,
                      union groups per key (itemCount), pick display name, keep spellings, sort
                   -> cache -> respond (spellings stripped)
GET /user/brand/items?key=amul&page=1&q=butter
  same gate -> entry = list.find(key) -> none: { brand: null, items: [] }
            -> loadListPage(collapsed | legacy) with brandSpellings = entry.spellings, nameQuery = q
GET /user/item/search/:query/1 (Business) -> + brands: brandUtils.matchChips(list, query) (max 3, fail-open)
```

No new collection, field or index in Phase 1. DBA check (the DBA, on dev once wholesale items exist): `explain()`
the list aggregation and a brand page; expect the `{storeId, status, ...}` index prefix and < 20 ms. Only if a
store passes ~10k wholesale items: consider a derived `brandKey` field + index (not now).

---

## 5. API contract (FINAL)

All routes: user API, existing JWT (`jwtUtils.authenticate`), mounted after `shopMode`. Response headers from the
existing middleware: `x-shop-mode`, `Vary: x-shop-mode`, `Cache-Control: private, no-store` in Business.
Flag: `BRAND_SHOP_ENABLED` (env; `true|1|on` = on; anything else / unset = off). Default off; on in dev.
Gate (both routes and the chip): flag on AND `viewerUtils.wholesaleAudience(req) === true`. Otherwise the empty
answer below, HTTP 200, no DB read.

**Brand object** (same everywhere):
```json
{ "key": "amul", "name": "Amul", "itemCount": 12, "logoUrl": null }
```
- `key`: `normaliseBrand(brand)`. Stable while the spelling is unchanged. Clients pass it back as-is.
- `name`: the merged spelling with the most cards, trimmed, spaces collapsed; tie -> smaller string (code-unit order).
- `itemCount`: cards, as defined in section 1. Always >= 1.
- `logoUrl`: always `null` in Phase 1 (string URL in Phase 2).

### 5.1 `GET /user/brand`
Request: no params. Any query string is ignored.
```json
200 { "msg": "Brands fetched", "data": { "brands": [ { "key": "amul", "name": "Amul", "itemCount": 12, "logoUrl": null } ] } }
```
- Order: keys starting `a`-`z` first, then everything else ("#" group); inside each, key ascending (code-unit
  order), tie by name. Clients derive the letter as uppercase first char of `key` if `a`-`z`, else `#`.
- No paging. Hard cap 1,000 brands (warn log once if hit). ~400 brands ~ 25 KB.
- Gate fails -> `{ "brands": [] }`.

### 5.2 `GET /user/brand/items`
| Query | Rule |
|---|---|
| `key` | required string, trimmed, 1-120 chars |
| `page` | integer >= 1, default 1 |
| `q` | optional string, trimmed, max 64; if shorter than 2 chars it is ignored (full list) |
Unknown query keys -> validation error. Validation errors use the user API's convention:
`errorUtils(message, 403)` (same as `/user/item` validators).
```json
200 { "msg": "Items fetched", "data": {
        "brand": { "key": "amul", "name": "Amul", "itemCount": 12, "logoUrl": null },
        "items": [ ...exactly the aisle item shape (collapsed with variant header, legacy without)... ],
        "cart": { "items": [ ... ] } } }
```
- Page size 12 (aisle). Order: aisle order (`isSuggested` desc, `_id` desc). Every item returned is in stock
  (buyable filter), so "in-stock first" holds by construction; sold-out sizes appear only inside the size sheet,
  as in the aisle.
- `q` filter: `tokenizedSearchClauses(q, ["name"])` added as `$and`; each word must be in the item name
  (case-insensitive, regex-escaped). `q` does not change `brand.itemCount`.
- Key not in the store's current list (unknown, hidden, sold out, renamed) or gate fails ->
  `{ "brand": null, "items": [], "cart": { "items": [] } }`.
- `brand` non-null + `items: []` + `q` present = "no match in this brand".
- Errors: 401 from `authenticate`; 403 validation; DB errors -> `next(error)` like other routes.

### 5.3 Search: `GET /user/item/search/:query/:page` (additive key)
Response `data` gains `brands: [Brand]`, always present (`[]` when none). Non-empty only when ALL hold: gate
passes, `page == 1`, `isFallback == false`, and the match rule:
- `n = normaliseBrand(query)`; a brand matches if `key == n`, or (`n.length >= 3` and `key.startsWith(n)`).
- Sort: exact match first, then `itemCount` desc, then name A-Z. Max 3.
- Reads the cached list (no extra DB read on a cache hit). Any error -> `brands: []` (fail-open, logged).
- Item results and `categories` are unchanged.

### 5.4 Cache
- Server: `CACHE_BRANDS_v1:<storeId>:business`, TTL 120 s, value = list incl. internal `spellings`. Key includes
  the view so retail and Business can never share an entry. No invalidation in Phase 1 (TTL only). Concurrent
  misses may compute twice (accepted).
- App: in-memory per (storeId, Business) for 5 min, shared by strip and All brands; pull-to-refresh bypasses it;
  store change or mode change clears it. Worst-case staleness ~7 min (sold-out brand opens to the sold-out state).

### 5.5 Not in Phase 1
`BRAND_SHOP_RETAIL`, admin routes (`GET/PUT /admin/brand`, logo upload), aliases. See Phase 2.

---

## 6. Phase 0: data clean-up (ops, no app code) — can start now

Script (backend engineer writes it, slice B0): `haper-backend/scripts/migrations/report-brand-duplicates.js`.
READ-ONLY, same pattern as `report-variant-candidates.js` (secondaryPreferred, autoIndex/autoCreate off,
`guardTarget` -> prod needs `--confirm-db=<db>`). Reads `products` (`brand`, `name`, `status`, `variantGroupId`).
CSV to stdout or `--out=<file>`, rows by type:
- `suspect`: keyA, countA, keyB, countB, reason, groupedCount, sample names. Reasons: same after stripping
  punctuation/spaces (haldiram/haldiram's, p&g/pg, close up/closeup), word-prefix (marico/marico ltd,
  jyothy lab/jyothy labs), edit similarity >= 0.85 (cadbbury/cadbury, reckit/reckitt). Small Levenshtein inside
  the script, no new dependency.
- `merged`: spellings auto-merged by case/space (info only).
- `hidden`: hidden-list keys with product counts (info only).
- `mojibake`: brands containing `â€` or `Ã` (e.g. "Bagrryâ€™s").
The user runs it (dev first; prod only with owner OK).

What staff do in Product Master (super admin):
1. For each `suspect` pair decide: same brand? If yes, edit the wrong-spelled products' Brand to the right
   spelling. Saving fans out to every store's items (and packs re-derive). This also fixes search.
2. Rows with `groupedCount > 0`: the edit is blocked (409 "Remove from size group first"). Remove the product
   from its size group, fix the brand on every member, re-create the group. Or leave the pair for Phase 2 aliases.
3. Fix mojibake ("Bagrryâ€™s" -> "Bagrry's").
4. Do NOT rename Generic/Genric (hidden anyway) and do NOT change company names to pack brands.
Done when a re-run shows only pairs that are intentionally different brands.

---

## 7. Phase 1 build slices

Rules for every slice: reuse existing code/queries/indexes; one responsibility per file; minimal comments
(non-obvious "why" only); grep all callers of anything shared you touch; additive only (new args default to
today's behaviour, new response keys nullable); backend tests in-memory Mongo only
(`cd packages/user && NODE_ENV=test npx jest <file>`); Android: unit tests + `./gradlew assembleDebug`.
Files are disjoint across slices. Order within a lane is the number order.

### Backend — backend engineer

| Slice | Files | Acceptance + tests |
|---|---|---|
| **B0** duplicate report | NEW `scripts/migrations/report-brand-duplicates.js` | Read-only; prod guard aborts without `--confirm-db`; on the offline/dev data lists generic/genric, cadbbury/cadbury, haldiram/haldiram's, the mojibake row. Test: pure pair-finder exported and unit-tested in `admin/__tests__/report-brand-duplicates.test.js` (no DB). |
| **B1** constants + pure utils | NEW `shared/constants/brand.constant.js`, NEW `shared/utils/brand.utils.js`; add one export line each in `shared/constants/index.js` (`BrandConstants`), `shared/utils/index.js` (`brandUtils`) | Constants: hidden keys, `CACHE_PREFIX = "CACHE_BRANDS_v1"`, TTL 120, MAX_BRANDS 1000, CHIP_MAX 3, CHIP_PREFIX_MIN 3, PAGE_SIZE 12. Utils: `brandShopEnabled()`, `isHiddenBrandKey(key)`, `buildBrandList(rows)` -> `[{key,name,itemCount,logoUrl:null,spellings}]` sorted, `toPublicBrand(entry)`, `matchChips(list, query)`. `brandKey` IS `variantRulesUtils.normaliseBrand` (no copy). Test `user/__tests__/brand.utils.test.js`: merge "Amul"/"AMUL"/"Amul "; group split across two spellings counted once; hidden list + "-"/""; display-name tie rule; "#" group last; chip exact/prefix/2-char/max 3/order; flag parsing. |
| **B2** brand repository | NEW `shared/repositories/brand.repository.js`; one export line in `shared/repositories/index.js` (`BrandRepository`) | `listForStore(storeId)` (Business view only; aggregation in section 4 using `buyableItemFilter(toOid(storeId), {wholesale:true})`; cache get/set each in try/catch). `findByKey(storeId, key)`. Test `user/__tests__/brand.repository.test.js`: only buyable wholesale brands; out-of-stock/unpriced/inactive/retail-only brand excluded; itemCount = cards; Redis `get` throwing -> still returns list. |
| **B3** item repo brand filter | `shared/repositories/item.repository.js` only | `getCollapsedPage4User({..., brandSpellings = null, nameQuery = null})` and `getPaginated4User(page, limit, storeId, { wholesale, brandSpellings = null, nameQuery = null })`: array -> `brand: {$in}`; `nameQuery` -> `$and: tokenizedSearchClauses(nameQuery, ["name"])`. Null = byte-identical query. Grep callers (home, item controllers): none pass the new args. Test `user/__tests__/item-brand-filter.test.js`: filters both paths; `q` "(" / ".*" safe; no args = same results as before; existing `home.test.js`, `item.test.js` green. |
| **B4** brand routes | NEW `user/src/routes/brand/router.js`, `controller.js`, `validator.js`; mount line in `user/src/routes/index.js` | Router: `authenticate`, `shopMode`; `variantMode` on `/items`. Contract 5.1/5.2 exactly. Test `user/__tests__/brand-shop.test.js`: leak matrix (no header / header + non-retailer / store wholesale off / flag off) x 2 routes -> empty; list + page happy path; hidden key -> `brand: null`; `q` filter + `q` 1 char ignored; page 2; unknown query key -> 403; no `costPrice`/`taxonomy` in items; `Vary`/`no-store` headers. |
| **B5** search chips | `user/src/routes/item/controller.js` only | Contract 5.3. Test `user/__tests__/item-search-brand-chip.test.js`: Business "amul"/"amu" -> chip; "am" -> none unless exact; page 2 / fallback / retail -> `[]`; list error -> `[]` and items unchanged. Run existing `item-search-category`, `variant-search`, `item-search-fallback` suites; if one asserts the exact `data` shape, add `brands: []` there (no other change). |
| **B6** env + docs | `.env.example` (`BRAND_SHOP_ENABLED=false` + one-line comment), NEW `docs/reference/brand-shop.md`, swagger comments already in B4 router | Doc = contract + flag + cache + Phase 0 note. Full `packages/user` jest green. |

Deploy note: the user sets `BRAND_SHOP_ENABLED=true` in the dev environment and deploys dev (agents do not touch
AWS / env files).

### Android — Android engineer (logic/VM/API first, then UI)
Paths under `haper-android/app/src/main/java/com/bheldi/` (tests under `app/src/test/java/com/bheldi/`).

| Slice | Files | Acceptance + tests |
|---|---|---|
| **A1** models + API | NEW `data/model/BrandModels.kt` (`BrandModel(key: String?, name: String?, itemCount: Int?, logoUrl: String?)`, `BrandListData(brands: List<BrandModel>?)`, `BrandItemsData(brand: BrandModel?, items: List<ItemModel>?, cart: ...?)`); `data/api/ApiService.kt` (+`getBrands()`, +`getBrandItems(@Query key, page, q: String?)`); `data/model/HomeModels.kt` (`SearchResultData.brands: List<BrandModel>? = null`) | All fields nullable (Gson ignores Kotlin defaults). Brands with blank key/name dropped at the VM. Test `data/model/BrandModelsGsonTest.kt`: missing keys -> null, no crash; old search JSON without `brands` decodes. |
| **A2** pure display logic | NEW `ui/screens/brand/BrandDisplay.kt` | `initials(name)`, `colourSlot(name)` (sum of code points of normalised name mod 8), `letterOf(key)`, `sections(list)` ("#" last), `filter(list, q)` (contains, case-insensitive), `stripBrands(list)` (itemCount desc, ties keep A-Z, max 8), `columnsFor(widthDp, fontScale)`, `countLabel(n)` ("1 item"/"N items"), `brandsLabel(n)`. Test `ui/screens/brand/BrandDisplayTest.kt`: "Amul"->"Am", slot 7; "Ching's Secret"->"CS"; "9am"->"9a", "#"; "bond" finds "Brooke Bond"; columns 360/1.0=3, 360/1.5=2, 700=5, 900=6. |
| **A3** brand list VM | NEW `ui/screens/brand/BrandListViewModel.kt` (activity-scoped; API injectable via constructor default `NetworkModule.getApiService()`) | States: Loading, Loaded, Empty, Error, Offline(cached?). Cache 5 min per (storeId, mode); `load(force)`; clears on `ShopModeState.changeSignal` and store change; filter text kept in VM. Test `ui/screens/brand/BrandListViewModelTest.kt` (coroutines-test + fake API): cache hit skips network; force refreshes; store change refetches; error -> Error; offline with cache -> cached + offline flag. |
| **A4** brand items VM | NEW `ui/screens/brand/BrandItemsViewModel.kt` (nav-entry scoped) | Paging (12, next page on full page, request-id guard like `categoryReqId`); query debounce 300 ms, < 2 chars = full list; states Loading, Loaded, SearchNoMatch, SoldOut (`brand == null`, same store as opened), Unavailable (`brand == null`, store changed), Error, LoadMoreError. Test `BrandItemsViewModelTest.kt`: debounce collapses typing to one call; stale response dropped; each state. |
| **A5** shared components | NEW `ui/components/BrandTile.kt` (`BrandTile`, `BrandCell`), NEW `ui/components/PlumScreenHeader.kt` | Per design sections 3, 4, 7, 8: badge/logo (Coil, cross-fade 160 ms, stay on badge on failure), ring, one-button cell with label "Amul, 12 items", reduce-motion. Header: back, title, subtitle, optional leading tile, search field 46 dp/radius 18 with clear (x) 48 dp, disabled flag. `assembleDebug`. |
| **A6** All brands screen | NEW `ui/screens/brand/BrandsScreen.kt` | `LazyColumn` of chunked rows + `stickyHeader` letters; states/copy per design section 6; scroll + filter `rememberSaveable`; `FloatingCartBar(business = true)`; analytics `logScreen("brands")`, `brand_tap` (source all_brands), `brands_filter_no_match`. |
| **A7** brand page | NEW `ui/screens/brand/BrandItemsScreen.kt` | Plum header (name/count/logo from route args, instant); 2-col grid with `ProductCard(AisleGrid)` + `cardWiring` (shared, unchanged); skeletons, load-more retry row, states per design; analytics `logScreen("brand", brand_key)`, `trackViewItemList("brand:$key")`. |
| **A8** home strip | NEW `ui/screens/home/BrandStrip.kt`; `ui/screens/home/HomeScreen.kt` | `SectionHeader` gains `actionLabel: String? = null, onAction: (() -> Unit)? = null` (existing calls unchanged). Strip only when `isBusiness`, after "Shop by category"; 5 skeleton tiles; hidden on 0/error; See-all rules (0/1-2/3+); events `brand_tap` (home_strip), `brands_see_all_tap` (header/tile). Haper mode home pixel-identical. |
| **A9** search chips | NEW `ui/screens/search/SearchBrandChips.kt`; `ui/screens/search/SearchScreen.kt` | Brand chip row above category chips, only Business, page 1, non-fallback, max 3; reuse the `CategorySearchChip` shell look; 24 dp `BrandTile`, "12 items"; `onBrandClick` callback; event `brand_tap` (search_chip). Retail search unchanged. |
| **A10** navigation + mode loss | NEW `ui/screens/brand/BrandRoute.kt` (`brands`, `brand/{key}?name=&count=&logo=`, reuse `encodeRouteArg`); `MainActivity.kt` | Create `BrandListViewModel` with the other activity VMs; wire Home/Search/Brands callbacks; when mode becomes HAPER on a brand route -> `popBackStack("main", false)` (Home shows the existing notice via `consumeFallback`); deep link `brand/...` in Haper -> home. Test: extend `NavTabForRouteTest.kt` if brand routes map to a tab. |
| **A11** hide "Under Rs 50" in Business | `ui/screens/category/AisleListingScreen.kt` only | Chip not rendered and filter forced off when `ShopMode.BUSINESS`; Haper mode unchanged. |

Parallelism: B0 + B1 + A1 + A2 start together. A3/A4 can run against a fake until B4 is on dev.
QA: `haper-misc/test-brand-shop-business.md` (new) + iOS/web rows in `haper-misc/client-followups.md` —
project lead assigns (QA owner), same session as the build.

### Phase 2 (after Phase 1 on dev) — not in this build
`brands` overlay collection `{ key unique, displayName, aliases[] (partial unique), logoUrl, hidden }`, admin
"Brands" page (super admin, FE/BE permission mirror, audit log, logo upload via `uploadAndProcessImages`),
`buildBrandList` takes the overlay; cache keys deleted per store after commit. Then optional `BRAND_SHOP_RETAIL`.

---

## 8. Edge cases and risks

| Case | Behaviour |
|---|---|
| Brand only on sold-out / unpriced / inactive items | Not listed (buyable filter). |
| Brand sells out after caching | Visible up to ~7 min; brand page -> "Amul is sold out right now". |
| Size group whose members have two spellings | Counted once (groups unioned per key). |
| Brand renamed in Product Master | New key after <= 120 s; old key's page -> `brand: null`. Deep links by key not promised. |
| Long names (max 31 chars) | 2 lines + ellipsis; full name in a11y label and brand page. |
| `q` with regex characters | Escaped by `tokenizedSearchClauses`; capped 64 chars / 6 words. |
| Packs | Carry base brand; `wholesaleOnly`, so they count in Business. |
| Retailer revoked / store wholesale off mid-session | Viewer cache <= 60 s, then RETAIL -> empty; app falls back via existing `x-shop-mode` echo. |
| Redis down | `get` throws -> compute from DB each call (one aggregation); still correct. |

**Security (leak).** Every read goes through the gate + `buyableItemFilter(store, {wholesale})`; the cache key
includes the view; the brand page only matches spellings from the Business list; spellings never leave the
server. Leak matrix test in B4.

**Backward compatibility.**
- `/user/item`, `/user/home/*`: repo functions get optional args defaulting to null -> identical queries (B3 test).
- Search: one additive key `brands` (array). Android Gson nullable; iOS Codable ignores unknown keys; web ignores.
- `SectionHeader` new params default null; Haper home unchanged. `HaperTopBar` untouched.
- No schema, index or write-path change. Admin product/item forms unchanged.

**Rollout / rollback.** Dev only, flag on in dev. Flag off = every app hides strip, chips and pages, no release.
Nothing hard to reverse.

---

## 9. Test strategy (summary)
- Backend unit: B1 utils, B0 pair finder. Integration (in-memory Mongo): B2, B3, B4, B5 + existing item/home/search suites.
- Android unit: A1 Gson, A2 display logic, A3/A4 VMs; `./gradlew assembleDebug`.
- Manual: `test-brand-shop-business.md` — strip rules (0/1-2/3+), grid columns at 360 dp and 200% font, filter
  no-match, brand page search, sold-out/unavailable states, chip "amu", Haper mode sees nothing, store flag off,
  Business mode lost, Under Rs 50 hidden in Business only, deploy + flag needed.

---

## 10. Still open (not blocking Phase 1)
1. Who in ops does the Phase 0 Product Master clean-up, and by when (should finish before Business goes live in prod).
2. Real Business brand counts are unknown until wholesale items exist (0 in prod today); re-check strip/grid look then.

---

## Build notes (Phase 1, 2026-11-20)
- Legacy brand page (`variantsEnabled` off) lists per item, not per size group, so it can show more cards than `itemCount`. Accepted.
- Cache key uses the canonical store id (`toOid`), so the same store always hits the same entry.
- Duplicate report counts active products only and defuses spreadsheet formulas in CSV cells (`=`, `+`, `-`, `@`).
- Home strip keeps the cached brands when a refresh fails (decision; the design said hide). Full error state only when nothing is cached.
- Search always returns `data.brands`; it is non-empty only in Business, flag on, page 1, not fallback.
- iOS and web wait for their Business switch (CH-23 in `client-followups.md`).
- Phase 0 spelling clean-up is owner/ops work (section 6), not app code.
