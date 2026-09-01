# Coupon info icon — design spec

Small addition to the Offers screen coupon cards: an (i) icon that reveals the coupon's
`description` field on tap, instead of each platform showing/truncating it differently inline.

Scope confirmed by research (see task brief): backend `description` field already returned by
`GET /user/coupon/available`, no backend change. Pure client-side display change on:
- Web: `haper-web/pages/Offers.tsx`
- Android: `haper-android/app/src/main/java/com/bheldi/ui/screens/offers/OffersScreen.kt`
- iOS: `haper-ios/haper/Views/OffersView.swift`

Checkout does **not** need this icon — checked all three clients: checkout only shows a single
applied-coupon summary row (`CheckoutScreen.kt` `checkoutCouponRow`, iOS `CheckoutView.swift`
summary line, web manual code-entry field), never a coupon card list. Coupon *cards* only exist
on the Offers screen. If a future checkout coupon-picker sheet is added, reuse this same pattern.

## 1. Icon

- Symbol: circled-i info icon (web: `lucide-react` `Info`, already imported in `Offers.tsx`;
  Android: Material `Icons.Outlined.Info` or an existing outline-info asset if the app has one;
  iOS: SF Symbol `info.circle`).
- Size: 14x14pt icon glyph, in a 20x20pt visual circle (matches the existing `Info` icon usage
  in `Offers.tsx` line ~110, which uses `w-3.5 h-3.5` inside a message row).
- Color: `InkSecondary` / `text-gray-500 dark:text-gray-400` — same tone as the description text
  it replaces. Do not use an accent/brand color; this is a neutral affordance, not a CTA.
- Placement: inline, immediately to the right of the coupon code chip, in the same header row
  as the code + eligibility/near-miss badge. Order left→right: code chip → info icon → badge
  (badge stays right-aligned via existing `justify-between`/`FlowRow` layout).
  - Web: sits inside the existing `flex items-start justify-between` header `<div>` — add it
    right after the code `<p>`, before the badge `<span>`.
  - Android: add inside the existing header `FlowRow` (~line 610-623), after the code `Text`
    chip and before the `OfferBadge`.
  - iOS: add inside `header` (the `VStack`/`HStack` building the code row), after the code text.
- Tap target: icon glyph is small, but the tappable area must be **44x44pt minimum** (iOS/Android)
  / 44x44px (web) — wrap the icon in an invisible padded hit-area (e.g. Android
  `Modifier.size(44.dp).clickable(...)`, iOS `.contentShape(Rectangle()).frame(width:44,height:44)`,
  web `<button className="p-2.5 -m-2.5">` or similar negative-margin trick so it doesn't disturb
  the header row's visual spacing).

## 2. Reveal pattern (per platform, one consistent visual language)

Don't use a hover tooltip anywhere — coupon descriptions can run to a few sentences, and mobile
has no hover. Use a **modal surface anchored to the tap**, sized for multi-line text:

- **Web**: small popover/dialog anchored below the icon, similar footprint to a tooltip but
  dismissible and scrollable. Reuse `CancelOrderDialog.tsx`'s modal chrome (overlay + centered
  card, `rounded-2xl`, `bg-white dark:bg-gray-900`, `shadow-sm`/existing dialog shadow) but sized
  small (max-width ~320px, not full dialog width) — center-anchored is simpler and more consistent
  with the existing dialog than a floating popover, so default to that unless it feels heavy in
  build; if a lighter popover is preferred, anchor it under the icon with a small caret, same
  card styling, `max-height` ~240px with internal scroll.
- **Android**: `ModalBottomSheet` (same primitive as `CancelOrderSheet.kt`, `LocationNeededSheet.kt`)
  — bottom sheet, rounded top corners matching those sheets' radius, drag handle, scrollable
  content column with `max` height so very long text scrolls instead of pushing the sheet off-screen.
- **iOS**: `.sheet(...)` presented as a small detent sheet (`.presentationDetents([.height(280),
  .large])` or similar — matches existing `.sheet(` usage pattern in the codebase (e.g.
  `CheckoutView.swift`, `AddressListView.swift`). Content in a `ScrollView` for long text.

Visual language across all three: reuse the card's existing corner radius, surface color, and
type scale — do not invent new tokens.
- Web: `rounded-2xl`, `bg-white dark:bg-gray-900`, border `border-gray-100 dark:border-gray-800`,
  body text `text-sm text-gray-700 dark:text-gray-300`.
- Android: `InkPrimary` heading, `InkSecondary` body, `SurfaceSunken`/card surface, existing sheet
  corner radius from `CancelOrderSheet.kt`.
- iOS: `HaperColors.inkPrimary` heading, `HaperColors.inkSecondary` body, `.haperBody` fonts,
  `HaperColors.borderHairline` divider if a footer/close button is added.

Interaction: tap icon → open; tap outside / swipe down (mobile sheet) / Escape or click-outside
(web) → close. No auto-dismiss timer (unlike the toast/copy-confirmation pattern elsewhere in
these files) since the user may be reading multi-sentence text.

## 3. States

- **Default (card, icon collapsed)**: description text is **removed from the card body** —
  don't keep the current inline truncated line (`line-clamp-2` on web, `lineLimit(2)` on iOS,
  the `description` fallback on Android) once the icon exists; the icon is now the single way to
  see it. Keep `discountSummary` (the short bolded line) inline as today — that stays outside the
  info popup, it's not what's being hidden.
- **Open**: full untruncated `description` text shown in the popover/sheet/dialog.
- **Long text**: content area scrolls internally (web: `overflow-y-auto` with a fixed
  `max-height`; Android: `ModalBottomSheet` content in a `Column` with `heightIn(max = ...)` +
  `verticalScroll`; iOS: `ScrollView` inside the sheet). Never let it grow the sheet/dialog past
  ~60% of screen height.
- **Empty/blank description**: if `coupon.description` is null/empty, **don't render the icon at
  all** (same `.takeIf { it.isNotBlank() }` / truthy check pattern already used for the inline
  text on all three platforms — just gate the icon on that instead of gating inline text).
- **Checkout**: no icon — checkout has no coupon cards, see scope note above. If asked later,
  same component, same trigger.

## 4. Copy

Keep it minimal — this is the same `description` field, not a separate legal T&C field:
- Header inside the popup: **"About this coupon"** (not "Terms & Conditions" — the field is
  marketing/eligibility copy per the backend schema, calling it "Terms & Conditions" overstates
  what it is and would set the wrong expectation if a merchant later writes casual copy in it).
- Body: the raw `description` text, no additional formatting/parsing.
- Close affordance: web — small "×" top-right of the dialog/popover (`aria-label="Close"`);
  Android/iOS — the sheet's native drag-to-dismiss is sufficient, no extra close button required,
  but add one for parity with web if the platform's sheet doesn't have an obvious dismiss affordance.

## 5. Accessibility

- Icon: `aria-label="More info about this coupon"` (web `<button>`), Android
  `Modifier.semantics { contentDescription = "More info about this coupon" }` (or
  `Icon(..., contentDescription = "More info about this coupon")`), iOS
  `.accessibilityLabel("More info about this coupon")` on the tappable icon.
- Tap target ≥44x44pt/px on all platforms (see §1).
- Popup/sheet must trap focus while open and return focus to the info icon on close (web: standard
  dialog focus-trap, same as `CancelOrderDialog.tsx` already does — confirm it does and mirror it).
- Web: dismissible via **Escape** key in addition to click-outside/×.
- Contrast: body text must meet the existing card body-text contrast ratio already used elsewhere
  on these screens (the tokens listed in §2 are already AA-compliant in this codebase — no new
  color needed).
- Screen reader: popover/sheet content should be read as a single block (heading then body), not
  require the user to discover it's scrollable — ensure scroll containers don't trap swipe-based
  screen reader navigation (iOS VoiceOver / Android TalkBack both handle `ScrollView`/scrollable
  `Column` natively, no special handling needed beyond correct semantics).

## Component reuse pointers (for implementers)

- Web: `haper-web/components/ui/CancelOrderDialog.tsx` — modal chrome/focus-trap pattern to mirror.
- Android: `.../ui/screens/orders/CancelOrderSheet.kt` — `ModalBottomSheet` pattern to mirror.
- iOS: existing `.sheet(...)` + `.presentationDetents` usage in `CheckoutView.swift` /
  `AddressListView.swift` — pattern to mirror.
