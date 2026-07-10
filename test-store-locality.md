# Test: Home screen store "locality" address line

**Area:** User app → Home screen → the grey address line under the selected store name
**Backend:** `GET /user/store/nearest` → `data.locality` (packages/user store controller)
**Apps:** Android + iOS (both read `data.locality`)

## What this line is

It is **not** the store's saved address. It is a reverse-geocode of the phone's GPS
coordinates (`x-user-latitude` / `x-user-longitude` headers) done by the backend via
`geocodingUtils.getLocality()` and returned as `data.locality`. The app just prints
that string under the store name (`homeVM.locality`).

## Current state (2026-07-05) — line temporarily hidden

OpenStreetMap (the current geocoder) returns a **wrong pincode** for some areas — e.g.
Chhapra / Bhagwan Bazar shows **841300** when the real pincode is **841301**. The whole
string, pincode included, comes verbatim from OSM's `display_name`; the backend does not
build or validate it.

**Temporary fix:** the nearest-store controller now sends `locality: ""` so the app shows
nothing on that line. The geocode call is left in place (parallel + cached) so re-enabling
is a one-line change.

**Planned real fix:** switch `GEOCODING_SERVICE=googlemaps` and return Google's
`formatted_address` string (better Indian pincode data), made fail-safe (never throw) and
cached like the OSM path. Tracked separately.

## Manual test steps

### ✅ Line is hidden
1. Open the user app (Android or iOS) pointing at dev (`dapi.haper.in`).
2. On the Home screen, confirm the selected store name still shows (e.g. "Haper Bhagwan Bazar").
3. Confirm the grey address line **below it is blank** — no "…841300…" text.

### ✅ Backend contract unchanged
1. `GET /user/store/nearest` with valid lat/long headers.
2. Response still has `data.store` (array) and `data.locality` — but `locality` is `""`.
3. No client should crash on an empty string (Android/iOS decode it as `String`).

### ✅ Automated
- `cd packages/user && NODE_ENV=test npx jest __tests__/store.test.js` — the
  "locality is always an empty string" test asserts `data.locality === ""`.

## Notes / edge cases
- The `GET /user/address/locality` endpoint (used to prefill the Add/Edit Address form) is
  **unchanged** — it still returns the real reverse-geocoded address. Only the home-screen
  store line was blanked.
- On Android, an empty `Text("")` may still leave a tiny vertical gap where the line was.
  If that gap must go too, hide the `Text` when `locality` is blank (needs an app build).

## Deploy / rollout
- Backend-only change on `dev`. Takes effect on the installed app immediately (no app
  release needed) once the dev backend is deployed.
