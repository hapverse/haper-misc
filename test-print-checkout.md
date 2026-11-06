# Test guide: Print on demand, checkout + payment (backend step 2a)

Needs: backend deploy only (user API + shared). Store `config.print.enabled = true`. Upload a file first (see `test-print-upload.md`).
All calls need `Authorization` and `x-store-id`. Example prices use the defaults: Rs 2/side single, Rs 1.50/side double, minimum Rs 20, delivery Rs 20.

Request: `POST /user/print/order`
`{ jobs: [{ jobId, copies, sides: "SINGLE"|"DOUBLE", pageRange }], addressId, paymentMethod: "RAZORPAY"|"WALLET"|"COD", redeemWallet, expectedTotal, configVersion }`
`expectedTotal` = the `total` the customer saw on the quote (printing + delivery, before wallet).

1. 3-page PDF, 2 copies, single, `expectedTotal: 40` -> 200, order `orderType: "print"`, status PAYMENT_INITIATED, `rzpOrder.id` present, Razorpay amount Rs 40 (6 sides = Rs 12, raised to the Rs 20 minimum, + Rs 20 delivery). ✅
2. Pay in the Razorpay sheet -> order becomes OPEN (webhook or `/user/razorpay/order/:id/verify`), shows in the admin Print Queue, NO pick task even on a picking store. ✅
3. Same request twice (double tap / second tab) -> one order; the other gets 409 `reason: JOB_ALREADY_ORDERED` with `data.orderId` of the first. ✅/❌
4. `expectedTotal` lower than the real price -> 409 `PRICE_CHANGED` with the real quote; nothing charged. ❌ expected
5. Admin changes the print price between quote and pay -> 409 `PRICE_CHANGED` with the new quote; resend with the new total -> 200. ✅/❌
6. Any extra key (`price`, `amount`, ...) -> 400. `copies` 0 / negative / decimal / over the store max -> 400. ❌ expected
7. `paymentMethod: "COD"` on a store with COD OFF (the default) -> 400 "Cash on delivery is not available for prints" with `errorType: "PRINT_CHECKOUT", reason: "COD_OFF"` (apps match on this reason only; other 400s such as address no longer available, out-of-area or validation carry NO `reason`). ❌ expected. With COD ON and an eligible customer -> 200, order placed (see "Cash on delivery" below). ✅
8. Another customer's `jobId` -> 404; another customer's `addressId` -> 400. ❌ expected
9. Wallet covers everything (`paymentMethod: "WALLET"`, `redeemWallet: true`) -> order OPEN immediately, wallet reduced by the total, store gets a "New print order" push. ✅
10. Partial wallet on a total with paise (e.g. Rs 42.50, wallet Rs 100) -> wallet takes Rs 41, Razorpay charges Rs 1.50 (Razorpay can't charge under Rs 1). ✅
11. Don't pay for 15 minutes -> cron cancels (PAYMENT_CANCELLED), wallet coins come back, the file returns to UPLOADED and can be ordered again. ✅
12. Cancel the unpaid order from the app -> same release as 11. ✅
13. Pay AFTER the order was auto-cancelled -> money goes to the wallet, the order stays cancelled, the file is not re-attached. ✅
14. Paid order cancelled within 60 seconds -> full refund (online + wallet) to the wallet. ✅
15. File within 20 minutes of its 24-hour deletion -> 409 `JOB_EXPIRING`. ❌ expected
16. Invoice line reads "B&W print · 6 sides" (no file name); profit uses cost Rs 0.80 x sides. ✅

Admin Reject (step 2b) cancels through the normal admin cancel (ADMIN_CANCELED) and refunds captured + wallet money to the wallet.

## Cash on delivery (COD) for print, per store
Needs: backend deploy only (user + admin API + shared). COD is OFF on every store until a super admin turns it on in
`PUT /admin/print/config/:storeId` (`codEnabled`, `codMaxOrderAmount` default Rs 300 on the order total, `codMinDeliveredOrders`
default 1 = the customer needs 1 earlier home-delivered (CLOSED) order of any kind at any store; counter (POS) sales in a
shop do NOT count; 0 = anyone). No COD fee. Fixed rules (not settings): at most 1 COD print order in progress per customer,
and no COD for 90 days after one of their COD print orders was refused at the door (UN_DELIVERED).
Example below: limit Rs 300, min 1, the 3-page x 2-copy order (total Rs 40).

`GET /user/print/config` now also returns `codAvailable` (true/false), `codMaxOrderAmount` (number, or null when COD is not
available) and `codUnavailableReason` (null | "COD_OFF" | "COD_NOT_ELIGIBLE"; refused-before also shows as "COD_NOT_ELIGIBLE"). The limit is not applied here (no total yet):
the app shows "Cash on delivery" only when `codAvailable === true` and its quote total <= `codMaxOrderAmount`.

C1. Store COD OFF -> config `codAvailable: false, codMaxOrderAmount: null, codUnavailableReason: "COD_OFF"`; a COD order -> step 7's 400 (`reason: COD_OFF`), no order, wallet untouched, file still UPLOADED. ❌ expected
C2. COD ON, customer with no delivered order -> config `codUnavailableReason: "COD_NOT_ELIGIBLE"`; a forced COD order -> 409 `reason: COD_NOT_ELIGIBLE` "Cash on delivery opens up after your first delivered order. Please pay online." Nothing written. ❌ expected
C3. Same customer after one grocery order is delivered (CLOSED) -> config `codAvailable: true, codMaxOrderAmount: 300`. ✅
C4. COD order, total Rs 40 -> 200, order `paymentMethod: 0` (COD), `status: 0` (OPEN), `price: 40`, `rzpOrder: null`, no Razorpay sheet, no payment timer. It shows at once in Admin > Print > To print with a Cash badge; store push "Cash ₹40 to collect · 1 file(s)". ✅
C5. Coins + cash: wallet Rs 15, `redeemWallet: true`, COD -> coins debited (Rs 15), `price: 25` = cash the rider collects, method COD. Wallet covering the whole total -> stored as a WALLET order (same as grocery). Because no cash is at risk, this works even when the COD limit, eligibility, open-order or refused-before rule would refuse cash (e.g. limit Rs 30, total Rs 40, coins Rs 100 -> 200, WALLET order, Rs 40 coins taken). Without `redeemWallet` those rules still apply. ✅
C6. Order total above the limit (e.g. limit Rs 39.50, total Rs 40) -> 409 `reason: COD_LIMIT`, `data.codMaxOrderAmount: 39.5`, "…up to ₹39.50. Please pay online." No coins taken, file still UPLOADED. ❌ expected
C7. Limit is on the total, not the cash part: limit Rs 30, total Rs 40, coins Rs 20 (cash would be Rs 20) -> still 409 `COD_LIMIT`. ❌ expected
C8. Total exactly at the limit (Rs 40 with limit Rs 40) -> 200. ✅
C9. Min delivered orders 2, customer has 1 -> 409 "…after 2 delivered orders…". Cancelled or still-in-delivery orders and other customers' orders never count. ❌ expected
C9a. POS exclusion: customer whose only CLOSED order is a counter sale (admin POS, `channel: "pos"`) -> 409 `COD_NOT_ELIGIBLE` (a Rs 10 shop purchase is not a delivery). After one home-delivered order -> 200. ❌ expected / ✅
C10. Min 0 -> a brand-new customer can place COD. ✅
C11. Admin turns COD OFF while the customer is on the review screen -> their COD submit gets the 400 `reason: COD_OFF` straight away (even with the old `configVersion`); paying online works (after a `PRICE_CHANGED` 409 if the app sends the old `configVersion`, because every settings save bumps it). Admin turns COD ON mid-checkout -> first submit 409 `PRICE_CHANGED` (same total), resend with the new version -> 200. ✅/❌
C12. `STORE_PICKUP_PREPAID` / `STORE_PICKUP_POSTPAID` -> still 400 on a COD store. Razorpay and WALLET orders on a COD store behave exactly as before. ❌ expected / ✅
C13. Eligibility or refused-before check fails (DB hiccup) -> config `codAvailable: false` (`COD_NOT_ELIGIBLE`), checkout 409 `COD_NOT_ELIGIBLE` with the neutral text "Cash on delivery isn't available right now. Please pay online." (not "opens up after your first delivered order", the customer may be eligible); never places a COD order it could not check. ❌ expected
C14. After the order: rider sees "Cash on delivery" with the amount to collect (`price`); on delivery it joins the rider's cash to settle and admin cash reconciliation; profit counts on the delivery day; invoice label "COD". Refused at the door -> UN_DELIVERED, no cash owed, coins (if any) back. ✅
C15. Customer cancel within 60 s, or staff Reject -> cancelled, only coins (if any) returned; nothing else to refund. Example: Rs 15 coins + Rs 25 cash, cancel -> `refundedAmount: 15`, wallet +15, then a new COD order is allowed again. Staff Reject push: "You have not been charged." (no coins) / "Your wallet coins have been returned." (coins); prepaid keeps "Any payment is being refunded." ✅
C16. Open-order cap: customer has a COD print order still OPEN, PACKED, ASSIGNED, PROCESSING or OUT_FOR_DELIVERY -> a second COD print order (any file) -> 409:
`{ code: 409, error: "Conflict", errorType: "PRINT_CHECKOUT", reason: "COD_OPEN_LIMIT", message: "You already have a cash-on-delivery print order in progress. Please pay online for this one.", data: { codMaxOrderAmount: 300 } }`.
No coins taken, file still UPLOADED, no store push; paying online for the same file works. Once the first order is delivered, cancelled or rejected -> COD works again. Prepaid (Razorpay/WALLET) print orders and grocery orders never count. The config call does NOT advertise this (checkout only), so the app maps this 409 to "pay online". ❌ expected / ✅
C17. Double tap / two devices: two COD orders sent at the same moment with different files -> exactly one order, coins taken once, the other gets the C16 409. ❌ expected
C18. Refused before: customer's COD print order was marked UN_DELIVERED (refused/not home) in the last 90 days -> config `codUnavailableReason: "COD_NOT_ELIGIBLE"`; checkout 409 `COD_NOT_ELIGIBLE` "Cash on delivery isn't available because an earlier cash print order could not be delivered. Please pay online." Online works. Older than 90 days, a refused grocery COD order or a refused prepaid print order -> no block. ❌ expected / ✅

## Hardening checks (prepaid-only, no cost leak, account deletion)
Needs: backend deploy only (user + admin API).

17. `POST /user/print/quote` response, `POST /user/print/order` (200 and 409 `PRICE_CHANGED`), `GET /user/print/jobs/:id` and the order GET/list -> no `costPerSide`, `costAmount`, `frozen` or item `costPrice` anywhere. `configVersion` is still present. ✅
18. Admin `POST /admin/order/:id/convert-to-cod` on a print order (unpaid or cancelled) -> 400 `PRINT_PREPAID_ONLY`; payment method and status unchanged (still true with print COD: customers choose COD at checkout, staff cannot convert). ❌ expected
19. Admin `PATCH /admin/order/edit-order/:id` on a print order -> 400 "Print orders cannot be edited". ❌ expected
20. Admin `PATCH /admin/order/mark-status-admin` `{ status: "OPEN" }` on a cancelled print order (reopen) -> 400 "Print orders cannot be reopened". ❌ expected
21. Customer with uploaded files deletes the account (OTP confirm) -> account soft-deleted and every LIVE print file gets `purgeAfter` = now, so the next purge run removes it from S3 (not 30 days later). If the expiry step fails, deletion still succeeds (logged); the account-purge cron is the backstop. ✅
22. Customer order list / history / detail / cancel response for a print order carries `print` (grocery orders have no `print` key). Example after staff downloaded the file but before Mark printed:
    `"print": { "stage": "PRINTING", "downloaded": true, "filesPurged": false, "rejectReason": null, "rejectCode": null }`
    - Paid, not downloaded -> `stage: "QUEUED"`. All files printed -> `stage: "PRINTED"`. File deleted after delivery -> `filesPurged: true`.
    - Rejected -> `stage: null`, `rejectReason: "Pages are blurred"`, `rejectCode: "UNREADABLE"` (UNREADABLE | PROHIBITED_CONTENT | OTHER).
    - No storage keys, hash, cost or staff id inside `print`. ✅
23. Store config with a per-side price of 0 (set directly in the DB) -> the quote uses the default price instead, total is never Rs 0; a total of Rs 0 can never become a free WALLET order. ✅

## Order-level quote for several files + per-order limits in config
Needs: backend deploy only (user API). Old apps keep sending `{ jobId, ... }` and see no change.

Q1. `POST /user/print/quote` with `{ jobId, copies: 2 }` (3-page file) -> exactly as before: `data: { jobId, pageCount, pageRange, copies, quote }`, quote has no `lines`, total 40. ✅
Q2. `{ jobs: [{ jobId, copies, sides, pageRange }] }` (1 to 10 files) -> 200, `data: { quote }` with one `lines[]` entry per file in request order, each carrying `jobId` and `subtotal` (that file's real printing price). Top-level `printSubtotal`, `minimumTopUp`, `printAmount`, `deliveryCharge` (once), `total`. ✅
Q3. Two tiny files (1 page + 2 pages, single, 1 copy, Rs 2/side): subtotals Rs 2 and Rs 4, `minimumTopUp` Rs 14, `printAmount` 20, delivery 20, total 40. Lines' `amount` is 16 / 4 (top-up folded into the first line, same as the stored order) — apps show `subtotal` per file and `minimumTopUp` as its own row. ✅
Q4. 11 files, a repeated `jobId`, both `jobId` and `jobs`, `jobs: []`, or `copies` next to `jobs` -> 400 `reason: INVALID_REQUEST`. Empty body -> 400 `"jobId" is required` (unchanged). ❌ expected
Q5. Another customer's file in `jobs` -> 404 `reason: NOT_FOUND`, `jobId` of that file; identical to a made-up id. ❌ expected
Q6. File from another store -> 409 `JOB_OTHER_STORE`; rejected/purged file -> 409 `JOB_UNAVAILABLE`; file expiring within the payment window -> 409 `JOB_EXPIRING`; file already in an order -> 409 `JOB_ALREADY_ORDERED`. Every one carries the failing `jobId`. `orderId` appears ONLY on `JOB_ALREADY_ORDERED`, and only when all the already-ordered files are in one order (files spread over two orders -> no `orderId`). A file from another store that is also attached to an order -> `JOB_OTHER_STORE` with no `orderId`. ❌ expected
Q7. Two 200-page files x 2 copies (800 sides) -> 400 "An order can have at most 500 printed sides", same message as placing the order, and NO `jobId` (it is the whole order, not one file). ❌ expected
Q7b. Three 3-page files, the 2nd with `pageRange: "2-9"` -> 400 `reason: INVALID_REQUEST`, message "Page 9 is beyond the last page (3)" (unchanged) plus `jobId` of the 2nd file so the app can mark that row. Same for bad copies or too many pages on one file. Placing that order -> same 400 and message, body unchanged (no `jobId`, no `errorType`). ❌ expected
Q8. Place the order right after the quote with `expectedTotal = quote.total` -> 200, no `PRICE_CHANGED`; order lines match the quote lines. ✅
Q9. `GET /user/print/config` -> also `maxFilesPerOrder: 10` and `maxPrintedSidesPerOrder` (store setting, default 500; admin change to 300 shows 300). ✅
