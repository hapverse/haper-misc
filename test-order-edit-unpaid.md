# Test: edit items on an unpaid online order

**Area:** Admin → Orders → order details → Edit Items
**Backend:** `PATCH /admin/order/edit-order/:orderId` — `packages/admin/src/routes/order/{controller,router}.js`,
`packages/shared/utils/order-edit.utils.js` (`applyItemEdit`, `unpaidOnline`)
**Plan:** `haper-misc/docs/plans/payment-confirmation-retry.md` §12.3 / §12.4 (task A.4)
**Needs:** backend on dev. The admin UI (Edit button on these statuses, "Customer will pay ₹X") is task A.5;
until it ships, test via API (Postman/curl with an admin JWT).

## What changed

An online (Razorpay) order that was never paid can now have its items edited in all three unpaid statuses:
`PAYMENT_INITIATED` (6, customer still on the payment screen), `PAYMENT_FAILED` (8), `PAYMENT_CANCELLED` (9).
Add items, remove items, raise or lower quantities, like a normal order.

**Money rules (do not "fix"):**
- Nobody paid, so an edit **never refunds**: no `refunds[]` entry, `refundedAmount` unchanged, wallet
  unchanged, no "Refund credited" push, `data.refundAmount` always `0` — even when coins were used.
- `price` = items + the original delivery/platform fees − the wallet coins used at checkout
  (`meta.walletUsed`). That is the cash a later COD switch collects. Example: ₹540 bill, ₹100 coins,
  remove a ₹60 item → price ₹380.
- If the new bill would be **smaller than the coins used**, the edit is refused (409 `COINS_EXCEED_TOTAL`).
- Stock moves **only** for `PAYMENT_INITIATED` (its stock is still held). For CANCELLED/FAILED the stock was
  already returned, so nothing moves; a later "Switch to COD" (Mode A) deducts the **edited** list.
- A `PAYMENT_INITIATED`/`PAYMENT_FAILED` edit **closes online payment** (`onlinePaymentClosedAt`, first edit's
  time kept). The customer can no longer pay it online; if the old payment still lands it goes to the wallet
  and the order is not made live. The order then finishes only by "Switch to COD", or the 15-min cron
  cancels it and returns the coins once.

## API contract

Request unchanged: `{ orderId, items: [{ itemId, quantity }], refundReason?, refundNote? }` (`refundReason`
ignored for unpaid orders). Role: super_admin / store_admin / manager / support **+** `orders.edit_items`
(the role gate is new for ALL edits: warehouse roles now get 403).

200: `{ msg, data: { order, refundAmount: 0, unpaid: true } }` (`unpaid: false` on every other edit).

Refusals on the unpaid path are `{ msg, code }` — branch on `code`:

| HTTP | code | when |
|---|---|---|
| 409 | `PAYMENT_ALREADY_CAPTURED` | captured payment on record, or Razorpay shows `captured`/`authorized` (INITIATED/FAILED) |
| 503 | `GATEWAY_UNVERIFIABLE` | Razorpay unreachable / unknown status / full page (INITIATED/FAILED) — at any value |
| 409 | `COINS_EXCEED_TOTAL` | new bill < coins used |
| 409 | `ORDER_CHANGED` | the order moved while editing (capture, COD switch, another edit) |
| 409 | `UNEXPECTED_REFUND` | INITIATED/FAILED order that already has money credited back (e.g. a late capture) |

Unchanged refusals: 400 "Order is not ongoing" (other statuses), 400 payment-pending message for a
non-Razorpay `PAYMENT_INITIATED` order (store pickup), 403 other store, 400 "Insufficient stock for item X"
(INITIATED only).

Audit: `order.items.edit` with `metadata.unpaid: true`, `metadata.status`.

## Manual steps (dev, Razorpay test mode)

For each of status 6, 8, 9, once without coins and once with ₹100 coins:

| # | Step | Expected |
|---|---|---|
| ✅ 1 | Note item stock + wallet coins. Edit: raise one qty, remove one line, add a new item | 200, `refundAmount 0`; price = new items + fees − coins; wallet and `refundedAmount` unchanged; no refund push |
| ✅ 2 | Stock after row 1 | status 6: moved per line (raise −1, removed +qty, added −qty). Status 8/9: **no change at all** |
| ✅ 3 | Status 6/8: DB `onlinePaymentClosedAt` | set; edit again → same timestamp. Status 9: not set |
| ❌ 4 | Edit so the bill < coins used | 409 `COINS_EXCEED_TOTAL`, nothing changed (stock too) |
| ❌ 5 | Status 6/8 while the customer's payment is `authorized`/`captured` at Razorpay | 409 `PAYMENT_ALREADY_CAPTURED` |
| ❌ 6 | Status 6/8 with Razorpay blocked | 503 `GATEWAY_UNVERIFIABLE`, alert row `edit.gateway_unverifiable` |
| ✅ 7 | Status 6: edit, then pay the old amount in the open sheet (`success@razorpay`) | order stays 6, full payment to wallet once, customer + store push; 15 min later the cron cancels it and returns the coins **once** |
| ✅ 8 | Status 9 with an item now out of stock: Switch to COD | 400 `OUT_OF_STOCK`. Edit out that item, switch again → 200 Mode A, stock deducted for the edited list, coins clawed back |
| ✅ 9 | Status 6: edit, then Switch to COD | Mode C, `cashToCollect` = the edited price |
| ❌ 10 | Warehouse manager with `orders.edit_items` edits any order | 403 (new role gate) |
| ✅ 11 | Regression: edit an OPEN COD order and an OPEN paid order | exactly as before (paid: qty cap + refund reason + refund) |
| ❌ 12 | Warehouse manager granted `orders.view` / `orders.assign_rider` / `orders.change_status`: open an order by id, assign-order, reassign, mark-status-admin | 403 `requiredRoles` on each (same role gate); store admin / manager / support / super admin unchanged |
| ✅ 13 | Status 6 with ₹100 coins: edit, pay the old amount (goes to wallet), then the **customer** taps Cancel | 200, status 9; wallet = online payment + ₹100 coins (coins back once, not eaten); store push after the payment says the order will expire and to ask for a reorder (no "Switch to COD") |
| ❌ 14 | Row 7 order after the cron cancelled it (status 9): Switch to COD, with Razorpay blocked or not | 409 `PAYMENT_ALREADY_CAPTURED`; wallet still holds the online payment + coins; nothing moved |
| ❌ 15 | Any never-paid status-9 Razorpay order: Mark status → OPEN (plain reopen) | 409 `UNPAID_ONLINE_REOPEN` ("Use Switch to Cash on Delivery"); Switch to COD on the same order still works (Mode A) |
| ✅ 16 | Status 6: customer cancel (or the cron) while an admin edit lands at the same moment | stock returned for the **edited** lines only (compare stock before/after with the edit) |

Deploy: backend only, **capture branch (A.2) before the edit (A.4)** — they ship together in this change.
Rollback: revert the edit (A.4) before the capture branch (A.2), never the other way round.
