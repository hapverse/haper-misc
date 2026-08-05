# Design Spec — Free Gift (Gift-With-Purchase)

Author: Priyanka (docs) · Date: 2026-07-26
Status: **Approved plan of record as of 2026-07-26.** The backend foundation (schema, shared
util/repo, checkout + cart-preview + admin CRUD, tests) is being built in this same pass. A few
items in §12 (Open questions) still await user sign-off and are called out inline.
Scope of this pass: backend only. Client / admin-UI / picker / delivery / invoice work is
spec-level here and lands in later passes (see §13).

---

## 1. Summary + a concrete example

A store can mark some cheap items as **free gifts** that unlock at cart-value thresholds. At
checkout the server grants **exactly one gift** — the single highest tier the order's item
subtotal reaches. Gifts never stack. If that tier's gift is out of stock, the server falls back
to the next lower qualifying tier; if nothing qualifying is in stock, the order simply ships with
no gift. The point is to nudge customers to spend a little more.

### Concrete example

Say **Bhagwan Bazar** store sets up two tiers:

| If cart item-subtotal is at least | Customer gets free |
| --------------------------------- | ------------------ |
| Rs 100                            | Parle-G biscuit    |
| Rs 500                            | Haldiram namkeen   |

- Customer's cart subtotal is **Rs 120** → they get the **Parle-G** free (crossed Rs 100, not Rs 500).
- Customer's cart subtotal is **Rs 640** → they get the **Haldiram** free only. They do **not** also
  get the Parle-G. Only the single highest tier applies.
- Customer's cart subtotal is **Rs 640** but Haldiram is **out of stock** → server falls back and
  gives the **Parle-G** instead (the next lower tier they still qualify for).
- Customer's cart subtotal is **Rs 640**, both Haldiram and Parle-G are out of stock → **no gift**,
  the order still goes through normally.
- Same customer places a **second** qualifying order the same day → **no second gift** (cap: one free
  gift per customer per store per day).

The gift shows up as a normal order line at **Rs 0** with a `isFreeGift: true` flag. Old apps that
don't know about gifts still see a harmless Rs 0 line; new apps show a "FREE" badge and a nudge.

---

## 2. Locked decisions

These are settled and drive the design below:

1. **Per-store config.** Each store configures its own tiers.
2. **Fixed item per tier.** No customer choice — the tier names the exact gift item.
3. **OOS fallback.** If the winning tier's gift is out of stock, fall back to the next lower
   qualifying tier. If none in stock → no gift.
4. **App orders only.** Channel `'app'` only. The **POS path is excluded** entirely.
5. **Scheduling per tier.** Each tier has a start date and end date (auto start/stop) **plus** an
   enable/disable toggle. A tier is active **only when** `enabled === true` **AND** now is inside
   `[startDate, endDate]`.
6. **One free gift per customer per store per IST day**, enforced at checkout.
7. **Threshold basis = cart item subtotal BEFORE delivery/platform charges.**

---

## 3. Data model (authoritative)

Everything here is **additive and defaulted** — see §3.5 (zero migration).

### 3.1 New collection `store-gift-tiers` (row per tier)

New file: `packages/shared/models/store-gift-tiers.schema.js`.

| Field           | Type / rules                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| `storeId`       | ObjectId, ref `stores`, **required**                                         |
| `minOrderValue` | Number, **required**, `min: 1` — threshold = paid item-subtotal before charges |
| `giftItemId`    | ObjectId, ref `items`, **required** — must be an item of THIS store (enforced in admin layer) |
| `giftItemName`  | String, default `null` — display snapshot only, **NOT authoritative**        |
| `startDate`     | Date, **required** — admin IST calendar date → UTC start-of-day at API boundary |
| `endDate`       | Date, **required** — admin IST calendar date → UTC end-of-day at API boundary |
| `enabled`       | Boolean, **required**, default `true` — active ⇔ `enabled===true` AND now in `[startDate,endDate]` |
| `createdBy`     | ObjectId, ref `admins`, default `null`                                        |
| `updatedBy`     | ObjectId, ref `admins`, default `null`                                        |

Schema options: `timestamps: true`, `versionKey: false`, `collection: "store-gift-tiers"`.
A `pre('validate')` hook enforces `endDate >= startDate`.

### 3.2 Indexes

- `{ storeId: 1, enabled: 1, minOrderValue: -1 }` — active-tier lookup, **highest-first** so the
  fallback walk reads tiers in descending threshold order.
- `{ storeId: 1, minOrderValue: 1 }` **UNIQUE** — one gift per threshold per store.

Register the model in `packages/shared/models/index.js`:

```js
StoreGiftTierModel: require("./store-gift-tiers.schema"),
```

### 3.3 New order-line field

In `orders.schema.js`, the `items[]` subdocument gets:

```js
isFreeGift: { type: Boolean, default: false }
```

This is **always emitted** on every order line (Gson-safe — see §7). A gift line has `salePrice: 0`
and `costPrice > 0`, so it books as lost margin (real cost, zero revenue).

### 3.4 New store master flag

In `stores.schema.js`, inside `config { }`:

```js
giftWithPurchaseEnabled: { type: Boolean, default: false }
```

**Important `.lean()` note:** `StoreRepository.getById` reads with `.lean()`, so **Mongoose schema
defaults are NOT applied on read.** Every consumer MUST read it defensively:

```js
const giftEnabled = !!store?.config?.giftWithPurchaseEnabled; // (?? false)
```

This is the **same pattern already used for `config.maintenance`**. Do not rely on the schema
default surfacing on a read.

### 3.5 Cap query index + zero migration + back-compat

- **Cap query index:** none new. The existing orders index `{ storeId: 1, userId: 1, createdAt: -1 }`
  already covers the daily-cap lookup.
- **Migration: NONE.** Every addition is a new collection, a new nullable/defaulted field, or a new
  defaulted flag. Nothing existing is renamed, removed, or reshaped. The feature is **fully
  backward-compatible** and reversible by flipping the flag off (§11).

---

## 4. Checkout algorithm + shared gift util/repository

### 4.1 New repository

New file: `packages/shared/repositories/store-gift-tier.repository.js`. Register in
`packages/shared/repositories/index.js`. Methods:

- `listByStore(storeId)`
- `getById(tierId)`
- `create(doc)`
- `update(tierId, patch)`
- `delete(tierId)`
- `thresholdExists(storeId, minOrderValue, excludeTierId)`

### 4.2 New shared util

New file: `packages/shared/utils/gift.utils.js`. Register in `packages/shared/utils/index.js`.
Signatures:

- `getActiveTiers({ storeId, now, session })` — enabled + in-window tiers, sorted as needed.
- `dailyGiftCount({ storeId, userId, now, session })` — the daily-cap count. IST day computed via
  `moment-timezone` `Asia/Kolkata`.
- `orderedCandidateTiers(subtotal, activeTiers)` — internal helper: qualifying tiers only, sorted by
  `minOrderValue` **DESC**.
- `previewGiftForCart({ storeId, userId, subtotal, now, session, giftEnabled })` — **READ-ONLY.**
  Returns `{ enabled, currentGift, nextTier, capReached, message }`. OOS is **advisory** here, judged
  via `item.quantity > 0`.
- `selectGiftForCart({ storeId, userId, subtotal, now, session, giftEnabled })` — **MUTATING.** Returns
  a gift line or `null`. Reserves stock via `sellFEFO`.

`giftEnabled = !!store?.config?.giftWithPurchaseEnabled` and is passed in by **both** call sites (cart
preview and checkout), so the `.lean()` default problem (§3.4) is handled once at the boundary.

### 4.3 `selectGiftForCart` steps (inside the checkout transaction)

1. If `!giftEnabled` → return `null`.
2. `active = getActiveTiers(...)`. If empty → return `null`.
3. If `dailyGiftCount(...) >= 1` → return `null` (cap reached).
4. `candidates = orderedCandidateTiers(subtotal, active)` — qualifying, threshold **DESC**.
5. For each candidate:
   - `item = getDetail(giftItemId, storeId, session)`.
   - If `!item` or `item.status !== ACTIVE` → `continue`.
   - `sell = sellFEFO(giftItemId, 1, session)`.
   - If `!sell.ok` → `continue` (this is the OOS fallback to the next lower tier).
   - Else → return the gift line.
6. If none succeeded → return `null`.

### 4.4 The gift line shape

```js
{
  itemId: item._id,
  iId: item.iId || "",
  name: item.name,
  quantity: 1,
  salePrice: 0,
  costPrice: sell.costPrice ?? item.costPrice ?? 0,
  gstRate: item.gstRate || 0,
  batchAllocations: sell.allocations,
  isFreeGift: true
}
```

### 4.5 Insertion point in `placeOrder`

File: `packages/user/src/routes/order/controller.js`.

- Insert **after `applyWallet`** (~line 280) and **BEFORE `OrderRepository.add`** (~line 284).
- Use `subtotal = pricing.itemsTotal`.
- Push the returned gift line into the local `orderItems` array.

### 4.6 Inline prepaid-rollback fix (required in this pass)

File: `packages/user/src/routes/order/controller.js` (~line 351). The Razorpay-create-failure `catch`
currently restocks by looping **`cartItems.items`** — which does **NOT** include the gift line — so a
failed prepaid create would **leak the reserved gift stock**.

**Fix:** change that catch to iterate the local **`orderItems`** array instead (raw `item._id` ids,
which include the gift) and call `incrementQuantity` from it.

The **other 4 restock paths already iterate `order.items`** and are therefore gift-safe already:
user-cancel, webhook `payment.failed`, admin status → restock, and the 15-min stale-prepaid cron.

**Also set status `PAYMENT_CANCELLED` (not `CANCELED`) on this path.** A Razorpay-create failure means
the customer **never paid**, so this attempt must **free** the daily gift slot exactly like an
abandoned checkout does. Marking it `PAYMENT_CANCELLED` — the same status the 15-min abandonment cron
uses — puts it in the payment-never-completed set that the cap ignores (§4.7). Using `CANCELED` here
would wrongly keep the slot consumed for a payment that never happened.

### 4.7 Cap query (IST-aware)

Computed with `moment-timezone` `Asia/Kolkata`:

```js
countDocuments({
  userId,
  storeId,
  createdAt: { $gte: startOfDayIST, $lte: endOfDayIST },
  "items.isFreeGift": true,
  status: { $nin: [PAYMENT_FAILED, PAYMENT_CANCELLED, FAILED] }
}, { session })
```

**Final cap rule (product owner, 2026-07-27):** a customer's daily slot is consumed by **any**
gift-bearing order for the IST day **except** the three payment-never-completed statuses above. The
**only** thing that frees the slot is a prepaid attempt that **never paid** (`PAYMENT_FAILED` /
`PAYMENT_CANCELLED` / `FAILED`). Everything else **COUNTS**: in-flight `PAYMENT_INITIATED`, every live
and delivered status, and — deliberately — `CANCELED`, `ADMIN_CANCELED`, `DELETED`, `UN_DELIVERED`,
and all `REFUND_*` statuses.

Why it works this way:

- **Anti-farming.** A gift on a genuinely-placed order (a COD order that reached `OPEN`, or a prepaid
  order that was actually paid) keeps the slot for the rest of the day **even if the order is later
  refunded or cancelled**. A customer must not be able to claim a free gift, cancel/refund, and
  immediately earn another one the same day.
- **A failed payment must never cost a gift.** A prepaid attempt that never completed payment frees
  the slot, so a genuine card failure or an abandoned checkout does not permanently burn the day's
  gift.
- **In-flight still counts.** A `PAYMENT_INITIATED` order already holds a real `sellFEFO`-reserved gift
  unit, so counting it stops a customer firing two orders at once to reserve two gifts.

The whole distinction rides on order status, so the inline Razorpay-create-failure path must mark a
never-paid attempt `PAYMENT_CANCELLED` — **not** `CANCELED` (see §4.6) — otherwise a never-paid attempt
would wrongly keep counting.

**Admin cannot action a payment-pending order (edge CLOSED — Option B, 2026-07-27).** Because a
`PAYMENT_INITIATED` order **counts**, an admin who cancelled such a never-paid order into a counting
terminal status (e.g. `ADMIN_CANCELED`) would have wrongly burned the customer's daily gift slot for a
payment that never happened. The product owner chose the strict fix: **admins can no longer action an
order that is still `PAYMENT_INITIATED` (payment pending).** Every admin order-mutation endpoint —
mark-status, edit-order, and reassign (assign-rider already rejected pending orders) — rejects the
attempt with a clear message:

> "This order's payment is still pending — it will resolve automatically. It can't be actioned manually."

A payment-pending order is instead resolved **automatically** by the payment webhook or the 15-minute
stale-prepaid cron, which restock the items, refund any wallet coins the customer spent, and set the
order to `PAYMENT_CANCELLED` / `PAYMENT_FAILED` — statuses that correctly **FREE** the gift slot. So a
never-paid attempt never costs the customer their daily gift. Orders in any **other** status are
unaffected and behave exactly as before.

### 4.8 Error handling — fail-open reads, fail-closed reserve (as implemented)

`selectGiftForCart` splits its error handling so a promo gift can never block a paid checkout it
can't evaluate, yet can never commit a half-reserved gift:

- **READ prelude is FAIL-OPEN.** `getActiveTiers`, `dailyGiftCount`, and each per-tier `getDetail`
  are reads. If any throws (a transient DB error), the gift is skipped and the checkout **proceeds
  with no gift** rather than aborting the whole transaction over a non-essential add-on — the same
  stance as the store maintenance / serviceability guards in `placeOrder`. A `getDetail` throw on one
  tier just skips that tier and walks DOWN to the next lower qualifying one (treated like `!item`).
- **Mutating `sellFEFO` reserve is FAIL-CLOSED.** The reserve is deliberately **not** wrapped in a
  swallow-and-continue catch. An out-of-stock `{ ok: false }` is the normal OOS fallback (walk down),
  but if `sellFEFO` itself **throws** mid-decrement the exception **propagates** so the enclosing
  transaction aborts and rolls back atomically — never committing a half-reserved gift.

`previewGiftForCart` (read-only) is fail-safe throughout: its `getDetail` reads are individually
swallowed, and the cart controller wraps the whole call so the cart response degrades to the neutral
no-offer instead of erroring.

---

## 5. Cart-preview API contract

We extend the existing `GET /cart` response with one additive, nullable `giftOffer` object — **no
second endpoint.**

```jsonc
"giftOffer": {
  "enabled": true,
  "currentGift": {                // the gift already unlocked, or null
    "tierId": "...",
    "minOrderValue": 100,
    "itemId": "...",
    "name": "Parle-G",
    "image": "...",
    "iId": "..."
  },
  "nextTier": {                   // the next tier to chase, or null
    "tierId": "...",
    "minOrderValue": 500,
    "amountToUnlock": 380,        // how much more to add
    "itemId": "...",
    "name": "Haldiram namkeen",
    "image": "..."
  },
  "capReached": false,
  "message": "..."
}
```

Behaviour mirrors checkout:

- Flag off / no active tiers → `enabled: false`.
- Only `enabled` + in-window tiers are considered.
- `currentGift` = the highest qualifying tier, with OOS fallback applied.
- `capReached: true` → `currentGift` and `nextTier` both `null`, with an "already claimed today"
  message.
- Preview OOS is **advisory only.** The **order response gift line is the source of truth** — the
  final grant is decided at checkout, not at preview.

---

## 6. Admin tier CRUD API contract

**Auth: reuse the existing `STORE_CONFIG` permission.** No new permission is added — this deliberately
**avoids FE/BE permission-mirror drift** (a known Haper gotcha where FE and BE permission lists fall
out of sync and gate the UI wrongly).

### 6.1 Routes

All store-scoped, on `packages/admin/src/routes/store/router.js`:

| Method   | Path                                        | Purpose            |
| -------- | ------------------------------------------- | ------------------ |
| `GET`    | `/admin/store/:storeId/gift-tiers`          | List tiers + flag  |
| `POST`   | `/admin/store/:storeId/gift-tiers`          | Create a tier      |
| `PUT`    | `/admin/store/:storeId/gift-tiers/:tierId`  | Update a tier      |
| `DELETE` | `/admin/store/:storeId/gift-tiers/:tierId`  | Delete a tier      |

The **master flag** `giftWithPurchaseEnabled` is toggled via the **existing** `PUT
/admin/store/:storeId` (one line in the `updateStore` config map) — **not** a new route.

### 6.2 Create / Update body

```jsonc
{
  "minOrderValue": 100,          // int > 0
  "giftItemId": "...",           // active item, belongs to THIS store
  "startDate": "2026-08-01",     // IST calendar date
  "endDate": "2026-08-31",       // IST calendar date, >= startDate
  "enabled": true                // optional
}
```

### 6.3 Validation (all 400 on failure)

- `minOrderValue` is an integer > 0.
- `giftItem` exists, is `ACTIVE`, and its `storeId === :storeId`.
- `endDate >= startDate`.
- Threshold is **unique per store** (exclude self on update).
- IST calendar dates → UTC **start-of-day / end-of-day** conversion happens at **this** API boundary.

### 6.4 List response

```jsonc
{
  "giftWithPurchaseEnabled": true,
  "tiers": [
    {
      "tierId": "...",
      "minOrderValue": 100,
      "startDate": "...",
      "endDate": "...",
      "enabled": true,
      "giftItem": {
        "name": "Parle-G",
        "iId": "...",
        "sellingPrice": 10,
        "quantity": 240,
        "status": "ACTIVE",
        "image": "..."
      }
    }
  ]
}
```

Tiers sorted by `minOrderValue` **ASC**. **Delete is a hard delete** — orders store a snapshot gift
line, so there is no tier foreign key to worry about.

---

## 7. OLD-APP / BACKWARD-COMPATIBILITY (hard requirement)

This is a first-class requirement, not an afterthought.

**The requirement:** a customer on an **old, un-updated Android build must keep working exactly as
before.** New behaviour lights up only on updated apps. Old apps degrade gracefully — they are never
broken.

**How the design satisfies it:**

1. **No new client field at checkout.** The gift is 100% **server-selected**. The client sends nothing
   new to earn a gift.
2. **Server applies the gift regardless of app version.** Old or new build, the same server logic
   runs.
3. **All new fields are additive, defaulted, and ALWAYS emitted.**
   - `isFreeGift` defaults to `false` and is emitted on **every** order-item line (Android Gson
     decodes a *missing* key to `null`, not to the Kotlin default — so the key must always be
     present).
   - `giftWithPurchaseEnabled` defaults to `false`.
   - `giftOffer` is additive and nullable.
4. **A Rs 0 gift line renders harmlessly** on an old app — it looks like a normal item priced at Rs 0,
   with no FREE tag — and it does **not** break totals. The authoritative totals
   (`price` / `actualOrderValue` / `charges`) already include it (the gift adds Rs 0), so
   `sum(items.salePrice * qty)` still reconciles to `actualOrderValue`.
5. **No existing field, shape, or enum is changed or removed.**
6. **Only new apps** show the nudge, the preview, and the FREE tag.

**Required test:** an **"old-app order" integration test** that places a qualifying order with **no
gift client field**, and asserts:

- exactly one `isFreeGift: true` line at `salePrice: 0`,
- `sum(items.salePrice * qty) === actualOrderValue`,
- `price === actualOrderValue + charges.delivery + charges.platform - walletUsed`.

Plus a **serialization test** asserting `isFreeGift` is present (default `false`) on **every non-gift
line**.

---

## 8. Client / picker / delivery / invoice behaviour (later passes, spec-level)

These are specified now so later passes have a target; they are **not** built in this pass.

**Customer app** (Android priority, then iOS, then web): the cart reads `giftOffer`.
- `currentGift` → "You've unlocked a free {name}!"
- `nextTier` → "Add Rs {amountToUnlock} more to get {name} free"
- `capReached` → "Free gift already claimed today"
- Order details render the `isFreeGift` line with a **FREE** badge at Rs 0.
- **Feature-degrade** cleanly when `giftOffer` is absent or `enabled: false`.

**Picker** (`haper-picker`): show a FREE badge on `isFreeGift` pick lines; quantity 1; **no
scan-gate change**.

**Delivery** (`haper-delivery`): show the Rs 0 FREE line in the manifest.

**Invoice** (`packages/shared/utils/invoice.utils.js`): render the gift line at Rs 0, labelled
**"FREE (Gift with purchase)"**, GST 0.

---

## 9. Accounting / COGS note

The gift line has `salePrice: 0` and `costPrice = sell.costPrice ?? item.costPrice ?? 0`, plus its
`batchAllocations`. Profit/COGS reporting reads the **sale-time `costPrice` snapshot** (the money
invariant), so a gift books as **lost margin** — zero revenue against a real cost. GST on the Rs 0
line = Rs 0.

---

## 10. Edge cases

1. **Subtotal changes between preview and checkout.** Checkout re-selects from `pricing.itemsTotal`;
   the preview is advisory only.
2. **Gift item also in the cart as a paid line.** Two separate lines result (one paid, one gift), and
   stock is decremented twice — this is intended.
3. **Admin order-edit `consolidateItems`** (`packages/admin/src/routes/order/helper.js`) keys on
   `itemId` only, so it **would merge** a paid + gift same-item order into one paid line and **drop
   `isFreeGift`**. → **Later-pass fix**: key on `itemId + isFreeGift`, or exclude gift lines from
   consolidation. (Tracked in §12 Q4 and §13 task k.)
4. **Lowest / all tiers OOS.** No gift is granted; the order still succeeds.
5. **Prepaid abandonment + cap.** An abandoned, never-paid prepaid order is marked `PAYMENT_CANCELLED`
   by the 15-min stale-prepaid cron, which **frees** the customer's daily gift slot — a never-paid
   attempt must never cost a gift. A genuinely-placed order that is later **cancelled or refunded**
   still **keeps** the slot (§4.7).
6. **Concurrent-checkout race** (two gifts for one user). Severity **LOW** — accept and document. Each
   gift is atomically `sellFEFO`-reserved and it takes two real *paid* orders to happen. Future upgrade
   if needed: a `gift-grants` collection with a unique `{ storeId, userId, dayKey }` index.
7. **GST on the Rs 0 line** → Rs 0; confirm with finance (§12 Q6).
8. **`.lean()` default not applied** → always read `?? false` (§3.4).
9. **Same-threshold seasonal swap** is blocked by the unique index → edit or delete the existing tier
   rather than creating a duplicate threshold.

---

## 11. Feature-flag rollout plan

- `giftWithPurchaseEnabled` is **OFF by default** for every store.
- When OFF, the code is **inert** — the checkout, cart, and POS paths are byte-for-byte unchanged.
- **Dark launch:** enable **one store first**, verify end-to-end, then expand store by store.
- **Rollback** = flip the flag **OFF** per store. Instant, no deploy. Because all schema additions are
  defaulted/nullable, there is **no data migration to reverse**.

---

## 12. Open questions / to-confirm

**Product owner signed off on 2026-07-27.** Several items below are now **RESOLVED** (marked inline).
The threshold basis in §2 #7 — cart **item-subtotal before delivery/platform charges** — was also
re-confirmed. A couple of implementation-confirmation items and one later-pass item remain open.

1. **Cap status filter** — **RESOLVED (2026-07-27): YES, count `PAYMENT_INITIATED`.** An in-flight
   prepaid order already holds a real reserved gift unit, so it counts (see §4.7).
2. **Cap scope** — **RESOLVED (2026-07-27): per-store per-day** (not global across all stores).
3. **Open-ended windows** — **RESOLVED (2026-07-27): NO.** A tier requires **both** a start and an end
   date; `endDate` stays required.
4. **Admin order-edit gift line** (edge #3) — **STILL OPEN (later pass):** key `consolidateItems` on
   `itemId + isFreeGift`, or make gift lines non-editable.
5. **Does a refunded / cancelled gift order free the cap?** — **RESOLVED (2026-07-27): NO (changed).**
   A **genuinely-placed** gift order (a COD order that reached `OPEN`, or a prepaid order that was
   actually paid) **keeps** the customer's daily slot for the rest of the IST day even if it is later
   cancelled or refunded — this is deliberate anti-farming. The **only** exception is a prepaid attempt
   that **never completed payment** (`PAYMENT_FAILED` / `PAYMENT_CANCELLED` / `FAILED`), which **does**
   free the slot, so a failed payment never costs the customer a gift (see §4.7). *(This reverses the
   old draft default, which excluded all `REFUND_*` / cancelled orders from the count.)*
6. **GST on free samples** — **RESOLVED (2026-07-27): Rs 0**, and the line is labelled **FREE**.
7. **Gift-item-belongs-to-store** enforced in the admin layer — confirm this is the right enforcement
   point.
8. **IST date conversion owned at the admin API boundary** — confirm the `Asia/Kolkata` display
   assumption for start/end dates.

---

## 13. Task breakdown

### THIS PASS — backend foundation + tests

- **(a)** Admin backend tier CRUD + master flag toggle.
- **(b)** Checkout + cart preview + shared `gift.utils` / repository + schema fields + the inline
  prepaid-rollback fix (§4.6).
- **(c)** Tests, including the old-app compatibility test (§7), plus this design doc and
  `haper-misc/test-free-gift.md`.

### LATER PASSES

| Task  | What                                                              | Owner / note                    |
| ----- | ---------------------------------------------------------------- | ------------------------------- |
| (d)   | Admin FE "Free Gift Tiers" screen (`haper-admin`)               | chanchal designs first          |
| (e)   | Android nudge + FREE tag                                          | **priority** client             |
| (f)   | iOS nudge + FREE tag                                              |                                 |
| (g)   | Web nudge + FREE tag                                              |                                 |
| (h)   | Picker FREE tag                                                  |                                 |
| (i)   | Delivery FREE tag                                                |                                 |
| (j)   | Invoice Rs 0 FREE line                                            |                                 |
| (k)   | Admin order-edit gift-safety (edge #3 — `consolidateItems`)      |                                 |
