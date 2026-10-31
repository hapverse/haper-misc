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
