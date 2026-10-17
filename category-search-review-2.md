# Category search — review 2 (backend re-review + Android review)

Reviewer: Mayank. Date: 2026-10-17. Read-only. Both trees uncommitted on `dev`.

## Part 1. Backend re-review (haper-backend)

Tests run (in-memory, targeted): `category-search.utils`, `item-search-category`, `item-search-fallback`.
3 suites, 99 tests, all green.

### Round-1 findings: all fixed and verified
- **H1 fixed.** `category-search.utils.js:82` uses `editDistanceWithin(qf, nf, 1) <= 1`, and `TYPO2_MIN_LEN` is gone.
  Mutation probe: I put the old `>= 8 ? 2 : 1` rule into an out-of-tree copy loaded through `moduleNameMapper`.
  The new test "one typo only, even for long words" FAILS against it (1 failed / 35 passed: `personal` vs Seasonal
  scored 1, expected 0). The test pins the rule.
- **M1 fixed, output unchanged.** `controller.js:62` calls `search4User(0, min(100, end))`.
  - If it gets back `end` rows, the page is all name hits and returns early.
  - If it gets back fewer rows than its limit, the whole name list (up to the cap) is in hand. Dedupe is then exact, as before.
  - When `end > 100`, the limit is 100 and A is the same capped set as in round 1.

  The `{taxonomy, category, subCategory}` `$project` placed before `EFFECTIVE_TAXONOMY_STAGE` keeps every field
  that stage reads (`taxonomy`, `category._id/name`, `subCategory._id/name`), and `_id` stays. Counts are identical.
  The cost test is meaningful: it asserts page 1 calls `[[0,10]]` with no `categoryItemIds` and no doc fetch, and
  page 3 calls `[[0,30]]`. The old `(0,100)` call fails it.
- **DBA L3 fixed (3 spare ids + trim).** Covered by "an item that sells out after the id read is replaced". With 0 spare ids the page has 9 items and that test fails.
- **L3 fixed.** The snapshot reload failure now logs `console.warn` with the error. The controller catch logs the full error, including the stack. The name-cap warning fires once per process.
- **L4 fixed.** The regex is now written as `/[̀-ͯ]/g`. No raw combining marks are left in the file.
- **L5 fixed.** No `B0` or `TYPO2` remains. `client-followups.md` CH-15 now says web loads page 1 only.
- **L1 fixed.** `test-category-search.md` step 10's ❌ column and the Limits section explain the stock-shift skip/repeat.

### Regression check: none found
Ranking (name hits first, then the aisle order), `isFallback` (page 1 and empty only, with `categories` forced to
`[]`), and the response keys (`item, cart, isFallback, categories`) are unchanged.

Old offset bug: `search4User(page - 1, …)` made page 2 return items 2–11. Every path now uses `(page-1)*10`. This is the
planned fix (plan §2, task B3) and has its own test. Old clients dedupe by id, so it is safe for them.

### Spare-id trim: can an item appear on two pages?
Not through the trim itself. An id dropped by the doc fetch (sold out after the id read) is also missing from
the NEXT request's fresh id read. So the next page's offset lines up exactly after the spare that filled the gap.
Both reads use the same `buyableItemFilter` and the same store id cast, so no id is always dropped.

A repeat can happen only when that item comes back in stock before the next page loads. That is the same
offset-paging shift already accepted in L1. Clients hide it with id-dedupe. **Accept.**

### New findings (LOW only)
- **L-B1. Ties in the regex fallback sort can repeat or skip an item at page edges.** `item.repository.js:101` sorts by
  `{ name: 1 }` only. Grocery stores often have several items with the same name in different pack sizes. MongoDB does not
  guarantee an order between equal sort keys. The category path now uses a different limit on every page (10, 20, 30…), so a
  same-name pair that sits across a page edge can swap places. One item then shows twice and the other never shows.
  Dedupe stays exact, because when A is short of its limit it is the full set. The plain name search had the same issue before this diff.
  This only happens when the Atlas index is unhealthy. Fix: `.sort({ name: 1, _id: 1 })`.
- **L-B2. The chip aggregate still runs on pages 2+, where the chips are thrown away.** `controller.js:55` runs
  `findCategoryChips` (the count aggregate + the disabled-row read) before the name search on every page. When the page is all
  name hits, the output does not depend on the chips at all. Optional: run the name search first, and return early when
  `page > 1 && nameHits.length >= end`, before computing chips. When category items are needed, the chips (and therefore the counts)
  are still required, because the top-8 cut uses `itemCount`. The aggregate is light now that the early `$project` is in. Accept, or do this as a follow-up.

**Backend verdict: APPROVE.** Every round-1 finding is fixed and pinned by a test that fails on the old code. Nothing regressed.

## Part 2. Android review (haper-android)

Tests: I did not re-run Gradle. The `app/build/test-results` XML files are dated 03:02, after the last source edit (03:01:13).
AisleRouteTest 4, SearchCategoryChipsTest 8, NavTabForRouteTest 6, ApiContractTest 57, HomeViewModelTest 46: 0 failures.
This agrees with the engineer's reported 546 green.

### Verified clean
- **Gson null-safety.** `HomeModels.kt:329` `categories: List<SearchCategoryMatch?>?`, and every `SearchCategoryMatch` field is nullable.
  A missing key, `null`, null entries, and blank id/name are all dropped in `toSearchCategoryChips`. The contract test covers the
  old-backend shape. `-keep class com.bheldi.data.model.** { *; }` covers release R8.
- **`itemCount: Int?` is the right choice.** Gson's int adapter accepts `42`, `"42"` and `42.0`. Only a non-number such as `"abc"` or `12.5` fails,
  and that fails the whole response, which shows the search error state. The value comes from our own `$sum`, which is always an integer,
  and a wrong type in any other field would break decoding the same way. A lenient type (`Double?` / `JsonElement`) is not worth it.
- **Chip states.**
  - The row shows only when `!isFallback && results.isNotEmpty() && chips.isNotEmpty()`.
  - Chips are parsed only for page 1 and non-fallback responses (`SearchScreen.kt:702`). The page-2 callback ignores them.
  - Chips are cleared on an empty query, the clear (X) button, and errors.
- **Slow page 1 vs a new query: no stale chips.** `LaunchedEffect(query)` cancels the old request. The cancelled Retrofit call
  throws, so the old `onSearchComplete` never runs. The row key `category-chips:$chipsQuery` resets the row on every new query.
- **Route encoding.** `encodeRouteArg` percent-encodes everything except unreserved characters, so `&`, `%`, `+`, `?`, `/`, spaces and
  non-Latin text are all safe. Navigation 2.8.9 decodes each value exactly once (`getQueryParameters`; `Uri.decode` for the path arg),
  as I checked in the library source. No injection: `&name=` cannot inject a `sub`.
  The legacy `navigate("aisle/${Uri.encode(id)}")` callers still match because the query args are optional with null defaults.
  `destination.route` is now the pattern string, which still `startsWith("aisle/")` (tab highlight, screen-name analytics, cart bar).
  A test pins this.
- **Pre-select race.** The sub id is applied after the sub-category list loads, inside the `categoryReqId` guard. An unknown sub id, or a
  failed sub-category load, opens "All". Before the list loads there are no rail entries to tap, so the user cannot race it.
- **Accessibility.**
  - Chips have `Role.Button`, merged semantics, and the spec's exact contentDescription strings ("1 item" and no-count cases tested).
  - The heading has `heading()`, and the touch target is `heightIn(min=48.dp)`.
  - The "in <parent>" line uses `InkSecondary`, matching the spec's AA correction.
  - IME is dismissed on tap.
- **Analytics PII.** The same query text is already sent today, untruncated, as `search_term` in `trackSearch`. So the new event adds
  no new kind of data. A chip only exists when every query word matched a category name, so the logged text is category words
  (for example "cream biscuits"), not free text. Truncating to 100 characters fits Firebase's value limit. Acceptable as built.
- **Old backend.** No `categories` key gives no chips, and the screen is the same as today.
- **Plan and spec.** A1–A4 and the design spec match (6-chip cap, 99+, text only, 720dp cap, no skeleton, CircleShape).

### MEDIUM
- **M-A1. The pre-selected sub-category can be off-screen in the aisle rail.** `AisleListingScreen.kt:471-515`:
  `AisleSubCategoryRail` is a vertical `LazyColumn` with no list state, and nothing scrolls to the selected entry. A chip for
  a sub-category low in the list (say the 10th of 14) opens the aisle with the right products. But the highlighted rail entry is
  below the fold, and the visible top entry ("All") looks unselected. The user cannot tell which shelf they are on.
  Fix: `val listState = rememberLazyListState()` in the rail, plus
  `LaunchedEffect(selectedSubCategory?.id, subCategories.size) { val i = subCategories.indexOfFirst { it.id == selectedSubCategory?.id }; if (i >= 0) listState.animateScrollToItem(i + 1) }`
  (+1 for the "All" item). Add a manual step to the test guide.

### LOW
- **L-A1. The chip row cannot skip recomposition.** `SearchScreen.kt:400` passes `categoryChips.toList()`, which is a new list on every
  LazyColumn recomposition (each page-2 append, each cart change). Under strong skipping, the row always recomposes. The cost is small
  (6 chips, and the stable chips inside still skip). Fix: pass `categoryChips` directly, or `remember(chipsQuery) { categoryChips.toList() }`.
- **L-A2. The aisle re-applies the chip's sub-category when you come back from item detail.** `AisleListingScreen.kt:144`: the effect
  re-runs when the screen is shown again. If the user switched to another shelf, Back from item detail resets it to the chip's sub.
  Today it resets to "All", so this is not a regression; it is the same reset with a different target. Note it only.
- **L-A3 (existing before this diff, FYI).** Search results are `remember`, not saveable. So Back from the aisle re-runs the search after the
  800 ms debounce and loses the scroll position. The spec line 36 promise ("returns to the same ... scroll") is not met, but item detail
  already behaves this way. `performSearch` also catches `CancellationException` as an error, which briefly shows the error state when you
  type mid-request. Chips are cleared consistently in both cases.

**Android verdict: APPROVE with M-A1 recommended before release.** It is a polish gap, not a correctness or crash risk. It is cheap to fix in the same change.

## Overall
Backend: APPROVE. Android: APPROVE. Fix M-A1 (rail scroll-to-selected) before the Play Store build. L-B1 (`_id` tie-break) is a one-line follow-up.
