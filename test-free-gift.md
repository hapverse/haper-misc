# Test: Free gift (gift-with-purchase) — backend foundation

**Area:** User app checkout + cart preview, and the admin store-config tier CRUD
**Backend:** `POST /user/order/place`, `GET /user/cart` (packages/user); gift engine
`packages/shared/utils/gift.utils.js` + `packages/shared/repositories/store-gift-tier.repository.js`;
admin tier CRUD `packages/admin/src/routes/store/{router,controller,validator}.js`
**Permission (admin):** `STORE_CONFIG.VIEW` to list tiers, `STORE_CONFIG.EDIT` to create/update/delete
(the same permission that already guards store config — no new permission, so no FE/BE mirror drift)
**Phase:** **backend only.** Dark by default (master flag OFF for every store). Client apps, admin FE
screen, picker/delivery FREE tag, and the invoice FREE line are **later passes** (see the bottom).

## What this is (a real example)

A store marks some cheap items as **free gifts** that unlock at cart-value thresholds. At checkout the
server **auto-adds exactly ONE free item at Rs 0** — the single **highest** tier the cart's item
subtotal reaches (item subtotal = the paid lines only, **before** delivery / platform charges).
Gifts never stack. If that tier's gift item is out of stock, the server **falls back to the next lower
qualifying tier**. If nothing qualifying is in stock, the order simply ships with **no gift**.

Say store **Bhagwan Bazar** sets up two tiers:

| If cart item-subtotal is at least | Customer gets free |
| --------------------------------- | ------------------ |
| Rs 100                            | Parle-G biscuit    |
| Rs 500                            | Haldiram namkeen   |

- Cart subtotal **Rs 120** → the **Parle-G** is added free (crossed Rs 100, not Rs 500).
- Cart subtotal **Rs 600** → **only the Haldiram** is added free. They do **not** also get the Parle-G.
  Only the single highest tier applies — a bigger cart never stacks two gifts.
- Cart subtotal **Rs 600** but Haldiram is out of stock → server falls back and adds the **Parle-G**.
- Cart subtotal **Rs 600**, both out of stock → **no gift**, the order still goes through.
- Same customer places a **second** qualifying order the same day → **no second gift**
  (cap: one free gift per customer per store per IST day).

The gift shows up as a normal order line at **Rs 0** carrying `isFreeGift: true`. Updated apps will show
a FREE badge and a "spend a little more to unlock…" nudge; old apps just see a harmless Rs 0 line.

---

## What exists today vs later passes

**Built now (this pass, backend only):**
- Per-store master flag `store.config.giftWithPurchaseEnabled` (default **false**).
- Admin tier CRUD (`/admin/store/:storeId/gift-tiers`).
- Checkout auto-adds the gift line inside the order transaction (`selectGiftForCart`).
- Cart preview: `GET /user/cart` returns an additive `giftOffer` object (`previewGiftForCart`).
- The `isFreeGift` order-line flag (always emitted, default false) and the daily cap.

**Admin FE (built this pass — see section ✅ I):**
- "Free Gift on Order" section on the store-config page (`/config`, `ConfigSettings.tsx`) — master
  switch (persisted via the store PUT) + tiers table + add/edit/delete tier modal with a searchable
  active-item picker. Scoped to the store selected in the switcher.
- Option-B controls in `OrderDetailsModal` — for a `PAYMENT_INITIATED` order the status / reassign /
  edit-items controls are disabled with an inline "payment pending" note; the backend 400 is also
  surfaced as a toast if anything slips through.
- FREE-gift line treatment in the order-details items list + a "Free gift → FREE" bill row.

**Later passes (NOT built now):** Android/iOS/web nudge + FREE tag, picker FREE tag, delivery FREE
line, and the invoice Rs 0 "FREE (Gift with purchase)" line. The invoice is a **backend-generated PDF**
(`shared/utils/invoice.utils.js`) that the admin only downloads — there is no admin-FE invoice line to
tag, so that item stays a backend task.

---

## How to enable (dev) — it is dark by default

Enable **one store first** and verify end-to-end before expanding.

1. **Turn the master switch ON** for a store:

   ```
   PUT /admin/store/:storeId      body: { "giftWithPurchaseEnabled": true }
   ```

2. **Create one or more tiers** (each names an **ACTIVE item of THAT store** as the gift):

   ```
   POST /admin/store/:storeId/gift-tiers
   {
     "minOrderValue": 100,          // integer >= 1; item-subtotal threshold before charges
     "giftItemId": "<an ACTIVE item of THIS store>",
     "startDate": "2026-08-01",     // IST calendar date; controller stores it as UTC start-of-day
     "endDate":   "2026-08-31",     // IST calendar date, >= startDate; stored as UTC end-of-day
     "enabled":   true              // optional (defaults true)
   }
   ```

A tier is **active** only when `enabled === true` **AND** now is within `[startDate, endDate]`.
Both the flag and the tiers must be set — the flag alone does nothing.

---

## Prerequisites (read once)

1. An admin on `damin.haper.in` with **`STORE_CONFIG.EDIT`** (to toggle the flag and manage tiers) and
   a store selected. Without `STORE_CONFIG.VIEW`/`EDIT` the tier endpoints return **403**.
2. At least one **ACTIVE item with stock** in that store to use as a gift.
3. A customer account you can place app orders with, and a delivery address that store serves.

---

## Manual test steps (dev)

### ❌ A. Flag OFF → behaves exactly as before (the safe default)
1. Leave `giftWithPurchaseEnabled` **false** (the default for every store).
2. Place a qualifying app order and open `GET /user/cart`.
3. **Expect:** no gift line on the order; `giftOffer` is `{ enabled: false, currentGift: null,
   nextTier: null, capReached: false, message: null }`. Checkout and cart are byte-for-byte as before.

### ✅ B. Flag ON + qualifying cart → one Rs 0 gift, highest tier only
1. Enable the flag and the two tiers from the example (Rs 100 Parle-G, Rs 500 Haldiram).
2. Place an app order with an item-subtotal of **Rs 120**.
   **Expect:** the order has one extra line — Parle-G, `quantity: 1`, `salePrice: 0`,
   `isFreeGift: true`. Gift stock dropped by 1.
3. Place an app order with an item-subtotal of **Rs 600**.
   **Expect:** exactly **one** gift line — the **Haldiram** only. The Parle-G is **not** also added
   (no stacking).

### ✅ C. OOS fallback → next lower tier; all OOS → no gift, order still succeeds
1. Set the Rs 500 gift item (Haldiram) stock to **0**. Place a **Rs 600** order.
   **Expect:** the **Parle-G** (Rs 100 tier) is granted instead — the fallback walks **down** to the
   next lower qualifying tier.
2. Now set **both** gift items to stock 0. Place a **Rs 600** order.
   **Expect:** **no gift line**, and the order still **succeeds** normally.

### ✅ D. Tier outside its window or disabled → not offered
1. Set a tier's `startDate`/`endDate` so **now is outside** the window (e.g. a future start).
   Place a qualifying order. **Expect:** that tier is ignored — no gift from it.
2. Set a tier `enabled: false`. Place a qualifying order. **Expect:** that tier is ignored.
   (A tier counts only when `enabled === true` AND now is in `[startDate, endDate]`.)

### ✅ E. Daily cap → one free gift per customer per store per IST day
1. As one customer, place a qualifying order at this store → gift granted.
2. As the **same customer**, place a **second** qualifying order at the **same store the same day**
   (Asia/Kolkata day). **Expect:** **no second gift**. The order still places normally.

> **Final cap rule (product owner, 2026-07-27):** the slot is consumed by **any** gift-bearing order
> for the IST day **except** a prepaid attempt that never completed payment. Only `PAYMENT_FAILED` /
> `PAYMENT_CANCELLED` / `FAILED` free the slot. Everything else — including a genuinely-placed order
> that is later cancelled or refunded, and an in-flight `PAYMENT_INITIATED` order — keeps it.

### ✅ E1. A cancelled / refunded genuine order does NOT free the slot (anti-farming)
1. As one customer, place a qualifying order that genuinely goes through — a COD order that reaches
   `OPEN`, or a prepaid order that is actually paid → gift granted (the slot is now used).
2. **Cancel or refund** that first order (user-cancel, admin cancel, or a full refund).
3. Same customer, same store, same IST day: place another qualifying order.
   **Expect:** **no second gift.** The cancelled/refunded order still counts, so a customer cannot
   claim a gift, then cancel/refund and immediately earn another one the same day.

### ✅ E2. A never-paid prepaid attempt DOES free the slot (a failed payment must not cost a gift)
1. As one customer, start a **prepaid** qualifying order but **never complete payment** — let the
   payment fail, or abandon it so the 15-min stale-prepaid cron auto-cancels it. The order ends up
   `PAYMENT_FAILED` / `FAILED` (payment failed) or `PAYMENT_CANCELLED` (abandoned / auto-cancelled —
   also the inline Razorpay-create-failure path).
2. Same customer, same store, same IST day: retry with a qualifying order that completes.
   **Expect:** the **gift IS granted** on the retry — the never-paid attempt did not burn today's gift.

### ✅ E3. An in-flight prepaid order still counts (no double-reserve)
1. As one customer, place a **prepaid** qualifying order and leave it at `PAYMENT_INITIATED` (payment
   not yet completed) — it already holds a real reserved gift unit.
2. Before it resolves, place a **second** qualifying order at the same store the same day.
   **Expect:** **no second gift** on the second order — a customer cannot fire two orders at once to
   reserve two gifts.

### ✅ E4. Admin cannot action a payment-pending order → its never-paid slot is freed automatically
1. As one customer, place a **prepaid** qualifying order and leave it at `PAYMENT_INITIATED` (payment
   not yet completed) — it holds a real reserved gift unit and counts toward today's cap.
2. As an admin, try to **cancel it**, **change its status**, **edit it**, or **reassign a rider**.
   **Expect:** every attempt is **rejected** with the clear message:
   *"This order's payment is still pending — it will resolve automatically. It can't be actioned
   manually."* The order is **left untouched** (still `PAYMENT_INITIATED`).
3. Let it resolve on its own — the payment webhook completes it, or the 15-min stale-prepaid cron
   auto-cancels an abandoned one. **Expect:** the items are restocked, any wallet coins the customer
   spent are refunded, and the order ends up `PAYMENT_CANCELLED` / `PAYMENT_FAILED`.
4. Same customer, same store, same IST day: place another qualifying order.
   **Expect:** the **gift IS granted** — because the pending order resolved to a slot-freeing status,
   the never-paid attempt did not burn today's gift. (This closes the old edge where an admin could
   cancel a never-paid order into `ADMIN_CANCELED` — a counting status — and wrongly burn the slot.)

**Regression check (admins can still action normal orders):** take an order that has reached `OPEN`
(or any live status **other than** `PAYMENT_INITIATED`) and change its status / cancel / edit /
reassign it. **Expect:** it works exactly as it did before this change — only `PAYMENT_INITIATED`
orders are blocked.

### ❌ F. POS / walk-in order → never gets a gift (app-only)
1. Record a walk-in sale from the admin POS counter (`POST /admin/pos/sale`) that would qualify.
2. **Expect:** **no gift line.** The gift engine is wired only into the app checkout
   (`POST /user/order/place`); the POS path never calls it.

### ✅ G. Cart preview → `giftOffer` on `GET /user/cart`
With the flag + tiers on, watch `giftOffer` as the cart grows:
- Below the first tier (e.g. Rs 60): `currentGift: null`, `nextTier` points at the Rs 100 tier with
  `amountToUnlock: 40`, message like **"Add Rs 40 more to unlock a free Parle-G."**
- Above the first tier (e.g. Rs 120): `currentGift` = Parle-G, `nextTier` = the Rs 500 tier with
  `amountToUnlock`, message like **"You've unlocked a free Parle-G. Add Rs 380 more for a free
  Haldiram namkeen."**
- After the daily cap is hit: `currentGift` and `nextTier` both **null**, `capReached: true`, message
  **"You've already claimed your free gift for today."**

> Preview OOS is **advisory** (judged from the live item quantity). The **order line at checkout is the
> source of truth** — the actual grant is decided at checkout, not at preview.

### ✅ H. Admin validation (each rejected)
Try to create/update a tier that is invalid:
- **Inactive gift item** → **400** "Gift item must be active."
- **Item from another store** → **404** "Gift item not found in this store." (the item lookup is
  store-scoped, so a foreign item simply isn't found).
- **`minOrderValue` not an integer >= 1** (e.g. 0 or -50) → **403** (Joi validation).
- **`endDate` before `startDate`** → **403** at create (Joi), or **400** "endDate must be on or after
  startDate." on a partial update (re-checked against the merged existing+patch dates).
- **Duplicate threshold for the same store** → **400** "A gift tier already exists at this order value."
  (also enforced by a unique index as a backstop).

### ✅ I. Admin FE walkthrough (`damin.haper.in`, this pass)

**Surface 1 — "Free Gift on Order" on `/config` (Store Configuration).** Sign in with a store admin (or a
super admin with a specific store — NOT "All Stores" — picked in the switcher).
1. **Loading / error / empty:** on open the tier area shows 3 skeleton rows, then either the tiers
   table or, when the master switch is ON with no tiers, the teaching empty state ("No gift tiers
   yet" + "Add your first tier"). Kill the network and the area shows an error card with **Retry**.
2. **Master OFF (default):** the tier area is dimmed (55%, not clickable) with "Turn on Free Gift to
   add tiers"; the **+Add** control is hidden. Flip the switch ON → the footer shows "Unsaved switch
   change"; click **Save** → toast "Free gift turned on" (persists via `PUT /admin/store/:id`).
3. **Add a tier:** click **Add tier** → modal. Enter a threshold (integer > 0), search the item
   picker (arrow keys + Enter work; each option shows thumbnail + weight + Rs price), pick start/end
   dates, leave **Tier enabled** ON, **Add**. Row appears, rows sorted by threshold ascending, with a
   status pill (**Active / Paused / Scheduled / Expired**).
4. **Validation:** threshold `0` → inline red "Enter a whole order value above Rs 0"; a threshold that
   already exists → "A tier at Rs N already exists"; end date before start → red banner "End date
   can't be before the start date". **Save/Add stays disabled** while any error is present. A
   backend reject (inactive item, etc.) surfaces as a toast and the modal stays open with input kept.
5. **Edit / delete:** the ghost icon buttons (aria-labels "Edit Rs N tier" / "Delete Rs N tier").
   Delete opens a confirm modal ("Remove this tier?"), **not** `window.confirm`.
6. **All-Stores mode (super admin):** switch to "All Stores" → the section shows "Select a specific
   store…" and no tier controls (the CRUD needs one concrete store id).

**Surface 2 — Option-B in Order details.** Open a `PAYMENT_INITIATED` order in `OrderDetailsModal`.
1. **Expect:** a yellow inline note "Payment pending — this order will resolve automatically and can't
   be actioned manually." The **status select + Update Status**, **delivery-boy select + Assign**, and
   **Edit Items** button are all **disabled**. Any **non**-`PAYMENT_INITIATED` order behaves exactly
   as before (regression check — see section E4).
2. If a control is somehow triggered, the backend 400 message is shown as a toast (no raw error).

**Surface 3 — FREE gift line in Order details.** Open a delivered/normal order that received a gift.
1. **Expect:** the gift line shows a green **FREE GIFT** pill next to its name, its price renders as
   the struck MRP + green **FREE** (never a bare Rs 0), the line Total shows **FREE**, and the payment
   card gains a **"Free gift → FREE"** row. Old orders (no `isFreeGift`, or `false`) render as normal
   lines — only an explicit `true` gets gift treatment.

---

## Old-app / backward-compatibility (hard requirement)

A customer on an **old, un-updated Android build must keep working exactly as before.** New behaviour
lights up only on updated apps.

### ✅ Old app places orders as today
1. From an old build (sends **nothing new** at checkout — the gift is 100% server-selected), place a
   qualifying order at a gift-enabled store.
2. **Expect:** the order places normally. The Rs 0 gift line is present but renders on the old app as a
   plain Rs 0 item with **no FREE tag** — harmless, not broken.

### ✅ The Rs 0 gift line does not break order-total math
The authoritative totals (`price` / `actualOrderValue` / `charges`) already include the gift as **+0**,
so line sums still reconcile:
- `sum(items.salePrice * quantity) === actualOrderValue`
- `price === actualOrderValue + charges.delivery + charges.platform - walletUsed`

### ❌ `isFreeGift` must never be missing from a line
`isFreeGift` is emitted (default **false**) on **every** order line — gift and non-gift alike. Android
Gson decodes a *missing* key to `null`, not to the Kotlin default, so the key must always be present.
Old-app decoding must not break on any line.

No existing field, response shape, or enum is changed or removed.

---

## Robustness (fail-open reads, fail-closed reserve)

The gift is a non-essential add-on, so it must never block a paid checkout it can't evaluate:

- **Fail-OPEN reads.** If the read prelude in `selectGiftForCart` hits a transient DB error
  (`getActiveTiers` / `dailyGiftCount`, or a per-tier `getDetail`), the checkout **proceeds with NO
  gift** — the paid order still goes through (same stance as the store maintenance / serviceability
  guards). A per-tier read error just skips that tier and walks down.
- **Fail-CLOSED reserve.** The mutating `sellFEFO` reserve is **not** swallowed: if it throws
  mid-decrement, the exception **propagates and aborts the whole transaction** — so no half-reserved
  gift is ever committed. (An out-of-stock `{ ok: false }` is not a throw — that's the normal fallback.)

---

## Automated coverage (in-memory Mongo only — never the real DB)

Run each from its package dir so the per-package in-memory setup fires:

```
cd packages/user  && NODE_ENV=test npx jest gift-       # 20 tests (3 suites), all green
cd packages/admin && NODE_ENV=test npx jest gift-tier   # 20 tests, all green
```

- **`packages/user/__tests__/gift-checkout.test.js`** (10) — highest-tier selection, no-stacking, OOS
  fallback to the next lower tier, all-OOS → no gift, the daily cap, POS excluded, and the **old-app
  order** test (no gift client field → exactly one `isFreeGift: true` line at Rs 0, and the total math
  reconciles).
- **`packages/user/__tests__/gift-cart.test.js`** (5) — the `giftOffer` preview: unlocked gift,
  "add Rs X more" nudge, cap-reached, and flag-off neutral offer.
- **`packages/user/__tests__/gift-failopen.test.js`** (5) — the read prelude fails open (paid order
  still places with no gift), while a reserve throw aborts and rolls back the order.
- **`packages/admin/__tests__/gift-tier.test.js`** (20) — tier CRUD + all the validation rejections in
  section H + the master-flag toggle + permission gating.

---

## Deploy / rollout

- **Backend redeploy only** (dev: `dapi.haper.in`). No DB migration — every addition is a new
  collection (`store-gift-tiers`), a new defaulted flag, or a new defaulted order-line field.
- **Enable per store** via the flag; dark-launch **one store first**, verify, then expand.
- **Rollback = flip `giftWithPurchaseEnabled` OFF** for the store. Instant, no data migration to
  reverse. With the flag off the code is inert (checkout / cart / POS unchanged).
- **Client apps** (Android priority, then iOS, then web), the **admin FE tier screen**, the
  **picker/delivery FREE tag**, and the **invoice Rs 0 FREE line** are **later passes** — none is
  required for the backend to be safe to ship.

---

## Open questions — RESOLVED 2026-07-27 (product owner sign-off)

The product owner signed off on 2026-07-27. Fuller detail lives in `haper-misc/free-gift-design.md`
§12. Only the last item (admin order-edit) is still open.

1. **Cap counts in-flight prepaid orders** — **RESOLVED: YES.** A `PAYMENT_INITIATED` order already
   holds a real reserved gift unit, so it **counts** toward the daily cap (stops a double-reserve). A
   never-paid attempt is freed only when it ends up `PAYMENT_FAILED` / `PAYMENT_CANCELLED` / `FAILED`
   (e.g. the 15-min cron marks an abandoned one `PAYMENT_CANCELLED`).
2. **Cap scope** — **RESOLVED: per-store per-day** (not global across all stores).
3. **Windows require both a start and an end date** — **RESOLVED: YES** (no open-ended "never expires"
   tier).
4. **Does a refunded / cancelled gift order free the cap?** — **RESOLVED: NO (changed).** A
   genuinely-placed gift order (a COD order that reached `OPEN`, or a prepaid order that was actually
   paid) **keeps** the slot for the rest of the IST day even if it is later cancelled or refunded —
   deliberate anti-farming. The **only** thing that frees the slot is a prepaid attempt that **never
   completed payment** (`PAYMENT_FAILED` / `PAYMENT_CANCELLED` / `FAILED`). *(This reverses the old
   draft, which let a refunded / cancelled order free the cap.)*
5. **GST on the Rs 0 line** — **RESOLVED: Rs 0**, and the line is labelled **FREE**. The threshold
   basis (cart item-subtotal before delivery / platform charges) was also re-confirmed.
6. **Admin order-edit of a gift-bearing order** — **STILL OPEN (later-pass fix):** `consolidateItems`
   currently keys on `itemId` only, so editing an order that has the same item as both a paid line and
   a gift line could merge them into one paid line and drop `isFreeGift`. Track under the later-pass
   admin order-edit gift-safety task.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Qualifying order gets **no gift** | Master flag OFF for the store, or no **active** tier (disabled, or now outside `[startDate, endDate]`). |
| Order gets **no gift** but flag + tier look right | The tier's gift item (and every lower qualifying one) is **out of stock**, or the customer already **claimed today's** gift (daily cap). |
| **POS** sale has no gift | Expected — the gift engine is app-checkout only. |
| Tier create returns **403** | Admin lacks `STORE_CONFIG.EDIT`, or `minOrderValue`/`endDate` failed Joi validation. |
| Tier create returns **404** "Gift item not found in this store." | The `giftItemId` belongs to a different store (or doesn't exist). |
| Tier create returns **400** "A gift tier already exists at this order value." | Duplicate threshold for the store — edit or delete the existing tier instead. |
| `giftOffer` missing from `GET /user/cart` | Backend not deployed on this box, or the preview safely fell back to the neutral no-offer (never an error). |
