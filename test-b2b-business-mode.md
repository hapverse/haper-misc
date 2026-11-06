# Test: Haper Business mode + wholesale bulk tiers (master walkthrough)

**Status (2026-11-01):** dev only. Backend, admin and Android are built, **not committed and not deployed**. No device run of this walkthrough has been done yet. iOS and web have none of Business mode.
**Plan (approved):** `haper-misc/plan-b2b-business-mode.md` (acceptance criteria A1-A8, H1-H4, T1-T9 in section 1).
**Design:** `haper-misc/design-retailer-wholesale.md` section 12 (screens, copy, states).
**Related guides (each has a dated "Business mode update" section):** `test-retailer-wholesale-cart.md`, `test-retailer-wholesale-checkout.md`, `test-retailer-wholesale-discounts.md`, `test-retailer-wholesale-android-shop.md`.
**Android walkthrough (the same flows, as Android steps):** `test-retailer-wholesale-android.md` sections 7, 8 and 9.
**Client follow-ups (iOS, web, rest of Android):** the Haper Business block in `haper-misc/client-followups.md`.

**How to read the steps.**
- ✅ = this must be true. Tick it when you see it.
- ❌ = this must NOT happen. Tick it when you confirm it is absent.
- **Not built** = the app has no screen for it yet. This only applies to iOS and web. Do not mark it failed. Test the API part instead.

**Money on screen.** The Android app writes rupees as `₹1127` (no comma). Paise show only when not whole: `₹1092.50`. This guide writes `Rs 1,127` in its prose. When a step quotes screen text, it uses the app's form.

---

## 1. What this is (a real example)

Sample Kirana is a fictional shop. Its owner, Test Retailer One, is an **approved retailer**. The store he orders from has wholesale turned on.

The app now has two shops:

- **Haper** = retail items only. Every customer sees it, retailers too.
- **Haper Business** = wholesale items only (packs, bulk stock). Only approved retailers can enter it. It has its **own cart**.

Example. Test Retailer One has 3 x Atta 5 kg in his Haper cart, for his home. He switches to Haper Business and adds 12 x Maggi Pack of 100. He switches back: the Haper cart still shows only the 3 Atta. He switches again: the 12 packs are still there.

Bulk tiers example. The pack costs Rs 1,150. The admin sets two tiers:

| Packs in one cart line | Discount | Price per pack |
|---|---|---|
| 1 to 9 | none | Rs 1,150 |
| 10 to 14 | 2% off | Rs 1,127 |
| 15 or more | 5% off | Rs 1,092.50 |

12 packs = Rs 1,127 each. The line is Rs 13,524 (12 x 1,127). Without the tier it would be Rs 13,800. The saving is Rs 276 (12 x Rs 23).

## 2. Words used here

| Word | Plain meaning |
|---|---|
| Haper | The normal shop. Retail items only. |
| Haper Business | The wholesale shop. Approved retailers only. |
| Shop mode | Which shop the app is in. The app says so with the header `x-shop-mode: business`. |
| Effective mode | What the server actually served. The server echoes it back in the response header `x-shop-mode`. If the server says `retail`, the app is shown the Haper shop, even if it asked for Business. |
| Business cart | A separate cart used only in Haper Business. Clients never name it. |
| Tier | A bulk discount on one wholesale product. "10+ packs = 2% off". |
| Paid price | The price after the tier. It is what the order, invoice and refund use. |
| Bulk line | A cart line on a wholesale pack that has earned a tier. |

## 3. What is built and what is not (2026-11-01)

| Part | Backend | Admin | Android | iOS | Web |
|---|---|---|---|---|---|
| Two shops (visibility), own cart, banners and coupon list empty in Business | Built | n/a | Built (header, echo, mode memory) | Not built | Not built |
| Home switch + 6-state sheet | n/a | n/a | Built | Not built | Not built |
| Tier data, cart preview, checkout, order lines, invoice | Built | n/a | Built: discounted unit price, "2% OFF bulk" label, "Line total", "Add N more" nudge | Not built | Not built |
| Admin "Bulk discounts" block, live preview, below-cost warning | Built | Built | n/a | n/a | n/a |
| Item page "Bulk price" table (with "Add N" buttons) | Data ready (`wholesale.tiers`) | n/a | Built | Not built | Not built |
| Cart: "2% OFF bulk" label, "Add N more" nudge, Set-quantity sheet | Data ready | n/a | Built | Not built | Not built |
| Wholesale lines exempt from the 6-per-line cap (packs go up to stock) | n/a (the server has no 6 cap) | n/a | Built (`util/CartQuantityCap.kt`: packs use stock as the limit; retail still 6) | Not built | Not built |
| Order double-submit lock (`ORDER_IN_PROGRESS`) | Built | n/a | Shows the server message (no change needed) | Not built (check how the app shows a 422 from place-order) | Not built (same check) |

**What this means for testers.** On Android you can now put 10, 12 or 15 packs in one line, up to the stock. Test the full flow on the Android app. Use the API (section 10) only for header and payload checks.

**Not device-tested yet.** Every Android step in this guide is unchecked until a tester runs it on a device.

---

## 4. Test data (fictional only)

Create this once on **dev**. Use only the names below. Do not use real shop names, real GSTINs, real phone numbers or real emails.

| Thing | Value |
|---|---|
| Store | "Sample Store Test" on dev, `config.wholesaleEnabled = true`, retailer program on |
| Retailer account | Test Retailer One, shop "Sample Kirana", GSTIN `10ABCDE1234F1ZF` (fictional, checksum-valid; the same one the Android apply-form guide uses), status APPROVED, COD switch OFF (the default) |
| Normal account | Test Customer Two, no retailer application |
| Retail item A | "Atta 5 kg" (retail) |
| Retail item B | "Sample Noodles 70 g" (retail, Rs 14) |
| Wholesale pack | "Maggi Pack of 100" (wholesale-only pack, selling price Rs 1,150, cost Rs 1,000, stock 40) |
| Tiers on the pack | 10 packs = 2%, 15 packs = 5% (`wholesaleTiers`) |
| Wholesale item without tiers | "Biscuit Pack of 24" (wholesale-only, no tiers) |

How to set it up:
- Wholesale-only pack and its tiers: admin product form. See `test-retailer-wholesale-admin-packs.md` to create the pack from a product.
- Costs: admin item edit for the store. Set the pack cost to Rs 1,000 for the section 6 checks. Set it to Rs 1,100 for test T3, so the 5% tier sells below cost.
- Retailer approval and COD switch: admin Retailers page. See `test-retailer-wholesale-admin.md`.

## 5. Deploy and order

| Order | Part | Why this order |
|---|---|---|
| 1 | **Backend** (`user` and `admin` services, both ship `packages/shared`) | Everything else depends on it. Safe for normal customers. |
| 2 | **Admin** (`haper-admin`) | The tiers block sends `wholesaleTiers`. An older backend may reject that unknown key. Deploy the backend first. |
| 3 | **Android** (`haper-android`) | The switch, the mode header, the bulk table, the cart tier lines, the Set-quantity sheet and the pack cap exemption. |
| 4 | Test guides | This file and the four updated guides. |

**Behaviour change to know before deploying.**
- A normal customer on any app build sees the same shop as before. Nothing changes for them.
- A retailer on an **old** app build sends no header. The server serves Haper. So the retailer sees **no packs anywhere** until they update the app. Nothing wholesale is on prod yet, so this is accepted. (The brief said "backend alone is safe for old apps". That is true for normal customers only. Retailers on old builds lose their packs.)
- A retailer's old mixed cart (packs and retail in one cart from before this change) keeps its packs in Redis. In Haper mode the packs are hidden. Checkout charges only what is shown. See E4.
- Place-order can now answer HTTP 422 `ORDER_IN_PROGRESS` (note 4 in section 11). Check how each shipped client shows that before prod.

iOS and web follow-ups are in `client-followups.md`. Prod is a separate, user-run step. Nothing here changes prod.

---

## 6. Section A: Mode, visibility and carts (A1-A8)

Setup: Test Retailer One on the Android app (retailer). Test Customer Two on a second phone or in a second session. Use the API for the header checks (section 10).

### A1. Normal customer: nothing changes
- ✅ **A1.1** Home, categories, sub-categories, search and search chips show no wholesale item. No "WHOLESALE" pill anywhere. Look the same as before this change.
- ❌ **A1.2** Searching "Pack of 100" shows nothing. Opening the pack's item id on the item page does not show it (it says not found). Do not test by barcode: a pack shares its base item's barcode.
- ✅ **A1.3** The size sheet of "Sample Noodles 70 g" shows no "Pack of 100" row.
- ❌ **A1.4** The wishlist never shows a wholesale item.
- ✅ **A1.5** API: `GET /user/item/?page=1` with a normal token and no shop header. The response header `x-shop-mode` is `retail`. No item has a `wholesale` key.

### A2. Retailer in Haper mode: retail only
- ✅ **A2.1** Test Retailer One in Haper: the same lists as A1.1. No wholesale item.
- ✅ **A2.2** Add the pack's id to the Haper cart: refused with 404 "Item not found or out of stock". The cart does not change.
- ✅ **A2.3** API: every call returns `x-shop-mode: retail` when no header is sent.

### A3. Retailer in Haper Business: wholesale only
- ✅ **A3.1** Tap "Haper Business". Home lists wholesale items only. The section title reads "Wholesale for your shop".
- ✅ **A3.2** A category with no wholesale item is not shown as a tile. The tile counts and the "from Rs X" price count wholesale items only.
- ❌ **A3.3** Search "Atta" in Business: no result. No retail item appears on any Business screen.
- ✅ **A3.4** Add "Atta 5 kg" (retail) by its id in Business: refused with 404 "Item not found or out of stock".
- ✅ **A3.5** Add "Maggi Pack of 100" in Business: added. The cart title reads "Business cart". On Android you can go past 6 on a pack (see T11).

### A4. Each shop has its own cart
Setup: 3 x Atta 5 kg in the Haper cart. Then switch to Business and add 10 x Maggi Pack of 100.
- ✅ **A4.1** The Business cart shows 10 packs. No Atta.
- ✅ **A4.2** Switch to Haper. The cart shows 3 x Atta. No pack.
- ✅ **A4.3** Switch to Business again. The 10 packs are still there.
- ✅ **A4.4** Close the app fully and reopen it. The mode and both carts are unchanged.

### A5. Placing an order takes only that shop's cart
- ✅ **A5.1** In Business with 10 packs, place the order (pay online). The order contains only the packs. The Haper cart still shows 3 x Atta. Business cart is empty after the order.
- ✅ **A5.2** Switch to Haper, place an order. The order contains only the Atta. The Haper cart is empty after it.
- ❌ **A5.3** No new order contains both a pack and a retail item.
- ✅ **A5.4** Cash on delivery for a pack cart still follows the retailer COD switch. With the switch OFF, COD is refused for the pack cart (see `test-retailer-wholesale-checkout.md`).

### A6. Not a retailer, or store wholesale OFF: the app is shown Haper
- ✅ **A6.1** API: Test Customer Two sends `x-shop-mode: business` on `GET /user/home/items`. The response header is `x-shop-mode: retail`. No pack appears.
- ✅ **A6.2** Store with wholesale OFF, Test Retailer One sends `x-shop-mode: business`. The response header is `retail`. On Android the app flips to Haper and shows the snackbar "Haper Business isn't available right now." (on Home or on Cart; see H2.6).
- ❌ **A6.3** A spoofed header from a normal account never shows a pack (the server decides, not the header).

### A7. Suspended while in Business
Setup: Test Retailer One is in Business with 10 packs in the cart.
- ✅ **A7.1** Admin suspends Test Retailer One. Within about 60 seconds, every Business screen falls back. The next Business call returns `x-shop-mode: retail`. On Android the app switches to Haper with the snackbar "Haper Business isn't available right now."
- ✅ **A7.2** The packs are hidden in Haper, not deleted. The Haper cart shows only retail lines.
- ❌ **A7.3** Checkout of the Business cart is refused. No order is created and no stock moves. The refusal is the existing wholesale refusal ("Out of stock: <name>..."). The check reads the profile fresh, not the 60-second cache.
- ✅ **A7.4** Reinstate Test Retailer One. The 10 packs are back in Business (if the cart is under 12 hours old).

### A8. Business shows no retail banners, coupons, gift bar or print tile
- ✅ **A8.1** API: `GET /user/home/banners` with `x-shop-mode: business` returns `{"banners": []}`.
- ✅ **A8.2** Android Home: no banner carousel and no Print tile in Business.
- ✅ **A8.3** API: `GET /user/coupon/available` with `x-shop-mode: business` returns `{"coupons": []}`.
- ✅ **A8.4** API: the cart response in Business has no gift offer (`giftOffer.enabled` is `false`).
- ✅ **A8.5** The wallet strip still shows in Business. This is intended.

---

## 7. Section H: Home switch (Android)

### H1. When the switch shows
- ✅ **H1.1** Test Retailer One, program ON at the store: a segmented switch "Haper | Haper Business" sits at the top of the green Home header, above "DELIVERING TO".
- ❌ **H1.2** Program OFF for the store (`programEnabled` is false in `GET /user/retailer/me`): no switch at all. Home looks as before.
- ✅ **H1.3** Test Customer Two (not a retailer), program ON: the switch shows. Tapping "Haper Business" opens the "Apply now" sheet (H3).

### H2. Switching
- ✅ **H2.1** Test Retailer One, store wholesale ON. Tap "Haper Business". The header turns plum (top #6B3FA6, bottom #4A2580). The eyebrow reads "HAPER BUSINESS". The search hint reads "Search wholesale items...". Lists reload.
- ✅ **H2.1a** The snackbar "You're in Haper Business. Only wholesale items here." appears the first time on this install only. A later switch shows no snackbar.
- ✅ **H2.2** Tap "Haper". The green header returns. "Fresh picks" returns. Retail lists return.
- ✅ **H2.3** The cart title reads "Business cart" in Business. The floating bar reads "View Business cart", with a plum "Business cart" chip. The bar is white with a plum outline.
- ✅ **H2.4** A store with no wholesale items: the empty state reads "No wholesale items here yet" with a "Back to Haper" button.
- ❌ **H2.5** Switching never opens a blocking dialog. It is an instant change.
- ✅ **H2.6** Fallback snackbar: if the mode falls back to Haper while you are on Home or the Cart screen, "Haper Business isn't available right now." shows there. If you are on another screen (item page, checkout), it waits and shows the next time Home or Cart is on screen. It shows once per fallback.
- ✅ **H2.7** Tap "Haper Business" right after login, before the profile has loaded, when Business is available: the mode does NOT change, and the snackbar "Please try again in a moment." appears. Tap again a second later: it switches.

### H3. The six states of the "Haper Business" tap
Tap "Haper Business" with each account. Each row needs the sheet, and the mode must stay Haper.

| Account | Sheet title | Buttons | Mode after |
|---|---|---|---|
| Normal customer (never applied) | "Haper Business is for shop owners" (3 bullets) | "Apply now", "Not now" | Haper |
| Application pending | "Your application is under review" | "View status", "Not now" | Haper |
| Application rejected | "Your application needs changes" | "Fix and resubmit", "Not now" | Haper |
| Suspended | "Haper Business is on hold for your account" | "Contact support", "Not now" | Haper |
| Approved, store wholesale OFF | "Haper Business isn't available at this store yet" | "OK" | Haper |
| Approved, store wholesale ON | (no sheet; mode switches) | none | Business |

- ✅ **H3.1** Each sheet's button goes where it says (apply form, status screen, fix and resubmit, support).
- ❌ **H3.2** No sheet changes the mode.

### H4. The mode is remembered per user and per device
- ✅ **H4.1** Test Retailer One in Business. Close and reopen the app. Still Business.
- ✅ **H4.2** Log out. The app opens in Haper. Log in as Test Customer Two on the same phone. Haper, never Business.
- ✅ **H4.3** Log in again as Test Retailer One. The app opens in Haper (logout reset it).
- ✅ **H4.4** Two devices, same retailer. Device A in Business, device B in Haper. Each shows its own mode. Both see the same Haper cart and the same Business cart, because carts belong to the user.

---

## 8. Section T: Bulk tiers (T1-T12)

### T1. Admin product form: the "Bulk discounts" block (super admin)
- ✅ **T1.1** Tick "Wholesale-only item". A "Bulk discounts" block appears under the switch, with "From [qty] units -> [x]% off" rows.
- ❌ **T1.2** A retail product (not ticked, not a pack) shows no Bulk discounts block.
- ✅ **T1.3** Enter 10 units / 2% and 15 units / 5%. The live preview table shows per-store unit prices (after the product is saved once; a new product shows "Store price preview is available once the product is saved."). Save. The toast reads "Product updated - synced N store item(s)" (edit) or "Product created" (new).

Each error below shows inline, and Save is disabled. The footer reads "Fix the errors above to save."

| Enter | Message on screen |
|---|---|
| Quantity 1 (or 10.5) | "Whole number from 2 to 100000" |
| Percent 0 (or 55) | "Use a percent above 0 up to 50" |
| Percent 2.555 | "Use at most 2 decimals" |
| Row 2: quantity 10 after row 1 quantity 15 | "Quantity must be higher than the row above" |
| Row 2: percent 2 after row 1 percent 2 | "Discount must be higher than the row above" |
| Row 2: quantity 10 after row 1 quantity 10 | "Two tiers can't start at the same quantity" |

- ✅ **T1.4** The "+ Add tier" button is disabled at 5 rows, so a 6th row cannot be added in the form.
- ✅ **T1.5** API (see section 10): a PATCH with 6 tiers returns 400 with `reason: "TIERS_INVALID"` and the message "tiers must have 1-5 rows". A duplicate quantity returns the message "tier 2: minQty must be higher than the previous tier" (the API wording differs from the form wording; both block the save).

### T2. Untick "Wholesale-only" with tiers present
- ✅ **T2.1** Untick "Wholesale-only item" on a product that has 2 tiers. The dialog "Remove the bulk discounts too?" opens. It says "This product has 2 bulk discount tiers...". Buttons: "Keep wholesale-only" (focused by default) and "Remove discounts".
- ✅ **T2.2** "Keep wholesale-only": the product stays wholesale and the tiers stay.
- ✅ **T2.3** "Remove discounts", then save. `GET` the product: no tiers. The server also removes tiers when `wholesaleOnly` is set to false (even by API).
- ✅ **T2.4** API: PATCH a retail product with `wholesaleTiers` returns 400 `TIERS_NEED_WHOLESALE` with "Bulk tiers need a wholesale-only product or a pack."

### T3. Below-cost warning (super admin, saves only)
Setup: the store's cost for the pack is Rs 1,100. The 5% tier then gives Rs 1,092.50, which is below cost.
- ✅ **T3.1** Save the 10 / 2% and 15 / 5% tiers. The save is refused. A warning "Some stores would sell below cost" shows a table: Store | Tier | Tier price | Cost | Short by. The 5% row shows Rs 1,092.50, cost Rs 1,100, short by Rs 7.50. The 2% row is not listed (Rs 1,127 is above cost).
- ✅ **T3.2** The Save button stays disabled until the box "I understand these tiers sell below cost in the stores above" is ticked. The footer reads "Tick the box above to save."
- ✅ **T3.3** Tick the box and save. It saves. The audit log has `product.wholesale_tiers.update` with the acknowledgement.
- ✅ **T3.4** Edit any tier after ticking. The tick clears.
- ✅ **T3.5** A store item with cost 0 (unknown) never triggers the warning.
- ✅ **T3.6** The warning is a warning only. The tier still applies in the cart (no clamp; see note 3 in section 11).

### T4. Item page: "Bulk price" table (Business, Android)
Open "Maggi Pack of 100" in Business. The table sits as a white "Bulk price" card under the price block.

- ✅ **T4.1** Card title "Bulk price", caption "Per pack", a line "Buy more, pay less on every pack.". Rows read "10+ packs  2% off  ₹1127 each" and "15+ packs  5% off  ₹1092.50 each". Each row has an outlined "Add N" button (Add 10, Add 15).
- ✅ **T4.2** Empty cart, tap "Add 10": the cart becomes exactly 10 (set, not +10). The sticky bar shows 10.
- ✅ **T4.3** With 10 in the cart: the 10+ row shows a plum bar on its left and "In cart" in place of the button. The 15+ row still shows "Add 15". Tap "Add 15": the quantity becomes 15 and the plum marker moves to the 15+ row.
- ✅ **T4.4** With 12 in the cart: the 10+ row reads "In cart" (tier reached), the 15+ row shows "Add 15".
- ✅ **T4.5** With 20 in the cart: BOTH rows read "In cart". No "Add" button anywhere, so this card can never cut the cart down. The plum bar is on the 15+ row only.
- ✅ **T4.6** Another device raises the line to 20 while this screen still shows 12. Tap "Add 15" here: nothing is sent, and after a refresh the cart is still 20. "Add N" never lowers the cart. (The cart's Set-quantity sheet can still lower it; see T10.)
- ✅ **T4.7** While a cart change on this item is in flight, the "Add N" buttons are dimmed and ignore taps.
- ✅ **T4.8** Lower the quantity below 10 with the stepper: no row is marked.
- ✅ **T4.9** Stock 12: the 15+ row button is dimmed and disabled, with "Only 12 available" under it. The 10+ row still works.
- ✅ **T4.10** A pack without tiers, and a normal Haper item: no "Bulk price" card at all. The price block looks as before.
- ✅ **T4.11** TalkBack: the card is "Bulk price". Each row reads like "10 or more packs, 2 percent off, ₹1127 each, button Add 10".
- ❌ **T4.12** A normal customer's item JSON has no `wholesale` key at all (API, section 10).
- ✅ **T4.13** API: `GET /user/item/<pack id>` with `x-shop-mode: business` returns `wholesale.tiers`: `[{"minQty":10,"percent":2,"unitPrice":1127},{"minQty":15,"percent":5,"unitPrice":1092.5}]`.

### T5. Cart line with 12 packs (Business cart, Android)
- ✅ **T5.1** Quantity 12: the line shows the struck "₹1150", then "₹1127 each", a "2% OFF bulk" chip (amber on cream), and "Line total ₹13524" under the chip. The nudge reads "Add 3 more for 5% off".
- ✅ **T5.2** Tap "Add 3 more for 5% off": the quantity becomes 15.
- ✅ **T5.3** Quantity 15: "₹1092.50 each", the chip "5% OFF bulk", the line "Line total ₹16387.50", and the text "Best bulk price applied" (not tappable). No nudge.
- ✅ **T5.4** Quantity 9: no chip, no struck price, no line total. The nudge reads "Add 1 more for 2% off".
- ✅ **T5.5** Quantity 5 (below the first tier): no chip, no struck price; nudge "Add 5 more for 2% off".
- ✅ **T5.6** While a change to the line is in flight, the "Add N more" text stops being tappable.
- ✅ **T5.7** Pack without tiers: no chip, no nudge, no line total. The line looks as before.
- ✅ **T5.8** Haper cart (normal items): lines look as before, with no chip, no nudge, and the quantity number is not tappable.
- ✅ **T5.9** The bill's "Discount" row shows "-₹276" for the 12-pack cart with no coupon (the existing row; it is labelled "Discount", not "Bulk discount"). "To pay" = Item total - Discount + delivery + platform fee. See note 10 in section 11 for a coupon.
- ✅ **T5.10** API: the same line: `quantity` 12, `discountedPrice` 1127, `discountAmount` 23, `discountTotal` 276, `discountLabel` "2% OFF bulk". Cart `discount.total` 276. `totalPrice` (gross) 13800. `finalPrice` is net of the 276, plus delivery and platform charges.

### T6. Checkout matches the cart (parity)
- ✅ **T6.1** Place the 12-pack order (online). The stored order line has: `salePrice` 1127, `originalSalePrice` 1150, `discountAmount` 23.
- ✅ **T6.2** The stored order line has one `appliedDiscounts` entry: `{"kind":"WHOLESALE_TIER","minQty":10,"type":"PERCENT","value":2,"amount":23}`. This is the stored record (admin or database view). The **customer's** order detail shows only `{label, amount}` for each entry. See note 7 in section 11.
- ✅ **T6.3** The order's `discountTotal` includes 276.
- ✅ **T6.4** The line's `costPrice` is the cost at sale time, unchanged. Profit is still (paid - cost) x quantity.
- ❌ **T6.5** The stored order line has no `tierSource` key. (It is removed before saving.)
- ✅ **T6.6** The amount charged equals the cart's `finalPrice`. Repeat for a scheduled order with a slot. Same numbers.
- ✅ **T6.7** A refused checkout (e.g. suspended retailer) creates no order and takes no stock.

### T7. Invoice and refunds use the paid price
Check these on dev. They are taken from the plan and were not traced in code in the 2026-11-01 pass.
- ✅ **T7.1** The B2B GST invoice for the 12-pack order shows the rate Rs 1,127 per pack, not Rs 1,150. The line amount is Rs 13,524. The taxable value is the paid price (check the tax lines against your own calculation).
- ✅ **T7.2** Refund one pack from this order: the refund amount is Rs 1,127, not Rs 1,150.
- ✅ **T7.3** The profit report uses the paid price with no change needed.

### T8. The tier is the only discount on a wholesale line
- ✅ **T8.1** A "10% off" coupon on a cart with only packs is refused with the usual message "We couldn't apply this coupon right now — try another one?". It never says "wholesale".
- ✅ **T8.2** A mixed cart (2 x Sample Noodles 70 g at Rs 14, 12 x Maggi Pack of 100): the coupon takes off only the retail lines. The pack line gets only its tier.
- ✅ **T8.3** A store-wide automatic "10% off everything" rule never touches a pack line. The pack line shows only "2% OFF bulk".
- ✅ **T8.4** Packs never count towards a free-gift tier. In Business the cart shows no gift offer.

### T9. Retail items never carry tiers
- ❌ **T9.1** A retail product has no Bulk discounts block (T1.2).
- ✅ **T9.2** API: PATCH a retail product with `wholesaleTiers` returns 400 `TIERS_NEED_WHOLESALE`.
- ❌ **T9.3** A retail item's JSON never has `wholesale.tiers`.
- ✅ **T9.4** A pack master (a product with `packOf`) may have tiers. The save succeeds.

### T10. Set quantity sheet (Business cart, Android)
Tap the number between "-" and "+" on a pack line. TalkBack reads "Quantity 12, tap to set quantity".
- ✅ **T10.1** The sheet "Set quantity" opens with the pack name, the numeric keyboard already open, the current number selected, and the word "packs" after the number.
- ✅ **T10.2** Type 20: the helper reads "Up to 40 packs available. 15+ packs: 5% off, ₹1092.50 each." The summary row reads "20 packs" with the total "₹21850". Tap "Update": the sheet closes and the line shows 20.
- ✅ **T10.3** Empty field or 0: "Update" is disabled and no error text shows.
- ✅ **T10.4** Type 41 on a stock of 40: red border and "Only 40 packs available". "Update" is disabled. Type 40: allowed.
- ✅ **T10.5** Letters, "-" and "." cannot be typed. Only digits, up to 7 digits.
- ✅ **T10.6** "Remove from cart" removes the line. If it was the last line, the cart goes to the empty state.
- ✅ **T10.7** Network off, tap "Update": the sheet stays open with red text "Couldn't update quantity. Try again."; the old quantity stays. "Update" works again after the network is back.
- ✅ **T10.8** While the update runs, "Update" is disabled. The sheet closes only when the update succeeded.
- ✅ **T10.9** Tap the number right after tapping "+" (the change is still in flight): "Update" waits for that change, then sets the exact number typed. No wrong total.
- ✅ **T10.10** Typing the same number the server already has closes the sheet quietly.
- ✅ **T10.11** Change the quantity from a second device, then tap "Update" here without refreshing: the result is exactly the typed number.
- ✅ **T10.12** Rotate the phone, or set font size to 200%: the sheet stays usable and nothing is clipped.
- ✅ **T10.13** Unlike the "+" and "Add N" buttons, the Set-quantity sheet can lower a line (for example 12 to 9). The price then falls back to the tier that matches the new quantity.

### T11. Wholesale packs go past 6 (Android cap exemption)
- ✅ **T11.1** Business mode, pack on a Home, search or aisle card: tap "+" past 6 (7, 8, ... 12). It keeps adding. No "You can add up to 6" message.
- ✅ **T11.2** The same on the item page sticky stepper, the size sheet (if the pack has sizes) and the cart line's "+".
- ✅ **T11.3** Keep adding until stock (40): "+" dims and the message reads "Only 40 packs available".
- ✅ **T11.4** Haper mode, normal item: "+" still stops at 6 ("You can add up to 6 of this item."), exactly as before.
- ❌ **T11.5** A pack stops at 6 in Business. (Regression check.)

### T12. Empty Business cart (Android)
- ✅ **T12.1** Business mode, nothing in the Business cart: title "Your Business cart is empty", message "Add wholesale packs to get bulk prices. Your Haper cart is separate and unchanged.", and a "Browse wholesale items" button. The button goes back to the previous screen. It does not change the mode.
- ✅ **T12.2** Haper mode, empty cart: "Your cart is empty" and "Start shopping" as before.
- ✅ **T12.3** The Business cart has no "Apply a coupon" row and no gift skeleton. The Haper cart keeps its coupon row.

---

## 9. Edge cases

| # | Situation | Expected |
|---|---|---|
| E1 | Suspended while in Business | Section A7. Falls back within about 60 s. Checkout refused. |
| E2 | Store wholesale turned OFF while in Business | Server answers `retail` within about 5 s. App flips to Haper with the snackbar. |
| E3 | Old app build (no switch) | Retailer sees retail only, no packs anywhere, until the app updates. Normal customers unchanged. |
| E4 | Old mixed Haper cart (pack and retail in one cart, made before this change) | Pack line hidden in Haper (not deleted). Checkout charges only the visible retail lines. The cart is cleared after the order, hidden lines included. Testable only on an account that held a pack before the change went out. Otherwise mark "not testable". |
| E5 | Two devices in different modes | H4.4. Each device keeps its own mode. Carts are shared by user. |
| E6 | Log out, log in as another user on the same phone | H4.2. Mode resets to Haper. Never shows the other user's mode. |
| E7 | Deep link or push to a retail item or category while in Business | Opens in Haper (the app switches). An order link does not switch mode. |
| E8 | Add past the stock on a pack | See section 11, note 5. The app stops first when it knows the stock; the server stops a stale app. |
| E9 | Pack with a selling price of more than 2 decimals (e.g. 1150.555) | No tiers at all. See section 11, note 6. |
| E10 | Two "Place order" taps at the same time for one cart | See section 11, note 4. One order. The second gets a clear "already being placed" message. |
| E11 | Coupon on a mixed cart (pack + retail) | The bill shows "Coupon discount" only. See section 11, note 10. |

---

## 10. API checks (curl)

These show the same behaviour without the app. Put real values in the placeholders. Never paste a real token into a doc or a chat. These are read-only except the cart add.

```bash
# Placeholders: a customer token, the dev store id, the pack's item id
T="<customer JWT>"
S="<dev store id>"
PACK="<pack item id>"

# Retailer in Business: add 12 packs to the Business cart (the server maps CART to the Business cart)
curl -i -X POST "https://dapi.haper.in/user/cart/CART" \
  -H "Authorization: Bearer $T" -H "x-store-id: $S" \
  -H "x-shop-mode: business" -H "Content-Type: application/json" \
  -d "{\"itemId\":\"$PACK\",\"quantity\":12}"

# Read the Business cart. Look for x-shop-mode: business in the headers.
curl -i "https://dapi.haper.in/user/cart/?type=CART&page=1" \
  -H "Authorization: Bearer $T" -H "x-store-id: $S" \
  -H "x-shop-mode: business"

# Same call without the header: the Haper cart, and x-shop-mode: retail
curl -i "https://dapi.haper.in/user/cart/?type=CART&page=1" \
  -H "Authorization: Bearer $T" -H "x-store-id: $S"
```

What to read:
- The response header `x-shop-mode` says what the server served (`business` or `retail`).
- A Business response also carries `Cache-Control: private, no-store` and a `Vary` header that includes `x-shop-mode`.
- Line fields: `discountedPrice`, `discountAmount`, `discountTotal`, `discountLabel`.
- Cart totals: `totalPrice` (gross), `discount.total`, `finalPrice` (net).

Admin calls (super admin token, `$A`):

```bash
# Preview what each store would charge (read only, writes nothing)
curl -s -X POST "https://dapi.haper.in/admin/product/<product id>/wholesale-tiers/preview" \
  -H "Authorization: Bearer $A" -H "Content-Type: application/json" \
  -d '{"wholesaleTiers":[{"minQty":10,"percent":2},{"minQty":15,"percent":5}]}'
```

A save with a below-cost tier and no acknowledgement returns 409 `TIERS_BELOW_COST` with `data.rows`. Repeat the save with `"acknowledgeBelowCost": true` to pass.

---

## 11. Known notes and deploy notes

1. **Order edit keeps the tier price (carry-forward).** When a super admin or store admin edits an order, each line keeps the price it was sold at, so the tier price stays. Checked in code 2026-11-01.
   - Lowering a tier line from 12 packs to 9 keeps Rs 1,127 per pack. The tier is not re-worked. This is the customer-favourable choice, and it matches the rule that orders are never re-priced on edit.
   - Raising a tier line's quantity keeps its stored per-unit price. It does not move up to the 15-pack tier.
   - A line added during an order edit has no stored price and no promotion. It is sold at the live price with no tier.
   - Change this only if the business asks for it.
   - ✅ Check on dev: edit a 12-pack order to 9 packs. The line still shows 1127 per pack.
2. **Invoice model byte-hash checks.** An earlier note said five byte-hash checks in `packages/user/__tests__/invoice-model.test.js` fail and are unrelated. On 2026-11-01 that suite passed 43 of 43 locally, so the failures did not reproduce. If you see them, they are the PDF golden checks (`sha256`) in that file. They are not part of this feature. Check the rest of the run first.
3. **Below-cost warning: what it covers.**
   - It runs only when an admin saves a product's tiers, and only when the tiers changed.
   - It compares each store's tier price with that store's cost for the same product. It skips any store item with no cost (0) or no selling price.
   - It scans up to 5,000 store items per product.
   - It does not run on "create product", because a new product has no store rows yet.
   - It does not re-check later. If a goods receipt raises the cost after the tier is saved, the tier can sell below cost with no warning. Use the preview endpoint to check by hand.
   - It is a warning, not a clamp. The tier applies even below cost. This is intended.
4. **Order double-submit lock (new, 2026-11-01).** Two "Place order" requests for the same cart used to create two orders. The race was there before this change: it was introduced by commit `afd4ed4`, and this regression run found it. Now place-order takes a per-cart lock with a 120-second limit. It is released as soon as the request ends.
   - The second request for the same cart gets **HTTP 422** with `code: "ORDER_IN_PROGRESS"` and the message "Your order is already being placed. Please wait a moment."
   - It is 422 on purpose, not 409. Shipped apps treat 409 from this endpoint as "store under maintenance".
   - ✅ Two requests for one cart at the same moment (two phones on one cart, or two terminals running the API call) → one order, the other gets 422 `ORDER_IN_PROGRESS`.
   - ✅ The 422 message is shown to the user, not a maintenance screen.
   - ✅ If placing fails (e.g. out of stock), the lock is released. Fix the cause and retry: it works at once.
   - ✅ Business cart and Haper cart have different cart ids, so placing one does not block the other.
   - ✅ Android: the Place order button is disabled while placing, so one phone rarely triggers this. Use two phones on the same account and cart to test it.
   - ⚠ Android wording to know: a 422 from place-order shows in the generic checkout error dialog. That dialog's title is "Payment Failed". The message is correct; the title is not. Open wording decision (a client or backend tag would change it).
   - ❌ **Not covered by this lock (user decision pending):** for ONLINE payment the cart is not cleared until payment. A second place-order tap AFTER the first request has finished (before paying) can still create a second online order. Fixing it needs an idempotency design (user decision). Record the result; do not count it as a regression of this change.
5. **Wholesale stock refusal (new).** A pack's stock is checked against the running total in the cart, not just the one new quantity.
   - The app stops first when it knows the stock: at stock the app shows "Only 40 packs available" and does not send the add.
   - The server refuses a stale app with HTTP 400: "You already have N of <name> in your cart. Only S available." (it names the stock it has now).
   - ✅ Stock 40, cart has 30, add 15 in the app → the app shows "Only 40 packs available". No request is sent.
   - ✅ Stock 40, cart has 30 on this phone. On a second device or in admin, lower the stock to 20. Here, add 5 without refreshing → the server refuses with "You already have 30 of Maggi Pack of 100 in your cart. Only 20 available." (the exact name is the product name).
   - ❌ A retail item is never refused with this message (retail lines keep the 6-per-line cap and the normal stock message).
6. **Selling price with more than 2 decimals gets no tier (new).** A tier needs a price with at most 2 decimals. A price like 1150.555 gets no bulk tier at all.
   - No Bulk price card, no "2% OFF bulk" label, no nudge, and no tier price in checkout. The checkout charges the price as it is.
   - ✅ Set a test pack's selling price to 1150.555 on dev. The item page has no "Bulk price" card. A 12-pack line has no chip and no nudge. Set the price back to 1150 afterwards.
   - Follow-up (user decision): add 2-decimal validation to the admin selling price. That is a public API change, so it is not done here.
7. **Customer order detail (new).** The order detail the customer app gets no longer includes tier lists.
   - The customer view removes the populated item's `wholesaleTiers` and its `costPrice`.
   - Each `appliedDiscounts` entry is trimmed to `{label, amount}` for customers. The fields `kind`, `minQty`, `type` and `value` stay in the stored order only.
   - ✅ Customer order detail for a pack order: no `wholesaleTiers` anywhere, no `tierSource`, and `appliedDiscounts` entries have only `label` and `amount`.
8. **cartId for place-order (new).** `POST /user/order/place` now requires `cartId` to be a 24-character hex id (the cart's own id).
   - ✅ A cart id that is not 24 hex characters is refused with a validation error. It never reaches the order code, and it is not a server error.
   - Cart ids from the cart response are already 24-hex, so the apps need no change for this.
9. **`x-shop-mode` header, cache and CORS (new).**
   - Every Business response from the routes below carries `x-shop-mode: business` and `Cache-Control: private, no-store`. Every response carries `Vary: x-shop-mode`. The routes are `home`, `item`, `cart`, `coupon` and `retailer`.
   - CORS exposes the `x-shop-mode` response header (`exposedHeaders` in `packages/user/index.js`), so a browser can read it.
   - ✅ API: the headers above are present on a Business response.
   - ✅ Web (when it starts): an allowed browser origin can read `x-shop-mode`. This depends on the deployed `CORS_ORIGIN` setting. The code default is the literal string `*.haper.in`, and the `cors` package sends a string origin back as it is. It does not do wildcard matching. Confirm the deployed value before web adopts Business mode. (Not checked here: the deployed value is not read from the environment.)
10. **Coupon and tier on one bill (open, to confirm on device).**
    - The cart gives the tier saving in `discount.total` even when a coupon is applied. The "To pay" total includes it.
    - The app's bill shows "Coupon discount" when a coupon is applied, and hides the "Discount" row. So the tier saving (for example 276) does not get its own row on that bill.
    - ✅ / ❌ Check on device with a coupon and a 12-pack line: does "Item total - Coupon discount + delivery + platform fee" equal "To pay"? If not, the gap is the tier saving. Record it. Do not change the code from this guide.
11. **Android 6-per-line cap (now built).** Packs use stock as the limit. Retail lines still stop at 6. The cap helper is `util/CartQuantityCap.kt`. Its top comment still says "6 units per line" for all lines; that comment is out of date.
12. **Android cart label and nudge (now built).** The "2% OFF bulk" chip, "Line total", "Add N more" nudge and "Best bulk price applied" are built in `ui/screens/cart/CartScreen.kt` and `CartBulkParts.kt`. Checks are in T5.

---

## 12. Automated tests

Run these from the package folder. Backend tests use in-memory Mongo only, never the real database.

**Backend, customer service (`user`):** 9 suites, 234 tests, all passing on 2026-11-01 (the run recorded for this guide).

```bash
cd /Users/office/Documents/haper/haper-backend/packages/user
NODE_ENV=test npx jest --coverage=false \
  __tests__/business-cart.test.js \
  __tests__/wholesale-tier-checkout.test.js \
  __tests__/wholesale-visibility.test.js \
  __tests__/wholesale-tier-utils.test.js \
  __tests__/wholesale-tier-presenter.test.js \
  __tests__/wholesale-cart.test.js \
  __tests__/retailer-viewer.test.js \
  __tests__/retailer-checkout.test.js \
  __tests__/retailer-application.test.js
```

Suites that exist for this feature but were **not** in that run and were not re-run for this guide: `business-cart-stock.test.js` (the stock refusal, note 5), `business-banners-coupons.test.js`, `wholesale-tier-edge.test.js`, and `order-place-concurrency.test.js` (the lock, note 4). Run them with the same command before sign-off.

**Backend, admin service (`admin`):** the tier endpoints, 29 tests, all passing on 2026-11-01.

```bash
cd /Users/office/Documents/haper/haper-backend/packages/admin
NODE_ENV=test npx jest --coverage=false __tests__/product-wholesale-tiers.test.js
```

**Invoice model (`user`):** 43 tests, all passing on 2026-11-01 (see note 2).

```bash
cd /Users/office/Documents/haper/haper-backend/packages/user
NODE_ENV=test npx jest --coverage=false __tests__/invoice-model.test.js
```

**Admin web app (Vitest). Use Node 24.** Node 26 (the default here) breaks the suites that use localStorage. Verified 2026-11-01 with Node v24.8.0 at `/opt/homebrew/opt/node@24/bin/node`.

```bash
cd /Users/office/Documents/haper/haper-admin
PATH=/opt/homebrew/opt/node@24/bin:$PATH npx vitest run
```

Result on 2026-11-01: 116 files, 1473 tests, all passing. The product form folder alone: 6 files, 108 tests.

**Android unit tests (JVM, no device).** The four classes below ran green (20 tests) on 2026-11-01. The other classes listed after them exist for this feature and were not re-run for this guide.

```bash
cd /Users/office/Documents/haper/haper-android
./gradlew :app:testDebugUnitTest \
  --tests "com.bheldi.util.ShopModeStateTest" \
  --tests "com.bheldi.data.api.ShopModeEchoTest" \
  --tests "com.bheldi.ui.screens.home.BusinessSwitchSheetTest" \
  --tests "com.bheldi.util.DeepLinkShopModeTest"
```

Other Android classes for this feature (not run in that pass): `HomeViewModelShopModeTest`, `CartViewModelShopModeTest` (set-quantity waits and re-reads), `BulkTiersTest` (nudge maths, Set-quantity validation, tier met, line total), `CartQuantityCapTest`, `WholesaleBlockGsonTest`, `VariantCardBindingTest`, `WholesaleDisplayTest`, `RetailerCheckoutTest`.

Not covered by any automated test: the iOS and web clients (not built), and a real device run of this walkthrough (not done).

---

## 13. Sign-off checklist

Tick each line after the walkthrough, on dev.

| ID | Check | Done |
|---|---|---|
| A1 | Normal customer: nothing wholesale anywhere | [ ] |
| A2 | Retailer in Haper: retail only, pack add refused | [ ] |
| A3 | Retailer in Business: wholesale only, retail add refused | [ ] |
| A4 | Two carts, both survive switching and restarts | [ ] |
| A5 | An order empties only its own cart | [ ] |
| A6 | Not a retailer / store off: served Haper, app flips | [ ] |
| A7 | Suspended in Business: falls back, checkout refused | [ ] |
| A8 | Business: no banners, coupons, gift offer, print tile | [ ] |
| H1 | Switch shows only when the program is on | [ ] |
| H2 | Switch changes mode instantly, both ways; first-time snackbar; "try again" after login | [ ] |
| H3 | Six sheet states, mode never changes on a sheet | [ ] |
| H4 | Mode remembered per user and device, reset on logout | [ ] |
| T1 | Admin tiers block: rules and messages | [ ] |
| T2 | Untick wholesale-only: dialog and server removal | [ ] |
| T3 | Below-cost warning: tick needed, warning only | [ ] |
| T4 | Item page Bulk price table: rows, "In cart", "Add N" never lowers | [ ] |
| T5 | 12-pack line: ₹1127 each, chip, line total ₹13524, nudge, bill row | [ ] |
| T6 | Checkout charges what the cart showed, order lines correct | [ ] |
| T7 | Invoice and refund use the paid price | [ ] |
| T8 | Tier is the only discount on a pack line | [ ] |
| T9 | Retail items never carry tiers | [ ] |
| T10 | Set quantity sheet: validation, stock, failure text, waits for in-flight | [ ] |
| T11 | Packs go past 6 to stock; retail still stops at 6 | [ ] |
| T12 | Empty Business cart copy and actions | [ ] |
| Note 4 | Order double-submit: one order, 422 message shown (note 4) | [ ] |
| Note 5 | Stock refusal: app stops first; stale app gets the server message (note 5) | [ ] |
| Note 6 | 3-decimal price: no tiers anywhere (note 6) | [ ] |
| Note 10 | Coupon + tier bill: rows add up, or gap recorded (note 10) | [ ] |

---

## 14. Changelog for this guide

- 2026-11-01 (second pass): Android tier screens are now in the guide as real ✅/❌ steps (T4, T5, T10, T11, T12, H2 extras). The "NOT BUILT YET" markers for Android are gone; iOS and web still say not built. Pack name unified to "Maggi Pack of 100"; retail example renamed; the GSTIN in the test data is now the checksum-valid one the Android guide uses. Added notes 4-12 (double-submit lock, stock refusal, 3-decimal prices, customer order detail, cartId, headers and CORS, coupon bill gap, cap and cart label status). Corrected screen money format (`₹1127`, no comma). Known-gap wording for the coupon bill and the "Payment Failed" title added as open items.
- 2026-11-01: First version. Covers acceptance criteria A1-A8, H1-H4, T1-T9. Android Home switch and mode plumbing built. Android tier screens and the wholesale cap exemption were not built yet at this point.
