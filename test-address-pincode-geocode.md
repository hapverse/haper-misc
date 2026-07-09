# Test: Pincode → map-pin snap on Add/Edit Address

**Area:** User app → Add/Edit Address → map pin. Type a 6-digit pincode → the map pin
jumps to that pincode's approximate centre → user drags to the exact spot.
**Backend:** `GET /user/address/geocode?pin=<6-digit>` (packages/user address route);
`geocodingUtils.getCoordsFromPincode` (packages/shared).
**Apps:** Android (first), then iOS + web.

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
- `AddEditAddressScreen`: `LaunchedEffect(pin)` — debounce 600ms, fires only when
  `pin.length == 6 && pin != initialPin && ValidationUtils.validatePin(pin) == null` and not
  read-only; sets `latitude`/`longitude` (the existing `LaunchedEffect(latitude, longitude)`
  recenters the inline preview + MapPickerScreen) and `locationStatus = "Location set from
  pincode — drag to adjust"`. `initialPin` guard = don't snap on opening an existing address.
- Needs the backend deployed (key live) to actually return coords; until then `coords:null`
  and the pin just stays put. Still needs on-device verification. Then mirror to iOS + web.

## Manual test steps (after key is live + backend deployed)

### ✅ Pincode snaps the pin
1. Add Address on the app (dev). Type a served pincode (e.g. `841301`).
2. **Expect:** within ~1s the map pin moves to that pincode's area. Drag to the exact spot.
3. Save → the saved coordinate is the dragged spot (not the pincode centre).

### ✅ Editing an existing address does NOT auto-move the pin
1. Open an existing address (pin already filled, precise location saved).
2. **Expect:** the pin stays on the saved location — no snap on open.
3. Change the pincode to a different valid one → **now** it snaps to the new area.

### ✅ Graceful fallback
- Geocoder off (`GEOCODING_SERVICE` not `googlemaps`) or an unlocatable pin → `coords:null`,
  app leaves the pin where it is; user drags manually. Save still works.
- Malformed/partial pin (<6 digits) → no call fired.

### ✅ Backend contract
- `GET /user/address/geocode?pin=841301` (authed): 200, `data.coords` = `{latitude,
  longitude}` when the key is live, else `null`.
- `pin=12` / `pin=abcdef`: 403.

## Rollout
- Backend: safe to ship now — dormant (returns null) until `GEOCODING_SERVICE=googlemaps` +
  key are set. Dev: `dapi.haper.in`.
- Set `GOOGLE_PLACES_API_KEY` + `GEOCODING_SERVICE=googlemaps` in Parameter Store → redeploy.
- Then build + ship the Android wiring; mirror to iOS + web.
