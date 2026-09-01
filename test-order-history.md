# Customer order history feed — Test Guide

Covers the new **customer-facing** `GET /user/order/history` endpoint — a single combined
feed of a customer's ACTIVE + PAST orders, latest-first, paginated. Against **dev**
(`dapi.haper.in`). Each step says **what to do** and **what to expect** (✅ good / ❌ should
be blocked).

> **Android is now wired up** (see §6) — the Orders tab consumes this endpoint and its
> Active/Past tab switcher is gone. iOS and web still call the old
> `GET /user/order?status=ACTIVE|PAST`, which is unchanged and still served.

---

## 0. Prerequisites
- Backend on **dev**, deployed with the `GET /user/order/history` endpoint
  (`packages/user/src/routes/order/{router,validator,controller}.js` +
  `OrderRepository.getHistoryPaginated`).
- A logged-in customer's auth token + a store's `x-store-id` header (same auth as every other
  `/user/order/*` route).
- A test user with a mix of orders across several statuses (some active, some finished, some
  hidden — see §2).

---

## 1. Combined active + past feed, sorted latest-first
1. As a customer with at least one **active** order (e.g. `OUT_FOR_DELIVERY`) and at least one
   **past/finished** order (e.g. `CLOSED`), call `GET /user/order/history?page=1`.
   ✅ Returns **200** with both orders in **one** list — not split into separate active/past
   arrays.
   ✅ The newer order appears **before** the older one, regardless of which bucket
   (active/past) each belongs to.

## 2. Hidden statuses are excluded
Orders that represent an abandoned/failed checkout are not real order history:
`DELETED`, `PAYMENT_FAILED`, `PAYMENT_CANCELLED`, `PAYMENT_SUCCESS` (a payment that
hasn't yet turned into a placed order).
1. Create one order in each of the four hidden statuses, plus one normal `OPEN` order, for the
   same customer.
   ✅ The history response contains the `OPEN` order.
   ❌ None of the four hidden-status orders appear in the response, on any page.

## 3. Pagination — 10 per page, `hasMore` flips at the boundary
1. Create **11** orders for one customer (any non-hidden status), call
   `GET /user/order/history?page=1`.
   ✅ Returns exactly **10** orders, `total: 11`, `hasMore: true`.
2. Call `GET /user/order/history?page=2`.
   ✅ Returns the remaining **1** order (the oldest of the 11), `total: 11`, `hasMore: false`.
   ✅ No order appears on both pages, and none is skipped — page 1 + page 2 together account
   for all 11.

## 4. Cross-user isolation
1. Two different customers each place an order.
   ✅ Customer A's `GET /user/order/history` never contains customer B's order, and vice versa.

## 5. `page` query param — edge cases
- ✅ **No `page` at all** (bare `GET /user/order/history`) → **200**, defaults to page 1's
  results. (Previously this incorrectly **403'd** with `"page" is required"` because the
  validator marked `page` both `.default(1)` and `.required()` — Joi's `.required()` wins, so
  the default could never fire. Fixed by making `page` genuinely optional.)
- ❌ `page=0` → **403** (validator rejection), not a 200 with an empty/broken result.
- ❌ `page=-1` → **403** (validator rejection). Previously this reached Mongo directly with a
  negative `skip` and leaked the driver's raw internal error message
  (`"BSON field 'skip' value must be >= 0..."`) straight to the client — a storage-engine
  detail that should never surface to a customer-facing API. Now rejected at the validator
  before it ever reaches the DB layer.
- ❌ `page=1.5` (or any non-integer) → **403**, instead of silently producing a half-shifted,
  overlapping page window.
- ✅ Missing/invalid `x-store-id` or no auth token still behaves exactly like every other
  `/user/order/*` route (**401** with no token).

## 6. Android client — the Orders tab (one flat list)
The Android Orders tab now calls this endpoint instead of the old
`GET /user/order?status=ACTIVE|PAST` pair.

1. Open the app → **Orders** tab.
   ✅ There is **no Active / Past tab switcher** — one continuous list.
   ✅ Active and finished orders are interleaved in **pure date order** (newest first), exactly
      as the server returns them. An older active order does **not** get pulled to the top.
   ✅ Each card carries its own status pill (`Order Placed`, `Delivered`, `Cancelled`, …).
   ✅ The `Track order ›` link shows only on **active** orders; finished/cancelled ones read
      `View details ›`.
2. Check the header subtitle under "Your orders".
   ✅ Reads `{total} orders` using the server's all-time `total` — e.g. `15 orders` even while
      only the first page of 10 is on screen.
   ❌ It must **never** claim a time window ("in the last 30 days") — `total` is all-time.
   ❌ It must never show a count derived from how many rows have loaded so far.
3. Scroll to the bottom of the list.
   ✅ Page 2 loads automatically and appends.
   ✅ Once the server says `hasMore: false`, the trailing spinner disappears and no further
      request is made. (Previously the client guessed "a full page of 10 means there's more",
      which fired one wasted request against an exactly-10-order account.)
4. Pull down to refresh.
   ✅ Refetches `page=1` and resets pagination.
5. Open an order, then press back.
   ✅ Order detail still loads — confirm `GET /user/order/:orderId` is **not** shadowed by the
      new `/history` route (the router registers `/history` first on purpose).
   ✅ Returning to the list refetches page 1.
6. A customer with **no orders at all**.
   ✅ One unified empty state: **"No orders yet"** / "Your first order lands here, with live
      tracking and a one-tap reorder."
   ❌ The old per-tab "No active orders" copy must not appear anywhere.
7. Place an order (checkout) — the success path refetches the list.
   ✅ Returning to Orders shows the new order at the top and `total` incremented by one.

**Backward-compatibility note:** the Android `OrderListResponseData.total` / `.hasMore` are
**nullable**. Against a backend that predates this endpoint's envelope, `total` stays null (the
subtitle simply hides) and `hasMore` falls back to the old page-size heuristic — no crash. This
matters because Gson decodes a missing JSON key to `null`, not to the Kotlin default.

---

### Notes for devs
- Route: `GET /user/order/history` → `packages/user/src/routes/order/router.js` →
  `validator.getOrderHistory` → `controller.getHistory`.
- Repository: `OrderRepository.getHistoryPaginated` in
  `packages/shared/repositories/order.repository.js` — reuses the same
  `HIDDEN_FROM_LIST_STATUSES` exclusion list as the existing `getPaginated` (see
  `test-order-status.md` §7), sorted by `_id: -1` (insertion-order proxy for latest-first,
  matches every other order list in this codebase). Returns `{ orders, total, hasMore }`
  directly — the controller no longer recomputes `hasMore` itself, so there's a single source
  of truth for the pagination boundary.
- Validator: `page` is `Joi.number().integer().min(1).default(1)` (no `.required()`) in
  `packages/user/src/routes/order/validator.js`'s `getOrderHistory`. The validator writes
  Joi's computed value back onto `req.query.page` before calling `next()`, so the controller's
  `page` variable reflects the default when the client sends nothing.
- Covered by `packages/user/__tests__/order-history.test.js`: combined feed sort order, hidden
  status exclusion, pagination boundary + `hasMore`, missing-`page` default, `page=0`/`page=-1`
  rejection, cross-user isolation, and the pre-existing 401-no-token case.
- **Android client**: `ApiService.getOrderHistory(page)`, `OrderViewModel.fetchOrderHistory()`
  (+ `totalOrders`), `OrdersScreen`. The old `ApiService.getOrders(status, page)` binding and
  `OrderViewModel.fetchOrders(status, …)` were **removed** — nothing on Android called them
  once the tab switcher went away. The backend's `GET /user/order?status=` is untouched and
  still used by admin/iOS/web.
- Android coverage: `OrderViewModelTest` (server `hasMore` beats the page-size heuristic,
  `total` exposed and left null when absent, `clearAll` drops it) and `ApiContractTest`
  (`total`/`hasMore` decode, and a response omitting both decodes to null without crashing).
