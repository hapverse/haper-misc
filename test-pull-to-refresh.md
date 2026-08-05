# Test: Pull-to-refresh (user apps)

**Area:** User app → Home, Categories, Cart screens → pull down to reload
**Apps:** Android + iOS

## What the feature is

Pull down (swipe down) at the top of a scrollable screen to reload its server data
without leaving the screen.

## Coverage (2026-07-05)

| Screen | Android | iOS |
|---|---|---|
| Home | ✅ (already existed) | ✅ **added** |
| Categories | ✅ (already existed) | ✅ **added** |
| Cart | ✅ (already existed) | ✅ **added** |
| Orders | ✅ | ✅ |
| Wallet | ✅ | ✅ |
| Search | ❌ | ❌ (not added) |

**This change:** brought iOS Home / Categories / Cart up to parity with Android.
Android already had all of these — no Android change was needed.

## What each refresh does (Android and iOS match)

- **Home** → reloads nearest store + categories + featured items. On iOS this now uses a
  dedicated `HomeViewModel.refresh()` (async) — it skips the full-screen "Finding nearest
  store..." overlay AND does **not** clear the current items, so the grid stays visible
  while fresh data loads (matches Android's `refresh()`, which keeps `featuredItems`).
- **Categories** → reloads the **currently selected category's** items, page 1
  (iOS: `refreshCategoryItems` = Android `refreshCategoryItems`; keeps the current items
  on screen instead of blanking them).
- **Cart** → re-syncs the cart (iOS: `cartManager.refreshCartAsync` = Android `refreshCart`).

## Update (2026-07-20): spinner now waits + no blanking (iOS)

The 2026-07-05 iOS limitation below (fire-and-forget `.refreshable`, spinner dismissing
immediately, and Home/Categories blanking the list on pull) has been **fixed** for Home /
Categories / Cart:
- The `.refreshable` closures now `await` an async refresh (`HomeViewModel.refresh()` /
  `refreshCategoryItems(...)` / `CartManager.refreshCartAsync()`), which bridges the Combine
  request to async/await via `withCheckedContinuation`. So the native pull spinner now
  **persists until the reload actually finishes**, matching Android.
- A separate `isRefreshing` flag drives the refresh so it never sets `isLoading` (no overlay)
  and never clears `featuredItems` / `categoryItems` (no blank flash).
- Orders / Wallet still use the older fire-and-forget pattern (Wallet's refresh now also
  refetches the balance, not just history).

## Manual test steps (iOS — the new part)

### ✅ Home
1. Open the app (dev), land on Home with a store selected.
2. Pull down from the top of the list.
3. Confirm a spinner appears and the store/categories/featured items reload.
4. Confirm the dark full-screen "Finding nearest store..." overlay does **NOT** flash.

### ✅ Categories
1. Go to Categories, select a category so items show on the right.
2. Pull down on the item grid.
3. Confirm the current category's items reload (page 1).

### ✅ Cart
1. Add items, open Cart.
2. Pull down on the cart list.
3. Confirm cart totals / bill details re-sync (e.g. change a price in admin, pull, see it update).

## Notes / known limitations
- ~~iOS uses the app's existing fire-and-forget `.refreshable` pattern … the pull spinner
  dismisses immediately … Making the spinner wait would need Combine→async bridging;
  deferred.~~ **RESOLVED 2026-07-20 for Home / Categories / Cart** (see "Update" section above).
- **Search** has no pull-to-refresh on either app (out of scope for this change).

## Deploy / rollout
- iOS-only code change on `dev`. Needs an **app build/install** (TestFlight or local run) to
  test on device — it is NOT a backend/live change. Android needed no change.
- Verified: `xcodebuild -scheme haper ... build` → BUILD SUCCEEDED.
