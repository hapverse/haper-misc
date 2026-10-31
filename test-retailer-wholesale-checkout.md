# Test: Retailer (wholesale) program — checkout + per-retailer COD switch

**Plan:** `haper-backend/docs/plans/retailer-wholesale.md` (rev 2, Phase 1D steps 21, 22, 22b; §3.6, §3.9 cart-limit row, V13, V14).
**Backend:** `packages/shared/utils/retailer-payment.utils.js` (new), `packages/user/src/routes/order/controller.js` (both checkout paths),
`packages/admin/src/routes/order/controller.js` (convert-to-COD, mark-status-admin, edit refusal codes), `packages/shared/utils/order-edit.utils.js`,
`packages/shared/models/orders.schema.js` (new optional fields).
**Branch:** `dev` (direct-to-dev workflow). **Deploy:** backend only (user + admin services). No migration, no index, no client build needed.
**Related guides:** `test-retailer-wholesale.md` (apply + verify), `test-retailer-wholesale-cart.md` (cart), `test-retailer-wholesale-admin.md`.

## What this is (a real example)

Ravi is an approved retailer ("Sharma Kirana", GSTIN `10ABCDE1234F1ZF`, fictional). His store has wholesale ON.

- He puts **Maggi 70 g, Pack of 100** (a wholesale item) in his cart and picks **Cash on delivery**. His COD switch is OFF (the default),
  so checkout is refused: "Cash on delivery isn't enabled for wholesale orders on your account. Please pay online." He pays online and the order goes through.
- His normal household cart (rice, oil, no wholesale item) still allows COD, like any customer. The switch only matters when the cart has a wholesale item.
- A super admin turns his COD switch ON (Admin → Retailers → settings). Now COD works for his wholesale carts too.
- Every order he places at a store with wholesale ON (or with a wholesale line in it) carries a frozen copy of his shop identity (`retailerSnapshot`: legal name, shop name, GSTIN, state code, shop address).
  The GST invoice lane uses it; editing his profile later never changes old orders.

All names, numbers and GSTINs here are fictional.

## API behaviour

| Where | Situation | Result |
|---|---|---|
| `POST /user/order/place` (now and scheduled) | cart has a wholesale line, method `COD` or `STORE_PICKUP_POSTPAID`, retailer's COD switch OFF | 400 `{errorType:"RETAILER", reason:"RETAILER_COD_DISABLED"}` |
| same | same cart, `RAZORPAY` / `WALLET` | 200 |
| same | cart has NO wholesale line | unchanged for everyone (COD allowed) |
| same | wholesale line, buyer is not an APPROVED retailer, or store `wholesaleEnabled` is off | 400 "Out of stock: <name>. Please remove this item..." (same as an unavailable item) |
| `POST /admin/order/:id/convert-to-cod` | retailer order (has `retailerSnapshot`) with a wholesale line, switch OFF, store admin / manager / support | 409 `{code:"RETAILER_COD_DISABLED"}` |
| same | super admin | 200 + audit row `order.convert_to_cod.retailer_cod_override` |
| `PATCH /admin/order/edit-order/:id` | adds (or raises) a wholesale line on a non-retailer's order | 409 `{code:"RETAILER_WHOLESALE_NOT_ALLOWED"}` |
| same | adds (or raises) a wholesale line on a retailer's COD order, switch OFF | 409 `{code:"RETAILER_COD_DISABLED"}` (no super-admin override) |
| `PATCH /admin/order/mark-status-admin` | retailer order CLOSED → `ADMIN_CANCELED` / `REFUND_SUCCESS`, not super admin | 409 `{code:"RETAILER_CREDIT_NOTE_REQUIRED"}` |
| same | super admin | allowed + audit row `order.retailer_closed_reversal.override` |

## Steps

### A. Setup
1. Dev store with `config.wholesaleEnabled: true` and batch tracking ON. One retail item (Maggi 70 g) and one wholesale item (`wholesaleOnly: true`, e.g. Maggi Pack of 100).
2. Customer R = approved retailer (COD switch OFF). Customer N = normal customer.

### B. Checkout (now)
1. ✅ R: wholesale + retail item in cart, pay **Online** → order placed. In Mongo the order has `retailerSnapshot` and the wholesale line has `wholesaleOnly: true`; the retail line has no `wholesaleOnly` key.
2. ❌ R: same cart, **COD** → 400 `RETAILER_COD_DISABLED`. No order, stock unchanged.
3. ❌ R: same cart, **Pay at store pickup** → same 400.
4. ✅ R: retail-only cart, **COD** → placed (Q2: the switch only applies to wholesale carts). At a store with wholesale ON the order has `retailerSnapshot`; at a store with wholesale OFF it does not.
5. Super admin turns R's COD switch ON. ✅ R: wholesale cart, **COD** → placed.
6. ❌ N: a wholesale item reaches N's cart (old app / stale cart) → checkout refused "Out of stock: Maggi 70 g Pack of 100 ...". No stock taken.
7. ❌ R after a super admin **suspends** him (within 60 s, before his cached status expires): wholesale cart → refused as out of stock. The checkout reads the profile fresh, not from the cache.
8. ❌ Store `wholesaleEnabled` turned OFF: R's wholesale line → refused as out of stock.

### C. Checkout (scheduled)
Repeat B1, B2, B4, B6 with a scheduled slot (store scheduling ON, COD allowed for scheduled). Same results; a refused booking takes **no** slot seat.

### D. Cart limits
1. ✅ A cart-limit rule caps "Noodles" at 2 per order. R's cart has 4 × a wholesale noodles pack → allowed (wholesale lines are exempt).
2. ❌ R's cart has 4 × the single noodles packet → refused with the rule name (retail lines still capped, even for retailers).

### E. Admin convert-to-COD
1. R places an online order with a wholesale line and abandons payment (switch OFF).
2. ❌ Store admin: Convert to COD → 409 `RETAILER_COD_DISABLED`; order stays Razorpay.
3. ✅ Super admin: Convert to COD → converted. Order Activity shows "retailer COD override" next to the conversion.
4. ✅ A retailer's online order with only retail items converts for a store admin as before.
5. ✅ Any non-retailer order: convert-to-COD behaves exactly as before.

### F. Admin order edit
1. ❌ Add a wholesale item to N's order → 409 `RETAILER_WHOLESALE_NOT_ALLOWED`.
2. ❌ Add a wholesale item (or raise its quantity) on R's COD order with the switch OFF → 409 `RETAILER_COD_DISABLED`, stock unchanged.
3. ✅ Switch ON → the added line saves with `wholesaleOnly: true`.
4. ✅ Edit an unrelated line on an order holding a wholesale line → the wholesale line keeps `wholesaleOnly: true`.

### G. Delivered retailer order
1. ❌ Store admin moves a CLOSED retailer order to Refund success / Admin cancelled → 409 `RETAILER_CREDIT_NOTE_REQUIRED` (a GST invoice was issued; a credit note is needed and is not built yet).
2. ✅ Super admin can do it; Order Activity shows `order.retailer_closed_reversal.override`.
3. ✅ A non-retailer's CLOSED order: unchanged (store admin can still refund).

### H. No change for everyone else (regression)
1. ✅ Normal COD / online / wallet / store-pickup / scheduled checkouts: same response and same stored order as before (no `retailerSnapshot`, no `wholesaleOnly` or `packOf` keys on lines; a line may store `hsn` in the database, but the response to an ordinary customer never shows it, see H.1 below). Backed by `user/__tests__/retailer-checkout-baseline.test.js` fixtures captured before the change.
2. ✅ Checkout now retries a temporary database write conflict instead of failing (two shoppers buying the same item at the same moment). The customer never sees a double order or a double wallet deduction.

## Edge cases / notes
- A client that sends `COD` while its wallet covers the whole total is refused for a wholesale cart with the switch OFF (clients send `WALLET` in that case, so this should not happen).
- The COD switch only counts for an APPROVED retailer: a suspended retailer with the switch ON is still refused COD on wholesale lines (convert-to-COD and edits).
- `retailerSnapshot` is stamped only when the store has wholesale ON or the order has a wholesale line (see "Who gets `retailerSnapshot` now" below). The delivered-order lock in G applies to those orders.
- Not in this lane: wholesale lines skipping discounts / coupons / free-gift subtotal / referral (owner E), pack-line `packOf` + `hsn` writes (next lane), `GET /user/cart` `paymentOptions` (cart lane), credit / pay later (phase 2).

## Automated tests
- `packages/user/__tests__/retailer-checkout.test.js` (20 tests), `packages/user/__tests__/retailer-checkout-baseline.test.js` (3 golden fixtures),
  `packages/admin/__tests__/retailer-order-admin.test.js` (15 tests). In-memory Mongo only.

## Update 2026-10-31: review + security-audit fixes (supersedes the lines named below)

**Needs:** backend deploy (user, admin, cron). No client change, no migration.

### Who gets `retailerSnapshot` now (replaces the "Every APPROVED retailer order gets `retailerSnapshot`" note above)
The snapshot (and with it the B2B invoice, the real GST rate on lines, and the delivered-order lock in G) is stamped only when the **store has wholesale ON**. Example: retailer R orders 2 packets of salt from a store with wholesale OFF → a normal order, normal invoice, no snapshot. Reason: a store without wholesale may have no GSTIN, and then R could never download an invoice.
1. ✅ Approved retailer, store wholesale OFF, retail-only cart → order has no `retailerSnapshot`; line `gstRate` is 0 (the default).
2. ✅ Approved retailer, store wholesale ON, retail-only cart → snapshot present; line `gstRate` is the item's real rate (e.g. 18).

### H.1 corrected (replaces "no `hsn` keys on lines")
A normal customer's line now **stores** `hsn` when the item has one (for invoices), but the place-order / order-detail **response does not show it**. Example: Atta with HSN `1101` → `orders.items[0].hsn = "1101"` in the database; the app JSON has no `hsn` on that line. Retailer orders keep `hsn` in the response.

### G. Delivered retailer order (extends G.1)
The lock now looks at "was this ever delivered" (`deliveredOn` or an invoice number), not only the current status, and covers every status except Delivered.
1. ❌ Store admin: Delivered → Undelivered / Refund initiated / Out for delivery → 409 `RETAILER_CREDIT_NOTE_REQUIRED`.
2. ❌ Store admin: a once-delivered retailer order sitting at Undelivered or Refund initiated → Admin cancelled / Refund success → 409 (the two-step way round the lock is closed; no stock or wallet refund happens).
3. ✅ Store admin can move it back to Delivered.
4. ✅ A retailer order that was never delivered (rider could not deliver, Undelivered) → store admin can still cancel it.
5. ✅ Super admin can take every step; each one writes `order.retailer_closed_reversal.override`.

### Reopen re-checks the retailer
1. ❌ Reopen (Admin cancelled → Open) a COD order with wholesale lines while R's COD switch is OFF → 409 `RETAILER_COD_DISABLED`, no stock taken.
2. ❌ Same, but R is suspended (any payment method) → 409 `RETAILER_WHOLESALE_NOT_ALLOWED`.
3. ✅ R approved + COD ON → reopens. ✅ A retail-only retailer order reopens with the switch OFF.
4. ✅ Convert-to-COD keeps its own check and the audited super-admin override (unchanged).

### Scheduled orders are re-checked at release
1. ❌ R books a scheduled COD order with a wholesale line, then is suspended (or COD is switched off) → at release time the order is **held, not cancelled**: `lastReleaseError = "retailer_cod_blocked"`, no pick task, and the store admin gets one push "Scheduled order #… held". Later ticks do not push again.
2. ✅ Turn R's COD back on (or reinstate R) → the next release tick (every 2 min) releases it normally.
3. ✅ Online-paid or retail-only scheduled orders release as before.

### Checkout robustness
1. ✅ A coupon pinned on the cart that becomes invalid between two internal retries → checkout is refused with the coupon reason and the coupon use is given back (it used to be used up on an order with no discount).
2. ✅ The cart is cleared only after the order is saved. If clearing fails, the order still stands (the cart may still show the items; the customer can clear it).
3. ✅ The customer removes the cart coupon (or swaps it for another code) while an internal retry is happening → checkout is refused with a "couldn't apply this coupon, try again" message and the first coupon's use is given back. Before, the order could go through with no discount while the coupon was still marked used. A second tap places the order normally.

### Editing a once-delivered retailer order
Example: super admin moves R's delivered order to Undelivered, then reopens it. It is Open again, but it still has its delivery date / invoice number.
1. ❌ Store admin edits it (removes a line or lowers a quantity) → 409 `RETAILER_CREDIT_NOTE_REQUIRED`; items, total and wallet unchanged.
2. ✅ Super admin can edit it; an `order.retailer_delivered_edit.override` audit row is written with the normal `order.items.edit` row.
3. ✅ A normal customer's order with a delivery date stays editable by the store admin.

### Automated tests
- `packages/user/__tests__/retailer-checkout.test.js` (27 tests), `retailer-checkout-baseline.test.js` (3 golden fixtures; no retries; ran 15× in a row green),
  `packages/admin/__tests__/retailer-order-admin.test.js` (49 tests: adds invoice streaming, invoice search scope, edit lock, invoice-cache drop), `packages/admin/__tests__/pack-order-edit.test.js`, `packages/cron/__tests__/scheduled-release.test.js`.

### Picker app on a once-delivered retailer order
Example: super admin moves R's delivered order to Undelivered, then reopens it. Its old pick task comes back to the picker queue, but the order still has its delivery date / invoice number.
1. ❌ Picker marks a line **Out of stock** → the app shows "This retailer order was delivered with a GST invoice…" (409). Items, total, wallet and the pick-task line stay as they were; no audit row.
2. ❌ Picker does a **short pick** (e.g. picks 1 of 3) → same 409, nothing changes.
3. ✅ A full pick (all units found) still works — no money moves.
4. ✅ A retailer order that was never delivered, and a normal customer's order, keep Out of stock / short pick exactly as before (refund to wallet for prepaid).
5. ✅ Super admin edit from the admin panel is the only way to change such an order (writes `order.retailer_delivered_edit.override`).

### Invoice cache follows the order's state
The cached PDF is saved per order **version** (`print/invoices/v3/<orderId>-<updatedAt ms>.pdf`), so any change to the order makes the old PDF a miss.
1. ✅ Admin downloads an invoice, then the order is reversed, edited and re-delivered within 24 h → the next admin download is a fresh PDF with the new lines/total (never the old one, even if an old download finished uploading late).
2. ✅ Second admin download with no change → served from the cache (no rebuild).
3. ⚠️ The customer app download still uses the unversioned key until `user` controller `downloadInvoice` passes the order (one-line follow-up); old behaviour, no regression.

### Admin invoice search page cap
1. ✅ `GET /admin/order/invoices/search?query=INV&page=9999999999999999999999` → 200 with an empty list (page is capped at 1000), never a 400 with database error text.

### Automated tests (this round)
- `packages/picking/__tests__/retailer-delivered-pick-lock.test.js` (6 tests: OOS + short pick refused, invoice number alone refuses, non-delivered retailer + non-retailer unchanged).
- `packages/admin/__tests__/retailer-order-admin.test.js` (56 tests: adds shared edit-core refusal/opt-in, late invoice save is a miss, page cap).
- `packages/user/__tests__/retailer-checkout.test.js` (29 tests: adds scheduled-checkout coupon hold reuse + removed-coupon release), `invoice-model.test.js` (adds versioned cache miss).
- Deploy: backend only (admin + picking + user services share `packages/shared`).

### Rider marks a reopened, once-delivered retailer order "Undelivered"
Example: R's prepaid order (₹90 card + ₹68 wallet) was delivered with a GST invoice, super admin reversed + reopened it, and it went back out with a rider. The shop is closed, so the rider marks it Undelivered.
1. ✅ Rider's Undelivered goes through (200): status becomes Undelivered, the 2 units go back on the shelf, slot seat freed — same as any order.
2. ❌ No automatic wallet refund: R's wallet stays the same, no "refund credited" push, `refundedAmount` stays 0.
3. ✅ An `order.retailer_delivered_refund_held` row appears in the order's activity (Admin → Order Activity, search the HP id, or the order modal's history icon) with `amount: 158`, store, rider id and retailer profile id — no GSTIN/name/address.
4. ✅ Super admin issues the refund deliberately from the admin panel (super-admin override; credit note when built). The automatic paths stay locked for this order.
5. ✅ Rider taps Undelivered twice / two phones at once → only one held row, wallet never touched.
6. ✅ Nothing owed (COD, no wallet coins used) → status/stock change, no held row.
7. ✅ A retailer order that was never delivered, and a normal customer's order, still get the automatic wallet refund exactly as before.

### Invoice cache needs the order, not just its id
1. ✅ Customer and admin invoice downloads both pass the whole order, so both use the versioned key (supersedes the ⚠️ note above).
2. ✅ Code that hands the cache a bare order id now fails loudly (programmer error) instead of silently writing an unversioned entry.

### Automated tests (this round, rider hold)
- `packages/delivery/__tests__/order-undelivered-retailer-refund-hold.test.js` (6 tests: delivered-on and invoice-number holds, replay + concurrent hold once, nothing owed = no row, never-delivered retailer + consumer refunded as before).
- `packages/user/__tests__/invoice-model.test.js` (adds bare-id refusal), `packages/picking/__tests__/retailer-delivered-pick-lock.test.js` (now also pins the `{ code: 409, data: null }` envelope).
- Deploy: backend only (delivery + user + admin services share `packages/shared`).
