# Test: Add-address location gate (screen 13, Android)

**Status:** Android DONE (`assembleDebug` green, `LocationSelectionTest` 37 tests / 0 failures;
NOT device-verified). Backend: no change. iOS: not ported. Web/admin: N/A (no map picker).

Design source: Claude Design project `2e1582dd-952c-4743-a53f-3ebc4de4cc55`,
`Haper Green Screens.dc.html` card **13 — "Add address — map pin"**, which imports
`Haper Green App` at `initial-screen="addredit"`. That screen has **two** stages:
`{{ locPick }}` (this gate) and `{{ locForm }}` (the map band + form we already shipped).
Only the gate was missing.

> Caveat for whoever reads the design next: `Haper Green App.dc.html` is 261 KB and the design
> MCP caps `get_file` at 256 KB, so the file truncates **mid-script**. All of the `addredit`
> markup is readable; the JS behind `locCurNote` / `locBlocked` / `locPickTitle` is not. The
> granted-state note copy below is ours, not the prototype's.
> `README.md` §3.15 is also stale — it describes a delivery-slot picker that no longer exists in
> the markup. Follow the HTML.

## Why

`AddEditAddressScreen` dropped the user straight onto the form with the map parked on a hardcoded
Bihar centre (`AddEditAddressScreen.kt`, `DEFAULT_MAP_CENTER`). Two problems:

1. **No route out of a permanent denial.** After Android's second refusal the OS stops showing the
   permission dialog, so "Refresh / Capture" fell into `fetchCurrentLocation()`'s guard and showed
   the same error dialog forever, with no link to app Settings.
2. **The GPS shortcut was buried.** The fastest, most accurate path — "I am standing at the
   door" — was a small text button inside a summary card, below a map already showing the wrong
   place.

Real example: Vikash adds his Chapra address. Location is off. Today he lands on a map of
somewhere he has never been, hand-pans it, and only finds out at **Save** that the app wanted a
confirmed pin all along.

## What was built

**New:** `app/src/main/java/com/bheldi/ui/screens/address/LocationGateScreen.kt`

- Header — `HaperTopBar` + a hairline. Title is **"Add an address"** when adding and
  **"Confirm the location"** when editing (the prototype's title is the variable `locPickTitle`,
  not a fixed string).
- **Amber card**, only when permission is off — `UpdateMoneyWell` / `LocationGateBorder`,
  heading `LocationGateInk`, body `UpdateMoneyInk`, and a 44dp `HaperButtonAccent.Amber` button
  **"Enable location access"**.
- **"Use my current location"** — dimmed with *"Needs location access — turn it on above"* when
  blocked, a spinner while fetching, live with a chevron when granted.
- **"Pick another location"** — always live. This is what keeps a denied user able to finish.
- Privacy footer.

**Gate appears on Add AND on Edit** (product decision, 2026-09-03), never on the read-only
"view address" route.

**Permission escape:** first tap launches the OS dialog; after a refusal `wasLocationDenied`
flips and the same button opens `ACTION_APPLICATION_DETAILS_SETTINGS` via `context.launchSafely`.
An `ON_RESUME` observer re-reads the permission so returning from Settings updates the gate in
place — no second tap needed.

**Coordinate source rule (new).** `LocationSelection` now carries `isFromCurrentLocation`, set
only by a GPS fix (`applyGpsResult`), never by a map confirm:

- **GPS coordinate** → a later PIN edit leaves lat/lng alone and raises **no** prompt.
- **Map-confirmed coordinate** → unchanged from today: the PIN edit still asks
  "Update location / Keep current".

The `.dc.html` `locFromCurrent` badge (**CURRENT LOCATION**, `GreenDeep` on `SurfaceMint`) now
renders next to the summary-card heading — it is the only on-screen cue that a PIN edit will not
move this coordinate.

Deliberately **not** built: PIN autofill from the GPS reverse-geocode (deferred, see Known gaps).

## Manual test steps (dev)

### ✅ Permission DENIED — the case in the design screenshot
1. Settings → Apps → Haper → Permissions → Location → **Deny**. Open the app, Profile →
   Addresses → **Add Address**.
2. **Expect:** the gate, not the form. Amber card **"Location access is off"**, orange
   **"Enable location access"** button. The "Use my current location" row is **faded**, reads
   *"Needs location access — turn it on above"*, and shows **no chevron**.
3. Tap **Enable location access** → the OS permission dialog appears. Refuse it.
4. **Expect:** you stay on the gate. **No error modal** — the amber card already says it.
5. Tap **Enable location access** again → **the app's Settings page opens** (this is the dead end
   that used to exist). Grant Location there, press Back.
6. **Expect:** the gate has updated **by itself** — the amber card is gone and the GPS row is
   live. You should NOT have to tap anything to refresh it.

### ✅ Denied user can still finish
1. From step 2 above, tap **"Pick another location"**.
2. **Expect:** the form, behaving exactly as it does today — default map centre, PIN→pin snap,
   and Save routed through the map picker. Nothing about the denial blocks the save.

### ✅ Permission GRANTED — the happy path
1. Grant location. Add Address.
2. **Expect:** the gate with **no** amber card; the GPS row is live with a chevron.
3. Tap **"Use my current location"** → a spinner appears in the row.
4. **Expect:** the gate closes on its own and the form opens with the map band **already centred
   on you**, the pin **green**, heading **"Confirmed location"**, and a **CURRENT LOCATION**
   badge beside it.
5. Tap **Save** → saves immediately, no map picker (the coordinate is already confirmed).

### ✅ GPS coordinate survives a PIN edit (the rule added 2026-09-03)
1. From step 4 above, change the **PIN code** field to a different valid PIN (e.g. `841302`).
2. **Expect:** the map does **NOT** move, the coordinate does **NOT** change, and the
   "Update location / Keep current" prompt does **NOT** appear. The CURRENT LOCATION badge stays.

### ✅ Map-confirmed coordinate still asks (unchanged behaviour)
1. Add Address → "Pick another location" → tap the map preview → drag → **Confirm location**.
2. **Expect:** pin green, **no** CURRENT LOCATION badge (this came from the map, not GPS).
3. Change the PIN code.
4. **Expect:** the **"Update location / Keep current" prompt appears**, exactly as before.

### ✅ Edit route
1. Addresses → tap an existing address → **Edit**.
2. **Expect:** the gate, titled **"Confirm the location"** (not "Add an address").

### ✅ View route is unaffected
1. Open an address in read-only "view" mode.
2. **Expect:** **no gate** — straight to the read-only form.

### ✅ Location services off (permission granted, GPS toggle off)
1. Grant permission, turn the phone's Location **master toggle** off. Add Address → gate →
   "Use my current location".
2. **Expect:** the Play-services "turn on location" resolution dialog. Accept → the fix lands and
   the gate closes. Decline → you stay on the gate with an error dialog, spinner cleared.

### ✅ Rotation / process death
1. On the gate, rotate the device → the gate stays, same state.
2. Get a GPS fix → form with the CURRENT LOCATION badge → rotate.
3. **Expect:** badge still there, and a PIN edit still does not move the coordinate.
   (Guarded by `current-location marking survives a saver round trip`.)

### ✅ Accessibility
1. TalkBack on. Both gate rows announce as buttons with their titles.
2. The blocked GPS row is still tappable and opens the permission dialog — it looks inert but is
   not a silent no-op.

## ❌ Edge cases / known gaps

- **PIN is not autofilled from the GPS fix.** The reverse-geocode at
  `AddEditAddressScreen.kt`'s `LaunchedEffect(latitude, longitude)` already returns
  `Address.postalCode` and we discard it. Deferred deliberately on 2026-09-03. When it is picked
  up it needs a guard: writing `pin` re-triggers `LaunchedEffect(pin)` → `shouldLookupPincode` →
  `geocodePincode` → `applyPincodeGuess`, which on a **map-confirmed** coordinate would pop the
  PIN-change prompt right after the user asked for their own location. (A GPS coordinate is now
  immune, per the rule above — but a map-confirmed one is not.)
- **Granted-state note copy is ours** ("We'll drop the pin at your door"), not the prototype's —
  the design file truncated before the JS. Swap it if the original surfaces.
- **The gate is Android-only.** iOS (`haper-ios`) still opens straight onto the form.
- The gate is **not** covered by Compose UI tests (no UI-test infra in this repo). Only the pure
  copy/state functions are unit-tested — the screen itself must be checked by hand.

## Automated coverage

`app/src/test/java/com/bheldi/ui/screens/address/LocationSelectionTest.kt` — 37 tests, 0 failures.
New in this change:

- `gps fix is marked as coming from the current location`
- `map confirm is not marked as coming from the current location`
- `pin edit never moves a gps coordinate and never prompts`
- `pin edit still prompts for a map-confirmed coordinate`
- `snapping to a new pin clears the current-location marking`
- `current-location marking survives a saver round trip`
- `blocked gate dims the gps row and points at the enable button`
- `fetching gate shows a spinner instead of a chevron`
- `ready gate is live`
- `gate title says confirm when editing an existing address`

## Related

- `test-address-precise-coordinate.md` — the save gate this stage sits in front of, and the
  `isCoordinateConfirmed` backend flag.
- `test-address-pincode-geocode.md` — the PIN→pin snap whose behaviour the coordinate-source rule
  now changes for GPS coordinates.
