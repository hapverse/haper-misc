# Reference — `order.paymentMethod`, cash collection and the `price` invariant

Durable reference for anyone touching payment method, cash reconciliation or refunds on an order.
Facts verified in `haper-backend` on 2026-09-21. Related: `docs/plans/reopen-as-cod.md`.

---

## 1. The money invariant — `price` IS the cash

At checkout the order is written with:

| Field | Meaning |
|---|---|
| `actualOrderValue` | items total (gross) |
| `meta.walletUsed` | wallet coins spent on this order, **debited synchronously at order creation** |
| `price` | `pricing.finalPayable` — **already net of wallet, discount and coupon** |

Therefore, for a Cash-on-Delivery order:

> **Cash to collect = `order.price`. Full stop.**

**Never compute `price - walletUsed` anywhere** — the wallet was already taken at checkout, so
subtracting it again under-collects. Example: a ₹1,000 basket where the customer spent ₹200 of
wallet coins is stored as `actualOrderValue 1000`, `meta.walletUsed 200`, `price 800` — and the
rider collects **₹800**, not ₹600.

The rider app does **no** client-side arithmetic: it renders `order.price` verbatim
(`haper-delivery` `DeliveryOrderCard.kt` / `DeliveryHomeScreen.kt`).

## 2. Who keys on `paymentMethod`

`OrderConstants.paymentMethod` = `COD: 0, RAZORPAY: 1, STORE_PICKUP_PREPAID: 2,
STORE_PICKUP_POSTPAID: 3, WALLET: 4`.

| Consumer | File | Behaviour |
|---|---|---|
| Rider cash ledger | `packages/shared/repositories/cash-reconciliation.repository.js` | `cashCollected = SUM(price)` over `{assignedTo, status: CLOSED, paymentMethod: COD}`. **This is the only definition of "cash the rider owes".** |
| Rider "Cash to settle" card | `packages/delivery/src/routes/profile/controller.js` → `getRiderSummary` | same numbers |
| Rider app palette | `haper-delivery` `Color.kt` `paymentPalette` | buckets by *"must the rider collect cash?"* — COD + postpaid = amber, online/wallet/prepaid = green. Label from `DeliveryFormatters.kt` (`0 → "Cash on delivery" / "COD"`). |
| Profit snapshots | `packages/shared/repositories/profit-snapshot.repository.js` | COD orders are attributed to the **delivery** date; everything else to the creation date |
| Revenue split / report filters | `packages/shared/repositories/order.repository.js` | revenue by payment method; report + order-list `paymentMethod` filter |
| Invoice | `packages/shared/utils/invoice.utils.js` | prints `paymentMethodKeyMap[paymentMethod]`; generated at/after delivery |
| Admin payment status | `packages/admin/src/routes/order/controller.js` → `derivePaymentStatus` | WALLET → `paid`; RAZORPAY → `meta.payment.status === "captured" ? paid : pending`; everything else → `cod_pending`. **There is no `paymentStatus` field** — it is derived on every read. |
| Gateway truth check | `packages/admin/src/routes/order/controller.js` → `verifyNoGatewayPayment` (convert-to-cod) | `meta.payment` exists **only if the capture webhook landed**, so converting an order to cash first asks Razorpay directly (`razorPayUtils.fetchPaymentsByOrderId(meta.id)`, ~3s, one retry, outside the transaction). Blocks on any `captured`/`authorized` payment with `amount_refunded < amount`; fails closed (503 `GATEWAY_UNVERIFIABLE`) above `COD_CONVERSION_MAX_VALUE` and open + alert below it. |
| Resume-payment | `packages/user/src/routes/razorpay/controller.js` → `getRazorpayOrder` | returns `{order:null, msg:"COD order"}` for `paymentMethod === COD` |
| COD value cap | `packages/shared/utils/cod.utils.js` + `stores.config.codLimit` | **checkout-time only** (`placeOrder` / `placeScheduledOrder`), compared against `pricing.finalPayable`; `null` = no cap |
| Scheduled booking | `packages/shared/utils/scheduling.utils.js` `allowedPaymentMethods: [RAZORPAY]` | **checkout-time only**; never consulted on an admin mutation |
| COD-conversion cash ceiling | `OrderConstants.COD_CONVERSION_MAX_VALUE` — checked in `convertToCod` **and** re-asserted in `packages/shared/utils/order-edit.utils.js` → `assertCodConversionEditLimit` | Applies ONLY to orders that carry a `codConversion.convertedAt` record, and only to a change that **raises** `price` (a reduction on an over-limit order is always allowed). Compared against `price` — the cash, already net of `meta.walletUsed` — never the gross. Over the ceiling ⇒ super admin only, `403 {msg, code:"APPROVAL_REQUIRED"}`. `0`/unset ⇒ no ceiling. It is a **cash-risk control** (second pair of eyes + audit trail), not a security boundary: the actor is trusted. Plain COD orders are governed by `stores.config.codLimit` at checkout instead. |

Consequence: flipping `paymentMethod` from RAZORPAY to COD on an existing order is enough to make
the rider app, the cash ledger, the reports and the invoice all agree that cash is expected — no
other field has to change.

## 3. Where cash is reconciled

1. Rider delivers → order goes `CLOSED` with `deliveredOn` + `assignedTo`.
2. `cash-reconciliation.repository.js` sums `price` for that rider's closed COD orders in the
   window → the admin rider-cash screen and the rider's own "Cash to settle" card.
3. Nothing else tracks physical cash. There is no cash ledger table — the orders collection **is**
   the ledger, which is why `paymentMethod` must be correct *before* delivery, never after.

## 4. Refunds on an unpaid / partly-paid order

- `refundUtils.computeRefundOwed(order)` = `capturedAmount + meta.walletUsed − refundedAmount`.
  For an order that was never captured this is just the wallet coins — correct: no cash ever
  changed hands.
- `refundUtils.hasUnclawedRefund(order)` = `refundedAmount > 0 && stockRestored === true` — "the
  customer has both the money and the goods back", the guard that blocks re-activating such an
  order. A partial refund on a **live** order (`stockRestored false`) is deliberately not caught.
- The `(pay <paymentId>)` marker inside a refund `note` is the idempotency de-dupe for gateway
  settlement — `computeRefundOwed` reads it; duplicate webhooks rely on it.

## 5. `codConversion` (reopen-as-COD)

`orders.codConversion` (nullable sub-document, `default: undefined`) records an admin flipping an
**unpaid** online order to cash: who, when, reason code + note, `originalPaymentMethod`,
`originalStatus`, `walletUsedAtConversion`, `expectedCash` (== `price` at conversion),
`razorpayOrderId`, and `lateCaptureAt` / `lateCapturePaymentId` if a capture arrives afterwards.
Its presence is the "was this converted?" test. A paid order is **never** converted — that is a
refund, not a conversion.

### Index — must be built by hand

```js
{ "codConversion.convertedAt": -1 }
partialFilterExpression: { "codConversion.convertedAt": { $exists: true } }   // name: cod_conversion_recent
```

🚨 Declaring it in the schema builds **nothing** on dev or prod: every service connects with
`readPreference: "secondaryPreferred"`, which makes mongoose silently force `autoIndex: false`
(see `packages/shared/utils/mongo-index.utils.js`), and `OrderModel` is deliberately **not** in the
boot-time `ensureIndexesFor()` allowlist in `packages/*/src/connections/mongo.js` — `orders` is far
too large to index at boot. It has to be created explicitly (a `scripts/migrations/*` dry-run +
`--apply` step, or by the DBA). Any query that wants it must repeat
`"codConversion.convertedAt": { $exists: true }` literally, or the planner ignores the partial
index and does a collection scan.

### 🔒 Staff-only — never ship it to a customer or rider

`codConversion.by` (admin id, email, roles) and `codConversion.note` (free text an admin typed
about the customer) are internal. The customer and rider order reads are **exclusion** projections
(`.select({ __v: 0 })`), which hand over every new schema field automatically — so the field has to
be named to keep it out. The whole sub-doc is excluded on those reads: both apps decide cash vs
online from `paymentMethod` alone.

- `packages/shared/repositories/order.repository.js` → `CUSTOMER_SAFE_PROJECTION`
  (`{ __v: 0, codConversion: 0 }`), used by `getPaginated`, `getHistoryPaginated`, `getDetail`,
  `getAllOrdersForDelivery`, `getDeliveryDetail`.
- `packages/delivery/src/routes/order/controller.js` → `hideInternalFromRider`, because the
  mark-status / accept / reject responses are raw `findOneAndUpdate` results, not projected reads.
- Admin reads keep it (that is what the board badge and the Order Activity view read).

Any NEW staff-only field on `orders` inherits the same problem: add it to
`CUSTOMER_SAFE_PROJECTION` rather than trusting the exclusion list.
