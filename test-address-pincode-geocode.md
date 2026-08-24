# Test: Pincode → map-pin snap on Add/Edit Address

**Area:** User app → Add/Edit Address → map pin. Type a 6-digit pincode → the map pin
jumps to that pincode's approximate centre → user drags to the exact spot.
**Backend:** `GET /user/address/geocode?pin=<6-digit>` (packages/user address route);
`geocodingUtils.getCoordsFromPincode` (packages/shared).
**Apps:** Android + iOS (done). **Web: N/A** — the web Add/Edit Address form has NO map
picker (it stamps device GPS on new addresses), so there is no pin to snap. If a web map picker
is ever added, wire it to `GET /user/address/geocode?pin=` then.

## Why

A buyer far from the delivery area (e.g. in Bangalore ordering for parents in Chapra) had
to hand-pan the Google Maps pin all the way across the country. Entering the pincode should
pre-position the pin near the right area; the pincode covers a few km² so the pin lands at
the **centre** and the user **drags** to the exact house. See [[project_store_from_delivery_address]].

## Geocoder choice (important)

**Google is now the ONLY geocoder (2026-07-10).** OpenStreetMap's pincode data is wrong for
our service area (Chhapra `841301` comes back as `841300`), so the whole OSM path in
`geocoding.utils.js` is **commented out** (kept for rollback) and `config.geocodingService`
now defaults to `googlemaps`. Both reverse geocode (`getLocality`) and forward geocode
(`getCoordsFromPincode`) go through Google.

- The forward endpoint is **inactive (returns `coords: null`) until `GOOGLE_PLACES_API_KEY`
  is set** in the backend env (Parameter Store). Key was **added 2026-07-10**; a redeploy
  activates it. Until active, the app falls back to manual drag — nothing breaks.
- Rollback: uncomment the OSM function + switch in `geocoding.utils.js` and set
  `GEOCODING_SERVICE=openstreetmap`.
- `getLocalityFromGoogle` was changed to return Google's `formatted_address` **string** (not
  the old address-components object) so the existing `GET /user/address/locality` string
  contract is preserved for the apps; it's now fail-safe (returns null, never throws).

- Google key: created in Google Cloud project `haper-multistore-2fe9f`, key
  "Geocoding API Key for backend", restricted to **Geocoding API** only. Application
  restriction = None for now; add **IP addresses = NAT Gateway Elastic IP** once the backend
  moves to autoscaling/launch-templates (instance IPs churn; the NAT egress IP is stable).

## Backend — DONE & TESTED (in-memory jest)

- `packages/shared/utils/geocoding.utils.js`: `getCoordsFromPincode(pin)` → `{latitude,
  longitude}` or `null`. Google forward geocode restricted to India
  (`components=postal_code:<pin>|country:IN`), 3s timeout, **never throws** (a miss returns
  null), cached 30 days (pincodes are static). Only calls Google when
  `geocodingService === "googlemaps"`.
- `packages/user/src/routes/address/router.js`: `GET /geocode` declared **before** `/:addId`
  so "geocode" isn't captured as an address id.
- `validator.geocodePincode`: Joi `pin` must match `^[1-9][0-9]{5}$` (6-digit Indian pincode).
- `controller.geocode`: always **200** — `{ data: { coords } }`, `coords` null = "couldn't
  locate, drag manually" (not an error, so the client never blocks address entry).
- Tests: `packages/user/__tests__/address.test.js` `GET /user/address/geocode` (5 new):
  401 no-token; 403 missing pin; 403 malformed pin (`12`, `0123456`, `abcdef`, `012345`);
  200 `coords:null` when geocoder inactive (OSM default in tests); 200 with coords when the
  util is spied to resolve. Suite green: **43 passed**.

## Android — DONE (compiled, assembleDebug SUCCESSFUL; NOT device-verified; UNCOMMITTED)

- `AddressModels.kt`: `PincodeGeocodeResponse { coords: PincodeCoords? }`, `PincodeCoords
  { latitude, longitude }`.
- `ApiService.getPincodeGeocode(pin)` → `GET user/address/geocode`.
- `AddressViewModel.geocodePincode(pin, onResult)` — best-effort; calls back only on a
  non-null coord, else leaves the pin as-is.
- `AddEditAddressScreen`: `LaunchedEffect(pin)` — debounce, fires only when
  `pin.length == 6 && pin != initialPin && ValidationUtils.validatePin(pin) == null` and not
  read-only. `initialPin` guard = don't snap on opening an existing address.
- **Superseded (2026-08-24) by the precise-vs-approximate fix — see
  `test-address-precise-coordinate.md`.** A pincode result is now an *unconfirmed* coordinate:
  it can no longer be saved as-is, and it never silently overwrites a confirmed one.
- Needs the backend deployed (key live) to actually return coords; until then `coords:null`
  and the pin just stays put. Still needs on-device verification.

## iOS — DONE (haper-ios, dev `8359260`; xcodebuild iphonesimulator BUILD SUCCEEDED; NOT device-verified)

- `Models/AddressModels.swift`: `PincodeGeocodeResponse { coords: PincodeCoords? }`,
  `PincodeCoords { latitude, longitude }`.
- `ViewModels/AddressViewModel.geocodePincode(pin:completion:)` → `GET /user/address/geocode?pin=`;
  best-effort (calls back only on non-null coords, else leaves the pin as-is).
- `Views/AddEditAddressView.swift`: `.onChange(of: pin)` sanitizes to digits (capped 6) and
  runs a **~300ms** debounced `Task`; fires only when `digits.count == 6 && digits != initialPin
  && ValidationHelper.validatePin == nil` and not read-only; moves `mapCenter` + camera to the
  returned coords (user then drags to adjust). `initialPin` (set in `setupForm`) guards against
  snapping on opening an existing address. Fail-safe: null/error leaves the pin, never blocks save.
- Needs the backend deployed (key live) to actually return coords; until then `coords:null`
  and the pin just stays put. Build-verified only.

## Manual test steps (after key is live + backend deployed)

### ✅ Pincode snaps the pin
1. Add Address on the app (dev). Type a served pincode (e.g. `841301`).
2. **Expect:** within ~1s the map pin moves to that pincode's area. Drag to the exact spot.
3. Save → the saved coordinate is the dragged spot (not the pincode centre).

### ✅ Editing an existing address does NOT auto-move the pin
1. Open an existing address (pin already filled, precise location saved).
2. **Expect:** the pin stays on the saved location — no snap on open.
3. Change the pincode to a different valid one → both apps now ask before moving the pin
   ("Your PIN changed. Update the pin location to match?") instead of overwriting the saved
   location. Android: `test-address-precise-coordinate.md`; iOS: the FIX section below.

### ✅ Graceful fallback
- Geocoder off (`GEOCODING_SERVICE` not `googlemaps`) or an unlocatable pin → `coords:null`,
  app leaves the pin where it is; user drags manually. Save still works.
- Malformed/partial pin (<6 digits) → no call fired.

### ✅ Backend contract
- `GET /user/address/geocode?pin=841301` (authed): 200, `data.coords` = `{latitude,
  longitude}` when the key is live, else `null`.
- `pin=12` / `pin=abcdef`: 403.

## FIX 2026-08-24 — a PIN snap is NOT a confirmed location (iOS; Android in parallel)

> Android's half of this fix is documented in `test-address-precise-coordinate.md`. Same
> semantics, platform-specific code. This section is the iOS half.

**Bug (prod-dump confirmed):** the PIN-derived coordinate (a Google `postal_code` area centroid)
was treated as a real, user-set location. 19% of prod addresses collapsed onto 3 fake centroid
points; 23% of this month's orders affected. Root cause on iOS: the pincode geocode callback
called `applyPickedCoordinate`, which set `hasUserSetCoordinate = true` — a system guess marked
as a user confirmation. It also silently overwrote an already-precise coordinate when the user
edited the PIN of a saved address.

**iOS change** (`haper-ios/haper/Views/AddEditAddressView.swift` only — no backend/API change):
- New `isCoordinateConfirmed` state (separate from `hasUserSetCoordinate`). True only from GPS,
  map-picker confirm, or opening a saved address that already has a coordinate.
- Save gate now checks `isCoordinateConfirmed`, not "a coordinate exists" → a PIN-only address
  **opens the map picker**, pre-centred on the PIN guess, and saves only after the user taps
  Confirm there (`AddressCoordinatePolicy.saveAction` → `.confirmOnMap`). Save **never** captures
  the phone's GPS on the user's behalf — otherwise someone in Bangalore adding a Chapra address
  would silently ship their Bangalore location as the delivery point (matches Android).
- GPS is reachable only from the explicit "Refresh — use my current location" button. A fix that
  arrives without that button having been tapped (a late/stray update) is **discarded** if a
  coordinate has since been confirmed, so it can't overwrite an explicit map confirm.
- `performSave()` has a `guard isCoordinateConfirmed` backstop, and `savableCoordinate` is nil
  while unconfirmed — an unconfirmed point cannot reach the API from any call site.
- Denied/restricted location permission is checked up front on Refresh (CoreLocation fires no
  callback when denied), so the button surfaces an error instead of looking dead.
- PIN changed on an already-confirmed address → inline amber prompt "Your PIN changed. Update
  the pin location to match?" with **Keep current location** / **Snap to new PIN** (both 44pt
  touch targets). Snapping applies the centroid but leaves it unconfirmed.
- Marker + status caption tint green (`AppTheme.success`) when confirmed, amber
  (`AppTheme.warning`) when not. New copy: "Approximate area from PIN — drag the pin to your
  exact spot", "Approximate — not yet confirmed", "PIN-based location — tap to confirm on map".
- Decision logic lives in `AddressCoordinatePolicy` (same file), unit-tested in
  `haperTests/AddressModelsTests.swift` → `AddressCoordinatePolicyTests`.

### ✅ New manual steps (iOS)
> Run steps 1–2 on a phone that is **far from the typed PIN** (e.g. sitting in Bangalore, adding a
> Chapra address), with location permission **granted** and GPS **on** — the dangerous case.

1. Add Address, type a valid PIN only → pin appears **amber**, caption "Approximate — not yet
   confirmed". Tap Save → the **full-screen map picker opens**, centred on the PIN area.
   ❌ Fail if it saves straight away, and ❌ **fail if the pin jumps to your own city** — the app
   must never capture your GPS on your behalf here.
2. Drag to the exact spot and tap **Confirm location** → the picker closes and the address
   **saves in one step** (no second Save tap needed), with the confirmed coordinate.
3. Same flow with location permission **denied** / GPS off → the picker still opens and step 2
   still saves; the picker does not need GPS.
4. Repeat step 1 but close the picker with **X** → nothing is saved, pin still amber. Then tap
   the map preview yourself and Confirm → pin green, but it does **not** auto-save; tapping Save
   now saves immediately.
5. Tap "Refresh — use my current location" → pin turns **green**, "Confirmed location", Save
   saves immediately. With permission denied, Refresh shows an error alert (❌ fail if it does
   nothing at all).
6. Late-GPS: tap Refresh, and *before it returns* open the map picker and confirm a clearly
   different spot → the confirmed spot stays; the late fix is discarded (pin must not jump).
   Tapping Refresh again afterwards *does* move the pin (the guard only drops superseded fixes).
7. Open a saved address with a precise location → opens **green**, "Saved location". Change the
   PIN → amber prompt appears; the pin does **not** move. ❌ Fail if the pin jumps.
8. Tap "Keep current location" → prompt closes, pin unchanged, Save still immediate.
9. Tap "Snap to new PIN" → pin moves to the new area and turns **amber**; Save now opens the map
   picker for confirmation.
10. VoiceOver: both prompt actions are reachable buttons with ≥44pt targets.

**Status:** iOS code DONE on `dev` (uncommitted at time of writing), `xcodebuild build`
SUCCEEDED, SwiftLint clean, runtime probe green (scenarios A–G, incl. negative controls that
reproduce both bugs on the pre-fix code). NOT device-verified. Android is a parallel task.
`xcodebuild test` still blocked by the unrelated pre-existing `ViewModelsStateTests.swift`
compile error (`ProfileViewModel.updateLocalError`).

**Known test gap (iOS):** `AddressCoordinatePolicyTests` covers the pure policy enum only, not
the view's call-site wiring (which source is passed where, what Save does, late-GPS handling).
That wiring is `@State`-bound; it is covered by an out-of-repo runtime harness, so the manual
steps above are the real gate until the test bundle compiles again.

## Rollout
- Backend: safe to ship now — dormant (returns null) until `GEOCODING_SERVICE=googlemaps` +
  key are set. Dev: `dapi.haper.in`.
- Set `GOOGLE_PLACES_API_KEY` + `GEOCODING_SERVICE=googlemaps` in Parameter Store → redeploy.
- Then build + ship the Android + iOS wiring. (Web N/A — no map picker.)
