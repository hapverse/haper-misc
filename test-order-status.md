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
  (COD orders that spent wallet coins also refund now — see §8.)
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

## 7. Undelivered / refunded orders stay in the customer's order history  (vanishing-order bug)
Reported live: order **#HP445512639** disappeared from the customer app after the delivery boy
marked it cancelled. Cause — the app's **Past** tab used a hand-written list of "finished"
statuses (`Closed, Cancelled, Admin Cancelled, Failed`), so any other finished status matched
**neither** the Active nor the Past filter and the order vanished from both tabs. `Undelivered`
and the three `Refund…` statuses were all missing. (Web was unaffected — it asks for `ALL`.)
Past is now the *opposite* of Active, so a new status can never fall through the crack again.

Do this in the **Android/iOS customer app** (the tabs only exist there):
1. Place an order, admin/rider takes it to **Out for Delivery**, then the **delivery boy marks it
   Undelivered / cancels it**.
   ✅ The order appears in the app's **Past / previous orders** tab (before: gone from both tabs).
   ✅ It reads as **Undelivered** to the customer (with the app's existing warning icon) — this is
   the pre-existing, correct client-side rendering; it is **not** relabelled to Cancelled.
   ❌ It must **not** still sit in the **Active** tab.
2. Admin → refund an order (**Refund Initiated / Refund Failed / Refund Success**).
   ✅ The order stays visible in the **Past** tab in every one of those three states.
3. Regression — an in-progress order (**Open / Picking / Packed / Assigned / Processing /
   Out for Delivery**):
   ✅ still shows in **Active**, ❌ must **not** show in **Past**.
4. Regression — an abandoned checkout (**Payment Failed / Payment Cancelled**) and a deleted
   order (**Deleted**):
   ✅ still hidden from **both** tabs — the customer never paid, so it isn't order history.
5. Admin → **Users → a user → order history** uses the same Active/Past filter:
   ✅ an undelivered/refunded order now shows under **Past** there too.

## 8. Admin cancel refunds wallet coins on COD orders too  (real-money bug fix)

Wallet coins are deducted at checkout for **every** payment method, COD included. Example: a
₹100 COD order where the customer paid ₹26 from wallet coins and would hand ₹74 cash to the
rider. If an admin cancels that order, the ₹26 is real customer money already taken.

Before this fix the cancel-refund only ran for prepaid orders (Razorpay / Wallet / Store-pickup
prepaid), so those ₹26 were silently kept — 18 out of 18 admin-cancelled COD+wallet orders on
dev had `refundedAmount: 0`. (A customer-side cancel already refunded correctly — different
code path.)

1. Place a COD order using some wallet coins (e.g. ₹26 of a ₹100 order). Note the customer's
   wallet balance.
2. Admin → **Orders** → that order → status **Admin Cancelled**.
   ✅ Customer's wallet increases by exactly **₹26** (the coins, not the ₹100 order value —
   the cash was never collected).
   ✅ Order shows `refundedAmount: 26` and one `refunds[]` entry; the customer gets the
   "Order cancelled — refund credited 💰 ₹26" push.
   ❌ Must **not** refund the full ₹100 / order price.
3. Plain COD order with **no** wallet coins → **Admin Cancelled**:
   ✅ refund amount **₹0**, wallet untouched, no refund push (unchanged behavior).
4. Prepaid order whose Razorpay payment was **already refunded** by an earlier partial edit,
   but which also spent wallet coins:
   ✅ the wallet portion is still refunded on cancel; the gateway payment is **not** refunded
   a second time.
5. Sub-₹1 wallet amount (e.g. ₹0.50 of coins) → **Admin Cancelled**:
   ✅ cancel succeeds (200), refund amount 0, no wallet credit, no error — refunds are whole
   rupees only.
6. Reopen a cancelled COD+wallet order back to **Open**:
   ✅ the ₹26 clawback is taken back out of the wallet (blocked with a clear message if the
   customer already spent it).
7. **Double-refund prevention.** Customer self-cancels a prepaid order — ₹90 charged on Razorpay
   + ₹10 of wallet coins. The user-cancel path refunds all ₹100 in **one** entry. Now an admin
   marks that same order **Admin Cancelled**:
   ✅ refund amount **₹0**, wallet untouched, no new `refunds[]` entry, `refundedAmount` stays 100.
   ❌ Must **not** credit ₹10 again (the wallet portion was already inside that one ₹100 entry).
8. **Reopen, then cancel again.** Take that same ₹90 + ₹10 order, **Reopen** it (₹100 is clawed
   back out of the wallet, `refundedAmount` resets to 0, the old `refunds[]` row is kept as
   audit history), then **Admin Cancelled** it again:
   ✅ refund amount **₹100** — the full captured + wallet amount goes back.
   ❌ Must **not** refund only ₹10 (that would permanently strand the ₹90 gateway portion the
   customer paid).
9. **Failed-payment order with coins.** A `PAYMENT_FAILED` prepaid order that spent ₹30 of coins
   (Razorpay attempted and failed — a payment id exists but nothing was captured) →
   **Admin Cancelled**:
   ✅ ₹30 refunded (coins only).
   ✅ the refund note carries **no** `(pay <id>)` marker — that marker means "this refund settles
   that gateway capture", and nothing was ever captured here.

Still open (separate follow-ups, **not** in this change): the admin UI shows a plain
"Confirm cancel" with no refund amount for COD+wallet orders; the admin order-**edit**
(item-removal) refund path still skips COD orders that used wallet coins; the delivery app's
`ADMIN_CANCELED` path has no refund logic.

---

## 9. Rider marks **Undelivered** in the delivery app (stock + audit parity)
Until this change, only the *admin* "Undelivered" restored stock. When a **rider** marked the
same status from the delivery app the backend just flipped the status — the goods came back to
the store physically but the app still counted them as sold, so the catalogue quantity was
permanently short.

1. Note the current quantity of every item on an order that is **Out for Delivery**
   (Admin → Inventory). Example: order has 3 × "Aashirvaad Atta 5kg", stock shows 20.
2. In the **delivery app**, open that order → mark **Undelivered** with a reason.
   ✅ Order status becomes **Undelivered** (unchanged behaviour).
   ✅ Stock goes **back up** — "Aashirvaad Atta 5kg" now shows **23**.
   ✅ Admin → order → **Order Activity** shows a new row: status change → Undelivered, actor
   role **rider**, source `delivery_app`, with the rider's reason.
   ❌ **No** refund / wallet credit, even for a prepaid (Razorpay) order — the customer's wallet
   balance, `refundedAmount` and the refunds list must all be unchanged. Money only comes back
   when an admin later moves the order to **Admin Cancelled** (§1–§8). This is deliberate:
   Undelivered is recoverable — dispatch can reassign a rider and retry the same day.
3. **No double restock.** Try to mark the same order Undelivered again from the app.
   ✅ Rejected (invalid transition / state changed) and the stock stays at 23 — not 26.
   ✅ Same if an admin afterwards sets **Admin Cancelled** on that Undelivered order: the admin
   path already skips restock when the previous status was Undelivered.
4. **Scheduled orders**: an order booked into a delivery slot gives its seat back when the rider
   marks it Undelivered (Admin → Scheduled slots shows one more seat free). A normal
   (non-scheduled) order is unaffected and must not error.

---

### Notes for devs
- §9 lives in `markDeliveryStatus` (`packages/delivery/src/routes/order/controller.js`). It mirrors
  the admin path's `restockStatuses` guard: restock only when the order moves INTO
  `[ADMIN_CANCELED, UN_DELIVERED, REFUND_SUCCESS]` from a status not already in that list, and
  `stockRestored: true` is stamped in the SAME status write (the Razorpay `payment.failed`
  webhook gates on that flag). This handler has **no** MongoDB transaction on purpose (write-lock
  conflicts with cron/admin writers); the `{ status: currentStatus }` filter on the status update
  is the single-winner claim, so the compensations after it run at most once. A compensation
  failure is logged and recorded in the audit row's metadata rather than rolled back — the status
  change is already committed and must not be reported as failed to the rider.
- Covered by `packages/delivery/__tests__/order.test.js`
  (`describe("PATCH /delivery/order/mark-status — UN_DELIVERED compensations")`).
- Known gap, **not** in this change: the picker app's own line-level paths write audit rows, but
  no rider-side status change other than `UN_DELIVERED` is audited.
- The push is deferred to post-commit by `queueOrderEvent` (`packages/shared/utils/order-event.utils.js`):
  transactional writes emit only after `commitTransaction`; a rolled-back/aborted attempt drops
  the queued events (so retries never double-send).
- `markOrderAdmin` (`packages/admin/src/routes/order/controller.js`) wraps its transaction in a
  bounded retry loop (fresh session per attempt) and short-circuits when the order is already in
  the requested status.
- Covered by `packages/admin/__tests__/order-close-notification.test.js` (Issue 2 + Issue 5).
- §8 (wallet refund on COD cancel) lives in the same `markOrderAdmin`: the cancel-refund gate is
  `isCancelTransition && Math.floor(cancelRefundAmount) >= 1` — gated on the AMOUNT, never on the
  payment method (`capturedAmount` is naturally 0 without a gateway capture, so a coin-free COD
  order still refunds nothing). The amount itself is simply
  `max(0, capturedAmount + walletUsed − refundedAmount)`: **every** refund-writing path in the
  repo `$inc`s `refundedAmount`, so that one field is already the complete running total of money
  given back. Do **not** reintroduce per-entry note parsing to work out what's still owed — an
  earlier version summed the marker-bearing `refunds[]` entries and both double-refunded the
  wallet portion (§8.7) and stranded the gateway portion after a reopen (§8.8). The
  paymentId-in-note marker is now used for ONE thing only: deciding whether this refund should
  stamp `(pay <id>)`, which additionally requires `capturedAmount > 0` (§8.9).
  Refund tests live in `packages/admin/__tests__/order-refund.test.js`.
- §6 (page-tiles bug) logic lives in `haper-admin/src/utils/orders.ts`
  (`REVENUE_COUNTED_STATUSES`, `FAILED_ORDER_STATUSES`, `computeOrdersPageSummary`) — extracted
  out of `OrdersList.tsx`'s `useMemo` so it's unit-testable without rendering the page. Covered
  by `haper-admin/src/utils/orders.test.ts` (`describe('computeOrdersPageSummary', ...)`), which
  pins the exact reported 8-order fixture.
- §7 (vanishing order) lives in `packages/shared/repositories/order.repository.js`:
  `ACTIVE_LIST_STATUSES` + `HIDDEN_FROM_LIST_STATUSES` above `module.exports`, used by
  `getPaginated` — **PAST is `$nin: [...active, ...hidden]`**, never a second literal list.
  `getPaginated` has a second caller — admin `GET /admin/user/orders`.
  `UN_DELIVERED` is deliberately **not** relabelled by `presentOrderStatus` in
  `packages/user/src/routes/order/controller.js` — Android/iOS have always rendered status code
  `12` natively as "Undelivered", and the status isn't terminal (admin can reassign a rider to
  redeliver). An earlier version of this fix added a `UN_DELIVERED → CANCELED` relabel on the
  false premise that old app builds render unknown status codes as "Failed"; that premise was
  disproved (there is no unknown-status fallback issue) and the relabel was reverted.
