# Test: Address "Village / Locality" picker per store

**Area:** User app → Add/Edit Address screen → "Village / Locality" field
**Backend:** `GET /user/address/default` → `data.villages` (packages/user address controller)
**Apps:** Android + iOS (web has no village field)

## What the feature is supposed to do

Every store can serve a **fixed list of villages** (set in admin → store → villages) or
**no fixed list** (villages empty).

- Store **has villages** → app shows a **dropdown**; user MUST pick one of that store's villages.
- Store **has no villages** (`villages: []`) → app shows a **free-text, optional** field.
  It must NOT show a dropdown of villages that belong to some other store.

The village list comes only from `GET /user/address/default` → `data.villages`.
The app sends the store via the `x-store-id` header.

## The bug that was fixed (2026-07-04)

The geo middleware (`packages/user/src/middleware/geo.js`) short-circuits store
resolution for `/address` routes (they must work even with no serviceable store),
so it never set `req.storeId`. `getDefault` therefore never loaded the store and
`store?.villages || AddressConstant.villages` **always** returned the hardcoded
25-village master list.

- Invisible for a store whose configured villages happen to equal the master list.
- Visible for a store with `villages: []` (e.g. dev store `6a48e4092eac4bd1df95553f`,
  "Dev Haper Bahwan baazar"): the app showed a forced dropdown of 25 villages that
  aren't that store's. Tester reported this.

**Fix:** `getDefault` now reads `req.storeId || req.headers["x-store-id"]`, so the
actual store is loaded and its own `villages` (including `[]`) is returned.
Only this one endpoint changed — geo middleware and other `req.storeId` readers
(home/item/cart/order) were left untouched to avoid regressions.

## Manual test steps

### ✅ Store with NO villages (the reported case)
1. Admin: pick a store with an empty villages list (or clear it).
2. User app: select that store, open Add Address.
3. **Expect:** "Village / Locality" is a **free-text** field and is **optional**
   (you can save without it). No 25-village dropdown.

### ✅ Store WITH villages
1. Admin: set a store's villages to e.g. `["Alpha","Bravo"]`.
2. User app: select that store, open Add Address.
3. **Expect:** "Village / Locality" is a **dropdown** showing exactly `Alpha`, `Bravo`,
   and selection is **required** to save.

### ✅ No store context (fallback) — CHANGED 2026-07-10
1. Call `GET /user/address/default` without an `x-store-id` header (store-less / new /
   not-yet-serviceable user).
2. **Expect:** `data.villages` = **`[]`** → the app shows a **free-text** village field, NOT
   a dropdown. (Previously this returned the hardcoded 25-village master list, which forced a
   confusing dropdown of arbitrary villages on new users. `AddressConstant.villages` is no
   longer used by this controller.)

### Edge cases
- Switching from a with-villages store to a no-villages store must flip the field
  from dropdown → free-text (app overwrites `availableVillages` with the new `[]`).
- Old address that already has a `village` value stored: editing must still show that
  value; on a no-villages store it stays as free text.

## Automated coverage
`packages/user/__tests__/address.test.js` → `GET /user/address/default`:
- returns store's own **empty** villages (not master list) when `x-store-id` sent
- returns store's **configured** villages when the store has them
- falls back to master list when no store context
Run: `cd packages/user && NODE_ENV=test npx jest __tests__/address.test.js`

## Deploy
Backend-only change → deploys with the next `dev` backend deploy (`dapi.haper.in`).
No app release required (Android/iOS already handle empty vs non-empty villages).
