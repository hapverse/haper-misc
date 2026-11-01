# Test: Retailer (wholesale) program — cart and wishlist visibility

**Plan:** `haper-backend/docs/plans/retailer-wholesale.md` (rev 2, Phase 1B step 11-12: §3.3 V11/V12, §3.6 `paymentOptions`, §3.9 cart limits and promotions).
**Backend:** `packages/shared/repositories/cart.repository.js`, `packages/user/src/routes/cart/controller.js`,
browse-attached cart in `packages/user/src/routes/{home,item}/controller.js`.
**Automated:** `packages/user/__tests__/wholesale-cart.test.js`, grep gate `packages/user/__tests__/customer-item-predicate-gate.test.js`.
**Branch:** `dev` (direct-to-dev workflow). Related guide: `test-retailer-wholesale.md` (application + verification).

## What this is (a real example)

Ravi runs "Sharma Kirana" (fictional) and is an **approved retailer**. His store has wholesale turned ON. He adds
"Premium Sugar 500g - Pack of 20" (a wholesale pack: one cart line = 20 packets) and 2 single packets to his cart.

- Ravi sees both lines. The pack line carries `itemId.wholesale = { units: 20, perUnitPrice: 26, baseLabel: "500 g" }`.
- Ops **suspends** Ravi. Within at most 60 s (viewer cache) his cart, wishlist and the cart attached to browse
  screens show only the 2 single packets. The pack line is hidden, not deleted: if he is reinstated within the
  cart's 12 h lifetime it comes back.
- Priya, a normal customer, can never add the pack, even with its id from an old screen. She gets exactly the
  answer for an item that does not exist, so she cannot tell that a wholesale item is there.

"Audience" below = store `config.wholesaleEnabled` is ON **and** the customer is an APPROVED retailer.
Everyone else (normal, PENDING, REJECTED, SUSPENDED, or the flag OFF) is "non-audience".

## Deploy needed

Backend only (user service). No migration. Nothing changes while every store has `wholesaleEnabled` OFF
(today: all stores), because no customer is in the audience and no item has `wholesaleOnly` yet (packs come in Phase 1C).

## Steps

### Non-audience customer (normal / PENDING / REJECTED / SUSPENDED, or store flag OFF)
1. ✅ `POST /user/cart/CART {itemId:<pack id>, quantity:1}` → `404 "Item not found or out of stock"` (see the 2026-11-01 update below), the same
   body as for a random id. ❌ Must not mention the pack name or its stock.
2. ✅ Same for the +/- delta add on a pack line the customer already holds (`quantity: 1` or `-1`).
3. ✅ `GET /user/cart/?type=CART&page=1` → no pack id anywhere; totals count retail lines only; **no** `paymentOptions` key.
4. ✅ `GET /user/cart/?type=WISHLIST&page=1` → same rule. A wishlist holding only packs answers `Cart empty`.
5. ✅ `GET /user/item/?page=1`, `GET /user/home/items?page=1`, search → `data.cart.items` has no pack line.
6. ✅ Writes answer without the pack too: `POST /user/cart/CART` (adding a retail item) and
   `DELETE /user/cart/<retail item id>` return `data.cart` with no pack id, while the stored cart still holds it.
   Example: Ravi (suspended) holds the pack + 1 sugar packet, adds 1 salt → response lists sugar + salt only.
7. ✅ JSON for a normal customer is byte-identical to before (golden fixtures `cart.json`, `item-list-with-cart.json`).

### Audience retailer
8. ✅ Adding a pack works; `GET /user/cart` shows it with the `wholesale` block. ❌ No raw `wholesaleOnly` / `packOf` keys.
9. ✅ `paymentOptions` is present: `{ cod, online: true, credit: null }`.
   - COD switch OFF + cart has a pack → `cod: false` (app hides COD, shows "Pay online").
   - COD switch OFF + retail-only cart → `cod: true`.
   - COD switch ON → `cod: true`.
   - Also returned by `POST /user/cart/coupon/apply` and `DELETE /user/cart/coupon` (same cart payload).
10. ✅ Cart-limit rules (e.g. "max 2 of sugar") never block a pack, and a pack line does not count towards a retail
   item's cap. Retail items keep their caps, even for retailers.
10a. ✅ Coupons count retail lines only. Example: 10 sugar packets (₹280) + 2 packs (₹1,040), coupon "10% off":
   - `POST /user/cart/coupon/apply` → `discountTotal: 28` (10% of ₹280, not of ₹1,320); `cart.coupon.lines` lists the
     sugar packet only. ❌ The pack line must never get a coupon share.
   - Coupon with "min order ₹499" → `400 BELOW_MIN_ORDER` "Add ₹219.00 more to use …", the same number the Offers screen shows.
   - `GET /user/cart` with that code already applied → same ₹28.
   - `cartItems.totalPrice` still includes the packs (₹1,320); only the discount ignores them.
10b. ✅ Packs-only cart: a no-minimum coupon → `400 NO_HEADROOM` "We couldn't apply this coupon right now — try another one?";
   a min-order coupon → the usual "Add ₹499.00 more…". ❌ No message may mention wholesale. A code already on the cart
   prices to ₹0 and the cart still loads.
10c. ✅ Automatic discounts (store `discountsEnabled` ON, "10% off everything") → only retail lines are discounted;
   the pack line shows `discountAmount: 0`, `discountedPrice: null`.
10d. ✅ Free-gift preview judges the tier on the retail lines. Example: gift tier at ₹1,000, cart ₹280 retail + ₹1,040 packs
   → no gift yet, "Add ₹720 more to unlock…". Free delivery and the platform fee still use the whole cart.

### Suspend / reinstate
11. ✅ Suspend an approved retailer with a pack in the cart → after ≤ 60 s the pack is gone from cart/wishlist/browse,
    retail lines stay, totals drop to the retail lines.
12. ✅ Reinstate → the pack line is back (if the cart has not expired).
13. ✅ Turn the store flag OFF → the same retailer loses the pack line from view at once (≤ 5 s flag cache).
14. ✅ Suspended retailer whose only visible line goes out of stock: `GET /user/cart` answers `Cart empty`, but the
    pack is NOT deleted. ❌ Reinstating must bring the pack back (before this fix the whole cart was wiped here).
15. ✅ A normal customer whose cart lines all go out of stock: `GET /user/cart` → `Cart empty` and the Redis key is gone.
16. ✅ Same when some lines point to items that were deleted from the catalogue and the rest went out of stock: the
    whole cart (and any applied coupon code) is removed. ❌ But if a hidden pack line is also there, the cart stays (step 14).

## Edge cases / known follow-ups
- Checkout, checkout cart limits and the checkout coupon now follow the same retail-only rules as the cart; see `test-retailer-wholesale-checkout.md` and `test-retailer-wholesale-discounts.md`.
- `CartRepository.increment` (not mounted on any route today) refuses a hidden pack line with
  "Item not found in cart" and leaves it stored; it no longer drops it.
- The coupon offers screen (`/user/coupon`) and the cart now use the same retail-only basis.
- A cart made only of lines for deleted items (nothing visible at all) is not swept on `GET /user/cart`; it just
  answers `Cart empty` until it expires (unchanged from before).
- The hidden pack line stays in Redis until the cart is emptied, placed, or expires (12 h).

## Business mode update (2026-11-01)

Plain example: Ravi (fictional "Sharma Kirana") is an approved retailer. Packs no longer sit in his normal shop. They live in **Haper Business**, a separate shop with its own cart. The full walkthrough is `test-b2b-business-mode.md`.

**What changes in the steps above**
- Steps 1-2: the refusal is **404**, not 400. The code returns 404 (`CartRepository.add`). The 400 wording in those steps was wrong.
- Steps 8-10d and 11-16 describe the **Business view**. The app asks for it with the header `x-shop-mode: business` (sent when the Haper Business switch is on). Without the header, a retailer gets the normal-customer answers in steps 1-7.
- Every cart response carries `x-shop-mode: business` or `x-shop-mode: retail`. That is what the server actually served.
- `type=CART` means the **Haper cart** in the Haper view and the **Business cart** in the Business view. Packs are only in the Business cart. A pack added before this change stays in the old cart, hidden in the Haper view (step 14 still covers that).
- `paymentOptions` (step 9) is returned in the Business view only. In the Haper view it is absent, like for any customer.
- The gift offer (step 10d) is always empty in the Business view.
- Coupons and automatic discounts (10a-10c) are unchanged: a wholesale line never takes them. The bulk tier is the only discount a pack line can take (see `test-retailer-wholesale-discounts.md`).

**New checks**
- ✅ Haper view, retailer: `POST /user/cart/CART {itemId:<pack id>}` → 404, cart unchanged.
- ✅ Business view (`x-shop-mode: business`): the same add → added. `GET /user/cart/?type=CART&page=1` with the header shows the pack. The same GET without the header does not.
- ✅ Suspend the retailer while a pack is in the Business cart: within about 60 s the header answers `retail`. The Business cart is no longer shown. The Haper cart is unchanged.
- ✅ Normal customer sending the header: `x-shop-mode: retail`, cart exactly as step 3.
- ❌ `POST /user/cart/3` (client trying to name the Business cart by number) → refused by the validator (403). No cart is created.
