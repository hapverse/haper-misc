# Test: Retailer (wholesale) program - iOS customer app (apply + status)

**Design:** `haper-misc/design-retailer-wholesale.md` sections 1-3. **Backend guide:** `haper-misc/test-retailer-wholesale.md` (do not edit from here).
**Needs first:** the backend retailer routes (`/user/retailer/me`, `/application`) must be DEPLOYED to dev (`dapi.haper.in`) and the store must have `wholesaleEnabled` on. Until then the Profile row never appears (the app hides the feature when `programEnabled` is false or the call fails).
**Not built here:** wholesale pills/packs, checkout payment options, credit screens.
**Status:** built, compiles (`xcodebuild build`), NOT yet run on a simulator or device. Every step below is untested (unit tests in RetailerTests pass, incl. ALREADY_APPLIED / cancelled-upload status re-check and the camera redraw).

## What this is (real example)

Ravi (fictional) opens Profile and sees **Become a retailer**. He fills "Madhur Kirana Store", picks Kirana, types GSTIN `10ABCDE1234F1ZF`, sees "Registered in Bihar", adds his shop address and map pin, takes a shop photo, taps Submit and lands on **Under review**. All names/GSTINs are fictional. Checksum-valid GSTINs: `10ABCDE1234F1ZF` (Bihar), `29AAAAA0000A1ZY` (Karnataka). Bad checksum: `10ABCDE1234F1ZG`.

## Setup
- A logged-in user on a store with the wholesale program on. Test on iPhone SE (smallest) and iPhone Pro Max, light + dark, Dynamic Type default and the largest accessibility size.
- To reset between runs: Withdraw the application from the status screen (server keeps history; 5 submissions per 30 days).

## 1. Profile entry
- [ ] Program off (or old backend): no retailer row, no chip anywhere.
- [ ] NONE + program on: first row in Preferences "Become a retailer / Buy in bulk at wholesale prices".
- [ ] PENDING: row "Retailer application / Under review" + "Under review" chip.
- [ ] REJECTED: "Needs your attention" + "Rejected" chip. SUSPENDED: "Account on hold" + "On hold" chip.
- [ ] APPROVED: no row; small plum "Retailer" chip under the name in the header, tap opens the status screen.
- [ ] Offline on opening Profile with nothing cached: no row (never a broken row). Row does not flash or jump on load.

## 2. Apply form
- [ ] Back with nothing typed leaves without a prompt; back after typing asks "Discard application?"; the edge swipe-back gesture is intentionally off on this screen (back button only), so it can never skip the discard or upload guard.
- [ ] Back while uploading: "Cancel upload?" (message "If the upload already finished, we'll show your application's status.") -> "Cancel upload" stops it (form and photos kept, no error banner) and the app re-checks the status: if the server had already received it, the screen switches to "Under review" by itself (no "Discard application?" for an application under review); if not, the form stays. "Keep uploading" continues.
- [ ] Cancel late (e.g. at "Finishing up..." on a slow network), then tap Submit again: either the screen has already switched to "Under review", or the banner says "You already have an application - showing its status." and the screen switches to the status screen. It never repeats "Couldn't submit your application".
- [ ] Leaving without submitting (Discard) leaves no `retailer-doc-*` files in the app tmp folder.
- [ ] Owner name is prefilled from the profile name and editable.
- [ ] Tap Submit on an empty form: all errors show and the screen scrolls to the first one (shop name). Button is never greyed out except while submitting.
- [ ] GSTIN: auto-uppercase, no spaces/symbols, max 15; counter "7/15" while typing, no error before 15.
  - [ ] `10ABCDE1234F1ZF` -> green check + "Registered in Bihar" (never the word "verified").
  - [ ] `10ABCDE1234F1ZG` -> "Check the last character - this GSTIN doesn't add up."
  - [ ] `00ABCDE1234F1ZF` -> "First two digits aren't a valid state code."
  - [ ] `ABABCDE1234F1ZF` -> format message.
- [ ] Business type: five chips, single select, wraps to extra rows at large text sizes.
- [ ] Address: opens a sheet; line 1, 6-digit PIN (ASCII digits only) and a map pin are required (town/city, district/village/landmark/line 2/state optional). Typing a PIN pre-centres the map; the pin only counts once confirmed on the map. Changing the PIN after confirming clears the pin (must confirm again). Cancel keeps the old address.
- [ ] Shop photo (required): "Take photo" (first time shows the iOS camera permission prompt with the shop-photo wording) or "Choose from library"; tile shows the image with Retake and an X. Camera permission denied -> inline "Camera access is off..." with a Settings button; library still works. Simulator has no camera: only the library option shows.
- [ ] GST certificate (optional): image from library, or image/PDF from Files; PDF shows name + size. A PDF over 10 MB or a non-PDF/non-image file shows an error on that tile.
- [ ] Lock note "Only Haper's verification team can see your photos and documents." visible under the tiles.
- [ ] Text "usually within 1 working day" appears nowhere.
- [ ] Submit with a huge photo (e.g. 12 MP): it is downscaled (1600 px, JPEG) and goes through; progress bar shows "Uploading N%".
- [ ] While submitting: fields are read-only, button shows "Submitting...".
- [ ] Success: status screen "Under review" with a check-circle pop (static with Reduce Motion) and a VoiceOver announcement "Application submitted, under review".
- [ ] Keyboard never hides the focused field; Submit bar stays above the keyboard and the home indicator.

## 3. Server errors (use a second account / dev data)
- [ ] GSTIN already used by another account (409 GSTIN_TAKEN): GSTIN field error "This GSTIN is already registered. Contact support if it's yours." + a Contact support link that opens the support screen.
- [ ] Airplane mode on Submit: banner "Couldn't submit. Check your connection and try again."; all inputs and photos kept; Submit again works once back online.
- [ ] 6th submission in 30 days (429 RESUBMIT_LIMIT): banner about the 5-per-month limit. Many rapid attempts (generic 429): "Try again later."
- [ ] Backend index/upload unavailable (503): "Wholesale applications are unavailable right now. Please try again in a little while."
- [ ] Unknown error code: generic "Couldn't submit your application. Please try again." (raw server text is never shown).
- [ ] Already applied elsewhere (409 ALREADY_APPLIED, e.g. applied on Android, then Submit on an iPhone that still shows the form): banner "You already have an application - showing its status." and the screen switches to the status screen by itself. Same during "Edit and resubmit" if the application is already PENDING again. If the status check fails (offline), the banner changes to "Couldn't load your application. Try again." with a Retry button (see the fetch-failure step below); Retry then moves to the status screen.

- [ ] Submit, then right after "Finishing up..." kill the network (or cancel the upload): the app lands on Pending with Shop, GSTIN (masked) and Submitted date filled in even if the follow-up fetch fails; no duplicate application is created.
- [ ] ALREADY_APPLIED with the status fetch failing (airplane mode right after the 409): banner reads "Couldn't load your application. Try again." with a Retry button; Retry loads the status screen.

## 4. Status screen
- [ ] Skeleton while loading; pull to refresh; refreshes on return from background.
- [ ] Offline/failed refresh with data already shown: banner "Can't refresh. Retry" + last updated time; with no data: "Couldn't load your application" + Retry.
- [ ] PENDING: hourglass, summary (shop, GSTIN as `10ABCDE****ZF`, submitted date), 3-step timeline, "Withdraw application" -> confirm -> returns to Profile and the row says "Become a retailer" again.
- [ ] Withdraw fails (offline): inline error, stays on screen.
- [ ] REJECTED: reason label + ops note (full text) + date + "N submissions left in 30 days"; "Edit and resubmit" opens the form prefilled (banner "Last time: ..."; the related field has an amber outline); "Contact support" opens support.
- [ ] Resubmit without changing anything: "Change something first - we can only re-review an updated application." Existing photo shows as "Already uploaded" (replaceable) and is not re-sent unless replaced.
- [ ] SUSPENDED: neutral lock icon, reason (or "Ask support for details"), only "Contact support", no re-apply.
- [ ] APPROVED: check icon, summary, "Cash on delivery: On/Off" row from `settings` (read-only), no buttons.
- [ ] Status changes while open (approve/reject from admin, then pull to refresh): content updates with a short crossfade.
- [ ] VoiceOver: title is a heading, icon hidden, status never colour-only; touch targets >= 44 pt.

## Edge cases
- [ ] Old backend (no `/user/retailer/me`, 404): no row, no crash.
- [ ] `me` response with missing/odd fields (null reason, unknown status): no crash; unknown status hides the row.
- [ ] Logout then login as another user: no previous user's retailer data shown.
- [ ] `{"programEnabled":true}` with NO `status` key: row hidden (not "Become a retailer").
- [ ] 48 MP photo from library/camera: UI stays responsive (picked off the main thread), no memory spike (library/Files photos are decoded subsampled; a camera photo is redrawn at 1600 px, never re-encoded at full size); a >10 MB PDF is rejected without being read.
- [ ] Tapping Submit with a ~10 MB PDF + photo: no UI hitch at the tap (the upload body is assembled off the main thread).
- [ ] Server rejects a file (413/415/422) with BOTH photo and certificate attached: general banner "One of your files couldn't be used. Try a different photo or PDF." and no tile marked bad (server names no field). With only one file attached, that tile is marked.
- [ ] Low Power / background mid-upload: upload fails cleanly with the network banner, form intact.

## Known gaps / deviations
- Dismissible Home strip (design: optional) not built. Push deep-link to the status screen not built.
- The Profile row keeps showing the last known state if a later refresh fails (design says hide on error).
- RESUBMIT_LIMIT message has no date (server sends none).
