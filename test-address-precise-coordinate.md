# Test: Precise vs approximate delivery coordinate (Android)

**Status:** Android DONE incl. the 2026-08-24 code-review fix-loop and the 2026-08-26 PIN-prompt
follow-up (clean `testDebugUnitTest` + `assembleDebug` green, 313 unit tests, 0 failures; NOT
device-verified). Backend: no change.
iOS: same fix done in parallel — see the "FIX 2026-08-24" section of
`test-address-pincode-geocode.md`. The 2026-08-26 PIN-prompt follow-up below (**"Snap to new PIN"
→ "Update location"** + a **PIN-named status line**) was ported to iOS on 2026-08-26 as well —
iOS manual steps 9–10 in `test-address-pincode-geocode.md`; `xcodebuild build` SUCCEEDED,
SwiftLint clean, 3 new `AddressModelsTests` cases + a negative-control runtime probe.
Web: N/A (no map picker).

## Why

`AddEditAddressScreen` treated a **PIN-derived coordinate** (an area centroid returned by
`GET /user/address/geocode`) exactly like a **GPS / map-confirmed coordinate**. The Save gate
only asked "is there a coordinate?", never "is it precise?".

Real example: a user in Chapra types PIN `841301`, the pin jumps to the middle of the PIN area
(~2 km from their house), they tap Save without dragging. The address is stored on the centroid
and the rider is sent to the wrong street.

Prod-dump analysis: **19% of addresses had collapsed onto 3 fake centroid coordinates, 23% of
the month's orders affected, and it was getting worse.** A second path made it worse still —
editing the PIN on an address that already had a good coordinate silently overwrote it.

## The fix (client-only — no new API field)

A coordinate now carries a confirmed/unconfirmed flag, held next to lat/lng in a
`LocationSelection` state holder in `AddEditAddressScreen.kt`:

- **Confirmed** = a GPS fix, an explicit map-picker confirm, or a coordinate loaded from the DB.
  A DB coordinate is treated as confirmed as a *pragmatic default* — the client cannot distinguish
  a legitimate GPS/map coordinate from a legacy pincode-centroid saved before this fix. So the
  "Confirmed location" styling will show on some historical addresses that are still actually
  approximate; closing that gap needs a backfill or a persisted confirmation flag (separate
  decision, see Known gaps).
- **Unconfirmed** = a pincode centroid.
- **Save gate** (`AddEditAddressScreen.kt:660`, `AddressSaveFlow.requestSave()` at
  `AddEditAddressScreen.kt:260`): only a *confirmed* coordinate is persisted. An unconfirmed one
  **opens the map picker** — Save behaves exactly like tapping "PIN-based location — tap to
  confirm on map" — and the save runs only after the user taps **Confirm location**.
  Save **never** captures the phone's GPS on the user's behalf: otherwise someone in Bangalore
  adding a Chapra address by PIN would silently save their *Bangalore* location as the delivery
  point. GPS is now reachable only from the explicit **Refresh / Capture location** button and
  from the picker's own "use current location" affordance.
- **Late-GPS guard**: a GPS fix still in flight when the user confirms on the map picker is
  **discarded** (each request carries an id that a confirm invalidates), so a stale fix can never
  overwrite an explicit confirmation. Tapping Refresh on an already-confirmed address still works.
- **PIN change on a confirmed address** no longer overwrites anything: it shows an inline prompt,
  *"Your PIN changed. Update the pin location to match?"* → **Keep current location** (no-op) /
  **Update location** (applies the centroid and marks it unconfirmed again). Editing the PIN
  **again** while that prompt is open dismisses it, because it refers to the *previous* pincode's
  coordinate.
- **2026-08-26 follow-up (this session):** the action was renamed **"Snap to new PIN" → "Update
  location"** (plain language, and it reads as a clear either/or against "Keep current location"),
  and a **PIN-named status line** was added. Once the coordinate is unconfirmed, every further PIN
  edit applies silently and correctly — but every other cue on screen (amber marker, "Approximate
  — not yet confirmed", the overlay caption) is *identical* before and after, and the only motion
  was a silent camera pan in the 180dp preview, so it read as "nothing happened". The status text
  now names the PIN — *"Approximate area from PIN 841303 — drag the pin to your exact spot"* — and
  is shown in the **Maps** branch too (it was previously rendered only in the no-Maps fallback).
- What is saved is still just the coordinate — nothing new persists.

Coordinate + flag are `rememberSaveable` together, so rotation / process death can never bring
back "confirmed" with a missing coordinate.

## Manual test steps (dev)

### ✅ REQUIRED (regression-critical) — the save gate
> This is the check that must never regress, and it **cannot** be unit-tested end-to-end (no
> Compose UI test infra in this repo — the gate lives at `AddEditAddressScreen.kt:660`, backed by
> `AddressSaveFlow.requestSave()` at `AddEditAddressScreen.kt:260`). **Run it by hand every time
> this screen changes.**

1. Stand/sit somewhere far from the delivery PIN (e.g. be in Bangalore, deliver to Chapra) with
   location permission **granted** and GPS **on** — this is the dangerous case.
2. Add Address → fill the fields → type PIN `841301`, let the pin snap.
3. Status under the map reads **"Approximate — not yet confirmed"**, the map pin is **amber**,
   the caption reads "PIN-based location — tap to confirm on map". No Lat/Lng is shown.
4. Tap **Save** without touching the map.
5. **Expect:** the **map picker opens**, centred on the PIN area (not on Bangalore), and *nothing
   is saved yet*. Tap **Confirm location** → pin turns green and the address saves in one go.
6. **Expect (the actual bug guard):** the saved coordinate is the **Chapra** one you confirmed —
   the app must **never** silently capture your Bangalore GPS and store it as the delivery point.
7. Press **Back** / the picker's back arrow instead of Confirm → the picker closes, **nothing is
   saved**, you are back on the form with the coordinate still amber/unconfirmed.

### ✅ Pincode guess cannot be saved as-is (no location permission)
1. Same as above with location permission **denied** and GPS **off**.
2. Tap **Save** → the picker still opens (it does not need GPS), still centred on the PIN area.
   Confirm → saves. No permission dialog is required to save.

### ✅ Confirmed coordinate saves directly
1. Same as above, but tap the map preview, drag to the exact spot, **Confirm**.
2. Pin turns **green**, status reads **"Confirmed location"** with the Lat/Lng line.
3. Tap **Save** → saves immediately, no location prompt.
4. Same via the **Refresh** (GPS) button → status "Location confirmed", saves immediately.

### ✅ Editing the PIN never eats a good coordinate
1. Open an existing address that has a saved location (pin green, "Saved location").
2. Change the PIN to a different valid one.
3. **Expect:** the pin does **not** move. An amber prompt appears: *"Your PIN changed. Update the
   pin location to match?"*
4. **Keep current location** → prompt closes, coordinate untouched, still green/confirmed, Save
   still saves directly.
5. Repeat and tap **Update location** → pin moves to the new area, goes **amber/unconfirmed**,
   the caption under the map reads *"Approximate area from PIN &lt;that PIN&gt; — drag the pin to your
   exact spot"*, and Save now opens the map picker first.

### ✅ A SECOND PIN edit after "Update location" (fixed 2026-08-26)
1. Existing address with a saved (green) location. Change the PIN → prompt appears → tap
   **Update location** → pin amber, caption names that PIN (e.g. `841302`).
2. **Without saving**, change the PIN to a *third* valid value (e.g. `841303`).
3. **Expect:** **no** second prompt (correct — there is no longer a confirmed coordinate to
   protect, so the new area applies silently), the map pin moves to the new area, and the caption
   now names the **new** PIN (`841303`). ❌ Fail if the caption still names the old PIN, or if the
   pin does not move — that is the "nothing happens" report this fix addresses.
4. Repeat once more (a 4th PIN) → same behaviour, caption keeps tracking the latest PIN.
5. Tap the map → drag → **Confirm location** → green/confirmed and the PIN-area caption
   **disappears** (it is no longer an approximation).

### ✅ Editing the PIN again while the prompt is open
1. Open an existing address with a saved (green) location. Change the PIN → the amber
   *"Your PIN changed…"* prompt appears.
2. Without tapping either action, edit the PIN **again** (delete a digit, or type a different
   valid PIN).
3. **Expect:** the old prompt **disappears**. If the new value is a complete valid PIN, a *fresh*
   prompt appears for that PIN. Tapping **Update location** on it moves the pin to the **new**
   PIN's area — never the previous one's. (Was a bug: the stale prompt applied the old PIN.)

### ✅ Save while the PIN-change prompt is open — deliberate behaviour
1. Existing address with a green/confirmed location. Change the PIN → prompt appears.
2. Tap **Save** while the prompt is still open.
3. **Expect:** it saves immediately, keeping the **OLD confirmed coordinate** against the **NEW
   pin**. This is **deliberate, not a bug** — the prompt is an *offer* to move the pin, and an
   untouched confirmed coordinate always outranks a centroid. (Users who do want the new area tap
   *Update location* first, which flips it to unconfirmed and routes Save through the picker.)

### ✅ Late GPS must not steal an explicit map confirm
1. On a slow/indoor GPS fix: tap **Refresh** (status shows "Fetching location…"), then *before it
   returns* tap the map preview, drag somewhere clearly different, and tap **Confirm location**.
2. **Expect:** the confirmed spot stays. When the late GPS fix eventually lands it is **silently
   discarded** — the pin must not jump. Status stays "Location confirmed".
3. Then tap **Refresh** again and let it finish → it *does* update the coordinate (the guard only
   drops superseded fixes; Refresh on a confirmed address still works).

### ✅ Opening an existing address
- Open (or view read-only) an address with a saved coordinate → green, "Saved location",
  no prompt, no snap on open.

### ✅ No-Maps-key fallback build
- With `MAPS_API_KEY` blank: confirmed → green row + Lat/Lng. Unconfirmed-with-PIN-coordinate →
  amber card "Approximate location — tap Refresh to confirm precisely" + "We only know the area
  of PIN <n>, not your exact spot." (no Lat/Lng shown).
  No coordinate → "Location not captured". Hardcoded hex colours replaced with the
  `Success`/`Warning` theme tokens, so this block is now correct in **dark theme** too.
- **Save with an unconfirmed coordinate** in this build has no map to open, and still refuses to
  grab GPS for the user → error dialog *"Confirm your delivery location first — tap Capture
  location."* Tapping **Capture location** (an explicit user action) then confirms via GPS and
  Save goes through.

### ✅ Accessibility / platform
- TalkBack: both prompt links announce as buttons ("Keep current location" / "Update location");
  the PIN-area caption is plain text and is re-announced when it changes.
  status icons are decorative (adjacent text carries the meaning).
- Both links have a real ≥48dp touch target (`minimumInteractiveComponentSize()`).
- Rotate the screen / force process death (Don't keep activities) mid-flow after a GPS confirm →
  the coordinate **and** its confirmed state both survive; Save still behaves correctly.

## ❌ Edge cases / known gaps
- **Existing bad prod rows are not repaired** by this change — it only stops new ones. A backfill
  / re-prompt for the ~19% already-collapsed addresses is a separate decision.
- **A DB coordinate is shown as "Confirmed" even when it is a legacy centroid.** The client
  cannot tell a real GPS/map coordinate apart from a pincode-centroid written by the old code, so
  it trusts what is stored. Consequence: some historical addresses display the green "Confirmed
  location" styling while still being approximate, and editing one will Save straight through
  without a map confirm. Closing this needs either the backfill above or a **persisted
  confirmation flag** on the address (new API field) — a separate decision, not done here.
- **Copy/flow parity with iOS** is intentional but the two are separate implementations —
  re-check both when the wording changes.
- A user can still deliberately confirm an *approximate* spot in the map picker, or tap
  "use current location" from somewhere other than the address. The fix removes the *silent*
  path, not the ability to choose badly on purpose.
- **No Compose UI test infra** in this repo, so the Save→map-picker wiring itself is covered by
  the JVM tests of `AddressSaveFlow` plus the REQUIRED manual step above, not an end-to-end test.
  Adding `compose-ui-test`/Robolectric is a future follow-up.

## Automated coverage
- `app/src/test/java/com/bheldi/ui/screens/address/LocationSelectionTest.kt` — 21 JVM tests:
  save blocked on a guess / allowed when confirmed, PIN change does not overwrite, snap-to-new-PIN
  flips to unconfirmed, keep-current is a no-op, DB coordinate starts confirmed, saver round-trip,
  **late/superseded GPS fixes dropped while Refresh still works**, **a further PIN edit clears the
  stale prompt** (and the old guess can no longer be snapped to).
- `app/src/test/java/com/bheldi/ui/screens/address/AddressSaveFlowTest.kt` — 10 JVM tests on the
  real save gate: unconfirmed → picker (never GPS), confirmed → save now, picker confirm completes
  the queued save, manual map tap does *not* save, dismissing abandons the save, keyless-Maps
  build asks for a manual capture, in-flight GPS discarded on picker confirm.
- Suite total: **310 tests, 0 failures** (`clean testDebugUnitTest assembleDebug` green).

## Rollout
- Client-only, no backend deploy needed. Ships in the next Android build.

---

## FIX · Retroactive map-confirmation on legacy addresses (2026-09-03)

**The bug:** 121+ production addresses had a fake "pincode centroid" GPS coordinate (an approximate location guessed from just the pincode, shared byte-identically by dozens of different customers' addresses) instead of the customer's real confirmed location. Root cause: the app checked "do coordinates exist?" (`latitude != null && longitude != null`) but never checked "are they real?". So when a customer **edited** an existing address that had a fake coordinate, the app saw coordinates present, assumed they were confirmed, and saved the fake centroid right back **without asking for re-confirmation on the map**.

**The fix (backend + Android):**
- Backend: new nullable field on the address model `isCoordinateConfirmed` (Boolean, `default: null`) in `packages/shared/models/addresses.schema.js`.
  - `true` = customer actually confirmed this coordinate via map or GPS.
  - `false` = known unconfirmed (a pincode guess).
  - `null` = unknown/legacy (saved before this field existed).
- Backend validator (`packages/user/src/routes/address/validator.js`): field is optional on both create and update; never defaulted, so `null` is preserved.
- Android: `AddressModel` + `AddressUpsertRequest` now carry nullable `isCoordinateConfirmed: Boolean?`.
- Android logic: when **loading an existing address for editing**, the app now checks the backend's `isCoordinateConfirmed` flag via the function `isBackendCoordinateConfirmed(backendFlag: Boolean?): Boolean = backendFlag == true`.
  - **Only** `true` → skip map re-confirmation (address already confirmed).
  - **`null` or `false`** → treated as NOT confirmed → **map-confirmation step is required again**, same as a brand-new address.
- Once the customer confirms a location via map picker or GPS, the app sends back `isCoordinateConfirmed: true`.

**Important scope note:** this fix **stops the bug going forward** but does **NOT retroactively repair the 121 already-affected addresses**. Those customers will be prompted to confirm their real location the **next time they edit** that address — the first time they do so, they'll see the map picker (amber/unconfirmed), and after confirming, it will be locked as `isCoordinateConfirmed: true` for future edits.

**Deployment requirement:** BOTH a backend deploy AND a new Android build are **required** for the fix to work end-to-end. The backend must persist the flag on new/edited addresses; the Android app must check it when loading an existing address. If only one ships:
- Backend alone: old app versions still read `null` as "we don't know" and treat it as confirmed (no change).
- Android alone: new app reads the backend's `isCoordinateConfirmed` field but it's always null (pre-existing), so no impact yet.

### ✅ QA steps for the fix (dev)

#### ✅ New address — still requires map confirmation (unchanged behavior)
1. Add Address → fill the fields → type a PIN, let the pin snap.
2. Status shows **"Approximate — not yet confirmed"**, pin is **amber**.
3. Tap **Save** without touching the map.
4. **Expect:** the map picker opens (centred on the PIN area). Only after tapping **Confirm location** does the address save.
5. **Verify in backend:** fetch the saved address → `isCoordinateConfirmed: true`.
6. **Expect on iOS:** identical — a new address has no `AddressModel` yet, so `AddressCoordinatePolicy.initialSource(for: nil)` never applies here; the PIN-resolved coordinate is `.pincode` (not a confirmation), so Save routes through the map picker the same way.

#### ✅ Address with `isCoordinateConfirmed: true` — does NOT re-prompt on edit (no annoyance)
1. Open an existing address that has `isCoordinateConfirmed: true` in the backend (a customer who already confirmed their spot).
2. Edit a field (e.g., street name) without touching the coordinate.
3. Tap **Save**.
4. **Expect:** saves immediately, **no map picker**. The green/confirmed status never changes.
5. Edit the PIN to a different value.
6. **Expect:** the inline *"Your PIN changed. Update the pin location to match?"* prompt appears. Tapping **Keep current location** saves the old confirmed coordinate against the new PIN (no re-prompt). Tapping **Update location** marks it unconfirmed and runs Save through the map picker on the next click.
7. **Expect on iOS:** identical behavior — `AddressCoordinatePolicy.initialSource(for:)` resolves `.savedAddress(confirmed: true)`, status line reads "Saved location", Save skips the map picker.

#### ✅ Legacy address with `isCoordinateConfirmed: null` — NOW requires map re-confirmation on edit (THE FIX)
**This is the actual bug being fixed — the headline test case.**
1. Create an address via the old code path (before this fix landed) — it will have no `isCoordinateConfirmed` field (or set it to `null` via direct DB edit for testing).
2. Load that address for editing.
3. **Expect on Android:** the status reads **"Approximate — not yet confirmed"** (amber), even though the address **already has coordinates** from a previous PIN-centroid guess. (This is the diff from the old behavior: the old code treated "has coordinates" = "confirmed"; the new code treats "null flag" = "unknown, not confirmed".)
4. **Expect on iOS:** identical — `AddressCoordinatePolicy.initialSource(for:)` sees `isCoordinateConfirmed == nil`, resolves `.savedAddress(confirmed: false)`, status line reads **"Approximate area — drag the pin to your exact spot"**.
5. Edit the street name and tap **Save**.
6. **Expect:** the map picker opens (both platforms). The address will NOT save until the customer confirms a spot via map or GPS.
7. Once confirmed: **Verify in backend** that the address now has `isCoordinateConfirmed: true`.
8. Edit again without touching the coordinate: **Expect** no map picker (same as step ✅2 above, now that it's marked confirmed) — on both Android and iOS.

#### ✅ A legacy address with no coordinates — still behaves as before
1. Create an address with a PIN but **before** tapping map/GPS (no coordinates saved yet, no `isCoordinateConfirmed` field).
2. Edit it later.
3. **Expect:** `isCoordinateConfirmed` is null → treated as unconfirmed → map picker required on Save (unchanged from the old behavior; there was nothing to confirm, so this is moot).

#### ❌ Known, NOT yet fixed by this pass — tapping straight through the picker still saves a guess
1. Trigger the map picker (new address, or a legacy address being re-prompted per the case above).
2. **Without dragging the pin** from its pre-seeded position (pincode-centroid or default), tap **Confirm location** straight away.
3. **Expect (still a gap):** it saves — the guessed location goes through **just like a real confirmation**, now marked `isCoordinateConfirmed: true`. Once saved this way, the address will **never be re-prompted again** (it reads as genuinely confirmed).
4. This is a **known remaining gap**, not something this fix closes — this fix only stops the *silent, automatic* re-save of a stale guess on every edit; it does not stop a customer from *deliberately* (or carelessly) confirming a bad guess once. Closing this needs a minimum-drag-distance check or an explicit "is this pin actually where you live?" nudge — a separate, not-yet-scoped decision.

**Deploy note — backend and Android must ship together:** the backend's Joi validator on `POST/PATCH /user/address` rejects **unknown fields**. An OLD Android build (sends no `isCoordinateConfirmed` key) is unaffected either way — that's backward compatible. But a **NEW** Android build sending `isCoordinateConfirmed` would get a **400** from an **OLD** (not-yet-deployed) backend that doesn't know the field yet. **Deploy order: backend first, always** — never ship the new Android build ahead of the backend deploy.

## FOLLOW-UP · Location gate + coordinate source (2026-09-03)

Screen 13's `locPick` stage now fronts this screen for Add and Edit — see
**`test-address-location-gate.md`**. Two things there change behaviour covered by this guide:

- A **GPS** coordinate is now marked `isFromCurrentLocation` and a later PIN edit leaves it alone
  with **no** prompt. The "Editing the PIN never eats a good coordinate" steps below still apply
  unchanged to **map-confirmed** coordinates.
- The permanent-denial dead end is gone: "Enable location access" opens app Settings once the OS
  dialog has been refused.

### ❌ Known gaps
- **iOS fix has shipped on `dev`** (uncommitted as of 2026-09-04) — `AddressModel.isCoordinateConfirmed: Bool?` + `AddressCoordinatePolicy.Source.savedAddress(confirmed:)` mirror the Android logic; `AddEditAddressView`'s load path calls the new `AddressCoordinatePolicy.initialSource(for:)` seam. This is no longer an open client follow-up.
- Existing bad prod rows (the 121 addresses with fake centroids) are not repaired by this change. They persist with coordinates but no confirmation flag until edited by the customer. A backfill / proactive re-prompt for those rows was considered a separate decision.

### Automated coverage
- No new unit tests added to `AddEditAddressScreen.kt`/`AddressSaveFlow.kt` (the existing suite already covers the save-gate logic; the confirmation flag is passed through correctly). The verification is manual (the field is persisted, the flag is read and acted on).
- iOS: `haperTests/AddressModelsTests.swift` has a regression test (`testInitialSource_legacyAddressWithMissingFlag_isNotConfirmed`) decoding a legacy payload (no `isCoordinateConfirmed` key) and asserting `AddressCoordinatePolicy.initialSource(for:).isConfirmation == false`. **This test covers the pure-function logic in isolation, not the view's call site.** The SwiftUI view's actual call to this function (in `AddEditAddressView.swift`'s `onAppear`) is not unit-testable (SwiftUI `@State`/`onAppear` bodies cannot be XCTest-driven), so a regression there (e.g. reverting to a hardcoded `confirmed: true`) would **not** be caught by the automated suite. Catching that regression relies on the manual QA scenario below — specifically the case "legacy address, `isCoordinateConfirmed: null` → must re-prompt on edit".

### Rollout
- **Requires both:** backend deploy (to persist the field on new/edited addresses) + a new client build (Android and/or iOS) to check the flag.
- Ships when backend + the relevant client build are ready on dev.
