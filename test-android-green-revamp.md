# Test — Android "Haper Green" UI revamp

Branch: `imp/vikash/revamp-no-delete` (haper-android)
Source design: Claude Design project "Quick commerce mobile app" →
`Haper Green App.dc.html` (the 31 live screens) + `Haper Green Screens.dc.html` (contact sheet).

Client-only change. **No backend, API contract, or response shape was touched.**

## What changed

The app was re-skinned from the old blue/Material look to the green direction in the
mocks. Screens already read their colours from `MaterialTheme.colorScheme` (456
references vs 59 hardcoded), so the theme swap re-skins everything at once; the
per-screen work below then matches specific layouts to the mocks.

**Foundation**
- **Fonts** — Quicksand (headings) + Poppins (body/labels), bundled in `res/font`
  with their OFL licences in `assets/licenses/`. Quicksand ships as one variable
  file; weights 500/600/700 are instances of it.
- **Palette** (`ui/theme/Color.kt`) — brand ramp `#5BB78E → #2F8163 → #215F49`,
  teal accent `#20B4AC`, rose error `#DC5F78`, amber warning, plum, green-tinted
  neutrals. Every previously-exported name was kept, so nothing broke.
- **`HaperBrand`** (`ui/theme/Theme.kt`) — the gradient ramps and corner scale
  (11/15/19/25 dp, sheet, pill) Material's ColorScheme has no slot for.
- 59 off-palette hardcoded colours mapped to tokens across 10 files.

**New shared components** (`ui/components/`)
- `HaperPrimaryButton` — the mocks' CTA: 150° gradient, coloured drop shadow,
  hairline top highlight. Text and custom-content overloads.
- `HaperBottomNav` — glass tab pill + the floating cart FAB that rides above it.
- `HaperEmptyState` — the shared "nothing here / something broke" panel.
- `HaperScreenHeader` — Quicksand title + subtitle + hairline rule.
- `HaperTopBar` — the mocks' back-button header (title + optional subtitle + actions).
- `HaperIconButton` — 36dp white square action button used in headers.
- `HaperItemRow` — horizontal product row (search results), same actions as the card.
- `bleedHorizontal` — lets a list item draw edge-to-edge inside a padded list.

**Screens reworked**
Home (full-bleed gradient header, logo chip, inline search, wallet strip, category
tiles, section headers), Categories/aisle (rail, filter pills), Item card, Item
detail (crumb, Quicksand title, price block, info tiles), Search (header field,
result rows, empty state), Cart (bill panel, empty state), Orders (header, tabs,
cards, empty state), Order detail (header), Profile (avatar, menu card, rows),
Wallet (dark balance card, header), Offers, Saved addresses, Add/edit address,
Edit profile, Notifications, FAQ, Map picker, Login, OTP, Checkout, Order success,
Force update, Restore account, No internet. Maintenance was already token-driven.

## Steps

### Foundation
1. ✅ `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` both pass.
2. ✅ Launch — **no blue anywhere**. Background is a warm off-white green (`#F2F9F5`),
   body text deep green-grey (`#1F332B`).
3. ✅ The **splash screen** is green off-white, not the old cool blue-grey.
4. ✅ Headings render in **Quicksand** (rounded, geometric); body/labels in **Poppins**.
   ❌ If either falls back to system sans, the font resource failed to load.

### Chrome
5. ✅ **Bottom nav** is a floating translucent pill with 4 tabs; the active tab has a
   pale green pad and dark-green icon/label.
6. ✅ A **round cart FAB** floats above the nav's centre with a white ring, and shows a
   white count badge when the cart is non-empty. Tapping opens the cart.
7. ✅ **Floating cart bar** (home/categories/search/item detail) is a dark green
   gradient bar: count chip, store name, "View cart", mint price + arrow.

### Gradient CTA
Each should show a green gradient (lighter top-left → deeper bottom-right) with a soft
green shadow, **not** a flat fill:
8. ✅ **Login** "Continue"/"Send OTP", **OTP** "Verify" — disabled = flat grey, no
   shadow; tapping shows a white spinner in place of the label.
9. ✅ **Item detail** "Add to Cart" (wrap-width). **Cart** "Checkout ⟶ ₹N" bar keeps
   label-left / price-right. **Checkout** "Place Order"/"Pay ₹N".
10. ✅ **Order success** "Track Order Details" keeps both icons.
11. ✅ **Force update** "Update Now", **Restore account** "Restore my account".

### Home
12. ✅ Green gradient header, rounded at the bottom, with two faint white blooms.
   Logo chip + delivery line, store name in Quicksand with a ▾ when multiple stores.
13. ✅ The bell (top-right) opens Notifications. The search bar sits inside the header.
14. ✅ **Wallet strip** below the banner shows the real balance and opens the wallet.
   ❌ It must not read "₹0" when the wallet actually has money — the balance is now
    fetched on app start, not only when Profile is opened.

### Search & cart
15. ✅ **Search** — header is a white rounded field with a back button beside it.
   Results are **horizontal rows** (60dp image well, name, weight, price, teal add
    button / stepper), not a 3-column card grid.
16. ✅ Searching nonsense shows the shared empty panel: "No results for "…"".
17. ✅ **Cart** — "Bill details" panel: 13sp grey labels, bold values, FREE in teal,
    a rule, then "To pay" in 16sp extra-bold. Empty cart shows the shared panel with
   "Continue shopping".

### Regression sweep
18. ✅ **Cart/Checkout** — free-delivery banner green, below-threshold amber; the
    checkout notice that used to be blue is now **teal**.
19. ✅ **Razorpay sheet** opens with a **green** accent, not the old blue.
20. ✅ **Order status chips** stay distinguishable: in-progress teal, out-for-delivery
    amber, delivered green, cancelled/failed rose, refunds plum.
21. ✅ **Notification settings** — the five per-type dots are still five distinct colours.
22. ✅ **Item card** — the veg / non-veg **FSSAI square is still true green / true red**.
   ❌ If those went brand-green, that's a compliance regression.
23. ✅ **Schedule slot picker** — amber cut-off notice, rose slot-unavailable error.

## Edge cases
- Fonts are bundled, not downloaded — works fully **offline**.
- `minSdk = 28`, so the variable-font `FontVariation` path is always available.
- Type **sizes and line heights were left unchanged**, only families swapped, so no
  layout should reflow. Still watch tight rows for clipping — Quicksand and Poppins
  have different metrics from the previous system sans.
- `HaperPrimaryButton` splits `enabled` and `loading`. Old call sites passed
  `enabled = cond && !isLoading`; now `enabled = cond, loading = isLoading`.
- The home hero's right-hand button changed from **cart** to **alerts** (the cart moved
  to the nav FAB), matching the mock.

## New screens (built this pass)

All wired to real data — nothing is a static mock-up.

24. ✅ **Refer & earn** (Profile → Refer & Earn) — shows **your real `refCode`** from
    `GET /user/profile`. Copy puts it on the clipboard; Share opens the Android share
    sheet with an invite message. ❌ If the code area says "isn't available yet", the
    profile hasn't loaded — that is the honest empty state, not a placeholder code.
25. ✅ **Settings** (Profile → Settings) — grouped hub: Account (profile, addresses),
    Preferences (notifications), Help (support, FAQs, about), Danger zone (delete
    account), then Log out in rose. Every row navigates to an existing screen.
26. ✅ **Notifications feed** (the bell on Home) — lists pushes the app has actually
    received, newest first, unread ones tinted with a green dot. Opening it marks all
    read. Tapping one with an order opens that order. The ⚙ action opens the
    notification **preferences** screen.
    ❌ Empty on a fresh install is correct — see the caveat below.
27. ✅ **Payment failed** — after a declined/cancelled Razorpay payment, a full screen
    replaces the old dialog: real amount, the gateway's Razorpay order id as Reference,
    and the parsed decline reason. "Try another method" returns to checkout;
    "Back to cart" leaves. The order is still cancelled and analytics still fire.
28. ✅ **Address out of range** — when a location resolves but no store serves it, Home
    now shows the full screen (title/subtitle/CTA still come from the `notServiceable`
    app-config block) with the saved address in a card, plus "Change delivery location".
29. ✅ **Server error** — Profile's load failure now uses the design's server-error
    panel with the real error text and a retry.

30. ✅ **Splash** — cold start shows the brand gradient with two faint blooms, the
    logo on a floating cream tile (it drifts up/down slowly), "Your neighbourhood
    store, delivered" in Quicksand, a white ring spinner, and "HAPVERSE PRIVATE LIMITED" at
    the bottom. It **holds for at least 3 seconds** even when the session resolves
    instantly, so it reads as a brand moment rather than a flash.
    ❌ Previously this was a blank white screen.
31. ✅ The **launch window** (before Compose starts) uses the same green gradient and
    logo, so there is no flash of a different colour into the splash.
32. ✅ A maintenance wall or force-update still takes over immediately — it is **not**
    delayed by the 3-second splash hold.
33. ✅ The **updated logo** from the design (`assets/haper-full.png`, 800×752 RGBA)
    appears on the splash, the Home header chip, Login, and About.

### Login & OTP
34. ✅ **Login** — 250dp green gradient header with the duotone mark watermarked in the
    corner, the logo on a cream tile, "Your neighbourhood store, delivered" in
    Quicksand 30 over two lines, and "Haper · by Hapverse Private Limited" beneath.
    ❌ The second line must not be clipped — the header grows past its 250dp minimum
    on devices with a taller status bar, so check a device with a notch/cutout too.
35. ✅ Body: "SIGN IN" eyebrow, "Continue to your cart", then a white 54dp phone field
    with a `+91` prefix, a divider, and a **teal tick once 10 digits are entered**.
    Errors show as a rose ⚠ row under the field.
36. ✅ "Send OTP →" gradient CTA, an OR rule, then a white "Continue with Google" pill.
37. ✅ Footer: **"Terms of Service" and "Privacy Policy" are tappable** and open
    `https://haper.in/terms` / `https://haper.in/privacy` in the in-app WebView
    (with back). ❌ They must not leave the app to an external browser.
38. ✅ Entering a name/referral (new user) keeps the same field styling and the header
    switches to "Almost there / Create your profile".
39. ✅ **OTP** — back button, "Verify your number", "Code sent to +91 … · Change"
    (Change returns to login), then **six 56dp cells**. The filled cell tints green,
    the next cell outlines teal. The system keyboard drives them (paste/autofill work).
40. ✅ A wrong code shows the rose error card ("That code didn't work" + detail).
41. ✅ Resend row counts down, then offers "Resend".

## Copy decisions
- The **login header and splash share the same line**, "Your neighbourhood store,
  delivered" — the design's "Groceries in ten minutes" is not used. There is no ETA field anywhere in the API (`StoreModel`
  has none — it is why the floating cart bar shows only the store name), so a minute
  count on the first screen would be a delivery promise nothing else in the app can
  substantiate. Change it in `SplashScreen.kt` if ops wants to commit to a number.

## Known gaps (NOT done)
- **Store closed was NOT built as a new screen — it already exists.** Store-scoped
  downtime is `MaintenanceScreen` with `scope == "store"`: store-specific heading,
  countdown, and an address escape hatch. A second screen would have been dead code.
- **The notification feed only records pushes that reach our code.** Pushes delivered
  as a `notification` payload while the app is backgrounded are rendered by the OS and
  never hit `onMessageReceived`, so they cannot be listed. History is local to the
  device (max 50, `SharedPreferences`) — there is no feed endpoint. A real feed needs
  a backend `GET /user/notifications`.
- **The mock's "Your referrals" list was NOT built** — there is no API for referred
  users or their status, and inventing names/amounts would be fake data. The screen
  ends after the share CTA.
- The mock's "Notify me when it opens" / "Notify me when you're here" buttons were
  left out — there is no notify-me endpoint to back them.
- **Order detail / tracking body** got the new header but its internals (timeline,
  60-second cancel window) still use the old layout.
- The mocks' **store-picker bottom sheet** and **toast** styling were not built; the
  store switcher is still a `DropdownMenu`.
- Item-detail **photo drop-zone** and the mock's banner art are placeholders — the
  design calls for real product photography.
- A handful of secondary/destructive `Button`s are still flat Material buttons
  (correctly green/rose, just no gradient) — that is deliberate: the gradient is
  reserved for the primary action on a screen.
- The mocks' **store-picker bottom sheet** and **toast** styling were not built.
- The mock's separate "all categories" list screen doesn't exist in the app's IA
  (the Categories tab opens the aisle view directly). Left as-is — changing it is a
  navigation change, not a re-skin.
- The design's logo is now installed as `res/drawable-nodpi/haper_logo.png`, taken from
  the **local export** at `~/Downloads/Quick commerce mobile app/assets/haper-full.png`
  (443 KB, RGBA). It could not be pulled through the design MCP, which caps file reads
  at 256 KiB — fetching it there yields a truncated, undecodable PNG. If the logo is
  revised again, re-export the project locally and re-copy rather than fetching it.
- `ic_app_logo*.png` are now unused by any screen but were left in place rather than
  deleted (branch is `revamp-no-delete`).
- Dark theme unchanged — `HaperTheme` remains light-only, as before.

---

## Phase A — theme foundation (2026-08-28, `dev@d2ad773`)

Purely additive. **No screen or behavior changed** — this is groundwork the later
phases build on. Nothing below needs a visual check; it's here so a tester knows
why the diff exists and doesn't go looking for a UI change that isn't there.

### What shipped
- `ui/theme/Shadows.kt` — 5 new Compose Modifier helpers (`cardShadow`,
  `headerShadow`, `primaryButtonShadow`, `navShadow`, `fabShadow`) porting the
  design's CSS box-shadows 1:1 via Compose 1.9's `dropShadow`/`innerShadow`.
- `ui/theme/Dimens.kt` — new dp constants.
- `ui/theme/Color.kt` — ~40 new named color tokens matching the design spec.
- `Theme.kt`'s `HaperElevation` — 3 old shadow helpers **deprecated, not removed**
  (still compile, still work) in favour of the new ones above.
- Same day, `dev@3afd791`: Quicksand display weights swapped from an approximated
  variable-font interpolation to the real static Google-served weight files
  (500/600/700) — matching how Poppins already loaded.

### Steps
1. ✅ `./gradlew assembleDebug` passes — the new Shadows/Dimens/Color files
   compile clean and nothing that referenced the deprecated `HaperElevation`
   helpers broke.
2. ✅ Launch the app and spot-check a few Quicksand headings (Home store name,
   Login/OTP headlines, Item detail price) — glyphs should look identical to
   before this pass, just sourced from the correct static weight file instead of
   an interpolated one. There's no "before" build to diff against on-device;
   this is a source-fidelity fix, not a visual redesign.
3. ❌ Nothing else to check — no screen calls the new shadow helpers or color
   tokens yet. If a screen looks different after this commit, that's a
   regression, not the intended effect of Phase A.

### Edge cases
- The 3 deprecated `HaperElevation` shadow helpers are still callable
  (deprecation warning only) — existing call sites keep working until a later
  phase migrates them to the new `Shadows.kt` helpers one screen at a time.
- Deprecated ≠ removed: don't expect a compile error from old call sites.

---

## Phase B — bottom nav reach (2026-08-28, `dev@5a77cf4`)

The bottom nav pill (Home/Categories/Orders/Profile + centre cart FAB) previously
rendered on 3 screens (home, search, aisle). It now rides along on every screen of
the main graph by **deny-list**, not allow-list: hidden only on
`splash`/`login`/`otp`/`maintenance`/`forceUpdate` (`NoBottomNavRoutes` in
`MainActivity.kt`). The active tab is now derived from the current route
(`navTabForRoute`), not just the user's last tap.

### Steps
1. ✅ `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` both pass —
   covers the new `NavTabForRouteTest.kt`.
2. ✅ **Nav bar absent** only on: splash, login, OTP, maintenance wall,
   force-update. ❌ If it's missing anywhere else (cart, checkout, order detail,
   profile, wallet, settings, alerts, notifications, referrals, FAQ, about,
   saved/add/edit address, edit profile, delete-account, support, webview), that's
   a regression — the design wants it present on all of these now.
3. ✅ **Home / Search / any `aisle/...` screen** — Home tab highlighted on
   home/search, Categories tab on aisle. (Unchanged from before this phase.)
4. ✅ **Order detail** (`orderDetail/...`) — **Orders** tab highlighted, even
   though you got there from Home or a push notification.
5. ✅ **Wallet, Refer & earn, Settings, Alerts, Notifications, Edit profile,
   Delete account, Support, FAQ, About, in-app webview (Terms/Privacy)** — all
   highlight the **Profile** tab.
6. ✅ **Cart, Checkout, Order success** and anything else not covered above —
   **Home** tab highlighted (the fallback in `navTabForRoute`).
7. ✅ On the tab host itself (`main` route) tapping a tab still works exactly as
   before — the user's own tap wins, route-based highlighting doesn't override it.
8. ✅ **Cart FAB from Checkout** — tap it, land on the existing Cart screen (not a
   second Cart pushed on top of Checkout). Press Back from there — you should
   **not** loop back into Checkout's cart-adjacent state; back-stack should read
   as if you navigated to Cart normally.
9. ✅ **Cart FAB from Order success** (`orderSuccess/...`) — tap it, go to Cart.
   Press Back from Cart — you should land on **Home** (`main`), never back on the
   "order placed" success screen. This was the specific loop the fix targets:
   success screens must stay un-re-enterable by Back.
10. ✅ **Bottom padding cleanup** — Checkout's bottom action bar and Edit
    profile's "Save changes" button still sit correctly above the nav bar /
    system nav, now relying on the nav bar's own layout instead of a
    `navigationBarsPadding()` call removed from each screen. ❌ If either button
    is now hidden behind the system nav bar or the app's bottom nav pill, that's
    a regression from this cleanup — flag it, don't just re-add the modifier.

### Edge cases
- **Deliberate, not a bug**: tapping the cart FAB while mid-way through filling
  out a **new** delivery address inside Checkout discards that in-progress
  address form. Same behavior as backing out of any half-filled form elsewhere
  in the app. Test it explicitly so it doesn't get "fixed" later: open Checkout →
  Add new address → type a few fields but don't save → tap the cart FAB → the
  address form is gone, cart opens normally.
- Routes with no design counterpart (`deleteAccount`, `support`, `faq`, `about`,
  `webview`) follow their entry point and land on the **Profile** tab — this is
  a judgment call baked into `ProfileGroupRoutes`, not something the design spec
  states explicitly.
- `NoBottomNavRoutes` lists `splash`/`login`/`otp`/`maintenance`/`forceUpdate` as
  a **guard for future routes**, even though none of those five are actual
  `NavHost` routes today (they render above the NavHost or live in a separate
  auth graph). Don't be surprised the set looks unused if you grep the nav graph
  — it's intentionally defensive.

### Dropped from this pass
A planned "scroll padding" sweep across screens was **confirmed unnecessary**
after verification — the existing nav bar's layout already handles it correctly
everywhere except the two `navigationBarsPadding()` removals above. No further
padding changes were needed. Not a gap to revisit.

## Deploy
Both phases are **already on `dev`** (`d2ad773`, `3afd791`, `5a77cf4`) — direct
commits under the current git workflow, no PR/deploy step. Ships with the next
Android build.
