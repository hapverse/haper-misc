# Payment confirmation + retry — UI spec (task 2.0)

Status: DRAFT for user sign-off. Author: chanchal-designer, 2026-09-24.
Prerequisite for: android platform engineer (Phase 2, tasks 2.1-2.9).
Cross-reference: `payment-confirmation-retry.md` §3.2 (state table), §5 (API shape), §7.1 (draft copy this
spec refines), §12 (admin edit/COD-conversion interactions). This doc does not repeat the API contract —
read that doc for field names and behaviour, this doc only for look, flow and copy.

---

## 0. What I read before designing this

Existing Android screens, to match rather than invent:
- `ui/screens/checkout/PaymentFailedScreen.kt` — the closest existing screen to S2/S3/S4. Danger icon circle,
  glass detail card (`DetailRow` rows), amber primary CTA (`HaperButtonAccent.Amber`), secondary + tertiary
  text actions stacked below.
- `ui/screens/orders/OrderSuccessScreen.kt` — S5, unchanged. Teal/green pulsing check, glass summary card,
  primary + secondary buttons.
- `ui/screens/orders/OrdersScreen.kt` `OrderCard` — status dot + colour, 4-segment progress bar, meta chips
  (`OrderMetaChip`), bottom action row with a pill "Track" button.
- `ui/screens/orders/OrderDetailScreen.kt` — the bill panel's "Paid ₹X / Paid via {method}" block this spec
  must change for a pending order.
- `ui/theme/Color.kt` — the token set used below. No new colours are introduced; `Warning`/`WarningSurface`/
  `WarningOutline`/`WarningText` already exist and are unused for orders today — this is their first use,
  which is exactly the "payment pending" amber the app needs.

This app has one component library (`HaperPrimaryButton`, `HaperSecondaryButton`, `HaperButtonAccent`,
`DetailRow`, glass-panel shadow modifiers) — every new screen below reuses it. No new visual style is
introduced.

---

## 1. The one decision the engineer needs made: one screen, state-driven

**Recommendation: ONE composable, `PaymentStatusScreen`, one route (`paymentStatus/{orderDbId}`), driven by
one `PaymentUiState` (already named in plan §2.4).** Not seven screens/routes.

Reasoning:
- S1→S2→S3→S4 (and back to S2 on a retry failure) are the **same order, same screen instance**, changing
  only because the poll or a retry answered differently. Routing between separate screens would either lose
  the countdown's monotonic timer on each hop or force it into a shared parent anyway — more code for zero
  benefit.
- S6 and S7 are reachable from the exact same poll loop (any poll response can say "actually it's COD now"
  or "couldn't reach the server this time") — they must be states of the same screen, not separate
  destinations, or the countdown/poll machinery has to be duplicated.
- S5 (Paid) is the **one exception**: it navigates OUT to the existing `orderSuccess/{orderDbId}/...` route
  and clears back-stack up to Orders, exactly like today's `onOrderSuccess`. Do not render "Paid" inside
  `PaymentStatusScreen` — reuse `OrderSuccessScreen` as-is (plan explicitly says "unchanged").
- So: **6 states render inside `PaymentStatusScreen`** (Confirming, AwaitingPayment-with-retry,
  AwaitingPayment-almost-up, Expired, SwitchedToCod, CheckFailed), **1 state (Paid) navigates away**.

Visual relationship: all 6 in-screen states share one shell —
```
Scaffold (SurfaceApp background, same 34dp side padding as PaymentFailedScreen)
  └─ centered Column: icon-in-circle (88dp) → title → subtitle → glass detail card → CTA stack
```
Only the icon, icon colour, title, subtitle, detail-card contents and CTA stack change per state. This is
literally `PaymentFailedScreen`'s layout generalised to 6 states — reuse its structure, do not build a new
layout.

**FINAL: the one-screen decision, the route name, and the shared shell.** If any state genuinely cannot fit
this shell (I don't expect this), flag back to me before diverging — don't silently add a second layout.

---

## 2. Visual shell (applies to every in-screen state)

```
┌─────────────────────────────────────┐
│                                       │
│              ( icon )  88dp circle   │  ← colour + glyph per state (never colour alone, see §7)
│                                       │
│         Title  24sp SemiBold          │  Quicksand, center
│                                       │
│   Subtitle  13.5sp  InkSecondary      │  center, 21.6sp line-height, 1-2 lines
│                                       │
│  ┌─────────────────────────────────┐ │
│  │  glass detail card (DetailRow×N) │ │  same panelShadow/gradient as PaymentFailedScreen
│  └─────────────────────────────────┘ │
│                                       │
│  [ Primary CTA — full width ]        │  HaperPrimaryButton, accent varies by state
│  [ Secondary CTA — full width ]      │  HaperSecondaryButton, optional
│   Tertiary text link                 │  optional, InkTertiary, small
│                                       │
└─────────────────────────────────────┘
```
Padding: `start=34dp end=34dp top=34dp bottom=104dp` (matches `PaymentFailedScreen`/`OrderSuccessScreen` —
keeps clearance above the nav tray). Icon circle: 88dp, `RoundedCornerShape(percent=50)`. Detail card: same
`panelShape = RoundedCornerShape(HaperDimens.sheetLargeCardMin)`, same white→mint 150° gradient + 1dp
`WhiteBorder90` + `panelShadow`, padding `horizontal=15dp vertical=13dp`. Title: `Quicksand`, 24sp,
`FontWeight.SemiBold`, `MaterialTheme.colorScheme.onBackground`. Spacing between icon→title 20dp,
title→subtitle 9dp, subtitle→card 22dp, card→primary CTA 20dp, primary→secondary CTA 10dp,
secondary→tertiary 16dp — identical rhythm to `PaymentFailedScreen`.

This screen is reached only from checkout (SDK callback) or cold-start recovery (plan §2.6) or the orders
list/detail "Complete payment" button — never has its own entry in bottom nav.

---

## 3. State-by-state spec

For every state: layout, copy (final unless marked), button behaviour, loading/error sub-states,
accessibility notes.

### S1 — Confirming

**When:** right after the Razorpay SDK reports success, before the server confirms (`verify` in flight, then
polling). Typically 1-3s, up to 20s.

- Icon: 88dp circle, `WarningSurface` background (not Danger, not Green — this is neutral-in-progress), a
  spinning `CircularProgressIndicator` (24dp, `Warning` colour, 2.5dp stroke) centered inside it **instead of**
  a static glyph — the only state that animates its icon.
- Title: **"Confirming your payment"**
- Subtitle: **"This usually takes a few seconds. Please don't close the app."**
- Detail card: `DetailRow("Order", "#HP…")`, `DetailRow("Amount", "₹X")`. No reason row (nothing failed).
- No buttons for the first 20 seconds.
- **After 20s** (still unresolved): subtitle changes to **"This is taking a little longer than usual. We'll
  update your order the moment your bank confirms — you can check back anytime."** and one button appears:
  `HaperSecondaryButton("Go to my orders")` → navigates to Orders list (the order shows its "Payment
  pending" card there, per §6). The screen keeps polling in the background per plan §2.4 even after
  navigating away is offered — it does not stop just because the button appeared.
- Never shows a success or failure glyph in this state — that's the whole point of S1 existing.
- **A11y:** `contentDescription = "Confirming your payment, please wait"` on the spinner group; announce via
  `liveRegion = LiveRegionMode.Polite` when the subtitle changes at 20s (screen reader users get the delay
  news without re-focusing).

### S2 — Complete your payment

**When:** `AWAITING_PAYMENT`, `canRetry:true`, ≥90s left. Reached after a back-out/decline, or on
resume/cold-start for an order still open to retry.

- Icon: 88dp circle, `WarningSurface` background, a clock glyph (`Icons.Default.Schedule` or equivalent),
  tint `Warning`. (Amber = "action needed", distinct from S1's spinner and S4/Danger's cross.)
- Title: **"Complete your payment"**
- Subtitle (default, no prior failure): **"Your order is on hold — finish paying to confirm it."**
- Subtitle (a previous attempt failed, `retryBlockedReason` absent): the plain-words failure reason, e.g.
  **"Your bank declined this payment. You can try again."** or **"That payment attempt was cancelled. You
  can try again."** — map the SDK/gateway reason to one of a short fixed set of plain sentences (never show
  a raw gateway code to the customer):
  | Gateway reason (examples) | Customer copy |
  |---|---|
  | insufficient funds / declined | "Your bank declined this payment." |
  | user cancelled / dismissed | "You closed the payment window before it finished." |
  | timeout / network | "The payment didn't go through in time." |
  | anything unmapped | "That payment attempt didn't go through." |
- Detail card: `DetailRow("Order", "#HP…")`, `DetailRow("Amount", "₹X")`, `DetailRow("Time left", "11:32",
  monospace = true)` — countdown live-updates every second, colour `InkPrimary` normally.
- **After the 3rd failed attempt** (client-tracked, resets per order): one more line under the card, small,
  `InkTertiary`: **"Tip: try a different UPI app, or pay by card instead."**
- Primary CTA: `HaperPrimaryButton("Pay ₹X", accent = Amber)` → re-fetches `payment-status` first; if still
  `canRetry`, opens Razorpay checkout with the server's `checkout` block (same order id). Double-tap guarded
  (`isOpeningCheckout`). If the re-fetch says `canRetry:false` (time ran out or state changed while the
  button sat there), re-render to whatever state the fresh poll returned instead of opening checkout —
  **never open a sheet the server has already invalidated.**
- Secondary CTA: `HaperSecondaryButton("Cancel order")` → confirmation dialog (see §5) → on confirm, calls
  cancel, then navigates to Orders list (plan §5.4, Q4: allowed anytime in the 15-min window now).
- Tertiary text link: **"Back to home"**, `InkTertiary`, 11.5sp, leaves the order as-is (does not cancel).
- **Order edited by admin mid-flow** (`retryBlockedReason: "ORDER_EDITED"`, plan §12.3.4): this is a
  **distinct rendering of S2**, not the retry-failure copy above:
  - Icon: same amber clock (this is not a failure, it's a store action).
  - Title: **"Your order was updated"**
  - Subtitle: **"The store changed something in your order — they may call you about it. This payment link
    no longer works for it."**
  - Detail card: `DetailRow("Order", "#HP…")`, `DetailRow("New amount", "₹X")` (the edited total, not the
    original).
  - No Pay button (retry is closed). Primary CTA becomes `HaperPrimaryButton("Place a new order",
    accent=Amber)` → opens cart. Secondary: `HaperSecondaryButton("Cancel order")` same as above. No "3rd
    failure" tip (irrelevant here).
  - This is the "small copy" item plan §12.11 assigns to me — copy above is final for it.
- **A11y:** countdown `DetailRow` gets `contentDescription = "Time left to pay: 11 minutes 32 seconds"`
  (spelled out, not "11:32" read digit-by-digit) and is wrapped in a `liveRegion = Polite` region that
  updates only once a minute (not every second — a screen reader announcing every second would be
  unusable). Buttons ≥48dp touch target (both already are, per `HaperButton`).

### S3 — Retry failed again

Not a separate screen: **S2 re-rendered** with the new failure reason via the mapping table above, replacing
the previous reason in place — no dialog stacks on top of the existing screen, no navigation event, the
subtitle text just updates (with a brief crossfade, 150ms, `HaperMotion` easing — same restraint as the rest
of the app's micro-interactions). The countdown does not reset. The failure-count tip in §S2 accrues across
S2→S3→S3... on the same order.

### S2 in "time's almost up" mode

**When:** `AWAITING_PAYMENT`, `canRetry:false` because <90s remain (cron hasn't fired yet).

- Icon: 88dp circle, `DangerSurface` background, clock glyph tint `Danger` (colour shift signals urgency
  escalation — still paired with text, never colour-only).
- Title: **"Time's almost up"**
- Subtitle: **"Less than a minute left to pay — it's safer to place a new order now."**
- Detail card: same rows, "Time left" row shows the final seconds ticking down in `Danger` colour, bold.
- No Pay button (retry is closed server-side too — `canRetry:false`). Primary CTA:
  `HaperPrimaryButton("Go to cart", accent = Amber)` → opens cart. Secondary: `HaperSecondaryButton("Cancel
  order")` unchanged. No tertiary link (do not offer "back to home" here — the countdown is about to expire
  and burying the exit invites a stranded customer at S4 with no context).
- This sub-state auto-transitions to S4 the moment the poll reports `EXPIRED` (cron ran) — no user action
  needed, no flash of anything in between.

### S4 — Payment time ran out

**When:** `paymentState: EXPIRED`.

- Icon: 88dp circle, `DangerSurface` background, an X/close glyph tint `Danger` (matches `PaymentFailedScreen`
  exactly — same icon, same meaning: "this didn't happen").
- Title: **"Payment time ran out"**
- Subtitle: **"Order #HP… wasn't placed — no money was taken."**
- Detail card: `DetailRow("Order", "#HP…")`, `DetailRow("Amount", "₹X")`. If `walletRefund > 0`, one more
  row, `DetailRow("Haper wallet", "+₹N", valueColor = GreenAction)` with the card gaining a one-line note
  above the divider: **"₹N in Haper coins is back in your wallet."**
- If the order was admin-edited before expiring (`onlinePaymentClosedAt` was set, still hit the 15-min cron):
  same S4 shell, subtitle instead reads: **"Order #HP… wasn't placed — the store had updated it, and time
  ran out before it could be paid."** (only shown if this combination is distinguishable from the API; if
  the backend cannot tell S4-plain from S4-after-edit apart, use the plain S4 copy — flag this back to me,
  don't guess a distinction the data doesn't support.)
- Primary CTA: `HaperPrimaryButton("Place order again", accent = Amber)` → opens cart (existing cart
  contents, per plan §3.5/Q8). If the cart is empty (customer or someone else cleared it): same button
  label, navigates to cart anyway, and the cart screen's own existing empty-state applies — do not
  special-case emptiness inside this screen.
- Secondary CTA: `HaperSecondaryButton("Back to home")`.
- No countdown, no retry — this state is a dead end for the old order, cleanly.

### S5 — Paid

Existing `OrderSuccessScreen`, byte-for-byte unchanged. `PaymentStatusScreen` navigates to
`orderSuccess/{orderDbId}/{displayOrderId}` and pops itself off the back stack (so Back from the success
screen goes to Orders/Home, not back into a stale payment-status screen). **FINAL — confirmed nothing about
this screen needs to change.**

### S6 — Switched to Cash on Delivery

**When:** `paymentState: SWITCHED_TO_COD` (admin converted the order, plan §12.2, possibly mid-payment).

- Icon: 88dp circle, gradient matching `OrderSuccessScreen`'s success check (teal/green 150° gradient,
  `SuccessCheckTop → GreenPrice → GreenShade`), white check glyph. This *is* good news for the customer (a
  confirmed order), so it borrows the success treatment, not the amber "pending" one — deliberately distinct
  from S2/S4 so a customer who was mid-retry doesn't read this as another warning.
- Title: **"Order confirmed — pay by cash"**
- Subtitle: **"The store switched your order to Cash on Delivery. Pay the rider when your order arrives."**
- Detail card: `DetailRow("Order", "#HP…")`, `DetailRow("Pay on delivery", "₹X")`.
- Primary CTA: `HaperPrimaryButton("Track my order")` → navigates into the existing order-detail flow (same
  target as `OrderSuccessScreen`'s "Track my order").
- No secondary CTA, no Pay button, no cancel — this order is live, no retry-payment option is ever shown
  here (matches plan AC-A5 exactly).
- **A11y:** the icon must not be the only "this is good news" signal — the title text carries it plainly
  ("Order confirmed"), so this holds even for a screen reader or a colour-blind customer.

### S7 — Check failed

**When:** the `payment-status` poll itself fails (network error, timeout, 5xx) — never a state the *server*
reports, purely a client-side "couldn't ask" state. Also used for `PaymentStatusViewModel`'s "taking longer
than 2 minutes, stopped polling" backstop.

- Icon: 88dp circle, `SurfaceSunken` background (neutral grey-green, not amber/red — this is "we don't
  know", not "something's wrong with your order"), a Wi-Fi-off or refresh glyph, tint `InkSecondary`.
- Title: **"Couldn't check your payment"**
- Subtitle: **"We're not sure yet if your payment went through. This does not mean it failed — check your
  connection and try again."** (explicitly reassuring: never implies failure)
- Detail card: `DetailRow("Order", "#HP…")` only — no amount/time claims when the state itself is unknown.
- Primary CTA: `HaperPrimaryButton("Check again", accent = Amber)` → re-fetches `payment-status` immediately,
  shows a brief inline spinner on the button itself (existing `HaperPrimaryButton` loading-state pattern, if
  one exists in the component; otherwise disable + spinner glyph for the request's duration, 100-2000ms).
- Secondary CTA: `HaperSecondaryButton("Go to my orders")` — same rationale as S1's 20s fallback: the order's
  true state will show correctly on the list/detail screens (§6) once reachable, without the customer being
  stuck staring at a spinner.
- **Never** shows anything about the order being paid, failed, or expired while in this state — the whole
  point of S7 is refusing to guess (plan's core principle, restated in the acceptance criteria as AC14).

---

## 4. Loading and empty sub-states (explicit, per team standard)

| Sub-state | Where | Treatment |
|---|---|---|
| **Loading** | First paint of `PaymentStatusScreen`, before the first `payment-status`/`verify` response lands | Show S1's shell (spinner icon, "Confirming your payment") even if the entry point was a cold-start recovery (plan §2.6), not S1's copy specifically if the entry was NOT a fresh SDK success — use a neutral **"Checking your order…"** title instead of "Confirming your payment" for the cold-start/resume case, same spinner treatment. This avoids implying a payment was just attempted when the customer just reopened the app. |
| **Empty** | N/A — this screen never has a content-less "empty" state; every reachable path resolves to one of S1-S7. | — |
| **Error (network)** | Poll fails | S7. |
| **Error (404 payment-status, old backend not deployed yet)** | Plan §2.4 fallback | Silently fall back to the existing `GET /order/:id` status mapping; render whichever of S1/S2/S4/S5 that maps to. Never show S7 for a 404 — that's a deploy-ordering fact, not "couldn't check". |
| **Disabled** | Pay button mid-request (double-tap guard) | Button shows a spinner glyph in place of the label text, same width, disabled interaction, `HaperButtonAccent.Amber` colour held (not greyed) so it doesn't read as "broken". |
| **Disabled** | Cancel button after tapping (avoid double-cancel) | Same pattern, `HaperSecondaryButton` variant. |

---

## 5. Confirmation pattern: "Cancel order" (destructive-ish, but reversible-in-effect)

Cancelling here only gives up a hold no money has actually left for — still needs a confirm step to avoid a
mis-tap losing an order the customer meant to keep paying for.

- Standard `AlertDialog` (match whatever dialog primitive the app already uses elsewhere — grep for an
  existing `ConfirmDialog`/`AlertDialog` wrapper before adding a new one; if `haper-android` doesn't have a
  shared one, flag this back to me, don't invent a one-off dialog style).
- Title: **"Cancel this order?"**
- Body: **"Order #HP… (₹X) will be cancelled. Nothing was charged, so there's nothing to refund."** (if
  `walletRefund` would apply because coins were held: **"…and ₹N in Haper coins goes back to your wallet."**)
- Buttons: `Keep order` (dismiss, default focus) / `Yes, cancel` (`Danger` tint text button, not a filled
  danger button — this app's existing danger actions use text-weight emphasis, see `PaymentFailedScreen`'s
  amber-not-red retry pattern as the precedent for "don't over-alarm a routine choice").
- No stacking: if the cancel request itself fails (409 `ORDER_CHANGED` — order moved under the customer,
  e.g. it just got paid or expired), close the dialog and let the next poll's fresh state render normally —
  do not show a second error dialog on top.

---

## 6. Orders list & detail: honest pending state

This is the bug that started the whole plan (§0) — get this part exactly right.

### 6.1 List card (`OrdersScreen.kt` `OrderCard`)

For `order.status == PAYMENT_INITIATED` (and not `SWITCHED_TO_COD`/edited-closed, which render as their own
real statuses once converted):

- Status dot + label: reuse the existing dot+text pattern, but status colour becomes `Warning` (not
  whatever "active" colour it defaults to today) and label text becomes **"Payment pending"** — this is
  the `orderStatus.displayName` today (plan confirms `PAYMENT_INITIATED` → "Payment Pending" already exists
  in `OrderModels.kt`; this spec just says: also drive the dot colour off it, and stop drawing the progress
  bar).
- **No 4-segment progress bar** — `listProgressSegments = 0` for this status (plan 2.7 already specifies
  this; confirming it here as the visual requirement it satisfies: a bar implies motion toward delivery,
  which is false for an unpaid order).
- **No delivery OTP well** (this order was never assigned/packed — OTP only ever shows for `isActive &&
  !isInStore`, and this status should not report as needing an OTP shown regardless of `isActive`'s
  definition; if `isActive` already excludes it, no change needed — verify against the live enum, don't
  assume).
- New: directly under the status row (where the progress bar used to sit), a single-line amber hint,
  matching the OTP-well's visual weight but simpler — **just text, no boxed well**: **"Complete your payment
  to confirm this order"**, 11.5sp, `WarningText` colour, `FontWeight.Bold`, padding-top 11dp (same slot the
  progress-bar+caption pair occupies for active orders).
- Footer row (price + action pill): replace the "Track" pill with a **"Complete payment"** pill, same shape/
  size/position (`RoundedCornerShape(11dp)`, 32dp height, pill gradient), but amber gradient instead of the
  green "Track" gradient (`AddButtonTop/Mid/Deep` → equivalent Warning-toned stops; if no amber pill gradient
  constant exists yet, flag back to me — do not invent new gradient stops without a token). Tapping it
  navigates to `paymentStatus/{orderDbId}`, same as tapping the card body.
- Card border: the existing `statusColor.copy(alpha=0.38f)` border automatically becomes amber once the
  status colour maps to `Warning` — no extra work, just confirm the mapping is wired through
  `orderStatus.color`.

ASCII (mobile card, unchanged width/shape from today, only the marked rows differ):

```
┌───────────────────────────────────────┐
│ ● Payment pending            #HP57099093│  ← dot+label now Warning, no bar below
│                                         │
│ Complete your payment to confirm this  │  ← NEW, replaces progress bar+caption
│ order                                  │
│                                         │
│ [img][img][img]  2x Milk, Bread, ...   │  ← unchanged
│ Today, 4:12pm · 3 items                │
│                                         │
│ [📍Home] [Razorpay]                    │  ← unchanged meta chips
├───────────────────────────────────────┤
│ ₹540                    [Complete payment]│  ← pill relabelled + recoloured amber
└───────────────────────────────────────┘
```

### 6.2 Detail screen (`OrderDetailScreen.kt` bill panel)

For the same status, replace the bill-panel's bottom block (today: "Paid ₹X" + "Paid via Razorpay"):

- Row label changes from **"Paid"** to **"To pay"**, same 16sp/800/`InkPrimary` styling — deliberately kept
  visually equal-weight to "Paid" (not shrunk/greyed) because this is still the number the customer needs
  to act on, not a de-emphasized fact.
- Caption changes from "Paid via {method}" to **"Payment pending via Razorpay"**, `WarningText` colour
  instead of `InkTertiary` (the only colour change in this block — small, deliberate, matches the list
  card's amber signal so the two screens read as one system).
- New: a banner directly above this bill block (inside the same `OrderPanel`, so it doesn't need a new
  card), matching the "Changes while preparing" card's structure (`SectionEyebrow` + text + optional action)
  already used elsewhere on this screen:
  - Eyebrow: **"Payment pending"**
  - Body: **"Finish paying to confirm this order. Order #HP… holds your items for a little while longer."**
  - Action: `HaperSecondaryButton("Complete payment")` full-width → `paymentStatus/{orderDbId}`. (Secondary,
    not primary — the detail screen's real primary action stays whatever it is today, e.g. "Track"/"Need
    help"; this doesn't fight it for attention on first glance, but is still clearly present.)
- **No countdown shown on the detail screen.** The list card and detail screen state "payment pending"
  plainly; the live countdown belongs only to `PaymentStatusScreen`, which is one tap away via "Complete
  payment" — showing two independently-ticking clocks on two screens for the same order risks them drifting
  visually (different poll cadence) and reads as a bug even when both are technically correct.

---

## 7. Accessibility (applies across all states)

- **Colour is never the only signal.** Every state pairs its status colour with (a) a distinct icon glyph
  (spinner / clock / cross / check / wifi-off) and (b) an explicit text label ("Confirming", "Complete your
  payment", "Time's almost up", "Payment time ran out", "Order confirmed", "Couldn't check"). A colour-blind
  or screen-reader user gets the same information as a sighted user reading colour.
- **Contrast:** `Warning` (#C98A2E) on `SurfaceApp`/white passes AA for the 11.5sp bold text uses specified
  above (verify against the exact background used — the amber pill/chip pairing already exists in the token
  set as `WarningSurface`/`WarningText`, which were chosen together for this reason; do not substitute
  `Warning` text directly onto `WarningSurface` fill without re-checking — use `WarningText` on
  `WarningSurface`, `Warning` only on plain white/`SurfaceApp`).
- **Countdown for screen readers:** never read digit-by-digit "one one colon three two". Use a
  `contentDescription`/`liveRegion` announcing "11 minutes 32 seconds left", updated at most once a minute
  (see S2 above) — a screen reader that announces every visual tick is unusable, not accessible.
  `reduceMotion`/TalkBack users must still get the *final* transition (S2 → S4) announced immediately when
  it happens, regardless of the throttled minute-by-minute updates.
- **Touch targets:** all buttons ≥48dp height (existing `HaperButton` components already satisfy this — no
  new custom-sized tap targets anywhere in this spec).
- **Focus order:** icon (skipped, decorative except S6 which needs the "confirmed" meaning carried in text
  regardless) → title → subtitle → detail card rows → primary CTA → secondary CTA → tertiary link. Matches
  natural reading order top-to-bottom, no custom traversal needed.
- **Motion:** the S1 spinner and the S2→S3 crossfade both respect system-level "reduce motion" — spinner
  degrades to a static clock glyph with the same "please wait" text carrying the meaning; the 150ms
  crossfade degrades to an instant swap. Neither carries information motion alone — text and colour already
  do.
- **List/detail chip contrast:** the new amber "Payment pending" chip/label on `OrdersScreen` must be
  checked against the card's white background at implementation time the same way the existing green/red
  status colours already are — no new contrast risk expected (amber tokens already exist and are presumably
  cleared for use elsewhere), but this spec does not have visual QA tooling to confirm at design time, so
  it's called out for the engineer to verify against the actual rendered card, not just the hex value in
  isolation.

---

## 8. What's FINAL vs what to flag back to me

**FINAL (build to this, no need to re-check with me):**
- The one-screen, state-driven architecture (§1) and the shared shell (§2).
- All copy in §3 (S1, S2, S3, "almost up", S4, S6, S7) and the failure-reason mapping table.
- The colour/icon assignment per state (Warning-spinner / Warning-clock / Danger-clock / Danger-cross /
  Green-check / Neutral-wifi-off).
- S5 stays `OrderSuccessScreen`, untouched.
- The confirm-dialog copy and pattern for "Cancel order" (§5).
- The list-card and detail-screen copy and layout changes (§6).
- The accessibility requirements in §7.

**FLAG BACK TO ME if any of these don't fit technically — do not silently resolve them differently:**
1. Whether `PaymentFailedScreen.kt` gets **retired** (its Danger/Amber visual language is fully absorbed
   into S2/S3/S4 above) or kept as a distinct screen for some other caller — plan §2.5 leaves this open
   ("retire it" as an option). My recommendation: retire it, route everything through
   `PaymentStatusScreen`, since keeping both means two places to update the failure-reason copy table.
2. Whether the app has an existing shared confirm-dialog component (§5) — if not, tell me before building a
   one-off, so I can spec it once for reuse.
3. Whether `isActive` already excludes `PAYMENT_INITIATED` from the OTP-well condition (§6.1) — if it
   doesn't, that's a small additional guard needed, not just a copy change.
4. Whether an amber pill-gradient token exists for the "Complete payment" list-card button (§6.1) — if not,
   I'll supply exact stops once I know the format used by `AddButtonTop/Mid/Deep`.
5. Whether the backend can actually distinguish "S4 after a plain expiry" from "S4 after an admin edit then
   expiry" in the `payment-status` response (§3 S4) — if `retryBlockedReason`/`onlinePaymentClosedAt` isn't
   surfaced post-expiry, use the plain S4 copy only, and tell me so I drop the edited-variant line rather
   than leaving dead copy in the codebase.
6. Exact icon glyphs (I named Material-style equivalents — `Schedule`, `WifiOff`/`Refresh`, `Check`,
   `Close`) — confirm against whatever icon set `haper-android` actually ships beyond `Icons.Default.Close`/
   `Check` seen in the two files I read; substitute the closest equivalent already in use elsewhere in the
   app rather than pulling in a new icon pack for one screen.

---

STATUS: done
OUTPUT: full UI spec for payment-confirmation-retry (S1-S7, list/detail pending states, a11y, states/loading/error/disabled) written to /Users/office/Documents/haper/haper-misc/docs/plans/payment-confirmation-retry-ui-spec.md
NEXT: USER — sign off on this spec (per plan task 2.0, Android work starts only after sign-off); once approved, hand the full spec verbatim to the android platform engineer for tasks 2.1-2.9, alongside payment-confirmation-retry.md
