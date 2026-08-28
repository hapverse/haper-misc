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

## Phase C1 — Home screen restyle (2026-08-28, `dev@10c8a30`)

Restyles four existing Home pieces (banner carousel, wallet/referral row, header,
loading state) to the new design's glass/shadow language. **No new screens, no
backend calls changed** — banners and wallet balance still come from the same
data as before.

### What shipped
- **Banner carousel** — full-bleed card per page (the old 44dp side-peek is
  gone), radius 24dp, a real drop shadow (`bannerShadow`), and a 1dp green ring
  (`BannerWellRing`) drawn on top of the image, last, so the ring survives even
  when the image is full-bleed. Pagination dots animate width 7dp → 20dp and
  colour on the active dot over 250ms (`animateDpAsState` / `animateColorAsState`),
  instead of jumping between fixed sizes.
- **Wallet/referral row** (`WalletStrip`) — plain white `Surface` + flat shadow
  replaced with a 150° white→mint glass fill (`glassRowShadow` + `GlassMintPale`)
  and a 1dp white border, radius unchanged (21dp).
- **Header** (`HomeHeroCard`) — the store-name pill, the alerts button, and the
  search bar all moved from flat white/`shadow()` to the same glass-fill +
  dedicated shadow-helper pattern (`storePillShadow`, `headerIconButtonShadow`,
  `searchFieldShadow`). The alerts bell icon tint changed from `Color.White` to
  `GreenDeep` (`#20654E`). **No ETA/time text was added** — the design mock's
  eyebrow line is `"DELIVERING IN {storeEta}"`, but the app has no ETA field, so
  that slot keeps the design's font size/position and shows the delivery address
  instead (see the source comment at `HomeHeroCard`).
- **Loading state** — the old `homeVM.isLoading` branch was a full-screen
  40%-black scrim + centered dialog (spinner, "Finding your nearest store",
  syncing copy) that sat **on top of** the whole screen and ate all touch input.
  It's replaced by `HaperProductCardSkeleton` × 6 (`HAPER_SKELETON_CARD_COUNT`)
  laid out inline in the product grid — same card radius/padding/image-well/text-row
  geometry as a real `ProductCard`, so nothing reflows when real cards swap in.
  New condition: `homeVM.isLoading && homeVM.featuredItems.isEmpty()` — this is
  the fix for the address-change bug below. When no store is resolved yet, a
  "Finding your nearest store…" caption still shows above the skeleton grid.

### Steps
1. ✅ `./gradlew assembleDebug` passes.
2. ✅ **Cold start** — kill and relaunch the app. Before the store resolves, Home
   shows a shimmering **skeleton grid** (6 card-shaped placeholders, "Finding
   your nearest store…" caption above them) — **not** a spinner dialog and
   **not** a darkened/blocked screen. You can still scroll/tap the header,
   banners area, etc. while it loads.
3. ✅ When real data lands, the skeletons are replaced by actual product cards
   with **no visible layout jump** — card size/spacing should look identical
   before and after the swap.
4. ✅ **Regression check — change delivery address from Home** (switch store via
   the header pill, or change the saved address so a different store resolves):
   the skeleton grid **reappears** while the new store's data loads, then swaps
   to the new store's real cards. ❌ **This is the specific bug that was found
   and fixed during review** — previously, changing address cleared only
   `featuredItems`, but the loading condition was gated on category data too, so
   the *old* store's category tiles stayed on screen, stale and still tappable,
   with no loading feedback at all. If you see stale content with no skeleton
   during a store switch, this regressed.
5. ✅ **Banner carousel** — swipe through all banners. Confirm:
   - Full-width single-card-per-page (no sliver of the next banner peeking in).
   - Each banner has a visible 1dp **green edge ring** on top of the image.
   - A soft drop shadow under the card.
   - Pagination dots: the active dot is a wider rounded-rect (~20dp), inactive
     dots are small circles (~7dp); switching pages animates the width/colour
     change smoothly, it doesn't snap.
   - **Tapping a banner** does the right thing depending on how it's configured
     in the backend: `category` type opens that category, `item` type opens
     that item's detail screen, `url` type opens the system browser, and
     `internal-url` type opens an in-app Custom Tab (not the system browser).
     ❌ If a banner does nothing on tap, check its `actionType`/`actionValue` in
     the backend banner config first — this is a data issue, not new client logic.
6. ✅ **Header — no delivery-time text, ever.** Check all three states: before
   any store is resolved (cold start / "Finding your nearest store…"), after a
   store resolves normally, and when location permission is needed/denied. In
   none of these should you see a time estimate like "10 minutes" or "10 mins"
   anywhere in the header. This is a deliberate product rule (the app never
   promises a delivery time it can't guarantee) — flag it as a bug, not a
   missing feature, if a time ever appears.
7. ✅ **Alerts bell** (top-right of header) is **dark green**, not white. ❌ If
   it's still white, the icon tint didn't pick up `GreenDeep`.
8. ✅ **Wallet row tap** — tapping the "Haper Wallet · ₹{balance}" row navigates
   to the Wallet screen (unchanged behavior, just the new glass-card look).
9. ✅ Store-name pill and search bar in the header both show the glass
   (white→pale-mint gradient) look with a thin white border, matching the
   wallet row and banner treatment — not a flat white fill.

### Edge cases
- **The address-change skeleton bug (caught in review, not shipped broken)**:
  the loading condition was originally going to key off whichever data field
  emptied first per section (categories vs. featured items), which meant an
  address change — which only clears `featuredItems`, not `categories` — would
  leave old category tiles on screen with no loading indicator. The fix scopes
  the skeleton to `isLoading && featuredItems.isEmpty()` specifically so it
  fires on every store re-resolve, cold start or mid-session. Test step 4 above
  is the direct regression check for this; don't skip it.
- The skeleton's TalkBack label ("Loading products") is only announced once
  per batch — the first placeholder card carries it, the other five are
  silent — so a screen reader doesn't say "loading" six times in a row.
- Banner `HorizontalPager` no longer has trailing `contentPadding`, so the old
  "next banner peeks in on the right" affordance is gone by design — the dots
  now carry the "there's more" signal instead.

---

## Phase C2 — Store picker + floating cart bar (2026-08-28, `dev@5a19e9c`)

Two independent presentation-only changes. **No ViewModel, data-model, API or
navigation change** — the same store list, the same `selectStore()` call, the
same cart totals as before.

### What shipped
- **Store picker is now a bottom sheet, not a dropdown menu.** Tapping the store
  name in the Home header (only possible when more than one store serves you)
  opens a "Choose a store" sheet from the bottom of the screen instead of a small
  grey menu anchored to the header. Each store is a white card with a shop-front
  icon tile, the store name, its address underneath, and — on the store you're
  using right now — a small teal gradient tick on the right. Picking a store does
  exactly what the old menu did.
  - **Caught in review before this shipped**: the first version of the sheet
    laid the store list out as a plain `Column`, which doesn't scroll — with 7+
    stores the rows past the visible sheet height would have been unreachable,
    with no indication more existed. Fixed by wrapping the list in its own
    scrollable `Column` (`weight(1f, fill = false)` + `verticalScroll`) inside
    the sheet, so the title/subtitle stay pinned and only the store list scrolls.
- **Floating "View cart" bar restyled.** Same bar, new look: dark-green 120°
  gradient (`#1E3A30 → #2F6250`), radius 22dp, soft green shadow, and the amount
  on the right in mint (`#8FE8D9`). All colours/radii now come from theme tokens
  — the file previously had none.
- **Cart-bar subtitle carries no delivery time.** The design's line is
  `{eta} · {storeName}`; the app shows the **store name only** (and
  "Ready to check out" when no store name is known), the same override the Phase
  C1 header used.
- Cart bar now announces itself to TalkBack as one control
  ("View cart, 3 items, total ₹540, <store>") instead of four separate texts.

### Steps
1. ✅ `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` pass (383 tests,
   0 failures).
2. ✅ **Open the store sheet** — on Home, tap the store name in the green header.
   A sheet slides up from the bottom titled "Choose a store" with the subtitle
   "Stock and prices vary by store." ❌ If a grey dropdown appears anchored under
   the header instead, the old menu is still in place.
   - Note: the store name is only tappable when **two or more** stores serve your
     address. With one store, tapping still opens the address screen (unchanged).
     This whole section is only testable end-to-end on a test account whose
     delivery address is served by 2+ stores — check the account's serviceable
     stores first if the pill doesn't respond to a tap.
3. ✅ **Current store is marked** — the store you're on has a teal circular tick
   on the right, a green outline and a slightly deeper mint icon tile. The others
   have a pale hairline outline and no tick.
4. ✅ **Switching works** — tap another store. The sheet closes, the header store
   name changes, and Home reloads that store's categories/products (the skeleton
   grid from Phase C1 should appear while it loads).
5. ✅ **Dismissing does nothing** — open the sheet, then swipe it down / tap the
   dark area above it / press Back. The sheet closes and the store is unchanged.
6. ✅ **Rotate with the sheet open** — the sheet stays open after rotation.
6b. ✅ **Long list scrolls** (only testable with a test account serving **7+**
   stores — this is the specific bug fixed during review, see above): open the
   sheet, and confirm the "Choose a store" title/subtitle stay fixed at the top
   while the store list underneath scrolls. Scroll to the very last row and
   confirm it's fully visible and tappable, not cut off by the sheet's bottom
   edge or the system nav bar. ❌ If the sheet doesn't scroll and stores below
   the fold are unreachable, this is the exact regression from the pre-review
   version.
6c. ✅ **Kill the app with the sheet open** — enable Android Developer Options →
   "Don't keep activities", open the store sheet, then background the app (Home
   button) so the OS destroys the process, and reopen it from the app switcher.
   The app should resume showing Home normally, with the sheet either **closed**
   or, if it does restore mid-restart, showing the same store list correctly —
   not a blank/frozen sheet.
7. ✅ **Cart bar look** — add an item to the cart, then look at the bar floating
   above the bottom nav on Home. Dark-green gradient left-to-right, rounded 22dp
   corners, a count pill on the left, "View cart" in white with the **store name**
   above it, and "₹<amount> →" on the right in **mint**, not white.
8. ✅ **No delivery time on the cart bar** — the small line above "View cart"
   must never read something like "10 mins · Chapra Store". Store name only.
   Flag any time estimate as a bug, not a missing feature.
9. ✅ **Where the cart bar shows** (unchanged from before): Home, Categories,
   Search and an Aisle/category listing. It should **not** float on Orders,
   Profile, Cart or Checkout. It also still appears above the add-to-cart bar on
   the **item detail** screen — that is pre-existing behaviour, not new.
10. ✅ **Regression — tapping the cart bar** opens the Cart screen from every
    screen that shows it.

### Edge cases
- **No CLOSED chip was built.** The design shows a red "CLOSED" badge on stores
  that aren't currently open. Android has **no open/closed information per
  store** — `StoreModel` only carries id/name/address/mapUrl, and nothing else on
  the client knows a store's hours. Rather than invent it, the chip is left out.
  It needs a backend field on the nearest-store response first. ❌ Don't file
  "CLOSED chip missing" as a UI bug.
- The sheet's subtitle is deliberately "Stock and **prices** vary by store", not
  the design's "Stock and **delivery time** vary by store" — the app never quotes
  a delivery time anywhere, so promising one in the sheet copy would break the
  same rule as step 8.
- The per-store row border and icon-tint in the design mock are bound to
  variables the prototype never defines; selection drives both here (brand green
  + deeper mint on the active store).
- Store cards are ~64dp tall, above the 48dp minimum touch target, and each row
  reads as one TalkBack item.

---

## Phase D — Browse + discovery (2026-08-29, `dev@215c635`)

Restyles the Categories, Aisle listing, Search and product-card screens to the
new design's glass/shadow language, and fixes one real bug found along the
way. **No ViewModel, API or navigation change** — same category/search data,
same cart logic as before.

### What shipped
- **All Categories screen** (`AllCategoriesScreen.kt`) — restyled to the new
  colors/shadows/spacing tokens. Stays a **single-column scrollable list** —
  checked against the real design source and confirmed a grid is *not* the
  intended layout here (Phase A's "Known gaps" note above, about a separate
  all-categories screen not existing in the app's IA, is unrelated: this is
  the existing Categories tab, restyled in place).
- **Aisle listing screen** (`AisleListingScreen.kt`, the subcategory rail
  inside a category) — subcategory filter chips and the "Under ₹50" filter
  restyled with the new shadow/colour tokens. Selected state is now visually
  distinct: **mint background, green border and green text**, versus a plain
  white/hairline chip when unselected.
- **Search screen** (`SearchScreen.kt`) — **a real bug was found and fixed**:
  the search input box was clipping the placeholder text ("Search for milk,
  atta, fruit…") vertically, cutting off the top/bottom of the letters. The
  field was rebuilt and now renders the full placeholder correctly.
- **Product cards** (`ProductCard.kt`, `ItemCard.kt` — shared by Home, Aisle
  listing and Search) — visual token/shadow pass, plus a visible fix: the
  in-cart quantity stepper ("− 1 +", shown once an item is in the cart) is now
  a **pill/lozenge shape**, noticeably rounder than the plain "+" add button
  shown on items not yet in the cart. The two controls are meant to look
  different — this matches the design spec.

### Steps
1. ✅ `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` both pass.
2. ✅ **Categories tab** — open it. Confirm it's still a **single-column list**
   (not a grid), with the new card styling (updated colours/shadows/spacing).
   Tap into any category — it opens the aisle listing as before. ❌ If it's
   rendered as a grid, that's a regression against the design source, not the
   intended change.
3. ✅ **Inside an aisle/category** — tap a subcategory filter chip: it turns
   **mint background with a green border and green text**; unselected chips
   stay plain. Tap "Under ₹50": same selected treatment. Tap it again to
   clear it — it returns to the unselected look and the full list returns.
4. ✅ **Search tab** — tap the search field. The placeholder "Search for milk,
   atta, fruit…" must render **fully, top and bottom of every letter visible**
   — no clipping. ❌ If the top or bottom of the text is cut off, this is the
   exact bug this phase fixed; flag it as a regression, not a known gap.
5. ✅ Type a query — results still return (data path unchanged). Tap a recent
   search chip (if any are present from prior searches) — it re-runs that
   search.
6. ✅ **Search result rows still look old-style** — this is a **known gap**,
   not a bug. Only the search field itself and the empty-state panel were
   restyled this phase; the row layout (image well, name, weight, price,
   add/stepper) still uses the pre-revamp styling. Do not report this as a
   missed restyle — it's flagged for a later phase below.
7. ✅ **Stepper roundness** — add an item to the cart from any product grid
   (Home, Aisle listing, or Search results). Look at that same item's card
   again: the "− 1 +" stepper control is now clearly **more rounded (pill
   shape)** than the plain "+" add button shown on other, not-yet-added items
   on the same screen. Compare the two side by side on one screen if possible
   — the shape difference should be obvious, not subtle.
8. ✅ **Cross-screen consistency** — repeat step 7 on Home and on Search
   results, not just Aisle listing. All three surfaces share the same
   `ProductCard`/`ItemCard`, so the stepper shape should look identical
   everywhere an item is in the cart.

### Known gaps (NOT done)
- **Search result rows** — still the old, pre-revamp row styling. Only the
  search field and empty states were restyled this phase. Flagged for a later
  phase; don't confuse this with "search is fully done."

---

## Phase E1 — Product Detail + Coupons (2026-08-29, `dev@2cd1bdd`)

Restyles the Item Detail and Offers (coupons) screens to the new design's
glass/shadow language, and fixes **two real bugs** found along the way.
**No ViewModel, API or navigation change** — same item data, same
add-to-cart/coupon-apply logic as before. **Cart screen is explicitly out of
scope** for this phase — it has separate, unrelated work in progress from
another session and was deliberately left untouched; don't test Cart changes
against this section.

### What shipped
- **Bug fix — "Total" label was stacking vertically.** The price block beside
  the "Add to Cart" button had `weight(1f)` while the button itself was an
  unweighted child of the same `Row`. `HaperPrimaryButton` lays its content out
  in a `fillMaxWidth()` inner `Row`, so as an unweighted sibling it got measured
  against the *whole* bar width and claimed all of it — leaving the weighted
  price column 0dp wide, which wrapped "Total" and the price to one
  character/digit per line, partly hidden behind the button. Fixed by making
  the price column intrinsic-width and giving the CTA the weight instead, so
  neither can starve the other.
- **Bug fix — hero image showed an unwanted white box behind non-white
  products.** The product photo's multiply-blend (used so the photo reads
  correctly against the screen's tinted background) had its offscreen
  compositing layer on the *image itself*. That meant the blend's backdrop was
  the image's own empty layer, not the real screen surface behind it — so the
  photo's white JPEG ground survived as a visible white rectangle instead of
  disappearing into the background. Fixed by moving the `CompositingStrategy
  .Offscreen` layer to the `Box` that contains the hero image, and painting the
  real surface colour (`SurfaceApp`) inside that same layer before the image is
  drawn, so the multiply blend has the right backdrop.
- **Item Detail — rest of the screen restyled**: no app bar; back/cart buttons
  now float over the hero image itself (which scrolls with the content,
  per the design's `.dc.html:426-433`). Category/subcategory label, product
  name in Quicksand, veg/non-veg mark (logic unchanged — still only shown when
  the item actually carries diet-type data), stock label, price row with
  "Save ₹N" and "% OFF" badges, unit-price line, and the quantity stepper (cap
  at 6, per README §3.11/§4 — unchanged cap logic).
- **Coupons/Offers screen restyled**: coupon-code entry field and "Apply"
  button on the new glass token set, and each coupon card's decorative
  circular **notch** cut into its left/right edges. The notch itself already
  existed (`BlendMode.Clear` punching a hole via an offscreen compositing
  layer) — this pass added the **1px hairline ring** around each notch
  (`.dc.html:633`) that the original version didn't draw, plus moved the
  notch's diameter to a shared `HaperDimens` token.
- New `Dimens.kt`/`Shadows.kt` tokens: `itemHeroHeight`, `couponNotchDiameter`,
  `stickyBarShadow`, `stickyStepperShadow`, `infoTileShadow`, `glassRowShadow`
  (shared file also touched by Phase C1/C2 — additive only, no existing token
  changed value).

### Steps
1. ✅ `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` both pass.
2. ✅ **Open any product's detail page** — near the "Add to Cart" button, the
   "Total" label and the price render as **normal horizontal text**, fully
   visible, not stacked into single letters/digits and not cut off behind the
   button. ❌ If you see vertically-stacked characters or the price hidden
   under the CTA, this is the exact bug this phase fixed — regression.
3. ✅ **Product photo** — confirm it displays with no odd white rectangle
   behind it, on **both** a white-background product photo and a non-white one
   (a coloured pouch/bottle is the best test — the bug only showed on
   non-white photos). ❌ A visible white box behind the photo edges is the
   second bug this phase fixed — regression.
4. ✅ **Back/cart buttons** float directly over the hero image (no app bar
   above it), and the hero scrolls with the rest of the content.
5. ✅ Category/subcategory label, product name, stock label, price with
   "Save ₹N" / "% OFF" badges, and unit-price line all show the new styling.
6. ✅ **Veg/non-veg mark** — only appears when the item actually has diet-type
   data (unchanged logic, just restyled). ❌ Don't expect it on items with no
   diet-type field — that's correct, not a gap.
7. ✅ **Add to cart from this screen** — tap "Add to Cart", confirm the
   quantity stepper appears and works (+ / −), and caps at **6** — the "+"
   button disables past 6.
8. ✅ **Go to Coupons/Offers** (from Cart) — the code entry field and "Apply"
   button show the new glass styling.
9. ✅ **Coupon card notch** — each card has a small circular notch cut into
   both its left and right edges, each with a thin **1px ring outline**
   (`BorderHairline`) around the cutout. ❌ A notch with no visible ring, or no
   notch at all, is a regression against this pass.
10. ✅ **Apply a real coupon code** — confirm it still applies correctly
    (discount reflects, success/error messaging is the same as before). This
    pass is visual only; functionality is unchanged.
11. ❌ **Cart screen** — not part of this phase. If you spot something odd on
    Cart itself, don't report it against E1 — it belongs to the separate,
    in-progress session mentioned above.

### Edge cases
- Both bugs were pre-existing (not introduced by an earlier revamp phase) —
  they predate this restyle pass and were caught while touching this screen,
  not caused by it.
- The hero's multiply-blend fix only works because the offscreen layer and the
  `SurfaceApp` background are painted on the **same** `Box` — if the layer
  modifier and the background colour ever get split across different
  composables again, the white-box bug can come back silently (it won't fail a
  build or test, only look wrong on device).
- The coupon notch's hole-punch (`BlendMode.Clear`) still needs
  `CompositingStrategy.Offscreen` on the card's own `Box`, same pattern as the
  hero image fix — the ring is drawn as a second pass after the hole so it
  isn't erased by the same clear.

---

## Phase F — Checkout + address (2026-08-29, `bfd4d26`)

Restyles the payment screen, the delivery-slot picker, the payment-failed
screen, the saved-address list, the add/edit-address form and the full-screen
map picker to the new design's glass/shadow language. **Money-adjacent screens
are presentation-only** — no ViewModel, repository, API or navigation change,
and **not one payment-availability rule was touched**. **Cart screen remains
out of scope** (separate in-progress session).

### What shipped
- **Payment screen (§3.16)**: new header ("Payment" + "₹N to pay") on the page
  background with a hairline; the delivery address is now a glass summary row
  with a "Change" link; uppercase section eyebrows ("DELIVERY SLOT", "HAPER
  WALLET", "PAY USING"); the payment methods are the design's list rows —
  40dp icon tile, name + one quiet line, a 1.6dp outline that turns green when
  chosen, and a teal ✓ disc; a Razorpay reassurance line; and a "Bill summary"
  card on the design's deepest shadow. The CTA moved to a sticky footer on the
  app background (label left, arrow right) instead of a raised white sheet.
- **🚨 COD availability is unchanged.** COD is still gated *only* by the
  server's schedule `allowedPaymentMethods`. The design mock's flat "COD is
  blocked above ₹2,000" rule is an agreed business-rule override and is
  **deliberately not implemented**. The disabled COD row now states the reason
  in more readable text than before, but the rule behind it is identical.
- **Delivery-slot picker (§3.15)**: one shared slot card for the now/schedule
  choice, the date strip and the time-slot grid — radius 17dp, 1.6dp outline,
  14sp Quicksand title, 10.5sp subtitle, selected changes both fill and
  outline. Availability still comes only from the server; unavailable slots
  are greyed **with the reason in words**, never colour alone.
- **Payment failed (§3.17)**: the summary card (Amount / Reference in
  monospace / Reason) moved onto the design's glass panel + shadow.
- **Saved addresses (§3.14)**: dashed "Add a new address" card, "SAVED
  ADDRESSES" eyebrow, address cards with a 38dp icon tile, a DEFAULT chip and
  the teal ✓ on the current address. View / Edit / Delete / "Deliver here"
  actions are all still there.
  - **Bug fix — button alignment + text cut-off in "Manage addresses" mode.**
    On the Profile → Saved Addresses screen (management mode, as opposed to
    the checkout picker), the View/Edit/Delete row was sometimes misaligned
    against the address text above it, and long address text was clipped
    more aggressively than intended. Both are fixed by the same card rebuild
    that restyled this screen — the action row now aligns consistently and
    address text truncates sensibly (ellipsis, not a hard cut mid-word).
- **Add/edit address (§3.14/§3.15)**: the 290dp map area moved to the top of
  the screen with a white "Move pin" chip; below it a glass card that says in
  words whether the location is confirmed, approximate-from-PIN, or not set;
  then the form as 50dp white fields with a 1.4dp outline and **⚠ inline
  validation** in Danger; "Save as" pills; and the Save button moved from the
  app bar to a sticky "Save address" footer.
- **The save gate is unchanged**: an unconfirmed coordinate still opens the map
  picker instead of saving, and the phone's GPS is still never grabbed on the
  user's behalf.
- **Map picker**: white map controls and a proper bottom sheet for the
  coordinate + "Confirm location".
- New additive tokens only: `panelShadow`, `billSummaryShadow`,
  `mapControlShadow`, plus `addressCard`, `paymentMethodRow`,
  `billSummaryCard`, `formFieldHeight`, `addressMapHeight`, `borderSelected`,
  `borderField`. New shared `HaperSelectedCheck` component (the teal ✓ used by
  both the payment list and the address list).
- **Payment logic itself was reviewed and confirmed unchanged by a payments
  specialist** as part of this pass: COD availability still comes only from
  the schedule's `allowedPaymentMethods` (never a rupee threshold), the
  Razorpay online-payment flow is untouched, and wallet-balance auto-apply on
  checkout is untouched — this phase is presentation-only around all three.

### Steps
1. ✅ `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` both pass.
2. ✅ **Cart → Checkout** — header reads "Payment" with "₹N to pay" beneath it;
   the address row, slot cards and payment rows all show the new styling.
3. ✅ **Pay using** — tap between "Online Payment" and "Cash on Delivery": the
   chosen row gets a green outline and the teal ✓, the other loses both.
4. ✅ **Schedule a delivery** — tap "Schedule", pick a date and a time slot.
   Unavailable dates/slots stay greyed **and say why** ("Unavailable", "Full",
   "Too soon", "Closed"). ❌ A greyed card with no word on it is a regression.
5. ✅ **COD with a scheduled order** — after picking a scheduled slot, the
   "Cash on Delivery" row goes disabled and reads "Not available for scheduled
   orders". ❌ If COD is disabled for any *other* reason — especially an order
   value threshold — that is a bug: no such rule exists in this app.
6. ✅ **COD with an immediate ("Now") order** — COD is selectable, whatever the
   order total. Place a **₹2,000+** COD order end to end to prove it. ❌ COD
   being blocked on a large "Now" order is the exact regression to watch for.
7. ✅ **Place a real order both ways** — COD and online (Razorpay) — and
   confirm both still complete and land on the order-success screen exactly as
   before. For the online order, follow the Razorpay sheet all the way
   through (not just to the point it opens) to confirm the end-to-end flow
   still works.
7b. ✅ **Wallet balance toggle** — with a test account that has wallet
   balance, toggle "Use Haper Wallet" on the checkout screen. The applied
   amount appears in the bill and "To pay" drops accordingly, same as before
   the restyle — only the visuals changed.
8. ✅ **Bill summary** — Items / coupon / Delivery / Platform fee / Wallet
   applied / "To pay" all show the same numbers as before the restyle.
9. ✅ **Checkout → Change address** — the address list opens with "Step 1 of 2 ·
   then payment", the dashed "Add a new address" card, and the current address
   carrying a DEFAULT chip and a teal ✓. Tapping a card selects it and returns.
10. ✅ **Profile → Saved Addresses** — same screen in management mode; "Deliver
    here", View, Edit and Delete are all present on each card and still work.
    Check the View/Edit/Delete row on **every** saved address card, especially
    ones with a long address line: the three actions stay evenly aligned and
    the address text truncates with an ellipsis instead of being cut off
    mid-word. ❌ Misaligned action buttons or awkwardly clipped text is the
    exact bug this phase fixed — regression.
11. ✅ **Add an address** — the map sits at the top; typing a valid 6-digit PIN
    still jumps the pin to that area and the card says "Approximate — not yet
    confirmed" naming the PIN. Tapping the map (or "Move pin") opens the
    full-screen picker; "Confirm location" flips it to "Confirmed location".
12. ✅ **Save with empty required fields** — each bad field turns pink and
    shows a "⚠ <reason>" line beneath it.
13. ✅ **Save with an unconfirmed location** — the map picker opens instead of
    saving, and the address is only saved after you confirm a spot. ❌ Saving
    straight away, or the pin silently jumping to *your own* current location,
    is a serious regression.
14. ✅ **Village/locality dropdown** — still opens the store's village list and
    picking one fills the field and clears its error.
15. ✅ Scroll every one of these screens to the very bottom — nothing is hidden
    behind the sticky button or the bottom nav bar.

### Known gaps (NOT done)
- **"Place Order" button text for COD orders is shorter than the design.**
  The mock's CTA reads "Place order · Pay on delivery"; the app's button
  currently shows a shorter label with no "Pay on delivery" suffix. Cosmetic
  only — the order still places correctly either way. Flagged for a later
  phase; don't report it as a functional bug.

### Edge cases
- **Builds without a Google Maps key**: the map area and the "Move pin" chip
  disappear entirely, the header strapline changes to "Capture your exact spot
  with GPS", and a "Capture location" / "Refresh current location" button is
  the way to set the coordinate. Verified on a deliberately keyless build.
  ❌ A blank grey rectangle where the map should be, or no way at all to set a
  location, means this fallback broke.
- The payment-failed screen is only reachable after a genuinely declined or
  cancelled gateway payment, so it was verified by code review rather than on
  device — worth an eyeball next time a test payment is cancelled at the
  Razorpay sheet.
- The address card hides the contact name when the address has a nickname
  ("Home"/"Work"), matching the design. Unlabelled addresses still show the
  name, so no address is ever nameless.

---

## Phase G1 — Orders list + Order Success (2026-08-29, `dev@d28b498`)

Restyles the Orders list (Active/Past tabs) and the Order Success confirmation
screen to the new design's glass/shadow language, and fixes one real bug found
along the way. **No ViewModel, API or navigation change** — same order data,
same checkout/order-placement logic as before. **Order Detail (tapping into a
specific order) and the cancel-order flow are explicitly out of scope** — a
separate follow-up phase (G2), not built yet.

### What shipped
- **Orders list restyled** — order cards on the new shadow/colour tokens: order
  ID, a status pill (e.g. "Cancelled", "Order Placed"), up to 3 item
  thumbnails, price, and a "Track order ›" / "View details ›" link depending
  on order state.
  - **Bug fix — "+N" extra-items badge.** The badge that shows how many items
    beyond the first 3 thumbnails an order has was counting only items that
    *had* a product photo, so orders with 4+ items where some items lacked a
    photo either undercounted the badge or made it disappear entirely. It now
    counts off the order's **total item count**, not the subset with photos.
  - **Bug fix — last card hidden behind the bottom nav.** The last order card
    in a long list sat partially behind the floating bottom nav pill; the list
    now has correct bottom spacing so the last card clears it.
  - **Bug fix — empty state placement.** The "no orders yet" empty state (both
    Active and Past tabs) wasn't clear of the bottom nav and wasn't properly
    centred; it now sits centred in the visible area above the nav.
- **Order Success screen** — the teal checkmark circle now uses the design's
  exact shadow/gradient plus a subtle **pulsing glow** animation around it.
  Still **no delivery-time estimate anywhere** on the screen — same app-wide
  no-invented-ETA rule as every other phase.

### Steps
1. ✅ `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` both pass.
2. ✅ **Orders tab** — Active/Past toggle switches correctly. Cards show the
   new shadow styling, order ID, status pill and thumbnails.
3. ✅ **Order with 4+ items where some lack product photos** — the "+N" badge
   shows the correct remaining count (total items − 3), not undercounted and
   not missing. ❌ A missing badge or a count that ignores photo-less items is
   the exact bug this phase fixed — regression.
4. ✅ **Scroll to the last order in a long list** — the card is fully visible,
   not hidden behind the bottom nav pill. ❌ A partially-obscured last card is
   a regression.
5. ✅ **Empty state** (reachable on a test account with no orders, on either
   tab) — "no orders yet" is centred in the visible area, clear of the bottom
   nav, and the screen doesn't scroll.
6. ✅ **Place a real order** — Order Success shows the teal checkmark with a
   soft pulsing glow, "Order placed", the order ID, and **no delivery-time
   text anywhere** on the screen.
7. ❌ **Order Detail (tap into a specific order) and cancel-order** — not part
   of this phase. Don't report Order Detail's old layout or the cancel flow
   against G1 — that's phase G2.

### Known gaps (NOT done)
- **"Browse the store" button on the empty orders screen** — present in the
  design mock, not wired up this phase. Needs a small additional bit of
  navigation wiring. Tracked as a follow-up, not a regression.
- **Order Detail screen and the cancel-order flow** — deliberately excluded
  from this phase; both still use the old, pre-revamp layout/behaviour. That's
  phase G2.

---

## Phase G2 — Order detail + cancel window (2026-08-29, `dev@f3a1fb6`)

The second half of Orders: the **order detail screen** you land on when you tap
an order, and the **cancel-order reason sheet**. This is the phase the plan
flagged as the riskiest of the whole revamp, because the same screen carries the
cancel window, the invoice download, and it's where a delivery push notification
opens.

**The one rule of this phase: nothing about *whether* you can cancel changed.**
Only how the cancel window *looks*. There are two separate things that were
easy to confuse and were kept strictly apart:
- a **normal order** gets a 60-second free-cancellation countdown after you
  place it, and
- a **scheduled-delivery order** gets its own, much longer window that the
  server decides.

Neither rule was touched — only their paint.

### What shipped
- **Status hero** at the top: a tinted well with a round status disc, the
  status name in its own colour, and when it was ordered. A delivered order
  gets the teal gradient disc from the design; a cancelled one stays red, a
  refunded one stays purple — the colour follows the real status instead of
  being fixed.
- **Live status stepper** — replaces the old flat 5-segment progress bar with
  a vertical timeline: a teal ✓ on every stage already passed, a **green
  pulsing dot** on the stage the order is on right now, grey for what's still
  ahead, joined by a hairline rail. The five stage names are the app's own
  existing status names (Order Placed / Assigned / Processing / Out for
  Delivery / Delivered) — **no new wording was invented**.
- **Cancel window card** — the countdown is now its own card: "Free
  cancellation window" with a large green `0:26` clock, a green progress bar
  that drains as the seconds tick, the remaining-seconds line, and an outlined
  red "Cancel order" button. Same 60 seconds as before, same disappearing act
  when it runs out.
- **Items, Bill, address, rider, refunds, short-pick changes** — all moved onto
  the revamp's glass cards with section headings (ITEMS / BILL / DELIVERY
  ADDRESS / …). Items get the design's 46dp product tile, "300 g · Qty 1" line
  and struck-through MRP with a "% OFF" tag. The bill's last line is now
  "**Paid**" in bold.
- **Cancel reason sheet** — restyled to match the app's other bottom sheets
  (rounded top, glass panel, drag handle) with the design's own rounded reason
  rows and green radio buttons. **Wording is unchanged**: still "Cancel
  Order?", "Yes, Cancel" and "No".
  - **Bug fix — unselected reason rows were see-through.** The rows weren't
    fully opaque, so the order detail screen behind the sheet bled through
    them slightly. Now solid white, as the design intends.
- **Accessibility fix — the "No" (dismiss) button.** It was implemented as a
  selectable option, so TalkBack announced it as a toggle you "select" rather
  than a button you tap, and its hit area was under the standard minimum tap
  target. It's now a proper button: announced correctly by screen readers and
  meets the minimum tap-target size.
- **Bug fix — content hidden behind the bottom nav.** The bottom of the order
  detail screen (the invoice button / cancel card) sat under the floating nav
  pill. It now has the correct clearance.

### Steps
1. ✅ `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` both pass.
2. ✅ **Open any order from the Orders tab** — status hero, stepper, address,
   ITEMS and BILL cards all render on the new styling. Scroll to the very
   bottom: nothing is hidden behind the bottom nav pill. ❌ Anything cut off at
   the bottom is a regression.
3. ✅ **The stepper's live dot pulses** (a soft green glow that breathes) and
   the rail visibly connects each dot to the next. Stages already passed show a
   teal ✓.
4. ✅ **Place a fresh Cash-on-Delivery order, then open it within 60 seconds** —
   the "Free cancellation window" card is there, the clock counts *down*, and
   the green bar shrinks in step with it.
5. ✅ **Wait for the clock to hit 0:00 without touching anything** — the whole
   cancel card disappears and the rest of the screen is unaffected. ❌ A stuck
   clock, a card that lingers past zero, or a card that never appears at all is
   a regression of the cancel window itself, not the styling.
6. ✅ **Tap "Cancel order" inside the window** — the reason sheet opens on the
   new styling: 7 reasons, each a rounded row with a green radio. Rows are
   **solid white**, not see-through. ❌ Being able to read the order screen
   through the reason rows is the exact bug fixed during this phase.
7. ✅ **Pick "Other"** — a "What went wrong?" note box and a `0/180` counter
   appear, and **both "Yes, Cancel" and "No" stay reachable at the bottom**,
   even with the keyboard open. ❌ Buttons pushed off-screen is an old bug (F1)
   that must not come back.
8. ✅ **Tap "No"** — the sheet closes and **the order is still active**, not
   cancelled. With TalkBack on, "No" is announced as a button, not a selection
   toggle, and its tap target meets the standard minimum size.
9. ✅ **A delivered order** — shows the teal disc, all 5 stages ✓/passed, the
   star rating card, and a full-width "Download invoice" button that actually
   downloads. ❌ The invoice button appearing on a *non-delivered* order is a
   regression — it is delivered-only, unchanged.
10. ✅ **A scheduled-delivery order** — its own "Scheduled delivery" card with
    the booked slot, the change/cancel deadlines, and "Change slot" / "Cancel
    order" buttons appearing exactly as often as they did before. ❌ A button
    appearing or disappearing versus the old build is a regression — the rule
    behind it was deliberately not touched.
11. ✅ **Tap an order push notification** — it still opens straight to that
    order's detail screen.

### Edge cases
- **The 60-second cancel-window logic itself was not touched** — verified
  byte-identical by an independent code review. Only its visual appearance
  (colours, timer display, progress bar) was restyled this phase. If the
  countdown's actual timing/behaviour looks wrong, that's a pre-existing issue,
  not something this phase introduced.
- **Note for testers**: dev now carries 2 extra orders left over from this
  phase's verification — `HP45199080` and `HP47489081`. Both are still active
  (not cancelled). Safe to ignore, or clean up if they get in the way of
  another test pass.

### Known gaps (NOT done)
- **"Reorder" button.** The design's footer pairs "Download invoice" with a
  "Reorder" button. The app has no reorder feature, so the invoice button takes
  the full width instead. Reorder is a real feature, not styling — separate
  work.
- **Map / rider-on-a-map panel.** The design's tracking screen shows a live map
  with rider and store pins. There is no live rider location available, so this
  was not built rather than faked.
- **"₹20 restocking fee" line.** The design's cancel card warns about a ₹20 fee
  after the timer ends. Haper has no such fee, so that sentence was left out.
- **Per-stage timestamps** under each stepper stage ("6 of 3 items picked…").
  No per-stage time data exists on the order, so the stages show names only.

---

## Deploy
Phases A, B, C1, C2, D, E1, F, G1 and G2 are **all on `dev`** (`d2ad773`,
`3afd791`, `5a77cf4`, `10c8a30`, `5a19e9c`, `215c635`, `2cd1bdd`, `bfd4d26`,
`d28b498`, `f3a1fb6`) — direct commits under the current git workflow, no
PR/deploy step. Ships with the next Android build.

(`b6123b4` "added code" also landed on `dev` around the same time, just before
Phase G2 — that's a cart-formatting fix from a separate, concurrent session,
unrelated to this revamp.)
