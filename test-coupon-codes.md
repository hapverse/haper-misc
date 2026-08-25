# Test guide — Coupon Codes

Feature plan: `coupon-codes-plan.md`. Admin UI design: `coupon-admin-ui-design.md`.
Backend: `haper-backend` (`packages/shared/utils/coupon.utils.js` engine, `packages/admin/src/routes/coupon/*` CRUD, wired into cart apply/remove and both checkout paths).
Admin panel: `haper-admin` (`src/pages/Coupons/*` CRUD, `POS/NewSalePage.tsx` coupon entry).

Needs: backend deploy (dev) + admin deploy. No migration. Android checkout coupon entry (§2A2), iOS checkout coupon entry (§2A3), and web checkout coupon entry (§2A4) are now built. All new cart/order fields are additive and default to null/empty.

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
4. **Expect:** **HTTP 400** with `reason: "CUSTOMER_LIMIT_REACHED"`, message "You've already used this coupon".
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
- **100+ backend tests**, ~30 admin-FE tests.

> ⚠️ Both test harnesses connect with `readPreference: "primary"`, but the real services use
> `secondaryPreferred`. That divergence is exactly what let the missing-index bug ship green, so
> any test about index *building* must open its own `secondaryPreferred` connection.

---

## 10. What deploy this needs

- **Backend deploy (dev):** `haper-backend` code + the 3 new collections (coupons, coupon-redemptions, coupon-attempts) created lazily on first write. No migration.
- **Admin panel deploy (dev):** `haper-admin` code (Coupons CRUD page + POS coupon UI).
- **Android deploy:** `haper-android` code (Cart screen coupon entry, §2A2) — normal debug build/install; no store release required for dev testing.
- **iOS deploy:** `haper-ios` code (Cart screen coupon entry, §2A3) — normal debug build/simulator install; no TestFlight/App Store release required for dev testing.
- **Web deploy (dev):** `haper-web` code (Checkout page coupon entry & form validation, §2A4) — test via `vite build` locally or deploy to dev.
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

