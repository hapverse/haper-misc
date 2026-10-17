# Test guide: Print on demand, checkout + payment (backend step 2a)

Needs: backend deploy only (user API + shared). Store `config.print.enabled = true`. Upload a file first (see `test-print-upload.md`).
All calls need `Authorization` and `x-store-id`. Example prices use the defaults: Rs 2/side single, Rs 1.50/side double, minimum Rs 20, delivery Rs 20.

Request: `POST /user/print/order`
`{ jobs: [{ jobId, copies, sides: "SINGLE"|"DOUBLE", pageRange }], addressId, paymentMethod: "RAZORPAY"|"WALLET", redeemWallet, expectedTotal, configVersion }`
`expectedTotal` = the `total` the customer saw on the quote (printing + delivery, before wallet).

1. 3-page PDF, 2 copies, single, `expectedTotal: 40` -> 200, order `orderType: "print"`, status PAYMENT_INITIATED, `rzpOrder.id` present, Razorpay amount Rs 40 (6 sides = Rs 12, raised to the Rs 20 minimum, + Rs 20 delivery). ✅
2. Pay in the Razorpay sheet -> order becomes OPEN (webhook or `/user/razorpay/order/:id/verify`), shows in the admin Print Queue, NO pick task even on a picking store. ✅
3. Same request twice (double tap / second tab) -> one order; the other gets 409 `reason: JOB_ALREADY_ORDERED` with `data.orderId` of the first. ✅/❌
4. `expectedTotal` lower than the real price -> 409 `PRICE_CHANGED` with the real quote; nothing charged. ❌ expected
5. Admin changes the print price between quote and pay -> 409 `PRICE_CHANGED` with the new quote; resend with the new total -> 200. ✅/❌
6. Any extra key (`price`, `amount`, ...) -> 400. `copies` 0 / negative / decimal / over the store max -> 400. ❌ expected
7. `paymentMethod: "COD"` -> 400 "Cash on delivery is not available for prints". ❌ expected
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

## Hardening checks (prepaid-only, no cost leak, account deletion)
Needs: backend deploy only (user + admin API).

17. `POST /user/print/quote` response, `POST /user/print/order` (200 and 409 `PRICE_CHANGED`), `GET /user/print/jobs/:id` and the order GET/list -> no `costPerSide`, `costAmount`, `frozen` or item `costPrice` anywhere. `configVersion` is still present. ✅
18. Admin `POST /admin/order/:id/convert-to-cod` on a print order (unpaid or cancelled) -> 400 `PRINT_PREPAID_ONLY`; payment method and status unchanged. ❌ expected
19. Admin `PATCH /admin/order/edit-order/:id` on a print order -> 400 "Print orders cannot be edited". ❌ expected
20. Admin `PATCH /admin/order/mark-status-admin` `{ status: "OPEN" }` on a cancelled print order (reopen) -> 400 "Print orders cannot be reopened". ❌ expected
21. Customer with uploaded files deletes the account (OTP confirm) -> account soft-deleted and every LIVE print file gets `purgeAfter` = now, so the next purge run removes it from S3 (not 30 days later). If the expiry step fails, deletion still succeeds (logged); the account-purge cron is the backstop. ✅
22. Customer order list / history / detail / cancel response for a print order carries `print` (grocery orders have no `print` key). Example after staff downloaded the file but before Mark printed:
    `"print": { "stage": "PRINTING", "downloaded": true, "filesPurged": false, "rejectReason": null, "rejectCode": null }`
    - Paid, not downloaded -> `stage: "QUEUED"`. All files printed -> `stage: "PRINTED"`. File deleted after delivery -> `filesPurged: true`.
    - Rejected -> `stage: null`, `rejectReason: "Pages are blurred"`, `rejectCode: "UNREADABLE"` (UNREADABLE | PROHIBITED_CONTENT | OTHER).
    - No storage keys, hash, cost or staff id inside `print`. ✅
23. Store config with a per-side price of 0 (set directly in the DB) -> the quote uses the default price instead, total is never Rs 0; a total of Rs 0 can never become a free WALLET order. ✅
