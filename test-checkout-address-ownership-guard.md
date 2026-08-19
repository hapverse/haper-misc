# Test: Checkout delivery-address ownership guard (cross-customer PII fix)

**Area:** Checkout (user app) → `POST /user/order/place`, both the instant and the scheduled path.
**Backend:** `packages/user/src/routes/order/controller.js`,
`packages/user/src/routes/order/validator.js`,
`packages/shared/repositories/address.repository.js`.
**Apps:** none. No Android / iOS / Web change, no app release.

---

## The problem this fixes

At checkout the order took `addressId` **straight from the request body** and wrote it onto the
order without ever checking that the id resolved to a real address the customer actually owns.

`AddressRepository.getDetail(userId, addressId)` is correctly scoped by `userId`, so if a customer
sent **someone else's** addressId the lookup returned `null` — but nothing looked at that `null`.
The raw id was still saved on the order.

Then roughly fifteen read paths do `.populate({ path: "addressId" })` with **no** ownership filter.
So the order happily rendered the *other* customer's real address — name, phone, street, landmark,
pin and GPS coordinates — back to the attacker, in the order-detail endpoint, the order list, and
even in the immediate response of the place-order call itself.

Plain example: Ravi opens the app, and instead of his own address id sends Priya's address id in
the checkout request. The order is created. Ravi then opens his own order and sees Priya's full
home address and phone number. Nothing in the system ever objected.

Four related holes, all closed here:

- **Nonexistent id:** an order was created against an address that does not exist → undeliverable
  order, no error shown to anyone.
- **Foreign id:** the PII disclosure above. **This is the actual security bug.**
- **Malformed id** (e.g. `"not-an-objectid"`): reached the DB layer and blew up as a raw Mongoose
  CastError 500 instead of a clean client error.
- **Store-pickup bypass** (found by a follow-up security audit, fixed in round 2 below): the first
  version of the guard was itself gated by `!storePickup`, so choosing store pickup walked straight
  past it and the leak was **still fully open**. See "Round 2" below.

On the **prepaid** path this also sat in front of money: the order is created and the transaction
committed *before* `razorPayUtils.create()` runs, so a payment could be captured by the async
webhook against one of these bad orders with no re-check.

**Real-world impact so far: zero.** A full census of the prod dump (20,963 orders / 2,059
addresses, read-only local `.bson` files — no live DB was touched) found no order referencing an
address it does not own. This is an unexploited hole, not an incident. Re-run after the audit, now
including the store-pickup cohort:

| Check | Count |
| --- | --- |
| Orders where `addressId` resolves to **another user's** address | **0** ← the one that matters |
| One `addressId` used by **more than one** distinct customer | **0** |
| Store-pickup orders (`paymentMethod` 2 or 3) with `addressId != null` | **1** — benign, see below |
| Orders whose `addressId` matches **no** address document | 1,175 (164 distinct ids) — benign |

The single pickup-with-address order (`BH658880`, `STORE_PICKUP_PREPAID`, 2025-08-06) resolves to an
address owned by **that same customer**, so it is not a compromise — just an old client sending a
field it did not need. Under the new code that same request now returns 400.

The 1,175 "no matching address document" orders come from only 164 distinct address ids, spread
across the whole date range. **No address document in the dump carries a `deletedAt` field at all**,
which means address deletion used to be a *hard* delete (soft-delete came later) — so these are
simply orders whose address the customer has since deleted. They populate to `null`: no PII, no
cross-user exposure. The "one id, more than one customer" count of **0** covers this bucket too —
it is the check that does not need the address document to exist, and it is clean.

**Not affected:** POS / counter sales (`packages/admin/src/routes/pos/controller.js`) always
hardcodes `addressId: null`.

---

## What changed

### 1. Ownership guard at checkout (the fix)

Both checkout functions now reject the order the moment the address does not resolve:

```js
if (!storePickup && addressId && !deliveryAddress) {
    throw new errorUtils("This delivery address is no longer available. Please pick another address.", 400);
}
```

- `placeOrder` (instant) — placed immediately after the `Promise.all` that loads cart + store +
  address, **before** the maintenance guard, stock reservation, wallet debit, gift reserve, order
  insert, cart clear and the Razorpay call. The throw lands in the existing `catch`, which calls
  `session.abortTransaction()` → **zero writes**.
- `placeScheduledOrder` (scheduled) — the same guard at the same point inside its
  `withTransaction`, i.e. **before `claimSeat()`**, so a rejected address can never burn a slot
  seat.

Deliberately duplicated, not extracted into a shared helper — these two functions are kept as
separate copies on purpose (see the comment block above `placeScheduledOrder`).

### 1b. Round 2 — the store-pickup bypass (the guard above was not enough)

A security audit found the first version of the guard could be walked around completely. Three
things that should have agreed did not:

- the **lookup** was gated by `!storePickup` — so on pickup `deliveryAddress` is `null` by
  construction;
- the **guard** was gated by the *same* `!storePickup` — so it short-circuited before it could ever
  notice that `null`;
- the **write** (`addressId,` into `OrderRepository.add`) was gated by **nothing at all**.

So `paymentMethod: "STORE_PICKUP_POSTPAID"` + another customer's `addressId` → **200**, order
created, and the victim's full address came back in the place-order response body and in every
later order read. Worse than the delivery case: `addressSnapshot` is `null` for pickup, so there was
not even a frozen copy — the order stayed exposed indefinitely via the live populate.

Plain example: Ravi picks "collect from store" at checkout and pastes Priya's address id. Before
this fix he got Priya's name, phone, street and GPS back in the response, and could re-read them any
time from his own order history.

Two changes, deliberately both (defence in depth):

```js
// 1. The write can never carry a client-supplied address on a pickup order,
//    whatever the guard does — this is the field ~15 read paths populate unscoped.
addressId: storePickup ? null : addressId,

// 2. The guard is no longer gated by !storePickup, and pickup gets its own
//    explicit, honest rejection instead of silently dropping the field.
if (storePickup && addressId) {
    throw new errorUtils("Address is not applicable for store pickup orders.", 400);
}
if (addressId && !deliveryAddress) { /* ...existing message... */ }
```

**Why reject rather than silently null it out:** no client ever sends both. Web omits `addressId`
entirely for pickup (`deliveryMode === 'home' ? selectedAddressId : undefined`), and Android and iOS
have no store-pickup checkout mode at all. So a request carrying both is malformed or hostile, and
is refused loudly instead of being quietly repaired.

Both fixes are mirrored into `placeScheduledOrder` defensively — that function already rejects
store pickup at the top ("Scheduled delivery is only available for delivery orders"), so it is
unreachable today and stays correct if that ever changes.

A `console.warn("[address-guard] rejected", {...})` (order flow, reason, userId, addressId — ids
only, no PII) now fires at each rejection so a probing attempt is visible in the logs.

### 2. Validator tightening (`validator.js`)

`addressId` is now `Joi.string().hex().length(24)` — it must look like an ObjectId. A malformed id
is rejected at the boundary with the codebase's standard Joi status (**403**) and never reaches the
controller or the DB.

### 3. `address.repository.js` missing `await` (separate correctness fix)

`getDetail`, `getDefault` and `update` did `return Model.findOne(...)` inside a `try` **without
`await`**, so the promise escaped the block and a rejection never reached the `catch` that wraps it
as a clean `errorUtils(..., 400)`. Now awaited. (`getPaginated`, `add`, `markDefault`, `delete`
were already correct.)

---

## Manual test steps

These need a request tool (Postman / curl) — the apps never send a wrong id, that is the point.

### ❌ Someone else's address id is rejected

1. Log in as customer A. Note customer B's address `_id` (from the dev DB).
2. `POST /user/order/place` as A with `addressId` = B's address id, `paymentMethod: "COD"`.
   - **Expect:** HTTP **400**, message *"This delivery address is no longer available. Please pick
     another address."*
   - **Expect:** the response body contains **none** of B's name / phone / street / landmark / pin.
   - **Expect:** no order was created, A's cart is untouched, item stock unchanged.

### ❌ A nonexistent (but well-formed) address id is rejected

1. Same call with a random valid-looking 24-hex id.
   - **Expect:** 400, same message, no order created.
   - Previously: 200 and a permanently undeliverable order.

### ❌ A malformed address id is rejected at the boundary

1. Same call with `addressId: "not-an-objectid"`.
   - **Expect:** HTTP **403** (Joi), a readable validation message — **not** a 500 CastError.

### ❌ Same three cases on the scheduled path

1. Repeat all three with `deliveryType: "scheduled"` + a valid `slotId`.
   - **Expect:** identical results, and the slot's booked count (`slot_capacity.orderIds.length`)
     is **unchanged** — a rejected address must not consume a seat.

### ❌ Prepaid: rejected before any money moves

1. Repeat the foreign-address case with `paymentMethod: "RAZORPAY"`.
   - **Expect:** 400, and **no Razorpay order is created** (nothing new in the Razorpay dashboard).

### ✅ Normal checkout is unaffected

1. Place an ordinary COD order to your own saved address.
   - **Expect:** 200 as always, `addressId` and `addressSnapshot` written as before.
2. Place a scheduled order to your own saved address.
   - **Expect:** 200 as always.

### ✅ Store pickup is unaffected

1. Place a `STORE_PICKUP_POSTPAID` order with **no** `addressId`.
   - **Expect:** 200, `addressId: null`. The guard must not fire — pickup legitimately has no
     address. This is what every real client sends.

### ❌ Store pickup **with** an address id is rejected (the round-2 bypass)

1. `POST /user/order/place` with `paymentMethod: "STORE_PICKUP_POSTPAID"` **and** customer B's
   `addressId`.
   - **Expect:** HTTP **400**, message *"Address is not applicable for store pickup orders."*
   - **Expect:** **none** of B's name / phone / street / landmark / pin / coordinates anywhere in
     the response body. Before the fix this returned **200** with B's full address inline.
   - **Expect:** no order created; `db.orders.countDocuments({ addressId: <B's id> })` is 0.
2. Repeat with `paymentMethod: "STORE_PICKUP_PREPAID"` — same result, and no Razorpay order.
3. Repeat with **your own** address id — also **400**. Sending an address with pickup is not a
   thing any client does, so it is refused rather than silently ignored.

---

## Edge cases

### ✅ Address deleted between screen-load and submit — behaviour change, on purpose

Phase 1 accepted this silently (order created, `addressSnapshot: null`). Now:

- The address is **soft**-deleted (Phase 2), and `getDetail` filters `deletedAt: null`, so it
  resolves to `null` → the order is now **rejected with a 400** telling the customer to pick
  another address.
- This is the intended trade-off: an order with no usable delivery address is not deliverable
  anyway, and the alternative is the PII hole. The message is deliberately customer-readable.
- This supersedes the "Address deleted between screen-load and submit" edge case in
  `test-order-address-snapshot.md`.

### ✅ A hard-deleted address (account purge) behaves the same

Resolves to `null` → 400. Same path, no special handling.

---

## Automated test coverage

**`haper-backend/packages/user/__tests__/order-address-guard.test.js`** (new, 13 tests):

Instant path — nonexistent id → 400 with no order / no stock decrement / cart intact; foreign id →
400 with an assertion that **no** victim PII value appears anywhere in the raw response body;
malformed id → 403 with `AddressRepository.getDetail` proven never called; foreign id on RAZORPAY →
400 with `razorPayUtils.create` proven never called; plus two regression tests (normal owned
address, and store pickup) that must still return 200.

Scheduled path — nonexistent id → 400 and `slot_capacity.orderIds` still empty; foreign id → 400,
no PII, no Razorpay call; malformed id → 403; plus a normal scheduled order regression test.

Store-pickup bypass (round 2) — a foreign `addressId` on **both** `STORE_PICKUP_POSTPAID` and
`STORE_PICKUP_PREPAID` → 400, zero victim PII in the body, and
`OrderModel.countDocuments({ addressId: victim })` is 0; plus the customer's **own** address id on a
pickup order → 400 with the "not applicable for store pickup" message.

These three were also verified load-bearing by reverting the round-2 fix: all three fail against the
old code, and the two PII ones fail on the **actual leak** — a 200 response whose body contains
`"name":"Victim Sharma","phone":"9812345678","street":"77 Secret Lane"...` with
`"addressSnapshot":null` — not merely on a status code.

The guard was verified **load-bearing**: with the guard removed, 7 of these 10 fail, and the
foreign-address assertions fail on the leaked `"Victim Sharma"` / `"9812345678"` values actually
present in the 200 response body — i.e. the tests reproduce the real leak, they do not merely
assert a status code.

Run from the package dir (in-memory Mongo):
`cd haper-backend/packages/user && NODE_ENV=test npx jest`

---

## What this needs to go live

**No migration required** — no schema change, no data change. The prod census (table above) found
no existing order carrying a foreign address, so there is nothing to clean up.

**Known follow-up, not built here:** rate limiting on `POST /user/order/place`. The guard makes each
probe fail, but nothing yet slows down someone enumerating address ids. Tracked separately as a
devops/infra item.

**Deploy:** normal backend deploy (`shared` + `user` packages). No admin or client release.

**Known follow-up (not in this change):** the admin side reads the same unscoped
`.populate("addressId")`, so the not-yet-merged Phase 3 "honest label" work (live populate wins over
the snapshot) would show a victim's address to an admin for any such order. This checkout-time
guard should land **first or alongside** that PR.

**Cross-links:** `test-order-address-snapshot.md` (Phase 1 — same `deliveryAddress` load),
`test-address-soft-delete.md` (Phase 2 — why `getDetail` can now return null for a real id),
`test-order-address-label.md` (Phase 3 — the admin read side).
