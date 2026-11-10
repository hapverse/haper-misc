# Tutorial: how to use wholesale (B2B) in Haper

For: the owner and the store/admin staff. All names, prices and the GSTIN here are made up ("Sample Biscuit 50g", "Sample Kirana", Ravi Sharma, GSTIN `22AAAAA0000A1Z5`).

> **Honest note.** Written from the test guides and the code. The author has NOT run these steps end to end in the admin panel or the apps. Treat every button name as "may differ slightly". Wholesale shopping is built and tested on **Android only** (see section 9).

## 1. What wholesale is in Haper

- A **retailer** is a shop owner with a GST number (GSTIN). Example: Ravi Sharma, "Sample Kirana".
- An approved retailer gets a second shop inside the app, **Haper Business**. It has its own cart.
- Normal customers never see wholesale items. Not on Home, search, item pages or in the cart.
- There are two kinds of wholesale item:
  - **Wholesale-only product**: its own product with its own stock. Example: "Sample Biscuit 50g Carton".
  - **Pack**: made from a normal product and shares its stock. Example: "Sample Biscuit 50g - Pack of 10" takes 10 pieces off the same shelf as the single biscuit.
- **Bulk discounts ("tiers")**: buy more, pay less per unit. Example: 10 or more = 2% off.
- **Rule:** retail and wholesale products are never mixed, in the app or in the admin lists.

## 2. Before you start (one-time setup)

Everything is OFF by default. Do these in order.

| # | Step | Who | Where |
|---|---|---|---|
| 1 | Cloud storage rules, shop-document storage, indexes, deploys | Developer / server person | Follow `runbook-wholesale-rollout.md`. Not copied here. |
| 2 | Give the permission `retailers.verify` to named managers only | Owner (super admin) | Admin > Team > permission grid, "Retailers - Approve / reject" |
| 3 | Batch tracking ON for the store (batch = one delivery of stock with its own expiry and cost) | Super admin | Admin > Stores > Edit |
| 4 | New picker app build installed on **every** picker device of that store | Developer ships, you confirm each device | Picker app. **Do this before step 5.** An old picker app mis-verifies pack lines. |
| 5 | Tick **"Wholesale for retailers"** for the store | Super admin only | Admin > Stores > Edit (store must also have a valid GSTIN) |
| 6 | Switch ON `RETAILER_APPLICATIONS_ENABLED=true` on the user API, then restart it | Developer / server task | Server `.env` (never in the admin panel) |

- Step 5 is refused with a red message if batch tracking is off or the store GSTIN is missing/invalid.
- While wholesale is ON for a store, its GSTIN and batch tracking are locked. Turn wholesale off to change them.
- Credit ("pay later") is **not built**. Never turn it on. Its switch is disabled in the admin ("Coming soon").

## 3. Get a retailer approved (so you can test as one)

**In the app (Android, iOS or web), as the test customer:**
1. Open **Profile > "Become a retailer"**.
2. Fill shop name, legal name, owner name, business type, GSTIN (example `22AAAAA0000A1Z5`), shop address with a map pin, PIN code.
3. Add a shop photo (required). A GST certificate (image or PDF) is optional.
4. Submit. Status becomes "Under review".

The "Become a retailer" row shows only when **both** are ON: the server switch (section 2, step 6) **and** the store's "Wholesale for retailers" toggle. If either is off, the row is hidden.

**In the admin (Admin > People > Retailers):**
1. Open the **Pending** tab. Click the application.
2. Look at the photo. Click "Check on GST portal" and check the GSTIN by hand.
3. Tick the GST-check box. Click **Approve**. (Approve stays disabled until the box is ticked.)
4. Or click **Reject**, pick a reason ("Other" needs a note). The customer can fix and resubmit (max 5 tries in 30 days).
5. **Suspend** / **Reinstate** are for super admin only. A suspended retailer loses wholesale within about a minute.
6. Reject reason "This GSTIN belongs to another business" blocks that account from using that GSTIN again. A super admin can undo it from "Blocked GSTINs" on the retailer page.
7. The super admin can switch **Cash on delivery** ON per retailer (default OFF). Without it, a wholesale cart must be paid online.

**What an approved retailer sees (Android):** a "Haper | Haper Business" switch at the top of Home. Tap **Haper Business**. The header turns plum and only wholesale items show.

## 4. Tutorial A: a NEW wholesale-only product

Example: "Sample Biscuit 50g Carton", sold only to retailers. Who: super admin (Product master is super-admin only).

1. Admin > **Product master** > add a product. Fill Name `Sample Biscuit 50g Carton`, Unit, Weight, GST rate, category and the other usual fields.
2. Tick **"Wholesale-only item"** (helper text: hidden from customers who are not approved retailers).
3. **HSN code** (HSN = the government's tax code for a product type; biscuits are `1905`). Enter 4 to 8 digits. It is printed on the GST invoice. Blank is allowed, but then the invoice shows `-` for that line.
4. **Barcode.** A wholesale-only product is its own product, so it needs its own barcode. A barcode must be unique per product. If you type one that exists, the form refuses and names the existing product ("Edit that product instead"). Never reuse the single biscuit's barcode here. If the carton has no printed code, leave it blank and use "Barcode" later to generate one.
5. **Bulk discounts** block (appears once wholesale-only is ticked). Up to 5 rows, each "From [N] units -> [x] % off".
   - Example row 1: From 10 units, 2 % off. Row 2: From 15 units, 5 % off.
   - N is a whole number 2 to 100000. Percent is above 0 and at most 50. Both must go up from row to row.
   - Counting is per cart line, in the item's own unit. Highest matching tier wins.
   - After saving, a preview table shows the price per store. If a tier would sell below a store's cost, a red box "Some stores would sell below cost" appears. Tick **"I understand these tiers sell below cost in the stores above"** to save.
6. Save. Unticking "Wholesale-only" later asks "Remove the bulk discounts too?".
7. **Assign to the store with a price.**
   - A product with a barcode is auto-added to all active stores and the warehouse **at price 0** (the form says so). This includes stores where wholesale is off. It stays hidden from normal customers.
   - Because the row already exists, "Assign" will skip it and will NOT change the price. Set the price on the store row: Admin > **Items** > switch to **Wholesale** > Edit the item > fill **Selling price** and **Price (MRP)**. Do this for each store.
   - Without a barcode: Product master > **Assign**, pick stores, fill Price (MRP) and Selling price.
8. **Stock in.** Admin > Items (Wholesale view) > the stock-in icon ("Add received inventory"). Enter quantity, Batch no., cost and Expiry. Cost comes from here.
9. **Check in the app** as the approved retailer (Android): tap **Haper Business**.
   - The carton shows in Haper Business only. Switch back to Haper: it is gone.
   - Open the item: a **"Bulk price"** table shows rows like "10+ units, 2% off, ₹1,127 each".
   - Add 12 to the Business cart: the line shows the struck price, ₹1,127 each, the label **"2% OFF bulk"**, and a nudge like "Add 3 more for 5% off".

Example numbers (from the approved plan; its example item was a Maggi pack at ₹1,150, reused here):

| Quantity | Tier | Price each | Line total |
|---|---|---|---|
| 9 | none | ₹1,150.00 | ₹10,350.00 |
| 12 | 10+ = 2% off | ₹1,127.00 (₹23 off) | ₹13,524.00 |
| 15 | 15+ = 5% off | ₹1,092.50 (₹57.50 off) | ₹16,387.50 |

## 5. Tutorial B: an EXISTING retail product gets a wholesale pack

Example: "Sample Biscuit 50g" already sells to normal customers. Now Ravi wants "Pack of 10". Who: super admin (a warehouse manager can see packs but cannot create them).

**What a pack is:** a second product that points at the single. It has **no stock of its own**. Example: the shelf holds 32 pieces. That is 2 singles plus 3 packs of 10 sold off the same shelf, or 3 packs shown as available (32 / 10, rounded down).

1. Admin > **Size groups** (Catalog). Open the group that holds "Sample Biscuit 50g", or create one: **New size group**, give it a name, search and add the biscuit.
   - The form says a group needs at least 2 sizes. The pack counts as a row. Not tried by the author. If Save is blocked, add a second retail size.
2. Click **"Add wholesale pack..."** (disabled with "Add a retail size first" if the group has no retail row). Fill:
   - **Base item**: Sample Biscuit 50g.
   - **Units per pack**: `10` (whole number 2 to 10000).
   - **Name** (optional): default is "Sample Biscuit 50g - Pack of 10".
   - **Barcode** (optional): see step 3.
   - **Pack price** (optional): only used to show warnings, it is not saved as the price.
3. **Why the barcode is usually blank.** The picker scans the normal biscuit barcode for both the single and the pack. Fill the barcode only if the carton has a **different** printed code. The same barcode as the single is refused ("A pack's carton barcode can't be the base item's barcode"). A barcode used by any other product is refused too.
4. Click **Add pack to group**, then **Save group**. The pack is only created on Save. You may see warnings (below cost, dearer per piece than singles, base stock below 10). They do not block.
5. **Assign the pack to the store with a price.** Packs are never auto-added at price 0.
   - Product master > Wholesale view > the pack row > **Assign** > pick the store > Price (MRP) and Selling price. Stores that do not carry the single are skipped.
   - If the row already exists, set the price in Items (Wholesale view) > Edit > Selling price.
6. **Bulk tiers on the pack:** Product master > Wholesale view > Edit the pack. The "Bulk discounts" block shows without ticking anything. Same rules as Tutorial A step 5.
7. **What happens to the retail product: nothing.** Normal customers still see only the single, at the same price.
8. **Stock rules.** Stock in, adjust, transfer, replenishment and POS sales happen on the **single** only.
   - On a pack row the admin Items list still shows the stock buttons. The server refuses with "This is a wholesale pack. It has no stock of its own: adjust the base item instead."
   - The pack's Edit form greys out quantity, cost, expiry, stock limits, brand, GST. Price and MRP still save.
   - Pack GST and HSN are copied from the single each time the single changes.
9. **Discontinue a pack:** Product master > Wholesale view > pack row > **Discontinue**. Its store rows go inactive. To change units, discontinue and create a new pack. Discontinuing the single also discontinues its packs, and re-activating the single does not bring them back.
10. **Check in the app** as the approved retailer: tap Haper Business. The pack shows a "Wholesale" pill and a per-piece price (a ₹140 pack of 10 shows "₹14.00 per piece"). Add some packs: tiers work as in Tutorial A. In plain Haper mode the pack is not there.

## 6. The admin lists: Retail | Wholesale switch

- Product master and Items both have a **Retail | Wholesale** switch. Default is **Retail**. Your choice is remembered for the browser tab.
- **Wholesale** shows wholesale-only products and packs. "Showing wholesale products only." appears above the list.
- Header totals on Items follow the switch. Packs add to the item count but not to stock value (their stock is the single's).
- The **Shelf** filter on Items starts at "All" in Wholesale view (packs have no shelf).
- **"Missing barcode"** is still there in Wholesale. It lists wholesale-only items with no barcode. Packs never appear in it, because a blank pack barcode is normal.
- Search finds nothing in the wrong view but shows a hint: "Looking for a wholesale product? Switch to Wholesale."

## 7. A retailer's order, end to end

1. **Cart.** Ravi adds items in Haper Business. It is a separate cart from his normal Haper cart. Coupons, store discounts, free gifts and referral rewards do **not** apply to wholesale lines. The bulk tier is the only discount.
2. **Checkout.** Online payment always works. Cash on delivery works only if the super admin ticked it for that retailer. Otherwise the app shows "Pay online".
3. **Admin Orders.** The order shows a **"Retailer"** pill with a masked GSTIN (`22••••••••••1Z5`).
4. **Picking (picker app).** A pack line shows "1 pack = 10 pcs", "Item inside: Sample Biscuit 50g" and "Qty: 3 packs (30 pcs)". Scan-anything works when the single and the pack share a barcode: scan once for the single, move the camera away for about 2 seconds, scan again for the pack. On a short pick, a field "Loose pieces left on shelf (optional)" lets the picker count loose pieces so the stock stays right.
5. **Delivery.** Riders never see the retailer's GSTIN or shop details.
6. **B2B GST invoice.** Same download button as any order. It differs: "TAX INVOICE", the shop name and GSTIN, a place of supply, an HSN column, tax split (CGST + SGST in the same state, IGST across states), and each line at the **paid** price (taxable value = what Ravi paid after the tier). A pack line reads "(Pack of 10) = 30 pcs".
7. **After delivery:**
   - A delivered retailer order is **locked**. A store admin cannot cancel, refund, reverse or edit its items. Only a super admin can (it is audited). Reason: a credit note would be needed and is not built.
   - If a rider marks it "Undelivered", the wallet refund is **held** for review, not paid automatically. A super admin issues it by hand.

## 8. Common problems and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| "Become a retailer" row is missing | Server switch OFF or the store's wholesale toggle OFF | Section 2 steps 5 and 6. Both must be on. |
| Approved retailer sees no Haper Business switch / no wholesale items | Store toggle off; or old app build; or iOS/web | Update the Android app. Wait about a minute after approval. iOS and web have no Business mode yet. |
| Normal customer sees a wholesale item | Should never happen | Stop. Tell the developer. Check the item is ticked "Wholesale-only" or is a pack. |
| Pack shows ₹0 or cannot be ordered | Pack not assigned to the store, or no selling price (exact app behaviour not verified) | Assign it with a price, or fix the price in Items (Wholesale view). |
| Pack stock looks wrong | A pack has no own stock. It is the single's stock divided by units, rounded down | Fix the single's stock. A fully correct number can lag until the nightly check. |
| Picker cannot verify a pack line ("Already done") | Old picker build | Install the new picker build on every device. Keep wholesale OFF until then. |
| Barcode refused as duplicate | A barcode must be unique per product. A pack cannot reuse the single's barcode | For a pack, leave it blank. For a new product, use a new code or edit the existing product. |
| Items > Wholesale view is empty | Product not assigned to this store, or a filter is narrowing the list | Assign it. Reset filters. Shelf must be "All". |
| Warning "Some stores would sell below cost" | A tier price is under a store's cost | Lower the percent, or tick "I understand" if intended. |
| Invoice download shows a message (409) | Order not delivered yet, no retailer details on the order, or the store GSTIN was removed | Deliver the order first. Check the store GSTIN is still set. |
| Cannot turn wholesale on for a store | Batch tracking off or store GSTIN missing/invalid | Fix both in Stores > Edit, then tick again. |
| "Cash on delivery isn't enabled for wholesale orders" | Retailer's COD switch is OFF | Super admin ticks it on the retailer page, or the retailer pays online. |
| Cannot change a delivered retailer order | Delivered-order lock | Super admin only. |
| New application says "not open yet" (503) | Server switch OFF | Section 2 step 6. |

## 9. NOT included yet

- **Credit (pay later):** not built. Must stay off.
- **Credit notes** for refunds after delivery: not built. That is why delivered orders are locked.
- **Wholesale rail on the home screen:** no. Only the Business switch.
- **Minimum order amount** for Haper Business: not built.
- **Web size sheet:** web shows packs as plain products.
- **Which clients have what:**

| Client | Apply as retailer | Haper Business switch, bulk prices, separate cart |
|---|---|---|
| Android | Built | Built (not tested on a real device yet) |
| iOS | Built | **Not started** |
| Web | Built | **Not started** |

- On iOS and web an approved retailer sees only the normal retail shop. To buy wholesale they must use Android for now.
- No client has had a real-device or browser run of the wholesale flow.

## 10. Quick reference checklist

**Setup (once)**
- [ ] Runbook steps done by the developer.
- [ ] `retailers.verify` given to named managers only.
- [ ] Store: batch tracking ON, valid GSTIN.
- [ ] New picker build on every picker device of the store.
- [ ] Store: "Wholesale for retailers" ticked.
- [ ] Server switch `RETAILER_APPLICATIONS_ENABLED=true`, user API restarted.

**Approve a test retailer**
- [ ] App: Profile > Become a retailer, submit.
- [ ] Admin > Retailers > Pending > tick GST check > Approve.
- [ ] App: Haper Business switch appears.

**Add a product or a pack**
- [ ] New product: Product master, tick Wholesale-only, HSN, own barcode, bulk discounts.
- [ ] Existing product: Size groups > Add wholesale pack, units, barcode blank.
- [ ] Optional: bulk tiers on the pack.

**Assign and price**
- [ ] Set Selling price and MRP per store (Items, Wholesale view, or Assign).

**Stock**
- [ ] Stock in on the product (new) or on the single (pack): batch, cost, expiry.

**Test as the retailer**
- [ ] Item is in Haper Business only, not in Haper.
- [ ] Bulk price table, then cart shows "2% OFF bulk" at 10+.
- [ ] Place an order (online first), see the "Retailer" pill in admin.
- [ ] Pick it, deliver it, download the B2B invoice.
