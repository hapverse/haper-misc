# Test: delivery instructions (customer note on an order)

**Area:** Backend + Android + Admin.
- Backend: `packages/shared/models/orders.schema.js` (`deliveryInstructions`),
  `packages/shared/constants/order.constant.js` (`DELIVERY_INSTRUCTIONS_MAX_LENGTH`),
  `packages/user/src/routes/order/validator.js` (`placeOrder`),
  `packages/user/src/routes/order/controller.js` (`placeOrder` + `placeScheduledOrder`).
- Android: `CartViewModel.deliveryInstructions`, `CartScreen.kt` (input card + "Deliver to" row),
  `CheckoutScreen.kt` (passes it through), `OrderViewModel.placeOrder`, `OrderModels.kt`
  (`PlaceOrderRequest`, `Order`), `OrderDetailScreen.kt` (read-back).
- Admin: `src/types/order.ts`, `src/pages/Orders/OrderDetailsModal.tsx`.

**PR/deploy:** backend deploy **first** (the field must exist before an app build sends it), then
the Android release, then admin. Order matters only for the write path — an old app simply omits
the key and the order saves with `deliveryInstructions: null`.

## What changed
The cart's "Delivery instructions" block used to be static copy in the design mock. It is now a
real input: the customer types a note on the cart, it travels with `POST /user/order/place`, is
frozen onto the order document (like `addressSnapshot` — it describes *this* delivery, not the
saved address), and is shown back on the app's order detail and in the admin order modal.

Server trims the note and caps it at **200 characters**; `""` is normalised to `null` so the column
is either a real instruction or absent. The client caps input at the same 200 so a request can
never be rejected for length alone.

## Steps

### Android — write path
- ✅ **Type a note and place an order.** Cart → "Delivery instructions" card → type
  `Ring the bell once`. Placeholder (`Ring the bell once · leave at the door`) disappears as you
  type; the card's border turns amber while focused. Place the order.
- ✅ **Order detail shows it back.** Orders → the order just placed → under "Delivery address"
  there is a `DELIVERY INSTRUCTIONS` eyebrow and the note.
- ✅ **Leave it blank → nothing breaks and nothing shows.** Place an order without touching the
  card. Order detail shows the address card with no instructions block.
- ✅ **Note is cleared with the cart.** After an order is placed, reopen the cart and add an item —
  the instructions field is empty, not carrying the previous order's note.
- ✅ **Long note is capped client-side.** Paste >200 characters; input stops accepting at 200.

### Android — "Deliver to" row
- ✅ Cart footer shows `Deliver to {label} · {street}` over the full address line, with a mint
  **Change** chip. Tapping either the row or the chip opens the address list.
- ✅ **No default address yet** → the row is hidden entirely and only "Proceed to pay" shows.
  (The CTA still routes to address selection, so the flow is unchanged.)

### Backend
- ✅ `cd packages/user && NODE_ENV=test npx jest __tests__/order.test.js` — includes three new
  cases: the note is trimmed and frozen, it defaults to `null` when omitted, and a 201-character
  note is rejected with **403**.
- ✅ **Scheduled orders carry it too.** Place a scheduled order with a note (`deliveryType:
  "scheduled"`); the saved order has the same `deliveryInstructions`. This is a *separate function*
  (`placeScheduledOrder`) from the instant path — both were wired.
- ✅ **Old clients are unaffected.** A `POST /user/order/place` body with no `deliveryInstructions`
  key succeeds exactly as before and stores `null`.

### Admin
- ✅ Orders → open an order placed with a note → the **Shipping Address** card shows a
  `Delivery instructions` block below the address, separated by a hairline, with the note.
- ✅ An order without a note shows the address card unchanged — no empty block, no stray divider.

## Edge cases
- **Pre-feature orders** have no `deliveryInstructions` key at all. Android's `Order.deliveryInstructions`
  is nullable (Gson decodes a missing key to `null`, never the Kotlin default), and the admin type
  is `string | null | undefined` — both render nothing.
- **Whitespace-only note** (`"   "`) is trimmed server-side to `""` then normalised to `null`, so it
  is treated as "no note" rather than an empty instruction.
- The note is **display-only** — never parsed, never used for routing or fees.

## Not covered
- **Picker / delivery apps do not surface it yet.** The field is returned by their order-detail
  reads (both use `.select({ __v: 0 })`, an exclusion projection, so it flows automatically), but
  neither UI renders it. That is the obvious next step — the rider is the person the note is
  actually for.
- **No edit-after-placement.** The note is frozen at checkout; there is no endpoint to change it.
- **Not on the order list/board.** `getActiveBoardOrders` uses an inclusion projection that does not
  include the field, deliberately — a note belongs on the detail, not a board row.
