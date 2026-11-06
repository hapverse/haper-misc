# Master test walkthrough: everything in this release (dev only)

Run this top to bottom on **dev** (`dapi.haper.in` user API, `damin.haper.in` admin API). Do not use prod.
This guide does not repeat the detailed steps. It tells you **what to run, in what order, and what to check across areas**. Each phase links the detailed guide (all in `haper-misc/`).

Legend: ✅ = must happen. ❌ = must be blocked / must not happen. Tick the box when done.
All names, phones and GSTINs are fictional. Examples used below:
- Retailer: Ravi Sharma, shop "Sharma Kirana", phone `9000000001`, GSTIN `22AAAAA0000A1Z5`
- Normal customer: Meena Devi, phone `9000000002`
- Store: "Sample Store" (GSTIN `22AAAAA0000A1Z5`)
- Items: "Sample Biscuit 50g" (barcode `8901000000017`), its pack "Sample Biscuit 50g Pack of 10"

---

## 1. What changed (plain summary)

1. **Retailer application.** A shop owner applies in the app (shop name, GSTIN, address, shop photo). Ops verifies it in Admin > Retailers (approve, reject with a reason, suspend, reinstate).
2. **Wholesale visibility.** Only an approved retailer, in a store with wholesale ON, sees wholesale packs. Everyone else (normal, pending, rejected, suspended, signed-out) sees nothing new.
3. **Size-group packs (same stock).** A pack such as "Pack of 10" has no stock of its own. It is 10 pieces of the normal item, taken from the same shelf.
4. **Wholesale checkout and COD gate.** A retailer can pay online, or pay cash on delivery only if a super admin turned COD on for that retailer. "Pay later" (credit) is not available.
5. **GST invoice.** Delivered retailer orders get a business (B2B) GST invoice with the shop's GSTIN and HSN.
6. **Exclusions.** Wholesale lines never get automatic discounts, coupons, free-gift credit or referral money, and a pack can never be a free gift or a banner target.
7. **Picker pack lines.** The picker app shows "= N pcs" on pack lines, handles scan-anything with singles and packs of the same barcode, loose pieces and short picks.
8. **Delivered-retailer-order lock and held refund.** A once-delivered retailer order cannot be cancelled, refunded or short-picked by store staff. If a rider later marks a reopened one Undelivered, the refund is **held** and recorded, not paid automatically.
9. **GSTIN block / unblock.** Rejecting with "GSTIN not owned" blocks that GSTIN for that account. Only a super admin can unblock it.
10. **Print cash on delivery (COD).** Per-store, off by default, limited by amount (default Rs 300), delivered-order history and one open COD print order.
11. **Invoice download hardening.** Invoices are streamed by the API (no public link, no redirect), private cache, per-store admin search capped at 50 rows. Retailer documents are never public.

---

## 2. Before you test

### 2.1 Deploy order (dev)
Follow `runbook-wholesale-rollout.md` for every AWS and server step. Do not copy commands from here. Order:

1. AWS bucket and IAM steps (shop documents blocked from the CDN, API can write `retailer/*`, invoice bucket rules).
2. **Pack index script BEFORE the backend deploy:** `node scripts/migrations/build-wholesale-indexes.js` (dry run), then `--apply`. Check it printed the DEV database name.
3. Backend deploy (user, admin, delivery, picking, cron) with all flags OFF.
4. Admin deploy.
5. Customer apps (Android, iOS, web) and rider app.
6. **Picker app build installed on EVERY picker device of the test store BEFORE `wholesaleEnabled` is turned on.** Old picker builds cannot verify a pack line.

- [ ] Index script ran on dev and says both pack indexes are OK.
- [ ] Backend boot log shows the two retailer-profile indexes were built (no "CRITICAL: index(es) missing").
- [ ] Picker build confirmed on all picker devices of "Sample Store".

### 2.2 Switches
| Switch | Where | Default | Used in |
|---|---|---|---|
| `RETAILER_APPLICATIONS_ENABLED` | env var on the **user API**; `true`, `1` or `on` = ON; restart with `--update-env` | OFF | Phase B onward |
| `wholesaleEnabled` | per store, Admin > Stores > Edit, super admin only. Needs batch tracking ON and a valid store GSTIN | OFF | Phase C onward |
| Retailer COD | per retailer, super admin, Admin > Retailers > detail | OFF | Phase E |
| Print COD (`codEnabled`, `codMaxOrderAmount`, `codMinDeliveredOrders`) | per store, Admin > Config > Print service, super admin | OFF / Rs 300 / 1 | Phase K |

Credit ("pay later") is **not** part of this release. Never turn it on.

### 2.3 Test accounts
| Account | Used for |
|---|---|
| Normal customer (Meena Devi, with 1 old delivered order) | regression, print COD |
| Brand-new customer (no orders) | print COD not eligible |
| Retailer applicant (Ravi Sharma) | apply, approve, reject |
| Approved retailer (second one, e.g. Asha Traders, GSTIN `22BBBBB0000B1Z5`; use a checksum-valid test number from the guide) | shop, checkout |
| Super admin | all switches, unblock, suspend |
| Store admin of Sample Store, and a store admin of a second store | scope checks |
| Picker (device with camera) | Phase H |
| Rider (delivery app) | Phase J |

GSTINs that pass the checksum are listed in `test-retailer-wholesale.md`. The fake `22AAAAA0000A1Z5` is fine where the guide says "valid-looking"; use the checksum-valid ones when the server validates.

### 2.4 Builds
- [ ] Android customer, iOS customer (an already-installed older build AND the new one), web (dev site), rider app, picker app (Android), admin web from `dev`.

---

## 3. Test run order

### Phase A. Flags OFF: nothing changes for a normal customer
**Goal:** prove the release is invisible when switches are OFF.
**Who/where:** Meena Devi (normal customer) on web, Android, iOS. Set `RETAILER_APPLICATIONS_ENABLED` OFF and every store `wholesaleEnabled` OFF first.
1. - [ ] ✅ Home, category and search: no "Pack of N" items, no "Become a retailer" entry. Search "Sample Biscuit" shows only the single.
2. - [ ] ✅ Cart and checkout: same lines, same totals, same payment options as before this release. Place one small COD order; it works.
3. - [ ] ✅ Order list and detail: no retailer wording, no extra fields. Download the invoice of an old delivered order: opens as the normal invoice.
4. - [ ] ✅ Print: open the print flow. No "Cash on delivery" option (print COD is OFF).
5. - [ ] ❌ `POST /user/retailer/application` with the switch OFF returns 503 `PROGRAM_DISABLED`.
6. - [ ] ✅ Old iOS build still downloads an invoice (no redirect error).
**Expected:** nothing looks or behaves differently. Any visible change here is a bug.
Detail in: `test-retailer-wholesale-cart.md` ("Non-audience customer"), `test-print-checkout.md` (C1).

### Phase B. Retailer applies, admin verifies
**Goal:** the full application life cycle, including GSTIN block and unblock.
**Who/where:** Ravi Sharma (web, Android, iOS), then super admin and store admin in Admin > Retailers.
Turn `RETAILER_APPLICATIONS_ENABLED=true` and turn `wholesaleEnabled` ON for Sample Store (see Phase D step 1 first if the toggle refuses).
1. - [ ] ✅ Ravi sees "Become a retailer". Fills shop "Sharma Kirana", GSTIN `22AAAAA0000A1Z5`, address with map pin, shop photo. Status becomes "Under review".
2. - [ ] ❌ Bad checksum GSTIN (e.g. one letter changed) is refused with a clear message. Missing photo is refused.
3. - [ ] ✅ Admin > Retailers lists the application. Photo link opens (it expires in 5 minutes).
4. - [ ] ✅ Store admin rejects with reason "Shop photo is unclear". Ravi sees the reason, fixes, resubmits (max 5 in 30 days).
5. - [ ] ✅ Super admin or permitted manager approves: ticks "I checked the GST portal", clicks Approve. Ravi's status: Approved.
6. - [ ] ❌ A manager without `retailers.verify` gets no Approve button (and 403 if forced).
7. - [ ] ✅ Suspend then Reinstate as super admin; store admin cannot do either.
8. - [ ] ✅ Block: a second applicant (Mohan Lal, `9000000003`) applies with Ravi's GSTIN. Reject with "GSTIN not owned". Mohan resubmits the same GSTIN: 409 `GSTIN_BLOCKED`.
9. - [ ] ✅ Super admin opens Mohan's profile > Blocked GSTINs, clicks Unblock with a reason. Mohan can resubmit. Store admin sees the masked list with no button.
10. - [ ] ✅ Two people open the same application, one approves; the other's action gets "updated by someone else, refresh".
11. - [ ] ✅ Same on iOS and Android (apply, status screen, withdraw while Under review).
**Expected:** statuses and messages as above; history and audit rows exist for approve, reject, block, unblock.
Detail in: `test-retailer-wholesale.md`, `test-retailer-wholesale-admin.md` (sections 1-9), `test-retailer-wholesale-web.md`, `test-retailer-wholesale-android.md`, `test-retailer-wholesale-ios.md`.

### Phase C. Wholesale visibility
**Goal:** only approved retailers see packs, only where wholesale is ON.
**Who/where:** approved retailer, Meena (normal), a pending/rejected/suspended applicant, signed-out visitor, on web, Android, iOS.
1. - [ ] ✅ Approved retailer in Sample Store: sees the wholesale section and "Sample Biscuit 50g Pack of 10" with price and "= 10 pcs".
2. - [ ] ❌ Meena, pending, rejected, suspended, and signed-out visitor: no packs anywhere (home, category, search, item page by direct link, barcode scan).
3. - [ ] ❌ Approved retailer in a store with wholesale OFF: sees no packs.
4. - [ ] ✅ Suspend Ravi: wholesale vanishes on next refresh; reinstate: it returns.
5. - [ ] ✅ Category tile "from Rs ..." price: retailer may see the pack price only when no retail item is in stock; normal customers never see a pack price.
**Expected:** zero leakage of pack names, prices or counts to non-retailers.
Detail in: `test-retailer-wholesale-cart.md`, `test-retailer-wholesale-web-shop.md`, `test-retailer-wholesale-android-shop.md`, `test-retailer-wholesale-ios-shop.md`.

### Phase D. Admin: store toggle, size-group packs, HSN, locks
**Goal:** set up a store and a pack the way ops will.
**Who/where:** super admin on Admin web; then a store admin.
1. - [ ] ✅ Stores > Edit "Sample Store": "Wholesale for retailers" toggle. With batch tracking OFF: refused with a message. Tick batch tracking + wholesale together: saves.
2. - [ ] ✅ While wholesale is ON: batch tracking and store GSTIN are locked ("Locked while wholesale is on").
3. - [ ] ❌ Store admin sees the toggle disabled ("Only a super admin can change this").
4. - [ ] ✅ Catalog > Size groups: add "Pack of 10" to Sample Biscuit 50g. Units must be 2 to 10000. Nothing is created until Save. The pack cannot be the default size.
5. - [ ] ✅ Product form: HSN field accepts 4 to 8 digits (`1905`, `19059090`), refuses `190`.
6. - [ ] ✅ Open the pack master: brand, unit, weight, GST, HSN, category are locked (taken from the base item). The name is editable.
7. - [ ] ✅ Assign the pack to Sample Store. Its quantity shows floor(single stock / 10): 40 singles = 4 packs.
8. - [ ] ✅ Discontinue the pack: it disappears for retailers. Barcode generator skips pack rows.
9. - [ ] ❌ Admin banner to a pack item and gift tier with a pack item are refused (see Phase G).
**Expected:** each lock and message appears; no half-created pack after a cancel.
Detail in: `test-retailer-wholesale-admin-packs.md`, `test-retailer-wholesale-packs.md`, `test-retailer-wholesale-admin.md`.

### Phase E. Wholesale cart and checkout
**Goal:** a retailer buys packs; COD works only when allowed.
**Who/where:** approved retailer on web, Android, iOS.
1. - [ ] ✅ Add 3 x "Pack of 10" and 2 x single Sample Biscuit 50g. Cart shows both lines; pack quantity is in packs.
2. - [ ] ❌ Ask for more packs than stock allows (stock 40 singles, ask 5 packs): refused with a clear message.
3. - [ ] ✅ Retailer with COD OFF: COD option is not offered for a cart with a pack; server refuses a forced COD. Pay online works.
4. - [ ] ✅ Super admin turns COD ON for this retailer: COD is offered and the order places.
5. - [ ] ❌ Suspend the retailer after the cart is filled: COD/wholesale checkout refused.
6. - [ ] ✅ Scheduled COD order with a pack, then suspend before release: order is held (not cancelled), store admin gets one push.
7. - [ ] ❌ Credit / "pay later" is not shown and a forced request is refused (`SETTING_UNAVAILABLE`).
8. - [ ] ✅ Meena's checkout and a retailer's pure-retail cart still work as before.
**Expected:** the order has a retailer snapshot (shop name, GSTIN) only when the store has wholesale ON.
Detail in: `test-retailer-wholesale-checkout.md`, `test-retailer-wholesale-cart.md`.

### Phase F. Order lines and GST invoice
**Goal:** order shows correct lines; invoice is a proper B2B invoice.
**Who/where:** admin Orders, then customer app and admin Invoice download, after delivery (finish Phase J delivery for one order first, or mark one delivered in admin).
1. - [ ] ✅ Admin order detail: pack line shows "Pack of 10 x 3 = 30 pcs", unit price per pack, base item name.
2. - [ ] ✅ Deliver the order. Download invoice from the app (Android, new iOS, web) and from Admin > Order > Invoice. Each is a PDF that opens.
3. - [ ] ✅ Invoice shows the shop name, buyer GSTIN `22AAAAA0000A1Z5`, store GSTIN, HSN per line, tax split, invoice number.
4. - [ ] ✅ Response is 200 with the PDF itself (no redirect), `Content-Type: application/pdf`, `Cache-Control: private, no-store`.
5. - [ ] ✅ Download twice: same file both times.
6. - [ ] ✅ Meena's order: normal invoice, no GSTIN block.
7. - [ ] ✅ Retailer in a wholesale-OFF store: normal invoice, no 409.
8. - [ ] ✅ Profit snapshot for the delivered pack order uses cost x 3 packs (within Rs 0.01).
**Expected:** correct B2B fields; nothing public.
Detail in: `test-retailer-wholesale-orderlines.md`, `test-retailer-wholesale-invoice.md`.

### Phase G. Discounts, coupons, gifts, referral exclusions
**Goal:** wholesale lines are excluded; retail lines in the same cart behave as before.
**Who/where:** approved retailer with a mixed cart: 2 x Sample Biscuit 50g at Rs 14 (Rs 28) + 1 x Pack of 100 at Rs 1150. Admin sets a 10% rule, a Rs 10 coupon, a "Rs 500 gets a free cola" tier.
1. - [ ] ✅ 10% sale takes Rs 2.80 off (only the Rs 28 retail part). Pack row shows no strikethrough and no "% OFF".
2. - [ ] ✅ Rs 10 coupon is taken only from the retail line.
3. - [ ] ❌ Pack-only cart with a coupon typed: refused with the generic "couldn't apply this coupon" text (never the word "wholesale"). No coupon slot used.
4. - [ ] ✅ Free-gift tier is NOT reached by the pack value; the cart says "Add Rs 472 more".
5. - [ ] ✅ Referred retailer's first delivered order, Rs 400 retail + Rs 600 wholesale: referrer earns 3% of Rs 400 = Rs 12.
6. - [ ] ❌ Admin banner linking to a pack: refused. Gift tier with a pack as the gift: refused.
7. - [ ] ✅ Meena: all discounts, coupons, gifts and referral behave exactly as before.
**Current behaviour to note (open question for the team):** an approved retailer is NOT blocked from coupons altogether. Coupons, discounts and gift credit simply ignore the wholesale lines and still work on the retail lines. If the team decides retailers should lose coupons even on retail lines, that is a change request, not a bug in this release. Record what you saw.
Detail in: `test-retailer-wholesale-discounts.md`.

### Phase H. Picking with pack lines
**Goal:** the picker can pick and verify an order with singles and packs of the same barcode.
**Who/where:** picker app on a real device. Orders: P1 = 2 singles + 3 x Pack of 10 (same barcode `8901000000017`); P2 = 3 x Pack of 10 only.
1. - [ ] ✅ Pack line shows "= 10 pcs" for each pack; the single line looks as today.
2. - [ ] ✅ Scan-anything: scan `8901000000017` five times. Singles line fills first or per the guide, then the pack line fills; neither shows "Already done" wrongly.
3. - [ ] ✅ Pack with its own carton barcode (`8901000000024`) matches only the pack line.
4. - [ ] ✅ Loose pieces: on P2 the picker finds only 25 pieces on the shelf: 2 full packs + 5 loose pieces handled as the guide describes; stock stays correct.
5. - [ ] ✅ Short-pick a pack line (1 of 3 packs found): the missing packs go back correctly (base stock restored by 20 pieces).
6. - [ ] ✅ Complete the task; order moves to the next stage.
7. - [ ] ✅ A normal customer's order picks exactly as before.
**Expected:** counts in packs on pack lines, in pieces on singles; no stuck lines.
Detail in: `test-picker-pack-lines.md`, `test-retailer-wholesale-pack-ops.md`.

### Phase I. Same-stock conservation
**Goal:** a pack and its single always draw from one pool.
**Who/where:** admin Items/Inventory plus a retailer order. Start: 40 singles = 4 packs.
1. - [ ] ✅ Sell 1 pack (10 pieces) to a retailer: singles go 40 to 30, pack shows 3.
2. - [ ] ✅ Sell 5 singles to Meena: singles 25, pack shows 2.
3. - [ ] ✅ Restock 20 singles (goods receipt): singles 45, pack shows 4.
4. - [ ] ✅ Cancel/short-pick a pack order before delivery: pieces return to the single.
5. - [ ] ✅ Transfer stock of the single between stores: pack counts follow in both stores.
6. - [ ] ❌ Stock-in, Adjust or Transfer applied directly to a pack row is refused (see known gaps: buttons are still visible).
7. - [ ] ✅ Low-stock lists, stock value and expiring counts include the single only, never double-count the pack.
8. - [ ] ✅ Delete or switch off the single: its packs show 0 at once; switch back on, packs return.
**Expected:** total pieces on hand never change except by real sales, restocks and adjustments.
Detail in: `test-retailer-wholesale-packs-sell.md`, `test-retailer-wholesale-pack-ops.md`, `test-retailer-wholesale-packs.md`.

### Phase J. Delivery, delivered-order lock, held refund
**Goal:** rider flow works; a delivered retailer order cannot be quietly reversed.
**Who/where:** rider app, store admin, super admin.
1. - [ ] ✅ Rider picks up, delivers a retailer COD order, collects cash. Order closes; cash joins the rider's settlement.
2. - [ ] ❌ Store admin moves the delivered retailer order to Undelivered or Refund initiated: 409 `RETAILER_CREDIT_NOTE_REQUIRED`. Store admin can move it back to Delivered.
3. - [ ] ❌ Super admin reverses and reopens it, then a picker marks a line Out of stock: refused with "This retailer order was delivered with a GST invoice...". Items, total and wallet unchanged.
4. - [ ] ✅ Super admin can still edit it from admin; an override row is written in the audit.
5. - [ ] ✅ Rider marks a reopened, once-delivered prepaid retailer order (Rs 90 card + Rs 68 wallet) as Undelivered: stock returns to the shelf, slot freed, **no automatic refund**.
6. - [ ] ✅ Order Activity shows a "refund held" row with amount Rs 158, the store, rider and retailer profile id. No GSTIN, name or address in it.
7. - [ ] ✅ A retailer order that was never delivered, then Undelivered: store admin can still cancel it; refund happens normally.
8. - [ ] ✅ A normal customer's Undelivered order refunds exactly as before.
**Expected:** only a super admin can money-reverse a delivered retailer order, deliberately.
Detail in: `test-retailer-wholesale-checkout.md` (sections G and the rider section), `test-retailer-wholesale-invoice.md`.

### Phase K. Print cash on delivery
**Goal:** COD for prints is limited, safe, and OFF by default.
**Who/where:** web, Android, iOS print flow; Admin > Config > Print service (super admin) and Admin > Print queue. Example order: 3 pages x 2 copies = Rs 40.
1. - [ ] ✅ Store COD OFF: print review shows no COD. Forced COD: 400 `COD_OFF`. Nothing is written.
2. - [ ] ✅ Super admin turns ON for Sample Store: limit Rs 300, min delivered orders 1 (the defaults). Settings save and show again after reload. Store admin cannot change them.
3. - [ ] ❌ Brand-new customer (no delivered order): COD not offered; forced: 409 `COD_NOT_ELIGIBLE`.
4. - [ ] ✅ Meena (1 delivered order): COD offered at Rs 40. Order places with no payment sheet; it shows in the print queue with a Cash chip.
5. - [ ] ❌ Total above the limit (set limit Rs 39.50): 409 `COD_LIMIT`, message names the limit. Customer pays online.
6. - [ ] ✅ Total exactly equal to the limit: allowed.
7. - [ ] ❌ A second COD print order while one is still in progress: 409 `COD_OPEN_LIMIT`.
8. - [ ] ✅ Coins cover part: Rs 15 coins + Rs 25 cash; rider collects Rs 25. Coins cover everything: placed as a wallet order.
9. - [ ] ❌ Only counter (POS) purchases in history: not eligible.
10. - [ ] ✅ Rider refused at the door (Undelivered): coins return, no cash owed. That customer cannot use COD for prints for 90 days (`COD_NOT_ELIGIBLE`), but can pay online.
11. - [ ] ✅ Customer cancel within 60 seconds or staff Reject: only coins returned; message never claims a refund of cash.
12. - [ ] ✅ Super admin switches COD OFF while a customer is on the review screen: their COD submit gets `COD_OFF`; online pay still works.
13. - [ ] ✅ Admin cannot convert a print order to COD later (`PRINT_PREPAID_ONLY`).
14. - [ ] ✅ Repeat steps 4, 5, 7 on all three of web, Android, iOS: the right button shows, the right message appears, web lands on the order page after a COD order.
**Expected:** every refusal says "pay online" and writes nothing.
Detail in: `test-print-checkout.md` (C1 to C18), `test-print-admin.md`, `test-print-customer-web.md`, `test-print-customer-android.md`, `test-print-customer-ios.md`. Design: `design-print-cod.md`.

### Phase L. Security spot-checks
**Goal:** private data stays private.
1. - [ ] ❌ Open a retailer document (shop photo) through the CDN domain: never 200. After the 5-minute admin link expires, the link stops working.
2. - [ ] ❌ Retailer documents link in admin works only for people with retailer permission.
3. - [ ] ❌ Customer B requests customer A's invoice: 404.
4. - [ ] ❌ Store admin of the second store downloads Sample Store's invoice: 404. Super admin can.
5. - [ ] ✅ Invoice for a retailer whose store GSTIN is missing: clear 409 message in the app. (In the admin Invoices page this shows a generic message; see known gaps.)
6. - [ ] ❌ Rider app and picker app responses for a retailer order contain no retailer snapshot (no GSTIN, legal name, shop address). Check in network traces.
7. - [ ] ❌ `GET /admin/order/invoices/search?query=INV&limit=1000` returns at most 50 rows, and no GST details, delivery address or payment internals.
8. - [ ] ✅ Store admin invoice search shows only their store; super admin sees all.
9. - [ ] ❌ Full GSTIN never appears in a URL, page title or aria-label in admin (unblock sends it in the body only).
Detail in: `test-retailer-wholesale-invoice.md` (2026-10-31 updates), `test-retailer-wholesale.md`.

### Phase M. Account deletion anonymises retailer data
**Goal:** a deleted account leaves no personal retailer data.
1. - [ ] ✅ Delete Asha Traders' account from the app (or via the normal deletion flow).
2. - [ ] ✅ After the purge job runs, the retailer profile is anonymised: name, shop, GSTIN, address and photo are gone. Blocked-GSTIN list is dropped.
3. - [ ] ✅ One purge audit row exists with an empty display name and system as actor.
4. - [ ] ✅ Her old orders still exist and the invoices stay downloadable by admin; they carry no fresh personal details beyond what the order already held.
5. - [ ] ✅ If the document delete fails, the nightly sweep retries it (checked in logs; after 3 days an alert is raised).
Detail in: `test-retailer-wholesale.md` (account deletion section).

---

## 4. Edge cases checklist
- [ ] Order placed from an old app build (no retailer fields) still works.
- [ ] Two devices place the same print COD order at once: exactly one order, coins taken once.
- [ ] Two admins act on the same retailer at once: second gets the "refresh" message.
- [ ] Retailer resubmits more than 5 times in 30 days: refused.
- [ ] GSTIN typed in lower case or with spaces still matches the block.
- [ ] Pack units 2 and 10000 accepted; 1, 10001, 2.5 refused.
- [ ] Pack with its own carton barcode vs shared base barcode both scan correctly.
- [ ] Redis down: status changes still succeed (invoice cache just skipped).
- [ ] `PRINT_S3_BUCKET` missing on an API: invoice still downloads (freshly built), applications answer 503.
- [ ] Turning `RETAILER_APPLICATIONS_ENABLED` OFF: existing applicants still see status and can withdraw; new ones get 503.
- [ ] Turning a store's wholesale OFF with open retailer orders: they still pick and deliver.
- [ ] Midnight to 5:30 IST orders and scheduled slots still book correctly for retailers.

---

## 5. Known gaps (not built; do not file as bugs)
- Credit ("pay later") for retailers: later phase, stays disabled.
- Credit notes: a delivered retailer order cannot be refunded by store staff; super admin handles it by hand.
- Web "size sheet" for choosing sizes: not built.
- Stock-in, Adjust and Transfer buttons are still visible on pack rows (the server refuses them).
- Users list has no retailer badge or filter.
- Admin Invoices page shows a generic message for the invoice 409 (the customer apps show the clear one).
- No push alert to staff when a refund is held; look in Order Activity.
- Print COD: no COD fee, no store confirm-first step, no refused-print cost report.
- Print COD and the pack features were not yet tested on real devices at the time of writing; this run is the first.

---

## 6. Sign-off

| Phase | Tester | Date | Pass / Fail | Notes |
|---|---|---|---|---|
| A. Flags-off regression | | | | |
| B. Apply and verify | | | | |
| C. Wholesale visibility | | | | |
| D. Admin setup and packs | | | | |
| E. Cart and checkout | | | | |
| F. Order lines and invoice | | | | |
| G. Discounts and exclusions | | | | |
| H. Picking | | | | |
| I. Stock conservation | | | | |
| J. Delivery, lock, held refund | | | | |
| K. Print COD | | | | |
| L. Security | | | | |
| M. Account deletion | | | | |
