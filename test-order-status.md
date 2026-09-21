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
   ✅ **Refund credited** (since 2026-09) — for a prepaid order the captured Razorpay amount plus
   any wallet coins spent goes back to the wallet, one `refunds[]` entry, one "Order not
   delivered — refund credited 💰" push. A COD order with no coins refunds ₹0 (unchanged).
   The amount is the same `max(0, capturedAmount + walletUsed − refundedAmount)` formula as the
   admin cancel (§8), so a later **Admin Cancelled** on the same order refunds ₹0 — no double-pay.
3. **No double restock.** Try to mark the same order Undelivered again from the app.
   ✅ Rejected (invalid transition / state changed) and the stock stays at 23 — not 26.
   ✅ Same if an admin afterwards sets **Admin Cancelled** on that Undelivered order: the admin
   path already skips restock when the previous status was Undelivered.
4. **Scheduled orders**: an order booked into a delivery slot gives its seat back when the rider
   marks it Undelivered (Admin → Scheduled slots shows one more seat free). A normal
   (non-scheduled) order is unaffected and must not error.

## 10. A refunded order can't be delivered again  (money-duplication holes)
Once §9 started giving the money back at **Undelivered**, every route back into delivery became a
way for the customer to keep both the refund *and* the goods. Three routes were open; all are now
blocked on the same condition — **money already refunded AND stock already returned**.

1. **Assign rider.** Take an Undelivered order that got a refund (wallet balance went up).
   Admin → order → **Assign rider**.
   ✅ Rejected with "This order was already refunded and its stock returned. Reopen it to OPEN
   first…". Same for the **Reassign** button.
   ✅ Still rejected even if the order has since been moved to some other status — the block is
   on the refund, not on the status.
2. **Partial refunds must stay deliverable** (the important regression). A **live** order where
   the picker marked a line out-of-stock, or an admin removed an item — it has `refundedAmount > 0`
   but was never restocked.
   ✅ Assign / Reassign still work normally. This must not be blocked.
   ✅ An Undelivered **COD** order with no refund also still assigns, exactly as before.
3. **Reject-assignment laundering.** Assign a refunded order to a rider, have the rider reject it
   (which sends it back to OPEN).
   ✅ It can never reach Assigned again — the step-1 block catches it at OPEN too.
4. **Reopen is the one way back.** Admin → **Reopen** the refunded order to OPEN.
   ✅ Wallet credit is clawed back, `refundedAmount` resets to 0, stock is re-deducted — and only
   *then* does Assign rider work again.
5. **Late Razorpay webhook.** An Undelivered order whose `payment.captured` webhook arrives late
   (Razorpay retries for hours), or arrives twice.
   ✅ The order stays **Undelivered** — it must NOT flip back to Open or re-enter picking.
   ✅ If the rider's refund already covered that payment (the `refunds[]` note carries
   `(pay <payment_id>)`), nothing further is paid out.
   ✅ If the capture landed *after* the rider refunded — so only the wallet coins came back at
   the time — the captured amount is now credited too, exactly once. A duplicate webhook adds
   nothing.

## 11. Removing an item from an order the customer never paid for  (real-money bug fix)
Reported live on **HP581915100** (₹2,124, Razorpay): the customer abandoned the payment sheet, the
cron marked it *"Payment abandoned by User. Cancelled by Cron."*, an admin **reopened** it to
deliver as cash-on-delivery — and then removing items from it **credited the customer's wallet**
for the removed lines. The order is "prepaid" by *payment method*, but ₹0 was ever collected.

The edit refund is now capped at money actually collected and not yet given back —
`captured + walletUsed − refundedAmount`, the same `computeRefundOwed` formula as the admin cancel
(§8) and the rider Undelivered refund (§9). Applies to **both** the admin item-edit and the picker
out-of-stock flow (they share one code path).

1. **Unpaid Razorpay order, admin removes an item.** Find/make an order whose payment was
   abandoned (`meta.payment` has only the cron note, no `status: "captured"`), reopened to OPEN.
   Admin → order → **Edit items** → remove a line → Save.
   ✅ 200, response `refundAmount: 0`.
   ✅ Wallet balance **unchanged**, no new row in the customer's wallet history.
   ✅ Order has no `refunds[]` entry, `refundedAmount` stays 0, `hasPartialRefund` stays false.
   ✅ The bill still recomputes — `actualOrderValue` / `price` drop by the removed line, stock is
   returned.
   ❌ Must **not** credit the removed line's value (that was the bug).
2. **Gateway attempt that FAILED.** Same as 1 but `meta.payment` carries a real `id` with
   `status: "failed"`.
   ✅ Still ₹0 credited — a payment id is not a capture.
3. **Unpaid order that spent coins at checkout.** Gross ₹300 = ₹40 wallet coins + ₹260 never
   captured. Remove ₹200 of items.
   ✅ Only **₹40** comes back (the coins really did leave the wallet). Not ₹200.
4. **Fully paid Razorpay order — unchanged.** Captured order, remove a ₹60 line.
   ✅ **₹60** credited, one `refunds[]` entry, `hasPartialRefund: true`, refund push sent —
   exactly as before this fix.
5. **Wallet + card split.** ₹30 coins + ₹170 captured, remove a ₹150 line.
   ✅ **₹150** credited (covered by the ₹200 actually paid).
6. **Pure wallet order** (payment method Wallet, `price` 0, whole gross in `meta.walletUsed`).
   Remove a ₹120 line.
   ✅ **₹120** credited. ❌ Must not refund ₹0 — a wallet order has no gateway capture by design,
   the money is in `walletUsed`.
7. **Store-pickup prepaid, captured.** Remove a ₹90 line. ✅ ₹90 credited (unchanged).
8. **COD.** Remove a line.
   ✅ ₹0, no `refunds[]` entry, no `hasPartialRefund` — but the bill recomputes and the
   customer-facing **change log** (`adjustments[]`, "an item was changed and why") is still
   written on the picker path. Unchanged from before.
9. **Sequential removals past the paid total.** Order shows 3 × ₹50 but only ₹100 was captured.
   Remove one line at a time.
   ✅ ₹50, then ₹50, then **₹0** — total credited ₹100, never more than was collected.
10. **Picker out-of-stock on an unpaid order.** Picker marks a line OOS on an abandoned-payment
    Razorpay order.
    ✅ Line removed, `refundAmount: 0`, wallet untouched, and the customer still sees the
    adjustment in order details.
    ✅ Short pick (picked 3 of 5) on the same order: line reduced, ₹0 credited.
    ✅ OOS on the **last** line cancels the order: status Cancelled, bill zeroed, and the leftover
    delivery/platform fees are **not** credited either (nothing was paid).
    ✅ On a genuinely paid order this same last-line cancel still refunds the leftover fees.
    ✅ **Fractional wallet amounts.** Pure-wallet order, e.g. ₹40 line + ₹0.5 fee paid as
    `walletUsed` 40.5; picker marks the only line OOS → 200, order Cancelled, task completed,
    wallet credited **₹40 once** (whole rupees; the ₹0.5 residue is skipped).
    ❌ Must **not** return 400 "Refund amount must be a positive number" (that bricked the task on
    every retry).
11. **Payment lands late, after an unpaid edit.** Edit an unpaid order (₹0 credited), then let the
    `payment.captured` webhook arrive for the original amount.
    ✅ A further removal now refunds real money — capped at what was captured.

---

## 12. Online payment that lands too late  (webhook hardening — real-money bug fix)
Two holes in the Razorpay `payment.captured` webhook, fixed together (Phase 0 of the
*reopen-as-COD* work — the conversion button itself is covered by `test-order-cod-conversion.md`).

**12A — capture on a LIVE order was silently dropped.** Before this fix, a capture for an order
already at OPEN / PICKING / PACKED / ASSIGNED / PROCESSING / OUT_FOR_DELIVERY / CLOSED matched
neither webhook branch: `meta.payment` was never written, so the admin board kept showing
*"payment pending"* and a later cancel/undelivered refunded **only** the wallet coins — the
customer's card money was never given back.

1. **Pay late on a reopened order.** Razorpay order, abandon the sheet (cron marks it
   *Payment cancelled*), admin **reopens** it to OPEN, then complete the payment from the old
   checkout sheet.
   ✅ Admin order details now shows the payment as **paid** (`meta.payment` recorded).
   ✅ Order status is **unchanged** (still OPEN — no reopen, no new pick task, no push storm).
   ✅ Wallet **unchanged** — this branch records, it never refunds.
   ✅ One `order.payment.capture_recorded` row in **Order Activity**.
   ✅ Cancel that order now → the **full** amount (card + coins) comes back.
2. **Redelivered webhook** (Razorpay retries the same event).
   ✅ Nothing changes, and **no second** Order Activity row.
3. **Normal first payment — unchanged.** Place a Razorpay order and pay normally.
   ✅ Order goes OPEN, coupon confirmed, pick task created, store-admin "New order — paid" push.
   ✅ **No** Order Activity row for it (only the two new branches write one).

**12B — capture after the order was switched to cash.** The customer's order was converted to COD
by an admin, and their online payment lands afterwards. They must never pay twice.

4. **Late capture on a converted order.** Convert an unpaid order (₹800 payable, ₹200 already paid
   in coins) to COD, then let the ₹800 capture arrive.
   ✅ **₹800 credited to the customer's wallet**, exactly once, with a wallet-history row.
   ✅ Order stays **Cash on delivery** and keeps its status — the rider still collects **₹800**
   (`price` never changes).
   ✅ Only the **captured** ₹800 comes back — the ₹200 of coins were genuinely spent and stay spent.
   ✅ `codConversion.lateCaptureAt` / `lateCapturePaymentId` stamped; `meta.payment` recorded.
   ✅ One `order.cod.late_capture_refunded` row in Order Activity, one customer push
   ("We received your ₹800 online payment after this order was switched to cash…"), one store-admin
   push.
   ✅ The order is still **deliverable** — a partial refund on a live order is not an "unclawed
   refund", so assigning a rider still works.
   ❌ Must **not** flip the order back to online / prepaid, and must **not** change the cash amount.
5. **Duplicate delivery of that capture.** ✅ Still one ₹800 credit, one wallet row, one audit row.
6. **Two deliveries at the same instant.** ✅ Still exactly one credit (the de-dupe lives in the
   update filter, not in a read-then-write check).
7. **Converted order that was later cancelled, then the capture arrives.** ✅ Existing
   cancelled-order behaviour — refund to wallet, order not reopened (unchanged by this fix).

**12C — customer self-cancel of a store-pickup prepaid order (under-refund fix).** Store-pickup
prepaid also pays through Razorpay, but the self-cancel used to look only at `paymentMethod ===
Razorpay`, so it gave back the coins and kept the card money.

8. **Cancel a captured store-pickup prepaid order inside the 1-minute window** (₹1,000 basket =
   ₹200 coins + ₹800 card).
   ✅ **₹1,000** credited (card + coins), one refund entry carrying the `(pay …)` marker.
   ❌ Must not credit only ₹200 (that was the bug).
9. **Razorpay / Wallet / COD cancels — unchanged.** Captured Razorpay ⇒ full amount; abandoned
   Razorpay ⇒ coins only and status *Payment cancelled* (so the daily free-gift slot isn't burnt);
   COD ⇒ ₹0 (or just the coins if any were spent).
10. **The 1-minute window is unchanged.** Cancel 5 minutes after placing ⇒ 400 *"Cancellation
    window has expired"*, nothing refunded, order still OPEN.
11. **Captured store-pickup prepaid still sitting at *Payment initiated*** (the webhook was slow) —
    cancel it inside the window.
    ✅ Status **Cancelled** (not *Payment cancelled*): the customer really did pay, so the daily
    free-gift slot is burnt.
    ✅ **₹1,000** back (card + coins).

**12D — the webhook decides on facts that can be one second old (security re-audit).** Everything
above assumed the webhook reads the order correctly and writes before anything else moves. These
drills cover the windows where that is not true. All of them are *timing* cases — to reproduce on
dev, have two people click at once, or use the automated drills in
`packages/user/__tests__/razorpay-capture-hardening.test.js` and
`razorpay-capture-primary-read.test.js`.

12. **Convert to COD and let the payment land in the same second.** (Admin presses *Switch to cash*
    while the customer's UPI app is confirming.)
    ✅ Exactly **one** wallet credit of the captured amount, order stays **Cash on delivery**.
    ❌ Must **not** reopen the order to OPEN, must **not** cut a pick task, must **not** leave the
    capture unrefunded. (Both halves of the fix matter: the order is re-read from the **primary**,
    and every write re-checks the state it decided on.)
13. **Same race on an already-live order** (ASSIGNED, then converted mid-flight).
    ✅ One wallet credit, status untouched.
14. **Cancel-refund and late capture at the same instant.** The self-cancel refunds and stamps
    `(pay …)` while the webhook is mid-flight.
    ✅ Customer gets the money **once** — the webhook's write finds the stamp and credits nothing.
15. **Processing fails mid-flow** (DB blip during the refund).
    ✅ Nothing is credited, and Razorpay is told the delivery **failed** (non-2xx) so it retries.
    ✅ The retry credits exactly once. Look for a `capture.processing_failed` alert row in logs.
16. **An ops person refunded the payment in the Razorpay dashboard first.**
    ✅ The webhook refuses to auto-credit the wallet and raises
    `capture.gateway_refund_present` — otherwise the customer gets the money twice.
17. **Odd capture entities.** Not captured / non-INR / captured amount larger than the order could
    have owed.
    ✅ No wallet credit for the first two (`capture.not_captured`, `capture.foreign_currency`).
    ✅ The third is refunded **in full** (see 12E-33) with a `capture.exceeds_expected` note in the
    logs. ❌ Must **not** be capped — that used to keep the difference.
    ✅ A capture quoting a different gateway order id still settles, but logs
    `capture.order_id_mismatch` for someone to look at.
18. **Customer paid twice for one order** (two different captures).
    ✅ The **first** payment stays recorded; the second is refunded to the wallet and raises
    `capture.second_capture`. A redelivery of the second capture adds nothing.
19. **A very old capture redelivered onto a refunded order** (status *Refund success* / failed /
    deleted).
    ✅ The payment is **recorded** so it is visible, status unchanged, no new pick task, and a
    `capture.unexpected_status` alert. ❌ Must never flip back to OPEN.
20. **Payment failed, customer retries and succeeds.** ✅ Still reopens to OPEN as before.
21. **A goodwill refund note that happens to contain the payment id.** ✅ The refund is skipped
    (we cannot tell it apart from a real settlement) but a `capture.refund_suppressed` alert is
    written — it is never silent. *Follow-up:* store the gateway payment id in a dedicated
    `refunds[].gatewayPaymentId` field so this ambiguity goes away.

**12E — the webhook must survive deliveries it cannot process (security re-audit round 2).**
Background for testers: a capture is answered only *after* it is processed, so anything that
throws answers 500. Razorpay retries a failing webhook for about **24 hours** and then **disables
the endpoint** — which would stop payment confirmation for *every* customer. So "this delivery is
rubbish" must end in a **200 + an alert row**, and only a temporary glitch may answer 500.
Automated drills: `packages/user/__tests__/razorpay-capture-resilience.test.js`.

22. **A payment made outside the app** — a Razorpay *payment link*, a QR code, a charge created in
    the Razorpay dashboard, or another integration on the same merchant account. Razorpay sends
    `payment.captured` for all of them, and they carry no `notes` (or notes of another shape).
    ✅ Webhook answers **200**, one `capture.unroutable` alert row with the payment id, no order
    touched. ❌ Must never 500 (four deliveries like this used to be enough to start the countdown
    to the webhook being switched off).
    Variants that must all behave the same: `notes.orderId` that is not a real id, no `notes` at
    all, `notes` arriving as an empty list, `notes.storeId` that is not a real store id.
23. **A capture whose order id is real but the order is gone** (deleted / wrong environment).
    ✅ **200** and a `capture.order_not_found` alert carrying the payment id and the notes — money
    exists that the system has not accounted for, so it is never a silent shrug.
24. **A permanent processing error** (a bug / bad data — it would fail the same way every time).
    ✅ **200** plus a `capture.processing_failed` alert with `transient: false`. Nothing is
    credited; ops settle it by hand. ❌ Must not ask for a redelivery.
25. **A temporary database glitch** (connection dropped, write conflict).
    ✅ **500** with `capture.processing_failed` and `transient: true`, nothing credited, and the
    gateway's retry then credits **exactly once**.
26. **The same payment keeps failing.** After **5** failed deliveries of one payment id:
    ✅ the 5th is **acked (200)** with a loud `capture.retry_budget_exhausted` alert instead of
    letting one stuck payment take the whole webhook down. Ops must settle that payment manually —
    treat this alert as a page.
27. **Cart cleanup fails after the money moved** (Redis blip). ✅ Still **200**, refund intact —
    housekeeping can never fail a settled payment.
28. **A payment the ops team already refunded in the Razorpay dashboard lands on an unpaid order**
    (status *Payment initiated* / *Payment failed*).
    ✅ The order stays unpaid, `meta.payment` is recorded so the money is visible, a
    `capture.gateway_refund_present` alert is written, and **no pick task is cut**.
    ❌ Must never go OPEN — the goods would ship after the money went back.
    Same for a `status: authorized` (not actually captured) entity → `capture.not_captured`.
29. **Customer paid twice and then the order was cancelled.** ✅ The **first** payment's record is
    kept, the second capture is refunded to the wallet once (redelivery adds nothing),
    `capture.second_capture` alert, and an **Order Activity** row.
    ❌ The first payment's record must never be overwritten — the cancel refund maths reads it.
30. **Every cancelled-order auto-refund now leaves a trail.** ✅ One
    `order.payment.cancelled_capture_refunded` row in **Order Activity** (previously this branch
    wrote nothing, so the wallet moved with no order-side record).
31. **The order keeps changing under the webhook** (repeated admin edits while the capture is
    being processed). ✅ After two attempts the webhook gives up safely with a
    `capture.dispatch_unresolved` alert and **no** money moved.
32. **A capture with no `currency` field.** ✅ Treated as INR as before, but now a
    `capture.currency_missing` alert is written so the assumption is visible.
33. **The late capture is bigger than the cash the order was converted at** (re-audit round 3).
    Repro: an unpaid ₹4,000 online order at *Open*; admin removes items down to ₹1,000 (nothing
    was paid, so no refund); convert it to **cash**; the customer's stale checkout screen finishes
    paying and Razorpay captures the original **₹4,000**.
    ✅ The **whole ₹4,000** goes back to the wallet (one credit, one wallet-history row, one
    *Order Activity* row), the order stays *Cash on delivery* with its status unchanged, and the
    rider still collects ₹1,000 cash. A `capture.exceeds_expected` row is written for ops.
    ❌ Must **not** refund only ₹1,000 — the old cap kept ₹3,000 of the customer's money, because
    the "expected cash" is stamped once at conversion and never updated when the order is edited
    afterwards. A real capture is always returned in full when the order is collected in cash.
    ✅ A duplicate delivery of that webhook still credits only once.

> **Ops note — never refund a late capture manually in the Razorpay dashboard.** The system already
> credits the customer's wallet automatically. A dashboard refund on top of that pays the customer
> twice. If the dashboard refund happened first, the webhook now refuses to credit and logs
> `capture.gateway_refund_present` — check the wallet before doing anything by hand.

---

## 13. Editing a COD order that paid with wallet coins  (double-charge bug fix)
Coins can be redeemed on a **cash** order: checkout stores `price` already **net** of them
(`price = gross − meta.walletUsed`), and that netted number is exactly what the rider collects and
what "Cash to settle" sums. The item edit used to rebuild the bill as `items + delivery + platform`,
which **re-added the coins to the cash demand** — the customer paid for the same rupees twice.

Example: ₹300 basket, ₹40 paid in coins ⇒ ₹260 cash due. Admin removes a ₹200 line. Before the fix
the rider was told to collect **₹100** for ₹100 of goods the customer had already put ₹40 towards
(₹140 paid in total). Now the door amount is **₹60**.

The rule now: on an order that is still collected (COD, store-pickup postpaid, an order converted to
COD), `price` = new bill **minus the coins still applied**; if the new bill falls **below** those
coins, the unusable remainder is refunded to the wallet through the normal refund path (wallet
history row + `refunds[]` + `refundedAmount`). Prepaid orders are untouched.

1. **Partial removal.** COD order, ₹300 of items, ₹40 coins, ₹260 cash due. Remove a ₹200 line.
   ✅ Order details / rider app now show **₹60** to collect.
   ✅ Wallet unchanged, no `refunds[]` entry (the coins are still fully used on the bill).
   ❌ Must **not** show ₹100 (that was the bug).
2. **Delivery / platform fees.** Same, with ₹20 delivery + ₹2 platform: ✅ ₹100 + ₹22 − ₹50 coins =
   **₹72**, and both charges are preserved as billed.
3. **Removal that drops the bill BELOW the coins.** ₹300 basket, ₹40 coins; remove everything except
   a ₹25 item.
   ✅ **₹0** to collect and **₹15 credited back to the wallet** (one refund entry, one wallet-history
   row, `hasPartialRefund: true`).
   ❌ Must not silently keep the ₹15.
4. **Sequential removals.** ₹300 basket with ₹250 in coins (₹50 cash due). Remove ₹100 of items →
   ₹50 back, ₹0 to collect. Remove another ₹100 → ₹100 back.
   ✅ Total credited **₹150**, never more than the ₹250 of coins actually spent.
5. **Same edit submitted twice / two admins at once.** ✅ One refund entry only, wallet credited once.
6. **Fractional coins.** ₹40.5 in coins, bill edited down to ₹40. ✅ 200 OK, ₹0 to collect, the ₹0.50
   residue is **not** credited (whole-rupee refunds only) and the edit does **not** fail.
7. **Order converted to COD that had spent coins.** ✅ Same netting — ₹300 → remove ₹200 → **₹60**
   cash due. (Conversion itself: `test-order-cod-conversion.md`.)
8. **COD order with NO coins — unchanged.** ✅ `price` = items + charges, exactly as before.
9. **Picker paths.** Same order shapes, picker app:
   ✅ Line marked **out of stock** → cash due drops to the netted amount (₹100 + ₹1 fee − ₹40 =
   **₹61**), adjustment still shown to the customer.
   ✅ **Short pick** that takes the bill below the coins → surplus credited, refund push sent
   ("₹… added to your wallet"), ₹0 to collect.
   ✅ **Last line** out of stock → order Cancelled and **every remaining coin** comes back (e.g. ₹71
   of coins ⇒ ₹71 credited), not just the fees.
   ❌ Must **not** cancel a coin-paying COD order with the coins kept by the store (the cancel used
   to refund only *prepaid-method* orders, and only up to `price` — which the netting had already
   driven to ₹0).
10. **Prepaid orders are byte-identical.** Captured Razorpay (incl. wallet+card split), pure Wallet,
    store-pickup prepaid: same refund amounts as §11, and `price` after an edit is still the
    items + charges total (nothing is collected at the door).
11. **Invoice.** Print the invoice for an edited coin-paying order.
    ✅ Item Total + fees − "Wallet Redeemed" = the **Grand Total** shown — on *every* order,
    however many times it was edited. The wallet line is now **derived from those two totals**
    (`gross − price`) on cash-collected orders instead of being read from `meta.walletUsed`.
    ✅ When the bill dropped below the coins, the wallet line shows only the coins the bill could
    absorb (the rest came back as a refund).
    ✅ **Edit down, then back up.** ₹300 basket, ₹40 coins (₹260 due) → edit down to ₹20 (₹20
    surplus refunded, ₹0 to collect) → add the items back to ₹300. Cash due is **₹280** (only the
    ₹20 of coins that were never returned still apply) and the invoice prints a **₹20** wallet
    line, so 300 − 20 = 280 matches the Grand Total.
    ❌ Must not print **₹40** there — that invoice claims a ₹260 total while the Grand Total says
    ₹280, i.e. a tax invoice that does not add up.
    ✅ Unedited orders (COD without coins, COD with coins, prepaid, pure Wallet) print exactly the
    numbers they printed before.
    - *Sub-rupee coin residue (policy, nothing to test):* refunds are whole rupees only, so a
      residue **under ₹1** (e.g. ₹0.50 of coins left on a bill edited to ₹0) stays with the store
      and is unrecoverable once `price` has hit 0 — the same floor convention every refund path
      uses. Accepted deliberately; a ₹0 refund attempt would otherwise abort the whole edit.
12. **Cash reconciliation.** Deliver an edited coin-paying COD order, then check
    rider → *Cash summary* / admin → delivery boy → *Cash to settle*.
    ✅ It counts the **netted** amount (it sums `order.price` for CLOSED COD orders), i.e. the cash
    the rider really took. No change was needed there — it was only ever wrong because `price` was.
13. **Payment gateway unreachable at checkout, with coins spent** (order-create call fails after
    the coins are already debited). Place a ₹400 online order paying ₹40 in coins while Razorpay
    is down.
    ✅ The customer gets the **₹40 back once** (one wallet-history row), stock goes back, the order
    lands on *Payment cancelled*, and the order itself is rewound to **never paid**: no coins on
    it and the bill back at the **full ₹400**.
    ✅ An admin then converting that order to **cash** sends the rider for the full **₹400**, and a
    later item edit nets **nothing** off — there is nothing paid to net.
    ❌ Before the fix the order still claimed the ₹40 as paid while the customer held the coins:
    the rider was told to collect ₹40 less, and an edit that took the bill under ₹40 "refunded"
    the same ₹40 a second time.
    ✅ Works when the customer redeemed their **whole** balance (the old code refused with an
    "insufficient balance" error there, leaving the order stuck and the coins gone).
    ✅ Same for a **scheduled** booking, which additionally frees the slot seat.
14. **Picker's typed out-of-stock reason never becomes a refund note.** On a coin-paying COD order,
    mark a line out of stock with a note containing a payment id (e.g. "customer already paid
    pay_XXXXXXXX at the door") so that the bill falls below the coins.
    ✅ The wallet credit's note is the fixed system text, the typed words are still kept on the
    pick task, the customer-facing change log and the audit row.
    ❌ The typed text must never land in `refunds[].note` — that field doubles as the late-capture
    idempotency marker (§12), so a typed payment id could suppress a genuine refund of that
    payment. (Prepaid refunds still carry the picker's reason, as before.)

---

### Notes for devs
- §12 lives in `packages/user/src/routes/razorpay/controller.js`. The `payment.captured` handler now
  has four branches, in this order: **(1)** order in `CANCELLED_STATES` → existing auto-refund
  (untouched); **(2)** order has a `codConversion.convertedAt` → late-capture refund + stamp;
  **(3)** status NOT in `successStatuses` → existing reopen-to-OPEN path (untouched); **(4)**
  anything else (a live, never-converted order) → record `meta.payment` only. Branch 1 stays first
  on purpose: a converted-then-cancelled order is a cancelled order first.
- The late-capture branch writes ONE `findOneAndUpdate` inside `withTransaction`
  (`$push refunds` + `$inc refundedAmount` + `$set meta.payment`/`codConversion.lateCapture*`), and
  its **filter carries the `(pay <id>)` marker check**. A read-then-write check would let two
  simultaneous deliveries both refund; here the loser matches nothing, throws, and its wallet credit
  rolls back with the transaction. `strict: false` on that update is deliberate — the dotted
  `codConversion.*` paths must write even before the schema field lands.
- `meta.payment` is always written as a **dotted** `$set` so `meta.id` / `meta.walletUsed` survive.
- §12C: the self-cancel no longer re-implements the refund math — it calls
  `refundUtils.computeRefundOwed(order)`, the same helper as admin cancel and the rider
  UN_DELIVERED path. `neverPaid` (which decides `PAYMENT_CANCELLED` vs `CANCELED`, i.e. whether the
  daily gift slot is burnt) now keys on `capturedAmount === 0` instead of the payment method, so a
  genuinely-captured store-pickup order writes `CANCELED` like any other paid order.
- Covered by `packages/user/__tests__/razorpay-late-capture.test.js` (8 cases, incl. the forced
  concurrent-delivery race) and `packages/user/__tests__/order-cancel-store-pickup-refund.test.js`
  (7 cases). Regression proof: `packages/user/__tests__/razorpay.test.js`,
  `order-cancel-reason.test.js`, `order.test.js`, `packages/cron/__tests__/payment-initiated-orders.test.js`.
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
- §10's blocking condition is ONE shared predicate, `refundUtils.hasUnclawedRefund(order)` =
  `refundedAmount > 0 && stockRestored === true` (`packages/shared/utils/refund.utils.js`), with a
  Mongo-filter twin `notUnclawedRefundFilter()` spread into the atomic update predicate of
  `assignOrder` / `reassignDeliveryBoy` so it can't be lost to a read-then-write race. Both halves
  are load-bearing: dropping `stockRestored` would block the everyday partial-OOS order (§10.2),
  and keying on `status === UN_DELIVERED` instead would let any other path launder the order out
  of the block (§10.3). Reopen is the only thing that resets both fields.
- §10.5: `UN_DELIVERED` is in `CANCELLED_STATES` in `packages/user/src/routes/razorpay/controller.js`,
  which routes a late capture into the refund-to-wallet branch instead of the reopen branch. That
  branch's de-dupe is the `(pay <id>)` marker, so it interlocks with the rider/admin refunds.
- The rider refund computes off `item` (the document returned by the atomic claim, read from the
  primary), never off `currentOrder` — that read is `secondaryPreferred` and pre-claim, so a
  refund landing moments earlier could be missing from it and the customer would be over-refunded.
  The non-money compensations (restock lines, audit, push) deliberately still use `currentOrder`.
  Covered by `packages/delivery/__tests__/order-undelivered-refund.test.js` and
  `packages/admin/__tests__/order-undelivered-refund-handoff.test.js`.
- §11 lives in `applyItemEdit` (`packages/shared/utils/order-edit.utils.js`) — the ONE code path
  behind both the admin item edit and the picker OOS/short-pick, so they can't drift. `isPrepaid`
  (payment METHOD) still decides *whether a refund is attempted*; the new `refundCeiling =
  refundUtils.computeRefundOwed(order).amount` decides *how much*, via one
  `Math.min(refundAmount, refundCeiling)` after the 2dp rounding. The ceiling is read from the
  **pre-edit** order doc, so sequential removals each see the running `refundedAmount` and can
  never sum past what was collected. `cancelEmptiedOrder` in
  `packages/picking/src/routes/task/controller.js` applies the same cap to the leftover-fees
  refund. Do **not** replace the method gate with the amount gate outright — `prepaid` also
  controls the admin-side "reduce only / refund reason required" validation, which must keep
  applying to a reopened-but-unpaid prepaid order.
- Known ≤₹1 edge (accepted): `computeRefundOwed` floors the captured paise→rupees, so on an order
  with a fractional `meta.walletUsed` the ceiling can sit up to ₹1 under the true paid total. The
  cap only ever reduces a refund, and `refundToWallet` floors to whole rupees anyway.
- §13.13 lives in the two checkout compensation blocks of
  `packages/user/src/routes/order/controller.js` (`placeOrder` and its scheduled twin). The coin
  return, its ledger row and the status write now share **one transaction** with the restock: a
  crash between "coins returned" and "order marked cancelled" used to leave the order at
  *Payment initiated* with the coins already back, which the abandonment cron then refunded a
  second time. The coins go back through `WalletRepository.upsertWallet` (coins-only — the exact
  inverse of the checkout debit), **not** `deductWallet`, which only writes when the wallet still
  holds the amount and so threw for a customer who had redeemed their whole balance.
  The order's coin fields (`meta.walletUsed` → 0, `price` → gross) are reset in that same `$set`.
  That is deliberately a DIFFERENT shape from the abandonment cron
  (`packages/cron/src/jobs/payment-initiated-orders.js`), which records the same coin return as a
  `refunds[]` entry + `refundedAmount` and leaves `meta.walletUsed`/`price` alone: there the coins
  are only re-taken if an admin reopens the order (reopen claws a refund back), whereas here the
  order is rewound to "never paid" so no later clawback — which can fail with `WALLET_SHORT` and
  strand the COD conversion — is needed at all. Either way the derived live credit
  (`computeRefundOwed().amount`) is what every money path reads; both shapes drive it to the right
  number. Covered by `packages/user/__tests__/order-gateway-failure-rollback.test.js`.
- §13.11's wallet line is `invoiceUtils.walletLineAmount(order)`
  (`packages/shared/utils/invoice.utils.js`): `gross − price` for cash-collected orders (it
  reconciles with the Grand Total by construction, for any sequence of edits), and the old
  `min(walletUsed, gross)` clamp for prepaid orders, whose `price` was never netted. An edited
  PREPAID order still prints `−walletUsed` against a gross total — pre-existing, unchanged here.
- §13.14: `applyItemEdit` forces its own fixed note on the coin-surplus credit and never forwards
  the caller's, and the picker call site (`markOutOfStock`) additionally only passes `refundNote`
  for a prepaid order — the same gate the admin edit endpoint already applies. Residual risk worth
  a separate look: the marker is still a **substring search over free text**
  (`refunds.some(r => r.note.includes(paymentId))`), so any path that can get admin/picker text
  into a prepaid order's refund note is one typo away from suppressing a real refund. A structured
  `refunds[].paymentId` field would close it for good.
- Covered by `packages/admin/__tests__/order-edit-unpaid-refund.test.js` (11 cases) and
  `packages/picking/__tests__/oos-unpaid-order.test.js` (3 cases). `packages/picking/__tests__/testUtils.js`
  `seedOpenOrder` now seeds a `captured` `meta.payment` for prepaid-method fixtures unless the
  caller passes its own `meta` — previously every prepaid picking fixture was implicitly "unpaid".
- §13 is the same `applyItemEdit` as §11. The invariant: **`price` on a cash-collected order is a
  collection instruction, already net of `meta.walletUsed` — never `price − walletUsed` again, and
  never a plain `items + charges` rebuild.** The coins still applied are *derived*, not stored:
  for such an order `refundUtils.computeRefundOwed(order).amount` (`captured` is 0, so it is
  `walletUsed − refundedAmount`) IS the live credit, which is what makes sequential edits and the
  reopen-clawback self-correcting. Hence `creditApplied = prepaid ? 0 : refundCeiling`,
  `price = max(0, gross − creditApplied)` and `surplus = max(0, creditApplied − gross)` refunded
  through the one `refundToWallet` call. Prepaid stays at `creditApplied = 0` deliberately: nothing
  is collected at the door there, `price` is a display total, and netting it would change every
  shipped paid-order flow.
- A COD coin-surplus credit reaches `refundToWallet` without an admin-supplied reason (the edit
  endpoint only demands one for prepaid orders), so it falls back to `OTHER` + a fixed note. The
  prepaid branch still passes the caller's reason through unchanged (invalid reasons must keep
  throwing there).
- `cancelEmptiedOrder` (picker, all-items-OOS) now refunds `computeRefundOwed(order).amount`
  outright — no `prepaid` gate and **no `Math.min(order.price, …)` cap**. Both were silently
  keeping coins: a coin-paying COD order is not "prepaid", and its `price` has already been netted
  to ₹0 by the time the last line goes. Same reasoning as §8's amount gate.
- The invoice's "Wallet Redeemed" line goes through `invoiceUtils.walletLineAmount()` (clamped to
  the gross) so an edited bill still adds up on paper. Unedited orders are unaffected —
  `walletUsed ≤ gross` always holds at checkout.
- Covered by `packages/admin/__tests__/order-edit-cod-wallet.test.js` (10 cases) and
  `packages/picking/__tests__/oos-cod-wallet-order.test.js` (9 cases, incl. the invoice line).
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

---

## 14. The coin refund on an admin edit is announced, and the trail says why  (follow-up to §13)
§13 made a **cash** order able to receive a wallet credit (the coins the shrunken bill can no
longer absorb). The admin edit endpoint still treated refunds as a prepaid-only thing, so that
credit was **silent**: no "Refund credited 💰" push, and the audit row recorded
`refundReason: null` because the order wasn't prepaid.

1. **COD order with coins, edited below the coins.** ₹300 basket, ₹40 coins, remove everything
   except a ₹25 item.
   ✅ Customer gets the push "Refund credited 💰 — ₹15 has been added to your wallet for order …".
   ✅ Order Activity → `order.items.edit` shows `refundAmount: 15`, `refundReason: "OTHER"` and the
   note "Wallet coins exceeded the revised order total after an item edit".
   ❌ Must not be silent, and must not say "no reason".
2. **Prepaid edit — unchanged.** Captured Razorpay order, remove a ₹200 line with reason
   *Out of stock*. ✅ Same single push as before; the audit records **the admin's own reason**
   (`OUT_OF_STOCK`), not `OTHER`.
3. **COD edit that credits nothing** (coins still fully absorbed). ✅ No push, `refundReason: null`
   in the audit — an ordinary bill reduction is not a refund.
4. The reason/note in the audit are now read back off the refund entry that was actually written,
   so the trail can never disagree with `order.refunds[]`.

### Day plan payment status (same pass)
Admin → Orders → **Scheduled day plan**: a **store-pickup prepaid** booking that was already paid
online used to show as `cod_pending` (collect on delivery) — it pays through Razorpay exactly like a
normal online order.
✅ Captured Razorpay **or** captured store-pickup-prepaid → `paid`.
✅ Either of them without a capture → `pending`.
✅ Wallet → `paid`; COD / store-pickup **postpaid** → `cod_pending` (unchanged).
The three values are unchanged, so the admin FE needs no release.

Covered by `packages/admin/__tests__/order-edit-refund-push.test.js` (3 cases) and the
`day plan — …paymentStatus…` case in `packages/admin/__tests__/scheduled-admin-views.test.js`.

## 15. The customer cancel response carries no staff-only data  (privacy fix)

The customer cancel endpoint (`POST /user/order/:id/cancel` and the legacy `DELETE /user/order/:id`)
answers with the freshly-updated order **document**, not a projected read — so any staff-only field
added to `orders` reaches the customer app from that one response. The first such field,
`codConversion` (which admin switched the order to cash, their email/roles, and a free-text
internal note), was shipping. It is now stripped in `sanitizeOrderForCustomer`, alongside
`releaseAt` / `releasedAt` / `slotHistory`.

✅ Admin converts an order to COD with an internal note → the customer cancels it inside the
1-minute window → 200, status `CANCELED`, and the response JSON contains no `codConversion`, no
admin email and none of the note text.
✅ Same for a **scheduled** order, which can be cancelled days ahead of its slot.
✅ The cancel itself is unchanged: restock, slot release, wallet refund, audit row and push all
behave exactly as in §8.
❗ For the next staff-only order field: closing the read projections is **not** enough — this
response, and the rider's accept/reject/status responses, are raw documents and need their own
strip.

Covered by `packages/user/__tests__/order-cod-conversion-privacy.test.js` (6 cases) and
`packages/delivery/__tests__/order-cod-conversion-privacy.test.js` (4).
