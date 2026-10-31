# Retailer wholesale - Android shop display + checkout options (test guide)

Scope: customer app (haper-android). Wholesale packs in the size sheet, detail tiles, detail price block, cart, and checkout payment options. Needs the backend wholesale work deployed to dev; the app only renders what it receives. Not device-tested at build time (JVM tests + `assembleDebug` only) - run this on a device.

Test data (fictional): retailer "Test Kirana" (APPROVED, store wholesale ON), item "Maggi 70 g" with a "Pack of 100" pack (units 100, Rs 1,150 -> Rs 11.50 per piece), plus a normal customer account.

## A. Normal customer (must be unchanged)
- [ ] No WHOLESALE pill anywhere (cards, sheet, tiles, cart).
- [ ] Checkout shows Online + Cash on Delivery exactly as before; COD is still the default.
- [ ] Cart has no wholesale note.

## B. Retailer - size sheet (card -> choose size)
- [ ] "Pack of 100" row shows label + plum WHOLESALE pill (storefront icon), price, and "Rs 11.50 per piece".
- [ ] The "per 100 g" line is NOT shown for the pack; retail sizes still show it.
- [ ] Pack with <= 5 left (or at its low-stock mark) shows "Only N packs left" ("Only 1 pack left" for one).
- [ ] Pack at its stock cap: + disabled and hint says "Only N packs available" (retail rows still say "Only N available").
- [ ] Card "from" price ignores the pack (check a group where the pack is the cheapest per pack but not per piece).
- [ ] TalkBack on the row reads: label, wholesale, price, per piece, only N packs left.

## C. Retailer - item detail
- [ ] Pack tile: WHOLESALE pill on top, label (wraps up to 2 lines), price, "Rs 11.50 / piece", packs-left line. No "per 100 g".
- [ ] Select the pack tile: price block shows pill + "Rs 11.50 per piece - 100 pieces" + mint note "Wholesale price. No coupons or discounts apply."
- [ ] Sticky bar shows "Pack of 100" and the extra "GST invoice with your GSTIN" line; a retail tile selected removes it.
- [ ] Sold-out pack: tile dimmed, "Sold out", no Add.

## D. Retailer - cart
- [ ] Wholesale line shows the pack label + pill; retail line in the same cart has no pill.
- [ ] Under the lines (only when >= 1 wholesale line): "Wholesale items don't get coupons or offers."
- [ ] Remove the wholesale line: note disappears. Totals always match what the server returns.
- [ ] Wholesale-only cart + coupon: server refusal text is shown as before (no new client logic).

## E. Retailer - checkout payment options
- [ ] COD switch ON for the retailer: Online + COD both shown (COD default as today).
- [ ] COD switch OFF + cart with a wholesale line: COD row is gone (not greyed), mint note "Cash on delivery isn't enabled for wholesale orders on your account. Pay online."; Online is selected; Place order works online.
- [ ] COD switch OFF + retail-only cart: COD shown as normal, no note.
- [ ] Scheduled delivery: COD is still disabled with the existing "Not available for scheduled orders" text when COD is otherwise visible.
- [ ] Old backend / normal customer (no `paymentOptions` in cart JSON): identical to today.

## F. Retailer - checkout refusals (flip the setting while checkout is open)
- [ ] Turn COD switch OFF in admin after opening checkout with COD selected, tap Place order: red banner above the button with the server message, no dialog, cart refetched, COD hidden, Online selected.
- [ ] Suspend the retailer (or store flag off) and tap Place order: banner with the server message; no "Payment Failed" dialog; no maintenance screen appears; cart refetched.
- [ ] Banner clears on the next Place order tap.
- [ ] An unrelated 409 (real store maintenance) still opens the maintenance screen; any other 400 still shows the old dialog.

## G. Invoice
- [ ] Delivered retailer order on a store without GSTIN: Download invoice shows the server's 409 message (not "Invoice not available").
- [ ] Any other failure still says "Invoice not available".

## Edge cases
- Pack with null `perUnitPrice` or `units`: no per-piece line, no crash (detail shows pill only).
- Dark theme, font scale 200 percent: pill and rows do not clip; tile height equalises.
- Rotation / process death in checkout: COD stays hidden after the cart reloads.

## Build / deploy needed
- Backend wholesale (cart `paymentOptions`, `wholesale` block, RETAILER errors) on dev. No new Android permissions or manifest changes. Unit tests: `WholesaleDisplayTest`, `RetailerCheckoutTest`.

## Invoice download (Android)
- The API no longer redirects: every invoice GET answers 200 with the PDF bytes (`application/pdf`, attachment filename, `Cache-Control: private, no-store`). The invoice client still strips `x-*` and `Content-Type` on non-API-host hops, kept as defence in depth in case a redirect ever returns. Unit test: `InvoiceRedirectHeadersTest`.
- Manual: order detail -> Download Invoice -> PDF opens, no redirect in the network log. Download twice: both succeed. API-host calls keep all headers.
