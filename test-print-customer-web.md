# Test guide: Print on demand, customer web (haper-web)

> **SHIP THE WHOLE WEB PRINT SET TOGETHER.** `OrderDetail.tsx` imports the new `PrintOrderDetail` page (plus `Print.tsx`, `PrintReview.tsx`, `PrintContext`, `components/print/*`, `services/printApi.ts`, `types.ts`, `services/api.ts`, `App.tsx`, `Home.tsx`, `CategoryPage.tsx`, `OrderSuccess.tsx`). Committing `OrderDetail.tsx` or `Orders.tsx` alone breaks the build.

Needs (in this order): 1) backend deployed (user API + shared; `test-print-upload.md`, `test-print-checkout.md`), 2) env `PRINT_S3_BUCKET` set, 3) store `config.print.enabled = true` with prices, 4) web build with `VITE_RAZORPAY_KEY` set. Old web builds crash on a print order line without a product, so ship this web build BEFORE the first print order exists.
Routes: `/#/print` (upload + options), `/#/print/review` (address, wallet, pay), `/#/orders/:id` (print tracking). Example prices: Rs 2/side single, Rs 1.50 double, minimum Rs 20, delivery Rs 20.

## Entry points
1. Store with print ON -> Home shows the "Print documents" tile above Shop by Category; Stationery category page shows the same tile above the products. Both open `/print`. ✅
2. Store with print OFF, or `PRINT_S3_BUCKET` empty -> neither tile shows (no gap, no error). ✅
3. Open `/#/print` directly while print is off -> "Printing isn't available at your location yet" + Back to home. ✅
4. Config call fails (offline) -> tiles hidden; `/print` shows "Couldn't load print settings" + Try again. ✅/❌
5. Switch delivery address to a store with print off while on `/print` -> screen swaps to the unavailable state, draft dropped. ✅

## Upload
6. Empty state: tick "I own this content..." then Choose file -> 3-page PDF uploads, determinate progress, then "Checking your file...", then file card "3 pages". ✅
7. Choose file WITHOUT ticking the box -> no picker, box is focused with "Tick the box to continue." (server needs consent at upload). ❌ expected
8. JPG and PNG -> 1 page each. ✅
9. `.docx` / `.exe` -> instant "We can only print PDF, JPG or PNG..." (no upload sent). ❌ expected
10. File over 20 MB -> "This file is 34.0 MB. The limit is 20 MB..." (no upload sent). ❌ expected
11. PDF over 200 pages -> "too many pages... Split the file". Password PDF / damaged PDF -> "We couldn't open this file...". ❌ expected
12. Turn network off mid-upload -> "Upload stopped. Check your connection." with Retry / Choose another file / Remove. ❌ expected
13. Cancel during upload -> back to empty state, no job left (check no draft row grows). ✅
14. 21st upload in an hour -> error card with the server's "Too many uploads" message. ❌ expected
15. Replace: upload a second file -> card switches, the old job is deleted server-side (best effort). ✅
16. Remove (X) -> "Remove this file?" -> Remove deletes the job (GET /jobs/:id now 404) and returns to empty state. Keep closes. ✅
17. Back arrow with a file attached -> "Discard this file?"; Discard deletes and leaves, Keep stays. ✅

## Options + live price
18. Change Sides / Copies / Pages -> price dims then settles (one request after ~300 ms of quiet; check network tab: rapid + taps = 1 quote). Price always comes from `/user/print/quote`. ✅
19. Custom pages `1-3, 7` on a 12-page file -> Printing pages count changes; `5-20` or `abc` -> inline "Enter pages like 1-3, 7. This file has 12 pages."; Continue disabled; input kept. ❌ expected
20. Copies stops at the config max (+ disables, "Up to 20 copies"). ✅
21. Total under Rs 20 -> amber "Minimum print order is Rs 20." and printing amount is Rs 20. ✅
22. Single-sided on a multi-page file -> "Double-sided is cheaper per side: Rs 1.5 vs Rs 2" nudge. ✅
23. Quote fails (stop backend) -> "Couldn't update the price." + Retry; Continue disabled. ❌ expected
24. Untick the lawful box -> Continue looks disabled, helper line shows; clicking it focuses the box. ✅
25. Preview: A4 frame shows the processed PDF; "Open preview in new tab" works (iOS Safari shows only page 1 in the frame, use the link). Leave the page 11+ minutes and come back -> preview still loads (link re-signed). ✅
26. No cost fields anywhere in network responses/UI (`costPerSide`, `costAmount`). ✅
27. Desktop >= 768 px: two columns (preview sticky left, options + price + Continue right); mobile: sticky bar with Printing price and Continue above the bottom nav. ✅

## Review & pay
28. Continue -> Review shows address (default selected, Change goes to /addresses), file summary (Edit returns with options intact), Price details with delivery charge and total (GST shown as "Includes GST"), notice "Your file is deleted 24 hours after delivery.", the payment line: "Payment is online only for print orders." when the server has COD off or sends no `codAvailable` (old backend), no COD row; with COD on see steps 54-66. ✅
29. Pay with Razorpay (test card) -> success toast, "Payment received" screen with order number, View order opens print tracking. Grocery cart is NOT cleared. ✅
30. Wallet toggle: wallet Rs 100 on Rs 40 order -> button "Pay Rs 0 with wallet", order is OPEN immediately, no Razorpay sheet. Wallet Rs 100 on Rs 42.50 -> wallet Rs 41, Razorpay Rs 1.50. ✅
31. Close the Razorpay sheet / failed card -> red banner "Payment didn't go through. You haven't been charged...", Pay button works again, the unpaid order is cancelled and the file is reusable. ❌/✅
32. Admin changes the price between Print and Pay -> amber banner "The price changed from Rs 40 to Rs 44", button becomes "Accept new price Rs 44" + Back, nothing charged; Accept updates the numbers, then Pay Rs 44 works. ✅
33. Double-tap Pay / second tab -> one order; the second gets JOB_ALREADY_ORDERED and lands on that order's page (shows "Confirming your payment" or "Complete payment"). ✅
34. File older than ~23h40m or deleted -> "This file is no longer available. Please upload it again." with Upload a file. ❌ expected
35. Reload `/print/review` (draft lost) -> redirected to `/print`. ✅
36. No saved address -> "+ Add Address" shown, Pay disabled. ❌ expected

## Order detail / tracking
37. Paid order WITH `print.stage`: stepper is Uploaded > Paid > Printing > Packed > Out for delivery > Delivered. stage QUEUED -> current step Paid; PRINTING/PRINTED -> Printing; then Packed etc. follow order status. Order with no `print` key (old order) -> the old 5 steps, no Printing. ✅
38. Unpaid (PAYMENT_INITIATED) order: "Confirming your payment..." polls every 3 s up to ~1 min, then "Check again"; Complete payment re-opens the Razorpay sheet; Cancel order cancels. ✅
39. Admin rejects the job -> order shows Rejected card "We couldn't print this file", refund line with the wallet amount, "Upload a new file" -> /print. If `print.rejectReason` is present it shows as "Reason: ..." above the refund line; absent/blank -> card as before. ✅
40. Line shows file name, pages, copies, sides, "B&W A4" and the printing amount; bill shows Printing, Print delivery charge, Wallet, Paid online (COD orders: see step 63). No cost price anywhere. ✅
41. 24 h after delivery the file note switches to "File deleted for your privacy." when `print.filesPurged` is true. If `filesPurged` is absent (old backend) it falls back to the 24 h-after-delivery guess from updatedAt; if it is `false` the normal 24-hour note shows even after 24 h. ✅
42. Orders list shows the print line by its generic name, opens the print detail; grocery orders and their detail page are unchanged. ✅

## Accessibility / theme
43. Keyboard only: tab order back > file card > sides > copies > pages > note > lawful box > Continue; visible focus ring on all; progress bar announces "Uploading 42 percent"; errors announced once (role=alert). ✅
44. Dark mode and light mode both readable (amber banner text on tint, error card, disabled states). ✅
45. 360 px wide: no horizontal scroll, long file names truncate with full name on hover. ✅

## Error reasons (web reads `reason`, never the message text)
46. Upload a .docx renamed or a real Word file -> `UNSUPPORTED_TYPE`: "We can only print PDF, JPG or PNG..." ❌ expected
47. Over-limit page count -> `TOO_MANY_PAGES`: copy shows the server's real `maxPages` (e.g. "up to 150 pages"), not the config default. ❌ expected
48. Password PDF -> `PDF_ENCRYPTED` copy about the password; damaged file -> `FILE_CORRUPT`. ❌ expected
49. Zip-bomb PDF -> `FILE_TOO_COMPLEX`: "too complex... simpler PDF or split it". ❌ expected
50. 3+ simultaneous big uploads -> extras get `BUSY`: "We're busy... try again in a minute" with a Retry button that works. ❌ expected
51. 21st upload in an hour -> `RATE_LIMITED`. File over 20 MB -> `FILE_TOO_LARGE`. ❌ expected
52. Old server with no `reason`: errors still classify by HTTP status (415/413/422/429/503). ✅
53. Quote returns `BUSY` / `FILE_TOO_COMPLEX` -> inline price error with the matching friendly copy; other quote failures unchanged. ❌ expected

## Cash on delivery (needs backend print-cod deployed; store COD ON; example max Rs 300, fictional users)
54. Eligible user, total Rs 62 -> "Payment" group with Pay online (selected by default) and Cash on delivery; line under it reads "You can pay online or in cash to the rider." Button stays "Pay Rs 62". ✅
55. Tab into the group -> focus lands on the selected row only; Arrow keys move and select; screen reader says "Payment method, radio group", rows "checked/not checked". Selected row also has a thicker border, not colour alone. ✅
56. Choose Cash on delivery -> button "Place order · pay Rs 62 in cash". Place order -> NO Razorpay sheet, toast "Order placed", lands on the print order page: header "Confirmed", line "Pay Rs 62 in cash on delivery", step list "Uploaded > Confirmed > ...", bill last row "Pay on delivery  Rs 62". Order is OPEN in the admin print queue. ✅
57. Wallet Rs 50 on a Rs 320 order is over the limit (step 59). Use Rs 62 order, wallet Rs 20, COD -> split card "Order total Rs 62 / Wallet coins -Rs 20 / Pay in cash on delivery Rs 42"; button "pay Rs 42 in cash". Wallet Rs 50 on Rs 62.50 -> coins Rs 50 (whole rupees), cash Rs 12.50, button "pay Rs 12.50 in cash". ✅
58. Wallet covers everything (Rs 100 coins, Rs 40 order) -> the whole Payment group and COD line disappear; button "Pay Rs 0 with wallet", order saved as WALLET. ✅
59. Total Rs 320 (over limit 300) -> no choice, line "Cash on delivery is available up to Rs 300. Pay online for this order." Total exactly Rs 300 -> COD offered. Compare is on the printout total even if coins reduce the cash part. ✅
60. New customer (no delivered order) -> no choice, quiet line "Cash on delivery opens up after your first delivered order." No disabled COD row. ✅
61. `codMaxOrderAmount` null / `codAvailable` missing -> behaves exactly like today (online-only line). ✅
62. Mid-session failures (turn COD OFF in admin, or lower the limit, then Place order): 409 (COD_LIMIT / COD_NOT_ELIGIBLE / COD_OPEN_LIMIT "you already have a COD print order in progress") -> red banner with the server message, selection resets to Pay online, choice re-fetched (hidden if gone), address + consent kept, focus moves to the banner; one tap on Pay then pays online. 400 with reason COD_OFF -> banner "Cash on delivery isn't available right now. Please pay online." (not the raw server text), selection resets to online. Any other 400 (e.g. address no longer available, out of delivery area) -> that error's own message in the banner, COD selection kept. Offline -> existing generic banner, selection kept. ❌ expected
63. Order page for COD: delivered -> last row "Paid in cash  Rs 62" and no pay line. Admin rejects -> "Nothing was charged." (never a refund of price + wallet); only if coins were returned: "Rs 20 wallet coins returned". Undelivered -> "Not delivered" header + "We couldn't deliver this order. Nothing was charged." Cancelled -> "This order was cancelled. Nothing was charged." Bill shows "Nothing was charged" instead of a total. Online orders unchanged ("Paid online", refund copy). ✅
64. Submit button spinner while placing; rows disabled while submitting; double-tap places one order. ✅
65. Known gap: no browser run was done when this was written; run 54-63 once on dev.

## Upload (queue behaviour, single file; web build with the upload queue)
66. Server busy (503 BUSY, e.g. 3+ big uploads at once): the extra file shows "Uploading... 0%" and retries by itself after about 8 s, then about 20 s, with no error card; only if still busy after that does the "We're busy..." card appear with a working Retry. ✅ then ❌ expected
67. Choose a file, then switch the network off before it finishes: the upload stops at once, the offline hint shows, the card stays with Cancel available; switch the network back on -> it uploads once more by itself and becomes the file card. Drop it a second time -> "Upload stopped. Check your connection." with Retry. ✅ then ❌ expected
68. Choose a file, switch the network off right after, before the bytes go out: the file waits (Cancel available, offline hint shown) and starts by itself when the connection returns. ✅
69. Server answers 429 with reason TOO_MANY_DRAFTS (20 saved files): card reads "You have too many saved files. Remove files you don't need, or try again later." (no Retry button). ❌ expected
70. After step 69, remove old drafts (or wait), then Choose another file -> the new file uploads normally; it is never stuck in a paused state. ✅
71. A file is ready, then choose a .docx (or a file over 20 MB) -> the error card shows the local-check message, no upload is sent, and the earlier file is deleted on the server (its draft row disappears; the page returns to the empty state with the error). ❌ expected
72. Replacing a ready file with a good one -> the old file card goes away immediately, the new one uploads, old draft deleted, options (copies, sides) kept, page range reset to All, price reloads once the new file is ready. ✅
73. Change the delivery address (or store) while a file is ready on the single-file page -> the file card goes away, the page returns to the empty state, and the uploaded file is deleted on the server (it no longer counts toward the 20 saved files). ✅ Noted change: before, the file was only dropped from the screen.
74. Finish an order normally (single file) -> the file is NOT deleted (the order owns it). ✅
75. With a screen reader on the single-file page, a failed upload is read once (by the error card), and "... is ready" is not announced by the list announcer. ✅

## Several files — the file list

Needs: the web build with this change, and (for the multi-file steps) a dev backend whose `GET /print/config` returns `maxFilesPerOrder` (here 10). Test files (made up): Invoice-March.pdf (12 pages), Notes-Ravi-Sharma.pdf, Poster.jpg, Report-Final.pdf (40 pages), Letter.docx, Huge-Scan.pdf (over the size limit).
Ordering with 2 or more files is switched on (see "Several files — review and order" below).

### Old backend (no `maxFilesPerOrder`)
- ✅ Print page looks and works exactly as before: "Choose file" (one file), file card with Replace / Remove, options, price, Continue to Review.
- ❌ No "Your files" list, no "Choose files", no multi-select in the picker.

### New backend, empty state
- ✅ Button says "Choose files"; caption "You can pick up to 10 files. PDF, JPG or PNG, up to 20 MB each."
- ✅ Not ticking the consent box and pressing Choose files → hint and focus on the box, picker does not open. Offline → button disabled.

### Pick several
- ✅ Pick Invoice-March.pdf, Notes-Ravi-Sharma.pdf, Poster.jpg together → three rows in pick order; list label "Your files" and "3 of 10"; list is announced as "Your files, 3 of 10".
- ✅ Only two rows show a progress bar at once; the third shows "Waiting" with a clock; it starts when one finishes.
- ✅ Each finished row shows a green check and "Ready", pages and size, and "1 copy · One side · All pages". No price on the row.
- ✅ Focus moves to the first new row after picking.
- ✅ With 2+ rows: no settings, preview or price blocks; button reads "Continue" and is disabled (also while files upload: "Uploading 2 of 3…"); it never opens Review.
- ✅ Remove down to one ready file → preview, options and price appear for it, the price matches that file, Continue opens Review.
- ✅ Picking the very same file again later fires the picker again (it is not ignored); the duplicate notice appears.
- ✅ With 2 files ready, open `#/print/review` by typing it in the address bar, or press browser Back then Forward from Review -> you land on the Print page; no price is shown on Review and no order can be placed. ❌ expected: Review showing one file's price, or an order for one of the two files.
- ✅ Go to Review with 1 ready file, press Back, add a second file, wait until both are Ready, press browser Forward -> back on the Print page (never Review).
- ✅ Remove one of two ready files -> the remaining file's preview, options and price come back and match that file.

### Add another file, limits
- ✅ "Add another file" opens the same multi-select picker. At 10 files the row says "10 of 10 files added" and is disabled.
- ✅ With 7 files, pick 6 (one already in the list, Letter.docx, and 4 new): 3 slots left → 3 added. Notice: "We added 3 of the 6 you picked" (picked counts the duplicate and the Word file). Duplicate notice names the file. Word file row says to save it as PDF.
- ✅ Remove one file → the over-limit notice disappears by itself.
- ✅ Huge-Scan.pdf → a row with an alert icon and the size message, Remove only, not counted in "n of 10".
- ✅ Notices can be dismissed with the X (44 px).

### Remove
- ✅ Remove on a Ready row → dialog "Remove Invoice-March.pdf?" / "It will be deleted from our servers." with Remove / Keep; Escape or Keep closes it and focus returns to the trash button.
- ✅ Remove on a Waiting / Uploading / Failed row removes at once. Focus goes to the next row, or to "Add another file" if it was the last.
- ✅ Remove the last row → back to the empty state.

### Failures and offline
- ✅ A failed row shows an alert icon and the sentence in normal dark text (not red), plus Retry. With 2+ retryable failures "Retry all" shows beside the count.
- ✅ Go offline while uploading → uploading rows fail with "Upload stopped. Check your connection."; Add another file is disabled; waiting rows say "Waiting for connection". Back online → they continue.
- ✅ "You have too many saved files…" banner with "Review my files" scrolls to the list; paused rows stay "Waiting"; the button says "Continue" (disabled), not "Uploading…".
- ✅ Upload finishes at the exact moment you go offline (use browser throttling, switch off Wi-Fi just as the last file's bar reaches 100%) -> the row shows Ready (not "Upload stopped"), and when the connection returns it is NOT uploaded a second time (the server's saved-file count goes up by one only). ❌ expected: a second upload of the same file, or a saved file the page does not show.
- ✅ Same moment, but you remove that row first -> the file ends up deleted on the server (no leftover saved file).
- ✅ Remove the last row while offline -> focus lands on the "Your files" heading (or the empty-state title), not lost on a disabled button.

### Leave
- ✅ Back with 3 files → "Discard 3 files?" / "They will be deleted from our servers." Discard leaves and deletes; Keep stays.
- ✅ Leave the Print page by any route (menu, browser Back, another tab link) while some files are still uploading, waiting or failed (example: 9 Ready, 1 uploading) -> only the unfinished and failed files are dropped (uploads cancelled); the Ready files stay. Coming back shows the 9 Ready files with their settings. No confirm is asked because nothing ready is lost. ❌ expected: the Ready files gone, or their server copies deleted (DevTools → Network: no `DELETE /user/print/jobs/...` for them).
- ✅ Single-file mode (max files 1): leaving while the one file is not ready still drops it, as before.
- ✅ File settings open, then leave by the bottom nav and come back with browser Back → the list shows (File settings closed). One more browser Back leaves the Print page; it never takes an extra press that does nothing.
- ✅ Log out with uploaded files in the list → DevTools shows one `DELETE /user/print/jobs/<id>` per uploaded file (sent before the logout finishes). Log in as another fictional user on the same browser (e.g. Asha Verma after Ravi Sharma) → the Print page is empty: no file names, no Retry for the previous person's files.
- ✅ Session expired (dev: DevTools → Application → Local Storage, set `haper_access_token` and `haper_refresh_token` to junk, then change copies on the list) → you land on the login screen (not Home, not the landing page); logging in shows an empty Print page. (The server copies cannot be deleted without a valid login; they expire on their own.)
- ✅ Change the delivery address / store with 3 files ready -> the list is emptied and all 3 files are deleted on the server (the saved-file count drops by 3).

### Keyboard and screen reader
- ✅ Tab order: back, banners, Retry all, each row (Retry, Remove), Add row, Continue. Every control shows a focus ring. Dialog closes with Escape.
- ✅ Screen reader reads each row as one summary, e.g. "Invoice-March.pdf, 12 pages, 1.4 megabytes, 1 copy, one side, all pages. Ready." Progress is spoken in 10% steps. "X is ready" is announced politely, failures assertively, one at a time.

### Zoom and small screens
- ✅ 200% zoom and 360 px wide: no sideways scroll; the file name shows its start and its extension; settings and status lines wrap; the trash button stays top-right; the Continue bar stays reachable.

## Several files — settings

Needs: the multi-file list (max files above 1). Use fictional files: Poster.jpg (1 page, image) and Report-Final.pdf (40 pages). Ordering is covered in "Several files — review and order"; here check only the settings.

### The "Same settings for all files" card
- ✅ With 1 file the page looks exactly as before (inline options, no card, no Edit). Add a second file → the card appears under "Add another file", switch ON, with Copies, Sides and the line "Page range is set for each file. Tap Edit on a file."
- ✅ Set 2 copies and "Both sides" in the card → both rows read "2 copies · Both sides · All pages". Add a third file → it starts at 2 copies, both sides.
- ✅ Pick notes.docx, a.pdf and b.pdf together (the Word file is refused and is the first row) → the card shows and works: + / − and Sides change a.pdf and b.pdf. ❌ expected: the card buttons doing nothing.
- ✅ A file that failed for good (for example a damaged PDF, or "Please add this file again") never supplies the card's values, is not counted as one of "several files", and is not changed by the card.
- ✅ Admin lowers the max copies (for example 10 → 4) while files are at 6 copies → after the config reloads (reopen the Print page) the files read 4 copies.
- ✅ Switch OFF → card shows only "Settings are set for each file." Rows keep their values.
- ✅ Make Poster.jpg 5 copies (see below), then switch ON again → a dialog asks "Use the same settings for all files?" with the first file's values (e.g. "2 copies, both sides"). "Use same settings" applies them to every file; page ranges stay. "Keep separate", Escape or a tap outside closes it and the switch stays OFF. Focus returns to the switch.
- ✅ If all files already match, switching ON does not ask.
- ✅ The whole switch row is tappable (44 px). With the keyboard: Tab to the switch, Space or Enter toggles it.

### Edit and File settings
- ✅ Each ready row has "Edit" at the end of its settings line (screen reader: "Edit settings for Report-Final.pdf"). Tapping the row body does the same. Rows still uploading or failed have no Edit.
- ✅ Edit on Report-Final.pdf → the page shows that file only: title is the file name (long names keep the ".pdf"), a back button, the preview, Colour, Paper, Sides, Copies, Pages. No note or consent box. One column, no side panel.
- ✅ With the switch ON, Sides and Copies are greyed, still readable, with "Using the same settings as all files." and "Change for this file". Pressing the greyed buttons does nothing.
- ✅ Choose Custom, type 3-12 → back → the row reads "2 copies · Both sides · Pages 3-12"; Poster.jpg still reads "All pages".
- ✅ Poster.jpg → Edit: there is no Pages section (1-page file).
- ✅ With one 1-page file, choose Custom in the inline Pages and leave it blank (or type "2"), then add a second file → the 1-page row reads "All pages" with "Edit" (no "Fix pages"), a price shows and Continue works. Same when the 1-page file is added second and finishes uploading after the other one. ❌ expected: "Fix pages" on a file whose File settings has no Pages section (only way out was Remove).
- ✅ Poster.jpg → Edit → "Change for this file" → switch goes OFF, Sides and Copies become editable (focus moves to Copies). Set 5 copies → back: Poster 5 copies, Report 2 copies. Nothing else moved.
- ✅ Browser Back (or the phone's back gesture) inside File settings closes it and shows the list; you stay on the Print page and the files are still there. A second Back leaves the page, as before.
- ✅ Focus lands on the file name heading when File settings opens, and on that row's Edit button when it closes.
- ✅ The file's preview link is renewed in the background. If the server says that file is gone, File settings closes with "Your file is no longer available. Please upload it again.", that row turns Failed "Please add this file again" with Remove only (no Retry), and the other files stay in the list.

### Wrong page range
- ✅ In File settings of Report-Final.pdf choose Custom and type 3-90 → red text under the field "Enter pages like 1-3, 7. This file has 40 pages." (read out politely, not a harsh alert). Back → the row shows the same message and the action says "Fix pages" (screen reader: "Fix pages for Report-Final.pdf").
- ✅ Choose Custom and leave it blank → the row's settings line says "Pages: not set", the row shows "Enter the pages to print." and the action says "Fix pages". The File settings field itself shows no red text while blank.
- ✅ While any range is wrong or blank, Continue is disabled. Fix it → Continue goes back to its normal state.
- ❌ expected: Continue enabled with a wrong range, or the error missing on the row.

### Order price requests (logic only; price rows are not on screen yet)
Needs: backend with the order quote form (`haper-backend/docs/reference/print-order-quote.md`). Watch DevTools → Network → `quote`.
- ✅ With 2+ ready files, one `POST /user/print/quote` with body `{ "jobs": [...] }` fires about 0.4 s after the last change: ready files only, in list order, `pageRange` left out for "All pages". Tapping Copies + five times quickly sends one request, not five.
- ✅ A file still uploading is not in `jobs`; when it becomes ready, one new request includes it. Removing a file sends one new request without it.
- ✅ Two changes within 0.4 s send one request, for the final settings. A change while a request is in flight cancels that request (shown as "(canceled)"); only the newest answer is used.
- ✅ A wrong or blank page range on any ready file stops requests until it is fixed.
- ✅ With exactly 1 file, the old single-file request (`{ "jobId": ... }`) is used, as before; no `jobs` request.
- ✅ If the quote says a file is gone (404 `NOT_FOUND`, 409 `JOB_UNAVAILABLE` / `JOB_EXPIRING` / `JOB_OTHER_STORE`), that row turns Failed "Please add this file again" with Remove only and a new request goes out without it. Its server copy is removed: one `DELETE /user/print/jobs/<id>` for that file (a 404 reply is fine).
- ✅ If the quote says a file is already in an order (`JOB_ALREADY_ORDERED`), the banner shows and that row shows the same message; the row is NOT turned into "Please add this file again" and no `DELETE` is sent for it.
- ❌ expected: a request per keystroke, a `jobs` request with one file, or a request while a page range is wrong.

### Small screens and zoom
- ✅ 360 px wide and 200% zoom: in the card Copies and Sides sit one under the other; Edit wraps to its own line if the settings text is long; nothing scrolls sideways.

### Keyboard only
- ✅ Tab order in the list: rows (Edit, Remove), Add row, the switch, Copies − / +, Sides, Continue. Every control shows a focus ring.
- ✅ In File settings: back button, (Change for this file), Sides, Copies, Pages, range field. The back button returns to the same row's Edit.
- ✅ The dialog traps focus, starts on "Keep separate", and closes with Escape.

## Several files — prices
Needs: the backend with the order quote form. This section checks what the prices look like; ordering is in "Several files — review and order".
- ✅ Each ready file row shows its own price on the right (bold, e.g. "₹6"). A row that is still uploading, waiting or failed shows no price.
- ✅ Three files priced 6 / 30 / 2 with delivery 20: the summary lists the three files, "Delivery charge ₹20", a line "Includes GST (18%)" with no amount, and "Total ₹58". There is no "Minimum order top-up" row. The sticky bar says "Total ₹58" and "3 files · N pages".
- ✅ Two tiny files (₹2 and ₹4): a "Minimum order top-up" row appears with "Minimum print order is ₹20." under it.
- ✅ Delivery is charged once, not once per file.
- ✅ With more than 3 files the summary shows one row "Printing (46 pages, 4 files)" and a "Show details" button. Pressing it lists the files indented under that row and the button says "Hide details".
- ✅ Change copies: prices turn into small grey bars and the summary dims for a moment, then the new prices appear. The old total is never shown next to the new settings.
- ✅ Type a wrong page range (for example 3-90 on a 40-page file): the summary and the sticky total disappear until it is fixed.
- ✅ A file that failed or was marked "Please add this file again" with a leftover wrong range does not block anything and does not say "Fix pages".
- ✅ Remove a file: the summary and total update to the remaining files.
- ✅ Order too big (many files with many copies, over the pages limit): a rose banner above the list says "This order is too big to print at once (limit 500 pages including copies). Reduce copies or remove a file."
- ✅ Quote failure (switch the network off in DevTools, then change copies): the sticky bar says "Couldn't update the price." with a Retry button. Retry sends the request again.
- ✅ A row whose file is gone shows "Please add this file again" with Remove only: no Retry and no price.
- ✅ Screen reader: a row reads its price as "24 rupees"; the new total is read once after each new quote ("Total 58 rupees, 3 files · 22 pages"), not while typing.
- ✅ Continue is enabled with 2 or more ready files only once the new total shows (disabled while prices are loading).
- ✅ With 2 or more files, "Note to store (optional)" shows under the price summary (same box and 140-character limit as the single-file page). Type "please staple" → Review → Place order: the request has `deliveryInstructions: "please staple"`. Back to the list keeps the note.
- ❌ expected: an old total beside new settings, GST amount shown as a line item, delivery repeated, or the summary visible with a wrong page range.
- Single-file page: price block and bar look exactly as before.

## Several files — review and order
Needs: this web build, the backend with the order quote form (`haper-backend/docs/reference/print-order-quote.md`), a store with print ON, COD ON with max Rs 300. Fictional files: Invoice-March.pdf (12 pages), Poster.jpg (1 page), Report-Final.pdf (40 pages), Notes-Ravi-Sharma.pdf. Watch DevTools → Network.

### Happy path
- ✅ 3 ready files, consent ticked, total shown → "Continue" → "Review order" opens. "Files (3)" with "Edit files"; each file shows its name, pages, its own price and its settings line ("1 copy · One side · All pages"). Price details list the three files, ONE "Delivery charge" and "Total". The pay bar reads the existing "Pay ₹N" with N from the total.
- ✅ "Place order" → ONE `POST /user/print/order` with `jobs` = the 3 files in list order (copies, sides, `pageRange` null for all pages), `expectedTotal` = the total on screen, `configVersion` from the quote. Pay → ONE order with 3 files. The Print page is empty afterwards (files are not deleted on the server: the order owns them).
- ✅ Double-click "Place order" → one request, one order (button shows the spinner while the request runs).
- ✅ Review → "Edit files" (or Back) → Print page with everything kept (files, settings, consent) → Continue → Review again.

### Some files failed
- ✅ 3 files, Notes-Ravi-Sharma.pdf failed → button "Continue with 2 files" → sheet "1 file won't be printed", lists "Notes-Ravi-Sharma.pdf", "You can still place the order with the other 2 files.", buttons "Go back" / "Continue without it".
- ✅ "Go back" (or Escape, or a click outside) → all three rows still there, focus back on the button.
- ✅ "Continue without it" → the failed row is removed, a new `jobs` quote for the 2 files fires, then Review opens with "Files (2)".
- ✅ Two failed → "2 files won't be printed" / "Continue without them".
- ✅ 2 files, 1 failed → "Continue with 1 file" → sheet → "Continue without it" → the single-file Review ("Review & pay") opens with that one file and its own price (single `{ jobId }` quote); no old multi-file total anywhere.
- ❌ expected: a failed file silently left out without the sheet.

### Guards
- ✅ Change copies after the total showed → the total turns to a grey bar and Continue is disabled until the new total shows.
- ✅ Type `#/print/review` in the address bar while a file is still uploading → back on the Print page. Same with a failed file not yet confirmed, consent unticked, or prices still loading.
- ✅ Reload on Review with several files → back on the Print page (files are not kept across a reload in this build).

### Cash on delivery limit
- ✅ Total ₹280 (cap ₹300) → Payment choice shown; "You can pay online or in cash to the rider."
- ✅ Total exactly ₹300 → cash still offered.
- ✅ Total ₹340 → no cash choice; note reads "Cash on delivery is available up to ₹300. This order is ₹340. Remove a file or pay online." with an "Edit files" button (back to the list, everything kept). A screen reader announces the note.
- ✅ Cash chosen, then the total goes over ₹300 (price changed) → choice goes back to Pay online and the note above shows.
- ✅ Server refuses cash (`COD_LIMIT` / `COD_NOT_ELIGIBLE` / `COD_OPEN_LIMIT`) → server message in the red banner, Pay online selected; `COD_OFF` → "Cash on delivery isn't available right now. Please pay online."
- ✅ Print switched off for the store while on Review (admin turns print OFF, then Place order → 403) → "Printing isn't available…" screen, never a blank white page. With the network off when the config reloads → Review stays as it was (the last good settings are kept), with the files and total. ❌ expected: a blank page.

### Order-time problems
- ✅ Prices changed at order time (admin edits print rates between Review and Place order) → amber "The price changed from ₹58 to ₹61…", button "Accept new price ₹61"; file prices and total show the new numbers. Accept → tap "Place order" again → order at ₹61. Nothing is ordered without the second tap.
- ✅ Same, but tap "Back" instead of Accept → the list fires ONE new `jobs` quote and shows the new total (never the old ₹58).
- ✅ A file expired or became unavailable (wait for expiry, or delete one draft on dev) → red banner with the server message and "Back to files". Back → ONE new `jobs` quote; that file's row says "Please add this file again" with Remove only; the others keep their prices. No repeated requests.
- ✅ A file already in another order (`JOB_ALREADY_ORDERED` with an order id) → banner with the server message, "Back to files" and "Open that order" (opens it; the list is kept).
- ❌ expected: an order with files that were not priced, a retry storm, or a total on screen different from `expectedTotal` in the request.

### Single file
- ✅ Single-file mode and a list with exactly one file: Print page, "Review & pay" and the order request (`jobs` with one entry) behave exactly as before.

## Several files — order placed and order detail
- ✅ A one-file order (Invoice-March.pdf, 12 pages) looks exactly as before on Order detail: same file block, no "Your files" header, no chip, no "Show all".
- ✅ A 3-file order (Invoice-March.pdf 12 pages, Notes-Ravi-Sharma.pdf 30 pages, Menu.pdf 4 pages) → Order detail shows "Your files" with all three and the chip "3 files · 46 pages"; each row has name, pages and "1 copy · One side · All pages", with NO per-file amount (a 1-page file must never show ₹10 because the minimum top-up was folded into it). The order total and bill details still show the real amounts.
- ✅ Pay online with 3 files → the order-placed screen shows "3 files · 46 pages" under the order number and lists the three files (no amounts). The wording and buttons are otherwise unchanged.
- ✅ Pay in cash → Order detail opens and still says "Pay ₹93 to the rider when it arrives." above the list.
- ✅ A 5-file order → only 3 rows, button "Show all 5 files"; press it → 5 rows, button reads "Show less"; press again → back to 3.
- ✅ A file with pages 3-12 and 2 copies on both sides → "2 copies · Both sides · Pages 3-12". A 1-page file → "1 page".
- ✅ After printing, a 3-file order shows "Document 1", "Document 2", "Document 3"; a one-file printed order still shows "Document".
- ✅ Timeline, cancel/payment buttons, bill details and "File deleted for your privacy." are unchanged.
- ✅ Keyboard only: Tab reaches "Show all" with a visible ring; Enter/Space toggles it; screen reader says "expanded"/"collapsed" and reads each row as "Invoice-March.pdf, 12 pages, 1 copy, one side, all pages".
- ✅ Browser zoom 200% (and a 320 px wide window): rows wrap, the file extension stays visible, nothing scrolls sideways, "Show all" stays tappable.
- ❌ expected: a list on a one-file order, a number shown that is not the order's own, or a name like "undefined" on an old order (should read "Print job").
- ✅ Pay online with 3 files, log out, log in as someone else in the same tab, press Back → the order-placed page shows no file list and no "N files · M pages" line (the rest of the page is as for any order). Pressing Back as the same user still shows the list.
- ❌ expected: the previous user's file names or page counts visible to the next person.

## Several files — settings card, other tab, logout
- ✅ Add two files that are both refused (for example wrong type) → no "Same settings for all files" card is shown; add one good file again → the card returns.
- ✅ A 1-page file whose custom page range was wrong never shows "Fix pages", not even for a moment after it finishes uploading.
- ✅ With files still waiting to upload in tab 1 (go offline, add 3 files, go online), log out in tab 2 and log in as another user there → tab 1 uploads nothing more (check the network panel: no new upload requests) and its list clears; the new user's account has no stray draft.
- ✅ Same setup, but press "Pay" on the review page in tab 1 after the switch → no order is sent, the page goes back to the print screen with an empty list.
- ✅ Log out with files uploaded → the page does not bounce to the login screen a second time a few seconds later (no extra delete request without a token).
- ✅ One file, the server says the file is no longer available (JOB_ message other than "already ordered") → same "upload it again" screen as before; the file is removed from the server.
- ❌ expected: any upload, price request or order sent under the other user's login from tab 1.
