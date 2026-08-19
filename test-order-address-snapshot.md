# Test: Order address snapshot (Phase 1 — order durability fix)

**Area:** Checkout (user app) → order record. Admin → order detail/list (read-only benefit).
**Backend:** `packages/shared/models/orders.schema.js`, `packages/shared/utils/address.utils.js`,
`packages/shared/utils/index.js`, `packages/user/src/routes/order/controller.js`.
**Apps:** none. No Android / iOS / Web change, no app release.

## The problem this fixes

An order stored only a **pointer** (`orders.addressId`) to the customer's saved address — it never
kept its own copy. So the order's delivery address was only as durable as the address document.
Phase 2 (soft-delete) stopped the normal "customer deletes an address" path from destroying it, but
two holes remain:

- Orders placed **before** Phase 2 shipped still point at rows that were hard-deleted.
- The compliance **account-purge** job still hard-deletes addresses (by design — right to erasure).

Phase 1 closes both going forward: at checkout the order freezes its own copy of the delivery
address into a new `addressSnapshot` field. This is exactly the pattern already used for
`items[].costPrice` and `items[].name` — snapshot at sale time so later upstream edits or deletions
can't rewrite history.

**Real evidence:** order HP966912806 — a real ₹271 Razorpay-paid, delivered order — shows
"Store_Pickup ()" in admin today because the customer deleted the address afterwards.

**Full design:** `/Users/office/Documents/haper/haper-misc/order-address-durability-plan.md` §3
(Phase 1) and §4 — DBA-approved.

---

## What changed

### Backend

**Schema (`orders.schema.js`):** new optional field on the order

```
addressSnapshot: { type: addressSnapshotSchema, default: null }
```

`addressSnapshotSchema` is an **explicit named sub-schema** (`_id: false`) with:
`name, phone, street, village, landmark, addressLine1, label, pin, location.coordinates`.

Why an explicit sub-schema and not a plain nested object: with a bare nested object Mongoose
ignores the parent `default: null` and writes `{name:null, phone:null, ...}` onto **every** order.
That would make "this order has no snapshot" impossible to express — and the backfill script
(§5 of the plan) needs to tell "never backfilled" apart from "backfilled but unrecoverable".

No index — this field is never queried on.

**Builder (`packages/shared/utils/address.utils.js`, new):** `buildAddressSnapshot(addressDoc)` —
a pure, I/O-free whitelist copy. Returns `null` when there is no address (store pickup, or the
address vanished between screen-load and submit). Exported from `shared` as `utils.addressUtils`.

**Checkout wire-up (`packages/user/src/routes/order/controller.js`):** both order-create sites now
pass `addressSnapshot: addressUtils.buildAddressSnapshot(deliveryAddress)` —
the instant path (`placeOrder`) and the scheduled path (`placeScheduledOrder`). No new DB read:
`deliveryAddress` was already loaded at both sites for the serviceability/delivery-charge checks.

**POS / counter sales are deliberately untouched** (`packages/admin/src/routes/pos/controller.js`)
— those set `addressId: null` on purpose and stay snapshot-less.

### Apps (no changes)

Nothing to do on Android / iOS / Web. `addressSnapshot` is a new **additive, nullable** field;
old builds simply ignore the extra key. No app release needed.

---

## Manual test steps

### ✅ A normal order freezes the address

1. On the app (dev), place a COD order to a saved address ("Home", with name/phone/street/pin).
2. Look the order up (admin order detail, or the DB on dev):
   - **Expect:** the order has an `addressSnapshot` object whose fields match the address used
     exactly — name, phone, street, village, landmark, addressLine1, label, pin, and
     `location.coordinates`.
   - **Expect:** `addressId` is still set as before (nothing about today's display changes).

### ✅ A scheduled order freezes it too

1. On a store with scheduled delivery enabled, book a slot and place a Razorpay scheduled order.
2. **Expect:** the same populated `addressSnapshot` on that order (the scheduled path is a separate
   create call — it is easy to fix one and forget the other, so check it explicitly).

### ✅ THE money test: delete the address afterwards

1. Place an order to address "Home".
2. On the app, **My Addresses → Home → Delete** (200, gone from the list; soft-deleted per Phase 2).
3. Re-read the order.
   - **Expect:** `addressSnapshot` is **completely intact** — the full delivery address is still on
     the order, independent of the address document's state.
   - **Expect:** no crash anywhere (admin detail, thermal print, invoice).

### ✅ A genuine store pickup gets NO snapshot

1. Place an order with payment method **STORE_PICKUP_POSTPAID** (or PREPAID) — no address.
2. **Expect:** `addressId` is `null` **and** `addressSnapshot` is `null`.
   - This is load-bearing: "null snapshot" must keep meaning "genuinely no address", otherwise
     Phase 3 cannot tell a real pickup apart from a lost address.

### ✅ Old orders are unaffected

1. Open any order placed **before** this shipped.
   - **Expect:** it has **no** `addressSnapshot` key at all (not an empty object of nulls).
   - **Expect:** it renders exactly as it does today, everywhere (admin, app order history,
     rider app, invoice). Phase 1 changes nothing about how any existing order displays.

---

## Edge cases

### ✅ Address deleted between screen-load and submit

Customer opens checkout with address A, deletes A in another tab/screen, then submits.

- **SUPERSEDED** by the checkout ownership guard — see
  `test-checkout-address-ownership-guard.md`. Checkout now **rejects with a 400** ("This delivery
  address is no longer available…") whenever the address does not resolve for that customer,
  because the same unchecked `null` was also what let one customer's order carry (and display)
  another customer's address.
- Previous behaviour, for reference: the order was still created with `addressSnapshot: null`
  (plan §7). After Phase 2 the address row still exists, but soft-deleted rows are filtered out by
  `getDetail`, so this case now 400s.

### ✅ An address with only the minimum fields filled

Add an address with just phone + pin (no landmark, no label, no addressLine1) and order to it.

- **Expect:** the snapshot exists, with the missing fields set to `null` (never `undefined`,
  never dropped) and `location.coordinates` present as an array (`[]` if the address has none).

### ❌ Not covered by Phase 1

- **Old orders do not get a snapshot retroactively** — that is the separate backfill script
  (plan §5, dry-run + `--apply`, DEV only for now) and it is **not built yet**.
- **The admin "Store_Pickup" mislabel is fixed in Phase 3, not here** — see
  `test-order-address-label.md`. Phase 3 is what actually reads this snapshot back on the admin
  side; until it ships, an order with a missing address shows the old wrong label even if a
  snapshot now exists.
- **Account-purge PII blanking of the snapshot is NOT built yet** (plan §5a, prerequisite 2).
  Until it is, a purged user's order retains name/phone/street in `addressSnapshot`. This must
  ship before the backfill is run on prod.

---

## Automated test coverage

**`haper-backend/packages/user/__tests__/order-address-snapshot.test.js`** (new, 5 tests):

- instant COD order → snapshot populated and field-for-field equal to the address used;
- scheduled order → same (covers the second, independent create site);
- genuine `STORE_PICKUP_POSTPAID` order → `addressId` null **and** `addressSnapshot` null;
- place an order → soft-delete that address via `DELETE /user/address/:id` → order's snapshot
  still fully intact (the regression this phase exists for);
- a raw legacy order inserted with no `addressSnapshot` key reads back cleanly
  (`undefined` on a lean read, `null` hydrated — no materialized `{name:null,...}`).

Run from the package dir (in-memory Mongo):
`cd haper-backend/packages/user && NODE_ENV=test npx jest`

Regression check on the admin side (orders are constructed/read there too):
`cd haper-backend/packages/admin && NODE_ENV=test npx jest __tests__/order-edit-discount-snapshot.test.js __tests__/scheduled-admin-views.test.js`

---

## What this needs to go live

**No migration required** — the field is additive and optional; existing orders simply lack the key.

**Deploy:** normal deploy of the backend (`shared` + `user` packages). No admin or client release.

**Ordering:** Phase 2 (soft-delete) ships first (done), then this, then the backfill script, then
Phase 3 (honest admin label). The account-purge PII-blanking companion change (plan §5a) must land
before the backfill is ever run on prod.

**Cross-links:** `test-address-soft-delete.md` (Phase 2), `test-order-address-label.md` (Phase 3 —
the admin read side that consumes this snapshot), `test-store-from-delivery-address.md`
(the serviceability guard that loads the same `deliveryAddress` at checkout).
