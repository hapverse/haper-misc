# Print cash on delivery (COD): UI design spec

Plan (authoritative for rules): `/Users/office/Documents/haper/haper-backend/docs/plans/print-cod.md` (§1, §5, §6, §7 tasks 7-12, §8).
Matches: `/Users/office/Documents/haper/haper-misc/design-print-page-spec.md`, `/Users/office/Documents/haper/haper-misc/design-print-entry-final.md`.
Mockup: `/Users/office/Documents/haper/haper-misc/design-print-cod-samples.html` (same practice as `design-print-page-samples.html`; open in a browser).
Examples are fictional. No code in this file. No new tokens anywhere (list at the end).

Platform differences: Android = Material-style `PrintPanel` rows; iOS = HIG list rows in the same panel style; web = `role="radiogroup"` like the address picker in `haper-web/pages/PrintReview.tsx:306`.

---
## 1. Customer print review (Android / iOS / web)

### 1.1 Flow
1. Review screen loads, `GET /user/print/config` already in hand (`codAvailable`, `codMaxOrderAmount`, `codUnavailableReason`).
2. Quote arrives. COD is offered only if `codAvailable === true` AND `quote.total <= codMaxOrderAmount`. Compare against `quote.total` (the printout value), never the cash part after wallet.
3. User picks Pay online (default) or Cash on delivery, optionally toggles wallet coins, ticks consent, taps the pay bar.
4. COD success -> existing success path (no payment sheet). Failure exits: 409 `COD_LIMIT` / `COD_NOT_ELIGIBLE` (1.5), plain 400 (1.6), offline / generic error (existing banner).

### 1.2 Layout (top to bottom, existing 16dp gutter, 12dp gap; nothing above the price summary changes)
```
 price summary (unchanged)
 Use wallet balance  [switch]            <- existing PrintPanel, unchanged
 Payment                                 <- NEW section label, only when COD is offered
 +------------------------------------+
 | (o) Pay online                     |   selected: 1.5dp GreenPrice border + SurfaceMint
 |     UPI, card or net banking       |
 +------------------------------------+
 | ( ) Cash on delivery               |
 |     Pay the rider when it arrives  |
 +------------------------------------+
 [ wallet + cash split card ]             <- only when COD selected AND wallet on (1.4)
 amber note: file deleted 24h / pay note  <- existing note, line 2 swaps (1.3)
 consent row (unchanged)
 sticky pay bar: [ Place order · pay ₹X in cash ]
```
- Two rows, each a `PrintPanel` (existing), min height 56dp, 16dp radius, 12/14dp padding, whole row is the tap target (radio is decorative + state). Selected: fill `SurfaceMint`, 1.5dp `GreenPrice` border; unselected: `SurfaceWhite`, 1dp `BorderHairline`. Title 14sp Bold `InkPrimary`; helper 11.5sp `InkSecondary` (never `InkTertiary`, fails AA). Radio 22dp `GreenPrice`; leading icon chip via existing `PrintIconChip` (online: card icon; cash: banknote icon).
- Section label "Payment": 12sp SemiBold `InkSecondary`, 4dp bottom. At 200% font: helper lines wrap, rows grow, never truncate.
- When COD is NOT offered the whole section is absent: screen is identical to today (no empty gap).
- Payable = 0 after wallet (coins cover everything): hide the whole choice, pay bar says the existing wallet-paid text. Nothing to choose; server stores WALLET.

### 1.3 Copy that replaces "Payment is online only for print orders."
| Situation | Line 2 of the amber note | Choice section |
|---|---|---|
| `codAvailable` true, total within limit | "You can pay online or in cash to the rider." | shown |
| `codAvailable` true, total > max (client check) | "Cash on delivery is available up to ₹300. Pay online for this order." | hidden |
| `COD_OFF` or key missing (old server) | existing "Payment is online only for print orders." | hidden |
| `COD_NOT_ELIGIBLE` | "Cash on delivery opens up after your first delivered order." (quiet, same line, same style) | hidden |
Recommendation: keep it quiet for `COD_NOT_ELIGIBLE`; a one-line reason beats a disabled radio (nothing to tap, no dead control) and tells a new customer how to unlock it. Never show a disabled COD row. Never show "₹0" or a missing limit: if `codMaxOrderAmount` is null treat as unavailable.

### 1.4 Wallet + cash split (COD selected, wallet switch on, `walletUsed` > 0)
Reuse `PrintPriceSummary` row style, rendered as a small `PrintPanel` under the choice:
`Order total ₹320.00` / `Wallet coins  -₹50.00` (GreenPrice) / divider 1dp `BorderHairline` / **`Pay in cash on delivery  ₹270.00`** (bold). Values from the existing wallet split helper; never add on the phone beyond it. The wallet row subtitle stays "₹X available · -₹Y on this order". COD without wallet: no split card, just the pay bar amount.

### 1.5 Pay bar and states
- Online selected: existing label. COD selected: **"Place order · pay ₹270 in cash"** (₹ amount = cash part, `formatPrintMoney`; 15sp Bold white on existing `HaperPrimaryButton` Green, 54dp). Disabled rules unchanged (no address, no consent, quoting, offline, submitting).
- Loading: choice section waits for quote; quote loading keeps the existing 0.6 dim; skeleton row 56dp x2 only if config is still loading (config skeleton already exists; add the two blocks so nothing jumps). Never flash COD then remove it.
- Submitting: button spinner + "Placing order…", rows disabled (0.6). Offline: existing banner, button disabled; selection is kept.
- 409 `COD_LIMIT` / `COD_NOT_ELIGIBLE`: reset selection to Pay online, hide the choice, show the **server `message` verbatim** in the existing error banner (`DangerSurface`, `Danger` icon, role alert), re-fetch config + quote, keep consent and address, do not clear the screen. Pay bar returns to the online label. One tap on the bar then pays online.
- 1.6 Plain 400 (COD turned OFF mid-session): same recovery, banner copy "Cash on delivery isn't available right now. Please pay online." (client copy, do not show the raw 400 text), then re-fetch config -> falls back to the "online only" line.
- `PRICE_CHANGED` after an admin toggles COD: existing handling, unchanged (plan §3.6).
- Success: existing success screen. Add one line when COD: "Pay ₹270 to the rider when it arrives." (13sp `InkSecondary`).

### 1.7 A11y
- Android: `Modifier.selectable(role = Role.RadioButton)` per row inside a `selectableGroup`; merged label "Cash on delivery, pay the rider when it arrives, selected, 2 of 2". iOS: `accessibilityElement(children: .combine)`, trait `.isSelected`, hint "Double tap to choose". Web: `role="radiogroup" aria-label="Payment method"`, roving tabindex, arrow keys, `aria-checked`.
- 48dp+ targets (rows are 56dp). Selected state is shown by border + radio fill + text, not colour alone. Error banner announced (live region / `role="alert"` / `UIAccessibility.post(.announcement)`).
- Focus order: wallet row -> payment group -> consent -> pay bar. After a 409, move focus to the banner, then it stays on the pay bar.
- Contrast: `InkPrimary` / `InkSecondary` on `SurfaceMint` 4.56 or better (see design-print-page-spec.md §3); white on `GreenAction` 5.5. No orange used here.
- Dark mode: customer apps are light-only today (no change).

---
## 2. Order detail / status after a COD order (customer)
Show COD wording only when `order.paymentMethod == COD`. Online/wallet orders unchanged.

| Place | COD copy |
|---|---|
| Status header, not delivered | "Pay ₹270 in cash on delivery" (if wallet used: "Pay ₹270 in cash. ₹50 paid with wallet coins.") |
| Total row label (web "Paid online" row, iOS/Android total) | "Pay on delivery" until delivered; "Paid in cash" once status is delivered/closed. Amount = `order.price` (the cash part) |
| Timeline first step | "Confirmed" (was "Paid"); the other steps unchanged. Android `PrintLogic.kt` already uses "We have your order" for some states, keep that mapping and swap only the "Paid" key |
| Rejected by store (ADMIN_CANCELED) | Title as today, plus "Nothing was charged." Refund text ONLY if `refundedAmount > 0`: "₹50 wallet coins returned" (use the word coins/wallet, not "refunded to your card") |
| Refused / not delivered (UN_DELIVERED) | "We couldn't deliver this order. Nothing was charged." plus the coins line if any |
| Customer cancel within 60 s | existing cancel flow; same "Nothing was charged" rule |
Never fall back to `price + walletUsed` for COD (iOS `PrintOrderDetailComponents.swift:105`, web `PrintOrderDetail.tsx:141`): that is the wrong-copy trap in plan §8.
States: loading = existing skeleton; error = existing retry; old builds keep their current (slightly wrong) copy, no money moves. A11y: header and total row read as one phrase ("Pay on delivery, 270 rupees"); status chip text, not colour. Pending-cash chip uses `WarningSurface` + `WarningText` #8A5A12 (existing pair, 11.5sp SemiBold, pill), icon banknote 14dp hidden from semantics; once paid, chip becomes `SurfaceChip` + `GreenDeep` "Paid in cash".

---
## 3. Admin: PrintServiceCard "Cash on delivery" sub-section
File: `/Users/office/Documents/haper/haper-admin/src/pages/Config/PrintServiceCard.tsx`. Uses existing `cfg-*` classes, `components/common/Switch`, same Save button.

### 3.1 Flow
Config > Print service (store selected) -> scroll below the price fields -> sub-section -> change switch/inputs -> existing "● Unsaved changes" -> "Save print settings" -> "Saved" for 2 s. Exits: validation error (save disabled), save error (existing `saveError` + Reload), 409/version conflict (existing Reload).

### 3.2 Layout
```
 Cash on delivery                     (h3, same size as price-group heading; divider 1px var(--border-color) above, 16px gap)
 Let customers pay the rider in cash for print orders.        cfg-hint
 +--------------------------------------------------------+
 | Allow cash on delivery                       [ switch ] |   cfg-inner cfg-toggle-row
 | Off by default. Turn it on only after the apps ship.     |   cfg-hint
 +--------------------------------------------------------+
 [Max COD order total   ₹ [ 300 ]]  [Min delivered orders  [ 1 ] orders]    cfg-fields-2
  hint: Largest print order total allowed on cash.        hint: New customers need this many delivered orders first. 0 = anyone.
```
- Inputs reuse the existing `Field` helper: `money` kind (₹ prefix) for max total, plain integer with suffix "orders" for min delivered. `inputMode` decimal / numeric. Stack to one column below the existing breakpoint (`cfg-fields-2` behaviour).
- Order inside the card: enable-printing switch, price fields, then COD sub-section, then footer (Save). One Save for everything (consistent: one PUT with a diff via `buildPatch`).

### 3.3 Validation (extend `printServiceValidation.ts`)
- Max total: required when switch is on; number 1-5000, up to 2 decimals. Errors (role="alert", `cfg-error-text`, `cfg-input--invalid`): "Enter an amount from ₹1 to ₹5,000." / "Use at most 2 decimal places."
- Min delivered: whole number 0-50. Error: "Enter a whole number from 0 to 50."
- Turning the switch ON with an empty/invalid max total blocks Save with "Set the max COD order total first." (same pattern as `enableBlocked`). Switch OFF: inputs keep their values and stay editable (so values are not lost) but are not required.
- Warning (not blocking, `--warning-text`): max total > 1000 -> "Large cash orders are a bigger loss if refused at the door." (plan risk section).

### 3.4 States
| State | Behaviour |
|---|---|
| Loading | existing card skeleton; sub-section appears with the loaded card (no separate skeleton) |
| Error loading | existing error + Retry |
| Print service OFF | whole sub-section greyed (`opacity .55`), switch + inputs `disabled`, hint under heading: "Turn on printing to use cash on delivery." Values still visible. |
| Not super admin (`!canEdit`) | switch + inputs `disabled`, lock icon (lucide `Lock`, 14px) before the heading text, line "Only a super admin can change cash on delivery." in `cfg-hint`, `aria-describedby` on each control. Existing hint "Only a super admin can change prices." already shows once at the top: keep it, add this one inside the sub-section (reason beside the thing). Footer hidden as today |
| Saving | controls disabled, button "Saving…" |
| Saved | button check + "Saved" 2 s, then "All changes saved." |
| Save error | existing `saveError` strip + Reload; server 400 text shown as-is |
| Stale (configVersion conflict) | existing Reload path |
A11y: heading is an `<h3>`; Switch `ariaLabel="Allow cash on delivery"`; labels via `htmlFor`; errors `aria-describedby` + `role="alert"`; 44px min control height as the existing inputs; disabled controls stay readable (contrast of disabled text is exempt, but keep the reason line at normal contrast); dark and light both via existing vars (`--warning-text` is #92400e light / #fbbf24 dark). Focus order: print switch -> price fields -> COD switch -> max total -> min delivered -> Save.

---
## 4. Admin print queue "Cash ₹X" chip
File: `/Users/office/Documents/haper/haper-admin/src/pages/Print/PrintQueuePage.tsx`.
- Show when `order.paymentMethod === 0`. Not shown for 1, 4 or undefined (older backend).
- Placement: in the title line next to `#orderId` / file name (the flex-wrap row at ~line 254), directly after the order number, so staff see it before the file name. Not in the right column (that holds the big amount and the action buttons).
- Text: "Cash ₹270" where X = `order.price` (the cash to collect, already net of wallet). Format with the page's `formatInr`. If wallet covered part, the chip still shows only the cash part; the big amount on the right stays the quote amount, so the two can differ and that is correct. Add `title` "Customer pays the rider in cash. Call before printing a large job."
- Style: pill, 11.5px / 600, padding 2px 8px, icon lucide `Banknote` 12px (aria-hidden). Fill `var(--warning-soft)`, text `var(--warning-text)`, 1px border `var(--warning-border)` (all existing tokens). Amber already means "waiting too long" on this page (the "Waiting" text uses `--warning-text`); the chip is distinguished by the icon + words, and it sits on a different line from the wait text, so no clash. Contrast: #92400e on soft-amber-over-white about 6.8:1 light; #fbbf24 on dark about 9:1.
- A11y: `aria-label="Cash on delivery, collect 270 rupees"` on the chip (visible text is "Cash ₹270"; label starts with the visible words). Include the chip text in the row's `aria-labelledby` so screen readers hear it in the row heading? No: keep the heading as is; the chip is read in DOM order right after it.
- Copy fix in the same row: `Paid {date}` (line ~259) must read **"Placed {date}"** for COD orders; keep "Paid" for others. Empty-state text "New paid jobs appear here" -> "New jobs appear here".
- States: loading/empty/error/refresh strip unchanged. 200% text: chip wraps with the title line (flex-wrap exists). Long file names: `overflow-wrap:anywhere`, chip never shrinks (`flex-shrink:0`).

---
## 5. Tokens and components
- New tokens: **none.** Customer: `GreenPrice`, `SurfaceMint`, `SurfaceWhite`, `BorderHairline`, `InkPrimary`, `InkSecondary`, `GreenDeep`, `SurfaceChip`, `WarningSurface`, `WarningText`, `DangerSurface`, `Danger` (Android `ui/theme/Color.kt`; iOS `HaperColors` and web Tailwind equivalents by role). Admin: `--warning-soft/-text/-border`, `--border-color`, `--text-*`, `--danger`, `cfg-*` classes.
- Reuse: `PrintPanel`, `PrintIconChip`, `PrintPriceSummary`, `HaperPrimaryButton`, existing error banner, `Switch`, `Field`.
- New (small, per platform): `PrintPaymentChoice` (two-row radio group, props: `options`, `selected`, `onSelect`, `enabled`), `CodSplitCard` (inline), admin `CodChip`. Do not add a shared component across repos.
- Avoid: orange `AuthEyebrow` / `AddButtonMid` for any COD text or button (design-print-page-spec.md §3).

## 6. Test guide hooks
Update `haper-misc/test-print-customer-android.md`, `-ios.md`, `-web.md`, `test-print-admin.md` with: choice appears only when available; 409 fallback; wallet split; rejected COD says "Nothing was charged"; non-super-admin sees locked controls; chip appears for method 0 only.
