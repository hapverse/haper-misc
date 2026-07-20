# Test: iOS ↔ Android parity sweep (2026-07-20)

**Area:** iOS user app — brought up to parity with the "latest" Android app across every screen.
**Apps:** iOS only (code change). Android was the source of truth and needed **no** change.
**Deploy:** iOS-only, on `dev`. Needs an **app build/install** (TestFlight or local `xcodebuild`
run) to test on device — NOT a backend/live change. No shared-code / Android / backend edits.
Verified: `xcodebuild -project haper.xcodeproj -scheme haper -destination 'generic/platform=iOS
Simulator' build` → **BUILD SUCCEEDED**; `swiftlint --strict` → 0 violations across the project.

## Why this exists

Android had been developed ahead and periodically ported to iOS. An 8-domain code-level
audit (Address, Home/Store, Category/Search, Checkout/Cart, Analytics, Orders, Config,
Profile/Wallet) found the headline features were already mirrored, but ~66 real divergences
remained — including **6 correctness/data bugs**. All are now fixed on iOS. This guide is the
single walkthrough; per-feature guides (`test-store-from-delivery-address.md`,
`test-pull-to-refresh.md`, `test-address-*.md`, `test-force-update.md`,
`test-checkout-analytics.md`, `test-order-status.md`, `test-cart-out-of-stock.md`) carry the
deeper per-feature steps and were updated where this change touched them.

Test on the **smallest** (e.g. iPhone SE) and **largest** (e.g. 17 Pro Max) simulators/devices.

---

## The 6 correctness bugs (verify these first — real user/data impact)

### ✅ 1. Address save no longer persists a hardcoded coordinate  (HIGH)
- **Was:** a brand-new address always saved the default map center (25.881, 84.948, Bihar) as
  the real delivery coordinate — feeding a WRONG location into store resolution/serviceability.
- **Now:** the default center is only a camera hint. A new address has no savable coordinate
  until the user sets a pin (map picker / pincode snap / Refresh/GPS).
- **Steps:** Add a new address WITHOUT touching the map/pincode → tap Save.
  - ✅ App requests location permission and captures GPS, then saves.
  - ✅ If permission is denied / Location Services off → save is **blocked** with an error
    alert; NO default-center coordinate is sent.
  - ✅ Inline preview shows "No location set yet" until a real pin exists.
  - ✅ Editing an existing address (which already has coords) still saves immediately.

### ✅ 2. One old order no longer wipes the whole orders list  (HIGH)
- **Was:** iOS decoded `orderId/items/status/price/actualOrderValue` (+ `salePrice`) as
  required; one pre-migration order missing a key failed the entire `[Order]` decode → the
  orders list/detail silently vanished.
- **Now:** those fields default (0 / [] / "") and nested `items`/`charges`/`addressId` decode
  with `try?`, so a malformed/legacy row degrades gracefully instead of wiping the list.
- **Steps:** With an account that has an old order (missing price/status/items keys), open
  Orders → ✅ the list loads and that order renders (with zeros where data is absent) rather
  than showing an empty/failed list.

### ✅ 3. Home no longer dead-ends to a blank screen  (HIGH)
- **Was:** the "not serviceable / Retry" card only showed when the error text was exactly
  `"No nearby stores found."`. On a timeout/5xx cold start you got no store, no card, no
  retry — a stuck home needing an app restart.
- **Now:** the not-serviceable state is driven by STATE (`!isLoading && !isRefreshing &&
  selectedStore == nil && categories.isEmpty`), matching Android, so ANY resolution failure
  shows the retry card.
- **Steps:** Cold-start with the network briefly off / a forced 5xx → ✅ the "not in your
  area / Check again" card appears with a working Retry (not a blank home).
- Also verify (robustness, mirror of Android): a **watchdog** forces the store fallback after
  ~8 s if resolution silently stalls; switching delivery address cancels any in-flight resolve
  so a stale response can't override the new one; pull-to-refresh does not blank the grid.

### ✅ 4. Razorpay checkout prefills the payer's real name + email  (HIGH)
- **Was:** iOS never fetched the profile on the checkout screen, so on a cold-launch →
  straight-to-checkout the payment sheet prefilled only the phone.
- **Now:** `CheckoutView.onAppear` fetches the profile if `nil`.
- **Steps:** Cold-launch (kill app) → go straight to Checkout → pay with Razorpay →
  ✅ name + email are prefilled (not just contact). Also ✅ the payment sheet is brand-blue
  (`#2563EB`), and a failed/cancelled payment shows a friendly message (not a raw string).

### ✅ 5. Edit Profile no longer sends "APPLIED" as the referral code  (HIGH)
- **Was:** for an already-referred user, every name edit re-posted `referrerCode = "APPLIED"`
  (garbage / possibly rejected).
- **Now:** the referral code is normalized and dropped when empty, `== "APPLIED"`, or the user
  already has a referrer.
- **Steps:** As an already-referred user, change your name → Save → ✅ succeeds; the referral
  field is not re-sent. As a new user, enter a valid referral (`[A-Z0-9]{4,16}`) → ✅ accepted;
  invalid codes are blocked with an inline error and Save disabled.

### ✅ 6. Analytics now tags store_id + app_platform="ios"  (HIGH)
- **Was:** iOS set no Firebase user properties → cross-platform funnels (the reason
  `checkout_error` exists) silently excluded iOS and couldn't break down by store.
- **Now:** `AnalyticsManager.setStoreContext(storeId:)` is fired on every active-store change
  from `MainTabView`, setting `store_id` and `app_platform="ios"`.
- **Steps (needs Firebase DebugView):** log in, let a store resolve, switch store → ✅
  `store_id` updates and `app_platform="ios"` is set as a user property.

---

## Per-area parity (functional + cosmetic) — spot-check by screen

- **Home:** section headers now have eyebrow + subtitle ("Browse / Shop by Category", "For
  you / Fresh Picks / Popular items from <store>."), hidden when empty; store-id re-asserted
  before add-to-cart; "cart is per store" notice now fires on address-driven store switches
  too (centralized in `MainTabView`), not just the picker.
- **Categories:** search title "Search products" + helper "Find products faster" until a
  category resolves; a store-resolved-but-empty state shows a spinner (not a contradictory
  "Select a Category"); awaited pull-to-refresh.
- **Search:** keyboard auto-focuses on open; pagination has an in-flight + per-item dedupe
  guard (no double page-loads on fast scroll); recent-search chip fires the search once;
  chips wrap to multiple rows; 3-column results grid; placeholder "Search products".
- **Item detail:** bottom bar shows "Total ₹<price>" + a `FloatingCartBar` running summary;
  a load failure shows "Unable to load item details." (not a blank screen); "About this item"
  always renders with a fallback line; "Selected store: <name>" line.
- **Checkout/Cart:** itemized Order Summary card (Items / Delivery / Platform fee / Wallet
  applied / To pay); amounts round (not truncate); wallet shows 2 decimals; cart +/- buttons
  lock while a mutation is in flight (no double-tap races); cleaned item name + weight/unit
  label + "{n} items ready to checkout" subtitle; orders list refetched after a paid order.
- **Orders detail:** recipient name + phone + structured address line (legacy fallback); item
  rows show weight/unit + struck MRP + "% OFF"; bill Item-Total / Total-Paid fallbacks;
  Platform Fee always shown.
- **Config / force-update:** a malformed maintenance `endTime` no longer fails the whole
  config (maintenance + force-update stay correctly gated); version compare is component-wise
  so "1.2" vs "1.2.0" does NOT wrongly force an update. (See `test-force-update.md`.)
- **Profile/Wallet/Notifications/About:** avatar resolves relative URLs and falls back to
  initials on load failure; referral "Share" only when a real code exists (no fake "HAPER");
  Wallet has an error/retry card + refetches balance on entry/pull; menu subtitles + section
  labels + logout card; notification-settings errors surfaced; About link detail subtitles.
- **Login:** logs a `screen_view("login")`.

## Deploy / rollout
- iOS-only, `dev` branch, code-only. Build an app (TestFlight/local run) to test on device.
- No backend, shared-package, Android, or web change. No migration.
