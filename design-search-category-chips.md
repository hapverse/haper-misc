# Design: category chips above search results (Android customer app)

Files: `ui/screens/search/SearchScreen.kt` (results `LazyColumn`, ~line 372), `ui/screens/category/AisleListingScreen.kt` (`AisleSubCategoryRail` ~469 = existing chip row to mirror), tokens in `ui/theme/{Color,Type,Theme,Dimens,Motion}.kt`. Names below are fictional examples.

## Placement and layout
First items inside the existing results `LazyColumn`, BEFORE the "N results for ..." text. Only when page 1 returned >=1 category match AND not `isFallback`.

```
 Categories                                  <- HaperType.eyebrow style? NO: use caption (see Tokens)
 [ Biscuits & Cookies  42 ][ Cream Biscuits  12 ][ Wafer Rolls  7 ] ->  (scrolls, 16dp start pad)
   in Biscuits & Cookies      <- 2nd line only on sub-category chips

 12 results for "cream"
 [product row] ...
```
- Heading: "Categories" (keep; one word, orients the row). `HaperType.caption`, `InkSecondary`, Bold, 12sp (same as the results-count text). 6dp gap to chips.
- Row: `LazyRow`, `horizontalArrangement = spacedBy(HaperSpacing.scale.x8)`, `contentPadding(horizontal = HaperSpacing.screenHorizontal)` (row bleeds edge to edge; heading keeps 16dp). 14dp gap below the row, then the count text (the parent column's x10 spacing applies; add 4dp).
- Cap: 6 chips, order = backend order (backend ranks). No "more" chip.
- Tablet / wide: same single scrolling row, chip size unchanged; cap the LazyRow content to 720dp max width, left aligned. No wrapping.

## Chip anatomy (one component: `CategorySearchChip`, private to SearchScreen unless reused)
- Shape `RoundedCornerShape(HaperRadius.chip)`? No: that 6dp reads as a stock tag. Use full pill `CircleShape` to match the sub-category rail; verify against `AisleSubCategoryRail` and copy its fill/border exactly if it differs.
- Fill `SurfaceWhite`, 1dp border `BorderHairline`; pressed: fill `SurfaceChip`, border `GreenPrice.copy(alpha=0.4f)`. Use existing `PressScale` (no new animation).
- Height: `heightIn(min = 48.dp)` (touch target); padding horizontal 14dp, vertical 8dp.
- Line 1: name, `HaperType.productNameCard` bumped to 13sp SemiBold, `InkPrimary`, `maxLines=1`, `TextOverflow.Ellipsis`, chip `widthIn(max = 220.dp)`.
- Count: after name, 6dp gap, `HaperType.caption` 12sp, `GreenAction`, plain number ("42"; show "99+" for >=100). Hide count when null or 0 is NOT allowed to show "0": omit count, keep chip only if backend sent the chip.
- Line 2 (sub-category chips only): "in Biscuits & Cookies", `HaperType.caption` 11sp, `InkTertiary`, 1 line, ellipsis, same max width. Chip is then 2 lines, min 48dp tall; mixed rows align `Alignment.CenterVertically`.
- Icon: TEXT ONLY. Category icon URLs are optional/inconsistent, add 20-40ms image load per chip and layout shift. No leading icon; no trailing chevron.

## Colour (light / dark)
App is light-only today (no dark palette in `Color.kt`); spec light tokens above. If dark ships, map `SurfaceWhite`->card surface, `BorderHairline`->outline, `InkPrimary/Secondary/Tertiary`->on-surface ramp; do not hardcode hex in the chip.

## Behaviour
- Tap -> `navController.navigate("aisle/${Uri.encode(categoryId)}")` (MainActivity route 848). Parent category chip: opens the aisle with no sub-category (`homeVM.selectedSubCategory = null`).
- Sub-category chip: navigate to the PARENT id and pre-select that sub-category. Gap: the route has only `categoryId` and sub-selection lives in `homeVM.selectedSubCategory` (SubCategoryModel); engineer must set it before navigate AND the aisle load must not reset it on entry (check line ~185-193 and the subCategories fetch). Needs an arijit-frontend-arch decision (extra optional nav arg `?sub=` preferred).
- Keyboard: dismiss IME on tap (`LocalFocusManager.clearFocus()`) before navigating. Back from aisle returns to the same search query and scroll.
- Loading: NO skeleton. Chips arrive with the same response as products and render in the same frame; the existing results loading state is unchanged (no row while loading). Page 2+ never touches the row. Row is `key`ed to the query so it clears on a new search.
- Motion: none beyond `PressScale`. No enter animation (avoids list jump). Reduced motion needs nothing extra; if the engineer adds a fade, use `HaperMotion.fadeMs` and skip when animations are off.

## States
1. No matches / field missing / null / old backend: no heading, no row, screen identical to today. Parse defensively (nullable list, nullable name/count/parent; drop any chip with blank name or blank id; never throw).
2. One chip: left-aligned, no scroll, heading still shown.
3. Many (>6): cap to 6, scrolls; the 7th half-peek is not guaranteed, so the 16dp end padding plus uneven widths must show a partial chip; if all 6 fit on a tablet, fine.
4. Long name ("Chocolate Spreads & Sweet Dessert Toppings"): ellipsized at 220dp max; TalkBack still reads the full name.
5. Sub-category chip: two lines with "in <parent>"; if parent name is missing, render one line (no "in").
6. Offline / request failed: results screen shows its existing error/empty state; chips are not shown (they come from the same call). No separate chip error.
7. Fallback ("We couldn't find ..."): no chips.
8. Disabled: n/a (chips are always tappable).

## Accessibility
- Chip merged semantics, `Role.Button`, contentDescription: "Open category Biscuits & Cookies, 42 items"; sub-category: "Open Cream Biscuits in Biscuits & Cookies, 12 items"; no count: omit ", N items"; count 1: "1 item".
- Heading marked `heading()`. Focus order: search field -> heading -> chips left to right -> results.
- Contrast: `InkPrimary` on `SurfaceWhite` ~13:1; `GreenAction` #257056 on white ~6.5:1; `InkTertiary` #93A79C on white is ~2.5:1 and FAILS AA for the "in <parent>" line, so use `InkSecondary` (#5A7268, ~5.2:1) for it instead. Border is decorative; chip edge is not the only affordance (text + count).
- Honour font scale: height is `min`, never fixed; at 2.0x the chip grows, row stays one line.

STATUS: done
OUTPUT: design spec for search-result category chips at /Users/office/Documents/haper/haper-misc/design-search-category-chips.md
NEXT: siddhart-android - implement from this spec (and arijit-frontend-arch - decide the sub-category pre-select nav arg vs homeVM.selectedSubCategory)
