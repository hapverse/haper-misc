# Test guide: payment confirmation + retry

Plan: `docs/plans/payment-confirmation-retry.md`. This guide grows as each phase lands.
Backend pieces below are on `dev` (not deployed until the user deploys). Android screens come in Phase 2.

Use Razorpay **test mode** on dev (`dapi.haper.in`). Auth = a customer JWT.

## 1. `GET /user/order/:orderId/payment-status` (task 1.2)

Read-only. Safe to call every 2 seconds. No Razorpay call, no DB write.

| # | Setup | Expected |
|---|---|---|
| ✅ 1 | Place a RAZORPAY order, don't pay, call at once | `paymentState: "AWAITING_PAYMENT"`, `canRetry: true`, `checkout` has `key` (rzp_…), `razorpayOrderId` (= `rzpOrder.id` from place), `amountPaise` = price × 100, `currency: "INR"`; `expiresAt` = order time + 15 min |
| ✅ 2 | Same order, 13.5+ min later (under 90 s left) | still `AWAITING_PAYMENT`, `canRetry: false`, `checkout: null` |
| ✅ 3 | After 15 min + cron ran | `paymentState: "EXPIRED"`, `expiresAt: null`, `walletRefund` = coins returned |
| ✅ 4 | Pay with `success@razorpay` | `paymentState: "PAID"` within a second or two of the webhook |
| ✅ 5 | Admin switched the order to COD | `paymentState: "SWITCHED_TO_COD"`; response has **no** `codConversion`, admin email or note |
| ✅ 6 | A COD order | `paymentState: "NOT_ONLINE"` |
| ✅ 7 | Customer-cancelled order | `paymentState: "CANCELLED"` |
| ✅ 8 | Scheduled prepaid order | `isScheduled: true` |
| ❌ 9 | Another customer's order id | **404** `{ "msg": "Order not found" }` (never 403) |
| ❌ 10 | Random / malformed id | **404**, same body |
| ❌ 11 | No token | 401 |

`retryBlockedReason` is `"ORDER_EDITED"` (with `canRetry: false`, `checkout: null`) once an admin has edited the
unpaid order's items (section 9); otherwise `null`.

## 2. `POST /user/order/place` new keys (task 1.7)

| # | Setup | Expected |
|---|---|---|
| ✅ 1 | RAZORPAY order (now or scheduled) | `data.paymentExpiresAt` = order `createdAt` + 15 min, `data.serverTime` = server clock (ISO) |
| ✅ 2 | COD / wallet-covered / store-pickup-postpaid order | neither key in `data` |
| ✅ 3 | Old app builds | unchanged behaviour (they ignore unknown keys) |

## 3. Schema / constants (addendum A.1)

- New order field `onlinePaymentClosedAt` (date, no default): must **not** appear on new orders in the DB.
  Written only by an admin item edit on a `PAYMENT_INITIATED`/`PAYMENT_FAILED` order (section 9).
- New constant `UNPAID_ONLINE_STATUSES = [6, 8, 9]`. No behaviour change.

## 4. A failed payment attempt no longer releases the order (task 1.4, decision Q2)

Before: the first `payment.failed` webhook moved the order to `PAYMENT_FAILED` (8), put the stock
back, freed the delivery slot and released the coupon, so the customer could not retry.
Now: the order stays `PAYMENT_INITIATED` (6) and only an audit row is written. The 15-minute
abandonment cron is the one place that releases an unpaid order.

| # | Setup | Expected |
|---|---|---|
| ✅ 1 | Place a RAZORPAY order, pay with `failure@razorpay` | order stays status **6**; stock, slot seat and coupon (still `HELD`) unchanged; Order Activity shows `order.payment.attempt_failed` with `paymentId`, `errorCode`, `errorReason` |
| ✅ 2 | Same order, fail twice more (2 new attempts) | one audit row per payment id; nothing else changes |
| ✅ 3 | Same order, then pay with `success@razorpay` within 15 min | order goes **OPEN** (0); stock was never returned in between |
| ✅ 4 | Fail once, wait 15+ min for the cron | status **9** (`PAYMENT_CANCELLED`), stock back once, seat freed, coupon `RELEASED`, wallet coins spent at checkout refunded once |
| ❌ 5 | Razorpay redelivers the same `payment.failed` | no second audit row, nothing released |
| ✅ 6 | `payment.failed` arrives after the cron already cancelled (status 9) | ignored, as before: no second restock or refund |

## 5. Capture pipeline moved to shared (task 1.1)

Pure move, no behaviour change: the `payment.captured` settlement code now lives in
`packages/shared/utils/razorpay-capture.utils.js` (`utils.razorpayCaptureUtils`) so the cron and
verify endpoint can reuse it. Regression check = row 4 of section 1 (pay → `PAID`/OPEN) plus the
existing capture-after-cancel and COD late-capture checks in `test-payment-alerts.md` /
`test-order-cod-conversion.md`.

## 6. `POST /user/razorpay/order/:orderId/verify` (task 1.3)

The app calls this right after the Razorpay sheet says "success", so the order confirms without
waiting for the webhook. Body: `{ razorpayPaymentId, razorpayOrderId, razorpaySignature }` (the three
values the Razorpay SDK hands back). The server checks the signature, asks Razorpay for the payment
itself, and settles it with the same code as the webhook. It answers with the section 1 body.

| # | Setup | Expected |
|---|---|---|
| ✅ 1 | Pay with `success@razorpay`, call verify with the SDK values (webhook blocked or slow) | 200, `paymentState: "PAID"`; order OPEN, pick task created, store admin push once, cart emptied |
| ✅ 2 | Call verify again, and let the webhook arrive too | still one OPEN, one pick task, one admin push, no wallet credit |
| ✅ 3 | Payment still `authorized` (not captured yet) | 200, `AWAITING_PAYMENT`, nothing changes; the webhook finishes it |
| ✅ 4 | Razorpay slow/down | 200 within ~3 s, `AWAITING_PAYMENT` (the app keeps polling) |
| ✅ 5 | Order was already cancelled by the cron, then the customer's payment lands and verify runs | order stays cancelled (9), captured amount goes to the wallet once, `paymentState: "EXPIRED"`, `walletRefund` = that amount |
| ✅ 6 | Admin switched the order to COD, then the card payment lands | order stays COD, captured amount to wallet once, `SWITCHED_TO_COD` |
| ❌ 7 | Wrong/forged signature | **400** "Payment verification failed", no Razorpay call, no change; log row `verify.bad_signature` |
| ❌ 8 | `razorpayOrderId` not this order's | **400**, no change; log row `verify.order_id_mismatch` |
| ❌ 9 | Another customer's order / malformed id | **404** `Order not found` |
| ❌ 10 | Missing body field | **400** |
| ❌ 11 | 11th call within a minute by one customer | **429** |

## 7. A new checkout releases the older unpaid order (task 1.6, decision Q3)

Before: backing out of the payment sheet and checking out again left **two** unpaid orders, both
holding stock. Now: `POST /user/order/place` (now or scheduled, any payment method) first releases
the customer's other unpaid (`PAYMENT_INITIATED`) orders **in the same store**, after asking Razorpay.

| # | Setup | Expected |
|---|---|---|
| ✅ 1 | Place RAZORPAY order A (with coupon + wallet coins), back out, place order B | A → status **9**, stock back, coins back, coupon `RELEASED`, scheduled seat freed; Order Activity on A shows `order.payment.superseded`; B created normally |
| ✅ 2 | A was actually paid at Razorpay (webhook lost), then place B | A goes **OPEN** (settled), not cancelled; B also created |
| ✅ 3 | A has an `authorized` payment | A left alone; B created |
| ✅ 4 | Razorpay down during B's checkout | A left for the 15-min cron; B created |
| ✅ 5 | Unpaid order in a **different store**, or another customer's | untouched |
| ✅ 6 | Anything goes wrong releasing A | B still goes through (release is best-effort) |
| ❌ 7 | Place A, then place B **within 60 s** (double-tap / retried request) | A left alone (still status 6, still payable); B created. Only orders **60 s+ old** are released (`SUPERSEDE_MIN_AGE_SECONDS`) |
| ✅ 8 | Place A, wait 61+ s, place B | A released exactly as row 1 |
| ❌ 9 | A is 60 s+ old, then call place with an empty or unknown `cartId` | request fails; A **not** released |

Note: a B that fails on **stock** still releases A first. That is on purpose: A's held stock going
back is what lets the customer re-checkout the same cart.

The abandonment cron calls the same shared code (`utils.unpaidOrderReleaseUtils.settleOrReleaseUnpaidOrder`),
and since Phase 3.1 it asks Razorpay first too: see section 10.

Deploy: backend only. Nothing for admin/web/apps until Phase 2.

## 8. Android app (Phase 2, tasks 2.1-2.9)

Debug build on dev (`./gradlew installDebug`), Razorpay **test mode**. UPI `success@razorpay` /
`failure@razorpay`. Screen spec: `docs/plans/payment-confirmation-retry-ui-spec.md`. Needs the backend
sections 1-7 deployed to dev; on a backend without payment-status the app falls back (row 16).

| # | Setup | Expected |
|---|---|---|
| ✅ 1 | Online order, pay with `success@razorpay` | "Confirming your payment" (spinner) for ~1-3 s, then the normal "Order placed" screen. Back from it goes Home, not into checkout |
| ✅ 2 | Online order, close the Razorpay sheet (back) | "Complete your payment": order no., amount, live "Time left", **Pay ₹X**, Cancel order, Back to home. Order is **not** cancelled (Orders tab shows it as "Payment Pending") |
| ✅ 3 | From row 2 tap Pay | Razorpay reopens for the **same** order (same `order_…` id in the Razorpay dashboard; no new HP order in admin) |
| ✅ 4 | Row 3 then `success@razorpay` | Confirming → Order placed; admin shows the order OPEN once, one pick task |
| ✅ 5 | Row 3 then `failure@razorpay` | Stays on "Complete your payment", subtitle is a plain sentence (e.g. "Your bank declined this payment. You can try again."), countdown did not reset. After 3 failures: "Tip: try a different UPI app…" |
| ✅ 6 | Double-tap Pay quickly | Only one Razorpay sheet opens |
| ✅ 7 | Wait until under 90 s left | Red "Time's almost up", no Pay button, **Go to cart** + Cancel order. Razorpay sheet opened earlier closes itself ~45 s before expiry |
| ✅ 8 | Wait past 15 min (cron runs) | "Payment time ran out … no money was taken"; if coins were used, "₹N in Haper coins is back in your wallet". **Place order again** opens the cart |
| ✅ 9 | Row 2, then Cancel order → Yes, cancel | Order cancelled (status 9), lands on Orders tab |
| ✅ 10 | Cancel order while the admin switches it to COD at the same moment | No error dialog; screen re-renders to "Order confirmed — pay by cash" |
| ✅ 11 | Admin switches the unpaid order to COD while the customer sits on row 2 | Within ~10 s: "Order confirmed — pay by cash", only **Track my order** |
| ✅ 12 | Admin edits the items of the unpaid order | "Your order was updated", "New amount ₹Y", **Place a new order** + Cancel order; no Pay |
| ✅ 13 | Start paying in the UPI app, then kill Haper from recents; reopen Haper | Opens straight onto that order's payment screen ("Checking your order…" then the right state) |
| ✅ 14 | Airplane mode on the payment screen, tap Check again | "Couldn't check your payment … This does not mean it failed", Check again + Go to my orders |
| ✅ 15 | Orders tab with an unpaid order | Amber "Payment Pending", no progress bar, no delivery OTP, "Complete your payment to confirm this order", **Complete payment** pill → payment screen. Detail screen: "Payment pending" card + button, bill says **To pay ₹X** / "Payment pending via Razorpay" (amber) |
| ✅ 16 | Backend without `/payment-status` (404) | Screen still shows the right outcome from `GET /order/:id`; an unpaid order shows Pay disabled with "Paying again isn't available for this order right now." |
| ✅ 17 | Unpaid order exists, go back to cart and tap Pay (online) again | Dialog "You have an unpaid order": **Complete payment** → its payment screen; **Start a new order** closes the dialog, next tap places a new order (server releases the old one) |
| ✅ 18 | Payment confirms slowly (block the webhook, verify returns AWAITING) | After 20 s the copy says "taking a little longer" + Go to my orders; after 2 min it stops asking and shows "Couldn't check your payment" with Check again |
| ❌ 19 | COD order and wallet-only order | Exactly as before: straight to "Order placed", no payment screen, no dialog |
| ❌ 20 | Log out with a pending payment, log in as someone else | No payment screen opens |

Deploy: Android debug/release build only (after backend on dev). No store upload from agents.

## 9. Admin edits and COD switch on an unpaid order (addendum A.2 / A.3 / A.4)

Full admin walkthrough: `test-order-edit-unpaid.md` (item edit) and `test-order-cod-conversion.md` "Mode C"
(switch a `PAYMENT_INITIATED` order to COD). Customer-side checks:

| # | Setup | Expected |
|---|---|---|
| ✅ 1 | Place online order (₹540), admin removes an item (₹480), then pay the **old** ₹540 in the still-open sheet | order stays status **6** (not OPEN), `meta.payment` not written, ₹540 credited to the wallet **once**, push "…after the store changed this order…"; `payment-status` → `canRetry:false`, `retryBlockedReason:"ORDER_EDITED"` |
| ✅ 2 | Row 1, then wait 15+ min | cron cancels it (status 9), stock back, the checkout coins come back **once** (wallet = ₹540 + coins) |
| ✅ 3 | Admin edits, then switches to COD | order OPEN + COD, rider collects the **edited** price; a later capture goes to the wallet once and the order stays COD |
| ❌ 4 | Redeliver row 1's webhook | no second credit |
| ✅ 5 | No admin edit: pay normally | order goes OPEN exactly as before (regression) |

## 10. Abandonment cron asks Razorpay before releasing (Phase 3.1)

Every 15-min cron run, per `PAYMENT_INITIATED` order older than 15 min, before cancelling it:

| # | Razorpay shows | Expected |
|---|---|---|
| ✅ 1 | nothing / only `failed`/`created` | cancelled as before (status 9, stock + coins back once) |
| ✅ 2 | a `captured` payment (webhook was lost) | order goes **OPEN** (settled like the webhook), never cancelled, at any age |
| ✅ 3 | `authorized`, or Razorpay unreachable / unknown status / full page, order < 30 min old | skipped this run (log row `release.gateway_unverifiable` for the unverifiable cases) |
| ✅ 4 | same, order > 30 min old (`PAYMENT_WINDOW_MINUTES + 15`) | released anyway + alert row `release.forced_after_limbo` (reason + age). A capture after that lands on a cancelled order and goes to the wallet |
| ✅ 5 | `captured`, order was admin-edited (section 9) | capture credited to the wallet (once), then the order is still cancelled and the coins returned once |
| ✅ 6 | order already switched to COD (Mode C) | untouched |

Deploy: backend only (A.2 before A.4 — the capture branch must be live before any order can be stamped).

