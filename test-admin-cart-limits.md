# Test: admin Cart Limits configuration panel (2026-09-15)

**Area:** Admin API + admin FE configuration. Backend routes:
`packages/admin/src/routes/cart-limit-rule/` (new router, controllers, validators). Admin FE pages:
`haper-admin/src/pages/CartLimits/` (CartLimitsPage, CartLimitRuleFormModal, StoreOverridePanel).

**Database:** `cart-limit-rules` collection (read via super/store admin endpoints).

**PR/deploy:** admin package → `dapi.haper.in` (backend). haper-admin → `damin.haper.in` (frontend).
Admin FE depends on the backend API being live.

## What this covers

Staff (super admin and store admin) use this interface to:
1. **Super admins:** Create, edit, enable/disable, and delete global rules. View the blast radius
   (preview/warnings) before saving. See all rules and their effective values.
2. **Store admins:** View global rules read-only. Create and remove store-level overrides of the numeric
   limits for their own store only. Cannot touch global rules or access another store's config.

The feature enforces a **hard permission boundary** — the FE mirrors the BE permission checks, and both
routes and role gates protect write operations.

## Manual walkthrough (dev) — super_admin

Prereqs: logged into haper-admin as `super_admin`, `/admin/cart-limits` page accessible.

### A. List and view global rules ✅

1. Open **Admin → Cart Limits**.
2. A table shows existing rules (at least the seeded "Cooking Oil" rule):
   - **Name:** "Cooking Oil"
   - **Enabled:** toggle ON
   - **Target:** "Sub-Categories: Mustard Oil, Refined Oil"
   - **Limit:** "2 L combined"
   - **Bulk exception:** "Packs ≥ 5 L max 1 unit each"
   - **Store override:** "none" (if not logged in as a specific store)
3. ✅ The rule detail shows all these fields read-only if you click into it.

### B. Create a new category-level rule ✅

1. Click **+ Add Rule**.
2. Fill in:
   - **Name:** "Premium Items" (or any test name)
   - **Description:** "Test rule for demo" (optional)
   - **Target type:** "Category" (dropdown)
   - **Select category:** pick any category (e.g. "Dairy")
   - **Limit type:** "SIZE" (dropdown)
   - **Limit value:** "1000" (e.g. 1000 ml)
   - **Base unit:** "ml" (dropdown)
   - Leave **Bulk exception** empty (optional)
3. Click **Save**.
4. ✅ The rule is created and shows in the list. Toggle it ON in the list view.
5. ✅ Add it to a test cart: a customer ordering from the Dairy category now sees the 1 L limit enforced.
6. Click to edit this rule:
   - Change the limit to "2000".
   - Click **Save**.
   - ✅ The change is effective within ~60 seconds (no restart needed). Test on the storefront.

### C. Create a rule with sub-categories (group targeting) ✅

1. Click **+ Add Rule**.
2. Fill in:
   - **Name:** "Oil Group Test"
   - **Target type:** "Sub-Category Group" (or "Multiple Sub-Categories")
   - **Select sub-categories:** pick the two oil sub-categories (Mustard Oil, Refined Oil), or any two
     others.
   - **Limit type:** "SIZE"
   - **Limit value:** "3000" (3 L)
   - **Base unit:** "ml"
   - **Bulk exception:** threshold = 6000, maxUnits = 1
3. Click **Preview** (before save).
4. ✅ The preview shows:
   - "Matched items: N" (count of SKUs in those sub-categories)
   - "Stores affected: M" (which stores have items tagged with these sub-categories)
   - "Unbuyable items: []" or a warning if any item is smaller than the limit with no bulk exception.
5. Click **Save**.
6. ✅ Rule is created and enforced.

### D. Create a unit-count rule (not size-based) ✅

1. Click **+ Add Rule**.
2. Fill in:
   - **Name:** "Per-Item Qty Cap"
   - **Target type:** "Item" (or "SKU")
   - **Select items:** pick 2–3 specific SKUs (e.g. expensive chocolates).
   - **Limit type:** "UNITS" (not SIZE)
   - **Limit value:** "5" (max 5 of each)
   - Leave **Base unit** unset (not applicable for UNITS).
   - Leave **Bulk exception** empty (not applicable for unit counts).
3. Click **Save**.
4. ✅ Rule is created. A customer adding these items sees "Max 5 of this item per order" when they
   exceed it.

### E. Bulk exception validation — reject invalid thresholds ✅

1. Click **+ Add Rule**.
2. Fill in:
   - **Name:** "Invalid Bulk Test"
   - **Target type:** "Category" (any)
   - **Limit type:** "SIZE"
   - **Limit value:** "2000" (2000 ml limit)
   - **Bulk threshold:** "1000" (smaller than limit — invalid!)
   - **Bulk max units:** "1"
3. Click **Save**.
4. ✅ **400 error:** "Bulk threshold (1000) must be greater than or equal to the limit (2000)." The rule
   is NOT created.
5. Fix it: change threshold to "3000" (larger than limit).
6. Click **Save**.
7. ✅ Rule is created successfully.

### F. Target conflict — two rules cannot target the same thing ✅

1. You have "Cooking Oil" (Mustard Oil + Refined Oil, ENABLED).
2. Click **+ Add Rule**.
3. Fill in:
   - **Name:** "Conflicting Oil Rule"
   - **Target type:** "Sub-Category"
   - **Select sub-categories:** "Mustard Oil" (overlaps with existing Cooking Oil rule)
   - **Limit type:** "SIZE"
   - **Limit value:** "1500"
4. Click **Save**.
5. ✅ **409 Conflict:** "Target 'Mustard Oil' is already covered by the enabled rule 'Cooking Oil'. No two
   enabled rules may share a target." The rule is rejected.
6. Toggle "Cooking Oil" OFF (disable it).
7. Click **Save** on the conflicting rule again.
8. ✅ **OK** — both exist, but only one is enabled at a time. (Conflicting targets are only an error if
   both are enabled.)

### G. Toggle rule on/off ✅

1. In the list, find the "Cooking Oil" rule.
2. Click the **Enabled** toggle → OFF.
3. ✅ Toast: "Rule disabled. Changes apply within 60 seconds."
4. On the storefront, add oils to cart — no 2 L limit enforced (the rule is off).
5. Back in admin, toggle **Enabled** → ON.
6. ✅ Toast: "Rule enabled. Changes apply within 60 seconds."
7. Wait ~5 seconds, go to storefront, try to add 2.5 L of oil → **blocked**.

### H. Dangling target warning (for reference) ✅

(This requires a real catalog edit, not typical in testing, but documented for QA.)
1. If an admin deletes a category or sub-category that a rule targets, the rule's target id becomes
   dangling.
2. In the admin list, the rule shows a warning chip: "Target 'Old Category' no longer exists."
3. The rule still exists and can be edited, but it matches no items (silently safe, no enforcement).

### I. Delete a rule ✅

1. In the list, find a test rule (e.g. "Premium Items").
2. Click **Delete** (or a trash icon).
3. ✅ **Confirm dialog:** "Deleting this rule will affect N customers. Are you sure?"
4. Click **Confirm**.
5. ✅ Rule is deleted. If it had any store overrides, they are cascade-deleted (no orphans).
6. ✅ Enforcement stops within 60 seconds.

---

## Manual walkthrough (dev) — store_admin

Prereqs: logged into haper-admin as `store_admin` for a specific store (e.g. Bihar store),
`/admin/cart-limits` page accessible.

### A. List rules as read-only ✅

1. Open **Admin → Cart Limits**.
2. ✅ You see the "Cooking Oil" rule and other global rules, but **ALL fields are read-only** —
   no edit/delete buttons, no ability to change the target or limit.
3. A note or description field says: "These are global rules managed by your team. You can override the
   numeric values for your store only." ✅
4. Below each rule, an **Override** section shows the current effective value for your store:
   - **Global:** 2 L (if no override)
   - **Store override:** "None" (if you haven't set one)
   - **Effective:** 2 L (the one in force)

### B. Create a store-level override (raise the limit) ✅

1. Find the "Cooking Oil" rule.
2. In the **Override** panel, click **Edit**.
3. A form appears with fields for this store only:
   - **Enabled:** toggle (default ON, inherits from global)
   - **Limit value:** "2000" (global default, preformed)
   - **Bulk threshold:** "5000" (preformed if bulk exists)
   - **Bulk max units:** "1" (preformed if bulk exists)
4. Change **Limit value** to "3000" (3 L — your store has more stock).
5. Leave the rest as-is.
6. Click **Save**.
7. ✅ Toast: "Override created. Changes apply within 60 seconds."
8. The override panel now shows:
   - **Global:** 2 L
   - **Store override:** 3 L (with an edit/delete button)
   - **Effective:** 3 L ✅
9. On your storefront, a customer can now add up to 3 L of oil per order.

### C. Modify an existing override ✅

1. The "Cooking Oil" override now shows "3 L".
2. Click **Edit**.
3. Change to "2500" (2.5 L).
4. Click **Save**.
5. ✅ The effective limit is now 2.5 L (updated within 60 seconds).

### D. Delete/remove an override (revert to global) ✅

1. The "Cooking Oil" override shows "2.5 L".
2. Click **Delete** (or **Remove Override**).
3. ✅ Confirm dialog: "This will revert to the global limit (2 L)."
4. Click **Confirm**.
5. ✅ The override is deleted. The panel now shows:
   - **Store override:** "None"
   - **Effective:** 2 L (back to global)
6. Behavior changes on your storefront immediately (~60 sec): 2 L limit re-applied.

### E. Disable a rule for your store only ✅

1. Find "Cooking Oil" (no override yet).
2. Click **Edit Override**.
3. Flip **Enabled** to OFF.
4. Click **Save**.
5. ✅ Toast: "Rule disabled for your store."
6. The effective value shows as "Disabled" or grayed out.
7. On your storefront, oil can be added without a 2 L limit (it's off in this store only).
8. Other stores still see the 2 L limit (they have the global rule).

### F. Attempt to access global rule creation — should fail ✅

1. As a `store_admin`, try to navigate to a "Create rule" page or API.
2. ✅ **403 Forbidden:** "You don't have permission to manage global cart limit rules. Store admins can
   only override existing rules for their own store."
3. The **+ Add Rule** button is NOT visible in the UI (FE permission gate).
4. If you try the API directly: `POST /admin/cart-limit-rule` → **403**.

### G. Attempt to override another store — should fail ✅

1. As a `store_admin` for Bihar store, try to create/edit an override for a different store (e.g. in the
   API or URL).
2. ✅ **403 Forbidden:** The override is ALWAYS keyed to your own store (`req.store._id`). The body
   parameter `storeId` is rejected as forbidden (Joi validation) or silently ignored.
3. Result: you can only override for your own store.

---

## Edge cases and error states

### Permission boundary ✅

- **Super admin without store context** (no `x-store-id` header): can create/edit/delete global rules,
  see all rules across all stores.
- **Super admin WITH store context** (e.g. switched to Bihar via `x-store-id`): can still edit global
  rules, **and** sees store overrides for that store (in addition to the global rules).
- **Store admin:** can ONLY see and override for their own store. Cannot see another store's overrides or
  create global rules.
- **Manager / Support / Warehouse roles:** should see NO cart-limits pages (role gate 403). Neither
  permission (`cart_limits.view` / `cart_limits.manage`) is in their preset today (Phase 1).

### Validation errors ✅

| Scenario | Expected error | HTTP |
|----------|---|---|
| No target selected (empty list) | "At least one target must be selected." | 400 |
| Limit value ≤ 0 | "Limit must be greater than 0." | 400 |
| Bulk threshold < limit | "Bulk threshold must be ≥ limit value." | 400 |
| Bulk max units ≤ 0 | "Bulk max units must be at least 1." | 400 |
| Target array has > 100 items | "Too many items selected (max 100)." | 400 |
| Overlapping enabled targets | "Target X is already covered by rule Y." | 409 |
| Editing a rule that no longer exists | "Rule not found." | 404 |
| Store override for a non-existent global rule | "Rule not found." | 404 |
| Store override with no store context (`x-store-id` missing) | "No store context." | 400 |

### Cascade-delete behavior ✅

1. A global "Cooking Oil" rule exists.
2. Bihar store has an override: 3 L.
3. Chapra store has an override: 2 L.
4. Delete the global rule from the list.
5. ✅ Confirm: "Deleting this rule will remove 2 store-level overrides."
6. Confirm delete.
7. ✅ The global rule AND both overrides are deleted in one transaction.
8. No orphaned `overrideOf` rows left behind.

### 60-second effectiveness window ✅

1. Super admin creates a new rule limiting widgets to 5 units.
2. At `T=0`, the rule is saved.
3. At `T=30`, a customer adds widgets → limit is NOT yet enforced (may not be in customer-process cache).
4. At `T=65`, the same customer tries again → limit IS enforced (cache invalidation has fired, new rules
   loaded).
5. ✅ Message explains: "Changes to cart limit rules apply within 60 seconds. No restart needed."

### Preview / blast radius warnings ✅

1. Create a rule targeting a category with 200 items in it.
2. Set limit to "100 g" (smaller than most items).
3. Click **Preview**.
4. ✅ Response shows:
   - "Matched items: 200"
   - "Stores affected: 3"
   - "Smallest pack: 150 g"
   - "Unbuyable items: [item1, item2, …]" (items smaller than 100 g)
   - **Warning:** "8 items are smaller than the limit and have no bulk exception — customers cannot buy
     them."
5. The warning helps admins catch "oops, I just locked out these products" before saving.

---

## Automated coverage

`cd packages/admin && NODE_ENV=test npx jest cart-limit` — includes:

- **Permission matrix:** each of 9 routes × 6 roles (super_admin, store_admin, manager, support, warehouse_admin,
  warehouse_staff). Load-bearing assertion: store_admin gets 403 on every global write route.
- **Store override:** created against `req.store._id`; body `storeId` rejected; store A cannot read/write
  store B's override; delete is idempotent.
- **Validation:** bulk threshold ≥ limit, limit > 0, at least one target, <= 100 targets.
- **E11000 → 409:** two admins create overlapping rules simultaneously → both reject with conflict message
  (database unique index).
- **Toggle-on collision:** toggle a disabled rule on while a target is taken by another enabled rule →
  409.
- **Cascade-delete:** deleting a global rule removes its store overrides in one transaction.
- **Preview endpoint:** returns correct counts, warnings, unbuyable-items list.
- **Audit log:** every write (create/update/delete/toggle/override-create/override-delete) logs an
  audit-log row with the admin and timestamp.

Admin FE tests (Vitest):
- List renders global + effective values for both roles.
- Store admin form fields disabled except override numerics.
- Super admin form fully editable.
- Validation states (threshold < limit, empty target).
- 409 conflict surfaced with rule name.
- Preview warnings rendered.
- Toast on success/error.

---

## Post-review fixes (2026-09-15) — what to re-test

### 1. CATEGORY rules now actually block ✅ (was: silently enforced nothing)

The item projection used to fetch rule-matching fields was missing `category`, and the entire live
catalog (3905/3905 items) has an empty `taxonomy[]` and matches only through that legacy field. So a
CATEGORY rule matched ZERO items — while the admin **Preview** happily reported matches.

Manual check on dev:
1. Super admin: create a rule targeting a **CATEGORY** (not sub-category), limit 3 units.
2. Wait 60 s.
3. Customer app: add 2 units of item A in that category, then 2 units of a DIFFERENT item B in the
   same category.
4. ✅ The second add is rejected (`LIMIT_EXCEEDED`, `X-Cart-Notice: LIMIT_EXCEEDED`) — the cap is a
   shared pool across the whole category.
5. ❌ Before the fix: both adds succeeded and the cap did nothing.

Automated: `packages/user/__tests__/cart-limit-rule-enforcement.test.js` case **1b** builds two items
with `taxonomy: []` and only `category`, and proves the second add is blocked.

### 2. Overlap-guard index keys on `overrideOf`, not `scope.type` ✅

`uniq_enabled_global_target`'s partial filter is now `{ enabled: true, overrideOf: null }`. No
behaviour change today (overrides carry no `targetKeys`); it stops a future standalone store-only
rule from escaping the guard. **Nothing has been applied to a real database yet** — no migration; the
index is built by `ensureIndexesFor` at admin boot.
- ✅ Re-test: create two enabled global rules on the same sub-category → still 409.
- ✅ Boot the admin service → no `[cart-limits] CRITICAL: index(es) missing/incorrect` line
  (the spec in `CartLimitConstants.criticalIndexSpecs` was updated to match).
- ⚠️ On an environment where the OLD index already exists, drop `uniq_enabled_global_target` once so
  it is rebuilt with the new filter — otherwise the boot check reports a partial-filter mismatch.

### 3. Write-conflict errors no longer leak driver text ✅

Concurrent `PUT /:id/store-override` calls used to return `400` with raw text
("Please retry your operation or multi-document transaction.") and defeated the transaction's own
retry. Now a driver error is passed through untouched (so `withTransaction` can retry it) and, if it
still fails, the client gets `500 "Something went wrong, please try again."` with the real message in
the server log only.
- ✅ Re-test: fire 4 simultaneous overrides for the same rule+store as one admin → the ones that fail
  never show driver text; the rule/override state stays consistent.
- Schema-validation messages ("Bulk threshold must be ≥ limit value") are unaffected — still 400 with
  the readable message.

### 4. Validator hardening ✅

`cart-limit-rule/validator.js` now calls `next()` exactly once per request (no fall-through after
`next(err)`). No visible behaviour change — re-run the validation-error table above; each row must
still return exactly one response with the same status.

---

## Commands

- **Admin API tests (backend):** `cd packages/admin && NODE_ENV=test npx jest cart-limit`
- **Admin FE tests:** `cd haper-admin && npx vitest run --include="CartLimits"` (or just `tsc -b` +
  `eslint .` to verify no new errors)
- **Manual smoke test:**
  1. Super admin: create a test rule → customer sees it enforced
  2. Super admin: edit the rule → takes effect within 60 s
  3. Store admin: create an override → overrides the global number for their store only
  4. Store admin: try to create a global rule → 403

---

## Summary

The admin Cart Limits interface lets staff configure per-order quantity caps from the database instead of
hardcoding them. Super admins have full CRUD control and can see the blast radius (preview warnings) before
saving. Store admins can override just the numeric values for their own store. The FE and BE both enforce a
hard permission boundary — store admins cannot touch global rules or access another store's config. Changes
take effect within ~60 seconds (no restart). A permission check failure shows a clear message, not a broken
page.
