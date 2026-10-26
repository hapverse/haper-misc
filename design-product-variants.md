# Product variants (multi-size) - design spec v2 (Zepto/Blinkit-style)

Supersedes v1 ("From Rs33 / 3 sizes" pill leading to a detail page), which the user rejected.
Mockup: `haper-misc/design-product-variants-mockup.html` (tabs: List+sheet, Atta, Detail, Cart, Out of stock, Loading).

## 0. Research - honesty note
WebSearch returned NO teardown of Zepto/Blinkit variant UI (only generic Shopify/template pages). Nothing below about those apps is verified from a source I could open. Treat as recalled-from-memory; tanmoy/siddhart/setu or the user should compare with the live apps before sign-off.

Recalled (not verified), both apps:
- List card: normal card; for multi-size products the pack-size text is replaced by an "N options" pill (with chevron), and ADD is still on the card.
- Tapping ADD (or the pill) on a multi-size card opens a bottom sheet titled with the product; one row per size: size, selling price, struck MRP, discount tag, and its own ADD / stepper.
- After a size is added, the card shows a stepper with the combined count; with more than one size in the cart, tapping +/- re-opens the sheet.
- Detail page: horizontal size tiles (size + price, discount tag); selecting a tile swaps price/MRP/image.
- Out-of-stock size: row/tile is dimmed, ADD replaced by "Out of stock" / "Notify me".
- Cart: each size is its own line ("Sugar - 500 g", "Sugar - 1 kg"), own stepper.
- Search: same card as list; no separate variant treatment.
Certain: none of the above. Confidence: high on card pill + sheet + tiles, medium on exact stepper behaviour.

## 1. Flow
1. List/search/aisle: single-size card unchanged. Multi-size card shows "N sizes v" pill where the pack size normally is.
2. Tap + or pill -> bottom sheet (scrim, 250ms slide-up). Tap card body -> detail page.
3. In sheet: ADD on a row -> row becomes stepper; footer CTA changes "Pick a size to add" (disabled) -> "Done - N in cart". Sheet stays open so several sizes can be added.
4. Close (x, scrim, Done, back) -> card shows stepper with total count + "N in cart" chip; floating cart bar updates.
5. Card stepper: one size in cart -> acts directly on it. 2+ sizes in cart -> +/- opens the sheet (never guesses which line).
6. Detail: size tiles; selected tile drives price block and bottom CTA (Add to cart / stepper / disabled OOS).
7. Cart: one line per size.
Exits: sheet dismissed with nothing added = no change; all sizes OOS = card dimmed, no control.

## 2. Card (extend `ProductCard.kt`, no new component for the card itself)
Reuse unchanged: well 102dp/94dp image, discount wedge, veg mark, name (productNameCard), price (priceCard), chip (HaperType.chip), AddControl (34dp amber +, stepper pill).
Changes only when `item.variants.size > 1`:
- Row 2 (currently packSize + unitPrice): replace with pill `"{N} sizes v"`. Pill: height 24dp, radius = HaperRadius.chip full-round, 1dp border GreenLeaf, fill SurfaceMint, text GreenAction, HaperType.chip weight SemiBold, chevron 12dp. Min touch target 48dp via padding/hit-slop. Drop the unit-price text on multi-size cards (it differs per size).
- Row 3 price: prefix "from" (InkTertiary, 10.5sp) only if sizes differ in price; price/MRP/discount/SAVE are those of the DEFAULT size = first in-stock size by ascending size.
- + button: opens sheet (does NOT add silently). Stepper: see flow 5. Total count = sum over sizes.
- Chip priority unchanged (OOS > low > SAVE > in cart); low-stock on the card only evaluates single-size cards; for multi-size, low stock is shown per row in the sheet.
- All sizes out of stock: dim well (45% opacity, greyscale), no control, chip "Out of stock" (Danger/DangerSurface).
- Colours: no new tokens.

## 3. Bottom sheet (new composable `VariantPickerSheet`)
- Container: SurfaceWhite, top radius 24dp, scrim ScrimSheet46, max height 78% of screen, grab handle 36x4dp BorderHairline. Reuse the store-picker sheet shadow (SheetShadowTint).
- Header: 44dp image well (ImageWellRing) + product name (Quicksand 15sp Bold, 2 lines max) + close 30dp circle (SurfaceMint).
- Row (min height 64dp, padding 16h/12v, 1dp BorderHairline divider):
  - Left: size (Poppins 14sp SemiBold InkPrimary); below: price (Quicksand ExtraBold 15sp GreenPrice) + MRP (11sp InkTertiary strike) + "N% OFF" chip (SaveChipSurface/SaveChipInk); optional third line: "Only N left" (WarningText, 11sp) when qty <= lowQty.
  - Right (86dp column, bottom-right aligned): not in cart -> outlined ADD button 74x34dp, radius 12dp, 1.5dp AddButtonMid border, white fill, AddButtonMid bold 13sp "ADD" (same outlined idiom as the aisle +). In cart -> existing amber stepper pill (StepperTop->AddButtonMid). Out of stock -> "Notify me" mint button (SurfaceMint, GreenAction text) if the notify feature exists, else a "Out of stock" Danger text only (open question 2).
  - OOS row: size + price in InkTertiary, status line "Out of stock" in Danger.
- Footer: full-width 46dp CTA radius 16dp, green button gradient (GreenLeaf->GreenPrice->GreenDeepest). Label "Done - N in cart"; with zero in cart: disabled, SurfaceMint fill, InkTertiary text, "Pick a size to add".
- Sort: ascending size. Default pre-highlight: none (avoid accidental adds).
- Quantity cap per line: min(CART_QUANTITY_CAP=6, stock). At cap: + dims 40%; tapping shows toast "Only N available" / "Max 6 per order".
- Motion: slide-up 250ms cubic-bezier(.2,.8,.2,1), scrim fade 200ms; stepper swap instant; reduced-motion = no slide (fade only). Row add acknowledged within 100ms (optimistic; revert + toast on API failure).

## 4. Detail page
- Under title: "{size} - Rs{per kg}/kg" unit-price line (existing calculateUnitPrice).
- "Select size" label (Poppins 13sp SemiBold) + horizontal scroll row of tiles (16dp side padding, 8dp gap).
- Tile: min width 92dp, radius 16dp, padding 8x10dp, 1.5dp border BorderHairline, white. Content: size (13sp SemiBold), price (Quicksand ExtraBold 14sp GreenPrice), MRP strike (10.5sp InkTertiary). Selected: border GreenPrice + SurfaceChip fill. Tag on the top-left edge: "N% OFF" (GreenPrice pill, white 9sp ExtraBold). If that size is in cart: small amber count badge top-right. OOS: 55% opacity, red "OUT" tag, still selectable (so user sees details) but CTA disabled.
- Initial selection: the size the user tapped from (if via sheet) else default size.
- Price block follows selected tile: price, MRP, % OFF chip, "Only N left" chip if low.
- Bottom bar: "Add to cart - Rs{price}" (AddCtaMid ramp, existing detail CTA) -> becomes stepper + line total once in cart; OOS selected size -> disabled DangerSurface button "Out of stock - pick another size".
- Image: if per-size images are absent, keep one image (no swap).

## 5. Cart
One line per size: image well 46dp, name, size on second line (InkTertiary 11sp), stepper, line total (Quicksand) + struck MRP total. Low stock: "Only N left" appended to size line (Warning). Same product's lines sit adjacent (sorted by size). Totals/discount math unchanged.

## 6. Search
Use the same card/list row; the pill replaces pack size. Match on variant sizes optional (query "1 kg sugar" highlighting the 1 kg row in the sheet = nice-to-have, not v1).

## 7. States
- Loading: skeleton card, identical footprint (SkeletonShimmerBase/Highlight); sheet needs no loading (variants arrive with the item).
- Empty/zero variants: treat as single-size using item fields (backward-compatible).
- Out of stock: per row, per tile, whole card (section 2).
- Low stock: per row/tile/detail chip, cart line note.
- Error: add failure -> row reverts, toast "Couldn't add. Try again" (Danger icon).
- Disabled: Done CTA with nothing added; + at cap; OOS CTA.
- Success: stepper swap, card chip "N in cart", cart bar count.

## 8. Accessibility
- Pill: "3 sizes, choose size" (button). Sheet: dialog role, title announced, focus to first row, back closes. Rows: "Sugar 1 kg, 65 rupees, discounted from 80, add" ; steppers "Decrease/Increase 1 kg".
- Tiles: radiogroup/radio with selected state; OOS announced "Out of stock".
- Touch targets >= 48dp; contrast: Warning (#C98A2E) on WarningSurface is below 4.5:1 for 9.5-11sp text, existing card chip precedent, so use WarningText (#8A5A12) for the sheet's "Only N left" line; InkTertiary is decorative/secondary only. SaveChipInk on SaveChipSurface passes.
- Dynamic font: rows grow, never truncate price.

## 9. Platform notes
Android: Material3 ModalBottomSheet styled to the Haper sheet spec; iOS: `.presentationDetents([.medium,.large])` sheet; web: drawer with the same rows. Data: needs a `variants[]` (id, weight, unit, price, sellingPrice, quantity, lowQty, status) on the item - backend open question 1.

## 10. Open questions
1. Do variants exist as separate items (grouped by a shared groupId/parent) or a variants[] on one item? Cart line = variant id either way.
2. Is "Notify me" in scope, or show plain "Out of stock" text?
3. Should + on the card open the sheet (this spec, safest) or add the default size directly like a single-size card?

## Changes vs rejected v1
- Dropped "From Rs33" price pill that only navigated; the card keeps its normal amber +/stepper and a "N sizes" pill beside it.
- Sizes are chosen and added in a bottom sheet with per-size price/MRP/discount/stock/stepper (no forced trip to detail).
- Detail uses tiles (size+price) instead of chips; cart lines per size.

## Options under review (2026-10-26)
User rejected the "From Rs33 / N sizes" card after seeing a Blinkit-style reference. Three options, all in Haper Green tokens, in one clickable mock: `haper-misc/design-product-variants-options.html` (tabs A/B/C; each shows Sugar + Atta, a 5-size Toor Dal, picker open, low stock, out-of-stock size, cart bar, Rs/kg).
- A: card = size tag + Rs/kg + price/MRP + ADD with "N options" caption; sheet = 2-per-row image tiles, ADD at tile corner. Needs a photo per size.
- B: same card as A; sheet = full-width rows (thumb, size/price/Rs/kg, ADD/stepper). Scales to 5 sizes. Recommended.
- C: size chips on the card, price follows chip, normal ADD, no sheet. Best for 2-3 sizes; weak at 5.
Common to A/B: ADD on multi-size card opens the sheet; stepper acts directly if one size in cart, reopens sheet if 2+; no footer button (just a round x above the sheet). This supersedes the "N sizes" pill and the "Done" footer in sections 2-3 once an option is chosen.


---
# FINAL DESIGN (2026-10-27) - Option B chosen + user decisions
Supersedes the "N sizes" pill and "Done" footer (sections 2-3) and the chips/tiles in section 4. Mockups: `design-product-variants-final-mockup.html` (customer) and `design-size-groups-admin-mockup.html` (admin). Customer tokens: Haper Green (Color.kt / Type.kt), no new tokens.
User decisions baked in: unit price is per 100 g / 100 ml; card shows "from Rs X"; max 8 sizes; optional default size; all sizes share primary category + brand; per-store switch; no Notify-me.

## F1. Card (extend ProductCard.kt only when item.variants.size > 1)
Single-size card: unchanged. Multi-size card, top to bottom:
1. Well/image, discount wedge, veg mark: unchanged. Image = default size image (or first in-stock).
2. Name (productNameCard). The old size tag is REPLACED by nothing (no per-size info on the card; sizes differ).
3. Price row: "from" (Poppins 10.5sp, InkTertiary) then price (Quicksand ExtraBold 15sp GreenPrice) = LOWEST in-stock size's selling price. No struck MRP, no % OFF, no Rs/100g on the card (they belong to one size; showing them would mislead). If all in-stock sizes have the same price, drop "from".
4. ADD button (74x34dp, outlined AddButtonMid) with caption under it "N options" (Poppins 10sp, InkSecondary, centered under button, N = in-stock + OOS sizes count shown in the sheet). Tap ADD or caption -> bottom sheet. Never adds silently.
5. In cart: button becomes amber stepper with SUM of all size quantities; caption becomes "N in cart" chip style (SurfaceChip / TealText). Exactly one size in cart: +/- act directly on that line. 2+ sizes in cart: +/- reopen the sheet.
6. All sizes OOS: well dim 45% greyscale, no control, caption "Out of stock" (Danger). Some sizes OOS: card normal; the "from" price ignores OOS sizes; the sheet shows greyed rows.
7. Low stock: not evaluated on the card (per-row in sheet).
Reason for "from": avoids the price jumping around vs the sheet; lowest in-stock is what the user can actually buy.

## F2. Sheet (supersedes section 3)
Round 36dp white close button floats above the sheet (no footer CTA). Sheet: SurfaceWhite, 24dp top radius, max-height 78%, ScrimSheet46. Title: product name (Quicksand 16sp Bold). Rows full width, min 72dp, 12dp v-padding, BorderHairline dividers, sorted by rank (the admin-set order):
- Thumb 56dp well (SurfaceMint) | size label (Poppins 14sp SemiBold) | price (Quicksand ExtraBold 15sp GreenPrice) + struck MRP (11sp InkTertiary) + "N% OFF" pill (SaveChipSurface/Ink) | "Rs X / 100 g" (10.5sp InkSecondary) | optional "Only N left" (WarningText #8A5A12, 11sp SemiBold).
- Right 86dp column: ADD (74x34) or stepper.
- Default size (if admin set one) is NOT highlighted and NOT pre-added; it only decides the card image and the detail page's initial tile.
- Out of stock row: whole row 55% opacity, thumb greyscale, price InkTertiary, status "Sold out" (Danger, 11sp SemiBold) in place of ADD. NO Notify-me. Row stays in rank position (do not move to bottom - keeps muscle memory).
- Qty cap per line min(6, stock): at cap "+" dims 40%; tap -> toast "Max 6 per order" / "Only N available".
- Add is optimistic (<100ms); API failure reverts and shows toast "Couldn't add. Try again".
Tapping a row body (not the button) -> detail page with that size's tile selected.
8 rows: sheet scrolls inside; header and close button stay fixed.

## F3. Detail page (size tiles, "Select Unit")
Order top to bottom: image carousel -> attribute-chip row (brand, veg/non-veg, type - reuse existing detail chips; small, SurfaceMint, 11sp) -> title (Quicksand 18sp Bold) -> "Select Unit" label (Poppins 13sp SemiBold InkPrimary) -> tile row -> delivery/info rows -> description. Sticky bottom bar.
Tile (adapted from competitor pattern, Haper colours):
- Width 108dp, radius 14dp, 1.5dp BorderHairline, white, padding 10dp. Contents: size label (Poppins 13sp SemiBold); price (Quicksand ExtraBold 15sp GreenPrice) + struck MRP (10.5sp InkTertiary) inline; "N% OFF on MRP" (SaveChipInk 10.5sp SemiBold, own line, only if discount > 0); "Rs X / 100 g" (10.5sp InkSecondary).
- Selected: 2dp GreenPrice outline + SurfaceChip tint; a 16dp GreenPrice check dot top-right (second channel besides colour).
- In cart: small amber count badge top-right (replaces check dot position on a non-selected tile; selected+in cart shows count).
- Low stock: keep the Rs/100g line and add "Only N left" (WarningText 10.5sp) as a 4th line on that tile only; tiles in the row equalise to the tallest.
- Out of stock: 55% opacity, "Sold out" Danger 10.5sp replaces the OFF line, still focusable/selectable (user can read details); sticky bar shows disabled state.
- Layout: horizontal scroll row, 16dp side padding, 8dp gap, snap-to-start, scroll position keeps selected tile fully visible. 1-3 tiles fit without scroll. 4-8 tiles: horizontal scroll; the right edge shows a 24dp fade + the next tile peeks by ~20dp so scrollability is visible. Do NOT wrap to rows (it pushes the buy area below the fold). Tablet/web >= 640dp: wrap to a grid of up to 4 per row instead of scrolling.
- Single size (or flag OFF / old client): no "Select Unit" label, no tiles; page is exactly today's detail page.
- Loading: skeleton of title + 3 tile skeletons (108x92dp, SkeletonShimmer) + bar skeleton; no layout jump when real tiles arrive (reserve 92dp).
Price block under tiles follows the selected tile (price, struck MRP, % OFF), unit line "Rs X / 100 g". Image swaps only if per-size images exist.
Sticky bar (SurfaceWhite, top hairline, 12dp padding, safe-area aware): left block = selected size (Poppins 12sp InkSecondary), price (Quicksand ExtraBold 18sp GreenPrice) + struck MRP, below "Inclusive of all taxes" (10.5sp InkTertiary). Right = ONE button 150x48dp radius 16dp, green gradient (GreenLeaf->GreenPrice->GreenDeepest) "Add to cart". After add the button becomes the amber stepper (same footprint, 48dp tall) with line total shown in the left block. Selected size OOS: left block price greyed, button disabled DangerSurface text Danger "Sold out"; helper text under title "Pick another size".
Error (add fails): stepper reverts, toast. Disabled: OOS only.

## F4. Cart lines
One line per size: "Sugar" + second line "1 kg" (InkTertiary 11sp) + stepper + line total; same product lines adjacent by rank. Low stock appended in WarningText. Unchanged totals math.

## F5. Accessibility
- Card ADD: label "Add Sugar, 3 options, from 40 rupees" (button, opens size picker). Stepper with 2+ sizes: "Change quantity, 2 sizes in cart, opens size picker".
- Sheet: dialog, title announced, focus to first row, back/scrim/close dismiss, focus returns to the card. Row label "Sugar 1 kg, 65 rupees, was 80, 19 percent off, 6.5 rupees per 100 grams, add". Sold-out row: "... sold out" with no button role.
- Tiles: radiogroup / radio, checked state announced, "sold out" suffix, arrow keys (web) move selection.
- Touch targets >= 48dp (tiles 108x~92 OK; ADD hit-slop to 48). Contrast: GreenPrice on white 4.9:1 OK; InkTertiary only for non-essential strike MRP; "Only N left" uses WarningText not Warning; "Sold out" Danger (#DC5F78) on white is 3.6:1: use DangerDeep #C9506C (4.6:1) for text on white rows.
- Reduced motion: sheet fades instead of sliding. Dynamic type: rows/tiles grow, price never truncated.

## F6. Platform notes
Android: ModalBottomSheet; tiles = LazyRow. iOS: sheet with detents .medium/.large; tiles = ScrollView(.horizontal) with scrollTargetBehavior. Web: bottom drawer on mobile widths, centred dialog >= 768px; tiles wrap >= 640px. Feature requires `x-client-features: variants-v1`; old clients keep the single-size card.

## F7. Admin "Size groups" screen (summary; full spec below, mock in design-size-groups-admin-mockup.html)
See section A1-A9 below.

# ADMIN SPEC - Size groups
Native to haper-admin: inline-style primitives from `src/pages/Warehouse/ui.tsx` (`card`, `btn('primary'|'ghost'|'danger')`, `input`, `th`/`td`, `StatusPill`, `Modal` with `width`, `PageHeader`) and CSS vars (`--bg-secondary`, `--bg-panel`, `--text-primary/secondary`, `--border-color`, `--accent-primary/-soft/-text`, `--danger`, `--success`, `--warning-text/-soft/-border`, `--radius-md`). Dark + light both via the vars (the mock has a theme toggle). Layout reference: `InventoryGroups/InventoryGroupModal.tsx`. No new tokens.

## A1. Access (changes the plan!)
Plan section 5.1 says SUPER_ADMIN only; the user decided super admin + warehouse manager. Needed: backend `requireRole(SUPER_ADMIN, WAREHOUSE_MANAGER)` on /admin/variant-group; FE route guard + `useMenu.ts` entry (label "Size groups", keywords size/variant/pack/group) for both roles; `permissions.ts` mirror updated (FE/BE mirror rule). Everyone else: menu entry hidden; direct URL shows the permission-denied state (A7).

## A2. Flow
1. Menu -> Size groups (list). 2. "New size group" -> modal. 3. Search items (brand+category scope), add, label, order, default. 4. Live validation; Save disabled while any BLOCKING error. 5. Warnings (non-blocking) need a "Save anyway" tick. 6. Success: modal closes, row appears with green "Saved" flash + toast. Edit: row click. Dissolve: row menu -> confirm. Suggestions: right/top panel -> "Review & create" opens the same modal PREFILLED (never saved until Save).

## A3. List page
PageHeader "Size groups" + subtitle "Sizes of one product shown as one card in the app" + action "New size group". Below: store-switch hint card only if no store has the switch on ("Size variants are off for all stores - customers will not see groups yet. Turn on per store in Stores.") amber soft.
Toolbar: search input (name/brand), status select (All/Active/Dissolved hidden by default). Table columns: Group name (+ thumbs of first 3 sizes) | Brand | Category | Sizes (count, "5 / 8") | Default size | Status pill | Updated (right, dd MMM yyyy) | row menu (Edit, Dissolve). Sizes count right-aligned; row hover bg `--accent-soft`; row is a button (Enter opens). Pager as other admin tables. Status pill: Active = `--success`, Dissolved = grey, "Needs attention" = warning (a member went inactive/discontinued).
Below 900px: columns Brand/Category/Updated collapse into a second line under the name.
Suggestions panel: collapsible card ABOVE the table ("Suggestions - 6 candidate groups found", chevron). Each suggestion row: proposed name, brand, category, size chips (labels), warnings count, button "Review & create" (primary ghost). A footnote: "Suggestions are never saved automatically." Dismiss (x) hides until next scan (client-side only). Empty suggestions: panel hidden.

## A4. Create/Edit modal (Modal width 880; one column < 760px)
Header: "New size group" / "Edit size group - {name}". Body in 3 blocks:
1. Group: Name (input, required, hint "Shown in the app, e.g. Sugar"), Brand + Category read-only chips derived from first item added (label "Locked by first item"; clears when all items removed).
2. Add items: search input over products (name/barcode), result list shows thumb, name, brand, category, weight+unit, status. Results that cannot be added are shown DISABLED with the reason inline: different brand, different category, already in "{group}", inactive/discontinued, group full (8). Click/Enter adds.
3. Sizes table (reorder with up/down buttons + drag handle; the order = order customers see; recommend smallest to largest, a "Sort by size" ghost button does this): # | thumb | item name | weight+unit | Label input (default prefilled from weight, e.g. "500 g", max 20 chars) | Price per 100 g/100 ml (read-only, right-aligned, Rs) | Default radio (optional; a "No default" radio above the table) | remove (x).
Footer: left = validation summary count ("2 problems"), right = Cancel (ghost) / Save group (primary; disabled with title explaining while blocked). Saving state: button "Saving..." disabled, inputs disabled.
Live validation (shown inline on the offending row AND as a red summary list at modal top; all text plain):
- BLOCKING (red `--danger`, row left border): "Brand differs: {item} is 'Tata', this group is 'Aashirvaad'. Fix the brand in Product Master or remove it." / "Category differs: {item} is in Oils, this group is Atta & Flour." / "More than 8 sizes. Remove {n}." (counter "5 / 8" turns red at 9; add is blocked at 8 anyway, count error occurs only via suggestion prefill) / "{item} is already in group 'Sugar (Madhur)'. Open that group or remove it here." / "{item} is inactive and cannot be a size. Remove it or reactivate it in Product Master." / "Need at least 2 sizes." / "Label '1 kg' is used twice." / "Label is required (max 20 characters)." / "Name is required."
- WARNING (amber `--warning-*`, needs tick "I checked these, save anyway"): per-100 g price is far from the others ("Rs 18 per 100 g vs Rs 7 for the others - check the pack size"), looks like a multipack ("Sugar 1 kg x 2"), size has no store items.
Each error includes a fix hint; fields use aria-invalid + aria-describedby; summary has role="alert".
Server conflicts: 409 member grouped elsewhere/rev mismatch -> banner "Someone changed this group. Reload to see the latest." with "Reload" button (keeps nothing). 422 warnings -> same as warnings tick.
Dirty-close: Cancel/x/Esc with edits -> small confirm "Discard changes?".

## A5. Dissolve confirm
Use existing `ConfirmDialog` (danger variant) with `acknowledgeLabel`: "Dissolve 'Sugar'? The 4 sizes become separate products again. In the app, customers will see 4 separate cards. Carts that contain these sizes are not affected." Checkbox "I understand" gates the danger button "Dissolve group". Success toast "Group dissolved". Failure keeps dialog open with inline error + Retry.

## A6. Suggestions detail
Source: GET /variant-group/suggestions (read-only). Row expands to show members (name, weight, suggested label) and warnings. "Review & create" -> modal prefilled with those items/labels/order (name editable). Cancel loses nothing server-side. Copy always says "Suggested". Loading: 3 skeleton rows. Error: "Couldn't load suggestions. Retry" (the list below still works).

## A7. States
- Loading: table skeleton, 6 rows with `--bg-panel` bars (light mode: use `--border-color` fill since bg-panel == bg-secondary there).
- Empty (no groups): illustration-free card: "No size groups yet" + "Group items like Sugar 500 g / 1 kg / 5 kg so customers see one card." + primary "New size group" + (if suggestions exist) "or review N suggestions".
- Empty search: "No groups match 'xyz'" + Clear search.
- Error: card with danger-soft border "Couldn't load size groups" + reason + Retry; keeps header. Do not show the empty state on error.
- Success: toast + row flash.
- Disabled: Save while blocked/saving; Add on non-addable results; New group button disabled with tooltip if user lacks permission (not rendered for non-roles).
- Permission denied: full-page card "You don't have access to Size groups" + "Ask a super admin or warehouse manager" + button "Back to dashboard"; HTTP 403 from API shows the same card.

## A8. Interaction
Hover/focus: rows `--accent-soft`; focus ring 2px `--accent-primary` offset 2. Modal open 150ms ease-out fade+4px rise; validation messages appear without layout jump (reserve line height) and announce via aria-live=polite (summary assertive on Save attempt). Reorder: up/down buttons move row and keep focus on the moved row's button; drag is a progressive enhancement. Optimistic UI: none on save (wait for server); list refetches. Esc closes (with dirty guard). `prefers-reduced-motion`: no rise.

## A9. Accessibility
Table with real th scope; numbers right-aligned; dates "27 Oct 2026". Buttons >= 32px tall (admin density), icon buttons have aria-label ("Move up {item}", "Remove {item}"). Default radios grouped with legend "Default size". Colour never sole signal: errors have an icon + text. Contrast: `--accent-text` and `--warning-text` for text; white on `--accent-primary` is 4.47:1 per index.css note - use existing btn() as-is.

## A10. Per-store switch (Stores modal)
Toggle "Size variants" (default off) in the store config section next to the discounts toggle; helper "Customers on updated apps see sizes grouped into one card." Changing it shows no confirm (reversible).
