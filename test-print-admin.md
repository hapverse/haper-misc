# Test guide: Print on demand, admin Print Queue + file purge (backend step 2b)

Needs: backend deploy (admin API + cron). Cron needs `PRINT_S3_BUCKET` (private bucket, versioning OFF). Admin needs `PRINT_S3_BUCKET` too for downloads. Store `config.print.enabled = true` for the customer side.
Admin calls use `Authorization` (+ `x-store-id` for a super admin acting inside one store). Paths are under `/admin/print`.
Existing managers do NOT get the new permissions automatically: tick Print (view + manage) on the Team page. Store admins and super admins have them already.
Who can do what: Print routes are for super_admin, store_admin and manager only. Support has NO print access, even if print permissions are ticked. Reject also needs `orders.change_status` (it cancels and refunds the order).
S3 lifecycle backstop: on the print bucket, prefix `print/`, expire current objects after **15 days** (just over the 14-day ceiling the app keeps an ordered file), plus abort incomplete multipart uploads after 1 day. The app's own purge normally deletes files after 24h; the lifecycle rule only catches what the app misses.

1. Paid print order (OPEN) -> `GET /queue?tab=to_print` shows it for that store's admin only; the other store's admin sees nothing. ✅
2. Super admin sees all stores; `?storeId=<other store>` as a store admin -> 403. ✅/❌
3. `POST /job/:id/download` -> `url` that works for 5 minutes (`expiresInSeconds: 300`); open it, the PDF prints at A4. After 5 minutes the link stops working. ✅
4. Download again -> `downloadCount` 2 on the job; Admin Audit shows two `print.job.download` rows; Order Activity shows `print.downloaded`. ✅
5. Download for a job from another store -> 404. File already purged -> 410. Unpaid order -> 409. ❌ expected
6. `POST /job/:id/printed` -> job PRINTED, order PACKED; then assign a rider (picking store and non-picking store) -> order ASSIGNED. ✅
6a. Assign a rider (Orders page or reassign) to a print order that is still OPEN (not printed), on a store with picking OFF and with picking ON -> 400 `PRINT_NOT_PRINTED` "Mark it printed before assigning a rider"; order stays OPEN. ❌ expected
6b. Orders page "change status" (`PATCH /admin/order/mark-status-admin`) on a print order that is still OPEN, to Assigned / Processing / Out for delivery / Delivered (CLOSED) / Undelivered / Refund success -> 400 `PRINT_NOT_PRINTED`; order stays OPEN. Cancel (ADMIN_CANCELED) still works. After Mark printed (PACKED) every later status works as for a grocery order. ❌ expected (OPEN) / ✅ (PACKED)
7. Click Mark printed twice quickly -> both 200, one says `alreadyPrinted: true`, order stays PACKED. ✅
8. `POST /job/:id/reject {reason, code}` -> order ADMIN_CANCELED, full refund to the customer's wallet (once, even on a double click), customer gets a push with the reason, job REJECTED. ✅
8a. Double-click Reject: the one response with `alreadyRejected: false` and the single `print.rejected` row in Order Activity both show the full refund amount (never 0), whichever click did the refund. ✅
9. Reject without a reason (or under 3 characters) -> 400. Reject a printed job -> 409. Reject an order the customer already cancelled -> 409. ❌ expected
9a. Cancel a print order from the normal Orders page, then Reject its job in the Print Queue -> 409 "already cancelled"; the customer gets NO "print rejected" push. ❌ expected
9b. Manager with Print view + manage but WITHOUT Orders > change status: Reject -> 403 (`requiredPermission: orders.change_status`), no refund. Tick change status -> Reject works. ✅/❌
9c. Support user (even with Print permissions ticked): Print Queue API -> 403. ❌ expected
10. `GET /config/:storeId` as store admin (own store) -> config with `canEdit: false`. `PUT` as store admin -> 403. ✅/❌
11. `PUT /config/:storeId` as super admin `{ pricePerSideSingle: 2.5 }` -> `configVersion` goes up by 1; same values again -> "No changes", no bump. Negative, 3 decimals, over the cap, unknown keys, empty body -> 400. ✅/❌
11a. `PUT { enabled: true, pricePerSideSingle: 0 }` -> 400 "Set both per-side prices above ₹0". With printing ON, `PUT { pricePerSideDouble: 0 }` -> 400. With printing OFF a zero price saves. A zero price already stored in the DB is read as the default price, so an order total is never ₹0. ❌ expected
12. Purge cron (hourly at :40): a never-ordered upload older than 24h is deleted from the bucket and the job shows `filesState: PURGED`. A delivered order's file goes 24h after delivery; a cancelled/rejected one 24h after the cancel. An order still OPEN keeps its file. UN_DELIVERED keeps it up to 14 days. ✅
13. Make S3 fail (wrong bucket policy on dev): rows stay `PURGING` with `purgeLastError`; after 3 tries the cron log shows an error line; fix S3 and the next run finishes them. ✅/❌
14. Run the cron twice in a row -> the second run deletes nothing. ✅
15. Account anonymised by `account-purge` (runs once the account's recovery window after soft delete has passed): that user's live files become due and the next purge run removes them; every print job of the user shows file name `document` and no hash, and the user's print order lines show file name `document`. ✅
16. After a file is purged: the job's file name becomes `document` and its hash is cleared; the order line's file name becomes `document` (customer screens show the real name only until then). ✅
17. Cron env WITHOUT `PRINT_S3_BUCKET`: every run logs `[print-file-purge] ERROR PRINT_S3_BUCKET is not set` at error level, nothing in the DB changes, and if live print files exist a `print.purge_bucket_unset` alert row is written (URGENT tier: arrives with the next urgent payment-alert mail, not the daily digest; one mail per hourly run while it stays unset). Files more than 24h past their purge time write `print.purge_overdue`. ❌ expected (alert) / ✅ (no DB change)
18. Rider app (`/delivery/order/...` list, detail, accept, mark-status) on a print order: no file name anywhere in the response; the print line shows its line name (e.g. "B&W print, 6 sides") instead of "Item". ✅
19. Admin Orders page / order detail / customer order history as support or as a manager without Print view: no print file name in the response (any `print` object, nested anywhere, loses `fileName` and `originalName`, even if `lineType` is missing). Manager with Print view, store admin, super admin: file name shown. ✅

Not in this step: auto-print.
Customer order responses (print checkout, list, history, detail, cancel) now carry `print` on print orders: `{ stage: "QUEUED"|"PRINTING"|"PRINTED"|null, downloaded, filesPurged, rejectReason, rejectCode }` (see test-print-checkout.md). Grocery orders have no `print` key.

---

## Admin UI walkthrough (haper-admin, Phase 2)

Deploy order: BACKEND FIRST (print admin API + permissions), then haper-admin. The admin UI alone shows load errors without the API.
Pages: sidebar "Print Queue" (`/print-queue`, under Sales & Orders) and the "Print service" card on Store Config (`/config#print-service`).
Test data: a paid print order (OPEN) for the store, example file `sample_notes.pdf`.

**Permissions**
1. Store admin and super admin see "Print Queue" in the sidebar. ✅
2. Manager with no print permission: no sidebar entry; typing `/print-queue` redirects to the dashboard. ✅/❌
3. Team page > edit a manager: a "Print Queue" row exists (View, Download / print / reject). "Apply manager preset" ticks both. Support preset does not. ✅
4. Manager with only Print > View: sees rows, but no Download / Mark printed / Reject buttons. ✅
5. Top-bar search: "print", "a4", "document" find Print Queue; "print price" finds the Print service card (Store Config). ✅

**Queue**
6. Tabs To print / Printed / In delivery / History; the active tab shows the count; pagination appears above 20 rows. ✅
7. Row shows order id, file name, pages, copies, sides, page range, size, paid time, "Waiting N min" (amber warning after 30 min), amount. ✅
8. Download opens the file in a new tab; the link is never shown on screen. Mark printed is disabled (tooltip "Download and print first") until one download; super admin is exempt. ✅
9. Download again after 5 min works (new link each click). File already purged -> inline "file was already deleted". ❌ expected
10. Mark printed -> confirm dialog -> job leaves "To print", order shows under "Printed" as Packed. Double click is safe. ✅
11. Reject -> pick type + message (min 3 chars, inline error) -> "Reject and refund" -> toast "Rejected. Refund started."; customer wallet refunded once. ✅
12. Two staff act on the same job: second gets toast "This job was already updated" and the list refreshes. ✅/❌
13. Auto-refresh every 30 s only while the tab is visible; new jobs get a 2 s outline. Switch the network off: a red strip "Couldn't refresh ... Showing the last loaded list" appears and rows stay. ✅
14. Loading shows 3 skeleton cards; empty "To print" shows "No print jobs waiting"; failed first load shows Retry. ✅
15. Screen reader / keyboard: tabs are `role=tab`, buttons name the file and order, dialogs trap focus, Esc closes. Tablet width (768 px): cards stack, buttons 44 px high. ✅

**Print service card (Store Config)**
16. Super admin with a store selected: card editable. Store admin / manager: inputs disabled with "Only a super admin can change prices.". Super admin on "All stores": "Select a specific store". ✅
17. Bad values blocked inline before save: price over 100, 3 decimals, minimum order over 10000, delivery charge over 1000, GST over 100, max pages over 200, max copies over 50, sides over 5000. ✅/❌
17b. SAC code shows as read-only text (998912) with note "Fixed: service code for printing"; no input to edit it, and Save never sends sacCode (check the PUT payload in the network tab). ✅
17c. API: PUT /admin/print/config/:storeId with `sacCode` returns 400 (not editable); GET still returns sacCode 998912 even if a store had another value stored. ✅
18. Turning the switch ON with a zero price -> "Set the prices first." and Save disabled. ✅
19. Save sends only changed fields; toast "Print settings saved". Two admins editing at once: second save shows the "changed by someone else" message with Reload; typed values stay until reload. ✅/❌
20. Prices changed here only affect new quotes; existing paid orders keep their price. ✅

Edge: a job whose file is PURGED shows "File deleted" and no Download. Old paid-but-rejected jobs appear under History with the reason.
Known gaps (need backend): the queue does not return the customer note, customer first name / masked phone, or the name of the admin who downloaded. Those spec items are not shown yet.
