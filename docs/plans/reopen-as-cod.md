# Reopen as COD — convert an unpaid online order to Cash on Delivery

Status: **PLAN — not approved for implementation until Q1..Q12 (§9) are answered.**
Author: Shavinder (planner) · Date: 2026-09-20 · Scope: dev only (prod is user-driven)

Repos touched: `haper-backend` (admin, user, shared), `haper-admin` (FE), `haper-misc` (docs/test guide).
`haper-delivery` (rider app): **no code change** — verified in §5.

---

## 1. Goal

A customer starts an online (Razorpay) order, never completes the payment, and the order lands in
`PAYMENT_CANCELLED` (9, written by the 15-minute abandonment cron) or `PAYMENT_FAILED` (8). The
customer then rings the store: "send it anyway, I'll pay cash at the door." Today the only tool is
the admin reopen (status → `OPEN`), which leaves `paymentMethod = RAZORPAY (1)`. Nothing in the
system then knows cash is expected: the rider app prints "Online payment" in green (prepaid
palette), the admin board derives `paymentStatus: "pending"`, and the rider cash-reconciliation
ledger — which counts only `paymentMethod === COD` — silently misses the money the rider is
carrying. This feature adds a first-class admin action that flips such an order to COD **atomically
with** the reopen, records who/why/what it used to be, and makes the rider app, the admin screens
and the cash books all agree that this is cash-to-collect.

### Acceptance criteria (done = all ticked)

- [ ] An admin can convert an unpaid Razorpay order to COD from the order details modal, in one
      click + confirm, for orders in `PAYMENT_CANCELLED`, `PAYMENT_FAILED`, and for already-reopened
      but still-unpaid orders in `OPEN` / `PICKING` / `PACKED` / `PROCESSING` / `ASSIGNED`.
- [ ] Converting from a cancelled status ALSO performs the full existing reopen (wallet clawback,
      stock re-deduct, scheduled-slot re-claim, `stockRestored:false`, `refundedAmount:0`) in ONE
      transaction — if any part fails, the payment method is not changed either.
- [ ] The order afterwards has `paymentMethod = 0 (COD)` and a `codConversion` record naming the
      admin, timestamp, reason code, note, original method and original status.
- [ ] The rider app (unchanged build) shows "Cash on delivery" / "COD" in the amber cash palette,
      and the amount it shows (`order.price`) equals exactly the cash to collect, including when the
      customer part-paid with wallet coins.
- [ ] The rider's "Cash to settle" card and the admin rider-cash reconciliation include the order
      once delivered.
- [ ] A later `payment.captured` webhook for the same order (stale checkout sheet, delayed UPI) is
      detected, auto-refunded to the customer's wallet exactly once, audited, and pushed to the
      customer and the store admins — never silently double-collected.
- [ ] Conversion is refused with a clear message when: the payment IS captured, the order is not a
      convertible status, another store's order, an unclawed refund is outstanding, the wallet
      clawback cannot be covered, stock is short, or the scheduled slot is now full.
- [ ] Every conversion writes an `order_audit_logs` row visible in the existing Order Activity view.
- [ ] Double-clicking the button converts once (second call returns "already COD", 200, no writes).
- [ ] `haper-misc/test-*.md` walkthrough updated in the same session.
- [ ] No existing endpoint, response shape, enum or field is renamed/removed (see §7 back-compat).

### Non-goals

- Converting a **paid** order to COD (never — that is a refund, not a conversion).
- COD for brand-new checkouts (COD at checkout remains governed by whatever the store allows today;
  this is an admin-only recovery action).
- Partial cash / split payment UI.
- Fixing the stuck prod order by hand. **No agent writes to any DB.** Prod order HP581915100 gets
  fixed by an admin clicking this button after the feature is deployed — nothing else.
- Re-claiming the coupon redemption released by the abandonment cron (pre-existing gap, see §7.6 —
  raised as Q9).

---

## 2. Current state (verified in code, 2026-09-20)

### 2.1 Backend — admin

| Thing | Location | Facts |
|---|---|---|
| Status change | `haper-backend/packages/admin/src/routes/order/controller.js` → `markOrderAdmin` (from ~line 520) | Transactional with up to 3 retries on `TransientTransactionError`; per-attempt fresh session. |
| Reopen branch | same file, `newStatus === orderStatus.OPEN`, ~lines 596–745 | `REOPENABLE_FROM = [CANCELED, PAYMENT_CANCELLED, ADMIN_CANCELED, UN_DELIVERED]` — **`PAYMENT_FAILED` is NOT in it today**, so a failed-payment order cannot be reopened at all. Does: slot re-claim (only if `slot.end` is in the future) → wallet clawback of `refundedAmount` (blocked if balance short) → `ItemRepository.decrementIfAvailable` per line → `$set {status:OPEN, refundedAmount:0, reason, stockRestored:false}` → audit `order.reopen` → `realtimeUtils.emitOrderEvent`. |
| Prepaid helpers | same file ~line 30 | `PREPAID_METHODS = [RAZORPAY, STORE_PICKUP_PREPAID, WALLET]`, `isPrepaid()`. |
| Payment status | same file ~line 51 | `derivePaymentStatus`: WALLET→paid; RAZORPAY→`meta.payment.status === "captured" ? paid : pending`; everything else → `cod_pending`. |
| Store scoping | same file ~line 18-24 | `isSuperAdmin(req)` / `orderScopeStoreId(req)` → `null` for super admin (global), else `req.store._id`. **Trap: it also returns `null` when `req.store` is missing for a non-super admin — that would silently make the lookup global.** |
| Validator | `.../order/validator.js:70` | `paymentMethod: Joi.string().valid(...Object.keys(paymentMethod))` is **only the `getOrderList` query filter**. No endpoint anywhere edits an existing order's `paymentMethod`. Confirmed by grep across `packages/*`. |
| Routing/permissions | `.../order/router.js` | Every route is `authenticate` + `requirePermission(P.ORDERS.*)`. |
| Permission model | `packages/admin/src/middleware/permission.js` | `super_admin` and `store_admin` **bypass every permission** (return true). manager/support/warehouse are checked against `resolveEffectivePermissions`. `requireRole(...)` is the only real gate for those two. FE mirror: `haper-admin/src/utils/permissions.ts` (same 4 rules — keep in sync). |
| Audit | `OrderAuditRepository.write({actor, action, orderId, orderDisplayId, storeId, userId, before, after, metadata, result})`, schema `packages/shared/models/order-audit-logs.schema.js` | Free-text dotted `action`; FE label map at `haper-admin/src/utils/orderAudit.ts`. |

### 2.2 Backend — money / payments

- **`packages/cron/src/jobs/payment-initiated-orders.js`**: at 15 minutes, an abandoned
  `PAYMENT_INITIATED` order is restocked, its **wallet portion refunded** via
  `refundUtils.refundToWallet` (so `refundedAmount = meta.walletUsed`), the slot seat released, the
  coupon hold released, and it is set `PAYMENT_CANCELLED` + `stockRestored: true` +
  `meta.payment.info = "Payment abandoned by User. Cancelled by Cron."`.
- **`packages/user/src/routes/razorpay/controller.js`** (293 lines):
  - `payment.captured` + order status in `CANCELLED_STATES = [CANCELED, PAYMENT_CANCELLED, ADMIN_CANCELED, UN_DELIVERED]`
    → auto-refund the captured amount to wallet, idempotent on a note containing the Razorpay
    `paymentId`, `$set meta.payment`, `$push refunds`, `$inc refundedAmount`, customer push.
  - `else if (!successStatuses.includes(order.status))` → mark the order `OPEN`, save `meta.payment`,
    notify, confirm coupon hold, create pick task.
  - **There is no `else`.** `successStatuses` contains `OPEN, PICKING, PACKED, ASSIGNED, PROCESSING,
    OUT_FOR_DELIVERY, CLOSED, PAYMENT_SUCCESS`. So **today, a `payment.captured` that arrives for an
    order sitting at OPEN/ASSIGNED/… does absolutely nothing** — `meta.payment` is never even
    written. The money is captured at Razorpay and the order still reads "payment pending". This is
    the exact hole that makes double payment possible after we convert to COD, and it exists today
    for reopened orders too.
  - `payment.failed` → restock + release slot + release coupon + `PAYMENT_FAILED` + `stockRestored:true`,
    but **does NOT refund `meta.walletUsed`** (pre-existing asymmetry vs the cron; see §7.6/Q10).
  - `getRazorpayOrder` returns `{order:null, msg:"COD order"}` when `paymentMethod === COD` — so
    **converting to COD also closes the customer app's "resume payment" path**, which is a bonus.
- **`packages/shared/utils/refund.utils.js`**: `computeRefundOwed(order)` = `capturedAmount +
  meta.walletUsed − refundedAmount`, plus `settlesPayment` / the `(pay <paymentId>)` marker;
  `hasUnclawedRefund(order)` = `refundedAmount > 0 && stockRestored === true`;
  `notUnclawedRefundFilter()` is the same rule as a Mongo `$nor` predicate for folding into filters.
- **Money shape**: at checkout `price = pricing.finalPayable` (**already net of wallet**),
  `actualOrderValue = itemsTotal`, `meta.walletUsed = walletUsed`, and the wallet is debited
  synchronously at order creation (`applyWallet`). Therefore **cash to collect after conversion =
  `order.price`, full stop** — no client-side arithmetic needed.

### 2.3 Cash reconciliation / reporting (what "the books" key on)

- `packages/shared/repositories/cash-reconciliation.repository.js:41` — derived `cashCollected` =
  `SUM(order.price)` over `{assignedTo: rider, status: CLOSED, paymentMethod: COD}` (+ optional
  store + `deliveredOn` window). **Keyed on `paymentMethod === COD` → a converted order is counted
  automatically, with zero extra code.** Same numbers feed the rider app's "Cash to settle" card
  (`packages/delivery/src/routes/profile/controller.js` → `getRiderSummary`).
- `packages/shared/repositories/profit-snapshot.repository.js:121,176` — COD orders are attributed
  to their **delivery** date, others to creation date, with a `$nor` seam guard around the cutover.
  Converting changes an order's attribution basis (see §7.4 — safe, because the order was never
  `CLOSED` before conversion).
- `packages/shared/repositories/order.repository.js:910, 1258-1330, 1406` — revenue split by payment
  method; `:1913/:2031` — report filters accept a `paymentMethod` key. A converted order simply
  reports as cash. Desired.
- `packages/shared/utils/invoice.utils.js:74` — invoice prints `paymentMethodKeyMap[paymentMethod]`
  → "COD". Invoices are produced at/after delivery, so a conversion before delivery is correct.
- `packages/shared/utils/scheduling.utils.js:69` — `allowedPaymentMethods: [RAZORPAY]` is a
  **checkout-time** gate for scheduled bookings only; it is not consulted on any admin mutation.
  A conversion deliberately bypasses it (Q6).
- No per-store "COD enabled" or "max COD value" rule exists anywhere in the codebase (grepped
  `codEnabled|maxCod|codLimit|allowedPaymentMethods`). The only payment-method policy is the
  scheduled-delivery one above. So there is nothing to respect — only something to invent (Q6/Q7).

### 2.4 Rider app (`haper-delivery`, Kotlin/Compose)

- `data/model/OrderModels.kt:70` — `val paymentMethod: Int? = null`, `val price: Double = 0.0`.
- `ui/components/DeliveryFormatters.kt:84,93` — `paymentLabel(0) = "Cash on delivery"`,
  `paymentShortLabel(0) = "COD"`.
- `ui/theme/Color.kt:47-52` — `paymentPalette` buckets **by "does the rider need to collect cash?"**:
  COD + postpaid → amber `PaymentCash`; online/wallet/prepaid → green.
- `ui/components/DeliveryOrderCard.kt:100,165` and `ui/home/DeliveryHomeScreen.kt:1323,1556,1587` —
  the card and the Payment detail card render `formatCurrency(order.price)` + the method label/chip.
- There is **no client-side wallet arithmetic** anywhere in the rider app — it displays `price`
  verbatim, which (see §2.2) is already the exact cash amount.

**Conclusion: flipping `paymentMethod` 1 → 0 is sufficient; no rider-app change is required.** The
only rider-side gap is *staleness*: a rider looking at an already-ASSIGNED order sees the old label
until the list refreshes (the app polls/refetches; there is no socket push for this field). Handled
in §3.5.

### 2.5 Admin FE

- `haper-admin/src/pages/Orders/OrderDetailsModal.tsx` — the "Manage Status" `<select>`; for
  `CANCELLED_STATES = ['CANCELED','PAYMENT_CANCELLED','ADMIN_CANCELED']` it offers only `OPEN`
  (line ~416). Calls `PATCH /admin/order/mark-status-admin`. Cancel reason logic is factored out in
  `src/pages/Orders/cancelReasons.ts` (pure, unit-tested) — the pattern to copy.
- `src/pages/Orders/OrderBoard.tsx` also calls `mark-status-admin`.
- `src/utils/orderAudit.ts:20` maps `'order.reopen' → 'Order reopened'`.

---

## 3. Proposed design

### 3.1 Shape of the action — **dedicated endpoint, shared reopen service** (recommended)

`POST /admin/order/:orderId/convert-to-cod`

Rejected alternative A — a `convertToCod: true` flag on `mark-status-admin`: that handler is already
a ~250-line multi-branch money path; adding a flag makes the most security-sensitive endpoint in the
admin API wider and harder to review, and it cannot express the "already OPEN, just convert" case
(no status change at all) without inventing a no-op transition.

Rejected alternative B — duplicate the reopen logic inside a new handler: guarantees drift on the
next scheduled-delivery/refund change.

**Chosen**: extract the existing reopen body **verbatim** into
`packages/admin/src/routes/order/reopen.service.js` → `reopenToOpen({ order, reason, session, req })`
returning `{ ok, clawback } | { ok:false, httpStatus, body }`, and call it from **both**
`markOrderAdmin`'s OPEN branch and the new controller. This is a *pure relocation* — no behaviour
change, no new conditionals — so the existing admin jest suite is the regression proof. DRY + SRP,
and the money rules keep exactly one home.

### 3.2 Which statuses convert (recommended minimal safe set)

Two modes, chosen by the order's current status:

| Mode | From statuses | What happens |
|---|---|---|
| **A: reopen + convert** (one transaction) | `PAYMENT_CANCELLED (9)`, `PAYMENT_FAILED (8)` | slot re-claim → wallet clawback → stock re-deduct → `$set {status:OPEN, refundedAmount:0, stockRestored:false, paymentMethod:COD, codConversion:{...}}` |
| **B: convert only** (no stock/slot/wallet work) | `OPEN (0)`, `PICKING (18)`, `PACKED (19)`, `PROCESSING (13)`, `ASSIGNED (10)` | `$set {paymentMethod:COD, codConversion:{...}}` only. This is the HP581915100 case — already reopened, stock already deducted. |

**Excluded on purpose**: `OUT_FOR_DELIVERY (11)` — the rider is already at the door with a stale
screen; flipping money semantics mid-handoff is how you get "he said online, she said cash". Also
excluded: `CLOSED`, `UN_DELIVERED`, `CANCELED`, `ADMIN_CANCELED`, `REFUND_*`, `PAYMENT_INITIATED`
(live payment sheet — same rule as `PAYMENT_PENDING_MSG` in `markOrderAdmin`), `DELETED`, `FAILED`.

Adding `PAYMENT_FAILED` to Mode A is a **new capability** (it is not reopenable today). It is safe:
the `payment.failed` webhook already restocked and set `stockRestored:true`, `refundedAmount` is 0,
so the clawback is 0 and the stock re-deduct is the correct mirror. **We do not add `PAYMENT_FAILED`
to `REOPENABLE_FROM`** — the plain reopen keeps its current behaviour exactly; only the new endpoint
accepts it. (Q3 asks whether you want plain reopen widened too.)

### 3.3 Preconditions (all enforced server-side, in this order)

1. `authenticate` → `requirePermission(P.ORDERS.CONVERT_TO_COD)` (new permission, §4.3).
2. **Tenancy**: non-super-admin ⇒ `req.store` must exist (else 403 `STORE_CONTEXT_REQUIRED`) and
   `String(order.storeId) === String(req.store._id)`. Do **not** rely on `orderScopeStoreId`'s
   `null`-means-global fallback for this endpoint.
3. Order exists → else 404.
4. `order.paymentMethod === RAZORPAY` → else 409. (If already COD: 200
   `{alreadyConverted:true}` — idempotent double-click, no write, no audit row.)
5. **No captured payment**: `!(order.meta?.payment?.status === "captured")` → else 409
   `PAYMENT_ALREADY_CAPTURED` ("This order was paid online. Cancel/refund it instead.").
6. Status ∈ Mode A ∪ Mode B set → else 409 with the status name.
7. `!refundUtils.hasUnclawedRefund(order)` for Mode B → else 400 `refundUtils.UNCLAWED_REFUND_MSG`
   (Mode A's clawback resolves this legitimately).
8. `order.channel !== "pos"` (POS orders are cash at the counter already) and
   `paymentMethod ∉ {STORE_PICKUP_*}` — implied by (4) but assert explicitly.
9. Reason code required (`codConversionReason`), note required when `OTHER`, note ≤ 300 chars.
10. **Value threshold**: if `order.price > COD_CONVERSION_MAX_VALUE` (**recommended default
    ₹5,000**), only `SUPER_ADMIN` may proceed; everyone else gets 403 `APPROVAL_REQUIRED` with the
    message "Orders above ₹5,000 must be converted by a super admin." (₹2,124 passes.) — Q7.
    **CORRECTION (security audit r1, finding M2).** Checking this only at conversion time made it
    a no-op: `editOrder` limits item additions to PREPAID orders, and a converted order is COD, so
    any store admin could convert ₹4,999 and edit it up to ₹50,000 (or trim ₹9,000 under the
    limit, convert, and restore it). As built, the ceiling is re-asserted in
    `packages/shared/utils/order-edit.utils.js` → `assertCodConversionEditLimit`, inside
    `applyItemEdit` on the in-transaction read before the write, so **every** caller is covered.
    It fires only for an order with `codConversion.convertedAt` and only when the edit RAISES
    `price` above the limit — a reduction on an over-limit order stays allowed, plain COD orders
    are unaffected, and `0`/unset still means no ceiling.
10b. **Gateway truth check (audit H2)** — for an order with `meta.id` (its Razorpay order id),
    ask Razorpay directly (`orders.fetchPayments`, via `razorPayUtils.fetchPaymentsByOrderId`)
    *before* the transaction is opened, ~3s timeout, one retry, one call per request.
    - any payment `captured`/`authorized` with `amount_refunded < amount` ⇒ 409
      `PAYMENT_ALREADY_CAPTURED` + an `order.convert_to_cod.blocked_unrecorded_capture` audit row
      (gateway payload never echoed to the client; `meta.payment` is NOT written here — the
      capture webhook owns it);
    - `failed`/`created`/fully-refunded attempts ⇒ proceed;
    - gateway unreachable / timeout / unknown payment status ⇒ **fail closed above
      `COD_CONVERSION_MAX_VALUE`** (503 `GATEWAY_UNVERIFIABLE`), **fail open at or below it**
      (convert + a `convert.gateway_unverifiable` alert row in `logs`), so a Razorpay outage
      cannot brick the recovery action for small orders.
    - skipped entirely when there is no `meta.id`, on the idempotent already-COD path, and on
      any order the cheaper local checks (2-9) would refuse anyway.
    Why: precondition (5) is only as good as the capture webhook — a lost delivery leaves an
    unpaid-looking order whose money is at the gateway, and the late-capture refund branch is
    driven by that same lost event.

11. Wallet: no special case needed. Mode A's clawback already re-debits `meta.walletUsed`, and
    `price` is net of wallet, so **cash to collect = `order.price`** in every case. If the customer
    has since spent the refunded coins, the existing clawback guard refuses the conversion with the
    existing balance message — correct and unchanged.

### 3.4 The write (concurrency-safe)

Everything inside `session.withTransaction` with `readPreference:'primary'`, wrapped in the existing
`isRetryableTxnError` 3-attempt loop. The final order write is a **single conditional
`findOneAndUpdate`** whose filter re-asserts every racy precondition, so a concurrent writer cannot
slip between the read and the write:

```
filter: {
  _id, storeId (non-super-admin), status: <the status we read>,
  paymentMethod: RAZORPAY,
  $and: [ { $or: [ {"meta.payment": null}, {"meta.payment.status": {$ne: "captured"}} ] },
          notUnclawedRefundFilter() ]   // Mode B only
}
```
No match ⇒ abort ⇒ 409 `ORDER_CHANGED` ("This order changed while you were working on it. Reopen
the order and try again."). This is the same `transitionStatus`-style pattern used elsewhere.

### 3.5 Late-webhook / double-payment — the critical section

**Today** (verified): a `payment.captured` for an order at OPEN/ASSIGNED/PROCESSING hits neither
webhook branch and is silently dropped. After we convert to COD, that becomes: customer pays online
AND the rider collects cash, with **no record of the online payment anywhere**. Unacceptable.

**Recommended behaviour — Option B: auto-refund to wallet, keep the order COD.**

New branch in `packages/user/src/routes/razorpay/controller.js`, evaluated **before** the
`successStatuses` check:

```
if (order.paymentMethod === COD && order.codConversion && order.codConversion.convertedAt) {
    // money captured for an order we already converted to cash
    -> idempotency: skip if any refunds[].note contains this paymentId
    -> refundToWallet(capturedAmount, reason: CUSTOMER_REQUEST,
                      note: `Auto-refund: online payment captured after COD conversion (pay ${paymentId})`)
    -> $set  "meta.payment" = entity          // so the capture is on the record
       $set  "codConversion.lateCaptureAt" = now, "codConversion.lateCapturePaymentId" = paymentId
       $push refunds, $inc refundedAmount
    -> audit row  action: "order.cod.late_capture_refunded"
    -> push to customer ("You paid ₹X online after this order was switched to cash — ₹X is back in your wallet. Please still pay cash at the door." — wording Q11)
    -> sendAdminStoreNotification(storeId, "Online payment arrived on a COD order #<id>", ...)
}
```

Why B over the alternatives:

- **Option A "treat it as prepaid, cancel the cash expectation"** (flip back to RAZORPAY, mark paid):
  correct on paper, dangerous in practice. The rider's screen is stale-by-poll; if the capture lands
  while he is at the door he may already have taken the cash, and now the system says prepaid and the
  cash is off-book. It also creates a second `paymentMethod` write path on live orders, doubling the
  audit surface. **Reject.**
- **Option C "flag for admin, do nothing automatic"**: leaves customer money sitting at Razorpay with
  a manual follow-up. No.
- **Option B** reuses the *exact* machinery and idempotency marker already proven for
  `CANCELLED_STATES` (same `(pay <paymentId>)` note convention read by `computeRefundOwed`), keeps
  one rule for the rider ("cash, always"), and keeps the books trivially explainable: cash in =
  `price`, wallet credit out = captured amount.

**The refunded amount is the FULL captured amount** — never bounded by `codConversion.expectedCash`
(or any other app-derived total). `expectedCash` is stamped once at conversion and no writer
refreshes it when the order is edited afterwards, so an earlier cap at
`expectedCash + walletUsedAtConversion` silently kept the difference (edit ₹4,000 → ₹1,000, convert,
₹4,000 captures ⇒ only ₹1,000 returned). Signature verification plus the `order_id` check already
establish that the capture is genuine; a genuine capture on an order being collected in cash goes
back whole. A capture above the expected total is logged as `capture.exceeds_expected` — information
only, it never reduces or blocks the refund.

**Also fix the silent hole while we are here** (recommended, small, same file): for a capture on any
*non-converted* order already in `successStatuses`, at minimum `$set meta.payment = entity` so the
capture is recorded and `derivePaymentStatus` stops lying. No refund, no status change. — Q8.

**Ordering guarantee**: capture-lands-during-conversion is covered because the conversion filter
requires `meta.payment.status != "captured"`. If the webhook commits first, the conversion 409s
("this order was just paid"). If the conversion commits first, the webhook takes the new branch and
refunds. There is no interleaving that both collects cash and keeps the capture unrecorded.

### 3.6 Data flow (Mode A, happy path)

```
Admin FE  --POST /admin/order/:id/convert-to-cod {reasonCode, note}-->  admin API
  authenticate -> requirePermission(orders.convert_to_cod) -> validator
  load order (store-scoped)  -> precondition checks 3..10
  txn { reopenToOpen(order)      // slot re-claim, wallet clawback, stock re-deduct
        conditional findOneAndUpdate { status:OPEN, refundedAmount:0, stockRestored:false,
                                       paymentMethod:COD, codConversion:{...} } }
  post-commit (fire & forget):
      OrderAuditRepository.write(action:"order.convert_to_cod")
      realtimeUtils.emitOrderEvent(order,"ORDER_STATUS_UPDATED")   -> admin boards
      notificationUtils.sendUserNotification(customer)             -> "pay ₹X cash on delivery"
      if status ASSIGNED: sendRiderNotification(assignedTo, "PAYMENT_CHANGED_TO_COD")
  200 { order, mode:"reopen_and_convert", clawbackAmount, cashToCollect: order.price }
```

---

## 4. Data model changes

### 4.1 `orders` — one new typed sub-document (nullable, additive)

`packages/shared/models/orders.schema.js`:

```js
codConversion: {
    type: {
        convertedAt:            { type: Date,   required: true },
        by:  { adminId: ObjectId, email: String, roles: [String] },
        reasonCode:             { type: String },      // codConversionReason
        note:                   { type: String, default: null },
        originalPaymentMethod:  { type: Number },      // 1 (RAZORPAY)
        originalStatus:         { type: Number },      // 9 / 8 / 0 / 10 ...
        walletUsedAtConversion: { type: Number, default: 0 },
        expectedCash:           { type: Number },      // == order.price at conversion
        razorpayOrderId:        { type: String, default: null },  // copy of meta.id
        lateCaptureAt:          { type: Date,   default: null },
        lateCapturePaymentId:   { type: String, default: null },
        _id: false,
    },
    default: undefined,   // absent on every existing order
},
```

**Why a typed top-level field and not `meta.codConversion`:** `meta` is `Schema.Types.Mixed` with a
validator that only permits `null` / `{}` / `{id,type,...}` — workable but untyped, unindexable in
practice, and invisible to any future reader. One new nullable path is the boring choice, and
`default: undefined` means **not one existing document changes**.

**`meta.id` / `meta.type` stay exactly as they are.** The late-capture branch and
`OrderRepository.getByRazorpayOrderId` (`{"meta.id", "meta.type": RAZORPAY}`) must keep matching.
`razorpayOrderId` above is a convenience copy for reporting, not the lookup key.

### 4.2 Index

```js
schema.index({ "codConversion.convertedAt": -1 },
  { partialFilterExpression: { "codConversion.convertedAt": { $exists: true } } });
```
Partial ⇒ it indexes only converted orders (a handful), costs nothing on writes of normal orders,
and supports "show me all COD conversions this month" for the audit/report view. **Build it
`background`/via a migration step, not `autoIndex`, on the prod deploy** — dev can rely on autoIndex.
(No data migration. No backfill. Nothing to roll back.)

### 4.3 Constants

`packages/shared/constants/order.constant.js` (additive, exported alongside the rest):

```js
const codConversionReason = {
    PAYMENT_FAILED_CUSTOMER_WILL_PAY_CASH: "PAYMENT_FAILED_CUSTOMER_WILL_PAY_CASH",
    CUSTOMER_REQUEST: "CUSTOMER_REQUEST",
    STORE_DECISION: "STORE_DECISION",
    OTHER: "OTHER",
};
const COD_CONVERSION_MAX_VALUE = 5000;   // above this: super_admin only
```
Mirrors the existing `refundReason` pattern exactly (same enum-as-string shape, same "OTHER requires
a note" rule).

`packages/shared/constants/permission.constant.js`: add `ORDERS.CONVERT_TO_COD = "orders.convert_to_cod"`.
**Deliberately NOT added to `MANAGER_PRESET` or `SUPPORT_PRESET`** ⇒ out of the box only
`super_admin` and `store_admin` can do it (they bypass), and a manager can be granted it explicitly
from the Team page. Least privilege for a money action. — Q5.

`packages/shared/constants/notification.constant.js`: add
`riderNotificationTemplates.PAYMENT_CHANGED_TO_COD = { title: "Collect cash 💵", body: "Order #{orderId} is now Cash on delivery — collect #{amount}.", prefKey: "newAssignment" }`.
Reusing the existing `newAssignment` pref key means **no rider preference migration** and no new
field for old rider rows to be missing.

### 4.4 Projections that must learn the new field (denormalized fan-out check)

Inclusion-style `.select({...})` projections silently drop new fields. The ones that must add
`codConversion: 1` if the UI is to show a badge:
- `packages/shared/repositories/order.repository.js:~180` (`getActiveBoardOrders`) — for the live board badge.
- `packages/shared/repositories/order.repository.js:~3054` — check and add.
- The admin order-list / order-detail reads: confirm at build time whether they are exclusion-style
  (`-__v`, free) or inclusion-style (must be edited). **Exclusion reads need no change** *to show*
  the field.
- Rider-facing reads: **do not add** `codConversion` — the rider needs nothing beyond
  `paymentMethod`, and not sending it keeps the rider payload unchanged (Gson-safe by omission).

**CORRECTION (security audit r1, finding M1).** "Exclusion reads need no change" was wrong for the
customer/rider side. An exclusion projection (`.select({ __v: 0 })`) ships EVERY new schema field
automatically, so `codConversion` — the acting admin's id/email/roles plus a free-text internal
note — reached the customer and rider apps the moment the sub-doc was written. A customer/rider
read must therefore name the field explicitly to exclude it. As built:
- `packages/shared/repositories/order.repository.js` — one shared `CUSTOMER_SAFE_PROJECTION =
  { __v: 0, codConversion: 0 }` used by `getPaginated`, `getHistoryPaginated`, `getDetail`,
  `getAllOrdersForDelivery`, `getDeliveryDetail`. The whole sub-doc is hidden, not just
  `by`/`note`: neither app needs any of it.
- `packages/delivery/src/routes/order/controller.js` — the mark-status / accept / reject handlers
  answer with the RAW `findOneAndUpdate` result (not a projected read), so they strip the field at
  the response boundary (`hideInternalFromRider`).
- Admin reads are untouched and still carry it (`getActiveBoardOrders`, the scoped admin list /
  detail reads, and the endpoint's own 200 body).
- Note `getPaginated` is shared: the admin "this customer's orders" tab loses the badge too. The
  admin board/list/detail screens keep it, so no admin UI need is lost.

---

## 5. API contract

### 5.1 `POST /admin/order/:orderId/convert-to-cod`

Auth: `authenticate` + `requirePermission("orders.convert_to_cod")` + in-controller tenancy assert.

Request:
```json
{ "reasonCode": "PAYMENT_FAILED_CUSTOMER_WILL_PAY_CASH", "note": "Customer called, will pay cash" }
```
`reasonCode` required, one of `codConversionReason`. `note` optional, required iff `OTHER`, ≤300 chars.

200 (converted):
```json
{ "msg": "Order converted to Cash on Delivery",
  "data": { "order": { /* full order, same shape as mark-status-admin */ },
            "mode": "reopen_and_convert" | "convert_only",
            "clawbackAmount": 0,
            "cashToCollect": 2124 } }
```
200 (idempotent repeat): `{ "msg": "This order is already Cash on Delivery.", "data": { "order": …, "alreadyConverted": true } }`

Errors (all `{ msg, code }`, matching the house style — FE reads `.msg`):

| HTTP | code | when |
|---|---|---|
| 400 | `INVALID_REASON` / `NOTE_REQUIRED` | validator |
| 400 | `UNCLAWED_REFUND` | `hasUnclawedRefund` (Mode B) |
| 400 | `WALLET_SHORT` | clawback > balance (existing message reused) |
| 400 | `OUT_OF_STOCK` | re-deduct failed (existing message reused) |
| 403 | `STORE_CONTEXT_REQUIRED` / `FORBIDDEN_STORE` | tenancy |
| 403 | `APPROVAL_REQUIRED` | over the value threshold, not super admin |
| 404 | `ORDER_NOT_FOUND` | |
| 409 | `PAYMENT_ALREADY_CAPTURED` | captured payment exists |
| 409 | `STATUS_NOT_CONVERTIBLE` | status outside Mode A ∪ B |
| 409 | `ORDER_CHANGED` | conditional update matched nothing |
| 503 | `GATEWAY_UNVERIFIABLE` | Razorpay could not be reached and the order is above the cash limit |
| 422 | `SLOT_UNAVAILABLE` | scheduled slot now full (existing message reused) |

### 5.2 Unchanged surfaces (explicitly)

`PATCH /admin/order/mark-status-admin` — byte-for-byte the same behaviour (the reopen body simply
lives in a service file now). `GET /admin/order/order-list?paymentMethod=COD` — a converted order now
appears in the COD filter; that is the point. Rider endpoints — unchanged payloads.

### 5.3 Events

- `realtimeUtils.emitOrderEvent(order, "ORDER_STATUS_UPDATED")` — reuses the existing event; no new
  event type, so every existing subscriber keeps working.
- Audit actions (new strings only, schema unchanged): `order.convert_to_cod`,
  `order.cod.late_capture_refunded`.

---

## 6. Step-by-step build order

One task = one reviewable change. Backend tasks land before FE.

**Phase 0 — webhook hardening (ships first; safe alone).** Owner: **hemant-payments**
1. `packages/user/src/routes/razorpay/controller.js`: add the `codConversion` late-capture branch
   (§3.5) + (Q8) record `meta.payment` for captures on live non-converted orders. Add the audit row.
   Tests: `packages/user/__tests__/razorpay-late-capture.test.js` (new).
   *Note: this branch is inert until Phase 2 creates the first converted order — deliberate, so the
   webhook can never be the lagging half.*

**Phase 1 — shared plumbing.** Owner: **sumit-backend**
2. `packages/shared/constants/order.constant.js` (+`codConversionReason`, `COD_CONVERSION_MAX_VALUE`),
   `permission.constant.js` (+`ORDERS.CONVERT_TO_COD`), `notification.constant.js`
   (+`PAYMENT_CHANGED_TO_COD`), `packages/shared/models/orders.schema.js` (+`codConversion` + partial
   index). Pure additive; run the full backend suite as the regression proof.
3. **Pure relocation**: extract the reopen body from `markOrderAdmin` into
   `packages/admin/src/routes/order/reopen.service.js`; `markOrderAdmin` calls it. **Zero behaviour
   change** — the existing admin tests must pass untouched. Reviewer instruction: diff must be a move.

**Phase 2 — the endpoint.** Owner: **sumit-backend**, money review by **hemant-payments**
4. `packages/admin/src/routes/order/controller.js` → `convertToCod` handler (Modes A/B, §3.3–3.4),
   `validator.js` → `convertToCod`, `router.js` → the route. Post-commit audit + pushes + realtime.
5. Projections: add `codConversion: 1` where §4.4 requires it.
6. Tests: `packages/admin/__tests__/order-convert-to-cod.test.js` (§8).

**Phase 3 — admin FE.** Owner: **tanmoy-web**, UI spec by **chanchal-designer first**
7. `haper-admin/src/pages/Orders/convertToCod.ts` — pure "is this order convertible / what does the
   confirm dialog say" helper (mirrors `cancelReasons.ts`), unit-tested.
8. `haper-admin/src/pages/Orders/OrderDetailsModal.tsx` — "Convert to Cash on Delivery" button in the
   Manage Status panel, gated by `hasPermission(user, 'orders.convert_to_cod')` **and** the client-side
   convertibility check; reason `<select>` + note field; confirm dialog naming the exact cash amount
   ("Switch order #HP581915100 to Cash on Delivery? The rider will collect ₹2,124 at the door. This
   cannot be undone from here."). Show a "Converted to COD by <email> on <date>" note when
   `order.codConversion` is present.
9. `haper-admin/src/utils/orderAudit.ts` — labels for the two new audit actions.
10. (Optional) `OrderBoard.tsx` — same action on the board card. Q12.

**Phase 4 — docs.** Owner: **sumit-backend** (or whoever lands Phase 2)
11. `haper-misc/test-order-cod-conversion.md` — ✅/❌ walkthrough incl. the late-capture drill.
12. `haper-misc/docs/reference/order-payment-method-and-cash.md` — the reference doc for this area:
    who keys on `paymentMethod`, where cash is reconciled, the `price`-is-net-of-wallet invariant.

**Deploy order:** backend (Phase 0+1+2 together) → verify on dev with a real abandoned order →
admin FE. The rider app needs **no release**. Then, and only then, an admin fixes HP581915100 in prod
by clicking the button. No script, no manual DB write, ever.

---

## 7. Edge cases, risks, back-compat

### 7.1 Race conditions & idempotency
- **Double-click / double-convert** — precondition (4) returns 200 `alreadyConverted` with no write;
  the conditional filter (`paymentMethod: RAZORPAY`) makes the second writer match nothing anyway.
- **Convert vs. capture** — resolved by the `meta.payment.status != "captured"` clause in the filter
  plus the webhook's own idempotency marker (§3.5). No interleaving double-collects silently.
- **Convert vs. rider closing the order** — the filter pins `status`; a mismatch ⇒ 409 `ORDER_CHANGED`.
- **Convert vs. admin cancel** — same; and a cancelled order is outside the convertible set.
- **Transient write conflict** — reuse `isRetryableTxnError` + fresh session per attempt, exactly as
  `markOrderAdmin` does. Post-commit pushes stay outside the transaction so a rolled-back attempt
  never notifies.
- **Duplicate webhooks** — the `(pay <paymentId>)` note marker is the existing, proven de-dupe.

### 7.2 Money-specific
- Cash to collect = `order.price`, already net of `meta.walletUsed`. **Never** compute
  `price - walletUsed` anywhere — that would under-collect.
- Post-conversion `UN_DELIVERED` (rider path): `computeRefundOwed` = `0 captured + walletUsed − 0` ⇒
  refunds only the wallet coins. Correct: no cash ever changed hands, the online money was never
  captured. Verified against the new `refund.utils.js` behaviour.
- Post-conversion customer cancel (user app): same computation, same correct answer.
- Post-conversion late capture: auto-refunded to wallet (§3.5); `refundedAmount` then > 0 while
  `stockRestored` is false ⇒ `hasUnclawedRefund` stays **false**, so the order is still deliverable.
  Verified — this is exactly the "partial refund on a live order" case the helper documents.
- A conversion never creates or destroys money by itself: it changes an expectation, not a balance.

### 7.3 Security / authz
- `store_admin` bypasses all permission checks ⇒ tenancy is the only real boundary ⇒ enforce it
  explicitly (`req.store` required + `order.storeId` equality), never via the
  `orderScopeStoreId → null` fallback.
- Value threshold escalates to `super_admin` (Q7).
- Reason + note are attacker-controlled free text: bound the length, store as-is, never interpolate
  into a shell/HTML/PDF unescaped (the invoice does not print it).
- Every call writes an audit row with `actor` (adminId, email, roles, ip, userAgent) — the existing
  `buildActor(req)`.

### 7.4 BACKWARD COMPATIBILITY — what this touches and how it keeps working

| Existing functionality | Why it still works unchanged |
|---|---|
| `PATCH /admin/order/mark-status-admin` + reopen | Logic is *moved*, not edited; `REOPENABLE_FROM` unchanged; existing tests are the proof. |
| Rider app (any installed build) | Reads `paymentMethod` + `price` only; both are pre-existing fields with pre-existing meanings. The new `codConversion` is **not** added to rider payloads. Gson sees no new keys. |
| Customer apps (Android/iOS/web) | No response shape change. `getRazorpayOrder` returning "COD order" for a converted order is existing, documented behaviour for COD orders. |
| Rider cash reconciliation / "Cash to settle" | Already keys on `paymentMethod === COD` — converted orders are picked up with **zero code change**. |
| Analytics revenue-by-method, order-list `paymentMethod` filter | A converted order reports as cash from the conversion onward. Historical rows unchanged. |
| Profit snapshots | Attribution basis for the order changes createdAt→deliveredOn, but the order was never `CLOSED` before conversion, so it was in **no** snapshot; no day can double-count it. The `$nor` seam guard already handles COD-delivered-after-cutover. |
| Invoices | Print "COD" — correct; invoices are generated at/after delivery. |
| Scheduled-delivery `allowedPaymentMethods` | Checkout-time only; not consulted by admin mutations. A converted scheduled order keeps its seat (Mode A re-claims it via the existing code). |
| Existing orders in the DB | `codConversion: default undefined` ⇒ not one document is written by this change. |
| Every other status transition, cancel, edit, refund, POS, pick flow | Untouched files. |

### 7.5 Failure modes / rollback
- The endpoint is additive: **rollback = revert the commits and redeploy**; already-converted orders
  remain valid COD orders with a `codConversion` record (their behaviour degrades to "an ordinary COD
  order", which is exactly right). The only irreversible bit is the converted order itself — and
  operationally that is the desired outcome, not damage.
- The partial index can be dropped with no data impact.
- **Hard-to-reverse step (flagged):** the conversion itself has no "un-convert" action in this plan.
  If a conversion is made in error *before* delivery, the admin's remedy is the existing cancel flow.
  Q4 asks whether you want an explicit un-convert (I recommend **no** for v1 — it doubles the money
  surface for a rare mistake).

### 7.6 Pre-existing gaps found while planning (NOT fixed here — raised, not silently inherited)
1. **Coupon redemption is not re-claimed on reopen.** The abandonment cron releases the coupon hold;
   the reopen does not re-claim it, so a reopened coupon order under-counts its redemption. Affects
   plain reopen today; a COD conversion inherits it. `couponFlowUtils.confirmOrderCouponHold()`
   already contains the "re-claim a released slot" logic and would be the one-line fix. — Q9.
2. **`payment.failed` does not refund `meta.walletUsed`** (the abandonment cron does). A
   `PAYMENT_FAILED` order keeps the customer's coins spent. Harmless for conversion (the coins are
   genuinely part of the payment), but it is an asymmetry worth a ticket. — Q10.
3. **A capture on a live order is silently dropped** (§2.2). Q8 proposes fixing it in Phase 0.

---

## 8. Test strategy

Backend jest, **in-memory Mongo only**, run per package with the pinned node:
`cd packages/admin && NODE_ENV=test /usr/local/bin/node ../../node_modules/.bin/jest`
(default node v26 breaks jest). Admin FE: `/usr/local/bin/node node_modules/.bin/vitest` — "green"
means still exactly the 5 known-failing `OrderDetailsModal` router tests, not zero.

**Unit (pure functions)**
- `codConversionReason` validation + note-required-on-OTHER.
- FE `convertToCod.ts`: convertible-status matrix, confirm-dialog copy, amount formatting.
- `reopen.service.js` extraction: the existing reopen tests must pass **unedited**.

**Integration — `packages/admin/__tests__/order-convert-to-cod.test.js`**
1. Mode A from `PAYMENT_CANCELLED`: wallet clawed back, stock re-deducted, `refundedAmount` 0,
   `stockRestored` false, `paymentMethod` 0, `codConversion` populated, audit row written.
2. Mode A from `PAYMENT_FAILED`: clawback 0, stock re-deducted, converts.
3. Mode B from `ASSIGNED` (the HP581915100 shape): **only** `paymentMethod` + `codConversion` change
   — assert stock quantity and `refundedAmount` are byte-identical before/after.
4. **Wallet-partial**: order `price 800`, `meta.walletUsed 200`, cron-refunded 200 ⇒ convert ⇒ wallet
   debited 200, `cashToCollect === 800`, and the order's `price` is untouched.
5. Wallet-short: customer spent the refund ⇒ 400, **nothing** written (assert `paymentMethod` still 1).
6. Captured payment ⇒ 409 `PAYMENT_ALREADY_CAPTURED`.
6b. Capture at Razorpay that the webhook never recorded ⇒ 409 `PAYMENT_ALREADY_CAPTURED`;
   gateway down ⇒ convert + alert (≤ ₹5,000) or 503 `GATEWAY_UNVERIFIABLE` (above it).
7. `OUT_FOR_DELIVERY` / `CLOSED` / `ADMIN_CANCELED` / `PAYMENT_INITIATED` ⇒ 409 `STATUS_NOT_CONVERTIBLE`.
8. **Concurrency**: two simultaneous `Promise.all` converts ⇒ exactly one audit row, one push, final
   state consistent; a second sequential call ⇒ 200 `alreadyConverted`, no new audit row.
9. **Tenancy**: store-A admin converting a store-B order ⇒ 403, no write. Super admin ⇒ allowed.
   Non-super admin with no `req.store` ⇒ 403.
10. Value threshold: ₹6,000 as store_admin ⇒ 403; as super_admin ⇒ 200.
11. Permission: a manager without `orders.convert_to_cod` ⇒ 403; with it ⇒ 200.
12. Scheduled order whose slot is full ⇒ 422 `SLOT_UNAVAILABLE`, nothing written.
13. Out-of-stock line ⇒ 400, nothing written.

**Integration — `packages/user/__tests__/razorpay-late-capture.test.js`**
14. Capture on a converted COD order ⇒ exactly one wallet credit, `refundedAmount` = captured,
    `meta.payment` recorded, `codConversion.lateCaptureAt` set, audit row, order stays COD and stays
    deliverable (`hasUnclawedRefund` false).
15. The **same webhook delivered twice** ⇒ still exactly one credit (marker de-dupe).
16. Capture on a *cancelled* order ⇒ existing behaviour unchanged (regression).
17. Capture on a live, never-converted order ⇒ Q8 behaviour (record only, no refund).

**Cash-books integration**
18. Converted order → `CLOSED` with `deliveredOn` + `assignedTo` ⇒ `getRiderSummary.cashCollected`
    includes `price` and `outstanding` rises by it.

**Mutation-test expectation** (if the team runs mutants on this file): every precondition in §3.3 and
every clause of the conditional filter in §3.4 must be killed by a test above — specifically flipping
`$ne: "captured"` → `$eq`, dropping `paymentMethod: RAZORPAY` from the filter, dropping the storeId
equality, and inverting the threshold comparison must each fail at least one test. If a mutant
survives, the missing test is the deliverable, not a waiver.

**Manual on dev**: place a Razorpay order, abandon the sheet, wait for the cron (or an admin cancel),
convert, confirm the rider app shows amber "COD" + the right ₹, deliver, confirm the cash card.

---

## 9. Open questions (each has a recommended default — "go with defaults" is a valid answer)

1. **Endpoint shape** — dedicated `POST /admin/order/:orderId/convert-to-cod` + extracting the reopen
   into a shared service? **Default: yes.**
2. **Status set** — Mode A from `PAYMENT_CANCELLED` + `PAYMENT_FAILED`; Mode B from `OPEN / PICKING /
   PACKED / PROCESSING / ASSIGNED`; `OUT_FOR_DELIVERY` excluded. **Default: as listed.** (Do you want
   `OUT_FOR_DELIVERY` included for the "rider is already there and the customer says cash" call?)
3. **Should plain reopen also accept `PAYMENT_FAILED`?** **Default: no** — leave `REOPENABLE_FROM`
   alone; only the new endpoint accepts it.
4. **Un-convert (COD → back to online)?** **Default: no for v1.**
5. **Permission** — new `orders.convert_to_cod`, not in the manager/support presets (so only
   super_admin + store_admin until granted). **Default: yes.** Alternative: reuse
   `orders.change_status` (then every manager/support already has it — I do not recommend that for a
   money action).
6. **Ignore `scheduling.allowedPaymentMethods`?** **Default: yes, ignore it** — it is a checkout-time
   customer rule; this is a deliberate admin recovery action on an order that already exists.
7. **Value threshold** — `COD_CONVERSION_MAX_VALUE = ₹5,000`, above which only `super_admin` may
   convert. **Default: ₹5,000.** (₹0 = no threshold; a number = super-admin escalation.)
8. **Fix the "capture on a live order is silently dropped" hole in Phase 0** (record `meta.payment`,
   no refund, no status change)? **Default: yes** — it is 5 lines and it makes
   `derivePaymentStatus` honest.
9. **Re-claim the coupon redemption on reopen/convert** via `confirmOrderCouponHold`? **Default:
   raise as a separate ticket, do not bundle** — it changes plain-reopen behaviour too.
10. **`payment.failed` not refunding `walletUsed`** — separate ticket? **Default: yes, separate.**
11. **Customer push wording** on conversion and on late capture — who signs off? **Default:**
    conversion → "Order #HP581915100 is on its way. Please keep ₹2,124 cash ready for the rider.";
    late capture → "We received your ₹2,124 online payment after this order was switched to cash, so
    ₹2,124 has been added to your wallet." **Needs your sign-off (customer-facing money copy).**
12. **Button also on the live Order Board card**, or details modal only? **Default: modal only for v1.**

---

## 10. Specialist assignment (for rahul's fan-out after approval)

| Part | Owner |
|---|---|
| Webhook late-capture branch, refund idempotency, money review of the endpoint | **hemant-payments** |
| Shared constants/schema/index, reopen-service extraction, the endpoint, backend tests | **sumit-backend** |
| Order-details modal UI spec (button placement, reason picker, confirm copy, converted badge) — **before** any FE code | **chanchal-designer** |
| Admin FE implementation + vitest | **tanmoy-web** |
| Index/partial-index review + any prod index step | **aabha-dba** |
| Rider app | **nobody — no change required** (verified §2.4) |
| `haper-misc/test-order-cod-conversion.md` + `docs/reference/order-payment-method-and-cash.md` | lands with Phase 2/4 |

---

**Not approved for implementation until Q1..Q12 are answered.**
