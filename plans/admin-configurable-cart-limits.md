# Admin-configurable per-order quantity limits — implementation plan

Author: shavinder (planner) · Date: 2026-09-15 · Status: **DRAFT — needs user approval**
Scope: `haper-backend` (packages/shared, packages/admin, packages/user), `haper-admin`, `haper-misc`
Target branch: `dev` (direct-to-dev, per project rules)

---

## 0. TL;DR of what changed after reading the real code

Five things in the briefing turned out to be different on disk. They change the plan materially, so
they are up front.

| Briefing said | Reality in the code | Consequence |
|---|---|---|
| Gap (a): the "+" stepper (`incrementCounter`) has no size check | `incrementCounter` / `CartRepository.increment` is reachable only from `cart/controller.js:updateCartQuantity`, which **is not mounted on any router**. Android (`ApiService.kt:85`), web (`services/api.ts:405`) and iOS (`CartManager.swift:307`) all do the "+" and "−" through `POST /user/cart/CART` with a **delta** quantity (`+1` / `-1`) — i.e. through `add()`, which **is** guarded. | The live stepper is **already enforced**. Gap (a) is real but is *dead code*, not a live hole. We still fix it (cheap, and it is exported from the repository), but it is not a P0 and it does not need a client release. |
| Enforcement matches `taxonomy[0]` | `add()` reads `product.subCategory._id` — which the taxonomy normaliser defines as the *derived primary* = `taxonomy[0]`. Same thing, confirmed. | Gap (c) confirmed real. Fix = match against the whole `taxonomy[]` array. |
| Item-level targeting | `items` are **per-store documents**; the cross-store product identity is `items.iId` (`items.schema.js` — unique per `{storeId, iId}`). `discount-rules.schema.js` already keys SKU targeting on `iId` for exactly this reason. | Item-level rules **must** target `iId`, never item `_id`. An `_id`-keyed rule would silently apply to one store only. |
| Reuse `store-category-settings` | That collection is a 3-field on/off flag (`storeId + categoryId + enabled`, absence = enabled). It is the right precedent for *"absence of a row = the default"*, but far too thin for a rule with targets, limits and a bulk exception. The real precedent is **`discount-rules`** — explicit `scope.type` discriminator, target arrays, a cached hot-path resolver, load-modify-save updates, a `preview` endpoint, and a double role+permission gate. | We reuse the **discount-rules pattern** (not its collection) and the **store-category-settings "absence = default"** idea for overrides. |
| Per-store override design may clash with tenancy | It does not. `packages/admin/src/middleware/auth.js` binds a `store_admin` to exactly **one** store (`admin.storeId`, header spoofing rejected with 403). So "a store admin overrides for their own store" is a natural fit — the store id is never taken from the request body. | Design stands, with one hard rule: **the store id for an override is always `req.store._id`, never client input** (super_admin switches store via `x-store-id`, which `authenticate` already validates). |

One more, and it is the important one for security review:

> **`store_admin` implicitly bypasses the entire permission system** (`middleware/permission.js`:
> `if (hasRole(admin, roles.STORE_ADMIN)) return true;`). So a permission string **alone never keeps a
> store admin out**. Every global-rule route must carry a hard `requireRoles([SUPER_ADMIN])` **in
> addition to** the permission — exactly what `discount-rule/router.js` does and says in its comment.

---

## 1. Goal

Let Haper staff configure "how much of X a customer may buy in one order" from the admin panel,
instead of a hardcoded array in `cart.repository.js`. A super admin defines platform-wide rules at
whatever granularity fits — a whole category ("Cooking Oil"), a set of sub-categories (the current
Mustard Oil + Refined Oil group), or specific SKUs — and an individual store admin may adjust the
*number* on a rule for their own store without being able to change what the rule targets. The rules
are enforced at every point a cart can grow, and re-checked once more at checkout so a cart that
grew before a rule existed cannot slip through.

**Plain-language example.** Today the code says "2 litres of cooking oil per order, but a 5-litre-or-
bigger bottle is exempt and you may buy 1 of it". After this change, that same sentence is a row in
the database that a super admin typed into a form; the Chhapra store admin can change *2 litres* to
*3 litres* for Chhapra only, because they have more oil in stock.

### Acceptance criteria ("done" means)

**Behaviour parity (must hold on day one)**
- [ ] With the seeded rules in place and no admin edits, the cooking-oil behaviour is **byte-identical**
      to the current hardcoded version: 2000 ml combined across Mustard Oil + Refined Oil, packs
      ≥ 5000 ml exempt and capped at 1 unit per SKU, same `LIMIT_EXCEEDED: …` message text.
- [ ] Sugar remains **disabled** — seeded as a rule row with `enabled: false`, enforcing nothing.
- [ ] Santosh's existing `packages/user/__tests__/cart-cooking-oil-limit.test.js` still passes after
      its fixtures are pointed at seeded DB rows instead of the hardcoded constant. No business case
      in it is deleted.

**New capability**
- [ ] A super admin can create/edit/disable/delete a rule targeting **a category**, **one or more
      sub-categories**, or **one or more SKUs (by `iId`)**, with a combined limit, and optionally a
      bulk-pack exception (threshold + per-SKU unit cap).
- [ ] A super admin can create a rule whose limit is a **unit count** ("max 5 of these") as well as a
      **size** ("max 2 L combined"), because `ItemConstants.units` includes `unit(s)` where a size
      limit is meaningless.
- [ ] A store admin sees the global rules read-only and can set a **per-store override of the numbers
      only** (limit / bulk threshold / bulk max units / on-off) for their own store. They cannot
      change targets, cannot create global rules, and cannot touch another store.
- [ ] Removing a store override restores the global default (no "reset to 0" state).

**Enforcement**
- [ ] `POST /user/cart/CART` (add **and** the +/− stepper — same endpoint) is blocked past the
      effective limit, with the remaining-headroom hint the current code already produces.
- [ ] `CartRepository.increment` (currently unrouted) enforces the same rule, so re-mounting it later
      cannot reopen the hole.
- [ ] **Checkout re-validates** on both paths (`placeOrder` and `placeScheduledOrder`) and refuses a
      cart that is over an effective limit, naming the rule and the offending group.
- [ ] An item that carries a limited sub-category **anywhere in `taxonomy[]`** is counted, not only
      when it is the primary pair (gap (c)).
- [ ] An admin edit takes effect on the customer path within **≤ 60 s** without a deploy or restart.

**Non-regression**
- [ ] Add-to-cart latency for items **not** covered by any rule adds **zero extra Mongo reads** in the
      steady state (cache hit).
- [ ] With the rules collection empty or unreadable, add-to-cart behaves exactly as if no rule existed
      (fail-open) and logs an error — a merchandising cap must never take the cart down.
- [ ] No API response shape, enum or field is removed or renamed anywhere; every new field is
      nullable/defaulted (Android Gson rule).

---

## 2. Current state

**Enforcement (the thing being replaced)**
- `packages/shared/repositories/cart.repository.js`
  - `SUBCATEGORY_SIZE_LIMIT_GROUPS` — hardcoded array; one live group (Cooking Oil), Sugar commented out.
  - `toBaseUnits(weightStr, unit)` — kg/g/l/ml → one integer "base unit".
  - `_limitGroupForSubCategory(subCatId)`, `_formatBaseUnits(amount, baseUnit)`.
  - `add()` — lines ~181–285: matches `product.subCategory._id` (= `taxonomy[0]`), then either the
    per-SKU bulk cap or the combined-sum cap; throws `errorUtils("LIMIT_EXCEEDED: …", 400)`.
  - `incrementCounter()` — lines ~107–150: stock check only, **no** size check. Not routed.
- `packages/user/src/routes/cart/router.js` — `POST /:type` → `controller.add`. `updateCartQuantity`
  exists in the controller but is **not mounted**.
- `packages/user/src/routes/order/controller.js` — `prepareOrderItemsAndInventory` (line 219) does
  stock/FEFO only; **no** size re-check. Cart is loaded at line 864 (pre-transaction, `placeOrder`)
  and line 1419 (**inside** `session.withTransaction`, `placeScheduledOrder` — retried).
- `packages/admin/src/routes/pos/controller.js` — counter sales build `orderItems` straight from
  `req.body.items`; no cart, therefore no limit today.

**Patterns we will reuse**
- `packages/shared/models/discount-rules.schema.js` — explicit `scope.type` GLOBAL|STORE discriminator
  (with the written rationale for why "empty array = global" is a bug factory), target arrays keyed on
  `iId`, `pre("validate")` cross-field invariants, and three deliberate indexes so the per-store `$or`
  is fully indexed.
- `packages/shared/repositories/discount-rule.repository.js` — `list/getById/create/updateSafe`, plus
  the explicit "CACHE THIS, it is a per-request query" and "do NOT call inside `withTransaction`"
  warnings (the collection is not in the pre-create list).
- `packages/shared/utils/discount.utils.js` lines 740–790 — the TTL cache shape this repo already
  uses: `Map` + `TTL_MS` + bounded size + fail-safe default + `__reset…()` test hook.
- `packages/shared/repositories/store-category-setting.repository.js` — "absence of a row = the
  default; only persist a deviation" (the model for store overrides).
- `packages/admin/src/routes/discount-rule/router.js` — the double gate
  (`requireRoles([SUPER_ADMIN])` **and** `requirePermission(P.DISCOUNTS.*)`).
- `haper-admin/src/pages/Discounts/` — `DiscountsPage.tsx` + `DiscountRuleFormModal.tsx` + tests:
  the exact list-page/modal-form idiom for this kind of screen.
- `haper-admin/src/utils/permissions.ts` ⇄ `packages/admin/src/middleware/permission.js` — the FE/BE
  permission mirror that must be kept in step.

**Tests / docs already in place**
- `packages/user/__tests__/cart-cooking-oil-limit.test.js` (Santosh, in flight).
- `haper-misc/test-cart-oil-limit.md`, `haper-misc/test-cart-quantity-cap.md`.

---

## 3. Proposed design

### 3.1 One collection, two kinds of document

New collection **`cart-limit-rules`** (`packages/shared/models/cart-limit-rules.schema.js`).

- **A global rule** (`scope.type = "GLOBAL"`): the full definition — name, target, limit type, limit,
  optional bulk exception. Super-admin owned.
- **A store override** (`scope.type = "STORE"`): a *thin patch* on exactly one global rule —
  `overrideOf: <globalRuleId>`, `scope.storeId`, and only the numeric fields it changes. It carries
  **no targets of its own**.

Why one collection and not two: the customer path needs both in a single query (`$or` over
`scope.type`), the admin list needs both to render "global 2 L, your store 3 L", and the two shapes
share validation. Why a *patch* and not a full copy: if a store could edit targets, "the Cooking Oil
rule" would mean something different in every store and no report or support answer would be
trustworthy. Numbers only is the smallest thing that satisfies the ask.

Why not extend `store-category-settings`: it is a boolean flag keyed by category with a unique
`{storeId, categoryId}` index; adding limit/targets/bulk fields to it would overload one collection
with two unrelated features and break its "absence = enabled" contract. DRY applies to *patterns*,
not to cramming unrelated rows into one table.

### 3.2 Targeting

```
target: {
  type: "CATEGORY" | "SUB_CATEGORY" | "ITEM",
  categoryIds:    [ObjectId],  // meaningful only when type=CATEGORY
  subCategoryIds: [ObjectId],  // meaningful only when type=SUB_CATEGORY
  iIds:           [String],    // meaningful only when type=ITEM  ← cross-store SKU identity
}
```

- **One target *type* per rule, but a list of ids** — because the live requirement (Mustard Oil +
  Refined Oil sharing one 2 L pool) is exactly "several ids, one pool". Mixing a category and a
  sub-category inside one pool is deliberately not allowed: an item that matched both would need a
  double-counting rule that no admin can reason about, and the UI copy ("2 L across these
  sub-categories") stops being true.
- **`ITEM` targets key on `iId`**, mirroring `discount-rules`. Items are per-store documents; `_id`
  would make a "global" rule apply to one store.
- **Matching uses the whole `taxonomy[]` array** — see §7 (gap (c)).
- An item matching a rule through two different taxonomy pairs is counted **once**.

### 3.3 Limit types

```
limit: {
  type: "SIZE" | "UNITS",
  value: Number,            // SIZE → base units (ml/g); UNITS → a count of units
  baseUnit: "ml" | "g",     // display only, SIZE rules only
  bulk: null | { threshold: Number, maxUnits: Number }   // SIZE rules only
}
```

`UNITS` exists because `ItemConstants.units` includes `unit(s)`, and `toBaseUnits` currently returns
the raw `weight` number for those — so a size limit on a piece-sold SKU is meaningless today and
would silently mis-enforce. `UNITS` also covers the common ask "max 5 of this offer SKU per order"
without inventing a second feature later.

### 3.4 Multiple rules matching one item

All matching rules are evaluated; **every one must pass**. No priority field, no "first match wins".

Overlap is constrained at *the same level only*: a sub-category may appear in at most one **enabled
global** rule, a category in at most one, an `iId` in at most one. Cross-level overlap is allowed and
intentional (a category-wide 5 kg cap *and* a tighter sub-category 2 L cap can coexist — the tighter
one bites first). This is enforced by a **unique partial multikey index** on a derived `targetKeys`
array (see §4), so two admins saving at the same moment cannot both win.

### 3.5 Hot-path read + caching (for aabha-dba to confirm)

New `packages/shared/utils/cart-limit.utils.js`:

```
getEffectiveRulesForStore(storeId) → [resolvedRule]
```

Two-tier, because the admin API and the user API are **separate Node processes** (see
`ecosystem.config.js`) — an in-process reset hook in the admin process can never invalidate the user
process's memory, so a purely local cache means staleness is *always* TTL-bounded:

1. **Redis snapshot** via the already-imported `distributedCacheUtils`: key
   `CART_LIMIT_RULES:<storeId>`, TTL 60 s, **deleted by every admin write** → an edit propagates in
   milliseconds across all workers.
2. **In-process memo**, 5 s TTL, bounded `Map`, same shape as
   `discount.utils.js`'s `flagCache` (bounded size + `__resetCartLimitRuleCache()` test hook) → the
   common burst of adds does not hit Redis once per tap.

Read on miss (one indexed query, tens of docs):

```js
find({ enabled: true, $or: [ { "scope.type": "GLOBAL" },
                             { "scope.type": "STORE", "scope.storeId": sid } ] })
```

then merge each override onto its parent in memory.

**Fail-open.** If Redis *and* Mongo both fail, log and return `[]` — no enforcement for that request.
A fair-share merchandising cap is not money; taking add-to-cart down to protect it is the wrong
trade. (Contrast: the coupon/discount money paths fail closed. Stated explicitly so nobody "fixes"
this later.) A failed read is never cached.

**Do not call the repository inside `session.withTransaction`** — same reason as `discount-rules`:
the collection is not in `connections/mongo.js`'s pre-create list, and a transaction cannot create a
collection. Checkout resolves rules **before** the transaction opens and evaluates purely in memory
inside it (which is also what makes it safe under `withTransaction` retries).

### 3.6 Data flow — add to cart

```
POST /user/cart/CART {itemId, quantity:+1}
  → cart/controller.add → CartRepository.add(userId, {itemId, quantity, type, storeId})
      1. item lookup + stock checks              (unchanged)
      2. store-switch cart reset                 (unchanged)
      3. rules = cartLimitUtils.getEffectiveRulesForStore(storeId)   ← Redis/memo, usually 0 I/O
      4. if no rule matches this item → skip entirely (zero extra queries)
      5. else load {_id, iId, taxonomy, weight, unit, name} for the cart's item ids (1 query)
      6. cartLimitUtils.evaluate({rules, cartLines, addition}) → pure function
      7. violation → throw errorUtils("LIMIT_EXCEEDED: …", 400)
      8. write cart to Redis                     (unchanged)
```

### 3.7 Data flow — checkout re-validation

```
placeOrder                (cart loaded pre-transaction, line ~864)
placeScheduledOrder       (cart loaded INSIDE withTransaction, line ~1419)
  → rules resolved BEFORE session.withTransaction in both paths
  → cartLimitUtils.evaluateCart({rules, cartLines}) — pure, no I/O, retry-safe
  → violation → 400 "Your cart exceeds the <label> limit (<cap>). Please reduce … to continue."
```

Placed **before** `prepareOrderItemsAndInventory`, so a rejected checkout costs zero stock
decrements and zero coupon holds — the same ordering rationale the address-ownership guard already
documents at line ~870.

---

## 4. Data model changes

### `cart-limit-rules` (new collection)

```js
{
  name: String,                    // "Cooking Oil", required, trim
  description: String,             // default ""
  enabled: Boolean,                // default true

  scope: {
    type: "GLOBAL" | "STORE",      // required, default GLOBAL — explicit discriminator
    storeId: ObjectId|null,        // required iff type=STORE, else forced null
    _id: false
  },
  overrideOf: ObjectId|null,       // required iff type=STORE, else forced null → cart-limit-rules

  // GLOBAL only. Forced empty on a STORE doc by pre('validate').
  target: {
    type: "CATEGORY"|"SUB_CATEGORY"|"ITEM"|null,
    categoryIds:    [ObjectId],    // ref categories
    subCategoryIds: [ObjectId],    // ref sub-categories
    iIds:           [String],      // cross-store SKU identity — NOT item _id
    _id: false
  },

  limit: {
    type: "SIZE"|"UNITS",
    value: Number,                 // >0 integer
    baseUnit: "ml"|"g"|null,       // SIZE only, display copy
    bulk: { threshold: Number, maxUnits: Number } | null,   // SIZE only
    _id: false
  },

  // Derived, write-only, never sent to clients. ["SUB_CATEGORY:<id>", …] on GLOBAL docs; [] on STORE.
  targetKeys: [String],

  createdBy: ObjectId|null,        // admins
  updatedBy: ObjectId|null,
}
{ timestamps: true, versionKey: false, collection: "cart-limit-rules" }
```

**`pre("validate")` invariants** (same defensive stance as `discount-rules`):
1. `GLOBAL` → force `scope.storeId = null`, `overrideOf = null`; require a `target.type` and a
   non-empty id array **of that type**; force the other two arrays empty (a stale array is how a rule
   silently widens).
2. `STORE` → require `scope.storeId` **and** `overrideOf`; force `target` empty; at least one of
   `limit.value` / `limit.bulk` / `enabled` must actually differ from the parent (no no-op rows).
3. `limit.type = "UNITS"` → `baseUnit = null`, `bulk = null`.
4. `limit.type = "SIZE"` → `baseUnit ∈ {ml, g}` required.
5. `limit.value` integer `> 0`; structural ceiling (e.g. 1,000,000) so a typo'd 2000000 is caught.
6. `bulk` present → `bulk.maxUnits` integer `≥ 1` **and** `bulk.threshold ≥ limit.value`.
   *Why:* a threshold below the combined cap makes the "exempt" pack smaller than the whole
   allowance, so a customer bypasses the cap entirely by buying just-over-threshold packs. Today:
   threshold 5000 ≥ limit 2000 ✔.
7. `targetKeys` recomputed from `target` on every save (never client-supplied).

**Indexes**
```js
// 1. Hot path. Both $or branches must be indexed or the whole query collection-scans.
schema.index({ enabled: 1, "scope.type": 1 },                 { name: "active_scope_type" });
schema.index({ enabled: 1, "scope.storeId": 1 },              { name: "active_scope_store" });
// 2. One override per (global rule, store) — the store-category-settings uniqueness idea.
schema.index({ overrideOf: 1, "scope.storeId": 1 },
             { unique: true, partialFilterExpression: { overrideOf: { $type: "objectId" } },
               name: "uniq_override_per_store" });
// 3. Race-proof overlap guard: no target id may appear in two ENABLED GLOBAL rules.
//    Unique + multikey enforces uniqueness of each ARRAY ELEMENT across documents.
schema.index({ targetKeys: 1 },
             { unique: true,
               partialFilterExpression: { enabled: true, "scope.type": "GLOBAL" },
               name: "uniq_enabled_global_target" });
```
Index 3 also fires on **toggle-on** of a previously disabled rule whose target is now taken — the
controller must catch E11000 and return a friendly `409 { error, conflictingTargetKey }` rather than
a raw 500. **Flag for aabha-dba:** confirm the partial-unique-multikey combination behaves as
expected on the managed Atlas version in use, and confirm index build order in
`mongo-index.utils.js` / the boot verification used for `coupon-redemptions`.

**No changes to any existing collection.** `items`, `categories`, `sub-categories`, `stores`,
`store-category-settings` are untouched.

**Collection pre-create:** add `cart-limit-rules` to each app's `connections/mongo.js` pre-create
list **only if** we ever write it inside a transaction. We do not — so instead we document the
"never inside `withTransaction`" rule in the repository header, exactly like `discount-rules`.

---

## 5. API contract

Base: `/admin/cart-limit-rule` (new router `packages/admin/src/routes/cart-limit-rule/`).
All routes: `authenticate` first (populates `req.admin`, `req.store`).

New permission group in `packages/shared/constants/permission.constant.js`:

```js
const CART_LIMITS = { VIEW: "cart_limits.view", MANAGE: "cart_limits.manage" };
```
Deliberately absent from every preset (same note as `DISCOUNTS`/`COUPONS`), and mirrored verbatim in
`haper-admin/src/constants/permissions.ts`.

| # | Method & path | Who | Gate |
|---|---|---|---|
| 1 | `GET /admin/cart-limit-rule` | super_admin **and** store_admin | `requirePermission(CART_LIMITS.VIEW)` |
| 2 | `POST /admin/cart-limit-rule` | super_admin only | `requireRoles([SUPER_ADMIN])` + `MANAGE` |
| 3 | `GET /admin/cart-limit-rule/:id` | super_admin + store_admin | `VIEW` |
| 4 | `PUT /admin/cart-limit-rule/:id` | super_admin only | `requireRoles([SUPER_ADMIN])` + `MANAGE` |
| 5 | `PATCH /admin/cart-limit-rule/:id/toggle` | super_admin only | `requireRoles([SUPER_ADMIN])` + `MANAGE` |
| 6 | `DELETE /admin/cart-limit-rule/:id` | super_admin only | `requireRoles([SUPER_ADMIN])` + `MANAGE` |
| 7 | `PUT /admin/cart-limit-rule/:id/store-override` | store_admin (own store) + super_admin (switched store) | `requireRoles([SUPER_ADMIN, STORE_ADMIN])` + `MANAGE` |
| 8 | `DELETE /admin/cart-limit-rule/:id/store-override` | same as 7 | same as 7 |
| 9 | `POST /admin/cart-limit-rule/preview` | super_admin only | `requireRoles([SUPER_ADMIN])` + `MANAGE` |

> Routes 2/4/5/6/9 **must** carry the hard role gate, not just the permission — `store_admin` bypasses
> the permission system. Routes 7/8 use `requireRoles` too, and derive the store id from
> `req.store._id` (never from the body), so a store admin physically cannot write another store's row.
> `MANAGER` / `SUPPORT` are excluded everywhere in Phase 1; granting them `cart_limits.view` later is
> a one-line preset change.

**1. List** — `GET /admin/cart-limit-rule?enabled=&targetType=`
```jsonc
{ "msg": "Rules fetched", "data": { "rules": [
  { "_id": "…", "name": "Cooking Oil", "enabled": true,
    "target": { "type": "SUB_CATEGORY",
                "subCategories": [ { "_id": "6679b3…a7ba", "name": "Mustard Oil" },
                                   { "_id": "682a33…bbf7", "name": "Refined Oil" } ] },
    "limit": { "type": "SIZE", "value": 2000, "baseUnit": "ml",
               "bulk": { "threshold": 5000, "maxUnits": 1 }, "display": "2 L" },
    // present only when a store context is active; null = no override for this store
    "storeOverride": { "_id": "…", "storeId": "…", "enabled": true,
                       "limit": { "value": 3000, "bulk": null }, "display": "3 L" },
    "effective": { "enabled": true, "limit": { "type":"SIZE","value":3000,"baseUnit":"ml",
                                               "bulk": { "threshold":5000,"maxUnits":1 } } },
    "createdAt": "…", "updatedAt": "…" } ] } }
```
Store admins receive **only** their own store's `storeOverride` (super_admin without an `x-store-id`
gets `storeOverride: null` and `effective` = the global). Tens of rows, no pagination — same call as
`discount-rule.list`.

**2/4. Create / update (global)** — body is the complete rule; `PUT` is **load-modify-save** through
a `updateSafe`-style repository method, never a dotted `$set`, so `pre("validate")` always runs (the
exact warning `discount-rule.repository.js` carries).
```jsonc
{ "name": "Cooking Oil", "description": "", "enabled": true,
  "target": { "type": "SUB_CATEGORY", "subCategoryIds": ["6679b3…a7ba","682a33…bbf7"] },
  "limit": { "type": "SIZE", "value": 2000, "baseUnit": "ml",
             "bulk": { "threshold": 5000, "maxUnits": 1 } } }
```
→ `200 { msg, data: { rule } }` · `400` validation · `409` target already covered by another enabled
rule (`{ error, conflictingRuleId, conflictingTargetKey }`).

**7. Upsert store override** — `PUT /admin/cart-limit-rule/:id/store-override`
```jsonc
{ "enabled": true, "limit": { "value": 3000, "bulk": { "threshold": 5000, "maxUnits": 1 } } }
```
- `:id` must be an existing **GLOBAL** rule → else `404`.
- `storeId` = `req.store._id`; `400 "No store context"` if absent (super_admin must send `x-store-id`).
- Omitted numeric fields inherit from the global. `enabled:false` = "this rule is off in my store".
- → `200 { msg, data: { rule, storeOverride, effective } }`.

**8. Delete override** → `200`, idempotent (deleting a non-existent override is a success — the
"absence = default" contract from `store-category-setting.repository.setState`).

**9. Preview / analyze** (borrowed from the discounts `preview` idiom) — body = a draft rule, response
= blast radius **before** saving:
```jsonc
{ "matchedItemCount": 37, "storesAffected": 2,
  "smallestPackBaseUnits": 500,
  "unbuyableItems": [ { "name": "Fortune Refined Oil - 15 Ltr", "packBaseUnits": 15000 } ],
  "itemsMissingSize": [ { "name": "…", "weight": "", "unit": "unit(s)" } ],
  "warnings": ["3 items have a pack size larger than the limit and no bulk exception — customers cannot buy them at all."] }
```
This is the single highest-value endpoint for preventing an accidental "nobody can buy oil" outage,
and it is also how we surface the known catalog data-quality problem (items whose stored
`weight`/`unit` contradicts their name) **without** editing catalog data.

**Audit:** every write on 2/4/5/6/7/8 writes an `admin-audit-logs` entry via the existing
`audit.utils` (actor, rule id, before/after) — a per-store limit change is a commercial decision
someone will ask about later.

**Customer-facing API: no change.** No new endpoint, no new response field. (Phase 2 idea, out of
scope: surface "max 2 L per order" on the product page so the customer learns the cap before the 400.)

---

## 6. Cart-enforcement rework

### New file: `packages/shared/utils/cart-limit.utils.js`

Pure logic + the cache. Everything below moves out of `cart.repository.js`:

| Exported | Purpose |
|---|---|
| `toBaseUnits(weight, unit)` | moved verbatim from `cart.repository.js` (kg/g/l/ml). Unchanged behaviour. |
| `formatBaseUnits(amount, baseUnit)` | moved verbatim. |
| `getEffectiveRulesForStore(storeId)` | Redis snapshot + 5 s memo + merge of overrides (§3.5). Fail-open `[]`. |
| `invalidateRulesCache(storeId?)` | `DEL CART_LIMIT_RULES:*` — called by every admin write. |
| `__resetCartLimitRuleCache()` | test hook, mirrors `__resetDiscountFlagCache`. |
| `matchRules(item, rules)` | taxonomy-wide + `iId` matching → the rules this item belongs to. |
| `evaluateAddition({ rules, cartLines, item, quantity })` | the current `add()` logic, generalised. Returns `{ok:true}` or `{ok:false, message}`. |
| `evaluateCart({ rules, cartLines })` | whole-cart check for checkout. Returns `{ok, violations[]}`. |

`cart.repository.js` keeps `add()`'s shape; the inline block at lines ~181–285 is replaced by a call
to `evaluateAddition`. `SUBCATEGORY_SIZE_LIMIT_GROUPS`, `_limitGroupForSubCategory` and
`_formatBaseUnits` are deleted **only after** the seeded rows exist (see §7 build order).

**Message text is preserved character-for-character** for the SIZE+bulk case so the seeded Oil rule
produces the identical string the tests and the clients already see:
`LIMIT_EXCEEDED: Max 2 L of Cooking Oil per order (combined). You can add N more of "…" (≈ X left in this category).`
The `label` in the message comes from `rule.name`, which the seed sets to `"Cooking Oil"`.

### The item query

Only when at least one rule matches the item being added (`matchRules` first, query second). Then one
query for the cart's item ids with the projection widened by two fields:

```js
{ _id: 1, iId: 1, subCategory: 1, taxonomy: 1, weight: 1, unit: 1, name: 1 }
```
(`taxonomy` and `iId` are the additions.) Bounded by cart size; unchanged cost for the ~99 % of adds
that match no rule.

### `incrementCounter`

Add the same `evaluateAddition` call before `itemInCart.quantity = newQuantity`, for positive deltas
only. Fixes gap (a) at its source even though nothing routes to it today, so re-mounting
`updateCartQuantity` later cannot silently reopen the hole.

### Checkout (gap (b))

In `packages/user/src/routes/order/controller.js`, a shared helper next to the existing coupon
helper:

```js
const assertCartWithinLimits = async (cartItems, storeId) => { … }   // resolves rules, calls evaluateCart
```

- **`placeOrder`** (~line 866): call it right after the cart/store `Promise.all`, **before**
  `prepareOrderItemsAndInventory` — outside the transaction.
- **`placeScheduledOrder`** (~line 1419): the cart is loaded **inside** `withTransaction`, which
  retries. So resolve the rules **before** `session.withTransaction` opens (one variable in the outer
  scope, exactly like `pricing`/`couponHold` already are at line ~1406) and call the **pure**
  `evaluateCart` inside. No I/O inside the transaction, retry-safe.
- Failure → `400` with an actionable message listing each violated rule. Copy is deliberately
  different from the add-to-cart copy ("your cart already exceeds…") because the customer is in a
  different place in the journey.
- A cart that is over the limit **is not auto-trimmed**. Silently removing items a customer chose is
  worse than an explicit refusal, and it is not reversible.

### POS (`packages/admin/src/routes/pos/controller.js`)

**Recommendation: exempt, and say so in the code.** POS is a staff-operated counter sale with the
goods physically present; a fair-share cap designed against online hoarding does not apply. This is an
**open question** (§10 Q4) — if the user wants it enforced, it is an additive call to `evaluateCart`
in the POS `sell` path with no schema change.

### Admin order-edit

`packages/admin/src/routes/order/controller.js` can add items to an existing order. Not gated today
and **not gated by this plan** — a support agent adding an item to fix a mistake must not be blocked
by a customer-facing cap. Listed in §8 as a known, deliberate hole.

---

## 7. Gap (c) — primary-only matching. Decision: **match the whole taxonomy**

**Call: match against every `(categoryId, subCategoryId)` pair in `items.taxonomy[]`, not just the
derived primary.**

Why:
- The cap exists to stop one customer buying out a scarce commodity. A rule that any multi-tagged SKU
  escapes is not a cap, it is a suggestion. A single merchandising edit — tagging a 1 L refined oil
  as "Festive Gifting → Combos" first — silently deletes the limit for that SKU, with no error and no
  alert anywhere.
- `taxonomy[]` is capped at `MAX_TAXONOMY_PAIRS = 5`, and the path is designed as one indexable
  multikey path (`taxonomy.subCategoryId`), so the cost is a five-element array scan in memory. Zero
  extra queries — the field just joins the projection we are already fetching.
- `discount-rules` already made the same call for targeting (there is even a regression test,
  `packages/user/__tests__/discount-multi-category-targeting.test.js`). Matching the discount engine's
  semantics means one mental model for "what does this rule cover".

Dedupe rule: an item matching one rule through two pairs counts **once** (match by item id, not by pair).

Backward-compat note: this **widens** enforcement. On the seeded Oil rule, any SKU that carries
Mustard/Refined Oil as a secondary pair starts counting toward the 2 L pool where it did not before.
The `preview` endpoint (§5.9) is how we measure that set **before** the switchover; expected to be
small or empty, and to be reported to the user in the switchover step.

---

## 8. Edge cases, risks, backward compatibility

**Correctness / races**
1. **Two admins create overlapping global rules simultaneously** → the unique partial multikey index
   on `targetKeys` rejects the loser with E11000 → mapped to `409`. A controller-only pre-check would
   race.
2. **Toggle-on collides** with a rule that took the target while this one was disabled → same E11000,
   same 409, from `PATCH /:id/toggle`. Must be tested, it is the non-obvious one.
3. **Concurrent adds by the same user** — already serialised by `lockUtils.acquireLock(userId, itemId)`
   in `add()`. Two *different* items in the same group can still interleave and overshoot slightly;
   this is pre-existing behaviour, bounded by one pack, and checkout re-validation now catches it.
4. **`withTransaction` retries** on `placeScheduledOrder` — handled by resolving rules outside and
   evaluating purely inside (§6).
5. **Deleting a global rule that has store overrides** → cascade-delete the override rows in the same
   call (they are meaningless orphans and `overrideOf` would dangle). Reject with `409` instead if the
   user prefers an explicit step — §10 Q3.
6. **Deleting a category/sub-category/item that a rule targets** → the rule keeps a dangling id and
   silently matches nothing. Mitigation: the list endpoint resolves target names and marks unresolved
   ids as `{ _id, name: null, missing: true }`, and the UI shows a warning chip. (A dangling ref that
   renders as blank is a known failure mode in this codebase.) No FK enforcement.

**Security / money-adjacent**
7. `store_admin` bypasses the permission system → hard `requireRoles` on every global route. This is
   the single most likely security mistake in this feature.
8. Override `storeId` is **always** `req.store._id`; a `storeId` in the body is ignored (and rejected
   by the Joi schema with `.forbidden()`, so a client that sends one gets a clear 403 rather than a
   silent drop).
9. A store admin **raising** their own limit above the global default is allowed by this design — it is
   a merchandising decision, audit-logged. Flagged as §10 Q2 in case the user wants a ceiling.

**Availability**
10. Cache fail-open: rules unreadable → no enforcement, error logged. Explicitly the chosen trade-off.
11. Stale reads bounded by 60 s Redis TTL even if the invalidation DEL is lost (e.g. a Redis restart
    between save and DEL). The admin UI must say "changes apply within a minute".
12. A rule whose limit is below the smallest pack in its target makes those SKUs **unbuyable**. The
    `preview` endpoint warns; the form shows the warning; we do **not** hard-block it (a deliberate
    "this bulk SKU is off-menu" is a legitimate use).

**Backward compatibility — what exists today and how it keeps working**

| Existing behaviour | How it stays unchanged |
|---|---|
| Cooking-oil 2 L combined cap + 5 L bulk exemption | Seeded as a DB row with identical numbers and an identical message string. The switchover commit deletes the constant only after the seed has run and the parity test is green. |
| Sugar disabled | Seeded `enabled: false` — enforces nothing, and stays visible in the admin list so nobody re-implements it from scratch. |
| `LIMIT_EXCEEDED: …` 400 message | Same prefix, same wording for the seeded rule. Verified no client parses it (`grep LIMIT_EXCEEDED` across haper-android / haper-ios / haper-web → **0 hits**), but clients display it verbatim, so the copy matters. |
| `toBaseUnits` behaviour incl. the mislabelled-catalog trust rule | Function **moved**, not changed. Stored `weight`/`unit` stays authoritative; catalog data is not touched. |
| `POST /user/cart/CART` request/response shape | Unchanged. No new field, no new status code. No client release required for the backend phase. |
| `CartRepository` public surface (`add/increment/delete/getOne/getById/setCouponCode/…`) | Unchanged signatures. Only `add`'s internals and `incrementCounter`'s guard change. |
| Cart stored in Redis | Unchanged — no new field on the cart JSON. |
| `store-category-settings` category on/off | Untouched — separate collection, separate endpoints. |
| Discount / coupon / gift engines | Untouched. Cart-limit evaluation runs before pricing and never mutates a line. |
| POS counter sales, admin order-edit | Untouched (deliberately exempt — §6). |
| `packages/admin` existing routers | Only additive: one new router registered in `routes/index.js`, one new permission group appended to `PERMISSIONS`. `ALL_PERMISSIONS` grows, which is additive for the Team page. |
| `haper-admin` existing pages | Only additive: one nav entry, one route, one page dir. |

**Rollback strategy.** Ordered by cost:
1. **Instant, no deploy** — disable every rule (`PATCH /:id/toggle`). Enforcement stops within 60 s.
2. **One-commit revert** — the switchover commit (which deletes the hardcoded constant) is kept
   *separate and last*, so reverting it restores hardcoded enforcement while the collection sits inert.
3. Hard to reverse: **nothing**. No destructive migration, no field rename, no data rewrite. The new
   collection can be dropped with no effect on any other feature.

---

## 9. Test strategy

**Unit — `packages/shared`** (pure functions, no DB)
- `toBaseUnits`: kg/g/l/ml/unknown-unit, `unit(s)`, empty weight, non-numeric weight.
- `formatBaseUnits`: 750 ml, 2000 ml → "2 L", 1500 g → "1.5 kg".
- `matchRules`: primary pair; **secondary-only pair (gap (c))**; two pairs one rule (counted once);
  `iId` match; `iId` empty string must **not** match a rule with an empty target array.
- `evaluateAddition`: boundary maths at exactly the limit / one base unit over; bulk exemption; bulk
  per-SKU cap; bulk packs excluded from the combined pool; mislabelled `weight`/`unit` trusted as
  stored; `UNITS`-type rule; two rules matching one item (most restrictive bites).
- Cache: hit/miss, TTL expiry, invalidation, **fail-open on a throwing Mongo/Redis**, bounded map size,
  `__resetCartLimitRuleCache`.

**Integration — `packages/admin/__tests__`** (in-memory Mongo, `NODE_ENV=test npx jest` from the pkg dir)
- Permission matrix, one test per cell: super_admin / store_admin / manager / support / warehouse_* ×
  each of the 9 routes. **The load-bearing assertion: `store_admin` gets 403 on every global write
  route** (the implicit-bypass trap).
- Store override: created against `req.store._id`; a body `storeId` is rejected; store A cannot read
  or write store B's override; delete is idempotent.
- `pre("validate")` invariants 1–7, one test each.
- `409` on overlapping create **and** on toggle-on collision (E11000 → friendly error).
- Cascade-delete of overrides when the parent global rule is deleted.
- `preview` warnings: unbuyable items, items missing a size.
- Audit-log row written on every write.

**Integration — `packages/user/__tests__`**
- **Adapt (do not rewrite) `cart-cooking-oil-limit.test.js`**: replace the hardcoded-constant
  reference in its header with a seeded rule created in `beforeAll`; keep every business case. Add a
  `__resetCartLimitRuleCache()` in `beforeEach` so the memo never leaks between tests.
- New `cart-limit-rule-enforcement.test.js`: category-level rule; item(`iId`)-level rule; `UNITS`
  rule; store override raises/lowers/disables the limit; **secondary-taxonomy item is counted**;
  rule edit takes effect after invalidation; no rule → zero enforcement; unreadable rules → fail-open.
- New `cart-limit-checkout.test.js`: an over-limit cart (built by seeding Redis directly, i.e. the
  "pre-existing cart" case) is refused on `placeOrder` **and** on `placeScheduledOrder`, with no stock
  decremented and no coupon hold left behind.
- Regression: **Sugar stays disabled**.

**Admin FE — `haper-admin`** (Vitest; "green" = still exactly the 5 known-failing OrderDetailsModal
tests, per the project baseline)
- List renders global + effective values; store admin sees form fields disabled except the override;
  form validation states (threshold < limit, limit ≤ 0, empty target); 409 conflict surfaced;
  preview warnings rendered.

**Manual / QA** — `haper-misc/test-cart-oil-limit.md` updated in the same session (project rule), plus
a new `haper-misc/test-admin-cart-limits.md` walkthrough with ✅/❌ steps for both roles.

**Commands** (per project rules): backend → `cd packages/<pkg> && NODE_ENV=test npx jest` (in-memory
Mongo only, never the real DB). Admin → `npx tsc -b` + `npx vitest run` + `npx eslint .` (no **new**
problems against the 113 baseline).

---

## 10. Open questions for the user

1. **Store-only rules.** Phase 1 lets a store admin only *override the numbers* on a global rule. Should
   a store admin also be able to create a rule that exists **only** in their store (e.g. "Chhapra caps
   rice at 10 kg, nobody else does")? Recommendation: **not in Phase 1** — it is additive later
   (`scope.type = "STORE"` with its own `target`, `overrideOf: null`), and shipping it now doubles the
   validation and UI surface.
2. **May a store admin raise a limit above the global default?** Current design: yes, audit-logged.
   Alternative: clamp to the global (stores may only be stricter). Which?
3. **Deleting a global rule that has store overrides** — cascade-delete the overrides silently, or
   refuse with "3 stores have overridden this rule; remove them first"? Recommendation: cascade, and
   say so in the confirm dialog.
4. **POS counter sales** (`/admin/pos`) — exempt (recommended) or enforced?
5. **Should the customer see the cap before hitting it?** e.g. "Max 2 L per order" on the product page.
   Out of scope here; it needs a client release on all three apps. Confirm it is a later phase.
6. **Cache staleness copy** — is "changes apply within about a minute" acceptable to show in the admin
   UI, or do you want a manual "apply now" button (an extra endpoint that just does the Redis DEL)?
7. **Blast radius of the taxonomy-wide fix (§7)** — we will run `preview` against the live Oil rule and
   report the exact SKU list that newly falls under the cap **before** the switchover commit. Confirm
   you want that report as a go/no-go gate rather than just an FYI.

---

## 11. Build order

Design-first is a standing rule, so **Phase 0 blocks all admin-UI work** — but the backend phases do
not wait on it.

| # | Phase | Owner | Files | Depends on |
|---|---|---|---|---|
| 0 | **UI design spec** — list page, create/edit modal, store-override panel, validation + conflict + preview-warning states, empty state, role-differentiated view | **chanchal-designer** | `haper-misc/design-admin-cart-limits.md` | — (start immediately, parallel with 1–4) |
| 1 | **Schema + constants** — model, permission group, constants | **sumit-backend**, reviewed by **rajit-backend-arch** + **aabha-dba** | `packages/shared/models/cart-limit-rules.schema.js`, `models/index.js`, `constants/cart-limit.constant.js`, `constants/index.js`, `constants/permission.constant.js` | — |
| 2 | **Repository** — CRUD + `updateSafe` (load-modify-save) + `findActiveForStore` + override merge | **sumit-backend** | `packages/shared/repositories/cart-limit-rule.repository.js`, `repositories/index.js` | 1 |
| 3 | **Utils** — pure evaluation + two-tier cache + moved `toBaseUnits`/`formatBaseUnits` | **sumit-backend** | `packages/shared/utils/cart-limit.utils.js`, `utils/index.js` | 1 (parallel with 2) |
| 4 | **Unit tests** for 3 | **santosh-tester** | `packages/shared/__tests__/cart-limit.utils.test.js` | 3 |
| 5 | **Admin API** — router/controller/validator + audit + E11000→409 mapping | **sumit-backend** | `packages/admin/src/routes/cart-limit-rule/{router,controller,validator}.js`, `routes/index.js` | 2 |
| 6 | **Admin API tests** incl. the full permission matrix | **santosh-tester** | `packages/admin/__tests__/cart-limit-rule.test.js` | 5 |
| 7 | **Seed migration** — Oil rule (enabled) + Sugar rule (disabled), idempotent, dry-run by default | **sumit-backend** | `scripts/migrations/seed-cart-limit-rules.js` (+ entry in `scripts/migrations/run.js`) | 1 |
| 8 | **Cart wiring** — `add()` + `incrementCounter()` call the utils; constant **still present but unused** | **sumit-backend** | `packages/shared/repositories/cart.repository.js` | 3, 7 |
| 9 | **Checkout re-validation** — both paths | **sumit-backend** | `packages/user/src/routes/order/controller.js` | 3 |
| 10 | **User integration tests** + adapt Santosh's existing oil test | **santosh-tester** | `packages/user/__tests__/cart-limit-rule-enforcement.test.js`, `cart-limit-checkout.test.js`, `cart-cooking-oil-limit.test.js` | 8, 9 |
| 11 | **Switchover** — delete `SUBCATEGORY_SIZE_LIMIT_GROUPS` + `_limitGroupForSubCategory` + `_formatBaseUnits`. **Its own commit, last, easily revertible.** | **sumit-backend** | `packages/shared/repositories/cart.repository.js` | 10 green |
| 12 | **Admin FE** — page, modal, override panel, API client, nav + route, permission mirror | admin FE engineer | `haper-admin/src/pages/CartLimits/*`, `src/services/api.ts`, `src/App.tsx`, nav component, `src/constants/permissions.ts` | 0, 5 |
| 13 | **Admin FE tests** | **santosh-tester** | `haper-admin/src/pages/CartLimits/*.test.tsx` | 12 |
| 14 | **Docs** — update `test-cart-oil-limit.md`, add `test-admin-cart-limits.md`, update `client-followups.md` | **sumit-backend** / **rahul** | `haper-misc/*` | 11, 12 |
| 15 | **Code review + QA** | **dhruv** (review), **durga** (QA) | — | 14 |

**Parallelism:** 0 ∥ 1; then 2 ∥ 3; then 5 ∥ 7 ∥ (4 after 3); 8 and 9 touch different files and can run
in parallel once 3+7 land; 12 needs 0 and 5 only, so the whole admin FE can be built while 8–11 are in
flight. **Strictly sequential:** 1 → 2 → 5, 3 → 8/9, 10 → 11.

**The one ordering rule that must not be broken:** step 11 (deleting the hardcoded constant) lands
**after** step 7 (seed) has been applied on the target environment and step 10 is green. Do them in the
wrong order and the Oil rule silently stops enforcing between deploy and seed.

---

## 12. Consultation status

The briefing asked for three consultations. This plan is written **to be reviewed by** them and
carries the specific questions each should answer — I cannot dispatch them from a planning-only role,
so **rahul should route these before build starts**:

- **rajit-backend-arch** — confirm: (a) one collection with two doc kinds vs. two collections;
  (b) one target *type* per rule (§3.2) vs. mixed-level pools; (c) "all matching rules must pass" with
  no priority field (§3.4); (d) the two-tier cache and the fail-open stance (§3.5); (e) checkout hook
  placement, especially resolving rules outside `withTransaction` on the scheduled path (§6).
- **aabha-dba** — confirm: (a) the three indexes in §4, in particular that
  **unique + partial + multikey on `targetKeys`** behaves as designed on the managed Atlas version in
  use, and how it should be verified at boot (the `coupon-redemptions` index-verification precedent);
  (b) Redis snapshot key/TTL + DEL-on-write vs. a pure in-process TTL, given admin and user run in
  separate processes; (c) whether `cart-limit-rules` needs adding to any `connections/mongo.js`
  pre-create list.
- **chanchal-designer** — phase 0 above; needs the role-differentiated view (super_admin full CRUD vs.
  store_admin read-only + override), the conflict/409 state, the preview-warning state, and the
  "dangling target id" warning chip.
