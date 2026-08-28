# Test — iOS "Haper Green" re-skin (customer app)

**Area:** haper-ios (customer app) — Splash through Cart/Coupons re-skinned from the old blue
theme to the new green design system, per design handoff spec.
**Branch:** `dev` (haper-ios). Committed at `e276a2f`; some of the fixes below (product card,
cart, item detail, offers) are pending commit in the same session — re-check `git status`
before assuming they've landed.
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

## NOT in scope for this guide (not yet re-skinned)

Address, Payment, Order tracking, Profile, Wallet, Referral, Settings, Alerts, and error-state
screens (§3.14 onward in the design spec) have **not** been touched this pass — still on the
old blue theme. Do not file re-skin bugs against them; a future guide update covers them once
built.

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

---

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
