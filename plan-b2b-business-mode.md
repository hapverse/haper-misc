# Plan: B2B improvements — "Haper Business" mode + wholesale bulk-quantity discounts

Status: APPROVED by user 2026-11-01. Nothing committed yet; build in progress (direct-to-dev workflow, user approves each commit).
Scope: dev only (`dapi.haper.in` / `damin.haper.in`). Clients now: backend, admin, Android. iOS + web = follow-ups.
Builds on: `haper-backend/docs/plans/retailer-wholesale.md` (P1, built on dev, NOT on prod), `haper-misc/design-retailer-wholesale.md`, `haper-misc/discounts-promotions-plan.md`.
All names/numbers below are made up (e.g. "Sample Kirana", Maggi Pack of 100 at Rs 1,150).

---

## 0. Plain-words summary

Today an approved retailer ("B2B user" = a normal Haper account whose shop application was approved) sees ONE mixed shop: normal retail items AND wholesale items (packs such as "Maggi 70 g Pack of 100", or items ticked "Wholesale-only").

After this change there are two separate shops inside the same app:

- **Haper** (normal) = retail items only. Every customer, retailers included. Wholesale items are never shown here.
- **Haper Business** = wholesale items only. Only approved retailers can enter, through a switch on the Home screen. It has its own cart, so switching back and forth never mixes the two.

Plus: when a product is marked wholesale-only in admin, the same form lets the super admin set **bulk-quantity discounts** ("tiers"). Example: Maggi Pack of 100 costs Rs 1,150 a pack; tier "10 packs or more = 2% off" and "15 packs or more = 5% off". A retailer buying 12 packs pays Rs 1,127 a pack (2% off); buying 15 pays Rs 1,092.50 a pack (5% off).

The backend is the referee for all of it: what is listed, what can be added to a cart, and what is charged. The app only asks "I am in Business mode" with one header; the server checks the person really is an approved retailer at a store with wholesale switched on, otherwise it quietly serves the normal shop.

---

## 1. Goal and acceptance criteria

Goal: give approved retailers a separate wholesale shop ("Haper Business") reachable from a Home-screen switch, keep the normal shop free of wholesale items and the business shop free of retail items, and let the super admin attach quantity-based discounts to wholesale products from the product form, applied identically in cart, checkout, order record and invoice.

### Acceptance criteria (checklist = "done")

Mode and visibility
- [ ] A1. Normal customer: app looks and behaves exactly as today. No wholesale item anywhere (home, categories, sub-categories, search, search chips, item page by id/iId/barcode, size sheet, cart, wishlist). Their JSON is byte-identical to today (snapshot test).
- [ ] A2. Approved retailer in **Haper** mode: sees retail items only (same as A1). Cannot add a wholesale item to the cart (404 "Item not found or out of stock", same as any hidden item).
- [ ] A3. Approved retailer in **Haper Business** mode: sees wholesale items only on every surface in A1. Cannot add a retail item (same 404). Categories with no wholesale item do not appear as tiles; tile counts and "from Rs X" count wholesale items only.
- [ ] A4. Business mode has its own cart. Example: retailer has 3 x Atta 5 kg in the Haper cart, switches to Business, adds 10 x Maggi Pack of 100, switches back: the Haper cart still shows exactly the 3 x Atta; switching to Business again shows the 10 packs.
- [ ] A5. Placing an order from one mode orders only that mode's cart and empties only that cart.
- [ ] A6. Someone who is not an approved retailer (or whose store has wholesale off) sending the Business header gets the normal Haper shop; the response tells the app `x-shop-mode: retail` and the app switches its UI back.
- [ ] A7. A retailer suspended while in Business mode: within the existing cache bound (60 s) every screen falls back to normal Haper; a checkout of the business cart is refused by the in-transaction check that exists today.
- [ ] A8. Business mode shows no retail banners, no coupon offers list, no free-gift progress bar, no Print tile.

Home switch (Android)
- [ ] H1. Home shows a "Haper | Haper Business" switch at the top of the green header when the retailer program is on for the store (`programEnabled`).
- [ ] H2. Approved retailer at a wholesale store: tapping "Haper Business" switches mode instantly (header turns plum, title "Haper Business", lists and cart reload). Tapping "Haper" switches back.
- [ ] H3. Not a retailer / pending / rejected / suspended / store without wholesale: tapping "Haper Business" opens a bottom sheet that explains and leads to the right place (apply, view status, fix and resubmit, contact support, "not available at this store yet"). Mode does not change.
- [ ] H4. Mode is remembered per device and per logged-in user across app restarts; logout resets to Haper.

Bulk-quantity discounts (tiers)
- [ ] T1. Admin product form: when "Wholesale-only item" is ticked (or the product is a pack), a "Bulk discounts" block appears with up to 5 rows "From [qty] units -> [x]% off". Blocking errors: qty not a whole number 2-100000, % not in (0, 50], quantities not strictly increasing, % not strictly increasing, duplicate qty, more than 5 rows.
- [ ] T2. Unticking "Wholesale-only" with tiers present asks "Remove the bulk discounts too?" and saving removes them (server also refuses tiers on a non-wholesale product).
- [ ] T3. Saving tiers that would price any store's item below its cost shows a warning listing store, tier and price vs cost; saving needs an "I understand" tick (super admin only; audited).
- [ ] T4. Retailer (Business mode) item page for a tiered item shows a "Bulk price" table: "10+ packs: 2% off, Rs 1,127 each" (prices computed by the server for that store).
- [ ] T5. Cart line with quantity 12 shows struck Rs 1,150, Rs 1,127 each, label "2% OFF bulk", line total Rs 13,524; a nudge "Add 3 more for 5% off". The bill's Discount row includes the tier saving.
- [ ] T6. Checkout charges exactly what the cart showed (parity test). The order line stores `salePrice` = 1,127 (paid price), `originalSalePrice` = 1,150, `discountAmount` = 23 (per unit), one `appliedDiscounts` entry `{kind:"WHOLESALE_TIER", minQty:10, type:"PERCENT", value:2, amount:23}`; `costPrice` is the untouched sale-time cost snapshot; `discountTotal` includes 23 x 12 = 276.
- [ ] T7. The B2B GST invoice shows the line at the paid rate Rs 1,127 (taxable value = what was paid). Refunds and profit reports read the paid price with no code change.
- [ ] T8. Wholesale lines still never get automatic sale discounts or coupons (existing rule); the tier is the only discount on a wholesale line.
- [ ] T9. Retail (non-wholesale) items can never carry tiers.

---

## 2. Current state (verified in code on `dev`, 2026-11-01)

Who is a retailer
- `haper-backend/packages/shared/utils/viewer.utils.js`: `getViewer(req)` (Redis `rtl_<userId>`, 60 s, negative cached, fail closed) and `wholesaleAudience(req)` = store `config.wholesaleEnabled === true` AND profile APPROVED. Not in the JWT.
- Checkout never trusts the cache: `resolveRetailerCheckout` (`user/src/routes/order/controller.js` ~1052) re-reads the profile in the transaction.

Visibility (one predicate)
- `shared/utils/item-visibility.utils.js`: `audienceFilter(wholesale)` returns `{}` when `wholesale === true` (retail + wholesale, "combined") else `{ wholesaleOnly: { $ne: true } }` (retail only, fail closed).
- `shared/utils/taxonomy.utils.js`: `activeItemFilter` / `listableItemFilter` / `buyableItemFilter` / `buyableMembershipFilter` all take `{ wholesale }`.
- Callers that pass `wholesale` (all from `viewerUtils.wholesaleAudience(req)`): `user/src/routes/home/controller.js` (categories, sub-categories, aisle items, featured), `user/src/routes/item/controller.js` (list, detail, search, search fallback), `user/src/routes/cart/controller.js` (`cartAudience`), `user/src/utils/present-items.js` (variant members, pack base labels); repositories `item.repository.js` (getPaginated, getPaginated4User, getCollapsedPage4User, getPaginatedItemsBasedOnCatSubCat, getVariantMembers, getDetail4User, getCount, search, search4User, regexFallbackSearch, getSearchDocsByIds), `category.repository.js` (getAll, getStoreCategoryMeta incl. `wholesale === true` branches at ~273/~295), `sub-category.repository.js`, `category-search.repository.js`, `cart.repository.js`.
- Hardcoded `{ wholesale: true }` in checkout: `order/controller.js` ~1097 (`supersedeUnpaidOrders`), ~1171 (placeOrder), ~1780 (placeScheduledOrder). Hardcoded `{ wholesale: false }`: `coupon/controller.js:51`.
- No viewer state needed on POS (refuses wholesale), picker, delivery.

Wholesale items
- `wholesaleOnly: true` on `products` + fanned out to `items` by `wholesaleFieldsFromProduct()` (`shared/repositories/product.repository.js:73`), `$unset` when cleared (`fanOutToItems`, ~198-206). Key exists only on wholesale docs (no default).
- Packs: `packOf {baseIId, units}`; always wholesale-only; derived stock. Created via `POST /admin/product/:id/packs`.
- Admin product form: `haper-admin/src/pages/Products/ProductModal.tsx` (~353-362, "Wholesale" checkbox + HSN), `productForm.ts` (`buildProductBody`, `hsnError`), types `src/types/product.ts`. Product master API is `requireRole(SUPER_ADMIN)` (`admin/src/routes/product/router.js`); validator `admin/src/routes/product/validator.js` `masterFields`; controller `MASTER_INPUT`, `splitSparseInput` (blank/false -> `$unset`).

Cart
- Redis only: key `CART:<userId>:<type>`, `cartType = { WISHLIST: 1, CART: 2 }` (`shared/constants/item.constant.js:2`), 12 h TTL. One cart per user per type, bound to one store.
- `cart.repository.js`: `_hiddenFrom` / `_withoutHiddenLines` filter the RESPONSE only (hidden lines are kept in Redis); `add` refuses hidden items with 404; `_findCartByItemOrCartId` loops `Object.values(cartType)`; `getCartForItems` always reads `cartType.CART`.
- Cart validators accept `type` from `Object.keys(cartType)` (`user/src/routes/cart/validator.js`). So a new public cart type would be client-writable.
- `buildCartPayload` (`cart/controller.js` ~253-480): gross `totalPrice`; coupon preview OR auto-discount preview (never both); wholesale lines excluded from both (`isPromoLine`); per-line Gson-safe fields `discountAmount / discountTotal / discountedPrice / discountLabel`; `discount {total, lines, labels}`; gift subtotal = net minus wholesale GROSS; `paymentOptions` only for the audience.

Checkout and order lines
- `prepareOrderItemsAndInventory` (~285): `salePrice = item.sellingPrice`, `costPrice` from `sellFEFO` (per pack for packs), `wholesaleOnly`/`packOf`/`hsn` keys on wholesale lines.
- Then coupon (`applyCouponForAttempt`) OR `discountUtils.applyDiscountsToOrderLines` — both BASELINE every line (`originalSalePrice = salePrice`, `discountAmount = 0`, `appliedDiscounts = []`) and skip wholesale lines for the money. Then `itemsTotalTmp` / delivery / `calculatePricing` from `salePrice`. Two paths: placeOrder (~1300-1370) and placeScheduledOrder (~1900-1940).
- `orders.schema.js`: `salePrice` = paid unit price (the backward-compat anchor), `originalSalePrice`, `discountAmount` (per unit), `appliedDiscounts[{ruleId, name, type, value, amount}]`, order `discountTotal`. Order edit (`shared/utils/order-edit.utils.js` ~254-290, ~455-470) CARRIES these per line, never re-resolves; added lines get no discount.
- Invoice (`shared/utils/invoice.utils.js:134,192`): rate and amount from `salePrice`. Profit/COGS read `items.costPrice` snapshot.

Existing discount mechanisms (checked for reuse)
- `discount-rules` + `discount.utils.js` (automatic sales: %, flat, schedule, stacking, margin clamp + cost-disclosure suppression). Wholesale lines are excluded by design (retailer plan D6). It has NO quantity-threshold concept.
- Coupons: whole-cart codes, wholesale excluded.
- Gift tiers: per-store "spend Rs X, get item Y". Different concept, name clash risk ("tiers").
- `cart-limit-rules`: max quantities, not prices; wholesale exempt.
- Verdict: no quantity-tier price mechanism exists. Reuse the ORDER-LINE money fields and the cart per-line/discount block shape; do not bolt tiers onto `discount-rules` (that engine is store-switched, schedule-based, excluded for wholesale, and edited on a different screen than the one the user asked for).

Android
- Header interceptor: `app/src/main/java/com/bheldi/data/api/NetworkModule.kt` `buildAuthInterceptor()` (adds `x-store-id`, `x-client-features: variants-v1`). Store id lives in `util/AppEnvironment.kt`.
- Home: `ui/screens/home/HomeScreen.kt` (`HomeHeroCard` ~564: green gradient header, address row + Help pill, search field; banners; `WalletPrintRow`; categories; "Fresh picks"), `HomeViewModel.kt`.
- Retailer: `ui/screens/retailer/*` (apply/status), `data/model/RetailerModels.kt` (`RetailerMeData`), `ApiService.kt` `getRetailerMe`.
- Wholesale UI: `ui/variants/WholesaleDisplay.kt` (`isWholesale()`), `WholesalePill`, `data/model/HomeModels.kt` `WholesaleBlock(units, perUnitPrice, ...)`, cart line `discountedPrice` already rendered (`ui/screens/cart/CartScreen.kt:950`).
- GAP found: `util/CartQuantityCap.kt` `CART_QUANTITY_CAP = 6` is applied to EVERY line in `CartViewModel.addToCart` (~276) — wholesale included — although retailer plan D1 says packs are capped by stock only. A tier at "10 packs" is unreachable today. Must be fixed in this work.
- Release state: Android `main` already contains the retailer apply/status and wholesale pill commits; backend `main` has no retailer code, so nothing wholesale is live on prod. iOS/web retailer code is on `dev` only.

---

## 3. Proposed design

### 3.1 Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | Two shop **modes**, not a hard filter: Haper (retail only, everyone) and Haper Business (wholesale only, approved retailers). | Bullet 4 asks for a switch, which only makes sense if both worlds stay reachable. A shop owner still buys groceries for home. (Q1 — if the user wants a hard filter, only the resolver in D3 changes.) |
| D2 | Mode is sent by the client on every request as header `x-shop-mode: business` (absent or anything else = Haper). The server decides the EFFECTIVE mode and echoes it in the response header `x-shop-mode`. | Same pattern as `x-store-id` / `x-client-features`. Stateless, per device. A header that is ignored is safe: it can only ever show the normal shop. Server-stored mode was rejected: an old app on a second device could get stuck in Business with no switch. |
| D3 | Effective Business = header says business AND store `wholesaleEnabled` AND viewer APPROVED (the existing `wholesaleAudience` checks, unchanged, plus the header). | One gate, already fail-closed and cached. Spoofed headers do nothing. |
| D4 | `audienceFilter(true)` changes from "retail + wholesale" to **"wholesale only"** (`{ wholesaleOnly: true }`). `audienceFilter(false)` is unchanged (retail only). | Every read path already threads this one boolean, so the whole catalogue flips with a 1-line predicate change; no third "combined" state survives. Missing parameter still means retail (fail closed for wholesale). A forgotten path can at worst show retail items in Business mode (a UX gap, never a leak). |
| D5 | The "combined" view (retail + wholesale together) is retired. A request without the header is Haper mode for everyone, retailers included. | Matches the user's rule "retail products not visible to B2B users" (in Business) and keeps two clean worlds. Nothing wholesale is on prod yet, so no released client loses a working flow (Q5). |
| D6 | Business mode uses its own Redis cart: internal cart type `BUSINESS = 3` (key `CART:<userId>:3`), NOT added to the public `cartType` enum. Controllers map the client's `type=CART` to the business cart when the effective mode is Business. | Each mode keeps its cart while switching. Checkout and Razorpay already address carts by `cartId` and `deleteCart` deletes only that cart's key, so the order path needs no "remove some lines" logic. Kept out of `cartType` because validators accept `Object.keys(cartType)` from clients. |
| D7 | Checkout reads the cart with the view **derived from the cart's own type** (CART -> retail view, BUSINESS -> wholesale view), replacing the 3 hardcoded `{ wholesale: true }`. The in-transaction profile check stays exactly as today. | The order then contains exactly the lines the cart screen showed. Without this, a pre-change mixed cart would charge for lines the screen hides. |
| D8 | Bulk tiers = `wholesaleTiers: [{ minQty, percent }]` on the product MASTER (global), fanned out to items like `wholesaleOnly`. Thresholds are in the item's own selling unit (packs for a pack). Applied per cart LINE (one item's quantity), highest qualifying tier wins. | Product master is global and super-admin owned; prices are per store, so a % works in every store. Per-line is predictable and matches "define it on the product". (Q2) |
| D9 | One pure util `shared/utils/wholesale-tier.utils.js` decides the tier and the price; cart preview, checkout and the item presenter all call it. Tier price = `round2(sellingPrice x (1 - percent/100))` per unit; line = unit x qty. | Preview and charge can never drift (same lesson as `discount.utils`). Per-unit rounding matches `discountAmount` per-unit semantics. |
| D10 | Tier money is written into the EXISTING line fields: `salePrice` = paid unit price, `originalSalePrice`, `discountAmount` (per unit), `appliedDiscounts` + one entry with new optional keys `kind: "WHOLESALE_TIER"`, `minQty`. Applied AFTER the coupon/auto-discount step (both baseline wholesale lines to zero) and BEFORE `itemsTotalTmp`. `discountTotal += tierTotal`. | "Keep salePrice = paid price": invoice, refunds, partial refunds, `actualOrderValue`, profit/COGS and order-edit carry-forward work unchanged. `costPrice` snapshot untouched, so profit = (paid - cost) x qty stays true. |
| D11 | Below-cost tiers: warn + acknowledge at save (super admin), NO runtime clamp. (Q3) | A clamp would silently break the advertised tier, and "suppress if clamped" (the sale-discount rule) would make the tier vanish unpredictably. A tier price is a fixed % of the selling price, so it never discloses cost. Mirrors the discount-rule save-time acknowledge. |
| D12 | Tiers allowed only on wholesale products (`wholesaleOnly` or pack). Removing wholesale-only removes tiers in the same write. | Bullet 3 says tiers are defined "at the same place" when B2B-marked; retail items keep the existing sale-discount engine. |

### 3.2 Request flow (mode)

```
App (Business on)  --x-shop-mode: business-->  shopMode middleware (per router, after authenticate)
                                                 view = await viewerUtils.shopView(req)
                                                   header != business          -> RETAIL (no lookup)
                                                   store flag off (in-process) -> RETAIL
                                                   viewer not APPROVED         -> RETAIL
                                                   else                        -> BUSINESS
                                                 req.shopView = view; res.vary("x-shop-mode"); res.set("x-shop-mode", view)
controllers: wholesale = (req.shopView === BUSINESS)   (wholesaleAudience(req) keeps its name, now = shopView === BUSINESS)
repos:       audienceFilter(wholesale)  -> true: { wholesaleOnly: true } | false: { wholesaleOnly: { $ne: true } }
cart:        cart type = wholesale ? BUSINESS(3) : requested type (CART/WISHLIST)
App reads response header x-shop-mode; if it asked business and got retail -> flips UI to Haper + one-line notice.
```

Mounted on: `home`, `item`, `cart`, `coupon`, `retailer` routers (the ones that read the viewer). Wishlist stays one shared list; its response is filtered by the same view (business shows only wholesale wishlisted items).

### 3.3 Cart and checkout flow (money)

```
Cart GET (Business): CART:<u>:3 -> populate items -> sanitizer drops retail lines (defence in depth)
   gross totalPrice (unchanged meaning)
   coupon preview: skipped result-wise (no promo-eligible lines; existing NO_HEADROOM)
   auto-discount preview: skips wholesale lines (existing)
   NEW tier preview (wholesale lines, in BOTH coupon and no-coupon branches):
       per line: discountedPrice = tier unit, discountAmount = per-unit off, discountTotal, discountLabel "2% OFF bulk"
       discount.total += tierTotal, discount.lines += {lineIndex,label,amount}, labels += label
   netTotal = gross - (coupon or auto) - tierTotal
   giftOffer = NO_GIFT_OFFER in Business view; elsewhere subtotal = netTotal - wholesaleNET (not GROSS)
   paymentOptions (existing)

placeOrder / placeScheduledOrder:
   cart = CartRepository.getById(userId, cartId, session, storeId, { byCartType: true })   // view from cart.type
   resolveRetailerCheckout (fresh profile, in txn) -> prepareOrderItemsAndInventory (unchanged refusal rules)
   coupon OR applyDiscountsToOrderLines (unchanged; both baseline + skip wholesale lines)
   NEW tierTotal = wholesaleTierUtils.applyTiersToOrderLines(orderItems)    // pure, per line, uses line.tierSource
   discountTotal = round2(discountTotal + tierTotal)
   itemsTotalTmp / delivery / calculatePricing / wallet / gift (unchanged, now see tier prices)
```

`line.tierSource` = the item's `wholesaleTiers` copied onto the line by `prepareOrderItemsAndInventory` as a transport-only field and deleted by `applyTiersToOrderLines` (same pattern as `marginCostPrice`), so tiers are read from the same fresh item doc as the price. It must never reach the order document (test).

### 3.4 Tier rules (pure util)

- Input `{ tiers, quantity, unitPrice }`. Qualifying tier = the one with the largest `minQty <= quantity`. No tier -> no change.
- `finalUnit = round2(unitPrice x (1 - percent/100))`; `perUnitOff = round2(unitPrice - finalUnit)`.
- Floor: if `finalUnit < DiscountConstants.MIN_SANE_UNIT_PRICE` -> treat as no tier (same floor as the sale engine).
- Only for wholesale lines (`retailerPaymentUtils.isWholesaleLine`), never free-gift lines, only `unitPrice > 0`.
- Malformed stored tiers (not ascending, bad numbers) -> ignored entirely (fail open = full price, logged), like the sale engine.
- `nextTier(tiers, quantity)` -> `{ minQty, percent, addMore }` for the nudge (computed by client from the presented tiers; util exported for server tests).

### 3.5 Presentation (whitelisted, audience-only)

- `variant-present.utils.js`: add `wholesaleTiers` to `WHOLESALE_RAW_FIELDS` (raw key never leaves the server). `buildWholesaleBlock` adds `tiers: [{ minQty, percent, unitPrice }]` (unitPrice computed from the doc's own selling price) only when tiers exist. Old clients ignore the extra key.
- Non-audience viewers never receive wholesale docs, so their JSON is unchanged.

### 3.6 Home switch — design note (for chanchal-designer to finalise; Android first)

Tokens: reuse `ui/theme/Color.kt` (`AccentPlum`, `AccentPlumContainer`, `WholesaleInk` #6B3FA6), Type.kt (Quicksand titles, Poppins body), Dimens/HaperSpacing, sheet style from existing bottom sheets, `HaperPrimaryButton` / `HaperSecondaryButton`.

Placement: a segmented switch at the TOP of `HomeHeroCard`, above the "DELIVERING TO" row, full width, 36dp tall, radius full. Track = white 18% glass (same recipe as the Help pill); selected segment = white fill; labels Poppins SemiBold 13sp: "Haper" | "Haper Business" (storefront icon 14dp before "Haper Business"). Selected label colour: GreenDeep in Haper, WholesaleInk in Business; unselected label white 85%.
- Why at the top: it changes the whole screen; users find shop switches at the top (common grocery-app pattern), and it does not fight the address row / Help pill for width.

Business mode visuals (so nobody orders in the wrong shop):
- Header gradient switches from the green recipe to plum: `WholesaleInk` (#6B3FA6) -> new token `BusinessDeep` (proposed #4A2580; white text >= 7:1 on both stops). One new token, designer to confirm.
- Eyebrow "HAPER BUSINESS" above the address; search placeholder "Search wholesale items...".
- Hidden in Business: banner carousel (server returns none anyway), Print tile, Offers entry, free-gift progress. Wallet strip stays.
- Section titles: "Shop by category" stays; "Fresh picks" -> "Wholesale for your shop".
- Empty state (no wholesale items at this store): existing `HaperEmptyState` "No wholesale items here yet" + secondary button "Back to Haper".
- Floating cart bar and cart screen title read "Business cart" in Business mode (plum WholesaleInk text on AccentPlumContainer chip).

States of the "Haper Business" segment (from `GET /user/retailer/me`):
| State | Tap on "Haper Business" |
|---|---|
| `programEnabled` false, or `/me` failed | Switch not shown at all (fail closed to nothing; same rule as the Profile row). |
| NONE | Bottom sheet: title "Haper Business is for shop owners", 3 bullets (wholesale packs, bulk discounts, GST invoice), primary "Apply now" -> existing `RetailerApplyScreen`, secondary "Not now". |
| PENDING | Sheet: "Your application is under review" + "View status" -> `RetailerStatusScreen`. |
| REJECTED | Sheet: "Your application needs changes" + "Fix and resubmit" -> apply form prefilled. |
| SUSPENDED | Sheet: "Haper Business is on hold for your account" + "Contact support". |
| APPROVED, `business.available` false (store has wholesale off) | Sheet: "Haper Business isn't available at this store yet." + "OK". |
| APPROVED, available | Switches mode immediately; 1-time snackbar "You're in Haper Business. Only wholesale items here." |

Switching: 200 ms crossfade of the header gradient (reduced motion: instant); lists show skeletons while reloading; never a blocking dialog.
Fallback: if the server echoes `x-shop-mode: retail` while the app asked Business, the app flips to Haper and shows a snackbar "Haper Business isn't available right now."
Deep links / push / banner taps to an item: open in Haper mode (all such links are retail today).
A11y: switch = `Role.Tab` pair with "selected" state; content descriptions "Haper, normal shop" / "Haper Business, wholesale shop"; 48dp touch height via padding; mode change announced politely.
iOS/web (follow-up): same switch at the top of the home header; same sheet states.

Wholesale quantity UX (needed for tiers):
- Wholesale lines exempt from the 6-per-line cap (stock cap only), on all add paths (card, sheet, item page, cart).
- Item page price block for a tiered item: "Bulk price" table rows "10+ packs  2% off  Rs 1,127 each", each row with a ghost "Add 10" button that sets the cart quantity to that tier.
- Cart line: tap the quantity number opens a small "Set quantity" sheet (numeric keyboard, max = stock). Under the line: applied label "2% OFF bulk" (existing discount label style) and nudge "Add 3 more for 5% off" (InkSecondary 12sp).

---

## 4. Data model changes (all additive; no index, no backfill)

| Collection | Field | Type | Default | Notes |
|---|---|---|---|---|
| `products` | `wholesaleTiers` | `[{ minQty: Int, percent: Number, _id: false }]` | **none** (key only when set) | Validated: 1-5 rows, minQty integer 2..100000 strictly increasing, percent 0 < p <= 50 (2dp) strictly increasing. Only with `wholesaleOnly: true` or `packOf`. |
| `items` | `wholesaleTiers` | same | none | Fan-out copy via `wholesaleFieldsFromProduct`; `$unset` in `fanOutToItems` when the master has none. Reconcile/assign/clone inherit through `projectionFieldsFromProduct`. |
| `orders.items[].appliedDiscounts[]` | `kind` | String | none | `"WHOLESALE_TIER"` on tier entries only; absent on rule entries (old orders unchanged). |
| `orders.items[].appliedDiscounts[]` | `minQty` | Number | none | Tier threshold at sale time. |
| Redis | `CART:<userId>:3` | cart JSON | n/a | Business cart. Internal type constant `BUSINESS_CART_TYPE = 3` (not in `cartType`). |

- `ruleId` stays absent on tier entries (it is a ref to `discount-rules`; a tier is not a rule).
- Mongoose schema declarations without `default` (variant M1 lesson: a default leaks keys into every populate).
- No index: `wholesaleOnly: true` is a residual equality after the existing `{storeId, status, ...}` seek on about 1.5k docs per store (aabha-dba to confirm; same reasoning as retailer plan N2).
- `.lean()` reads: every consumer treats a missing `wholesaleTiers` as "no tiers".

---

## 5. API contract

Customer (user service), all behind `jwtUtils.authenticate`:

| Endpoint | Change |
|---|---|
| Every route under `/user/home`, `/user/item`, `/user/cart`, `/user/coupon`, `/user/retailer` | Request header `x-shop-mode: business` (optional). Response header `x-shop-mode: retail|business` (effective) + `Vary: x-shop-mode`. No header = today's normal-customer behaviour. |
| `GET /user/retailer/me` | + `business: { available: boolean }` (true only for APPROVED + store `wholesaleEnabled`). Always emitted (Gson-safe), `available:false` for everyone else. |
| `GET /user/home/banners` | Business view: `{ banners: [] }` (checked before the per-store cache). |
| `GET /user/coupon/available` | Business view: `{ coupons: [] }`. |
| `GET /user/cart`, `POST /user/cart`, increment/delete, coupon apply/remove | Business view reads/writes the business cart. Same response shape. Per-line tier fields reuse `discountAmount / discountTotal / discountedPrice / discountLabel`; `discount.total/lines/labels` include tiers. `giftOffer` neutral in Business. Client-sent `type` values unchanged (`CART`, `WISHLIST`). |
| Item JSON (audience viewers only) | `wholesale.tiers: [{ minQty, percent, unitPrice }]` when the item has tiers. Absent otherwise. |
| `POST /user/order/place`, scheduled place | Unchanged request/response. Order lines carry tier fields per §4. |
| Errors | Adding a retail item in Business or a wholesale item in Haper: 404 "Item not found or out of stock" (existing). |

Admin service (all `requireRole(SUPER_ADMIN)`, existing product router):

| Endpoint | Change |
|---|---|
| `POST /admin/product`, `PATCH /admin/product/:id` | + `wholesaleTiers` (array, or `[]`/`null` to clear) + `acknowledgeBelowCost?: boolean`. 400 `TIERS_INVALID` (message names the row), 400 `TIERS_NEED_WHOLESALE`, 409 `TIERS_BELOW_COST` with `data.rows: [{ storeId, storeName, minQty, percent, unitPrice, costPrice }]` unless acknowledged. Unticking wholesale-only (`wholesaleOnly:false`) also `$unset`s tiers. Audit row `product.wholesale_tiers.update` (before/after, ack flag). |
| `POST /admin/product/:id/wholesale-tiers/preview` (new) | Body `{ wholesaleTiers }` -> `{ rows: [{ storeId, storeName, sellingPrice, costPrice, tiers: [{ minQty, percent, unitPrice, belowCost }] }] }`. Read-only; drives the live preview table in the form. |
| `GET /admin/product/:id` | returns `wholesaleTiers` when set. |

---

## 6. Step-by-step build order

Lane rule (from the retailer build): hot files have ONE owner and their changes are serialised. Lanes below touch disjoint files; arrows are dependencies. Each step ~10 min of specialist work; each is one reviewable commit with its tests.

Owners: **BE-A** shared view lane, **BE-B** cart lane, **BE-D** order-controller lane (hot), **BE-C** small controllers lane, **BE-T** tier model lane, **BE-P** admin product lane, **ADM** admin engineer, **AND** Android engineer, **DOC** test-guide writer. Reviews: hemant-payments (B8, B7), aabha-dba (B5 note), chanchal-designer (P0).

### Phase 0 — design (chanchal-designer)
- P0. Android mockup: Home switch (both modes), business header, 6-state sheet, tier table on item page, cart line label + nudge + "Set quantity" sheet; admin "Bulk discounts" block + below-cost warning. File: `haper-misc/design-b2b-business-mode-mockup.html` + short spec appended to `haper-misc/design-retailer-wholesale.md` (new §12). Confirms the one new token `BusinessDeep`.

### Phase 1 — backend: Business view (no money)
- B1 (BE-A). `shared/constants/retailer.constant.js` (+ `SHOP_MODE_HEADER = "x-shop-mode"`, `shopView = { RETAIL, BUSINESS }`); `shared/utils/viewer.utils.js` (+ `shopView(req)` memoised on `req._shopView`; `wholesaleAudience(req)` = shopView === BUSINESS; doc comment updated); `shared/utils/item-visibility.utils.js` (`audienceFilter(true)` -> `{ wholesaleOnly: true }`); new `user/src/middleware/shop-mode.js` (vary + echo, never fails a request: error -> RETAIL). Tests: update `user/__tests__/retailer-viewer.test.js`, `user/__tests__/wholesale-visibility.test.js` (matrix: normal / retailer-no-header / retailer-business-header / suspended / store-off x V1-V12).
- B2 (BE-A, after B1). Mount `shopMode` after `authenticate` in `user/src/routes/home/router.js`, `item/router.js`, `cart/router.js`, `coupon/router.js`, `retailer/router.js`. Review `shared/repositories/category.repository.js` `wholesale === true` branches (`cheapestRetailPrice` now always null in Business; keep, add a test that the tile price = cheapest pack). Test: response header echo + Vary on each router.
- B3 (BE-B, after B1). `shared/constants/item.constant.js` (+ `BUSINESS_CART_TYPE = 3`, `ALL_CART_TYPES`); `shared/repositories/cart.repository.js` (`_hiddenFrom` symmetric: Business hides non-wholesale; loops use `ALL_CART_TYPES`; `getCartForItems` reads the business cart when `wholesale`; `getById(..., { byCartType: true })` derives the view from `cart.type`). Tests: new `user/__tests__/business-cart.test.js` (isolation A4, add refusals A2/A3, ghost-line filtering, client cannot send type 3).
- B4 (BE-B, after B3). `user/src/routes/cart/controller.js` (`cartAudience` -> `{ wholesale, codEnabled, cartTypeFor(type) }`; map CART -> business cart in get/getAll/add/applyCoupon/removeCoupon; `giftOffer` neutral in Business; gift subtotal uses wholesale NET). Tests: extend `user/__tests__/wholesale-cart.test.js`, `gift-cart.test.js`.
- B5 (BE-D, after B3). `user/src/routes/order/controller.js`: the 3 `getById(..., { wholesale: true })` -> `{ byCartType: true }` (placeOrder, placeScheduledOrder, supersedeUnpaidOrders). Tests: extend `user/__tests__/retailer-checkout.test.js` (A5; legacy mixed CART only charges visible retail lines; business cart refused for a suspended retailer).
- B6 (BE-C, after B1). `user/src/routes/home/controller.js` (`getBanners` empty in Business, before cache), `user/src/routes/coupon/controller.js` (available list empty in Business), `user/src/routes/retailer/controller.js` (`toMeDto` + `business.available`). Tests: `retailer-application.test.js` (me shape), new small banner/coupon Business tests.

### Phase 2 — backend: bulk tiers
- B7 (BE-T). Model + pure util: `shared/models/products.schema.js`, `shared/models/items.schema.js` (+ `wholesaleTiers` sub-schema, no default), `shared/models/orders.schema.js` (`appliedDiscounts` + `kind`, `minQty`), new `shared/utils/wholesale-tier.utils.js` (`validateTiers`, `resolveTier`, `nextTier`, `applyTiersToOrderLines`, `TIER_LIMITS`) + export in `shared/utils/index.js`, `shared/repositories/product.repository.js` (`wholesaleFieldsFromProduct` + `$unset` in `fanOutToItems`). Tests: new `shared`-level unit test in `user/__tests__/wholesale-tier-utils.test.js` (boundaries, rounding, floor, malformed), `admin/__tests__/variant-product-sync.test.js`-style fan-out test. aabha-dba: confirm no index.
- B8 (BE-P, after B7). `admin/src/routes/product/validator.js` (`wholesaleTiers`, `acknowledgeBelowCost`), `admin/src/routes/product/controller.js` (`MASTER_INPUT`, `splitSparseInput` empty -> `$unset`; tiers need wholesale; unticking wholesale `$unset`s tiers; below-cost scan over the iId's store items with `costPrice > 0`, 409 unless acknowledged; audit), `admin/src/routes/product/router.js` (preview route). Tests: new `admin/__tests__/product-wholesale-tiers.test.js` (validation table, coupling, fan-out, below-cost 409 + ack, pack master allowed, non-super-admin 403).
- B9 (BE-B, after B4 + B7). `shared/utils/variant-present.utils.js` (raw field strip + `tiers` in the wholesale block); `user/src/routes/cart/controller.js` (tier preview in both branches, merge into `discount`, netTotal, Gson-safe per-line fields). Tests: extend `wholesale-cart.test.js` (T5, coupon-active cart still shows tier, per-line fields always present), presenter test (raw key never in JSON). Review: hemant-payments.
- B10 (BE-D, after B5 + B7). `user/src/routes/order/controller.js`: `tierSource` on wholesale lines in `prepareOrderItemsAndInventory`; `applyTiersToOrderLines` + `discountTotal += tierTotal` in BOTH placeOrder and placeScheduledOrder. Tests: new `user/__tests__/wholesale-tier-checkout.test.js` (T6 parity cart vs order for both paths, `tierSource` never persisted, `costPrice` unchanged, invoice line amount = paid, order-edit carry-forward keeps the tier, refund amount = paid). Review: hemant-payments.

### Phase 3 — admin (after B8 on dev)
- A1 (ADM). `haper-admin/src/types/product.ts` (+ `wholesaleTiers?`), `src/api/products.ts` (+ preview call), `src/pages/Products/productForm.ts` (`tierErrors` mirror of server rules, `buildProductBody` sends tiers, clears on untick). Tests: `productForm.test.ts`.
- A2 (ADM, after A1). New `src/pages/Products/WholesaleTiersField.tsx` (rows, add/remove, inline errors, live preview table from the preview API, below-cost list + "I understand" tick); `ProductModal.tsx` wiring (show when wholesale-only or pack; untick confirm via existing `ConfirmDialog`; 409 `TIERS_BELOW_COST` handling). Tests: `ProductModal.test.tsx`. Verify `tsc -b` + eslint (no NEW problems vs the 113 baseline) + vitest (still exactly the 5 known failures).

### Phase 4 — Android (after Phase 1 + B9 on dev)
- N1 (AND). `util/AppEnvironment.kt` (+ `shopMode`, persisted per user), `data/api/NetworkModule.kt` (send `x-shop-mode` when Business; read the response echo; on mismatch post a mode-fallback event), `data/model/RetailerModels.kt` (+ `business: RetailerBusinessDto?` nullable), logout reset hook. Unit tests for persistence + echo handling.
- N2 (AND, after N1 + P0). New `ui/screens/home/HaperBusinessSwitch.kt` (segmented switch + state sheet), `ui/screens/home/HomeScreen.kt` (place switch in `HomeHeroCard`, business gradient/eyebrow/placeholder, hide banners/print/offers in Business), `ui/theme/Color.kt` (+ `BusinessDeep`). Render tests like the existing on-device render tests.
- N3 (AND, after N2). `ui/screens/home/HomeViewModel.kt`, `ui/screens/cart/CartViewModel.kt` (reload on mode change, clear in-memory cart, "Business cart" title), navigation for deep links forcing Haper.
- N4 (AND, after B9). `util/CartQuantityCap.kt` + `CartViewModel.kt` + `ui/variants/VariantPresentation.kt` + `ui/components/VariantCardParts.kt` (wholesale exempt from the 6 cap), `data/model/HomeModels.kt` (`WholesaleBlock.tiers` nullable list), `ui/screens/itemdetail/ItemDetailScreen.kt` (Bulk price table + "Add N"), `ui/screens/cart/CartScreen.kt` (Set-quantity sheet, nudge). Verify `./gradlew assembleDebug` + unit tests for the nudge maths.

### Phase 5 — docs (same session as each phase)
- DOC. New `haper-misc/test-b2b-business-mode.md` (A1-A8, H1-H4, T1-T9 as ✅/❌ steps); update `test-retailer-wholesale-android-shop.md`, `-cart.md`, `-checkout.md`, `-discounts.md`, `-admin.md` (retailer no longer sees packs in normal mode; tiers are the one wholesale discount); `client-followups.md` (iOS + web rows: shop-mode header + switch, tier table, cap exemption, set-quantity).

---

## 7. Edge cases, risks, backward compatibility

### 7.1 Do-not-break list
| Existing behaviour | How it stays unchanged |
|---|---|
| Normal customer browse/cart/checkout | No header -> retail view, which is exactly today's non-retailer path (`audienceFilter(false)` untouched). Snapshot test on home/item/cart JSON. |
| Old app builds (any platform) | Never send the header -> normal Haper. New response header and `business` key are ignored / nullable. |
| Wholesale invisible to non-retailers | Still requires literal `wholesale === true`, which now only a verified Business view produces. Spoofed header does nothing (test). |
| Coupons, auto-discounts, free gift, referral exclusions for wholesale | Untouched; tiers run after them and only on wholesale lines. Referral base (`retail-portion.utils`) uses `salePrice`, so wholesale lines are still excluded as before. |
| Order money fields, invoices, refunds, profit | `salePrice` keeps meaning "paid"; `costPrice` snapshot untouched; order-edit carries `appliedDiscounts` entries whole (new keys ride inside). |
| Retailer COD switch, `paymentOptions`, retailer snapshot, B2B invoice | Untouched (checkout still reads the fresh profile). |
| Cart validators | `cartType` enum unchanged; business cart type is internal. |
| POS, picker, delivery, admin order edit | No viewer/mode involvement. Admin order-edit "add line" stays at live price, no tier (documented, same as sale discounts Phase 1). |
| Category tile maths | Business view counts only wholesale (positive filter in the outer `$match`); stock stays inside accumulators as today. |
| Atlas `item_search` index | Unchanged; audience is the post-`$search` `$match`. |

### 7.2 Risks and failure modes
- R1 Behaviour change for retailers on builds without the switch (iOS/web dev builds, Android build already on `main`): they now see retail only. Acceptable because no wholesale is live on prod; ship backend + Android switch together (Q5).
- R2 Existing automated tests asserting "retailer sees packs in normal lists" flip — expected; update them in B1, do not weaken them (the matrix test is the real gate).
- R3 Legacy mixed carts on dev (made before this change): checkout now charges only the lines the cart shows (D7). Hidden lines are cleared with the cart after the order. Note in the test guide: testers clear old carts.
- R4 `supersedeUnpaidOrders` now runs per cart, but still cancels ANY unpaid online order of the user in that store (existing rule). A retailer who leaves a Haper online payment unfinished and then checks out Business will have the unpaid one released (stock back, it checks Razorpay first). Existing behaviour, flag only.
- R5 Tier below cost after a later cost rise (new goods receipt): sells below cost silently (Q3 default). Mitigation: preview endpoint is reusable for a later "tiers below cost" report.
- R6 Order edit lowering quantity below the tier keeps the tier price per unit (snapshot carried, customer-favourable). Raising quantity of an existing tier line keeps the stored per-unit price. Documented; change only if the user asks.
- R7 Cache: Business responses must not be served to Haper requests by any shared cache: `Vary: x-shop-mode` + existing no-store on banners; banners short-circuit BEFORE the per-store Redis banner cache.
- R8 Mode resolution adds no DB/Redis cost for normal customers (header absent -> no lookup); for retailers it is the existing memoised viewer lookup.
- R9 Two devices in different modes share carts per user: fine (each mode has its own cart; both devices see the same carts).
- R10 Security: client cannot select the business cart directly; cannot create tiers (super admin only); cannot influence tier money (server recomputes from the item doc; cart preview is advisory).
- R11 Old builds' JSON for retailers in Haper mode loses `paymentOptions`? No: `paymentOptions` is emitted only for the audience, i.e. now only in Business; in Haper mode the retailer gets the normal-customer shape, which old clients already handle.

### 7.3 Rollback
- Level 1 (no deploy): apps stop sending the header (Android remote flag not needed: switch hidden when `programEnabled` false; store `wholesaleEnabled` off hides Business for everyone within ~5 s).
- Level 2 (code revert, backend): safe. Sparse keys are ignored by old code (raw `wholesaleTiers` would appear in retailer item JSON — harmless). Business carts in Redis become orphaned and expire in 12 h. Orders keep their tier prices (already paid). Revert admin before backend if tiers UI is live (else saves send an unknown key -> Joi 400).
- Hard to reverse: none (no migration, no index, no destructive write).

### 7.4 Deploy order (dev)
1. Backend (B1-B10) to dev. 2. Admin (A1-A2). 3. Android (N1-N4). 4. Test guides. iOS/web later via `client-followups.md`. Prod stays user-driven and should ship this together with the first retailer backend release (wholesale is not on prod yet).

---

## 8. Test strategy

Backend (Jest, in-memory Mongo only: `cd packages/<pkg> && NODE_ENV=test npx jest`)
- Unit: `wholesale-tier.utils` (exact threshold, between tiers, highest wins, rounding of odd prices e.g. Rs 999 at 2.5%, floor, malformed tiers, non-wholesale/free-gift untouched, `tierSource` deleted), `audienceFilter` both values, `shopView` truth table, `_hiddenFrom` symmetry.
- Integration: visibility matrix (5 viewer states x V1-V12 paths); business cart isolation and type mapping; checkout single-world read (both paths); cart-vs-checkout tier parity (both paths, with and without a coupon on a retail cart); order line fields + `discountTotal`; order-edit carry-forward; invoice amounts; admin tiers validation/coupling/below-cost/fan-out/`$unset`; `/me` shape; banners/coupons empty in Business; JSON snapshot for normal customer unchanged.
- Grep-gate: extend the existing customer-predicate gate so a new inline `wholesaleOnly` literal outside `item-visibility.utils.js` fails.

Admin (Vitest): `productForm.test.ts` (tier rule table mirrors server), `ProductModal.test.tsx` (block shows only for wholesale, untick confirm, 409 below-cost flow). Baseline: still exactly the 5 known failures; eslint no new problems.

Android: unit tests (mode persistence/reset, echo mismatch flip, nudge maths, cap exemption); render tests for the switch states; `./gradlew assembleDebug`.

Manual/E2E: `haper-misc/test-b2b-business-mode.md` on dev with one wholesale-enabled store, one approved test retailer ("Sample Kirana"), one normal account.

---

## 9. Open questions (recommended default in bold)

All 7 answered: defaults accepted. User also confirmed: two separate carts (normal + business), switch between normal app mode and Haper Business mode.

1. Q1 Mode or hard filter? **Mode switch**: a retailer can use normal Haper for home shopping and Haper Business for the shop; each has its own cart. (Alternative: retailers only ever see wholesale; only the resolver changes.)

   -> DECIDED: default accepted (2026-11-01).
2. Q2 How is the tier quantity counted? **Per cart line, in the item's own selling unit** (for "Pack of 100", the tier "10+" means 10 packs = 1,000 pieces; admin shows the piece count as a hint). Not pooled across different products or sizes.

   -> DECIDED: default accepted (2026-11-01).
3. Q3 Tier price below cost? **Allow it, warn at save with "I understand"** (like coupons). Alternative: cap at cost like sale discounts (then the tier silently disappears for that store).

   -> DECIDED: default accepted (2026-11-01).
4. Q4 Who sees the "Haper Business" switch? **Everyone at a store where the retailer program is on**; non-retailers get the "Apply now" sheet (doubles as acquisition). Alternative: approved retailers only.

   -> DECIDED: default accepted (2026-11-01).
5. Q5 App builds without the switch (current Android release, iOS/web): **they show normal Haper only** (retailers must update to shop wholesale). Alternative: keep today's mixed view for requests without the header (keeps a third state alive).

   -> DECIDED: default accepted (2026-11-01).
6. Q6 Max tier discount: **50%** as a typo guard (e.g. "25" typed for "2.5"). Tell us if you need more.

   -> DECIDED: default accepted (2026-11-01).
7. Q7 Minimum order for Haper Business (e.g. Rs 2,000 or N packs)? **Not in this scope**; easy follow-up on the same store config.

   -> DECIDED: default accepted (2026-11-01).

---

## 10. Specialist routing (for rahul)

| Part | Specialist |
|---|---|
| P0 Home switch, business header, tier table, admin tiers block | chanchal-designer |
| B1-B6 Business view + carts (shared utils, cart repo/controller, small controllers) | backend platform engineer(s), lanes BE-A / BE-B / BE-C |
| B5, B10 order controller (hot file, one owner) | backend platform engineer, lane BE-D; hemant-payments reviews B10 |
| B7 tier model + util | backend platform engineer (BE-T); aabha-dba light review (no index, sparse keys) |
| B8 admin tiers API | backend platform engineer (BE-P) |
| B9 cart tier preview + presenter | BE-B; hemant-payments reviews |
| A1-A2 admin form | admin (web) platform engineer |
| N1-N4 Android | Android platform engineer |
| DOC test guides + client follow-ups | whoever lands each phase (same session) |
| Not needed | stas-realtime, deepanshu-data, rohit-ai |
