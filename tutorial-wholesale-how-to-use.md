# Tutorial: how to use wholesale (B2B) in Haper

> The API steps were checked on a local sandbox on 2026-11-10 (71 of 73 checks passed; the two differences are fixed here). The admin and app screens, picker, delivery, invoice and documents have not been walked through yet — use the dev checklist (`tutorial-wholesale-dev-walkthrough-checklist.md`). Labels and steps there may differ slightly.

For: the owner and store/admin staff. Last checked against the code: 2026-11-10 (backend, admin, Android and picker are committed; whether dev runs that build is "confirm on dev").
All names, prices and GSTINs are made up. Steps marked **confirm on dev** were not settled by the code.

## Contents

1. [Words used here](#1-words-used-here)
2. [What wholesale is, and the example we use](#2-what-wholesale-is-and-the-example-we-use)
3. [Before you start](#3-before-you-start)
4. [Who can do what](#4-who-can-do-what)
5. [Quick start](#5-quick-start)
6. [Get a retailer approved](#6-get-a-retailer-approved)
7. [Tutorial A: a NEW wholesale-only product](#7-tutorial-a-a-new-wholesale-only-product)
8. [Tutorial B: an EXISTING product gets a wholesale pack](#8-tutorial-b-an-existing-product-gets-a-wholesale-pack)
9. [Setting and changing the price per store](#9-setting-and-changing-the-price-per-store)
10. [The admin lists: Retail | Wholesale](#10-the-admin-lists-retail--wholesale)
11. [A retailer's order, end to end (with the price maths)](#11-a-retailers-order-end-to-end)
12. [Edge cases](#12-edge-cases)
13. [Switching off and rolling back](#13-switching-off-and-rolling-back)
14. [Which app has what](#14-which-app-has-what)
15. [Common problems and fixes](#15-common-problems-and-fixes)
16. [Not built yet](#16-not-built-yet)

### Which section do I need?

| I want to... | Go to |
|---|---|
| Understand a word (pack, tier, HSN...) | 1 |
| Switch wholesale on for a store | 3 |
| Know if my role can do a task | 4 |
| Sell a brand-new product only to shops | 5A, then 7 |
| Sell an existing product in packs of 10 | 5B, then 8 |
| Approve, reject or suspend a shop | 6, 12.1 |
| Fix a price for one store | 9 |
| Find wholesale items in the admin lists | 10 |
| Check the bulk discount maths | 11.2 |
| Know what happens when something goes wrong | 12 |
| Turn wholesale off | 13 |
| Know which app (Android, iOS, web) has what | 14 |

## 1. Words used here

| Word | Plain meaning | Tiny example |
|---|---|---|
| Retailer | A shop owner with a GST number, approved by Haper staff. | Ravi Sharma, owner of "Sample Kirana". |
| GSTIN | A business's 15-character GST number. First 2 digits = state code. | `10ABCDE1234F1ZF` (10 = Bihar). |
| Wholesale-only item | Its own product, with its own stock, shown only to retailers. | "Sample Biscuit 50g Carton". |
| Pack | A wholesale product made from a normal product. It has **no stock of its own**. It sells N pieces of that product. | "Sample Biscuit 50g - Pack of 10" takes 10 biscuits off the shelf. |
| Base item | The normal product a pack is made from. | "Sample Biscuit 50g" (the single). |
| Tier (bulk discount) | Buy more in one cart line, pay less per unit. | 10 or more = 2% off. |
| HSN | Government tax code for a product type, printed on GST invoices. | Biscuits: `1905`. |
| Batch | One delivery of stock with its own expiry and cost. | 100 biscuits, expiry March, cost ₹8 each. |
| Shelf | Where the picker finds the item in the store. | `R2-S4`. |
| Haper Business (Business mode) | The second shop inside the Android app. Wholesale items only, its own cart. | Ravi taps "Haper Business" at the top of Home. |
| Store toggle | The store setting "Wholesale for retailers". | ON for "Sample Store" only. |
| Server switch | `RETAILER_APPLICATIONS_ENABLED` on the user API. Opens the apply form. | `true` = applications open. |

## 2. What wholesale is, and the example we use

- An approved retailer gets a second shop in the Android app: **Haper Business**. It has its own cart.
- Normal customers never see wholesale items: not on Home, search, item pages, cart or wishlist.
- A retailer in the normal **Haper** shop also sees retail items only.
- Retail and wholesale are never mixed: not in one cart, not in one admin list.

**The one example set used in this whole tutorial:**

| Thing | Value |
|---|---|
| Store | "Sample Store" (Bihar, state code 10), batch tracking ON |
| Retailer | Ravi Sharma, shop "Sample Kirana", GSTIN `10ABCDE1234F1ZF` |
| Retail product | "Sample Biscuit 50g", ₹10, barcode on the wrapper |
| Pack (Tutorial B) | "Sample Biscuit 50g - Pack of 10", ₹95 (₹9.50 per piece) |
| Wholesale-only product (Tutorial A) | "Sample Biscuit 50g Carton", ₹449, tiers 10+ = 2% off, 15+ = 5% off |

> **Warning about GSTINs.** `10ABCDE1234F1ZF` is a made-up number that passes the server's check (`packages/shared/utils/gstin.utils.js`). Do not make up your own GSTIN: the last character is a check digit, and the server refuses invalid ones (the apply call returns 400 "Please enter a valid GSTIN"). A Bihar GSTIN (starts with 10) gives a same-state invoice (CGST + SGST). A GSTIN from another state gives a cross-state invoice (IGST).

## 3. Before you start

Everything is OFF by default. Do the rows in order.

**Developer / server tasks (never in the admin panel)**

| # | Task | Detail |
|---|---|---|
| D1 | Storage rules, document bucket, invoice privacy | `runbook-wholesale-rollout.md` steps 1-5 |
| D2 | Build the pack indexes **before** the backend deploy | Runbook step 6 |
| D3 | Deploy backend, then admin, then apps, all switches OFF | Runbook steps 9-11 |
| D4 | Install the new picker build on **every** picker device of the store | Runbook step 12. Must be done before A4. |
| D5 | Turn on `RETAILER_APPLICATIONS_ENABLED=true` on the user API, restart with `--update-env` | Runbook step 15. Do last. |

**Admin-panel tasks**

| # | Task | Who | Where | You should see |
|---|---|---|---|---|
| A1 | Give "Retailers - Approve / reject" to named managers only | Store admin or super admin | People > **Team** > **Add Team Member** or Edit > Permissions grid, row **Retailers**, box **Approve / reject** | The person sees **Retailers** in the sidebar after logging in again |
| A2 | Set a valid store GSTIN | Super admin | Settings > **Stores** > pencil **Edit Store** > **GSTIN \*** | Saves |
| A3 | Turn on batch tracking | Super admin | Same form, tick **Batch tracking (FEFO + per-lot cost / expiry) for this store** | Saves |
| A4 | Turn on wholesale (only after D4) | Super admin | Same form, tick **Wholesale for retailers**, **Save Store** | Saves. Refusals below. |

Refusal messages on A4 (from `packages/admin/src/routes/store/controller.js`):
- Batch tracking off: "Turn on batch tracking for this store before enabling wholesale."
- GSTIN missing or wrong: "Add a valid store GSTIN before enabling wholesale. Retailers need it on their GST invoice."
- While wholesale is ON, GSTIN and batch tracking are locked: "Locked while wholesale is on. Turn wholesale off to change it."
- You can tick batch tracking and wholesale in the same save.

**Why D4 comes first.** An old picker app cannot tell a pack line from a singles line of the same biscuit. It shows "Already done" on the pack line, and the order cannot be picked properly. The server does not check the picker version. The picker build has no new version number to look for (`versionName "1.0.0"`). To check a device, open an order with a pack: the new build shows the pill "1 pack = 10 pcs".

**Credit ("pay later") is not built.** Its switch in the admin says "Coming soon" and the server refuses it.

## 4. Who can do what

Checked in `haper-admin/src/hooks/useMenu.ts`, `src/utils/permissions.ts`, `haper-backend/packages/admin/src/routes/{retailer,product}/router.js`.

| Task | Super admin | Store admin | Manager / Support | Warehouse roles |
|---|---|---|---|---|
| See **Retailers**, approve, reject | Yes, all stores | Yes, own store only | Only if "Approve / reject" is ticked on Team | No. The server answers 403 (no store), even if granted |
| Suspend, reinstate, COD switch, unblock GSTIN | Yes | No | No | No |
| **Product Master** (new product, tiers, Assign, Barcode, Discontinue, Delete) | Yes | No | No | No |
| **Size groups** page | Yes | No | No | Warehouse manager can open it, but cannot add packs |
| Add wholesale pack | Yes | No | No | No |
| **Stores** page (store toggle, batch tracking) | Yes | No | No | No |
| **Items** > Edit price, shelf, Stock In | Yes | Yes, own store | Depends on their Items permissions (confirm on dev) | No |
| Cost Price field and "Cost / unit (₹)" on Stock In | Yes | Hidden | Hidden | Hidden |
| **Team** page | Yes | Yes | No | No |

The frontend and backend use the same rule: super admin and store admin always pass a permission check; manager, support and warehouse roles need the permission in their list.

## 5. Quick start

**5A. New wholesale-only product (10 lines)**
1. Section 3 done for the store.
2. Catalog > **Product Master** > **New product**.
3. Name `Sample Biscuit 50g Carton`, unit, weight, GST, category.
4. Tick **Wholesale-only item**.
5. **HSN code (optional)**: `1905`.
6. **Barcode**: the carton's own code, or blank.
7. Save. Open it again (Edit) and add **Bulk discounts**: 10 units 2%, 15 units 5%. Save.
8. Catalog > **Items** > **Wholesale** > Edit the carton > **Selling Price** `449`, **Price (MRP)** `449`, **Shelf Location**. **Save Item**. Repeat per store.
9. Same row > **Add received inventory** > **Stock In** > quantity, batch, expiry > **Add Stock**.
10. Android, as Ravi: **Haper Business** > the carton shows a "Bulk price" table.

**5B. Existing product gets a pack (10 lines)**
1. Section 3 done for the store.
2. Catalog > **Size groups** > open the biscuit's group, or **New size group** with the biscuit.
3. **Add wholesale pack...**
4. **Base item** Sample Biscuit 50g, **Units per pack** `10`, other fields blank.
5. **Add pack to group**, then **Save group**.
6. Product Master > **Wholesale** > the pack row > **Assign** > the store > **Price (MRP)** `95`, **Selling price** `95` > **Assign**.
7. Do NOT stock the pack. Stock the single biscuit as usual.
8. Optional: Product Master > Wholesale > pack row > **Edit** > Bulk discounts.
9. Android, as Ravi: **Haper Business** > "Sample Biscuit 50g - Pack of 10", "₹9.50 per piece".
10. Normal customers still see only the single biscuit at ₹10.

## 6. Get a retailer approved

**6.1 In the app, as the customer (Android, iOS or web)**

| # | Do | You should see |
|---|---|---|
| 1 | Open **Profile** | First row of "Your account" (Android): "Become a retailer / Buy in bulk at wholesale prices" |
| 2 | Tap it. Fill shop name, legal name, owner name, business type, GSTIN, shop address, map pin, PIN | GSTIN shows a green tick and "Registered in <state>". Wrong GSTIN: an error under the field |
| 3 | Add a shop photo (required). GST certificate optional | Photo in the tile |
| 4 | Submit | Status screen: "Under review" |

The "Become a retailer" row shows only when **both** are ON: the server switch (D5) **and** the store toggle (A4). On web the pages are `#/retailer/apply` and `#/retailer/status`.

**6.2 In the admin**

| # | Do | You should see |
|---|---|---|
| 1 | People > **Retailers** > tab **Pending** (oldest first) | Ravi's row, "Waiting" column (amber after 2 days) |
| 2 | Click the row | Detail with Application, Documents, **GST check**, History |
| 3 | Look at the photo. Click **Check on GST portal**. Check the legal name and status by hand | Portal opens in a new tab |
| 4 | Tick **I checked the legal name and active status on the GST portal** | **Approve** becomes clickable (before: tooltip "Tick the GST check first") |
| 5 | Click **Approve** | Toast "Approved - Sample Kirana can now see wholesale items" |
| 6 | Optional, super admin only: card **Cash on delivery for wholesale orders** > switch ON > **Save payment options** | Toast "Payment options saved" |

- No push or SMS is sent on approve or reject (no notification code in the retailer routes). Ravi sees the new status when he opens Profile or the status screen.
- Wholesale reaches Ravi within about 60 seconds (viewer cache `VIEWER_CACHE_TTL_SEC = 60`).
- Approval is global: Ravi sees Haper Business in every store with the toggle ON.

**6.3 What Ravi sees after approval (Android)**
- A switch "Haper | Haper Business" at the top of the green Home header.
- Tap **Haper Business**: the header turns plum, the eyebrow reads "HAPER BUSINESS", search reads "Search wholesale items...", and the first time only a snackbar "You're in Haper Business. Only wholesale items here."

## 7. Tutorial A: a NEW wholesale-only product

Example: "Sample Biscuit 50g Carton", sold only to retailers. Who: super admin.

| # | Do | You should see |
|---|---|---|
| 1 | Catalog > **Product Master** > **New product** | Dialog "New product" with "Products with a barcode are automatically added to all active stores and the warehouse..." |
| 2 | Fill **Name \***, **Unit \***, weight, GST, category | |
| 3 | Under **Wholesale**, tick **Wholesale-only item** | Helper "Hidden from customers who are not approved retailers." A **Bulk discounts** block appears |
| 4 | **HSN code (optional)**: `1905` | Helper "Needed on GST invoices to retailers. 4 to 8 digits." `190` gives "Use 4 to 8 digits" and blocks Save |
| 5 | **Barcode**: the carton's own printed code, or blank | See 7.1 |
| 6 | Bulk discounts: **Add tier**, "From 10 units 2 % off", **Add tier**, "From 15 units 5 % off" | Counter "2 of 5 tiers". Preview: "Store price preview is available once the product is saved." |
| 7 | Save | Toast "Product created" (or a warning if not auto-added, see 7.1) |
| 8 | Set the price in each store (section 9) | Selling Price ₹449 |
| 9 | Set the shelf: Items > Wholesale > **Edit** > **Shelf Location** `R2-S5` > **Save Item** | The picker needs it to find the carton |
| 10 | Stock in: same row > icon **Add received inventory** > **Stock In** > **Quantity to add** `40`, **Batch no.** (blank = named automatically), **Expiry**, (super admin) **Cost / unit (₹)** `400` > **Add Stock** | Row shows 40 in stock |
| 11 | Edit the product again in Product Master to check tiers | Preview table per store with bands "1 to 9 units", "10 to 14 units", "15+ units" |
| 12 | Android, as Ravi: **Haper Business** | The carton shows. In **Haper** it is gone |

**7.1 Barcode rules**
- A product with a barcode is auto-added to **every active store** and the warehouse at **quantity 0, price 0, cost 0** (`assignToStores` in `packages/shared/repositories/product.repository.js`). This includes stores where wholesale is OFF. The form says "automatically added" but does not say "price 0".
- A ₹0 item is hidden from every customer and retailer (see 12.3). So nothing is sold until you set a price.
- Typing a barcode another product has: "A product with barcode <code> already exists — "<name>" (iId <id>). Edit that product instead of creating a duplicate."
- Same name, weight and unit as an existing product is also refused: "... already exists as iId <id>. Edit it instead of creating a duplicate."
- No barcode: nothing is auto-added. You get a warning "Product created, but not auto-provisioned. No barcode set — nothing was auto-provisioned. Add a barcode, then use Assign." Use **Assign** (section 9). The **Generate** button mints an internal barcode; after that the product is auto-added at price 0 like any barcode product.
- Never reuse the single biscuit's barcode for the carton.

**7.2 Bulk discount rules (form messages, `pages/Products/productForm.ts`)**

| Rule | Message if broken |
|---|---|
| Up to 5 rows | "+ Add tier" is disabled at 5 |
| Quantity: whole number 2 to 100000 | "Whole number from 2 to 100000" |
| Percent: above 0, at most 50 | "Use a percent above 0 up to 50" |
| At most 2 decimals | "Use at most 2 decimals" |
| Quantity goes up row by row | "Quantity must be higher than the row above" |
| Percent goes up row by row | "Discount must be higher than the row above" |
| No two rows with the same quantity | "Two tiers can't start at the same quantity" |

- With any error, Save is disabled and the footer reads "Fix the errors above to save."
- Counting is per cart line, in the item's own unit (cartons here, packs for a pack). The highest tier reached wins.
- **Below-cost warning:** if a tier price is under a store's cost, a red box "Some stores would sell below cost" lists Store, Tier, Tier price, Cost, Short by. Tick **I understand these tiers sell below cost in the stores above** to save ("Tick the box above to save."). Editing a tier clears the tick. It is a warning only; the tier still applies. It is checked only when you save tiers; a later cost rise is not re-checked.
- Example: cost ₹430, 5% tier = ₹426.55, short by ₹3.45.
- Unticking **Wholesale-only item** with tiers opens "Remove the bulk discounts too?" with **Keep wholesale-only** (default) or **Remove discounts**.
- A retail product never shows the Bulk discounts block. The server refuses tiers on it: "Bulk tiers need a wholesale-only product or a pack."

## 8. Tutorial B: an EXISTING product gets a wholesale pack

Example: "Sample Biscuit 50g" sells to normal customers at ₹10. Ravi wants "Pack of 10". Who: super admin.

**What a pack is:** a second product that points at the single. It has no stock of its own. The shelf holds 32 biscuits: the pack shows 3 available (32 ÷ 10, rounded down). Selling 1 pack takes 10 biscuits.

Packs are created **only** from Size groups. There is no pack button in Product Master.

| # | Do | You should see |
|---|---|---|
| 1 | Catalog > **Size groups** > open the group with the biscuit, or **New size group** | Dialog "New size group" or "Edit size group - <name>" |
| 2 | New group: **Name**, search, add "Sample Biscuit 50g" | Row in "Sizes" |
| 3 | Click **Add wholesale pack...** | Mini-form "Add wholesale pack". Disabled with tooltip "Add a retail size first" if no retail row |
| 4 | **Base item**: Sample Biscuit 50g. **Units per pack**: `10` | Wrong units: "Units must be a whole number from 2 to 10000." |
| 5 | **Pack name (optional)**: blank = "Sample Biscuit 50g - Pack of 10" | |
| 6 | **Carton barcode (optional)**: blank (see 8.1) | |
| 7 | **Pack price, Rs (optional)**: `95` | Used for warnings only. It is NOT saved as the price |
| 8 | **Add pack to group** | Row with tag "Wholesale pack", lock, "x10", label "Pack of 10", default radio disabled ("A wholesale pack can't be the default size"). Nothing is created yet |
| 9 | **Save group** | The pack is created, then the group is saved. Warnings may show (below cost, dearer per piece than singles, base stock under 10). They do not block |
| 10 | Assign with a price (section 9). Packs are **never** auto-added | "A wholesale pack is never auto-provisioned. Use Assign and set its price per store." |
| 11 | Optional tiers: Product Master > **Wholesale** > pack row > **Edit** > Bulk discounts | The block shows without ticking anything |
| 12 | Android, as Ravi, in Haper Business | "Wholesale" pill, "₹9.50 per piece". Not in Haper mode |

**Group size rule.** The form needs "at least 2 sizes" (`variantGroupForm.ts`), and the server needs "at least 2 products" (`variant-rules.utils.js`). Both count the pack. So **one retail size + one pack is enough**. The default size must be a retail size.

**8.1 Pack barcode**
- The picker scans the single's barcode for both the single and the pack. So leave it blank, unless the carton has its own printed code.
- Same as the single: "A pack's carton barcode can't be the base item's barcode."
- Used by another product: "This barcode is already used by another product."

**8.2 Stock rules for a pack**
- Stock in, adjust, transfers, replenishment: on the **single** only.
- The Items list still shows the stock icon on a pack row. The server refuses Stock In with a 409: "This is a wholesale pack: its stock come from the base item. Change the base item instead." (The server's wording has a grammar slip, "stock come". Search for it as written.) Editing the quantity fields on a pack's Edit form gives the same sentence with those field names in place of "stock".
- Pack Edit (Items): note "This is a wholesale pack of 10 x item <id>...". Quantity, Cost Price, Low Stock Warn Qty, Max Stock, Reorder Qty, brand, size, GST and category are greyed. Price (MRP) and Selling Price save.
- Pack GST and HSN copy from the single every time the single changes.
- Leave the pack's Shelf Location blank: the picker uses the single's shelf.
- POS (New Sale) refuses packs and wholesale-only items.

## 9. Setting and changing the price per store

| Situation | Where | Steps |
|---|---|---|
| Row already exists in the store (any product with a barcode, auto-added at ₹0) | Catalog > **Items** | Pick the store in the top-bar store selector. **Wholesale**. Find the row. **Edit** (pencil). **Price (MRP) \*** and **Selling Price \***. **Save Item**. |
| Row does not exist yet (packs; products without barcode) | Catalog > **Product Master** (super admin) | **Wholesale**. Row > **Assign**. **All stores** or **Pick stores**. **Price (MRP)**, **Selling price**, **Low-stock qty**. **Assign**. Result "Assigned N · skipped M". |

- **Assign never changes an existing row.** "Stores that already carry it are skipped." Use Items > Edit for those.
- A pack is skipped in stores that do not carry the single.
- A store admin can set prices for their own store in Items. Only a super admin can Assign.
- After a barcode product is auto-added, a store admin must, per store: set **Selling Price** and **Price (MRP)**, set **Shelf Location**, and stock it in. Stores with wholesale OFF also get the row at ₹0; it stays hidden (₹0 and wholesale-only). Leave it or set its status to INACTIVE by clicking the **ACTIVE** pill in the Items list.
- Use the **Unpriced** button on Items to list ₹0 rows ("Items priced at ₹0 are hidden from customers until fixed").

## 10. The admin lists: Retail | Wholesale

- **Product Master** and **Items** have a **Retail | Wholesale** switch. Default **Retail**. The choice is kept for the browser tab.
- Wholesale shows wholesale-only products and packs, with "Showing wholesale products only." (Product Master) or "Showing wholesale items only." (Items).
- Search in the wrong view shows: "Looking for a wholesale product? Switch to Wholesale."
- Items header totals follow the switch. Packs count as items, not as stock value.
- The Items **Shelf** filter starts at "All" in Wholesale (packs have no shelf).
- **Missing Barcode** in Wholesale lists wholesale-only items without a barcode. Packs never appear (a blank pack barcode is normal).
- Empty Wholesale list: "No wholesale products yet. Add a pack from a product's size group or tick Wholesale-only on a product."

## 11. A retailer's order, end to end

**11.1 The flow**

For testers using the API: ask for Business mode with the request header `x-shop-mode: business`. Without it the retailer gets the normal shop.

| # | Who | Do | You should see |
|---|---|---|---|
| 1 | Ravi (Android) | **Haper Business**, add 12 cartons | Cart title "Business cart". His Haper cart is separate and unchanged |
| 2 | Ravi | Checkout, pay online | Order placed. COD only if his switch is ON |
| 3 | Staff | Sales & Orders > **Orders** | A "Retailer" pill with a masked GSTIN, e.g. `10••••••••••1ZF`. The admin screen masks it even though the admin API sends the full number |
| 4 | Picker | Pick (see 12.5 for pack lines) | Carton line as a normal line; pack lines show "1 pack = 10 pcs" |
| 5 | Rider | Deliver | Riders never see the GSTIN or shop details |
| 6 | Ravi or staff | **Download invoice** on the delivered order | B2B tax invoice (12.5) |

**11.2 The price maths (worked once, in plain words)**

The carton costs ₹449. Tiers: 10+ = 2% off, 15+ = 5% off. Ravi has 12 cartons in one cart line.
1. 12 is 10 or more, but less than 15, so the 2% tier applies.
2. 2% of ₹449 is ₹8.98.
3. Price each = ₹449 - ₹8.98 = **₹440.02**. (The server works out 449 x 0.98 and rounds to the nearest paisa: `round2` in `packages/shared/utils/wholesale-tier.utils.js`. ₹92.625 would become ₹92.63.)
4. Line total = ₹440.02 x 12 = **₹5,280.24**.
5. Saving = ₹8.98 x 12 = ₹107.76. The bill's "Discount" row shows it.

| Quantity | Tier | Price each | Line total | Saving |
|---|---|---|---|---|
| 9 | none | ₹449.00 | ₹4,041.00 | ₹0 |
| 12 | 10+ = 2% | ₹440.02 | ₹5,280.24 | ₹107.76 |
| 15 | 15+ = 5% | ₹426.55 | ₹6,398.25 | ₹336.75 |

- The app writes `₹440.02`, `₹5280.24` (no comma; paise only when not whole).
- At 12 the cart says "Add 3 more for 5% off". At 9: "Add 1 more for 2% off". At 15: "Best bulk price applied". The Android app builds these hints; the API does not send them.
- **Checked on the sandbox (different example prices):** a carton at ₹1,150 with tiers 10+ and 15+ gives ₹1,127 each at 10 or more packs and ₹1,092.50 each at 15 or more. A cart with 12 cartons (2% off) and 3 packs (3% off) shows a tier discount of ₹288.60 in total, with the labels "2% OFF bulk" and "3% OFF bulk". A pack shows "₹14 per piece".
- A COD order from a retailer is refused until a super admin turns that retailer's COD switch ON.
- Delivery and platform fees are added on top as for any order.
- A selling price with more than 2 decimals (e.g. ₹449.555) gets **no** tier at all. A tier that would make the price below ₹1 is ignored.

## 12. Edge cases

Format: situation → what the user sees → what to do.

### 12.1 Retailer lifecycle

| Status | Meaning | App shows (Android) | Admin can |
|---|---|---|---|
| Pending | Waiting for review | "Under review", "Withdraw application" | Approve, Reject |
| Approved | Can buy wholesale | "Retailer" chip on Profile; Home switch | Suspend, COD switch (super admin) |
| Rejected | Needs changes | Reason, note, "Edit and resubmit" | Read only |
| Suspended | On hold | "Wholesale access on hold", reason, "Contact support" | Reinstate (super admin) |
| Withdrawn | Customer pulled it back | Back to "Become a retailer" | Read only |

1. **Reject → resubmit.** Ravi taps **Edit and resubmit**. The form is pre-filled. If nothing changed: "Change something first - we can only re-review an updated application." Reason "Shop photo is unclear" asks for a new photo. Other reasons keep the old photo.
2. **5 applications in 30 days.** The 6th is refused. Android: "You've reached the limit of 5 submissions in 30 days. Try again later, or contact support." Withdrawing does not give a try back.
3. **Too many tries in an hour.** More than 10 submit attempts in an hour (failed ones count): "Too many attempts. Try again later."
4. **Documents.** Photo: JPG, PNG or WebP, max 10 MB, re-saved as JPEG (location data removed). Certificate: image or PDF (up to 5 pages), max 10 MB. Wrong type: "This file is not a supported image. Please upload a JPG or PNG."
5. **Withdraw.** Only while Pending. The GSTIN is freed. An approved retailer cannot withdraw.
6. **Suspend.** Super admin > **Suspend** > reason (shown to the customer) > tick "I understand wholesale access stops immediately". Within about 60 seconds Ravi's Business screens fall back to Haper with "Haper Business isn't available right now." Business cart checkout is refused at once ("Out of stock: <name>. Please remove this item from your cart to continue."); checkout reads the profile fresh. His Business cart is hidden, not deleted (carts last 12 hours). **Reinstate** brings it back.
7. **Scheduled order with wholesale + COD, then suspended or COD switched off.** At release time it is held (not cancelled). The store admin gets one push "Scheduled order #... held". Fix the cause; the next 2-minute tick releases it.
8. **Applications switched off (D5 = false).** New applications get "Retailer applications are not open yet. Please try again later." (Android: "Wholesale applications are unavailable right now..."). Existing applicants still see status and can withdraw.

### 12.2 GSTIN rules

1. **Format.** 15 characters: 2-digit state code + 10-character PAN + entity number + "Z" + check character. Lowercase and spaces are fixed automatically. Android messages: wrong shape "That doesn't look like a GSTIN...", bad state "First two digits aren't a valid state code.", bad check "Check the last character - this GSTIN doesn't add up."
2. **One GSTIN, one live application.** A GSTIN held by a Pending, Approved or Suspended profile is taken. Server: "This GSTIN is already registered. Please contact support." Android shows under the field: "This GSTIN is already registered. Contact support if it's yours." with a support link.
3. **Someone used another shop's GSTIN.** If the squatter is Pending: reject with reason **This GSTIN belongs to another business**. The GSTIN is freed at once; the squatter is blocked from it for ever. If the squatter is Approved or Suspended: hand to support (not fixable from the reject button).
4. **Blocked GSTIN.** The blocked user gets "This GSTIN cannot be used with your account. Please contact support." Note: the Android form does not map this reason, so it shows the generic "Couldn't submit your application. Please try again." (`RetailerLogic.kt` `mapSubmit`). Confirm on dev.
5. **Unblock (super admin only).** People > Retailers > open the profile > card **Blocked GSTINs** > **Unblock** > reason > tick > confirm. Store admins see "Only a super admin can unblock."
6. **Account deletion does not block a GSTIN.** The nightly purge (test guide: about 30 days after deletion; confirm on dev) empties the profile and frees the GSTIN. Until then the GSTIN still counts as taken.

### 12.3 Product and pack edge cases

| Situation | What happens | What to do |
|---|---|---|
| Item or pack at price 0 or no price in a store | Hidden from everyone, retailers too. Add: "Item not found or out of stock". Stale cart at checkout: "Price not available: <name>. Please remove this item from your cart to continue." (`item-visibility.utils.js`, `cart.repository.js`, order controller) | Set Selling Price (section 9) |
| Pack never assigned to the store | No store row, so it does not exist there | Assign it (section 9) |
| Single biscuit out of stock | Pack shows 0 (sold out); cannot be added | Stock in the single |
| Single biscuit set INACTIVE in the store | Pack shows 0 at once | Re-activate the single |
| Wholesale-only item with no stock | Cannot be added ("Item not found or out of stock"). Whether lists show it as sold out or hide it: confirm on dev | Stock in |
| Packs and singles of the same biscuit sold | With separate carts, one new order holds packs OR singles, not both. Both kinds come off the same shelf. A mixed order can still exist (an old cart from before Business mode; an admin order edit: confirm on dev). Then the picker scans the same barcode twice (singles first) | 12.5 |
| Change the units of a pack (10 → 12) | Not allowed. Units are locked in the group; the server refuses a change | Discontinue the old pack, then add a new one. If the group will not save because the old pack "is not active", remove its row first (confirm on dev) |
| Discontinue the single that has packs | Its packs are discontinued too; pack store rows go INACTIVE. The single's own store rows stay ACTIVE. Re-activating the single does NOT bring the packs back | Re-activate each pack (row "Re-activate a pack") |
| Discontinue a pack | Product Master > Wholesale > **Discontinue** > confirm. Its store rows go INACTIVE | |
| Discontinue a wholesale-only product (the carton) | The master is discontinued, but its store rows stay ACTIVE and can still sell (`retirePacksOf` only touches packs) | Also set each store row INACTIVE: Items > Wholesale > click the **ACTIVE** pill |
| Re-activate a pack | **Activate**. Refused while the single is discontinued, or while another live pack of the same units exists. Its store rows stay INACTIVE | Items > Status filter **Inactive** > click the **INACTIVE** pill per store |
| Delete a product that has packs | "This product has wholesale packs and cannot be deleted. Delete its packs first, or use Discontinue instead." | Use Discontinue |
| Make a pack the default size | Not offered; server: "Default size must be a retail size" | |
| Barcodeless wholesale-only product | Not auto-added; picker cannot scan it | Assign by hand. Picker uses "Confirm without scan (override)", or **Generate** a barcode |
| HSN blank | Allowed. Invoice prints `-` with a footnote | Add HSN later in Product Master |
| HSN wrong (`190`, `12AB`) | "Use 4 to 8 digits"; Save blocked | |
| Product sold at retail AND has tiers | Not possible: tiers need "Wholesale-only" or a pack. A pack can have tiers while its single sells at retail | Put tiers on the pack |

- Adding a wrong-cart item, a hidden item, or any item while the store toggle is OFF returns the same message: "Item not found or out of stock". It does NOT always mean the item is out of stock.
- A normal customer who opens a wholesale item directly by its id gets an empty item (it stays hidden), not an error.

The Android item page shows "Wholesale" pill, the "Bulk price" card ("Buy more, pay less on every pack.") and the note "Wholesale price. No coupons or discounts apply."

### 12.4 Ordering edge cases

| Situation | What the retailer sees | What to do |
|---|---|---|
| Store toggle turned OFF while Ravi has a Business cart | Within about 5 seconds the server serves Haper. Android flips to Haper with "Haper Business isn't available right now." Business checkout refused. Cart kept 12 hours (hidden) | Turn the toggle back on, or Ravi buys at retail |
| Item out of stock, set INACTIVE or priced ₹0 while in the cart | Next cart load: the line is removed silently, or lowered to the stock left (`user/src/routes/cart/controller.js`). If it changes between cart and checkout: "Out of stock: <name>. Please remove this item from your cart to continue." | Add it again when back |
| Quantity above stock (Business) | App stops first: "Only 40 packs available". Stale app, server: "You already have 30 of <name> in your cart. Only 20 available." | Lower the quantity |
| Retail and Business in one order | Impossible. Two carts; an order takes only the cart you pay from | Two orders |
| More than 6 of one pack | Allowed on Android, up to stock. Retail items still stop at 6 | |
| Cash on delivery | Online always works. COD only if the super admin ticked "Cash on delivery for wholesale orders". Otherwise COD is hidden with "Cash on delivery isn't enabled for wholesale orders on your account. Pay online." Server: "...Please pay online." | Super admin turns it on, or pay online |
| Online payment fails | No paid order. Unpaid orders are released and stock goes back. Tapping Pay again works | |
| Two "Place order" taps at once | One order. The other: "Your order is already being placed. Please wait a moment." (Android dialog title reads "Payment Failed"; known wording issue) | Wait |
| Coupon | Business cart has no coupon row. A coupon on wholesale lines: "We couldn't apply this coupon right now — try another one?" (never says "wholesale") | The tier is the only discount |
| Store-wide sale, free gift, referral | Never apply to wholesale lines. No gift offer in Business | |
| Minimum order | None. (The store's minimum is only for free delivery) | |

### 12.5 After the order

1. **Cancel or edit before delivery.** A store admin can cancel or edit as usual. Edits keep the tier price (12 → 9 cartons keeps ₹440.02). Adding a wholesale line to a normal customer's order is refused.
2. **After delivery the order is locked.** A retailer order ever delivered (delivery date or invoice number) cannot be cancelled, refunded, reversed, moved to Undelivered or edited by a store admin: "This retailer order was delivered with a GST invoice. Only a super admin can cancel or refund it until credit notes are available." A super admin can; each step is audited. The picker app also refuses out-of-stock and short pick on such an order.
3. **This lock also covers retail-only orders** of an approved retailer at a store with wholesale ON (those orders carry the retailer details too).
4. **Rider marks "Undelivered".** A never-delivered order: normal automatic refund. An order that was delivered before (super admin reversed and reopened it): stock goes back but the wallet refund is **held**, and Order Activity shows `order.retailer_delivered_refund_held`. A super admin must issue the refund by hand from the order (exact screen: confirm on dev).
5. **Picking a pack line.** Card: pack name, "1 pack = 10 pcs", "Item inside: Sample Biscuit 50g", "Qty: 3 packs (30 pcs)", stepper "Packs found", button "Pick 3 packs".
   - Scan-anything on a mixed order (singles + packs sharing one barcode, rare now): scan once (singles verified), move the camera away about 2 seconds, scan again (pack verified).
   - Short pick (2 of 3): field "Loose pieces left on shelf (optional)". Blank sets the single's stock to 0. A number sets it to that count, minus pieces other open orders still need. Enough loose pieces for a whole pack: "That's enough loose pieces to make a full pack of 10. Pick that pack instead, or recount the loose pieces."
   - The missing pack is taken off the order and refunded as usual.
6. **Old picker build** (D4 skipped): the pack line shows "Already done" and cannot be verified in scan-anything. Install the new build, keep the toggle OFF until then.
7. **B2B GST invoice.** Same **Download invoice** button. Contains "TAX INVOICE / Original for recipient", store and buyer GSTIN, legal and trade name, place of supply, "Reverse Charge: No", HSN column, CGST + SGST (same state) or IGST (other state), tax summary per rate, delivery and platform fee lines at 18%, wallet coins as a payment. Lines use the **paid** price (₹440.02). A pack line reads "Sample Biscuit 50g - Pack of 10 = 30 pcs".
8. **Invoice refused.**
   - Not delivered: "Invoice is only available for delivered orders" (HTTP 400).
   - Store GSTIN removed: "This store has no GSTIN set, so a GST (B2B) invoice cannot be issued. Add the store GSTIN and try again." Android, iOS and web show this message.
   - Amounts do not add up: "...the GST invoice can't be issued. Please contact support."
9. **Re-download.** Same PDF from a 24-hour private cache. After any order change, a fresh PDF.
10. **Reports.** Profit = (paid price - cost) x quantity. A pack's cost = the real batch cost of its pieces. Referral money counts retail lines only.

## 13. Switching off and rolling back

| Switch off | Who | What retailers see | Data that stays |
|---|---|---|---|
| Store toggle "Wholesale for retailers" | Super admin, Stores > Edit Store | Within about 5 seconds, Haper only. Android Business switch hidden; a user in Business flips to Haper with the snackbar. Business checkout refused | Profiles, products, packs, prices, Business carts (12 h), orders, invoices |
| Server switch `RETAILER_APPLICATIONS_ENABLED=false` + restart | Developer | No "Become a retailer". **Also hides the Android Business switch for approved retailers** (the app needs both switches, `RetailerLogic.kt`). What a retailer already in Business mode sees: confirm on dev | Everything; applicants keep status and withdraw |
| Suspend one retailer | Super admin | That retailer only, within about 60 seconds | Profile and history |

- Level 1 rollback = the two switches above. Packs restock correctly on cancel.
- A code revert after packs exist is NOT safe without the runbook's "Level 3" step (developer task, runbook "Rollback").

## 14. Which app has what

From `client-followups.md` and the code. **No client has been tested on a device or browser.**

| Feature | Android | iOS | Web | Picker | Admin |
|---|---|---|---|---|---|
| Apply form + status | Built | Built | Built | - | Retailers page |
| Haper Business switch, Business cart | Built | Not started | Not started | - | - |
| Bulk price table, "2% OFF bulk", nudge, Set quantity | Built | Not started | Not started | - | Bulk discounts block |
| Packs past 6 per line | Built (up to stock) | - | - | - | - |
| Hide COD for wholesale | Built | Built (only reachable with Business) | Built (same) | - | COD switch |
| Invoice download (B2B for retailer orders) | Built | Built | Built | - | Orders, Invoices |
| Pack lines, loose pieces | - | - | - | Built (new build) | - |

- On iOS and web an approved retailer sees only the normal shop. They can still download the B2B invoice of an order placed on Android.

## 15. Common problems and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| "Become a retailer" row missing | Server switch or store toggle OFF | Section 3, D5 and A4 |
| No Haper Business switch for an approved retailer | Store toggle or server switch OFF; old app; iOS or web | Check both switches; update Android; wait about a minute |
| GSTIN refused on the form | Wrong check character (a made-up GSTIN fails the check digit) | Section 2 warning |
| Normal customer sees a wholesale item | Should never happen | Stop. Tell the developer |
| Retailer cannot see or add a pack | Not assigned, price 0, single out of stock or inactive | Sections 9, 12.3 |
| Pack stock looks wrong | Pack = single's stock ÷ units, rounded down | Fix the single |
| "This is a wholesale pack: its stock come from the base item. Change the base item instead." | Stock action on a pack row | Stock the single |
| Assign did not change the price | Assign skips existing rows | Items > Edit |
| Items > Wholesale empty | Not assigned, or a filter | Reset filters; Shelf "All" |
| Picker shows "Already done" on a pack line | Old picker build | Install the new build |
| "Cash on delivery isn't enabled for wholesale orders..." | Retailer COD switch OFF | Super admin turns it on, or pay online |
| Cannot change a delivered retailer order | Delivered-order lock | Super admin only |
| Invoice refused | Not delivered, or store GSTIN missing | 12.5 item 8 |
| Cannot turn wholesale on | Batch tracking off or GSTIN invalid | Section 3 |

## 16. Not built yet

- Credit (pay later) and credit notes. That is why delivered retailer orders are locked.
- A wholesale rail or list screen; a minimum order for Haper Business.
- Business mode on iOS and web; the web size sheet (web shows packs as plain products).
- Retailer-only coupons (decision pending).
- Push notification on approve or reject.

Sources: `runbook-wholesale-rollout.md`, `test-retailer-wholesale*.md`, `test-b2b-business-mode.md`, `test-picker-pack-lines.md`, `test-admin-wholesale-filter.md`, `client-followups.md`, `haper-backend/docs/reference/retailer-wholesale.md`, and the code paths named above.
