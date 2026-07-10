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

- **Home** → reloads nearest store + categories + featured items (iOS: `fetchHomeData`).
  On iOS the pull-refresh path skips the full-screen "Finding nearest store..." overlay
  (uses `fetchHomeData(showLoader: false)`), so it behaves like Android's refresh.
- **Categories** → reloads the **currently selected category's** items, page 1
  (iOS: `fetchItemsByCategory` = Android `refreshCategoryItems`).
- **Cart** → re-syncs the cart (iOS: `cartManager.fetchCart` = Android `refreshCart`).

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
- iOS uses the app's existing fire-and-forget `.refreshable` pattern (same as Orders/Wallet):
  the pull spinner dismisses immediately rather than staying until the network finishes.
  Data still updates when it arrives. Making the spinner wait would need Combine→async
  bridging; deferred.
- **Search** has no pull-to-refresh on either app (out of scope for this change).

## Deploy / rollout
- iOS-only code change on `dev`. Needs an **app build/install** (TestFlight or local run) to
  test on device — it is NOT a backend/live change. Android needed no change.
- Verified: `xcodebuild -scheme haper ... build` → BUILD SUCCEEDED.
