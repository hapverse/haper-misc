# Test: Store resolved from the DELIVERY ADDRESS (order for someone far away)

**Area:** User app → home/store resolution + Add/Edit Address + checkout
**Backend:** `GET /user/store/nearest`, `POST /user/order/place` (packages/user), `packages/shared` stores repo/schema/config, `packages/admin` store create/update
**Apps:** Android + Web + iOS (all three)

## The problem this fixes

The serving store used to be resolved from the **user's current phone GPS**, not from
the **delivery address**. So a user physically far from a serviceable area (e.g. traveling,
or living in an unserved city) could not order **for a loved one** whose address IS
serviceable — the app showed "We're not in your area yet" and blocked the whole
catalog/cart/checkout. `DEFAULT_STORE_ID` being unset (`config.defaultStore.id = null`)
meant there was no fallback either → hard 404.

**Real example:** Ravi is in Delhi (not served). His parents live 2 km from the Chapra
store (served). He wants to send them groceries. Old behaviour: app checks Ravi's Delhi
GPS → no store → blocked. New behaviour: app resolves the store from the **parents'
address** → Chapra store serves it → Ravi can order from anywhere.

The store that fulfils an order still has to be near the **delivery address** (quick
commerce = local delivery). You can never deliver to a city with no store; the fix only
makes the *correct* store resolve for a served address regardless of where the buyer is.

## What was found in the prod data (2026-07-08, offline dump analysis)

- Only **15%** of saved addresses have any coordinates; of those, **70%** are just the
  store's own location (a default stamped on the address), not the real home.
- Of real (believable) home deliveries, **99% are within ~4 km** of the store; a long
  tail reaches ~15 km for a few village orders.
- ⇒ Two consequences: (a) clients MUST reliably capture a real coordinate at address
  entry, or address-based resolution has nothing to work from; (b) the order-time guard
  must FAIL-OPEN when an address has no coordinates, and stay in shadow (non-blocking)
  until coordinate capture is fixed + backfilled.

## Serviceability model (radius; polygon optional)

A store decides "do I serve this point?" two ways:
1. **Radius** (default, always on): within `config.deliveryRadiusKm` (per-store, nullable)
   else the global `MAX_NEAREST_STORE_DISTANCE_KM` (default 5 km). **No polygon needed.**
2. **Polygon** (`config.useServiceArea`, default OFF): exact drawn boundary. Only used if
   a store opts in. Nothing in this fix requires it.

Range decision: **global default 5 km; a particular store can be set to 10–15 km**; other
stores may differ. Per-store value set by an admin (nullable → falls back to global).

## Backend — DONE & TESTED (in-memory jest)

- `packages/shared/models/stores.schema.js`: new `config.deliveryRadiusKm` (Number, default
  null → uses global). Backward-compatible.
- `packages/shared/repositories/stores.repository.js`:
  - `getServingStores(lng, lat)` — nearest-first, each store gated by its OWN radius
    (`deliveryRadiusKm ?? global`). Replaces the fixed-radius `$near` in resolution.
  - `servesPoint(storeId, lng, lat)` — order-guard check (polygon-covers OR within
    effective radius), haversine so it needs no geo index.
  - `effectiveRadiusKm(store)`, `_haversineKm(...)` helpers.
- `packages/user/src/routes/store/controller.js`: `findNearestStore` now calls
  `getServingStores` (per-store radius). Polygon shadow/override + default-store fallback
  unchanged.
- `packages/user/src/routes/order/controller.js` `placeOrder`: loads the delivery address
  and runs the **serviceability guard** — skipped for store-pickup and for addresses with
  no coordinates; **FAIL-OPEN** on any error; only **shadow-logs** unless
  `ENFORCE_ADDRESS_SERVICEABILITY=true`.
- `packages/shared/config/index.js`: `enforceAddressServiceability` flag (default false).
- Admin `packages/admin/src/routes/store/{validator,controller}.js`: create + update accept
  `deliveryRadiusKm` (Joi `0..50`, empty/null clears to global default).
- Tests: `packages/user/__tests__/order-serviceability.test.js` (8), admin store.test.js
  (+2). Full suites green: user 277, admin 53.

## Clients — DONE (all on dev; compiled, NOT yet runtime-verified)

Same 3 goals per platform: (1) capture a real coordinate at add/edit address; (2) resolve
the store from the SELECTED delivery (default) address, GPS only as first-run fallback;
(3) "Change delivery location" on the not-serviceable screen → address picker.

- **Android** (`haper-android`, dev 06873a5; assembleDebug SUCCESSFUL): HomeViewModel resolves
  from the default address (`resolveStoreFromDeliveryAddressOrGps` / `onDeliveryAddressChanged`);
  MainActivity fires it on `addressVM.defaultAddress` change; removed the AddEditAddressScreen
  AppEnvironment-coords overwrite (single source of truth). Capture already enforced (map pin +
  Save blocks without coords). HomeScreen not-serviceable "Change delivery location".
- **Web** (`haper-web`, dev b8f8b3d; tsc clean): api.ts `resolveStoreForDeliveryLocation` /
  `resolveStoreFromDefaultAddress`; AuthContext.detectStore resolves from the default address;
  AddressBook re-homes on "Deliver to this Address"; Home not-serviceable "Change delivery
  location" → /addresses. **GAP:** web address form still stamps device GPS on NEW addresses
  (no map picker yet) — a follow-up; resolution is correct for addresses that HAVE coords.
- **iOS** (`haper-ios`, dev fe5d629; xcodebuild simulator OK): HomeViewModel resolves from the
  default address (GPS fallback); location listener guarded by `deliveryCoords` so a late GPS
  update can't override; MainTabView `.onChange(defaultAddress?.location?.coordinates)`; HomeView
  not-serviceable "Change delivery location" sheet → AddressListView. iOS already had a MapKit
  picker (capture) and no coupling.

Still to do: on-device/GPS runtime verification (Android + iOS), and a web map picker.

## Manual test steps

### ✅ Order for a loved one far away (the core fix)
1. Be physically outside any served area (or fake GPS to Delhi).
2. Add/select a delivery address that IS within a store's range (e.g. Chapra, 2 km from
   store), with a real pin.
3. **Expect:** catalog loads for the Chapra store; you can add to cart and checkout; the
   order is attached to the Chapra store.

### ✅ Per-store range (admin)
1. Admin → store → set **Delivery range (km)** to 12; save.
2. `GET /user/store/nearest` with a point ~10 km from the store.
3. **Expect:** store IS returned (was 404 with the default 5 km).
4. Clear the field (blank) → falls back to the global default.

### ✅ Guard shadow vs enforce (backend)
- `ENFORCE_ADDRESS_SERVICEABILITY` unset/false: placing an order to a far address still
  succeeds; a `[address-serviceability]` line is logged. (Keep this until clients ship +
  coordinates are trustworthy.)
- `=true`: placing an order to a far address (with coords) returns **400** "…not in the
  selected store's delivery area…". Near address, store-pickup, and no-coordinate addresses
  still succeed.

### Edge cases
- Address with **no coordinates** (85% of legacy rows): guard is skipped (fail-open); the
  order still places. Clients should backfill/capture coords going forward.
- Switching the selected delivery address to one served by a **different** store must swap
  the store + refresh the (store-scoped) cart.
- Store on an enabled `serviceArea` polygon: covered points serve regardless of radius.

## Rollout / deploy

- Backend + admin: safe to ship now (guard OFF/shadow, per-store field nullable → zero
  behaviour change for existing stores). Dev: `dapi/damin.haper.in`.
- Do NOT set `ENFORCE_ADDRESS_SERVICEABILITY=true` until: clients resolve store from the
  address AND capture real coordinates AND legacy coordinates are backfilled — else legit
  orders (85% no-coords, 70%-of-coords defaulted to store) could be misjudged.
- Per-store range for the current Bihar store: data says ~4 km real → leave `deliveryRadiusKm`
  null (global 5 km) unless the store wants wider village coverage (then 10–15 km).
