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

  **Cold-start reliability fixes (2026-07-09, assembleDebug SUCCESSFUL):** three defects that
  made store selection stick or do nothing:
  1. **Location + store now persist across launches.** `AppEnvironment` was in-memory only and
     defaulted to **Delhi (28.7041,77.1025)** — wrong for a Bihar business and reset on every
     cold start. Now `AppEnvironment.initialize(context)` (called first in `MainActivity.onCreate`)
     seeds lat/lng/storeId from `SharedPreferences("haper_location_prefs")`, and the setters
     write through. A returning user resolves their real store instantly; the last-resort seed
     (fresh install + denied location + no address) is **Chhapra (25.7811,84.7274)**, near the
     live store, not Delhi. ⇐ **product decision to confirm:** this means a zero-signal new user
     now browses the Chhapra store instead of hitting "not serviceable"; revert to a non-serving
     coord if strict not-serviceable is preferred.
  2. **Resolution watchdog now covers the address path, not just GPS.** The 8s safety net was
     armed only in `requestLocationAndFetch()`; the delivery-address branch (the primary path)
     had none, so a slow/failed `getDefaultAddress` could wedge the "Finding your nearest store"
     overlay forever. `armResolutionWatchdog()` is now called up front in
     `resolveStoreFromDeliveryAddressOrGps()` and in `onDeliveryAddressChanged()`. A single
     tracked `resolveJob` is cancelled before each new resolve so racing `fetchHomeData()`
     triggers can't stack duplicate nearest-store calls or stomp the fetch guard.
  3. **Saving a new address now delivers there.** `AddressViewModel.justAddedAddress` is set on
     add-success; MainActivity re-homes to it via `onDeliveryAddressChanged`. Previously an added
     address did nothing unless the user also marked it default — so "add a Chapra address to
     order for someone there" silently stayed on the old store.
- **Web** (`haper-web`, dev b8f8b3d; tsc clean): api.ts `resolveStoreForDeliveryLocation` /
  `resolveStoreFromDefaultAddress`; AuthContext.detectStore resolves from the default address;
  AddressBook re-homes on "Deliver to this Address"; Home not-serviceable "Change delivery
  location" → /addresses. **GAP:** web address form still stamps device GPS on NEW addresses
  (no map picker yet) — a follow-up; resolution is correct for addresses that HAVE coords.

  **Cold-start + reliability mirror (2026-07-10, dev `8d0fe8c`; tsc clean, vite build OK):**
  1. **State-aware home header** (`pages/Home.tsx`) mirrors the app's HomeHeroCard: *resolving*
     ("Finding your store…" + spinner) while home data loads, *has-store* ("Delivering to
     <label> · <area>"), and *no-store* ("Set delivery location" / "Choose where you want
     delivery" → /addresses). Replaces the old always-on "Delivery to … | Select Address".
  2. **Clear stale store when not serviceable** (`services/api.ts` `fetchNearestStoreAndApply`):
     a served point sets the new store; a 200-empty or 404 CLEARS the cached store (so the home
     shows not-serviceable, not old-store data); a 5xx / network error KEEPS the existing store
     (transient). Previously `resolveStoreForDeliveryLocation` cleared the store up front even on
     a hiccup.
  3. **Cold start reopens to the last-used delivery location** (`services/api.ts`): the last
     delivery point re-homed to is persisted in `localStorage` (`haper_delivery_loc`), seeds the
     request coords at load, and `resolveStoreFromDefaultAddress` prefers it over the server
     default; cleared on logout (`clearAuth`). The web GPS-stamping gap for NEW addresses is
     unchanged (still a follow-up).
- **iOS** (`haper-ios`, dev fe5d629; xcodebuild simulator OK): HomeViewModel resolves from the
  default address (GPS fallback); location listener guarded by `deliveryCoords` so a late GPS
  update can't override; MainTabView `.onChange(defaultAddress?.location?.coordinates)`; HomeView
  not-serviceable "Change delivery location" sheet → AddressListView. iOS already had a MapKit
  picker (capture) and no coupling.

  **Cold-start + not-serviceable + header mirror (2026-07-10, dev `8359260`; xcodebuild
  iphonesimulator BUILD SUCCEEDED):**
  1. **State-aware home header** (`Components/HomeComponents.swift` `LocationHeaderView`): the
     old always-on "Select Store" pill + `homeVM.locality` line is replaced by three states —
     *resolving* ("Finding your store…" + spinner), *has-store* (store name / "Delivering to
     <label> · <area>" from the default address; tap switches store if >1 else opens the picker),
     *no-store* ("Set delivery location" / "Choose where you want delivery" → picker via a new
     `onChangeLocation` closure from HomeView). HomeView fetches the default address on appear so
     the subtitle has the label/area.
  2. **Clear stale store when not serviceable** (`ViewModels/HomeViewModel.fetchNearestStore` +
     new `clearResolvedStore()`): backend **404** (no serving store) or a 200-empty list now
     CLEARS the cached store + catalog and sets `errorMessage = "No nearby stores found."` so
     `HomeView.isNotServiceable` shows the not-serviceable screen instead of stale old-store data;
     5xx / network errors KEEP the store (transient). Needed a NetworkManager change:
     `NetworkError.httpError(Int, String)` (+ `statusCode`) so the 404 is distinguishable
     (errorDescription unchanged → existing error UI intact).
  3. **Cold start reopens to the last-used delivery location** (`Utils/AppEnvironment.swift`):
     the last delivery point is persisted in **UserDefaults** (`haper_last_delivery_loc`), seeded
     at launch by `AppEnvironment.initialize()` (called first in `haperApp.init`), and
     `resolveStoreFromDeliveryAddressOrGps` prefers it over the server default; cleared on logout
     (`HomeViewModel.clearAll` → `clearDeliveryLocation`). The old hardcoded **Delhi
     (28.7041,77.1025)** default is gone — the last-resort seed is now **Chhapra (25.7811,84.7274)**
     to match Android/web (same product-decision note applies).
  4. **Categories no-store empty state** (`Views/CategoryView.swift`, dev `ae3fc50`; mirrors
     Android `CategoryScreen.kt` 37cec37): when categories are empty AND `selectedStore == nil`
     AND not loading, the browse-by-aisle screen shows "No store selected — Set your delivery
     location to browse products" + a button that opens the address picker (instead of the
     misleading "Select a Category" prompt over an empty sidebar). A spinner shows ONLY while
     resolving/loading. (iOS never hard-hung like Android — its item spinner was nested under a
     selected category — but the no-store dead-end is now handled gracefully.)

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

### ✅ Android cold-start reliability (2026-07-09)
1. **Add-address delivers there:** at Bheldi (or any served point), Add an in-range Chapra
   address with a pin → **Expect:** home switches to the Chapra store immediately (no need to
   also mark it default). If nothing serves that point → not-serviceable screen (correct).
2. **Cold start remembers the store:** resolve a store, force-stop the app, reopen →
   **Expect:** the same store loads immediately; no long "Finding your nearest store" spinner,
   no reset to a Delhi/other default.
3. **Overlay never sticks:** put the phone in airplane mode and cold-start → **Expect:** the
   loading overlay clears within ~8s (watchdog) to the not-serviceable/error state, never hangs.
4. **Fresh install, location denied, no address:** **Expect:** browses the Chhapra store (the
   last-resort seed) rather than a dead "not serviceable" — see the product-decision note above.

### ✅ Web cold-start + not-serviceable (2026-07-10)
1. **Header states:** open Home while it loads → **Expect:** "Finding your store…" with a
   spinner; once loaded → "Delivering to <label> · <area>" (served) OR "Set delivery location /
   Choose where you want delivery" (not served).
2. **Deliver Here re-homes:** on /addresses tap **Deliver Here** on an in-range address →
   **Expect:** navigates to Home and the catalog loads for that address's store.
3. **Switch to an unserved address:** **Deliver Here** on an out-of-range address →
   **Expect:** Home shows the not-serviceable screen (stale store cleared), not the old store's
   catalog.
4. **Cold start remembers the delivery location:** deliver to a served address, close the tab,
   reopen the app → **Expect:** the same store loads (resolved from the persisted last-used
   delivery location), not the server default.
5. **Logout clears it:** log out → log in as a different user → **Expect:** the previous user's
   delivery location is gone (resolves from the new user's default).

### ✅ iOS cold-start + not-serviceable + header (2026-07-10)
1. **Header states:** open Home while it loads → **Expect:** "Finding your store…" + spinner;
   once loaded → store name / "Delivering to <label> · <area>" (served) OR "Set delivery location
   / Choose where you want delivery" (not served, tap → address picker sheet).
2. **Deliver Here re-homes:** on My Addresses tap **Deliver Here** on an in-range address →
   **Expect:** jumps to the Home tab and the catalog loads for that address's store.
3. **Switch to an unserved address:** **Deliver Here** on an out-of-range address (backend 404) →
   **Expect:** Home shows the not-serviceable screen (stale store cleared), not the old catalog.
4. **Cold start remembers the delivery location:** deliver to a served address, force-quit,
   reopen → **Expect:** the same store loads (from the persisted last-used location), not the
   server default, no hardcoded-Delhi reset.
5. **Logout clears it:** log out → log in as a different user → **Expect:** the previous user's
   delivery location is gone (resolves from the new user's default).
6. **Categories no-store state:** with no resolved store, open the **Categories** tab →
   **Expect:** "No store selected — Set your delivery location to browse products" + a button
   that opens the address picker (NOT a "Select a Category" prompt over an empty sidebar, and NOT
   an endless spinner). Pick a served address → categories load.

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

---

## 2026-08-18 — explicit `?lat=&lng=` + mismatch observability (backend)

Part of the **wrong-store order routing** bug-prevention plan
(`haper-misc/docs/plans/wrong-store-order-routing-fix.md`, steps 5-backend + 6). Backend
only — Android sends the new params in a later step. **Zero change to accept/reject
behaviour:** enforcement stays OFF.

### Why

Two real orders went to a store far from the delivery address because the *headers*
(`x-user-latitude/longitude`) describe where the **phone** is, not where the **parcel**
goes. The endpoint had no way for a client to say "resolve the store for THIS point".

### What changed

- `GET /user/store/nearest` accepts **optional** `lat` + `lng` query params. Present and
  numeric → they win over the headers. Absent → identical to before.
  Files: `packages/user/src/routes/store/validator.js`, `.../store/controller.js`.
- The order-time serviceability mismatch log is now emitted by **both** checkout paths
  (the scheduled path had none) and carries distance + which store *should* have served.
  Files: `packages/user/src/routes/order/controller.js`,
  `packages/shared/repositories/stores.repository.js` (`distanceToStoreKm`).

### ✅ `GET /user/store/nearest` — query params

1. **Header-only (old client):** send only `x-user-latitude/x-user-longitude` →
   **Expect:** exactly today's result (same store list, `locality: ""`). No regression.
2. **Query wins:** headers pointed at a far/unserved point, `?lat=<served>&lng=<served>` →
   **Expect:** 200 with the store serving the QUERY point.
3. **Query wins (mirror):** headers at a served point, query at an unserved point →
   **Expect:** 404. (Proves precedence, not luck.)
4. **No headers at all:** just `?lat=&lng=` with real values → **Expect:** 200.
5. ❌ **Malformed:** `?lat=abc&lng=77.1`, `?lat=28.7&lng=xyz`, `?lat=&lng=`, `?lat=999&lng=77.1`,
   or only one of the two → **Expect:** 400 with a Joi message.
6. **Stray param:** `?someLegacyParam=1` with valid headers → **Expect:** 200 (ignored, not
   rejected) — old clients must not break.

### ✅ Mismatch shadow log (both order flows)

Place an order whose **delivery address** is outside the chosen store's range, with
`ENFORCE_ADDRESS_SERVICEABILITY` off (the default).

1. **Normal order:** `POST /user/order/place` → **Expect:** order SUCCEEDS (fail-open) and
   one line `[address-serviceability] {...}` in the logs.
2. **Scheduled order:** same with `deliveryType: "scheduled"` → **Expect:** order SUCCEEDS
   **and now logs too** (previously silent — this was the gap).
3. **Same shape:** both lines carry the same keys; only `flow` differs
   (`placeOrder` vs `placeScheduledOrder`):
   `flow, enforced, storeId, addressId, point, distanceKm, radiusKm, chosenStoreName,`
   `wouldServeStoreId, wouldServeStoreName, wouldServeCount, defaultStoreId`.
4. **Routing bug vs coverage gap:** with another store that DOES serve the address →
   **Expect:** `wouldServeCount: 1` + that store's id/name (a client routing bug).
   With no store serving it → **Expect:** `wouldServeCount: 0`, ids null, but `distanceKm`
   still filled (a coverage gap). These need opposite decisions later.
   `wouldServeCount` is `null` (not `0`) if the serving-store read fails — `0` always
   means a REAL zero.
5. **Default-store fallback visibility:** `defaultStoreId` echoes `DEFAULT_STORE_ID`
   (`null` when unset, and the literal string `"null"` also reads as unset, same as
   `/user/store/nearest`). **Why it matters:** if it is NOT null, a `wouldServeCount: 0`
   does **not** mean "nobody could serve this address" — `/user/store/nearest` would have
   handed the client the default store instead of a 404, which is itself a likely cause of
   wrong-store orders. Read this field before concluding "coverage gap".
6. **No false positives:** an address the store DOES serve → **Expect:** no
   `[address-serviceability]` line at all.
7. **Enrichment can't break checkout:** if the enrichment read fails, → **Expect:** the
   order still succeeds, the line still prints, unknown fields are `null` (never a missing
   key).
8. **Enforcement ON (not the default; dev experiment only):** the mismatch is logged with
   `enforced: true` AND the order is rejected 400 "…delivery area…" — unchanged from before.

### Edge cases

- `lat`/`lng` must be sent as a **pair**; half a pair is a 400, not a silent fallback to
  headers (a half-supplied pair means a client bug, and silently guessing is the very
  behaviour this plan removes).
- The mismatch log runs INSIDE the checkout transaction, so it is wrapped so that nothing
  it does can abort an order.
- Distance is 2dp haversine — good enough to tell 0.15 km from 24.5 km, not metre-accurate.

### Rollout / deploy

- Backend only, purely additive; safe to ship to dev independently of the Android work.
- **Do NOT** flip `ENFORCE_ADDRESS_SERVICEABILITY` — the plan holds it off for ~2 weeks
  while these logs collect real mismatch data; a separate decision follows.
- Real alerting (Grafana/on-call) on these lines is an explicit follow-up, not this phase.

### Tests

`cd packages/user && NODE_ENV=test npx jest store` and `... npx jest order-serviceability`
(in-memory Mongo). Covers header-only, query-override both directions, all 400 cases, and
both flows' log payloads including fail-open.

---

## 2026-08-18 — Android fails closed instead of guessing a store (steps 1-3 + 5-android)

Same plan (`haper-misc/docs/plans/wrong-store-order-routing-fix.md`), Android client half.
**The "set your location" UI is NOT in this change** — it is the next step (now built: see
"Android set-your-location UI + cart guard" below). This change makes the underlying state
correct; until the UI landed, the failure states surfaced through the existing
`NotServiceableCard`.

### Why

The app could *invent* a location. Three separate paths did it:
1. A hardcoded emergency coordinate `25.7811, 84.7274` seeded `defaultLatitude/Longitude`
   on a fresh install. Its code comment claimed it "never resolves a store on its own" —
   true when written, **false since 2026-07-26**, when a store was created 0.4 km from it.
2. A failed default-address fetch fell through to GPS and from there to that coordinate —
   a network blip became a confidently wrong store (#HP245512766).
3. Two unsynchronized resolutions fired on login and whichever finished last won
   (#HP219712748), plus an 8 s watchdog that resolved a store from whatever ambient
   coordinate happened to be set.

### What changed

- `AppEnvironment.defaultLatitude/Longitude` are now **nullable** and there is **no
  fallback**. Null = "unknown" → the `x-user-latitude/longitude` headers are **omitted**
  rather than filled with a guess.
- **One-shot prefs migration** (`prefs_migrated_v2`): a persisted coordinate within ~500 m
  of the retired one is wiped **together with the persisted `storeId`** derived from it.
  Runs exactly once per install.
- Default-address fetch is now three-way — `Has` / `None` / `Failed`. Only `None` (no
  address, or an address with no coordinates) may fall through to GPS. `Failed` fails closed.
- **Generation token**: every resolution attempt (address / GPS / watchdog / re-home /
  manual store pick) takes a monotonic number; any async result whose number is stale is
  discarded. New attempts supersede in-flight ones instead of being blocked by them.
- The **watchdog only ends the spinner** — it can no longer resolve a store.
- `GET /user/store/nearest` is called with **explicit `?lat=&lng=`** (the backend half above).

### ✅ Fail-closed cold start (device/emulator; test at min supported API too)

1. **Fresh install, location denied, no saved address** → **Expect:** spinner ends, NO store,
   NO catalog, the not-serviceable/choose-location state. ❌ Must NOT land on a store.
2. **Fresh install, denied, address WITH coordinates** → **Expect:** the store serving that
   address.
3. **Fresh install, denied, address with NO coordinates (legacy)** → **Expect:** prompt, no
   silent store. (This is order #HP245512766's exact setup.)
4. **Airplane mode / throttled network on cold start** → **Expect:** loading ends within ~8 s
   in a retryable state, **never** a resolved store. Restore network + Retry → resolves.
5. **Backgrounded past the 8 s watchdog then resumed** → **Expect:** same, no invented store.

### ✅ Poisoned-prefs migration (must be verified on an UPGRADE, not a fresh install)

6. Install the **previous** build, let it settle onto the fallback coordinate (fresh install +
   deny location + no address), confirm it picked a store. Now install this build **over it**
   (do not uninstall) → **Expect:** the stale coordinate AND store id are gone; the app asks
   for a location instead of reopening the wrong store.
7. Relaunch again → **Expect:** the migration does not re-run (a user genuinely near that
   coordinate keeps their location).

### ✅ Race determinism (the actual bug)

8. **Login 10× in a row** on a slow connection with a default address that has coordinates →
   **Expect:** the address-derived store **every single time**. ❌ Any run landing on a
   different store is a fail.
9. **Change the default address** to another city → **Expect:** re-homes to the new store
   (this must still work — the fix must not freeze the store).
10. **Add a new address** for another location → **Expect:** switches there, or shows
    not-serviceable.
11. **Pick a store manually** from the store switcher while a resolution is in flight →
    **Expect:** your pick sticks; a late response does not overwrite it.

### Edge cases

- The header pair is all-or-nothing: when the location is unknown, **neither**
  `x-user-latitude` nor `x-user-longitude` is sent (matches the backend's pair rule above).
- `CartViewModel.ensureStoreId()` still resolves a store when `storeId` is blank — closing
  that back-door is the **next** step (now done, see below). It is no longer dangerous on its
  own (with no location it now sends no coordinates and simply fails), but it is not yet a
  proper prompt.
- Checkout is deliberately NOT re-resolving client-side; the backend guard stays the
  authority for the money-adjacent decision.
- Crashlytics logging on the fail-closed paths is wrapped — telemetry must never be able to
  prevent the app from failing closed. Watch for the new line
  `resolution watchdog timed out … failing closed, NO store resolved` (the old line said
  "forcing nearest store", so old and new behaviour are distinguishable in logs).

### Rollout / deploy

- Client-only; the backend `?lat=&lng=` support is additive, so ordering between the two is
  not critical (Android degrades to header behaviour if deployed first).
- ⚠️ The migration and the fallback deletion **must ship in the same release** — shipping the
  deletion without the migration leaves existing installs pinned to the wrong store.
- Raising the min build via `forceUpdate` is a separate, later step in the plan.

### Tests

`cd haper-android && ./gradlew testDebugUnitTest assembleDebug` — 222 JVM tests green.
Covers: Has/None/Failed branching, failed-fetch never calling `/store/nearest`, the
watchdog resolving nothing, last-attempt-always-wins (10 iterations), an explicit store pick
surviving a late response, explicit `lat`/`lng` being sent, and the prefs migration
(poisoned cleared, real location kept, runs once, fresh install = null not a fallback).

---

## 2026-08-19 — Android set-your-location UI + cart guard (step 4)

Same plan, step 4. The previous change made the app **fail closed**; this one makes failing
closed **usable**, and closes the last path that could still resolve a store behind the
user's back.

### Why

"Fail closed" without a UI is just a dead end. The four failure reasons the ViewModel already
recorded all rendered as the same not-serviceable card, whose copy said *"Haper isn't
serviceable at your location yet"* — which is a **different and wrong statement**: we hadn't
learned their location at all. A customer in a fully-served area was told we don't deliver to
them, with no button that would fix it.

Separately, tapping "+" on an item was still a hidden resolution path: `CartViewModel
.ensureStoreId()` called `/store/nearest` itself from ambient coordinates and stamped whatever
came back onto the cart — so an order could be placed against a store the user never browsed.

### What changed

- New **`LocationNeededCard`** (`ui/screens/home/LocationNeededCard.kt`), shown on Home
  whenever `homeVM.locationNeeded != null`. Four states, each with its own copy and its own
  primary action:

  | State | Title | Primary CTA | Secondary |
  |---|---|---|---|
  | `PERMISSION_NEEDED` | Where should we deliver? | Enable location | Or add a delivery address |
  | `PERMISSION_DENIED` | Where should we deliver? | Open Settings | Or add a delivery address |
  | `NO_ADDRESS` | Add a delivery address | Add a delivery address | Or try enabling location |
  | `NETWORK_ERROR` | Can't reach Haper right now | Retry | (none) |

- `NotServiceableCard` **stays**, unchanged in behaviour, for its own case ("we know where you
  are, nobody serves it"). Both now share one shell (`HomeStatusCard`) so they can't drift.
- **Retry** uses an in-button spinner (`homeVM.isRetryingLocation`), not the full-screen
  "Finding your nearest store" overlay — a one-tap retry shouldn't flash the whole screen.
- **Touch targets**: both CTAs are now ≥ 48dp tall (the old secondary text-link was ~36dp).
- Returning from **system Settings** with the permission granted resumes resolution
  automatically (ON_RESUME re-check) — no second tap needed.
- **Cart guard**: `ensureStoreId()` is gone. `addToCart()` now **refuses** when no store is
  resolved, remembers the `(itemId, quantity)`, and raises `needsLocationForCart`.
  `LocationNeededSheetHost` (mounted once above the NavHost, so it covers home / category /
  search / item-detail / cart) shows the SAME card in a Material3 `ModalBottomSheet`.
  On success the sheet closes and the original add is replayed **exactly once**; dismissing
  cancels it.

### ✅ Location-needed states (device/emulator; check at min supported API too)

12. **Deny location, no saved address** → **Expect:** "Where should we deliver?" + **Enable
    location**. ❌ Must NOT say "not serviceable".
13. Tap **Enable location** → system dialog. **Allow** → the "Finding your nearest store"
    overlay → normal catalog. ❌ No bespoke success screen.
14. Tap **Enable location** → **Deny** → the same card **crossfades in place** to the "Open
    Settings" copy. ❌ Must not navigate or blink the whole screen.
15. Tap **Open Settings** → app settings page → grant Location → press **back** →
    **Expect:** resolution resumes on its own. ❌ Having to also tap Retry is a fail.
16. Turn on **airplane mode**, pull-to-refresh → **Expect:** "Can't reach Haper right now"
    with **Retry** only (no address link). Tap Retry → spinner **inside the button**, card
    stays put. ❌ A full-screen loading overlay is a fail.
17. Restore network, tap **Retry** → resolves and shows the catalog.
18. **Legacy address with no coordinates** (~75% of real addresses) → **Expect:** "Add a
    delivery address" copy, and the secondary link offers location instead.
19. Tap **"Or add a delivery address"** → the existing address flow (same route as the
    not-serviceable card's link). Add/select an address with a location → store resolves.

### ✅ Cart guard (the back door)

20. Get into a no-store state (step 12), then tap **+** on any item **from the home screen** →
    **Expect:** bottom sheet with the same card. ❌ The item must NOT be added, and NO
    `/store/nearest` call may be made by the cart.
21. Resolve the location **inside the sheet** → **Expect:** sheet closes and **that same item
    appears in the cart, once**. ❌ Two units = fail.
22. Repeat, but **swipe the sheet away** (or tap the scrim / press back) → **Expect:** nothing
    added, cart unchanged. Then resolve the location some other way → **Expect:** still
    nothing added (the cancelled add must not resurface).
23. Repeat step 20 from **category**, **search** and **item-detail** screens → same sheet,
    same behaviour (one host covers all entry points).
24. In the sheet, tap **"Or add a delivery address"** → navigates to addresses; the pending
    add is **cancelled** (they can tap + again once the store resolves).
25. **Log out while a sheet is pending**, log in as a different user → **Expect:** no
    mystery item ever appears in the new user's cart.

### ✅ Platform correctness

26. **Rotate** the device on each of the four states → copy and state survive.
27. **Dark theme** → card is legible; the icon badge is Primary-at-10% on both themes.
28. **Font scale 130%+** → title/body wrap, buttons still tappable, nothing clipped.
29. **TalkBack** → icon is silent (decorative); title, body and both CTAs are reachable and
    announced; both CTAs are ≥ 48dp.
30. **Process death** (Developer options → "Don't keep activities"), background and return →
    the app re-resolves or re-asks; ❌ it must never come back silently on a store.

### Edge cases

- Denying the permission does **not** cancel an in-flight address-based resolution — most
  customers order to a saved address and never need GPS. It only escalates a state we are
  already stuck in (`onLocationPermissionDenied()` no-ops while loading / once resolved).
- The permission denial also no longer sets the locality label to "Using default delivery
  location" (there is no default any more); it says "Set your delivery location".
- The pending add is deliberately **not** cleared by `CartViewModel.clearAll()` — `clearAll()`
  also runs for an ordinary "cart is empty" response, which is exactly what arrives right
  after a store resolves. Logout clears it explicitly.
- `ModalBottomSheet` cancels on dismiss; there is no "are you sure" — re-tapping + is cheap.
- Shared code note: this is **Android-only** (Kotlin/Compose). No shared RN/Flutter surface,
  so nothing for iOS to mirror mechanically — but the *copy* should match iOS when setu-ios
  builds the equivalent screen.

### Rollout / deploy

- Client-only, no backend dependency. Ships with the step 1-3 change (same release as the
  prefs migration).

### Tests

`cd haper-android && ./gradlew clean testDebugUnitTest assembleDebug` — **238 JVM tests
green, 0 failures**. New coverage: the copy table for all four reasons (including "no
exclamation marks / no Error-Failed jargon"), retry showing the in-button spinner and not
`isLoading`, a failing retry keeping the card up, double-retry being ignored, permission-denial
semantics (flips in place / doesn't cancel a live resolution / ignored once resolved), the
cart refusing to add with no store, the cart never calling `/store/nearest`, replay-exactly-
once, dismissal cancelling for good, and an empty-cart response not swallowing the pending add.
There is no instrumented (androidTest) source set in this project, so the card itself is
verified through its pure copy table plus manual steps 12-30 above.

---

## 2026-08-19 — Android review fix-loop (code review on steps 1-4)

Five findings from the code review of the work above, all fixed in `haper-android` on `dev`.
Two of them were real, provable holes in the fix itself — the wrong store could still survive.

### What changed

- **The one-shot migration now clears the persisted `storeId` UNCONDITIONALLY**
  (`AppEnvironment.initialize()`). It used to clear it only when it also found a persisted
  coordinate sitting on the retired fallback point — but the fallback was only ever an
  *in-memory* seed and was never written to prefs. So the classic victim (fresh install →
  location denied → no address → store silently resolved from the fallback) carries **only**
  a wrong `last_store_id` and no coordinates at all, and the old check sailed straight past
  it. Coordinates are still cleared conditionally (a real one is kept). Cost: one extra store
  re-resolution on the first launch after this update.
- **"Deliver Here" now has its own signal.** `AddressViewModel.setDefaultAddress()` (the only
  caller behind that button) sets a one-shot `justSelectedAddress`, which `MainActivity`
  routes to `HomeViewModel.onDeliveryAddressChanged()` — the unconditional re-home — exactly
  like the existing `justAddedAddress`. Before: if the login-time address fetch failed, the
  user's deliberate tap was the *first* default-address emission of the session, and the
  "first sighting is the passive login fetch" rule ignored it, leaving them shopping and
  ordering from the previous address's store.
- **A refresh blip can no longer wipe a working home.** `failLocation()` now checks
  "already resolved" (the guard `onLocationPermissionDenied()` already had): with a store on
  screen, a failed re-resolution shows a small toast instead of raising the full-screen
  "Where should we deliver?" card over a working catalog.
- **`NO_ADDRESS` is no longer dead code.** "You have an address but it has no map pin, and
  GPS is unavailable" now reports `NO_ADDRESS` ("Add a delivery address") instead of
  `PERMISSION_NEEDED` ("Enable location") — enabling location does nothing for that user.
  `DeliveryAddressResult.None` carries `hasAddress` so the GPS branch can tell the two apart.
  "No address at all" still reports `PERMISSION_NEEDED`.
- Comment-only: the `onDefaultAddressLoaded` KDoc no longer claims a general "rescue"; it now
  states that a failed own-resolution is only adopted when no coordinates were in play, and
  that a returning user with a persisted location stays fail-closed until they tap Retry.

### ✅ Manual steps (Android)

31. **Upgrade with only a poisoned store id** — install the *previous* build, fresh install,
    deny location, no address, let it settle on a store; **uninstall nothing**, install this
    build over it → **Expect:** it does NOT reopen that store; it asks where to deliver.
    (This is the case the earlier migration missed — the one real users are in.)
32. **Upgrade with a real saved location** → **Expect:** the location survives, the store is
    re-resolved once on first launch and lands on the same store. No visible difference beyond
    a single extra resolution.
33. **"Deliver Here" with a broken login fetch** — turn the network off during app launch so
    the header's default-address fetch fails, turn it back on, open **My Addresses**, tap
    **Deliver Here** on an address in another town → **Expect:** the store re-homes to that
    town (or shows not-serviceable). ❌ Must NOT stay on the previous store.
34. **Refresh blip over a working home** — with a store and catalog on screen, kill the
    network and pull to refresh → **Expect:** the catalog stays, a short toast appears.
    ❌ Must NOT show the full-screen "Where should we deliver?" card.
35. **Legacy address, GPS off** — account whose only address has no map pin, location
    permission denied → **Expect:** the card reads **"Add a delivery address"** with primary
    CTA "Add a delivery address" (not "Enable location").
36. **No address at all, GPS off** → **Expect:** the card still reads "Where should we
    deliver?" with primary CTA "Enable location". The two must stay distinct.

### Edge cases

- Re-picking the *same* address twice still signals (the flag is consumed one-shot, so the
  Compose key goes `id → null → id`), and `onDeliveryAddressChanged` no-ops when the
  coordinates are already the active ones — so a repeat tap costs nothing.
- The downgraded failure message is a toast on Home and only fires when a store IS resolved,
  so it can't double up with the not-serviceable / location-needed cards.
- Still Android-only; no shared RN/Flutter surface. iOS should mirror the `NO_ADDRESS` copy
  split and the deliberate-pick signal when setu-ios builds the equivalent screens.

### Rollout / deploy

- Client-only, same release as steps 1-4. The migration change is **not** re-runnable for
  anyone who already installed a build carrying `prefs_migrated_v2 = true` — those installs
  need a `_v3` key if this ships after such a build reached users.

### Tests

`cd haper-android && ./gradlew clean testDebugUnitTest assembleDebug` — **245 JVM tests
green, 0 failures** (238 → 245). New/updated: migration clearing a store id with no
coordinates at all, migration keeping a real location while still dropping its store id,
a deliberate pick re-homing when it is the first address the VM sees, a failed refresh not
raising the location card over a resolved store, declining the location dialog over a
resolved store, `NO_ADDRESS` vs `PERMISSION_NEEDED` copy selection (two tests corrected from
the wrong expectation, one added), and `setDefaultAddress` flagging/one-shot-consuming the
deliberate pick.
