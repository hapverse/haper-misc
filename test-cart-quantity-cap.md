# Test: cart line item quantity cap (6 per line)

**Area:** Android only, client-side. `app/src/main/java/com/bheldi/util/CartQuantityCap.kt`
(constant + `effectiveMaxQuantity`), `app/src/main/java/com/bheldi/ui/screens/cart/CartViewModel.kt`
(`addToCart`, `isAtQuantityCap`), stepper UI in `ProductCard.kt`, `ItemCard.kt`,
`HaperItemRow.kt`, `ItemDetailScreen.kt`, `CartScreen.kt`.
**PR/deploy:** Android app release only. No backend change, no admin change — the 6-unit cap is
enforced only in the client (see "Not covered" below).

## What changed
Every "in cart" stepper's `+` now disables at **6 units per line**, independent of stock — the
per-line cap (`CART_QUANTITY_CAP = 6`) and the live stock ceiling (`maxAvailable`) both apply, and
whichever is more restrictive wins (`effectiveMaxQuantity`). `CartViewModel.addToCart` rejects any
add that would push a line above the effective max and sets a specific `errorMessage` explaining
why. `CartViewModel.isAtQuantityCap(itemId)` is the single source of truth for "is this line at the
cap" — `ItemDetailScreen.kt` and `CartScreen.kt` call it directly since they hold a `CartViewModel`
reference; `ProductCard.kt` / `ItemCard.kt` / `HaperItemRow.kt` only receive `quantityInCart: Int`
as a param (no ViewModel access) so they compare against the `CART_QUANTITY_CAP` constant inline —
same result, just no VM dependency in those leaf composables.

## Steps
- ✅ **Add up to 6 succeeds.** From Home/Aisle grid, Search row, or Product detail, tap `+` on an
  item with ≥6 stock repeatedly. Quantity climbs 1→6 with no error, cart total updates each time.
- ✅ **7th add is blocked with the cap message.** At quantity 6, `+` is visually disabled (dimmed,
  not just inert) on all four surfaces: Home/Aisle grid card, Search row, Product detail page, and
  Cart screen stepper. If a stale enabled `+` is somehow tapped (e.g. race), `errorMessage` shows
  **"You can add up to 6 of this item."** and quantity stays at 6.
- ✅ **Stock < 6 shows the stock message once stock is exhausted**, not the cap message. E.g. an
  item with `maxAvailable = 3`: `+` disables at quantity 3 (stock ceiling is the more restrictive of
  the two), and if triggered anyway the message is **"No more quantity available. Only 3 in
  stock."** — never the generic cap message, since `maxAvailable < CART_QUANTITY_CAP` takes
  precedence in `CartViewModel.addToCart`'s message branch.
  - `maxAvailable <= 0` → **"This item is currently out of stock."** (existing OOS message,
    unchanged by this work).
- ✅ **Pre-existing cart line already above 6 can still decrement, never increment further.** Seed a
  cart line at quantity 8 (e.g. via a cart added before this cap shipped, or directly via the cart
  API in a dev/test build). Open Cart screen: `−` is enabled and decrements normally (8→7→6→…);
  `+` stays disabled the entire time the line is ≥6 (`isAtQuantityCap` is `>=`, not `==`, so it
  doesn't flip enabled again until the line actually drops below 6 — confirm it re-enables once the
  user manually decrements below 6).
- ✅ **`+` visually disables, not just silently no-ops**, on all 4 surfaces: Home/Aisle grid
  (`ProductCard.kt`), Search row (`HaperItemRow.kt`), Product detail (`ItemDetailScreen.kt`), Cart
  screen (`CartScreen.kt`). Dimmed alpha (~0.4) at the cap, full opacity below it.
- ✅ **TalkBack announces disabled state at the cap**, not just "Increase quantity" with no
  indication. All three leaf glyphs (`ProductCardStepperGlyph`, `StepperGlyph`, `RowStepperGlyph`)
  and `CartScreen`'s `CartStepperGlyph` use `Modifier.clickable(enabled = enabled, onClick = onClick,
  role = Role.Button)` so TalkBack reads "Increase quantity, dimmed / unavailable" at the cap
  instead of a clickable node with no click semantics.
- ✅ **Cart screen `isUpdating` dimming doesn't double-stack with the cap dimming.** While a
  quantity update is in flight (`isUpdating`), the whole stepper Row dims to `alpha(0.6f)`. The `+`
  glyph's own dim (`dimmed` param) only fires for the cap reason (`quantity >= CART_QUANTITY_CAP`),
  not for `isUpdating` — so the compounded opacity during an in-flight update on an already-capped
  line is ~0.24 (0.6 × 0.4), same as before this fix, not stacked further.

## Edge cases
- Cap and stock ceiling both apply — whichever is lower wins (`effectiveMaxQuantity`). A 20-in-stock
  item still caps at 6; a 3-in-stock item caps at 3, never lets the user reach 6.
- The cap is **per cart line**, not per SKU family — a 500g and 1kg variant of the same product are
  separate lines, each capped independently at 6.
- Decrementing a line that started above 6 (legacy data / pre-fix carts) is always allowed; only the
  `+` direction is gated.

## Not covered / follow-ups
- **No backend enforcement.** The cap is enforced entirely client-side in the Android app; there is
  no matching check on the cart/order API. A modified or patched client (or a direct API call) could
  still push a line past 6. See the code comment on `CART_QUANTITY_CAP` in `CartQuantityCap.kt`.
  Backend equivalent is a tracked follow-up, not built here — different codebase/scope.
- iOS parity not covered by this test guide — check `test-ios-parity.md` separately if/when the cap
  ships there.
