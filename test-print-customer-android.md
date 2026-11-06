# Test guide: Print on demand, customer flow (Android)

Needs (in order): backend deployed (print routes + order `orderType`/`print` line fields), store `config.print.enabled = true` (and `PRINT_S3_BUCKET` set), then the new Android build (needs an app-store rollout; old builds never show a print entry and show print lines as plain "Item"). Admin Print Queue is needed for steps 14-16.
Use a dev account with a saved address and (for 12) some wallet balance. All prices below are the defaults: Rs 2/side single, Rs 1.50 double, minimum Rs 20, delivery Rs 20.

## Entry points
1. Store with print ON -> Home shows one row directly under the promo carousel: the wallet card on the left and a square pale-mint "Print" tile on the right, same height. Tapping the tile opens the Print screen. ✅
1a. Home row details (Android, print ON):
    - Wallet card: subtitle "Invite a friend, earn rewards on their orders" stays on one line and ends in "…" when space runs out; chevron sits at the right edge of the card. ✅
    - Print tile: square, pale mint, dark green print icon and "Print" label. ✅
    - Press feedback: the tile shrinks slightly on press (scale 0.96, about 120 ms) with a ripple. ✅
    - Reduced motion (Developer options > Animator duration scale = Off): the row has no entrance animation; it appears at once. ✅
    - TalkBack order: wallet card first (reads its balance title), then "Print documents, button". ✅
    - 200% font scale: the wallet card grows taller, the tile grows with it and stays square, and the "Print" label is neither clipped nor wrapped. ✅
1b. Stationery category (print ON) shows one full-width card above the products: pale mint, dark green print icon, "Print documents" with the line "Upload a PDF or photo. We print it and deliver it.", and a chevron. Tapping it opens the Print screen. ✅
2. Store with print OFF, or `GET /user/print/config` failing (airplane mode then reopen) -> no Print tile on Home: the wallet card runs full width with no empty gap, and Stationery shows no Print card. Automated: `WalletPrintRowTest` (print-off case). ✅
3. Switch store (address change) to a print-OFF store while on the Print screen with a file -> "Printing isn't available at your location yet" + Back to home; the draft is deleted (check `GET /user/print/jobs/:id` -> 404/EXPIRED). ✅
4. Orders screen / Order detail of a print order on an OLD build -> shows "B&W print · name · N sides", no image, no crash. (separate old-build check)

## Empty state (Print screen before a file is picked)
Spec: `design-print-page-spec.md` (variant A). Android-only; needs only the new Android build (no backend/admin change). All numbers come from `GET /user/print/config` - change them in admin print settings and reopen the screen to check each case.
E1. Default config -> top to bottom: back arrow + "Print documents", grey rounded printer badge, "Print from your phone", "PDF, JPG or PNG. Up to 20 MB and 200 pages.", "Word file? Save it as PDF first.", lawful-content checkbox, ORANGE "Choose file" (deep orange gradient, white label clearly readable; Continue and Pay buttons stay green), "Black & white, A4. Delivered to your door.", then a "Black & White" card with a big orange "Rs 2 / page" and two small orange pills "Double-sided Rs 1.50 / page" and "A4", then a pale-mint strip with a green "i": "Minimum order Rs 20 · about 10 pages" / "Delivery Rs 20 per order". No colour-print card anywhere, no "Coming soon". ✅
E2. Small grey lines ("Word file?...", "Tick the box to choose a file.", "Black & white, A4...") are the darker grey (InkSecondary), readable on the light background. ✅
E3. Single price Rs 1.50, minimum Rs 20 -> "about 14 pages" (always rounded up). Single Rs 3, minimum Rs 20 -> "about 7 pages". ✅
E4. Double price unset, equal to single, or higher than single -> the "Double-sided" pill is hidden (the "A4" pill stays). ✅
E5. Delivery charge 0 or unset -> the "Delivery Rs N per order" line is hidden; the strip shows only the minimum line. ✅
E6. Single price unset or 0 -> the Black & White card is hidden entirely (never "Rs 0"); the strip still shows "Minimum order Rs 20" without "about N pages". Minimum also unset/0 and delivery 0 -> strip hidden too; the rest of the screen (Choose file etc.) still works. ✅
E7. Config still loading (slow network) -> grey placeholder blocks, including a tall card block and a short strip block, so nothing jumps when prices arrive. ✅
E8. Config request fails (airplane mode, then open Print) -> "Couldn't load print settings. Retry" (unchanged); Retry with network back shows the full empty state. ❌ expected
E9. Offline after the screen loaded -> offline banner, Choose file disabled, price card and strip still visible. ✅
E10. TalkBack: price card reads as one item "Black and white printing, 2 rupees per page. Double-sided 1 rupee 50 paise per page. A4 paper." (not a button); strip reads "Minimum order 20 rupees, about 10 pages. Delivery 20 rupees per order."; order is back -> hero text -> checkbox -> Choose file -> captions -> card -> strip. Automated: `PrintRateCardTest` (connected test). ✅
E11. Font scale 200% -> the pills wrap onto a new line, the big price is never cut off. Dark theme / rotation -> no crash, card and strip keep their colours. ✅

## Upload
5. Tick the lawful box, Choose file, pick a 3-page PDF -> determinate "Uploading... N%", then "Checking your file...", then file card "3 pages · size" + A4 preview strip. ✅
6. Tap Choose file with the box unticked -> picker does not open, view scrolls to the checkbox. ✅ Orange button behaves exactly as before (same press feedback, 48dp+ height). Automated: `HaperButtonAmberDeepContrastTest` (white label >= 4.5:1).
7. JPG and PNG -> 1 page. ✅
8. Word/text file -> local error "We can only print PDF, JPG or PNG..." (no network call). 25 MB file -> "This file is 25 MB. The limit is 20 MB..." (no network call). ❌ expected
9. Password-protected PDF -> "We couldn't open this file. If it has a password...". PDF over the page limit -> too-many-pages copy. ❌ expected
10. Airplane mode mid-upload -> "Upload stopped. Check your connection." with Retry / Choose another file / Remove; Retry works. Cancel during upload -> back to empty. ✅/❌
11. 21st upload in an hour -> rate-limit copy (no Retry loop). ❌ expected

Upload queue (needs an Android build with the per-file upload queue; busy/too-many-drafts steps need the backend to answer 503 `reason: BUSY` / 429 `reason: TOO_MANY_DRAFTS`). Automated: `PrintUploadQueueTest`, `PrintViewModelTest`.
11a. Server busy: upload `class10_notes.pdf` while the server answers 503 BUSY -> card stays on "Uploading... 0%", the app sends it again by itself after about 8 s, then about 20 s (watch okhttp logcat); if still busy -> "We're a bit busy right now. Please try again in a minute." with Retry. Retry starts the count again (two more quiet tries). ✅ If the 2nd try succeeds -> normal file card, no error shown. ✅
11b. Pick `rent_agreement.pdf` in airplane mode -> card waits at 0%, Cancel works; turn airplane mode off -> upload starts by itself, no tap needed. ✅ Cancel while waiting -> back to empty, nothing uploads later. ✅
11c. Airplane mode mid-upload (bar below 100%) -> "Upload stopped. Check your connection."; turn it off -> upload restarts once by itself. Drop the connection again on that retry -> the error stays and the app does not retry by itself again until you tap Retry. ❌ expected on the 2nd drop
11d. Too many saved files: upload while the server answers 429 TOO_MANY_DRAFTS -> "You have too many saved files. Remove files you don't need, or try again later."; tap "Choose another file", pick `id_card_scan.jpg` -> it uploads normally (bar moves, file card appears). Must NOT freeze at "Uploading... 0%". ✅
11e. With `bank_statement.pdf` ready (file card shown), Choose file and pick `photo.docx` (fails the local check) -> local error card replaces it, and the old file's draft is deleted on the server (okhttp logcat shows DELETE on that job). ✅ Same with a 25 MB file. ✅
11f. Go offline at the moment an upload finishes (big `thesis_draft.pdf`, turn on aeroplane mode just as the bar reaches 100%) -> the file ends up Ready (preview/options appear) and is NOT uploaded a second time when you reconnect (okhttp logcat: one POST `user/print/upload` for it). ✅ If the bytes had not all gone out yet -> "Upload stopped. Check your connection." and one automatic re-upload on reconnect, as in 11c. ✅ Remove a row just as its upload finishes -> the row stays gone and logcat shows a DELETE for that job (no hidden saved file left behind). ✅ Automated: `PrintUploadQueueLateSuccessTest`, `PrintUploaderCancelTest`.
11g. Log out while files are uploading (pick `bank_statement.pdf` and `id_card_scan.jpg`, one Ready, one still uploading, then Profile -> Logout) -> uploads stop at once; logcat (`okhttp`) shows a `DELETE user/print/jobs/…` for the Ready file BEFORE the session ends and no further `POST user/print/upload`. Log in as another user and open Print -> empty screen, consent unticked, no old file. ✅ Session expiry (token rejected) clears the screen the same way, without DELETE calls. ✅ Automated: `PrintSessionAndRecoveryViewModelTest`.
11h. Switch dark mode, font size or split-screen while files upload -> every file still finishes (no "Upload stopped" / unreadable-file errors caused by the switch). ✅ Automated: `PrintCacheSweepTest`.
11i. Open File settings -> tap "retry preview", then log out at once and log in as someone else -> no preview of the previous user is downloaded (no GET of the old signed link in okhttp logcat after the new login; Print opens empty). ✅ Automated: `PrintSessionAndRecoveryViewModelTest`.
11j. Pick a large file (about 20 MB) and leave the Print screen while it is still being added; repeat 5 times -> no leftover copy: the app's cache size (Settings -> Apps -> Haper -> Storage) does not grow across repeats. ✅ Same when a preview download is cut short by leaving the screen. ✅
11k. One file waiting to retry (airplane mode on and off, or server BUSY), then untick the consent box -> the card says "Tick the box above to continue." instead of "Uploading... 0%"; re-tick -> the upload starts by itself. ✅ Automated: `PrintFileListLogicTest`.

## Options + price
12. Change sides / copies / custom pages -> price dims, updates once ~0.3 s after the last change (one `/quote` call, see logcat okhttp BASIC). Copies + disabled at the store max with "Up to N copies". ✅
13. Pages "1-3, 7" -> thumbnails outside the range dimmed with "Not printed"; "1-99" on a 12-page file -> inline error "Enter pages like 1-3, 7. This file has 12 pages.", Continue disabled, no quote call. ✅
14. Tiny job (1 page) -> breakdown shows "Minimum order top-up" and "Minimum print order is Rs 20." Cost / margin never appears anywhere. ✅
14b. Options-screen breakdown ends with "Delivery charge Rs 20" and a bold "Total Rs 40" (4 sides, min top-up case: Printing 8 + top-up 12 + delivery 20); Total equals the sticky bar value. If delivery is 0 the delivery row is hidden but Total still shows. A thin line sits above the Total row on the Options screen. ✅
15. Quote fails (airplane mode) -> "Couldn't update the price. Retry", Continue disabled, old price kept. ❌/✅
16. Continue is disabled until: price loaded, range valid, lawful box ticked. Tapping it while only the box is missing scrolls to the box. ✅
17. Back with a file attached -> "Discard this file?"; Discard calls DELETE (job gone), Keep stays. Remove (X) asks "Remove this file?". Replace picks a new file and deletes the old draft. ✅
18. TalkBack: thumbnails read "Page 3 of 12, will be printed/not printed"; progress reads "Uploading 42 percent"; stepper reads "Decrease/Increase copies"; price announces "Total Rs ..." only after settling; all targets >= 48dp; font scale 200% puts price above the button. ✅
18b. Type in "Note to store (optional)" -> keyboard action key is Done (no return arrow); tapping Done hides the keyboard and clears focus; no newline inserted. With the keyboard still open, scroll the screen down to the lawful box; the Continue bar is behind the keyboard and comes back after Done or Back (content sits above the keyboard, nothing cut off). Also check: no large blank gap between the content and the keyboard; at font scale 200% on a small phone the Note field stays visible while typing. The floating tab bar hides while the keyboard is open on this screen and comes back after Done / keyboard dismiss (Back). Same for the Custom pages field. Regression: on Search, Addresses, Login and Checkout the tab bar behaves exactly as before (it does NOT hide with the keyboard there). ✅/❌

## Review & pay
19. Continue -> Review shows address (Change opens the address list and returns), file summary (Edit goes back, options intact), price + delivery + GST line + total, wallet toggle (only when balance >= Rs 1), deletion notice, the amber note's second line ("Payment is online only for print orders." while COD is off / old backend; see COD section), lawful box. ✅
20. Pay with Razorpay -> sheet opens for the server amount -> success lands on existing payment-status -> "Payment received / We'll print it and send it to you." -> Track my order. Grocery cart is NOT cleared. ✅
21. Wallet covers everything -> "Pay Rs 0 with wallet", order placed without Razorpay. Partial wallet (e.g. total Rs 42.50, wallet Rs 100) -> wallet Rs 41, Razorpay Rs 1.50. ✅
22. Admin changes the price after the quote, then Pay -> amber banner "The price changed from X to Y", button becomes "Accept new price", nothing charged; Accept updates totals, then Pay charges the new amount. ✅/❌
23. Double tap Pay / second device on the same file -> one order; the other gets taken to that order's payment screen (JOB_ALREADY_ORDERED). ✅
24. Close the Razorpay sheet -> existing payment-status screen (retry / expiry), no duplicate order. Kill the app in the sheet and reopen -> lands on that payment screen. ✅
25. Wait past the 15-minute window -> payment-status "expired"; the file returns to UPLOADED server-side (re-print needs a new Print flow; the old local state is gone). ❌ expected

## Cash on delivery (needs backend print-cod on dev; COD is OFF per store until a super admin turns it on)
C1. COD off (or old backend, config has no `codAvailable`) -> screen identical to before: no "Payment" section, note says "Payment is online only for print orders.", pay bar "Pay Rs X". ✅
C2. COD on, eligible user, total <= limit -> "Payment" section with "Pay online" (selected) and "Cash on delivery"; note says "You can pay online or in cash to the rider." ✅
C3. Pick Cash on delivery -> pay bar "Place order · pay Rs X in cash" (X = total, or the part after coins when the wallet switch is on, e.g. Rs 1.50 shows "Rs 1.50"). Wallet on + COD -> extra card: Order total / Wallet coins -Rs N / Pay in cash on delivery. ✅
C4. Place a COD order -> no Razorpay sheet, goes straight to the placed/success flow; order detail shows Confirmed (not Paid) in the timeline. Wallet is debited only for the coins part. ✅
C5. Wallet coins cover the whole total -> no Payment section, amber note says "Paid with your wallet coins." (not the pay-online-or-cash line), button "Pay Rs 0 with wallet", order stored as wallet (not COD). ✅
C6. Total above the limit (e.g. limit Rs 300, quote Rs 320) -> no choice; note "Cash on delivery is available up to Rs 300. Pay online for this order." Reduce copies -> choice appears. ✅
C7. New user with no delivered order (`COD_NOT_ELIGIBLE`) -> no choice; note "Cash on delivery opens up after your first delivered order." ✅
C8. Admin lowers the limit after the screen loaded, then Place order -> 409 COD_LIMIT: red banner shows the server message, selection back to Pay online, config AND quote re-fetched, consent and address kept; next tap pays online. Same for COD_NOT_ELIGIBLE (neutral server copy "Cash on delivery isn't available right now. Please pay online.") and COD_OPEN_LIMIT (an open COD print order exists; server message shown; config does not report this reason, so COD may be offered again on reopen). ✅/❌
C9. Admin turns COD off mid-session, then Place order -> 400 with `reason: "COD_OFF"` (needs the backend change): banner "Cash on delivery isn't available right now. Please pay online.", back to online, note returns to the "online only" line. ✅/❌
C9b. COD with an out-of-area / removed address -> plain 400 (no COD_OFF): the real address error shows, selection STAYS on cash (no false "COD isn't available"). ✅/❌
C9c. After a COD refusal, turn off network before the config refetch fires: the uploaded file and review screen stay (no kick-out, file not deleted); only the COD choice resets. ✅/❌
C10. Reject a COD order (no coins used) -> red card ends with "Nothing was charged." (no "refunded" wording); with coins used and `refundedAmount` > 0 -> "Nothing was charged. Rs N wallet coins returned." Non-COD rejected order keeps "Your payment is being refunded to your wallet." ✅
C11. TalkBack: each choice row reads "Cash on delivery, pay the rider when it arrives, selected, 2 of 2"; rows >= 56dp; 200% font wraps without truncating. ✅
C12. COD order detail: total row "Pay on delivery" ("Paid in cash" once delivered; "Nothing was charged" + Rs 0 when rejected, cancelled, undelivered, failed, deleted, payment failed/cancelled or any refund status), amount keeps paise (Rs 1.50 order shows Rs 1.50, not Rs 2); no "Paid via" sub-line; header "Pay Rs X in cash on delivery" (with coins: "Pay Rs X in cash. Rs N paid with wallet coins."); UN_DELIVERED shows "We couldn't deliver this order. Nothing was charged."; non-COD and non-print orders unchanged. ✅/❌
C13. Success screen for a COD print order: title "Order placed", line "Pay Rs X to the rider when it arrives." (never "Payment received"). Wired: PrintReview passes order.price when the placed order is COD, as route arg `&cod=` on orderSuccess (optional; absent for wallet/Razorpay/grocery and deep links, which keep "Payment received"). ✅/❌
Not device-tested yet: JVM tests cover the decision logic only.

## Order detail
26. Paid print order -> status hero "Order Placed"; timeline Uploaded > Paid (live) > Packed > Out for delivery > Delivered (old backend, no `print` block: no "Printing" step; with the `print` block the timeline has 6 steps and "Printing" follows Paid); line card "name.pdf / N pages · N copies · Single-sided · B&W A4 / Rs X"; footer "Your file is deleted 24 hours after delivery."; 60-second cancel works as for grocery. ✅
27. Admin marks printed -> Packed; assign rider -> delivery partner card; delivered -> Delivered, after 24 h the footer reads "File deleted for your privacy." ✅
28. Admin Rejects with a reason -> hero "Rejected", no timeline, red card "We couldn't print this file", staff reason, "Your Rs X is being refunded to your wallet." (online/wallet orders; COD orders say "Nothing was charged.", see C10), "Upload a new file" opens Print (or a toast when print is off). Wallet shows the refund. ✅
29a. Backend with `print` block: admin queues -> Paid stays active; admin starts printing (stage PRINTING) -> "Printing" active; marks printed (PRINTED) -> "Packed" active. ✅
29b. Rejected order shows the staff reason from `print.rejectReason`; old order without `print` still shows it via the "Print rejected:" text. ✅
29c. Footer reads "File deleted for your privacy." as soon as `print.filesPurged` is true (even before 24 h), and not while it is false. Old order (no `print`) keeps the 24 h guess. ✅
29d. Upload errors: complex PDF (FILE_TOO_COMPLEX) -> "too complex" copy; BUSY -> "a bit busy" copy with Retry; over-limit PDF shows the server's real page limit (`maxPages`). ❌ expected
29e. Upload with 20 unordered drafts already on the account (429 `TOO_MANY_DRAFTS`) -> "You have too many saved files. Remove files you don't need, or try again later." with Retry (before this change it showed the "Too many uploads" copy). The 21st upload in an hour (429 `RATE_LIMITED`) still shows "Too many uploads right now. Please try again in a while." with Retry. ❌ expected. No other visible change yet: the multi-file upload queue exists in code only (unit-tested), not wired to the screen. Needs an app build from dev.
29. Push "Print order rejected" opens the order detail. ✅

## Regression
30. A normal grocery order: checkout, payment status, order success ("Order placed"), order detail timeline (5 grocery steps), Aisle screens of other categories, Home with print OFF -> unchanged. ✅

## Order placed + Order detail: files list (multi-file print orders)

Needs: a dev build with the multi-file print order flow (no backend deploy needed; reads existing order items).

1. One-file order (e.g. "Invoice-March.pdf", 12 pages)
   - ✅ Order placed and Order detail look exactly as before: no summary line, no "Your files", the single print row.
   - ❌ A "1 file · 12 pages" chip or a "Show all" link appears.
2. Three-file order (12 + 30 + 4 pages)
   - ✅ Order placed shows "3 files · 46 pages" under the Order ID card, then all three files; the COD line "Pay ₹93 to the rider when it arrives." is unchanged.
   - ✅ Order detail shows the "Your files" section with the "3 files · 46 pages" chip and the same three rows in order; timeline, COD wording and cancel window unchanged.
   - ✅ Each row reads name and "12 pages · 1 copy · Single-sided · B&W A4" (plus "· Pages 3-12" when a range was set), with NO per-file amount: the Total row is the price.
   - ❌ A ₹ amount on any file row (e.g. a ₹2 file showing ₹10 because the minimum top-up sits on line 1). TalkBack reads no amount for a row either. Automated: `PrintOrderFilesListTest`.
3. Five-file order
   - ✅ Only 3 rows show, with "Show all 5 files" below. Tap it: all 5 rows, link becomes "Show less". Tap again: back to 3.
   - ✅ Rotate the phone while expanded: it stays expanded.
4. Printed order (files purged by the server)
   - ✅ Names show "Document 1", "Document 2", "Document 3" by position. A single purged file still shows "Document".
5. Long file name
   - ✅ "Quarterly-report-final-version-2.pdf" shows as "Quarterly-report-f…sion-2.pdf" (extension visible).
6. Accessibility
   - ✅ TalkBack reads each row as one item: "Invoice-March.pdf, 12 pages, 1 copy, one side, all pages".
   - ✅ "Show all" is at least 48 dp tall; font scale 200% wraps names and settings without clipping.
7. No extra request
   - ✅ Order placed lists the files from what the app just ordered: logcat (`okhttp`) shows NO `GET` for the order while the success screen opens. After an app restart or from Orders, Order detail lists them from the order itself.
   - ✅ Rotate on Order placed: the list stays. Leave the screen (Track my order / Keep shopping / Back): the list is not shown again for that order on a later success screen.

---

## Several files — the file list

Needs: a dev backend that sends `maxFilesPerOrder` (10) in the print config for the "new" steps, and one that does not for the "old" step. Test files are made up: `Invoice-March.pdf` (12 pages), `Notes-Ravi.pdf`, `Poster.jpg`, a 34 MB PDF, a `.docx`.

NOTE: ordering with 2 or more files is switched on (see "Several files — review and order" below). Continue for 2+ files turns on once their price shows.

**Old backend (no `maxFilesPerOrder`)**
- ✅ Screen is exactly as before: "Choose file" button, single file card, "Choose another file", options block, Continue.
- ❌ Any list, "Your files" label, "Add another file" row, or "Choose files" text appears.

**Picking**
- ✅ New backend: empty state button reads "Choose files"; caption reads "You can pick up to 10 files. PDF, JPG or PNG, up to 20 MB each."
- ✅ Consent not ticked: button tap scrolls to the tick box, caption says "Tick the box to choose files."; offline: button disabled.
- ✅ Pick 3 files at once: 3 rows appear in the order picked, label "Your files  3 of 10".
- ✅ Two rows upload at a time, the third shows "Waiting"; progress bar with percent; then "Checking your file"; then green tick "Ready".
- ✅ Sticky bar: "Uploading k of n…" (disabled) while uploading, where k is the next file to finish: 3 files just picked read "Uploading 1 of 3…"; after the first is Ready (or failed) "Uploading 2 of 3…"; it never reads "3 of 3" while two are still uploading. After all are done and the price has loaded it shows "Continue" (2+ files) with the total.
- ✅ TalkBack reads the "Uploading k of n…" label politely when it changes.
- ✅ 2+ files where some are Ready and some failed or were rejected (nothing uploading): the button reads "Continue with 2 files" (enabled once priced) and opens the confirm dialog (see "Several files — review and order").
- ✅ Uploads paused by "too many saved files" with nothing else uploading: the button reads "Continue" (disabled), not "Uploading…"; the banner explains why.
- ✅ "Add another file" opens the multi-picker; new rows go to the end; focus moves to the first new row.
- ✅ While picked files are still being added (rows still appearing one by one), "Choose files" and "Add another file" are disabled, so a second pick is not possible until the first batch is in.
- ❌ The count ever goes past the limit (e.g. "6 of 3"), or a file from the first batch is added twice by a quick second pick.
- ✅ Rotate the phone or switch dark mode while a batch is being added: every picked file still shows up. Press Back → Discard while files are being added: nothing comes back later.
- ✅ With 10 files: Add row is greyed and reads "10 of 10 files added".
- ✅ Pick 9 when 3 free slots: 3 are added, banner "You can print up to 10 files in one order. We added 3 of the 9 you picked. …"; banner dismisses with OK.
- ✅ The numbers count every file picked, including duplicates and rejected ones: e.g. 6 picked (1 already listed, 1 `.docx`, 1 unreadable, 3 slots free) reads "We added 2 of the 6 you picked."
- ✅ Remove a file while the over-limit banner shows: the banner goes away (a slot is free again).
- ✅ Pick a file already listed (same name and size): skipped, banner "Invoice-March.pdf is already in your list. To print more copies, change Copies." Several: "2 files were already in your list and were skipped."
- ✅ 34 MB PDF: row with the "This file is 34 MB. The limit is 20 MB…" text and Remove only; it does not count towards "n of 10".
- ✅ `.docx`: row with "We can only print PDF, JPG or PNG…" and Remove only.
- ✅ A file that cannot be read (e.g. a cloud file that fails to download): row with "We couldn't read this file. Remove it and pick it again." and Remove only; it does not count towards "n of 10".
- ❌ A rejected row is never uploaded and has no Retry.

**Remove**
- ✅ Remove on a Ready row: dialog "Remove Invoice-March.pdf?" / "It will be deleted from our servers." / Remove / Keep. Keep does nothing.
- ✅ Remove on a Waiting, Uploading or Failed row: removed at once, no dialog; the next waiting file starts.
- ✅ After removing, TalkBack focus lands on the next row (or the Add row if it was last).
- ✅ Remove the last file: back to the empty state, consent still ticked.

**Failures**
- ✅ Turn on aeroplane mode during an upload: uploading rows show "Upload stopped. Check your connection." with Retry; waiting rows show "Waiting for connection"; offline banner at top.
- ✅ Two or more retryable failures: "Retry all" appears next to "Your files"; one failure: only the row's Retry.
- ✅ Failure text is dark (not red); the alert icon is red.
- ✅ Too many saved files: banner with "Review my files" scrolls to the list.

**Back**
- ✅ Back with 3 files: dialog "Discard 3 files?" / "They will be deleted from our servers." / Discard / Keep. With 1 file: "Discard this file?" as before.

**One file in the list layout (new backend)**
- ✅ Preview, options, price summary and note field show as before; Continue goes to Review as before; the bar shows the total.

**Note, consent, limit changes**
- ✅ With 2+ files the "Note to rider" box shows under the price summary; the text typed is sent as the order's delivery instructions. ❌ The box missing with several files. Automated: `PrintFileRowLogicTest`, `PrintSessionAndRecoveryViewModelTest`.
- ✅ Two failed files: untick the consent box, tap Retry (or Retry all) -> nothing uploads (logcat: no `POST user/print/upload`), the rows stay failed and the screen scrolls to the tick box. Tick it, tap Retry -> they upload. Files still waiting when consent is unticked wait until it is ticked again.
- ✅ Two files listed, the store's config then comes back without `maxFilesPerOrder` (e.g. after a refused cash order): both rows stay listed and priced, "Add another file" is greyed, Continue still works, and Remove on one row removes only that row.
- ✅ A file already in another order while pricing (`JOB_ALREADY_ORDERED`): banner with "Open that order" (opens its payment screen) and that row reads "This file is already part of an order."

**Accessibility**
- ✅ TalkBack reads a row as one item: "Invoice-March.pdf, 12 pages, 1.4 megabytes, 1 copy, one side, all pages. Ready."
- ✅ Remove ("Remove Invoice-March.pdf") and Retry ("Retry upload of …") are separate stops, 48 dp.
- ✅ Percent changes are not read out; "Ready" is read politely, a failure assertively.
- ✅ Font size 200% and a 360 dp wide screen: name wraps to two lines, status text wraps, Remove stays top-right, sticky bar stacks the button.

## Several files — settings
Needs an Android build with multi-file settings and a backend that sends `maxFilesPerOrder` above 1. Prices and Review for several files: see the sections below. Automated: `PrintSettingsUiLogicTest`, `PrintSharedSettingsTest`.

**Shared settings card**
- ✅ With 2+ files a card appears under "Add another file": "Same settings for all files" with a switch (ON), helper "Copies and sides apply to every file. Page range is set for each file.", Copies stepper, Sides "One side / Both sides", and "Page range is set for each file. Tap Edit on a file."
- ✅ Tapping anywhere on the switch row toggles it (not only the switch).
- ✅ Switch OFF -> controls disappear, text "Settings are set for each file."; every row keeps the copies/sides it had.
- ❌ With exactly one file (or `maxFilesPerOrder` 1) there is no card and no Edit: the screen is exactly as before (preview + Options + price + note).
- ❌ A locally rejected file (e.g. 34 MB) does not count: 1 good file + 1 rejected file shows no card.

**Worked example** (`Poster.jpg`, 1-page image + `Report-Final.pdf`, 40 pages)
1. Add both. Card ON; set Copies 2 and Sides "Both sides" -> both rows read "2 copies · Both sides · All pages". ✅
2. Edit on `Report-Final.pdf` -> full-screen File settings titled with the file name: preview, Options (Copies/Sides greyed with "Using the same settings as all files." and "Change for this file"), Pages All/Custom. Pick Custom, type `3-12`, Back -> row reads "2 copies · Both sides · Pages 3-12"; the poster still reads "All pages". ✅
3. Edit on `Poster.jpg` -> no Pages controls at all (1-page file). ✅
4. Tap "Change for this file" -> Copies/Sides become editable; set Copies 5, Back -> poster "5 copies · Both sides", report still "2 copies · Both sides · Pages 3-12"; card switch is now OFF. ✅
5. Turn the switch ON again -> dialog "Use the same settings for all files?" / "Copies and sides on your files will be replaced with the values below. Page ranges stay." / "5 copies, both sides" (first file's values) / "Use same settings" / "Keep separate". ✅
6. "Keep separate" -> switch stays OFF, nothing changes. ❌ no value moves
7. ON again -> "Use same settings" -> both rows 5 copies, both sides; report keeps Pages 3-12. ✅

**Edit, Fix pages, File settings**
- ✅ Edit shows only on Ready rows (not on Waiting/Uploading/Failed/rejected rows). Tapping the row body opens the same File settings.
- ✅ System Back and the top-bar back arrow both close File settings and return to the list at the same scroll position.
- ✅ Range `3-80` on the 40-page PDF -> under the row: "Enter pages like 1-3, 7. This file has 40 pages."; the row's action reads "Fix pages" and opens File settings. Custom with an empty field also shows "Fix pages". Fixing the range brings "Edit" back.
- ❌ An invalid range on any file keeps Continue disabled.
- ✅ Single-file screen (one file): typing `9` on a 3-page file still shows "Enter pages like 1-3, 7. This file has 3 pages." and Continue disabled, exactly as before.
- ✅ Rotate while File settings is open: it stays open on the same file.

**Dead ends, previews, wording, unreadable files**
- ✅ A 1-page file (e.g. `Poster.jpg`) with Custom ticked and `2` typed, then a second file added -> the poster row reads "All pages", shows no "Fix pages" and no error, and Continue is not blocked by it.
- ✅ With 2+ files, a 1-page file offers no page range in File settings and cannot be given one.
- ✅ A file with Custom ticked and nothing typed -> its row reads "Pages: not set" (not "All pages"), "Fix pages" shows, and under the row: "Enter the pages to print." TalkBack reads the same text. The File settings field itself is unchanged.
- ✅ Open one file's settings, go back, then remove the other file -> the remaining file's preview loads (no endless "loading").
- ✅ Sides read "One side / Both sides" on the card, in the rows, in the "Use the same settings" dialog and in File settings. (One file only: the Options block keeps "Single-sided / Double-sided".)
- ✅ A file that cannot be read (e.g. its source app revokes access) shows a row "We couldn't read this file. Remove it and pick it again."; the other files in the same pick still add and the app does not crash.
- ✅ A file that failed and cannot be retried does not change the card's values or the "Use the same settings" dialog text.
- ✅ Store lowers the maximum copies, then reopen Print -> no file shows more copies than the new maximum (applies to the one-file screen too).

**Accessibility**
- ✅ TalkBack: the row's Edit is its own stop, read "Edit settings for Report-Final.pdf"; "Fix pages for …" when the range is wrong, and the row summary reads the range error after "Ready".
- ✅ Closing File settings puts focus back on that row's Edit; closing the switch dialog puts focus back on the switch row. The dialog keeps focus inside and closes with Back.
- ✅ Switch row is read as a switch with its state; stepper buttons "Decrease copies" / "Increase copies" are 48 dp.
- ✅ Font size 200% or a 360 dp wide phone: Copies sits above Sides in the card, and a row's Edit moves to its own line.

## Several files — order price (logic only; nothing new on screen yet)
Needs an Android build from dev and the backend order-form quote (`haper-backend/docs/reference/print-order-quote.md`) on dev. Row prices, banners and ordering are covered in the sections below. Automated: `PrintOrderQuoteLogicTest`, `PrintOrderQuoterTest`, `PrintOrderQuoteViewModelTest`, `PrintUploadQueueQuoteMarksTest`, `PrintOrderQuoteGsonTest`.

What can be checked now (debug build, filter logcat by `okhttp`):
- ✅ 2 Ready files -> about 0.4 s later ONE `POST user/print/quote` with body `{"jobs":[{"jobId":…,"copies":1,"sides":"SINGLE"},…]}` (no `pageRange` key for "All pages"), files in list order.
- ✅ Tap Copies + three times quickly -> one more quote call (with the last value), not three.
- ❌ Changing a file that is still uploading or failed sends no quote call.
- ❌ A file with Custom pages ticked and an empty or wrong range -> no quote call until the range is fixed.
- ❌ One file on screen (or `maxFilesPerOrder` missing/1) -> only the old single-file quote (`{"jobId":…}` body), never the `jobs` form. Remove the 2nd file -> the single-file quote is asked again for the remaining file.
- ✅ A file deleted on the server (404 `NOT_FOUND` / 409 `JOB_UNAVAILABLE` / `JOB_EXPIRING` / `JOB_OTHER_STORE` for its jobId) -> that row turns Failed "Please add this file again" with no Retry, exactly ONE `DELETE user/print/jobs/…` call for it (Remove later sends none), and the remaining files are quoted again.

Rules the next step relies on (unit-tested): the file price is `lines[].subtotal` (never `amount`); top-up, delivery (hidden at 0), "Includes GST (18%)" and Total are the server's numbers, never added up in the app; a reply missing `total`/`subtotal`/`configVersion`/… counts as a failed price, never ₹0; a price only counts when it was made for exactly the files and settings on screen.

## Several files — prices
Needs an Android build from dev and the order-form quote on dev. Fictional data below. Ordering with 2+ files: see "Several files — review and order". Automated: `PrintOrderPriceUiLogicTest`, `PrintMultiFileViewModelTest`, `PrintSharedSettingsTest`.

**Row prices and summary**
- ✅ Each Ready file shows its own price at the right of its "Ready" line (e.g. `Invoice-March.pdf` ₹6, `Notes.pdf` ₹30, `Poster.jpg` ₹2). Rows that are uploading, waiting or failed show no price.
- ✅ Three files priced 6 / 30 / 2 with delivery 20: the summary lists the three file lines, "Delivery charge ₹20", "Includes GST (18%)" (no amount), then Total ₹58. No "Minimum order top-up" row. The sticky bar reads "Total ₹58" with "3 files · N pages" under it.
- ✅ Two tiny files (₹1 and ₹2) under the store minimum: a "Minimum order top-up" row shows with "Minimum print order is ₹…". Delivery appears once, not per file.
- ✅ More than 3 files: the file lines fold into one "Printing (46 pages, 4 files)" row with "Show details". Tap it: the Printing row stays and the file lines show indented below it; the button reads "Hide details". TalkBack says Collapsed / Expanded.
- ✅ Change Copies on the settings card: the row prices, summary and sticky total all turn into grey bars together, then show the new numbers. The old total is never shown next to the new copies.
- ✅ Type a page range that is wrong for a file: the summary and the sticky total disappear, that row shows "Fix pages" and its message; fix the range and the prices come back.
- ✅ A file that failed or cannot be read, holding a wrong page range, does not show "Fix pages" and does not keep Continue blocked by itself.
- ✅ Remove a file: prices go to bars, then the total is for the remaining files only.
- ✅ Font size 200% or a 360 dp wide phone: each row's price sits under its settings line, and the sticky bar shows the total above a full-width Continue.

**Errors**
- ✅ Copies so high that the order passes the printed-sides limit: a banner above the list reads "This order is too big to print at once (limit … pages including copies). Reduce copies or remove a file." The summary is hidden.
- ✅ Price cannot be fetched (airplane mode after a change): the sticky bar shows "Couldn't update the price." with Retry; Retry fetches again and the prices return.
- ✅ A file the server no longer has: its row turns Failed "Please add this file again" with Remove only (no Retry, no price); the other files are priced again.
- ❌ No red text for errors: row price errors are dark text with a red alert icon.

**One file / sticky bar**
- ✅ With 2+ files Continue is enabled only while the shown price is for exactly the files and settings on screen (grey bars = disabled).
- ✅ Two files, then remove one: the screen and price block are exactly the old one-file screen, and the single-file price is asked for again (logcat: one `{"jobId":…}` quote, none while two files were listed).
- ✅ With 2+ files no old single-file quote (`{"jobId":…}` body) is sent at all.

**TalkBack**
- ✅ A row reads "Name, 12 pages, 1.4 megabytes, 1 copy, one side, all pages, 24 rupees. Ready." Summary lines read "Delivery charge, 20 rupees"; the GST line reads as a label only; the total is announced once per new price, not while typing.

## Several files — review and order
Needs an Android build from dev, a backend that sends `maxFilesPerOrder` (10) and the order-form quote on dev. Fictional data: `Invoice-March.pdf` (12 pages), `Notes-Ravi.pdf` (30 pages), `Poster.jpg` (1 page) and `Report-Final.pdf` (40 pages, pages 3-12 = 10 printed). Store cash limit ₹300 where COD is on. Automated: `PrintOrderPlaceLogicTest`, `PrintFilesOrderViewModelTest`, `PrintOrderQuoteViewModelTest`.

**Happy path (3 files)**
1. Add `Invoice-March.pdf`, `Notes-Ravi.pdf`, `Report-Final.pdf` (range 3-12). Wait for the total. Tap "Continue". ✅ Review opens with top bar "Review order".
2. ✅ "Files (3)" with "Edit files"; three rows in list order, each with name, "12 pages · 1 copy · One side · All pages" (report: "10 pages · 1 copy · One side · Pages 3-12"; "Both sides" when double-sided, same words as the list) and its own price. The summary below lists each file line, ONE "Delivery charge", "Includes GST (18%)" and the Total — expanded on Review.
3. ✅ Delivery address, wallet switch, payment choice, amber note ("Your files are deleted 24 hours after delivery.") and the pay bar look as on the one-file Review; the pay bar amount equals the summary Total.
4. "Edit files" ✅ goes back to the list with everything kept (files, settings, price).
5. Tap pay. ✅ logcat (`okhttp`): ONE `POST user/print/order` whose `jobs` are the three files in list order, the same `jobs` as the last `POST user/print/quote`, `expectedTotal` = the Total shown, `configVersion` from that quote, no `pageRange` key for "All pages".
6. ✅ Success screen lists the three files with "3 files · 52 pages" (12 + 30 + 10) and makes NO extra order request. ✅ Orders shows ONE order with 3 files.
7. ❌ The files are deleted after ordering: no `DELETE user/print/jobs/…` call after the order.

**One file failed**
- 3 files, `Poster.jpg` failed (airplane mode during its upload, then back online). ✅ Button reads "Continue with 2 files". Tap: dialog "1 file won't be printed", "• Poster.jpg", "You can still place the order with the other 2 files.", buttons "Go back" / "Continue without it".
- ✅ "Go back" (or Back, or tap outside): dialog closes, all three rows stay.
- ✅ "Continue without it": the failed row is removed and Review opens with "Files (2)".
- ✅ Two failed of three: title "2 files won't be printed", body "You can still place the order with the other file.", button "Continue without them"; after it the ONE remaining file goes through the normal one-file Review ("Review & pay"), with the one-file price (logcat: a `{"jobId":…}` quote), never the old order total.
- ❌ Any file is left out without the dialog.

**Price must match the screen**
- ✅ On the list, change Copies after the total showed: Continue turns off (grey bars) until the new total shows. On Review the pay bar reads "Calculating price" (disabled), the summary shows grey bars and the Wallet / To pay panel is hidden while a new price loads; the old total is never shown.
- ✅ Change the delivery address on Review to one served by another store: Review closes back to the list, which is empty with the "You changed your address…" message.

**Cash on delivery**
- ✅ Total ₹280: cash choice shows as on one file.
- ✅ Total ₹340 (over ₹300): no cash choice; the amber note reads "Cash on delivery is available up to ₹300. This order is ₹340. Remove a file or pay online." followed by "Edit files" (back to the list). TalkBack reads the line when it appears.
- ✅ Cash was chosen, then a file added on the list pushes the total over ₹300: back on Review the choice is gone, Pay online is used, and the line above shows.
- ✅ Total exactly ₹300: cash is offered. ₹300.01: not offered.
- ✅ Server refuses cash (`COD_LIMIT` / `COD_NOT_ELIGIBLE` / `COD_OPEN_LIMIT`): its message in the red banner, choice back to Pay online, one new price request (`jobs` form). `COD_OFF`: "Cash on delivery isn't available right now. Please pay online."

**Order-time errors**
- ✅ Prices changed between Review and pay (`PRICE_CHANGED`): "The price changed from ₹93 to ₹101 (printing rates were updated)." and "Accept new price ₹101"; nothing is charged until accepted; then the pay bar shows ₹101 and the user taps pay again. The order sends `expectedTotal` 101.
- ✅ Price changed -> tap "Back" -> change Copies on a file -> wait for the new total -> Continue: Review shows the NEW price and the normal pay bar, not "Accept new price" with the old numbers. ❌ Pay stuck disabled or the summary stuck on grey bars. Automated: `PrintSessionAndRecoveryViewModelTest`.
- ✅ A `PRICE_CHANGED` reply without file lines: red banner "The price changed. Go back to your files to see the new price." with "Back to files".
- ✅ A file expired before paying (`JOB_EXPIRING` / `JOB_UNAVAILABLE` / `JOB_OTHER_STORE`, or 404): red banner with the server message and "Back to files". Tap it: the list shows that file marked "Please add this file again" (no Retry); the others are priced again and the button reads "Continue with 2 files". logcat: exactly one quote for all files, then one for the files still ready — no repeating calls.
- ✅ A file already in another order (`JOB_ALREADY_ORDERED` with an order id): banner with the server message and "Open that order" (opens its payment screen); the list is kept.
- ✅ Double-tap the pay button quickly: ONE `POST user/print/order`, one order.
- ✅ Order refused because one file is already part of another order (reply has no order to open): the Review banner shows the server message with "Back to files"; tapping it returns to the files, the price is asked once, the offending row reads "This file is already part of an order." and Remove on it lets the rest be ordered.
- ✅ A "forbidden" reply (403) that is not "print unavailable" (e.g. from a proxy): uploaded files stay listed; the price shows Retry (or the order shows its error banner). Only reason `UNAVAILABLE` clears the list and deletes the uploaded files.

**One file / old backend**
- ✅ One file (or no `maxFilesPerOrder`): Print, "Review & pay" and the order request are exactly as before (single `jobs` entry, single-file quote), and the success screen has no files list.

**Accessibility**
- ✅ The confirm dialog keeps TalkBack focus inside and closes with Back; its buttons are 48 dp.
- ✅ Each Review file row is read as one item: "Report-Final.pdf, 10 pages, 1 copy, one side, pages 3-12, ₹40".
- ✅ Font size 200%: file names wrap to two lines, prices stay visible, the pay bar does not clip.
