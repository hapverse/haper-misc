# Shop by Brand in Haper Business - test guide (Phase 1: backend + Android)

Scope: Business mode only, Android + backend, dev only. iOS and web are NOT in Phase 1 (tracked in `client-followups.md`). Specs: `plan-brand-shop-business.md`, `design-brand-shop-business.md`.
Steps marked **[API]** need the new brand API (`GET /user/brand`, `GET /user/brand/items`, search `brands` key) deployed to dev. The Android build is not device-tested at build time (JVM tests + `assembleDebug` only) - run this on a device.

Plain example: Test Kirana taps Haper Business, sees "Shop by brand", taps "Amul", sees only Amul wholesale items and adds one to the Business cart.

## Setup (dev only)
- Owner sets `BRAND_SHOP_ENABLED=true` in the dev environment and deploys the backend to dev (agents do not touch env/AWS). Flag off or unset = feature is invisible everywhere.
- Store with wholesale ON (`wholesaleEnabled`), plus an APPROVED retailer ("Test Kirana"), a normal customer, and a retailer on a store with wholesale OFF.
- Wholesale items (priced, active, in stock) in that store:
  - Case/space variants of one brand: "Amul", "AMUL ", "amul" (3 items across them) - must merge into ONE tile.
  - Hidden name "Generic" (and optionally "Genric", "NA", "-", blank) - must never show as a brand.
  - A 1-item brand; a long name (about 30 chars, e.g. "Shree Ganesh Traditional Foods"); a digit-first name ("9am Foods").
  - A sold-out-only brand (all items qty 0) and a retail-only brand (no wholesale item).
  - A wholesale-only brand (no retail item) for the leak checks.
  - Enough brands for 3+ on the strip, and 13+ for sticky letters (a second run with <= 12 brands checks the no-letters case).
- Size-grouped items: a brand with a size group (cards count groups, not sizes).

## Phase 0 - spelling clean-up (before real use; ops, no app)
- [ ] Owner runs (read-only): `cd haper-backend && node scripts/migrations/report-brand-duplicates.js --out=brands.csv` (stdout CSV if no `--out`). Dev first.
- [ ] Prod only with the owner's OK and `--confirm-db=<exact db name>`; without it the script aborts. It only reads (secondaryPreferred).
- [ ] CSV has rows `suspect` (probable same brand, e.g. cadbbury/cadbury, haldiram/haldiram's), `merged`, `hidden` (generic/genric counts), `mojibake` (e.g. "Bagrryâ€™s").
- [ ] Staff fix spellings in Product Master (super admin): edit the wrong Brand; it fans out to every store.
- [ ] `grouped_count > 0` row: brand edit returns 409 "Remove from size group first" -> remove from group, fix brand on every member, regroup (or leave for Phase 2 aliases).
- [ ] Do NOT rename Generic/Genric or turn company names into pack brands.
- [ ] Re-run: only intentionally different pairs remain. Real misspellings are NOT auto-merged by the app (only case/space).

## A. Business home strip (Android) [API]
- [ ] Haper Business -> "Shop by brand" strip sits after "Shop by category", before "Wholesale for your shop". Header eyebrow "Brands" + "See all" link.
- [ ] 0 brands: whole section (header too) hidden.
- [ ] 1-2 brands: tiles only, no "See all" tile or header link.
- [ ] 3+ brands: up to 8 tiles + "See all" tile (second line "N brands"); header link also shown.
- [ ] More than 8 brands: tiles are the 8 with the most items (ties A-Z).
- [ ] "Amul"/"AMUL "/"amul" is one tile; name is the most common spelling. Item count = cards (a size group = 1).
- [ ] "Generic" has no tile. Letter badge: "Amul" -> "Am", "Brooke Bond" -> "BB", "9am Foods" -> "9a".
- [ ] While loading: 5 skeleton tiles. On error/offline: section silently hidden; pull-to-refresh retries.
- [ ] Both "See all" (header link, tile) open All brands.
- [ ] Haper mode home is identical to before (no strip).

## B. All brands screen [API]
- [ ] Plum header, title "Brands", subtitle "N brands" ("1 brand" for one), field "Search brands".
- [ ] A-Z order; digit/symbol names in a "#" group LAST ("9am" does not push "Amul" down).
- [ ] 13+ brands: sticky letter headers. 12 or fewer: no headers. Headers hidden while filtering.
- [ ] 3 columns at 360 dp; tile shows name (max 2 lines, ellipsis) + "12 items" ("1 item" singular). Long name shows full on brand page.
- [ ] Search brands filters on device, contains-match, case-insensitive ("bond" finds "Brooke Bond"); clear (x) works; keyboard Search just hides keyboard.
- [ ] No match: title `No brand matches "xyz"`, body "Check the spelling, or search all wholesale items.", buttons `Search items for "xyz"` (opens Search prefilled with xyz) and "Clear".
- [ ] Loading: disabled search field + skeleton rows. Empty store: "No brands yet" / "This store has no branded wholesale items right now. You can still shop by category." / "Shop by category" (back to Business home).
- [ ] Error: "Couldn't load brands" / "Check your connection and try again." / "Retry" works.
- [ ] Offline, nothing cached: "You're offline" / "Connect to the internet to see brands." / "Retry".
- [ ] Offline with cached list (open once online first): grid shown + strip "You're offline. Showing brands from earlier."
- [ ] Home strip, failed refresh (e.g. go offline, then refresh Home): the strip keeps showing the earlier brands. By decision; the design originally said hide it.
- [ ] Business cart bar visible at the bottom.
- [ ] Back from a brand page returns to the same row with the filter text kept.

## C. Brand page [API]
- [ ] Header: back, tile (56 dp), name, "N wholesale items", field "Search in Amul". Name/count appear instantly on tap (before load).
- [ ] Cards: 2-column aisle grid, Wholesale pill, pack label, Add/stepper, size sheet, bulk price table on the item page. Only Amul items. Count shown equals the cards with no search text.
- [ ] Paging: scroll to the end loads the next 12 (2 skeleton cards); failure shows "Couldn't load more. Retry".
- [ ] Add to cart: goes to the BUSINESS cart; Business cart bar updates and opens the Business cart.
- [ ] Search in Amul: needs 2+ chars (1 char = full list); ~300 ms debounce, one request per pause; every word must match the name; regex characters like `(` or `.*` do not crash.
- [ ] Search no match: `Nothing in Amul matches "xyz"` / "Try another word, or clear the search." / "Clear search".
- [ ] Loading: 4 skeleton cards. Error: "Couldn't load Amul items" / "Check your connection and try again." / "Retry".
- [ ] All items sold out: set qty 0 in admin, then reopen Amul from a strip tile or search chip loaded earlier (list cache is up to 5 min; the brand page has no pull-to-refresh). Shows "Amul is sold out right now" / "Check back soon, or pick another brand." / "See all brands".
- [ ] Store change then brand gone: unit-test only (`unavailableWhenBrandNullAfterStoreChange`). On a device, changing store pops to Home (Deliver Here closes the brand page) and reopening Amul at the new store shows the sold-out state ("Amul is sold out right now"), by design. "Amul isn't available here" only appears if the store changes while the brand page stays open and the tester then types in the brand search; no normal device path.
- [ ] Brand renamed in Product Master: old brand page shows the unavailable/sold-out state after <= 2 min cache (no crash).

## D. Search chips [API]
- [ ] Business search "amul": "Brands" chip row above the "Categories" chips, chip "Amul" with "12 items"; tap opens brand page.
- [ ] "amu" (3+ chars, prefix) shows the chip; "am" (2 chars) does not, unless a brand is exactly "am".
- [ ] Max 3 chips; exact match first, then more items first.
- [ ] Page 2 of results: no chip row. Fallback ("no exact match") results: no chips. Type a new query: old chips cleared immediately.
- [ ] Item results and category chips are unchanged. Search for "sugar" still finds "Generic Sugar 50 kg".
- [ ] Haper mode search: no brand chips.

## E. Navigation, store, mode
- [ ] Back from brand page lands at the same scroll spot on Home / All brands / Search.
- [ ] Change store/address: strip and list refetch (cache cleared); counts match the new store.
- [ ] Switch to Haper on Home: brand screens removed from the back stack.
- [ ] Suspend the retailer (or turn store wholesale OFF) while on a brand page: next call lands on Haper home with "Haper Business isn't available right now."
- [ ] Deep link `brand/...` while in Haper mode: opens Haper home, no error.

## F. "Under Rs 50" chip
- [ ] Business aisle/category screen: "Under Rs 50" chip hidden and the filter not applied.
- [ ] Haper mode aisle: chip still shown and still filters.

## G. Accessibility (TalkBack, 200% font, reduce motion)
- [ ] Tile reads "Amul, 12 items" as one button (initials hidden). "See all" tile: "See all 214 brands". Header link: "See all brands". Letter header is a heading. Search chip: "Brand Amul, 12 items". Brand page header: "Amul, 38 wholesale items".
- [ ] All targets >= 48 dp (tiles, chips, See all, clear x, back).
- [ ] Font 200%: All brands drops to 2 columns; badge letters stay the same size (do not grow or shrink with font); names 2 lines + ellipsis; strip tiles stay 64 dp wide, row grows taller.
- [ ] Reduce motion on: skeletons static, logo/badge swap instant, no press scale.
- [ ] Dark theme / small phone: nothing clipped.

## H. Server / leak checks (app or curl on dev; use the retailer/customer JWT you already have, never paste tokens in notes)
Routes: `GET /user/brand`, `GET /user/brand/items?key=amul&page=1&q=`.
- [ ] **[API]** Business header + approved retailer + wholesale store + flag on: list non-empty, each brand `{key,name,itemCount,logoUrl:null}`; no `spellings`, no `costPrice`/`taxonomy` in items. Response headers `x-shop-mode: business`, `Vary: x-shop-mode`, `Cache-Control: private, no-store`.
- [ ] **[API]** Each of these returns HTTP 200 with `brands: []` and brand page `brand: null, items: []`: (1) no `x-shop-mode` header / Haper mode, (2) normal customer with the business header, (3) retailer on a store with wholesale OFF, (4) flag unset/false (needs the owner to flip it on dev).
- [ ] **[API]** Retail-only brand never in the Business list; its key on the brand page -> `brand: null`.
- [ ] **[API]** Wholesale-only brand never reachable as a normal customer (list empty, page null, not in search chips); its items still do not appear in the normal shop.
- [ ] **[API]** "Generic"/"Genric"/"NA"/"-"/blank: not in list, key `generic` -> `brand: null`; items still found via category and search.
- [ ] **[API]** Brand page: `q` of 1 char ignored; `q` over 64 chars (after trim) -> 403; `key` over 120 chars / blank -> 403; unknown query key (e.g. `&foo=1`) -> 403 validation; `page=0` -> 403; missing `key` -> 403.
- [ ] **[API]** Search `GET /user/item/search/amul/1` Business: `data.brands` present; page 2 and Haper mode: `brands: []`; `data.categories` and items unchanged.
- [ ] Old app builds (current Play/dev build, no brand code): home, search, categories, cart work exactly as before; extra `brands` key is ignored.
- [ ] Redis down (if testable): list still returns (computed from DB).

## Edge cases
- [ ] Unicode / very long names, name with `&`, `'`, `/` (e.g. "Ching's Secret", "P&G"): tile and page open correctly (key passes in the query string).
- [ ] Brand with items in both a size group and singles: count = groups + singles.
- [ ] Rotation / process death on brand page: query text and scroll restored; no crash.

## Build / deploy needed
- Backend brand API on dev with `BRAND_SHOP_ENABLED=true` (owner sets it and deploys; flag off = no release needed to hide). No schema/index change, no new Android permissions.
- Android build from dev. Unit tests: `BrandModelsGsonTest`, `BrandDisplayTest`, `BrandListViewModelTest`, `BrandItemsViewModelTest`. Backend: `brand.utils`, `brand.repository`, `item-brand-filter`, `brand-shop`, `item-search-brand-chip` suites.
- Prod: owner's call; Phase 0 clean-up should be done first.

STATUS: done
OUTPUT: wrote /Users/office/Documents/haper/haper-misc/test-brand-shop-business.md (setup, Phase 0, Android A-G, leak checks H, [API] steps marked; iOS/web noted as out of Phase 1)
NEXT: USER - review the guide; add iOS/web rows to client-followups.md if not yet done
