# Payment confirmation + "Complete your payment" retry (Android + backend)

Status: PLAN, waiting for user approval. Author: shavinder-planner, 2026-09-24.
Trigger: WhatsApp support case, order HP57099093.
Repos: haper-backend (dev), haper-android (dev), haper-misc.

---

## 0. Read this first: the brief's premise does not match the code

The brief says the app shows "Order placed" as soon as the order is created or the Razorpay sheet opens.
That is **not** what the code on `dev` does, and not what the released `v2.5.3` tag does either.

What the code actually does (`haper-android/.../checkout/CheckoutScreen.kt` lines 425-474):

- The "Order placed" screen opens when the **Razorpay SDK on the phone** reports success
  (`MainActivity.onPaymentSuccess`). It does **not** wait for our server to confirm the payment.
- When the SDK reports a failure or a back-out, the app shows `PaymentFailedScreen` and at the same time
  **calls cancel on the order** (`orderVM.cancelOrder`). The backend only accepts a customer cancel in the
  first **60 seconds** after the order was created. After that the cancel fails silently and the order
  stays `PAYMENT_INITIATED` for up to 15 minutes.
- "Retry" on `PaymentFailedScreen` only closes the screen. Tapping Pay again creates a **new** order.

So a customer can believe their order went through in three ways, and **none** of them is "success shown at
order creation":

1. **My Orders makes an unpaid order look placed.** A `PAYMENT_INITIATED` order appears in the Active list
   with a progress bar and the text "We have your order" (`OrderModels.kt` `listProgressText`). The detail
   screen shows "Paid ₹X" and "Paid via Razorpay" (`OrderDetailScreen.kt` ~line 944-959). This is the most
   likely thing the customer saw.
2. **The phone said success but our server never confirmed it.** The order only goes live when the Razorpay
   webhook reaches us. If the webhook is late or lost, the cron cancels the order at 15 minutes. If the
   capture arrives later it is refunded to the wallet. If it never arrives, the customer paid, the order is
   cancelled, and nothing refunds them.
3. **The app was killed while the customer was in their UPI app.** The SDK result is kept in a static
   `completionHandler` (`RazorpayManager.kt`) and is lost when the process dies. The customer comes back to
   the home screen with no status at all.

**Debug before fixing (project rule).** Task 0.1 checks which of these three happened to HP57099093 before
any code is written. The fix below covers all three either way, but the diagnosis decides how urgent
Phase 3 (the check with Razorpay before the cron cancels) is.

---

## 1. Goal

For online (Razorpay) orders, the customer sees "Order placed" **only after our server has confirmed the
money was captured**. If the payment did not complete, the customer sees a clear "Complete your payment"
screen that lets them pay again **for the same order** while it is still reserved (15 minutes). After that
they see "Payment time ran out" and a way to place the order again. Cash on Delivery and wallet-only orders
behave exactly as they do today. No flow may create a duplicate order or take money twice.

Plain words, with an example: Riya orders ₹540 of groceries and chooses UPI. She opens PhonePe, gets
distracted and comes back. Today the app might show her order as placed. After this change she sees
"Complete your payment. Order #HP57099093, ₹540, 11:32 left, [Pay ₹540]". Tapping Pay reopens Razorpay for
the **same** order, so no second order is created. If she comes back after 15 minutes, she sees "Payment time
ran out. Nothing was charged. [Place order again]".

### Acceptance criteria (what "done" means for the user)

- [ ] AC1. Online order, payment succeeds: "Order placed" appears only after the server says `PAID`,
      normally within about 3 seconds of the Razorpay sheet closing.
- [ ] AC2. Online order, customer backs out of the sheet: the "Complete your payment" screen appears with
      the order number, the amount, a countdown and a "Pay ₹X" button. No "Order placed" screen, and the
      order is **not** cancelled.
- [ ] AC3. Tapping "Pay ₹X" reopens Razorpay with the **same** Razorpay order id. The database gains no new
      order and Razorpay gains no new order.
- [ ] AC4. The retry payment succeeds: "Order placed" appears, and the order goes OPEN exactly once
      (one pick task, one admin "New order - paid" push).
- [ ] AC5. The retry fails again: the customer stays on "Complete your payment" with the new reason, and
      can try again while time is left.
- [ ] AC6. Less than 90 seconds left: the Pay button is replaced with "Time's almost up. Place a new order",
      and the Razorpay sheet can never stay open past the expiry (checkout `timeout`).
- [ ] AC7. After 15 minutes (the cron has cancelled the order): the customer sees "Payment time ran out",
      whatever wallet amount went back to them ("₹X is back in your Haper wallet"), and
      "Place order again", which opens the cart.
- [ ] AC8. The app is killed while the customer is in their UPI app. On the next open (logged in), the app
      shows the correct screen for that order (confirming, complete payment, expired, or placed).
- [ ] AC9. My Orders never shows an unpaid order as placed. A `PAYMENT_INITIATED` card shows
      "Payment pending", a "Complete payment" button and no progress bar. Its detail screen says
      "To pay ₹X", not "Paid ₹X via Razorpay".
- [ ] AC10. COD and wallet-only orders: same screens, same timing, same requests as today. The response
      bytes are the same apart from new optional keys.
- [ ] AC11. The customer pays twice somehow (two UPI apps, a slow bank). They get exactly one order, and the
      second payment goes to their wallet with a push. This is the existing behaviour and must stay working.
- [ ] AC12. The payment is captured but the webhook is missing or late. The order still goes OPEN, through
      the verify call (Phase 1) or the cron's check with Razorpay (Phase 3). It is never cancelled while
      money for it sits at Razorpay.
- [ ] AC13. An admin switched the order to Cash on Delivery. The customer's screen says "Confirmed as Cash
      on Delivery, pay ₹X to the rider" and offers no online retry.
- [ ] AC14. The status check fails (no network): the screen says "Couldn't check your payment" with
      "Check again". It never guesses success or failure.

---

## 2. Current state (what exists today)

### Backend (haper-backend, `dev`)

| Piece | File | Fact that matters here |
|---|---|---|
| Status enum | `packages/shared/constants/order.constant.js` | `PAYMENT_INITIATED 6`, `PAYMENT_SUCCESS 7`, `PAYMENT_FAILED 8`, `PAYMENT_CANCELLED 9`, `OPEN 0` … `successStatuses` = OPEN, PICKING, PACKED, ASSIGNED, PROCESSING, OUT_FOR_DELIVERY, CLOSED, PAYMENT_SUCCESS. `paymentMethod`: COD 0, RAZORPAY 1, STORE_PICKUP_PREPAID 2, STORE_PICKUP_POSTPAID 3, WALLET 4. |
| Order create | `packages/user/src/routes/order/controller.js` `placeOrder` (~943-1407) + scheduled branch (~1600-1970) | A prepaid order is written as `PAYMENT_INITIATED`. Stock, wallet coins and the slot seat are taken **inside** the transaction, and the coupon stays HELD. The Razorpay order (`razorPayUtils.create`, notes `{userId, orderId, cartId, storeId}`) is created after the commit, and `meta.id` = the Razorpay order id. The cart is **not** deleted for prepaid orders (only on capture). The response carries `rzpOrder` and `rzpToken`. |
| Capture webhook | `packages/user/src/routes/razorpay/controller.js` `events` → `processCapture` → `dispatchCapture` | Heavily hardened. Every branch re-checks its conditions in the write filter. `PAYMENT_INITIATED` or `PAYMENT_FAILED` → OPEN via `updateOne` (so no customer push). Cancelled states → refund to wallet. COD-converted → late-capture refund to wallet. Already live → record the capture only. A second different capture → refund to wallet. Idempotency marker = `(pay <id>)` in the refund note. 4s ack budget, retry budget. Covered by the `razorpay-capture-*` and `razorpay-late-capture` tests. |
| `payment.failed` webhook | same file ~1083-1145 | On the **first failed attempt** it moves the order to `PAYMENT_FAILED`, restocks, frees the slot and releases the coupon. It does **not** give back the wallet coins, and the write is not conditional. |
| Abandonment cron | `packages/cron/src/jobs/payment-initiated-orders.js` (every minute) | `PAYMENT_INITIATED` older than 15 min → restock, wallet coins back, `PAYMENT_CANCELLED`, `stockRestored:true`, frees the slot, then releases the coupon. **The status write is conditional on `_id` only** (`updateWithOps`), and the read comes through `getAllOrders` (the cron connects `secondaryPreferred`). |
| Customer cancel | order `controller.js` `cancel` (~2210) | Allows `OPEN`/`PAYMENT_INITIATED` only within 60 s of creation. A never-paid order becomes `PAYMENT_CANCELLED`. The read (`getDetail`) happens outside the transaction and the write is `_id`-only. |
| Order read for customer | `getOne` `GET /order/:orderId`, `getHistory`, `sanitizeOrderForCustomer`, `CUSTOMER_SAFE_PROJECTION` strips `codConversion` | `PAYMENT_FAILED`/`PAYMENT_CANCELLED` are **hidden** from list and history (`HIDDEN_FROM_LIST_STATUSES`). `PAYMENT_INITIATED` counts as ACTIVE. |
| Razorpay utils | `packages/shared/utils/razorpay.utils.js` | `create`, `fetchPaymentsByOrderId`, `fetchPaymentsByPaymentId`, `validatePaymentBySignature` (**exists but no route uses it**), `fetchOrderByOrderId`. |
| Existing client route | `GET /razorpay/order/:orderId` | Returns the raw Razorpay order. Unused by this plan and left unchanged. |
| Admin convert-to-COD | `packages/admin/src/routes/order/controller.js` `convertToCod` + `reopen.service.js` | Mode A from `PAYMENT_CANCELLED`/`PAYMENT_FAILED` (reopen + convert). Mode B from OPEN, PICKING, PACKED, PROCESSING, ASSIGNED. **`PAYMENT_INITIATED` is deliberately NOT convertible.** The write filter includes "no capture yet". Late capture after conversion → wallet refund. |
| Status-change push | `orders.schema.js` post-`findOneAndUpdate` hook | Any `findOneAndUpdate` that changes status fires `order-status-changed`. That is why `payment.failed` currently sends "Payment Failed ⚠️ … Please try again" (from `notification.constant.js`), a push with no retry path behind it. |

### Android (haper-android, `dev`, versionCode 51)

| Piece | File | Fact |
|---|---|---|
| Pay flow | `ui/screens/checkout/CheckoutScreen.kt` 366-497 | Place order → `RazorpayManager.showPaymentForm` → on SDK success, `onOrderSuccess` (success screen). On SDK error, `PaymentFailedScreen` + `orderVM.cancelOrder`. |
| SDK bridge | `ui/screens/checkout/RazorpayManager.kt`, `MainActivity.kt` 131-180 | A single static `completionHandler`, lost when the process dies. Razorpay checkout SDK `1.6.33` (`gradle/libs.versions.toml`). |
| Success screen | `ui/screens/orders/OrderSuccessScreen.kt`, route `orderSuccess/{orderDbId}/{displayOrderId}?scheduled=` | Ids only, no API read. |
| Failure screen | `ui/screens/checkout/PaymentFailedScreen.kt` | "Retry" = just close the screen. |
| Status model | `data/model/OrderModels.kt` | `PAYMENT_INITIATED` → "Payment Pending", but `listProgressSegments`=1 and `listProgressText`="We have your order". `isActive` includes it. |
| Order detail | `ui/screens/orders/OrderDetailScreen.kt` | "Paid ₹X / Paid via Razorpay" is shown whatever the status. |
| Local prefs | `util/TokenManager.kt`, `util/DevPrefs.kt` (SharedPreferences) | The pattern to reuse for a pending-payment marker. |

### Razorpay facts this design depends on (verified 2026-09-24)

- One Razorpay order can carry **many payment attempts** (status `created` → `attempted`). Once one payment
  is captured the order is `paid`, and Razorpay **refuses** any further payment on it. While a payment is
  `authorized`, a new attempt on the same order is also refused. So **reusing the same Razorpay order id is
  what stops a double charge**.
- Checkout option `timeout` (seconds) closes the sheet automatically. `retry.max_count` limits retries inside
  the sheet on Android and iOS (Razorpay recommends 4).
- `payment.failed` fires **per failed attempt**, not per order. The customer can still pay the same order
  after it.

---

## 3. Proposed design

### 3.1 Decisions

1. **The server decides, the phone only hints.** The SDK's success and error callbacks never show a final
   screen on their own. They trigger a server check, and the screen follows the server's answer.
2. **Retry = the same order, the same Razorpay order id.** No new endpoint mutates anything to "retry". The
   app reopens checkout with `order.meta.id`. Razorpay itself refuses a second payment once the order is
   paid. That is the idempotency: it is enforced by the gateway, not by our own counter.
3. **Expired = a new order through the normal cart and checkout.** Once the cron has released stock, the slot
   and the coupon, we do **not** revive the old order. Reviving it would mean re-reserving stock, the seat,
   the coupon and the wallet coins, which is exactly the admin Mode-A reopen logic. Duplicating that on a
   customer path is the risky, clever option. The cart is still there (prepaid carts are only deleted on
   capture), so "Place order again" opens the cart and runs the normal checkout, which re-checks stock,
   price, coupon and slot.
4. **A fast confirmation path, plus a backstop.** A new `POST /razorpay/order/:orderId/verify` lets the app
   hand the server the SDK's `payment_id` and `signature`. The server checks the signature, asks Razorpay
   for the payment, and runs **the same capture code the webhook runs**. The order goes OPEN in about a
   second instead of waiting for the webhook, and a lost webhook no longer strands a paid order. The
   webhook stays the primary path. The two paths are safe to run together because every capture write is
   already conditional and idempotent.
5. **A failed attempt is not a failed order** (Q2, recommended). `payment.failed` stops restocking and stops
   moving the order to `PAYMENT_FAILED`. The order stays `PAYMENT_INITIATED`, so the customer can retry,
   and the 15-minute cron stays the **single** place that releases an unpaid order. This also fixes two bugs
   that exist today:
   - (a) A customer whose first UPI attempt fails and whose second succeeds (inside the same sheet) currently
     goes OPEN **after** their stock and slot were given back. The stock count can then go wrong and the
     slot can be overbooked.
   - (b) `PAYMENT_FAILED` orders keep the customer's wallet coins forever, because the cron only sweeps
     `PAYMENT_INITIATED`.
6. **The cron (and the customer cancel) may only cancel an order that is still unpaid at the moment of the
   write.** The write filter must include `status: PAYMENT_INITIATED` plus "no captured payment". Today a
   capture landing between the cron's (secondary) read and its write gets overwritten: a paid, live order
   is cancelled and nothing refunds it. A retry feature pushes customers to pay near the deadline, so this
   race must be closed **before** retry ships.
7. **Polling, not sockets.** The confirmation window lasts seconds to minutes, on one screen, for one order.
   A 2-second poll of one indexed `_id` read is the boring option. stas-realtime is not needed.

### 3.2 States: server `paymentState` → screen

| Server order state | `paymentState` | Screen |
|---|---|---|
| status in `successStatuses`, no `codConversion.convertedAt` | `PAID` | Existing `OrderSuccessScreen` |
| status in `successStatuses`, `codConversion.convertedAt` set | `SWITCHED_TO_COD` | "Confirmed as Cash on Delivery" (S6) |
| `PAYMENT_INITIATED`, now < expiresAt | `AWAITING_PAYMENT` | "Confirming…" (S1) right after an SDK success, otherwise "Complete your payment" (S2) |
| `PAYMENT_INITIATED`, now ≥ expiresAt (cron not run yet) | `AWAITING_PAYMENT`, `canRetry:false` | S2 in "time's almost up" mode, then S4 |
| `PAYMENT_CANCELLED`, or legacy `PAYMENT_FAILED` | `EXPIRED` | "Payment time ran out" (S4) + wallet refund line |
| `CANCELED`, `ADMIN_CANCELED`, `FAILED`, `DELETED`, `REFUND_*`, `UN_DELIVERED` | `CANCELLED` | Order detail (existing) |
| COD, WALLET, STORE_PICKUP_POSTPAID never reach this screen | `NOT_ONLINE` | n/a (defensive) |

`expiresAt = createdAt + PAYMENT_WINDOW_MINUTES (15)`. `canRetry = AWAITING_PAYMENT && meta.id present &&
expiresAt - now ≥ RETRY_MIN_REMAINING_SECONDS (90)`.

### 3.3 Data flow: happy path

```
App                         user API                              Razorpay            DB
 | POST /order/place  ------> placeOrder (unchanged)  ----------> orders.create       order PAYMENT_INITIATED
 | <-- order, rzpOrder, rzpToken, paymentExpiresAt*, serverTime*                       (*new optional keys)
 | save PendingPaymentStore{orderDbId, expiresAt}
 | Checkout.open(order_id=rzpOrder.id, timeout=secondsLeft-45, retry.max_count=4)
 | ... customer pays in UPI app ...                                ---- webhook ---->  (may arrive any time)
 | SDK onPaymentSuccess(payment_id, order_id, signature)
 | nav -> paymentStatus/{orderDbId} (S1 Confirming)
 | POST /razorpay/order/:id/verify {ids, signature} -> HMAC check -> payments.fetch -> processCapture()  -> OPEN
 | <-- paymentState PAID
 | clear PendingPaymentStore, cart clear, nav -> orderSuccess
```

The webhook and verify both call `processCapture`. Whichever loses the conditional `updateOne` re-reads, sees
OPEN plus the same `meta.payment.id`, and does nothing (`recordCaptureOnly` returns DONE on the same id).
So there is one OPEN transition, one pick task and one admin push.

### 3.4 Data flow: back-out, then retry

```
SDK onPaymentError -> nav paymentStatus/{id} -> GET payment-status -> AWAITING_PAYMENT canRetry
   (no cancel call any more)
S2 [Pay ₹X] -> GET payment-status (fresh; if not retryable, re-render) -> Checkout.open(order_id = checkout.razorpayOrderId,
   timeout = secondsLeft - 45) -> success -> verify -> PAID -> success screen
                                -> error   -> S2 with the new reason
```

### 3.5 Data flow: expired

```
cron at T+15m: [Phase 3] ask Razorpay first -> none captured -> conditional release -> PAYMENT_CANCELLED
App (open, or opened later): GET payment-status -> EXPIRED {walletRefund}
S4 [Place order again] -> GET /cart (existing) -> cart screen -> normal checkout -> NEW order
```

A capture landing after expiry follows the existing `CANCELLED_STATES` branch: refund to wallet plus a push.
This is unchanged.

### 3.6 How this interacts with admin "Switch to Cash on Delivery"

- **Customer in the middle of a retry (`PAYMENT_INITIATED`)**: the admin **cannot** convert. The status is
  excluded from Mode A and Mode B (by design, "live payment sheet"). No conflict. Because of decision 5,
  orders now stay `PAYMENT_INITIATED` after a failed attempt, so the admin waits for the cron (at most 15
  minutes) before converting. Today they could convert right after the first failed attempt. Covered by Q2.
- **The admin converts after expiry (Mode A) while the customer sits on S4**: the app re-reads
  `payment-status` when S4 opens, on resume, and **right before** "Place order again". It then sees
  `SWITCHED_TO_COD` and shows S6 instead of letting the customer create a second order. Remaining gap: the
  admin converts after the customer already placed the new order. The result is two orders, and ops cancels
  one. Proposed admin follow-up (not in this plan's scope): the convert-to-COD modal warns
  "customer has a newer order #X placed after this one". This is Q10.
- **The customer pays late on a converted order**: the existing late-capture refund to wallet. Unchanged.

### 3.7 Double-order guard (Q3)

The cart survives a prepaid order. Today a customer who backs out, returns to the cart and pays again gets
**two** live unpaid orders. Both hold stock, and both can be paid, because they have two different Razorpay
orders. Two layers of protection:

- **App**: before placing a new order, if `PendingPaymentStore` holds a live order for this store, show a
  sheet: "You have an unpaid order #X (₹Y). [Complete payment] [Start a new order]".
- **Server backstop** (for old builds and iOS): in `placeOrder`, **before** the transaction opens, release
  any other `PAYMENT_INITIATED` order of `{userId, storeId}`. It uses the same shared release helper as the
  cron, so it is conditional, checks Razorpay first (Phase 3) and is best-effort. A failure to release never
  blocks checkout; the cron catches it. If Razorpay says the old order was **paid**, the helper settles it
  through `processCapture` and does not cancel it.

---

## 4. Data model changes

**No new collection, no new index, no migration.** Everything is additive:

- `order.constant.js` (additive exports only): `PAYMENT_WINDOW_MINUTES = 15`,
  `RETRY_MIN_REMAINING_SECONDS = 90`, `paymentState` enum
  (`AWAITING_PAYMENT | PAID | EXPIRED | SWITCHED_TO_COD | CANCELLED | NOT_ONLINE`). The cron switches from
  its literal `15` to the constant (same value).
- No new order field. `expiresAt` is derived from `createdAt`. Optional extension (Q5) would need a nullable
  `paymentExpiresAt`, which is **not** proposed for v1.
- `payment.failed` no longer writes `status`, `meta.payment` or `stockRestored` for a `PAYMENT_INITIATED`
  order. It writes an `order_audit_logs` row `order.payment.attempt_failed`
  (`metadata: {paymentId, errorCode, errorReason}`). The action is a free-text string, so the schema does
  not change.
- aabha-dba sign-off, brief: the supersede lookup `{userId, storeId, status: 6}` rides the existing
  `{userId:1, status:1}` index. `payment-status` is an `_id` read on the primary. The cron query is unchanged.

---

## 5. API contract

All customer routes use the existing `jwtUtils.authenticate`, are **owner-scoped** (`{_id, userId}`), read
from the **primary** (a lagging secondary would report "unpaid" right after a capture), and return 404 for
another user's order (never 403, so no id enumeration).

### 5.1 `GET /order/:orderId/payment-status` (new, user package)

Route: register in `packages/user/src/routes/order/router.js` **before** `/:orderId`.
No gateway call and no writes. Safe to poll.

```json
200 {
  "msg": "OK",
  "data": {
    "orderId": "66f…",                 // mongo id
    "orderDisplayId": "HP57099093",
    "status": 6,                       // passed through presentOrderStatus
    "paymentMethod": 1,
    "paymentState": "AWAITING_PAYMENT",
    "amount": 540,                     // order.price: the online amount due, in ₹
    "expiresAt": "2026-09-24T10:15:00.000Z",   // null unless AWAITING_PAYMENT
    "serverTime": "2026-09-24T10:03:28.000Z",  // the client counts down from this, not the phone clock
    "canRetry": true,
    "checkout": {                      // null unless canRetry
      "key": "rzp_test_…",             // razorPayUtils.getRazorPayId(), public key
      "razorpayOrderId": "order_P…",   // order.meta.id, the SAME Razorpay order
      "amountPaise": 54000,            // Math.round(order.price*100), must equal the Razorpay order amount
      "currency": "INR"
    },
    "walletRefund": 0,                 // order.refundedAmount (coins returned + any late-capture refund), EXPIRED only
    "isScheduled": false
  }
}
404 { "msg": "Order not found" }
```

Every new key is additive, and Android reads them all as nullable.

### 5.2 `POST /razorpay/order/:orderId/verify` (new, user package, hemant-payments)

Route: `packages/user/src/routes/razorpay/router.js`, `[jwtUtils.authenticate, validator.verifyPayment]`.

Request:
```json
{ "razorpayPaymentId": "pay_…", "razorpayOrderId": "order_…", "razorpaySignature": "hex" }
```

Server steps. Every "no" answers 200 with the current `payment-status` body, never an error, so the client
just keeps polling:

1. Load the order `{_id, userId}` on the primary. Missing → 404.
2. `razorpayOrderId === order.meta.id`, otherwise stop (an alert-log `verify.order_id_mismatch`).
3. `validatePaymentBySignature(order.meta.id, paymentId, signature)`, otherwise stop (alert-log
   `verify.bad_signature`). Never trust a client-sent status.
4. `razorPayUtils.fetchPaymentsByPaymentId(paymentId)` with a 3s timeout. The entity must satisfy
   `order_id === order.meta.id` **and** `notes.orderId === String(order._id)`. If the notes are missing,
   stop and leave it to the webhook. Never build notes ourselves.
5. `status === "captured"` → `processCapture({ entity, storeId: notes.storeId, effects, deadline: now+6000 })`,
   the **same function** the webhook runs. Then run the effects, and delete the cart (as the webhook does).
   `authorized` or `created` → do nothing.
6. Answer with the fresh `payment-status` body.

Idempotent: calling it N times, or at the same time as the webhook, gives one transition. Suggested
rate limit: 10/min per user (existing limiter pattern, if any; otherwise leave it out of v1 and note it).

### 5.3 `POST /order/place` (existing): additive response keys only

Adds `data.paymentExpiresAt` (ISO) and `data.serverTime` for prepaid orders. Absent or null for COD and
wallet orders. Behaviour change (Q3): releases other unpaid orders of this user in this store **before**
creating the new one.

### 5.4 `POST /order/:orderId/cancel` and `DELETE /order/:orderId` (existing): Q4

Recommended change: a **never-paid `PAYMENT_INITIATED`** order can be cancelled by its owner at any time
inside its 15-minute window, not only in the first 60 s. OPEN orders keep the exact 60 s rule, and scheduled
orders keep their own rule. The write becomes conditional on the status that was read (409 `ORDER_CHANGED`
when it loses).

### 5.5 Webhook `payment.failed` (existing): Q2

For a `PAYMENT_INITIATED` order: **no** status change, **no** restock, **no** coupon or slot release. Write
the audit row only. Orders already in other statuses: unchanged (still skipped).

---

## 6. Step-by-step build order

Each task is one reviewable change. Backend tasks run `cd packages/<pkg> && NODE_ENV=test npx jest`
(in-memory Mongo only; use `/usr/local/bin/node` if the default node breaks jest). Android tasks run
`./gradlew assembleDebug` and the unit tests.

### Phase 0: diagnose and close the races (before any feature work)

**0.1 Diagnose HP57099093** (USER + hemant-payments, read-only). Needs **user approval** before any prod read.
The alternative is for the user to share the damin Order Activity for the order plus its status in the
Razorpay dashboard. Questions to answer:
- (a) the status timeline from the order audit rows;
- (b) `meta.payment` and `refunds[]`;
- (c) `client.av` / `client.bn`, which app build placed it;
- (d) webhook log rows for its `meta.id` (`WEBHOOK_JUST_LOG`, `WEBHOOK_ERROR`);
- (e) the Razorpay payment list for that order.

The outcome decides which of the three failure modes in §0 happened. No code.

**0.2 Cron: cancel only if still unpaid** (hemant-payments).
`packages/cron/src/jobs/payment-initiated-orders.js`: replace `OrderRepository.updateWithOps(order._id, …)`
with `updateWithOpsFiltered({ _id, status: PAYMENT_INITIATED, $or: [{"meta.payment": null}, {"meta.payment.status": {$ne: "captured"}}] }, …)`.
If nothing matches, throw a sentinel inside the transaction, so the restock and the coin refund roll back,
and return "skipped" (info log, not an error). Use `PAYMENT_WINDOW_MINUTES`.
Tests: `packages/cron/__tests__/payment-initiated-orders.test.js`. Add "order became OPEN between read and
write → not cancelled, no restock, no coin refund". Existing cases stay green.

**0.3 Customer cancel: conditional write** (backend platform engineer, hemant review).
`packages/user/src/routes/order/controller.js` `cancel`: `updateWithOps(orderId, …)` becomes
`updateWithOpsFiltered({ _id: orderId, userId, status: order.status }, …)`. No match → abort, 409
`ORDER_CHANGED`. Tests: `order.test.js` / `order-cancel-reason.test.js` stay green, plus a new race case.

**0.4 Constants** (backend platform). `packages/shared/constants/order.constant.js`: add
`PAYMENT_WINDOW_MINUTES`, `RETRY_MIN_REMAINING_SECONDS` and `paymentState`. Additive only. Grep all
importers; none destructure in a way that breaks.

### Phase 1: backend payment truth (deploy before the app)

**1.1 Move the capture pipeline into shared (pure relocation)** (hemant-payments).
Move `processCapture`, `dispatchCapture`, `recordCaptureOnly`, `settleCaptureToWallet`, `inspectCapture`,
`loadCodConversion`, the helpers and constants from `packages/user/src/routes/razorpay/controller.js` into
`packages/shared/utils/razorpay-capture.utils.js`, exported via the shared utils index. The controller
imports them. **No behaviour change.** The proof is that every existing `razorpay*.test.js`
(`-capture-hardening`, `-late-capture`, `-capture-ack-budget`, `-capture-resilience`,
`-capture-primary-read`, `razorpay.test.js`) passes **unmodified**. If any test's mocking depends on the
module path, stop and report; do not edit the tests to fit. Why shared: the cron (Phase 3) and supersede
(1.6) must settle a capture with the same code, and the cron package cannot import the user package.

**1.2 `GET /order/:orderId/payment-status`** (backend platform).
Files:
- `packages/shared/utils/payment-state.utils.js` (new, pure `derivePaymentState(order, now)`);
- `packages/shared/repositories/order.repository.js` (new `getPaymentStateForUser(orderId, userId)`:
  primary read, projection includes `codConversion.convertedAt`, **never** returned raw);
- `packages/user/src/routes/order/{router,validator,controller}.js`.

Tests: new `packages/user/__tests__/order-payment-status.test.js`, covering every row of §3.2, owner
scoping, that the `codConversion` details never leak, and the `canRetry` boundary at 90 s.

**1.3 `POST /razorpay/order/:orderId/verify`** (hemant-payments).
Files: `packages/user/src/routes/razorpay/{router,validator,controller}.js`. Tests: new
`packages/user/__tests__/razorpay-verify.test.js`, with Razorpay mocked, covering:
- bad signature → no write;
- order id mismatch → no write;
- another user's order → 404;
- captured → OPEN exactly once;
- verify and webhook concurrently → one OPEN, one pick task, one admin push;
- verify after the cron cancelled the order → wallet refund branch (existing);
- verify on a COD-converted order → late-capture refund (existing);
- authorized → no change;
- gateway timeout → 200 with AWAITING.

**1.4 `payment.failed` stops releasing** (hemant-payments). **Decision: Q2.**
In `packages/user/src/routes/razorpay/controller.js` `payment.failed`: for `PAYMENT_INITIATED`, write the
audit row only. Update the intentional-behaviour tests:
- `razorpay.test.js`: "should handle payment.failed and update order status to PAYMENT_FAILED",
  "restocks once on payment.failed…", "duplicate payment.failed releases the coupon…";
- `seat-release.test.js`: "frees the seat of a scheduled order whose payment failed";
- the `coupon-checkout.test.js` release case, if it goes through the webhook.

They now assert "stays PAYMENT_INITIATED, nothing released", and a new case asserts "the cron later
releases it exactly once, wallet coins included". **List these test edits in the commit message**: they are
deliberate, not "fixing tests to pass".

**1.5 Customer cancel window for never-paid orders** (backend platform). **Decision: Q4.**
In `cancel`, the `neverPaid` `PAYMENT_INITIATED` branch uses the 15-min window instead of 60 s. Tests
extend `order-cancel-reason.test.js`.

**1.6 Supersede an older unpaid order at checkout** (hemant-payments). **Decision: Q3.**
- New `packages/shared/utils/unpaid-order-release.utils.js`: `releaseUnpaidOrder(order, { source })`, the
  cron's `cancelOne` moved here with the 0.2 filter. The cron calls it, so it is one implementation.
- `placeOrder` and the scheduled branch: before `startTransaction`, find `{userId, storeId, status: 6}` and
  release each one, best-effort with try/catch, never blocking.
- Tests: `packages/cron/__tests__/payment-initiated-orders.test.js` stays green, plus a new
  `packages/user/__tests__/order-supersede-unpaid.test.js`.

**1.7 Additive place-order keys** (backend platform): `paymentExpiresAt`, `serverTime` in both prepaid
responses. Test: the COD response has no new non-null keys (or both are null).

### Phase 2: Android (after Phase 1 is on dev; needs the chanchal-designer spec first)

**2.0 Design spec** (chanchal-designer): screens S1-S7 and the list/detail changes in §7.1. Output:
`haper-misc/docs/plans/payment-confirmation-retry-ui-spec.md`. Android work starts after the user signs off
on it.

**2.1 Data layer** (android platform engineer).
- `data/model/OrderModels.kt`: `PaymentStatusData` (every field nullable), `PaymentCheckout`,
  `VerifyPaymentRequest`; add `paymentExpiresAt`/`serverTime` (nullable) to `PlaceOrderResponseData`.
- `data/api/ApiService.kt`: `getPaymentStatus`, `verifyPayment`.

**2.2 PendingPaymentStore** (android). New `util/PendingPaymentStore.kt` (SharedPreferences, same pattern as
`DevPrefs`). It stores `{orderDbId, displayOrderId, storeId, expiresAtEpochMs}`. Set it right before
`Checkout.open`. Clear it on `PAID`, `SWITCHED_TO_COD`, `CANCELLED`, after S4 is shown once, and on logout.

**2.3 Payment result bus** (android).
- `RazorpayManager.kt`: keep the API. Also publish every result to an app-scoped
  `MutableSharedFlow<PaymentResult>` (replay 1, tagged with the Razorpay order id), so a recreated screen or
  VM still receives it.
- `MainActivity.kt`: pass `paymentData.orderId` and `paymentData.signature` through.
- `showPaymentForm` gains optional `timeoutSeconds: Int?` and `retryMaxCount: Int = 4` (defaulted, so the
  existing caller compiles unchanged).

**2.4 PaymentStatusViewModel** (android; arijit-frontend-arch reviews this one).
New `ui/screens/checkout/PaymentStatusViewModel.kt`. It uses `SavedStateHandle` for `orderDbId` and a
single `StateFlow<PaymentUiState>` (`Confirming | AwaitingPayment | Expired | Paid | SwitchedToCod | Cancelled | CheckFailed`).
- On an SDK success, call `verify` once, then poll `payment-status`: every 2s for 30s, then every 5s up to
  2 min, then stop and show "taking longer" with "Check again".
- Polls **only while the screen is STARTED**, and re-checks on ON_RESUME (the customer coming back from a
  UPI app).
- The countdown uses `expiresAt - serverTime` plus the elapsed monotonic time (`SystemClock.elapsedRealtime`),
  never the wall clock.
- A retry tap first re-fetches the status. It opens checkout only when `canRetry` is true, using the
  **server's** `checkout` block, with `timeout = secondsLeft - 45`.
- A double-tap guard (`isOpeningCheckout`) protects the Pay button.
- Falls back to `GET /order/:id` status mapping if `payment-status` returns 404 (backend not deployed yet).

**2.5 PaymentStatusScreen + navigation** (android).
- New `ui/screens/checkout/PaymentStatusScreen.kt`. Reuse `PaymentFailedScreen` visuals for S2 if the spec
  allows, otherwise retire it.
- `MainActivity.kt` adds the route `paymentStatus/{orderDbId}`.
- `CheckoutScreen.kt`: on an SDK success, navigate to `paymentStatus` (not `onOrderSuccess`). On an SDK
  error, navigate to `paymentStatus` and **delete the `orderVM.cancelOrder(...)` call**. The
  COD/WALLET `else` branch stays byte-identical.
- The `cartVM.clearAll()` and `walletVM.fetchWallet()` calls move to the moment the VM sees `PAID`.

**2.6 Cold-start / resume recovery** (android). `MainActivity.kt`: after auth resolves, if
`PendingPaymentStore` holds an unexpired entry (or one expired less than 30 min ago), navigate to
`paymentStatus/{id}` once.

**2.7 Orders list and detail truthfulness** (android).
- `OrderModels.kt`: `PAYMENT_INITIATED` → `listProgressSegments = 0` and
  `listProgressText = "Payment pending"`.
- `OrdersScreen.kt`: a "Complete payment" button on that card → `paymentStatus/{id}`.
- `OrderDetailScreen.kt`: for `PAYMENT_INITIATED`, "To pay ₹X" instead of "Paid ₹X / Paid via Razorpay",
  plus a "Complete payment" banner.
- `OrderStatus.displayName` is unchanged.

**2.8 Pre-checkout unpaid-order sheet** (android). `CheckoutScreen.kt`: on Pay, if `PendingPaymentStore` has
a live order for this store, show the §3.7 sheet.

**2.9 Analytics** (android; deepanshu-data optional). Events `payment_status_shown{state}`,
`payment_retry_tapped`, `payment_verify_result`, `payment_expired_shown`. Reuse `AnalyticsTracker`.

### Phase 3: backstop against missed webhooks (hemant-payments)

**3.1 Check Razorpay before releasing.** In `unpaid-order-release.utils.js`, before the conditional release,
when `order.meta.id` exists, call `fetchPaymentsByOrderId` (3s timeout, the admin
`verifyNoGatewayPayment` rules: a full page counts as "maybe"):
- **captured** → run `processCapture` for it (the order goes OPEN, or refund per branch) and do not cancel;
- **authorized**, or unverifiable → skip this run, up to `PAYMENT_WINDOW_MINUTES + 15`, then release anyway
  (a late capture is then refunded to the wallet by the existing branch) and alert-log it;
- **nothing held** → release.

Tests: extend the cron test with Razorpay mocked.

### Phase 4: docs and parity

**4.1** New `haper-misc/test-payment-confirmation-retry.md` (the ✅/❌ walkthrough, Razorpay test mode:
`success@razorpay` / `failure@razorpay` UPI, back-out, app kill, expiry, admin COD conversion
mid-flow). Update `haper-misc/test-order-cod-conversion.md` for the Q2 consequence and
`haper-misc/test-order-status.md`.

**4.2** `haper-misc/client-followups.md`: add iOS (`haper-ios/haper/Managers/RazorpayManager.swift`,
`ViewModels/OrderViewModel.swift` very likely have the same flow) and admin (the Q10 warning) rows.

---

## 7. Edge cases and risks

### 7.1 UI states for chanchal-designer to finalise (draft copy, not final)

- **S1 Confirming**: spinner, "Confirming your payment…", "Please don't close the app". After 20 s:
  "This is taking longer than usual. We'll update your order the moment your bank confirms." with
  [Go to my orders]. Never shows success or failure on its own.
- **S2 Complete your payment**: amber clock, "Complete your payment", `#HP…`, ₹X, "Complete within 11:32",
  the last failure reason (from the SDK, for example "Payment was cancelled" or "Your bank declined it"),
  [Pay ₹X] primary, [Cancel order] secondary (Q4), [Back to home] text. After the 3rd failure add the hint
  "Try a different UPI app or card".
- **S3 Retry failed again**: S2 re-rendered with the new reason. No modal stacking.
- **S2 in "time's almost up" mode** (< 90 s): no Pay button. Instead "Time's almost up. Place a new order to
  be safe" [Go to cart].
- **S4 Payment time ran out**: "Payment time ran out", "Order #X was not placed. No money was taken."
  If `walletRefund > 0`: "₹N is back in your Haper wallet." [Place order again] → cart. [Back to home].
- **S5 Paid**: the existing `OrderSuccessScreen`, unchanged.
- **S6 Switched to COD**: "Your order is confirmed. Pay ₹X in cash to the rider." [Track my order].
- **S7 Check failed**: "Couldn't check your payment", [Check again]. Offline-safe.
- **List/detail**: amber "Payment pending" chip, "Complete payment" button, "To pay ₹X". Designer decides
  whether to show the countdown on the list card.

### 7.2 Risks and how each is handled

| Risk | Handling |
|---|---|
| Double charge on retry | Retry reuses `meta.id`. Razorpay refuses a second payment on a paid or authorized order. If two captures still happen (a slow UPI collect), the existing `SECOND_CAPTURE` → wallet refund branch applies (AC11). |
| Duplicate order | The app guard (2.8) plus the server supersede (1.6). "Retry" never calls `/order/place`. |
| Paid order cancelled by the cron (race) | 0.2 conditional write. Phase 3 checks Razorpay before releasing. |
| Paid order stranded because the webhook was lost | Verify (1.3) plus the Phase 3 cron check. |
| Verify and webhook run together | Both go through `processCapture`, whose writes are conditional. Proven by a test in 1.3. |
| Forged verify call | HMAC signature check plus a server-side `payments.fetch`. The client-sent status is never trusted. The owner is scoped. |
| Sheet open past expiry | Checkout `timeout = secondsLeft - 45`, and no retry under 90 s. Anything later → the existing CANCELLED-branch wallet refund. |
| Phone clock wrong | The countdown comes from `serverTime`. |
| Process death in the UPI app | `PendingPaymentStore` plus resume recovery (2.6). |
| Admin COD conversion vs customer | See §3.6. `PAYMENT_INITIATED` cannot be converted. S4 re-checks before "Place order again". |
| Legacy `PAYMENT_FAILED` rows captured later | Still in `REOPENABLE_ON_CAPTURE`, so they go OPEN **without** re-taking stock (a pre-existing bug). Not fixed here; follow-up F1. After Q2 no new rows reach this state. |
| Polling load | One `_id` primary read every 2-5 s for one screen, stopping at 2 min. Negligible. |
| Hard to reverse? | Nothing needs a data migration. Q2 and Q3 are code-only and revert cleanly. **Deploy order matters**: backend before app. The app falls back if `payment-status` returns 404. |

### 7.3 Backward compatibility: existing behaviour this plan touches

| Existing functionality | Stays working because |
|---|---|
| COD / WALLET / STORE_PICKUP checkout (Android) | The non-Razorpay `else` branch in `CheckoutScreen` is untouched. The backend creates them OPEN exactly as now. The new response keys are null or absent for them. |
| Old Android builds (≤ v2.5.3) and iOS | Every backend change is additive. Old builds keep the SDK-success → success-screen behaviour (unchanged, not worse). Their auto-cancel still works within 60 s, and within 15 min if Q4 is adopted. **One visible difference with Q2**: after a failed attempt an old build's order stays in Active as "We have your order" for up to 15 min, instead of vanishing as `PAYMENT_FAILED`. The same already happens today when the customer only dismisses the sheet (no `payment.failed` fires). |
| Capture webhook | 1.1 is a pure move. All capture tests pass unmodified. |
| `payment.failed` webhook | Changes only for `PAYMENT_INITIATED` (Q2). The "already returned" skip list is unchanged. The customer "Payment Failed ⚠️" push goes away with it; it came from the status hook (Q2). |
| Abandonment cron | Same schedule, same window (constant = 15), same release steps. It only refuses to cancel an order that moved (0.2) or has money at Razorpay (Phase 3). |
| Admin convert-to-COD (Mode A/B) | No code change. Mode A still covers `PAYMENT_CANCELLED` and legacy `PAYMENT_FAILED`. Its `codNoCaptureFilter` and gateway check are untouched. |
| `GET /order/:id`, `/order/history`, `/order` | Unchanged. `payment-status` is a separate route registered before `/:orderId`. |
| `GET /razorpay/order/:orderId` | Unchanged. |
| Coupon hold / slot seat / gift cap | Released by the cron as today. Q2 just stops the earlier release by `payment.failed`. The cron's release steps are unchanged and idempotent. |
| Admin order list/filters on `PAYMENT_FAILED` | Keep working. Fewer new rows land there. |

---

## 8. Test strategy

**Backend unit/integration (jest, in-memory Mongo only, run per package):**
- `derivePaymentState`: pure unit table test (every status × COD-converted × time left).
- `payment-status` route: owner scoping, primary read, no `codConversion` leak, the `canRetry` boundary.
- `verify` route: signature, mismatch, captured/authorized/timeout, idempotency, **concurrent verify and
  webhook** (the key money test), and verify after cron / after COD conversion.
- Cron: race, "OPEN before write" → no release; Phase 3 gateway branches.
- Cancel: the conditional-write race; the Q4 window.
- `payment.failed` (Q2): stays PAYMENT_INITIATED, then the cron releases exactly once, wallet coins included.
- Supersede: the old unpaid order is released and the new one created; supersede failure never blocks
  checkout; an old order found paid at Razorpay is settled, not cancelled.
- Regression: every existing `razorpay*.test.js`, `order*.test.js`, `seat-release`, `coupon-checkout`, and
  the admin `convert-to-cod` tests are green. The edits listed in 1.4 are the only ones allowed.

**Android:**
- Unit (`app/src/test`): `PaymentStatusViewModel` state mapping, polling schedule with a test dispatcher,
  stop on PAID, 404 fallback, countdown from `serverTime`, and the double-tap guard. Update
  `OrderViewModelTest` if placeOrder callers change. `./gradlew assembleDebug` must pass.
- Manual on dev with Razorpay **test mode**: success, failure, back-out → retry → success, 3 failures,
  kill the app in the UPI app, expiry with the cron, admin convert while the customer is on S4, and COD
  unchanged. Written in the 4.1 guide.

---

## 9. Open questions for the user (decide before building)

- **Q1 (blocking Phase 0.1).** May we read order HP57099093 on **prod** (read-only: the order, its audit
  rows, webhook logs)? Or can you share its damin "Order Activity" page and the Razorpay dashboard status?
  We need to know which of the three failure modes in §0 hit this customer, and which app version they had.
- **Q2 (recommended: YES).** Stop treating one failed payment attempt as a failed order. The order stays
  "payment pending" until paid or until the 15 minutes run out, and the customer can retry. Side effects:
  (a) the "Payment Failed ⚠️ please try again" push goes away (the new screen replaces it); (b) an admin can
  switch such an order to Cash on Delivery only after the 15 minutes, not right after the failed attempt.
- **Q3 (recommended: YES).** When a customer starts a new checkout while an older unpaid order exists in the
  same store, automatically cancel the older one. Example: Riya backs out, edits her cart and pays; the
  first unpaid order is released so its stock is not held twice.
- **Q4 (recommended: YES).** Let a customer cancel their own **unpaid** order at any time in the 15 minutes
  (today: only in the first 60 seconds).
- **Q5 (recommended: keep 15 min fixed).** Should a retry extend the 15-minute hold? Extending keeps stock
  locked longer. Fixed is simpler, and we block retry in the last 90 seconds.
- **Q6.** When money arrives after the order was cancelled, or twice, the system refunds it to the **Haper
  wallet** (existing behaviour), not to the bank or UPI. Keep this for now?
- **Q7 (recommended: NO for v1).** Should the customer get a "Pay by cash instead" button on the retry
  screen? Today only admins can switch an order to cash.
- **Q8 (recommended: go to cart).** "Place order again" after expiry opens the existing cart, which normally
  still has the items. If the cart was emptied, show "Your cart is empty". A proper "add these items back"
  (reorder) feature does not exist today and would be separate work.
- **Q9 (needed for Phase 3).** In the Razorpay dashboard, is **auto-capture** on, and what is the
  "late authorization" setting? This decides how long the cron waits on an `authorized` payment.
- **Q10.** Should the admin "Switch to COD" dialog warn when the customer has placed a newer order since?
  (Small admin follow-up.)
- **Q11.** iOS: same fix right after Android, or later? (Tracked in `client-followups.md`.)

## 10. Follow-ups found while planning (not in scope; raised here, not left as silent gaps)

- **F1.** A capture on a legacy `PAYMENT_FAILED` order goes OPEN without re-taking stock or the slot
  (`REOPENABLE_ON_CAPTURE`).
- **F2.** The `payment.failed` status write is `_id`-only (moot if Q2 is adopted).
- **F3.** The Razorpay Android SDK `1.6.33`: check the latest stable 1.6.x before release (the change is
  tiny, and it is where `timeout` and `retry.max_count` behaviour is verified).
- **F4.** No customer push when a prepaid order goes OPEN (the capture uses `updateOne` on purpose). Consider
  an explicit "Order confirmed" push later.

## 11. Who builds what

| Part | Specialist |
|---|---|
| 0.1 diagnosis | USER approval, then hemant-payments (read-only) |
| 0.2, 1.1, 1.3, 1.4, 1.6, Phase 3 | **hemant-payments** (money paths) |
| 0.3, 0.4, 1.2, 1.5, 1.7 | backend platform engineer (hemant reviews 0.3) |
| 2.0 screen spec S1-S7 + list/detail | **chanchal-designer** (user signs off before Android work) |
| 2.1-2.9 | Android platform engineer |
| 2.4 state machine review | arijit-frontend-arch (short review) |
| §4 index note | aabha-dba (quick confirmation, no new index) |
| 2.9 analytics | deepanshu-data (optional) |
| Not needed | stas-realtime (polling chosen), rohit-ai |
| 4.1, 4.2 docs | whoever lands each phase, in the same session |

Sources (Razorpay behaviour):
[About Orders](https://razorpay.com/docs/payments/orders/?preferred-country=IN),
[Create an Order](https://razorpay.com/docs/api/orders/create/),
[Standard Checkout options](https://razorpay.com/docs/payment-gateway/web-integration/standard/checkout-options).

---

## 12. Addendum: COD conversion + edit-ability + no-refund for unpaid orders

Added 2026-09-24 (shavinder-planner), same approval gate as the rest of this plan. Scope: the three
**unpaid online** statuses: `PAYMENT_INITIATED` (6), `PAYMENT_FAILED` (8), `PAYMENT_CANCELLED` (9).
In this section "unpaid" always means "in one of these three statuses **and** no captured payment on record".

### 12.0 What this addendum changes in §1-11 (read first)

| Earlier text | Now |
|---|---|
| §2 row "Admin convert-to-COD": "`PAYMENT_INITIATED` is deliberately NOT convertible" | It becomes convertible (new **Mode C**, §12.2). Modes A and B are unchanged. |
| §3.6 bullet 1 ("the admin **cannot** convert … waits for the cron") | Replaced by §12.2. The admin can convert while the customer is still on the payment screen; the safety net is §12.2.3. |
| §7.2 row "Admin COD conversion vs customer" | Now: Mode C + the §12.2.3 net. |
| §7.3 row "Admin convert-to-COD (Mode A/B) — No code change" | Mode C is added in the same handler. Modes A and B stay byte-identical (their tests pass unmodified). |
| §9 Q2 side effect (b) ("admin can switch only after the 15 minutes") | Moot: Mode C lets the admin switch at once. |
| §3.2 table, row `PAYMENT_INITIATED, now < expiresAt` | One extra case: if the order was **edited by an admin** (`onlinePaymentClosedAt` set), `canRetry:false`, `checkout:null`, new optional key `retryBlockedReason:"ORDER_EDITED"` (§12.3.4). |
| Phase 3.1 "captured → run processCapture … and do not cancel" | Exception: an order with `onlinePaymentClosedAt` is **still released** after its capture is settled to the wallet (§12.3.4). |

### 12.1 Goal and acceptance criteria

**Goal (plain words).** When a customer's online payment did not go through, a store admin or super admin
can (1) switch the order to Cash on Delivery even if it is still "payment pending", and (2) change its
items (add, remove, change quantity) in any of the three unpaid statuses, exactly like a normal order.
Because the customer never actually paid online, **neither action may ever put money into the
customer's wallet**. Example: Riya's ₹540 UPI payment is stuck at "payment pending". She calls the store:
"remove the milk, I'll pay cash". The store admin removes the milk (bill becomes ₹480) and switches the
order to COD. The rider collects ₹480. Riya's wallet does not change. If her old ₹540 UPI payment somehow
completes later, the ₹540 goes to her wallet (that money really arrived, so it must go back to her) and
the order stays cash.

Acceptance criteria:

- [ ] AC-A1. A store admin (own store only) and a super admin can switch a `PAYMENT_INITIATED` Razorpay
      order to COD. Result: status OPEN, method COD, one pick task, one conversion audit row, coupon
      confirmed. Stock counts, the wallet and the delivery slot **do not change** (they are already held).
- [ ] AC-A2. The switch is refused with 409 when Razorpay shows a captured or authorized payment for that
      order, and with 503 when Razorpay cannot be reached (for `PAYMENT_INITIATED`, at any order value).
- [ ] AC-A3. The customer's payment completes after the switch: the order stays COD, the captured amount
      is credited to the wallet exactly once, the customer and the store get the existing "paid after
      switch" pushes, and the rider still collects `price`. (Existing behaviour, now also for Mode C.)
- [ ] AC-A4. The 15-minute cron, a customer cancel, a `payment.failed` event or the supersede step (1.6)
      never cancels, restocks or refunds an order that was switched to COD.
- [ ] AC-A5. After Phase 2 ships: the customer's app shows "Confirmed as Cash on Delivery" (S6), never
      a Pay button, for a switched order.
- [ ] AC-B1. "Edit Items" is enabled in the admin order modal for all three statuses. The admin can add
      items, remove items and raise or lower quantities. No "paid order" limits, no refund reason asked,
      no "₹X will be credited" preview.
- [ ] AC-B2. `PAYMENT_INITIATED` edit: stock moves exactly like an OPEN edit (the stock is still held).
      `PAYMENT_CANCELLED` / `PAYMENT_FAILED` edit: **no** stock moves at all (their stock was already
      given back). A later Mode-A switch deducts stock for the **edited** item list.
- [ ] AC-B3. After an edit, `price` = items + the original delivery/platform fees − the wallet coins used
      at checkout. That is the cash a later COD switch collects.
- [ ] AC-B4. `PAYMENT_INITIATED` edit: the save dialog warns "Online payment for this order will close.
      Switch it to Cash on Delivery, or it auto-cancels at HH:MM". After saving, the customer can no longer
      pay it online (retry closed). A payment that still lands is credited to the wallet and the order
      is **not** made live at the old amount.
- [ ] AC-B5. An edit on a `PAYMENT_INITIATED`/`PAYMENT_FAILED` order is refused (409) when Razorpay shows a
      captured or authorized payment, and (503) when Razorpay cannot be reached.
- [ ] AC-C1. For all three statuses, neither the COD switch nor an item edit ever creates a `refunds[]`
      entry, changes `refundedAmount`, credits the wallet or sends "Refund credited", **even when the
      customer used wallet coins**.
- [ ] AC-C2. An edit that would make the bill smaller than the wallet coins already used is refused with
      a clear message (pending QA2).
- [ ] AC-C3. Editing OPEN/paid/COD orders, picker out-of-stock, Modes A and B, and every existing
      refund path behave exactly as today (their existing tests pass unmodified).

### 12.2 COD conversion from `PAYMENT_INITIATED` (Mode C)

#### 12.2.1 Role gating: already correct, no change

- Backend: `packages/admin/src/routes/order/router.js` `POST /:orderId/convert-to-cod` =
  `requireRole(SUPER_ADMIN, STORE_ADMIN, MANAGER, SUPPORT)` + `requirePermission(ORDERS.CONVERT_TO_COD)`.
  `checkPermission` (`packages/admin/src/middleware/permission.js`) lets super_admin and store_admin
  through always, so **both roles already have it**. Managers and support need the permission string.
  Store tenancy is enforced inside `convertToCod` (explicit `STORE_CONTEXT_REQUIRED` / `FORBIDDEN_STORE`).
- Admin UI: `haper-admin/src/pages/Orders/convertToCod.ts` `COD_CONVERT_ROLES` + `canConvertToCod`
  mirror it. No gating change for Mode C.

#### 12.2.2 Why Mode C is its own branch (not Mode A, not Mode B)

A `PAYMENT_INITIATED` order still **holds** its stock, wallet coins, slot seat and HELD coupon (taken in
`placeOrder`). So:
- Mode A (`reopenToOpen`) is wrong: it re-deducts stock (double deduction) and claws back refunds (there
  are none). **Do not add `PAYMENT_INITIATED` to `COD_MODE_A_FROM`.**
- Mode B is wrong: its `$set` only flips the method; the status must also move to OPEN.

Mode C = one conditional write, no money movement:

```
filter: { _id, status: PAYMENT_INITIATED, paymentMethod: RAZORPAY, [storeId if not super admin],
          $and: [ codNoCaptureFilter(), refundUtils.notUnclawedRefundFilter() ] }
$set:   { status: OPEN, paymentMethod: COD, codConversion: {…, originalStatus: 6} }
```

Written with `OrderRepository.updateWithOpsFiltered` (a `findOneAndUpdate`), so the existing
`orders.schema.js` post-hook fires `open-order-created` (pick task via `ensurePickTaskForOrder`, store
email) and `order-status-changed`, exactly as Mode A's reopen does today. Then the existing post-commit
steps run unchanged: `confirmConversionCouponHold` (finds the hold HELD → confirms it, like Mode B),
`COD_CONVERTED` customer push, realtime event. No rider push (no rider yet).

#### 12.2.3 The late-payment race: can we void the Razorpay order? No. Recommendation

**Research (2026-09-24):** Razorpay has **no API to cancel, void or expire an Order**. `PATCH /v1/orders/:id`
can change only `notes`; `amount` is immutable. Orders never expire on their own (open feature request
razorpay-node#426, no response). So "best-effort void the pending Razorpay order" is **not possible**.
Changing `notes` is not a substitute: our DB is the source of truth, and tampering with `notes.orderId`
would orphan a real capture (worse).

**Recommendation: no void step. The safety net is the existing one, plus two tightenings.** In order:

1. **Before the switch, ask Razorpay** (existing `verifyNoGatewayPayment`): a captured or `authorized`
   payment → 409, no switch. This is the step that catches "the customer is paying right now".
2. **Tightening 1: fail closed for Mode C when Razorpay can't be reached, at any value** (QA4). Modes A/B
   keep the ₹5,000 fail-open rule. Why: `PAYMENT_INITIATED` is exactly the state where a payment is most
   likely in flight; the admin can retry in a minute, or wait for the cron and use Mode A.
3. **The write itself re-checks** status + "no capture" in its filter (`codNoCaptureFilter`). If the
   capture webhook wins, the switch loses (409). If the switch wins, the capture webhook's reopen
   `updateOne` filter (`paymentMethod: {$ne: COD}`, `codConversion.convertedAt: {$exists:false}`) no
   longer matches, the retry pass re-reads, and `dispatchCapture`'s existing COD-converted branch
   (checked **before** `REOPENABLE_ON_CAPTURE`) credits the whole capture to the wallet. Verified in
   `packages/user/src/routes/razorpay/controller.js` `dispatchCapture` + `loadCodConversion`:
   **zero capture-pipeline change is needed for Mode C.** The same holds for `/verify` (1.3), which
   calls the same `processCapture`.
4. **Tightening 2: the customer can no longer start a new attempt.** After Phase 2, `payment-status`
   returns `SWITCHED_TO_COD`, the retry tap re-fetches status first (2.4), and any open sheet closes at
   its `timeout`. The only remaining window is a payment already approved in the UPI app in the same
   seconds; that lands in step 3's wallet credit.

This is consistent with decision 3.1.2 (the gateway is the idempotency; we never mint a second Razorpay
order) and with the conditional-write pattern used everywhere in `processCapture`.

**Clarification for rule 3 ("no refund for these statuses"):** the wallet credit in step 3 is **not** a
refund of uncaptured money. It only happens when Razorpay really took the customer's money after the
switch. Skipping it would make the customer pay twice (online and in cash). It stays (QA3).

#### 12.2.4 Hard prerequisites (must be on dev before Mode C)

Mode C turns a `PAYMENT_INITIATED` order into a live cash order while three other writers may still be
holding a stale "INITIATED" read. Today each of them writes by `_id` only and would **cancel, restock and
coin-refund a live COD order**:
- the abandonment cron → task **0.2** (conditional on `status: PAYMENT_INITIATED`);
- the customer cancel → task **0.3**;
- `payment.failed` → task **1.4** (Q2) or, if Q2 is declined, a conditional-write fix for F2
  (`status: PAYMENT_INITIATED` in the filter).

The supersede step (1.6) uses the 0.2 helper, so it is already conditional: whichever of
"supersede" and "switch" writes first wins, and the other gets "order changed".

### 12.3 Item edit on the three unpaid statuses

#### 12.3.1 What blocks it today (verified)

| Layer | File / function | Guard |
|---|---|---|
| Backend | `packages/admin/src/routes/order/controller.js` `editOrder` | `if (order.status === PAYMENT_INITIATED)` → 400 `PAYMENT_PENDING_MSG`; then `allowedStatuses = [OPEN, ASSIGNED, PROCESSING, OUT_FOR_DELIVERY]` → 400 "Order is not ongoing" for `PAYMENT_CANCELLED`/`PAYMENT_FAILED`. |
| Backend | same, `prepaid` block | `isPrepaid(RAZORPAY)` is true → "only removals / no qty increase" + **refund reason required**. Wrong for an order nobody paid. |
| Shared | `packages/shared/utils/order-edit.utils.js` `applyItemEdit` | Moves stock on every line; for prepaid methods `creditApplied = 0` (price becomes gross, not net of coins); refunds via `refundToWallet` up to `computeRefundOwed` (6abe178). |
| Admin UI | `haper-admin/src/pages/Orders/OrderDetailsModal.tsx` | `canEditItems = !paymentPending` (only INITIATED disabled; CANCELLED/FAILED show the button and get a backend 400). `isPrepaidOrder` drives the qty cap, `computePreviewRefund`, the refund-reason box and the "₹X will be credited" confirm. |
| Admin UI | `haper-admin/src/utils/orders.ts` | `isPaymentPending`, `PAYMENT_PENDING_NOTE` ("can't be actioned manually"). |

Role gate: `PATCH /edit-order/:orderId` = `requirePermission(ORDERS.EDIT_ITEMS)`, so store_admin and
super_admin already pass (managers get it in `MANAGER_PRESET`). No gating change needed (QA5).

#### 12.3.2 How an unpaid edit differs from an OPEN edit (the scope)

An OPEN edit changes the lines, moves stock, recomputes totals and, for paid orders, refunds removed lines.
For unpaid orders there is no picking yet (pick tasks exist only from OPEN on), so "edit" = change the
order record only, with these differences:

| Concern | OPEN edit (today) | Unpaid edit (new) |
|---|---|---|
| Add items / raise qty | Blocked for prepaid | **Allowed** (nobody has paid) |
| Stock | Reserve/return per line | `stockRestored !== true` (INITIATED): same as OPEN. `stockRestored === true` (CANCELLED, FAILED): **no stock movement**; Mode-A reopen later deducts the edited list via `decrementIfAvailable`. Keyed on the `stockRestored` fact, not on the status. |
| `price` | Prepaid: gross (items + fees) | **Net**: `max(0, gross − meta.walletUsed)`, the same meaning `placeOrder` gave it, so a later COD switch collects the right cash. `walletUsed` in full because the coins are still held (INITIATED/FAILED) or will be taken back by the Mode-A clawback (CANCELLED). |
| Refund | Up to `computeRefundOwed` | **Never.** |
| Coins larger than the new bill | COD path credits the surplus | **Refused** 409 `COINS_EXCEED_TOTAL` (QA2) |
| Online payment afterwards | n/a | INITIATED/FAILED: **closed** (§12.3.4) |
| Gift lines, frozen salePrice, discount + cost snapshots, fees | Carried | Carried, same code |
| Coupon minimum after shrinking | Not re-checked | Not re-checked (same as OPEN) |

A real use for CANCELLED/FAILED edits: Mode A fails with `OUT_OF_STOCK` because one item sold out after
the cancel. The admin removes that line, then switches to COD.

#### 12.3.3 Why the 6abe178 cap is not enough (the refund guard is required)

6abe178 caps an edit refund at `computeRefundOwed(order).amount` = captured + `walletUsed` − `refundedAmount`.
For the three statuses:
- `PAYMENT_CANCELLED`: the cron already credited `walletUsed` (`refundedAmount = walletUsed`) → cap 0 →
  already a no-op.
- `PAYMENT_INITIATED` and `PAYMENT_FAILED`: coins are still held (`refundedAmount = 0`) → cap =
  `walletUsed` → **removing items would credit the coins to the wallet.** Then, for INITIATED, the cron's
  cancel (`packages/cron/src/jobs/payment-initiated-orders.js`) credits **`walletUsed` again** (it refunds
  `walletUsed`, not `walletUsed − refundedAmount`): the customer gets the coins twice.

So the unpaid path must skip the refund branch entirely, not rely on the cap.

#### 12.3.4 Closing online payment after an INITIATED/FAILED edit

A Razorpay order's amount cannot change (see 12.2.3), and minting a second Razorpay order breaks decision
3.1.2 (two payable orders = double charge). So after an admin edit, **the old online payment can no longer
be allowed to make the order live**: `processCapture` does not compare the amount, and a ₹540 capture
would turn a ₹480 order OPEN with ₹60 silently kept (or a raised order OPEN underpaid).

Mechanism: one new nullable field, **`onlinePaymentClosedAt: Date`** (no schema default).
- Stamped by the unpaid edit (`$min`, so the first edit's time is kept).
- `dispatchCapture`: a new branch placed **after** the COD-converted branch and **before**
  `REOPENABLE_ON_CAPTURE`: `REOPENABLE_ON_CAPTURE.includes(status) && order.onlinePaymentClosedAt` →
  `settleCaptureToWallet` of the whole capture, note `…(pay <id>)` (the existing idempotency marker),
  filter `{status, onlinePaymentClosedAt: {$ne: null}}`, audit `order.payment.closed_capture_refunded`,
  customer push. It **does not write `meta.payment`**: the 0.2 cron filter ("no captured payment") must
  still let the cron cancel this order and return its coins.
- The existing reopen `updateOne` filter gains `onlinePaymentClosedAt: null` (matches missing **and** null).
  Edit-vs-capture race: capture first → the edit's filter fails (409). Edit first → the reopen matches
  nothing → RETRY pass → the new branch credits the wallet.
- Phase 3.1: after `processCapture` settles a capture on a closed order, re-read; still INITIATED + closed
  → release it (do not "skip").
- Phase 1.2: `derivePaymentState` → `canRetry:false`, `checkout:null`, `retryBlockedReason:"ORDER_EDITED"`.
  chanchal-designer adds copy to S2: "The store changed your order. They'll call you, or place a new order."
- Not stamped for CANCELLED (a capture there already goes to the wallet via `CANCELLED_STATES`), but
  stamping it too is harmless; the plan stamps only INITIATED and FAILED.

Result: an edited INITIATED order is completed only through a COD switch, or it expires at 15 minutes and
the cron returns the coins once. The admin UI says so before saving (AC-B4). QA1 offers a simpler
alternative.

### 12.4 No-refund guarantee: every branch

| Action | Code branch | Today | Change |
|---|---|---|---|
| COD switch Mode A (CANCELLED/FAILED) | `convertToCod` → `reopenToOpen` (`reopen.service.js`) | No refund call. The only money move is the **clawback** (a wallet **debit** of what the cron credited). | None. Add a test asserting no `refunds[]` push and no credit. |
| COD switch Mode B | `convertToCod` `updateWithOpsFiltered` | No money call. | None. |
| COD switch Mode C (new) | `convertToCod`, new branch | n/a | By construction: no `refundUtils`, `WalletRepository` or stock call in the branch. Test: wallet, `refundedAmount`, `refunds[]` and stock unchanged. |
| Item edit, unpaid | `applyItemEdit` refund block (`if (prepaid) … else …` then `if (Math.floor(refundAmount) >= 1) refundToWallet`) | Unreachable today (the controller blocks these statuses). Would credit coins for INITIATED/FAILED once unblocked (12.3.3). | New `unpaidOnline` flag: `refundAmount = 0`, the refund block and `refundToWallet` are **skipped entirely** (not called with ₹0: `refundToWallet` throws 400 on an amount that floors to 0). |
| Item edit push | `editOrder` "Refund credited" push, gated on `refundAmount > 0` | n/a | Stays silent because `refundAmount` is 0. |
| Late capture after switch/edit | `dispatchCapture` COD-converted branch / new closed branch | Wallet credit of **real captured** money | Keep (QA3). |
| Picker OOS | `packages/picking` task controller | Pick tasks exist only after OPEN | Unaffected. |

### 12.5 Data model

- `packages/shared/models/orders.schema.js`: `onlinePaymentClosedAt: { type: Date }`, **no default**
  (a `default: null` would store `null` on every new order; the filters use `null`-matching anyway so
  either works, but no default keeps old and new documents identical). No index: it is only read on
  `_id` lookups. aabha-dba: quick confirmation only.
- Exclusion projections (`CUSTOMER_SAFE_PROJECTION`) return it automatically. It is a harmless date;
  old Android/iOS builds ignore unknown keys. Inclusion projections that must learn it: only the new
  `getPaymentStateForUser` (1.2). `freshOrderRaw` in the capture controller does not need it (the new
  branch reads the full `getByOrderIdPrimary` document).
- `packages/shared/constants/order.constant.js`: additive `UNPAID_ONLINE_STATUSES = [PAYMENT_INITIATED,
  PAYMENT_FAILED, PAYMENT_CANCELLED]`.
- No migration, no backfill.

### 12.6 API contract changes

- `POST /admin/order/:orderId/convert-to-cod`: request unchanged. It now also accepts
  `PAYMENT_INITIATED`. Response `data.mode` gains the value `"confirm_and_convert"`. The admin UI's
  `codSuccessToast` already falls back to generic copy for an unknown mode, so an older admin bundle
  still works. New refusal for Mode C: 503 `GATEWAY_UNVERIFIABLE` at any value.
- `PATCH /admin/order/edit-order/:orderId`: request unchanged (`refundReason` is ignored for unpaid
  orders). New refusals: 409 `PAYMENT_ALREADY_CAPTURED` (captured on record, or Razorpay shows
  captured/authorized), 503 `GATEWAY_UNVERIFIABLE`, 409 `COINS_EXCEED_TOTAL`, 409 `ORDER_CHANGED`.
  Response `data.refundAmount` is always 0 for unpaid orders.
- `GET /order/:orderId/payment-status` (1.2, not shipped yet): additive `retryBlockedReason` (nullable).

### 12.7 Build order (after Phase 0.2 + 0.3, and 1.4 or the F2 fix; each task one reviewable change)

**A.1 Constants + field** (backend platform). `order.constant.js` `UNPAID_ONLINE_STATUSES`;
`orders.schema.js` `onlinePaymentClosedAt`. Grep every `OrderConstants` destructure. Test: extend
`packages/admin/__tests__/cod-conversion-constants-schema.test.js`.

**A.2 Capture: the closed-order branch** (hemant-payments). Ship **before** A.4: it is inert until an
order is stamped. File: `packages/user/src/routes/razorpay/controller.js` `dispatchCapture` (or
`packages/shared/utils/razorpay-capture.utils.js` if 1.1 has landed). New branch + reopen-filter clause
as in 12.3.4. Tests: new `packages/user/__tests__/razorpay-closed-capture.test.js`: closed INITIATED →
wallet credit once, status unchanged, `meta.payment` unwritten; redelivery → no second credit; edit-vs-
capture both orders; unstamped INITIATED → OPEN exactly as today. All existing `razorpay*.test.js` pass
unmodified.

**A.3 Convert-to-COD Mode C** (hemant-payments). File: `packages/admin/src/routes/order/controller.js`:
- new `COD_MODE_C_FROM = [orderStatus.PAYMENT_INITIATED]` next to `COD_MODE_A_FROM`/`COD_MODE_B_FROM`;
- `convertToCod` pre-read `convertible` includes Mode C;
- after the `!isModeA && !isModeB` check, add `isModeC`;
- in the `gatewayCheck.unverifiable` block, `failClosed = isModeC || …`;
- Mode C write branch per 12.2.2; `mode = "confirm_and_convert"`; audit metadata `mode` + `originalStatus: 6`.
Tests: `packages/admin/__tests__/order-convert-to-cod.test.js`: **deliberately** remove the
`["PAYMENT_INITIATED", …]` row from the "refuses a %s order" `it.each` (list it in the commit message).
New cases: store admin own store ✅, other store 403, super admin ✅; OPEN + COD + pick task once; stock,
wallet, slot and coupon-hold counts unchanged apart from the coupon confirm; Razorpay authorized → 409;
Razorpay down → 503 even for ₹300; capture landing first → 409; switch first then capture → wallet credit
once (reuse the `razorpay-late-capture` harness); cron after the switch → not cancelled (needs 0.2).

**A.4 Unpaid item edit** (hemant-payments; money core).
- `packages/shared/utils/order-edit.utils.js` `applyItemEdit`: new optional args `unpaidOnline = false`
  and `extraFilter = null`, both defaulting to today's behaviour. When `unpaidOnline`: stock-neutral if
  `order.stockRestored === true` (skip both `atomicAdjustStock` calls and the removal restock, still load
  the master to validate the item); `creditApplied = walletUsed`; refuse `COINS_EXCEED_TOTAL` when
  `grossPrice < creditApplied`; `refundAmount = 0` and skip the refund block; `$min:
  {onlinePaymentClosedAt: now}` for INITIATED/FAILED; write via `updateWithOpsFiltered({_id, ...extraFilter})`
  and throw 409 `ORDER_CHANGED` on no match.
- `packages/admin/src/routes/order/controller.js` `editOrder`: replace the `PAYMENT_INITIATED` 400 and
  extend `allowedStatuses` with `UNPAID_ONLINE_STATUSES`; `unpaid = UNPAID_ONLINE_STATUSES.includes(status)`;
  captured on record → 409; for INITIATED/FAILED run `verifyNoGatewayPayment` **before** the transaction
  opens (same shape as `convertToCod`: pre-read on primary, then re-assert the Razorpay order id inside),
  fail closed; skip the `prepaid` qty/refund-reason block when `unpaid`; pass `unpaidOnline: unpaid`,
  `extraFilter: {status: order.status, $and: [codNoCaptureFilter()]}`; audit metadata `unpaid: true`.
- Tests:
  - `packages/admin/__tests__/order-payment-pending.test.js`: **deliberately** flip "rejects editing
    items on a PAYMENT_INITIATED order" to the new 200 behaviour (commit message). The mark-status,
    reassign and gift-slot cases stay as they are.
  - New `packages/admin/__tests__/order-edit-unpaid-status.test.js`, for each of the 3 statuses ×
    {no coins, coins}: add/remove/raise allowed; wallet, `refundedAmount` and `refunds[]` unchanged; no
    push; stock moves only for INITIATED; `price` net of coins; `COINS_EXCEED_TOTAL`; captured → 409;
    Razorpay authorized/down → 409/503; INITIATED edit then cron → coins back exactly once; CANCELLED edit
    then Mode A → edited list deducted, clawback correct; edit then Mode C → `cashToCollect` = new price.
  - `order-edit-unpaid-refund.test.js`, `order-edit-cod-wallet.test.js`, `order-edit-*.test.js`,
    `order-convert-to-cod-edit-limit.test.js` pass **unmodified** (the OPEN-order coin refund at line 116
    of `order-edit-unpaid-refund.test.js` is intentionally untouched).

**A.5 Admin UI** (admin/web platform engineer; copy from chanchal-designer). Files:
- `src/utils/orders.ts`: `isUnpaidOnline(order)`; `PAYMENT_PENDING_NOTE` copy → "Payment pending. You
  can edit items or switch to Cash on Delivery; other actions wait until the payment resolves."
- `src/pages/Orders/OrderDetailsModal.tsx`: `canEditItems` true for the three statuses (status select,
  save-status and rider assign stay disabled for INITIATED); `isPrepaidOrder && !unpaid` for the qty cap,
  `computePreviewRefund`, refund-reason box and "Paid order" hint; for unpaid show "Customer will pay
  ₹X" (items + fees − coins); INITIATED save confirm per AC-B4, then offer "Switch to COD now".
- `src/pages/Orders/convertToCod.ts`: `MODE_C_STATUSES = ['PAYMENT_INITIATED']`, `CodMode` union +
  `'confirm_and_convert'`, `COD_HELPER` copy ("Payment is still pending. The customer will pay cash;
  if their online payment still arrives, it goes to their wallet."), `buildCodConfirm` bullets (stock
  and slot stay as they are), `codSuccessToast`.
- Tests: `convertToCod.test.ts` "row 5: PAYMENT_INITIATED → hidden" **deliberately** becomes "available,
  confirm_and_convert"; `OrderDetailsModal.cod.test.tsx` + a new unpaid-edit case. Check: `tsc -b`,
  `eslint` (no new problems over the 113 baseline), Vitest still exactly the 5 known failures.

**A.6 Customer-facing wiring** (with 1.2 and Phase 3): `retryBlockedReason` in `derivePaymentState`;
the 3.1 release exception. Folded into those tasks if they are not built yet.

**A.7 Docs.** Update `haper-misc/test-order-cod-conversion.md` (Mode C steps, the late-capture check);
new `haper-misc/test-order-edit-unpaid.md` (✅/❌ per status, coins case, stock counts before/after,
Razorpay test mode `success@razorpay` after an edit); `haper-misc/client-followups.md` admin row.

Deploy order: backend (A.1 → A.2 → A.3/A.4) before the admin bundle (A.5). An old admin bundle on the new
backend keeps working for INITIATED (its edit/switch buttons stay hidden), but for CANCELLED/FAILED the
old bundle's already-visible Edit button now succeeds while still showing the "₹X will be credited"
preview (nothing is credited). So ship A.5 right after the backend. A new bundle on the old backend gets
400/409, so do not ship A.5 first.

### 12.8 Edge cases and risks

| Case | Handling |
|---|---|
| Switch and capture at the same moment | 12.2.3 step 3: exactly one wins in the filter; no path keeps both. |
| Two admins: one edits, one switches | Both conditional on the read status: the second gets 409 "order changed". |
| Switch vs supersede (1.6) vs cron vs customer cancel | All conditional after 0.2/0.3 (hard prerequisite 12.2.4). |
| Customer places a second order while the admin switches the first | Two live orders; ops cancels one. The Q10 admin warning would catch it; worth doing with A.5. |
| Edited INITIATED order, customer pays old amount | Credited to the wallet, order stays INITIATED, cron cancels, coins back once. Safe but unfriendly; the admin UI pushes "Switch to COD now". |
| CANCELLED edit adds an item that is out of stock | Not reserved at edit time; Mode A later fails `OUT_OF_STOCK` with the item name. Optional: a non-reserving availability hint in the edit UI. |
| Scheduled INITIATED order switched | Slot seat still held; goes OPEN like a captured scheduled order; the release cron handles it. Test it. |
| Coupon order edited while unpaid | Coupon stays allocated in the frozen line prices, minimum not re-checked (same as OPEN). |
| Gift-with-purchase | Gift lines untouched by edits. Mode C moves the order into a gift-cap-counting status, which is correct (it is now a real order). |
| Legacy INITIATED/FAILED order with `refundedAmount > 0` (should not exist) | Refuse the unpaid edit (409) rather than guess the coin balance. |
| Rollback | Code-only, but **revert A.4/A.5 before A.2**: stamped orders exist once A.4 runs, and without A.2 a capture on one would go OPEN at the old amount. Mode C (A.3) reverts cleanly. |

Backward compatibility: Modes A/B, OPEN/paid/COD edits, picker OOS, all refund paths and the capture
branches for unstamped orders are untouched (proven by their existing tests passing unmodified). New
fields and response values are additive and nullable. Pre-existing gap found (not caused by this work):
`editOrder` scopes by `if (req.store && …)`, so a warehouse role holding `orders.edit_items`
(`req.store` is null for warehouse roles) would be unscoped. Proposed fix with A.4: add the same
`requireRole(SUPER_ADMIN, STORE_ADMIN, MANAGER, SUPPORT)` gate the convert route uses (QA6).

### 12.9 Test strategy (additions)

- Unit: `applyItemEdit` with `unpaidOnline` (stock-neutral vs held, net price, surplus refusal, no
  `refundToWallet` call: spy on it); the `extraFilter` no-match → 409.
- Integration (jest, in-memory Mongo, per package): A.2, A.3, A.4 lists above. The key money tests:
  switch-then-capture, edit-then-capture, edit-then-cron (coins once), CANCELLED-edit-then-Mode-A.
- Regression: every existing `order-convert-to-cod*`, `order-edit*`, `order-refund`, `razorpay*`,
  `payment-initiated-orders` and `seat-release` test green. The only allowed edits are the three
  named above (`order-convert-to-cod.test.js` row, `order-payment-pending.test.js` edit case,
  `convertToCod.test.ts` row 5), listed in the commit messages.
- Manual on dev (Razorpay test mode): switch an INITIATED order and then complete the payment in the
  still-open sheet → wallet credit + COD kept; edit an INITIATED order and then pay → wallet credit,
  order expires; a CANCELLED order with a sold-out item → edit out → Mode A succeeds.

### 12.10 Open questions (addendum)

- **QA1 (recommended: A).** Editing a `PAYMENT_INITIATED` order: **(A)** allowed, and the edit closes
  online payment for that order (§12.3.4; needs the A.2 capture branch), or **(B)** simpler: for
  INITIATED only, the Edit button says "Switch to Cash on Delivery first", and after the switch the
  existing OPEN-order edit applies. B needs no capture-pipeline change. Example: with A the admin can
  remove the milk and then switch; with B they switch and then remove the milk. Same end result.
- **QA2 (recommended: refuse).** Riya used ₹100 of wallet coins on a ₹540 order; the admin edits it down to
  ₹60. The ₹40 of coins that no longer fit: refuse the edit (no refund, as asked), or credit ₹40 back to
  her wallet (a coin refund, which also needs the cron changed so it does not return the coins twice)?
- **QA3 (recommended: keep).** If Razorpay really takes the customer's money **after** the switch or the
  edit, it goes to their wallet. This is the only wallet credit left on these orders, and without it the
  customer pays twice. Confirm this is not the "refund" you want banned.
- **QA4 (recommended: yes).** When Razorpay cannot be reached, refuse switching a `PAYMENT_INITIATED`
  order at any value (today's rule allows it up to ₹5,000 for the other modes).
- **QA5 (recommended: keep today's gates).** Managers and support who hold the edit/convert permissions
  can also do these actions, as they can on any order today. Or restrict them to store admin + super admin?
- **QA6 (recommended: yes, with A.4).** Add the role gate to the edit route to close the warehouse-role
  store-scoping gap found in 12.8.

### 12.11 Who builds what (addendum)

| Part | Specialist |
|---|---|
| A.2, A.3, A.4 (capture branch, Mode C, unpaid edit core) | **hemant-payments** |
| A.1, A.6 wiring | backend platform engineer (hemant reviews) |
| A.5 admin UI | admin/web platform engineer |
| Copy: COD helper, edit warning, S2 "ORDER_EDITED" line | chanchal-designer (small) |
| `onlinePaymentClosedAt` no-index confirmation | aabha-dba (quick) |
| A.7 docs | whoever lands each task, same session |
| Not needed | stas-realtime, deepanshu-data, rohit-ai |

Sources (addendum): [Razorpay Update an Order (notes only)](https://razorpay.com/docs/api/orders/update/),
[Razorpay Orders API](https://razorpay.com/docs/api/orders/),
[razorpay-node #426: no order cancel API](https://github.com/razorpay/razorpay-node/issues/426).
