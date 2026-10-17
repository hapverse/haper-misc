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
28. Continue -> Review shows address (default selected, Change goes to /addresses), file summary (Edit returns with options intact), Price details with delivery charge and total (GST shown as "Includes GST"), notice "Your file is deleted 24 hours after delivery.", "Payment is online only for print orders." No COD row. ✅
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
40. Line shows file name, pages, copies, sides, "B&W A4" and the printing amount; bill shows Printing, Print delivery charge, Wallet, Paid online. No cost price anywhere. ✅
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
