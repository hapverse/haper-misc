# Checkout Info Message — Design Spec

Status: ready for build. Read `checkout-info-message.md` (plan) first for schema/API — this file
covers ONLY visual/UX. No HTML/markdown ever renders — plain text, `\n` line breaks only if the
admin typed them (see §4).

Source screens read before writing this spec:
- `haper-web/pages/Checkout.tsx` (~L668-724) + `haper-web/components/GiftNudge.tsx`
- `haper-android/.../checkout/CheckoutScreen.kt` (~L887-934, the min-order `Surface`)
- `haper-ios/haper/Views/CheckoutView.swift` (~L319-349, the min-order `HStack`)

**Important asymmetry found during review:** Android and iOS both already render a min-order
banner on checkout (`cartVM.minOrderMessage` / `cartManager.minOrderMessage`). **Web does not** —
web's checkout has no min-order banner at all, only a small green "Free Delivery" pill inline in
the summary (`Checkout.tsx` L586). Web's only existing banner-family component on this screen is
`CartGiftNudge` (rounded-2xl card, 28px icon chip, colored surface). So:
- Android/iOS: new banner joins an existing 2-banner stack (min-order + gift... wait, gift nudge
  isn't on Android/iOS checkout either — grep found `GiftNudge.tsx` is web-only, per the file's own
  comment "Parity target: haper-android CartScreen.kt" which is the CART screen, not checkout).
  **On Android/iOS checkout today, the only existing banner is min-order.** The new info banner
  is the second one, not the third.
- Web: web's checkout already has `CartGiftNudge`. **Web has never shipped the min-order banner
  on checkout at all** — so on web today the new info banner is also only the second banner.

The 3-banners-at-once scenario described in the brief (min-order + gift nudge + info) is
therefore a **future-proofing case for web only**, once/if a min-order banner is added there. Spec
below covers 0/1/2/3 for all platforms so it's already correct if that gap is closed later.

---

## 1. Placement

**Rule: order-level notices group together, directly above "Order Summary" / "Bill Details",
below all interactive input (address, slot, payment method).** This matches where the min-order
banner already sits on Android/iOS (right after the payment-method card, right before the summary
card) and where the gift nudge already sits on web (right before "Bill Details").

Stack position, top to bottom, whenever multiple are present:

1. Min-order / free-delivery banner (existing) — most actionable, tells the customer they can
   still change the outcome by adding items.
2. Gift-nudge banner (existing, web-only today) — also actionable (add ₹X for a free gift).
3. **Checkout info message (new)** — always last/bottom. It is pure information, never actionable,
   so it reads after anything the customer can still act on.

Rationale: actionable-before-informational is the same ordering principle already encoded in the
gift nudge's own internal states (unlocked > next-tier > cap-reached), so this keeps one consistent
"can still act > can no longer act > just FYI" reading order down the page.

Spacing between stacked banners: **12px (Android `Spacer(12.dp)`, iOS `.padding(.top, 12)` /
12pt `VStack(spacing: 12)`, web `space-y-3` wrapping the group — 12px = Tailwind `3`)**. Do not use
each platform's existing pre/post spacer meant for a single banner (Android's 16dp) between two
stacked banners — that gap is for banner-to-next-different-section, not banner-to-banner. Keep 16dp/
16px only between the LAST banner in the stack and the Order Summary card below it.

---

## 2. Visual treatment — the "info" family

This is intentionally the **third color state** of the same banner family the min-order banner
already uses (green = unlocked/positive, amber = warning/actionable, **blue = neutral/informational**).
No new component shape — same rounded-corner card, same circular icon chip, same semibold text —
only a new color pair and a new icon.

No `--info` or `--warning` design token exists in any of these three codebases today (confirmed:
haper-admin has none either — colors are hardcoded per-component). Do not add token infrastructure
for this feature; use the literal values below directly, matching how the amber/green pair is
already hardcoded per platform.

### Color values (all platforms — same visual result, native per-platform notation)

| Role | Web (Tailwind, dark-mode variant given) | Android (Compose `Color(0x..)`) | iOS (SwiftUI `Color(red:green:blue:)`) |
|---|---|---|---|
| Background fill | `bg-blue-50` / `dark:bg-blue-950/25` | `Color(0xFFE3F2FD)` | `Color(red: 0.89, green: 0.95, blue: 0.99)` |
| Border | `border-blue-600/30` / `dark:border-blue-500/25` | `Color(0xFF2196F3)` | `Color(red: 0.129, green: 0.588, blue: 0.953)` |
| Icon chip fill | same as border | same as border | same as border |
| Text | `text-blue-800` / `dark:text-blue-200` | `Color(0xFF0D47A1)` | `Color(red: 0.051, green: 0.278, blue: 0.631)` |

This is a standard Material Blue 500/50/900 ladder (`#2196F3` / `#E3F2FD` / `#0D47A1`) — chosen
because it's the direct "info" analog of Material's own blue, sits far enough from the existing
amber (`#FF9800`/`#FFF3E0`) and green (`#4CAF50`/`#E8F5E9`) hues to never be confused with them,
and passes contrast (see §7). Web has no blue in its custom Tailwind palette (`primary`=orange,
`secondary`=green) — use Tailwind's **built-in** `blue-*` utility classes; they exist by default
even though not declared in `tailwind.config`'s `extend.colors`, exactly like `gray-*` is used
elsewhere in this same file.

### Shape / spacing (unchanged from the existing banner, per platform)

- **Web**: `rounded-2xl border px-3.5 py-3` (exact match to `GiftNudge.tsx`'s `Banner` component —
  reuse that component's `container`/`text`/`chip` prop shape, do not fork a new banner shell).
  Icon chip: `h-7 w-7 rounded-full`, icon `h-4 w-4 text-white`.
- **Android**: `RoundedCornerShape(16.dp)` surface, `BorderStroke(1.5.dp, borderColor)`, inner
  `Row` padding `horizontal = 14.dp, vertical = 12.dp`, icon chip `Surface(shape =
  RoundedCornerShape(999.dp), size = 30.dp)`, icon `size(18.dp)`, text `MaterialTheme.typography
  .bodyMedium` + `FontWeight.SemiBold` — exact match to the existing min-order `Surface` block.
- **iOS**: `.cornerRadius(12)` with `.overlay(RoundedRectangle(cornerRadius: 12).stroke(borderColor,
  lineWidth: 1.5))`, `.padding(14)`, icon in a `ZStack` circle `.frame(width: 30, height: 30)`,
  icon `.font(.system(size: 16, weight: .bold))`, text `.font(.system(size: 14, weight: .semibold))`
  — exact match to the existing min-order `HStack` block.

### Icon

- **Android**: `Icons.Default.Info` (already used for the min-order banner's non-free-delivery
  state, so this is a re-skin, not a new icon import).
- **iOS**: `"info.circle.fill"` (already used for the min-order banner's non-free-delivery state —
  same reuse).
- **Web**: `Info` from `lucide-react` (not currently imported in `Checkout.tsx` — add the import;
  `GiftNudge.tsx`'s `Banner` component already accepts an `icon` prop pattern, extend it with a
  third `'info'` variant mapping to `Info`).

Icon is purely decorative (the message text says everything) — mark it `aria-hidden="true"` /
`contentDescription = null` / no accessibility label on iOS's `Image(systemName:)`, matching how
the existing min-order and gift-nudge icons are already marked on all three platforms.

---

## 3. Stacking behavior — exact rules for 0/1/2/3 notices

Each banner is independently fail-open: it renders nothing (not even a placeholder) when its own
condition is false. There is no shared wrapper that reserves space for "up to 3 banners" — each
one either renders its full card or renders nothing, and normal document/layout flow closes the
gap automatically. This mirrors the existing pattern (`CartGiftNudge` already returns `null`
outright when there's no offer — do the same for the info banner).

| min-order | gift nudge (web only today) | info message | Result |
|---|---|---|---|
| off | off | off | Nothing renders in this slot — zero height, zero DOM/view node (see §5). |
| on | off | off | Just the min-order banner, existing bottom margin unchanged. |
| off | on | off | Just the gift nudge, existing margin unchanged. |
| off | off | on | Just the info banner, using the SAME bottom margin the min-order banner
  currently uses when it's alone (16dp/16px to the next section) — i.e. the info banner is a
  first-class citizen of this slot, not an afterthought appended only when others exist. |
| on | on | off | min-order, 12px gap, gift nudge (this is the CURRENT web behavior once a
  min-order banner is added there — no change needed for this feature). |
| on | off | on | min-order, 12px gap, info message. |
| off | on | on | gift nudge, 12px gap, info message. |
| on | on | on | min-order, 12px gap, gift nudge, 12px gap, info message. Three cards is the
  visual ceiling for this slot — do not compress padding or merge any two of them into one card to
  save space; if this ever feels heavy in practice, the fix is business logic (e.g. suppressing the
  gift nudge below the min-order threshold), not a design compromise on the cards themselves. |

Implementation note for engineers: build the info banner as its own independent conditional block
(own `if (checkoutMessage) { ... }`), inserted after the gift-nudge block and before the summary
card, with its own 12px top margin **only when a banner already rendered above it** — do not
hardcoded a fixed count-based margin; let each block supply its own top gap and have the topmost
rendered block's top gap collapse against the section above (i.e. treat gap as "space before me,
if I'm not first" the same way `space-y-3` in Tailwind or `Arrangement.spacedBy(12.dp)` in Compose
already do — use those flex/stack gap primitives rather than manual per-banner spacers, since they
handle the 0/1/2/3 cases correctly for free).

---

## 4. Text handling

- **Never truncate, never ellipsis, no `lineLimit`/`line-clamp` cap.** This directly overrides one
  detail of the existing min-order banner: iOS's current min-order `Text(msg)` has
  `.lineLimit(1)` + `.minimumScaleFactor(0.75)` (shrinks text to fit one line). **Do not copy that
  behavior for the info banner** — a 200-char operational message must wrap to multiple lines
  and stay full-size, full-width, readable. (Optionally raise this as a separate future fix for the
  min-order banner too, since a store's min-order copy could also grow — out of scope here.)
- Card width is always full-bleed within its container padding (`fillMaxWidth` / `maxWidth:
  .infinity` / `w-full` — already true of all three existing banners), so wrapping happens at the
  card's own width, not a fixed pixel constraint.
- Text is left-aligned, vertically centered against the icon on the first line; if it wraps to 2+
  lines, the icon stays top-aligned with the first line (not vertically centered against the full
  block) — on Android/iOS this means the icon `Row`/`HStack` needs `verticalAlignment = Alignment
  .Top` / `.alignment: .top` for THIS banner specifically (the min-order banner today center-aligns
  because its text is capped to 1 line; the info banner cannot assume that).
- At 200 characters on a small phone (e.g. 360px-wide Android device / iPhone SE 375pt): expect
  roughly 4-5 lines at 14sp/14pt semibold. This is acceptable — the card simply grows taller. Do
  not shrink font size to compress it (no `minimumScaleFactor` equivalent). Confirm during
  implementation that the "Place Order" sticky button never overlaps this content — all three
  checkout screens already scroll their body content above a sticky/fixed bottom bar, so a taller
  card just means more scrolling, not overlap; no special-case needed for the 200-char extreme.
- Whitespace: trim leading/trailing (already handled server-side per the plan's Joi
  `.trim()`), but preserve internal single spaces and any line breaks the admin typed as literal
  `\n` — render with normal text wrapping (`white-space: normal` / Compose `Text` default / SwiftUI
  `Text` default), do not collapse `\n` to a space. The admin textarea allows multi-line entry; the
  banner should look the same as what the admin typed.

---

## 5. Empty state

**Zero reserved space, zero DOM/view node** — not a hidden-but-present element. Concretely:

- **Web**: the block returns `null` from React (not `style={{display:'none'}}`, not `hidden`
  attribute) when `checkoutMessage` is empty/whitespace/absent — same pattern `CartGiftNudge`
  already uses (`if (!hasContent) return null`). No wrapping `<div>` stays behind.
- **Android**: use Kotlin's `?.let { }` scope function gated on `.isNotBlank()` around the entire
  `Surface` + its trailing `Spacer` (exact mirror of how the min-order block already does this at
  L888-889) — when the condition is false, **neither** the `Surface` nor its `Spacer(16.dp)`
  compose, so no gap is left behind either.
  when
- **iOS**: wrap in `if let msg = ..., !msg.isEmpty { ... }` (exact mirror of the min-order block at
  L320) — SwiftUI simply does not add the view to the hierarchy when the condition is false.

For stores that never set `config.checkoutMessage` (existing stores, per the plan's back-compat
note): the field is `null`, this block never renders, checkout is pixel-identical to pre-feature —
this must be explicitly verified as a screenshot-diff or manual check on at least one existing
store per platform before merging, since it's the plan's own acceptance criterion.

---

## 6. Dark mode

**Web only** — confirmed via `haper-web/index.html` (`darkMode: 'class'`) and dark: classes
throughout `Checkout.tsx`/`GiftNudge.tsx`. Android and iOS checkout screens read `MaterialTheme
.colorScheme` / a light-only hardcoded palette respectively for the min-order banner and have not
built a dark variant for it — so **do not add dark-mode handling for this banner on Android/iOS**;
match the existing min-order banner's current (light-only) behavior exactly, no new scope.

Web dark values (already given in the table in §2, repeated here for clarity):
- Background: `dark:bg-blue-950/25`
- Border: `dark:border-blue-500/25`
- Text: `dark:text-blue-200`
- Icon chip: no dark variant needed — it's a solid fill (`bg-blue-600` equivalent — see exact class
  below) with a white icon on top in both modes, exactly like the gift-nudge chip (`bg-emerald-600`
  is mode-invariant in `GiftNudge.tsx`).

Exact Tailwind class set for the web banner card (paralleling `GiftNudge.tsx`'s `container`/`text`/
`chip` props):
```
container: "border-blue-600/30 bg-blue-50 dark:border-blue-500/25 dark:bg-blue-950/25"
text:      "text-blue-800 dark:text-blue-200"
chip:      "bg-blue-600"
```

---

## 7. Accessibility

- **Contrast**: `text-blue-800` (`#1e40af`) on `bg-blue-50` (`#eff6ff`) = ~8.6:1 — passes AA and
  AAA for normal text. Dark mode `text-blue-200` (`#bfdbfe`) on the ~5%-opacity dark blue overlay
  (effectively near-`bg-gray-950`, `#030712`) = well over 4.5:1. Android `#0D47A1` on `#E3F2FD` and
  iOS's equivalent RGB triple are the same Material Blue 900-on-50 pair, ~9:1 — all comfortably
  pass WCAG 2.2 AA (4.5:1 for this 14sp/14pt semibold body text; it also clears the stricter 3:1
  large-text bar with margin, so no risk even before rounding).
- **Icon**: decorative only, no accessible name — the message text is the complete content. Set
  `aria-hidden="true"` (web), `contentDescription = null` (Android, already the pattern in the
  min-order block), and rely on iOS `Image(systemName:)` not being exposed as a separate
  accessibility element when it's inside a `Text`-labeled `HStack` with `.accessibilityElement
  (children: .combine)` — if that modifier isn't already present on the min-order `HStack`, add it
  here too so VoiceOver reads "info, <message text>" as one announcement, not two.
- **Live region**: web should mark this `role="status" aria-live="polite"` exactly like `GiftNudge
  .tsx`'s `Banner` does — the message can appear async on cart/checkout load, and a polite live
  region means a screen-reader user hears it without an interruption. Android/iOS don't need an
  equivalent since the banner is present at initial screen composition, not injected after a user
  action mid-task (same as the existing min-order banner's current behavior, which has no
  live-region equivalent either).
- **Touch target**: none needed — this banner is not interactive (no tap target, no button), so no
  44pt/48dp minimum applies.
- **Focus order**: not a focusable element (no `tabindex`, no Compose `Modifier.focusable()`, no
  SwiftUI `.focusable()`) — screen readers reach it via normal linear reading order, which is
  already correct given its placement in §1 (after payment method, before order summary).

---

## Summary for engineers

Reuse the min-order banner's exact shape per platform (Android/iOS) or the `GiftNudge` `Banner`
component's exact shape (web) — same radius/padding/icon-chip size/font weight — with ONE new
color state (blue: bg `#E3F2FD`/border+chip `#2196F3`/text `#0D47A1`, dark-mode web variants given
in §6) and the `Info`/`info.circle.fill`/`Icons.Default.Info` icon (already imported everywhere
except web, where `lucide-react`'s `Info` needs one new import). Position: bottom of the
order-level-notices stack (after min-order and gift-nudge, before Order Summary/Bill Details), 12px
gap between stacked banners, no truncation, own top-aligned icon when wrapped, and a `return null` /
`?.let` / `if let` guard for zero-height empty state — no exceptions.
