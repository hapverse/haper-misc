# Google Places Autocomplete — Android "Add Other Address" Map Picker

Status: FINAL PLAN, ready for implementation. Consults closed: arijit-frontend-arch (architecture,
two passes — second pass read `MapPickerScreen.kt`, `AddEditAddressScreen.kt`,
`AddressViewModel.kt`, `NetworkModule.kt` line-by-line), chanchal-designer (UI, two passes — second
pass read `MapPickerScreen.kt`, `HomeScreen.kt`, `Color.kt`, `Type.kt`, `Dimens.kt`, `Shadows.kt`
line-by-line), anuj-devops (key-provisioning decision, §1). Android only — iOS/web are separate
future work.

## 0. Scope recap

- Add search-as-you-type locality/address autocomplete to `MapPickerScreen.kt`.
- Additive only: existing manual drag, PIN-code geocode (`GET /user/address/geocode?pin=`), and
  GPS capture ("Use current location") must keep working unchanged. Autocomplete never replaces
  drag-to-fine-tune — Google's rural-Bihar coverage is patchy, so the pin a suggestion drops you
  on is a starting point, not the final answer.
- Architecture decision (final, from arijit-frontend-arch): **backend proxy**, two new endpoints,
  mirroring the existing `GET /user/address/geocode?pin=` proxy — which itself is already Redis-cached
  (30 days) server-side, confirming the backend-proxy precedent even more concretely than assumed
  at first pass. No Places SDK for Android, no direct Android→Google HTTP. Zero new Android
  dependencies — plain suspend Retrofit calls + a fully custom Compose search box/dropdown.
- UI decision (final, from chanchal-designer): search field docked at the top of the map (replacing
  the current back-button-row layout with a two-row chrome), expanding suggestion panel below it.
  Full spec in §3.2.
- **Invariant this whole feature must respect** (arijit-frontend-arch, SEVERITY HIGH — see §3.3):
  a Places suggestion is an area guess, exactly like a PIN-code centroid, NOT a precise doorstep
  pin. Selecting a suggestion must only move the map — it must never auto-confirm a location. This
  is the single most important constraint in this plan and shows up again as a first-class
  acceptance criterion in §4(a).
- **No new reverse-geocode call is needed anywhere in this feature.** `AddEditAddressScreen.kt`
  already re-derives the "City & state" read-only cell via the on-device `android.location.Geocoder`
  (lines 520-537) every time `locationSelection.latitude/longitude` changes — including after a
  map-picker confirm. Since this plan deliberately does not widen `MapPickerScreen`'s confirm
  contract (§3.3), that existing client-side Geocoder call keeps firing exactly as it does today,
  for free and offline-capable. Do not add a Google reverse-geocode call to this feature — it would
  be pure new cost for zero new UI benefit.

## 1. Prerequisite (BLOCKER, sequenced first) — anuj-devops

The existing `GOOGLE_PLACES_API_KEY` (AWS Parameter Store, project `haper-multistore-2fe9f`) is
currently restricted to **Geocoding API only** (used today by
`packages/shared/utils/geocoding.utils.js` for reverse-geocode and the pincode-centroid lookup).
Places API (New) — Autocomplete + Place Details — will 403 against this key until its API
restriction is broadened, or a second key is provisioned.

Note: the Android app also already ships a *different* Google key today — `MAPS_API_KEY` (a
build-time Gradle property, used only for on-device map tile rendering). That key being client-side
is normal/expected for map SDKs (Google's map-tile rendering has no server-side proxy option) and
is **not** a counter-precedent for shipping a Places key client-side — don't let a future reviewer
cite it as one. The Places key stays server-side only, per the backend-proxy decision above.

**Recommendation: provision a separate key for Places**, not broaden the existing one.
Reasoning:
- Cost/quota isolation per API — Places Autocomplete session billing and Geocoding billing are
  tracked independently, so a runaway session-token bug (see §3.4) shows up as an isolated spike
  on the Places key's dashboard instead of muddying the Geocoding key's usage graph.
- Blast radius — if the Places key ever needs to be rotated/revoked (e.g. suspected leak), it
  doesn't take down the unrelated pincode/reverse-geocode paths that already work today.
- Both keys land in the same place (Parameter Store, same project) so this isn't extra
  operational surface, just an extra key value.

Since the backend-proxy design (§2) means this key **only ever lives server-side** (injected as
an env var into the backend process, never shipped in the APK), the app-restriction on the key
can safely stay "None" as today, or optionally be tightened to the backend's server IP/NAT. This
is an anuj-devops judgment call, not a blocker either way — flagging it, not gating on it.

**This step must land before any backend work in §2 is deployable** (the code can be written in
parallel, but calls will 403 until the key/restriction exists in the dev environment).

Action items for anuj-devops:
1. Decide: new key vs. broadened restriction (recommend new key, per above).
2. Enable "Places API (New)" on that key in Google Cloud Console.
3. Add/update the Parameter Store value (new key → new env var name, e.g.
   `GOOGLE_PLACES_AUTOCOMPLETE_API_KEY`, or reuse `GOOGLE_PLACES_API_KEY` if restriction is
   broadened instead — pick ONE and tell backend which, since `packages/shared/config` reads it
   by name, see §2.1).
4. Confirm dev backend env picks up the value (redeploy dev, per this project's existing pattern
   for env var changes — see `reference_geocoding_google_only.md`: "GOOGLE_PLACES_API_KEY added
   to Parameter Store... redeploy to activate").

## 2. Backend (haper-backend) — two new proxy endpoints

Reference implementation to mirror: `packages/user/src/routes/address/{router,validator,controller}.js`
and `packages/shared/utils/geocoding.utils.js` (the existing `geocode?pin=` endpoint, itself
Redis-cached 30 days). Same package (`packages/user`), same route file, same "never throw, degrade
to null/empty" contract.

### 2.1 Config

File: `packages/shared/config/index.js` (existing `googlePlacesApiKey` is read at line ~99 from
`process.env.GOOGLE_PLACES_API_KEY`).

- If anuj-devops provisions a **separate** key (recommended): add a new config field, e.g.
  `googlePlacesAutocompleteApiKey: process.env.GOOGLE_PLACES_AUTOCOMPLETE_API_KEY`, alongside the
  existing one. Both utils files below read whichever key applies to them.
- If the **same** key is broadened instead: no config change needed, reuse `googlePlacesApiKey`.
- Either way, the new utils functions (§2.2) must follow the existing pattern: `if (!apiKey)
  return null` — inactive key never 500s, it just makes autocomplete silently unavailable (UI
  already has a "search failed" state per §3.2).

### 2.2 New shared util: `packages/shared/utils/places.utils.js`

New file (autocomplete/place-details don't belong in `geocoding.utils.js`, which is scoped to
forward/reverse geocoding — same separation of concerns already used in that codebase). Two
functions, both **stateless pass-throughs of the session token** (per arijit's design — Android
generates and owns the token lifecycle; backend never inspects or persists it):

```js
// GET https://maps.googleapis.com/maps/api/place/autocomplete/json
// params: input, sessiontoken, key, components=country:in (bias to India, matches the
// existing pincode geocode's country restriction), language=en
const getAutocompleteSuggestions = async (input, sessionToken) => { ... }

// GET https://maps.googleapis.com/maps/api/place/details/json
// params: place_id, sessiontoken, key, fields=geometry,formatted_address,name
// (minimal field mask — coords + a label string, plus geometry/viewport so the Android
// client can pick an appropriate zoom level on jump — see §3.5 "Camera jump quality" for
// why viewport is included. Stays on the cheaper "Basic Data" SKU tier; never pulls
// Contact/Atmosphere fields the app doesn't use.)
const getPlaceDetails = async (placeId, sessionToken) => { ... }
```

Contract, mirroring `geocoding.utils.js` exactly:
- Never throw. On any Google error/timeout/non-OK status, log (`console.log`, same style as the
  existing file) and return `null` (place-details) or `[]` (autocomplete) — never block the
  caller.
- `timeout: 3000` on the axios call, consistent with the existing geocode utils. **Deliberately no
  retry logic on timeout.** This is a per-request-billed Google API call; if a retry wrapper were
  ever added here, each retry re-bills, silently multiplying cost per slow/flaky request. (The
  Android app's own shared OkHttp client has exactly this kind of `ConnectionRetryInterceptor` for
  its own reasons — see §3.4's NetworkModule note — which is precisely why this file must not grow
  the equivalent behavior without deliberately re-evaluating this risk first.)
- **No caching for autocomplete** (input is free-text, per-keystroke — a cache would almost never
  hit and adds complexity for no benefit). There is also a hard ToS reason on top of the
  no-benefit one: Google Maps Platform's caching terms specifically discourage/limit caching of
  Autocomplete *prediction lists* (as opposed to place IDs, which may be cached indefinitely) — so
  this isn't just a complexity call, it's a compliance one. Place-details COULD be cached by
  placeId (permitted under ToS), but skip it initially — place selection is a one-off per
  address-add, caching a random cross-user placeId buys nothing meaningful; keep the file simple,
  add caching later only if usage data justifies it. **Do not add prediction-list caching later
  without re-checking Google's ToS first** — flagged explicitly so this isn't mistaken for a
  purely-complexity decision down the line.
- Google's own response `status` field must be checked (`"OK"`, `"ZERO_RESULTS"`,
  `"OVER_QUERY_LIMIT"`, `"REQUEST_DENIED"`, etc.) — only `"OK"` is treated as success;
  everything else (including rate-limit/quota errors) collapses to the same empty/null return so
  the client's error handling doesn't need to special-case Google's internal error taxonomy.

### 2.3 Validator additions: `packages/user/src/routes/address/validator.js`

Add next to `geocodePincode` (same file, same style):

```js
autocomplete: (req, res, next) => {
    const schema = Joi.object({
        input: Joi.string().trim().min(3).max(200).required(),
        sessiontoken: Joi.string().trim().min(1).max(200).required(),
    }).required();
    const { error } = schema.validate(req.query);
    if (error) return next(new errorUtils(error.message, 403));
    return next();
},
placeDetails: (req, res, next) => {
    const schema = Joi.object({
        placeId: Joi.string().trim().min(1).max(500).required(),
        sessiontoken: Joi.string().trim().min(1).max(200).required(),
    }).required();
    const { error } = schema.validate(req.query);
    if (error) return next(new errorUtils(error.message, 403));
    return next();
},
```

The `min(3)` on `input` is a server-side backstop for the min-length guard (§3.4 does the same
client-side to cut request volume) — belt-and-braces, since a client bug or a modified/rooted
client could otherwise still spray 1-character queries.

### 2.4 Controller additions: `packages/user/src/routes/address/controller.js`

Next to the existing `geocode` handler:

```js
// Places Autocomplete, proxied so the API key never ships in the APK. sessiontoken is
// opaque here — generated by the client, forwarded to Google unchanged on both this call
// and place-details, discarded by the client after selection/cancel. Always 200 with an
// empty array on any failure (bad input already 403'd by the validator) — search must
// never block the existing drag/PIN/GPS flow.
autocomplete: async (req, res, next) => {
    try {
        const { input, sessiontoken } = req.query;
        const suggestions = await placesUtils.getAutocompleteSuggestions(String(input), String(sessiontoken));
        return res.json({
            msg: suggestions.length ? "Suggestions found" : "No matches found",
            data: { suggestions },
        });
    } catch (error) {
        return next(error);
    }
},

// Resolve a placeId (from an autocomplete suggestion) to coordinates + a label + optional
// viewport, closing out the same session token used for the autocomplete calls that led here.
placeDetails: async (req, res, next) => {
    try {
        const { placeId, sessiontoken } = req.query;
        const place = await placesUtils.getPlaceDetails(String(placeId), String(sessiontoken));
        return res.json({
            msg: place ? "Place located" : "Place not located",
            data: { place },
        });
    } catch (error) {
        return next(error);
    }
},
```

Response shapes:

```
GET /user/address/autocomplete?input=<text>&sessiontoken=<uuid>
200 { msg, data: { suggestions: [ { placeId, primaryText, secondaryText } ] } }
  suggestions is [] on zero-results, Google error, rate-limit, or key/config issue — never
  an error status for these cases (matches geocode?pin=' "never block the form" contract).

GET /user/address/place-details?placeId=<id>&sessiontoken=<uuid>
200 { msg, data: { place: { latitude, longitude, label, viewport } | null } }
  viewport is { northeastLat, northeastLng, southwestLat, southwestLng } | null — present
  when Google's response includes one, used by the Android client to pick jump zoom (§3.5).
  place is null on any failure (same convention as geocode?pin='s `coords: null`).
```

Error handling for genuine Google API errors/rate-limiting: collapsed inside `places.utils.js`
(§2.2) to the same "empty/null" contract as a zero-results response — the controller and the
Android client do not need to distinguish "Google said no matches" from "Google errored" from
"key not configured". This matches the existing `geocode?pin=` philosophy exactly (a `coords:
null` there covers both "not found" and "geocoder off").

### 2.5 Router: `packages/user/src/routes/address/router.js`

```js
// Must be declared before "/:addId" for the same reason "geocode" is (line already
// has this comment above geocode — extend it to cover both new routes).
router.get("/geocode", validator.geocodePincode, controller.geocode);
router.get("/autocomplete", validator.autocomplete, controller.autocomplete);
router.get("/place-details", validator.placeDetails, controller.placeDetails);
```

All three sit above `/:addId`, same reasoning as the existing comment already there.

### 2.6 Rate limiting

The existing `geocode?pin=` endpoint has no dedicated rate limiter (it inherits whatever
app/router-level limiter `packages/user` has globally). Autocomplete is fired on every keystroke
(debounced client-side to 300ms, §3.4) so its natural request rate is meaningfully higher
per user-session than pincode geocode. Recommend a light per-IP limiter, following the
`express-rate-limit` pattern already used in `packages/user/src/routes/auth/router.js` (§ referenced
above) — e.g. 60 requests / 5 min per IP on `/autocomplete` — cheap insurance against a
misbehaving/rooted client bypassing the debounce+min-length client guard, without needing a
phone/session key (there's no stable per-user identifier at this layer beyond the JWT, and IP is
consistent with how the existing `refreshLimiter` is keyed). This is a nice-to-have hardening
step, not a hard blocker — flag for sumit-backend/tejas-services to decide during implementation
whether it lands in this PR or a fast-follow.

### 2.7 Backend files touched/created — summary

| File | Change |
|---|---|
| `packages/shared/config/index.js` | +1 field if separate key provisioned |
| `packages/shared/utils/places.utils.js` | NEW — autocomplete + place-details Google calls |
| `packages/user/src/routes/address/validator.js` | +2 validators |
| `packages/user/src/routes/address/controller.js` | +2 handlers, +require `places.utils` |
| `packages/user/src/routes/address/router.js` | +2 routes |
| `packages/user/__tests__/address.test.js` | +tests (santosh-tester, §5) |
| (optional) `packages/user/src/routes/address/router.js` | +2 rate limiters (§2.6) |

## 3. Android (haper-android)

### 3.1 Current contract — do not widen it

`MapPickerScreen`'s exact current signature must stay unchanged:

```kotlin
MapPickerScreen(initialLatitude, initialLongitude, onConfirm: (lat: Double, lng: Double) -> Unit, onDismiss)
```

Coordinates only, no address text — hosted as a `Dialog` (not a nav destination), called from
`AddEditAddressScreen.kt:758`. This plan does **not** add address text to `onConfirm`'s signature
(see the invariant discussion in §3.3) — prefilling address form fields from a picked place's
`formattedAddress` is explicitly **out of scope** here (a v2 idea), since the existing
device-Geocoder city/state cell (§0) already refreshes correctly on confirm regardless of how the
pin got there.

### 3.2 New Compose components (UI spec, chanchal-designer final — implement as-is)

This section replaces the thinner first-pass spec. Every value below is grounded in real tokens
already used in `MapPickerScreen.kt`, `Color.kt`, `Type.kt`, `Dimens.kt`, `Shadows.kt` — not
generic recommendations.

**Current layout facts (confirmed from the real file, baseline this plan builds on):**
- Back button: 36dp white circle, `mapControlShadow(shape = HaperBrand.cornerMedium, color =
  SurfaceWhite)`, positioned `statusBarsPadding().padding(start = 14.dp, top = 12.dp)`.
- Existing hint chip: `top = 12.dp, start = 62.dp, end = 14.dp` (62dp clears the back button),
  same `mapControlShadow`, text style `HaperType.caption`/`InkPrimary`.
- Pin and "use current location" button both use `AuthFocus` (#E58124, orange) as this screen's
  local accent color — distinct from the app's general green (`GreenAction`).

**Token choice — reject Home screen's search-pill treatment as a direct copy.** Home's
`searchFieldShadow`/`GlassMintSoft` search-looking row uses `sheetLargeCardMax` (21dp radius), but
that's a fake nav-shortcut (whole row is clickable, not a real `TextField`) — wrong precedent for
a REAL typed input here. Use the real form-field tokens instead: `HaperDimens.formFieldHeight`
(50dp), `HaperDimens.inputSlotMin` (17dp radius), `HaperDimens.borderField` (1.4dp),
`HaperType.inputText` (Poppins SemiBold 16sp — the actual live-input text style used app-wide).
Still reuse the `searchFieldShadow` *modifier itself* (just not its 21dp radius value) and the
glass-white fill treatment, for elevation consistency with Home's search affordance.

**Two-row top chrome** (replaces the current single back-button-row layout):
- Row 1 = back button + search field: `Row`, `spacedBy(10.dp)`,
  `padding(start = 14.dp, top = 12.dp, end = 14.dp)`, field `weight(1f)`.
- The existing hint chip does **not** disappear — it moves. While the search field is
  unfocused/empty, the hint chip sits directly below the field, now full-width (14dp/14dp insets —
  no longer needs the 62dp offset since the back button is no longer beside it at that row). While
  the field is focused/typing, the hint chip is **hidden** and the suggestion panel takes its place
  instead. (This is the concrete resolution to the "collision" question the first-pass consult
  left open — no longer a flag, this is the answer.)
- Suggestion panel docks directly under the search field, same left/right insets, `zIndex` above
  the pin, `heightIn(max = 280.dp)` (~4-5 rows) so the GPS FAB and Confirm sheet in the bottom
  third of the screen stay reachable even with the panel open. No dimming scrim behind it — floats
  via `mapControlShadow`-style elevation only, so it doesn't feel like a separate full-screen
  search page.

**Suggestion row**: `Row`, ~56dp effective height, `padding(horizontal = HaperSpacing.scale.x14,
vertical = HaperSpacing.scale.x12)`, `spacedBy(HaperSpacing.scale.x12)`.
- Leading: 32dp circular well, `SurfaceSunken` fill, location icon at 16dp, tint `InkSecondary`
  (deliberately **not** the orange `AuthFocus` accent — that's reserved for "this is the
  chosen/final spot" elsewhere on screen, keeping "candidate suggestion" visually distinct from
  "confirmed selection").
- Primary text `HaperType.body` (Poppins SemiBold 14.5sp) `InkPrimary`, 1 line ellipsis; secondary
  text `HaperType.caption` (Poppins Medium 12.5sp) `InkTertiary`, 1 line ellipsis, `spacedBy(2.dp)`
  below primary.
- Full row clickable (ripple, `role = Role.Button`) as the tap target.
- Divider: 1dp `BorderHairline`, inset to start after the leading icon (32+12=44dp indent), not
  full-bleed — matches how list dividers behave elsewhere in the app.

**States, precise:**
- **Empty** — placeholder "Search locality, landmark, or PIN code", `InkTertiary`. Leading icon =
  generic search glyph tinted `GreenAction` (distinct from the location-pin icon used in results —
  don't reuse the same icon for both).
- **Loading** — trailing icon area shows a 16dp `CircularProgressIndicator(strokeWidth = 2.dp,
  color = GreenAction)` replacing the clear "✕" temporarily. Keep showing the *previous* result set
  while loading rather than flashing empty — swap only when the new list arrives (avoids layout
  flicker on every keystroke).
- **Results** — quick ~120ms fade only, no bouncier animation (list changes every keystroke;
  anything punchier reads as noisy).
- **NoResults** — styled as a single row in the SAME panel container (not a separate red banner):
  32dp `SurfaceSunken` well with `EmptyIconFg`-tint icon, primary line "Couldn't find that here"
  (`InkPrimary`), secondary line "Coverage can be patchy in smaller localities — drag the map to
  your exact spot instead." (`InkSecondary`, up to 2 lines). No red, no exclamation, no "Try again"
  CTA — there's nothing to retry, it's genuinely not in Google's index.
- **Error** — must be visually distinct from NoResults: amber `Warning`/`WarningSurface`/
  `WarningText` channel (**not** `Danger` red — this is a connectivity issue, not a destructive
  failure), small `WifiOff`/`ErrorOutline` icon tinted `Warning`, text "Couldn't load suggestions —
  check your connection", inline "Retry" text-button (`GreenAction`, `HaperType.labelLarge`) that
  retries the last query as-is. This is the one state where retry makes sense — it specifically
  distinguishes "internet dropped" (retry helps) from "village genuinely not covered" (retry is
  pointless) for a rural user.

**Selection/handoff sequence, precise** (replaces the current plan's generic Snackbar
recommendation entirely — do not implement a Snackbar for this):
1. Keyboard dismisses immediately via `LocalFocusManager.clearFocus()`.
2. Suggestion panel fades+shrinks ~150ms using the SAME `FastOutSlowInEasing` the pin's existing
   lift animation already uses (visual family consistency, not a new easing curve).
3. Search field collapses from active/typing state into a compact "selected" **chip** state
   showing the tapped suggestion's short primary text (e.g. "Near Ram Mandir Road") with a small
   trailing "✕" to clear and search again — do not just revert the field to blank/placeholder; the
   chip is the confirmation that the search "did something."
4. Camera animates via the existing `jumpTo` (refined per §3.5), triggering the existing pin
   bounce for free.
5. Once the camera settles, the hint chip reappears below the field with a **temporary copy
   override** for ~3 seconds — "Found it — drag to fine-tune your exact spot" — then reverts to
   the standard "Move the map to place the pin on your exact gate / door." copy (same visual
   treatment, just a temporary text swap, no new component).

This hint-chip-copy-override mechanism replaces the old Snackbar idea because it reuses an
existing component instead of introducing a new transient one, and it ties directly into the hint
chip's role/position already established above — it is strictly more specific and lower-risk than
a generic Snackbar.

**Debounce**: 300ms, 3-character minimum (unchanged from first pass; second pass confirms 300ms
as the concrete recommendation rather than the wider 300-400ms range).

**Back-button/system-back handling**: on system back, first collapse the panel/clear focus; second
back press exits the picker as today. (See §3.6 for the exact mechanism — arijit-frontend-arch and
chanchal-designer converged on this requirement independently in their second passes, which is
worth noting as corroboration.)

**Clear button**: `Icons.Default.Close`, 16dp, `InkTertiary`, appears in the trailing slot once
text is non-empty (replacing the loading spinner once loaded). Clearing text closes the panel but
does **not** move the camera back — the map stays wherever it last was.

**Disabled state**: none needed — the field never blocks input (unlike GPS's permission gate). If
the Places key/network is entirely unavailable at screen load, treat every query as the Error
state rather than pre-emptively greying out the field with no explanation.

**Accessibility** (new — currently entirely missing from the plan; add as an implementation
checklist item):
- Field needs `contentDescription` "Search for a location" for TalkBack.
- Each suggestion row needs a combined content description reading primary+secondary text
  together.
- NoResults/Error panels need `liveRegion = polite` since they replace content without a focus
  change.
- Touch targets already meet 48dp via the padding choices above.
- Verify `InkPrimary`-on-`SurfaceWhite` and `WarningText`-on-`WarningSurface` contrast (both
  already used elsewhere so should already pass, but spot-check in Compose's contrast tooling if
  any NEW color pairing beyond what's listed here gets introduced during implementation).

**Reduce-motion**: the panel fade and the field's collapse-to-chip transition should both respect
the SAME `rememberReduceMotionEnabled()` check already used elsewhere in this file for the pin's
animations (snap instantly instead of fading when enabled) — extend that existing helper's usage,
do not add a second reduce-motion mechanism.

**Component inventory** (supersedes the single-file table entry in the original draft): the
composables likely belong together in one file, `AddressSearchBar.kt`:
- `MapSearchField` — the field itself (states: empty / typing / loading / selected-chip).
- `PlacesSuggestionPanel` — the container (loading / results / no-results / error).
- `PlacesSuggestionRow` — one suggestion row.

Keep all three in `AddressSearchBar.kt` unless the implementing engineer finds it unwieldy — this
is engineer's discretion, not a hard requirement to split into 3 files.

### 3.3 The invariant this feature must not violate (SEVERITY HIGH — first-class requirement)

`LocationSelection` in `AddEditAddressScreen.kt:176-346` enforces: only a GPS fix or an explicit
map Confirm sets `isCoordinateConfirmed`, and **only** a confirmed coordinate may be saved —
specifically so someone adding a remote family member's address can't accidentally save a vague
guessed centroid as if it were a precise doorstep location.

A Places autocomplete suggestion for a village is the **same class of object** as a PIN-code
centroid — an area guess, not a doorstep pin. Therefore, non-negotiably:

- Selecting a suggestion must call `jumpTo(latLng)` **only**. It must never call `onConfirm`, must
  never reach `confirmPrecise`, must never close the picker dialog automatically.
- `MapPickerScreen`'s `onConfirm(lat, lng)` signature stays byte-for-byte identical to today (see
  §3.1) — no address text is threaded through it for this feature.
- This is a named "Do-Not-Break" item, and it has a concrete test: after selecting a suggestion,
  `isCoordinateConfirmed` must remain `false` until the user does an actual GPS fix or taps
  Confirm — same rule as today's PIN-code-guess behavior, not a new/different one (see §4(a) and
  §5's Android test #1).

### 3.4 Networking: go through the normal authenticated client, never call Google directly

`NetworkModule.kt:214-215` — the app's shared OkHttp client has `buildAuthInterceptor()` attached
(adds `Authorization: Bearer <haper token>`, `x-device-id`, and user-location headers to every
request on that client) plus a `ConnectionRetryInterceptor` (retries GETs on
`SocketTimeoutException`).

Calling the new `/autocomplete` / `/place-details` **backend** endpoints through the normal
`ApiService`/main Retrofit client is correct and expected — these are calls to Haper's own backend
(not to Google directly), so the auth header being attached is just another authenticated Haper
API call, same as everything else this app does.

**Flag explicitly, for future engineers**: if anyone is ever tempted to bypass the backend proxy
and call `googleapis.com` directly from Android (violating the backend-proxy decision in §0), they
must not reuse the shared client — this note exists specifically to block that regression path for
an engineer who doesn't re-read the architecture decision later. Also note: the
`ConnectionRetryInterceptor`'s auto-retry-on-timeout, if it ever applied to a per-request-billed
call, multiplies cost per retry — this is the same reasoning already cited in §2.2 for why
`places.utils.js`'s own axios calls get no retry logic either. Keep both sides of this call chain
retry-free by design.

### 3.5 Camera jump quality (refines `jumpTo`, not a replacement)

`jumpTo` currently always does `cameraPositionState.animate(newLatLngZoom(target, 17f))`. Two
refinements on top of "just reuse `jumpTo`":

- **Distance-aware motion**: a long-distance jump (current map center to the searched place is
  roughly >50km) should use an instant `move()` rather than an animated fly-over, which otherwise
  looks janky/slow for a large pan. Below that threshold, keep the existing animate-based jump.
- **Zoom level**: 17 over-zooms into meaningless detail for a village/locality-level suggestion
  (as opposed to a precise street address). Decision: use the place-details viewport if Google
  returned one (§2.2/§2.4 — `place.viewport`) via `newLatLngBounds`, so the zoom matches the
  actual size of the selected area; if no viewport is available, default to zoom **15** rather than
  17, since 15 is safer for locality-level results than the tighter zoom used for a GPS fix/manual
  drag.
- Either way, the jump still sets `cameraPositionState.isMoving = true`, which correctly fires the
  existing pin lift/settle bounce animation for free — this part of the original plan was already
  correct; the refinement above is only about which zoom/motion the jump itself uses.

### 3.6 Interaction details: IME overlap and back-button ordering (SEVERITY MEDIUM — implementation requirements, not QA notes)

**IME/keyboard overlap.** `MapPickerScreen` is hosted in a `Dialog` with
`usePlatformDefaultWidth = false`. Dialog windows do not inherit the Activity's soft-input/IME
behavior by default, and the existing bottom Confirm sheet uses `navigationBarsPadding()`, not
`imePadding()`. Predicted real bug: on a shorter device, the keyboard will cover the suggestion
panel and/or the Confirm button when the search field is focused. Required implementation:
- Apply `imePadding()` to the search/panel container.
- Set `decorFitsSystemWindows = false` in the `Dialog`'s `DialogProperties`.
- Verify on a small/short device as part of manual QA (§6, end-to-end QA step).

**Back-button ordering.** Today, Back dismisses the picker via `onDismiss` immediately, which
abandons any queued save (`isSavePending`). With a focused/open suggestion panel, Back should
first close the panel/clear focus — not immediately exit the picker. Required implementation: add
`BackHandler(enabled = dropdownVisible) { /* collapse panel, clear focus */ }` positioned above/
before the dialog's own dismiss handling, so a second Back press (once the panel is already
closed) is what actually exits the picker.

### 3.7 Sequence-number guard for late autocomplete responses

`LocationSelection.beginGpsRequest()` / `applyGpsResult(requestId, ...)` in
`AddEditAddressScreen.kt:249-266` already exists specifically so a late-arriving async response
can't stomp newer state (e.g., a slow GPS fix landing after a newer one). The debounce +
cancel-in-flight-coroutine approach in §3.9 is good, but should also adopt this same
request-id/sequence-number guard shape for the autocomplete suggestions list: tag each outgoing
`/autocomplete` call with an incrementing request id, and only apply a response to
`searchSuggestions`/`searchState` if its request id is still the latest one issued. This ensures a
slow "ram" query response can never overwrite a faster "rampur" query's already-rendered results
if coroutine cancellation timing is imperfect. This reuses the existing pattern by name — it is
not a new invented mechanism.

### 3.8 Session-token lifecycle — as a small standalone class

This is the part explicitly called out as needing to be *verifiably* correct — get this wrong and
autocomplete silently falls off session pricing onto far costlier per-request billing.

**Lifecycle rules (unchanged from first pass):**
- **Create**: generate a new `UUID.randomUUID().toString()` the moment the search box gains focus
  OR the first keystroke is typed (whichever fires first) — lazily, only when a search session
  actually starts, never eagerly on screen open.
- **Reuse**: the SAME token string is sent as `sessiontoken` on every `/autocomplete` call for that
  session (every keystroke after the debounce, however many), AND the single `/place-details` call
  when a suggestion is tapped.
- **Discard**: the token is cleared immediately after a successful `place-details` fetch (selection
  completes the session), OR the user clears the search box / backs out of the map picker without
  selecting anything, OR the search box loses focus with empty text. Next focus/keystroke after a
  discard generates a brand-new token — never reuse a discarded one.
- **Min-length guard**: no `/autocomplete` call fires below 3 characters (mirrors the server-side
  `min(3)` validator in §2.3).

**Implementation shape — refined from first pass.** Model this as a small, plain state-holder
class, `PlaceSearchSession`, in the SAME idiom as the existing `LocationSelection`/
`AddressSaveFlow` classes already in `AddEditAddressScreen.kt` — rather than loose `var`/`Job`
fields directly in the ViewModel:

```kotlin
class PlaceSearchSession {
    var token: String? = null
        private set

    fun begin(): String = token ?: UUID.randomUUID().toString().also { token = it }
    fun consume(): String? = token // read without mutating, for the place-details call
    fun abandon() { token = null }
}
```

This **replaces** the earlier "`private var sessionToken: String? = null` in `AddressViewModel`"
approach from the first draft — the lifecycle rules above are unchanged, only the shape of the
holder changes. Reasoning: this makes it a small, pure-Kotlin, no-Android-deps unit that can be
unit-tested in isolation exactly like `LocationSelection` already is (mockk/turbine/junit already
in the test config) — which is the single best guard against the silent session-token billing
regression this whole feature is worried about. It should get its own unit test file mirroring
however `LocationSelection` is tested today (see §5, Android test #1).

### 3.9 Process death handling

`AddressSaveFlow` is `remember` (not `rememberSaveable`) at line ~469, meaning the picker already
closes on process death while `LocationSelection` survives it. The new search query state and the
`PlaceSearchSession` instance must stay on the **same side** of that line — transient,
`remember`-scoped, never `rememberSaveable`. Restoring a stale session token into a re-opened
picker would itself be a session-boundary bug (reusing a token across what Google considers two
separate sessions).

### 3.10 ViewModel wiring: `AddressViewModel.kt`

Add alongside the existing `geocodePincode` function (same file, same "best-effort, never blocks
the form" style already established there):

```kotlin
var searchQuery by mutableStateOf("")
var searchSuggestions by mutableStateOf<List<PlaceSuggestion>>(emptyList())
var searchState by mutableStateOf<AddressSearchState>(AddressSearchState.Idle)
private val searchSession = PlaceSearchSession()
private var searchJob: Job? = null
private var latestRequestId = 0 // sequence-number guard, §3.7

fun onSearchQueryChange(query: String) {
    searchQuery = query
    searchJob?.cancel()
    if (query.length < 3) {
        searchSuggestions = emptyList()
        searchState = AddressSearchState.Idle
        return
    }
    searchJob = viewModelScope.launch {
        delay(300) // debounce, §3.2
        runAutocomplete(query)
    }
}

private suspend fun runAutocomplete(query: String) {
    val requestId = ++latestRequestId
    val token = searchSession.begin()
    searchState = AddressSearchState.Loading
    try {
        val response = api.getAutocomplete(query, token)
        if (requestId != latestRequestId) return // a newer query has since superseded this one
        val suggestions = response.body()?.data?.suggestions ?: emptyList()
        searchSuggestions = suggestions
        searchState = if (response.isSuccessful) {
            if (suggestions.isEmpty()) AddressSearchState.NoResults else AddressSearchState.Results
        } else {
            AddressSearchState.Error
        }
    } catch (_: Exception) {
        if (requestId == latestRequestId) searchState = AddressSearchState.Error
    }
}

fun selectSuggestion(suggestion: PlaceSuggestion, onResult: (Double, Double, PlaceViewport?) -> Unit) {
    val token = searchSession.consume()
    viewModelScope.launch {
        try {
            val response = api.getPlaceDetails(suggestion.placeId, token ?: "")
            val place = response.body()?.data?.place
            if (response.isSuccessful && place != null) {
                onResult(place.latitude, place.longitude, place.viewport) // jumpTo ONLY, never onConfirm — §3.3
            }
        } catch (_: Exception) {
            // best-effort: panel just closes, user can drag/retry
        } finally {
            discardSearchSession()
        }
    }
}

fun discardSearchSession() {
    searchSession.abandon()
    searchJob?.cancel()
    searchQuery = ""
    searchSuggestions = emptyList()
    searchState = AddressSearchState.Idle
}
```

`clearAll()` (existing function, line 232) should also call `discardSearchSession()` so leaving
the address flow entirely never leaks a live session token into a later, unrelated session.

Note the deliberate signature of `selectSuggestion`'s callback: `(Double, Double, PlaceViewport?) ->
Unit`, i.e. it drives `jumpTo(...)` only (§3.5) — it is not, and must never become, a route to
`onConfirm`.

### 3.11 API layer: `ApiService.kt`

```kotlin
@GET("user/address/autocomplete")
suspend fun getAutocomplete(
    @Query("input") input: String,
    @Query("sessiontoken") sessionToken: String
): Response<BaseResponse<PlaceAutocompleteResponse>>

@GET("user/address/place-details")
suspend fun getPlaceDetails(
    @Query("placeId") placeId: String,
    @Query("sessiontoken") sessionToken: String
): Response<BaseResponse<PlaceDetailsResponse>>
```

Placed next to the existing `getPincodeGeocode` (line ~125), same section/comment block. Both
calls go through the existing shared Retrofit/OkHttp client (§3.4) — no special-cased client.

### 3.12 Models: `AddressModels.kt`

```kotlin
// GET /user/address/autocomplete?input=&sessiontoken= — suggestions is empty on zero-results,
// Google error, or rate-limit; the search UI shows its NoResults/Error state accordingly.
data class PlaceAutocompleteResponse(
    val suggestions: List<PlaceSuggestion> = emptyList()
)

data class PlaceSuggestion(
    val placeId: String = "",
    val primaryText: String = "",
    val secondaryText: String = ""
)

// GET /user/address/place-details?placeId=&sessiontoken= — place is null when Google couldn't
// resolve the id (or the geocoder is off); the caller keeps the current pin, same convention as
// PincodeGeocodeResponse.coords.
data class PlaceDetailsResponse(
    val place: PlaceDetails? = null
)

data class PlaceDetails(
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val label: String = "",
    val viewport: PlaceViewport? = null // used to pick jump zoom, §3.5; null → default zoom 15
)

data class PlaceViewport(
    val northeastLat: Double = 0.0,
    val northeastLng: Double = 0.0,
    val southwestLat: Double = 0.0,
    val southwestLng: Double = 0.0
)
```

### 3.13 MapPickerScreen.kt wiring

- `MapPickerScreen` needs the `AddressViewModel` passed in (or created via
  `viewModel()`/hoisted from the caller — check how `AddEditAddressScreen.kt` currently
  instantiates/passes `addressVM` at line ~758's `MapPickerScreen(...)` call site and follow the
  same pattern, so this doesn't introduce a second, disconnected ViewModel instance).
- Add the new two-row top chrome (§3.2) as new children of the existing root `Box` (after the
  `GoogleMap` call, so it visually sits above the map — `Box` children later in source order draw
  on top). This replaces the current single back-button row and repositions the hint chip per
  §3.2, rather than being a pure append.
- On suggestion selection, call:
  ```kotlin
  viewModel.selectSuggestion(suggestion) { lat, lng, viewport ->
      jumpTo(LatLng(lat, lng), viewport) // §3.5 — jumpTo ONLY, never onConfirm
  }
  ```
- Update `jumpTo` per §3.5 to accept an optional viewport and pick distance-aware motion + zoom
  accordingly; existing callers (recenter button, GPS fix) pass `viewport = null` and keep their
  current zoom-17 animated behavior unchanged.
- Add the `BackHandler` from §3.6 above/before the dialog's existing dismiss handling.
- Apply `imePadding()` / `decorFitsSystemWindows = false` per §3.6.

### 3.14 Analytics / instrumentation (new — currently missing from the plan)

Given known/suspected patchy rural-Bihar coverage, add basic analytics events so this can be
measured post-launch rather than guessed at, following whatever `AnalyticsTracker`/equivalent
pattern this app already uses elsewhere (check for the existing tracker class referenced in prior
client work and follow its existing call pattern rather than inventing a new one):

- `place_search_opened` — search field gains focus for the first time in a picker session.
- `place_search_zero_results` — include query length, to distinguish "typo" from "genuinely not
  covered."
- `place_search_selected` — a suggestion was tapped.
- `map_confirmed_without_search` — baseline for comparison: Confirm was tapped in a picker session
  where the search field was never used.

If zero-results dominates in practice, the backend's fail-soft design means the feature can be
quietly killed (return empty always, §2.2) with zero app release needed — these events are what
would tell us that.

### 3.15 Android files touched/created — summary

| File | Change |
|---|---|
| `app/src/main/java/com/bheldi/ui/screens/address/AddressSearchBar.kt` | NEW — `MapSearchField` + `PlacesSuggestionPanel` + `PlacesSuggestionRow` |
| `app/src/main/java/com/bheldi/ui/screens/address/MapPickerScreen.kt` | wire in search chrome, reposition hint chip, `jumpTo` distance/zoom refinement, `BackHandler`, IME padding |
| `app/src/main/java/com/bheldi/ui/screens/address/AddressViewModel.kt` | +search state, +`PlaceSearchSession`, +sequence-number guard, +2 functions |
| `app/src/main/java/com/bheldi/data/api/ApiService.kt` | +2 endpoints |
| `app/src/main/java/com/bheldi/data/model/AddressModels.kt` | +5 data classes (incl. `PlaceViewport`) |
| `app/src/main/java/com/bheldi/util/analytics/...` (existing tracker) | +4 events, §3.14 |

No new Gradle dependencies (confirmed by arijit's design — plain Retrofit + Compose, both already
present).

## 4. Acceptance criteria

(a) **Invariant preservation — a suggestion pick must never auto-confirm a location.** (First-class
criterion, per §3.3.) After `onSuggestionSelected` fires, `isCoordinateConfirmed` in
`LocationSelection` must remain `false` until the user performs an actual GPS fix or taps Confirm —
identical to today's PIN-code-guess behavior, never a new/looser rule for search. Concrete test:
select a suggestion, assert `onConfirm`/`confirmPrecise` were never invoked and the picker dialog
is still open; only a subsequent explicit Confirm tap may set `isCoordinateConfirmed = true`.

(b) **Session-token correctness, verifiable.** Add a debug-only log line in
`runAutocomplete`/`selectSuggestion` (e.g. `Log.d("PlacesSearch", "token=$token
event=autocomplete|details")`) so a manual test session can grep logcat and confirm exactly one
token value spans N keystroke calls + 1 details call, then a fresh token appears on the next
search. santosh-tester should add a unit test on `PlaceSearchSession` in isolation (mirroring
however `LocationSelection` is unit-tested today, §3.8) plus a `AddressViewModel` test that types
multiple characters (advancing a `TestDispatcher`/`turbine` past the debounce) and asserts
`getAutocomplete` was invoked multiple times with the SAME `sessionToken` argument, then asserts
`getPlaceDetails` received that same token, and that a subsequent new search after
`discardSearchSession()` uses a different token.

(c) **Graceful degradation**, never blocks drag/PIN/GPS:
- No results → friendly `NoResults` copy, search box stays usable, map/drag untouched.
- Network/API error → `Error` copy with Retry, search box stays enabled (not disabled), user can
  still drag or tap GPS FAB.
- Rural/no-coverage area (Google has nothing) → same as no-results; this is expected and by
  design, not a bug — hence the copy explicitly pointing at drag-to-set instead of implying
  something's broken.

(d) **No regression to PIN-code geocode or GPS capture.** `geocodePincode()` (existing
ViewModel function) and `useCurrentLocation()`/`recenterTapped()` (existing MapPickerScreen
functions) are untouched by this change — verify by re-running the existing manual/automated
address-add flows for both paths after integration, and confirm `AddEditAddressScreen.kt`'s pin
autofill-on-6-digits flow (line ~580) still fires identically. Also confirm the existing
client-side reverse-geocode (`AddEditAddressScreen.kt:520-537`) still fires on every confirmed
coordinate change exactly as today (§0) — this feature adds no new reverse-geocode call.

(e) **Drag-to-fine-tune after a suggestion pick works identically to today.** After
`onSuggestionSelected` → `jumpTo(...)`, the map is a completely normal, still-draggable
`GoogleMap` in the same `cameraPositionState` — dragging, the pin lift/settle animation
(`isDragging` derived off `cameraPositionState.isMoving`, lines ~192-235), and the "Confirm
location" button all continue to read `cameraPositionState.position.target` exactly as they do
for a manually-dragged or GPS-jumped pin. No code path treats a "search-selected" pin differently
from a dragged one — verify no new flag was accidentally threaded through that would gate/skip
drag handling post-selection.

(f) **IME and back-button behavior** (§3.6): on a short/small device, the keyboard never covers
the suggestion panel or the Confirm button while the search field is focused. A single Back press
with the panel open only closes the panel (keeps focus/dismiss local); a second Back press exits
the picker as today.

## 5. Test plan (santosh-tester)

Backend (`packages/user/__tests__/address.test.js`, in-memory Mongo only per this project's
testing rule — Google calls must be mocked/stubbed, never hit the real API in CI):
1. `GET /autocomplete` with `input` < 3 chars → 403 (validator).
2. `GET /autocomplete` missing `sessiontoken` → 403 (validator).
3. `GET /autocomplete` happy path (mock `placesUtils.getAutocompleteSuggestions` to return a
   fixture list) → 200, `data.suggestions` matches fixture.
4. `GET /autocomplete` with mocked Google zero-results/error → 200, `data.suggestions: []` (never
   a 4xx/5xx from Google's own failure states).
5. `GET /place-details` missing `placeId`/`sessiontoken` → 403.
6. `GET /place-details` happy path (mocked, including a `viewport`) → 200, `data.place` matches
   fixture including `viewport`.
7. `GET /place-details` with mocked Google failure → 200, `data.place: null`.
8. Assert the `sessiontoken` query param is forwarded byte-for-byte into the outbound Google
   call's params in both endpoints (mock `axios.get`/the utils module and inspect call args) —
   this is the server-side half of session-token correctness.

Android (instrumented/unit, Compose + ViewModel):
1. **Session-token reuse**: unit-test `PlaceSearchSession` in isolation (begin/consume/abandon,
   mirroring `LocationSelection`'s existing test style) — then, at the ViewModel level, type 3+
   chars across several debounced calls → same token on every `/autocomplete` call; select a
   suggestion → same token on `/place-details`; next search after selection → a NEW token (per
   §4(b)).
2. **Invariant check (§4(a))**: select a suggestion and assert `onConfirm`/`confirmPrecise` are
   never invoked and `isCoordinateConfirmed` stays `false`; only an explicit Confirm tap afterward
   flips it to `true`.
3. **Debounce**: rapid keystrokes within the 300ms debounce window fire only ONE network call, not
   one per keystroke.
4. **Min-length guard**: typing 1-2 characters never calls `/autocomplete`.
5. **Sequence-number guard**: simulate a slow response for query "ram" arriving after a fast
   response for a later query "rampur" — assert the final rendered `searchSuggestions`/
   `searchState` reflects "rampur", not the late "ram" response (§3.7).
6. **No-results state**: mocked empty response → `NoResults` UI shown, search box still editable,
   Confirm/drag/GPS still function.
7. **Network/API error state**: mocked failure/exception → `Error` UI shown with Retry, same
   still-functional guarantee; tapping Retry re-issues the last query.
8. **Selection → map animation**: selecting a suggestion calls `jumpTo` with the returned
   lat/lng/viewport (assert via a fake/spy on the camera state or an integration-level check), and
   the pin remains draggable afterward (regression check for §4(e)).
9. **Camera jump distance/zoom logic (§3.5)**: given a target >50km from the current camera
   center, assert `jumpTo` uses instant `move()` not `animate()`; given a target with a viewport,
   assert `newLatLngBounds` is used; given no viewport, assert zoom defaults to 15, not 17.
10. **IME/back-button (§3.6/§4(f))**: with the suggestion panel open and the field focused,
    simulate Back → panel closes/focus clears, picker stays open; a second Back → picker exits via
    `onDismiss`.
11. **Regression — PIN geocode**: existing 6-digit pincode autofill flow in
    `AddEditAddressScreen.kt` still calls `geocodePincode` and updates the pin, unaffected by the
    new search bar's presence.
12. **Regression — GPS**: `recenterTapped()`/`useCurrentLocation()` still work with the search bar
    mounted (no focus-stealing, no z-order/touch-target conflict with the repositioned hint chip).
13. **Session discard on abandonment**: focusing the search box, typing, then backing out of
    `MapPickerScreen` without selecting → session token cleared (verify via the debug log or a
    `PlaceSearchSession`-level assertion that `token` is null after `clearAll()`/screen dispose).
14. **Process death**: kill/restore the process with the picker open and a live search session →
    on restore, the search query and session token are gone (transient, `remember`-scoped) while
    `LocationSelection`'s existing state survives as it does today (§3.9).

## 6. Effort & sequencing estimate

1. **anuj-devops key provisioning** (§1) — ~0.5 day (mostly waiting on Google Cloud Console
   propagation + Parameter Store + dev redeploy). Sequenced FIRST; blocks backend testing but not
   backend coding.
2. **Backend implementation** (§2) — ~1-1.5 days (sumit-backend/tejas-services): new util file
   (now including viewport in the field mask/response shape), validator/controller/router wiring,
   optional rate limiter. Can be coded in parallel with step 1, but needs the real key to test
   end-to-end against Google.
3. **Backend tests** (§5, santosh-tester) — ~0.5 day, can start once controller/validator
   contracts are stable (fixtures don't need the real key).
4. **Android implementation** (§3, siddhart-android) — ~3-3.5 days (up from the first draft's
   2-2.5, reflecting the added scope from the second-pass findings): new `AddressSearchBar.kt`
   (3 composables, states/spec, §3.2) (~1 day); ViewModel `PlaceSearchSession` class +
   sequence-number guard + debounce wiring (~0.75 day, up from 0.5 to account for the class
   extraction and its own unit tests' scaffolding); API/model plumbing incl. `PlaceViewport`
   (~0.5 day); `MapPickerScreen` integration — two-row chrome, hint-chip repositioning, `jumpTo`
   distance/zoom refinement, `BackHandler`, IME padding — plus manual verification against real
   device sensor/map/keyboard behavior (~1 day, up from 0.5 to cover the IME and back-button work).
5. **Android tests** (§5, santosh-tester) — ~1.25 days (up from 1), covering the additional
   invariant, sequence-guard, camera-jump-logic, and IME/back-button cases.
6. **End-to-end manual QA** against dev backend (rural-Bihar-locality spot check, since that's the
   known coverage gap driving the "additive, never replacing drag" requirement; plus explicit
   short/small-device IME check per §3.6) — ~0.5 day.
7. **Test guide update**: per this project's standing rule, add/update a
   `haper-misc/test-*.md` walkthrough for this feature in the same session/PR the code lands in
   (e.g. `haper-misc/test-address-search-autocomplete.md`) — ✅/❌ steps for search, selection,
   no-results, error+retry, invariant (no auto-confirm), IME/back-button, and the three regression
   paths (PIN, GPS, drag-after-select).

Total: roughly **6-7 working days** end to end (up from the first draft's 5-6, reflecting the
additional HIGH/MEDIUM severity implementation items and the deeper UI spec), with step 1 (devops)
able to run fully in parallel with the start of step 2.

## 7. Open questions for the user

1. **Key provisioning choice**: confirm the recommendation in §1 (separate
   `GOOGLE_PLACES_AUTOCOMPLETE_API_KEY` vs. broadening the existing `GOOGLE_PLACES_API_KEY`'s
   restriction) before anuj-devops proceeds — this plan defaults to "separate key" but it's your
   call since it's a minor ongoing-ops tradeoff either way.
2. **Rate limiter (§2.6)**: land it in this same PR, or fast-follow? Not a blocker either way,
   flagging so it doesn't get silently dropped.
3. **Viewport field in place-details (§2.2/§3.5)**: this plan now requests `geometry/viewport` in
   addition to `geometry,formatted_address,name` so the client can pick a sensible jump zoom for
   locality-level results. Confirm this is acceptable (it stays within the Basic Data SKU, so no
   cost-tier change) — the alternative is to skip viewport and always default to zoom 15 for
   search-originated jumps, which is simpler but less precise for larger areas.
4. Per this project's git workflow (currently direct-to-dev): should this land as one combined
   backend+Android commit sequence on `dev`, or backend first (merged/verified against dev) then
   Android in a follow-up push? Recommend backend first so Android can be manually tested against
   a live dev endpoint rather than mocks throughout.

---
Consult sources incorporated: arijit-frontend-arch (client architecture — backend proxy, session
token ownership, zero new deps; second pass — invariant-preservation risk, shared-OkHttp-client
risk, camera jump quality, sequence-number guard, session-token-as-class refinement, process-death
handling, all grounded in a line-by-line read of `MapPickerScreen.kt`, `AddEditAddressScreen.kt`,
`AddressViewModel.kt`, `NetworkModule.kt`), chanchal-designer (UI spec — placement, states,
interaction, debounce timing; second pass — exact token-grounded layout spec, selection/handoff
sequence, accessibility and reduce-motion requirements, all grounded in a line-by-line read of
`MapPickerScreen.kt`, `HomeScreen.kt`, `Color.kt`, `Type.kt`, `Dimens.kt`, `Shadows.kt`).
anuj-devops prerequisite derived from the existing dev-environment fact (`GOOGLE_PLACES_API_KEY`
is Geocoding-API-restricted today, per project memory `reference_geocoding_google_only.md`) plus
this plan's own recommendation on how to resolve it.
