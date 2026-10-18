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

## Upload
5. Tick the lawful box, Choose file, pick a 3-page PDF -> determinate "Uploading... N%", then "Checking your file...", then file card "3 pages · size" + A4 preview strip. ✅
6. Tap Choose file with the box unticked -> picker does not open, view scrolls to the checkbox. ✅
7. JPG and PNG -> 1 page. ✅
8. Word/text file -> local error "We can only print PDF, JPG or PNG..." (no network call). 25 MB file -> "This file is 25 MB. The limit is 20 MB..." (no network call). ❌ expected
9. Password-protected PDF -> "We couldn't open this file. If it has a password...". PDF over the page limit -> too-many-pages copy. ❌ expected
10. Airplane mode mid-upload -> "Upload stopped. Check your connection." with Retry / Choose another file / Remove; Retry works. Cancel during upload -> back to empty. ✅/❌
11. 21st upload in an hour -> rate-limit copy (no Retry loop). ❌ expected

## Options + price
12. Change sides / copies / custom pages -> price dims, updates once ~0.3 s after the last change (one `/quote` call, see logcat okhttp BASIC). Copies + disabled at the store max with "Up to N copies". ✅
13. Pages "1-3, 7" -> thumbnails outside the range dimmed with "Not printed"; "1-99" on a 12-page file -> inline error "Enter pages like 1-3, 7. This file has 12 pages.", Continue disabled, no quote call. ✅
14. Tiny job (1 page) -> breakdown shows "Minimum order top-up" and "Minimum print order is Rs 20." Cost / margin never appears anywhere. ✅
15. Quote fails (airplane mode) -> "Couldn't update the price. Retry", Continue disabled, old price kept. ❌/✅
16. Continue is disabled until: price loaded, range valid, lawful box ticked. Tapping it while only the box is missing scrolls to the box. ✅
17. Back with a file attached -> "Discard this file?"; Discard calls DELETE (job gone), Keep stays. Remove (X) asks "Remove this file?". Replace picks a new file and deletes the old draft. ✅
18. TalkBack: thumbnails read "Page 3 of 12, will be printed/not printed"; progress reads "Uploading 42 percent"; stepper reads "Decrease/Increase copies"; price announces "Total Rs ..." only after settling; all targets >= 48dp; font scale 200% puts price above the button. ✅

## Review & pay
19. Continue -> Review shows address (Change opens the address list and returns), file summary (Edit goes back, options intact), price + delivery + GST line + total, wallet toggle (only when balance >= Rs 1), deletion notice, "online only" line, lawful box. ✅
20. Pay with Razorpay -> sheet opens for the server amount -> success lands on existing payment-status -> "Payment received / We'll print it and send it to you." -> Track my order. Grocery cart is NOT cleared. ✅
21. Wallet covers everything -> "Pay Rs 0 with wallet", order placed without Razorpay. Partial wallet (e.g. total Rs 42.50, wallet Rs 100) -> wallet Rs 41, Razorpay Rs 1.50. ✅
22. Admin changes the price after the quote, then Pay -> amber banner "The price changed from X to Y", button becomes "Accept new price", nothing charged; Accept updates totals, then Pay charges the new amount. ✅/❌
23. Double tap Pay / second device on the same file -> one order; the other gets taken to that order's payment screen (JOB_ALREADY_ORDERED). ✅
24. Close the Razorpay sheet -> existing payment-status screen (retry / expiry), no duplicate order. Kill the app in the sheet and reopen -> lands on that payment screen. ✅
25. Wait past the 15-minute window -> payment-status "expired"; the file returns to UPLOADED server-side (re-print needs a new Print flow; the old local state is gone). ❌ expected

## Order detail
26. Paid print order -> status hero "Order Placed"; timeline Uploaded > Paid (live) > Packed > Out for delivery > Delivered (old backend, no `print` block: no "Printing" step; with the `print` block the timeline has 6 steps and "Printing" follows Paid); line card "name.pdf / N pages · N copies · Single-sided · B&W A4 / Rs X"; footer "Your file is deleted 24 hours after delivery."; 60-second cancel works as for grocery. ✅
27. Admin marks printed -> Packed; assign rider -> delivery partner card; delivered -> Delivered, after 24 h the footer reads "File deleted for your privacy." ✅
28. Admin Rejects with a reason -> hero "Rejected", no timeline, red card "We couldn't print this file", staff reason, "Your Rs X is being refunded to your wallet.", "Upload a new file" opens Print (or a toast when print is off). Wallet shows the refund. ✅
29a. Backend with `print` block: admin queues -> Paid stays active; admin starts printing (stage PRINTING) -> "Printing" active; marks printed (PRINTED) -> "Packed" active. ✅
29b. Rejected order shows the staff reason from `print.rejectReason`; old order without `print` still shows it via the "Print rejected:" text. ✅
29c. Footer reads "File deleted for your privacy." as soon as `print.filesPurged` is true (even before 24 h), and not while it is false. Old order (no `print`) keeps the 24 h guess. ✅
29d. Upload errors: complex PDF (FILE_TOO_COMPLEX) -> "too complex" copy; BUSY -> "a bit busy" copy with Retry; over-limit PDF shows the server's real page limit (`maxPages`). ❌ expected
29. Push "Print order rejected" opens the order detail. ✅

## Regression
30. A normal grocery order: checkout, payment status, order success ("Order placed"), order detail timeline (5 grocery steps), Aisle screens of other categories, Home with print OFF -> unchanged. ✅
