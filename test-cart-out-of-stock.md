# Test: poisoned cart — out-of-stock item blocks checkout

**Area:** Backend cart (Redis) + checkout. `packages/shared/repositories/cart.repository.js`,
`packages/user/src/routes/cart/controller.js`, `packages/user/src/routes/order/controller.js`.
**PR/deploy:** backend-only. Land on `dev` → deploy `dapi.haper.in`. No client change required.

## The bug (real incident, 2026-07-11)
`Onion - 1 kg` went out of stock (`quantity: 0`) while it was sitting in many users' carts.
Every checkout then failed with **"Insufficient quantity for item Onion - 1 kg"** — even when
the user added a *different* onion (500 g) or removed all onions and ordered something else.

### Why it happened (two chained defects)
1. **Cart cleanup was a silent no-op (type bug).** On `GET /user/cart`, the controller tries to
   drop out-of-stock lines: `CartRepository.delete(userId, item.itemId._id)` — but `item.itemId._id`
   is a **Mongoose ObjectId** (from a `.lean()` populate), while the Redis cart stores `itemId` as a
   **string**. `_findCartByItemOrCartId` / `delete` compared with `===`/`!==`, so
   `"6857…" === ObjectId("6857…")` was **always false** → nothing was removed. The item was
   *hidden* from the cart response (excluded from `updatedCartItems`) but **never purged from Redis**.
2. **Checkout failed the whole cart on one bad line.** `prepareOrderItemsAndInventory` threw on the
   first `sellFEFO` miss, rejecting the entire order and naming that item.

Net effect: a hidden, unremovable, out-of-stock item poisoned the cart and blocked every checkout
until the 12h Redis TTL expired. Immediate ops workaround was to clear the affected Redis carts.

## The fix
- **A — type-safe cart matching** (`cart.repository.js`): `_findCartByItemOrCartId` and `delete`
  now coerce both sides with `String(...)`. The out-of-stock cleanup on cart GET actually purges the
  item now → carts self-heal on next view. Backward-compatible (string callers unchanged).
- **B — fail-closed, itemised checkout** (`order/controller.js`): collect **all** unfulfillable
  lines in one pass and reject with `Out of stock: <names>. Please remove … to continue.` (HTTP 400).
  **No** auto-drop and **no** partial order (deliberate — the user removes items themselves). The
  throw aborts the transaction, so any in-stock lines decremented in the same pass roll back.

## Steps (backend jest, in-memory — `cd packages/user && NODE_ENV=test npx jest cart.test.js order.test.js`)
- ✅ **Cleanup purges, not hides** (`cart.test.js` → "purges an out-of-stock item from Redis on GET"):
  add 2 items, set one to `quantity:0`, GET cart → `CartRepository.getOne` no longer returns the
  sold-out item (proves it left Redis, not just the response).
- ✅ **Fail-closed checkout** (`order.test.js` → "rejects checkout (fail-closed)…"): cart with an
  in-stock + a sold-out item → `POST /user/order/place` returns **400**, `message` names the item and
  says "out of stock", and the in-stock item's quantity is **unchanged** (no partial order).
- ✅ Regression: all existing cart/order/serviceability tests still pass (88 total).

## Edge cases
- **Multiple out-of-stock items** → all are listed in one message ("these items"), not one-at-a-time.
- **Product deleted (not just 0 stock)** → also collected as unavailable (was a separate `Item no
  longer available` throw before).
- **Race (sold out between cart view and checkout)** → checkout still fails closed with the clear
  message; next cart GET purges it so the retry succeeds.
- **Manual remove API** (`DELETE /user/cart/:itemId`, string id) → unaffected, still works.

## Not covered / follow-ups
- Onion-1kg can't be *re-added* while `quantity:0` (`cart.add` blocks qty-0), so it can't re-poison
  a cart unless restocked then sold out again with copies still in carts — but **any** item hitting 0
  while in a cart is now handled by A.
- Broader data hygiene surfaced during triage (not this fix): ~37 items named "…kg" with `unit:g`,
  and 591/1485 items with `costPrice:0`. Tracked separately.
