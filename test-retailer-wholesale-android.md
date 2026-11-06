# Retailer application - Android walkthrough

Scope: Profile entry, Apply form, Status screen (Pending / Approved / Rejected / Suspended), Withdraw. Sections 7-9 cover Haper Business (Home switch, two carts, bulk tiers).
Not covered here: checkout payment options (see `test-retailer-wholesale-checkout.md`) and credit (backend not ready).

**Needs first:** the backend retailer routes (`/user/retailer/me`, `/application`) deployed to dev, and the store's wholesale flag ON (`programEnabled: true`). Nothing below can be seen until then. Status changes (approve / reject / suspend) are done from haper-admin. No device test was done when this was written; every step is still unchecked.

Use fictional data only. Checksum-valid sample GSTINs: `10ABCDE1234F1ZF` (Bihar), `27PQRSX5678K2ZX` (Maharashtra). Bad checksum: `10ABCDE1234F1ZB`. Bad state: `50ABCDE1234F1ZB`.

## 1. Profile entry
- [ ] Program OFF for the store: no retailer row, no chip anywhere.
- [ ] Program ON, no application: first row in "Your account" says "Become a retailer / Buy in bulk at wholesale prices".
- [ ] After applying: row becomes "Retailer application" with chip Under review.
- [ ] Rejected: sub "Needs your attention", chip Rejected. Suspended: sub "Account on hold", chip On hold (grey, lock).
- [ ] Approved: no row; small plum "Retailer" chip beside the name in the profile header, tapping it opens Status.
- [ ] `/me` fails with no earlier result: no row (nothing broken shown). Reopening Profile retries.
- [ ] Log out and log in as another user: the old user's status is gone.

## 2. Apply form
- [ ] Opens full screen; owner name prefilled from profile (editable).
- [ ] Submit is always tappable. Tapping with empty fields shows all errors and scrolls to the first one (shop name).
- [ ] GSTIN: typing shows `n/15`; lowercase becomes uppercase; spaces/dashes are dropped; max 15.
- [ ] Valid GSTIN: green tick and "Registered in Bihar" (never the word "verified").
- [ ] Bad checksum -> "Check the last character..."; bad state -> "First two digits aren't a valid state code."; wrong shape -> format message.
- [ ] Error under a field disappears as soon as that field is edited.
- [ ] PIN accepts digits only, 6 max; 5 digits on Submit -> error.
- [ ] Shop location: tap opens the same map picker used for delivery addresses; confirm -> card says "Shop pinned on map". Submit without it -> "Pin your shop on the map".
- [ ] Debug build without a Maps key: tap with a valid PIN fills an approximate pin; without a PIN a toast asks for it.
- [ ] Shop photo: "Take photo" opens the camera app; "Choose from gallery" opens the picker. Photo shows in the tile with Retake and a remove X. Portrait photos are not sideways.
- [ ] Large camera photo (12 MP+) uploads fine (client shrinks to 1600 px JPEG).
- [ ] Non-image picked as photo -> tile error "Photo is too large or not an image. Try another."
- [ ] GST certificate: optional; image or PDF; shows file name + size; X removes. PDF over 10 MB -> tile error "File is too large (max 10 MB) or not a photo or PDF. Try another."
- [ ] Lock note "Only Haper's verification team can see your photos." is visible.
- [ ] No "usually within 1 working day" text anywhere.
- [ ] Submitting: button shows spinner and "Submitting..."; fields are read-only; progress bar and "Uploading photo n%".
- [ ] Success: goes to Status (Under review). Back from Status goes to Profile, not the form.
- [ ] Rejected user: Status > "Edit and resubmit" > submit. Lands on ONE Status screen (Under review); a single Back goes to Profile (not Status again, not the form).
- [ ] Logout, then check app cache (`adb shell run-as com.bheldi ls cache/retailer`): empty, including any leftover cam_/img_/cert_ files.
- [ ] Success while the status refresh fails (turn on airplane mode the moment the upload hits 100%): Status still shows Under review with a "Can't refresh" note and Retry, never "Couldn't load your application".
- [ ] Rotate the phone mid-form: all text and the chosen photo stay.
- [ ] Back with typed data -> "Discard application?" (Keep editing / Discard). Back with nothing typed leaves immediately.
- [ ] Back while submitting -> "Cancel upload?".
- [ ] Airplane mode + Submit: red banner "Couldn't submit. Check your connection..." with Retry; inputs kept; Retry works after reconnecting.
- [ ] Font scale 200%: labels wrap, nothing cut off, Submit stays reachable above the keyboard.
- [ ] TalkBack: photo tile reads "Add shop photo, required"; chips read selected state.

## 3. Server errors (from the form)
- [ ] GSTIN already used by another retailer (409 GSTIN_TAKEN): error under GSTIN with a "Contact support" link opening Support.
- [ ] 409 ALREADY_APPLIED (apply from two phones): banner, then the app moves on its own from the form to the Status screen (Under review). Back from Status goes to Profile, not the form. If that refresh fails (go offline right after tapping Submit), the banner changes to "Couldn't load your application. Try again." with a Retry action; go online, tap Retry, and the app moves to Status.
- [ ] 429 RESUBMIT_LIMIT: banner about the submission limit. Generic 429: "Too many attempts. Try again later."
- [ ] 413 / 415 / 422 on the photo: photo tile error.
- [ ] 503 (index missing / upload unavailable): "Wholesale applications are unavailable right now..."; no raw server text anywhere.
- [ ] Unknown error code: generic friendly message, never the server's text.

## 4. Status screen
- [ ] Pending: hourglass, "Under review", shop, masked GSTIN (`10ABCDE****ZF`), submitted date, 3-step timeline with "In review" current, "Withdraw application".
- [ ] Withdraw -> confirm dialog -> screen closes to Profile, row back to "Become a retailer". Offline withdraw -> friendly error, stays on screen.
- [ ] Approve in admin, then reopen / resume the app: Status crossfades to approved; "Go to home" works; "Cash on delivery: On/Off" matches the admin setting.
- [ ] Reject in admin (reason + note): Status shows reason label (bold), the note in quotes, date, submissions left.
- [ ] "Edit and resubmit": form prefilled (incl. coordinates), banner "Last time: ...". Submit unchanged -> "Change something first...". Edit one field -> Resubmit works -> Pending again.
- [ ] Rejection reason PHOTO_UNCLEAR: shop photo tile is empty and required again; other reasons show "Already uploaded".
- [ ] 0 submissions left: "Edit and resubmit" disabled, text says contact support.
- [ ] Suspend in admin: grey lock, "Wholesale access on hold", reason (or "Ask support for details"), only "Contact support"; no Withdraw, no re-apply.
- [ ] Offline on open with no earlier result: "Couldn't load your application" + Retry. Offline after a good load: last status stays with a "Can't refresh" note and Retry.

## 5. Process death (app killed in the background)
How to simulate: Developer options > "Don't keep activities" ON (camera steps), or put the app in the background and run `adb shell am kill com.bheldi` (form steps), then reopen from Recents.
- [ ] Rejected user on the form, kill + reopen: a short skeleton shows, then the form comes back prefilled with the old answers and the "Last time: ..." banner (not a blank form).
- [ ] Same, but offline when reopening: "Couldn't load your application" + Retry (not a blank form). Retry after reconnecting shows the prefilled form.
- [ ] New applicant: tap Take photo, the app is killed while the camera is open, take the photo and confirm: back in the app, the photo is in the tile (no "Photo is too large or not an image" error). Typed text is lost (known, see below).
- [ ] Rejected user, same camera kill: form is prefilled AND the new photo is in the tile.
- [ ] User who already applied on another phone (status Under review) and was restored onto the form: the app moves to the Status screen by itself.
- [ ] Cache check (debug, optional): `adb shell run-as com.bheldi ls cache/retailer` after a fresh app start shows no old `img_`/`cert_` files; a pending `cam_` file is only kept until the photo is read (or for 24 h if abandoned).

## 6. Document uploads (shop photo + GST certificate)
Regression: every image used to be rejected with "Photo is too large or not an image".
- [ ] Camera shop photo: Take photo, confirm. The photo shows in the tile, no error.
- [ ] Gallery shop photo (large, 12 MP+): picks fine, shows in the tile, submit uploads it.
- [ ] Image GST certificate (JPG/PNG from gallery or files): accepted, shows in the certificate tile.
- [ ] PDF GST certificate (under 10 MB): accepted with its file name; over 10 MB shows the too-large message.
- [ ] Non-image file (e.g. .txt, .zip) picked as shop photo or certificate: rejected with "Photo is too large or not an image" (certificate: unsupported message), nothing attached.
- [ ] Portrait phone photo keeps its orientation after upload (EXIF rotation).
- [ ] Automated: `./gradlew connectedDebugAndroidTest --tests '*RetailerDocsInstrumentedTest'` (needs an emulator/device).

## Edge cases to try
- Kill the app while on the form: typed text is lost (not restored after process death yet); only the status-based prefill and a pending camera photo come back.
- Server-side FIELD_INVALID / file rejection (413/415/422) shows a general banner (the server sends no field name); GSTIN_TAKEN/GSTIN_INVALID still mark the GSTIN field.
- Two taps on Submit: only one request.
- Withdrawn user applying again: allowed until the 5-in-30-days limit.
- Android 9 (API 28) device/emulator: camera + gallery + PDF picker all work.

## 7. Haper Business switch (Home)
Needs: dev backend with the Business view on dev. The Home lists and the cart reload on switch (see section 8). Use made-up shops/accounts only. The same flows are in `test-b2b-business-mode.md` (sections H and A).

Switch visibility
- ✅ Retailer program off for the store, or /me failed: Home header is exactly as before, no switch.
- ✅ Program on: a "Haper | Haper Business" switch is the first thing in the green header, above "DELIVERING TO". Track is dark green, selected side is white.
- ❌ Not allowed: switch hiding the address row, or the Help pill moving.

Tap "Haper Business" per state (mode must never change for 1-5)
- ✅ 1. No application: sheet "Haper Business is for shop owners", 3 bullets, "Apply now" opens the apply form (empty), "Not now" closes.
- ✅ 2. Pending: "Your application is under review", "View status" opens the status screen.
- ✅ 3. Rejected: "Your application needs changes", body shows "Last time: <reason>. Fix it and send it again.", "Fix and resubmit" opens the apply form prefilled.
- ✅ 4. Suspended: "Haper Business is on hold for your account", "Contact support" opens Support.
- ✅ 5. Approved but store has wholesale off: "Haper Business isn't available at this store yet", single "OK".
- ✅ 6a. Right after login (before the profile has loaded), tap "Haper Business" when it is available: mode does NOT change; snackbar "Please try again in a moment." appears; tap again a second later and it switches.
- ✅ 6. Approved and available: no sheet, header turns plum at once, eyebrow "HAPER BUSINESS", search reads "Search wholesale items...", snackbar "You're in Haper Business. Only wholesale items here." (first switch on this install only; second switch shows no snackbar).
- ✅ Swipe down / tap outside / Back closes any sheet; focus returns to the switch.

Business look
- ✅ Header fades Green -> Plum in about 200 ms; with "Remove animations" on (Developer options, animation scale 0) it changes instantly.
- ✅ In Business: no banner carousel, no Print tile, wallet strip still there, section title "Wholesale for your shop" instead of "Fresh picks", sticky search says "Search wholesale items...". (Home has no Offers entry or free-gift bar today, so nothing to hide there.)
- ✅ Tap "Haper": green header and normal Home come back.
- ✅ Store with no wholesale items: "No wholesale items here yet" + "Back to Haper" (button switches back).
- ❌ Not allowed: a user who never switched sees any difference from before (compare screenshots).

Fallback
- ✅ Make the retailer suspended (admin) while in Business, wait ~1 min, pull to refresh: UI flips to Haper and snackbar "Haper Business isn't available right now." appears; restart app stays on Haper.
- ✅ Fallback while you are on the Cart screen: the same snackbar shows there. While on any other screen (item page, checkout), it waits and shows the next time Home or Cart is on screen. It shows once per fallback, never twice.

Persistence and logout
- ✅ Switch to Business, kill and reopen the app: still Business (plum) for the same account.
- ✅ Log out, log in as another account (or same): starts in Haper.
- ✅ Log out while in Business: login screen appears with no extra Home/catalogue requests (check Logcat/proxy: no `home/items` calls after logout).
- ✅ First login on a fresh install: the Business switch appears once the store resolves (the status request is re-sent when the store changes), without needing to reopen the app.
- ✅ Cold start in Business while offline: the switch still shows (so you can get back to Haper) even though /me has not loaded.

Accessibility
- ✅ TalkBack: first focus stop is the switch; reads "Haper, normal shop, tab, selected" / "Haper Business, wholesale shop"; switching announces the new shop politely.
- ✅ Each segment is at least 48dp tall; font scale 200%: labels wrap to two lines, nothing cut off.
- ✅ Sheet: title is heading, buttons stacked and at least 48dp.

## 8. Two carts (Haper vs Haper Business)
Needs the backend on dev (separate Business cart, `x-shop-mode` header) and an approved retailer at a store with wholesale on. Fictional items: "Sample Milk 500 ml" (retail), "Maggi Pack of 100" (wholesale).

Separate carts
- ✅ 1. In Haper add 2x Sample Milk. Floating bar is green, "2 items".
- ✅ 2. Switch to Haper Business: lists show skeletons for a moment, then wholesale items only. The green bar is gone (Business cart is empty); no Milk anywhere.
- ✅ 3. Add 12x Maggi Pack of 100. Floating bar is WHITE with a plum outline, plum chip "Business cart", "12 items", total in dark plum.
- ✅ 4. Open the cart: title "Business cart"; only the pack.
- ✅ 5. Back, switch to Haper: the Milk quantity stepper on the card shows 2 again; the pack card is not on Home. Haper cart title is "Your cart".
- ✅ 6. Switch to Business again: the pack is still 12 (nothing lost either way).
- ✅ Quantities on cards (Home, aisle, search) always follow the current mode's cart; the bottom cart badge/bar never shows the other mode's count.
- ❌ Not allowed: Milk visible/addable in Business, a wholesale pack in the Haper cart, or the Haper count flashing in the Business bar after a switch.

Reload on switch
- ✅ Switch repeatedly and fast (5+ times): final screen matches the final mode, no stale list from the previous mode.
- ✅ Open an aisle, then a fallback to Haper happens (suspend retailer, wait): aisle shows its "Couldn't load this aisle" + Retry, not a wrong-mode list.
- ✅ Pending "add" waiting on a location prompt is dropped when the mode changes (does not replay in the other cart).

Load failed vs empty (Business Home)
- ✅ Turn on airplane mode, switch to Business: after skeletons, "Couldn't load wholesale items" / "Check your connection and try again." with plum "Retry" (NOT "No wholesale items here yet").
- ✅ Turn network back on, tap Retry: skeletons then wholesale items.
- ✅ Store with truly zero wholesale items (network fine): "No wholesale items here yet" + "Back to Haper".
- ❌ Not allowed: the empty message while the request failed.
- Haper mode behaviour on a failed load is unchanged (no new error card).

Deep links and push
- ✅ In Business, tap an order push: Orders > order detail opens, mode stays Business (orders are mode-independent and may be wholesale).
- Retail item/category links (banners are hidden in Business; no item deep links exist yet) are wired through `shopModeForDeepLink` to force Haper; verify when such a link is added.

Logout / user switch
- ✅ In Business with items in the Business cart, log out: login screen; log in again: Haper mode, Haper cart loaded, no Business count visible.
- ✅ Log in as a different user: starts in Haper with that user's own cart.

Automated: `HomeViewModelShopModeTest`, `CartViewModelShopModeTest`, `DeepLinkShopModeTest`.

## 9. Bulk tiers in the app (Business cart, item page)
Needs: backend with bulk tiers on dev; an approved retailer; a wholesale pack with tiers set in admin: "Maggi Pack of 100", ₹1150 each, stock 40, tiers 10+ packs = 2%, 15+ packs = 5%; one wholesale pack WITHOUT tiers ("Biscuit Pack of 24"); one normal Haper item. Every check below is in Business mode unless it says Haper.

Quantity limit (pack cap exemption)
- ✅ Business mode, pack on a Home/search/aisle card: tap + past 6 (to 7, 8, ... 12): it keeps adding, no "You can add up to 6" message.
- ✅ Same on the item page sticky stepper, the size sheet (if the pack has sizes) and the cart line + button.
- ✅ A plain pack (no sizes) on Home, aisle, search and Related cards: + keeps working past 6 up to stock; the same card for a retail item stops at 6.
- ✅ Keep adding until stock (40): + dims and the message reads "Only 40 packs available".
- ✅ Haper mode, normal item: + still stops at 6 ("You can add up to 6 of this item.") exactly as before.
- ❌ Not allowed: a wholesale pack stopping at 6.

Bulk price table (item page)
- ✅ Open the tiered pack: a white "Bulk price" card under the price block, caption "Per pack", rows "10+ packs  2% off  ₹1127 each" and "15+ packs  5% off  ₹1092.50 each". Prices are the server's, shown to the paisa when not whole.
- ✅ Each row has an outlined "Add N" button. Tap "Add 10" with an empty cart: the cart quantity becomes exactly 10 (not +10); the sticky bar shows 10.
- ✅ With 10 in the cart: the 10+ row shows a plum left bar and "In cart" instead of the button; the 15+ row still shows "Add 15". Tap "Add 15": quantity becomes 15 (set, not +15) and the marker moves to the 15+ row.
- ✅ With 12 in the cart: the 10+ row reads "In cart" (tier reached); 15+ shows "Add 15".
- ✅ With 20 in the cart (tiers 10 and 15): BOTH rows read "In cart", no "Add" button anywhere, so this card can never cut the cart down. The plum bar is on the 15+ row only.
- ✅ Another device raises the line to 20 while this screen still shows 12: tap "Add 15" (item page or cart nudge): nothing is sent, and after a refresh the cart is still 20. Never lowered. (The cart's Set-quantity sheet can still lower it; see Set quantity below.)
- ✅ While a cart change on that item is in flight, the "Add N" buttons are dimmed and ignore taps.
- ✅ "Add N" buttons have a 48dp tap area (TalkBack touch exploration / Layout Inspector).
- ✅ Lower the quantity below 10 with the stepper: no row is marked.
- ✅ Pack with stock 12: the 15+ row button is dimmed and disabled, with "Only 12 available" under it; the 10+ row works.
- ✅ Pack without tiers, and a normal Haper item: no Bulk price card at all; price block as today.
- ✅ TalkBack: the card is "Bulk price"; each row reads like "10 or more packs, 2 percent off, ₹1127 each, button Add 10".

Cart line (Business cart)
- ✅ Quantity 12: the line shows the struck ₹1150, "₹1127 each", a "2% OFF bulk" chip (amber on cream) and the link "Add 3 more for 5% off". Tap the link: quantity becomes 15.
- ✅ Quantity 15: "₹1092.50 each", "5% OFF bulk", and the text "Best bulk price applied" (not tappable). No nudge.
- ✅ Quantity 9: no chip, no struck price; nudge "Add 1 more for 2% off".
- ✅ Quantity 5 (below the first tier): no chip, no struck price; nudge "Add 5 more for 2% off".
- ✅ Tiered line total: quantity 12 shows "Line total ₹13524" under the chip (server unit price x quantity). Lines without a tier show no line total.
- ✅ Pack without tiers: no chip, no nudge, no line total; the line looks as before.
- ✅ Haper cart (normal items): lines look as before; no chip, no nudge; the quantity number is not tappable.
- ✅ Bill: with no coupon, the bill's "Discount" row shows "-₹276" for the 12-pack cart. The row is labelled "Discount", not "Bulk discount". With a coupon the bill behaves differently; see `test-b2b-business-mode.md` note 10.
- ✅ While a change to the line is in flight, the "Add N more" link stops being tappable.
- ✅ Business cart: no "Apply a coupon" row and no gift skeleton, including while switching modes. The Haper cart keeps its coupon row.

Set quantity sheet
- ✅ Tap the number between - and + on a pack line (TalkBack: "Quantity 12, tap to set quantity"): bottom sheet "Set quantity" with the pack name, numeric keyboard already open, current number selected, "packs" after it.
- ✅ Type 20: helper reads "Up to 40 packs available. 15+ packs: 5% off, ₹1092.50 each." Summary row "20 packs" and total "₹21850". Tap Update: sheet closes, line shows 20.
- ✅ Empty field or 0: Update is disabled, no error text.
- ✅ Type 41 on a stock of 40: red border and "Only 40 packs available"; Update disabled. Type 40: allowed.
- ✅ Letters, "-" and "." cannot be typed (numeric keyboard + filter). Up to 7 digits.
- ✅ "Remove from cart" removes the line (and the cart goes to the empty state if it was the last).
- ✅ Network off, tap Update: the sheet stays open with red text "Couldn't update quantity. Try again."; the old quantity stays; Update works again after the network is back.
- ✅ While the update runs, Update is disabled; the sheet closes only when it succeeded.
- ✅ Tap the number right after tapping + (change still in flight): Update waits for that change, then sets the exact number typed (no "nothing happened", no wrong total). Typing the same number as the server has is a quiet close.
- ✅ Change the quantity from a second device, then Update here without refreshing: the result is exactly the typed number.
- ✅ Rotate or enlarge font to 200%: sheet stays usable, nothing clipped.
- ✅ Update can also LOWER a line (for example 12 to 9). The price then falls back to the tier that matches the new quantity.

Empty Business cart
- ✅ Business mode with nothing in the cart: "Your Business cart is empty" / "Add wholesale packs to get bulk prices. Your Haper cart is separate and unchanged." with "Browse wholesale items" (goes back). Haper empty cart still says "Your cart is empty".

Checkout double-tap (server lock)
- ✅ Two place-order requests for the same cart at the same moment (two phones on one account and cart): one order; the other shows "Your order is already being placed. Please wait a moment." The dialog title reads "Payment Failed" today. That title is an open wording decision (see `test-b2b-business-mode.md` note 4). The Place order button is disabled while placing, so one phone rarely triggers it.

Old backend / no tiers
- ✅ Against a backend that does not send `tiers` or `discountLabel`: no crash; wholesale items show no Bulk price card, cart lines show no chip or nudge; the only visible change is that wholesale packs can now go past 6.

Not in this step: a skeleton for the Bulk price card (the item page already shows a full-screen spinner until the item arrives).

Automated: `BulkTiersTest` (nudge maths, Set-quantity validation, tier-met and line total), `CartViewModelShopModeTest` (set quantity waits/re-reads/fails), `ShopModeStateTest`, `ShopModeEchoTest`, `CartQuantityCapTest`, `WholesaleBlockGsonTest`, `VariantCardBindingTest`, `WholesaleDisplayTest`. These exist for this feature; they were not re-run in the 2026-11-01 pass.
