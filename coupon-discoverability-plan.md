# Coupon Discoverability ("Offers") — Implementation Plan

**Status:** DRAFT — not approved. Do not start building until the user answers §9.
**Author:** shavinder (planner) · **Date:** 2026-08-27
**Extends:** `haper-misc/coupon-codes-plan.md` (the shipped coupon system) and
`haper-misc/coupon-codes-admin-ui-design.md` (the admin form this touches).

---

## 0. Scope summary (read this first)

| | |
|---|---|
| **What is new** | (a) one boolean on the coupon schema, (b) ONE new read-only customer endpoint, (c) one toggle on the existing admin coupon form, (d) one new customer screen per client. |
| **What is NOT changing** | The apply-by-typing flow, `POST /cart/coupon/apply`, `DELETE /cart/coupon`, the redemption ledger, the claim/release concurrency core, the abuse counter, POS, both checkout paths, the automatic-discount engine. **Zero money-path code is edited.** |
| **Money risk** | None directly. This feature never claims, never prices an order, never writes a redemption. It reads. The only real risk is a *hidden* coupon leaking into the list (a business/secrecy risk, not a money-loss one). |
| **Scope guard** | Still whole-cart-only. No SKU/category targeting is added here (v1 constraint stands). |

---

## 1. Goal

Today a Haper customer can only use a coupon if somebody told them the exact code. There is no
screen in the app that says "here is what you can save right now". We are adding one: an **Offers**
screen that lists the coupons this specific customer can actually use, and lets them apply one with
a single tap instead of retyping it. At the same time, marketing keeps the ability to issue *secret*
codes (influencer codes, referral-partner codes, a code a support agent gives an unhappy customer)
that must **never** appear in that list — so every coupon carries an admin-controlled
"visible to customers / hidden (code only)" switch.

Real example: marketing runs `MONSOON20` (20% off, min ₹499) as a public campaign and issues
`RAVI-YT` to a YouTuber. A customer opening Offers sees exactly one card — `MONSOON20`, with
"Add ₹120 more to use this" if their cart is at ₹379. `RAVI-YT` is invisible to them, but still
works the moment they type it.

### Acceptance criteria ("done" means all of these are true)

1. An admin creating or editing a coupon sees a **Visible to customers / Hidden (code only)**
   control on the coupon form, saves it, and the saved value is shown when they reopen the form.
2. Every coupon that existed before this feature shipped reads as **Hidden** until an admin
   explicitly turns it on (nothing becomes public by accident).
3. A logged-in customer can open an Offers screen and see the coupons that are visible **and**
   usable by them right now: enabled, inside its date window, valid at their store, not
   first-order-only-when-they-have-ordered, not already used up by them, not globally exhausted.
4. A coupon marked Hidden **never** appears in that list, for any customer, in any state — verified
   by an automated test, not just by eye.
5. Each card shows: the code, a plain-English discount summary ("20% off, up to ₹150"), the
   description, the minimum order value, and — when the cart is below that minimum — how much more
   is needed ("Add ₹120 more to use this").
6. Tapping a card applies the coupon to the cart in one action (no manual typing) and the customer
   lands back on the cart/checkout with the discount already reflected. If the cart is empty,
   the card explains that instead of failing with a raw error.
7. A customer with no eligible visible coupons sees a friendly empty state, not an error or a
   blank screen.
8. Typing a code by hand still works exactly as it does today — including hidden codes — with the
   same messages, the same 3-wrong-codes-a-day guard, and the same checkout behaviour.
9. Old app versions that never call the new endpoint are completely unaffected.
10. `haper-misc/test-coupon-codes.md` gains a section covering the Offers screen and the
    visible/hidden rule (project rule: test guides stay in sync).

---

## 2. Current state (verified in the tree today)

| Piece | File | Note |
|---|---|---|
| Coupon schema | `haper-backend/packages/shared/models/coupons.schema.js` | `code, description, scope, discount, minOrderValue, schedule, limits, usedCount, enabled`. No visibility concept. 3 indexes. |
| Eligibility engine | `haper-backend/packages/shared/utils/coupon.utils.js` → `validateCouponForCart()` | Already decides kill-switch, enabled, schedule, store scope, minOrderValue, firstOrderOnly, guest-identity. Deliberately does NOT decide total-cap / per-customer-cap (those are claim-time only). **This is the function the new endpoint reuses.** |
| Orchestration | `haper-backend/packages/shared/utils/coupon-flow.utils.js` | `resolveForCart()` (code → verdict), `messageFor()` (reason → customer sentence, already contains the "Add ₹X more to use CODE." string), `isFirstOrderForUser()`. |
| Advisory counters | `haper-backend/packages/shared/repositories/coupon-redemption.repository.js` → `countLiveForCustomer()` | HELD+CONFIRMED slots per customer. Documented as advisory-only; the cart apply path already uses it exactly this way. |
| Customer apply | `haper-backend/packages/user/src/routes/cart/{router,controller}.js` | `POST /cart/coupon/apply`, `DELETE /cart/coupon`. Apply persists the CODE on the cart and returns the repriced cart. **Requires a non-empty cart.** |
| Store resolution | `haper-backend/packages/user/src/middleware/geo.js` | `req.storeId` comes from the `x-store-id` header; any `/user/*` path not on the whitelist 400s without it. |
| Admin CRUD | `haper-backend/packages/admin/src/routes/coupon/{controller,validator,router}.js` | `COUPON_FIELDS` whitelist (line ~55) controls what a create/edit may persist; `decorate()` adds computed `activeNow`. |
| Admin UI | `haper-admin/src/pages/Coupons/{CouponsPage,CouponFormModal}.tsx` + `src/api/coupons.ts` | Form already has an `enabled` Switch (line ~522) — the new toggle sits beside it. |
| Android | `.../ui/screens/cart/{CartScreen,CartViewModel}.kt`, `data/api/ApiService.kt` | Coupon input + apply/remove already wired; nav graph is a single `NavHost` in `MainActivity.kt` (~line 600+). |
| iOS | `haper-ios/haper/Views/{CartView,CheckoutView}.swift`, `ViewModels/CartManager.swift`, `Views/MainTabView.swift` | Same shape as Android. |
| Web | `haper-web/pages/Checkout.tsx`, `context/CartContext.tsx`, `services/api.ts` (`couponApi`), routes in `App.tsx` | Has a `/rewards` page (wallet + referral) — a natural neighbour for `/offers`. |

**There is no "list coupons" endpoint anywhere today** — admin list is `/admin/coupon` and is
admin-authenticated.

---

## 3. Proposed design

### 3.1 One boolean, not an enum — `visible`

Add `visible: { type: Boolean, required: true, default: false }` to the coupon schema.

- **Why a boolean:** the question has exactly two answers and the schema already has the identical
  precedent in `enabled`. An enum (`PUBLIC | HIDDEN | ...`) invites a third state nobody has asked
  for and forces every client to handle an unknown value.
- **Why the name `visible`:** it is the same part of speech and register as the existing `enabled`,
  so `enabled && visible` reads correctly. `isPublic` wrongly suggests "usable without login";
  `discoverable` is a longer word for the same thing and does not pair with `enabled`.
- **Why default `false`:** a coupon becoming publicly listed must be a decision somebody made, never
  a side effect of a deploy. `WELCOME50` sitting quietly in the collection today may be a code that
  only ever went out by SMS to 40 people — publishing it to every customer on deploy day is
  irreversible (you cannot un-see a code). Hidden-by-default fails closed. *(Confirm — Q1.)*

**The backfill subtlety (deliberate, do not "fix" it):** existing documents have no `visible` field
at all, and `.lean()` reads do **not** apply schema defaults. The list query filters on
`{ visible: true }`, and a missing field does not match `true` — so old coupons are excluded
automatically, with no migration required. A migration is still recommended for tidiness (§4.3), but
correctness does not depend on it.

**The admin-read subtlety:** on the admin side the same missing field would render as `undefined` and
could make a Switch look "on" or throw off a strict-equality test. `decorate()` in the admin
controller therefore coerces: `visible: coupon.visible === true`.

### 3.2 The list endpoint reuses the engine — it does not re-implement eligibility

```
GET /user/coupon/available
  ↓
1. Mongo pre-filter (cheap, indexed):
     visible: true, enabled: true,
     schedule.startAt <= now, schedule.endAt >= now,
     $or: [ {scope.type: "global"}, {scope.storeIds: req.storeId} ]
   → at most N candidates (hard cap 50; the collection is tens of docs)
  ↓
2. Read the customer's current cart lines → subtotal (couponUtils.sumLineSubtotal)
   Empty cart ⇒ subtotal = 0, which is a legitimate value, not an error.
  ↓
3. isFirstOrder — computed ONCE for the request, and only if some candidate
   has limits.firstOrderOnly (one `OrderModel.exists()`, same helper checkout uses)
  ↓
4. Per candidate: couponUtils.validateCouponForCart({coupon, storeId, subtotal,
                                                     isFirstOrder, userIsGuest:false, now})
     ok                → INCLUDE, eligibleNow = true
     BELOW_MIN_ORDER   → INCLUDE, eligibleNow = false, shortBy = min - subtotal
     anything else     → DROP (expired, wrong store, not-first-order, disabled,
                               kill-switch NOT_FOUND)
  ↓
5. Advisory cap filters (drop-only, never a gate on anything):
     totalLimit != null  && usedCount >= totalLimit          → DROP
     perCustomerLimit set && countLiveForCustomer >= limit   → DROP
  ↓
6. Shape the cards, sort, return
```

Step 4 is the whole point: **the truth about "can this customer use this coupon" stays in exactly
one function.** If a future rule is added to `validateCouponForCart`, the Offers screen inherits it
with no code change — and the screen can never promise something checkout will refuse.

Step 1's Mongo filter looks like it duplicates step 4. It does not: it is a cheap narrowing so we do
not load every expired coupon ever created. Step 4 remains authoritative — if the two ever disagree,
step 4 wins and the coupon is dropped.

**Kill switch:** `validateCouponForCart` returns `NOT_FOUND` for every coupon while
`COUPONS_KILL_SWITCH=true`. The list therefore comes back empty on its own — no extra branch, and
the Offers screen goes quiet exactly when the rest of the feature does.

**Guests:** the route sits behind `jwtUtils.authenticate`, so there is always a real user.
`userIsGuest` is hard-coded `false`. POS is not touched.

### 3.3 Why "near-miss" coupons are shown with a gap, not hidden

A customer with ₹379 in the cart and a `min ₹499` coupon is the single most valuable person to show
that coupon to — that is ₹120 of extra basket. Hiding it produces the worst outcome: an empty Offers
screen for a customer who is one item away from a discount.

So: `BELOW_MIN_ORDER` is the **one** refusal reason that still renders, as a card with
`eligibleNow: false` and a `message` of "Add ₹120.00 more to use this." (reusing
`couponFlowUtils.messageFor(BELOW_MIN_ORDER, {shortBy})` so the sentence matches the one the cart
already shows). Every other refusal reason means the coupon is genuinely unusable and listing it
would just be a tease. *(Confirm — Q2.)*

### 3.4 Tap-to-apply reuses the existing apply endpoint

No new apply path. The Offers card calls the **existing** `POST /cart/coupon/apply` with the code it
just displayed. Three reasons: the apply endpoint already returns the fully repriced cart the client
needs; it already carries the fail-closed refusal messages; and a code coming from the list can never
be counted as a "wrong attempt" (`isWrongCodeAttempt` requires the coupon to not exist), so the abuse
counter is untouched by design.

Two behaviours the clients must implement:

- **Cart has items** → apply, then navigate back to cart/checkout showing the applied coupon. If the
  server refuses (it went exhausted in the last 30 seconds), show the server's message on the Offers
  screen and refresh the list.
- **Cart is empty** → do NOT call apply (it 400s with "Your cart is empty…"). The card's action
  becomes "Copy code" + a line saying it will apply at checkout. *(Confirm — Q3.)*

### 3.5 Where the screen lives (functional shape; chanchal-designer owns the visuals)

| Client | Primary entry | Secondary entry |
|---|---|---|
| Android | Row on the cart/checkout coupon block: **"View offers"** next to the code input → `composable("offers")` in `MainActivity.kt` | Profile menu item "Offers & coupons", beside Wallet |
| iOS | Same "View offers" affordance on `CartView`/`CheckoutView` → pushed `OffersView` | `ProfileView` row |
| Web | Same affordance on `Checkout.tsx` → route `/offers` | Profile menu link (sits naturally beside `/rewards`) |

**No new bottom-tab.** A tab is expensive real estate and this screen is only interesting when
someone is shopping; the cart is where the intent is. The profile entry exists so a customer can
browse offers before filling a cart. Entry points are shown unconditionally — if the endpoint 404s
(old backend) or returns an empty list, the screen shows its empty state. Deliberately **not**
gated on `/user/config`, which is cached for 12 hours and would delay the rollout by half a day.

---

## 4. Data model changes

### 4.1 `coupons.schema.js` — one new field

```js
// Does this coupon appear in the customer-facing Offers list?
// FALSE (the default) = code-only: it still works when typed, it is simply never
// advertised. That is what makes influencer / referral-partner / support-issued
// codes possible, so this defaults to hidden — a coupon becomes public only
// because an admin said so, never because a deploy happened.
visible: { type: Boolean, required: true, default: false },
```

No validation hook change (a boolean cannot be cross-field invalid).

### 4.2 New index

```js
schema.index({ visible: 1, enabled: 1, "schedule.endAt": 1 }, { name: "visible_active" });
```

Supports the one new query. The collection is tiny, so this is about keeping the customer path an
IXSCAN forever rather than about today's row count. The existing `active_window` index is left
untouched (the admin list still uses it).

### 4.3 Migration (optional, tidiness only)

`db.coupons.updateMany({ visible: { $exists: false } }, { $set: { visible: false } })` — makes the
admin list render a definite "Hidden" badge instead of an absent field. **Correctness does not
depend on it** (§3.1) and it is trivially reversible. Run on dev; prod is the user's call.

No other collection changes. `coupon-redemptions` and `coupon-attempts` are untouched.

---

## 5. API contract

### 5.1 NEW — `GET /user/coupon/available`

- **Auth:** `jwtUtils.authenticate` (customer JWT).
- **Headers:** `x-store-id` required (standard geo middleware; the list is store-scoped, so this is
  correct — a customer with no store cannot be shown store-specific offers). Path is **not** added
  to the geo whitelist.
- **Query:** `type=CART` (optional, default `CART`) — mirrors the cart endpoints so a future
  scheduled-cart type works unchanged.

**200 response** (all keys ALWAYS present — Android Gson decodes a missing key to `null`, not to the
Kotlin default):

```jsonc
{
  "msg": "Offers fetched successfully",
  "data": {
    "coupons": [
      {
        "code": "MONSOON20",
        "description": "Monsoon sale — 20% off",
        "discountType": "PERCENT",          // PERCENT | FLAT
        "discountValue": 20,
        "maxDiscountAmount": 150,           // null when uncapped
        "discountSummary": "20% off, up to ₹150",   // server-rendered; clients just print it
        "minOrderValue": 499,
        "eligibleNow": false,               // false ONLY for the below-minimum case
        "shortBy": 120.00,                  // 0 when eligibleNow is true
        "message": "Add ₹120.00 more to use MONSOON20.",  // null when eligibleNow
        "estimatedDiscount": 0,             // ₹ this coupon would give on the CURRENT cart; 0 when not eligible
        "expiresAt": "2026-09-30T18:29:59.000Z"
      }
    ],
    "cartSubtotal": 379.00
  }
}
```

**Never in the response:** `usedCount`, `limits`, `scope`, `_id`, `createdBy`, or any coupon whose
`visible !== true`. The response is assembled from an explicit field list, never by spreading the
document — the same rule the admin `pickCouponFields` whitelist follows in the other direction.

**Sorting:** `eligibleNow` first, then `estimatedDiscount` desc, then `minOrderValue` asc, then
`expiresAt` asc. Deterministic, and the best offer is on top.

**Errors:** 401 (no/invalid token), 400 (missing `x-store-id`, from the existing middleware).
Never 500 for "no coupons" — an empty array is a success.

**Caching:** none. The response is per-customer and per-cart; a shared cache here is exactly how one
customer's first-order-only coupon shows up for another. Explicit `Cache-Control: no-store`.

### 5.2 CHANGED — admin coupon endpoints (additive only)

| Endpoint | Change |
|---|---|
| `POST /admin/coupon` | accepts `visible: boolean` (optional, defaults false) |
| `PUT /admin/coupon/:id` | accepts `visible: boolean` (optional) |
| `GET /admin/coupon` | each row gains `visible: boolean`; new optional filter `?visible=true\|false` |
| `GET /admin/coupon/:id` | detail gains `visible: boolean` |

`code` stays immutable; `usedCount` stays untouchable. Role/permission gates unchanged
(super_admin, as today).

### 5.3 UNCHANGED (stated explicitly)

`POST /cart/coupon/apply`, `DELETE /cart/coupon`, `GET /cart`, `POST /order/place`, the scheduled
order path, every POS coupon endpoint, and every response shape they return. **Not one line of the
apply/claim/checkout path is edited by this plan.**

---

## 6. Step-by-step build order

Each step is one reviewable change. Steps 1–7 are Phase 1, 8–9 Phase 2, 10–11 Phase 3 (see §7.1).

**Backend**

1. **Schema + index.** `haper-backend/packages/shared/models/coupons.schema.js` — add `visible`
   (default `false`) and the `visible_active` index, with the comment from §4.1.
2. **Admin write path.** `haper-backend/packages/admin/src/routes/coupon/controller.js` — add
   `"visible"` to `COUPON_FIELDS`; add `visible: coupon.visible === true` to `decorate()`; add the
   optional `visible` list filter. `validator.js` — `visible: Joi.boolean().optional()` on the create
   and update schemas.
3. **The card builder (pure).** New `haper-backend/packages/shared/utils/coupon-offers.utils.js`:
   `formatDiscountSummary(coupon)` and `buildOfferCard({coupon, verdict, subtotal})`. Pure, no DB,
   no Express — this is where the unit tests earn their keep. Export from
   `packages/shared/utils/index.js`.
4. **Repository read.** `haper-backend/packages/shared/repositories/coupon.repository.js` — add
   `listVisibleForStore({ storeId, now, limit = 50 })` with the §3.2 step-1 filter. Data layer only;
   no verdicts here.
5. **The endpoint.** New `haper-backend/packages/user/src/routes/coupon/{router,controller,validator}.js`
   implementing §3.2, wired into `packages/user/src/routes/index.js` as `router.use("/coupon", couponRoutes)`.
   The controller calls `validateCouponForCart` — it must not contain a single hand-written
   eligibility condition.
6. **Backend tests.** Unit for step 3; integration (in-memory Mongo, run from the package dir) for
   the endpoint, including the hidden-coupon leak test (§8).
7. **Admin UI.** `haper-admin/src/api/coupons.ts` (add `visible` to `Coupon` /
   `CouponCreateInput`), `CouponFormModal.tsx` (a `Switch` beside the existing Enabled switch:
   "Visible in the app's Offers screen" / helper text "Hidden coupons still work when the customer
   types the code."), `CouponsPage.tsx` (a Hidden/Visible badge in the row). Update
   `CouponFormModal.test.tsx` / `CouponsPage.test.tsx`.

**Clients**

8. **Android — data + VM.** `data/api/ApiService.kt` (`@GET("user/coupon/available")`), a
   `data/model/CouponModels.kt` entry with **nullable** fields, and `ui/screens/offers/OffersViewModel.kt`.
9. **Android — screen + nav.** `ui/screens/offers/OffersScreen.kt`, `composable("offers")` in
   `MainActivity.kt`, the "View offers" affordance in `CartScreen.kt`, and the profile menu row.
   Tap-to-apply reuses `CartViewModel.applyCoupon`-style plumbing (§3.4). Verify with
   `./gradlew assembleDebug`.
10. **Web.** `services/api.ts` (`couponApi.available()`), `pages/Offers.tsx`, `/offers` route in
    `App.tsx`, entry points in `Checkout.tsx` + profile menu. Verify with `tsc --noEmit` +
    `vite build` (haper-web has no real eslint gate).
11. **iOS.** `Utils/NetworkManager.swift` endpoint, `Models/` decodable with optionals **and explicit
    `CodingKeys`**, `ViewModels/OffersViewModel.swift`, `Views/OffersView.swift`, entry points in
    `CartView`/`CheckoutView` + `ProfileView`.

**Docs**

12. `haper-misc/test-coupon-codes.md` — new "Offers screen / visible vs hidden" section with ✅/❌
    steps and the edge cases from §7. Required in the same session as the code (project rule).

---

## 7. Edge cases, risks, backward compatibility

### 7.1 Recommended phasing — three phases, same shape as the original rollout

- **Phase 1 (backend + admin, ships together):** steps 1–7. Fully inert on its own — the endpoint
  exists, every coupon is hidden, no client calls it. Marketing can start flipping codes to Visible
  and see nothing break. This is the safe place to stop and think.
- **Phase 2 (Android):** steps 8–9. Largest user base, and the platform where the original coupon UI
  landed first.
- **Phase 3 (web + iOS):** steps 10–11. iOS ships on the user's own pipeline schedule.

Ship-all-at-once is rejected: three clients changing on the same day multiplies the number of things
that can be wrong at the moment the first Visible coupon goes live, and iOS release timing is not
ours to control anyway. *(Confirm — Q4.)*

### 7.2 The one real risk: a hidden coupon leaking

There is exactly one filter (`visible: true`) standing between a partner's secret code and every
customer. Mitigations, all cheap:

- The Mongo filter is `visible: true` (positive match), not `visible: { $ne: true }` or a
  post-fetch `!coupon.hidden` — a missing field can never pass.
- The response is built from an explicit field list, so no code path can spread an unexpected
  document into the payload.
- A **mandatory** integration test seeds a hidden coupon that is perfectly eligible for the test
  customer and asserts it is absent from the response (§8).
- The endpoint has no `code`/`q` parameter of any kind. It cannot be turned into an oracle for
  probing whether a specific hidden code exists.

### 7.3 Other edge cases

| Case | Behaviour |
|---|---|
| Cart empty | `subtotal = 0`. Coupons with `minOrderValue > 0` show with `shortBy = min`. Tap = copy, not apply (§3.4). |
| Coupon exhausts between list and tap | The apply endpoint refuses with its normal message; the client shows it and refreshes the list. Expected, not a bug — the atomic claim remains the only authority. |
| Per-customer count is racy | `countLiveForCustomer` is advisory (the repo says so in its own comment). Worst case: a customer sees a coupon they cannot use and is told why on tap. Never the reverse — it can only over-hide, never over-promise. |
| Advisory read throws | Fail **open on the read, closed on the coupon**: log and drop that one coupon from the list rather than 500 the whole screen. A missing card is a smaller harm than a broken screen. |
| Kill switch on | Empty list, automatically (§3.2). |
| No `x-store-id` | The existing middleware 400s with the existing message. Clients already handle this everywhere else. |
| N candidates × 1 count query | Bounded: max 50 candidates, and only those with a `perCustomerLimit` are counted. Realistically <10 queries on a tens-of-documents collection. If it ever grows, the fix is one `$group` aggregate — noted, not built. |
| Old app + new backend | Never calls the endpoint. Nothing changes. |
| New app + old backend | 404 → the client shows the empty state (never a crash). |
| `.lean()` skips defaults | Handled twice: the customer query is a positive match on `true`; the admin `decorate()` coerces with `=== true`. |

### 7.4 Backward compatibility — every existing behaviour, and why it keeps working

| Existing behaviour | Why it is unchanged |
|---|---|
| Typing a code on cart/checkout | `POST /cart/coupon/apply` and `resolveForCart` are not edited. `visible` is never consulted on the apply path — a hidden code applies exactly as before. |
| Hidden codes at checkout | Both checkout paths read the coupon by code; the new field is inert there. |
| POS coupon on a walk-in sale | Admin package, separate path, untouched. |
| Redemption ledger / caps / claim / release / sweeper | Not edited. This feature never claims. |
| Wrong-attempt abuse counter | Only incremented for codes that do not exist. Listing does not touch it; tap-to-apply sends a code that exists. |
| Automatic discount engine + the coupon-overrides-auto rule | `GET /cart` pricing is not edited. |
| Admin coupon list/create/edit/toggle/delete | Additive optional field only. An admin client that never sends `visible` gets `false` on create and no change on edit. |
| Existing coupons in prod | Stay hidden until an admin says otherwise (§3.1). |
| `GET /cart`, `POST /order/place` response shapes | No new or removed keys. |

### 7.5 Rollback

Three independent levers, in increasing order of blast radius:

1. **Per coupon:** flip `visible` off in the admin — the coupon disappears from every Offers screen
   within one refresh. No deploy.
2. **Whole feature, data-side:** `updateMany({}, {$set:{visible:false}})` — every Offers screen goes
   to its empty state; typing codes is unaffected.
3. **Whole feature, code-side:** revert the router line in `packages/user/src/routes/index.js` → the
   endpoint 404s → clients show the empty state.

Nothing here is hard to reverse. The only genuinely irreversible act in the whole plan is
**publishing a code that was meant to be secret** (§7.2) — which is why the default is hidden.

---

## 8. Test strategy

**Unit (pure, no DB)** — `coupon-offers.utils.js`:
- `formatDiscountSummary`: PERCENT capped ("20% off, up to ₹150"), PERCENT uncapped legacy doc,
  FLAT ("₹50 off"), FLAT with a cap, unknown type (must not throw).
- `buildOfferCard`: eligible card has `shortBy: 0` / `message: null`; below-minimum card has the
  right `shortBy` to 2dp and the right sentence; every key present even on the sparsest coupon
  (the Gson always-present-keys rule).
- Sort comparator determinism, including ties.

**Integration (in-memory Mongo only, run from the package dir)** — the endpoint:
1. **The leak test (mandatory):** a `visible:false` coupon that is otherwise perfectly eligible for
   the test customer is absent from the response.
2. A `visible:true` eligible coupon is present with the expected card fields.
3. Expired / not-yet-started / wrong-store / disabled coupons are all absent.
4. `firstOrderOnly` coupon: present for a brand-new customer, absent once they have a real order —
   and the first-order lookup runs **once** per request, not per coupon.
5. Below-minimum coupon: present, `eligibleNow:false`, correct `shortBy`.
6. Total cap reached (`usedCount >= totalLimit`) → absent. Per-customer limit spent → absent.
7. `COUPONS_KILL_SWITCH=true` → empty list.
8. No token → 401. No `x-store-id` → 400.
9. Admin create/edit round-trips `visible`; a coupon created without `visible` reads back `false`.
10. **Regression guard:** applying a hidden code through `POST /cart/coupon/apply` still succeeds
    after the schema change.

**Admin FE (Vitest)** — the toggle renders, defaults to Hidden on create, reflects the saved value
on edit, and is included in the submitted payload. "Green" = still exactly the 5 known-failing
OrderDetailsModal tests, not zero.

**Manual E2E on dev before each phase ships** — walk the ✅/❌ steps in
`haper-misc/test-coupon-codes.md`, with one visible and one hidden coupon live at the same time.

**Clients** — Android `./gradlew assembleDebug`; web `tsc --noEmit` + `vite build`; iOS build only
(`xcodebuild test` is currently broken for unrelated reasons, and the pipeline is user-triggered).

---

## 9. Open questions (blocking — please answer before build starts)

1. **Default for existing coupons — confirm `visible: false` (hidden).** Every coupon in the
   collection today stays invisible until an admin turns it on. The alternative (default visible) is
   one deploy away from publishing a code that was only ever meant for 40 people, and a published
   code cannot be un-published. Recommend **hidden**.
2. **Near-miss coupons — show with "Add ₹120 more", or hide entirely?** Recommend **show**: a
   customer one item away from a discount is the most valuable person to show it to, and hiding it
   can leave the screen empty for exactly the customer we want to convert.
3. **Empty-cart tap behaviour.** Recommend: card action becomes **Copy code** (apply is impossible —
   the endpoint requires a non-empty cart). Alternative: tap navigates to Home with a "we'll apply
   it at checkout" note, which needs client-side pending-coupon state we do not have today.
4. **Phasing — confirm backend+admin → Android → web+iOS.** Recommend as stated in §7.1.
5. **Screen name and entry point.** Recommend **"Offers"**, reached from the cart/checkout coupon
   block plus a Profile menu row, with **no new bottom tab**. Say the word if you want it in the tab
   bar or on the Home screen instead — that changes the client work in phases 2–3, not the backend.

---

## 10. Fleet routing (after approval)

| Specialist | Owns |
|---|---|
| **aabha-dba** | §4.2 index review + confirming the `.lean()`/default-missing-field behaviour on the real collection |
| **sumit-backend** | Steps 1–6 (schema, admin write path, card builder, repository read, endpoint, backend tests) |
| **tanmoy-web** | Step 7 (admin toggle + badge) and step 10 (haper-web Offers page) |
| **chanchal-designer** | Offers card + empty state + entry-point affordance spec, all three clients (§3.5 is the functional shape only) |
| **siddhart-android** | Steps 8–9 |
| **setu-ios** | Step 11 |
| **santosh-tester** | §8, with the hidden-coupon leak test as the gate |
| **mayank-reviewer + navjot-security** | Review — not money-touching, but it is a disclosure boundary |
| **priyanka-docs** | Step 12 (`haper-misc/test-coupon-codes.md`) |
| **kiran-git** | Commit direct to `dev`, staged explicitly by path. `main` stays off-limits; the prod deploy is the user's manual act. |

*Not involved:* hemant-payments (no money path is edited), stas-realtime, rohit-ai, deepanshu-data.

---

**End of plan. Not approved for implementation until the user answers Q1–Q5.**
