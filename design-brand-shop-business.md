# Shop by Brand in Haper Business - design spec (v1, 2026-11-19)

Owner ask: "I wanna option for wholesale users to shop/buy/search by brand."
Mockup: `/Users/office/Documents/haper/haper-misc/design-brand-shop-business-mockup.html` (360 px phone frames).
Builds on: `design-b2b-business-mode-mockup.html` + `plan-b2b-business-mode.md` (switch, plum header, Business cart) and `design-retailer-wholesale.md` (WholesaleInk, Wholesale pill).
Scope: Business mode only. A normal customer, or a retailer in Haper mode, never sees a brand tile, chip, route or event.
Android first (real tokens below). iOS/web follow the same layout; notes in section 9.

Plain words: a "brand" is the company name printed on the pack (Amul, Britannia). Shop owners usually restock brand by brand, because each brand often comes through its own distributor ("what do I need from Britannia this week?"). So brand is a natural way for them to shop.

## 0. Data rules the screens rely on (backend owns, design depends on them)
- Brand list = only brands with at least 1 buyable WHOLESALE item in the retailer's current store. No new brand data exists today, so the API must group `items.brand`.
- Group case-insensitively and ignore extra spaces: "AMUL", "Amul ", "amul" = one brand. Show the most common spelling.
- Catch-all names are NOT brands and are hidden from all brand UI: "Generic", "Genric", blank, "NA", "-", "Unbranded", "Local" (list kept server-side). Their items stay reachable through categories and search. Example: 582 "Generic" items do not get a tile; you still find "Generic Sugar 50 kg" by searching "sugar".
- Each brand row: `{ key, name, itemCount, logoUrl | null }`. `itemCount` = buyable wholesale items (in stock).
- New endpoints are needed (none exist): brand list (Business view only) and items-by-brand (paged, same item shape as the aisle list). For frontend architect / backend engineer to define.

## 1. User flows
A. Home strip: 1) Business home -> 2) "Shop by brand" strip -> 3) tap a brand tile -> 4) Brand page -> 5) Add / size sheet / bulk table exactly as today -> 6) Back returns to Home at the same scroll spot. Exit: floating Business cart bar -> Business cart.
B. All brands: 1) Home strip "See all" (header link or last tile) -> 2) All brands screen -> 3) optional: type in "Search brands" -> 4) tap tile -> 5) Brand page -> 6) Back returns to the grid at the same row with the filter text kept.
C. Search: 1) Business search bar -> 2) type "amul" -> 3) "Brands" chip row appears above the "Categories" chips -> 4) tap "Amul" chip -> 5) Brand page.
Failure exits: list error -> Retry; no brands -> "Shop by category"; brand gone (store changed / sold out) -> "See all brands"; Business mode lost (server falls back to retail) -> Haper home + existing snackbar "Haper Business isn't available right now."

## 2. Entry points on the Business home
Decision: ONE entry = a "Shop by brand" horizontal strip, placed right after "Shop by category" and before "Wholesale for your shop".
- Why the strip, not the photo card from sample 2: the strip shows real brands (value before effort, one tap to a brand); the photo card needs a stock photo we do not have, carries no information, costs ~140dp, and its fake search pill looks like a text field but is a button. Sitting next to categories keeps both "browse" tools together.
- Not using the empty Print-tile slot beside Wallet: that row stays identical in both modes, so switching modes does not shuffle the screen.
- Header: existing `SectionHeader` eyebrow "Brands", title "Shop by brand", plus a NEW optional trailing link "See all" (GreenAction, Poppins SemiBold 13sp, 48dp tall touch area). `SectionHeader` has no trailing slot today; add `actionLabel`/`onAction` (default null, so Haper-mode callers are unchanged).
- Strip: `LazyRow`, same metrics as `CategoriesQuickGrid` (tile column 64dp wide, 10dp gap, contentPadding 2dp/8dp). Up to 8 brands, ordered by `itemCount` high to low (ties A-Z). Then one "See all" tile: SurfaceMint square, ArrowForward icon GreenAction, label "See all" + second line "214 brands".
- Brand count rules: 0 brands -> hide the whole section (header too). 1-2 brands -> tiles only, no "See all". 3+ -> up to 8 + "See all".
- Search chips: in Business search, when results are non-empty and the query equals a brand name, or is 3+ characters and starts a brand name, show a "Brands" chip row (max 3 chips) ABOVE the existing "Categories" chip row. Reuse the `CategorySearchChip` shell (48dp min, pill, white, hairline border, pressed SurfaceChip) with a 24dp brand tile on the left, name, then "12 items" in GreenAction. Needs the search API to return matching brands in Business view.

## 3. All brands screen (route `brands`)
Layout, top to bottom (all widths):
```
+----------------------------------+  plum header (same 155deg ramp as Business hero:
| [<]  Brands                      |  WholesaleInk -> BusinessDeep), bottom corners 36dp
|      214 brands                  |
| [ (search) Search brands       ] |  white field 46dp, radius 18dp, like home search
+----------------------------------+
  A                                   sticky letter header (SurfaceApp bg)
 [tile] [tile] [tile]                 3 columns at 360dp
  Amul   Anik  Ashirvad
 12 items 4 items 9 items
  B ...
              [ Business cart bar ]   existing FloatingCartBar(business = true)
```
- Header: back = existing `HaperIconButton` (white square). Title "Brands" Quicksand Bold 18sp white; subtitle "214 brands" Poppins 12.5sp white 90%. White on WholesaleInk 7.27:1, on BusinessDeep 11.24:1. Padding 20dp sides (`screenHorizontalHomeHeader`), 12dp top, 18dp bottom.
- No cart icon in the top bar (sample has one): Haper shows the cart through the floating Business cart bar on every browse screen; a second cart control would be new and inconsistent.
- Search brands field: filters the loaded list on the device as you type (no network; the list is small). Matches anywhere in the name, case-insensitive ("bond" finds Brooke Bond). Clear (x) button 48dp when text present. Keyboard action "Search" just hides the keyboard.
- Grid decision: 3 columns at 360dp (not 4). Content width 360 - 2x16 = 328dp; 3 columns with 12dp gaps = 101dp cells, fits about 13 characters per line at 12.5sp, so "Chakaachak" (10) never breaks mid-word as it does in the sample's 4-column grid (76dp cells). 4 columns also fail at 200% font.
- Column rule: width < 600dp -> 3 (2 when font scale >= 1.5); 600-839dp -> 5; >= 840dp -> 6. Max content width 720dp, centred.
- Tile: square, fills cell width, max 96dp, radius 22dp (same as `CategoryTile`), 1dp `CategoryWellRing` border. Under it: name Poppins SemiBold 12.5sp, line height 16sp, InkPrimary, centred, max 2 lines, ellipsis at end, break only between words. Then "12 items" Poppins Medium 11.5sp InkSecondary (4.9:1 on SurfaceApp), 1 line ("1 item" singular). Gaps: tile -> name 8dp, name -> count 2dp; row gap 16dp.
- Whole cell (tile + name + count) is ONE button, min 48x48dp (it is about 101 x 150dp). Pressed: existing `pressScale` + ripple.
- Order: A-Z, case-insensitive. Names starting with a digit or symbol go in a "#" group LAST (like phone contacts), so "9am" does not push "Amul" down.
- Letter navigation: sticky letter headers, no A-Z side rail. Why: 26 letters on a rail are about 18dp each (below the 48dp target) and the right screen edge is Android's back-swipe zone. The search field is the fast path for long lists. Header: letter in Quicksand Bold 15sp InkSecondary (4.9:1; not GreenSubtle, which is 2.9:1 and fails), 16dp side padding, 32dp tall, SurfaceApp background so tiles scroll under it. Hide headers when the list has 12 brands or fewer (headers add noise to a short list) and while a filter is typed.
- Engineer note: grid sticky headers are not stable in Compose; build it as a `LazyColumn` of rows (brands chunked by column count) with `stickyHeader` per letter.
- Item count is shown (decision): tells a shop owner whether a brand has a real range before tapping (Amul 42 items vs 1 item). It is also part of the screen-reader label.

## 4. Brand tile: letter badge (now) and logo (later)
One composable, two looks, same size, radius and ring, so a mixed grid looks planned.
(a) Letter badge (no logo, or logo failed):
- Text: 1 word -> first 2 letters/digits, first upper, second lower ("Amul" -> "Am", "9am" -> "9a"). 2+ words -> first letter of the first two words, upper ("Ching's Secret" -> "CS", "Brooke Bond" -> "BB"). Two characters stop a row of "A A A" in the A section.
- Font: Quicksand Bold, size = 30% of the tile (29dp on 96dp, 19dp on 64dp, 7dp on 24dp chips). It is a picture, so its size does NOT follow the font-scale setting; the name under it does.
- Colour rule (same on all platforms): key = brand name lower-cased, trimmed, spaces collapsed. index = (sum of the Unicode code points of the key) mod 8. Example: "amul" = 97+109+117+108 = 431, 431 mod 8 = 7 -> slot 7.

| slot | background (existing token) | initials (existing token) | contrast |
|---|---|---|---|
| 0 | HaperCategoryTint.staples #F5E3CD | WarningText #8A5A12 | 4.72:1 |
| 1 | HaperCategoryTint.veg #D8EEE1 | GreenDeep #20654E | 5.68:1 |
| 2 | HaperCategoryTint.dairy #DCEAF3 | InkPrimary #1F332B | 10.92:1 |
| 3 | HaperCategoryTint.snacks #FADEE4 | InkPrimary | 10.62:1 |
| 4 | HaperCategoryTint.bev #D5EDE9 | GreenDeep | 5.64:1 |
| 5 | HaperCategoryTint.oil #F7EBCF | WarningText | 4.99:1 |
| 6 | HaperCategoryTint.cloth #E1E3F5 | InkPrimary | 10.54:1 |
| 7 | HaperCategoryTint.body #F7E0EA | InkPrimary | 10.73:1 |
All pass 4.5:1 (the text is large, so 3:1 would do). `cloth` is used instead of `salt` because salt is too close to `dairy` blue next to each other. `choco` (#EADFF7) is left out on purpose: it is the Wholesale pill colour and would read as a status badge.
(b) Logo: SurfaceWhite tile, same 1dp ring, logo `ContentScale.Fit` inside 12% padding, never cropped or stretched. While the logo loads, show the letter badge; when it arrives, cross-fade 160ms (`HaperMotion.fadeMs`). If it fails, stay on the letter badge (no broken-image icon, no retry). Cache with the existing image loader.
On the plum header (brand page) the tile sits on plum: both looks keep their own background, ring becomes white 90% (`WhiteBorder90`).

## 5. Brand page (route `brand/{key}`)
- Header (plum, same ramp/corners as section 3): back button; row with brand tile 56dp + name Quicksand Bold 19sp white (max 2 lines) + "38 wholesale items" Poppins 12.5sp white 90%; then search field "Search in Amul" (filters on the server within this brand, 300ms debounce, min 2 characters; empty field = full list).
- Body: the existing aisle product grid, unchanged: `ProductCard(variant = AisleGrid)`, 2 columns, `productGridGap` 14dp, 16dp sides, Wholesale pill, pack label, "Add" / stepper, size sheet (`VariantPickerSheet`), bulk price table on the item page, Business cart. Nothing new on the card.
- Order: in-stock first, then the same server order the aisle list uses. No sort or filter controls: the aisle list has no server sort today, and its "Under Rs 50" chip means nothing for wholesale packs (hide it in Business wherever it appears).
- Paging: same as aisle (load next page near the end; 2 `HaperProductCardSkeleton` at the bottom while loading; "Couldn't load more. Retry" text row on failure).
- Back returns to where the user came from (Home strip, All brands, or Search) at the same scroll spot and with the same filter text.
- Bottom padding: `scrollBottomPadding` + the cart-bar reserve, as on other browse screens.

## 6. States (exact copy)
All empty/error panels use `HaperEmptyState` with Business styling: `iconTint = WholesaleInk`, `iconBackground = AccentPlumContainer` (as Business home does today).

| Screen | State | What shows |
|---|---|---|
| Home strip | Loading | 5 skeleton tiles (64dp `HaperSkeletonBar` squares, radius 22dp + 2 short bars), header shown |
| Home strip | Error / offline | Hide the section silently; the rest of Home has its own error state. Retried on pull-to-refresh |
| Home strip | 0 brands | Section hidden |
| All brands | Loading | Header + disabled search field + 4 rows x 3 skeleton tiles; screen reader "Loading brands" |
| All brands | Empty (store has no brands) | Icon Storefront. Title "No brands yet". Body "This store has no branded wholesale items right now. You can still shop by category." Button "Shop by category" (back to Business home) |
| All brands | Filter has no match | Title "No brand matches "xyz"". Body "Check the spelling, or search all wholesale items." Button "Search items for "xyz"" (opens Search with the text). Secondary "Clear" |
| All brands | Error | Icon ErrorOutline. Title "Couldn't load brands". Body "Check your connection and try again." Button "Retry" |
| All brands | Offline, nothing cached | Icon CloudOff. Title "You're offline". Body "Connect to the internet to see brands." Button "Retry" |
| All brands | Offline, cached list | Show cached grid + a 40dp WarningSurface strip under the header: "You're offline. Showing brands from earlier." (WarningText 13sp) |
| All brands | 1 brand | One tile, no letter headers, subtitle "1 brand" |
| All brands | Very long list (300+) | Sticky headers + search field; no extra UI |
| Brand page | Loading | Header with name (passed from the tile, so it is instant) + 4 skeleton product cards |
| Brand page | Search no match | Title "Nothing in Amul matches "xyz"". Body "Try another word, or clear the search." Button "Clear search" |
| Brand page | All items sold out (on refresh / return) | Cards already on screen keep the existing out-of-stock look until the next refresh. When the list comes back empty: Title "Amul is sold out right now". Body "Check back soon, or pick another brand." Button "See all brands" |
| Brand page | Brand no longer in this store (store/address changed) | Title "Amul isn't available here". Body "This store doesn't sell Amul wholesale right now." Button "See all brands" |
| Brand page | Error | "Couldn't load Amul items" / "Check your connection and try again." / "Retry" |
| Any | Business mode lost | Leave brand screens, open Haper home, existing snackbar "Haper Business isn't available right now." |
Disabled: the search field is disabled only during the first load (header and back stay active). Nothing else on these screens has a disabled state.

## 7. Accessibility
- Targets: every tile/cell, chip, "See all", clear (x) and back = at least 48x48dp.
- Labels: tile = one button, label "Amul, 12 items" (initials and logo are hidden from the screen reader). "See all" tile: "See all 214 brands". Header link "See all brands". Letter header = heading "A". Search chip: "Brand Amul, 12 items". Brand page header announced "Amul, 38 wholesale items", heading.
- Focus order: back -> title -> Search brands -> letter header -> tiles left to right, row by row -> Business cart bar. Brand page: back -> brand name -> Search in Amul -> cards -> cart bar.
- Font scale 200%: grid drops to 2 columns at >= 1.5x; names keep max 2 lines with ellipsis but the full name is always in the label; header subtitle may wrap; home strip tiles stay 64dp wide and the row grows taller (names 2 lines).
- Contrast: badge pairs table in section 4 (all >= 4.72:1); white on plum >= 7.27:1 (white 90% subtitles 6.2:1); item counts InkSecondary 4.9:1; letter headers InkSecondary (not GreenSubtle, which fails).
- Reduce motion (animations off in system settings): skeletons are static (no shimmer), logo swap is instant, no press scale (ripple only).
- Right-to-left: out of scope.

## 8. Tokens and components
| Use | Reuse (existing) | New |
|---|---|---|
| Colours | WholesaleInk, BusinessDeep, AccentPlumContainer, HaperCategoryTint.*, InkPrimary/Secondary, GreenDeep, WarningText, WarningSurface, GreenAction, SurfaceApp/White/Mint, CategoryWellRing, WhiteBorder90 | none |
| Type | Quicksand / Poppins via HaperType (sectionHeading, storeName 19sp, caption) | none |
| Spacing / radius | HaperSpacing.screenHorizontal 16, gridGap 12, productGridGap 14, headerBottomCorners 36, tile radius 22 (as CategoryTile), search field 18 | none |
| Motion | HaperMotion.fadeMs 160, pressScale, shimmer | none |
| Components | SectionHeader (+ optional `actionLabel`, `onAction`), HaperIconButton, HaperEmptyState, HaperSkeletonBar, HaperProductCardSkeleton, ProductCard(AisleGrid), VariantPickerSheet, FloatingCartBar(business = true), CategorySearchChip shell | see below |

New composables (props):
- `BrandTile(name: String, logoUrl: String?, size: Dp, onPlum: Boolean = false)` - picture only, no text, no click. Decides badge vs logo, initials and colour slot.
- `BrandCell(brand: BrandModel, onClick, columnWidth: Dp)` - tile + name + count as one button (grid and strip; strip passes 64dp and hides the count).
- `BrandGrid(brands, columns, showLetterHeaders, listState, onBrandClick)` - LazyColumn of chunked rows + sticky `LetterHeader(letter: String)`.
- `BrandStrip(brands, totalCount, onBrandClick, onSeeAll)` - home row incl. the "See all" tile.
- `PlumScreenHeader(title, subtitle, onBack, leading: (@Composable)? = null, searchPlaceholder, query, onQueryChange)` - shared by both new screens. Ask the frontend architect whether this should instead extend `HaperTopBar`.

## 9. Behaviour notes for the engineer
- Cache: brand list in memory per (storeId, Business mode) for 5 minutes; Home strip and All brands share it (opening All brands after Home is instant). Pull-to-refresh on both screens bypasses it. Store/address change clears it.
- Scroll restore: list state and filter text are `rememberSaveable` in the nav back-stack entry, so Back from a brand page lands on the same row. Do not refetch on return if the cache is fresh.
- Analytics (existing `AnalyticsTracker`, same style as `search_category_chip_tap`): `logScreen("brands")`, `logScreen("brand", bundleOf("brand_key" to key))`; `logEvent("brand_tap", bundleOf("brand_key", "source" to home_strip|all_brands|search_chip, "position"))`; `logEvent("brands_see_all_tap", bundleOf("source" to header|tile))`; `logEvent("brands_filter_no_match", bundleOf("query" to q.take(100)))` (tells us which brands retailers want but we don't stock); `trackViewItemList("brand:$key")`.
- Mode change: the switch only lives on Home, so the user cannot switch while on a brand page. If the server falls back to retail (store turned wholesale off, retailer paused), pop all brand routes and land on Haper home with the existing notice. When the user switches to Haper on Home, brand routes are removed from the back stack. Deep link to `brand/...` in Haper mode -> Haper home, no error.
- The brand page passes `name`, `itemCount` and `logoUrl` from the tapped cell so the header is drawn instantly.
- iOS: same layout; use `.searchable`-style field inside the plum header, `List` sections with sticky headers, VoiceOver labels as above. Web: same, CSS grid 3 columns under 600px; tile is a `<button>`.

## 10. Open questions for the owner (recommendation first)
1. Logos: ship letter badges now and add logo upload later? Recommend YES. Badges cost nothing and look complete; logos need someone to collect ~400 images. The tile already switches by itself when a logo exists, so adding logos later needs no app update.
2. "Generic" and similar catch-all names: hide them, or show one "Other" tile at the end? Recommend HIDE. An "Other" tile would hold 700+ unrelated items (sugar, buckets, soap), which is not shopping by brand. Those items stay in categories and search.
3. Spelling clean-up ("Genric" vs "Generic", mixed casing, near duplicates like "Ching's" vs "Chings"): recommend the app groups only by case and spaces automatically, and someone fixes real misspellings once in the product master (one-time admin job). Automatic "close enough" merging can wrongly join two real brands.
4. Home strip order: most wholesale items (works today) or most ordered by retailers? Recommend MOST ITEMS now, switch to most ordered once there are a few weeks of Business orders.
