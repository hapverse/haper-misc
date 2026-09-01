# Test — iOS "Haper Green" re-skin (customer app)

**Area:** haper-ios (customer app) — the whole app re-skinned from the old blue theme to the
new green design system, per the `Haper Green Screens` design handoff (all 31 screens).
**Branch:** `dev` (haper-ios). Landed over three passes: `e276a2f` (theme, components, auth,
home, categories), `a297afc` (product/cart/checkout/orders/profile/error states), and a final
pass that finishes the account/support/schedule surfaces and **deletes the legacy blue
`AppTheme`** — pending commit at time of writing, so re-check `git status`.
**Deploy:** iOS-only, code change. Needs an app build/install (simulator or device) to test —
no backend/shared-package/Android/web change touched by this pass.

## What changed (this pass)

**Theme layer** — new colour/font/spacing/radius/shadow tokens (`haper/Utils/HaperColors.swift`,
`HaperFonts.swift`, etc.), Poppins (body) + Quicksand (headings) bundled, app locked to **light
mode only**.

**New shared components** — `HaperProductCard` (used on Home/Aisle/related-items),
`HaperCategoryTile` (3-photo composite category tile).

**Screens re-skinned:** Splash, Login, OTP, Home, Search, Categories (restructured — see below),
Product Detail, Cart, Coupons.

**Categories tab restructure** — was one combined sidebar+content screen; is now two real
screens: `AllCategoriesView` (16-tile grid) → tap a tile → `AisleListingView` (subcategory
chips + new sort control [Relevance / Price low-high / Price high-low] + new "Under ₹50" filter
+ product grid). Two bug-fix rounds happened here during testing — see Edge cases, they are the
highest-value regression checks in this guide.

**Product Detail / Cart / Coupons correctness fix** — price-per-unit and discount badges now
use only server-authoritative / server-validated data (see §5 below).

**Final pass (this session) — the last blue surfaces.** Everything below moved onto the green
tokens, and the legacy `haper/Utils/AppTheme.swift` was then **deleted outright** so nothing can
drift back:

- Help & support, FAQs, About Haper, Edit profile, Delete account, Restore account
- Cancel-order reason sheet, the shared radio row it uses (`PaymentOptionRow`)
- Floating "View cart" bar, tab-bar tint, in-app web view (privacy/T&C pages)
- Scheduled-delivery slot picker (date strip, slot grid, skeleton) + the order-detail
  "Change slot" card
- Free-gift components — the Material green/amber palette was remapped onto the Haper
  teal/warning ramps

Dead blue code removed in the same pass: the unused `ItemCard` product card (superseded by
`HaperProductCard`; its file is now `FeaturedItemsSection.swift`) and the unused
`FloatingCartView`.

## NOT in scope for this guide

Nothing in the design handoff is left on the old theme. Two spec items remain deliberately
unbuilt and are tracked as gaps, not re-skin bugs — the 6-per-line cart cap (below) and the
30-second OTP resend countdown (step 9).

## Known gap (flag, do not test as a bug)

The design spec calls for a hard cap of **6 units per cart line item**. This does **not** exist
today — only real-stock-based capping is enforced (see `test-cart-quantity-cap.md` for the
existing stock-cap behaviour). Do not write/run a test asserting a 6-unit cap works; it's a
pending product decision, not a regression.

---

## Steps

### 1. Theme / fonts

1. ✅ Launch on a clean build — no blue anywhere in the re-skinned screens (Splash → Login →
   OTP → Home → Search → Categories → Aisle → Item Detail → Cart → Coupons).
2. ✅ Headings render in **Quicksand** (rounded, geometric); body/labels in **Poppins**.
   ❌ If either falls back to the system font, the bundled font resource failed to load.
3. ✅ Force iOS **Dark Mode** at the OS level → app stays light (locked to light mode) —
   confirm no screen goes dark/mismatched.
4. ❌ Not yet device-verified: **Dynamic Type** (Settings → Accessibility → larger text) and
   **Reduce Motion** were coded for but not confirmed on a real device — see "Before this is
   fully tested" below.

### 2. Splash → Login → OTP

5. ✅ Cold start shows the new **Splash** screen (brand-new, transient) briefly, then routes to
   Login (logged-out) or Home (logged-in).
6. ✅ **Login** — 10-digit phone field shows a **checkmark** affordance once 10 digits are
   entered. ❌ The checkmark must not appear before 10 digits, and must disappear if a digit is
   deleted back below 10.
7. ✅ Tap "Send OTP" → **OTP screen** shows **6 separate boxes**, not a single text field.
8. ✅ **OTP autofill**: on a real device, when the SMS with the code arrives, iOS offers the
   code above the keyboard (`.oneTimeCode` content type) — tapping it fills all 6 boxes at
   once. This does **not** work reliably on the simulator; verify on device.
9. ❌ **Known pre-existing mismatch (not fixed this session)**: the on-screen resend countdown
   currently shows **2:00** (120 seconds, hardcoded in `AuthViewModel.resendTimer`), but the
   design intends **0:30**. Flag as a known gap if seen — do not report as a new regression.
10. ✅ After the countdown reaches 0, "Resend" becomes tappable and re-sends the OTP.

### 3. Home / Search

11. ✅ Home renders in the new green theme — header, category tiles, product cards all pull
    from the new token set.
12. ✅ Search — new visual treatment; typing a query returns results in the re-skinned
    `HaperProductCard` layout.
13. ❌ Searching nonsense still shows a sane empty state (not a blank/broken screen).

### 4. Categories (two-screen flow) — regression-critical

14. ✅ Categories tab opens **`AllCategoriesView`** — a 16-tile grid, not the old combined
    sidebar+content screen.
15. ✅ Tapping a tile opens **`AisleListingView`** for that category: subcategory chips, sort
    control (Relevance / Price low-high / Price high-low), "Under ₹50" filter, product grid.

**Edge case A — pagination stuck at ~24 items (fixed this pass):**
16. ✅ Open a large aisle (one with 50+ items) and scroll all the way to the bottom.
    ✅ Items keep loading past ~24 — confirm the grid reaches the true end (or a clear "no more
    items"), not a silent stop.
    ❌ If scrolling stalls with more items known to exist, this regressed.

**Edge case B — stale category on cross-tab tap (fixed this pass):**
17. ✅ From the Categories tab, open aisle **A** (e.g. "Dairy").
18. ✅ Switch to the **Home** tab.
19. ✅ On Home, tap a **different** category tile, **B** (e.g. "Snacks").
20. ✅ Confirm the aisle screen that opens shows **B's real name and B's real items** — not A's
    stale product list under B's title.
    ❌ If the title says B but the grid still shows A's items (or vice versa), this regressed.

**Edge case C — "Under ₹50" filter + pagination:**
21. ✅ In an aisle with many items, enable "Under ₹50".
22. ✅ If the filter narrows the visible list to very few or zero items on the first page,
    confirm the screen **keeps fetching subsequent pages** looking for more matches — it should
    not get stuck showing "no items under ₹50" after checking only page 1.
23. ✅ Toggling the filter off restores the full unfiltered grid without a manual refresh.

### 5. Product Detail

24. ✅ Price-per-unit line (e.g. "₹X/100g") — this is now **server-authoritative**
    (`item.pricePerUnit`, computed backend-side), never client-guessed.
    ❌ **Priority check**: open a multipack item (e.g. a "Dettol Soap (4+1) 100g"-style name)
    and confirm the per-unit price is sane for the multipack — not a wildly wrong number from
    a client-side guess based on the pack size in the name.
25. ✅ Discount badges ("Save ₹N" / "X% OFF") show together when a real discount applies.
    ❌ **Must never show for implausible/bad discount data** — e.g. must never show something
    like "Save ₹9701" / "80% OFF" on a product with obviously bad pricing data. The suppression
    rule: a legacy (non-backend) discount only shows if the computed discount is between 1–70%;
    outside that range, no badge — same rule the product card already enforced.
    ✅ A backend-driven discount (`item.discountedPrice` + a non-empty `item.discountLabel`) is
    always trusted and shown regardless of percentage, since it's already server-validated.
26. ✅ Veg / non-veg mark renders correctly and is still visually distinct (true green / true
    red square) in the new theme.
27. ✅ Related items rail renders using the new `HaperProductCard`, matches the rest of the
    grid's re-skin.

### 6. Cart

28. ✅ Empty cart shows the re-skinned empty state (not the old blue-themed one).
29. ✅ Adding items shows them in the new cart layout.
30. ✅ Coupon entry field — enter a valid coupon code, confirm it applies and the bill updates.
31. ✅ Enter an invalid/expired code, confirm a clear inline error (see `test-coupon-codes.md`
    for coupon-specific edge cases not covered by this pass).

### 7. Coupons / Offers screen

32. ✅ Offers screen renders in the new theme — cards, copy-code affordance, apply flow.
33. ❌ Confirm no leftover blue accents (buttons, chips, active states) anywhere on this screen.

### 8. Account area (final pass) — the last blue surfaces

34. ✅ Profile → **Help & support**: green hero card, mint/chip/sunken contact tiles, green
    icons and chevrons. ❌ No blue circles behind the mail/phone/office icons (they used to be
    pale blue/lilac).
35. ✅ Profile → **FAQs**: new "HELP / Frequently asked questions" eyebrow + Quicksand title,
    white cards on the app's mint-grey background, green chevron that **rotates** on expand.
    ❌ The chevron must animate, not swap glyphs.
36. ✅ Profile → **About Haper**: green fallback logo tile, uppercase green eyebrows ("OUR
    MISSION", "CONNECT WITH US"), hairline dividers. Tapping Privacy Policy / Terms opens the
    **in-app** web view (green spinner), while Support Email opens Mail.
37. ✅ Profile → **Edit profile**: form sits on the app background (not the iOS grouped grey),
    "Save changes" is a **green gradient** button that dims when the form is invalid, and the
    referral code renders in **monospace**.
    ❌ Inline name/referral errors must be the muted `dangerText` red, not system red.
38. ✅ Edit profile → **Delete account**: danger card in the soft pink `dangerSurface` (not
    system-red-at-8%), wallet-forfeit card in the amber `warningSurface`, reason menu and OTP
    field are white with a hairline border. OTP field is monospace and still autofills.
39. ✅ **Restore account** (log in with a soft-deleted number inside the 30-day window): amber
    icon well, green gradient "Restore my account", mint "Cancel and go back".
40. ✅ **Tab bar**: the selected tab is green, not blue. Check on every tab.
41. ✅ **Floating "View cart" bar** (Home / Categories / Aisle / Item detail): green gradient
    pill with the item-count chip on the left and the total in Quicksand on the right.
    ❌ No blue gradient.

### 9. Order cancel + scheduled delivery (final pass)

42. ✅ Place an order, open it, tap **Cancel** within the cancel window → the reason sheet
    opens as a **medium detent** with a drag indicator, on the app's mint-grey background.
43. ✅ Reason rows are white cards; the selected one gets a **green ring + green dot** and a
    green border. ❌ No blue radio.
44. ✅ Pick "Other" → the free-text field is white with a hairline border; the character
    counter turns **amber** (not orange) near the 180-char cap.
45. ✅ "Yes, Cancel" is the design's `Danger` pink-red (not system red); "No" is the mint
    secondary button.
46. ✅ On a **scheduled** order, the order-detail "Scheduled delivery" card is white with the
    green calendar icon and the slot label in Quicksand.
47. ✅ Tap **Change slot** → date strip and slot grid render as white cards with a **1.6pt**
    hairline border; the selected date/slot flips to a **mint fill + green border**.
    ❌ No blue fill/border anywhere in the picker.
48. ✅ Unavailable dates/slots stay **greyed with the reason spelled out** (never colour-only),
    and "Only N left" reads amber.
49. ✅ "Confirm new slot" is a green gradient button, dimmed while no new slot is selected;
    "Keep current slot" is the mint secondary.
50. ✅ While slots load, the skeleton blocks are the pale `surfaceSunken` green-grey, not grey.

### 10. Free gift (if a gift offer is live)

51. ✅ Cart gift nudge: "spend ₹X more" state uses the **amber** `warningSurface` fill +
    `warning` border; the unlocked state uses the **mint** `surfaceChip` + green border.
    ❌ Neither should be Material green (`#4CAF50`) or Material orange (`#FF9800`) any more.
52. ✅ The "FREE GIFT" pill and the gift preview row read teal-green on mint, and the gift row
    still announces as "…, free gift, no charge" under VoiceOver.

### 11. Whole-app sweep

53. ✅ Walk every screen in the app once and confirm **no blue remains anywhere**. The only two
    intentional non-green brand colours are the **Google "G"** on the login screen and the
    **ivory logo card** on splash — both are per the design spec, not misses.

---

---

## Android-parity pass (same session, after the re-skin)

A screen-by-screen / component-by-component / endpoint-by-endpoint review against
`haper-android` (read-only) turned up gaps that were **features and data, not skin**.
These landed in the same session.

### Data layer

- **Orders moved off a deprecated route.** iOS was calling `GET /user/order?status=ACTIVE|PAST`
  with an Active/Past tab split. Android calls `GET /user/order/history` — one combined feed
  that also returns `total`, `hasMore` and a rolling-window `stats` roll-up. iOS now does too:
  it trusts the server's `hasMore` instead of guessing `count >= 10`, shows a real order count
  in the header instead of hedging "Showing N", and renders the SPENT / SAVED / ORDERS tiles.
- **Store-routing race closed.** `GET /user/store/nearest` was relying on the ambient
  `x-user-latitude/longitude` headers (global mutable state). A coordinate change between
  building and sending a request could route an order to the wrong store — the exact bug
  Android fixed by passing `lat`/`lng` as explicit query params. iOS now passes them too.
- **Referral endpoint wired up.** `GET /user/profile/referrals` existed on the backend and was
  used by Android, but iOS had never called it — the Profile tab carried a comment asserting
  there was "no referral-tracking data". There is.

### New screens (Android has them, iOS did not)

- **Refer & earn** — coins balance card, dashed code card with copy, share, how-it-works,
  and the referral list with per-friend earnings.
- **Alerts / notification inbox** — there is no notification-feed endpoint, so (exactly as on
  Android) it is the local history of pushes this device received. The home header's bell used
  to dead-end at Notification Settings; it now opens the inbox and carries an unread dot.
- **Settings** — the grouped Account / Preferences / Help / Danger-zone index.

### Behaviour

- **6-per-line cart cap now enforced.** README §3.11/§4 specifies a hard ceiling of 6 units per
  line item, independent of stock. Android enforces it; iOS did not (the previous version of
  this guide listed it as a known gap). Every `+` — product card, item detail, cart — now
  disables at the cap, and the error copy distinguishes "out of stock" / "only N in stock" /
  "you can add up to 6".
- **Home no longer blocks on a scrim.** The full-screen dark overlay + spinner is replaced by
  shimmer skeletons in the shape of the real product cards, so the header and the
  not-serviceable card stay reachable while the store resolves.
- **Wallet history reads like English.** Ledger lines came straight from the backend, so users
  saw raw enums (`ADMIN_CANCEL`) and internal Razorpay refs (`pay_…`). Now mapped to human copy
  with the gateway refs stripped, matching Android.
- **Logout is instant.** `isLoggedIn` was only flipped after two awaited network calls, so the
  UI sat on the authenticated screen during logout. It now flips synchronously; the deliberate
  unregister-before-clear-Keychain ordering is unchanged.

### Product card, pixel by pixel

The card was a single layout; Android has two real variants traced to the prototype. iOS now
matches: home is a white r22 card with 10pt padding over a **fixed 102pt** image well, aisle is
a glass-gradient r21 card with 9pt padding, a white hairline and a 96pt well. Also added, all
of which were missing: the 1pt `rgba(88,169,132,.14)` ring on the well, the **green-gradient
discount wedge** in the well's top-right corner (was an amber chip top-left), the add control
**straddling the well's bottom-right corner** on the amber ramp — outlined on aisle, filled on
home (was a flat green square inside the image), the **`SAVE ₹N` chip**, the **veg/non-veg
mark**, and the display-name cleanup that strips a weight the name already repeats
("Cadbury Silk - 112gm" with `weight=112, unit=g`).

### Still missing vs Android (not attempted — flag, don't file as bugs)

- **Custom bottom nav.** Android draws the design's glass tab pill with a cart FAB riding above
  its centre — that FAB is the design's 5th "Cart" destination (§2.3). iOS uses a stock
  four-tab `TabView`; cart is reached from the header button and the floating cart bar. This is
  navigation chrome, not a re-skin, and was left alone deliberately.
- **`locationNeeded` four-state machine.** Android distinguishes "we don't know where to
  deliver" (permission needed / denied / no address with coordinates / lookup failed) from
  "nobody serves here", and shows a different card for each. iOS still shows only the
  not-serviceable card. Porting it means restructuring store resolution — the code path whose
  own comments record a past bug that "routed orders 24km away" — so it was not attempted here.
- **Derived design tokens.** Android's `Color.kt` carries a whole layer of prototype-traced
  tokens (nav glass, scrims, inner shades, top highlights) that iOS only has where a component
  needed them.

### Extra steps to test

54. ✅ **Orders** — one combined list (no Active/Past tabs). Header reads a real count
    ("N orders in the last 30 days"). Above the list: three tiles — SPENT, SAVED (amber),
    ORDERS. ❌ Tiles must be hidden entirely when the window has no orders.
55. ✅ Scroll to the bottom of a long order history — it keeps paging and stops at the true
    end (server `hasMore`), not at a guessed multiple of 10.
56. ✅ First load of Orders shows three shimmering order-card skeletons, not a spinner.
57. ✅ **Refer & earn** (Profile → Refer & Earn): dark amber coins card, dashed code card,
    Copy flips to "Copied", Share opens the system sheet, how-it-works steps, and — if you
    have referrals — the list with "+N" per friend and "Not ordered yet" for those who haven't.
58. ✅ **Alerts**: home header bell opens the inbox. With a push received, the row is mint with
    an unread dot; opening the screen marks all read and the dot on the bell clears. Tapping a
    row with an order deep-links to that order. ❌ Log out and back in — the inbox must be
    empty (it is per-account local history).
59. ✅ **Settings** (Profile → App → Settings): four groups, glass cards, Danger zone's
    "Delete account" opens the existing OTP-confirmed flow.
60. ✅ **Cart cap**: add the same item repeatedly. At 6 the `+` greys out everywhere (product
    card, item detail, cart). Pushing past it says "You can add up to 6 of this item."
    ❌ For an item with fewer than 6 in stock, the message must name the stock, not the cap.
61. ✅ **Home**: wallet strip sits under the banners ("Haper Wallet · ₹N"), taps through to
    Wallet. While the store resolves you see skeleton cards and can still tap the header —
    ❌ no dark full-screen overlay.
62. ✅ **Product card**: discount shows as a green wedge in the image's top-right; the add
    button straddles the image's bottom-right and is amber (filled on Home, outlined in an
    aisle); a discounted item shows "SAVE ₹N"; veg/non-veg mark sits top-left.
63. ✅ **Wallet**: a refund line reads e.g. "Refund credited by support · Order #1234".
    ❌ It must never show `ADMIN_CANCEL` or a `pay_…` reference.

---

## Known pre-existing test-target failures (not from this pass)

Both were reproduced on a clean checkout of `dev` before any of this work, and both are now
**fixed**:

- `ViewModelsStateTests.testProfileViewModel_updateLocalErrorSetsAndClears` did not compile — it
  called `ProfileViewModel.updateLocalError(_:)`, which did not exist, and that broke the whole
  test target's build (so nothing could be verified at all). The method now exists and is the
  single place local validation errors are set/cleared.
- `AuthViewModelTests.testLogout_clearsAllState` failed at runtime because `isLoggedIn` was only
  cleared inside an async `Task` behind two awaited network calls. See "Logout is instant" above.

The suite is green.

## Before this is considered fully tested

- **Real device testing is required, not just simulator.** Dynamic Type and Reduce Motion were
  coded for but not verified on a physical device this session. This is customer-facing
  production software — run steps 3–4 and a spot-check of the rest on at least one real iPhone
  before sign-off.
- OTP autofill (step 8) specifically needs a real device with a live SIM/SMS — the simulator
  cannot receive the autofill prompt.
- Test on both a small (e.g. iPhone SE) and large (e.g. 17 Pro Max) screen — the design spec
  changed spacing/typography, so tight layouts (OTP boxes, category grid, price-per-unit line)
  are the most likely to clip on a small screen.

## Deploy

iOS-only, `dev` branch. Needs an app build (TestFlight or local `xcodebuild` run) to test on
device — no backend, shared-package, Android, or web change. No migration.
