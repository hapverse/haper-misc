# Design Spec: Print Documents (customer apps + admin)

Author: Chanchal (design) · Date: 2026-10-12
Inputs: `haper-misc/plans/print-on-demand-plan.md` (data/API), `free-gift-design.md` (house style). Where the brief's decisions differ from the plan, **this doc wins**: min order Rs 20 (plan says Rs 10), 20 MB / 200 pages, A4 preview before paying, files deleted 24 h after delivery (plan says 7 days), separate "print delivery charge", extra statuses on the customer side.
All prices below are examples; the server calculates and returns every number. Clients never compute a price.

---

## 0. Shared rules

**Tokens: spec by role, each platform resolves from its own file** (web accent is orange, Android/iOS accent is blue/Haper Green re-skin; do not copy hexes across).

| Role | Android (`ui/theme/Color.kt`) | iOS (`AppTheme.swift`) | Web (Tailwind in `index.html`) |
|---|---|---|---|
| Accent / primary action | `Primary` | `primary` | `primary` (600 on hover/press) |
| Success (Delivered, price-OK) | `Success` | `accentGreen` | `secondary` / emerald |
| Warning (price changed, 24h notice) | `Warning` + `WarningSurface` | `accentOrange` | amber-50 bg / amber-700 text |
| Error / Rejected | `ErrorRed` | system red | rose |
| Card | M3 `Card` radius 24dp, `surfaceBright`, 16dp outer + 16dp inner pad | `cornerRadius Large 20`, spacing 16 | `rounded-2xl bg-white dark:bg-gray-900 p-4` |
| Icon chip | 38dp, radius 14dp, primary at 12% | same | `h-10 w-10 rounded-xl bg-primary/10` |

Type: screen title = existing title style; section label = existing "caption, semibold"; price total = largest numeral on screen, tabular figures, right-aligned. Spacing scale 4/8/12/16/24. Dark and light both required; every surface uses theme tokens only.

**Currency format:** `Rs 20` style as the app already renders (use the existing money formatter; max 2 decimals, "1.50" not "1.5").

**Reuse, don't invent:** existing primary/secondary buttons, bottom sheet, snackbar/Toast (web `ui/Toast.tsx`), Razorpay payment sheet + payment-status polling, address picker, wallet toggle row from checkout, the amber "info" banner family from `design-checkout-info-message.md`, order-detail screens. **New components** (3 total): `PrintFileCard`, `PagePreviewStrip`, `PrintPriceSummary`.

**Mandatory trust copy (always visible, not in a tooltip):** under the file card and again on the pay screen: "Your file is deleted 24 hours after delivery." and the lawful-content checkbox.

**Old app versions (note only):** the order is a normal order whose lines have no product. Old Android/iOS/delivery show each print line as "Item" with no image (plan section 5 item 6 proposes a backend name+icon stub; whichever ships, old apps cannot open a print detail). Old web order detail would crash on a null product: the `OrderDetail.tsx` null-guard fix must ship before the first print order. Old apps never show the print entry point and never see "Rejected"/"Packed" wording differences beyond the existing order statuses. Picker never sees print orders.

---

## A. Customer flow (Android, iOS, web)

### A1. Flow

1. Entry: home tile "Print documents" OR tile/banner at the top of the Stationery category. Both open the same screen. Tile visible only if `GET /user/print/config` says enabled for the user's current store; otherwise hidden (see feature-off state).
2. **Print** screen (empty): pick a file. Android SAF `OpenDocument` / iOS document picker (+ Photos option) / web file input. Accept PDF, JPG, PNG.
3. Client checks type and size locally (fast fail), uploads; progress bar; server returns page count.
4. Print screen (loaded): file card, A4 preview, options, live price. Changing any option re-quotes (debounced 300 ms).
5. Tap **Continue** (needs: valid file, valid page range, lawful checkbox ticked).
6. **Review & pay** screen: address, summary, price breakdown, wallet toggle, print delivery charge, notice. Tap **Pay Rs X**.
7. Razorpay sheet (existing). Success: order-confirmed screen then Order detail with tracking. Failure: stays on Review & pay with an error banner.
8. Tracking on Order detail: Uploaded > Paid > Printing > Packed > Out for delivery > Delivered; or Rejected (auto-refund).
Exits: back from step 4 with a file attached asks "Discard this file?" (removes the upload server-side). Back from step 6 returns to step 4 with state intact.

v1 = one file per order. (Plan API allows several; the UI shows one file card and no "add another file" button. Leave the list layout ready for multiple files in Phase 2.)

### A2. Print screen layout (mobile-first)

```
[<]  Print documents
-----------------------------------------
(empty state)
  [ printer illustration ]
  Print from your phone
  PDF, JPG or PNG. Up to 20 MB and 200 pages.
  Word file? Save it as PDF first.
  [  Choose file  ]            (primary, full width)
  Black & white, A4. Delivered to your door.

(loaded state)
 +-- PrintFileCard -----------------------+
 | [pdf icon] marksheet_sample.pdf    [x] |
 | 12 pages . 1.4 MB          Replace     |
 +----------------------------------------+
 Preview (A4)                  Page 1 of 12
 +--- PagePreviewStrip ------------------+
 | [pg1][pg2][pg3] -> horizontal scroll   |
 +----------------------------------------+
 Options (card)
  Colour         [ Black & white  v ]  (single choice, selected, locked)
  Paper          [ Plain A4       v ]  (single choice, locked)
  Sides          ( Single-sided )( Double-sided )   segmented
  Copies         [ - ]  1  [ + ]
  Pages          (o) All   ( ) Custom   [ 1-3, 7 ]
 Note to store (optional, 140 chars)
 [ ] I own this content and it is lawful to print it.   (required)
 ...............................................
 sticky bottom bar:  Rs 24.00  (12 sides)   [ Continue ]
```

- Colour and Paper rows render as read-only "chips" now (one option, pre-selected, no chevron) so adding "Colour" or "Photo paper" later is a data change, not a layout change. Never show disabled "coming soon" options.
- Sticky bottom bar holds the live price (left, with a small skeleton shimmer while re-quoting, price never blanks) and Continue (right). It sits in the thumb zone; safe-area padding on iOS/Android.
- Tablet/web >= 768 px: two columns, left = preview (max 480 px, sticky), right = options and price card. Price bar becomes a card at the bottom of the right column. Web page max width 960, centred, like other web pages.

**Preview behaviour.** The point is to show what will physically print. Preview shows the A4 pages after server normalisation: use the server's print PDF (`GET` signed link for the owner, if exposed) once upload completes; until then show a local preview of the picked file with label "Preview (A4 layout may vary slightly)" and swap to the server version when ready, with no layout jump. Pages outside the selected range are dimmed 40% with a small "not printed" corner mark; double-sided shows pages in pairs labelled "Sheet 1 (front/back)". Tap a thumbnail to open a full-screen pager with pinch zoom. Images are scaled to fit A4 with a visible paper edge so users see the margins.

**Price card (PrintPriceSummary)** (also reused on A3):
```
12 pages x 2 copies          24 sides
Rate (single-sided)          Rs 2.00 / side
Printing                     Rs 48.00
Minimum order top-up         Rs 0.00   (row hidden unless applied)
```
Row "Minimum order Rs 20 applied" appears only when the minimum kicks in, with copy: "Minimum print order is Rs 20." Delivery charge is NOT shown here (it is address-dependent); it appears on A3. Footnote line: "Double-sided is cheaper per side: Rs 1.50 vs Rs 2.00." only if user is on single-sided and doc has more than 1 page (a gentle nudge, secondary text, no icon).

### A3. Review & pay screen

Order: Deliver-to card (existing address row, change opens address picker) > File summary row (name, pages, copies, sides, range; tap Edit returns) > PrintPriceSummary + "Print delivery charge Rs X" + GST line if the server returns one > wallet toggle (existing component) > notice card (amber-surface, calendar icon): "Your file is deleted 24 hours after delivery." > sticky bar with **Pay Rs X** (total payable after wallet). If wallet covers all, label "Pay Rs 0 with wallet" follows existing checkout behaviour.
Prepaid only: no COD row; show one line "Payment is online only for print orders."

### A4. States (customer)

| State | Where | Treatment and copy |
|---|---|---|
| Empty | Print screen | A2 empty block. |
| Loading config | entering screen | Skeleton for hero block (not spinner). >3s: inline retry. |
| Uploading | file card | Card shows name, "Uploading... 42%" with determinate linear progress (accent), Cancel text button. Options and Continue disabled (reduced opacity, `aria-disabled`). After 100%: "Checking your file..." indeterminate for the server processing. |
| Upload success | file card | Progress fades (150 ms) to "12 pages . 1.4 MB"; preview strip skeleton then thumbnails. |
| Error: wrong type | file card turns error-outlined; icon swap | "We can only print PDF, JPG or PNG. For a Word file, save it as PDF and try again." Buttons: Choose another file. |
| Error: too big | same | "This file is 34 MB. The limit is 20 MB. Try a smaller file or fewer pages." |
| Error: too many pages | same | "This file has 240 pages. We can print up to 200 pages in one order. Split the file and print in parts." |
| Error: corrupt / password-protected | same | "We couldn't open this file. If it has a password, remove it and upload again." |
| Error: network during upload | same | "Upload stopped. Check your connection." Buttons: Retry (resumes from scratch), Remove. |
| Invalid page range | Pages field | Inline under field, error colour + icon: "Enter pages like 1-3, 7. This file has 12 pages." Continue disabled. Field keeps user input. |
| Copies limit | stepper | At max (server-driven, e.g. 20) the + disables, helper "Up to 20 copies". |
| Re-quoting | price bar | Price dims 60% with shimmer, announces nothing until settled. |
| Quote failed | price bar | "Couldn't update the price." Retry link; Continue disabled. |
| Lawful box unticked | Continue | Continue stays enabled-looking? No: disabled, and a helper line above the bar "Tick the box above to continue." Tapping the disabled bar scrolls to and shakes (reduced-motion: just focuses) the checkbox. |
| Price changed since preview | on Pay (server re-quotes) | Block payment. Amber banner at top of Review screen: "The price changed from Rs 24.00 to Rs 28.00 (printing rates were updated)." Primary button becomes **Accept new price Rs 28** and secondary **Back**. Nothing is charged until the user accepts. Never silently charge the new amount. |
| Payment failed / cancelled | Review & pay | Error banner: "Payment didn't go through. You haven't been charged. If money was deducted it will be refunded in 5-7 days." Button **Try again**; file and options preserved. If the payment window expires: "This order timed out. Your file is still saved for now." returns to Print screen with the file card. |
| Success | confirm screen | Check icon, "Payment received", order number, "We'll print it and send it to you." Button View order. |
| Feature off for this store | tile and deep link | Tile hidden. If user lands via deep link or switched store while in-flow: full-screen empty state with printer icon, title "Printing isn't available at your location yet", body "We're starting in select areas. Check back soon." Button **Back to home**. If the store changes mid-flow, show this and keep nothing. |
| Offline | Print screen | Existing offline banner; Choose file disabled. |

### A5. Order detail (print order)

- Header status chip uses the customer labels. Mapping (backend job/order status to display): UPLOADED (draft, only seen in the Print screen) > **Uploaded**; order OPEN > **Paid**; staff has downloaded/started > **Printing** (backend may not distinguish from Paid in v1; if no signal, show Paid until PACKED, and hide Printing from the stepper rather than faking it: needs backend `print.downloaded` as the trigger, flagged below); PACKED > **Packed**; rider picked up > **Out for delivery**; delivered > **Delivered**; rejected > **Rejected**.
- Stepper reuses the existing order tracker. Print line card: icon chip with printer, name "marksheet_sample.pdf", sub-line "12 pages . 2 copies . Single-sided . B&W A4", amount.
- **Rejected state:** error-tinted card replacing the stepper tail: title "We couldn't print this file", reason from staff (free text plus mapped title, e.g. "The file was too blurry to read"), line "Your Rs 56.00 is being refunded to {original method/wallet}." and button **Upload a new file** (opens Print screen). Refund amount is the server value.
- Footer note on all print orders until deletion: "Your file is deleted 24 hours after delivery." After deletion: file row shows "File deleted for your privacy".
- 60-second cancel window applies as for grocery (existing component); no print-specific cancel UI.
- Cancel/reorder: no "reorder" for print lines in v1.

### A6. Interaction

- Any tap acknowledged < 100 ms (pressed state). File card replace/remove: remove asks confirm only if uploaded (bottom sheet "Remove this file?" Remove / Keep).
- Transitions: progress to done 150 ms ease-out; preview thumbnails fade in 150 ms; error card shake 0 (no shake; use a 200 ms outline colour fade). Respect reduced motion: no fades beyond opacity swap.
- Optimistic: options update instantly; price is the only thing awaiting server (dimmed).
- Uploads continue if the app is backgrounded briefly; on return show current progress. Android: foreground worker not needed under 20 MB.

### A7. Accessibility (customer)

- Contrast AA: body text 4.5:1, chips and borders 3:1 in both themes. Check the amber banner text on its tint per platform (web amber-700 on amber-50; Android `Warning` text on `WarningSurface` must be verified, do not put `Warning` as text on white).
- Touch targets >= 48dp (Android), 44pt (iOS), 44 px (web); stepper +/- and segmented control meet this; thumbnails >= 64 px wide with 8 px gaps.
- Focus order: back > file card (Replace, Remove) > preview > Sides > Copies > Pages > Note > lawful checkbox > Continue.
- Labels: preview thumbnail "Page 3 of 12, will be printed" / "not printed"; progress bar `role=progressbar` with value text "Uploading 42 percent"; price bar `aria-live=polite`, announces "Total Rs 28.00" only after settling; error cards use `role=alert` once. Stepper buttons "Decrease copies"/"Increase copies"; copies value announced. Lawful checkbox label is the full sentence and `aria-required`.
- Status never colour-only: chip has text and icon. Dynamic type / font scale to 200%: the sticky bar wraps price above the button.

---

## B. Admin (haper-admin)

House style: Warehouse `ui.tsx` kit (card, btn, input, th/td, StatusPill, PageHeader, Modal) + CSS vars for both themes; page-level grid via a scoped `<style>` block with prefix `.prq-`; page capped at `maxWidth:1080px; margin:0 auto`. Sidebar entry "Print Queue" (printer icon, lucide `Printer`) under Orders, gated by permission `print_jobs.view`; actions need `print_jobs.manage` (mirror FE `permissions.ts` and BE).

### B1. Print Queue page

Flow: staff opens Print Queue (store auto-scoped; super-admin gets a store select) > list shows paid jobs oldest first > **Download** (new tab opens signed 5-minute link) > staff prints on the shop printer > **Mark printed** (confirm) > job leaves "To print" tab, order moves to Packed. Wrong file: **Reject** with reason.

```
Print Queue                                    [Store: Chapra Main v]  [Refresh]
Tabs:  To print (4) | Printed today (12) | Rejected (1)
+--------------------------------------------------------------------------+
| #HP4821   marksheet_sample.pdf          Paid 10:42 (18 min ago)           |
| 12 pages . 2 copies . Single-sided . B&W A4  = 24 sides                   |
| Pages: 1-3, 7     Note: "Please staple"                    [Rs 56.00 paid]|
| Priya S. . +91 98xxxxx210                                                 |
| [ Download ] [ Mark printed ]                       [ Reject ... ]        |
+--------------------------------------------------------------------------+
```
- Row = card (not a table): each job has several fields and actions; cards stack in one column on narrow screens, and at >= 1180 px viewport the actions move to the right of the row (scoped media query). Numbers (sides, amount) right-aligned in the right block; dates "10 Oct, 10:42" IST consistently.
- Fields: order id, file name (truncate middle, full name on hover/title), pages, copies, sides, page range (if any), customer note (shown in an amber-tinted quote block so staff do not miss it; "No note" otherwise hidden), age since paid (turns amber at > 30 min, as an indicator with text "Waiting 35 min"), customer first name and masked phone only.
- Download is the primary action while untouched; after a download the row shows "Downloaded 10:50 by Anil" and Mark printed becomes primary. Mark printed disabled until downloaded at least once (hint: "Download and print first"), except super-admin.
- **Mark printed** confirm dialog (the shared `ConfirmDialog`): "Mark #HP4821 as printed? The order moves to Packed and a rider can be assigned." Buttons Cancel / Mark printed.
- **Reject** opens a Modal: reason select (Unreadable or corrupt file, Not allowed content, Wrong page size or unsupported, Other) + required free text (min 5 chars, shown to customer) + warning line "The customer is refunded automatically." Button **Reject and refund** uses the danger button. After success the toast "Rejected. Refund started."
- Reprint (plan section 3.4) = secondary text action "Log reprint" inside a row overflow menu on Printed tab only.
- Download opens signed URL in a new tab; if it fails (expired/403): inline row error "Link expired. Try Download again." The link is generated per click; never cache.
- Safety copy at top of page, dismissible per session: "Customer files are private. Don't save or share them. Files are deleted automatically."

**Admin states**

| State | Treatment |
|---|---|
| Loading | 3 skeleton cards (skeleton-bar; light-mode skeleton needs a visible fill, see theming traps). |
| Empty (To print) | Printer icon, "No print jobs waiting", sub "New paid jobs appear here. This page refreshes every 30 seconds." |
| Empty (other tabs) | Short one-liner, no illustration. |
| Error | Card: "Couldn't load the print queue." Retry button. Keep stale rows if a refresh fails and show a thin top error strip (never show an empty list on error). |
| Printing feature off for store | Info card replacing the list: "Print is turned off for this store. Turn it on in Store settings > Print service." (link if user has the permission; otherwise "Ask a super admin"). |
| No permission | Standard forbidden screen. |
| Action in flight | Button shows inline spinner and is disabled; row dims 60%. |
| Action conflict | Another staff already printed/rejected: toast "This job was already updated" and the row refreshes. |
| New job arrives | Auto-refresh every 30 s plus existing admin store notification sound if enabled; new rows get a 1-time subtle 2 s accent outline, not a modal. |
| Disabled | Mark printed before download; Reject on already-printed jobs (shown with tooltip "Already printed, issue a refund from the order instead"). |

Accessibility (admin): each card is a `<article>` with heading = file name; buttons have the file/order in their accessible name ("Download marksheet_sample.pdf for order HP4821"); tabs use `role=tablist`; status text + icon, not colour-only; focus returns to the row's next card after Mark printed; dialog traps focus, Esc closes, initial focus on the first field (Reject) or Cancel (Mark printed). Targets >= 36 px high on desktop buttons, 44 px at narrow widths. Contrast: StatusPill recipe (text + 55 border + 1a tint) verified in light mode.

### B2. Store settings: "Print service" section

Placement: the store config form (Stores page / store settings), a new card after the existing config cards, using the ConfigSettings-style `Switch` and `Field` (label + hint). Editing visible/enabled only to super-admin (money knobs, per plan); store admins see it read-only.

```
Print service
[ ON/OFF switch ]  Enable printing for this store
  (when off, fields below are dimmed but still editable? NO: collapsed/disabled)

 Price per side, single-sided        Rs [ 2.00 ]
 Price per side, double-sided        Rs [ 1.50 ]
 Minimum order amount                Rs [ 20.00 ]
 Print delivery charge               Rs [ 25.00 ]
 GST on printing                     [ 18 ] %
 Printing cost per side (internal)   Rs [ 0.60 ]   hint: "Paper and toner. Used only for profit reports."
 ---------------------------------------------------
 Example: 12 pages, 2 copies, double-sided = 24 sides x Rs 1.50 = Rs 36.00
                                           [ Save print settings ]
```
- Two-column grid at >= 1180 px viewport (scoped CSS, `align-items:start`), else one column. Number inputs: right-aligned, `inputMode=decimal`, step 0.25, min 0, max sane bound (e.g. 1000), 2 decimals shown. GST 0-28.
- Live "Example" line recomputes client-side for illustration only, labelled "Example (the server does the real calculation)".
- Validation inline: required, numbers only, double-sided price must be <= single-sided (warning, not blocking: "Double-sided is usually cheaper"), cost per side above price shows a non-blocking amber warning "Cost is higher than the price, you will lose money."
- Turning the switch OFF while jobs are in the queue: inline amber note "3 paid jobs are still in the queue. They will still be printed and delivered; customers just can't place new ones." (never disable existing orders). Turning ON with empty/zero prices: blocked with "Set the prices first."
- Save: footer button, loading state, Toast "Print settings saved". Changing prices only affects new quotes; show hint "Existing paid orders keep their price. Customers who already have a quote will see a price-changed notice."
- States: loading (skeleton fields), error load (retry), save error (inline banner, form preserved), read-only for non-super-admin (inputs disabled with lock hint "Only a super admin can change prices"), dirty-leave guard (existing pattern).
- Accessibility: Switch `role=switch aria-checked`, labels bound to inputs with `htmlFor`, units announced via `aria-describedby` ("rupees"), errors `aria-invalid` + `role=alert`.

---

## C. Open items for engineers/backend

1. "Printing" status needs a backend signal (suggest: first `print.downloaded` flips display status). Without it the customer stepper omits Printing.
2. Preview of the server-normalised A4 PDF to the customer needs an owner-scoped signed GET (not in the plan's API list); otherwise local preview only plus label.
3. Quote response must include: `selectedPages, sides, ratePerSide, printAmount, minimumApplied, deliveryCharge, gst, total, configVersion` so the price-changed flow can compare versions and render the breakdown.
4. Lawful-content acceptance sent with the order request and timestamped (plan section 5).
5. Retention: this spec shows "24 hours after delivery"; plan says 7 days. Backend purge must match whatever is stated in the UI.

STATUS: done
OUTPUT: Print documents design spec (customer print/review/order-detail flow for Android/iOS/web, admin Print Queue page, admin Print service settings) at /Users/office/Documents/haper/haper-misc/print-on-demand-design.md
NEXT: tanmoy-web — brief with the full spec file (sections 0, A for haper-web and B for haper-admin); siddhart-android and setu-ios — sections 0 and A; backend owner — section C open items
