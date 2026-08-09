# Test — Global maintenance mode auto-lift (`endTime`)

**Area:** `configs` doc (`name: "APP_CONFIG"`), sub-doc `maintenance: { isActive, message, endTime }`
**Backend files:**
- `packages/user/src/routes/config/controller.js` — `getAppConfig` (what the apps read; Redis-cached)
- `packages/admin/src/routes/config/controller.js` — `updateMaintenance` (super-admin writer)
- `packages/shared/repositories/config.repository.js` — `getAppConfig` / `getAppConfigUnleaned`

**Deploy needed:** backend redeploy (dev → `dapi.haper.in`). No DB migration required for the fix itself.
**Follow-up (manual, prod, user-driven):** add a unique **partial** index on `configs.name` for `name: "APP_CONFIG"` so a duplicate `APP_CONFIG` doc can never be created. Prod currently has two `configs` docs (one legacy default read by `_id`, one real `APP_CONFIG`).

---

## Why this exists (the bug)

Maintenance mode never turned off at its scheduled time. `endTime` was stored but **nothing read it** — the app endpoint returned `isActive` verbatim and no cron flipped it, so maintenance stayed on until a super-admin manually toggled it off. Confirmed on prod: a config updated the same morning still carried an **11-day-stale** `endTime`.

## The fix (two sides)

- **Read side (`getAppConfig`):** returns an *effective* `isActive` = `storedIsActive && (endTime == null || endTime > now)`. Maintenance auto-lifts exactly at `endTime`, no cron. Response shape is unchanged — only the `isActive` value is corrected. Cache TTL is capped to `endTime` (so a cached "on" can't outlive the deadline by up to 12h). A best-effort lazy write-back flips the stored flag off once `endTime` passes so the admin panel reflects reality.
- **Write side (`updateMaintenance`):** ON + future `endTime` → honoured as-is; ON + missing/null/**stale** `endTime` → defaults to **now + 6h**; OFF → `endTime` cleared to `null`. Guarantees maintenance can never get stuck on indefinitely.

---

## Test steps

Super-admin token required for the admin PUT. `GET /config` (user app config) needs **no** `x-store-id` for global config. Admin maintenance PUT **403s** if `x-store-id` is sent (global-only).

### Write-side (`PUT /admin/config/maintenance`)
| # | Body | Expected stored `endTime` | Result |
|---|------|---------------------------|--------|
| 1 | `{ isActive: true }` (no endTime) | ~ now + 6h | ✅ / ❌ |
| 2 | `{ isActive: true, endTime: <past> }` | overwritten to ~ now + 6h | ✅ / ❌ |
| 3 | `{ isActive: true, endTime: <future> }` | equals the provided value | ✅ / ❌ |
| 4 | `{ isActive: false }` | `null` | ✅ / ❌ |

### Read-side (`GET /config` app config → `data.maintenance.isActive`)
| # | Stored state | Expected `isActive` in response | Result |
|---|--------------|--------------------------------|--------|
| 5 | isActive:true, endTime in **future** | `true` | ✅ / ❌ |
| 6 | isActive:true, endTime in **past** | `false` (auto-lifted) | ✅ / ❌ |
| 7 | isActive:true, endTime **null** | `true` (indefinite) | ✅ / ❌ |
| 8 | isActive:false | `false` | ✅ / ❌ |

### End-to-end (the real incident)
9. Super-admin turns maintenance ON with no endTime → app shows maintenance. ✅/❌
10. Wait past the 6h window (or set a near endTime) → app **auto-lifts** without anyone touching it. ✅/❌
11. Re-`GET /config` after lift → stored `maintenance.isActive` is now `false` (lazy write-back). ✅/❌

---

## Edge cases to watch

- **Cache lag:** the app config is Redis-cached (12h default, capped to `endTime` when active). Admin writes clear the cache immediately (`distributedCacheUtils.del`). A manual toggle is instant; an auto-lift at `endTime` is bounded by the capped TTL.
- **Timezone:** `endTime` is a UTC `Date`. The admin UI must send it in ISO/UTC. `06:00 IST` must be stored as `00:30 UTC` — verify the FE picker's timezone handling.
- **Two config docs:** reads use `.sort({ updatedAt: -1 })`, so user-read and admin-write always resolve to the same newest `APP_CONFIG`. Until the unique index lands, do not hand-create a second `APP_CONFIG` doc.
- **Legacy admin tests** send `{ enabled: ... }` (wrong key — real schema is `isActive`); they never exercised a real save. Test cases 1–8 above are the first to assert persisted/returned values.

## Clients
No client change required — response shape is identical, apps already gate their maintenance screen on `data.maintenance.isActive`. The fix is purely that this value is now correct.

## Automated coverage
- `packages/user/__tests__/config.test.js` — cases 5–8 (in-memory Mongo).
- `packages/admin/__tests__/config.test.js` — cases 1–4 (in-memory Mongo).

---

# Surface — Admin per-store maintenance page (`/maintenance`)

**Area:** haper-admin dedicated route `/maintenance` (super-admin only). Promotes maintenance out of the
`/config` page (Config now shows a "Maintenance Mode →" link card instead of the inline panel).

**Admin files (haper-admin):**
- `src/pages/Maintenance/MaintenancePage.tsx` — global master card + per-store list + precedence + states.
- `src/pages/Maintenance/MaintenanceStoreModal.tsx` — per-store editor (Switch + message + duration + end time).
- `src/pages/Maintenance/MaintenanceFields.tsx` — shared message + duration-chips + IST end-time editor.
- `src/pages/Maintenance/maintenanceHelpers.ts` — client `resolveEffective`, countdown + auto-lift formatters.
- `src/components/common/{Switch,MaintenanceBadge,ConfirmDialog}.tsx`, `src/hooks/useNow.ts` — reusable pieces.
- Router: `src/App.tsx` (`/maintenance`, super-admin group). Nav: `src/hooks/useMenu.ts` (Settings → Maintenance).

**API bound (backend already built):**
- `GET /admin/config` (no store header) → global stored `maintenance` for the master card.
- `GET /admin/config/maintenance/stores` (super-admin) → `[{ storeId, name, status, maintenance:{ isActive(effective), storedIsActive, message, endTime } }]`.
- `PUT /admin/config/maintenance` — GLOBAL (no store header) or PER-STORE (`x-store-id: <storeId>`). `endTime`: ON+future kept, ON+missing/past → now+6h, OFF → null.

**Deploy needed:** admin FE redeploy (dev → `damin.haper.in`). No backend/DB change (endpoints already live).

## Admin UI test steps (super-admin)
| # | Step | Expected | Result |
|---|------|----------|--------|
| A1 | Open sidebar → Settings → **Maintenance** | Dedicated page: global master card + store list, live countdowns tick | ✅ / ❌ |
| A2 | Config page (`/config`) | Old inline maintenance panel gone. **Updated 2026-07-28:** the entry point is now a **single slim link row** at the **bottom of the PLATFORM SETTINGS group** — "Maintenance Mode · Take the whole app or a single store offline" with **Open ›** — not a card. Clicking it (or pressing Enter on it) still opens `/maintenance`; still super-admin only | ✅ / ❌ |
| A2b | `/maintenance` in **LIGHT** theme on a slow network (dev tools → Slow 3G) | The store-list **loading skeletons are visible** as grey bars. They used to be white-on-white, i.e. invisible in light theme, so the page looked blank while loading (app-wide `.skeleton-bar` fix; see [`test-admin-ui.md` § Issue 12](./test-admin-ui.md#issue-12--config-page-layout-revamp)) | ✅ / ❌ |
| A3 | Toggle **global** switch ON | ConfirmDialog "Take the ENTIRE app down?" with required **acknowledgement checkbox** (confirm disabled until ticked) | ✅ / ❌ |
| A4 | Confirm global ON | Master card turns red **LIVE**, mono countdown "auto-lifts H:MM · HH:MM:SS"; store list greys (opacity .5) + amber banner; Manage disabled | ✅ / ❌ |
| A5 | Global ON, leave `endTime` blank | Stored `endTime` ≈ now + 6h (backend default); hint "Blank = defaults to 6 hours" shown | ✅ / ❌ |
| A6 | Global card **Restore service** → confirm | Global off; toast + **Undo** snackbar (~6s) that re-applies the prior maintenance | ✅ / ❌ |
| A7 | Global OFF, a store's **Manage** → toggle on + message + `+6h` chip → **Take store down** | Only that store's row → red **LIVE** with countdown; other stores stay Off | ✅ / ❌ |
| A8 | Per-store PUT sends `x-store-id` of the edited store (not the top-bar store) | Correct store updated (verify in DB `stores.config.maintenance`) | ✅ / ❌ |
| A9 | Live store row **Restore** → confirm | Row → Off; toast + **Undo** snackbar | ✅ / ❌ |
| A10 | Let a live store's countdown reach 0 (short end time) | Badge auto-flips to **Off** live (client re-derives effective); no refresh needed | ✅ / ❌ |
| A11 | Global ON while a store is also down | Store row shows `⛔ Down (global)` + faint "Store setting: On" (per-store value preserved) | ✅ / ❌ |
| A12 | Keyboard: open a dialog → Tab cycles inside, Esc cancels, focus returns to trigger; Cancel is default-focused | ✅ / ❌ |
| A13 | States: slow network (loading skeleton rows), no stores (empty), store-list fetch fails (inline **Retry**) | Each renders correctly | ✅ / ❌ |

## Edge cases (admin page)
- **Precedence is visual only:** while global is ON the store PUTs still work server-side, but the page pauses/greys them and hides Restore — lifting global immediately restores each store's own stored setting.
- **Countdowns are derived in render** from one shared `useNow()` clock; end time is IST via `configTime` (same UTC↔IST rule as the old picker — verify `4:30 PM IST` round-trips).
- **Optimistic OFF:** the badge flips before the API returns; on failure it reverts + shows an error toast (input preserved on the store modal).
- **Non-super-admin** hitting `/maintenance` (route is super-gated, but defensive): read-only notice, no toggles.

## Ambiguities resolved (flag for reviewer)
- Store editor **toggle seeds from the EFFECTIVE state** (what the row badge shows), while message/end-time seed from the stored values — so the admin edits exactly what they see. (Spec left stored-vs-effective open.)
- **Scheduled** badge (future start) is coded but unused — reserved for a Phase-2 `startTime`; today ON is immediate (matches backend).
- ~~Shared `Switch`/`Panel`/`Field` extraction was **not** applied to `ConfigSettings.tsx`.~~ **Resolved 2026-07-28:** the `/config` revamp deleted the page's local copy and `ConfigSettings.tsx` now imports the shared `components/common/Switch` (the same one this page uses), so both pages' switches are one component. `Panel`/`Field` are still per-page.
- Auto-lift "green flash" (A.8) omitted — the badge simply flips to Off; no functional gap.

---

# Surface — Backend store-wise resolution + clients

**Area:** `stores.config.maintenance` (new, defaulted, no migration) + shared `maintenance.utils` (resolveEffective / resolveEndTimeForWrite / precedence). Global stays the master kill-switch.

**Backend files:** `packages/shared/utils/maintenance.utils.js` (new), `packages/shared/models/stores.schema.js`, `packages/shared/repositories/stores.repository.js` (`getMaintenance`), `packages/user/src/routes/config/controller.js` (store-aware read), `packages/user/src/routes/order/controller.js` (409 guard), `packages/admin/src/routes/config/controller.js` + `router.js` (per-store PUT + `GET /config/maintenance/stores`).

**Deploy needed:** backend redeploy (dev → `dapi.haper.in`) + client releases (Android/iOS store update; web deploy). Already-shipped Android honors store maintenance the moment the backend deploys (it already sends `x-store-id`) — safe (default OFF).

## API resolution — `GET /user/config` (send `x-store-id`)
Server resolves precedence and returns `data.maintenance { isActive, message, endTime, scope }` (the boolean clients gate on) + additive nullable `data.storeMaintenance`.

| # | Global | Store | `x-store-id` | Expected `data.maintenance` | Result |
|---|--------|-------|-------------|-----------------------------|--------|
| B1 | ON | OFF | store | `isActive:true, scope:"global"` (global message) | ✅ / ❌ |
| B2 | ON | ON | store | `isActive:true, scope:"global"` (global wins) | ✅ / ❌ |
| B3 | OFF | ON | store | `isActive:true, scope:"store"` (store message + endTime) | ✅ / ❌ |
| B4 | OFF | OFF | store | `isActive:false, scope:"none"` | ✅ / ❌ |
| B5 | OFF | ON (endTime past) | store | `isActive:false` (store auto-lifted) + lazy write-back flips stored store flag | ✅ / ❌ |
| B6 | OFF | ON | *(none)* | `isActive:false`, `storeMaintenance:null` (identical to pre-store behavior) | ✅ / ❌ |
| B7 | OFF | ON | *invalid id* | treated as no store → global-only | ✅ / ❌ |

## Order guard — `POST /user/order/place`
| # | Step | Expected | Result |
|---|------|----------|--------|
| B8 | Place order into a store that is effective-ON (or global ON) | Rejected **409** with the maintenance message; no inventory decrement (txn aborts) | ✅ / ❌ |
| B9 | Config/maintenance read throws a DB error during checkout | Order **proceeds** (fail-open — guard gates re-throw on `statusCode===409` only) | ✅ / ❌ |

## Clients (store-scoped)
| # | Platform | Step | Expected | Result |
|---|----------|------|----------|--------|
| B10 | Android | Enter a down store → switch to a healthy store | Maintenance screen ("This store is briefly down") shows, then clears on switch (re-fetch on store change). **Updated 2026-08-09:** before this date there was **no in-app way to switch** from this screen at all (no back button, no address bar — a genuine dead end; the only way out was leaving the app or changing address from somewhere else entirely). See **B10a** for the new in-app mechanism. | ✅ / ❌ |
| B10a | Android | From a store-scoped Maintenance screen, tap **"Try a different delivery address"** → pick an address that resolves to a live store | Link opens a dedicated address list/add/edit flow (not the app's main NavHost — that's unmounted while Maintenance is showing). Picking a live-store address auto-clears Maintenance and lands on Home via the existing reactive re-fetch (`selectedStoreId` change → `configVM.fetchConfig()`); no new "success" screen needed. Link is **hidden** for global/null-scope maintenance (switching address can't fix a global outage) **and, updated 2026-08-09, for a logged-out/session-expired user** — `showAddressEscapeHatch = isStoreScoped && isLoggedIn`, added because the flow opens real authenticated address APIs and MaintenanceScreen can render before auth resolves or after a session expires. See full checklist below. | ✅ / ❌ |
| B11 | iOS | Resolve a down store | Overlay appears — confirm `x-store-id` is actually sent on `/user/config` (was headerless before) | ✅ / ❌ |
| B12 | Web | Resolve a down store | Full-screen overlay with scope copy + countdown; checkout 409 → message + overlay | ✅ / ❌ |
| B13 | All | Global ON | Every customer sees the global message regardless of store | ✅ / ❌ |

### Android — "Try a different delivery address" escape hatch (B10a detail)
**Files:** `app/src/main/java/com/bheldi/ui/screens/maintenance/MaintenanceScreen.kt` (the link + new `onChangeAddress: () -> Unit` param; **updated 2026-08-09:** visibility is now `showAddressEscapeHatch = isStoreScoped && isLoggedIn` — a new required `isLoggedIn: Boolean` constructor param ANDed with the existing store-scope check, fixing a review finding where the link stayed reachable for logged-out/session-expired users) · `app/src/main/java/com/bheldi/MainActivity.kt` (`showMaintenanceAddressFlow` state + reset effect, and the private `MaintenanceAddressFlow` composable — a small dedicated `NavHost` for list/add/edit/view, reusing `AddressListScreen`/`AddEditAddressScreen`, needed because `MainActivity`'s real NavHost lives inside `MainAppContent`, a mutually-exclusive sibling branch that's unmounted while Maintenance is showing).

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1 | Trigger store-scoped maintenance vs global/null-scope maintenance, **and** vary logged-in state | Link visible **only** when **store-scoped AND logged in**; hidden for global scope, for a null/legacy scope payload, and — **updated 2026-08-09** — hidden for a logged-out/session-expired user even when the maintenance itself is store-scoped (the link opens authenticated address APIs, so a logged-out tap must not be reachable) | ✅ / ❌ |
| 2 | Tap the link | Address list screen opens (embedded flow, not the main app NavHost) | ✅ / ❌ |
| 3 | Press device back from the address list | Returns to MaintenanceScreen — does **NOT** exit the app (there's no parent NavHost to inherit back-stack pop from here, so this needs its own `BackHandler`) | ✅ / ❌ |
| 4 | Pick a different address that resolves to a **live** store | Auto-transitions to Home (reactive re-fetch on `selectedStoreId` change) — no manual "continue" step | ✅ / ❌ |
| 5 | Pick an address that resolves to a **different down** store | Re-shows Maintenance with **that** store's own message/countdown/link (not stale copy from the first store) | ✅ / ❌ |
| 6 | Add / edit / view an address from within this embedded flow | Each screen works the same as it does from the main app's address flow (same composables, same callback shapes) | ✅ / ❌ |
| 7 | Measure the link's tap target | ≥ 48dp touch target (uses `vertical = 14.dp` padding + text line height) | ✅ / ❌ |
| 8 | Trigger maintenance on the **guest/pre-login** path (maintenance can fire before login) and tap the link with an empty/unauthenticated address list | No crash; address list renders its normal empty/guest state (note: with the 2026-08-09 `isLoggedIn` gate the link itself won't even be visible on the guest path — this case now mainly guards against a stale/cached logged-in flag racing the auth state) | ✅ / ❌ |
| 9 | **New 2026-08-09.** From the embedded address list, tap **"Deliver Here"** on an address that has **no saved map location** (~75% of real default addresses currently have none — this path will be hit often). Manual verification recommended: tap the escape-hatch link → pick/add an address with no saved coordinates → tap "Deliver Here" | Toast **"This address has no saved location — set it on the map to continue."** + routes straight into the existing edit-address screen (which already has a "set your location on the map" state for coordinate-less addresses) — it does **NOT** silently bounce back to the same maintenance wall. Set a location + save → the wall then clears via the normal reactive re-fetch. Only an address that **already has coordinates** causes an immediate exit back to the (now-cleared) app. | ✅ / ❌ |
| 10 | Open the embedded address flow, then exit it (back or a successful "Deliver Here") while the Maintenance countdown timer is still running vs. after `endTime` has already passed | Config is **always** re-fetched on exit from the flow, regardless of the countdown's own state — closing the flow can unmount MaintenanceScreen long enough that its in-flight countdown (which normally re-fetches right at `endTime`) gets cancelled and never fires; the explicit re-fetch on exit covers that gap so a since-passed `endTime` doesn't leave a stale wall up until the app is next backgrounded/foregrounded | ✅ / ❌ |

**Automated coverage:** `app/src/test/java/com/bheldi/ui/screens/maintenance/AppConfigViewModelTest.kt` — JVM unit tests pinning `maintenanceScope` parsing for `"store"` / `"global"` / `"none"` / legacy-missing-field, i.e. the exact data feeding the `isStoreScoped` gate (runs via `./gradlew testDebugUnitTest`, green, 201/201 as of 2026-08-09 — unaffected by the `isLoggedIn` fix loop). `app/src/androidTest/java/com/bheldi/ui/screens/maintenance/MaintenanceScreenTest.kt` — Compose UI tests, now **6** (was 4): link visibility per scope + click firing `onChangeAddress`, plus (**added 2026-08-09**) `linkHidden_whenLoggedOut_evenIfStoreScoped` and `linkShown_whenLoggedIn_andStoreScoped` isolating the new `isLoggedIn` dimension with scope held fixed at `"store"` — covers checklist item 1 in full (both the scope axis and the login axis) and the click half of item 2. **Not executed** in this pass — no connected device/emulator and no Robolectric in this repo; the file compiles clean and the instrumented test APK assembles (`./gradlew compileDebugAndroidTestKotlin`, `./gradlew assembleDebugAndroidTest`, both BUILD SUCCESSFUL as of 2026-08-09), so it's ready to run via `./gradlew connectedDebugAndroidTest` once a device/CI runner is available. Checklist items 2 (navigation)/3 (back-stack)/4/5 (reactive re-fetch across composables)/6/8/**9 (no-location toast + edit-screen routing)**/**10 (unconditional re-fetch on exit)** need either that instrumented run or manual device testing — not covered by the JVM unit tests. Item 9 especially should be run manually before this ships given how common coordinate-less addresses are today.

## Edge cases (backend)
- **Cache keys:** global `CACHE_APP_CONFIG` vs per-store `CACHE_STORE_MAINTENANCE_<id>` are busted independently; a store response always recombines the current global master. Store key normalized to canonical lowercase ObjectId hex so an upper-case `x-store-id` can't strand a stale entry.
- **Guarded lazy write-back:** flips the stored flag off only if the observed `endTime` still matches, so a concurrent admin re-enable isn't clobbered (global + store).
- **`.lean()` reads** don't apply schema defaults → resolver treats an undefined `config.maintenance` as OFF (old stores unaffected).
- **Super-admin only:** `config.maintenance` can only be written via the super-admin `PUT /config/maintenance`; `updateStoreConfig` (store-admin reachable) whitelists fields and has no `maintenance` key.

## Automated coverage (store-wise)
- `packages/user/__tests__/config.test.js` — B1–B7 (in-memory).
- `packages/user/__tests__/order-serviceability.test.js` — B8–B9 incl. the fail-open DB-error test.
- `packages/admin/__tests__/config.test.js` — per-store PUT + `GET /config/maintenance/stores`.
- Design spec: `design-store-maintenance.md`.
