# Test guide: Print documents, customer flow (iOS)

Needs: backend deployed first (user API + shared, see `test-print-upload.md` and `test-print-checkout.md`), `PRINT_S3_BUCKET` set, store `config.print.enabled = true` for the store you test with, and an iOS build that contains this feature (App Store rollout, TestFlight first). Old app versions never show print.
Use the dev API (debug build). Example prices: Rs 2/side single, Rs 1.50/side double, minimum Rs 20, delivery Rs 20.

## Entry points
1. Store with print ON -> Home shows a "Print documents" tile under the wallet strip; the Stationery aisle shows the same tile under its header. Both open the Print screen. ✅
2. Store with print OFF, or `/user/print/config` failing (airplane mode, 5xx) -> no tile anywhere. ✅
3. Switch the delivery address to a store with print OFF -> tile disappears. If you are on the Print screen at that moment -> "Printing isn't available at your location yet" with Back to home; the draft is discarded. ✅
4. Log out -> tile gone; log in -> tile returns. ✅

## Upload
5. Empty state shows copy "Print from your phone", limits from config (20 MB, 200 pages), "Choose file". ✅
6. Choose a 3-page PDF from Files -> progress "Uploading... n%", then "Checking your file...", then file card "3 pages . size", A4 preview thumbnails, options, price. ✅
7. Choose a JPG, a PNG, and a HEIC photo from the photo library -> all upload (HEIC is converted to JPEG on device). ✅
8. Pick a file over 20 MB -> error card "This file is N MB. The limit is 20 MB..." with Choose another file; nothing is uploaded. ❌ expected
9. Error cards are chosen from the server `reason` (never message text): TOO_MANY_PAGES shows the real `maxPages`; PDF_ENCRYPTED mentions removing the password; FILE_CORRUPT; FILE_TOO_COMPLEX "too complex... simpler PDF or split"; BUSY "busy right now, try in a minute" (Retry offered); RATE_LIMITED/UNAVAILABLE as before. The same reasons on quote show friendly copy under the price. ❌ expected
10. Turn on airplane mode mid-upload -> "Upload stopped. Check your connection." with Retry and Remove. Retry works after reconnect. ❌/✅
11. Cancel during upload -> back to the empty state, no draft left on the server. ✅
12. Remove (x) or Replace on an uploaded file -> the old draft is deleted on the server (`GET /user/print/jobs/:id` -> 404 afterwards). ✅
13. System Back arrow with a file attached -> "Discard this file?" -> Discard deletes the draft. Swipe-back works but does NOT ask; the draft is left for the 24 h server purge. ✅ (known, see deviations)

Upload queue (single file; the Print screen now uploads through the multi-file queue, one file allowed). These replace the BUSY part of step 9 and the airplane-mode part of step 10. Not yet run on a simulator or device.
UQ-1. Server busy (upload returns 503 `reason: "BUSY"`) -> the card stays on "Uploading... 0%" (Cancel available) and quietly tries again after 8 s, then after 20 s; only a third BUSY shows "We're busy right now. Please try again in a minute." with Retry and Remove. ❌ not run
UQ-2. Turn on airplane mode, then choose a file -> the card shows "Uploading... 0%" with Cancel, the no-internet overlay shows, nothing is sent. Turn airplane mode off -> the upload starts by itself and finishes. Cancel while still offline -> back to the empty state. ❌ not run
UQ-3. Turn on airplane mode mid-upload -> the upload stops at once with "Upload stopped. Check your connection." (Retry and Remove). Reconnect -> it retries once by itself. Drop the connection again during that retry -> it stays failed until you tap Retry. A file already at "Checking your file..." is not stopped; it finishes. ❌ not run
UQ-4. Server refuses with too many saved files (`reason: "TOO_MANY_DRAFTS"`) -> "You have too many saved files. Remove files you don't need, or try again later." with Retry and Remove. ❌ not run
UQ-5. After UQ-4, tap Remove, then choose another file -> the new file uploads normally (no stuck "waiting"). ❌ not run
UQ-6. With a file uploaded (card shows pages), use Replace file and pick a Word file or a file over the size limit -> the error card for the new file shows, and the old draft is deleted on the server (`GET /user/print/jobs/:oldId` -> 404). ❌ not run
UQ-7. Discard during "Checking your file..." -> the screen closes at once; when the server replies, that draft is deleted (`GET /user/print/jobs/:id` -> 404). ❌ not run
UQ-8. Cancel, Remove or Discard while the card says "Checking your file..." -> when the server replies, that draft is deleted (`GET /user/print/jobs/:id` -> 404). Single-file mode too: this now sends one DELETE more than before; that is expected, not a bug. ❌ not run
UQ-9. On Review & pay (one file), get JOB_EXPIRING or JOB_OTHER_STORE and tap "Upload again" -> back on the Print screen, and the old draft is deleted on the server (`GET /user/print/jobs/:id` -> 404; a gone draft answering 404/409 to the delete is fine). ❌ not run
UQ-10. Upload bodies left behind (app killed mid-upload) are swept like the local copies: a `print-upload-*.tmp` file in the app's tmp folder older than 24 h is deleted the next time Print opens; a fresh one is kept. ❌ not run
Needs: only the iOS build with this change; no backend change.

## Options and price
14. Single/Double sides, copies stepper, custom page range each re-quote after about 300 ms; the price dims with a small spinner while updating and never goes blank. ✅
15. Page range "1-3, 7" on a 12-page file -> pages 4-6, 8-12 dim with a "not printed" mark in the strip. Double-sided -> "Sheet 1 front/back" captions. ✅
16. Page range "1-99" or "abc" -> inline error under the field "Enter pages like 1-3, 7. This file has 12 pages." and Continue stays disabled; the typed text is kept. ❌ expected
17. Copies + disabled at the store max; helper "Up to N copies". ✅
18. Quote fails (stop the backend / airplane mode) -> "Couldn't update the price." with Retry, Continue disabled. ✅
19. Consent box unticked -> Continue looks disabled, helper "Tick the box above to continue."; tapping Continue scrolls to the checkbox. Tick it -> Continue enables. ✅
20. Price shown is the server's `printAmount` (no cost anywhere; the app never shows or receives cost). ✅

## Review and pay
21. Continue -> Review & pay: delivery address (Change opens the existing picker), file summary with Edit, price breakdown + print delivery charge + "Includes GST", wallet toggle (only with balance), deletion notice. With COD OFF / old server (no `codAvailable` key) the last line stays "Payment is online only for print orders." and there is no COD row. ✅
22. Back/Edit returns to the Print screen with file and options intact. ✅
23. Pay with Razorpay (test card) -> "Payment received" screen with order number -> View order opens the print order detail. ✅
24. Wallet covers the total -> button reads "Pay Rs 0 with wallet", order is placed without Razorpay. ✅
25. Partial wallet (e.g. total Rs 42.50, wallet Rs 100) -> wallet takes whole rupees, Razorpay charges the rest (min Rs 1). ✅
26. Cancel the Razorpay sheet -> banner "Payment didn't go through. You haven't been charged...", button "Try again", file and options preserved; the unpaid order is cancelled first so the retry does not hit JOB_ALREADY_ORDERED. ✅
27. Change the print price in admin after the quote -> Pay shows an amber banner "The price changed from Rs X to Rs Y", the button becomes "Accept new price Rs Y" (+ Back); nothing is charged until you accept; after accepting, Pay uses the new total. ✅
28. Place the same order from a second device/tab -> JOB_ALREADY_ORDERED banner with "View order". ✅/❌
29. Wait until the file is about to expire (JOB_EXPIRING), or change the address to another store's area (JOB_OTHER_STORE) -> error banner with "Upload again", which returns to the Print screen. ❌ expected
30. No address selected -> Pay disabled, "Add" link. ✅

## Cash on delivery (needs backend print-cod live; store COD ON)
COD-1. Store COD ON, eligible user, total <= limit -> a "Payment" section with "Pay online" (selected) and "Cash on delivery"; the note line reads "You can pay online or in cash to the rider." Pay bar is the online label until COD is picked. ❌ not run on a simulator
COD-2. Pick COD -> pay bar "Place order · pay ₹X in cash"; tap -> NO Razorpay sheet, success screen "Order placed" + "Pay ₹X to the rider when it arrives."; order is in Orders (not cancelled), first step reads "Confirmed". ❌
COD-3. COD + wallet toggle on -> split card (Order total / Wallet coins / Pay in cash on delivery); pay bar shows the cash part only. Coins cover everything -> the Payment section disappears, pay bar "Pay ₹0 with wallet". ❌
COD-4. Total above the limit -> no choice, note "Cash on delivery is available up to ₹300. Pay online for this order." Not-yet-eligible user -> note "Cash on delivery opens up after your first delivered order." COD OFF -> old "online only" line. Never a disabled COD row. ❌
COD-5. Server 409 COD_LIMIT / COD_NOT_ELIGIBLE / COD_OPEN_LIMIT (change the store limit, or hold another open COD print order, after opening Review) -> red banner with the server message, selection back to online, choice hidden; address and options kept; next tap pays online. A 400 with `reason: "COD_OFF"` after sending COD -> banner "Cash on delivery isn't available right now. Please pay online.", back to online, COD hidden. Any OTHER 400 (address no longer available, out of area, validation) -> its own message banner; COD stays selected and visible. ❌
COD-6. Admin rejects a COD order -> "Nothing was charged." (no "refunded to your Haper wallet" line); with wallet coins used -> "₹X wallet coins returned." Undelivered COD -> "We couldn't deliver this order. Nothing was charged." Delivered COD shows "Paid in cash ₹X"; before delivery "Pay ₹X in cash on delivery". Rejected/undelivered with coins returned -> "Nothing was charged." plus "₹X wallet coins returned." User-cancelled COD order -> "Nothing was charged." (no "Pay ₹X in cash" line). Bill card for COD: label "Pay on delivery" until delivered, then "Paid in cash", dead statuses "Nothing was charged" with amount "₹0" (matches Android); otherwise amount is `order.price` with paise ("₹270.50"); no "Paid via" row. Online-order reject copy and bill card are unchanged. ❌
COD-8. Server answers a COD request with a wallet-paid order (price 0, paymentMethod 1, e.g. stale coin balance) -> success screen "Payment received", no "Pay ₹0 to the rider". If the server ever returns an rzpOrder for a COD request, Razorpay is NOT opened. ❌
COD-7. VoiceOver reads each row as "Cash on delivery, Pay the rider when it arrives, 2 of 2" with selected trait; rows are >= 56pt; Dynamic Type at AX sizes wraps, never truncates. ❌
Unit tests (run): `PrintCodTests` (availability rule, error mapping, 400 reason gating, server-answer cash line, dead-status copy, COD placed is never cancelled, refund fallback, step label, copy).

## Order detail (print order)
31. Orders tab -> print order opens a print layout: stepper Uploaded > Paid (COD orders: Confirmed) > Packed > Out for delivery > Delivered; when the order has `print.stage` the stepper adds "Printing" after Paid (QUEUED = Paid current, PRINTING = Printing current, PRINTED = Packed current); `print` null/absent keeps the five-step stepper, print line card (file name, "12 pages . 2 copies . Single-sided . B&W A4", amount), shared bill/address cards, footer "Your file is deleted 24 hours after delivery." until `print.filesPurged` is true, then "File deleted for your privacy" (no `print` -> old 24 h-after-delivery inference). ✅
32. Admin Reject (ADMIN_CANCELED) -> status "Rejected", card "We couldn't print this file", staff `rejectReason` shown under the title; title from `rejectCode` (UNREADABLE "We couldn't read this file", PROHIBITED_CONTENT "We can't print this content", else "We couldn't print this file"); refund line with the amount, "Upload a new file" opens the Print screen. Reject with no reason/code keeps the old card. ✅
33. Cancel within 60 seconds uses the existing cancel countdown. ✅
34. Old grocery orders still render exactly as before (no print layout). ✅

## Edge cases
- Dynamic Type at accessibility sizes: price bar stacks above Continue; no clipped text. VoiceOver reads thumbnails as "Page 3 of 12, will be printed / not printed", progress as a percent, stepper buttons as "Decrease/Increase copies".
- Dark mode and the smallest device (iPhone SE) and largest (Pro Max).
- Missing/null fields in `/user/print/config` or the quote never crash; the feature hides or shows the quote-failed state.
- Preview PDF is downloaded to a temp file, read into memory and deleted immediately; its URL is never logged.
- App backgrounded during upload: upload continues for a short time; returning shows current progress or the error card.

## Deploy dependency
Backend (print routes, store flag, S3 bucket) must be live first; then the iOS build. Until a store has `print.enabled`, iOS shows nothing. Needs an App Store release (user-driven).

## Several files — the file list

Needs: a backend that sends `maxFilesPerOrder` (for example 6) in the print config. All file names below are made up. Ordering with 2 or more files is switched on: see "Several files — review and order" below.

### Old backend (no `maxFilesPerOrder`)
- ✅ Print screen looks and works exactly as before: "Choose file", one file card, "Choose another", options, Continue, "Discard this file?".
- ❌ If you see "Your files", "Add another file" or a file count, the layout switched on without the config. Report it.

### Picking
- ✅ Empty state shows "Choose files" and "You can pick up to 6 files. PDF, JPG or PNG, up to 20 MB each."
- ✅ Files: pick Invoice-March.pdf, Notes-Ravi-Sharma.pdf and Poster.jpg at once. Three rows appear in pick order. The first two upload together; the third says "Waiting" until one finishes.
- ✅ Photo library: pick 3 photos. Rows "Photo 1.jpg" to "Photo 3.jpg". The picker will not let you pick more than the free slots.
- ✅ From the EMPTY screen (no files yet): "Choose files" -> "Photo library" opens the photo picker at once. ❌ if nothing opens, or if a photo picker pops up by itself later (for example right after you add a file from Files instead).
- ✅ No Photos permission prompt appears at any point (before, during or after picking).
- ✅ Pick 10 phone photos at once: while they are added one by one the screen stays responsive (scrolling and Back respond). ❌ if the screen freezes for seconds.
- ✅ Swipe back while a batch is still being added (rows still appearing): nothing more is added or uploaded after you leave; reopening Print shows an empty screen. ❌ if new drafts keep appearing on the server for files you had not reached yet.
- ✅ Rows "Photo 1.jpg" and "Photo 2.jpg"; remove Photo 1, then add a new photo -> the new row is "Photo 3.jpg" (never a second "Photo 2.jpg"). Numbers start at 1 again only after the list is emptied.
- ✅ Pick the same photo that is already "Photo 2.jpg" again (in a later pick) -> skipped with "Photo 2.jpg is already in your list. To print more copies, change Copies." ❌ if it is added as a new row.
- ✅ "Add another file" opens the same Files / Photo library choice and adds below the existing rows.
- ✅ After a pick, VoiceOver focus lands on the first new row.
- ✅ While files are being copied, "Choose files" and "Add another file" are greyed out.
- ✅ Offline: "Add another file" is greyed out.

### Row states (each shows an icon AND text)
- ✅ Waiting: clock + "Waiting". Uploading: bar + "Uploading 45%". After the last byte: spinner + "Checking your file". Ready: green check + "Ready".
- ✅ Settings line reads "1 copy · One side · All pages"; name keeps its ending ".pdf" when long (middle cut).
- ✅ Oversize file (34 MB): row says "This file is 34 MB. The limit is 20 MB. ..." with Remove only; it does not count in "n of 6".
- ✅ Word file: row says "We can only print PDF, JPG or PNG. ..."
- ✅ A file that cannot be read (for example deleted in Files before copying): row says "We couldn't read this file. Remove it and pick it again."
- ✅ Failed row shows the sentence in dark text (not red text) with a red icon and "Retry" when retryable. Two or more retryable failures show "Retry all" beside "Your files".

### Limits and notices
- ✅ With 5 rows, pick 4 more: notice "You can print up to 6 files in one order. We added 1 of the 4 you picked. ..." Add row now reads "6 of 6 files added" and is greyed out. Notice can be dismissed with X.
- ✅ Pick Poster.jpg again (same name and size): notice "Poster.jpg is already in your list. To print more copies, change Copies." Two repeats: "2 files were already in your list and were skipped."
- ✅ Too many saved files (server limit): amber notice with "Review my files", which scrolls to the list.
- ✅ Changing the delivery address, then coming back to Print: files are removed and the amber notice "You changed your address. Files uploaded for the old store were removed. Please add them again." shows. The list is now empty, and the notice still shows on the empty screen. It goes away with X or when you start the next pick, and it never comes back later on its own. ❌ if the files vanish with no notice.
- ✅ With 1 file, open Review, change the delivery address there and switch apps and back: Review stays filled in. Coming back from Review to Print then removes the files and shows the notice.
- ✅ Opening Print right after a cold start (before the store is known), adding files, and then the store loading does NOT remove the files.

### Remove
- ✅ Trash on a Ready row asks "Remove Invoice-March.pdf?" / "It will be deleted from our servers." with Remove / Keep.
- ✅ Trash on Waiting, Uploading, Failed or rejected rows removes at once, no question.
- ✅ Removing the last row goes back to the empty state; the consent tick stays.
- ✅ The consent tick sits on the empty screen too. "Choose files" stays grey until it is ticked. With files listed, untick it and tap "Retry", "Retry all" or "Add another file": the screen scrolls to the tick box and nothing uploads. ❌ if an upload starts while the box is unticked. (The one-file screen of an old backend keeps its old behaviour.)
- ✅ Remove down to one ready file: preview, options, note and the price come back.

### Continue and totals
- ✅ One file: Continue and total work as before.
- ✅ 2 or more files: the order total shows in the bottom bar (see "Several files — prices"); preview/options hidden; Continue opens Review once every file is priced.
- ✅ Button text follows the rows: "Uploading 2 of 4…", then "Continue" (or "Continue with 2 files" when a file failed).
- ❌ not run. Pick 4 files, and while 2 still say "Waiting" untick the consent box: once the 2 uploading rows finish, the waiting rows still read "Waiting", the button reads "Continue" (grey, NOT "Uploading 3 of 4…"), and "Tick the box above to continue." shows above it. Tap the grey button: the screen scrolls to the tick box. Tick it: the waiting rows upload. ❌ if the button keeps saying "Uploading…" while nothing moves.

### Offline
- ✅ Turn on Airplane mode while uploading: uploading rows turn into "Upload stopped. Check your connection." with Retry; waiting rows read "Waiting for connection". Back online, they continue.

### Back
- ✅ With 3 files, back asks "Discard 3 files?" / "They will be deleted from our servers." with Discard / Keep. With 1 file in this mode: "Discard this file?".

### Accessibility
- ✅ VoiceOver reads one item per row: "Invoice-March.pdf, 12 pages, 1.4 megabytes, 1 copy, one side, all pages. Ready." Progress is read in 10% steps, status last.
- ✅ Actions on the row: "Remove Invoice-March.pdf", and "Retry upload of Invoice-March.pdf" on retryable rows.
- ✅ "Invoice-March.pdf is ready" is announced politely, one at a time; a failure is announced with higher priority; percent changes are not announced.
- ✅ After Remove, VoiceOver moves to the next row, or the Add row if it was last.
- ✅ Largest Dynamic Type (accessibility 5): names wrap to 2 lines, settings and status wrap, trash stays top-right and tappable, bottom bar stacks.
- ✅ Reduce Motion on: rows appear and disappear with no animation.

## Several files — settings
Needs: a dev backend that sends `maxFilesPerOrder` above 1 (as in "Several files — the file list"). Sample files (made up): `Poster.jpg` (a photo, 1 page), `Report-Final.pdf` (40 pages), `Invoice-March.pdf` (12 pages).

### Shared settings card
- ✅ With 2 files, a card sits under "Add another file": switch "Same settings for all files" is ON, helper "Copies and sides apply to every file. Page range is set for each file.", a Copies stepper, a Sides choice "One side" / "Both sides", and the line "Page range is set for each file. Tap Edit on a file."
- ✅ Tapping anywhere on the switch row (not only the switch) flips it. Turning it OFF changes no row; helper becomes "Settings are set for each file." and the steppers hide.
- ✅ With one file (or one file plus a rejected/failed-for-good row) there is no card. ❌ if the card shows for a single usable file.
- ✅ The note field ("Note to store (optional)") stays visible under the card with 2+ files. ❌ if it disappears (it is still sent with the order). (This replaces "note hidden" in "Continue and totals" above.)

### Worked example
1. ✅ Pick `Poster.jpg` and `Report-Final.pdf`. In the card set Copies 2 and "Both sides". Poster row: "2 copies · Both sides · All pages"; Report row: the same.
2. ✅ Tap "Edit" on the Report row: a screen titled "Report-Final.pdf" opens with the preview and options. Copies and Sides are greyed with "Using the same settings as all files." and "Change for this file". Pages is editable: pick Custom, type `3-12`, tap Back. Report row: "2 copies · Both sides · Pages 3-12". The card still says 2 copies.
3. ✅ Tap "Edit" on the Poster row: there is no Pages section (1-page file). Tap "Change for this file": Copies and Sides become editable and the card's switch is now OFF. Set Copies 5, Back. Poster row: "5 copies · Both sides · All pages"; Report row unchanged ("2 copies · Both sides · Pages 3-12").

### Switching back ON
- ✅ After the example (files differ), turning the switch ON asks "Use the same settings for all files?" / "Copies and sides on your files will be replaced with the values below. Page ranges stay." plus the values of the first file, e.g. "5 copies, both sides". "Use same settings": every file gets them, the Report keeps "Pages 3-12", switch ON. "Keep separate": switch stays OFF, nothing changes.
- ✅ When every file already has the same copies and sides, turning ON needs no question.

### Page range per file
- ✅ A 1-page file or photo never shows a Pages section and never shows "Fix pages". ❌ if "Fix pages" appears on it.
- ✅ With one 1-page photo alone, Custom pages can still be ticked; add a second file and the photo goes back to "All pages".
- ❌ not run. With one 1-page photo alone, tick Custom (leave it empty), then add `letter.doc` (a Word file, rejected): the photo row reads "All pages" and "Edit" (never "Fix pages"), and once the price is in, Continue is not held back by the photo. ❌ if "Fix pages" shows or Continue stays grey because of the photo.
- ✅ On a ready PDF, tick Custom and leave it empty, Back: the row reads "… · Pages: not set", the message "Enter the pages to print." shows under it, the action reads "Fix pages", and Continue stays grey.
- ✅ Type a wrong range, e.g. `5-80` on the 40-page file: the row shows "Enter pages like 1-3, 7. This file has 40 pages." and "Fix pages". Fix it: the message goes away and the action reads "Edit".
- ✅ Tapping the row body opens the same screen as "Edit" (only on Ready rows).

### Robustness
- ✅ Pick `letter.doc` first, then two PDFs: the .doc row is rejected, but the card still works — changing Copies updates both PDFs. ❌ if the card's controls do nothing.
- ✅ A file that failed for good (e.g. damaged PDF) keeps its own values and is never changed by the card.
- ✅ One file alone: set 3 copies, Both sides, Custom `2-4`. Add a second file, then remove it: the remaining file still shows 3 copies, Both sides, pages 2-4, and its price matches. ❌ if the options reset.
- ✅ A file still uploading when you change the card keeps those values once it is Ready (only a range that does not fit its real page count goes back to "All pages").
- ✅ If the store lowers its copies limit, files above it come down to the new limit.

### File settings screen
- ✅ Back (button or edge swipe) returns to the list and never asks "Discard N files?".
- ✅ If the file is removed while its screen is open (e.g. store change), the screen closes by itself.
- ✅ Open File settings on one file, go Back, then remove the other file: the remaining file's preview loads (no endless spinner).

### Wording
- ✅ In the several-files flow sides read "One side" / "Both sides" everywhere: rows, card, dialog values line, File settings and VoiceOver. The one-file-only screen (old backend) still says "Single-sided" / "Double-sided".

### Accessibility
- ✅ VoiceOver: the card's switch is read as a switch ("Same settings for all files, on"). Each Ready row has a separate "Edit settings for Invoice-March.pdf" button (or "Fix pages for …"). A range message is read after the row's status.
- ✅ After Back from File settings, VoiceOver focus lands on that row's Edit button. After the switch-on question closes, focus returns to the switch.
- ✅ Largest Dynamic Type (accessibility 5) and iPhone SE width: in the card Copies sits above Sides; in a row "Edit" moves to its own line; every control is still at least 44 pt and tappable.

## Several files — prices
Needs: a dev backend with the order quote (`POST /user/print/quote` with `jobs`, see `haper-backend/docs/reference/print-order-quote.md`) and `maxFilesPerOrder` above 1. Default store prices assumed: ₹2/side one side, ₹1.5/side both sides, minimum ₹20, delivery ₹20, GST 18% included. Sample files (made up): `Notes-A.pdf` (3 pages), `Report-Final.pdf` (15 pages), `Poster.jpg` (1 page), `Ticket.pdf` (1 page), `Form.pdf` (2 pages).

### Prices on rows and the summary
- ✅ Each Ready file shows its own price on the right of "Ready", e.g. "₹6.00". A file still uploading or failed shows no price. ❌ if a row shows a price that includes the minimum top-up.
- ✅ Three files `Notes-A.pdf` 1 copy, `Report-Final.pdf` 1 copy, `Poster.jpg` 1 copy (one side): rows ₹6.00 / ₹30.00 / ₹2.00. Summary: "Notes-A.pdf (3 pages × 1) ₹6.00", "Report-Final.pdf (15 pages × 1) ₹30.00", "Poster.jpg (1 page × 1) ₹2.00", "Delivery charge ₹20.00", "Includes GST (18%)", Total ₹58.00. No "Minimum order top-up" row.
- ✅ Two tiny files `Ticket.pdf` (₹2.00) and `Form.pdf` (₹4.00): the summary shows "Minimum order top-up ₹14.00" with "Minimum print order is ₹20." under it, delivery ₹20.00, Total ₹40.00.
- ✅ Delivery is charged once, however many files. "Includes GST (18%)" has no amount next to it.
- ✅ Four or more files: the file lines fold into one "Printing (… pages, … files)" row with "Show details". Tap it: the file lines appear under that row and the button reads "Hide details". Collapsed every time the screen opens.
- ✅ Bottom bar (left): "Total ₹58.00" and "3 files · 19 pages" (pages before copies). At the largest text sizes the total sits above the button.

### Updating
- ✅ Change Copies: row prices and the bottom total turn into grey bars for a moment, the summary dims to grey rows, then the new prices appear. ❌ if the old total is ever shown next to the new settings.
- ✅ Tap +/- quickly several times: only the last value is priced (one update, not one per tap).
- ✅ Tick Custom pages on a file and leave it empty, or type a wrong range: the summary and the bottom total disappear and no row shows a price until it is fixed.
- ✅ Remove a file: its line leaves the summary and the total updates.
- ✅ Go back to one file: the screen and price block look exactly as the one-file screen (price, "… sides · delivery added next"). Add a second file again: the one-file price disappears and the order price comes back. ❌ if a one-file price and an order total are ever shown together.

### Errors
- ✅ Order too big (e.g. 2 files × 20 copies × 15 pages): banner "This order is too big to print at once (limit 500 pages including copies). Reduce copies or remove a file." (the number follows the store limit). No total shown.
- ✅ No connection / server error while pricing: bottom bar reads "Couldn't update the price." with "Retry"; Retry prices again at once.
- ❌ not run. A 403 that is not "print is off" (e.g. a proxy or firewall page, no `reason: "UNAVAILABLE"`) while pricing or ordering: the files stay, pricing shows "Couldn't update the price." with "Retry" (ordering shows "We couldn't place this order. Please try again."). Only a 403 with `reason: "UNAVAILABLE"` shows the print-off screen and removes the files.
- ✅ A file the server no longer has (e.g. expired, or removed on another phone): that row shows "Please add this file again" with only the trash button (no Retry), the other files are priced again, and the file is deleted from the server.
- ✅ A wrong page range the server refuses for one file: the server's sentence shows under that row with an alert icon; changing that file's settings clears it.
- ✅ A file that is already in an order: banner "This file is already part of an order. Open that order to finish paying." with "Open that order" (opens the order on the Orders tab). The row keeps its file.
- ✅ Continue is enabled with two or more files only while the total shown matches the files (never during the grey bars).

### Accessibility
- ✅ VoiceOver reads the price before the status: "Notes-A.pdf, 3 pages, …, all pages, 6 rupees. Ready." A price error is read after the status.
- ✅ When a new total arrives VoiceOver says "Total 58 rupees" once (politely).
- ✅ "Show details" is at least 44 pt tall and is read as collapsed / expanded.

## Several files — review and order
Needs: the dev backend with the order quote and `maxFilesPerOrder` above 1 (as above), a delivery address, and an iOS build with this change. No backend change. Sample files (made up): `Invoice-March.pdf` (12 pages), `Poster.jpg` (1 page), `Report-Final.pdf` (40 pages; Custom pages `3-12` = 10 pages). Store limit for cash on delivery assumed ₹300.

### Happy path
- ✅ Pick all three, tick consent, wait for "Ready" on each and the total. Tap "Continue": "Review order" opens with "Files (3)" and "Edit files", one entry per file in order, e.g. "Invoice-March.pdf" / "12 pages · 1 copy · One side" and its own price on the right; "Report-Final.pdf" / "10 pages · 1 copy · One side · Pages 3-12".
- ✅ Below: the delivery address, the price rows (every file line shown, one "Delivery charge"), wallet, payment choice and the pay bar "Pay ₹…" with the same total as the Print screen.
- ✅ Place the order: ONE order is created with all three files (check the Orders tab: one order, not three). The order-placed screen shows the order number and "3 files · 23 pages" under it, then the three files with their settings and no prices.
- ✅ Double-tap the pay button quickly: still only one order.
- ✅ The note typed on the Print screen ("Please staple") reaches the store with the order.
- ✅ "Edit files" on Review goes back to the list with everything kept.

### A file failed
- ✅ Pick three files where one fails for good (e.g. a damaged PDF). The button reads "Continue with 2 files". Tap it: a dialog "1 file won't be printed", the failed file's name, "You can still place the order with the other 2 files.", buttons "Go back" and "Continue without it".
- ✅ "Go back": the dialog closes and all three rows are still there.
- ✅ "Continue without it": the failed row is removed and Review opens by itself with "Files (2)" once the two files are priced.
- ✅ Two failed and one ready: the dialog reads "2 files won't be printed" / "You can still place the order with the other file." / "Continue without them"; after it, the one-file Review opens ("Review & pay"), exactly as for a single file. ❌ if an old two-file total is shown there.

### Price must match the files
- ✅ Price the files, then change Copies on the Print screen and tap Continue at once: Continue stays grey until the new total shows. ❌ if Review opens with the old total.
- ✅ On Review, while a new price is being fetched (e.g. after a cash refusal), the pay bar reads "Calculating price" and is grey, the wallet line is hidden, and the price rows are grey bars.
- ❌ not run. On Review, make that new price fail (e.g. airplane mode right after the cash refusal): Review shows "Couldn't update the price." with "Retry" and "Back to files", and the pay bar reads "Couldn't update the price." (grey). Retry with the connection back: the price rows and "Pay ₹…" return. ❌ if the bar says "Calculating price" forever.
- ✅ If a file is removed or fails while Review is open, Review closes and you are back on the list.

### Cash on delivery
- ✅ Total within ₹300 (₹300.00 exactly included): "Cash on delivery" is offered as before.
- ✅ Total above the limit (e.g. ₹340): no cash choice; the note reads "Cash on delivery is available up to ₹300. This order is ₹340. Remove a file or pay online." with "Edit files". If cash was picked earlier, it switches to "Pay online" and VoiceOver says the note.
- ✅ The server refuses cash (e.g. open cash order limit): its message shows, the choice goes back to "Pay online", and the price is fetched again.

### Problems at order time
- ✅ The price changed between pricing and paying: banner "The price changed from ₹58.00 to ₹64.00 …" and the bar "Accept new price ₹64.00". Paying needs a second tap after accepting; the order is placed at ₹64.00.
- ✅ Price changed, then "Back", change Copies, Continue: Review shows the new price for the new copies, not the old "Accept new price" prompt.
- ✅ A file expired at order time: banner with the server's message and "Back to files". Tap it: the list shows that file as "Please add this file again" (trash only), the other files are priced again, and nothing keeps reloading.
- ❌ not run (changed). Several files, a file already in another order: banner (or Review) with "Open that order" opens that order on the Orders tab, and NO file is removed. Come back to Print (Home tab): all the files are still listed, and the clashing file is marked "This file is already part of an order." ❌ if the other files are gone.
- ❌ not run. Two of your files sit in two DIFFERENT unpaid orders (the server sends no order id): the banner shows the server's message with "Back to files". Tap it: the list prices again and names the file with "This file is already part of an order." under its row. Remove that row (trash, confirm): the rest is priced and Continue works. ❌ if Review keeps sending you back with no file named.
- ✅ Print switched off for the store while on Review: Review closes and the "Printing isn't available at your location yet" screen shows; the uploaded files are removed from the server.

### Sign-out
- ✅ Log out while files are uploading: uploads stop, the uploaded files are removed from the server, and the next person to log in on this phone sees an empty Print screen with the consent box unticked.
- ✅ Session expired (forced logout): the Print screen is emptied the same way (the server deletes the files after 24 hours by itself).
- ❌ not run. One file: tap Pay (online), and log out (or let the session expire) before the Razorpay sheet opens: the sheet never opens over the login screen, and no "cancel order" call is made with the next user's login. The unpaid order stays in the first user's Orders tab. ❌ if the payment sheet appears after logging out.
- ❌ not run. One file, Pay (online): log out while the Razorpay sheet is open. The sheet stays over the login screen until it is closed. After a completed payment, that customer's Orders tab shows the order as paid shortly after (the server confirms it). After a failed or closed payment the order stays "payment pending" until the server cancels it (about 15-30 minutes), and its files stay on the server for up to 24 hours after that. ❌ if the app cancels the order or refreshes the wallet with the next user's login.
- ❌ not run. Slow network (Network Link Conditioner "Very Bad Network"), files uploaded, log out: logout finishes within about 3 s; kill and reopen the app: you are on the login screen, NOT signed in as the previous user. ❌ if the previous user is signed in again after the cold start.
- ❌ not run. One file, Photo library: pick a large iCloud photo, log out while it is still loading, log in as someone else: that photo is never uploaded to the new account.

### One file
- ❌ not run (changed). A file the server says is gone or expired is now also removed from the server (`GET /user/print/jobs/:id` -> 404).
- ❌ not run (changed). Order ids are format-checked before the app opens an order: "View order" with a malformed id opens the Orders list instead of an order.
- ✅ With one file everything is exactly as before: "Continue" opens "Review & pay", the file summary card, the same price rows and success screen.

### Accessibility
- ✅ VoiceOver reads each Review entry as one item with its price: "Invoice-March.pdf, 12 pages, 1 copy, one side, 24 rupees".
- ✅ The "1 file won't be printed" dialog is read in full and closes with "Go back".
- ✅ Largest Dynamic Type: names wrap to 2 lines, the price drops under the detail line, every button is at least 44 pt.

## Several files — order placed and order detail
Needs: the same build; an order placed with 2+ files (above).

### Order placed
- ✅ "3 files · 23 pages" (pages before copies) under the order number, then the files list; more than 3 files fold to 3 with "Show all 5 files".
- ✅ No per-file price anywhere on this screen, and nothing loads (it is shown from memory). Closing it and coming back from Orders does not show the list again (Order detail does).
- ✅ One-file order: the screen looks exactly as before.

### Order detail
- ✅ An order with 3 files shows "Your files" with the chip "3 files · 23 pages" and one row per file (name, pages, copies, sides, range). More than 3 fold to 3 with "Show all N files".
- ✅ No amount next to any file, and VoiceOver reads no amount for a file. The bill card still shows the totals. ❌ if a small file shows ₹10 (that is the minimum top-up folded into the first line).
- ✅ After printing, the files read "Document 1", "Document 2", "Document 3".
- ✅ An old order with a missing file name shows "Print job".
- ✅ One-file order detail: unchanged ("Print job" card with the file and its amount).

