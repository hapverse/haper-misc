# Places Autocomplete — Full Review (Backend + Android)

Date: 2026-09-10
Scope: uncommitted changes on `dev` in `haper-backend` and `haper-android` implementing
Google Places Autocomplete/Details (backend proxy) + the map-picker search UI (Android).
This is a fresh, self-contained, from-scratch review (a prior Android-side pass was lost to
truncation in transit) — every finding below was independently re-verified against the actual
diffs and by running the build/test suites, not copied from any earlier pass.

---

## Verdicts

- **Backend (`haper-backend`): APPROVE WITH NOTES.** One Medium finding (missing rate limit on
  `/place-details`) should be fixed before ship; everything else is solid.
- **Android (`haper-android`): APPROVE.** The single highest-stakes correctness requirement
  (a search suggestion must never auto-confirm a location) is verified true in the actual code
  path. One small Low-severity coroutine-cancellation nit worth a follow-up, not a blocker.

---

## Backend — `haper-backend`

Files changed: `.env.example`, `packages/shared/config/index.js`, `packages/shared/utils/index.js`,
`packages/shared/utils/places.utils.js` (new), `packages/user/src/routes/address/controller.js`,
`packages/user/src/routes/address/router.js`, `packages/user/src/routes/address/validator.js`,
`packages/user/__tests__/address.test.js`.

Two new endpoints, both behind `jwtUtils.authenticate`:
- `GET /user/address/autocomplete?input=&sessiontoken=` → `placesUtils.getAutocompleteSuggestions`
- `GET /user/address/place-details?placeId=&sessiontoken=` → `placesUtils.getPlaceDetails`

### Medium

**`/place-details` has no rate limiting, unlike `/autocomplete`.** In
`packages/user/src/routes/address/router.js`:

```js
router.get("/autocomplete", autocompleteIpLimiter, validator.autocomplete, controller.autocomplete);
router.get("/place-details", validator.placeDetails, controller.placeDetails);
```

`autocompleteIpLimiter` (30 req / 5 min per IP, via `express-rate-limit`) is wired only onto
`/autocomplete`. `/place-details` is a separately-billed Google call (Basic Data SKU: geometry +
formatted_address + name) reachable by any authenticated user who can supply a `placeId` —
`placeId`s are not secret (they appear in Google's own public Places responses, in browser
devtools, in other apps' state, in URLs), so this isn't purely theoretical: a client (or a
compromised/rooted one bypassing the app's UI entirely) can hit `/place-details` directly, in a
tight loop, at whatever rate it likes, and each call is a billed Google request. Recommend adding
the same `autocompleteIpLimiter` (or a dedicated one) to `/place-details` before shipping — it's a
one-line change:

```js
router.get("/place-details", autocompleteIpLimiter, validator.placeDetails, controller.placeDetails);
```

(Sharing one limiter across both routes is fine since it's IP-keyed and both are the same cost
class; a separate limiter with its own window/max is also reasonable if you want to budget them
independently.)

### Low

**`.trim()` in the Joi validators is validation-only; it doesn't affect the value actually sent to
Google.** In `validator.js`:

```js
input: Joi.string().trim().min(...).max(...).required(),
```

Joi's `.trim()` here only affects what's checked against `.min()`/`.max()` during
`schema.validate(req.query)` — the validator never reassigns `req.query` (no
`{ value } = schema.validate(...)` + write-back, and no `stripUnknown`/`convert` handling that
would matter here). The controller then reads the *original*, untrimmed `req.query.input` /
`req.query.sessiontoken`:

```js
const { input, sessiontoken } = req.query;
const suggestions = await placesUtils.getAutocompleteSuggestions(String(input), String(sessiontoken));
```

So a query like `"  ram nagar  "` (14 chars trimmed-checked as 10) passes the min-length check but
is forwarded to Google with the surrounding whitespace intact. Harmless in practice — Google's
Autocomplete API tolerates leading/trailing whitespace in `input`, and a stray space in a
`sessiontoken` is inert since it's opaque and only echoed back — but it's an inconsistency: the
`.trim()` reads as if it sanitizes the value, and it doesn't. Either drop `.trim()` (since it does
nothing useful today) or use the validated/trimmed value downstream for consistency. Not worth
blocking on.

### Verified from the earlier context (all confirmed correct)

- **Never-throw / fail-soft contract holds.** Both `getAutocompleteSuggestions` and
  `getPlaceDetails` in `packages/shared/utils/places.utils.js` wrap every Google call in
  try/catch, log via `console.log`, and return `[]` / `null` respectively on any failure (missing
  key, timeout, non-OK Google status, network error). The controller mirrors this: both handlers
  always `res.json(...)` with 200, never surfacing a Google-shaped error to the client. A bad
  *request* (missing/short input) still 403s via the Joi validator before it reaches the
  controller — that's the only non-200 case, and it's intentional input validation, not a Google
  failure leaking through.
- **Config centralization.** All magic numbers/strings for this feature —
  `rateLimitWindowMs`, `rateLimitMax`, `requestTimeoutMs`, `countryBias`, `language`,
  `detailsFieldMask`, `inputMinLength`, `inputMaxLength`, `placeIdMaxLength`,
  `sessionTokenMaxLength` — live in one place: `config.placesAutocomplete` in
  `packages/shared/config/index.js`. Nothing is duplicated inline in the router/validator/utils.
- **API key never reaches the client or logs.** `GOOGLE_PLACES_AUTOCOMPLETE_API_KEY` is read
  server-side only (`config.placesAutocomplete.apiKey`), attached to the outbound Google request,
  and never included in any response payload or `console.log` call (the two `console.log` calls
  in `places.utils.js` log only `err.message`, not request params or the key). It's a
  deliberately *separate* key from `GOOGLE_PLACES_API_KEY` (geocoding) for billing/quota
  isolation, per the plan doc's §1.
- **Timeout, no retry — by design, and reasonable.** `requestTimeoutMs: 3000` with no retry
  wrapper is a correct call for a per-request-billed API — a retry-on-timeout policy here would
  silently multiply Google billing on every slow/flaky request. Documented inline in
  `places.utils.js`'s header comment.
- **Test counts, re-verified by actually running them (not just reading the diff):**
  - `NODE_ENV=test npx jest --testPathPatterns=address.test.js` (this file alone, if scoped
    precisely) — the 39 new/changed test cases in the diff (13 `it()` blocks: 5 for autocomplete,
    5 for place-details, all in the diff above) are part of the file's 82 total.
  - Running `--testPathPatterns=address` (broader — also picks up
    `order-address-snapshot.test.js` and `order-address-guard.test.js`, both of which reference
    "address" in their path/describe) gives **100 passed, 100 total**, confirmed by actually
    running it just now:
    ```
    Test Suites: 3 passed, 3 total
    Tests:       100 passed, 100 total
    ```
  Both the "82" and "100" figures the earlier pass reported are correct — they're just different
  scopes (one file vs. a broader pattern match), not an inflated or inconsistent claim.
- **New tests are meaningful, not padding.** They cover: 403 on short/missing input, 403 on
  missing sessiontoken (both endpoints), 200 with mocked-fixture suggestions on the happy path,
  200 with an empty list on Google zero-results/error (proving the fail-soft contract end-to-end
  through the HTTP layer, not just at the utils-function level), and byte-for-byte forwarding of
  `sessiontoken` to the outbound Google call (`expect(spy).toHaveBeenCalledWith(...)`) for both
  routes — this last one is exactly the check that would catch a future refactor accidentally
  trimming/mangling the token and silently breaking Google's session-based billing.

---

## Android — `haper-android`

Files changed: `ApiService.kt`, `AddressModels.kt`, `AnalyticsTracker.kt`, `AddressViewModel.kt`,
`MapPickerScreen.kt`, `AddEditAddressScreen.kt`; new: `AddressSearchBar.kt`,
`AddressViewModelSearchTest.kt`, `PlaceSearchSessionTest.kt`.

Build and full unit-test suite were re-run fresh for this review:
- `./gradlew assembleDebug` — **succeeds**.
- `./gradlew :app:testDebugUnitTest` — **27 test suites, 438 tests total, 0 failures, 0 errors**
  (confirmed from the actual `TEST-*.xml` result files, not just console tail). The two new
  classes contribute 18 of those: `AddressViewModelSearchTest` (12 tests) and
  `PlaceSearchSessionTest` (6 tests) — matches the "18 new tests" figure exactly.

### Highest-stakes item — VERIFIED: a suggestion pick never auto-confirms a location

Traced the actual code path end to end, not just the comments:

In `MapPickerScreen.kt`, the suggestion-tap handler is:

```kotlin
onSuggestionClick = { suggestion ->
    AnalyticsTracker.trackPlaceSearchSelected()
    focusManager.clearFocus()
    selectedSuggestionLabel = suggestion.primaryText
    addressVM.selectSuggestion(suggestion) { lat, lng, viewport ->
        jumpTo(LatLng(lat, lng), viewport, defaultZoom = 15f)
        pendingHintOverride = true
    }
},
```

and in `AddressViewModel.kt`:

```kotlin
fun selectSuggestion(suggestion: PlaceSuggestion, onResult: (Double, Double, PlaceViewport?) -> Unit) {
    val token = searchSession.consume()
    viewModelScope.launch {
        try {
            val response = api.getPlaceDetails(suggestion.placeId, token ?: "")
            val place = response.body()?.data?.place
            if (response.isSuccessful && place != null) {
                onResult(place.latitude, place.longitude, place.viewport)
            }
        } catch (_: Exception) { /* best-effort */ }
        finally { discardSearchSession() }
    }
}
```

`onResult`'s callback signature is `(Double, Double, PlaceViewport?) -> Unit` — there is no route
from it to `onConfirm` or `selection.confirmPrecise` at all; the only thing the call site does
with it is call `jumpTo(...)`. `onConfirm` is a completely separate parameter of `MapPickerScreen`,
invoked from exactly one place — the "Confirm location" button's `onClick`:

```kotlin
onClick = {
    if (!hasUsedSearch) AnalyticsTracker.trackMapConfirmedWithoutSearch()
    onConfirm(target.latitude, target.longitude)
},
```

— which requires an explicit user tap and reads the live dragged `target`, not anything from the
suggestion. **Verdict: the invariant holds.** A suggestion pick only calls `jumpTo`, and the
existing "only GPS/explicit Confirm may mark a location as precise" behavior is unchanged.
`AddressViewModelSearchTest`'s test #2 (`selecting a suggestion drives jumpTo only, never confirms
the location`) exercises this against the real `LocationSelection`/`AddressSaveFlow` classes (not
a stand-in) and asserts `selection.isCoordinateConfirmed` stays false after a suggestion pick —
good test, matches the real risk.

### Verified: `MapPickerScreen`'s 5th param and its one call site

`grep -rl MapPickerScreen app/src/main/java` returns exactly 3 files: `MapPickerScreen.kt` itself,
`AddressSearchBar.kt` (an unrelated `import`-adjacent hit — it doesn't actually call
`MapPickerScreen`, just lives in the same package direction; the real call is in
`AddEditAddressScreen.kt`), and `AddEditAddressScreen.kt`. Confirmed by grep there is exactly
**one call site**, and `addressVM: AddressViewModel` is already an existing parameter of
`AddEditAddressScreen` (used throughout that file already, e.g. `addressVM.updateAddress(...)`,
`addressVM.errorMessage`) — so wiring it into the `MapPickerScreen(...)` call required no new
plumbing, just passing an already-in-scope value. `assembleDebug` succeeds with no other call
sites broken. The added `decorFitsSystemWindows = false` on the `Dialog`'s `DialogProperties` is
scoped to that one dialog and is the correct fix for the stated reason (so the Dialog window
picks up the IME inset itself, which `imePadding()` inside `MapPickerScreen` needs to react to) —
not touching any other dialog/screen in the file.

### Verified: `jumpTo`'s distance-aware `move()`/`animate()` applies to all callers, and near-field behavior is unchanged

`jumpTo` has exactly 3 call sites in `MapPickerScreen.kt`:
- GPS fix: `jumpTo(LatLng(loc.latitude, loc.longitude))` — no `viewport`/`defaultZoom` args.
- Map click/drag: `jumpTo(latLng)` — same.
- Suggestion selection: `jumpTo(LatLng(lat, lng), viewport, defaultZoom = 15f)`.

The new distance check (`Location.distanceBetween(...)`, `isFarJump = distanceMeters[0] > 50_000f`)
runs unconditionally inside `jumpTo` for **all three** callers, exactly as flagged for
verification. For the GPS/click callers, real-world jump distances (device GPS fix vs. current map
center, or a drag-to-click on the currently-visible map) are essentially always well under 50 km
— so `isFarJump` evaluates `false` for these in every realistic case, and they fall through to the
same `cameraPositionState.animate(CameraUpdateFactory.newLatLngZoom(target, 17f))` call as before
the change (same zoom level 17, same animate semantics; the only structural difference is it now
goes through an `if/else` that resolves to the pre-existing branch, not new behavior). **Verdict:
net improvement, not a regression** — the >50km case (which realistically only the search feature
can produce, since GPS/drag can't move you 50km in one jump) now gets an instant `move()` instead
of an oddly long fly-over animation across half of India, while normal-distance GPS/recenter/drag
behavior is provably unchanged.

### Low: `catch (_: Exception)` in `runAutocomplete` can catch `CancellationException`, causing a brief, real (if minor) UI flicker

This is a genuine bug, not "harmless because the sequence-number guard covers it" — the guard and
this bug are orthogonal; here's the concrete sequence:

```kotlin
private suspend fun runAutocomplete(query: String) {
    val requestId = ++latestRequestId
    ...
    try {
        val response = api.getAutocomplete(query, token)
        if (requestId != latestRequestId) return
        ...
    } catch (_: Exception) {
        if (requestId == latestRequestId) searchState = AddressSearchState.Error
    }
}
```

`kotlinx.coroutines.CancellationException` is a `RuntimeException`/`Exception` subtype, so
`catch (_: Exception)` catches it too. Trace a real race:

1. User types "ram" → debounce fires after 300ms → `runAutocomplete("ram")` starts, sets
   `requestId = latestRequestId = N`, and suspends inside `api.getAutocomplete(...)` (in flight).
2. User types one more character ("ram n") before that network call returns.
   `onSearchQueryChange` calls `searchJob?.cancel()` — cancelling the *same* job that's
   suspended in step 1's network call — then launches a *new* job that starts its own 300ms
   debounce (it hasn't called `runAutocomplete` yet, so `latestRequestId` is still `N`).
3. The cancellation throws `CancellationException` at the network call's suspension point inside
   the old job. It's caught by `catch (_: Exception)`. The guard check
   `requestId == latestRequestId` evaluates **true** (both are still `N` — the new job hasn't
   incremented it yet), so `searchState` is incorrectly set to `AddressSearchState.Error`.
4. For up to the new job's 300ms debounce window, the UI shows "Couldn't load suggestions — check
   your connection" — even though nothing failed and the user is mid-typing with a perfectly fine
   connection. Then the new debounce fires, `searchState` flips to `Loading`, and (assuming
   success) to `Results` — so it self-heals, but there's a real, user-visible incorrect-state
   flash in between.

This is a genuinely fast-typing-triggered cosmetic bug (a false "connection error" flicker), not a
crash and not a data-correctness issue — the final state a user lands on is always correct once
they stop typing. Fix is small and idiomatic: rethrow cancellation instead of swallowing it, e.g.

```kotlin
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Exception) {
    if (requestId == latestRequestId) searchState = AddressSearchState.Error
}
```

Worth noting: the existing test suite does **not** exercise this path — test #5 in
`AddressViewModelSearchTest` (the sequence-number-guard test) deliberately drops the tracked
`searchJob` reference via reflection specifically *so that* the older job is left running
un-cancelled, explicitly to avoid the normal cancellation path and force the race a different way.
That's a reasonable test design for what it's testing, but it means this particular flicker bug
has no regression test today. Not a blocker for shipping the feature, but worth a quick follow-up
fix + a test asserting `searchState` stays `Loading`/transitions cleanly to the new query's state
without passing through `Error` when a keystroke cancels an in-flight request.

### Other things checked, no issues found

- `PlaceSearchSession` (`begin`/`consume`/`abandon`) is a small, correctly-scoped state holder;
  `discardSearchSession()` is called from `onClear`, and from `AddressViewModel.clearAll()` — so
  leaving the map picker or clearing search always ends the session, no token leak across
  sessions. `PlaceSearchSessionTest` covers lazy creation, reuse, consume-doesn't-mutate,
  abandon-clears, fresh-token-after-abandon, and abandon-on-empty-is-a-no-op — good coverage for
  a class whose only job is exactly these five behaviors.
- `AddressSearchBar.kt` (`MapSearchField`, `PlacesSuggestionPanel`, `PlacesSuggestionRow`,
  `NoResultsRow`, `ErrorRow`) is pure, self-contained UI with no state ownership beyond what's
  passed in — no correctness concerns, only cosmetic/design-system choices (e.g. the file has an
  honest inline comment flagging that the plan's named `HaperType.labelLarge` doesn't exist in the
  design system and substitutes the base M3 `Typography.labelLarge`, explicitly flagged for
  design sign-off rather than silently guessed).
- `AnalyticsTracker.kt` additions (`trackPlaceSearchOpened`, `trackPlaceSearchZeroResults`,
  `trackPlaceSearchSelected`, `trackMapConfirmedWithoutSearch`) are simple `logEvent` wrappers,
  consistent with the rest of the file's pattern; no PII in the logged params
  (`query_length` is a count, not the query text).
- `AddressModels.kt` new response models (`PlaceAutocompleteResponse`, `PlaceSuggestion`,
  `PlaceDetailsResponse`, `PlaceDetails`, `PlaceViewport`) all have default values on every field
  — consistent with the codebase's Gson-safety convention (missing JSON keys decode to the
  default, not a crash), matching the project-wide rule that new fields must be nullable/defaulted.

---

## Summary

| Repo | Verdict | Blocking items |
|---|---|---|
| haper-backend | APPROVE WITH NOTES | Medium: add rate limiting to `/place-details` (currently unprotected, billed Google call) |
| haper-android | APPROVE | None blocking; Low: `CancellationException` swallowed in `runAutocomplete`, causes a brief false-"Error" UI flicker on fast typing — recommend a follow-up fix + test, not a ship-blocker |

Both repos' test suites were re-run fresh for this review (not trusted from memory):
backend 100/100 passing (`--testPathPatterns=address`), Android 438/438 passing across 27 suites
(`:app:testDebugUnitTest`), and `./gradlew assembleDebug` succeeds.
