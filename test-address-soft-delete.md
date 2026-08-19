# Test: Address soft-delete (Phase 2 — order durability fix)

**Area:** User app → address list + checkout. Delivery app → rider navigation.
Admin → order detail/list.
**Backend:** `packages/shared/models/addresses.schema.js`, `packages/shared/repositories/address.repository.js`, address delete routes.
**Apps:** Android + iOS + Web (checkout, address list).

## The problem this fixes

Orders store only a **pointer** (`addressId`) to a customer's saved address. When a customer deletes
that address (hard delete, today), the order permanently loses all delivery-address history. Admin's
`.populate('addressId')` then returns null—indistinguishable from a genuine store-pickup order—so
admin actively mislabels real delivered orders as **"Store_Pickup"**. A rider also loses navigation.

**Real evidence:** Order HP966912806 — a real ₹271 Razorpay-paid, successfully delivered order — now
shows "Store_Pickup ()" in admin.haper.in because customer Aditya Kumar deleted his saved address
after checkout. The address is permanently gone.

Phase 2 prevents this from happening to **future** address deletions: convert address deletion from a hard
delete to a **soft delete** (mark with `deletedAt: Date`, filter from customer lists). Orders' `.populate('addressId')`
**keeps resolving forever**. All read-sites (admin, rider, invoices) need **zero code changes**.

**Full design:** see `/Users/office/Documents/haper/haper-misc/order-address-durability-plan.md` §3
(approved, includes DBA sign-off and test strategy).

---

## What changed

### Backend

**Schema:**
- `haper-backend/packages/shared/models/addresses.schema.js`: new field `deletedAt: { type: Date, default: null }`.
  Single field only (soft-delete marker); backward-compatible.

**Repository (`address.repository.js`):**
- `delete()` method: instead of `Model.deleteOne(...)`, now sets `{ deletedAt: new Date() }` (atomic soft-delete).
  If the deleted address was the default, the next-newest active address is promoted to default via atomic `findOneAndUpdate`.
- All customer-facing read functions (`getPaginated`, `getDetail`, `getDefault`, list queries in `add()` count check)
  now filter `{ deletedAt: null }` — soft-deleted rows are invisible to the customer.
- `deletedAt` is **stripped from every API response** — it never leaks to clients.

**Behavior (from a customer's view):** deleting an address in the app looks and behaves **exactly the same as
before** (gone from their address list, 200 response). The only difference is invisible: the row is kept internally
so any past order that pointed at it can still resolve/display that address correctly.

**Behavior (from an admin's view):** an order whose customer later deleted their delivery address will now
**still show the correct address** in admin (order list, order detail, thermal print, invoice) instead of showing
nothing / getting mislabeled. (Note: the "Store_Pickup" mislabel fix itself is Phase 3, not yet built — this
Phase 2 guide is **only about the soft-delete mechanism**. If a tester runs through this now, an order with
a pre-existing dangling reference from **before** this fix shipped will still show the old broken label until
Phase 3 ships — see "Known limitation" below.)

### Apps (No changes)

Zero changes to Android, iOS, or Web for Phase 2 — the soft-delete is invisible to clients. Address lists still show
only active addresses; checkout still resolves from active addresses. The benefit is **internal durability** (orders
keep their history) and **rider navigation safety** (address `.populate()` never returns null mid-delivery).

---

## Manual test steps

### ✅ Place an order, then delete the address used — order still shows it in admin

1. On the app (dev):
   - Add a delivery address (e.g. "Home", with a pin).
   - Place an order (COD or Razorpay, doesn't matter).
2. Confirm the order appears in admin.haper.in: order list → the order shows the address as normal.
3. On the app, go to **My Addresses** → tap the address used → **Delete**.
   - **Expect:** 200 response, address gone from the list.
4. In admin, reload the **order detail** page for that order (or search for the order ID).
   - **Expect:** the address is **still there** (name, phone, street, pin). Not null, not missing, not "Store_Pickup".
   - **Expect:** the order detail page renders correctly (no null-pointer crash, no blank fields).

### ✅ Delete the default address — next-newest address becomes default

1. On the app:
   - Add two addresses: "Home" + "Office".
   - Mark "Home" as default (or it is by default as the first-added).
2. Delete "Home".
   - **Expect:** 200 response, "Home" gone from the list.
   - **Expect:** "Office" is now shown as the default (no extra tap needed).
3. On the app's checkout or address picker, place an order:
   - **Expect:** "Office" is pre-selected as the delivery address.

### ✅ Delete your only address — app and checkout still work

1. On the app:
   - Add one address: "Temp".
   - Delete "Temp".
   - **Expect:** 200 response, gone from the list.
2. Try to place an order.
   - **Expect:** checkout shows "no addresses" or a prompt to add one (normal behavior today, unchanged).
3. Add a new address → it becomes the default.
   - **Expect:** Place an order to the new address (works normally).

### ✅ Delete the same address twice (double-tap, or race condition)

1. On the app:
   - Add an address and delete it once.
   - Immediately try to delete it again (or fast double-tap the delete button if UI allows).
   - **Expect:** second delete returns **404** or **"address not found"**, or gracefully no-ops (not a 500 crash).
2. In admin, that order still resolves the address (soft-deleted, but the order can still see it).

### ✅ In-flight order: address deleted while rider is navigating (core safety fix)

1. **Setup:** place an order with status **OUT_FOR_DELIVERY** (admin → change status, or let a real delivery flow run on dev).
   - Note the order ID and address.
2. Delete that address from the customer account (on the app, or via admin).
   - **Expect:** 200 delete response.
3. On the **delivery app** (haper-delivery):
   - Open that order (search by order ID or in the list).
   - **Expect:** the address is **still there**; the rider can see name, phone, street, pin, coordinates.
   - **Expect:** the rider can tap "Navigate" and the map app opens (no crash, coordinates resolve).
   - **Expect:** the order status and rider screen remain stable (nothing breaks).

### ✅ Address list and picker only show active (non-deleted) addresses

1. On the app:
   - Add three addresses: A, B, C. Mark B as default.
   - In **My Addresses**, confirm all three are listed.
2. Delete address A.
   - **Expect:** A is gone from the list; B and C remain.
   - **Expect:** B is still shown as default.
3. In **checkout** (or address picker during order):
   - **Expect:** only B and C are offered in the dropdown / list.
   - **Expect:** cannot select the deleted A.

---

## Edge cases

### ✅ Deleted address from before Phase 2 shipped (hard-deleted, no soft-delete row)

**Context:** If a customer deleted their address *before* this fix shipped (or via another hard-delete path not yet soft-deleted),
the address row is gone forever. Phase 2 prevents **new** instances but can't recover history already lost.

1. Search for an old order (one where the address was deleted before Phase 2).
   - **Expect:** admin shows the order, but address is **null** or **"Address unavailable"**
     (the old mislabel "Store_Pickup" may still appear until Phase 3 ships).
   - **Expect:** no crash.

(Phase 1 and Phase 3 will address this — Phase 1 snapshot + Phase 3 honest label. Phase 2 is only the durability forward path.)

### ✅ Promoted default is also soft-deleted

(Rare edge case: a customer adds Address A (default), adds B, marks A deleted, adds C. Then deletes B. Deletion tries to promote
the next address. This should find C, not A.)

1. Add three addresses: A, B, C.
2. Manually soft-delete A somehow (e.g. via admin directly, not the app UI — or as a consequence of a bug).
3. Delete B (via the app).
   - **Expect:** C becomes the new default, not A.

---

## Automated test coverage

**Backend unit tests:** `haper-backend/packages/user/__tests__/address.test.js` (61 tests total, including Phase 2).
- Hard-delete behavior rewritten to assert soft-delete: old assertion `address is null after DELETE` now asserts `deletedAt is set`.
- Default-address promotion skips deleted addresses.
- List queries filter out soft-deleted rows.
- `deletedAt` is never leaked in API responses.
- See line ~333 for the test that was rewritten; consult the test file for the exact new assertions.

(A second file, `delete-account.test.js` line ~266, asserts the account-purge cron's **hard-delete** path remains
hard-delete — this is a separate, compliance-related hard-delete and must stay green unchanged.)

---

## What this needs to go live

**No migration required** — MongoDB's additive optional fields live without schema migration. The `deletedAt` field
is added as `default: null` and existing rows simply have the field absent (which `{deletedAt: null}` queries match).

**Deploy:** normal deploy of the `user` package (address routes) to dev/staging/prod. No other package changes required
for Phase 2 alone.

---

## Known limitation: Phase 3 (honest admin label) not yet built

Until Phase 3 ships, an order whose address was **already deleted before this fix** (or deleted through some other
hard-delete path) will **still show the old wrong label** ("Store_Pickup") in admin, **even though** the underlying
soft-delete mechanism now prevents **new** instances of data loss.

Example: order HP966912806 (the real prod incident) was placed and the address was deleted *before* Phase 2 shipped.
Phase 2 soft-delete can't recover it. Once Phase 1 (address snapshot) and Phase 3 (honest label) ship, admin will
show the correct label for **all future** address deletions and will have a recovery path for **some** old orders
(if the address was snapshotted at checkout).

---

## Platform specifics

### Android
- Address delete: button → confirm → delete (same UX as today, but now soft).
- Address list re-homes to the next default if the current default was deleted.
- Checkout address picker only shows active addresses (filter applied server-side; app receives only live ones).

### iOS
- Same as Android.

### Web
- Address list: same.
- Checkout: pre-selected address in the dropdown is the live default (soft-deleted ones excluded).

### Delivery app (haper-delivery)
- Rider opens an order mid-delivery.
- **Before:** if the customer deleted the address, the rider sees null / missing coordinates.
- **After (Phase 2):** soft-delete means `.populate('addressId')` still resolves → rider sees the address + can navigate.

---

## Rollout / deploy

- **Dev:** ship the backend `user` package changes to `dapi.haper.in`. Zero client changes needed.
- **Staging/Prod:** normal deploy. No data migration, no backfill script (that's Phase 1).
- **Apps:** zero changes for Phase 2. Android/iOS/Web can ship independently or alongside; no dependency.
- **Go-live decision:** once merged and tested on dev, can roll out to prod at any time. Phase 2 is backward-compatible
  (only affects **new** address deletions going forward).

**Phase 1 and Phase 3 are the next sequential steps** (see the design doc). Phase 1 adds the address snapshot at checkout;
Phase 3 rewrites the admin label logic to show the snapshot when the live address is gone.
