Status: APPROVED 2026-08-18, build starting

# Plan: stop wrong-store order routing (bug-prevention, Android-led)

## Decisions made at approval

1. **Fail-closed UX over neutral browse**: Users without a resolvable location see "set your location" screen with no catalog, rather than a browse-only catalog. This increases friction intentionally but closes the exploit surface.

2. **Alerting deferred; ship structured logs now**: Backend will emit structured logs with distance + which store should have served. Real alerting integration (Grafana, on-call hooks) is an explicit follow-up, not in this delivery.

3. **Enforcement stays measure-only for 2 weeks**: `ENFORCE_ADDRESS_SERVICEABILITY` flag stays off. After 2 weeks of real mismatch data in prod, a separate decision will be made on surgical enforcement. This delivery is bug-prevention only.

4. **Web end-to-end fix is a follow-up**: Web client changes are out of scope. The gap is stated explicitly in risks so "this can't happen again" isn't overpromised.

---

## Trigger incidents

Two real orders confirmed via local prod-dump spot check (read-only, not a live DB query):
- **#HP219712748**: address had valid coordinates 0.15km from store "Haper Mart", but order was routed to "Haper - Bhagwan Bazar" 24.5km away. Root cause: login-time race between two unsynchronized async resolution triggers (MainActivity.kt) plus an 8-second watchdog that "invents" a store rather than failing safe.
- **#HP245512766**: delivery address had ZERO saved coordinates (legacy address, pre-dates coordinate capture). App fell through address→GPS→hardcoded fallback chain, landing on the same hardcoded emergency coordinate (25.7811, 84.7274) which, since 2026-07-26, sits 0.4km from "Haper - Bhagwan Bazar" — so the "safe" fallback now confidently resolves to a real, wrong store.

## New findings from planning/verification pass

1. `haper-android/app/src/main/java/com/bheldi/ui/screens/cart/CartViewModel.kt:145-158`, `ensureStoreId()`: if store id is blank, "Add to cart" silently resolves one itself from the same bad ambient coordinates — a 5th resolution site that would defeat a naive fail-closed fix if not also covered.

2. `haper-backend/packages/user/src/routes/store/controller.js:105,160-176`: if no store serves a point and `DEFAULT_STORE_ID` is configured, the endpoint returns a store anyway; even when a real match is found, it appends the default store to the picker list. Whether `DEFAULT_STORE_ID` is set in dev/prod is unknown — must be checked first (Step 0).

3. `haper-android/app/src/main/java/com/bheldi/util/AppEnvironment.kt:16-21`: comment says "All stores are in Bihar, so this coordinate never resolves a store on its own" — true when written (one store), false since 2026-07-26 (second store created 0.4km away). This is the root-cause sentence.

4. Backend guard already skips coordinate-less addresses and is fail-open on any error (`order/controller.js:551-577`). The scheduled-order mirror (`:988-1003`) is missing the shadow-log line entirely — scheduled-order mismatches are currently invisible.

5. Current Android version in prod: 2.0.4/build46 (both incident orders); latest is 2.0.5/build47. A `forceUpdate` mechanism exists at `packages/user/src/routes/config/controller.js:62-84`.

## Goal

An order must never be created against a store that cannot deliver to the chosen address. Fix the client to fail closed (say "I don't know where you are") instead of guessing, remove every path that invents an answer, and make the backend's existing safety net observable.

## Acceptance criteria

- Fresh install, location denied, not logged in → "choose your location" state, no catalog, no `x-store-id` sent.
- Fresh install, denied, logged in with an address that HAS coordinates → resolves to the store serving that address.
- Fresh install, denied, logged in with addresses that have NO coordinates → prompts for location, no silent store selection.
- Network throttled/timeout during cold start → loading ends within watchdog window with a retry state, never a resolved store.
- Simulated login race (address fetch resolves after GPS path) → address-derived store wins, every time, 10/10 attempts.
- "Add to cart" with no store resolved → routes to location prompt, does not silently resolve a store.
- Existing install with poisoned prefs (retired fallback coordinate persisted) → cleared on first launch of new build.
- No `AppEnvironment.defaultLatitude/Longitude` read remains as an INPUT to store resolution (may remain as request headers only).
- Backend: address-serviceability mismatch produces a structured/countable signal, not just a console line; scheduled orders log it too.
- Backend: zero change in accept/reject behavior for any existing flow this phase (enforcement stays off).
- `./gradlew assembleDebug` passes; backend package jest (in-memory Mongo) green.

**Out of scope:** manually fixing either trigger order; finishing web/iOS client feature end-to-end (follow-up only); flipping `ENFORCE_ADDRESS_SERVICEABILITY=true` globally; backfilling legacy coordinates.

## Design

- **A. "Unknown location" must be representable.** Delete `FALLBACK_LAT/LNG` entirely; `AppEnvironment.defaultLatitude/Longitude` become nullable `String?`. When null, omit location headers and `x-store-id`; render the location-required state instead of a catalog.

- **B. Explicit-argument resolution + generation token.** `getNearestStore()` gains optional `lat`/`lng` query params (additive, backward compatible — old clients unaffected). Every resolution attempt increments a monotonic counter; stale-generation responses are discarded. This is what kills the whole bug class, not just the two known triggers.

- **C. Watchdog only ends the spinner.** Never produces an answer — sets retry state, cancels loading.

- Checkout does NOT re-resolve client-side (would add a second racy resolution on the most expensive path); if `storeId` is blank, "Place order" is disabled with the location prompt. Server-side guard remains the authority for the money-adjacent decision.

- Backend this phase: observability only. Add missing shadow log to scheduled-order path; include distance + which store would have served in the log payload. Still fail-open, still unenforced.

- **Rejected alternatives:** auto-correcting the store at checkout (cart is store-scoped — wrong prices/stock, rejected); moving the fallback coordinate to a "safe" empty location (recreates the same unenforced invariant, rejected); patching only the two known triggers without the generation token (wouldn't close the whole class, rejected per plan brief).

## Data model changes

None — no schema/index/migration. One client-side one-shot SharedPreferences migration: detect persisted coordinates within ~500m of the retired (25.7811, 84.7274) and clear them + the stored `storeId`, gated behind a prefs-version key so it runs once.

## API contract change

`GET /user/store/nearest` — accept optional `?lat=&lng=` query params, taking precedence over `x-user-latitude/longitude` headers when present and numeric; identical behavior when absent. No change to `/order/place` or `/order/schedule`.

## Build order

0. **sumit-backend** — check whether `DEFAULT_STORE_ID` is configured in dev/prod (report only, no fix yet; blocking for later steps' scope)
1. **siddhart-android** — delete fallback coordinate, nullable location types, one-shot poisoned-prefs migration
2. **siddhart-android** — Has/None/Failed address-fetch result type; single resolution entry point (kill MainActivity's double-trigger)
3. **siddhart-android** — generation token discarding stale resolutions; watchdog no longer invents a store
4. **siddhart-android + chanchal-designer** — close CartViewModel back-door; build the "set your location" state (design first)
5. **sumit-backend then siddhart-android** — optional lat/lng query params on `/store/nearest`
6. **sumit-backend** (design authority rajit-backend-arch if needed) — missing shadow log on scheduled-order path; structured mismatch logging (distance + correct store)
7. **rahul + user** — rollout to dev, device-verify against acceptance criteria, then raise min build via forceUpdate mechanism
8. **Deferred** — after 2 weeks of real mismatch data, decide on surgical enforcement (separate future plan, not pre-approved)
9. **docs** — update `haper-misc/test-store-from-delivery-address.md`

## Risks

Fail-closed increases visible friction for users with no resolvable location (intended, but a real UX change — needs sign-off on copy/flow); poisoned-prefs migration is easy to forget and must ship in the same release as the fallback deletion; nullable-coordinate ripple through UI read-sites (compiler will catch these); `DEFAULT_STORE_ID` fallback removal (if set) is a product decision, not just a bug fix; web remains unfixed and is a known residual gap, stated explicitly so "this can't happen again" isn't overpromised for web.

## Test strategy

Android unit tests (JVM, fake ApiService): stale-generation race, Failed-vs-None address fetch, watchdog produces zero resolution calls, poisoned-prefs clear, CartViewModel makes no resolution call when store blank. Android manual/device: full acceptance-criteria checklist (permission denied, throttled network, login race) — document runs in the misc guide. Backend jest (in-memory Mongo): `/store/nearest` with query params / headers-only / malformed params (400); scheduled-order path emits shadow log and still allows the order; `servesPoint` regression cases.
