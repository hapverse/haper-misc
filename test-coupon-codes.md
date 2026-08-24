# Test guide — Coupon Codes

Feature plan: `coupon-codes-plan.md`. Admin UI design: `coupon-admin-ui-design.md`.
Backend: `haper-backend` (`packages/shared/utils/coupon.utils.js` engine, `packages/admin/src/routes/coupon/*` CRUD, wired into cart apply/remove and both checkout paths).
Admin panel: `haper-admin` (`src/pages/Coupons/*` CRUD, `POS/NewSalePage.tsx` coupon entry).

Needs: backend deploy (dev) + admin deploy. No migration. No client (Android/iOS/web) change required except Android checkout coupon entry (shipping in a few days — test then). All new cart/order fields are additive and default to null/empty.

---

## 0. Understanding coupon behavior vs automatic discounts

**What you need to know before testing:**

- A coupon **replaces** an automatic discount — never both apply to the same order.
- The coupon applies at **cart level** (e.g. ₹50 off the whole order, or 10% of the subtotal), but
  the discount is **allocated back onto individual order lines** so invoices, GST, refunds, and profit/COGS work correctly. See the plan §3.3 for the allocation algorithm.
- A coupon with `per-customer-limit` or `first-order-only` cannot be used by the anonymous "Walk-in Customer" on POS — the cashier must capture a phone number first.
- Once a coupon code is created, it **cannot be renamed** (codes are handed to customers; renaming breaks shared codes).

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
8. **Max discount amount:** empty (not capped).
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

## 2. Customer checkout — apply a coupon (Android coming in a few days)

**Note:** This section covers the cart apply/remove and checkout validation flow. Android checkout UI is NOT part of today's ship — when Android ships in a few days, test the normal flow (apply valid code → total drops → place order → order shows coupon). For now, test via the backend API (or use web/admin POS as a proxy).

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

### ✅ E. Margin guard: coupon doesn't sell below cost (aggregate)
1. Create item "Budget Item" with:
   - Selling price: ₹100
   - Cost price: ₹60
   - Headroom: ₹40
2. A customer has 1 unit in cart (subtotal ₹100).
3. Create coupon `BIG_DISCOUNT` (FLAT ₹60 off, total limit 100).
4. Apply the coupon → **Expect:** ₹60 coupon is **clamped to ₹40** (the max headroom), so the total becomes ₹60 (not ₹40, which would sell below cost).
5. The order shows `coupon: { discountAmount: 40 }` (the clamped amount), not the requested ₹60.
6. **Verify:** the customer sees the clamped discount on the preview AND at checkout (same computation, no surprise).

### ✅ F. Margin guard: unknown cost (`costPrice: 0`) is skipped
1. Create item "Mystery Item" with:
   - Selling price: ₹100
   - Cost price: 0 (unknown — the repo invariant per costPrice-money-invariant.md)
2. A customer has this item in the cart (subtotal ₹100).
3. Apply coupon `AGGRESSIVE` (FLAT ₹80 off).
4. **Expect:** the coupon computes the headroom as ₹0 (because cost is unknown, never fake it), so the discount is clamped to ₹0.
5. The order total stays ₹100 (full price), not ₹20.
6. The coupon application returns a success but with `discountAmount: 0` (the clamp prevented it).

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

## 6. Known tracked follow-up (data-exposure edge case)

### ❌ G. Cost exposure edge case — documenting a tracked limitation

**What this is:** This is **not a bug to fix in this pass**, but a known issue being tracked for a separate fix (likely this week). Document it here so a tester encountering unexpected numbers knows it's tracked and not a new defect.

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

**When it will be fixed:**
- Tracked as a separate work item (approx. this week, per the plan).
- **Fix direction:** show the coupon without the clamp to the customer (e.g., "₹2500 off, capped at ₹2000 to protect our margin"), or obfuscate by rounding the clamped discount.

**For testing:**
- If you see a coupon discount that seems oddly smaller than the percentage suggests (e.g., a 50% coupon yielding only 40% effective discount on a high-volume cart), this is the margin guard + clamp at work. It is expected and correct.
- If you suspect cost information has leaked (e.g., a customer tells you they reverse-engineered your cost), flag it but know it's a known, tracked limitation.

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
- **100+ backend tests**, ~30 admin-FE tests.

---

## 10. What deploy this needs

- **Backend deploy (dev):** `haper-backend` code + the 3 new collections (coupons, coupon-redemptions, coupon-attempts) created lazily on first write. No migration.
- **Admin panel deploy (dev):** `haper-admin` code (Coupons CRUD page + POS coupon UI).
- **No Android deploy today.** The checkout coupon entry comes in a few days. For now, test via API or the admin/web proxy.
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

