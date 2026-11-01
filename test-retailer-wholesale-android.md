# Retailer application - Android walkthrough

Scope: Profile entry, Apply form, Status screen (Pending / Approved / Rejected / Suspended), Withdraw.
Not covered yet: wholesale packs, checkout payment options, credit (backend not ready).

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
