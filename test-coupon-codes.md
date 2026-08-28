# Test guide — Coupon Codes

Feature plan: `coupon-codes-plan.md`. Admin UI design: `coupon-admin-ui-design.md`.
Backend: `haper-backend` (`packages/shared/utils/coupon.utils.js` engine, `packages/admin/src/routes/coupon/*` CRUD, wired into cart apply/remove and both checkout paths).
Admin panel: `haper-admin` (`src/pages/Coupons/*` CRUD, `POS/NewSalePage.tsx` coupon entry).

Needs: backend deploy (dev) + admin deploy. No migration. Android checkout coupon entry (§2A2), iOS checkout coupon entry (§2A3), and web checkout coupon entry (§2A4) are now built. The checkout coupon-failure title + coupon summary row are built on Android (§2 D4/D5), iOS (§2 D8/D9), and were already correct on web (§2 D6/D7). The **order detail** screen names the coupon on web (§3 G), admin
(§3 H) and Android (§3 I) — as an informational "you saved ₹X" line, never a `-₹` subtraction (the
item total is already net). **Android (§3 J), iOS (§3 K), web (§12) and admin (§13) have since gone further:** they rebuild the GROSS item prices
from each line's preserved `originalSalePrice`, so their Order Details now shows the same per-item prices as
the cart plus a real `-₹X` coupon row. The informational line survives only as the fallback for
automatic-discount orders and legacy coupon orders whose lines never stored `originalSalePrice`.
All new cart/order fields are additive and default to null/empty.

---

## 0. Understanding coupon behavior vs automatic discounts

**What you need to know before testing:**

- A coupon **replaces** an automatic discount — never both apply to the same order.
- The coupon applies at **cart level** (e.g. ₹50 off the whole order, or 10% of the subtotal), but
  the discount is **allocated back onto individual order lines** so invoices, GST, refunds, and profit/COGS work correctly. See the plan §3.3 for the allocation algorithm.
- A coupon with `per-customer-limit` or `first-order-only` cannot be used by the anonymous "Walk-in Customer" on POS — the cashier must capture a phone number first.
- Once a coupon code is created, it **cannot be renamed** (codes are handed to customers; renaming breaks shared codes).
- **A percentage coupon must always have a "Max discount" cap** (rule added 2026-08-26). A flat ₹ coupon does not — its own value is already the most it can ever give.

---

## 1. Admin — turn a coupon on (or create one)

`/admin/coupon` (super-admin only, `coupons.manage` permission).

### ✅ A. Create a coupon with a typed code
1. Log in as super-admin (e.g. `super@haper.in`) on `damin.haper.in` → navigate to **Admin → Coupons**.
2. Click **Create coupon**.
3. **Code field:** type `WELCOME50` (must be 4–20 alphanumeric chars, uppercase, no spaces; underscores and hyphens allowed).
4. **Description:** e.g., "Welcome new customer".
5. **Scope:** select **Global** (applies to all stores).
6. **Discount type:** select **FLAT**, value **₹50**.
7. **Min order value:** `₹200` (order subtotal must be ≥ ₹200 before the coupon is valid).
8. **Max discount amount:** leave **No cap** checked (a FLAT ₹ coupon may be uncapped — ₹50 off is ₹50 off, whatever the cart is worth).
9. **Schedule:** start now, end tomorrow.
10. **Limits:** total 100 redemptions, per-customer 1, **not** first-order-only.
11. **Enabled:** on.
12. Click **Save**.
13. **Expect:** coupon appears in the list as `WELCOME50` (code, discount value, window, enabled state all visible).

### ✅ B. Create a coupon with auto-generated code
1. On the **Create coupon** form, instead of typing a code, click the **Auto-generate** button.
2. **Expect:** the code field fills with an 8-character uppercase alphanumeric string (e.g. `AB3XY7Z2`, no I/O/0/1 lookalikes).
3. Fill in the other fields as before and save.
4. **Expect:** the coupon saves and the auto-generated code is now live (immutable).

### ❌ C. Duplicate code is rejected
1. Create a coupon with code `PROMO25`.
2. Immediately try to create **another** coupon with the same code `PROMO25` (or `promo25` lowercase — codes are case-insensitive).
3. **Expect:** the form shows an error "A coupon with this code already exists" (or similar), and the save is **rejected**; **no duplicate is created**.

### ✅ D. Code field is read-only when editing
1. Create and save a coupon with code `SALE10`.
2. Click **Edit** on that coupon.
3. **Expect:** the code field is **read-only** (grayed out or disabled), showing `SALE10`. You cannot change it to anything else.
4. Change the discount value (e.g. from ₹10 to ₹15) and save.
5. **Expect:** the discount updates, but the code stays `SALE10`.

### ❌ D2. A percentage coupon cannot be saved without a max-discount cap (2026-08-26)

**Why:** "50% off" with no cap on a ₹5,000 cart is ₹2,500 given away on one order. Since the
margin guard was removed (§6), the cap is the only thing bounding the loss per redemption.
Flat ₹ coupons are untouched — ₹50 off can never cost more than ₹50.

1. **Create coupon** → discount type **Percent**, value `50`.
2. **Expect:** there is **no "No cap" checkbox** at all for Percent. The **Max discount (required)**
   field is always shown.
3. Leave Max discount empty and click **Save coupon**.
4. **Expect:** blocked with "A percentage coupon must have a maximum discount — enter an amount above ₹0."
   Nothing is created.
5. Enter `150` and save → **Expect:** saves; the coupon gives 50% off **up to ₹150** (on a ₹5,000
   order the customer gets ₹150 off, not ₹2,500).
6. Switch the type to **Flat ₹** → **Expect:** the **No cap** checkbox is back and a flat coupon
   still saves with no cap.
7. **Edit** a live percentage coupon and try to clear its cap → **Expect:** rejected (403, message
   naming the cap). Same rule applies on edit, not just create.
8. **Existing coupons:** a percentage coupon created **before** this rule keeps working exactly as
   before, and can still be edited (description, schedule, limits) and toggled off. Only when you
   change its **discount** does it demand a cap. ❌ Flag it if an old uncapped percentage coupon
   stops applying at checkout — that is not intended.

### ✅ E. Admin can toggle a coupon on/off instantly
1. Create and save a coupon `INSTANT10`.
2. In the coupon list, find the row for `INSTANT10` and toggle the **Enabled** switch **off**.
3. **Expect:** toggle completes immediately (no page reload), and the enabled state shows **off** in the list.
4. Try to apply `INSTANT10` on a checkout (see §2) → **Expect:** error "This coupon code isn't valid" (not revealing that it's disabled, just that it can't be used).
5. Toggle it **on** again.
6. **Expect:** coupon becomes usable immediately on checkout (no deploy needed).

### ✅ F. Scope is honored — store-specific coupon
1. You have stores A and B (different `storeId`s). Create a coupon `STORE_A_ONLY` with:
   - Scope: **Store** (not Global)
   - Store IDs: select only **Store A**
   - Discount: ₹20 off
2. Save.
3. Try to apply this coupon on a checkout **in Store B** → **Expect:** error "This coupon code isn't valid" (the coupon exists but doesn't match this store).
4. Apply the **same code** on a checkout in **Store A** → **Expect:** succeeds, ₹20 off applied.

### ✅ G. Coupon list shows usage stats
1. From the coupon list page, look at the `WELCOME50` row created in step A.
2. **Expect:** the row displays:
   - Code: `WELCOME50`
   - Discount: `₹50 OFF`
   - Window: date range (e.g., "Aug 24 – Aug 25")
   - Usage: `3 / 100` (3 redemptions out of 100 total limit)
   - Enabled: yes/no toggle

### ✅ H. Click coupon detail to see stats
1. Click on a coupon code (e.g. `WELCOME50`) to open its detail page.
2. **Expect:** a detail card showing:
   - Code, description, scope, discount type/value, min order value, schedule (start/end), limits (total/per-customer/first-order)
   - **Stats:** `usedCount`, `uniqueCustomers` (how many distinct users have redeemed it), `totalDiscountGiven` (sum of all discount amounts given by this coupon)

---

## 2. Customer checkout — apply a coupon

**Note:** This section covers the cart apply/remove and checkout validation flow across all platforms and the raw backend API.

### ✅ A2. Android — normal-flow coupon entry (built 2026-08-25)

Files: `app/src/main/java/com/bheldi/ui/screens/cart/{CartScreen,CartViewModel}.kt`,
`app/src/main/java/com/bheldi/data/model/HomeModels.kt` (`CartCoupon`, `ApplyCouponResponse`,
`RemoveCouponResponse`), `app/src/main/java/com/bheldi/data/api/ApiService.kt`
(`applyCoupon`/`removeCoupon`). Scope was normal-flow only (not exhaustive edge cases —
see §2C/D/E for reason-code coverage, which the Android UI displays verbatim via the API's
`message` string but wasn't individually tested against each reason).

1. On the Android app (debug build), open **Cart** with items totalling ≥ a coupon's min order value.
2. **Expect:** a **Coupon** card sits directly above **Bill Details**, with a text input
   ("Enter coupon code") + **Apply** button. No coupon UI existed before this build — if the cart
   has never had a coupon applied, this card must be the ONLY new thing visible; everything else
   renders exactly as before.
3. Type `welcome50` (lowercase) into the field.
4. **Expect:** the input **auto-uppercases as you type** — the field shows `WELCOME50`, not `welcome50` (client-side, immediate, matches the admin panel's convention).
5. Tap **Apply**.
6. **Expect:** a brief spinner on the Apply button, then:
   - The card switches to the applied state: code chip (`WELCOME50`) + "You saved ₹50" + a **Remove** button.
   - **Bill Details** now shows a **"Coupon discount"** row (`-₹50`) instead of any "Discount" row — never both.
   - **"To Pay"** and the bottom **Checkout** button total both drop by ₹50.
7. Tap **Checkout** → complete the order (COD is simplest).
8. **Expect:** order places successfully; the payable amount charged matches the coupon-adjusted total from step 6. (Order-detail screen does not yet render the coupon block — `Order.coupon` is modeled but not wired into any screen this pass; that's a follow-up, not a bug.)
9. Go back to **Cart** with a fresh cart, apply `WELCOME50` again, then tap **Remove**.
10. **Expect:** the card reverts to the input state, **Bill Details** shows the automatic "Discount" row again (if one applies at this subtotal) or no discount row (if none), and the total reverts correctly.
11. **❌ Invalid code:** type `DOESNOTEXIST`, tap Apply.
12. **Expect:** an inline error appears under the input (the API's `message` shown as-is, e.g. "This coupon code isn't valid") — no crash, no toast, cart total unchanged. Clearing/retyping the field clears the error.
13. **Stale coupon (valid: false):** apply a coupon, then remove enough items to drop below its min order value, pull-to-refresh the cart.
14. **Expect:** the applied-coupon chip **stays visible** (code + Remove button) with an added inline warning line showing `coupon.message` (amber, with an info icon) — the coupon is NOT auto-cleared; the customer must tap Remove themselves. Total is priced without the coupon in the meantime.

**Not covered this pass (normal-flow scope only, per explicit instruction):** exhaustive walk of every `reason` code (NOT_STARTED, WRONG_STORE, TOO_MANY_ATTEMPTS, etc.) on Android specifically — the UI path is identical for all of them (shows `message` inline), so only NOT_FOUND was walked as a representative case. `./gradlew assembleDebug` passes with no new warnings.

### ✅ A3. iOS — coupon entry (built 2026-08-25)

Files: `haper/Views/CartView.swift` (`CouponCard`), `haper/ViewModels/CartManager.swift`
(`coupon`, `couponInput`, `couponError`, `couponWorseThanAutoAdvisory`, `applyCoupon()`,
`removeCoupon()`, `applyCartResponse()`), `haper/Models/HomeModels.swift` (`CartCoupon`,
`ApplyCouponData`, `RemoveCouponData`).

1. On the iOS app (debug build/simulator), open **Cart** with items totalling ≥ a coupon's min
   order value.
2. **Expect:** a **Coupon** card sits directly above **Bill Details**, with a text field ("Enter
   coupon code") + **Apply** button. If the cart has never had a coupon applied, this card must be
   the only new thing visible.
3. Type `welcome50` (lowercase) into the field.
4. **Expect:** the field **auto-uppercases as you type** — shows `WELCOME50`.
5. Tap **Apply**.
6. **Expect:** a brief spinner on the Apply button, then:
   - The card switches to the applied state: code (`WELCOME50`) + "You saved ₹50" + a **Remove**
     button.
   - **Bill Details** shows a **"Coupon discount"** row (`-₹50`) instead of any "Discount" row —
     never both.
   - The total drops by ₹50.
7. Complete checkout (COD is simplest).
8. **Expect:** order places successfully; the charged amount matches the coupon-adjusted total.
9. On a fresh cart, apply `WELCOME50` again, then tap **Remove**.
10. **Expect:** the card reverts to the input state, **Bill Details** shows the automatic
    "Discount" row again (if one applies) or none, and the total reverts correctly.
11. **❌ Invalid code:** type `DOESNOTEXIST`, tap Apply.
12. **Expect:** an inline error appears under the input (the API's `message`, e.g. "This coupon
    code isn't valid") — no crash, no alert, cart total unchanged. Editing the field clears the
    error.
13. **Stale/zero-discount coupon:** apply a coupon, then remove enough items to drop below its min
    order value, pull-to-refresh the cart.
14. **Expect:** the applied-coupon card **stays visible** (code + Remove button) with an added
    inline warning line showing `coupon.message` (amber, with an info icon) — not auto-cleared;
    tap Remove to clear it. Total is priced without the coupon meanwhile.
15. **Worse-than-automatic-discount advisory:** apply a coupon on a cart where an automatic
    discount was already active and is worth more than the coupon (`replacedAutoDiscount == true`
    and `couponBetter == false` on the apply response).
16. **Expect:** a one-shot grey advisory line appears under the applied card: "Your existing offer
    of ₹X was better — remove this coupon to get it back". Now edit an item quantity (e.g. tap +)
    so the cart refreshes.
17. **Expect:** the advisory **disappears** on the refreshed cart — it must never persist across a
    cart edit with a stale ₹ figure; it only ever reflects the most recent Apply action.
18. **❌ Remove-coupon failure (e.g. airplane mode or a transient 5xx):** with a coupon applied, go
    offline, tap **Remove**.
19. **Expect:** an inline error appears **in the applied-coupon card** (same red text style as the
    apply-error case) — NOT the shared "Unable to add more" cart alert sheet. The coupon stays
    applied since the remove didn't succeed.

**Not covered this pass (normal-flow scope only, matching Android's §2A2 scope):** exhaustive walk
of every `reason` code — identical UI path for all (shows `message` inline), only NOT_FOUND walked
as representative. `xcodebuild build` passes with no new warnings.

### ✅ A4. Web — coupon entry (built 2026-08-25)

Files: `haper-web/types.ts` (`CartCoupon`, `ApplyCouponResponseData`, `RemoveCouponResponseData`),
`haper-web/services/api.ts` (`couponApi.applyCoupon`/`couponApi.removeCoupon`), `haper-web/context/CartContext.tsx`
(`coupon`, `couponInput`, `applyCoupon()`, `removeCoupon()`), `haper-web/pages/Checkout.tsx`
(coupon entry form + applied chip). Scope: normal-flow + specific edge cases listed below (stale coupons,
₹0-discount with clamp warning, worse-than-auto advisory).

1. On the web checkout page (browser, logged in), open **Cart** with items totalling ≥ a coupon's min
   order value.
2. **Expect:** a **Coupon** card sits directly above **Bill Details**, with a text input ("Enter coupon
   code") + **Apply** button. If the cart has never had a coupon applied, this card must be the only new
   thing visible on this section.
3. Type `welcome50` (lowercase) into the field.
4. **Expect:** the input **auto-uppercases as you type** — the field shows `WELCOME50`, not `welcome50`
   (client-side, immediate, before the Apply button is tapped).
5. The **Apply** button is disabled until the code is 4–20 characters (before the server even sees it).
6. Tap **Apply**.
7. **Expect:** a brief spinner on the Apply button, then:
   - The card switches to the applied state: code chip (`WELCOME50` in a green badge) + "You saved ₹50" +
     a **Remove** button.
   - **Bill Details** shows a **"Coupon discount"** row (`-₹50`) instead of any "Discount" row — never both.
   - **"To Pay"** and the grand total both drop by ₹50.
8. Proceed to complete the checkout (select payment method, click **Place Order** → fill in payment flow).
9. **Expect:** order places successfully; the charged amount matches the coupon-adjusted total from step 7.
10. Go back (or open a new session), add items to cart, apply `WELCOME50` again, then tap **Remove**.
11. **Expect:** the card reverts to the input state, **Bill Details** shows the automatic "Discount" row
    again (if one applies at this subtotal) or no discount row, and the total reverts correctly.
12. **❌ Invalid code:** type `DOESNOTEXIST`, tap Apply.
13. **Expect:** an inline error appears below the input (the API's `message` shown as-is, red text,
    e.g. "This coupon code isn't valid") — no toast, no crash, cart total unchanged. Clearing/retyping the
    field clears the error.
14. **❌ Code length validation:** type `ABC` (only 3 chars, below the 4-char minimum).
15. **Expect:** the **Apply** button is disabled; no server call is made even if you try to click it.
16. **❌ Code too long:** type `ABCDEFGHIJKLMNOPQRSTU` (21+ chars, above the 20-char max).
17. **Expect:** the field stops accepting input at 20 chars; Apply stays disabled.
18. **Stale coupon (valid: false):** apply a coupon, then remove enough items to drop below its min order
    value, wait a moment or manually refresh the cart.
19. **Expect:** the applied-coupon card **stays visible** (code chip + Remove button) with an added inline
    warning line showing `coupon.message` (amber text with an info icon) — the coupon is NOT auto-cleared;
    the customer can still tap Remove to clear it manually. Total is priced without the coupon meanwhile.
20. **Deep coupon on a tight-margin cart:** apply a coupon big enough to sell the cart below its cost
    price (e.g. 95% off an item costing ₹90.37). **Since 2026-08-26 this is allowed** — the coupon
    pays out **in full** and the order books a loss. There is no margin guard any more.
21. **Expect:** a completely ordinary applied-coupon card — the full "You saved ₹X" savings line, no
    amber warning, `coupon.message: null`, and a cart total that can sit well under what the goods
    cost us. ❌ Bug if the discount comes back as **₹0** with the
    *"We couldn't apply this coupon right now"* message: that is the old suppressed behaviour.
    (The ₹0 + message path still exists for a coupon that is genuinely worth nothing — a
    zero-valued discount, or a basket of nothing but free-gift lines — but no longer for margin.)
22. **Worse-than-automatic-discount advisory:** apply a coupon on a cart where an automatic discount was
    already active and is worth more than the coupon (`replacedAutoDiscount == true` and `couponBetter ==
    false` on the apply response).
23. **Expect:** a one-shot grey advisory line appears below the applied card: "Your existing offer of ₹X
    was better — remove this coupon to get it back". Now edit an item quantity (e.g. tap + to increase
    quantity) so the cart refreshes.
24. **Expect:** the advisory **disappears** on the refreshed cart — it must never persist across a
    quantity change; the advisory is a one-time snapshot at apply-time and clears when the cart re-syncs
    (confirming the known fix that landed: tieing coupons no longer shows this advisory, and editing
    quantities clears stale ₹ figures).

**Not covered this pass (normal-flow scope, mirroring Android/iOS):** exhaustive walk of every `reason`
code (identical web-UI path for all via the API message — error display is generic); only NOT_FOUND and
one validation (length gate) walked as representative. `tsc -b` and `vite build` pass with no new errors.

### ✅ A. Apply a valid coupon on the cart
1. As a logged-in customer on dev, add some items to the cart (subtotal ≥ ₹200, to meet the min order value from §1.A).
2. Call `POST /cart/coupon/apply` with `{ code: "WELCOME50" }`.
   - Via web/admin checkout flow (when implemented): there will be a coupon input field; type `WELCOME50` and tap Apply.
3. **Expect:**
   - **HTTP 200** with `ok: true`
   - Response includes `coupon: { code: "WELCOME50", discountTotal: 50, ... }`
   - `replacedAutoDiscount: true` if an automatic discount was on the cart, false if none
   - `autoDiscountTotal: <number>` showing what the auto discount would have been (for comparison)
   - `couponBetter: boolean` telling the customer if the coupon is a better deal
   - Updated `cart` showing coupon applied
4. **Verify on `GET /cart`:** the response now includes `coupon: { code: "WELCOME50", discountTotal: 50, valid: true, ... }` and `discount: { total: 0, lines: [], labels: [] }` (zeroed out — automatic discount is suppressed).
5. **Verify pricing:** if subtotal was ₹500, expected total is now ₹450 (₹500 − ₹50 coupon).

### ✅ B. Remove an applied coupon
1. From §2.A, the cart has `WELCOME50` applied.
2. Call `DELETE /cart/coupon`.
   - Via web/admin UI: click the **Remove** button next to the applied coupon chip.
3. **Expect:**
   - **HTTP 200** with `ok: true`
   - `GET /cart` now shows `coupon: { code: null, discountTotal: 0, valid: true }` (coupon slot cleared)
   - `discount` block restored to the automatic discount (if one applies at this subtotal)
   - Total reverts to exactly the pre-coupon price, or to the post-automatic-discount price if an automatic discount kicks back in
4. **Example:** if the subtotal is ₹500, automatic discount is ₹30, and coupon was ₹50:
   - Before remove: total ₹450 (coupon applied, auto discount not).
   - After remove: total ₹470 (auto discount ₹30 back, coupon gone).

### ❌ C. Apply an invalid code (unknown, expired, or below min order)
1. With a ₹150 subtotal cart, apply coupon `WELCOME50` (which requires ₹200 min).
2. **Expect:** **HTTP 400** with `ok: false, reason: "BELOW_MIN_ORDER"`, message "Add ₹50 more to use this coupon".
3. With a ₹200+ subtotal cart, apply coupon `DOES_NOT_EXIST`.
4. **Expect:** **HTTP 400** with `reason: "NOT_FOUND"`, message "This coupon code isn't valid" (don't leak that the code doesn't exist).
5. With a valid cart, apply a coupon that has expired (end date in the past).
6. **Expect:** **HTTP 400** with `reason: "EXPIRED"`, message "This coupon code has expired".
7. In all cases: **no cart state changes**, total stays the same.

### ✅ D. Wrong-code attempt counter — 3 wrong attempts then blocked
1. On a fresh cart, try to apply 3 invalid codes in quick succession (e.g. `WRONGCODE1`, `WRONGCODE2`, `WRONGCODE3`).
2. **Expect:** each returns `reason: "NOT_FOUND"` (not blocked yet; these are just wrong codes, not a real code that's expired).
3. On the **4th wrong attempt**, `WRONGCODE4`:
4. **Expect:** **HTTP 400** with `reason: "TOO_MANY_ATTEMPTS"`, message "Too many attempts, try again tomorrow".
5. After this block, try to apply an **already-valid code that you had applied before** (from a prior checkout). 
6. **Expect:** this succeeds — the limit is on *wrong-code guesses*, not on valid codes already applied. A customer who has a valid coupon in their cart is not locked out by the attempt limiter.
7. The block is **per calendar day (IST)**. At 00:00 IST the next day, the counter resets and the user can guess wrong codes again.

### ✅ D2. Already-used coupon is refused ON THE CART, not at Place Order (added 2026-08-26)
**Why this exists:** a per-customer-limited coupon used to sail through apply and only fail at the final "Place Order" step — where the Android/iOS apps show a generic **"Payment Failed"** dialog for *every* checkout error. Nothing was ever charged, so that dialog was simply wrong. The cart now tells the customer up front.

1. Create coupon `ONCE_EACH` with **per-customer limit: 1**, total limit 100.
2. As **Customer A**, apply it and complete an order → succeeds.
3. On a new cart, apply `ONCE_EACH` again (`POST /cart/coupon/apply`).
4. **Expect:** **HTTP 400** with `ok: false, reason: "CUSTOMER_LIMIT_REACHED"`, message **"You've already used this coupon."** — immediately, without reaching checkout.
5. **Expect:** the code is **NOT** pinned to the cart, `GET /cart` still shows the neutral coupon block, and the coupon's `usedCount` is unchanged (this check is a read — it claims nothing).
6. **A different Customer B** applies `ONCE_EACH` → still succeeds. One customer's usage never affects another's.
7. A coupon with **no** per-customer limit is never refused by this check, however many times that customer has used it.

❗ **This check is ADVISORY / best-effort, by design.** It is not the enforcement. The atomic claim at Place Order is still the only authority on the cap, and it is unchanged. If two devices apply at the same instant, both applies may pass and one of them will still be refused at Place Order — **that is expected and correct, not a bug.** Do not report it as one.

### ✅ D3. A coupon failure at Place Order is now machine-identifiable (added 2026-08-26)
This is what lets the apps stop saying "Payment Failed" for a coupon problem. Verify with a proxy/network log on `POST /user/order/place`.

1. Force any coupon failure at checkout — the easiest is a coupon whose total cap you exhausted, or a code you type that has expired (type it in the checkout request body so it is not just a stale cart coupon).
2. **Expect** the 400 body to now carry **two extra top-level fields**:
   ```json
   {
     "code": 400,
     "error": "Error",
     "data": null,
     "message": "You've already used this coupon.",
     "errorType": "COUPON",
     "reason": "CUSTOMER_LIMIT_REACHED"
   }
   ```
3. `errorType` is always the literal string `"COUPON"` for any coupon refusal. `reason` is one of `NOT_FOUND`, `DISABLED`, `NOT_STARTED`, `EXPIRED`, `EXHAUSTED`, `BELOW_MIN_ORDER`, `NOT_FIRST_ORDER`, `WRONG_STORE`, `CUSTOMER_LIMIT_REACHED`, `TOO_MANY_ATTEMPTS`, `CLAIM_CONFLICT`, `NO_HEADROOM` — the same values `POST /cart/coupon/apply` already returns.
4. **Expect:** a **non**-coupon checkout failure (bad address, out of stock, slot full, payment) carries **neither** field. Clients must branch on `errorType === "COUPON"` and treat "field absent" as "not a coupon problem".
5. **Expect:** a **successful** order response is byte-identical to before — neither field appears on a 200.
6. `message` is unchanged, so an app build that doesn't know these fields keeps behaving exactly as it does today.

### ✅ D4. Android — a coupon failure at Place Order says "Coupon Issue", not "Payment Failed" (built 2026-08-26)

Consumes §D3's `errorType`. Files: `app/src/main/java/com/bheldi/data/model/AuthModels.kt`
(`ErrorResponse` gains `errorType` + `reason`), `.../ui/screens/orders/OrderViewModel.kt`
(`checkoutErrorType`/`checkoutErrorReason`), `.../ui/screens/checkout/CheckoutScreen.kt`
(`checkoutErrorDialogTitle`).

1. Create coupon `ONCE_EACH` (per-customer limit 1). As Customer A, apply it and place an order → succeeds.
2. Build a new cart. Because of §D2 the app will usually refuse at **apply** time now — to reach the checkout path instead, exhaust the coupon's **total** cap (or expire it) *after* it is already pinned to the cart, so the cart holds a coupon that only dies at Place Order.
3. Tap **Confirm Order → Place Order**.
4. **Expect:** the dialog title reads **"Coupon Issue"**, not "Payment Failed". The message body is **unchanged** (whatever the server's `message` says, verbatim).
5. **Expect:** tapping **OK** dismisses it and leaves the customer on checkout with the cart intact — nothing was charged, and the wording no longer implies it was.
6. **❌ Regression check — a real payment failure must still say "Payment Failed":** with no coupon on the cart, force a non-coupon checkout failure (out of stock item, or cancel the Razorpay sheet).
7. **Expect:** the dialog title is still **"Payment Failed"** exactly as before. Any error the server did not tag with `errorType: "COUPON"` keeps the old wording — including responses from an older backend that sends neither field.
8. **❌ No stale title:** hit the coupon error from step 4, tap OK, remove the coupon, then force a payment failure.
9. **Expect:** the second dialog says **"Payment Failed"** — the coupon tag must not leak into the next attempt.

### ✅ D5. Android — checkout screen shows WHICH coupon is applied (built 2026-08-26)

**Why this exists:** the Confirm Order screen showed only "Items" and "To pay". A customer with a coupon
saw a total that was lower than the item total with **no explanation anywhere on the screen** — the coupon
UI lived only on the Cart screen.

1. Apply `WELCOME50` (₹50 off) on the **Cart**, then tap **Checkout**.
2. **Expect:** in the **Order Summary** card, directly under the **Items** row, a green row reading
   **`Coupon WELCOME50`  `-₹50`** — the code is named, so the customer can see *why* the total dropped.
3. **Expect:** the arithmetic now reads correctly top to bottom: Items − coupon + delivery + platform fee = **To pay**.
4. **Expect:** the row style matches the existing **"Wallet applied"** row on the same screen (green, negative amount).
5. **No coupon applied:** go to checkout with no coupon.
6. **Expect:** **no** coupon row at all — the Order Summary is byte-identical to before this build.
7. **Stale / ₹0 coupon:** apply a coupon, then drop the cart below its min order so `valid: false` / discount ₹0.
8. **Expect:** **no** coupon row on checkout (a "-₹0" line would be noise). The cart screen's amber warning chip remains the place that explains a stale coupon.

⚠️ **Known gap (pre-existing, NOT introduced here):** the checkout Order Summary still does not show the
**automatic** (non-coupon) discount row that the Cart's Bill Details shows. A cart whose discount came from
a promo rule rather than a coupon still shows an unexplained drop on checkout. Out of scope for this pass.

### ✅ D6. Web — a coupon failure at Place Order was never mislabelled (verified 2026-08-26, no code change)

Web's counterpart to §D4. **No change was needed** — checked against `haper-web/pages/Checkout.tsx`
(the `catch` block of `handlePlaceOrder`), which has always surfaced the server's own `message` in a
**neutral** toast: `showToast(err?.message || 'Order Failed. Try again.', 'error')`. There is no
"Payment Failed" wording anywhere on that path, so web never had the bug §D4 fixed on Android, and
web does **not** read the new `errorType` field at all (it doesn't need to — it shows the server's
sentence verbatim, which is already the specific reason).

1. Get a coupon to fail at Place Order exactly as in §D4 step 2 (cart holds a coupon that only dies at
   checkout).
2. On web checkout, click **Place Order**.
3. **Expect:** a single toast whose text is the server's `message` verbatim (e.g. *"You've already used
   this coupon."*). ❌ Bug if it ever reads "Payment Failed" or "Payment could not be completed".
4. **Expect:** you stay on the checkout page with the cart intact, and the page is still usable (the
   Place Order button re-enables — `setIsLoading(false)` runs on every error branch).
5. **❌ Regression check:** with no coupon on the cart, force a non-coupon failure (out-of-stock item, or
   a slot that fills up). **Expect:** still the server's message in the same neutral toast — the 422
   slot race still shows **inline** next to the slot list, and a 409 maintenance error still triggers the
   maintenance re-fetch. Those two special branches must keep working.

### ✅ D7. Web — checkout page shows WHICH coupon is applied (verified 2026-08-26, already built)

Web's counterpart to §D5. **No change was needed** — web already shipped this in §A4 (2026-08-25): the
checkout page is where coupon entry lives, so the applied code and its savings were always on screen.
Re-verified against the current `haper-web/pages/Checkout.tsx`; both readings come from the live
`CartContext.coupon` (set from every `GET /cart` response), so they can never show a stale amount.

1. Apply `WELCOME50` (₹50 off) on the web checkout page.
2. **Expect:** the **Coupon** card shows the code `WELCOME50` in bold plus **"You saved ₹50"**, with a
   **Remove** button.
3. **Expect:** **Bill Details** shows a **`Coupon discount`  `-₹50`** row (green), and **To Pay** is
   lower by exactly ₹50.
4. **Stale / ₹0 coupon:** drop the cart below the coupon's min order.
5. **Expect:** the "You saved" line and the **Bill Details** coupon row both disappear (both are gated on
   `discountTotal > 0`), the code chip stays with an amber `coupon.message` explaining why, and **To Pay**
   is priced without the coupon. ❌ Bug if a `-₹0` row is left behind or the total still shows the
   discount.
6. Change an item quantity so the cart re-syncs. **Expect:** the coupon row and To Pay move together —
   never a discount row whose amount doesn't match what the total was reduced by.

### ✅ D8. iOS — a coupon failure at Place Order says "Coupon Issue", not "Payment Failed" (built 2026-08-26)

iOS's counterpart to §D4. Files: `haper/Models/AuthModels.swift` (`ErrorResponse` gains `errorType` +
`reason`, **and a lenient `code` decode — see the ⚠️ below**), `haper/Utils/NetworkManager.swift`
(`NetworkError.httpError` gains a 5th, defaulted associated value + an `errorType` accessor),
`haper/ViewModels/OrderViewModel.swift` (`lastErrorType`, cleared at the START of every
`placeOrder`), `haper/Views/CheckoutView.swift` (new `CheckoutErrorTitle` enum + a single
`showError(_:errorType:)` entry point; the alert is now titled from `errorTitle`, not a literal).

⚠️ **A second, pre-existing iOS-only bug had to be fixed for this to work at all.** The shared error
middleware sends `code` as the HTTP status **number** (`{ "code": 400, ... }`), but iOS typed it as
`String?`. `decodeIfPresent(String.self)` *throws* on a number, so the **whole** `ErrorResponse`
decode failed and `NetworkManager` fell back to **"Server Error 400"** — meaning every
middleware-thrown error message on iOS (not just coupons) was being swallowed. `ErrorResponse` now
has a hand-written `init(from:)`: a **string** `code` still decodes (scheduling's `SLOT_UNAVAILABLE`
etc.), a **numeric** `code` decodes to `nil` (it's an HTTP status, already on
`NetworkError.statusCode`). Android was never affected — Gson coerces `400` → `"400"`.

1. Set the cart up exactly as in §D4 steps 1–2 (a coupon pinned to the cart that only dies at Place Order).
2. On the iOS app (debug build/simulator), tap **Confirm Order → Place Order**.
3. **Expect:** the alert title reads **"Coupon Issue"**, not "Payment Failed", and the body is the
   server's `message` verbatim (e.g. *"You've already used this coupon."*). ❌ Bug if the body reads
   **"Server Error 400"** — that means the lenient `code` decode above is missing/reverted.
4. **Expect:** tapping **OK** dismisses it and leaves you on checkout with the cart intact.
5. **❌ Regression check — a real payment failure still says "Payment Failed":** with no coupon on the
   cart, cancel the Razorpay sheet (or force an out-of-stock failure).
6. **Expect:** title **"Payment Failed"** exactly as before. Same for **every** untagged error, and for
   an older backend that sends neither field.
7. **❌ No stale title (the important one):** hit the coupon error from step 3, tap OK, remove the
   coupon, then force a payment failure.
8. **Expect:** the second alert says **"Payment Failed"**. The tag is cleared at the start of every
   place-order attempt, and the title is re-derived on *every* alert presentation — including the
   pre-flight guards ("Please select a delivery address.", "Cart is empty or invalid.") and the
   Razorpay decline path, which never carry a tag.
9. **❌ Scheduling regression check:** with scheduled delivery on, let a chosen slot fill up before you
   place the order. **Expect:** unchanged behaviour — the **inline** "slot no longer available" message
   next to the slot list with a refreshed slot grid, **no** alert at all.

### ✅ D9. iOS — checkout screen shows WHICH coupon is applied (built 2026-08-26)

iOS's counterpart to §D5. File: `haper/Views/CheckoutView.swift` (`appliedCouponCode` /
`appliedCouponDiscount` + one extra `CheckoutSummaryRow`). Both read
`CartManager.coupon` — the **same** `@EnvironmentObject` instance the Cart screen's coupon card
writes into (there is exactly one `CartManager()`, in `haperApp.swift`), so checkout can never show a
stale or divergent copy.

1. Apply `WELCOME50` (₹50 off) on the **Cart**, then tap **Checkout**.
2. **Expect:** in the **Order Summary** card, between **Items** and **Wallet applied**, a green row
   reading **`Coupon WELCOME50`  `-₹50`**.
3. **Expect:** the row style matches the existing **"Wallet applied"** row (same `CheckoutSummaryRow`,
   negative amount rendered as `-₹50`).
4. **No coupon applied:** go to checkout with no coupon. **Expect:** **no** coupon row — the Order
   Summary is identical to before this build.
5. **Stale / ₹0 coupon:** apply a coupon, then drop the cart below its min order so the discount is ₹0.
6. **Expect:** **no** coupon row on checkout (a "-₹0" line would be noise). The cart screen's warning
   text remains the place that explains a stale coupon.
7. **Back-and-forth check:** on checkout, go **back** to the cart, tap **Remove** on the coupon, then
   enter checkout again. **Expect:** the row is gone and **To pay** matches — both come from the one
   `CartManager`, so they move together.
8. **Accessibility / layout:** with **Dynamic Type at the largest accessibility size** and in **dark
   mode**, the row wraps rather than truncating the code, and the green stays legible.

⚠️ **Known gap (same as Android's §D5, pre-existing):** the checkout Order Summary still doesn't show
the **automatic** (non-coupon) promo discount, so a rule-discounted cart still shows an unexplained
drop between "Items" and "To pay". Out of scope for this pass on both platforms.

### ✅ E. Stale coupon in the cart (expires or drops below min order while sitting)
1. Apply coupon `WELCOME50` to a ₹500 cart successfully.
2. Modify the cart to drop below the min order value (e.g., remove items so subtotal becomes ₹150).
3. Call `GET /cart`.
4. **Expect:** `coupon.valid: false`, and the message says "Add ₹50 more to use WELCOME50" (the same rule that rejected it originally).
5. The total is priced **without the coupon** (reverting to the automatic discount if one applies, or full price).
6. The `couponCode` is **NOT silently cleared** — the customer sees why the coupon stopped working (not a surprise at checkout).
7. If the customer adds items back to reach ₹200+ subtotal:
8. **Expect:** `coupon.valid: true` again, and the coupon amount is reapplied to `GET /cart`.

---

## 3. Customer checkout — place order with a coupon

### ✅ A. Place an order with a coupon applied
1. A customer has a ₹500 subtotal cart with coupon `WELCOME50` (₹50 off) applied → total ₹450.
2. Call `POST /order/place` with the items (no need to send `couponCode` in the body; the server reads the applied code from the persisted cart).
   - Alternatively, send `{ ..., couponCode: "WELCOME50" }` explicitly (both work; the server re-validates from scratch).
3. **Expect:**
   - **HTTP 201**, order created
   - Order snapshot includes `coupon: { code: "WELCOME50", couponId: <id>, discountAmount: 50, redemptionId: <id> }`
   - Order `discountTotal: 50` (matching the coupon discount)
   - Per-line `originalSalePrice`, `discountAmount` (per unit), `salePrice` are all present (coupon was allocated across lines)
   - Order total = sum of line `salePrice × quantity` across all lines = exactly ₹450 (what the customer paid)

### ✅ B. Coupon discount is allocated across order lines
1. Place an order with:
   - Item A: 1 unit @ ₹100 (₹100 total line price)
   - Item B: 2 units @ ₹200 each (₹400 total line price)
   - Subtotal ₹500, coupon `WELCOME50` (₹50 off)
2. **Expect:** the order shows:
   - Item A: `originalSalePrice: 100`, `discountAmount: 10` (per unit), `salePrice: 90`, qty 1 → ₹90
   - Item B: `originalSalePrice: 200`, `discountAmount: 10` (per unit), `salePrice: 190`, qty 2 → ₹380
   - Order total: ₹90 + ₹380 = ₹470? No wait, let me recalculate. If we discount the whole cart by ₹50:
     - Item A weight: 1 × ₹100 = ₹100
     - Item B weight: 2 × ₹200 = ₹400
     - Total weight: ₹500
     - Item A share: ₹50 × (₹100 / ₹500) = ₹10
     - Item B share: ₹50 × (₹400 / ₹500) = ₹40
   - So: Item A `salePrice: 100 − 10 = 90`, Item B `salePrice: 200 − 8 = 192` (per unit, so 2 × ₹192 = ₹384)
   - Wait, the allocation algorithm uses floor2 for individual lines then pushes remainder to the largest. Read the plan §3.3 for the exact algorithm. The key property is: **the per-line amounts sum exactly to the coupon total** (₹50 in this case), and the order shows `discountTotal: 50` to match.
3. **Verify the math:** sum of (line `salePrice × quantity`) across all lines = exactly ₹450 (the payable total); this total is used for GST, invoices, refunds, and profit/COGS calculations.

### ✅ C. Invoices, GST, refunds still compute correctly
1. Place an order with a coupon as in §3.A, and the order is closed/paid.
2. Look at the generated invoice (`/admin/order/:id/invoice`).
3. **Expect:**
   - Invoice shows the per-line `rate` (which is the `salePrice` after coupon discount).
   - GST is computed on the discounted line rates — not affected by the coupon allocation, only by the rewritten per-line prices.
   - Invoice total = sum of (discounted line rates × quantity) = order total (₹450 in the example).
4. If the customer initiates a partial refund (e.g., return one unit of Item B):
5. **Expect:** the refund is computed on the refunded line's **discounted unit price** (the coupon discount is refunded too).

### ✅ D. Prepaid order initiated but not paid does NOT burn the coupon redemption
1. A customer places an order with coupon `WELCOME50` and starts the payment flow, but **abandons before paying** (e.g., closes the browser).
2. The order is created as `status: PENDING` (not yet paid/closed).
3. The coupon claim is initially marked `HELD` (reserved, with a 15-minute TTL).
4. If the order is never paid and abandoned → the claim **auto-releases** after 15 minutes (via a background sweeper cron).
5. The customer can now apply `WELCOME50` again and complete another checkout, because the redemption was released (it never became `CONFIRMED`).
6. **Verify:** the coupon's `usedCount` does not permanently jump when an order is initiated; it only increments when the order is fully paid/closed.

### ✅ E. Coupon replaces (never stacks with) automatic discount
1. A cart with ₹500 subtotal has an automatic discount of ₹30 (from an active rule).
2. `GET /cart` shows `discount: { total: 30 }, coupon: { code: null }`, total ₹470.
3. Apply coupon `WELCOME50` (₹50 off) on this cart.
4. `GET /cart` now shows `discount: { total: 0 }, coupon: { total: 50 }`, total ₹450.
5. **Expect:** the coupon ₹50 **replaces** the auto-discount ₹30, not stacks (total is ₹450, not ₹420).

### ❌ F. Coupon below minimum order value is rejected at checkout
1. A customer applies coupon `WELCOME50` (requires ₹200 min) to a ₹150 cart, but the system lets them somehow (shouldn't happen in practice, but this is a server-side re-validation).
2. They call `POST /order/place`.
3. **Expect:** **HTTP 400** with `reason: "BELOW_MIN_ORDER"`, and **no order is created** (the re-validation at checkout catches it, even though the cart said it was valid).

### ✅ G. Web — the order detail page NAMES the coupon that was used (built 2026-08-26, row format fixed 2026-08-26)

**Why this exists (pre-existing gap, not caused by any other fix today):** web's Bill Summary on a past
order showed a bare **"Discount applied  -₹50"**. A customer who used a code had no way to confirm from
their order which coupon it was — and no way to tell a coupon apart from an automatic promo.

**Follow-up fix (2026-08-26, code review):** the original build kept the row as a two-column
`label` / `-₹X` line-item subtraction. On a discounted order, `Item Total` on this page falls back to
`order.actualOrderValue`, which the backend already computes NET of the discount (baked into each line's
`salePrice`) — so subtracting the discount amount a second time here made the displayed rows not sum to
the Grand Total (e.g. ₹500 cart, ₹50 coupon, ₹5 platform fee → page showed ₹450 − ₹50 + ₹5 = ₹405,
but the customer was actually charged ₹455). Fixed by de-arithmetizing the row: it's now a single
informational line, `"Coupon WELCOME50 — you saved ₹50"` (no separate `-₹` cell), matching the "You
saved ₹X" phrasing already used on `Checkout.tsx`. `Item Total`'s calculation itself was NOT touched.

Files: `haper-web/types.ts` (new `OrderCoupon` interface + `coupon?` on `Order`),
`haper-web/pages/OrderDetail.tsx` (Bill Summary discount row label + format). The backend already
returned this — `GET /user/order/:orderId` sends the whole order document, and
`sanitizeOrderForCustomer` does not strip the `coupon` block, so **no backend change was needed**.

1. Place an order with coupon `WELCOME50` (₹50 off), then open **Orders → that order** on web.
2. **Expect:** in **Bill Summary**, the discount row reads a single line, **`Coupon WELCOME50 — you saved
   ₹50`** (green), naming the code. There is no separate `-₹` amount cell any more.
3. **Expect:** the number shown is still `order.discountTotal` — the same value as before this build. A
   coupon order's `discountTotal` already equals the coupon amount (the automatic and coupon engines
   never stack, see §3.E), so this change only moved the **label/format**, never the money. ❌ Bug if the
   number changed, a second discount row appeared, or the row is subtracted again anywhere in the totals.
4. **Automatic (non-coupon) discount:** open an order that got a promo-rule discount with no code.
5. **Expect:** the row reads **`Discount — you saved ₹X`** — same informational format, no code name.
6. **Old / no-discount orders:** open an order placed before coupons existed, and one with no discount at
   all.
7. **Expect:** **no** discount row at all (the row is still gated on `discountTotal > 0`), and no crash —
   `order.coupon` is simply absent on those documents and is always read as `order.coupon?.code`.
8. **Long code layout:** use a 20-character code (the max). **Expect:** on a narrow phone width the whole
   line (`Coupon <code> — you saved ₹X`) truncates with an ellipsis — no wrap, no horizontal scroll.
9. **POS orders:** a walk-in POS sale with a coupon (§5.A) that lands in the customer's history behaves
   identically — POS writes the same `coupon` block and the same `discountTotal`.
10. **Grand Total still reconciles:** on a discounted order, add up every visible Bill Summary row
    (Item Total + Delivery Fee + Platform Fee, ignoring the informational "you saved" line since it's no
    longer a subtraction) and confirm it equals the Grand Total / amount actually charged. ❌ Bug if it
    doesn't — this was the original defect this follow-up fixed.

**Known gap (unchanged):** the **Orders list** page still shows no discount line of any kind; only the
order **detail** page names the coupon. Out of scope for this pass.

### ✅ H. Admin — Order Details modal shows the coupon / promo saving (built 2026-08-27)

**Why this exists (pre-existing gap):** the admin panel's **Order Details** modal had **no** promo/coupon
money at all. Its only discount-looking row was labelled **"Wallet Used"** and read a variable misleadingly
named `discountAmount` in `haper-admin/src/utils/orders.ts` that is actually `meta.walletUsed` (wallet
money, not a discount). A store admin looking at a discounted order could not tell **why** the total was
lower than the item prices suggested — no coupon code, no discount amount anywhere on the screen.

**What changed:**
- `haper-admin/src/utils/orders.ts` — the normalized field is renamed `discountAmount` → **`walletUsed`**
  (same value, same source, **same "Wallet Used" row behaviour**). Only 2 consumers existed, both updated.
- `haper-admin/src/pages/Orders/OrderDetailsModal.tsx` — a **new, separate** row in the Payment card,
  above Wallet Used, reading `order.discountTotal` and `order.coupon?.code`.

Backend: **no change needed** — `getOrderDetailForAdminScoped` uses `.select({__v:0})` (whole document),
so `discountTotal` and `coupon` were already on the wire.

**Bill-reconciliation:** the row is deliberately **informational**, not a subtraction (same defect class
as §3.G on web). The modal's `Subtotal` falls back to `order.subTotal ?? order.actualOrderValue ?? Σ
salePrice×qty` — all three are already **NET** of the discount, so a `-₹X` line would double-subtract and
stop the rows adding up to `Total`. Wallet Used stays a real `-₹` subtraction, because `price` is net of
the wallet but the Subtotal is not.

1. Place an order with coupon `WELCOME50` (₹50 off), then open **Admin → Orders → that order**.
2. **Expect:** in the **Payment** card, a green row **`🎟 Coupon WELCOME50:  customer saved ₹50`**, shown
   **above** Wallet Used. ❌ Bug if it reads `-₹50` or if it is missing.
3. **Expect:** `Subtotal + Delivery Fee + Platform Fee − Wallet Used = Total` still holds exactly, ignoring
   the informational saved line. ❌ Bug if the rows no longer sum to Total (the original web defect).
4. **Automatic (non-coupon) discount:** open an order discounted by a promo *rule* (no code entered).
5. **Expect:** the same row reads **`Discount applied:  customer saved ₹X`** — generic, no code name.
   (`discountTotal` carries whichever engine applied; they never stack, see §3.E.)
6. **No discount / pre-feature orders:** open an old order and an undiscounted order.
7. **Expect:** **no** discount row at all, no crash, no layout change vs before this build (`coupon` is
   simply absent on those documents and is always read as `order.coupon?.code`).
8. **Wallet regression:** open an order paid partly from wallet. **Expect:** `Wallet Used: -₹X` renders
   exactly as before (this is the row whose backing variable was renamed). ❌ Bug if it disappeared.
9. **Both at once:** an order with a coupon **and** wallet money shows **two separate rows** — the saved
   line and the `-₹` wallet line — and they are not the same number.
10. **Long code layout:** a 20-character code truncates with an ellipsis inside the card; the amount on the
    right never wraps and the modal never scrolls sideways.
11. **POS orders:** a walk-in POS sale with a coupon (§5.A) opened in admin behaves identically.

**Automated:** `haper-admin/src/pages/Orders/OrderDetailsModal.test.tsx` — 4 new tests (coupon named row /
generic automatic-discount row / nothing when no discount / Wallet Used still independent and never `-₹50`).
While adding them, the 5 pre-existing tests in that file that always crashed with *"Cannot destructure
property 'basename'"* were fixed by wrapping the render in `<MemoryRouter>` — that whole file is now green
(9/9), so the documented "5 known-failing OrderDetailsModal tests" baseline no longer applies.

**Known gap (unchanged):** the admin **Orders list**, the thermal print slip and the invoice still show no
coupon line — only the Order Details modal does. Out of scope for this pass.

### ✅ I. Android — Order Details names the coupon that was used (built 2026-08-27)

> ⚠️ **Superseded for modern coupon orders by §3.J (2026-08-28).** The informational line described here
> is now only the **fallback**, used for a coupon order whose lines predate `originalSalePrice`. A coupon
> order that carries those gross prices shows a real `-₹X` row instead. Steps 4-7 and 11 below still apply
> as written; steps 1-3 and 8-10 are superseded by §3.J for orders placed after this feature.

**Why this exists (pre-existing gap, not a regression):** the Android **Order Details** screen has *never*
shown coupon or promo money — its Bill Details card was only `Item Total / Delivery Fee / Platform Fee /
Wallet Used / Total Paid`. A customer who checked out with a code saw the checkout screen name it (§2 D5)
and then, on the saved order, no trace of it at all. The app's own model already decoded the block —
`OrderModels.kt` carried `val coupon: OrderCoupon?` with a comment saying the display wiring was a
follow-up. This pass is that follow-up. **No backend change:** `GET /user/order/:orderId` already returns
`coupon {code, couponId, discountAmount, redemptionId}` and `discountTotal`.

**Bill-reconciliation (same defect class as §3.G web / §3.H admin — checked, and it applies here too):**
Android's `Item Total` is `charges.itemTotal ?: actualOrderValue ?: Σ(qty × salePrice)`. The backend never
sends `charges.itemTotal` (an order's `charges` is only `{delivery, platform}`), so it always falls back to
`actualOrderValue` — which the backend computes as `Σ(qty × salePrice)` **after** the coupon has rewritten
each line's `salePrice` to the discounted price. So `Item Total` on this screen is **already NET**. A
`-₹50` line item would double-subtract. The row is therefore **informational**: a single green line,
**`Coupon WELCOME50 — you saved ₹50`**, with no `-₹` amount cell — exactly the phrasing web landed on.
`Item Total`, `Total Paid` and the `Wallet Used` row were **not** touched.

Files: `haper-android/app/src/main/java/com/bheldi/ui/screens/orders/OrderDetailScreen.kt` (new
`orderCouponSavingsNote()` helper + one row in the Bill Details card).

1. Place an order with coupon `WELCOME50` (₹50 off), then open **Orders → that order** on Android.
2. **Expect:** in **Bill Details**, directly under **Item Total**, a green line reading
   **`Coupon WELCOME50 — you saved ₹50`**. ❌ Bug if it reads `-₹50` or renders as a two-column row.
3. **Expect:** `Item Total + Delivery Fee + Platform Fee − Wallet Used = Total Paid` still holds exactly,
   ignoring the informational saved line. ❌ Bug if the rows no longer sum to Total Paid.
4. **No coupon:** open any order placed without a code, and one placed before coupons existed.
5. **Expect:** **no** line at all and no crash — the Bill Details card is pixel-identical to before this
   build (`coupon` is simply absent on those documents; Gson decodes the missing key to `null`).
6. **Stale / ₹0 coupon:** an order whose `discountTotal` is `0` or absent while a `coupon` block exists.
7. **Expect:** **no** line (never a "you saved ₹0").
8. **Long code layout:** a 20-character code (the max). **Expect:** the line wraps inside the card; the
   card never scrolls sideways and the rows below don't shift.
9. **TalkBack:** the line is read out as one sentence ("Coupon WELCOME50 — you saved ₹50"); it is not
   announced as a price row with a negative amount.
10. **Dark theme + large font scale (200%):** the green stays legible on the dark card and the text wraps
    rather than truncating the amount.
11. **POS orders:** a walk-in POS sale with a coupon (§5.A) opened in the app behaves identically — POS
    writes the same `coupon` block and the same `discountTotal`.

**Automated:** `haper-android/app/src/test/java/com/bheldi/ui/screens/orders/OrderDetailCouponTest.kt` —
6 tests, mirroring `CheckoutSummaryTest`'s pattern (the helper is a file-level `internal fun` precisely so
it is unit-testable; this source set has no Compose UI test runtime).

⚠️ **Known gap (deliberate, matches the brief's gating):** an **automatic** (non-coupon) promo discount
still shows nothing on Android's Order Details — the line is gated on a coupon **code** being present, so
an order discounted by a promo rule shows an unexplained lower total, exactly as before. Web (§3.G) and
admin (§3.H) *do* show a generic "Discount — you saved ₹X" for that case, so Android is now the odd one
out. The Android **Orders list** also still shows no discount line. Both out of scope for this pass.

### ✅ J. Android — Order Details shows the SAME item prices as the cart, with a real coupon row (built 2026-08-28)

**The bug:** the same coupon order looked like it had two different sets of prices depending on the screen.
In the **Cart**, "Abhi Cashews Kaju" was **₹239** (struck ₹330) with a separate **-₹50** coupon line. On
**Order Details** after placing, the same item read **₹203**, struck ₹330, **"38% OFF"**, and Item Total
was **₹283** instead of ₹333. Customers reasonably read this as being charged different prices.

**Root cause (the backend is correct — do not change it):** at checkout the coupon is deliberately
*allocated down into each line* for accounting/COGS — `coupon.utils.js` rewrites every line's `salePrice`
to the post-coupon price — but it **preserves the pre-coupon price in `originalSalePrice`** on the same
line. Order Details was simply reading the reduced `salePrice`, and computing the "% OFF" badge against it.

**The fix (Android display only):** when an order carries a coupon, Order Details rebuilds the GROSS item
prices from `originalSalePrice` and then subtracts the coupon for real — exactly the shape Cart/Checkout
already use. Worked example (the reported order):

| Row | Before | After |
| --- | --- | --- |
| Kaju (MRP ₹330) | ₹203, 38% OFF | **₹239, 27% OFF** |
| Oats (MRP ₹100) | ₹80, 20% OFF | **₹94, 6% OFF** |
| Item Total | ₹283 | **₹333** |
| Coupon RAUNAK50 | "you saved ₹50" note | **-₹50** |
| Delivery / Platform | ₹0 / ₹1 | ₹0 / ₹1 |
| **Total Paid** | **₹284** | **₹284** (unchanged) |

`333 − 50 + 0 + 1 = 284` ✓ — Total Paid is the one number that was always right and it does not move.

**Gated on a coupon, on purpose:** the separate **automatic-discount** engine writes `originalSalePrice`
too, but for those orders the reduced `salePrice` genuinely *is* the sale price and there is no coupon row
to reconstruct. The two engines never both apply to one order (`order/controller.js`), so the fix keys off
`order.coupon.code`. It also **self-checks**: unless `gross − couponAmount` reconciles with the stored
`actualOrderValue` (±₹0.01), it falls back to the old §3.I display, which is what makes legacy orders safe.

Files: `haper-android/.../data/model/OrderModels.kt` (new `OrderItem.displayUnitPrice`; `unitPrice` kept
as-is), `haper-android/.../ui/screens/orders/OrderDetailScreen.kt` (new `orderCouponBreakdown()` helper;
item price/badge, Item Total and the Bill Details row read it). **No backend, iOS, web or admin change.**

1. Place an order with a coupon (e.g. ₹50 off) on items that also have a catalog discount, then open
   **Orders → that order**.
2. **Expect:** each item's price and struck-through MRP are **identical to what the Cart showed** for the
   same item. ❌ Bug if any item is cheaper here than it was in the cart.
3. **Expect:** the **% OFF** badge matches the catalog discount (MRP vs the cart price), not an inflated
   one. Note it **truncates**, so ₹330→₹239 shows **27% OFF**, not 28%.
4. **Expect:** **Item Total** equals the sum of (cart price × qty) — the gross number — and directly under
   it a green **`Coupon <CODE>`  `-₹50`** two-column row.
5. **Expect:** `Item Total − Coupon + Delivery Fee + Platform Fee − Wallet Used = Total Paid`, exactly.
   ❌ Bug if the rows don't sum, or if Total Paid changed from what the customer was actually charged.
6. **Wallet + coupon together:** repeat with wallet money applied. **Expect:** both rows subtract and the
   sum still lands on Total Paid.
7. **Automatic (non-coupon) discount order:** open an order discounted by a promo rule with no code.
8. **Expect:** **pixel-identical to before this build** — net prices, no coupon row, no "you saved" line.
   ❌ Bug if a `-₹` row appears or the item prices jump up (they'd no longer match what was charged).
9. **No discount at all / pre-coupon legacy order:** **Expect:** unchanged, no crash, never a **₹0** price.
10. **Legacy coupon order** (placed before `originalSalePrice` was stored): **Expect:** the old §3.I
    informational `Coupon <CODE> — you saved ₹X` line and net prices — never a broken/doubled subtraction.
11. **Free gift in a coupon order:** **Expect:** the gift line still shows the **FREE GIFT** pill and
    `FREE`, and does **not** add anything to Item Total.
12. **COD order:** **Expect:** same breakdown ("Total Paid" is the amount due on delivery).
13. **TalkBack:** the coupon row is announced as a label + a negative amount, like the Wallet Used row.
14. **Dark theme + 200% font scale + rotation:** the coupon row stays green/legible, doesn't clip the
    amount, and survives rotation (the whole screen is stateless w.r.t. this change).
15. **POS orders:** a walk-in POS sale with a coupon (§5.A) writes the same fields and behaves identically.

**Automated:** `OrderDetailCouponTest.kt` — now **17** tests (the 6 fallback-note ones plus 11 covering the
gross rebuild, the reported ₹333/-₹50/₹284 arithmetic, the 27%-vs-38% badge, qty > 1, free-gift lines, the
no-coupon and legacy-order fallbacks, and the reconciliation guard). Full app suite: **348 passing**.

### ✅ K. iOS — Order Details shows the SAME item prices as the cart, with a real coupon row (built 2026-08-28)

iOS's counterpart to §J — same bug, same root cause, same numbers. It was never screenshotted on iOS, but
the identical read of the coupon-reduced `salePrice` was confirmed by code (`OrderModels.swift` exposed only
`unitPrice { salePrice }`, and the Bill's Item Total fell through to the net `actualOrderValue`).

**The fix (iOS display only):** `OrderItem` now decodes `originalSalePrice` (optional — legacy orders have no
such key) and exposes `displayUnitPrice` (= `originalSalePrice` when > 0, else `salePrice`); `Order` decodes
the `coupon` snapshot (`code` + `discountAmount`). When — and only when — the order names a coupon **and**
`gross − coupon` reconciles with the stored `actualOrderValue` (±₹0.01), Order Details renders gross item
prices, computes the % OFF badge against them, sets **Item Total** to the gross sum, and adds a real green
`Coupon (CODE)` `-₹50` row directly under it. `unitPrice` is unchanged and still means "what was charged".

| Row | Before | After |
| --- | --- | --- |
| Kaju (MRP ₹330) | ₹203, 38% OFF | **₹239, 27% OFF** |
| Oats (MRP ₹100) | ₹80, 20% OFF | **₹94, 6% OFF** |
| Item Total | ₹283 | **₹333** |
| Coupon (CODE) | *(no row at all on iOS)* | **-₹50** |
| Delivery / Platform | ₹0 / ₹1 | ₹0 / ₹1 |
| **Total Paid** | **₹284** | **₹284** (unchanged) |

`333 − 50 + 0 + 1 = 284` ✓.

**Same two safety gates as Android:** (a) keyed off `order.coupon.code`, so **automatic-discount** orders —
where the reduced `salePrice` really is the sale price — are untouched; (b) the reconciliation guard, so a
coupon order placed before `originalSalePrice` existed keeps its net prices and gets an informational
`Coupon (CODE)` `You saved ₹50` note instead of a subtraction that wouldn't add up.

Files: `haper-ios/haper/Models/OrderModels.swift` (`OrderItem.originalSalePrice` + `displayUnitPrice`, new
`OrderCoupon`, `Order.hasCouponCode` / `couponBreakdownReconciles` / `hasCouponDiscount` / `grossItemTotal`),
`haper-ios/haper/Views/OrderDetailView.swift` (item price + badge + line total + Bill Details).
**No backend, Android, web or admin change.**

1. Steps **1–15 of §J**, run on the iOS app instead — same expectations, including the automatic-discount,
   legacy, free-gift, wallet-plus-coupon and COD cases.
2. **iOS-specific:** VoiceOver reads the coupon row as its label then a negative amount (like Wallet Used).
3. **iOS-specific:** at the largest Dynamic Type size and on the smallest supported device, the **₹ amount is
   never truncated** — a long code truncates instead. Check dark mode too (the row is green on both).
4. **iOS-specific:** the same order opened from **Orders list → detail** and from **Order Success → detail**
   shows the same numbers.

**Automated:** `haperTests/OrderCouponDisplayTests.swift` — 12 tests (gross prices, the ₹333/-₹50/₹284
arithmetic, the 27%-vs-38% badge, qty > 1, free-gift lines, automatic-discount and legacy fallbacks, a
`code: null` coupon block, the reconciliation guard (including a fully-covered order where
`actualOrderValue` is legitimately 0), and a malformed coupon block that must not wipe the order). The
**pre-existing** `haperTests` compile break (`ViewModelsStateTests.swift`, unrelated to coupons) still
blocks a plain `xcodebuild test` on the whole bundle — exclude just that one file to run these:
```
xcodebuild test -project haper.xcodeproj -scheme haper -destination 'platform=iOS Simulator,id=<UDID>' CODE_SIGNING_ALLOWED=NO EXCLUDED_SOURCE_FILE_NAMES='ViewModelsStateTests.swift' -only-testing:haperTests/OrderCouponDisplayTests
```

---

## 4. Money correctness — caps and concurrency

### ✅ A. Total redemption cap is enforced
1. Create coupon `LIMITED3` with:
   - FLAT ₹50 off
   - Total limit: 3 redemptions
   - Per-customer limit: none (unlimited per customer)
2. Three different customers each place an order with `LIMITED3`:
   - Customer 1 → order closes, `usedCount` becomes 1.
   - Customer 2 → order closes, `usedCount` becomes 2.
   - Customer 3 → order closes, `usedCount` becomes 3.
3. A **4th customer** tries to apply and checkout with `LIMITED3`.
4. **Expect:** at checkout, **HTTP 400** with `reason: "EXHAUSTED"`, message "This coupon code has reached its limit". No order created, `usedCount` stays at 3 (not incremented).

### ✅ B. Per-customer redemption cap is enforced
1. Create coupon `ONCE_EACH` with:
   - FLAT ₹50 off
   - Total limit: 100
   - Per-customer limit: 1 (each customer can use it once)
2. **Customer A** places an order with `ONCE_EACH` → succeeds, `usedCount: 1`.
3. **Same Customer A** tries to apply `ONCE_EACH` again on a new cart.
4. **Expect:** **HTTP 400** with `reason: "CUSTOMER_LIMIT_REACHED"`, message "You've already used this coupon". Since 2026-08-26 this is refused at **apply** time as well as at checkout (§2 D2) — but the checkout claim is still the only real enforcement.
5. A **different Customer B** applies and orders with `ONCE_EACH` → succeeds, `usedCount: 2`.

### ✅ C. Concurrent claims don't exceed total cap (stress test)
1. Create coupon `RACE_TEST` with total limit 10 and no per-customer limit.
2. Fire 15 simultaneous `POST /cart/coupon/apply` requests (or place 15 orders in rapid succession from different customer sessions).
3. **Expect:** exactly 10 succeed, 5 fail with `EXHAUSTED`.
4. Check the coupon's `usedCount` — it's exactly 10, not more (the atomic `$inc` guards against oversell even under concurrent traffic).

### ✅ D. Concurrent per-customer claims don't exceed per-customer cap
1. Create coupon `PER_CUST_RACE` with:
   - Per-customer limit: 1
   - Total limit: 100
2. From **one customer's two browser tabs** (same userId), rapidly fire two `POST /order/place` requests with `couponCode: "PER_CUST_RACE"` at nearly the same time.
3. **Expect:** exactly **one** succeeds, the other fails with `CUSTOMER_LIMIT_REACHED`.
4. The unique index `(couponId, userId, ordinal)` ensures the second insert hits a duplicate-key error → only one redemption row is created.

### ✅ E. Below-cost coupons apply IN FULL (margin guard REMOVED, 2026-08-26)

> **Policy change.** The aggregate margin guard is gone. A coupon now always gives its full discount
> even when the order therefore sells below cost. Approved by the business: a code we advertised must
> be honoured, and marketing owns the loss. Every other rule is untouched — minimum order value,
> expiry, store scope, first-order-only, per-customer and total caps all still refuse as before.
>
> This replaces the old §E/§F margin-guard walkthroughs and supersedes
> `test-coupon-codes-security-fixes.md` §4.

1. Create item "Budget Item" with:
   - Selling price: ₹100
   - Cost price: ₹60
2. A customer has 1 unit in cart (subtotal ₹100).
3. Create coupon `BIG_DISCOUNT` (FLAT ₹60 off, total limit 100).
4. Apply the coupon → **Expect:** `coupon.discountTotal: 60`, cart total ₹40, `coupon.message: null`.
   The order sells ₹60 of goods for ₹40 — a ₹20 loss, and that is correct.
   ❌ Bug if it comes back as **₹0 off** with an apology message — that is the removed guard.
5. The order shows `coupon: { discountAmount: 60 }` and the line at `salePrice: 40`,
   `originalSalePrice: 100`, `discountAmount: 60` (per unit).
6. **Verify:** preview and checkout agree to the paisa (same shared function), and the ₹60 does not
   change with the item's cost price — cost is no longer an input to the discount at all.
7. Go deeper: a 95%-off coupon on a ₹100 item costing ₹90.37 → **₹95 off**, ₹5 payable, at any
   quantity. The order must place successfully, consume stock, and claim exactly one redemption.
8. **Cost-price disclosure (was the reason for the guard):** nothing on the bill sits at the cost
   line any more, because the price follows the coupon's own maths. Dividing the ₹ off by the
   quantity gives ₹95, not the ₹9.63 margin. ✅

### ✅ F. Unknown cost (`costPrice: 0`) is a non-event now
1. Create item "Mystery Item", selling price ₹100, cost price 0 (unknown — the repo invariant per
   costPrice-money-invariant.md).
2. Cart it (subtotal ₹100) and apply coupon `AGGRESSIVE` (FLAT ₹80 off).
3. **Expect:** ₹80 off, total ₹20 — same as it was, but now for the trivial reason that cost is never
   consulted. Mixing in a second item that *does* have a cost changes nothing either.
   (Historically this needed a special "all costs unknown → skip the guard" branch, or every coupon
   in a store with no goods receipts silently gave ₹0. That trap is gone with the guard.)

### ✅ G. A coupon genuinely worth ₹0 is still refused (unchanged)
1. This path no longer has anything to do with margin. It fires when the engine values the coupon at
   zero — a zero/unknown-valued discount row, or a basket of nothing but free-gift lines.
2. **Expect:** the code TYPED at checkout → 400 with *"We couldn't apply this coupon right now — try
   another one?"*, no order, **no redemption claimed**, `usedCount` unchanged. A code merely sitting
   on the cart → silently dropped, order prices normally, still nothing claimed.
3. This is the guard that stops a worthless coupon burning the customer's only use. ✅

---

## 5. POS counter sales — walk-in customer

This section covers the `POST /admin/pos/sale` flow with coupon support (both paths ship today).

### ✅ A. Apply a valid coupon on a POS sale
1. A store admin on `damin.haper.in`, **New Sale** page, POS mode.
2. Add one in-stock item (e.g., 2 units @ ₹250 each = ₹500 subtotal).
3. Scroll to the **coupon code** input field.
4. Type `WELCOME50` and tap **Apply coupon** (or similar).
5. **Expect:**
   - Coupon validates (same rules as checkout: scope, schedule, min order, enabled, etc.).
   - A success message shows: "Coupon applied — ₹50 off".
   - The POS bill summary updates: `Subtotal ₹500 → Coupon −₹50 → Payable ₹450`.
6. Enter the customer's phone (e.g. `9876543210`), tap **Record sale**.
7. **Expect:**
   - **HTTP 201**, sale closes
   - Invoice number is minted and printed (or displayed).
   - Order shows `coupon: { code: "WELCOME50", discountAmount: 50 }`, total ₹450.

### ✅ B. POS: add or remove items after applying coupon — total updates correctly
1. On the **New Sale** page, add item A (₹100) to cart.
2. Apply coupon `WELCOME50` (₹50 off) → bill shows ₹50 payable (₹100 − ₹50).
3. **While the coupon is still applied**, add item B (₹60) to the cart.
4. **Expect:** the bill **recalculates immediately**:
   - New subtotal: ₹160
   - Coupon: ₹50 off (still applies; min order is ₹200 so if it's met, applies)
   - New payable: ₹110 (or ₹160 if the min order is now not met)
5. Remove item A from the cart.
6. **Expect:** the bill updates again — no stale coupon total frozen from before.
7. This was a real bug found in review; call out the regression check: the total must not be frozen when items change after a coupon is applied.

### ✅ C. POS: coupon with per-customer limit requires phone (guest user refusal)
1. On the **New Sale** page, add an in-stock item to the cart.
2. **Don't** enter a customer phone (leave it empty or as "Walk-in").
3. Try to apply a coupon `FREQUENT_BUYER` that has:
   - Per-customer limit: 1 (or any limit > 0)
   - OR first-order-only: true
4. **Expect:** **error "This coupon requires customer details. Please enter the customer's phone number."** (or similar messaging).
5. The coupon is **NOT applied**, and the sale cannot proceed with this coupon until a valid phone is captured.
6. **Now** enter a valid phone (e.g. `9876543210`) and try the coupon again.
7. **Expect:** coupon applies successfully — the per-customer limit now applies to this phone.

### ✅ D. POS: coupon with total-cap only (no per-customer limit) works for guests
1. Create coupon `WALK_IN_OK` with:
   - FLAT ₹30 off
   - Total limit: 1000 (per-customer limit: **none**, first-order-only: **off**)
2. On POS, record a sale with **no phone** (anonymous walk-in, uses the shared `POS-GUEST` account).
3. Apply `WALK_IN_OK`.
4. **Expect:** coupon applies fine — no phone required because there's no per-customer tracking needed.
5. A second walk-in (different person, same `POS-GUEST` account) can apply `WALK_IN_OK` again immediately (no per-customer block).
6. The `usedCount` increments for each sale; the total cap protects it, but there's no per-customer gate.

### ✅ E. POS: no wrong-attempt limiter for cashiers (trusted user)
1. On POS, try to apply 5 junk codes in a row (e.g. `BADCODE1`, `BADCODE2`, etc.).
2. **Expect:** each returns an error, but the 4th/5th/Nth are NOT blocked by "too many attempts" — the limiter does **not apply at POS**.
3. A cashier can retry invalid codes unlimited times (POS is a trusted authenticated channel; the 3-wrong-per-day limit is for anonymous customers protecting against brute force).

### ❌ F. POS: invoice-retry loop doesn't double-burn a coupon
1. Trigger the invoice-retry scenario (this is hard to reproduce in manual testing; it's covered by automation in the backend suite, but flag it here as a regression check).
2. The coupon is **claimed OUTSIDE the retry loop** (claim once, retry the invoice mint if it fails).
3. **Expect:** even if the invoice mint retries 2–3 times, the coupon's `usedCount` increments exactly once, and exactly one redemption row exists (the claim is idempotent; the release is too).

---

## 6. Cost exposure — CLOSED 2026-08-25, re-closed differently 2026-08-26

### ✅ G. Cost exposure edge case — now closed by removing the clamp entirely

**Status: fixed, twice over.** The leak needed a *clamp* to exist: a clamped discount priced the cart
at exactly `Σ cost`, so dividing the ₹ off by the quantity read our per-unit cost straight back.

- 2026-08-25 fix: suppress instead of clamp (₹0 off, cart at full price) — nothing published.
- **2026-08-26 (current): the margin guard was removed altogether** as a business decision. Coupons
  always pay out in full, below cost included. There is no clamp and no suppression, so there is
  again nothing derived from cost anywhere in the response — the price now follows the coupon's own
  arithmetic and has no relationship to what we paid.

Re-test with §E above. The description below is kept for context on what the leak was.

**What this was:** a known issue tracked for a separate fix after the first mitigation (rounding the
clamped amount to whole rupees) turned out not to work.

**Symptom:** A customer who buys a large quantity of one item and applies a large-percentage coupon can, by doing the math on the discount shown, estimate the store's cost price for that item. The store's exact purchase cost may be exposed.

**Example:**
- Item: "Premium Snack", selling price ₹100, cost ₹40 (margin ₹60, headroom).
- Coupon: `BULK50` (50% off, capped at ₹2000).
- Customer's cart: 50 units @ ₹100 = ₹5000 subtotal.
- Coupon offers 50% = ₹2500, but is capped at ₹2000 (due to the aggregate margin guard over all items).
- Customer observes: "I was offered ₹2000 off ₹5000, so the margin must be ₹2000 / 50 = ₹40 per unit, therefore the cost is ₹60 per unit."
- **Reality:** in this case the customer is correct, but only by coincidence (they may also infer margins incorrectly in other scenarios).

**Why it's not a blocker:**
- The coupon discount is correctly clamped to protect margin; no loss of money.
- The exposure is informational (cost estimates), not a financial loss.
- The maths is observable from any big order with a coupon, independent of this feature.

**How it was fixed (2026-08-25):**
- Obfuscation was the wrong direction: any figure derived from the headroom is `(price − cost) × qty`,
  so the customer divides by their own quantity and the obfuscation washes out. The coupon is
  suppressed instead — nothing is published.

**How it was fixed AGAIN (2026-08-26):**
- The guard is gone (business decision). A coupon is always paid in full, so the customer's ₹ off is
  purely `value%` or the flat rupees — a number they already knew from the poster.

**For testing:**
- A coupon that is **worth less than the percentage suggests** is impossible: caps aside
  (`maxDiscountAmount`, and never more than the cart is worth), the customer gets exactly what the
  coupon says.
- ❌ Flag it as a regression if a big-percentage coupon on a tight-margin cart gives **₹0** — that is
  the removed guard resurfacing.

---

## 7. Rollback / kill switch

### ✅ A. Toggle a coupon off to stop using it immediately
1. In admin, find coupon `WELCOME50`.
2. Toggle **Enabled** to **off**.
3. **Expect:** toggle updates instantly (no page reload), no deploy needed.
4. Try to apply `WELCOME50` on a checkout immediately.
5. **Expect:** **HTTP 400** with reason `DISABLED`, message "This coupon code isn't valid".
6. Existing orders with `WELCOME50` keep their snapshots; only new applications are blocked.

### ✅ B. Global kill switch (env var)
1. If the coupon feature code path itself is broken (rare, but deployment contingency), a global `COUPONS_KILL_SWITCH` environment variable can disable the entire feature without a deploy.
2. Set `COUPONS_KILL_SWITCH=true` in the backend's runtime config.
3. Try to apply any coupon on checkout.
4. **Expect:** **HTTP 400** with reason `NOT_FOUND` (the system acts as if no coupons exist).
5. All POS sales with or without a coupon attempt still work (the feature simply returns "coupon not found").
6. **To re-enable:** remove/unset the env var, and the feature reactivates (no code deploy needed).

### ✅ C. Boot-time index check degrades — it must NEVER take a service down

**Background (dev incident, 2026-08-24).** The coupon ledger's `per_customer_slot` unique index
*is* the per-customer redemption cap. At boot each service verifies it exists. Admin used to
`process.exit(1)` when that check failed — which killed the **entire** admin API (stores, orders,
inventory, everything) and, under PM2, turned into an endless restart loop. Admin now degrades the
same way the customer API always did.

**Why the index was missing in the first place:** every service connects with
`readPreference: "secondaryPreferred"`. Mongoose treats that as "no index creation allowed on this
connection" and silently forces `autoIndex`/`autoCreate` to `false`, so the boot's `Model.init()`
call resolved successfully having built **zero** indexes — no error, nothing to catch. The boot now
calls `mongoIndexUtils.ensureIndexesFor(...)` explicitly, which is not subject to that flag.

Steps:
1. Confirm the coupon indexes exist on the target DB:
   `db.getCollection('coupon-redemptions').getIndexes()`
2. **Expect:** `_id_`, `per_customer_slot` (unique + `partialFilterExpression`
   `{status: {$in: ["HELD","CONFIRMED"]}}`), `hold_sweeper`, `by_order`, `coupon_report`.
   Also check `coupons` (`code_unique`, `active_window`, `scope_store`) and `coupon-attempts`
   (`actor_day_unique`, `attempt_ttl`).
3. Restart the admin service and read the boot log.
4. **Expect:** `MongoDB Connected: ...` and **no** `[coupons] CRITICAL` line. Admin serves normally.
5. **Simulating the failure** (do this on a scratch DB only, never dev/prod): drop
   `per_customer_slot`, then restart admin.
6. **Expect:** admin **still boots and stays up**. The log shows
   `[coupons] CRITICAL: coupon-redemption index verification failed on the admin API — coupons are
   DISABLED for this process (the rest of admin stays up).`
7. **Expect:** stores, orders, inventory, POS sales *without* a coupon — all work normally.
8. Try to apply any coupon at POS. **Expect:** clean **HTTP 400** reason `NOT_FOUND` (a tidy
   refusal, not a 500) — the cap is never left silently unenforced.
9. Rebuild the index and restart. **Expect:** coupons work again, no CRITICAL line.

> ⚠️ **Never "fix" a coupon `E11000` by dropping or de-uniquing `per_customer_slot`.** That index
> is the only thing preventing a "once per customer" coupon from being redeemed twice.

**Requires MongoDB 6.0+** — `$in` inside a `partialFilterExpression` is only allowed from 6.0.
Dev and prod clusters are 8.0, so this is satisfied; it only constrains where the app may be pointed.

---

## 8. Regression tests (backward compatibility)

### ✅ A. No coupon applied — responses are byte-identical to before
1. A customer adds items to the cart **without applying any coupon**.
2. `GET /cart` response is **identical** to the pre-coupon behavior:
   - `coupon` block is present, but `{ code: null, discountTotal: 0, valid: true }` (zeroed).
   - `discount` block is unchanged (automatic discount engine still works).
   - All other fields (items, totals, delivery, gift tier) are exactly as before.
3. `POST /order/place` without a `couponCode` field is **byte-identical** to before (the code path skips coupon logic entirely).

### ✅ B. `discountsEnabled: false` stores keep working
1. A store has `config.discountsEnabled: false` (automatic discounts are off).
2. Coupons are **independent** of this flag — they are not gated by it.
3. A customer can still apply a coupon at this store, and it works normally.
4. **Rationale:** a store with automatic discounts off should still be able to run a marketing campaign with a coupon code.

---

## 9. Automated coverage (in-memory Mongo only)

Backend tests run against **in-memory Mongo only**. Run from the package dir:

```
cd packages/user && NODE_ENV=test npx jest coupon
cd packages/admin && NODE_ENV=test npx jest coupon
```

**Coverage includes:**
- Pure engine tests (`coupon.utils.js`): PERCENT/FLAT maths, caps, allocation algorithm, margin guard.
- Redemption claiming tests: total-cap atomic `$inc`, per-customer unique-index insert-retry, HELD/CONFIRMED/RELEASED lifecycle.
- Abort-path release: transaction throw after claim → redemption is released, `usedCount` decrements.
- Sweeper: HELD rows past TTL are auto-released.
- Wrong-attempt counter: 3 wrong attempts, 4th blocked, IST day boundary.
- Cart apply/remove/checkout flow: coupon persisted, replaced automatic discount, per-line allocation, invoices agree.
- Both checkout paths: `placeOrder` AND `placeScheduledOrder` both handle coupons (the delivery bug risk from the plan).
- POS sale with coupon, invoice-retry idempotency, guest refusal for per-customer coupons.
- Admin CRUD: create, list, edit (code read-only), toggle, delete.
- **Boot index build on a production-shaped connection**
  (`packages/user/__tests__/coupon-boot-index-build-secondary-preferred.test.js`): proves
  `Model.init()` silently builds nothing under `readPreference: "secondaryPreferred"`, that
  `ensureIndexesFor()` does build `per_customer_slot` unique+partial, and that the built index
  really rejects a second live slot while a RELEASED row frees it.
- **Boot degradation** (`packages/admin/__tests__/coupon-boot-index-verification-connectdb.test.js`):
  admin logs CRITICAL and force-disables coupons instead of `process.exit(1)`. This is a regression
  guard for the 2026-08-24 admin crash-loop — do not let the exit come back.
- **Checkout refusal tagging** (`packages/user/__tests__/coupon-checkout.test.js`, "coupon failures
  carry errorType + reason", §2 D3): every coupon refusal on BOTH checkout paths answers
  `errorType:"COUPON"` + the specific `reason`; a non-coupon failure and a 200 carry neither; and an
  untagged error that happens to have its own `.reason` (the mongo driver's does) publishes nothing.
- **Advisory per-customer apply check** (`packages/user/__tests__/coupon-cart.test.js`, §2 D2):
  refuses on a live HELD/CONFIRMED slot, lets a RELEASED row back in, ignores other customers and
  uncapped coupons, and **fails open** if the read itself errors.
- **Android client-side tagging** (`haper-android`, §2 D4/D5): `CheckoutSummaryTest` covers the
  dialog title (COUPON → "Coupon Issue"; null / unknown tag / empty → "Payment Failed") and the
  Order Summary coupon row (rendered with the code; omitted for no coupon, blank code, or ₹0
  discount). `OrderViewModelTest` proves `placeOrder` threads `errorType`/`reason` through and
  **clears them before every retry** so a coupon tag can't mislabel a later payment failure.
  `ApiContractTest` round-trips the real §D3 JSON through Gson (tagged, untagged, and the
  `/cart/coupon/apply` `{ok:false,reason,message}` body) via MockWebServer.
  `OrderDetailCouponTest` (§3 I) covers the order-detail saved line: named with the amount when a coupon
  saved money, nothing for no coupon / blank code / ₹0 / null / negative discount, and an explicit
  assertion that the line **never** contains `-₹` (the bill-reconciliation guard).
- **iOS client-side tagging** (`haper-ios`, §2 D8/D9): `CheckoutErrorTitleTests` covers the alert
  title (COUPON / lowercase `coupon` → "Coupon Issue"; nil / `""` / `"COUPONS"` / `"PAYMENT"` →
  "Payment Failed") and round-trips the real §D3 JSON through `ErrorResponse` → `NetworkError` →
  title. `AuthModelsTests` locks the additive decode **and the numeric-`code` fix** (numeric code →
  body still decodes, `code` nil; string code → still `SLOT_UNAVAILABLE`).
  `NetworkManagerTypesTests` proves the new 5th associated value defaults to nil so every existing
  4-argument `httpError` call site is unchanged.
  ⚠️ `xcodebuild test` currently cannot run (pre-existing unrelated compile error in
  `ViewModelsStateTests.swift`, which blocks the whole test bundle). The above was additionally
  verified with a standalone runtime harness that mirrors the ViewModel/View wiring and includes
  **negative controls** — the pre-fix code is re-run against the same inputs and each bug is shown
  to reproduce (wrong title, "Server Error 400" body, and an identical PIN status line).
- **100+ backend tests**, ~30 admin-FE tests, **333 Android unit tests** (327 + the 6 in §3 I).

> ⚠️ Both test harnesses connect with `readPreference: "primary"`, but the real services use
> `secondaryPreferred`. That divergence is exactly what let the missing-index bug ship green, so
> any test about index *building* must open its own `secondaryPreferred` connection.

---

## 10. What deploy this needs

- **Backend deploy (dev):** `haper-backend` code + the 3 new collections (coupons, coupon-redemptions, coupon-attempts) created lazily on first write. No migration.
- **Admin panel deploy (dev):** `haper-admin` code (Coupons CRUD page + POS coupon UI).
- **Android — DONE 2026-08-26 (§2 D4, D5):** consumes `errorType:"COUPON"` (§2 D3) to title the
  checkout dialog **"Coupon Issue"** instead of "Payment Failed", and names the applied coupon in
  the checkout Order Summary. Needs the backend deploy above to be live to have any effect; with an
  old backend the fields are simply absent and the app behaves exactly as before.
- **iOS — DONE 2026-08-26 (§2 D8, D9):** the same two changes as Android's §2 D4/D5 — the checkout
  alert is titled **"Coupon Issue"** for an `errorType:"COUPON"` refusal, and the Order Summary names
  the applied coupon. Needs the backend deploy above to be live to have any effect; with an old
  backend both fields are absent and the app behaves exactly as before. **Also fixed on the way
  through (iOS-only, pre-existing):** a numeric `code` in the error body broke `ErrorResponse`
  decoding entirely, so *every* middleware error showed "Server Error 4xx" instead of the real
  message — see the ⚠️ in §2 D8.
- **Web — CLOSED 2026-08-26 (§2 D6, D7; §3 G):** the two Android fixes turned out to need **no web
  change** — web already showed the server's own message in a neutral toast (§2 D6) and already named
  the applied coupon on checkout (§2 D7). Web does **not** read `errorType`. The one real web gap, the
  order **detail** page saying only "Discount applied", **was** fixed (§3 G) — a frontend-only change
  (`types.ts`, `pages/OrderDetail.tsx`); the backend already returned the `coupon` block.
- **Android — DONE 2026-08-27 (§3 I):** the **order detail** screen now names the coupon
  (`Coupon <CODE> — you saved ₹X`, informational, never a `-₹` subtraction). Frontend-only; the backend
  already returned the `coupon` block on `GET /user/order/:orderId`.
- **Android deploy:** `haper-android` code (Cart screen coupon entry §2A2; checkout coupon dialog + summary row §2 D4/D5; order-detail coupon line §3 I) — normal debug build/install; no store release required for dev testing.
- **iOS deploy:** `haper-ios` code (Cart screen coupon entry §2A3; checkout coupon alert title + summary row §2 D8/D9; Order Details gross prices + coupon row §3 K) — normal debug build/simulator install; no TestFlight/App Store release required for dev testing.
- **Web deploy (dev):** `haper-web` code (Checkout page coupon entry & form validation, §2A4; order-detail coupon name, §3 G) — test via `tsc --noEmit` + `vite build` locally or deploy to dev. `haper-web` has no eslint gate and no test suite; those two commands are the whole check.
- **`main` stays off-limits.** This ships to prod via a manual user-driven deploy only (not a CI/CD auto-merge to main).

---

## Prerequisites (read once)

1. **Backend and admin deployed to dev** (dapi/damin.haper.in with the coupon feature code).
2. **Log in as super-admin** to `damin.haper.in` for admin tests (permission: `coupons.manage`).
3. **An app user account** for customer checkout tests (or use an existing one).
4. **A store with some in-stock items** for POS sales.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| **Admin service crash-loops on boot** with `[coupons] CRITICAL ... aborting startup` | Old build. Admin no longer exits on this check — redeploy. The underlying cause is the missing `per_customer_slot` index (see §7C). |
| Every coupon returns `NOT_FOUND`, and the boot log has a `[coupons] CRITICAL` line | The boot index check failed, so coupons force-disabled themselves for that process. Rebuild the coupon indexes and restart (see §7C). |
| `coupon-redemptions` has only the `_id_` index after a deploy | The boot index build didn't run. `Model.init()` does **not** build indexes on a `secondaryPreferred` connection — the explicit `ensureIndexesFor()` call must be present in `connections/mongo.js`. |
| Coupon endpoint returns **403** | The admin account lacks `coupons.manage` permission. |
| Coupon endpoint returns **404** | Feature code not deployed on this box (redeploy backend). |
| `GET /cart` doesn't include a `coupon` block | Backend not deployed; the cart endpoint is missing the additive field. |
| Applied coupon doesn't affect total at POS | POS endpoint not deployed or `couponCode` not wired into the sale controller. |
| Coupon applies but checkout fails with "Exhausted" | The coupon's total cap has been hit; use a different coupon or create a new one. |
| Concurrent orders oversell a coupon cap | Redemption claiming not deployed correctly (likely backend-only issue; escalate). |
| Prepaid order burns coupon even after abandonment | Release-on-abort hook not wired or sweeper cron not running (escalate to backend). |

---

## Edge cases to verify

- **Stale coupon in a persisted cart** (expires or min order unmet): `GET /cart` shows `valid: false` with a message, prices without the coupon, but `couponCode` is still persisted (not silently cleared).
- **Coupon amount larger than cart total:** clamped to the subtotal; the payable is never negative or zero (charges-only minimum).
- **Free-gift lines (₹0) never discounted:** included in the cart but excluded from the coupon's discount basis and allocation.
- **Coupon + automatic discount interaction:** coupon replaces, never stacks; the preview shows both numbers so the customer knows.
- **Scheduled coupons (future start date):** treated as inactive; error "This coupon code isn't valid" (same as disabled).
- **Multiple stores, store-specific coupon:** applies only in the scoped store; other stores see "invalid code".
- **First-order-only coupon for repeat customers:** error "This coupon is for new customers only" (reason `NOT_FIRST_ORDER`).

---

## 11. Coupon Discoverability — Offers screen (Phase 1 backend + admin, Phase 2 Android, Phase 3 iOS)

**Status: BUILT 2026-08-27** — Phase 1 (backend + admin), Phase 2 (**Android** Offers screen) and the **iOS** half of Phase 3 are complete. Web is not built.

**What Phase 1 ships:** A boolean `visible` field on every coupon (defaults `false`/hidden), a toggle in the admin form, a new read-only backend endpoint `GET /user/coupon/available` that lists eligible visible coupons for a specific customer.

**What Phase 2 ships:** The **Android** Offers screen — sections A–E below are the API/admin walkthrough, **section F is the Android app walkthrough**. Web still has no UI; there the list can only be seen via curl/Postman.

**What Phase 3 (iOS) ships:** the same Offers screen on iOS — **section G**. Same card states, same copy, same API; only the two platform-specific navigation differences listed there.

---

### ✅ A. Admin — create a coupon as Hidden (default), then toggle Visible

1. Log in as super-admin to `damin.haper.in` → navigate to **Admin → Coupons**.
2. Click **Create coupon**.
3. Fill in the form: code `PUBLIC50`, ₹50 flat discount, min order ₹200, enabled on, etc. (any valid coupon shape).
4. **Expect:** at the bottom of the form, a section **"Visible in the app's Offers screen"** with a toggle showing **Hidden** (OFF), and helper text: "Hidden coupons still work when the customer types the code."
5. **Do NOT toggle it yet.** Save the coupon.
6. **Expect:** coupon is created and appears in the list.
7. Look at the coupon row in the list.
8. **Expect:** a badge showing **Hidden** next to the code name.
9. Now click **Edit** on that coupon.
10. **Expect:** the toggle reads **Hidden** (OFF).
11. Click the toggle to turn it **Visible** (ON).
12. **Expect:** the label next to the toggle changes to **Visible**.
13. Save the changes.
14. **Expect:** the list row now shows **Visible** badge instead of **Hidden**.
15. Edit the coupon again.
16. **Expect:** the toggle still reads **Visible** (ON) — the saved state persists.
17. Toggle it back to **Hidden**.
18. **Expect:** the badge in the list updates to **Hidden** again instantly (no page reload needed).

### ✅ B. Admin — test the Visible/Hidden badge in the coupon list

1. Create two coupons:
   - `SECRET_CODE` (Hidden, the default)
   - `PUBLIC_SALE` (create and immediately toggle Visible)
2. View the coupon list.
3. **Expect:** both rows show their badge:
   - `SECRET_CODE` row: **Hidden** badge
   - `PUBLIC_SALE` row: **Visible** badge
4. The badge is just informational (no action); clicking the row opens the edit form.

### ✅ C. Admin — existing coupons default to Hidden on first load after deploy

1. **On the **first run** after the feature is deployed**, fetch the coupon list.
2. **Expect:** every coupon that existed before the feature (or was created without explicitly setting `visible`) reads as **Hidden** in the admin UI.
3. **Rationale:** a coupon that was only ever meant for a select audience (referral partners, influencers) must never become public by accident on deploy day.

---

### ✅ D. New endpoint — list visible eligible coupons (raw API call)

**Note:** This endpoint is tested via raw API calls (curl/Postman) on dev since no client UI exists yet (Phase 2/3). The endpoint is `GET /user/coupon/available` and requires a customer token + `x-store-id` header.

#### Setup
1. Create two coupons on admin:
   - `VISIBLE_CODE` (₹50 off, min ₹200, enabled, **Visible** toggle ON)
   - `HIDDEN_CODE` (₹50 off, min ₹200, enabled, **Visible** toggle OFF)
2. Ensure both are scoped to the **same store** where you'll test (Global scope is fine).
3. Get a valid **customer JWT token** (log in as a customer, copy the auth token).
4. Know the **store ID** where you logged in (from the store header or admin).

#### Test: Visible coupon appears, Hidden coupon does NOT (leak test)

1. Make a raw **GET** request with curl or Postman:
   ```
   GET https://dapi.haper.in/user/coupon/available
   Headers:
     Authorization: Bearer <CUSTOMER_JWT>
     x-store-id: <STORE_ID>
   ```
2. **Expect:** **HTTP 200** with response body:
   ```json
   {
     "msg": "Offers fetched successfully",
     "data": {
       "coupons": [
         {
           "code": "VISIBLE_CODE",
           "description": "...",
           "discountType": "FLAT",
           "discountValue": 50,
           "discountSummary": "₹50 off",
           "minOrderValue": 200,
           "eligibleNow": true,
           "shortBy": 0,
           "message": null,
           "estimatedDiscount": 50,
           "expiresAt": "2026-12-31T..."
         }
       ],
       "cartSubtotal": 0
     }
   }
   ```
3. **CRITICAL:** the response includes **ONLY** `VISIBLE_CODE`. `HIDDEN_CODE` is **completely absent** — even though it is eligible, enabled, and in-scope for this customer. This is the feature's core safety guarantee: a hidden coupon NEVER leaks into the Offers list.
4. ❌ **Regression:** if `HIDDEN_CODE` appears in the response, the `visible` filter is broken or was reverted — escalate immediately (business/secrecy risk).

#### Test: Below-minimum coupon shows with a gap message

1. Create coupon `ALMOST` (₹50 flat, min ₹500, enabled, **Visible**).
2. As the same customer, call `GET /user/coupon/available` again.
3. **Expect:** the `ALMOST` coupon appears in the list with:
   - `"eligibleNow": false`
   - `"shortBy": 500` (example: if customer's current cart is ₹0, the shortBy is the full min order value)
   - `"message": "Add ₹500.00 more to use ALMOST."`
   - `"estimatedDiscount": 0` (because it's not eligible now)
4. This is the "near-miss" case: show the coupon so the customer knows what to spend to unlock it.

#### Test: Expired or disabled coupon does NOT appear

1. Create coupon `DISABLED_TEST` (enabled OFF, **Visible**).
2. Create coupon `EXPIRED_TEST` (enabled ON, **Visible**, end date in the past).
3. Call `GET /user/coupon/available` again.
4. **Expect:** neither `DISABLED_TEST` nor `EXPIRED_TEST` appears in the list.
5. **Rationale:** they are genuinely unusable, not just a near-miss — showing them is a tease.

#### Test: Total cap and per-customer cap filter advisories

1. Create coupon `CAP_TEST` (₹50 off, total limit 2, per-customer limit 1, **Visible**).
2. As **Customer A**, call the endpoint.
3. **Expect:** `CAP_TEST` appears in the response.
4. As Customer A, apply and complete an order with `CAP_TEST`.
5. As Customer A, call `GET /user/coupon/available` again.
6. **Expect:** `CAP_TEST` **does NOT appear** — the per-customer limit (1) has been reached (advisory filter).
7. As a **different Customer B**, call `GET /user/coupon/available`.
8. **Expect:** `CAP_TEST` **still appears** — per-customer limits are per customer, never shared.
9. Have Customer B also apply and order with `CAP_TEST`.
10. Now **both** customers have used it once. As a **third Customer C**, call the endpoint.
11. **Expect:** `CAP_TEST` **still appears** for Customer C (they haven't used it yet, so no per-customer block).
12. When Customer C applies it and the order closes, the coupon's `usedCount` becomes 2 (matching the total limit).
13. As a **fourth Customer D**, call `GET /user/coupon/available`.
14. **Expect:** `CAP_TEST` **does NOT appear** — the total limit (2) has been exhausted (advisory filter).

#### Test: Empty cart is a valid state

1. As a logged-in customer with an **empty cart**, call `GET /user/coupon/available`.
2. **Expect:** **HTTP 200** (not an error), `data.cartSubtotal: 0`.
3. Coupons with `minOrderValue > 0` still appear with `eligibleNow: false` and `shortBy: <min_value>`.
4. Coupons with no minimum (`minOrderValue: 0`) appear with `eligibleNow: true`, `shortBy: 0`, `message: null`.
5. **Rationale:** a customer browsing Offers before shopping still deserves to see what they could get if they add items.

#### Test: Store-specific coupon scope is honored

1. You have stores A and B (different `storeId`s).
2. Create coupon `STORE_A_ONLY` (scope: Store A only, **Visible**).
3. As a customer in **Store A**, call `GET /user/coupon/available` with `x-store-id: <STORE_A_ID>`.
4. **Expect:** `STORE_A_ONLY` **appears** in the list.
5. As the same customer in **Store B**, call `GET /user/coupon/available` with `x-store-id: <STORE_B_ID>`.
6. **Expect:** `STORE_A_ONLY` **does NOT appear** (scope mismatch).

#### Test: Kill switch empties the list

1. Set environment variable `COUPONS_KILL_SWITCH=true` on the backend (or equivalent in your deployment).
2. Call `GET /user/coupon/available`.
3. **Expect:** **HTTP 200** with `data.coupons: []` (empty list, no error).
4. All coupons disappear from the list automatically.
5. Remove/unset the env var.
6. **Expect:** coupons reappear on the next call (no backend restart needed).

#### Test: No token or missing store header

1. Call `GET /user/coupon/available` **without** an Authorization header.
2. **Expect:** **HTTP 401** (not authenticated).
3. Call `GET /user/coupon/available` **with** a token but **without** the `x-store-id` header.
4. **Expect:** **HTTP 400** from the geo middleware (existing behavior for any `/user/*` path).

#### Test: Offers degrades to fewer cards, never to a broken screen (security-audit fixes, 2026-08-27)

The Offers list must never return a 500. If any single upstream read fails, that one card disappears
and the rest of the list still renders. These are hard to force by hand on dev — the automated suite
proves each one (`packages/user/__tests__/coupon-offers.test.js`, section 6b) — but if you can force
a failure (e.g. temporarily point the backend at an unreachable DB), the expectations are:

1. The coupon list query fails → **HTTP 200** with `data.coupons: []`, not a 500.
2. The first-order check fails → **HTTP 200**; a "first order only" coupon is **hidden** (fail closed,
   so the list never advertises something checkout would refuse); every other coupon still shows.
3. One coupon's eligibility check or card build fails → **HTTP 200**; only that coupon is missing.
4. ❌ **Regression:** any 500 from `GET /user/coupon/available` is a bug — an empty list is a success.

#### Test: Server errors don't leak internal detail in production

1. On a **production-mode** backend, force any unhandled server error on any `/user/*` or `/admin/*`
   route (e.g. a DB outage).
2. **Expect:** the response body's `message` is exactly `"Something went wrong. Please try again."` —
   no mongo index names, file paths or replica-set/host names anywhere in the body.
3. **Expect:** the full original error is still in the server logs (unchanged logging).
4. **Expect:** 4xx messages are **untouched** — "Coupon not found", validation messages and
   "Add ₹120.00 more to use MONSOON20." must still reach the user verbatim, in production too.
5. On dev (`NODE_ENV != production`) the detailed message is still shown — that is the existing
   convention and is intentional.

---

### ✅ E. Regression — hidden coupon still works when typed manually

1. On the cart/checkout screen, manually type the code `HIDDEN_CODE` (the one you created as Hidden in §D).
2. Tap **Apply** (or use the existing `POST /cart/coupon/apply` endpoint).
3. **Expect:** coupon applies successfully, full ₹50 off, no error about visibility.
4. ❌ **Regression:** if it fails with "not found" or any error, the `visible` field broke the manual apply flow — it must not affect the typing path at all.
5. **Rationale:** a hidden coupon is "code-only" — it still works perfectly when you know the code and type it. The `visible` field **only** gates appearing in the Offers list; it is never consulted on the apply path.

---

### ✅ F. Phase 2 — Offers screen on ANDROID (built 2026-08-27)

**Android has the Offers screen** (iOS too — see section G; web too — see section H).

Needs the Phase 1 backend deployed to dev. Against an OLD backend (endpoint 404s) the Android screen
shows its "Couldn't load offers" error card with a Retry button — never a crash and never a blank
screen.

#### Test: the two entry points

1. Open the app, add items to the cart, open **Cart**.
2. **Expect:** in the **Coupon** card, under the code input + Apply row, a **"View offers →"** text link.
3. Type and apply any valid code so the coupon card flips to its applied state.
4. **Expect:** the "View offers" link is **gone** (entry state only — Remove the coupon to get it back).
5. Open **Profile**.
6. **Expect:** under **Preferences**, a first row **"Offers & Coupons" / "See what you can save right now"** with a ticket icon, directly under the Wallet tile. Tapping it opens Offers.

#### Test: the three card states

1. Mark `MONSOON20` (20% off, min ₹499) **Visible** in the admin.
2. With a cart at **₹379**, open Offers from the Cart link.
3. **Expect:** a context line **"Your cart: ₹379"** at the top, and the `MONSOON20` card in the
   **near-miss** state: an **amber** "₹120 more to go" tag, the server's sentence
   "Add ₹120.00 more to use MONSOON20.", and a **"Continue shopping"** outline button (NOT Apply).
   The card must NOT look greyed-out or red — being ₹120 short is not an error.
4. Tap **Continue shopping**. **Expect:** you land on the Home tab.
5. Add enough to cross ₹499, open Offers again.
6. **Expect:** the card is now **eligible** — a green **"✓ Eligible"** tag, a green
   "Saves you ₹X on this order" line, a green-tinted card border, and a filled
   **"Apply — Save ₹X"** button.
7. Empty the cart entirely and open Offers from **Profile**.
8. **Expect:** **no** "Your cart: ₹0" line (it is hidden on an empty cart), no amber gap tag, and
   every card shows "Add items to your cart, then apply this at checkout." with a
   **"Copy code"** button instead of Apply.
9. Tap **Copy code**. **Expect:** the button label swaps to **"Copied"** for ~1.5s and back; you stay
   on Offers. Long-press any text field and paste — the code pastes.

#### Test: tap to apply (the happy path)

1. Cart above the minimum, open Offers from the Cart's "View offers" link.
2. Tap **"Apply — Save ₹X"** on an eligible card.
3. **Expect:** that button shows a spinner + **"Applying…"**; other cards' Apply buttons go disabled
   for the moment (one coupon call at a time).
4. **Expect:** on success you are taken **straight back to the Cart**, where the Coupon card now
   shows the applied code, the green "You saved ₹X" chip, a **Remove** button, and the
   "Coupon discount" row in Bill Details.
5. Entering from **Profile** instead: applying takes you to the **Cart** screen (not back to Profile).

#### Test: the coupon runs out between listing and tapping

1. Set a coupon's total limit to 1 and have another customer use it up while your Offers screen sits open.
2. Tap **Apply** on that card.
3. **Expect:** you **stay on Offers**. The server's own refusal sentence appears in amber on that card,
   and the list re-fetches — the exhausted card disappears (or updates) instead of sitting there
   promising a discount that no longer exists.

#### Test: empty vs error must look different

1. Turn every coupon **Hidden** in the admin, open Offers.
2. **Expect:** the friendly empty state — **"No offers right now"** / "Check back soon — we add new
   offers all the time." with a **Continue shopping** button.
3. Turn airplane mode on and open Offers.
4. **Expect:** a clearly different card — **"Couldn't load offers"** with a **Retry** button. Turn
   the network back on and tap Retry; the list loads.
5. ❌ **A network failure must NEVER render as "No offers right now"** — that would tell a customer
   there is nothing for them when the truth is the app could not ask.

#### Test: nothing else on Cart or Profile changed

1. Typing a code by hand on the Cart still works exactly as before (including a **Hidden** code).
2. Remove still works; the Bill Details rows are unchanged.
3. The Profile screen's Wallet/Referral tiles, Saved Addresses, Notifications, Help rows and Log Out
   all behave as before — the Offers row is purely additive.

---

### ✅ F2. Android — Offers screen review fixes (built 2026-08-27)

Follow-up to §11 F, from a code review of that same build. Files:
`app/src/main/java/com/bheldi/ui/screens/offers/{OffersScreen,OffersViewModel}.kt`,
`app/src/main/java/com/bheldi/ui/screens/cart/CartViewModel.kt`.

1. **Both entry points still land correctly:** open Offers from the Cart's "View offers" link and
   separately from Profile's "Offers & Coupons" row. **Expect:** identical screen, three card states
   (eligible / near-miss / copy-only-on-empty-cart) exactly as in §11 F, and tap-to-apply from either
   entry point lands you back on **Cart** with the coupon shown applied (Profile does not stay on
   Profile).
2. **Double-tap on Apply doesn't lose the spinner:** on an eligible card, tap **Apply** twice as fast
   as you can (two taps in the same gesture, before the button visibly disables).
   **Expect:** exactly **one** apply request goes out — the button shows the spinner + "Applying…"
   throughout, and does **not** flicker back to an enabled "Apply" state while the first request is
   still in flight. It resolves normally (success → Cart, or failure → error shown) once, not twice.
3. **Already-applied coupon from Profile:** apply a coupon from the Cart, then open Offers again from
   **Profile** (still showing eligible-tag cards). **Expect:** the card for the code you already have
   applied shows a disabled **"✓ Applied"** button instead of "Apply — Save ₹X" — tapping elsewhere on
   the card does nothing; no re-apply call is made. Every other card's Apply button behaves normally.
4. **Apply-failure toast survives the card disappearing:** set a coupon's total limit to 1, exhaust it
   from another customer while your Offers screen sits open, then tap Apply on that card (as in §11 F's
   "coupon runs out between listing and tapping" test). **Expect:** in addition to that test's existing
   behaviour, a **toast** with the server's refusal sentence appears — and stays legible even in the
   split second the list-refresh removes that card from view (previously the message could disappear
   with the card before it was read).
5. **A failed background refresh isn't silent:** with a coupon applied and the Offers list already
   showing cards, force the *next* refresh to fail (airplane mode right after an apply attempt that
   also triggers the refresh). **Expect:** a toast reporting the failure, and the existing (now stale)
   cards stay on screen rather than the whole screen going blank or silently doing nothing. This is
   separate from §11 F's "empty vs error" full-screen state, which is unaffected — that still gates on
   an empty list.
6. **Near-miss card never shows "Add ₹0 more":** on a near-miss card where the server response has no
   `message` and no `shortBy` (rare, only reachable via a malformed/older API response), the card shows
   its amber "more to go" tag with no explanatory line underneath, instead of a nonsense "Add ₹0 more to
   use CODE." sentence.
7. **Cart coupon-error no longer goes stale across entry points:** on Cart, type a bad code (e.g.
   `DOESNOTEXIST`) so the red inline error shows under the input. Now go to **Offers** and successfully
   apply a different, valid coupon. **Expect:** you land back on Cart in the **applied** state (no error
   visible, since the applied view replaces the input+error view). Tap **Remove**. **Expect:** the entry
   state reappears with a **clean** input — the old red error from the bad code you typed earlier does
   **not** resurface.

`./gradlew assembleDebug` and `./gradlew testDebugUnitTest` both pass with no new warnings.

---

### ✅ F3. Android — Offers screen typed-entry-row fixes (built 2026-08-28)

Second-round code review of the same Offers screen, on the on-screen **typed code entry row**
(the field at the top of Offers, separate from the per-card Apply buttons). Files:
`app/src/main/java/com/bheldi/ui/screens/offers/OffersScreen.kt`,
`app/src/main/java/com/bheldi/ui/screens/cart/CartViewModel.kt`.

1. **Typed-code success now gives feedback:** on Offers, type a valid, currently-unlisted coupon code
   into the entry row (one not shown as a card below) and tap **APPLY**. **Expect:** you land on
   **Cart** with the coupon applied — same landing behaviour as tapping Apply on a card — instead of
   the input silently clearing with no navigation.
2. **Typed-code error still displays correctly:** type a bad code (e.g. `DOESNOTEXIST`) into the entry
   row and tap **APPLY**. **Expect:** a red error message appears **fully readable** below the field
   (not clipped/squeezed) — the field grows to fit the error text.
3. **Notch is now a real cutout:** open Offers with at least one coupon card showing. **Expect:** each
   card has two small semicircular notches cut into its left/right edges (a "ticket" look) that show
   the **screen background showing through**, not a same-colour circle sitting on top — look closely at
   the card's shadow near the notch: the shadow is also interrupted there, confirming it's a real
   cutout and not an overlay.
4. **Typed-apply spinner has a TalkBack label:** with TalkBack on, tap APPLY on the entry row while a
   request is in flight. **Expect:** TalkBack announces "Applying coupon" (not silence) while the
   spinner shows, and "Apply coupon" when idle.
5. **Typed-apply in flight disables card buttons too:** type a valid code, tap APPLY, and *before* it
   resolves, try tapping Apply on one of the coupon cards below. **Expect:** the card's Apply button is
   disabled (not tappable) while the typed request is still in flight — no flash-then-vanish spinner on
   the card.

`./gradlew assembleDebug` passes with no new warnings.

---

### ✅ G. Phase 3 — Offers screen on iOS (built 2026-08-27)

Everything in section F applies to iOS unchanged (same three card states, same copy, same
empty/error/loading states, same apply behaviour). Test iOS with section F's steps, plus the
platform differences below.

Needs the Phase 1 backend deployed to dev. Against an OLD backend (endpoint 404s) the iOS screen
shows "Couldn't load offers" + **Retry** — never a crash, never a blank screen.

#### iOS-only differences to check

1. **Where the entry points are.** Cart → the **Coupon** card, a **"View offers →"** link under the
   code input + Apply row (entry state only; apply a coupon and the link disappears with the input).
   Profile → **Preferences** section, first row **"Offers & Coupons" / "See what you can save right
   now"** with a ticket icon, directly under the Wallet tile.
   ❌ There is **no** entry point on iOS **Checkout** — the iOS Checkout screen has no coupon input
   at all (it only shows the applied-coupon bill row), so there is nothing to sit beside. This is
   correct, not a missing piece.
2. **It is a pushed screen, not a sheet.** Offers slides in from the right with an "Offers" title and
   a back chevron; the **swipe-back-from-left-edge gesture must work**. If it appears as a
   bottom sheet, that is a bug.
3. **"Continue shopping" from the Cart entry point closes the whole Cart sheet** (the Cart is itself
   a sheet on iOS), landing you back on the catalog you were browsing. From the **Profile** entry
   point the button reads **"Start shopping"** and switches to the **Home** tab.
4. **Apply success, Cart entry point:** pops back to the Cart sheet immediately, where the Coupon
   card already shows the applied code + "You saved ₹X" + Remove — that IS the confirmation, so
   no extra state is shown on Offers itself.
   **Apply success, Profile entry point (fixed 2026-08-27):** dismiss()ing straight back to the
   Profile menu gave **zero confirmation** the coupon actually applied — the screen just vanished.
   Fixed: the applying card now flashes a green **"✓ Applied"** state (checkmark + "Applied", same
   row height as the Apply button) for ~0.9s before the screen pops back to Profile. ❌ Bug if,
   from Profile, the screen pops immediately with no flash, or if the flash appears when Offers was
   opened from the **Cart** entry point (Cart must still pop immediately, unchanged).
5. **Copy code** puts the code on the iOS pasteboard; the button label swaps to "Copied" for ~1.5s.
   With VoiceOver on, an announcement "Coupon code X copied" is spoken.
6. **Pull-to-refresh** on the Offers list re-fetches and now genuinely **awaits** the fetch (fixed
   2026-08-27 — previously `.refreshable`'s spinner retracted immediately because the closure
   wasn't `async`, so no loading indicator showed during the refresh). ❌ Bug if the pull spinner
   snaps back before the list visibly updates on a slow connection. Leaving and re-entering the
   screen always re-fetches too — a stale list is never shown.
7. VoiceOver on an eligible card's button reads **"Apply MONSOON20, save 75 rupees"**, not a bare
   "Apply" — so several offers can be told apart without reading each card.
8. **Shortfall/min-order amounts round UP, never down (fixed 2026-08-27).** On a near-miss card,
   the **"₹X more to go"** tag and the **"Min. order ₹X"** meta line both round the raw amount **up**
   to the next rupee (`10.40` → shows `11`, not `10`). Verify: get a cart exactly ₹10.40 short of a
   coupon, open Offers. **Expect:** the tag reads **"₹11 more to go"**, matching (or exceeding) the
   server's own `message` text ("Add ₹10.40 more…") right below it — never a lower number than the
   message implies. Add exactly ₹10 (trusting an under-rounded tag would have been the bug) and
   confirm the card is **still** in the near-miss state, not eligible. Then add ₹11 total and confirm
   it flips to eligible.

#### Test: nothing else on iOS Cart or Profile changed

1. Typing a code by hand on the Cart works exactly as before, including a **Hidden** code, the
   "coupon is worse than your automatic discount" advisory, and Remove.
2. Profile's Wallet/Referral tiles, Saved Addresses, Notifications, Help rows and Log Out are
   unchanged — the Offers row is purely additive.

---

### ✅ H. Phase 4 — Offers page on WEB (built 2026-08-27)

Same three card states, same copy, same empty/error/loading states as Android/iOS (sections F/G) —
test with those steps, plus the web-only notes below.

Needs the Phase 1 backend deployed to dev. Against an OLD backend (endpoint 404s) the web page shows
"Couldn't load offers" + **Retry** — never a crash, never a blank screen.

#### Test: the two entry points

1. Open the site, add items to the cart, go to **Checkout**.
2. **Expect:** in the **Coupon** section, under the code input + Apply row, a **"View offers →"**
   text link.
3. Type and apply any valid code so the coupon section flips to its applied state.
4. **Expect:** the "View offers" link is gone (entry state only — Remove the coupon to get it back).
5. Open **Profile**.
6. **Expect:** under Preferences, a row **"Offers & Coupons" / "See what you can save right now"**
   with a ticket icon, directly under the Wallet tile. Clicking it navigates to `/offers`.

#### Test: the card states

1. Mark a coupon **Visible** in the admin with a min order above your current cart.
2. Open Offers from the Checkout link. **Expect:** a "Your cart: ₹X" line at the top and the card in
   the **near-miss** state (amber gap tag, server's sentence, "Continue shopping" button — no Apply).
3. Add enough to cross the minimum, reopen Offers. **Expect:** **eligible** state — green "✓
   Eligible" tag, green-tinted border, and (only when the discount is actually > ₹0) a "Saves you
   ₹X" line above a filled "Apply — Save ₹X" button. A coupon that is eligible but computes to a ₹0
   discount (margin-guard clamp) must show a bare **"Apply"** button with no "Saves you ₹0.00" line.
4. Empty the cart, open Offers from Profile. **Expect:** no "Your cart" line, every card in
   **empty-cart** state ("Add items to your cart, then apply this at checkout." + "Copy code"
   button). Clicking Copy code shows "Copied" for ~1.5s, then reverts.

#### Test: tap to apply (the happy path)

1. Cart above the minimum, open Offers, click **"Apply — Save ₹X"** on an eligible card.
2. **Expect:** that button shows a spinner + "Applying…"; every other card's Apply button is also
   disabled while the call is in flight (one coupon call at a time, whole-page not just the tapped
   card).
3. **Expect:** on success you land on **Checkout**, where the coupon section shows the applied code
   and the "Coupon discount" row in Bill Details.

#### Test: the coupon runs out between listing and tapping

1. Set a coupon's total limit to 1 and have another session use it up while your Offers page sits
   open.
2. Click Apply on that card.
3. **Expect:** you stay on Offers. The server's refusal sentence appears in amber **on that card and
   stays visible** — the list quietly re-fetches behind it (no skeleton flash), so you never lose the
   message even if the exhausted coupon disappears from the refreshed list.

#### Test: empty vs error must look different

1. Turn every coupon Hidden in the admin, open Offers. **Expect:** "No offers right now" / "Check
   back soon" with a Continue shopping button.
2. Simulate a network failure (devtools offline) and open/reload Offers. **Expect:** "Couldn't load
   offers" with a Retry button; going back online and clicking Retry loads the list.
3. ❌ A network/store-resolution failure must never render as "No offers right now".

#### Test: the store-header fix (fresh login)

1. Log out (clearing any cached store), then log back in and navigate straight to `/offers` (via
   Profile or the Checkout link) without visiting Home first.
2. **Expect:** Offers loads normally — no "Could not find a store for you" error and no stuck Retry
   loop. (`/user/coupon/available` now resolves the store header the same way `/user/cart/*` does.)

#### Test: nothing else on Checkout or Profile changed

1. Typing a code by hand on Checkout still works exactly as before, including a Hidden code, the
   "coupon is worse than your automatic discount" advisory, and Remove.
2. Profile's Wallet/Referral tiles, Saved Addresses, Notifications, Help rows and Log Out are
   unchanged — the Offers row is purely additive.


---

## 12. Web — order detail shows CART prices on a coupon order (built 2026-08-28)

**What was wrong.** On a coupon order the backend deliberately spreads the coupon's ₹ down into
each line's stored `salePrice` (for COGS/accounting) — correct backend behaviour, unchanged. But
`haper-web`'s order-detail page displayed that allocated `salePrice`, so the same order looked
cheaper per item than it did in the cart. Real example: cart showed "Abhi Cashews Kaju ₹239
(struck ₹330)" + a "-₹50" coupon line; order detail showed "₹203" and an Item Total of ₹283.
Only the Grand Total (₹284) was right.

**The fix (web only, `pages/OrderDetail.tsx`).** When the order carries a coupon, the page now
shows the preserved pre-coupon price (`originalSalePrice`) per item and subtracts the coupon once,
as its own bill row — exactly like the cart. Nothing else changed.

**Files:** `haper-web/pages/OrderDetail.tsx` only (no backend, no schema, no other client).

### ✅ A. A coupon order now matches the cart

1. Add items to cart, apply a coupon, note each item's price and the bill rows, place the order.
2. Open the order from Orders → order detail.
3. **Expect** — every per-item price is the SAME number the cart showed (e.g. ₹239, ₹94), struck
   through against catalog MRP (₹330, ₹100) where MRP is higher.
4. **Expect** the bill summary reads:
   - `Item Total ₹333` (gross, the sum of the item prices above)
   - `Coupon <CODE>  -₹50` (a real subtraction now, not "you saved ₹50")
   - `Delivery ₹0` (row hidden when 0) · `Platform Fee ₹1`
   - `Grand Total ₹284`
5. **Expect the arithmetic to close exactly:** 333 − 50 + 0 + 1 = 284. Grand Total must be the same
   number it was before this change.

### ✅ B. An automatic-discount order is UNCHANGED

The automatic-discount engine and coupons never both apply to one order, and for automatic
discounts the reduced `salePrice` genuinely IS the price paid.

1. Place an order with an automatic discount rule active and NO coupon code.
2. **Expect** exactly the old display: the discounted price in bold with the pre-discount price
   struck through, `Item Total` = the net amount, and the informational
   `Discount — you saved ₹X` note (NOT a `-₹X` subtraction).

### ✅ C. A plain order (no coupon, no discount) is UNCHANGED

1. Place an order with no coupon and no discount rule.
2. **Expect** no strikethrough, no discount/coupon row, Item Total and Grand Total as before.

### ✅ D. Free gift-with-purchase still renders as FREE

1. Place a coupon order that also earns a free gift.
2. **Expect** the gift line still shows the `FREE` badge (never ₹0.00, never a price, never `NaN`),
   contributes nothing to Item Total, and the `Free gift` row in the bill summary still appears.
3. **Expect** the arithmetic still closes (gross Item Total − coupon + fees = Grand Total).

### ❌ Edge cases

- **Legacy coupon order with no `originalSalePrice` on its lines** (placed before the promotions
  snapshot existed): the page must FALL BACK to the old display (net prices + the informational
  "you saved ₹X" note). The new gross layout only activates when gross − coupon reconciles exactly
  to the server's net item total (±₹0.01), so a Grand Total can never stop adding up.
- **Coupon with `discountAmount` 0** — treated as no coupon; old display.
- **Float dust:** per-item and Item Total figures are rounded to 2dp for display, so a line like
  ₹33.33 × 3 shows ₹99.99, never ₹99.99000000000001.

### Deploy

`haper-web` only. Verified with `npx tsc --noEmit` (clean) + `npm run build` (succeeds) — that is
the whole gate for this repo (no eslint, no test suite). Prod is a manual user-driven deploy.

---

## 13. Admin — Order Details shows CART prices on a coupon order (built 2026-08-28)

Same bug as §12, other surface. The admin panel's **Order Details** modal read each line's
allocated (post-coupon) `salePrice`, so store staff reconciling an order against what the customer
actually saw got different numbers: item ₹203 instead of ₹239, Subtotal ₹283 instead of ₹333.
Backend behaviour is correct and **unchanged** — the coupon is deliberately spread into each
line's `salePrice` for COGS/refunds/invoices.

**The fix (admin only).** When an order carries a coupon AND the arithmetic reconciles, the modal
shows the preserved pre-coupon price (`originalSalePrice`) per item, a gross Subtotal, and the
coupon as one real `-₹X` row right under Subtotal. Cost / P/L / profit columns and the wallet
refund preview still use the net `salePrice` — accounting is untouched.

**Files:**
- `haper-admin/src/utils/orders.ts` — new helpers `orderHasCoupon`, `getGrossUnitPrice`,
  `getGrossSubTotal`, `getCouponDiscountAmount`, `usesCouponGrossDisplay`; `normalizeOrder` gains an
  additive `grossSubTotal` (the existing `subTotal` is byte-for-byte unchanged for every other screen).
- `haper-admin/src/pages/Orders/OrderDetailsModal.tsx` — item Price/Total cells, Subtotal row, and
  the coupon row (informational → real subtraction, for coupon orders only).

### ✅ A. A coupon order now matches the customer's cart

1. On `damin.haper.in`, open an order that used a coupon (e.g. `RAUNAK50`).
2. **Expect** per-item Price = the catalog price the customer saw (₹239, ₹94), NOT ₹203.11 / ₹79.89.
3. **Expect** the Payment card reads: Subtotal ₹333 → `Coupon RAUNAK50: -₹50` → Platform Fee ₹1 →
   Total ₹284. The arithmetic must close: 333 − 50 + 0 + 1 = 284.
4. **Expect** Total, Payment status and everything else are the same numbers as before the change.

### ✅ B. An automatic-discount order is UNCHANGED

1. Open an order discounted by a **discount rule** (no coupon code).
2. **Expect** per-item prices are still the reduced `salePrice` (that IS the real sale price here),
   Subtotal is still the net figure, and the row still reads `Discount applied: customer saved ₹X`
   — never `-₹X`. A coupon and an automatic rule never both apply to one order.

### ✅ C. A plain order (no coupon, no discount) is UNCHANGED

1. Open any normal order. **Expect** the modal is identical to before (no coupon row at all).

### ✅ D. Super-admin money columns still show cost truth

1. As super-admin, open the coupon order from A.
2. **Expect** the Cost and P/L columns, and the Cost Price / Profit block, are unchanged — they
   still use the net `salePrice`, so profit does NOT jump by ₹50.

### ❌ Edge cases

- **Legacy coupon order with no `originalSalePrice` on its lines:** the modal FALLS BACK to the old
  display (net prices + the informational `Coupon <CODE>: customer saved ₹X`). The new layout only
  activates when gross − coupon lands on the server's net Subtotal within ₹0.01, so a Total can
  never stop adding up. Same gate as web (§12).
- **Free gift line:** still renders `FREE`, contributes ₹0 to the gross Subtotal.
- **Editing items on a coupon order:** the table shows gross prices while the "To be refunded"
  preview stays on the net `salePrice` — the refund is what the customer actually paid, so these
  two figures differ by design on a coupon order.

### Deploy

`haper-admin` only. No backend, no migration. Verified with `npx tsc -b` (clean for the touched
files) + `npx vitest run` (only the known unrelated `TransfersPage` failure) + `npm run build`.
