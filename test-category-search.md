# Test: Search finds category / sub-category names

**Area:** Customer app → Search. Typing a category name ("biscuit", "dairy") now lists that
category's in-stock products.
**Backend:** `GET /user/item/search/:query/:page` (packages/user `routes/item/controller.js`),
`shared/repositories/category-search.repository.js`, `shared/utils/category-search.utils.js`,
shared aisle predicate `taxonomyUtils.buyableMembershipFilter`.
**Plan:** `plans/category-search-plan.md`. **Client tracker:** `client-followups.md` CH-15.

## What changed (plain words)
- Before: searching "biscuit" only looked at product **names**. "Good Day" is a biscuit but its
  name has no "biscuit", so the app said "We couldn't find 'biscuit', here are popular picks".
- Now: the search also checks **category and sub-category names**. If "biscuit" matches
  "Biscuits & Cookies", that category's buyable products are added **after** the name hits.
- Example: store has "Biscuit Crackers" (name hit) + "Good Day", "Marie Gold" (filed under
  Biscuits & Cookies). Search "biscuit" → `Biscuit Crackers`, then `Good Day`, `Marie Gold`.
- **Bug fix on the same screen:** "load more" (page 2) used to repeat page 1 minus one item, so
  each scroll added only ONE new product. Page 2 now brings 10 new products.
- Response gains `data.categories` (always an array; filled on page 1 only). Old apps ignore it.

## Deploys needed
1. Backend → dev (`dapi.haper.in`). That is enough for **old** app builds to show the fix.
2. Android chips: a later Play Store build. Order: backend deployed FIRST, app release after
   (see "Android chips" below).
3. Optional, user-run, read-only check: `idx_items_store_status_taxonomy` exists on `items`
   (plan §9 V3). Without it search is still correct, just slower.

## Steps — dev backend, OLD Android build (no app update)
Use a store that has a category like "Biscuits & Cookies" with some in-stock products.

| # | Do | ✅ Expect | ❌ Bug if |
|---|---|---|---|
| 1 | Search `biscuit` | Products from Biscuits & Cookies listed, no "popular picks" banner | Popular-picks banner shown |
| 2 | Search `biscuits`, `Biscuits`, `BISCUIT` | Same products as step 1 | Any of them falls back |
| 3 | Search `bisc` (prefix) | Same products | Fallback |
| 4 | Search `biscut` (one typo) | Same products | Fallback |
| 5 | Search `cream biscuits` | Only the "Cream Biscuits" sub-category's products | Every biscuit shown |
| 6 | Search `diary` (swap of "dairy") | Dairy products | Fallback |
| 7 | Search `amul` | Exactly the same first results, same order, as before the deploy | Order changed / extra items first |
| 8 | Search `amul milk` | Same as before (no whole Milk category added) | Every milk product added |
| 9 | Search `mi` (2 letters) | Same as before (no category matching under 3 letters) | Whole Milk category added |
| 10 | Search `biscuit`, scroll to load page 2, 3 | Each scroll adds new products; **no product appears twice** | Duplicates, or only 1 new item per scroll (not a bug: if stock changes between two page loads, one product can be skipped or appear twice; the app hides the repeat) |
| 11 | Search a word matching nothing (`zzqx`) | Popular-picks banner, same as before | Error / empty screen |
| 12 | Search `a+b*(c)?[` | Normal response, no crash | Error |

## Edge cases (set up in dev admin first)
| Case | Setup | ✅ Expect |
|---|---|---|
| All items out of stock | Category "Frozen Foods" whose items all have stock 0 | `frozen` adds nothing from it; no chip |
| Unpriced items | Category whose items all have selling price 0 | Not matched |
| Category disabled for the store | Admin → Categories → turn it **off** for this store | Its name no longer adds products (others still do) |
| Category only in another store | Category stocked only at store B | Searching at store A never shows it |
| Secondary tag | Item whose 2nd category tag is Biscuits & Cookies (primary is Snacks) | Found by `biscuit` |
| Item hit by name AND category | "Biscuit Mix" filed under Biscuits | Appears once, at its name-hit position |
| Rename a category in admin | Rename "Biscuits & Cookies" → "Cookies" | Search picks up the new name within ~60 s |
| Deactivate a category / sub-category in admin | Set "Biscuits & Cookies" to inactive | It stops matching within ~60 s (it may still show for up to a minute) |

## API check (response contract)
`GET /user/item/search/biscuit/1` → `data` keys are exactly `item`, `cart`, `isFallback`,
`categories`. Each `categories[]` entry:
`{ categoryId, subCategoryId (null for a category), name, parentName (null for a category), icon, itemCount }`.
Page 2+ → `categories: []`. No item carries `taxonomy`, `costPrice`, `quantity`, `status`.

## Kill switch
Set `SEARCH_CATEGORY_MATCH=false` (or `0` / `off`) on the user service and restart → search
behaves exactly as before (name-only; `categories: []`), except the page-2 skip fix stays.
Any internal error in the category step is logged (`[item.search] category match failed`) and
the old name-only result is returned — never a 500.

## Limits (by design)
- Name hits capped at 100 and category products at 300 for a category-matched query.
- Hindi/local words (`atta`, `doodh`) only match if the category name contains them (synonyms are a follow-up).
- Up to 8 chips per query.
- Taxonomy-only everywhere: items with an empty `taxonomy` (not backfilled) are excluded from search, the aisle list AND the home category/sub-category tiles, so tile counts always match the aisle. Backfill before expecting such items to show.
- Pages are fixed slices of one list. If stock changes between two page loads (an item sells out or comes back), the list shifts: one product can be skipped or show twice. The apps drop the repeat by id. Expected, not a bug.
- A category or sub-category set to inactive in admin can still match for up to ~60 s (same delay as a rename). Turning it off for one store is instant.
- Items with an EMPTY taxonomy list are not listed in the aisle or in category search (the old fallback to the single category field was removed). Invariant: every active item has at least one taxonomy entry (admin create requires a category, edits reject an empty taxonomy, backfill migration). Dev and the prod dump have 0 such items.

## Automated tests (in-memory Mongo)
`cd haper-backend/packages/user && NODE_ENV=test npx jest --coverage=false --forceExit __tests__/item-search-category.test.js __tests__/category-search.utils.test.js`

## Android chips (new app build)
**Code:** `haper-android` `ui/screens/search/SearchCategoryChips.kt` (row + parsing), `SearchScreen.kt`
(wiring), `ui/screens/category/AisleRoute.kt` (route `aisle/{categoryId}?sub=&name=`),
`HomeViewModel.onCategorySelected(categoryId, initialSubCategoryId)`, `AisleListingScreen.kt`.
**Needs:** the backend above deployed to dev first; the chips ship in the next Play Store build.
**Analytics:** tap logs `search_category_chip_tap` (`query`, `category_id`, `sub_category_id`, `position`).

| # | Do | ✅ Expect | ❌ Bug if |
|---|---|---|---|
| A1 | Search `biscuit` | "Categories" caption, then a row of pill chips (e.g. `Biscuits & Cookies 42`), then "N results for …" | No row / row below the count |
| A2 | Look at a sub-category chip (`cream biscuits`) | Two lines: `Cream Biscuits 9` / `in Biscuits & Cookies` | One line, or "in null" |
| A3 | Query with more than 6 matching chips | At most 6 chips; the row scrolls sideways edge to edge | 7+ chips, or row clipped at 16dp |
| A4 | A chip whose count is 100+ | Shows `99+` | Shows `100` or a long number |
| A5 | Tap a category chip | Keyboard closes; aisle opens on **All**, titled with the category name | Wrong aisle / title "Aisle" |
| A6 | Tap a sub-category chip | Parent aisle opens with that sub-category already selected in the left rail; list = that sub's items | Opens on All, or shows the wrong sub |
| A7 | Back from the aisle | Search screen with the same query and results (chips re-appear) | Query lost |
| A8 | Scroll results to load page 2 | Chips stay as they were (page 2 never changes them) | Chips vanish or duplicate |
| A9 | Search `amul` (no category match) | No caption, no row; screen identical to before | Empty "Categories" caption |
| A10 | Search `zzqx` (fallback) | "We couldn't find…" + popular picks, NO chips | Chips above popular picks |
| A11 | Airplane mode, search | Existing error/empty state; no chips | Chips without results |
| A12 | Clear the search (x) | Chips disappear with the results | Old chips linger |
| A13 | TalkBack on a chip | "Open category Biscuits & Cookies, 42 items" / "Open Cream Biscuits in Biscuits & Cookies, 9 items"; caption read as a heading | Name read twice, or no "button" |
| A14 | Font size max (Settings) | Chips grow taller, row stays one line, nothing clipped | Text cut off |
| A15 | Tap a chip for a sub-category low in the list (e.g. 10th of 14) | Aisle opens with that entry selected AND scrolled into view in the left rail | Highlighted entry off-screen |
| A16 | In the aisle, tap an already-visible rail entry | Rail does not jump | Rail scrolls unexpectedly |

**Old backend / old response:** new app build against a backend WITHOUT `data.categories` → no row,
search works exactly as before (unit test `searchItems without categories key…`). Malformed entries
(blank id or name, `null`) are dropped, never a crash.

**Unchanged callers:** home tiles and the All-categories grid still open `aisle/<id>` (no `sub`) and
land on All.

Unit tests: `cd haper-android && ./gradlew testDebugUnitTest` (`SearchCategoryChipsTest`,
`AisleRouteTest`, `ApiContractTest` search cases, `HomeViewModelTest` pre-select cases).
