# Admin order-status changes — Test Guide

Covers the **admin panel** order status change (`PATCH /admin/order/mark-status-admin`) and
its two customer-notification guarantees. Against **dev** (`damin.haper.in` / `dapi.haper.in`).
Each step says **what to do** and **what to expect** (✅ good / ❌ should be blocked).

> Companion to `test-inventory.md` (inventory) and `test-picking.md` (picker app). This one is
> about the admin **Orders** screen status dropdown (Open → … → Out for Delivery → Closed).

---

## 0. Prerequisites
- Backend on **dev**, deployed with:
  - **Issue 2** — notify the customer only *after* a status change commits (`b4de034`, merged).
  - **Issue 5** — admin close is idempotent + retries a transient write conflict (this change).
- A test customer with the **customer app installed + push enabled** (to observe notifications).
- One order you can walk through the lifecycle (place a COD order, or use an existing one).

---

## 1. Normal close (happy path)
1. Admin → **Orders** → open an order in **Out for Delivery**.
2. Change status to **Closed**.
   ✅ Status becomes **Closed**; the customer gets **exactly one** "Delivered 🎉 — Your order
   #… has been delivered!" push.
   ✅ An invoice number (`INV-…`) is generated shortly after (post-commit).

## 2. Notification only fires on success  (Issue 2)
The "Delivered" push must **never** go out for a status change that fails/rolls back.
- ✅ On a successful close → one push, sent **after** the DB commit.
- ✅ If the close fails for any reason (see §3) → **no** "Delivered" push at all.

## 3. Order already closed by the rider  (Issue 5 — idempotency)
Simulate a race: the **rider closes the order in the delivery app** (or it's already Closed),
then the admin also clicks **Closed** on the same order.
1. Ensure the order is already **Closed** (rider delivered it, or pick a Closed order).
2. Admin → set status **Closed** again.
   ✅ Returns **200** with the note **"This order was already marked Delivered (it may have
   been closed by the rider)."**
   ❌ **No** second "Delivered" push to the customer (no duplicate).
   ❌ **No** 400 write-conflict error.

## 4. Concurrent close → retry, not a 400  (Issue 5 — write-conflict retry)
Before this fix, closing an order that another process was writing at the same instant threw:
`400 … "Write conflict during plan execution and yielding is disabled."`
- ✅ Now the admin close **retries** automatically (up to 3 attempts) and either **succeeds
  (200, Closed)** or, if the other writer won and already Closed it, returns the **"already
  Delivered"** note from §3.
- ✅ Either way the customer gets **at most one** "Delivered" push — never zero-on-success,
  never a duplicate.
- ❌ You should **no longer** see the raw `Write conflict …` 400 on a normal close.

## 5. Other transitions still work (regression)
Quick sanity that the retry/idempotency wrapper didn't change existing behavior:
- ✅ Out for Delivery → **Undelivered** → stock is restored; status Undelivered.
- ✅ Prepaid order → **Admin Cancelled** → refund credited to wallet (one refund push); a
  second Cancel on the same order returns the **"already Cancelled"** note (no double refund).
- ✅ Cancelled order → **Open** (reopen) → wallet clawback + stock re-deducted as before.

## 6. Orders list page tiles only count live orders  (money-display bug fix)
The admin **Orders → Live tab** shows four/five tiles above the table: **Orders on page**,
**Revenue on page**, **Profit on page** (super admin only), **Ongoing**, **Failed / canceled**.
Previously "Revenue on page"/"Profit on page" summed **every** order on the page regardless of
status — reported via a screenshot where a page of 8 orders (7 cancelled/failed, 1 live ₹166
order) showed **₹1,346 revenue** instead of ₹166.
1. Admin → **Orders** (Live tab), filter/browse to a page mixing live and dead orders (e.g. a
   few Open/Closed orders alongside some Cancelled/Payment Failed/Admin Cancelled ones).
   ✅ **Revenue on page** / **Profit on page** only sum orders whose status is one of:
   `OPEN, PICKING, PACKED, ASSIGNED, PROCESSING, OUT_FOR_DELIVERY, CLOSED, PAYMENT_SUCCESS`.
   ✅ **Failed / canceled** counts orders whose status is one of:
   `CANCELED, FAILED, UN_DELIVERED, ADMIN_CANCELED, PAYMENT_FAILED, PAYMENT_CANCELLED`.
   ❌ A page full of cancelled/failed orders should show **₹0** revenue/profit, not a sum of
   their `totalAmount`.
2. A refunded order (`REFUND_INITIATED` / `REFUND_FAILED` / `REFUND_SUCCESS`) is deliberate:
   ✅ it counts toward **neither** the revenue/profit tiles **nor** "Failed / canceled" — it was
   a real sale but isn't page revenue. (Revisit only if admins ask for a dedicated Refunds tile.)
   ✅ **Orders on page** still counts it (it's still an order on the page).

---

### Notes for devs
- The push is deferred to post-commit by `queueOrderEvent` (`packages/shared/utils/order-event.utils.js`):
  transactional writes emit only after `commitTransaction`; a rolled-back/aborted attempt drops
  the queued events (so retries never double-send).
- `markOrderAdmin` (`packages/admin/src/routes/order/controller.js`) wraps its transaction in a
  bounded retry loop (fresh session per attempt) and short-circuits when the order is already in
  the requested status.
- Covered by `packages/admin/__tests__/order-close-notification.test.js` (Issue 2 + Issue 5).
- §6 (page-tiles bug) logic lives in `haper-admin/src/utils/orders.ts`
  (`REVENUE_COUNTED_STATUSES`, `FAILED_ORDER_STATUSES`, `computeOrdersPageSummary`) — extracted
  out of `OrdersList.tsx`'s `useMemo` so it's unit-testable without rendering the page. Covered
  by `haper-admin/src/utils/orders.test.ts` (`describe('computeOrdersPageSummary', ...)`), which
  pins the exact reported 8-order fixture.
