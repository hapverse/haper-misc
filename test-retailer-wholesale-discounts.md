# Test guide - Wholesale lines vs discounts, coupons, free gifts, referral (backend)

Plan rule (retailer-wholesale.md §3.9): a wholesale line (a pack such as "Maggi 70 g Pack of 100") never takes an automatic discount, never takes a coupon, does not count towards a free-gift tier, does not earn referral money, and can never be a free gift. Only the retail part of a retailer's cart counts. Normal customers see no change at all.

Plain example: a retailer's cart has 2 x Maggi 70 g at ₹14 (retail, ₹28) and 1 x Maggi Pack of 100 at ₹1150 (wholesale). A "10% off everything" sale takes ₹2.80 off (10% of ₹28), not ₹117.80. A ₹10 coupon is taken only off the ₹28 part. A "free cola on orders of ₹500+" tier is NOT reached (₹28 retail), even though the whole cart is ₹1178.

**Needs:** backend deployed to dev with this change (shared discount/coupon/gift utils, order.handler referral, checkout, admin banner + gift-tier refusal). Use a store with "Wholesale enabled" ON and an APPROVED retailer test account (fictional shop, e.g. "Sample Kirana", GSTIN 10ABCDE1234F1Z5) with COD ON.

Automated: `packages/user/__tests__/wholesale-commercial-rules.test.js`, `packages/admin/__tests__/wholesale-gift-banner-targets.test.js`.

## 1. Automatic discounts
- ✅ Store discounts ON + a 10% "all items" rule. Retailer cart: 2 x Maggi 70 g (₹14) + 1 x Pack of 100 (₹1150). Cart shows the discount on Maggi only; the pack row shows no strikethrough.
- ✅ Place the order (now and scheduled). Order detail: Maggi line ₹12.60 (₹1.40 off each), pack line ₹1150 with ₹0 off; order discount total ₹2.80.
- ✅ Retailer browsing the wholesale section: pack cards never show a sale price or "% OFF".
- ✅ Normal customer, same rule: discounts exactly as before.

## 2. Coupons
- ✅ ₹10 flat coupon, no minimum, on the mixed cart above: order coupon amount ₹10, all on the Maggi line (₹9 each); pack line untouched at ₹1150.
- ✅ 10% coupon on the mixed cart: ₹2.80 off (10% of ₹28), not 10% of ₹1178.
- ✅ Coupon with a ₹300 minimum on the mixed cart: refused with "Add ₹272.00 more to use <CODE>." (only the ₹28 retail part counts).
- ❌ Wholesale-only cart (just the pack), coupon typed at checkout: refused with "We couldn't apply this coupon right now — try another one?" (the same words as any coupon worth ₹0). The message never says "wholesale". No order, no coupon slot used.
- ❌ Wholesale-only cart, coupon with a minimum (say ₹100): "Add ₹100.00 more to use <CODE>." (same as any small cart).
- ✅ Wholesale-only cart with a coupon already sitting on the cart (not typed now): checkout drops the coupon quietly and the order goes through at full price.
- ✅ Normal customer: every coupon behaves exactly as before.
- ✅ Cart screen "Apply coupon" (retailer): the preview counts only the retail lines, the same as checkout. A cart with only packs is refused with "We couldn't apply this coupon right now — try another one?" (the standard "worth ₹0" sentence; it never says "wholesale").

## 3. Free gift
- ✅ Store gift ON, tier "₹500 → Free Cola". Mixed cart ₹28 retail + ₹1150 pack: no free gift on the order; cart offer says "Add ₹472 more to unlock a free Free Cola".
- ✅ Mixed cart with 40 x Maggi (₹560 retail) + pack: the free Cola is added.
- ✅ Wholesale-only cart: no free gift.
- ❌ Admin -> Store -> Gift tiers: choosing a wholesale item (a pack) as the gift is refused: "A wholesale item can't be a free gift." Same when editing an existing tier to a pack.
- ✅ A tier that already points at a wholesale item (made before this fix): no customer ever sees its name in the cart gift offer, and checkout skips it (walks down to a lower retail tier if there is one).
- ✅ Normal customer: gift tiers as before.

## 4. Referral earnings
- ✅ Referred retailer's first delivered order: ₹400 retail + ₹600 wholesale (₹1000). Referrer earns 3% of ₹400 = ₹12 (not ₹30). Referral log shows order value 400.
- ✅ Wholesale-only order: referrer earns nothing, no referral log line.
- ✅ Normal referred customer: 3% / 1% of the order value as before.

## 5. Banners
- ❌ Admin -> Banners -> action "item" with a wholesale item's id or iId (e.g. a "Pack of 24"): refused "A banner can't link to a wholesale item." Same on edit (changing only the value, or only switching the type to "item").
- ✅ Banner to a retail item (by id or iId), a category, or a URL: saves as before.
- Note: a pack shares its base item's barcode, so a barcode typed as the banner value is not checked (the customer item page already hides packs from non-retailers).

## Edge cases
- ✅ A pack line whose "wholesale" marker is missing but which still has "pack of" data is treated as wholesale everywhere above.
- ✅ Free-delivery threshold and platform fee still use the whole order (unchanged by design).
