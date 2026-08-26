# Design Spec — Coupon Discoverability ("Offers" screen + entry points)

Author: Chanchal (designer) · Date: 2026-08-27
Status: Spec for `coupon-discoverability-plan.md` (approved) — covers §3.3, §3.4, §3.5, §5.1, §7.3, §9
of that plan. This doc does not repeat eligibility/money logic — the API in plan §5.1 is the sole
source of truth for what a card can say; this spec only covers how it is presented.

Audience: siddhart-android (Jetpack Compose), setu-ios (SwiftUI), tanmoy-web (React, no build-time
CSS framework — Tailwind utility classes, matches `Checkout.tsx`'s existing convention).

Precedent read before writing this spec: `haper-web/pages/Checkout.tsx` (coupon entry/applied card,
lines 773-852 — the two-state pattern this screen must feel like a sibling of), `haper-web/pages/
Rewards.tsx` (the natural profile-menu neighbour — gradient header, card grid, rounded-2xl surfaces,
`Sparkles`/`Gift` icon language), `haper-ios/haper/Views/CartView.swift`'s `CouponCard` (SwiftUI
mirror of the same two-state pattern), `haper-android/.../ui/screens/profile/ProfileScreen.kt`
(`SettingsRow`-style menu rows with icon/title/value/chevron), `haper-ios/haper/Views/ProfileView.swift`
(`ProfileMenuRow`/`ProfileInfoCard`), and the admin-side `coupon-codes-admin-ui-design.md` /
`discounts-admin-ui-design.md` for this project's spec format and color-discipline conventions
(amber = "normal, not broken," red = "actually wrong," green = "money in your favour").

---

## 0. One card language, three renderers

There is exactly one visual/interaction model — described once in §2 — that Android, iOS, and web
each render with their own native chrome (list vs. `LazyColumn` vs. `ScrollView` vs. a React page).
Platform notes are called out inline wherever a platform's convention should differ, not as a fourth
separate spec.

---

## 1. User flow

1. **Entry.** Customer taps "View offers" next to the coupon-code field on Checkout, OR taps "Offers
   & Coupons" in the Profile menu. Both entry points always render, regardless of cart state or
   whether any coupons are currently visible (plan §3.5 — no gating on cached config).
2. **Load.** Offers screen opens, calls `GET /user/coupon/available`. Skeleton shown while in flight.
3. **List renders**, sorted per the API's own order (eligible-first, best-discount-first — the client
   does not re-sort). Each card is one of three states: **Eligible**, **Near-miss**, or
   **Empty-cart (copy-only)** — see §3.
4. **Customer acts on a card:**
   - Eligible + non-empty cart → taps **Apply** → in-flight feedback (§4.2) → success: cart is
     re-priced server-side, client auto-navigates back to Cart/Checkout with the coupon already
     showing applied (§4.3). Failure (coupon just exhausted, etc.): inline error stays **on the
     Offers screen**, that one card's state updates from the server's fresh verdict (§4.4), customer
     is not silently bounced anywhere.
   - Empty cart → taps **Copy code** → code copied to clipboard, small inline confirmation, customer
     stays on Offers (§3.3). No navigation — they still need to go add items themselves.
   - Near-miss → no primary apply action (nothing to tap that calls the API) — a **"Continue
     shopping"** link with a shopping/back-to-home destination, or the customer simply backs out
     using the entry point they came from (§3.2).
5. **Empty list** (zero visible+eligible coupons) → friendly empty state, never blank/error-looking
   (§5).
6. **Exit.** Back/close from Offers always returns to wherever the customer came from (Checkout, or
   Profile) — Offers never traps navigation.

---

## 2. Layout

### 2.1 Structure (all platforms, mobile-first — this is also the only web breakpoint that matters,
Offers is not a desktop-optimized power screen)

```
┌──────────────────────────────────────────┐
│ ←  Offers                                 │  ← header: back/close + title, platform-native chrome
├──────────────────────────────────────────┤
│  Your cart: ₹379.00                       │  ← optional context line, only if cartSubtotal > 0
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │  MONSOON20                    [tag] │   │  ← card 1 (see §3 for state variants)
│ │  20% off, up to ₹150                │   │
│ │  Min. order ₹499                    │   │
│ │  ...state-specific body...          │   │
│ │  [ primary action ]                 │   │
│ └────────────────────────────────────┘   │
│ ┌────────────────────────────────────┐   │
│ │  card 2                             │   │
│ └────────────────────────────────────┘   │
│              ...                          │
└──────────────────────────────────────────┘
```

- Single scrollable column of full-width cards, 12–16px vertical gap between cards, 16px horizontal
  page padding — matches Checkout's existing `p-4` rhythm on web; Android/iOS use their standard list
  content-inset (16dp / 16pt).
- **Context line** ("Your cart: ₹379.00") renders only when `cartSubtotal > 0` — it's what makes the
  near-miss cards' gap math legible at a glance without repeating the subtotal on every card. Omit
  entirely when cart is empty (that state is self-explanatory per-card, see §3.3); don't show "Your
  cart: ₹0.00", it reads as an error.
- No filters, no tabs, no search — the API already returns exactly what this customer can see, and
  the plan caps candidates at 50 (§3.2 of the plan) which in practice will be single digits. A search/
  filter bar would be solving a problem this screen doesn't have.
- **Web:** dedicated route `/offers` (not a modal) — consistent with `/rewards` being a full page, not
  an overlay, and because the entry point from Profile needs a bookmarkable/back-button-friendly
  destination the same way Rewards is. Header can reuse Rewards' gradient-hero treatment scaled down
  (see §2.2) for visual family resemblance, or a plain white header with a title — recommend the
  latter for Offers specifically, see rationale in §2.2.
- **Android:** new `composable("offers")` per the plan, pushed onto the same `NavHost`, standard
  `TopAppBar` with back arrow — a full screen, not a bottom sheet (a bottom sheet caps how many cards
  are comfortably scrollable and this list can legitimately hold several).
- **iOS:** pushed `OffersView` via `NavigationLink`/`.navigationDestination` from both Cart/Checkout
  and Profile — same push pattern iOS already uses for `AddressListView`, `WalletView`, etc. Not a
  `.sheet()` — sheets in this app are reserved for short, modal, single-decision flows (per existing
  precedent); Offers is a browsing screen you can come back to, which is what push nav communicates.

### 2.2 Why NOT the Rewards gradient hero, specifically

Rewards' hero (gradient banner + giant balance number) works because there is one hero number (wallet
balance) worth making huge. Offers has no single hero number — it's a list of N different offers, so
a big gradient banner with nothing to put in it would be decoration without content. Use a plain
header (title + optional cart-subtotal context line, §2.1) instead. This is a deliberate deviation
from Rewards' visual template, not an oversight — keep the shared DNA (rounded-2xl cards, same
gray-50/gray-950 page background, same border/shadow tokens) without copying the hero pattern.

### 2.3 Card anatomy (all three states share this skeleton)

```
┌──────────────────────────────────────────────┐
│  CODE12                          [state tag]  │  row 1: code (bold, mono-ish) + right-aligned state tag
│  20% off, up to ₹150                          │  row 2: discountSummary (medium weight, larger than body)
│  Monsoon sale — get ready for the rains       │  row 3: description (optional, muted, 1-2 lines, truncate)
│  Min. order ₹499 · Expires 30 Sep             │  row 4: meta line (muted, small)
│  ─────────────────────────────────────────    │
│  ...state-specific message/body...            │  row 5: state-specific (§3)
│  [                action button              ]│  row 6: full-width primary action (or none, near-miss)
└──────────────────────────────────────────────┘
```

- Card container: rounded-xl/2xl, `1px` border, white/`bg-gray-900` surface, subtle shadow — identical
  token family to the Checkout coupon card and Rewards' info cards (`rounded-2xl`, `border-gray-100
  dark:border-gray-800`, `shadow-sm`).
- Code: bold, `text-base`/`17-18px`, `tracking-wide` — same visual weight as the applied-coupon code in
  Checkout's card (`font-bold text-sm` there is for a compact context; Offers cards have more room, so
  bump one step up for a browsing screen where the code is the primary scan target).
  **Full code must NEVER be truncated** — this is user-editable content (they may want to
  read/remember it) so `min-w-0` + wrap or shrink-to-fit, never an ellipsis mid-code.
- `discountSummary`: printed verbatim from the API, no client-side re-derivation (plan §5.1 — this
  string is server-rendered on purpose). Second-largest text on the card after the code.
- `description`: optional, 1-2 line clamp with `line-clamp-2` (web) / equivalent truncation
  (`.lineLimit(2)` iOS, `maxLines = 2` Android) — never expand the card height unpredictably; long
  descriptions are marketing's problem to keep short, not a scroll-jank problem for us.
- Meta line: `Min. order ₹{minOrderValue}` (or omit entirely if `minOrderValue` is 0 — "Min. order ₹0"
  is meaningless) `·` `Expires {date, e.g. "30 Sep"}` — use the same short date format Checkout/Cart
  already use elsewhere in this app (day + short month, no year unless >1 year out — mirror whatever
  `configTime.ts`-equivalent short-date helper each client already has, don't invent a new one).

---

## 3. Card states

### 3.1 Eligible (`eligibleNow: true`, cart non-empty)

```
┌──────────────────────────────────────────────┐
│  MONSOON20                        ✓ Eligible  │
│  20% off, up to ₹150                          │
│  Monsoon sale — 20% off                       │
│  Min. order ₹499 · Expires 30 Sep             │
│  ─────────────────────────────────────────    │
│  Saves you ₹75.80 on this order               │  ← estimatedDiscount, green
│  [        Apply — Save ₹75.80              ]  │  ← full-width filled primary button
└──────────────────────────────────────────────┘
```

- **Full color, full prominence** — this is the state the whole screen exists to surface. Card border
  can pick up a subtle green/accent tint (`border-emerald-200 dark:border-emerald-800`, same token
  Checkout's applied-coupon card already uses) so an eligible card visually "pops" against near-miss
  cards without needing a loud badge.
- State tag top-right: small pill, `✓ Eligible`, `emerald`/`--success` background-tint + text —
  reuses the exact green (`#22c55e`/`emerald-*`) already established for "money in the customer's
  favour" across this codebase (Checkout's "You saved ₹X", the admin POS applied-coupon row).
- `estimatedDiscount` line: "Saves you ₹{amount} on this order" in emerald, sits directly above the
  button — this is the number that makes tapping obviously worth it, must be visible without any
  interaction.
- Primary action: full-width filled button, label **"Apply — Save ₹{estimatedDiscount}"** (fold the
  number into the button label itself, not just the line above it — a customer scanning a list of
  buttons should be able to compare offers by button label alone without reading every card's body).
  If `estimatedDiscount` is exactly 0 for some edge reason (shouldn't happen when `eligibleNow` is
  true per the plan's card builder, but defensively), fall back to plain **"Apply"**.
- **Tap target = the button specifically, not the whole card.** Reasoning: the card also contains
  scrollable/selectable text (the code, which a customer may want to long-press-copy even on an
  eligible card) and a full-card tap-to-apply removes the ability to select that text or simply read
  the card without triggering a cart mutation. A dedicated button is the safer, more standard
  e-commerce pattern (matches how Checkout's own coupon Apply is a button, not a tap-anywhere-on-row).

### 3.2 Near-miss (`eligibleNow: false`, `shortBy > 0`)

```
┌──────────────────────────────────────────────┐
│  MONSOON20                    ₹120 more to go │
│  20% off, up to ₹150                          │
│  Monsoon sale — 20% off                       │
│  Min. order ₹499 · Expires 30 Sep             │
│  ─────────────────────────────────────────    │
│  Add ₹120.00 more to use MONSOON20.           │  ← API's `message`, verbatim
│  [        Continue shopping →              ]  │  ← outline/ghost button, not filled
└──────────────────────────────────────────────┘
```

- **Muted but NOT disabled-looking or error-looking** — this is the plan's explicit requirement
  (§3.3/§7.3): a near-miss card is an invitation, not a rejection. Concretely:
  - Card border: neutral (`border-gray-100 dark:border-gray-800`, same as a plain card — no red, no
    grey-disabled wash over the whole card).
  - Card content (code, discountSummary, description) stays at **full text opacity/color** — do not
    grey out the informational content, only the CTA area differs from the eligible state.
  - State tag top-right: `₹{shortBy} more to go` in **amber** (`#d97706`/`amber-600`, the established
    "normal, not broken, just not-yet" tone across this codebase — same discipline as the admin specs'
    amber-vs-red rule). Never red — red would say "this is wrong," and being ₹120 short is not wrong,
    it's just not there yet.
  - `message` line: the API's pre-rendered sentence verbatim ("Add ₹120.00 more to use MONSOON20."),
    same amber tone, with a small icon (info/arrow) — matches the exact visual treatment Checkout
    already gives a stale-coupon `message` (amber text + small icon, `Info` lucide icon on web).
- **Action:** outline/ghost button (not filled — filled is reserved for the one action that actually
  does something right now), label **"Continue shopping →"**, navigates back to Home/browse (Checkout
  entry point) — this is a nudge to go add ₹120 more, not a dead button. If launched from the Profile
  entry point (no active cart context to "continue" into), the same button instead reads **"Start
  shopping →"** and goes to Home. No apply/copy action is offered here — tapping Apply on an
  ineligible coupon would just 400 from the server for no reason; don't build an interaction the API
  will refuse.
- Sort position: the API already sorts eligible-first (plan §5.1), so near-miss cards naturally trail
  behind eligible ones — no client-side re-sort needed, but the client must NOT alphabetize or
  re-order on its own, preserve API order exactly.

### 3.3 Empty-cart, copy-only (`cartSubtotal == 0` for the whole response — cart is empty)

```
┌──────────────────────────────────────────────┐
│  MONSOON20                                    │
│  20% off, up to ₹150                          │
│  Monsoon sale — 20% off                       │
│  Min. order ₹499 · Expires 30 Sep             │
│  ─────────────────────────────────────────    │
│  Add items to your cart, then apply this      │
│  at checkout.                                 │
│  [   ⧉  Copy code                           ] │
└──────────────────────────────────────────────┘
```

- This state is **screen-wide**, not per-card — it is driven by the top-level `cartSubtotal` being 0
  (empty cart), which per the plan means every candidate coupon shows with `shortBy = minOrderValue`
  and no card can be "eligible now" in the apply-able sense. Detect it once (top-level `cartSubtotal
  === 0`) and render every card in this state, rather than inferring it per-card from `shortBy ===
  minOrderValue` (fragile — a coupon with `minOrderValue: 0` could coincidentally match that
  condition without the cart being empty).
- **Visually distinct from near-miss** (plan requirement) — no amber "X more to go" tag (there's
  nothing to compute a gap against yet in a meaningful "you're close" sense — technically `shortBy ==
  minOrderValue` but showing "Add ₹499 more" on an empty cart reads as scarier/more distant than the
  same near-miss framing on a ₹379 cart), no `message` sentence about a ₹ gap. Instead: a calm,
  neutral instructional line — **"Add items to your cart, then apply this at checkout."** — same
  muted tone as near-miss (amber-free, just `text-gray-500`/secondary text) but framed as "how to use
  this" rather than "how far you are."
- **Action: "Copy code"** (outline button, copy/clipboard icon prefix) — copies the raw `code` string
  to the clipboard. On tap: brief inline confirmation directly on the button (label swaps to "✓
  Copied" for ~1.5s, matching Rewards' existing `copied` state pattern on its referral-code copy
  button — same interaction the codebase already has, reuse it) — no toast needed for this, the
  button's own label change is sufficient in-place feedback.
- No navigation on copy — the customer stays on Offers, browsing more codes, and will paste this one
  in at checkout later (either into the manual code field, or the codebase could special-case "coupon
  copied from Offers, auto-fill on next Checkout visit" — **out of scope for v1** per the plan's Q3
  answer, which explicitly rejected building pending-coupon client state; the manual paste is fine).

### 3.4 Disabled sub-state — button in-flight (applies within Eligible only)

Covered in §4.2 (interaction detail), not a fourth card state — the card's overall state doesn't
change while applying, just the button.

---

## 4. The apply interaction (Eligible cards only)

### 4.1 Trigger

Tap the card's **Apply — Save ₹X** button (§3.1). Full-card tap does nothing (§3.1 rationale) — only
the button is a tap target for the apply action, though the whole card remains scrollable/readable/
selectable.

### 4.2 In-flight

- Button becomes disabled, label swaps to a spinner + **"Applying…"** (matches Checkout's existing
  `isLoading` prop on its own Apply button — same visual convention, different screen).
- The rest of the card (code, discountSummary, meta) stays static — no skeleton, no dimming of
  content, this is a sub-second network call, not a data reload.
- Other cards on the screen remain fully interactive — tapping a different card's Apply while one is
  in flight is allowed to queue/replace (last request wins) rather than being blocked entirely, since
  each Apply call is independent and idempotent from the customer's point of view (only one coupon can
  end up applied to the cart regardless of how many they tap).

### 4.3 Success

- Server returns the repriced cart with the coupon applied (same response shape `POST
  /cart/coupon/apply` already returns today — no new contract).
- **Auto-navigate back to Cart/Checkout immediately** (plan §3.4 explicitly recommends this — "lands
  back on cart/checkout showing the applied coupon"). Do not show a separate in-place "Applied ✓" card
  state on Offers with a second manual "Go to cart" tap required — that's an extra tap for zero
  benefit, since there is nothing further to do on Offers once a coupon is on the cart. Auto-navigate,
  and let Checkout's own existing applied-coupon card (green chip + "You saved ₹X" + Remove, already
  built) be the confirmation the customer sees.
- Transition: standard platform push-back/pop navigation, no custom animation needed — this should
  feel instantaneous, like the button "took you there."
- If the customer manually backed into Offers from Checkout (rather than being deep-linked), popping
  back returns to that same Checkout instance with cart state refreshed — no full page reload, reuse
  whatever cart-refresh mechanism the Apply flow already triggers today (`refreshCart`/equivalent).

### 4.4 Failure

- Server refuses (coupon exhausted in the last 30 seconds, went disabled, etc. — plan §3.4/§7.3).
- **Stay on Offers.** Do not navigate anywhere.
- Show the server's message inline on that specific card, same visual treatment as a near-miss card's
  message line (amber, icon-prefixed) — but keep the button visible and re-enabled with its original
  "Apply — Save ₹X" label so they can retry if it was transient, UNLESS the server's response indicates
  the coupon is now genuinely gone/exhausted (e.g. same reason codes the plan's `validateCouponForCart`
  produces), in which case **refresh the whole list** (re-call `GET /user/coupon/available`) so the
  card's state (or its removal from the list entirely) reflects reality rather than a stale card
  sitting there promising something that no longer exists. This matches the plan's own instruction:
  "show the server's message ... and refresh the list" (§3.4).
- No destructive confirmation needed anywhere in this flow — applying a coupon is reversible (Remove
  exists on Checkout already) and this path never deletes anything.

---

## 5. Empty-list state (zero visible+eligible coupons)

```
┌──────────────────────────────────────────┐
│  ←  Offers                                │
├──────────────────────────────────────────┤
│                                            │
│              🎟️ / Tag icon                │
│                                            │
│         No offers right now               │
│   Check back soon — we add new offers     │
│         all the time.                     │
│                                            │
│         [   Continue shopping   ]          │
│                                            │
└──────────────────────────────────────────┘
```

- Centered, generous vertical padding (like Rewards' own "No wallet transactions yet" empty state —
  reuse that exact structural pattern: icon in a soft rounded tile, bold heading, muted one-line
  explainer, optional CTA).
- Icon: a coupon/ticket glyph (`Ticket`/`Tag` lucide on web — matches the icon already chosen for the
  admin Coupons nav entry per the admin spec, `Ticket`, for cross-surface consistency of "what a
  coupon looks like as an icon" even though customer and admin apps don't share components) inside a
  soft neutral tile (`bg-gray-100 dark:bg-gray-800`), same treatment as every other empty state in
  this app family.
- Copy: **"No offers right now"** / **"Check back soon — we add new offers all the time."** — encouraging,
  not apologetic, no mention of eligibility mechanics (never say "you don't qualify for anything," the
  customer doesn't need to know the mechanism, only that there's nothing to see yet).
- CTA: **"Continue shopping"**, outline button, routes to Home — same rationale as the near-miss card's
  CTA (§3.2), gives the customer somewhere to go rather than a dead end.
- **This state must be visually distinguishable from a loading or error state** (see §6) — an empty
  list is not a failure, and per this codebase's own established discipline (see the "error
  indistinguishable from empty" pattern already flagged in prior work on this project), never let a
  swallowed fetch error silently render as this friendly empty state — see §6.

---

## 6. Other states

- **Loading (initial fetch):** skeleton — 2-3 placeholder cards matching the real card's box shape
  (code-width bar, summary-width bar, button-width bar), same skeleton convention already used
  elsewhere in each client (Rewards' `Loader2` spinner + "Loading..." text is a lighter-weight
  alternative; prefer skeleton cards here since the final content IS cards — skeleton previews the
  actual shape, a bare spinner doesn't). No skeleton needed for longer than ~1-2s in practice (this
  is a single cheap read).
- **Error (fetch failed — network, 5xx, or old-backend 404):** distinct from both loading and empty —
  icon + **"Couldn't load offers"** + **"Check your connection and try again."** + **Retry** button
  that re-calls the endpoint. A 404 (old backend, plan §7.3 "New app + old backend") is treated
  identically to any other fetch failure that yields no data — same error card, not a special "this
  feature doesn't exist" message (the customer has no use for that distinction; "couldn't load" is
  true and actionable either way). **Never render the friendly empty state (§5) on a fetch failure**
  — same discipline already established elsewhere in this project (don't let a caught/swallowed error
  produce copy that's indistinguishable from "genuinely nothing to show").
- **Disabled entry-point affordances:** never — both entry points (§7) always render, unconditionally,
  per the plan (§3.5). There is no "hide View offers if the endpoint might 404" logic; the Offers
  screen itself absorbs that as its own error/empty state.
- **Post-apply-then-back:** if a customer applies a coupon, gets auto-navigated to Cart (§4.3), then
  taps "View offers" again mid-session, the list re-fetches fresh (cart has changed, other coupons'
  `eligibleNow`/`estimatedDiscount` may now differ since a coupon usually can't stack) — no cached
  stale list is ever shown; always re-fetch on screen entry, don't cache across visits.

---

## 7. Entry-point affordances

### 7.1 Cart/Checkout coupon area

```
Coupon
┌──────────────────────────────┐  ┌───────┐
│ Enter coupon code            │  │ Apply │
└──────────────────────────────┘  └───────┘
View offers →
```

- A single text link/button **"View offers →"** directly beneath the existing manual code-input row,
  inside the same coupon card (`Coupon` section header, same card boundary as Checkout's existing
  `Tag`-icon-headed block) — not a separate card, this is one more line in the section that already
  exists.
- Style: text-link weight (not a filled/outline button — this is a secondary, optional path next to
  the primary manual-entry interaction which stays the default/expected flow for a customer who
  already knows a code). `text-primary-600 dark:text-primary-400`, small chevron/arrow suffix, `text-sm
  font-semibold` — same visual weight class as other in-card text links already in this app (e.g. the
  admin's "View redemptions" link pattern, or web's existing text-link buttons).
- **Renders in the entry (no-coupon) state only** — once a coupon is applied, the card shows the
  applied chip + Remove (existing behavior, unchanged); showing "View offers" next to an
  already-applied coupon is redundant (they'd be swapping one applied coupon for another, which this
  spec doesn't design for — Remove-then-browse is the existing, sufficient path).
- Tap destination: push/route to Offers (§2.1's per-platform navigation), passing no cart-state
  props — Offers does its own fresh fetch.

### 7.2 Profile menu row

```
┌────────────────────────────────────────┐
│  🎟  Offers & Coupons              ›   │
└────────────────────────────────────────┘
```

- Placed **directly adjacent to the Wallet row** in the Profile menu list (plan §3.5 — "beside
  Wallet"), same row component/visual weight as every other Profile menu row (icon + title + chevron,
  no value/balance shown since there's no single number to summarize — unlike Wallet's "₹{balance}"
  trailing value).
- **Android:** new `SettingsRow`/menu-row entry using the same component already rendering "Haper
  Wallet", "Saved Addresses", etc. in `ProfileScreen.kt` (`icon = Icons.Default.ConfirmationNumber` or
  equivalent "ticket" Material icon — `Icons.Default.CreditCard` is taken by Wallet, needs a visually
  distinct icon; `ConfirmationNumber`/`LocalOffer` are Material's ticket/tag equivalents), label
  **"Offers & Coupons"**, `onClick` navigates to `composable("offers")`.
- **iOS:** new `NavigationLink(destination: OffersView())` wrapping a `ProfileMenuRow(title: "Offers
  & Coupons", icon: "ticket.fill", subtitle: "See what you can save right now")` — same component
  already used for Saved Addresses / Notifications / Support rows, SF Symbol `ticket.fill` (distinct
  from Wallet's `creditcard.fill`). Subtitle text is optional per the existing pattern (some rows have
  one, e.g. "Manage delivery locations") — recommend including one here since it's a newer, less
  self-explanatory feature than Wallet: **"See what you can save right now."**
- **Web:** a new item in whatever menu/dropdown currently links to `/rewards` (need to confirm the
  exact profile-menu component tanmoy-web uses — not located during this pass; flag as a build-time
  lookup for tanmoy-web, same row styling/icon (`Ticket` lucide) as its neighbours, linking to
  `/offers`).
- Row placement rationale: Wallet and Offers are both "things that save you money," adjacent placement
  groups them as a natural pair — matches the plan's explicit instruction.

---

## 8. Design tokens (reused, none new)

| Purpose | Token / value |
|---|---|
| Card surface | `bg-white dark:bg-gray-900`, `rounded-xl`/`rounded-2xl`, `border border-gray-100 dark:border-gray-800`, `shadow-sm` |
| Page background | `bg-gray-50 dark:bg-gray-950` |
| Primary text | `text-gray-900 dark:text-white` |
| Secondary/muted text | `text-gray-500 dark:text-gray-400` |
| Eligible / "money in customer's favour" | emerald family — `emerald-50/200/600/800`, `#22c55e` (same hex already used on Checkout's applied-coupon card and admin POS applied row) |
| Near-miss / "normal, not broken" | amber — `#d97706`/`amber-600` (same hex already used for Checkout's stale-coupon message and every admin "0 left"/caution state) |
| Error / fetch failure | `red-600`/`rose-600` (same as Checkout's `couponError` text) |
| Primary accent (buttons, links) | `primary-500/600` (the app's orange primary — matches Checkout's existing `Button` component and `focus:ring-primary-500`) |
| Spacing | 16px page padding, 12-16px inter-card gap, 12-16px internal card padding — matches Checkout's `p-4` card rhythm |
| Type | Code: `text-base font-bold tracking-wide`; discountSummary: `text-sm font-semibold`; description/meta: `text-xs text-gray-500`; button label: `text-sm font-semibold` |
| Radius | `rounded-xl`/`rounded-2xl` cards, `rounded-lg` buttons/inputs — matches Checkout |

No new colors, no new type scale — everything above already exists in at least one of Checkout.tsx,
Rewards.tsx, or the admin specs' documented palette.

---

## 9. Component inventory

| Component | Status | Notes |
|---|---|---|
| Offers screen/page shell | New | Web: `pages/Offers.tsx` + `/offers` route. Android: `ui/screens/offers/{OffersScreen,OffersViewModel}.kt` + `composable("offers")`. iOS: `Views/OffersView.swift` + `ViewModels/OffersViewModel.swift`. |
| Offer card (3 states) | New | Single component with a `state` derived from `eligibleNow` + `cartSubtotal === 0`, per §3 — not three separate components, one component with conditional body/action per §2.3's shared skeleton. |
| Apply button (in-flight/success/failure) | New | Reuses the existing cart-apply call (`POST /cart/coupon/apply` client wrapper each platform already has from the Checkout coupon feature) — no new API client method beyond the new `GET /user/coupon/available` call. |
| Copy-code button + "Copied" flash | Reuse pattern | Same interaction already built for Rewards' referral-code copy button (web `copied` state / iOS-Android equivalents) — same ~1.5s label-swap convention. |
| Empty-list state | Reuse pattern | Same icon-tile + heading + muted line + CTA shape as Rewards' "No wallet transactions yet" / Checkout's existing empty states. |
| Error state (fetch failed) | Reuse pattern | Same icon + message + Retry shape used elsewhere (admin Coupons/Discounts list error state is the closest documented precedent; customer apps should already have an equivalent generic list-error component — reuse it, don't invent a new one). |
| Skeleton cards | New, trivial | 2-3 placeholder boxes matching the real card's line layout. |
| "View offers →" text link (Checkout entry point) | New, trivial | One `<Text>`/`<button>` styled as a link, inside the existing coupon card. |
| Profile menu row (Offers & Coupons) | New, trivial | Reuses each platform's existing menu-row component (`SettingsRow`-equivalent Android, `ProfileMenuRow` iOS, whatever renders the Wallet row on web) — new icon + label + destination only. |

---

## 10. Accessibility

- **Touch targets:** Apply / Copy code / Continue shopping buttons are full-width and at least 44pt/dp
  tall (matches Checkout's own `min-h-[44px]` convention already in use for its Remove button).
- **Focus order (web):** header back button → context line (not focusable) → cards in list order, each
  card's interactive elements (button, and the code text if selectable) in visual top-to-bottom order.
  No focus traps — the in-flight/disabled Apply button must not swallow focus when it becomes
  disabled (focus moves to the next focusable element per standard `disabled` semantics).
- **Screen reader labels:**
  - Card overall: no single wrapping `role="group"` label needed beyond its visible text being read
    in order (code → summary → description → meta → message → button) — the button itself must have
    an accessible name that includes the amount, e.g. "Apply, save 75 rupees 80 paise" (or the
    platform's natural currency-reading convention) — not just "Apply," since a screen-reader user
    flicking through buttons needs to distinguish "Apply — Save ₹75.80" from "Apply — Save ₹30" without
    reading the whole card.
  - Near-miss state tag ("₹120 more to go") must be readable as part of the card's content, not color-
    only — it already is, since it's rendered as text, but confirm no state is communicated by color
    alone (the eligible/near-miss distinction is ALSO carried by the tag text and button label, not
    just border tint — satisfies WCAG 1.4.1).
  - Copy-code button: after tapping, the "✓ Copied" label change must also fire an `aria-live="polite"`
    announcement (web) / equivalent (`UIAccessibility.post(notification: .announcement, …)` iOS,
    `liveRegion` Android) — a silent label swap is invisible to a screen-reader user relying on audio
    feedback alone.
- **Contrast:** emerald-on-white-tint, amber-on-white-tint, and primary-accent buttons must all be
  checked per this project's own documented light/dark contrast gotchas — reuse the exact hex values
  already verified elsewhere in this codebase (§8) rather than picking new shades, since those have
  already been vetted for both themes.
- **Reduced motion:** the auto-navigate-on-success transition (§4.3) should respect
  `prefers-reduced-motion`/platform equivalents by using the standard (non-custom) push/pop transition
  each platform already provides — no bespoke animation is being added here to begin with, so this is
  a "don't add one," not a "add a reduced-motion variant."

---

## 11. Platform-specific adaptation summary

| Aspect | Android (Material) | iOS (HIG) | Web (React) |
|---|---|---|---|
| Screen container | `composable("offers")`, `TopAppBar` w/ back arrow, `LazyColumn` of cards | Pushed `OffersView` via `.navigationDestination`, native large-title or inline title | Dedicated route `/offers`, plain header (not gradient hero, §2.2) |
| Card list | `LazyColumn` + `Card` composables | `ScrollView` + `VStack` of card views (or `List` with `.plain` style + custom row background to avoid default List chrome fighting the card look) | `<div>` stack, Tailwind card classes matching Checkout |
| Apply button in-flight | `CircularProgressIndicator` inline in button + disabled state | `ProgressView()` inline + `.disabled(true)` | `Button` component's existing `isLoading` prop (already used on Checkout's own Apply button) |
| Copy-to-clipboard | `ClipboardManager` | `UIPasteboard.general.string` | `navigator.clipboard.writeText` (same call Rewards already uses) |
| Auto-navigate on success | `navController.popBackStack()` back to Cart/Checkout destination | `dismiss()`/pop navigation stack back to `CartView`/`CheckoutView` | `navigate('/checkout')` or equivalent, reusing existing post-apply refresh |
| Entry point icon (Profile) | Material `ConfirmationNumber` or `LocalOffer` | SF Symbol `ticket.fill` | lucide-react `Ticket` |

---

**End of spec.**
