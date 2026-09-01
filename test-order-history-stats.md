# Test: order-history stat tiles (spent / saved / orders, last 30 days)

**Area:** Backend + Android.
- Backend: `packages/shared/repositories/order.repository.js` (`getHistoryStats`,
  `NOT_SPENT_STATUSES`), `packages/user/src/routes/order/controller.js`
  (`getHistory`, `ORDER_STATS_WINDOW_DAYS`).
- Android: `data/model/OrderModels.kt` (`OrderHistoryStats`, `OrderListResponseData.stats`),
  `ui/screens/orders/OrderViewModel.kt` (`historyStats`),
  `ui/screens/orders/OrdersScreen.kt` (`OrderStatsRow`, header subtitle).

**PR/deploy:** backend **first**. Until it is deployed the app hides the tiles
entirely (see "Old backend" below), so the app build is safe to ship in either
order — but the tiles only appear once the API sends `data.stats`.

## What changed
The redesigned orders screen puts three tiles above the list — SPENT, SAVED,
ORDERS — framed as "the last 30 days". They are computed **server-side**, in a
new `$group` aggregate on `GET /user/order/history`, and returned as
`data.stats`.

They are not summed on the client because the list is paginated: adding up the
loaded page would show a figure that climbs as the customer scrolls, and would
disagree with the header count.

`spent` is deliberately narrower than "sum of every order":
- orders where **no money changed hands** are excluded — `CANCELED`,
  `ADMIN_CANCELED`, `FAILED`, `UN_DELIVERED`, `PAYMENT_INITIATED`, plus the
  statuses already hidden from the history list;
- **refunds are subtracted** (`price - refundedAmount`), floored at zero so a
  goodwill refund larger than its own order cannot eat into another order's
  contribution.

`saved` sums `discountTotal`, which is the order's whole discount — the coupon
and automatic-discount engines are mutually exclusive on the backend, so it is
never double-counted. It does **not** include per-item MRP-vs-selling-price
markdowns; those are a catalog markdown, not an order-level discount.

## Steps

### Backend
- ✅ `cd packages/user && NODE_ENV=test npx jest __tests__/order.test.js` — 68 pass,
  including six new cases under `GET /user/order/history stats`:
  zeroed window with no orders; sums price and discountTotal; excludes
  cancelled/failed/unpaid; subtracts refunds and never goes negative; ignores
  orders older than 30 days; counts only the requesting customer's orders.
- ✅ **The window is real, not assumed.** The "older than 30 days" case backdates
  `createdAt` through `OrderModel.collection.updateOne` — a Mongoose
  model-level update silently drops `createdAt` (it is immutable), so an
  earlier version of that test passed against an order that was never actually
  backdated. It now asserts the stored date before calling the endpoint.
- ✅ `data.stats` shape is `{ windowDays, orders, spent, saved }`, both money
  fields rounded to 2 dp.

### Android
- ✅ Orders tab → three tiles above the list. SAVED is the amber one.
- ✅ The header subtitle reads "N orders in the last 30 days" and **N matches the
  ORDERS tile** — both come from the same server roll-up.
- ✅ Place an order, then cancel it → SPENT does not move.
- ✅ An order with a coupon shows `Saved ₹X` on its own card, and X is included
  in the SAVED tile. Cross-check against the order-detail bill: the card chip
  and the detail page's `Coupon CODE −₹X` row are the same number.
- ✅ Scroll to load more pages → the tiles do **not** change. They describe the
  window, not what has been loaded.

### Old backend / degradation
- ✅ **App build against a backend without this change**: `data.stats` is absent,
  Gson decodes `stats` to null, the tiles do not render, and the subtitle falls
  back to the all-time "N orders". Verified on dev before the backend deploy —
  list renders normally, no crash.

## Edge cases
- **Refund larger than the order** (goodwill credit) contributes 0, not a
  negative — asserted in the tests.
- **Customer with no orders in the window** but orders older than it: the
  aggregate returns no rows and the endpoint sends zeros; the app hides the row
  (`stats.orders <= 0`) rather than showing three zeroes.
- **Orders hidden from the list** (`PAYMENT_SUCCESS`, `PAYMENT_FAILED`,
  `PAYMENT_CANCELLED`, `DELETED`) are excluded from the stats too, so the tiles
  and the list always describe the same set.
- The header's all-time `total` and the tiles' windowed count differ on purpose.

## Not covered
- **No index was added.** The aggregate matches `{ userId, createdAt, status }`
  and rides the existing `{ userId: 1, status: 1 }` index; the date filter is
  then applied within one customer's orders, which is a small set by
  definition. Revisit if a customer ever accumulates thousands of orders.
- **Not exposed anywhere else.** Admin, web and the rider app do not call
  `/user/order/history`, so nothing else reads `data.stats`.
- **Per-item markdowns are not in SAVED**, deliberately — see above.
