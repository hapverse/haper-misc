# Test guide - retailer wholesale on haper-web (shop display + checkout)

Web only. Needs the backend wholesale work deployed to dev and an APPROVED retailer account in a store with the wholesale flag on. Non-retailers must see no change at all.
Not browser-tested yet: only `tsc`, `vite build` and node unit tests were run.

## Setup (fictional data)
- Retailer "Sunita Traders", approved, store wholesale ON, one pack item "Pack of 100" (Maggi 70 g base, Rs 1,150 per pack, 100 units).
- Retailer COD switch: run once ON, once OFF.

## A. Display
1. Open the pack's product page. Expect a plum WHOLESALE pill, "Rs 11.50 per piece - 100 pieces", NO per-100 g line, note "Wholesale price. Wholesale items don't get coupons or offers." ✅ / ❌
2. Pack with 2 left: "Only 2 packs left" on the page and on the card. 6+ left: nothing. ✅ / ❌
2b. Pack with lowQty 10 and 8 in stock: card shows "Only 8 packs left" (never "Only 8 left"). ✅ / ❌
3. Retail item: unchanged (per-100 g line, "Only N left"). ✅ / ❌
4. Dark mode: pill text readable. ✅ / ❌
5. Customer who is NOT a retailer: no pills anywhere, payload has no `wholesale`. ✅ / ❌

## B. Cart / checkout items
1. Add the pack: cart line shows pill + "Rs 11.50 per piece". ✅ / ❌
2. Note "Wholesale items don't get coupons or offers." appears under the items only when a wholesale line exists. ✅ / ❌
3. Remove the pack: note and pill disappear. ✅ / ❌

## C. Payment options
1. COD switch ON: Pay Online + Cash on Delivery shown as before. ✅ / ❌
2. COD switch OFF + pack in cart: COD row is absent (not greyed), one-line note "Cash on delivery isn't enabled for wholesale orders on your account. Pay online."; Pay Online selected; Place Order sends RAZORPAY. ✅ / ❌
3. Select COD first (retail-only cart), then add the pack with COD OFF: selection flips to online. ✅ / ❌
4. COD OFF but retail-only cart: COD shown as normal. ✅ / ❌
5. Non-retailer / old backend (no `paymentOptions`): identical to today. ✅ / ❌
6. Scheduled-delivery restriction still works (COD disabled for slots). ✅ / ❌

## D. Errors on Place Order
1. Force `RETAILER_COD_DISABLED` (switch COD OFF in admin after opening checkout, then place with COD): red banner with the server message, focus moves to it, cart refetches, COD hidden, online selected. ✅ / ❌
2. `RETAILER_WHOLESALE_NOT_ALLOWED` (suspend the retailer, then place): banner with server message, cart refetched, cart and input preserved, no toast. ✅ / ❌
3. Placing again clears the banner. ✅ / ❌
4. Other errors (409 maintenance, slot taken, area) still behave as before. ✅ / ❌

## E. Invoice
1. Delivered retailer order on a store with NO GSTIN: Download Invoice shows the server's readable 409 text, not "Failed to download". ✅ / ❌
2. Any customer, network off (or blob error) when tapping Download Invoice: generic "Failed to download invoice. Please try again." (never "Failed to fetch"). ✅ / ❌
2. Store with GSTIN: PDF downloads. Other failures: the old generic message. ✅ / ❌

## Edge cases
- `wholesale` block with all-null fields: pill still shows, no per-piece line.
- Pack out of stock: card/page use existing out-of-stock treatment.

## Not in this change
- No size drawer, tiles or "Wholesale only" card on web (web has no size-variants UI yet); no wholesale rail/list page, credit or ledger.
- Needs deploy: backend wholesale contract (already built); web deploy.

Unit tests: `node --test utils/*.test.mjs` (29 pass; wholesale.test.mjs adds 8).
