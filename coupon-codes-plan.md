# Coupon Codes — Implementation Plan

**Status:** Awaiting user approval (no code to be written until approved)
**Author:** shavinder (planner)
**Date:** 2026-08-24
**Urgency:** BACKEND + ADMIN SHIP TODAY, DIRECT TO PROD. Android follows in a few days.
**Companion doc:** `haper-misc/discounts-promotions-plan.md` (the automatic-discount engine this
feature sits on top of — read §2 "Approved Decisions" and §8 "Edge Cases" before building).

---

## 0. Scope Summary (read this first)

| Area | This release |
|---|---|
| Backend (`haper-backend`) | TODAY — full feature |
| Admin panel (`haper-admin`) | TODAY — coupon CRUD + POS coupon entry |
| Android (`haper-android`) | In a few days — checkout coupon entry, normal-flow testing only |
| iOS (`haper-ios`) | DEFERRED — not in this plan |
| Web (`haper-web`) | DEFERRED — not in this plan |

**Confirmed requirements (do not re-open these):**

1. **Promo-style coupon codes only.** The existing referral-code system (signup referral →
   wallet cashback) is a *different* feature. Do not touch it, do not merge the two code spaces,
   do not reuse its validation.
2. **Only `super_admin` creates coupons.** Scope is global or a specific store (same
   `scope: {type, storeIds}` shape as `discount-rules`).
3. **Usage limits:** any combination of (a) total redemption cap, (b) per-customer cap,
   (c) first-order-only.
4. **A successfully applied coupon ALWAYS replaces the automatic discount. Never stacks.**
   ("Option A", confirmed.) The customer gets the coupon price, not coupon-on-top-of-sale.
5. **Both code formats:** admin can type a code (e.g. `WELCOME50`) or ask the system to
   auto-generate one.
6. **Optional minimum order value** per coupon.
7. **Abuse guard:** max 3 *wrong-code* attempts per customer per day.
8. **Entry points from day one:** customer checkout (Android) AND POS (store admin ringing up a
   walk-in customer). POS is in scope from day one — unlike the automatic Discounts feature,
   where POS was explicitly deferred to Phase 2.
9. **DRY:** reuse `shared/utils/discount.utils.js` pure helpers and the
   `admin/src/routes/discount-rule/*` route/validator/controller shape as heavily as possible.

---

## 1. Goal

Give Haper a promo-code lever: super admin creates a code like `WELCOME50` (₹50 off orders over
₹299, first order only, 500 total redemptions, once per customer). The customer types it on the
Android checkout screen and sees the order total drop before paying; a store admin can type the
same code into the POS screen for a walk-in customer. The discount is computed and enforced 100%
server-side, is frozen onto the order at checkout, cannot be over-redeemed past its caps even
under concurrent traffic, and replaces (never adds to) whatever automatic sale price the
Discounts engine would have given.

### Acceptance criteria ("done" means all of these are true)

Admin (today)
- [ ] Super admin can create a coupon with: code (typed or auto-generated), description,
      global-or-store scope, PERCENT or FLAT value, optional max-discount cap, optional minimum
      order value, start/end date-time (IST), total-redemption cap (optional), per-customer cap
      (optional), first-order-only toggle, enabled toggle.
- [ ] Duplicate codes are rejected at save with a clear message (case-insensitively).
- [ ] Coupon list shows code, value, window, `usedCount / totalLimit`, enabled state.
- [ ] Coupon can be disabled instantly (toggle) without deleting it.
- [ ] A non-super-admin (including store_admin) cannot reach any coupon write endpoint.

Customer checkout (Android, in a few days)
- [ ] Customer types a valid code on the cart/checkout screen and sees: the coupon discount
      amount, the new payable total, and the code marked as applied.
- [ ] Customer taps Remove and the total returns to exactly the pre-coupon total (which may
      include an automatic discount again).
- [ ] An invalid code shows a specific message ("This coupon code isn't valid") and does not
      change any total.
- [ ] After 3 wrong codes in one day the 4th wrong attempt is refused with "Too many attempts,
      try again tomorrow" — but a code that is already applied still checks out fine.
- [ ] The order that lands in the DB shows the coupon code, the coupon discount amount, and
      per-line prices that sum exactly to what the customer paid.

POS (today)
- [ ] Store admin can enter a coupon code on a walk-in sale and see the total drop.
- [ ] A coupon that has per-customer / first-order limits is refused for an anonymous walk-in
      with a message telling the admin to capture the customer's phone number.

Money correctness (all channels)
- [ ] Coupon discount never stacks with an automatic discount — applying a coupon on a
      discounted cart replaces the automatic discount.
- [ ] The order never sells below cost in aggregate (margin guard), except where costPrice is 0.
- [ ] Total redemptions never exceed the cap, and per-customer redemptions never exceed the
      per-customer cap, even with two devices submitting simultaneously.
- [ ] A prepaid order that is initiated but never paid does NOT permanently burn a redemption.
- [ ] Invoice line rates, GST, partial refunds, wallet, `actualOrderValue` and profit/COGS all
      keep working — no order-level "lump" discount that lines don't add up to.

Non-regression
- [ ] With no coupon applied, every existing response is byte-identical to today.
- [ ] `discountsEnabled: false` stores keep behaving exactly as today.

---

## 2. Current State (verified in the tree today)

### The automatic-discount engine (SHIPPED — reuse it)
- `haper-backend/packages/shared/utils/discount.utils.js` — the pure engine. Exports (verified):
  `SPECIFICITY, isRuleActiveNow, ruleMatchesStore, matchSpecificity, ruleMatchesItem,
  resolveDiscountForLine, resolveDiscountsForLine, buildDiscountLabel, isDiscountEnabledForStore,
  getActiveRulesForStore, resolveDiscountsForItems, toCustomerDiscounts, attachDiscountsToItemList,
  attachDiscountsToItem, isDiscountEnabledForStoreId, __resetDiscountFlagCache,
  applyDiscountsToOrderLines, sumOrderDiscountTotal`.
  Internal (not exported, will need exporting or duplicating — see build order): `round2`,
  `floor2`, `applyMarginGuard`.
  IST handling is `moment-timezone` with `TZ = "Asia/Kolkata"`.
- `haper-backend/packages/shared/models/discount-rules.schema.js` — the automatic rule model.
- `haper-backend/packages/shared/models/orders.schema.js` — already carries per-line
  `originalSalePrice` (default 0), `discountAmount` (default 0, PER UNIT),
  `appliedDiscounts[]`, and order-level `discountTotal` (default 0). Note the schema's own
  comment: lean reads return `undefined`, not the default, on old docs — always read
  `?? 0`.
- `haper-backend/packages/shared/models/stores.schema.js` — `config.discountsEnabled`
  (default false, must be read `?? false` because `getById` is `.lean()`).
- `haper-backend/packages/admin/src/routes/discount-rule/{router,controller,validator}.js` —
  the CRUD shape to clone. Router uses the **double gate**:
  `requireRoles([SUPER_ADMIN])` + `requirePermission(P.DISCOUNTS.*)`, because store_admin
  *implicitly bypasses* the permission middleware, so a permission-only gate would hand pricing
  control to every store admin. Registered at `packages/admin/src/routes/index.js:64`.
- `haper-backend/packages/shared/constants/permission.constant.js` — `DISCOUNTS` block at line
  118; FE mirror at `haper-admin/src/constants/permissions.ts` (known drift bug — always change
  both).

### The two checkout paths (BOTH must be handled)
- `haper-backend/packages/user/src/routes/order/controller.js:727` — `placeOrder`, calls
  `discountUtils.applyDiscountsToOrderLines(...)` then `sumOrderDiscountTotal`.
- `haper-backend/packages/user/src/routes/order/controller.js:1191` — `placeScheduledOrder`,
  the *same* call with the same rules.
  **Missing the second one is the single most likely delivery bug in this feature.**
  Both call it OUTSIDE the transaction semantics (no session passed) because `discount-rules` is
  not in the transaction pre-create list — coupon reads must follow the same rule.
- Route registration: `packages/user/src/routes/order/router.js:11` → `POST /order/place`.

### Cart preview
- `haper-backend/packages/user/src/routes/cart/controller.js` — already builds an advisory
  `cartItems.discount = { total, lines, labels }` block inside a try/catch that **fails open**
  to `NO_DISCOUNT`. Downstream free-delivery threshold and gift tier are judged on
  `netTotalPrice = totalPrice - discount.total`. This is the exact insertion point for the
  coupon preview, and the exact precedent for its response shape.

### POS (no discount support today)
- `haper-backend/packages/admin/src/routes/pos/controller.js` — `sale()` at line 96.
  Lines are pushed at `salePrice: master.sellingPrice` (line 139) with **no discount engine call
  at all**. `GUEST_PHONE = "POS-GUEST"` (line 13) with `resolveCustomer()` upserting a single
  shared `"Walk-in Customer"` user for anonymous sales. Invoice minting has a
  re-mint-and-retry loop around `session.withTransaction`.
- Admin FE: `haper-admin/src/pages/POS/NewSalePage.tsx`.

### Admin FE (Discounts, the UI precedent)
- `haper-admin/src/pages/Discounts/{DiscountsPage,DiscountRuleFormModal,BelowCostConfirmModal}.tsx`
  (+ their `.test.tsx`), API client at `haper-admin/src/api/discountRules.ts`, menu entry in
  `src/hooks/useMenu.ts`, route in `src/App.tsx`.

### Android (display-only today)
- `haper-android/app/src/main/java/com/bheldi/data/model/HomeModels.kt` — `CartResponseData`
  (line 153), `CartDiscount` (171), `CartDiscountLine` (177), `CartCharges` (250).
- `haper-android/app/src/main/java/com/bheldi/ui/screens/cart/{CartScreen,CartViewModel}.kt`.
- `haper-android/app/src/main/java/com/bheldi/data/model/OrderModels.kt`.

### Infrastructure caveats
- `haper-backend/packages/shared/utils/distributed-cache.utils.js` uses Redis when
  `redis.url` is configured and **silently falls back to an in-process `NodeCache`** otherwise.
  A rate limit built on it is bypassable by hitting another instance → the wrong-attempt counter
  must live in Mongo.
- `carts.schema.js` currently stores only `{userId, storeId, items[{itemId, quantity}], type,
  status}` — there is nowhere to persist an applied coupon yet.

---

## 3. Proposed Design

### 3.1 Core decision: a separate `coupons` collection, sharing the engine's pure helpers

Do **not** add a `code` field to `discount-rules`. Reasons:
- `FLAT` means different things. In `discount-rules` FLAT is **₹ off PER UNIT** (an approved
  decision in the discounts plan). For a coupon, FLAT means **₹ off the WHOLE CART**
  (`WELCOME50` = ₹50 off the order, not ₹50 off each of 8 items = ₹400). Overloading one money
  field with two meanings is a bug factory.
- Coupons have identity, caps, redemption ledgers, and abuse counters that automatic rules do not.
- Coupons are matched by explicit code entry, not by catalog scanning.

What IS reused (this is the DRY story):
- `round2` / `floor2` money rounding — same 2dp convention.
- The margin-guard idea and `costPrice === 0 → skip` invariant.
- `isRuleActiveNow(rule, now)` — the coupon carries a `schedule: {startAt, endAt, recurrence: null}`
  block *specifically so this evaluator works unchanged*. No new date logic.
- `ruleMatchesStore(rule, storeId)` — coupon `scope` uses the identical shape.
- The router/validator/controller file shape and the double role+permission gate.
- The order-line snapshot fields (`originalSalePrice`, `discountAmount`, `salePrice`) — the coupon
  writes the *same* fields, so invoices, GST, refunds and COGS need zero changes.

### 3.2 The override rule ("Option A") — suppress, don't undo

When a coupon is applied, **do not call the automatic discount engine at all** for that order.
The coupon applier baselines the same per-line fields the engine would have written
(`originalSalePrice = pre-discount unit price`, then rewrites `salePrice`).

Do **not** implement this as "run the automatic engine, then undo it". That re-derives money
twice and drifts by a paisa the moment rounding differs.

Consequence for the UI: the cart preview must be able to tell the customer *both* numbers so the
override is not a nasty surprise — see §5 `couponBetter` / `replacedAutoDiscount` flags.

### 3.3 Cart-level discount must be ALLOCATED back onto lines

A coupon discount is computed at cart level (`₹50 off`, or `10% of subtotal capped at ₹100`), but
it must be **written back onto the individual order lines**, rewriting each line's `salePrice`.
It must never be stored as an order-level lump that the lines don't add up to.

Why: per-line GST, invoice rate (`invoice.utils.js` uses `salePrice`), partial refunds,
`actualOrderValue`, and profit/COGS all read per-line money. An order-level lump makes every one
of them silently wrong.

Allocation algorithm (deterministic, no drift):
1. `lineWeight = quantity * unitPrice` for each non-free-gift line.
2. `rawShare = couponTotal * lineWeight / subtotal`.
3. `lineShare = floor2(rawShare)` for every line.
4. `remainder = round2(couponTotal - sum(lineShare))` → add the whole remainder to the **largest**
   line (tie broken by line index) so allocations sum **exactly** to `couponTotal`.
5. Per line: `discountAmount = round2(lineShare / quantity)` (per-unit, matching the existing
   field's meaning), `originalSalePrice = unitPrice`,
   `salePrice = round2(unitPrice - discountAmount)`.
6. Re-derive `couponDiscountTotal` from the written lines (never from the pre-allocation number)
   so the stored total is provably the sum of the lines.

Free-gift lines (`isFreeGift: true`, `salePrice: 0`) are excluded from both the weight basis and
the allocation, exactly as the automatic engine skips them.

### 3.4 Margin guard goes AGGREGATE, not per line

For a cart-level discount, clamp the **total** coupon discount to the summed headroom:
`headroom = Σ over lines of max(0, (unitPrice - costPrice) * quantity)`, skipping any line whose
`costPrice === 0` (cost unknown; never fake it — repo invariant, see
`costPrice money invariant`). Then `couponTotal = min(couponTotal, headroom)`.

Bonus property: because the clamp is aggregate, no single line lands at exactly cost, so the
per-line clamping cost-disclosure leak does not reappear.

If the clamp reduces the discount, the customer sees the clamped number in the preview — the
preview and checkout run the identical function, so they cannot disagree.

### 3.5 Fail CLOSED (this is the opposite of the automatic engine)

The automatic discount engine **fails open**: if rules can't be resolved, charge full price and
log loudly. That is right for an ambient feature the customer never asked for.

A coupon is an **explicit ask**. If we cannot validate or claim it, we must **reject the checkout
with a specific error**, never silently charge the customer more than the screen showed. Silently
charging more than the displayed total is a chargeback and a support fire.

Rule: `couponCode` present on a request → any failure is a 4xx with a specific message.
`couponCode` absent → behaviour is exactly as today, unchanged.

### 3.6 Redemption claiming — the concurrency core (NOT cuttable)

Two caps, two different races, two different mechanisms.

**Total cap race** — one atomic conditional update, no read-then-write:
```
Coupon.findOneAndUpdate(
  { _id, enabled: true, $expr: { $lt: ["$usedCount", "$totalLimit"] } },
  { $inc: { usedCount: 1 } },
  { new: true }
)
```
`null` result = cap exhausted (or disabled). Coupons with no total cap skip the `$expr` guard and
just `$inc` for reporting.

**Per-customer cap race** — a unique index and an optimistic insert, never count-then-insert:
- Unique index `(couponId, userId, ordinal)` on `coupon-redemptions`.
- Insert with `ordinal = 1`; on E11000 retry `ordinal = 2`, … until success or
  `ordinal > perCustomerLimit` → cap reached.
- Counting existing redemptions then inserting is a TOCTOU bug: two simultaneous requests both
  count `0` and both insert.

**Claim happens OUTSIDE the transaction, with a compensating release.**
A brand-new collection cannot be created inside a Mongo transaction, and the existing checkout
already keeps `discount-rules` reads out of the session for exactly this reason. So:

```
1. validate + compute (read-only)
2. CLAIM  → insert coupon-redemption {status: HELD, expiresAt: now+15min}
             + atomic usedCount $inc
3. open the order transaction, write the order with the coupon snapshot
4. on transaction COMMIT   → mark redemption CONFIRMED (orderId set)
   on transaction ABORT    → RELEASE: set status RELEASED + $inc usedCount by -1
5. safety net: a cron sweeper releases HELD rows older than the TTL
```

Without step 4/5, a prepaid order that is initiated and never paid burns the redemption forever.
Payment-failed / cancelled-before-payment must release too.

**Idempotency:** the release is guarded so it can only fire once per redemption
(`findOneAndUpdate({_id, status: HELD}, {status: RELEASED})` — if it didn't match, someone already
resolved it, do nothing).

### 3.7 Abuse guard — wrong-code attempts, in Mongo

`coupon-attempts` collection, one doc per `(actorKey, dayKey)`, with a TTL index so it self-cleans.

- `actorKey` = `user:<userId>` for the app, and for POS see Open Question Q2.
- `dayKey` = IST calendar date string `YYYY-MM-DD` (IST, via `moment-timezone`, matching the
  engine's TZ) — "per day" must mean the customer's day, not UTC's.
- Increment happens **only on a genuinely unknown code**, only on the apply/preview endpoint.
- Explicitly NOT a wrong attempt: a real code that is expired, exhausted, below minimum order
  value, not first-order, or out of store scope. Those are real codes; the customer isn't
  guessing. They get their own specific error.
- Checkout re-validation of an **already-applied** code must never be blocked by the limiter, or a
  customer who hit the limit locks themselves out of their own order.
- Counter lives in Mongo, not `distributed-cache.utils.js`, because that util silently degrades to
  a per-process `NodeCache` which another instance bypasses.

### 3.8 Persist the CODE on the cart, never the amount

Add `couponCode: { type: String, default: null }` to `carts.schema.js`.

- Apply/remove become real endpoints that survive an app restart or a device switch.
- The server always recomputes the money from the code; the client never sends an amount.
- Keeps "never trust the client" fully intact.

### 3.9 Data flow — customer checkout

```
Customer types code
  → POST /cart/coupon/apply { code }
      → validate (fail closed) → compute + allocate + margin clamp (read-only, NO claim)
      → persist couponCode on the cart
      → respond with the preview numbers
  → GET /cart now returns cart.coupon = {code, discountTotal, ...} INSTEAD of cart.discount
      (automatic engine not called when a coupon is applied)
  → POST /order/place
      → re-validate the code server-side (authoritative; cart preview is advisory)
      → CLAIM (outside txn, HELD)
      → open txn: prepareOrderItemsAndInventory
                  → coupon applier writes per-line originalSalePrice/discountAmount/salePrice
                  → NO call to applyDiscountsToOrderLines
                  → calculatePricing sums the already-discounted salePrice
                  → delivery threshold / gift tier / wallet all see post-coupon money
                  → order written with coupon snapshot
      → commit → CONFIRM the redemption
      → abort/throw → RELEASE the redemption, surface the specific error
```

### 3.10 Data flow — POS

Same validate → claim → write → confirm/release sequence, wrapped around the existing
`attemptSale()` transaction in `pos/controller.js`. Two POS-specific wrinkles:

- The invoice re-mint retry loop re-runs the whole transaction. The coupon **claim must sit
  OUTSIDE that retry loop** (claim once, retry the sale) or a retry double-burns the cap.
- The shared `POS-GUEST` user collapses per-customer limits: one walk-in consumes
  "once per customer" forever, and every walk-in looks like a repeat customer for
  first-order-only. **Rule: a coupon with a per-customer cap or first-order-only is REFUSED for
  the guest user**, with a message telling the admin to capture the phone number. Coupons with
  only a total cap work fine for guests.

---

## 4. Data Model Changes

### 4.1 New collection: `coupons` (global, super-admin owned)

`haper-backend/packages/shared/models/coupons.schema.js`

```javascript
{
  _id: ObjectId,

  code: String,          // stored UPPERCASE, trimmed. See Open Question Q4.
  description: String,

  scope: {               // SAME SHAPE as discount-rules, so ruleMatchesStore() is reused verbatim
    type: "global" | "store",
    storeIds: [ObjectId]              // empty = all stores
  },

  discount: {
    type: "PERCENT" | "FLAT",
    value: Number,                    // PERCENT: 1-100. FLAT: Rs off the WHOLE CART.
    maxDiscountAmount: Number | null  // cap on total Rs off (mainly for PERCENT)
  },

  minOrderValue: { type: Number, default: 0 },   // 0 = no minimum. Evaluated on the
                                                 // pre-discount item subtotal (see §7).

  schedule: {                          // deliberately the discount-rules shape so
    startAt: Date,                     // isRuleActiveNow() works UNCHANGED
    endAt: Date,
    recurrence: null                   // ALWAYS null in v1 (recurrence is a cut, see §9)
  },

  limits: {
    totalLimit: Number | null,         // null = unlimited redemptions
    perCustomerLimit: Number | null,   // null = unlimited per customer
    firstOrderOnly: { type: Boolean, default: false }
  },

  usedCount: { type: Number, default: 0 },   // authoritative counter, only ever moved
                                             // by atomic $inc (claim +1 / release -1)

  enabled: { type: Boolean, default: true },

  createdBy: ObjectId,
  updatedBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:
- `{ code: 1 }` **unique** (with the case decision from Q4 — either a plain unique index on an
  always-uppercased field, or a `collation: {locale:"en", strength:2}` unique index).
- `{ enabled: 1, "schedule.startAt": 1, "schedule.endAt": 1 }`
- `{ "scope.storeIds": 1, enabled: 1 }`

Validation (`pre("validate")`, mirroring `discount-rules.schema.js`):
- `schedule.endAt >= schedule.startAt`
- PERCENT: `1 <= value <= 100`; FLAT: `value > 0`
- `minOrderValue >= 0`; `totalLimit`/`perCustomerLimit` null or `>= 1`
- code matches `/^[A-Z0-9][A-Z0-9_-]{3,19}$/` (4–20 chars, no spaces, no lookalike-hostile chars)

### 4.2 New collection: `coupon-redemptions` (the ledger + the concurrency guard)

`haper-backend/packages/shared/models/coupon-redemptions.schema.js`

```javascript
{
  _id: ObjectId,
  couponId: ObjectId,        // ref "coupons"
  code: String,              // denormalised snapshot (survives coupon rename/delete)
  userId: ObjectId,          // ref "users"
  ordinal: Number,           // 1,2,3... the customer's Nth redemption of THIS coupon
  orderId: ObjectId | null,  // set on CONFIRM
  storeId: ObjectId,
  channel: "APP" | "POS",
  discountAmount: Number,    // Rs actually given (post-clamp)
  status: "HELD" | "CONFIRMED" | "RELEASED",
  expiresAt: Date,           // now + 15 min at HELD; used by the sweeper
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:
- **`{ couponId: 1, userId: 1, ordinal: 1 }` unique** — this index IS the per-customer cap.
- `{ status: 1, expiresAt: 1 }` — the sweeper's query.
- `{ orderId: 1 }` — order lookup / reporting.
- `{ couponId: 1, createdAt: -1 }` — reporting.

> Note: RELEASED rows keep their `(couponId,userId,ordinal)` slot. That means a customer whose
> order failed cannot immediately re-use ordinal 1. Decision: the **release also deletes the row**
> (rather than marking it RELEASED) so the slot frees up, and we write a separate audit line via
> the existing admin-audit mechanism. If we prefer an immutable ledger instead, the unique index
> must become partial: `{ partialFilterExpression: { status: { $in: ["HELD","CONFIRMED"] } } }`.
> **Recommended: the partial index + immutable ledger** — a partial unique index on a status
> field is a known, boring pattern and keeps a real audit trail.

### 4.3 New collection: `coupon-attempts` (abuse guard)

`haper-backend/packages/shared/models/coupon-attempts.schema.js`

```javascript
{
  _id: ObjectId,
  actorKey: String,     // "user:<userId>"  (POS key: see Q2)
  dayKey: String,       // "YYYY-MM-DD" in IST
  count: { type: Number, default: 0 },
  expiresAt: Date,      // end of that IST day + 1 day buffer
  createdAt: Date
}
```

Indexes:
- `{ actorKey: 1, dayKey: 1 }` **unique** (upsert + `$inc` target)
- `{ expiresAt: 1 }` with `expireAfterSeconds: 0` (TTL self-clean)

### 4.4 `orders.schema.js` — one new nullable order-level block

```javascript
coupon: {
  code:           { type: String, default: null },
  couponId:       { type: mongoose.Types.ObjectId, default: null },   // NOT a typed ref
  discountAmount: { type: Number, default: 0 },
  redemptionId:   { type: mongoose.Types.ObjectId, default: null },
  _id: false
}
```
Default for the whole block is `null`/absent for every existing order.

**Why a separate block and not `items[].appliedDiscounts[].ruleId`:** that field is (or reads as)
a reference into the automatic `discount-rules` collection. Stuffing a coupon id into it creates a
dangling reference for anything that populates or joins it, and makes "was this an automatic
discount?" unanswerable. Keep them separate.

The per-line fields (`originalSalePrice`, `discountAmount`, `salePrice`) are **reused as-is** by
the coupon allocator — that is what keeps invoices/refunds/COGS untouched. Order-level
`discountTotal` also gets the coupon's total, so any existing "total discount" reporting keeps
working; `coupon.discountAmount` tells you how much of it was coupon-driven.

### 4.5 Cart persistence — CORRECTED 2026-08-24, do not use `carts.schema.js`

**The live cart is 100% Redis-backed, not Mongo.** Verified by direct investigation: every cart
read/write in `packages/user/src/routes/cart/controller.js` goes through
`packages/shared/repositories/cart.repository.js`'s `_getCartFromRedis`/`_saveCartToRedis`
(`distributedCacheUtils`, key `CART:${userId}:${type}`, plain JSON `{_id, userId, storeId, type,
items:[{_id,itemId,quantity}]}`, 12h TTL). The Mongoose `CartModel`/`carts.schema.js` is **dead
for cart storage** — grepped for every write verb across the repo, the only hit is a test
fixture; the few live `CartModel` references (`order.repository.js:841`,
`profile/controller.js:309`, `product/controller.js:122`, `cron/account-purge.js:74`) are
vestigial guards/cleanup against a collection that's never populated.

**Corrected approach**: add `couponCode` to the plain Redis cart JSON object shape in
`cart.repository.js` (set on the object before `_saveCartToRedis`, read back in
`getOne`/`getById`/`getCartForItems`) — new Redis-side logic, not a Mongoose schema field. The
`couponCode` field added to `carts.schema.js` during initial schema work should be treated as a
harmless but MISLEADING no-op — either remove it or leave it with a comment noting it's unused,
whichever the implementing engineer prefers, but the real persistence must happen in Redis.
Code only, never the amount — that part of the design is unchanged.

### 4.6 `stores.schema.js` — no change

Coupons are **not** gated by `config.discountsEnabled`. See Open Question Q5 — this is the
recommended default (a coupon is a deliberate super-admin act; a store that has automatic
discounts off should still be able to honour a marketing code), but it needs your confirmation.

### 4.7 Migration

None. Every field is new, nullable/defaulted, and additive. No backfill, no data rewrite.
Collections are created lazily on first write (which is exactly why the claim cannot be inside
a transaction).

---

## 5. API Contract

### 5.1 Admin — `/admin/coupon` (super_admin only)

New permission block in `packages/shared/constants/permission.constant.js`:
`PERMISSIONS.COUPONS = { VIEW: "coupons.view", MANAGE: "coupons.manage" }`
**and the exact mirror in `haper-admin/src/constants/permissions.ts`** (this repo has a known
FE/BE permission-mirror drift bug — change both in the same commit).

Every route carries the same double gate as `discount-rule/router.js`:
`requireRoles([AdminConstants.roles.SUPER_ADMIN])` + `requirePermission(P.COUPONS.*)`.

```
GET    /admin/coupon
  Query: ?q=<code substring>&storeId=&enabled=true|false&activeNow=true|false&page=&limit=
  200:   { coupons: [ {_id, code, description, scope, discount, minOrderValue, schedule,
                       limits, usedCount, enabled, createdAt} ], total: N }

POST   /admin/coupon
  Body:  { code?, autoGenerate?: boolean, description, scope, discount,
           minOrderValue, schedule, limits, enabled }
         - exactly one of `code` or `autoGenerate: true`
         - autoGenerate mints an 8-char A-Z2-9 code (no I/O/0/1), retrying on collision
  201:   { coupon: {...} }
  409:   { error: "A coupon with this code already exists" }
  400:   validation errors

GET    /admin/coupon/:id
  200:   { coupon: {...}, stats: { usedCount, uniqueCustomers, totalDiscountGiven } }

PUT    /admin/coupon/:id
  Body:  same as POST minus code changes.
         CODE IS IMMUTABLE after creation (renaming a live code orphans printed/shared codes).
  200:   { coupon: {...} }

PATCH  /admin/coupon/:id/toggle
  Body:  { enabled: boolean }
  200:   { coupon: {...} }        // instant kill switch, no deploy

DELETE /admin/coupon/:id
  Soft-disable only if usedCount > 0 (never destroy redemption history).
  Hard delete allowed only when usedCount === 0.
  200:   { ok: true, softDisabled: boolean }

GET    /admin/coupon/:id/redemptions
  Query: ?page=&limit=
  200:   { redemptions: [ {_id, code, userId, orderId, channel, discountAmount,
                           status, createdAt} ], total: N }
```

### 5.2 POS — coupon on a walk-in sale

```
POST /admin/pos/coupon/validate        (auth: admin with POS permission + store context header)
  Body:  { code, items: [{itemId, quantity}], customerPhone?: string|null }
  200:   { valid: true, code, discountTotal, subtotal, payable,
           lines: [{itemId, quantity, originalSalePrice, salePrice, discountAmount}] }
  400:   { valid: false, reason: "<machine code>", message: "<admin-facing text>" }
         reasons: NOT_FOUND | DISABLED | NOT_STARTED | EXPIRED | EXHAUSTED |
                  BELOW_MIN_ORDER | NOT_FIRST_ORDER | WRONG_STORE |
                  CUSTOMER_LIMIT_REACHED | REQUIRES_CUSTOMER_PHONE | TOO_MANY_ATTEMPTS

POST /admin/pos/sale                   (EXISTING endpoint, one new optional body field)
  Body:  { items, customerPhone, customerName, paymentMode, couponCode?: string|null }
  201:   { msg, data: { order, invoiceNumber } }   // shape unchanged
  400:   any coupon failure fails the SALE (fail closed) with the specific message
```
`couponCode` omitted → the POS sale path is byte-identical to today.

### 5.3 Customer — cart apply / remove

```
POST /cart/coupon/apply        (auth: user + store context)
  Body:  { code }
  200:   { ok: true,
           coupon: { code, description, discountTotal, appliedAt },
           replacedAutoDiscount: boolean,     // true when an automatic discount was displaced
           autoDiscountTotal: number,         // what the automatic discount WOULD have been
           couponBetter: boolean,             // discountTotal > autoDiscountTotal
           cart: <the same shape GET /cart returns> }
  400:   { ok: false, reason: "<machine code>", message: "<customer-facing text>" }
         Same reason list as POS, plus TOO_MANY_ATTEMPTS.
  429 is NOT used — keep it a 400 with reason TOO_MANY_ATTEMPTS so old clients
      that only branch on 4xx still show the message.

DELETE /cart/coupon            (auth: user + store context)
  200:   { ok: true, cart: <GET /cart shape> }
  Always succeeds, even if no coupon was applied (idempotent).
```

### 5.4 Customer — `GET /cart` (additive)

Always emitted, so Android Gson never sees a missing key:
```
{
  ...existing fields,
  discount: { total, lines, labels },     // EXISTING. Zeroed out when a coupon is applied.
  coupon: {
    code:            String | null,
    discountTotal:   Number,              // 0 when none
    lines:           [{ itemId, amount }],
    message:         String | null,       // e.g. "Add Rs 60 more to use WELCOME50"
    valid:           Boolean              // false = code on the cart no longer qualifies
  }
}
```
`coupon` is always present with `code: null, discountTotal: 0, valid: true` when no coupon —
that is the "always emit the key" rule that keeps Android safe.

**Stale-coupon behaviour:** if the persisted code no longer qualifies (customer removed items and
dropped below `minOrderValue`, or the coupon expired while the cart sat), `GET /cart` returns
`coupon.valid: false` with a `message` and **prices the cart WITHOUT the coupon** (falling back to
the automatic discount). It does not silently clear the code — the customer should see why.

### 5.5 Customer — `POST /order/place` (additive)

```
Body: { ...existing, couponCode?: string|null }
```
- `couponCode` absent/null → today's behaviour exactly (automatic engine runs).
- `couponCode` present → server re-validates and re-computes from scratch. **No amount is ever
  accepted from the client.** Any failure = 400 with the specific reason; the order is not placed.
- If the body omits `couponCode` but the cart has one persisted, the **cart's code is used**
  (so an older Android build that doesn't send the field still honours an applied coupon).

Response order snapshot gains:
```
{ ...order, coupon: { code, couponId, discountAmount, redemptionId }, discountTotal }
```

---

## 6. Step-by-step Build Order

Each numbered step is one reviewable change. Steps 1–12 are TODAY (backend + admin).
Steps 13–16 are Android, a few days out.

**Backend — model + engine (no behaviour change yet)**

1. `packages/shared/models/coupons.schema.js`, `coupon-redemptions.schema.js`,
   `coupon-attempts.schema.js` + register all three in `packages/shared/models/index.js`.
   Include every index from §4 (aabha-dba reviews the unique/partial index choices).
2. `packages/shared/repositories/` — `coupon.repository.js`, `coupon-redemption.repository.js`,
   `coupon-attempt.repository.js` + register in the repositories index. The redemption repo owns
   `claim()`, `confirm()`, `release()`, `sweepExpired()` — nothing else touches those collections.
3. `packages/shared/utils/discount.utils.js` — **export `round2`, `floor2`, and the margin-guard
   primitive** (additive to `module.exports`, nothing else touched). This is what makes the coupon
   engine share the exact money maths instead of copying it.
4. `packages/shared/utils/coupon.utils.js` — the pure engine, no DB in the pure parts:
   - `normalizeCode(code)`
   - `validateCouponForCart({ coupon, storeId, subtotal, isFirstOrder, userIsGuest, now })`
     → `{ ok, reason }` (uses `isRuleActiveNow` + `ruleMatchesStore` from discount.utils)
   - `computeCouponDiscount({ coupon, lines })` → aggregate amount, cap applied
   - `applyAggregateMarginGuard({ amount, lines })`
   - `allocateCouponToLines({ lines, couponTotal })` → floor2 + remainder-to-largest-line
   - `applyCouponToOrderLines({ coupon, orderLines })` → writes `originalSalePrice`,
     `discountAmount`, `salePrice`; returns the re-derived total
   **Unit tests written in this same step, before any wiring.**
5. `packages/shared/utils/coupon-claim.utils.js` (or fold into the redemption repo):
   `claimRedemption()`, `confirmRedemption()`, `releaseRedemption()` with the atomic `$expr`
   total-cap update and the ordinal insert-retry loop.
6. `packages/shared/models/orders.schema.js` — add the nullable `coupon` block (§4.4).
   `packages/shared/models/carts.schema.js` — add `couponCode` (§4.5).
7. Abuse guard: `recordWrongAttempt(actorKey)` / `isAttemptBlocked(actorKey)` in
   `coupon.utils.js`, backed by `coupon-attempts` with the IST `dayKey`. Unit-test the IST day
   boundary (23:59 IST and 00:01 IST are different days; 18:29 UTC is the flip).

**Backend — admin surface**

8. `packages/shared/constants/permission.constant.js` — add the `COUPONS` block and wire it into
   the role/permission maps exactly like `DISCOUNTS`.
9. `packages/admin/src/routes/coupon/{router,controller,validator}.js` — clone the
   `discount-rule` shape, including the double role+permission gate and the
   "static path before /:id" ordering. Register in `packages/admin/src/routes/index.js`.
   Includes the auto-generate mint with collision retry.
10. `packages/admin/src/routes/pos/controller.js` — new `validateCoupon` handler +
    `couponCode` support in `sale()`. **Claim OUTSIDE the invoice re-mint retry loop**;
    confirm after the loop succeeds; release on any throw. Guest-user refusal for
    per-customer/first-order coupons. Route added to `pos/router.js`.

**Backend — customer surface**

11. `packages/user/src/routes/cart/` — `POST /coupon/apply`, `DELETE /coupon` (router +
    controller + validator), and the `coupon` block in `GET /cart`. When a coupon is applied,
    **skip the automatic discount block entirely** and zero out `discount`; `netTotalPrice`
    subtracts the coupon total instead, so the free-delivery threshold and gift tier are judged on
    post-coupon money exactly as they are today on post-discount money.
12. `packages/user/src/routes/order/controller.js` — **BOTH** paths:
    - `placeOrder` (~line 727)
    - `placeScheduledOrder` (~line 1191)
    In each: if a coupon applies → claim before the transaction, call
    `applyCouponToOrderLines` **instead of** `applyDiscountsToOrderLines`, set `discountTotal`
    and the order-level `coupon` block, confirm on commit, release on abort.
    Plus a release hook on the payment-failure / order-cancel-before-payment path.
    Plus the sweeper cron for expired HELD rows (wire into the existing cron registry).

**Admin panel (today, ships with the backend)**

13. `haper-admin/src/constants/permissions.ts` — mirror the `COUPONS` permissions.
    `haper-admin/src/api/coupons.ts` — API client, modelled on `api/discountRules.ts`.
14. `haper-admin/src/pages/Coupons/CouponsPage.tsx` + `CouponFormModal.tsx` — list + create/edit,
    modelled on `pages/Discounts/DiscountsPage.tsx` + `DiscountRuleFormModal.tsx`.
    Menu entry in `src/hooks/useMenu.ts`, route in `src/App.tsx`.
    Form must include: code field with an "Auto-generate" button, scope picker, PERCENT/FLAT,
    value, max cap, min order value, IST date-time range (reuse `configTime.ts`), total limit,
    per-customer limit, first-order-only toggle, enabled toggle.
    Code field is **read-only in edit mode**.
15. `haper-admin/src/pages/POS/NewSalePage.tsx` — coupon input + Apply/Remove, showing subtotal,
    coupon discount, payable. Sends `couponCode` on the sale. Shows the specific refusal message
    (especially REQUIRES_CUSTOMER_PHONE).

**Android (a few days out — normal flow only)**

16. `data/model/HomeModels.kt` — `CartCoupon` model + `coupon` field on `CartResponseData`
    (nullable, matching the always-emitted server shape). `data/model/OrderModels.kt` — coupon
    block on the order.
17. `ui/screens/cart/{CartViewModel,CartScreen}.kt` — coupon input row, Apply/Remove calls, the
    applied-coupon chip, error message display, and the coupon line in the bill summary.
    `data/remote/` — the two new endpoints.
18. `haper-misc/test-coupons.md` — the ✅/❌ walkthrough (mandatory, same session as the code).
    Plus a "Coupons" section appended to `haper-misc/test-pos-counter-sales.md`.

---

## 7. Edge Cases, Risks, Backward Compatibility

### The two-checkout-path trap
`placeOrder` AND `placeScheduledOrder` both call the discount engine. Coupon logic must land in
**both**. This is the highest-probability delivery bug in the whole plan — call it out in review.

### Concurrency
- **Total cap oversell:** solved by the conditional `$expr` `$inc` (§3.6). Never read-then-write.
- **Per-customer cap oversell:** solved by the unique `(couponId, userId, ordinal)` index. Never
  count-then-insert.
- **Abandoned prepaid orders burning the cap:** solved by HELD + TTL + sweeper + release on abort.
- **POS invoice retry double-burn:** claim sits outside the retry loop.
- **Double-release:** the release is a status-guarded `findOneAndUpdate`, so it is idempotent.

### Money
- **Rounding drift:** allocate with `floor2` and push the remainder into the largest line so
  allocations sum EXACTLY to the coupon total, then re-derive the stored total from the lines.
  Never round the percentage itself.
- **Below-cost selling:** aggregate margin guard, skipping `costPrice === 0` lines (the repo's
  "0 means cost unknown, never fake it" invariant).
- **Cost basis:** profit/COGS reads the order's `items.costPrice` snapshot, not live cost — the
  coupon does not touch `costPrice`, so this stays correct by construction.
- **Coupon larger than the cart:** clamp to the subtotal; the payable floor is charges only,
  never negative. A ₹100 coupon on a ₹60 cart gives ₹60 off, not a ₹40 credit.
- **Interaction with wallet:** the coupon applies to the item subtotal *before* wallet redemption,
  exactly where the automatic discount sits today. No change to wallet maths.
- **Interaction with free delivery / gift tier:** both are judged on the post-coupon net, exactly
  as they are judged on post-discount net today. This means a coupon can push an order under the
  free-delivery threshold — that is the existing, intentional behaviour for discounts and we keep
  it consistent. Flag it to the user so nobody is surprised by a support ticket.
- **`minOrderValue` basis:** evaluated on the **pre-discount item subtotal** (excluding delivery
  and platform charges, excluding free-gift lines). Documented in the admin form's helper text so
  the marketing intent is unambiguous.

### Abuse / security
- No coupon amount is ever accepted from a client — only the code.
- Only `super_admin` can write coupons; the double gate exists because store_admin bypasses the
  permission middleware.
- Wrong-attempt counter lives in Mongo (not the degradable cache) and is keyed per IST day.
- A real-but-not-currently-usable code is NOT a wrong attempt — otherwise a customer with a valid
  expired code locks themselves out for nothing.
- Checkout re-validation of an already-applied code bypasses the limiter.
- Code enumeration: the auto-generate alphabet excludes lookalikes and mints 8 chars; combined
  with the 3/day limit, brute force is not viable.

### Failure modes
- Coupon collection unreachable at cart preview → **fail closed** with a specific error on the
  apply endpoint; but `GET /cart` with a persisted code that can't be resolved should render
  `coupon.valid: false` + a message rather than 500 the whole cart.
- Checkout can't claim → 400 with the reason, no order created, no stock consumed.
- Transaction aborts after a claim → release fires; sweeper is the backstop.

### Backward compatibility (each existing behaviour, and why it keeps working)

| Existing behaviour | How it stays unchanged |
|---|---|
| Automatic discounts (`discount-rules`) | Untouched. The engine is only *not called* when a coupon is applied to that specific order. Rules, admin UI, cart preview all identical. |
| `GET /cart` without a coupon | `coupon` block is additive and zeroed; `discount` block unchanged. Existing clients ignore the new key. |
| `POST /order/place` without `couponCode` | Byte-identical code path to today. |
| `POST /admin/pos/sale` without `couponCode` | Byte-identical to today, including the invoice retry loop. |
| Invoices (`invoice.utils.js` rate = `salePrice`) | The coupon writes `salePrice` = actually-paid unit price, same as the discount engine. No change needed. |
| GST per line | Computed on the rewritten per-line `salePrice`. Allocation guarantees lines sum to the total. |
| Refunds / partial refunds | Read per-line paid price. Unchanged semantics. |
| `actualOrderValue`, profit/COGS, profit snapshots | Read snapshots (`salePrice` / `items.costPrice`). Unchanged. |
| Order emails | Already fixed to read `items.salePrice`. Coupon needs no change there. |
| Existing orders (no coupon field) | `coupon` reads as `null`/absent; every read must use `order.coupon?.code ?? null`. |
| Android Gson | Every new key is always emitted by the server, and every new Kotlin field is nullable. |
| Referral codes | Completely separate collection, separate endpoints, separate wallet flow. Not touched, not merged, not validated against. |
| Free-gift lines | Excluded from the coupon basis and allocation, same as the discount engine. |
| `discountsEnabled: false` stores | Unchanged for automatic discounts. Coupons are independent — pending Q5. |

### Rollback strategy
1. Fastest, no deploy: toggle every coupon to `enabled: false` from the admin panel. Coupons stop
   working immediately; existing orders keep their snapshots.
2. If the code path itself misbehaves: an env/config kill switch checked at the top of
   `validateCouponForCart` returning `NOT_FOUND` for everything, so no deploy is needed to disable
   the feature globally. **Add this in step 4 — it is cheap insurance for a same-day prod ship.**
3. Full revert: the schema changes are purely additive, so reverting the code leaves the new
   collections orphaned but harmless. No data migration to undo.

### Hard to reverse (flagged)
- **Codes handed to customers.** Once `WELCOME50` is printed on a poster, it cannot be renamed —
  which is exactly why the code is immutable after creation.
- **The unique index choice on `code`** (plain-uppercase vs collation) is awkward to change later
  because it requires an index rebuild on a live collection. Decide it in Q4 *before* building.
- **Redemptions already given.** If the maths is wrong on day one, refunds are manual. This is why
  the pure engine is unit-tested before any wiring (step 4).

---

## 8. Test Strategy

### Unit (pure, no DB — the bulk of the value, written in step 4)
- PERCENT / FLAT maths, `maxDiscountAmount` cap, coupon > cart clamp.
- Allocation: sums to the total EXACTLY across awkward splits (₹50 over 3 lines, ₹0.01 remainders,
  a single line, a line with quantity 7).
- Aggregate margin guard, including the `costPrice === 0` skip and a fully-zero-cost cart.
- Free-gift lines excluded from basis and allocation.
- `validateCouponForCart` for every reason code: NOT_FOUND, DISABLED, NOT_STARTED, EXPIRED,
  EXHAUSTED, BELOW_MIN_ORDER, NOT_FIRST_ORDER, WRONG_STORE, CUSTOMER_LIMIT_REACHED,
  REQUIRES_CUSTOMER_PHONE.
- IST boundaries: coupon active at 23:59 IST (= 18:29 UTC), not at 00:00 IST the next day;
  `[start, end)` half-open window matching the discount engine.
- Attempt-counter IST day rollover.
- Code normalization + the auto-generate alphabet (no I/O/0/1).

### Integration (in-memory Mongo ONLY — never the real DB; run from the package dir with
`NODE_ENV=test npx jest`)
- Apply → `GET /cart` shows coupon, `discount` is zeroed (override proven, not just claimed).
- Remove → cart returns to exactly the pre-coupon totals including the automatic discount.
- Checkout writes: per-line `originalSalePrice`/`discountAmount`/`salePrice`, order `coupon`
  block, `discountTotal`; per-line paid amounts sum to the order total.
- **Total-cap concurrency:** fire N+5 simultaneous claims at a cap of N; assert exactly N succeed
  and `usedCount === N`.
- **Per-customer concurrency:** two simultaneous claims for the same user at a limit of 1; exactly
  one wins.
- Abort path: force the checkout transaction to throw after the claim → assert the redemption is
  released and `usedCount` is back where it started.
- Sweeper releases a HELD row past its TTL.
- 3 wrong attempts then a 4th → TOO_MANY_ATTEMPTS; a *valid* code after 3 wrong attempts on an
  already-applied coupon still checks out.
- **`placeScheduledOrder` gets its own full copy of the checkout assertions.**
- POS: guest refusal for per-customer/first-order coupons; success with a real phone;
  invoice-retry does not double-burn.
- **No-coupon regression:** cart, place-order and POS-sale responses are identical to the
  pre-change baseline.

### Admin FE (Vitest — baseline is 273 tests with 5 known-failing OrderDetailsModal tests;
"green" means still exactly those 5)
- `CouponFormModal` validation, auto-generate button, code read-only in edit mode.
- `CouponsPage` list + toggle.
- `NewSalePage` coupon apply/remove/error rendering.

### Manual E2E before the prod ship (today)
1. Create `TESTOFF10` (10%, cap ₹50, min ₹200, total 3, per-customer 1) on dev.
2. Apply on a ₹150 cart → BELOW_MIN_ORDER. Add items → applies, ₹50 cap visible.
3. Place the order → totals match the screen; `usedCount` = 1.
4. Same customer applies again → CUSTOMER_LIMIT_REACHED.
5. Two more customers redeem → third gets EXHAUSTED.
6. POS: apply for a walk-in with no phone → REQUIRES_CUSTOMER_PHONE; with a phone → works.
7. Type 3 junk codes → 4th refused; the already-applied coupon still checks out.
8. Toggle the coupon off → immediately unusable.

### Android (a few days out) — normal flow only, per the user's instruction
Apply valid code → total drops → place order → order shows the coupon. Remove → total restores.
Invalid code → message, no total change. No edge-case sweep on the client.

---

## 9. Deliberate cuts for the same-day ship (and what is NOT cuttable)

**Cut from v1 (add later if asked):**
- Recurrence windows (happy-hour coupons). `schedule.recurrence` is stored as `null` and the
  evaluator already handles that — adding it later is additive.
- SKU / category targeting (see Q3). v1 is whole-cart only.
- The catalog "analyze / below-cost preview" scan that the automatic rules have.
- Coupon reporting / analytics screens (the `/redemptions` endpoint gives the raw data).
- Per-customer *cohort* targeting (new users only beyond `firstOrderOnly`, specific user lists).
- iOS and web clients.

**NOT cuttable, at any deadline:** the claim/confirm/release concurrency work (§3.6), the
per-line allocation (§3.3), and fail-closed validation (§3.5). Those three ARE the correctness
story; shipping without them means overselling coupons and mis-billing invoices.

---

## 10. Open Questions (blocking — please answer before build starts)

**Q1. Redemption claim approach — confirm the HELD/CONFIRMED/RELEASED design.**
The alternative is "only count a redemption once the order is fully paid", which is simpler but
lets a popular coupon be redeemed past its cap by everyone who is mid-checkout at the same moment.
Recommended: HELD + TTL + sweeper as designed in §3.6. Confirm, and confirm the **15-minute hold
window** is right for your payment flow.
*Sub-question:* on release, do we **delete** the redemption row (frees the ordinal slot
immediately) or keep it as RELEASED with a **partial unique index** (immutable audit trail)?
Recommended: partial unique index.

**Q2. POS attempt keying — what identifies the "customer" for the 3-wrong-attempts-per-day limit
at the counter?**
Options: (a) the admin user ringing up the sale (`admin:<adminId>`) — protects against a scripted
attacker but a busy counter could plausibly hit 3 typos in a day; (b) the customer's phone when
present, falling back to the admin id; (c) no limit at POS at all, since it is a trusted
authenticated employee.
Recommended: (c) — skip the limiter for POS entirely; the abuse vector it defends against is
anonymous guessing, and blocking a cashier mid-queue is a worse outcome. Needs your call.

**Q3. Whole-cart-only, or do you need SKU/category targeting on day one?**
Whole-cart-only ("₹50 off your order") is what the ship-today timeline supports. Item-targeted
coupons ("20% off all Dairy") need the targeting matcher, a different allocation basis, and a
different minimum-order interpretation. If you need targeting, it is a follow-up release, not
today. Confirm whole-cart-only for v1.

**Q4. Code case-sensitivity — how should `welcome50` vs `WELCOME50` behave?**
Recommended: **case-insensitive** — normalize to uppercase on write and on every lookup, with a
plain unique index on the uppercased field. (The alternative, a collation-based unique index, is
harder to change later.) Customers type codes on phone keyboards; case-sensitive codes generate
support tickets. Confirm — this is hard to change after codes are live.
*Related:* confirm the code format rule `^[A-Z0-9][A-Z0-9_-]{3,19}$` (4–20 chars) is acceptable
for the codes marketing wants to use.

**Q5. Does `store.config.discountsEnabled` gate coupons too?**
Recommended: **no** — coupons are an independent, deliberate super-admin lever, and a store with
automatic discounts switched off should still be able to honour a marketing code. But if you want
one master "no price reductions at this store" switch, say so and coupons will be gated by the
same flag (or by a new `couponsEnabled` flag, which is a third option).

**Q6 (non-blocking, but flag it now).** A coupon can push an order below the free-delivery
threshold, so the customer sees a delivery charge appear when they apply a coupon. This is the
existing behaviour for automatic discounts and the plan keeps it consistent. Confirm you are OK
with that, or we judge free delivery on the pre-coupon subtotal instead (a one-line change, but a
deliberate inconsistency with the discount engine).

---

## 11. Fleet Routing (after approval)

| Specialist | Owns |
|---|---|
| **aabha-dba** | §4 schemas, the unique/partial index decisions, the TTL index, concurrency review of the claim mechanism |
| **sumit-backend** | Steps 1–12: models, repos, `coupon.utils.js`, claim/release, admin CRUD, POS, cart, both checkout paths, sweeper cron |
| **hemant-payments** | Money review: allocation, aggregate margin guard, the release-on-payment-failure hook, coupon×wallet×charges interaction |
| **chanchal-designer** | Admin coupon form + POS coupon row spec; Android checkout coupon-entry spec |
| **tanmoy-web** | Steps 13–15: admin panel Coupons page + POS coupon UI |
| **siddhart-android** | Steps 16–17 (a few days out), normal flow only |
| **santosh-tester** | §8 unit + integration suites, especially the concurrency and both-checkout-paths cases |
| **mayank-reviewer + navjot-security** | Mandatory review — this is money-touching and ships straight to prod |
| **priyanka-docs** | `haper-misc/test-coupons.md` + the POS guide's coupon section (step 18) |
| **kiran-git** | Commit direct to `dev`, staged explicitly by path. **`main` stays off-limits; the prod deploy is the user's manual act.** |

*Not involved:* stas-realtime (nothing realtime), rohit-ai, deepanshu-data (no pipeline work),
setu-ios (deferred).

---

## 12. References

- `haper-misc/discounts-promotions-plan.md` — the engine this builds on; §2 approved decisions
  (FLAT-per-unit, margin guard, strikethrough), §8 risk patterns.
- `haper-backend/packages/shared/utils/discount.utils.js` — the pure helpers being reused.
- `haper-backend/packages/admin/src/routes/discount-rule/router.js` — the double role+permission
  gate to copy verbatim.
- `haper-backend/packages/admin/src/routes/pos/controller.js` — the POS transaction + invoice
  retry loop the claim must sit outside of.
- `haper-backend/packages/user/src/routes/order/controller.js:727` and `:1191` — the two
  checkout paths.
- `haper-misc/test-discounts.md`, `haper-misc/test-pos-counter-sales.md` — the walkthrough style
  `test-coupons.md` must match.

---

**End of plan. Not approved for implementation until the user answers Q1–Q5.**
