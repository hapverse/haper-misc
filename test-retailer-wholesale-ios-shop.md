# Retailer wholesale - iOS shop display + checkout (walkthrough)

Spec: `design-retailer-wholesale.md` sections 4-5. Backend: wholesale `wholesale` block + cart `paymentOptions` + `errorType:"RETAILER"` errors (dev). Needs: dev backend with the wholesale commits, an approved retailer account in a store with wholesale on, one pack item (e.g. "Pack of 100", fictional), one retail item. Not shipped to a build yet; nothing here has been run in a simulator UI (unit tests only).

Note: iOS does not send the variants feature header, so packs arrive as separate plain items (not inside a size sheet). The pill/per-piece rules are applied on cards, detail and cart.

## A. Display (approved retailer)
1. Item list / search: pack card shows the WHOLESALE pill (plum) beside the pack size; the right-hand line reads "₹11.50 per piece" (whole numbers stay "₹12") (NOT "Rs/100 g"). Retail cards are unchanged. ✅/❌
2. Pack with stock <= 5 (floor of 5 even when lowQty is smaller, e.g. lowQty 2 and 4 packs still shows it): chip "Only 2 packs left"; exactly 1 -> "Only 1 pack left". ✅/❌
3. Pack detail: pill under the name, per-piece line in place of the per-unit line, and a note "Wholesale price. No coupons or discounts apply." ✅/❌
4. Cart with a pack: line shows the pill; a note "Wholesale items don't get coupons or offers." appears once, above the delivery banner. Retail-only cart: no note, no pill. ✅/❌
5. VoiceOver on a card/cart line: pill reads "Wholesale" inside the row, not a separate stop. ✅/❌
6. Non-retailer / flag off: no pill, no note, no change anywhere (payload has no `wholesale`). ✅/❌

## B. Checkout payment options
1. Retailer, cart WITH a pack, COD switch OFF (`paymentOptions.cod:false`): COD row is NOT shown; one-line note "Cash on delivery isn't enabled for wholesale orders on your account. Pay online."; Online preselected. ✅/❌
2. Same retailer, retail-only cart: COD row shows as normal. ✅/❌
3. COD selected, then cart refreshes with `cod:false`: selection flips to Online. ✅/❌
4. COD switch ON: COD row shows and works. ✅/❌
5. Non-retailer (no `paymentOptions` key): exactly the old Online + COD rows; scheduled-delivery "Not available for scheduled orders" disabled row still works. ✅/❌
6. Force a server refusal (COD placed while switch off, e.g. flip the switch in admin after opening checkout): red banner above Pay showing the server message alone (our fallback copy only if the server sent none); VoiceOver announces it, cart refetched, COD gone, Online selected, no alert. ✅/❌
7. Suspend the retailer / turn the store flag off, then Place order: banner shows the server message (`RETAILER_WHOLESALE_NOT_ALLOWED`), cart refetched (pack lines gone). ✅/❌
8. Banner clears on the next Place order tap. ✅/❌
9. Coupon rejection and other failures still use the alert with their old titles. ✅/❌

## C. Invoice
1. Order detail -> Download Invoice on a retailer order for a store with no GSTIN: server returns 409; the "Invoice Error" alert shows the server's readable message. ✅/❌
2. Any other failure (500, offline, 404): still "Invoice not available for this order". ✅/❌
3. Normal invoice still opens the share sheet. ✅/❌

## Edge cases
- `wholesale.perUnitPrice` null -> no per-piece line (and still no per-100 g line on a pack).
- Malformed `wholesale` or `paymentOptions` never breaks the item/cart decode (treated as absent).
- Pack that sells out while in cart: existing unavailable-line behaviour.

## Not built (by design)
Wholesale rail/list screen (no endpoint), credit/Pay later, ledger, one-time sheet hint, "Wholesale only" card caption, mixed-cart coupon copy ("on retail items"), "GST invoice with your GSTIN" sticky-bar line.

## Automated
`xcodebuild test ... -only-testing:haperTests/WholesaleTests` (decode, per-piece/packs-left text, payment option fallback, banner mapping, invoice 409 message).

## Deploy
iOS build only (no backend change). Backend must already include the wholesale commits.

## Invoice download (no redirect)
The API now answers every invoice request with 200 and the PDF itself (no redirect, no S3 link). iOS keeps its dedicated session that strips `Authorization` + `x-device-id`/`x-user-latitude`/`x-user-longitude`/`x-store-id` on cross-host (or https->http) redirects, as defence in depth only.
1. Download invoice on a delivered order -> PDF share sheet opens. ✅/❌
2. 409 (not ready) still shows the readable message. ✅/❌
3. Download twice: both open the same PDF. ✅/❌
Automated: `-only-testing:haperTests/InvoiceRedirectPolicyTests`.
Android: see `test-retailer-wholesale-android-shop.md` (same defence in depth).
