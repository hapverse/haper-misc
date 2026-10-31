# Test guide - Become a retailer (haper-web)

Customer web flow: apply + status. Design: `design-retailer-wholesale.md` sections 1-3.
Not covered here: wholesale packs, checkout payment options, credit.

## Needs first
- Backend with `/user/retailer/*` must be DEPLOYED to the dev API (`dev1.api.haper.in`). Without it the Profile row never shows (fails closed) and the pages show "Couldn't load".
- The store must have wholesale switched on (`programEnabled: true` in `GET /user/retailer/me`). Off = no row, and `/retailer/*` URLs bounce to Profile.
- Web only reads. Admin approve/reject/suspend happens in haper-admin (needed to see the other states).
- No browser run was done when this was written - run the steps below.

## Routes
`#/retailer/apply`, `#/retailer/status` (HashRouter, login required).

## 1. Profile entry
- ✅ Status NONE + program on: "Become a retailer / Buy in bulk at wholesale prices" row first in Quick Access. Click opens the form.
- ✅ PENDING / REJECTED / SUSPENDED: row reads "Retailer application" with chip (Under review / Rejected / On hold) and sub text. Click opens Status.
- ✅ APPROVED: no row; a "Retailer" chip sits beside "Secure account" in the header; click opens Status.
- ✅ Program off, or `/me` fails: no row, nothing broken, no error shown.
- ✅ Row is keyboard reachable (Tab, Enter/Space) with a visible focus ring.

## 2. Apply form
- ✅ Submit with everything empty: stays enabled, shows all errors, focus + scroll to the first invalid field (shop name).
- ✅ Errors also appear on blur of a single field.
- ✅ GSTIN: type lowercase / spaces -> uppercased, spaces removed, max 15, counter "n/15". No error while typing under 15 (error only after blur or submit).
- ✅ At 15 chars valid -> "Registered in {State}" (never "verified"). Bad format / bad last character / unknown state code -> the matching message.
- ✅ Valid GSTIN example: build one with a correct check character (the `10ABCDE1234F1Z5` hint is NOT guaranteed valid).
- ✅ PIN accepts digits only, 6 required. City required. Location: "Use my current location" fills lat/long; denying permission shows a note and the fields can be typed.
- ✅ Shop photo: required first time. Camera (mobile) or file. A large photo is shrunk to 1600px JPEG client-side. A non-image / undecodable file (e.g. HEIC on desktop) -> "Photo is too large or not an image. Try another."
- ✅ Any image over 25 MB is rejected before decoding with the same friendly error (no memory crash on a 40-50 MB photo).
- ✅ PENDING card shows a "Submitted {date}" row when the server sends `application.submittedAt`; no row if absent.
- ✅ Profile retailer row appears even with no cached store (request resolves the store first).
- ✅ File tile errors are announced with the button (aria-describedby).
- Unit tests: `node --test utils/*.test.mjs`
- ✅ GST certificate optional: image or PDF; PDF over 10 MB or other type -> error.
- ✅ Lock note under photos. Consent line with Privacy policy link. No "usually within 1 working day" text.
- ✅ Submit: button shows loading, fields locked; success -> toast and Status page (Under review).
- ❌ (expected) Server errors, form values are kept in every case:
  - GSTIN already used -> field error with "Contact support" link (opens /support), focus on GSTIN.
  - GSTIN rejected by server -> GSTIN field error.
  - 409 already applied -> goes to Status.
  - 429 resubmit limit -> banner "limit of 5 submissions this month".
  - Other 429 -> "Too many attempts. Try again later."
  - 413 / 415 / 422 -> banner about the file.
  - 503 or 5xx -> banner "Our side - try again in a minute"; offline -> "Check your connection". Submit again works.
- ✅ Back with data typed -> "Discard application?" (Keep editing / Discard). Closing the tab also warns.
- ✅ Visiting `#/retailer/apply` while PENDING/APPROVED/SUSPENDED -> redirected to Status.

## 3. Status page
- ✅ PENDING: "Under review", masked GSTIN (`10ABCDE****Z5`), progress line, "Withdraw application" -> confirm -> back to Profile, row returns to "Become a retailer".
- ✅ APPROVED: "You're a verified retailer", what-changes list, Cash on delivery On/Off row, "Browse wholesale items" -> Home.
- ✅ REJECTED: reason label (server label) + note quoted + date + "N submissions left this month". "Edit and resubmit" opens the form prefilled with a "Last time: ..." banner; "Contact support" opens /support.
  - PHOTO_UNCLEAR: photo must be re-added (amber outline). Other reasons: photo shows "Already uploaded", can be left alone (backend reuses it).
  - GSTIN_* reason: GSTIN field outlined amber. NOT_A_SHOP: shop name + photo outlined.
  - Resubmit with nothing changed -> "Change something first - we can only re-review an updated application." (no request sent).
  - 0 submissions left -> "Edit and resubmit" disabled.
- ✅ SUSPENDED: neutral lock, "Wholesale access on hold", reason text (or "Ask support for details."), only "Contact support". No withdraw, no reapply.
- ✅ Loading skeleton; fetch error with no data -> "Couldn't load" + Retry; fetch error after data -> last status stays with "Can't refresh" + Retry.
- ✅ Returning to the tab refetches (approval while open updates the page).
- ✅ Dark mode readable; narrow phone width has no horizontal scroll; Tab order follows visual order.

## Edge cases
- Old/odd `/me` payload (missing fields, unknown status): treated as NONE / blanks, no crash.
- Double-tap Submit: only one request (button locked).
- Token expired mid-submit: api client refreshes and retries once.

## Known differences from Android
- No map picker on web (none exists in haper-web): location is "use my current location" or typed latitude/longitude.
- No upload percentage (plain fetch): shows "Uploading. Keep this page open."
- No push deep link; Status refreshes on tab focus.

## Checks run
`npx tsc --noEmit`, `npx vite build`, `node --test utils/gstin.test.mjs` (GSTIN validator). haper-web has no working eslint gate.
