# Test: cooking-oil per-order limit — admin-configurable (NEW feature, 2026-09-15)

**Area:** Backend cart enforcement + admin configuration. Backend enforcement:
`packages/shared/repositories/cart.repository.js` (`add()`, `incrementCounter()`),
`packages/shared/utils/cart-limit.utils.js` (pure evaluation), `packages/user/src/routes/order/controller.js`
(checkout re-validation). Admin configuration: `packages/admin/src/routes/cart-limit-rule/` (new router),
`haper-admin/src/pages/CartLimits/` (new pages).

**Database:** new `cart-limit-rules` MongoDB collection, seeded by `scripts/migrations/seed-cart-limit-rules.js`.

**PR/deploy:** backend-only enforcement lands on `dev` → deploy `dapi.haper.in`. Admin FE (haper-admin)
deploys separately.

**⚠️ CRITICAL — This is NEW enforcement being introduced, not a regression-risk restoration.** Dev has
**never** had a working hardcoded Cooking Oil cap before this feature. (The only prior hardcoded rule was
a Sugar cap that was already disabled/dead code.) The seed migration is what turns this feature ON for
the first time — if the seed is not applied, or if the seeded rules are not in the collection, add-to-cart
will not enforce ANY limit.

## What changed — first time setup

**New enforcement model:** Instead of a hardcoded array in `cart.repository.js`, cart limits are now
**configured via the database** (`cart-limit-rules` collection) and administered through the haper-admin
panel. A super admin creates rules targeting a category, a group of sub-categories, or specific SKUs (by
`iId`), with a combined size limit or a unit count limit. Store admins can override just the numeric
limits for their own store.

**New seeded rule — Cooking Oil (ENABLED):**
- **Target:** Mustard Oil (`6679b349d15b89674794a7ba`) + Refined Oil (`682a33257b7e8240162cbbf7`) subcategories.
- **Limit:** 2000 ml combined across both, per order.
- **Bulk exception:** Items with pack size ≥ 5000 ml (5 L, 15 L bulk bottles) are exempt from the 2 L cap
  and instead capped at **1 unit per SKU**. Different bulk SKUs are independent (1×5 L + 1×15 L OK).
- **Message:** "Max 2 L of Cooking Oil per order (combined). You can add N more …" — identical text to the
  old hardcoded version.

**Sugar rule (seeded but DISABLED):**
- Kept in the database as a template in case re-enabling is needed later, but enforces nothing today
  (`enabled: false`).

**To activate enforcement:** Run the seed migration **before** deploying the feature code to an environment.
```bash
node scripts/migrations/seed-cart-limit-rules.js --apply
```
Dry-run (the default) shows what would be seeded without writing:
```bash
node scripts/migrations/seed-cart-limit-rules.js
```

The seed is idempotent — if a rule named "Cooking Oil" already exists, it is skipped (admin edits to the
limit are never overwritten).

## Customer-facing behaviour (unchanged from intent)

- **✅ Add-to-cart blocks past the limit.** Cart has 1 L Mustard Oil → try to add 1.5 L Refined Oil →
  **400** with `LIMIT_EXCEEDED: Max 2 L of Cooking Oil per order (combined). …`, header
  `X-Cart-Notice: LIMIT_EXCEEDED`.
- **✅ Exactly at the cap is allowed.** 1 L Mustard + 500 ml Refined + 500 ml Refined = 2000 ml → OK.
  One more 500 ml (2500 ml) → blocked.
- **✅ Bulk packs are exempt and independent.** Empty cart → add 1× "5 L" Mustard oil → OK (never hits
  the 2 L cap). Add 1× "15 L" Refined in the same cart → also OK (two different bulk SKUs, each capped at
  1 unit). But add the **same** 5 L Mustard again → **400** "Max 1 unit of 5 L Cooking Oil per order."
- **✅ Bulk packs don't consume the combined budget.** With 1× 5 L + 1× 15 L in the cart, adding a 2 L
  regular Mustard Oil still succeeds (the bulks are off their own counter).
- **✅ Checkout re-validates.** A cart built **before** the rule existed (e.g. added via old hardcoded
  path, or via an old API) that exceeds the limit is **refused at checkout** with a clear message ("Your
  cart already exceeds the Cooking Oil limit. Please remove items and try again."), and no stock is
  decremented.
- **✅ Non-oil items untouched.** Any item outside the two oil subcategories is never blocked.

## Manual walkthrough (dev) — customer-facing

Prereqs: seeded rules in place (`seed-cart-limit-rules.js --apply` has run). Fresh customer, empty cart.

### A. Add-to-cart enforcement ✅

1. Search for "Mustard Oil" (any SKU, e.g. 1 L bottle) → add 1 unit to cart.
2. Add 1.5 L Refined Oil (same or different SKU, also 1.5 L) → **400 error** with message "Max 2 L of
   Cooking Oil per order (combined). You can add 500 ml more …" ✅
3. Cart still shows only the 1 L Mustard Oil (the add was rejected).
4. Remove the 1 L Mustard, add 2×1 L Refined instead → **400 error** "Max 2 L of Cooking Oil per order."
   ✅
5. Cart only has 1×1 L Refined. Add 1 L Mustard → **OK**, cart now has 1 L + 1 L = 2 L combined. ✅

### B. Bulk pack exemption ✅

1. Empty cart (remove all items from walkthrough A).
2. Search "5 Litre" (or "15 Litre" — any bulk SKU in the oils) → add 1 unit → **OK** (bulk pack, never
   blocked by the 2 L cap). ✅
3. Try to add the **same** bulk SKU again → **400** "Max 1 unit of 5 Litre Cooking Oil per order." ✅
4. Add a **different** bulk SKU (if available, e.g. 15 L) → **OK**. Two different bulk SKUs are independent.
   ✅
5. With 1× bulk in cart, add a 1 L regular-size oil → **OK** (bulk doesn't consume the combined budget).
   ✅

### C. Checkout block (pre-existing cart) ✅

1. Directly insert a cart into Redis that exceeds the 2 L limit (e.g. via test fixture or a cache
   write). Example: 2.5 L of combined oils.
2. `POST /user/order/place` with that cart → **400** "Your cart already exceeds the Cooking Oil limit.
   Please remove items and try again." ✅ (No order created, stock unchanged.)

### D. Store override (admin panel) ✅

Prerequisites: haper-admin logged in as `store_admin` for a specific store (e.g. Bihar store).

1. Navigate to **Admin → Cart Limits** (new menu item).
2. You see the global "Cooking Oil" rule read-only: 2 L combined, bulk ≥5 L exempt, 1 unit each.
3. Below it, an **Override** section shows: "Limit: 2 L" (the global default). Click **Edit**.
4. Change to **3 L**, click **Save** → the override is created. The **Effective** value now shows 3 L.
5. Go back to the customer storefront (as a customer), add oil to cart:
   - 1.5 L Mustard + 1.5 L Refined = 3 L → **OK** (this store's override is 3 L).
   - Add another 0.5 L → **400** "Max 3 L of Cooking Oil per order." ✅
6. In admin, delete the override → the **Effective** value reverts to the global 2 L.
7. Test as customer again: 1 L + 1 L = 2 L → **OK**, 1 L + 1.5 L → **400**. (Back to the global limit.)

## Edge cases

- **Mislabelled catalog rows trust their STORED `weight`/`unit`, not their name.** A product named
  "Fortune Refined Oil - 5 Ltr Bottle" but stored with `weight: "1 L"` is treated as 1 L, not 5 L.
  Fixing the catalog is a separate task.
- **Missing/unparseable `weight`** → 0 base units: the item never triggers the limit and is never
  considered bulk.
- **Multi-category items** (tagged with oil as a secondary pair): are counted against the limit if they
  carry Mustard Oil or Refined Oil anywhere in their `taxonomy[]` array. This is intentional (gap (c) fix
  in the plan) — a rule that any multi-tagged SKU escapes would not be a real cap.
- **Quantity decrements** (removing items) skip the check — users can always remove things.
- **Admin-initiated order edits** are exempt from the limit (support agents can fix orders that would
  violate caps).

## Not covered / follow-ups

- **Cart built via old paths** (if any still exist) that exceed the limit: checkout re-validation catches
  them, fail-closed. No auto-trim.
- **POS counter sales** are deliberately exempt (staff are trusted, and fair-share caps don't apply to
  in-person staff sales). No enforcement on POS `sell()`.
- **Sugar** rule is present but disabled — re-enabling is a business decision (admin creates a new rule or
  toggles the existing one on).

## Automated coverage

`cd packages/user && NODE_ENV=test npx jest cart-limit` — suite includes:
- `cart-cooking-oil-limit.test.js` (adapted from the old hardcoded test; now uses seeded DB rule):
  combined cap, bulk exemption per SKU, mislabelled trust, multi-category matching, checkout re-validation
  of pre-existing over-limit carts.
- `cart-limit-rule-enforcement.test.js` (new): category-level rules, item-level rules, UNITS-type rules,
  store override raises/lowers/disables limit, secondary-taxonomy item counted, edit invalidates cache and
  takes effect.
- `cart-limit-checkout.test.js` (new): over-limit cart on both `placeOrder` and `placeScheduledOrder`
  paths, no stock decremented, clear error message.

`cd packages/admin && NODE_ENV=test npx jest cart-limit` — permission matrix tests (super_admin full CRUD,
store_admin read-only + override), E11000→409 conflict mapping, cascade-delete on global rule deletion.

`cd packages/user && NODE_ENV=test npx jest` — **regression:** all 1281+ existing cart/checkout tests still
pass (the limit enforcement is **additive**, not a rewrite). Sugar stays disabled.

## Commands

- **Seed migration (dry run):** `node scripts/migrations/seed-cart-limit-rules.js`
- **Seed migration (apply):** `node scripts/migrations/seed-cart-limit-rules.js --apply`
- **Backend tests:** `cd packages/user && NODE_ENV=test npx jest` (in-memory Mongo only)
- **Admin API tests:** `cd packages/admin && NODE_ENV=test npx jest cart-limit` (permission matrix, API
  contract)

## Summary

This feature introduces **new enforcement** of a 2 L Cooking Oil per-order cap, configurable from the admin
panel. It is NOT restoring a previously-working hardcoded cap that was lost — dev never had a working Oil
cap before. The seed migration is what turns the feature on. After seeding, customers will see the limit
enforced on add-to-cart and checkout, store admins can override the numeric values for their own store, and
super admins can create new rules or modify this one from the admin panel.
