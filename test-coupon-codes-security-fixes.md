# Test: Coupon codes — security/review fix loop (2026-08-24)

**Area:** customer cart + checkout, boot safety, the shared coupon engine
**Backend:** `packages/shared/utils/coupon.utils.js`, `packages/shared/utils/coupon-flow.utils.js`,
`packages/shared/repositories/coupon-redemption.repository.js`,
`packages/user/src/routes/order/controller.js`, `packages/user/src/routes/cart/controller.js`,
`packages/user/src/connections/mongo.js`, `packages/admin/src/connections/mongo.js`
**Branch:** `dev` (direct-to-dev)
**Phase:** backend only. No client change is required — every fix is either invisible to the app or
turns a hard failure into a softer one. The Android coupon UI is still a few days out.

## What changed (a real example each)

### 1. A bad index check can no longer take the storefront down
Boot verifies the `per_customer_slot` index that enforces "one use per customer". That check used to
read the index list over the **customer API's** connection, which prefers a **secondary** replica —
so a replica that hadn't yet copied a brand-new index would report it missing, and the app would
**exit**. On the very first deploy that is a full storefront outage over a coupon detail.

Now: the index list is read from the **primary** (never a lagging replica), and if the check still
fails on the **customer API** the app **stays up with coupons switched off** for that process — every
code answers "This coupon code isn't valid." The **admin API** still exits (staff losing the coupon
screen is cheap; customers losing the shop is not).

### 2. `/order/place` can no longer be used to guess coupon codes
The "3 wrong codes a day" limit only covered the cart's **Apply** button. An attacker who used up
their 3 guesses could keep guessing on the **place-order** endpoint instead, and the reply told them
whether the code was real ("expired" vs "isn't valid") — a free code oracle, with a real order
transaction opened per guess.

Now the same limit applies at checkout, but **only to a code typed on that request**. A coupon the
customer already applied (it rides along on the cart) is never blocked — they can always finish
paying for their own order.

### 3. A stale coupon on the cart no longer blocks checkout
Riya applies `SAVE50`, it expires overnight. The cart screen already showed her the price **without**
the coupon. Placing the order used to fail with a 400 every time until she manually removed the
coupon — which the app doesn't yet offer a clear button for.

Now the stale cart coupon is **silently dropped** at checkout and the order goes through at exactly
the price the cart screen showed. A code she **types** that is expired is still refused out loud
(she asked for it, so she must be told).

### 4. The margin clamp no longer publishes our cost price
When a coupon would sell below cost, the discount is capped at the margin. On a **one-item** cart
that cap was exactly `price - cost`, so the customer could work out our cost to the paisa
(₹100 item, ₹62.37 cost → discount shown as ₹37.63). Now a capped discount is given in **whole
rupees** (₹37), so the cost can only be guessed within ±₹1. Costs at most 99 paise of discount, and
only in the rare capped case.

### 5. A late payment can no longer over-redeem a coupon
Holds expire after 20 minutes. If a `payment.captured` webhook arrived after the sweeper released
the hold, the order was paid **with** the discount but the coupon's slot had been given back — the
cap could be exceeded by one, silently. Now the webhook **takes a fresh slot** for that order; if the
coupon is genuinely full it logs `CRITICAL … over-redeemed` so ops can see it.

### 6. Small consistency fix
`/cart/coupon/apply` validated one value and used another when a code was sent in **both** the query
string and the body. Both now agree (body wins).

## Manual walkthrough (dev)

Prereqs: a super-admin coupon, e.g. `CHECK50` = FLAT ₹50 off, no minimum, enabled.

### A. Guessing guard at checkout ✅
1. Apply 3 junk codes at `POST /user/cart/coupon/apply` → 3rd/4th answer
   "Too many incorrect coupon codes today." ✅
2. Now `POST /user/order/place` with `{"couponCode": "GUESS99"}` (a code that does not exist) →
   **400 "Too many incorrect coupon codes today."** ✅ (Before the fix: a normal
   "This coupon code isn't valid." — a working oracle.)
3. Check the order list: **no order was created** and item stock is unchanged. ✅

### B. An already-applied coupon still checks out ✅
1. Fresh customer: apply `CHECK50` on the cart (succeeds).
2. Then burn the day's 3 guesses with junk codes.
3. `POST /user/order/place` with **no `couponCode` in the body** → order placed, ₹50 off. ✅
   ❌ Bug if this returns "Too many incorrect coupon codes".

### C. Stale cart coupon ✅
1. Apply `CHECK50` to the cart.
2. In admin, set the coupon's end date to yesterday (or disable it).
3. `GET /user/cart` → `coupon.valid: false`, `coupon.discountTotal: 0`, priced at full price.
4. `POST /user/order/place` with **no `couponCode`** → **order succeeds** at exactly the price
   step 3 showed, `order.coupon.code` is null, no redemption row. ✅
5. Same order but with `{"couponCode": "CHECK50"}` in the body → **400 "This coupon has expired."** ✅
   (Typed codes still fail closed.)

### D. Cost-price disclosure ✅
1. One item, selling ₹100, cost ₹62.37, quantity 1.
2. A ₹100-off coupon → cart shows **₹37 off**, not ₹37.63. ✅
   ❌ Bug if the discount is an exact 2-decimal figure equal to price − cost.
3. Same coupon on a cart with plenty of margin → discount is exact to the paisa (no rounding). ✅

### E. Boot check (staging only, do NOT do this on prod)
1. Drop the `per_customer_slot` index on `coupon-redemptions`.
2. Start the **user** API → it **starts**, logs `[coupons] CRITICAL … coupons are DISABLED`, and every
   coupon apply answers "This coupon code isn't valid." The rest of the app works normally. ✅
3. Start the **admin** API → it **exits** with a CRITICAL log. ✅
4. Rebuild the index and restart both.

## Edge cases

- A real-but-unusable code (expired, below minimum, wrong store) **never** counts against the daily
  guess budget — only a code that does not exist does. One expired coupon in a customer's pocket must
  not lock them out of the feature for the day.
- The whole-rupee rounding applies **only** when the margin clamp actually bites. Ordinary coupons are
  still exact to the paisa.
- Dropping a stale cart coupon leaves the code **on the cart** (unchanged behaviour) — re-adding items
  or a coupon becoming valid again makes it work without re-typing.
- POS is still exempt from the guessing limit (trusted cashier) and is unaffected by all of the above
  except the whole-rupee clamp, which it shares through the same engine.

## What it needs

- Backend deploy (user + admin). **No client release required.**
- No migration, no data change.

## Automated coverage

`cd packages/user && NODE_ENV=test npx jest coupon` — 125 tests, including:
`coupon-checkout.test.js` (checkout limiter, cart-coupon exemption, stale-drop vs typed fail-closed,
late-capture re-claim), `coupon.utils.test.js` (clamped-discount cost disclosure, forced kill switch),
`coupon-redemption-index-verification.test.js` (primary read preference),
`coupon-boot-index-verification-connectdb.test.js` (user API degrades, admin API exits).
