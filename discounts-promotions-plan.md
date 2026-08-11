# Discounts / Promotions — Feature Plan

**Status:** Approved for Phase 1 implementation  
**Last updated:** 2026-08-11  
**Audience:** Backend, admin UI, web/mobile clients, QA  

---

## 1. Goal

Super admin can create discount rules — percent or flat-off, optionally capped, targeting all items / specific SKUs / specific categories / a mix, scoped globally or to a specific store, active on an absolute date-time range and/or a recurring weekday+hour pattern (IST) — and customers see the discounted price on browse and at checkout, computed server-side only.

---

## 2. Approved Decisions

The following items were explicitly approved by the product owner. Do not treat as open questions; implement as specified.

### Stacking

If any matching rule is marked exclusive (`stackable:false`), the highest-priority exclusive rule wins alone; otherwise all stackable matching rules compound sequentially on the residual price (10%+10% = 19%, not 20%), ordered by specificity (SKU > category > all-items) then priority.

### Margin Guard

At rule save time, the API computes items that would sell below `costPrice` and the admin UI blocks Save until "I understand" is acknowledged (audit-logged). At runtime, the pricing engine silently clamps the discount so price never actually goes below costPrice — except when `costPrice === 0` (repo invariant: 0 means cost unknown, never fake it to 0), where the guard is skipped entirely.

### Flat Discount Unit

Flat discount type is ₹ off PER UNIT (not per line, not per cart).

### Strikethrough Price

Customer-facing strikethrough price stays the original MRP (`price` field) exactly as today — no change to what's struck through, only the paid price changes.

### Phase 1 Scope — Exclusions (Explicit; do not add before Phase 2)

Phase 1 **excludes** the following, which are explicitly deferred to Phase 2:
- POS counter-sale discount support
- Admin manual order-edit discount support

In Phase 1, those two paths continue selling at full price only.

Phase 1 also excludes:
- Discount audit/reporting UI (Phase 2)
- Coupon codes (not assigned to any phase; may come later as a separate feature)

### Phase 2 (Next After Phase 1 Ships)

- Discount report/analytics endpoint + admin reporting view + CSV export
- POS discount support
- Admin order-edit discount support
- Active-rule caching

### Phase 3 (Later)

- Store_admin self-service delegation
- Per-user/first-order promos
- Coupon codes (separate future feature, not designed yet)

---

## 3. Current State (Verified)

- `packages/shared/models/items.schema.js` — items are per-store documents (`storeId` + per-store `_id`), with a cross-store product identity `iId`. `price` (MRP), `sellingPrice` (paid), `costPrice`. No discount field.
- `packages/shared/models/categories.schema.js` — categories are a global master, no storeId (inventory-v2 §11). Category targeting is naturally global.
- Cart GET: `packages/user/src/routes/cart/controller.js:81` → `item.itemId.sellingPrice * quantity`; additive fail-open `giftOffer` block is the shape precedent.
- Checkout: `packages/user/src/routes/order/controller.js` — `calculatePricing` (~169), `prepareOrderItemsAndInventory` (~193) snapshots `salePrice: item.sellingPrice` (~226).
- Browse/detail: `packages/user/src/routes/item/controller.js` decorates every response through `pricePerUnitUtils.attachPricePerUnit(ToList)` — the natural, DRY decoration point for discounts too.
- Precedent engine: `shared/utils/gift.utils.js` (+ `store-gift-tiers.schema.js`) = rule model + `previewXForCart` (read-only) + `selectXForCart` (in-transaction), gated by `store.config.giftWithPurchaseEnabled`, IST via `moment-timezone`. Admin CRUD lives at `admin/src/routes/store/router.js:34-37` under `P.STORE_CONFIG.*`.
- Other price writers found (must be handled explicitly): `shared/utils/order-edit.utils.js:158` (admin adds a line at `master.sellingPrice`), `admin/src/routes/pos/controller.js:139` (POS sale), `shared/utils/invoice.utils.js:133` (rate = `salePrice`), `shared/utils/email.utils.js:111,160` (order email reads live `itemId.sellingPrice` — shows the WRONG price after discounts; must be fixed regardless of phase).
- Web client maps price at `haper-web/services/mappers.ts:16` (`price: item.sellingPrice ?? item.price`, `mrp: item.price`) — web already has an MRP-strikethrough concept to reuse.

---

## 4. Design

One new global collection `discount-rules` + one pure engine util `shared/utils/discount.utils.js`, mirroring the gift engine's three-part shape:

- `resolveDiscountsForItems({ storeId, items, now })` — READ-ONLY, used by browse/detail/cart. Never throws (fail-open → zero discount).
- `applyDiscountsToOrderLines({ storeId, orderLines, now, session })` — called inside the checkout transaction, right after `prepareOrderItemsAndInventory`, before `calculatePricing`. Same pure resolver, so preview and checkout can never drift.
- Gated by new `store.config.discountsEnabled` (default `false`, read defensively `?? false` because `StoreRepository.getById` uses `.lean()`).

### Data Flow (Checkout)

Cart GET → resolver (advisory, shows discounted price) → placeOrder → stock reserved → resolver re-run inside the transaction on the frozen line prices → per-line `discountAmount` written → `calculatePricing` sums the already-discounted `salePrice` → delivery/platform → wallet → `finalPayable`. Discount is applied before charges and before wallet.

### Stacking Algorithm

1. Collect rules matching a line (specificity: SKU > category > all-items).
2. If any matching rule has `stackable:false`, the exclusive rule wins alone — highest `priority`, tie broken by larger discount for the customer, then newest.
3. Else all stackable rules apply sequentially on the running residual price, ordered by `priority` desc.
4. Each rule's own `maxDiscountAmount` cap is applied per rule per line; total line discount capped at the line subtotal.
5. Margin guard clamps last.
6. Money rounded to 2dp via existing `round2` convention.

### Margin Guard

Warn-with-acknowledge at save + silent clamp at runtime, as described in Approved Decisions above.

---

## 5. Data Model Changes

### New Collection: `discount-rules` (Global, Super-Admin Owned)

```
{
  _id: ObjectId,
  name: String,
  description: String,
  
  scope: {
    type: "global" | "store",
    storeIds: [ObjectId]  // empty = all stores
  },
  
  targets: {
    allItems: Boolean,
    categoryIds: [ObjectId],
    iIds: [String]  // SKU targeting keys on iId (cross-store product identity),
                    // NOT itemId (per-store doc id)
  },
  
  discount: {
    type: "PERCENT" | "FLAT",
    value: Number,
    maxDiscountAmount: Number | null  // cap on discount amount per unit
  },
  
  schedule: {
    startAt: Date,      // UTC instant (admin converts IST calendar input)
    endAt: Date,        // UTC instant
    recurrence: {
      daysOfWeek: [0-6],  // 0=Sunday, 6=Saturday
      windows: [
        {
          startMinute: Number,  // minutes from IST midnight, [0-1439]
          endMinute: Number     // minutes from IST midnight, [0-1440]
        }
      ]
    } | null  // Phase 1 requires endMinute > startMinute (no midnight-crossing)
  },
  
  stackable: Boolean,  // default false
  priority: Number,    // default 0; higher = evaluated later (more weight)
  
  enabled: Boolean,
  createdBy: ObjectId | String,
  updatedBy: ObjectId | String,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:**
- `{ enabled: 1, startAt: 1, endAt: 1 }`
- `{ "scope.storeIds": 1, enabled: 1 }`

**Validation (in `pre("validate")`):**
- `endAt >= startAt`
- percent value 1–100
- flat value > 0

---

### Schema Changes: `orders.schema.js`

Per-line fields (always emitted, Gson-safe):

```javascript
{
  // existing fields...
  
  originalSalePrice: { type: Number, default: 0 },  // pre-discount unit price
  discountAmount: { type: Number, default: 0 },     // ₹ off for the whole line
  appliedDiscounts: [
    {
      ruleId: ObjectId,
      name: String,
      type: "PERCENT" | "FLAT",
      value: Number,
      amount: Number,  // ₹ off by this rule
      _id: false
    }
  ] // default []
  
  // salePrice keeps meaning "unit price actually paid" (now post-discount)
  // This is key backward-compat: invoice rate, refunds, partial refunds,
  // actualOrderValue, profit/COGS all keep working untouched.
}
```

**Order-level field:**
- `discountTotal: { type: Number, default: 0 }`

---

### Schema Changes: `stores.schema.js`

```javascript
{
  config: {
    // existing fields...
    discountsEnabled: { type: Boolean, default: false }
  }
}
```

Always read defensively: `store.config.discountsEnabled ?? false`

---

## 6. API Contract

All discount admin endpoints require `requireRole(SUPER_ADMIN)` in Phase 1.

New permissions added to `BE packages/shared/constants/permission.constant.js` AND `FE haper-admin/src/constants/permissions.ts` (same change, avoid known mirror-drift bug):
- `PERMISSIONS.DISCOUNTS.VIEW`
- `PERMISSIONS.DISCOUNTS.MANAGE`

### Admin Endpoints

**List rules:**
```
GET /admin/discount-rule
Query: ?storeId=<id>&enabled=true|false&activeNow=true|false
Response: { rules: [...], total: N }
```

**Create rule:**
```
POST /admin/discount-rule
Body: { name, description, scope, targets, discount, schedule, stackable, priority }
Query: ?acknowledgeBelowCost=true|false

Response (success):
{
  rule: { _id, name, ... },
  belowCostItems: [
    { itemId, iId, name, price, costPrice, applicableDiscount }
  ]
}

Response (blocked):
{
  error: "Below-cost items exist; set acknowledgeBelowCost=true to proceed",
  belowCostItems: [...]
}
```

**Update rule:**
```
PUT /admin/discount-rule/:id
PATCH /admin/discount-rule/:id/toggle  (toggle enabled flag only)
DELETE /admin/discount-rule/:id  (soft-disable preferred)

Same response shape as POST.
```

**Preview (dry run):**
```
POST /admin/discount-rule/preview
Body: { scope, targets, discount, schedule, ... }  (rule fields, no _id)

Response:
{
  affectedItemCount: N,
  samples: [
    { itemId, name, originalPrice, discountedPrice, appliedRules: [...] }
  ],
  belowCostItems: [...]
}
```

**Analytics (Phase 2):**
```
GET /admin/analytics/discounts?from=<date>&to=<date>&storeId=<id>&groupBy=rule|store|item
Response: Aggregation from order snapshots only (never joined to live rules)
```

### User Endpoints

All additive; keys always present, null/0 when no discount:

**Item list/detail/home/search:**
```
GET /item, /item/:id, /home, /search
Added per item:
{
  discountedPrice: Number | null,
  discountAmount: Number | null,
  discountLabel: String | null  // e.g. "20% OFF"
}
```

**Cart:**
```
GET /cart
Added per line:
{
  discountAmount: Number
}

Added at cart level:
{
  discount: {
    total: Number,
    lines: [{ lineIndex, ruleId, name, amount }],
    labels: [String]  // ["20% OFF", "Flat ₹50 OFF"]
  }
}
```

**Place Order:**
```
POST /order
Input: No discount fields accepted from client, ever.
Server recomputes and freezes discounts inside the transaction.

Response snapshot includes:
{
  items: [
    {
      originalSalePrice, discountAmount, appliedDiscounts,
      salePrice  // post-discount
    }
  ],
  discountTotal: Number
}
```

---

## 7. Build Order

1. `packages/shared/models/discount-rules.schema.js` + register in `models/index.js` + repository (aabha-dba index review)
2. `packages/shared/utils/discount.utils.js` — pure matcher, IST schedule evaluator, stacking resolver, cap + margin clamp. Unit tests first, no DB.
3. `orders.schema.js` snapshot fields + `stores.schema.js` `discountsEnabled` flag.
4. Admin CRUD router/controller/validator (`admin/src/routes/discount-rule/*`) + permission constant + FE mirror + preview/below-cost endpoint.
5. User read path: decorate items in `user/src/routes/item` + `home` (alongside `attachPricePerUnit`).
6. Cart: discount block in `user/src/routes/cart/controller.js` (fail-open like `giftOffer`).
7. Checkout: apply inside transaction in `user/src/routes/order/controller.js`; write snapshots; `discountTotal`.
8. Fix `shared/utils/email.utils.js` to use `items.salePrice` instead of live `itemId.sellingPrice`.
9. (Phase 2) Discount report endpoint + aggregation over order snapshots.
10. Admin UI: `Discounts` page — rule list + `DiscountRuleFormModal` (targets picker, schedule builder, cap, stacking, below-cost confirm), modelled on `Config/GiftTiersPanel.tsx` + `GiftTierFormModal.tsx` + `configTime.ts`.
11. (Phase 2) Admin reporting view (table + CSV).
12. Clients: Android `ItemCard.kt`/`ItemDetailScreen.kt`/`CartScreen.kt`/`OrderModels.kt`, iOS `CartManager.swift`/`OrderModels.swift`, web `services/mappers.ts` + item card (already has `mrp` strikethrough to reuse) — display only.
13. `haper-misc/test-discounts.md` walkthrough + refresh architecture/map doc with the new engine.

---

## 8. Edge Cases, Risks, Backward Compatibility

### Non-Customer Price Writers (Phase 1)

In Phase 1, `order-edit.utils.js:158` (admin adds a line) and `pos/controller.js:139` (counter sale) **do not apply discounts**; both add at full price. Discount support for these paths is deferred to Phase 2 per user's explicit priority flag.

### Free-Gift Lines

Free-gift lines (`isFreeGift: true`, `salePrice: 0`) must be skipped by the discount resolver entirely.

### Price Changes Between Cart View and Checkout

Checkout is authoritative. No "price changed" blocker in Phase 1; user sees the best price at checkout.

### Rule Edited Mid-Checkout

In-transaction resolve is single source of truth; snapshot makes it irreversible and auditable.

### Rounding

Clamp/round exactly once per line at 2dp (`round2` convention); never round the percentage itself.

### Boundary Times

Window is `[start, end)` in IST; a rule ending 18:00 does not apply at 18:00:00.

### Backward Compatibility

- Flag defaults `false` → every store behaves exactly as today
- All new fields nullable/defaulted and always emitted (Android Gson safety)
- `salePrice` semantics unchanged (paid price) so invoices, refunds, wallet, profit/COGS via `items.costPrice` are untouched
- Reports read snapshots so deleting a rule can't rewrite history

### Rollback

Flip `discountsEnabled: false` per store (instant, no deploy); rules stay, orders keep snapshots.

### Security / Money

- No discount value ever comes from the client
- Only super_admin writes rules
- Below-cost acknowledgement is audit-logged

---

## 9. Test Strategy

### Unit (Bulk, Pure Functions)

- Percent/flat/cap maths
- Stacking (exclusive-wins, sequential residual)
- Specificity ordering
- IST schedule evaluation:
  - Date range boundary
  - Weekday check
  - Hour window check
  - Rule active at 23:59 IST = 18:29 UTC
- Margin clamp incl. `costPrice === 0` skip
- Zero/negative safety

### Integration (In-Memory Mongo)

- Cart preview totals
- Checkout freezes snapshots
- Flag-off = byte-identical response
- Free-gift line untouched
- (Phase 2) Discount report aggregation

### Manual / E2E

- Admin creates a happy-hour rule → app shows it at 6pm IST and not at 5:59pm
- See `haper-misc/test-discounts.md` for detailed walkthrough

---

## 10. Fleet Routing

After Phase 1 code is complete (before committing to `dev`):

1. **sumit-backend** — core discount engine + admin CRUD + user endpoints
2. **aabha-dba** — schema design + indexes + repo pattern
3. **chanchal-designer** — admin UI spec (modelled on gift-tier form)
4. **tanmoy-web** — admin panel build + web client display logic
5. **siddhart-android** — Android client display
6. **setu-ios** — iOS client display
7. **santosh-tester + farhan-testinfra** — test suite + infra
8. **mayank-reviewer + navjot-security** — code review (money/pricing logic is security-sensitive)
9. **priyanka-docs** — test-discounts.md walkthrough + architecture refresh
10. **kiran-git** — commit DIRECT TO DEV (`dev` is the default integration target; no feature branches, no PRs)

---

## 11. Implementation Checklist

- [ ] Discount rules schema + indexes created
- [ ] Discount utils (pure resolver, stacking, margin guard) with unit tests
- [ ] Order schema snapshot fields added
- [ ] Store config flag added
- [ ] Admin CRUD routes + validation + permission constants (BE + FE mirror)
- [ ] Preview endpoint + below-cost detection
- [ ] Item detail/browse/home decoration
- [ ] Cart discount preview
- [ ] Checkout apply + snapshot write
- [ ] Email utils fixed (use snapshot salePrice)
- [ ] Admin UI form + list view
- [ ] Android display logic
- [ ] iOS display logic
- [ ] Web client display logic
- [ ] test-discounts.md walkthrough created
- [ ] Integration tests pass (in-memory Mongo)
- [ ] E2E manual test pass (happy-hour rule)
- [ ] Code review complete (security + money)
- [ ] Ready for Phase 1 ship

---

## 12. References

- **Gift-with-purchase engine (precedent):** `shared/utils/gift.utils.js`, `store-gift-tiers.schema.js`, `admin/src/routes/store/router.js`
- **Inventory v2 design:** `haper-misc/inventory-v2-design.md` §11 (global categories, storeId topology)
- **Cost price invariant:** `shared/utils/costPrice-money-invariant.md` (profit/COGS reads snapshot, not live)
- **Store topology:** super-admin owns company, store-admin owns per-store
- **Admin permission mirror:** FE `permissions.ts` must match BE `permission.constant.js` (known drift bug fixed in [commit link])

---

**End of plan. A new session can implement Phase 1 from this document alone.**
