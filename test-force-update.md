# Test guide — Force-update screen (iOS + Android)

The blocking screen shown when the installed app is older than the server's minimum
version. Server drives it via `GET /user/config` → `data.forceUpdate.minAndroidVersion` /
`minIosVersion` + `updateMessage`.

- **iOS:** `haper/Views/ForceUpdateView.swift` (host: `haperApp.swift`, gate:
  `AppConfigViewModel.isForceUpdateRequired`)
- **Android:** `ui/screens/maintenance/ForceUpdateScreen.kt` (gate in `MainActivity` `when`,
  `AppConfigViewModel.isForceUpdateRequired`)

## What changed (2026-07-04 redesign — visual only, no behavior change)

Old look = full-screen **dark-navy gradient + neon-red** icon/button (the "scam pop-up"
palette, hardcoded, off-brand). New look = **Haper brand**: mint background, white card,
soft-blue icon badge, solid blue "Update Now" button, calmer copy.

Colors now used (all from the app theme — `AppTheme` on iOS, `ui/theme/Color.kt` on Android):

| Role | Hex |
|---|---|
| Brand blue (icon + button) | `#2563EB` |
| Mint background | `#F0FDF4` |
| Card | `#FFFFFF` |
| Blue icon-badge halo | `#2563EB` @ 10% |
| Title text | `#111827` |
| Body / caption text | `#6B7280` |

Copy: title `Update Required` → **`Time to update`**; added caption **`It only takes a few
seconds`**. Button still `Update Now`.

## How to trigger it

Make the server min version **higher** than the installed build:

- Android installed `versionName` = **2.0.2** → set `forceUpdate.minAndroidVersion` to e.g.
  `9.9.9` in the dev config source for `/user/config`.
- iOS installed `MARKETING_VERSION` = **1.0** → set `forceUpdate.minIosVersion` to e.g. `9.9.9`.
- Disabled sentinels (screen must NOT show): `""`, `null`, `"0.0"`, `"0.0.0"`.

The gate re-checks on every foreground (`ON_START` / `willEnterForeground`), so background →
foreground the app after changing config.

## Steps

✅ **1. Screen appears & blocks** — with min > installed, open/foreground the app. The update
   screen fully covers the app; there is no back/dismiss/"Later". (Android: `MaintenanceScreen`
   still wins if maintenance mode is also on.)

✅ **2. New design renders** — mint background, centered white card with soft shadow, blue
   circle badge with a blue download arrow, "Time to update" title, the server message, blue
   "Update Now" button, "It only takes a few seconds" caption. **No** dark navy, **no** red.

✅ **3. Server message shows** — set `updateMessage` to a custom string; it appears as the body.
   Empty/absent → fallback `A new version of the app is available. Please update to continue.`

✅ **4. Button opens the store** — tap **Update Now** →
   Android: Play Store `market`/web for `com.bheldi`; iOS: App Store for `id6741940637`
   (⚠️ placeholder App Store ID — swap for the real one before prod).

✅ **5. Disabled when up to date** — set min ≤ installed (or a `0.0.0`/empty sentinel),
   foreground → screen does NOT show, normal app loads.

## Edge cases

- ❌ Long `updateMessage` (3–4 lines) — must stay inside the card, centered, no clipping.
- ❌ Small screens (e.g. iPhone SE / compact Android) — card stays centered, button reachable,
   nothing overflows (card is width-capped at 380dp/pt, page has 24 padding).
- ❌ Semver compare edge: installed `2.0.2` vs min `2.0.10` must be treated as older
   (numeric compare), i.e. screen shows. Regression guard for the version-compare logic.
- ❌ Foreground toggle: min set high while app is backgrounded → screen appears on return;
   min lowered again → screen clears on next foreground.

## PR / deploy

- Client-only change (2 files). Ships in the next **Android** + **iOS** app builds.
- No backend/deploy needed — the `/user/config` `forceUpdate` contract is unchanged.
