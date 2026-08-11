# Test guide — Discounts / Promotions (Phase 1)

Feature plan: `discounts-promotions-plan.md`. Admin UI design: `discounts-admin-ui-design.md`.
Backend: `haper-backend` (`packages/shared/utils/discount.utils.js` engine, `packages/admin/src/routes/discount-rule/*` CRUD, wired into user item/home/cart/order).

Needs: backend deploy (dev) + admin deploy. No migration. No client (Android/iOS/web) change is
required — all new customer fields are additive and default to null/empty.

---

## 0. Turn the feature on (this is a per-store switch)

`stores.config.discountsEnabled` — **off by default for every store**.

- ✅ Admin → Stores → edit the store → save with `discountsEnabled` true
  (`PUT /admin/store/:storeId { "discountsEnabled": true }`; same wiring as
  `giftWithPurchaseEnabled`).
- ❌ Before the fix there was NO write path at all — the flag could only be set by hand in the DB.
- Edge: flag off ⇒ browse/cart/checkout behave exactly as before the feature (no extra DB reads
  either — the flag is checked first).

---

## 1. Admin — create a rule

`/admin/discount-rule` (super-admin only, `discounts.manage`).

- ✅ 10% off everything, live now → saves, `affectedItemCount` shows the true catalog count.
- ✅ Preview (`POST /admin/discount-rule/preview`) shows up to 10 before/after prices and never saves.
- ❌ A rule targeting nothing (no allItems / categories / iIds) is rejected.
- ❌ PERCENT outside 1–100 rejected; FLAT ≤ 0 rejected; FLAT above 100000 rejected (structural ceiling).

## 2. Admin — the below-cost / zero-price gate

Two reasons block a save, both cleared by re-submitting with `acknowledgeBelowCost: true`:

- ✅ **Below cost** — item sellingPrice 100 / costPrice 50, rule 80% off → blocked, `belowCostItems`
  lists it with `intendedPrice`, `clampedPrice`, and now `chargedPrice` + `ruleApplies:false`.
- ✅ **Prices to zero (cost UNKNOWN)** — item sellingPrice 9 / **costPrice 0**, rule ₹9 FLAT off →
  blocked with `zeroPriceItems` (this case previously produced NO warning at all, because
  costPrice 0 means "cost unknown" and the margin guard is skipped there).
- ✅ Same for a known-cost item that would price under ₹1.
- ❌ A FLAT value bigger than the price of EVERY item the rule targets → hard **400**, not an
  acknowledgeable warning ("check the value for a typo"). Acknowledging does not help.
- ✅ Acknowledging writes a CRITICAL audit row containing the actual item list (not just a count),
  so "who approved selling what below cost" is reconstructable. If the audit write fails, the
  request fails — the rule is not silently saved unrecorded.

## 3. Customer — browse / detail / home / cart

- ✅ Discounted item shows `discountedPrice`, `discountAmount` (per unit), `discountLabel`
  ("20% OFF" / "₹15 OFF"), `appliedDiscounts`.
- ✅ `appliedDiscounts` entries are `{ label, amount }` only — **no ruleId, no internal rule name,
  no type/value**. Cart `discount.lines[]` is `{ lineIndex, label, amount }`.
- ✅ **A below-cost (margin-clamped) item shows NO discount at all** — full price, no label.
  Reason: the clamped price is EXACTLY our costPrice, so showing it would publish our cost.
  Checkout charges the same full price, so cart and order still agree.
- ✅ `costPrice` never appears anywhere in a customer response — browse, detail, search, **cart**
  (newly stripped) or order reads.
- ✅ Flag off / no live rule / any engine error ⇒ full price, keys still present (null / []).

## 4. Customer — checkout

- ✅ Order lines snapshot `originalSalePrice`, `discountAmount` (per unit), `appliedDiscounts`
  (full detail, server-side), and `salePrice` is rewritten to the price actually paid;
  `order.discountTotal` = Σ discountAmount × quantity.
- ✅ **Rounding**: 9 @ 17% off × 2 (=7.47 each) + a 5.00 line → order total is exactly **19.94**,
  and the Razorpay amount is integer paise (**1994**). Before the fix this was
  `19.939999999999998` → `1993.9999999999998` paise → Razorpay rejected the payment
  (~14% of discounted carts).
- ✅ Free-gift lines (₹0) are never discounted.
- ✅ Fail-open: if the rule lookup breaks, checkout succeeds at FULL price (never blocked), and
  every line is fully restored to full price — including `salePrice`.

## 5. Admin — editing an order that had a discount

- ✅ Remove one line from a 2-line discounted order → the surviving line KEEPS its
  `originalSalePrice` / `discountAmount` / `appliedDiscounts`, and `order.discountTotal` drops by
  exactly the removed line's contribution.
- ❌ Discounts are NOT re-resolved on edit (an edited order must not be re-priced against today's
  rules/clock).
- ✅ A line ADDED during an edit is priced at the live price with zero discount.

---

## 6. Second review round — what changed and how to check it

- ✅ **The cart price IS the price you pay, even on a batch/FEFO store.** Set up an item at
  sellingPrice ₹100 with TWO lots — 60 units at cost ₹70 (expiring first) and 40 at cost ₹40, so
  the item-master average cost is ₹58 — turn `batchesEnabled` + `discountsEnabled` on, and run a
  40% rule. Cart shows ₹60; checkout charges ₹60. Before the fix the cart showed ₹60 and checkout
  charged the FULL ₹100, because the margin guard clamped against the oldest LOT's ₹70 at checkout
  but against the ₹58 average in the cart, and a clamped line is suppressed entirely.
  The order still snapshots the true FEFO lot cost (₹70) for COGS/profit — only the discount
  guard changed basis.
- ✅ At 50% off (breaching even the ₹58 average) BOTH cart and checkout show/charge full price —
  they agree in the clamped direction too.
- ✅ **A rule and its approval audit row commit together.** If the audit write fails, the rule is
  NOT created (create), NOT changed (update) and NOT enabled (toggle) — retrying afterwards
  creates exactly one rule, never two stacked ones.
- ✅ **A rule targeting more than 5000 items is BLOCKED for acknowledgement** even when the scan
  found nothing wrong: "could not fully verify this rule's below-cost impact". The scan is also
  now deterministic (`_id` order), so the same rule always scans the same window.
- ✅ **Runtime price floor.** Add a NEW item (cost unknown, i.e. `costPrice: 0`) priced under the
  live rule's reach — e.g. a ₹9 item with a ₹9 FLAT rule that was approved before this item
  existed. It shows and charges FULL price, not ₹0. The admin-time scan is a one-off; this check
  runs on every request, so catalog changes can't sneak past it.
- ✅ **Customer order history/detail no longer leaks rule internals.** `GET /user/order` (list),
  order detail, the place-order response, cancel and reschedule all return
  `appliedDiscounts: [{ label, amount }]` — no `ruleId`, no internal rule name, no `type`/`value`.
  The stored order document is unchanged (admin reporting still has the full snapshot).
- ✅ **Hot path**: the per-store `discountsEnabled` check is now a cached, single-field read
  (30s TTL) instead of a full store-document fetch on every browse/list/detail/home request.
  Flipping the toggle in the admin store form takes effect immediately (the cache is dropped on
  write); a flip made directly in the DB takes up to 30 seconds.

---

## Regression tests

- `haper-backend/packages/user/__tests__/discount-rounding.test.js` — the float-tail → Razorpay bug.
- `haper-backend/packages/admin/__tests__/discount-rule-zero-price.test.js` — unknown-cost /
  zero-price gate + FLAT ceiling.
- `haper-backend/packages/user/__tests__/discount-fefo-cost-basis.test.js` — cart price ==
  charged price on a multi-lot / FEFO store (the ₹58-vs-₹70 cost-basis bug).
- `haper-backend/packages/admin/__tests__/discount-rule-audit-atomicity.test.js` — a failing audit
  write leaves no live, unrecorded rule.
- `haper-backend/packages/user/__tests__/discount-store-flag-cache.test.js` — the cached, projected
  store-flag gate + its reset hook.
- Plus the existing `discount*.test.js` suites in `packages/user` and `packages/admin`.

Run: `cd packages/<pkg> && NODE_ENV=test npx jest` (in-memory Mongo only).

## Known follow-ups

- Admin UI: the store form still needs a visible "Discounts enabled" toggle (the backend write path
  now exists; `haper-admin/src/pages/Discounts/*` already warns when a store has the flag off).
