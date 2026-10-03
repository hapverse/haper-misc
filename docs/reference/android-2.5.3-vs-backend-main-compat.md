# Android 2.5.3 (live in users' hands) vs haper-backend `main` — compatibility audit

**Audited:** 2026-10-03
**Android side:** tag `v2.5.3` (`7899bb1`, 2026-09-13), `versionCode = 53`, `versionName = "2.5.3"`
**Backend side:** `origin/main` = `0500e10` (2026-10-02 22:23 IST)
**Baseline for "what changed":** `1e3c1ce` (main merge of 2026-09-12) — the backend that was live when 2.5.3 shipped.
**Endpoints audited:** 51 (every `@GET/@POST/@PATCH/@DELETE/@HTTP` in
`haper-android/app/src/main/java/com/bheldi/data/api/ApiService.kt` at `v2.5.3`)

**Verdict: no hard break (no 404s, no parse crash, no new required request field).
Two REAL customer-visible problems, both data/behaviour, both version-agnostic
(2.5.5 is affected identically). One is the taxonomy incident, still fallback-less in code.**

---

## 0. Ground rules established by this audit

### JSON parsing: Gson (not Moshi)
`app/build.gradle.kts:115` → `retrofit.converter.gson`.
Consequences, confirmed:
* **Unknown/new JSON fields are silently ignored.** Every additive backend field in this
  diff (`thumbnail`, `codConversion`, `prepaidPaymentWindow` keys, …) is harmless.
* **A missing key decodes to `null` even for a non-null Kotlin type** (reflective
  allocation bypasses the constructor/defaults). So a *removed or renamed* backend field
  whose Kotlin declaration is non-null is an NPE at the read site, not at parse time.
  → **No such removal exists in this diff.** All customer projections went from
  `{__v: 0}` to `{__v: 0, codConversion: 0}` — exclusion-only, nothing customer-facing
  dropped (`haper-backend/packages/shared/repositories/order.repository.js:142`).
* Non-null primitives (`ItemModel.price: Double`) land as `0.0`, not a crash.

### Error surfacing is robust
`ErrorResponse.displayMessage` = `msg ?: message ?: error ?: "An unexpected error occurred"`
(`haper-android/app/src/main/java/com/bheldi/data/model/AuthModels.kt:84`), read through
`NetworkModule.parseError` (`.../data/api/NetworkModule.kt:337`).
Every new backend refusal in this diff puts its text in `msg`, so 2.5.3 shows the real
server sentence, not a generic error.

### There IS an app-version compat mechanism, and 2.5.3 passes it
`haper-backend/packages/user/src/routes/order/controller.js:27-56`:
```js
const PICK_STATUS_MIN_BUILD = { android: 44, ios: 1 };
const clientKnowsPickStatuses = (req) => { ... parseInt(req.headers["x-build-number"]) >= min }
```
2.5.3 sends `x-platform: android` + `x-build-number: 53`
(`NetworkModule.kt:106-108`). 53 >= 44 → 2.5.3 receives the **real** `PICKING(18)` /
`PACKED(19)` codes, and it renders both natively
(`OrderModels.kt:513-514, 531-532, 544, 559-560, 571`). ✅ correct for 2.5.3.

This is the **only** version-gated behaviour in the backend. There is no API version
header, no `client.av` gate, no per-version feature flag. Everything else is "one
response shape for all clients" — which is why the taxonomy cutover hit everyone at once.

### Enums / status codes: nothing renumbered
`packages/shared/constants/order.constant.js` diff is **purely additive** (COD-conversion
reasons, `paymentState` strings, `UNPAID_ONLINE_STATUSES`, timing constants).
`paymentMethod` stays `COD:0, RAZORPAY:1, STORE_PICKUP_PREPAID:2, STORE_PICKUP_POSTPAID:3,
WALLET:4` — identical to `OrderModels.kt:586-592`. No new `orderStatus` value.
2.5.3's `OrderStatus.from()` falls back to `FAILED` for unknown codes, and there is
nothing unknown left to hit.

---

## 1. 🚨 FAIL — taxonomy cutover: category browse is 100% dependent on `items.taxonomy`, with no fallback, and the backfill is NOT in the migration runner

This is the incident that just happened. **It is not fixed in code on `main` or on `dev`** —
it was (presumably) fixed by running the backfill by hand. Any un-backfilled item, any
new environment, or any item written by a path that skips the normaliser **vanishes
silently** from browse again.

**Three customer surfaces, all fail-closed-to-empty, no `$or` fallback to the singular
`category._id` that 2.5.3 still carries:**

| 2.5.3 call | Backend read path on `main` | Mechanism |
|---|---|---|
| `GET user/home/category` → `getCategories()` (`ApiService.kt:45`) | `packages/shared/repositories/category.repository.js:152-172` | `$unwind: "$taxonomy"` → `$group` → `match._id = {$in: tagged}`. `$unwind` **drops** taxonomy-less items. Comment literally says *"Empty → `{$in: []}` matches nothing, the correct fail-closed answer."* |
| `GET user/home/sub-category/{categoryId}` → `getSubCategories()` (`ApiService.kt:57`) | `packages/shared/repositories/sub-category.repository.js:126-149` | same `$unwind` + `$in: reachableSubIds`, fail-closed |
| `GET user/home/items/{cat}/{sub}/{page}` → `getItemsByCategory()` (`ApiService.kt:60`) | `packages/shared/repositories/item.repository.js:617-630` | `condition.taxonomy = {$elemMatch: {categoryId, subCategoryId}}` — replaced `condition["category._id"] = categoryId` |

**What the 2.5.3 user sees:** home screen with **zero category tiles**; if a tile does
render, tapping it gives an empty aisle list / empty item list. No error, no retry — the
app's empty state. Search (`user/item/search/...`) and item detail still work, because
neither touches `taxonomy` — which is exactly why this looked like "categories broke" and
not "the catalog broke".

**Why it keeps being a landmine:**
* `scripts/migrations/backfill-item-taxonomy.js` exists and is idempotent, **but it is
  absent from `STEPS` in `scripts/migrations/run.js:47-61`** (steps 1-12 list cost price,
  shelf, batches, cart-limit rules, COD index — no taxonomy). `npm run migrate:apply`
  therefore **skips it silently**. Same for `scripts/migrations/build-taxonomy-index.js`
  (the supporting index `idx_items_store_status_taxonomy`, which
  `packages/shared/models/items.schema.js:167-180` explicitly says is **not** built at boot).
* **No test covers a legacy item with empty `taxonomy`.** Every fixture writes `taxonomy`
  explicitly — `packages/user/__tests__/multi-category-items.test.js:26` says so in a
  comment. The green suite cannot see this class of bug.
* The singular `category`/`subCategory` fields are still maintained (as "derived primary =
  `taxonomy[0]`", `packages/shared/models/items.schema.js:76-79`), so the *data for a
  fallback is right there* — the read path just doesn't use it.

**Recommended minimal fix (owner: sumit-backend):** (a) add
`backfill-item-taxonomy.js` + `build-taxonomy-index.js` to `run.js` STEPS; (b) add one
test with an item whose `taxonomy` is `[]` but whose `category._id` is set, asserting it
is still browsable — or accept the gap explicitly and add a startup/health assertion that
`items` with a category and no taxonomy == 0.

---

## 2. 🚨 FAIL (soft, silent) — unpriced items (`sellingPrice <= 0`) are now invisible, and a cart line holding one is deleted without telling the customer

New `itemVisibilityUtils.PRICED_FILTER = { sellingPrice: { $gt: 0 } }`
(`packages/shared/utils/item-visibility.utils.js:17`) was added to **every** customer read:

* `item.repository.js:579` `getPaginated4User` → `GET user/item` / `user/home/items`
* `item.repository.js:613` `getPaginatedItemsBasedOnCatSubCat` → category drill-down
* `item.repository.js:725` `getDetail4User` → `GET user/item/{itemId}` ⇒ **404** for a deep link / push / "buy again" on an unpriced item
* `item.repository.js:73, 930, 1010, 1122` → search ($search + regex fallback), suggested, counts

Plus two cart effects:

* **Silent cart-line deletion.** `packages/user/src/routes/cart/controller.js:239-247`:
  a line whose item price was zeroed is `CartRepository.delete(...)`'d on the next cart
  read, treated exactly like out-of-stock. 2.5.3's cart screen has **no message for this**
  — the item just disappears between screens. (Same for 2.5.5.)
* **New 404 on add-to-cart.** `packages/shared/repositories/cart.repository.js` (the
  `hasSellablePrice` guard) → `"Item not found or out of stock"` with status 404.
  2.5.3 displays the `msg`, so this one is legible.

**Risk to quantify (I cannot — no prod DB access):** how many ACTIVE, in-stock prod items
currently have `sellingPrice <= 0` or missing. That number is exactly how much catalog is
invisible to 2.5.3 users right now. The ops worklist for it is the admin
`missingSellingPrice=true` filter (`item.repository.js:357-362`). **Check this before
calling the app healthy.**

---

## 3. Endpoint-by-endpoint result

Legend: ✅ pass (route + shape + semantics unchanged for 2.5.3) · ⚠️ pass with a
behaviour change a 2.5.3 user can notice · ❌ fail.

### Auth (5) — ✅ all
`GET user/auth/otp/get-otp`, `POST user/auth/otp/login`, `POST user/auth/google/register`,
`POST user/auth/google/verify-phone`, `POST user/auth/refresh`.
Routers unchanged (`packages/user/src/routes/auth/**`); zero diff vs baseline.

### Store (1) — ✅
`GET user/store/nearest` — `store/router.js:6` intact, controller untouched.

### Home (5)
| Endpoint | Result |
|---|---|
| `GET user/home/category` | ❌ **see §1** |
| `GET user/home/sub-category/{categoryId}` | ❌ **see §1** |
| `GET user/home/items/{cat}/{sub}/{page}` | ❌ **see §1** (+ §2) |
| `GET user/home/items` (suggested/featured) | ⚠️ §2 only — `isSuggested` based, no taxonomy |
| `GET user/home/banners` | ✅ |
Response shape: `home/controller.js:91, 112` now wrap the item list in
`stripTaxonomy(...)` — it **removes** the `taxonomy` key. 2.5.3's `ItemModel`
(`HomeModels.kt:70-104`) never declared `taxonomy`, so this is a no-op for it. ✅

### Item (2)
| Endpoint | Result |
|---|---|
| `GET user/item/{itemId}` | ⚠️ §2 — 404 instead of a product page for an unpriced item |
| `GET user/item/search/{query}/{page}` | ⚠️ §2 — unpriced items excluded; still **not** taxonomy-dependent, so search survives a taxonomy gap |

### Cart (3)
| Endpoint | Result |
|---|---|
| `GET user/cart/` | ⚠️ §2 silent line deletion |
| `POST user/cart/CART` | ⚠️ new 404 (unpriced, §2) and new **400 cart-limit refusal** (§4) |
| `DELETE user/cart/{itemId}` | ✅ |
Shape: `cart/controller.js:45-51` additionally deletes `line.itemId.taxonomy` — again a
key 2.5.3 never read. ✅

### Coupons / offers (3) — ✅ all
`POST user/cart/coupon/apply`, `DELETE user/cart/coupon`, `GET user/coupon/available`.
No diff in `coupon/router.js`, `coupon/controller.js`. `discount.utils.js` changed only to
match rules against every taxonomy pair; emitted keys (`discountedPrice`,
`discountAmount`, `discountLabel`, `appliedDiscounts`) are unchanged — all nullable in
`HomeModels.kt:100-103`.

### Profile / notifications / account deletion (11) — ✅ all
`GET|PATCH user/profile/`, `GET user/profile/referrals`,
`GET|PATCH user/profile/notifications`, `POST|DELETE user/profile/device`,
`GET user/profile/delete-account/preview`, `POST .../send-otp`, `POST .../confirm`,
`POST user/profile/restore-account`. `profile/router.js` + controller untouched.

### Address (9) — ✅ all
`GET user/address`, `/default`, `/geocode`, `/autocomplete`, `/place-details`,
`POST`, `PATCH`, `PATCH /default`, `DELETE /{id}`. `address/router.js:26-41` intact,
no controller/validator diff.

### Wallet (2) — ✅ both
`GET user/wallet/`, `GET user/wallet/history`.

### Orders (9)
| Endpoint | Result |
|---|---|
| `GET user/order/history` | ✅ (status buckets unchanged; `presentOrderStatus` gives 2.5.3 real codes, which it renders) |
| `GET user/order/{orderId}` | ✅ |
| `DELETE user/order/{orderId}` | ⚠️ §5 — new 409 `ORDER_CHANGED`; cancel window for unpaid orders widened 60s → 15 min (more permissive) |
| `POST user/order/{orderId}/cancel` | ⚠️ same as above |
| `GET user/order/slots` | ✅ |
| `POST user/order/{orderId}/change-slot` | ✅ |
| `POST user/order/{orderId}/rate` | ✅ |
| `GET user/order/{orderId}/invoice` | ✅ (`invoice.utils.js` only changed the wallet line's arithmetic) |
| `POST user/order/place` | ⚠️ §4 cart-limit 400; response is additive only (`prepaidPaymentWindow(...)` keys added beside the existing `order`/`minOrder`/`walletUsed`/`rzpOrder`/`rzpToken` that `PlaceOrderResponseData` (`OrderModels.kt:77-83`) reads) |
`order/router.js` adds only `GET /:orderId/payment-status`, placed **above** `/:orderId`
so it cannot shadow 2.5.3's detail call. No new required request field anywhere
(`order/validator.js` diff is one new read-only validator).

### Config (1) — ⚠️
`GET user/config` — controller unchanged. BUT `forceUpdate.minAndroidVersion` is
**DB-driven** (`config/controller.js:18-22`). If anyone sets it to `2.5.4`+, every 2.5.3
user is hard-blocked at the force-update screen. That is a config decision, not a code
break — just don't do it accidentally.

---

## 4. ⚠️ Cart quantity limits — a new 400 a 2.5.3 cart has no UI for

New DB-driven `cart-limit-rules` collection + enforcement at two points:
* add-to-cart: `packages/shared/repositories/cart.repository.js` (`evaluateAddition`, throws 400)
* checkout: `packages/user/src/routes/order/controller.js:615-632` `assertCartWithinLimits`
  → `throw new errorUtils(violations.join(" "), 400)`

Migration step 11 (`run.js:58`) seeds **"Cooking Oil on, Sugar off"**, so there is a live
rule in any migrated environment.

For 2.5.3 this is **not a break but is poor UX**: the cart screen shows no limit hint and
the `+` button is not capped, so the customer can build an over-limit cart and only learn
at Place Order, as a plain toast/dialog carrying the server sentence. The backend
fail-opens on any lookup error (`controller.js:626-629`), so it can never block a
checkout spuriously. 2.5.5 is in the same position — no client surfaces limits yet.

## 5. ⚠️ Unpaid online orders now auto-cancel after 15 minutes, and 2.5.3 has no retry path

New `PAYMENT_WINDOW_MINUTES = 15` + `packages/cron/src/jobs/payment-initiated-orders.js`
+ `packages/shared/utils/unpaid-order-release.utils.js`. 2.5.3 confirms payment **purely
via the Razorpay webhook** — `RazorpayManager` just hands the SDK result to a local
callback (`.../checkout/RazorpayManager.kt:56-64`, `MainActivity.kt:174-179`); it never
calls `/payment-status` or `/razorpay/order/{id}/verify` (both added after 2.5.3, see the
`v2.5.3..main` diff of `ApiService.kt`).

**This is safe, and I verified why:** before cancelling, the release path asks Razorpay
itself (`unpaid-order-release.utils.js:168-247` `settleOrReleaseUnpaidOrder`) — a
`captured` payment is **settled** through `processCapture` instead of cancelled, an
`authorized`/unverifiable one is left alone until `PAYMENT_WINDOW_MINUTES + 15`. So a
2.5.3 order whose webhook is slow is not cancelled out from under the customer.

What a 2.5.3 user *does* see on a genuinely abandoned payment: the order turns up in
history as `PAYMENT_CANCELLED(9)` → "Payment Cancelled" (`OrderModels.kt:531`), wallet
coins refunded. No retry button (2.5.5-only feature). Acceptable; worth knowing for
support.

Related and also fine: a new checkout **supersedes** an unpaid order ≥ 60s old
(`SUPERSEDE_MIN_AGE_SECONDS`), so a 2.5.3 user who retries by re-placing doesn't strand
stock.

## 6. ⚠️ Reopen-as-COD — invisible but correct on 2.5.3

An admin flipping an unpaid online order to cash writes `order.codConversion` and changes
`paymentMethod` 1 → 0. 2.5.3 reads `paymentMethod` only
(`OrderModels.kt:199`, `PaymentMethod.from()` → "Cash on Delivery"), which is the right
thing to show. `codConversion` itself is stripped from every customer read by
`CUSTOMER_SAFE_PROJECTION` (`order.repository.js:142`) — deliberately, it holds staff
data. The customer is told by push (`COD_CONVERTED` template,
`packages/shared/constants/notification.constant.js`), which needs no app change.

## 7. The one remaining taxonomy-shaped hole specific to 2.5.3

`ItemDetailScreen.kt:174-175` reads `item.category?.id` and calls
`getItemsByCategory(categoryId, "null", 1)` to populate the "similar items" rail. Since
that endpoint now matches on `taxonomy.categoryId` (§1) while `category._id` is still
populated on legacy rows, a legacy item shows a **product page with an empty similar-items
rail**. Null-safe (`CategoryRef` is nullable, `HomeModels.kt:136`), so no crash — just a
blank section. This is the only place 2.5.3 reads singular `category` for a *request*; the
other two reads (`ItemDetailScreen.kt:521-522`, breadcrumb text) are display-only.

---

## 8. What a future cutover should do differently

1. **A read-path cutover to a new denormalised field needs an `$or` fallback to the old
   field**, kept until a census proves 0 rows lack the new one. Fail-closed `{$in: []}` is
   correct for *security*, wrong for *catalog visibility*.
2. **A backfill that a read path depends on must be in `run.js` STEPS**, or it will be
   skipped by whoever runs `migrate:apply`.
3. **At least one test fixture must be written the OLD way** (no `taxonomy`). A suite where
   every fixture uses the new shape proves nothing about existing rows.
4. The `x-build-number` / `PICK_STATUS_MIN_BUILD` mechanism in
   `packages/user/src/routes/order/controller.js:33` is the house pattern for serving older
   builds differently — reuse it rather than inventing a new gate, and remember it is
   currently used in exactly one place.
