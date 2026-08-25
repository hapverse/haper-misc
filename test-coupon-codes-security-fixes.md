# Test: Coupon codes — security/review fix loop (2026-08-24)

**Area:** customer cart + checkout, boot safety, the shared coupon engine
**Backend:** `packages/shared/utils/coupon.utils.js`, `packages/shared/utils/coupon-flow.utils.js`,
`packages/shared/constants/coupon.constant.js`,
`packages/shared/repositories/coupon-redemption.repository.js`,
`packages/user/src/routes/order/controller.js`, `packages/user/src/routes/cart/controller.js`,
`packages/admin/src/routes/pos/controller.js`,
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
**(Revised 2026-08-25 — the first version of this fix did not work; see below.)**

> ⚠️ **SUPERSEDED 2026-08-26 — the margin guard was REMOVED entirely.** A business decision: coupons
> always give their full discount, even when the order therefore sells below cost. There is no clamp
> and no suppression left, so the leak this section describes is closed a third way — the price now
> follows the coupon's own arithmetic and is never derived from cost. **Do not re-test the ₹0
> suppression steps below (§D steps 2-7 and §D2 steps 2-6); they will now fail by
> design.** The current walkthrough is `test-coupon-codes.md` §E. This section is kept for history.

When a coupon would sell the cart below cost, the discount used to be **reduced** to whatever margin
was left. On a one-item cart that reduced amount was exactly `price − cost`, i.e. our cost, printed
on the customer's own bill (₹100 item, ₹62.37 cost → "₹37.63 off").

The first fix rounded the reduced amount down to **whole rupees** (₹37) to turn that into a ±₹1
guess. It didn't hold:

- if the margin happens to be a whole number (₹100 selling, ₹90 cost) the rounding changes nothing
  and the cost is still exact;
- the margin left is `(price − cost) × quantity`, so the customer just **buys more units**: divide
  the ₹ off by their own quantity and the ±₹1 shrinks to ±₹1/quantity. With ₹100 selling / ₹90.37
  cost and one 95%-off code: qty 1 is ₹0.63 out, qty 5 is ₹0.03 out, **qty 200 is exact**.

Now the coupon is **suppressed** instead of reduced: if it doesn't fit inside the cart's margin, it
gives **₹0 off** and the cart stays at full price, with the message *"This coupon can't reduce this
cart's price any further."* Nothing derived from the cost is published, at any quantity. This is the
same rule the automatic sale-price engine already follows (a fully margin-clamped item is shown at
full price, never at cost) in browse, cart and checkout.

A coupon that **fits** inside the margin is unaffected — still paid in full, to the paisa.

### 4b. A suppressed (₹0) coupon no longer burns the customer's use — 2026-08-25
Surfaced while verifying fix 4. A suppressed coupon still **claimed a redemption** at checkout and at
the POS counter. Real example: Riya's `SAVE50` is limited to one use each. On a thin-margin cart it
suppresses to ₹0, and checkout used to place the order at full price **and** mark her one use as
spent — a week later, on a cart where ₹50 off genuinely applies, she gets "You've already used this
coupon." She never received a single rupee off. Campaign-wide the same claim inflated `usedCount` and
the redemption report for discounts nobody was given.

Now nothing is claimed when the discount comes out at ₹0:

- a code the customer **types** at checkout (either "now" or a scheduled slot) is **refused**, 400
  *"This coupon can't reduce this cart's price any further."* — an explicit ask we can't honour is
  said out loud, the same fail-closed rule every other typed refusal follows;
- a code merely **sitting on the cart** is **dropped** and the order prices normally (never above the
  total the cart screen showed), exactly like a stale cart coupon;
- **POS** `sale()` refuses with the same sentence (`error: NO_HEADROOM`);
- **POS** `coupon/validate` now returns that sentence in `msg` + `data.message` (+
  `data.reason: "NO_HEADROOM"`) instead of a silent ₹0 labelled "Coupon applied".

The suppression logic itself is untouched — cost is still never published.

> ⚠️ **Partly superseded 2026-08-26.** With the margin guard removed, a below-cost coupon is no
> longer a ₹0 coupon — it applies in full, the order places, and the redemption is claimed (correctly:
> the customer really did get their discount). The "claim nothing on ₹0" rule itself SURVIVES and is
> still worth testing, but it now only fires for a coupon genuinely worth nothing (a zero-valued
> discount row, or a basket of nothing but free-gift lines) — see `test-coupon-codes.md` §G.

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

### D. Cost-price disclosure ✅ (re-test after the 2026-08-25 revision)
1. One item, selling **₹100**, cost **₹90.37**, stock 200+. Coupon `DEEP95` = **95% off**.
2. ⚠️ **SUPERSEDED 2026-08-26 (margin guard removed) — do not re-test.** Cart with quantity **1** →
   `coupon.discountTotal: 0`, `coupon.lines: []`, `coupon.valid: true`,
   message **"This coupon can't reduce this cart's price any further."**, cart priced at ₹100. ✅
3. ⚠️ **SUPERSEDED — do not re-test.** Repeat with quantity **5**, **50**, **200** → **the same ₹0**
   every time. ✅ ❌ Bug if the ₹ off changes with the quantity at all — that is the leak:
   `100 − (₹off ÷ qty)` is our cost price.
4. ⚠️ **SUPERSEDED — do not re-test.** Place the order with `{"couponCode": "DEEP95"}` (both "now"
   and a scheduled slot) → **400 "This coupon can't reduce this cart's price any further."**,
   **no order**, stock unchanged. ✅ ❌ Bug if the order is placed and the coupon's `usedCount`
   moves — that is the ₹0-claim bug.
5. ⚠️ **SUPERSEDED — do not re-test.** Whole-rupee margin (selling ₹100, cost ₹90) → still
   **₹0 off**, not "₹10 off". ✅
6. ⚠️ **SUPERSEDED — do not re-test.** Same coupon on a cart with plenty of margin (cost ₹40) →
   discount paid in full, exact to the paisa. ✅ Suppression must not spill onto healthy coupons.
7. ⚠️ **SUPERSEDED — do not re-test.** POS `POST /admin/pos/coupon/validate` with the same
   item/coupon at qty 1, 5, 40 → `discountTotal: 0`, `payable` = subtotal, and `msg` /
   `data.message` = *"This coupon can't reduce this cart's price any further."* with
   `data.reason: "NO_HEADROOM"`. ✅

### D2. A ₹0 coupon must not eat the customer's one use ✅ (2026-08-25)
1. Coupon `ONEUSE50` = FLAT ₹50 off, **per-customer limit 1**, total limit 5.
2. ⚠️ **SUPERSEDED 2026-08-26 (margin guard removed) — do not re-test.** Cart of 2 × ₹100 items
   whose cost is **₹99** (only ₹2 of margin) → applying `ONEUSE50` back then produced a ₹0
   suppression, and placing the order **typing the code** answered **400 "This coupon can't reduce
   this cart's price any further."** ✅ Today the same cart just pays the ₹50 off in full.
3. ⚠️ **SUPERSEDED — do not re-test.** In admin: the coupon's **used count is still 0** and its
   redemption list is **empty**. ✅ ❌ Bug if a redemption row exists (HELD or CONFIRMED) or the
   count moved.
4. ⚠️ **SUPERSEDED — do not re-test.** Now order a normal-margin cart (cost ₹10) with the **same**
   code → **₹50 off, order placed**. ✅ ❌ Bug if this answers "You've already used this coupon" —
   the ₹0 attempt stole her slot.
5. ⚠️ **SUPERSEDED — do not re-test.** Repeat 2–4 on the **scheduled** checkout path (deliveryType
   `scheduled` + a slot). ✅
6. ⚠️ **SUPERSEDED 2026-08-26 (margin guard removed) — do not re-test.** Repeat on **POS**:
   `POST /admin/pos/sale` with the thin-margin item back then answered 400 with
   `error: "NO_HEADROOM"`, no sale, no redemption row, `usedCount` unchanged; today it rings up the
   coupon in full regardless of margin.
7. Still valid (unrelated to the margin guard): apply a code to the cart, then place the order
   **without** `couponCode` in the body → order **succeeds** at full price with
   `order.coupon.code: null` and **no** redemption row (dropped, not refused — the customer is
   never stranded). ✅

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
- ⚠️ **SUPERSEDED 2026-08-26 — the margin guard has been removed entirely** (see the banner at the
  top of §4). Both statements below describe behaviour that no longer exists; kept for history only.
  Coupons now always apply their full discount regardless of cost — there is no suppression case to
  test anymore.
  - This used to be true: "Suppression applies **only** when the coupon doesn't fit the cart's
    margin. Ordinary coupons are still paid in full, exact to the paisa."
  - This used to be true: "If **no** item in the cart has a known cost the guard is skipped
    entirely, so coupons keep working in a store that has never taken a goods receipt."
- Dropping a stale cart coupon leaves the code **on the cart** (unchanged behaviour) — re-adding items
  or a coupon becoming valid again makes it work without re-typing.
- POS is still exempt from the guessing limit (trusted cashier) and is unaffected by all of the above
  except the whole-rupee clamp, which it shares through the same engine.

## What it needs

- Backend deploy (user + admin). **No client release required.**
- No migration, no data change.
- Admin FE follow-up (not blocking, additive only): `haper-admin/src/api/coupons.ts`
  `PosCouponValidateSuccess` doesn't yet carry the new optional `message` / `reason`, so the NewSalePage
  still shows a bare ₹0 until it renders them. The refusal on the sale itself already surfaces.

## Automated coverage

`cd packages/user && NODE_ENV=test npx jest coupon` — including:
`coupon-checkout.test.js` (checkout limiter, cart-coupon exemption, stale-drop vs typed fail-closed,
late-capture re-claim, **suppression at both checkout paths at qty 1/5**, **the ₹0 attempt claims
nothing and the same coupon still works on a later order**, **cart-pinned ₹0 code dropped**),
`coupon-cart.test.js` (**the auditor's ₹100 / ₹90.37 attack at qty 1/5/50/200 + the no-headroom
message**), `coupon.utils.test.js` (suppress-on-clamp unit level, forced kill switch),
`coupon-redemption-index-verification.test.js` (primary read preference),
`coupon-boot-index-verification-connectdb.test.js` (user API degrades, admin API exits).

`cd packages/admin && NODE_ENV=test npx jest pos-coupon` — includes the same suppression check on the
POS validate endpoint at qty 1/5/40 (**now asserting the no-headroom message**), plus **the POS sale
refusing a ₹0 coupon without claiming**, and **the same coupon selling on the next cart**.
