# Test: Switch an unpaid online order to Cash on Delivery ("reopen as COD")

**Area:** Admin → Orders → order details modal → Manage Status → Payment
**Backend (new):** `POST /admin/order/:orderId/convert-to-cod` — `packages/admin/src/routes/order/{controller,validator,router}.js`
**Backend (shared):** `packages/admin/src/routes/order/reopen.service.js`, `packages/shared/models/orders.schema.js` (`codConversion`), `packages/shared/constants/{order,permission,notification}.constant.js`
**Backend (webhook):** `packages/user/src/routes/razorpay/controller.js` (late-capture auto-refund)
**Plan:** `haper-misc/docs/plans/reopen-as-cod.md` · **UI spec:** `haper-misc/docs/plans/reopen-as-cod-ui-spec.md`
**Rider app / customer apps:** NO change and NO release needed.

## What this feature does

A customer starts an online (Razorpay) order, never finishes paying, and the order lands in
`PAYMENT_CANCELLED` (abandonment cron) or `PAYMENT_FAILED`. They ring the store: "send it
anyway, I'll pay cash." Before this, the only tool was the plain reopen, which left
`paymentMethod = RAZORPAY` — the rider app printed "Online payment" in green and the rider
cash ledger (which counts only `paymentMethod === COD`) missed the cash he was carrying.

The new action flips `paymentMethod` 1 → 0 **atomically with** the reopen and stamps a
`codConversion` record (who, when, why, what it used to be). Because the rider app, the cash
reconciliation, the reports and the invoice all key on that one field, nothing else has to
change.

**Money rule (do not "fix" this):** cash to collect = `order.price`, full stop. `price` is
ALREADY net of `meta.walletUsed`. An order of ₹1,000 where the customer spent ₹200 of coins
has `price = 800`, and the rider collects **₹800**. Never `price - walletUsed`.

## Modes

| Mode | From status | What happens |
|---|---|---|
| **A** `reopen_and_convert` | `PAYMENT_CANCELLED`, `PAYMENT_FAILED` | Slot re-claim → wallet clawback → stock re-deduct → `status: OPEN`, `refundedAmount: 0`, `stockRestored: false`, `paymentMethod: COD`, `codConversion` — one transaction. |
| **B** `convert_only` | `OPEN`, `PICKING`, `PACKED`, `PROCESSING`, `ASSIGNED` | Only `paymentMethod` + `codConversion`. This is the HP581915100 shape (already reopened, stock already deducted). |

Never convertible: `OUT_FOR_DELIVERY` (rider is at the door with a stale screen), `CLOSED`,
`CANCELED`, `ADMIN_CANCELED`, `UN_DELIVERED`, `PAYMENT_INITIATED`, `REFUND_*`, `FAILED`,
`DELETED`; any order with a captured payment; any order that is not Razorpay; POS orders.

## API contract

`POST /admin/order/:orderId/convert-to-cod`
Auth: `authenticate` + role in {super_admin, store_admin, manager, support} + permission
`orders.convert_to_cod` (in NO preset — a manager must be granted it on the Team page).

Body: `{ "reasonCode": "PAYMENT_FAILED_CUSTOMER_WILL_PAY_CASH" | "CUSTOMER_REQUEST" | "STORE_DECISION" | "OTHER", "note": "…" }`
`note` is required (non-blank) only for `OTHER`, max 300 chars, stored trimmed.

200 converted:
```json
{ "msg": "Order converted to Cash on Delivery",
  "data": { "order": { "…": "full order incl. codConversion" },
            "mode": "reopen_and_convert",
            "clawbackAmount": 200,
            "cashToCollect": 800,
            "alreadyConverted": false } }
```
200 repeat: `{ "msg": "This order is already Cash on Delivery.", "data": { "order": …, "alreadyConverted": true, "cashToCollect": 800 } }`

Errors are `{ msg, code }` — **branch on `code`, never on the message text**:

| HTTP | code | when |
|---|---|---|
| 400 | `INVALID_REASON` | missing/unknown reasonCode, note > 300 |
| 400 | `NOTE_REQUIRED` | `OTHER` with a blank/missing note |
| 400 | `UNCLAWED_REFUND` | Mode B order already refunded + restocked |
| 400 | `WALLET_SHORT` | customer spent the refunded coins (Mode A clawback) |
| 400 | `OUT_OF_STOCK` | a line can't be re-deducted (Mode A) |
| 403 | `STORE_CONTEXT_REQUIRED` / `FORBIDDEN_STORE` | tenancy |
| 403 | `APPROVAL_REQUIRED` | `price > ₹5,000` and not super admin |
| 404 | `ORDER_NOT_FOUND` | |
| 409 | `PAYMENT_ALREADY_CAPTURED` | the customer already paid online |
| 409 | `STATUS_NOT_CONVERTIBLE` | status outside Mode A ∪ B (message names the status) |
| 409 | `PAYMENT_METHOD_NOT_CONVERTIBLE` | wallet / store-pickup / POS order |
| 409 | `ORDER_CHANGED` | the conditional write matched nothing (someone else moved first) |
| 422 | `SLOT_UNAVAILABLE` | scheduled slot now full |
| 503 | `GATEWAY_UNVERIFIABLE` | Razorpay could not be reached **and** the order is above ₹5,000 (admin should retry in a minute) |

Audit rows: `order.convert_to_cod` (metadata: `mode`, `reasonCode`, `note`, `originalStatus`,
`originalPaymentMethod`, `cashToCollect`, `walletUsed`, `clawbackAmount`, `razorpayOrderId`)
and, in Mode A, `order.reopen` as well. Both show in Order Activity.

Pushes: customer `COD_CONVERTED` ("keep ₹2,124 cash ready"), and if a rider is assigned,
`PAYMENT_CHANGED_TO_COD` ("collect ₹2,124"). Both are fire-and-forget — a push failure never
fails the conversion.

---

## Manual test steps (dev)

### ✅ Mode A — abandoned payment, wallet coins involved
1. Customer app: place a Razorpay order using some wallet coins (e.g. total ₹1,000, coins ₹200
   → `price` 800). Close the payment sheet without paying.
2. Wait ~15 min for the abandonment cron (or have an admin cancel it) → status
   `PAYMENT_CANCELLED`, `refundedAmount` 200, `stockRestored: true`, coins back in the wallet.
3. Admin → Orders → open the order → Manage Status → **Switch to Cash on Delivery**, reason
   "Payment failed — customer will pay cash", confirm.
4. **Expect:** toast "reopened and switched…", status `OPEN`, payment shows COD,
   `clawbackAmount` 200, cash to collect **₹800**.
5. **Expect in DB/UI:** coins deducted by 200 again, item stock down by the ordered quantity,
   `refundedAmount` 0, `stockRestored` false, `codConversion` filled in (admin email, reason,
   `expectedCash` 800, `originalStatus` 9).
6. **Expect:** Order Activity shows BOTH "Order reopened" and "Switched to Cash on Delivery".
7. **Expect:** customer push "Please keep ₹800 cash ready for the rider."

### ✅ Mode B — the HP581915100 shape (already reopened, rider assigned)
1. Take an unpaid Razorpay order that was already reopened and assigned to a rider (`ASSIGNED`).
2. Switch it to Cash on Delivery.
3. **Expect:** status unchanged (`ASSIGNED`), stock unchanged, wallet untouched,
   `refundedAmount` unchanged, only `paymentMethod` + `codConversion` change.
4. **Expect:** the rider gets "Collect cash 💵 — Order #… is now Cash on delivery — collect ₹X",
   and after his app refreshes the card shows the **amber COD** palette with the same ₹X.
5. Deliver the order → rider "Cash to settle" card and the admin rider-cash reconciliation both
   include it.

### ✅ Double click is safe
Click the button twice (or have two admins click at once).
**Expect:** exactly one conversion, one audit row, one push. The second call returns 200
"This order is already Cash on Delivery." (or 409 `ORDER_CHANGED`) and writes nothing.

### ✅ Value threshold
An order above ₹5,000: a store admin gets 403 "Orders above ₹5,000 must be converted by a
super admin."; a super admin converts it. An order of exactly ₹5,000 is allowed for both.

### ✅ Permissions
- Manager **without** `orders.convert_to_cod` → 403 (and the button is hidden in the UI).
- Same manager after a store admin grants "Switch to COD" on the Team page → allowed.
- Warehouse manager/staff → 403 even if the permission string is granted (hard role gate).

### ❌ Paid order
An order whose `meta.payment.status === "captured"` → 409 `PAYMENT_ALREADY_CAPTURED`,
"This order was paid online. Cancel/refund it instead." Nothing is written.

### ❌ Paid at Razorpay but the webhook never landed (gateway truth check)
`meta.payment` is written **only** by the capture webhook, so a lost/disabled delivery leaves an
order that *looks* unpaid while the money sits at Razorpay. Before converting, the endpoint asks
Razorpay itself (`orders.fetchPayments` on `meta.id`, ~3s, one retry, once per request, before the
transaction opens).

1. On dev, take an order whose Razorpay order has a real `captured` (or `authorized`) payment and
   delete/never-deliver the webhook so `meta.payment` is absent.
2. Convert it → **409 `PAYMENT_ALREADY_CAPTURED`**, nothing written, and an audit row
   `order.convert_to_cod.blocked_unrecorded_capture` carrying the payment id, status and paise
   amounts for reconciliation. `meta.payment` is **not** written by this endpoint (the webhook
   owns it) — re-deliver the webhook to heal the order.
3. The response never contains the gateway payload — only the code and the generic message.
4. Only `failed`/`created` attempts, or a **fully** refunded capture (`amount_refunded === amount`)
   → the conversion proceeds. A **partial** refund still blocks (the rest of the money is ours to
   return, not to re-collect in cash).

### ⚠️ Razorpay unreachable during a conversion
1. Order **at or below ₹5,000**: the conversion **proceeds** (an outage must not brick the
   recovery action) and an alert row lands in `logs` —
   `type: WEBHOOK_ERROR, meta.code: "convert.gateway_unverifiable", meta.outcome:
   "converted_unverified"`, with the order id, razorpay order id, reason and cash amount.
2. Order **above ₹5,000**: **503 `GATEWAY_UNVERIFIABLE`** — "Could not verify the online payment
   status with Razorpay. Try again in a minute." Nothing is written; the alert row records
   `outcome: "refused"`. Clicking again a minute later succeeds once Razorpay answers.
3. A payment status this code does not recognise is treated the same way as an outage (never as
   "unpaid").
4. No gateway call at all when the order has no `meta.id`, when it is already COD (idempotent
   path), or when a cheaper local check (status/tenancy) would refuse it anyway.

> 🚨 **Those alert rows are only useful if somebody reads them.** The cron that mails them is
> `test-payment-alerts.md` (urgent tier, hourly — to `PAYMENT_ALERT_EMAILS` if set, super
> admins otherwise). It must be **deployed and
> verified before `orders.convert_to_cod` is granted to anyone** — a `converted_unverified`
> conversion is only an acceptable trade if a human hears about it within the hour.

### ❌ Wrong store
Store A's admin aiming at store B's order → 403 `FORBIDDEN_STORE`. Super admin may convert any
store's order.

### ❌ Wrong status
`OUT_FOR_DELIVERY`, `CLOSED`, `CANCELED`, `ADMIN_CANCELED`, `UN_DELIVERED`,
`PAYMENT_INITIATED` → 409 `STATUS_NOT_CONVERTIBLE` naming the status.

### ❌ Money blockers (Mode A)
- Customer spent the refunded coins → 400 `WALLET_SHORT`, nothing written.
- A line is out of stock → 400 `OUT_OF_STOCK`, nothing written (no partial deduct).
- Scheduled order whose slot filled up → 422 `SLOT_UNAVAILABLE`, nothing written.

### ❌ Refund already issued (Mode B)
`refundedAmount > 0` **and** `stockRestored === true` on a live order → 400 `UNCLAWED_REFUND`
("cancel the order instead").

### ❌ Not an online order
Plain COD → 200 `alreadyConverted` (no write). Wallet / store-pickup / POS → 409
`PAYMENT_METHOD_NOT_CONVERTIBLE`.

### 🔁 Late-capture drill (the one that must never double-collect)
1. Convert an order to COD (Mode A or B).
2. Make the customer's stale checkout sheet pay (or replay the Razorpay `payment.captured`
   webhook for that `meta.id` on dev).
3. **Expect:** the order **stays COD** and keeps its status; the captured amount is credited
   back to the customer's **wallet** exactly once; `refunds[]` carries
   `"Auto-refund: online payment captured after COD conversion (pay pay_XXX)"`;
   `codConversion.lateCaptureAt` / `lateCapturePaymentId` are set; `meta.payment` is recorded;
   audit row `order.cod.late_capture_refunded`; the customer is pushed about the wallet credit.
4. Replay the SAME webhook again → still exactly one wallet credit (the `(pay …)` marker
   de-dupes).
5. **Expect:** the order is still deliverable (a partial refund on a live order does not trip
   `hasUnclawedRefund`), and the rider still collects the full `price` in cash.
6. Reverse race: while the conversion is in flight, if the capture commits first the conversion
   fails with 409 (`PAYMENT_ALREADY_CAPTURED` or `ORDER_CHANGED`) and nothing is written. There
   is no interleaving that collects both cash and an unrecorded online payment.
7. Residual (by design): a capture that happens in the ~ms between the gateway check and the
   conditional write still converts — and is then auto-refunded by the late-capture webhook
   branch above. The gateway check closes the "webhook never arrived" hole; the webhook branch
   closes the "capture arrived after we decided" one.

### ✅ Coupon order — the discount is paid for by burning the code
Background in one line: a coupon order "holds" a redemption slot at checkout and the **online
payment** is what normally makes that slot final. A converted order never gets a payment, so the
conversion has to do it — otherwise the customer gets the discount AND the code stays re-usable.

1. Place an order with a coupon (say CASH50, ₹50 off) through Razorpay and abandon the payment.
2. **Mode B** (order still live, hold still `HELD`): convert → the redemption row becomes
   `CONFIRMED` and is stamped with the order id. The coupon's `usedCount` does **not** move (the
   slot was already counted when it was held).
3. **Mode A** (the abandonment cron already cancelled the order, so it gave the slot back and
   the row is `RELEASED`): convert → the old row **stays** `RELEASED`, a **fresh** slot is claimed
   and confirmed for this order, and `usedCount` goes back to 1.
4. Admin → Order Activity → `order.convert_to_cod` shows a `coupon` block:
   `{ code, redemptionId, holdBefore, confirmed, outcome }` where `outcome` is
   `confirmed` / `reclaimed` / `already_confirmed` / `reclaim_failed` / `confirm_failed` / `error`.
5. **Double click:** exactly one confirmed redemption, `usedCount` 1. Never two.
6. **Edge — the coupon ran out meanwhile** (someone else took the last slot while the order sat
   cancelled): the conversion **still succeeds** (a cash delivery is never blocked over a coupon);
   the audit says `outcome: "reclaim_failed"`, `confirmed: false`, and the server log carries a
   CRITICAL line. The customer keeps the discount on that one order and the coupon is under-burnt
   by one — deliberate, and visible in the trail. ⚠️ Product decision to confirm: is that the
   wanted behaviour, or should such an order be flagged for manual follow-up?
7. A no-coupon order is untouched: no redemption row, `metadata.coupon` is `null`.

### 🔁 After conversion
- Rider marks it `UN_DELIVERED`, or the customer cancels → the refund is the **wallet portion
  only** (nothing was ever captured). A COD order with no coins refunds ₹0. The burnt coupon is
  **not** given back (same anti-farming rule as a cancelled paid order).
- Invoice prints "COD". Reports/`order-list?paymentMethod=COD` include it from the conversion on.

## Automated coverage

- `packages/admin/__tests__/order-convert-to-cod.test.js` — 68 tests: both modes, every
  refusal, validator, tenancy, threshold, roles/permissions (manager **and** support, with and
  without the permission, plus the store boundary for a permitted manager), concurrency (two
  simultaneous converts, capture mid-flight, four "stale read vs conditional write" races),
  wallet-coins order, post-conversion refund math, and the coupon redemption block above
  (Mode B confirm, Mode A re-claim, exhausted-coupon, already-confirmed, per-customer limit).
  Plus the gateway truth check (15 tests): unrecorded capture ⇒ 409 + blocked audit row,
  `authorized` ⇒ 409, partial refund ⇒ 409, failed/created and fully-refunded ⇒ converts,
  Mode A refusal, retry-once, outage ≤ ₹5,000 ⇒ converts + alert, outage/timeout > ₹5,000 ⇒ 503,
  unknown status ⇒ 503, and the three no-call paths (no `meta.id`, already COD, wrong status).
- `packages/admin/__tests__/cod-conversion-constants-schema.test.js` — constants, permission,
  templates, `codConversion` sub-doc + partial index.
- `packages/user/__tests__/razorpay-late-capture.test.js` — the webhook drill above.
- Existing `order*` suites are the regression proof that plain reopen / status change / edit are
  unchanged.

Run (node 22 explicitly — the default `node` breaks jest):
```
cd packages/admin && PATH=/usr/local/bin:$PATH NODE_ENV=test /usr/local/bin/node ../../node_modules/.bin/jest order --runInBand
cd packages/user  && PATH=/usr/local/bin:$PATH NODE_ENV=test /usr/local/bin/node ../../node_modules/.bin/jest razorpay-late-capture razorpay.test.js order.test.js --runInBand
```

## Deploy order

1. **Backend** (webhook late-capture + shared constants/schema + the endpoint) — all together.
   The webhook branch is inert until the first conversion exists, so it can never be the
   lagging half.
2. **Verify on dev** with a real abandoned Razorpay order (Mode A) and an already-assigned one
   (Mode B), including the late-capture drill.
3. **Admin FE** (`haper-admin`): the button + reason dialog + converted badge, and the
   permission mirror (`src/constants/permissions.ts` + `PermissionGrid.tsx`) — without the
   mirror a manager can never be granted "Switch to COD".
4. **Index**: `codConversion.convertedAt` partial index is a **separate migration step**
   (orders reads secondaryPreferred, so schema-level autoIndex builds nothing). Not required for
   the feature to work — only for "show me all COD conversions this month".
5. **Rider app / customer apps:** no release.

Only after all of that does an admin fix the stuck prod order HP581915100 by clicking the
button. No script, no manual DB write, ever.

---

## Security fix loop — r1 (backend, 2026-09-21)

Audit findings M1, M3, M4, L2, L5. What changed and how to check it by hand.

### M1 — internal conversion data must not reach the customer / rider apps

`codConversion.by` (admin id, email, roles) and `codConversion.note` (free text about the
customer) were being shipped to both apps: the customer and rider order reads are **exclusion**
projections, which pass every new schema field through automatically. The whole sub-doc is now
excluded from those reads (neither app needs it — both read `paymentMethod`).

✅ Convert an order, then as the CUSTOMER open the order list, the order history and the order
detail → no `codConversion` anywhere in the JSON.
✅ As the RIDER (order assigned to him): my-orders list, order detail, accept, reject and
mark-status responses → no `codConversion`, and the note text appears nowhere.
✅ As an ADMIN: the board badge, the order list and the order detail still show the conversion.
❌ Known/accepted: the admin "customer → orders" tab shares the customer read, so that one list
does not carry the badge. Every admin order screen does.

### M3 — a conversion can no longer exist without an audit row

The `order.reopen` (Mode A) and `order.convert_to_cod` rows are now written INSIDE the
conversion's transaction. The coupon burn still runs after the commit (coupon collections must
never be touched inside a transaction) and its outcome is stamped onto the already-committed row
afterwards (`metadata.coupon`), best-effort.

✅ Convert → exactly one `order.convert_to_cod` row (plus `order.reopen` for Mode A), and
`metadata.coupon` filled in for a coupon order.
✅ A conversion that fails (409 lost race, refused precondition) leaves NO audit row.
✅ If the coupon step fails, the conversion and its audit row still stand
(`metadata.coupon.outcome = "error"`), and the failure is logged.

### M4 — coupon race + stale redemption pointer

(a) `CouponRedemptionRepository.getById` / `findByOrderId` now read from the PRIMARY (services
connect `secondaryPreferred`; a stale answer made the caller take a SECOND redemption slot).
(b) After a Mode-A re-claim, `order.coupon.redemptionId` is repointed at the NEW redemption.

✅ Mode A on an order whose hold the abandonment cron released → exactly ONE CONFIRMED redemption,
`usedCount` 1, and the order now points at that new row (not the RELEASED one).
✅ Cancel that order afterwards → the released row stays RELEASED, the confirmed row stays
CONFIRMED (a confirmed redemption is never handed back), `usedCount` unchanged.

### L2 — malformed order id

`POST /admin/order/<garbage>/convert-to-cod` now answers `404 {msg:"Order not found",
code:"ORDER_NOT_FOUND"}` instead of a 500 with a bare `{error}` body (which showed the admin a
blank dialog). Same answer as a well-formed id that does not exist — no existence oracle, no new
FE mapping.

### M2 — the ₹5,000 ceiling was bypassable with an item edit

The threshold was checked only at the moment of conversion. `editOrder` restricts item additions
to **prepaid** orders, and a converted order is COD — so a store admin could convert a ₹4,999
order and then edit it up to any amount of cash, or trim a ₹9,000 order under the limit, convert
it, and put it straight back. Nothing downstream re-checked it.

The ceiling is now re-asserted inside the shared `applyItemEdit`, on the in-transaction read,
before the write — so every caller (admin edit, picker) is covered, not just the one endpoint.
Only an edit that **raises** the cash is gated; the number compared is `price` (already net of
wallet coins), never the gross bill.

✅ Store admin converts a ₹4,999 order, then edits it up past ₹5,000 → **403
`{msg, code:"APPROVAL_REQUIRED"}`**, "Cash on delivery orders above ₹5,000 need a super admin to
raise the total." Items, price, stock, wallet and ledger are all unchanged.
✅ Super admin makes the same edit → allowed.
✅ Store admin raises a converted order to **exactly** ₹5,000 (or anything below) → allowed.
✅ ₹9,000 order trimmed to ₹4,000 → converted → edited back up to ₹6,000 → **403**.
✅ A converted order already above the limit (super-admin converted) trimmed **down** from ₹9,000
to ₹6,000 by a store admin → **allowed** (still over the ceiling; a reduction is never blocked, or
an over-limit order could never be brought back down).
✅ Coin order: gross ₹5,500 with ₹500 coins spent = ₹5,000 cash → allowed; gross ₹6,000 = ₹5,500
cash → 403. The gate reads the cash, not the gross.
❌ A plain COD order that was **never converted** is NOT gated — no threshold applies to those
today. Editing one up past ₹5,000 still succeeds (unchanged behaviour).
❌ Prepaid orders keep their own rule: increasing quantity is still the existing 400 "Paid orders
can only have items removed or quantities reduced", not `APPROVAL_REQUIRED`.

❗ Product question: should plain COD orders (and COD at checkout) carry the same ₹5,000 cash
ceiling? Today they do not — the control exists only on converted orders.

### L5 — inert notification preference key

`COD_CONVERTED` / `COD_LATE_CAPTURE_REFUNDED` declared `prefKey: "paymentUpdates"`, but they are
sent through `sendUserNotification`, which has no preference handling (only `sendOrderNotification`
does). The key was removed so it cannot be mistaken for an honoured opt-out.
❗ Product question: a customer who turned "payment updates" OFF still receives both pushes. If
that is wrong, the fix is to make the sender preference-aware — not to re-add the key.

### Tests

- `packages/admin/__tests__/order-convert-to-cod-audit.test.js` (8) — audit in-transaction,
  rollback on audit failure (Mode A + Mode B), no row on a 409, coupon-step failure, the
  redemption repoint, and the malformed-id 404.
- `packages/user/__tests__/order-cod-conversion-privacy.test.js` (3) — customer list / history /
  detail carry no `codConversion`.
- `packages/delivery/__tests__/order-cod-conversion-privacy.test.js` (4) — rider list / detail /
  accept / mark-status carry no `codConversion`.
- `packages/user/__tests__/coupon-redemption-lookup-primary-read.test.js` (2) — both lookups read
  from the primary (driver-level assertion).
- `packages/admin/__tests__/order-convert-to-cod-edit-limit.test.js` (9) — the M2 matrix above:
  convert-then-raise, super-admin allowed, at/under the limit, trim-convert-restore, reduction on
  an over-limit order, coins-vs-gross boundary, plain COD unchanged, prepaid rule unchanged, two
  concurrent raising edits.

```
cd packages/admin    && PATH=/usr/local/bin:$PATH NODE_ENV=test /usr/local/bin/node ../../node_modules/.bin/jest order --runInBand
cd packages/user     && PATH=/usr/local/bin:$PATH NODE_ENV=test /usr/local/bin/node ../../node_modules/.bin/jest order.test.js razorpay order-cod-conversion-privacy coupon-redemption --runInBand
cd packages/delivery && PATH=/usr/local/bin:$PATH NODE_ENV=test /usr/local/bin/node ../../node_modules/.bin/jest order profile --runInBand
```

## Security fix loop — r2 + r3, batch A (backend, 2026-09-21)

Second-round findings on the same endpoint plus one from the Razorpay-webhook audit.

### M (release blocker) — `codConversion` still reached the customer on CANCEL

The r1 fix closed the READ projections, but the customer **cancel** handler answers with the raw
`findOneAndUpdate` document — no projection — so the acting admin's id/email/roles and the
internal note still shipped. Reachable because a converted order sits at OPEN, and OPEN is
cancellable (for a scheduled order, for days).

The strip now lives in `sanitizeOrderForCustomer`, next to `releaseAt`/`slotHistory`, which
covers every raw-document path the customer app has.

✅ Convert an order that carries a note, then cancel it as the customer within the 1-minute window
→ 200, order CANCELED, and **no** `codConversion` / admin email / note text anywhere in the body.
✅ Same for a **scheduled** order cancelled days ahead of its slot.
✅ Customer invoice download (`getInvoiceData`) — the PDF read moved off the bare `{__v:0}`
exclusion onto `CUSTOMER_SAFE_PROJECTION`. The invoice PDF is unchanged (it never used the field).
✅ Sweep: no other customer/rider endpoint returns a raw order document. Picker never returns one;
the rider's accept/reject/status responses already go through `hideInternalFromRider`; the
change-slot response re-reads through `getDetail` and is sanitized.

### L — a body `orderId` could override the path param

The validator merged `{...req.params, ...req.body}`, so a body `orderId` won validation while the
handler still read `req.params.orderId` — a malformed path id sailed through to Mongoose. Merge
order is now body first, path param last.

✅ `POST /admin/order/not-an-id/convert-to-cod` with body `{"orderId":"<a real id>", reasonCode}`
→ **404 `{msg:"Order not found", code:"ORDER_NOT_FOUND"}`**, and the order named in the body is
untouched.
✅ A valid request that also carries a body `orderId` converts the **path** order and ignores the
body one (the path param overwrites it before validation, so it is not an unknown-key rejection).
❌ Every other unknown body key is still rejected as before.

### L — fail-open policy no longer rides on the approval threshold

The "Razorpay unreachable" branch read `COD_CONVERSION_MAX_VALUE`, so setting that to 0 to turn
the super-admin approval step OFF also made every conversion fail **open** at any value, silently.
It now reads its own constant, `OrderConstants.COD_GATEWAY_FAIL_CLOSED_ABOVE` (default ₹5,000).

**Semantics chosen:** `cashToCollect > value` ⇒ fail closed (503). `0`, negative or unset ⇒ fail
closed at **every** order value. Turning verification off should never be something you get by
accident — it has to be a deliberately large number.

✅ Default config: behaviour is exactly as documented under "⚠️ Razorpay unreachable" above
(≤ ₹5,000 converts with an alert, > ₹5,000 is a 503).
✅ `COD_CONVERSION_MAX_VALUE = 0` (approval step off): a ₹6,000 order with Razorpay down is still
**503**, not a silent conversion.
✅ `COD_GATEWAY_FAIL_CLOSED_ABOVE = 0`: even a ₹300 order with Razorpay down is a 503.
✅ Raising it to ₹9,000: a ₹6,000 order converts unverified and writes the
`outcome: "converted_unverified"` alert row.

### M (webhook audit) — double re-claim of a released coupon slot

`reclaimReleasedSlot` went from "the hold was released" straight to `claim()`. Two callers — the
late-capture webhook and the admin reopen/convert — could both see the hold released and both take
a fresh slot: the coupon ends up redeemed one time more than its cap, and the loser's CONFIRMED
row is an orphan no cancel path will ever release. It now asks `findByOrderId` (primary-pinned)
first and adopts an existing CONFIRMED row instead of claiming.

✅ Two reclaims for the same order → exactly ONE CONFIRMED redemption, `usedCount` 1, and
`order.coupon.redemptionId` points at that row.
✅ A caller that re-read the order and holds the NEW redemption id is idempotent too.
✅ An order with no CONFIRMED row of its own still re-claims normally.
❗ Residual: two reclaims that interleave **exactly** (both read before either confirms) can still
double-claim — the guard is a read-then-act, and the two claims take different ordinals so no
unique index stops them. The window is now milliseconds instead of seconds; closing it fully needs
a claim conditional on the order, which is a bigger change than this audit item.

### Tests added in batch A

- `packages/user/__tests__/order-cod-conversion-privacy.test.js` → 6 (was 3): + cancel, +
  scheduled cancel, + invoice data.
- `packages/user/__tests__/coupon-reclaim-double-claim.test.js` (3) — the adopt-before-claim guard.
- `packages/admin/__tests__/order-convert-to-cod.test.js` — + 2 validator tests (body `orderId`)
  and + 3 fail-closed-constant tests.
