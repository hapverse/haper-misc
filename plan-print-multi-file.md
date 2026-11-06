# Plan: several files in one print order

APPROVED by the owner on 2026-11-06. BUILT on 2026-11-06 in all four code repos and reviewed; NOTHING IS COMMITTED YET (direct-to-dev workflow; the owner approves each commit). Not yet run on a device, a simulator or in a browser — only unit tests, builds and code review. Scope: dev only.

Design spec (source of truth, read it, do not copy it here): `haper-misc/design-print-multi-file.md`
Mockup (open in a browser): `haper-misc/design-print-multi-file-mockup.html`
Client architecture note (Phase 0 output): `haper-misc/arch-print-multi-file-client.md`
Backend reference: `haper-backend/docs/reference/print-order-quote.md`

All data in this plan and in the guides is made up.

---
## 1. Goal in two lines
A customer can pick several files (up to 10) in one print order. Each file keeps its own page range; copies and sides can be shared. The server prices the whole order and the apps only show what it returns.

## 2. Facts checked in code (do not re-derive)
- Server already accepts 1 to 10 jobs in one order, each with its own page range, copies and sides: `haper-backend/packages/user/src/routes/print/validator.js`.
- 20 MB per file. Upload is one file per request. The server processes 2 files at once.
- Order price is computed for all files together in `packages/shared/utils/print-pricing.utils.js`: the minimum applies to the sum, delivery is charged once.
- The three customer apps were single-file before this work:
  - Android: `app/src/main/java/com/bheldi/ui/screens/print/`
  - iOS: `haper/Views/Print*.swift`
  - web: `pages/Print*.tsx`
- Rate limits on upload: 20 an hour, 60 a day. Draft cap: 20 unordered files per customer. Drafts expire after 24 hours.

## 3. Owner's decisions (2026-11-06)
1. **Partial order: allowed.** If some files failed and others are ready, the customer can order the ready ones, but only after a sheet that says "1 file won't be printed" with the button "Continue without it".
2. **Minimum order top-up** is shown as its own row, "Minimum order top-up". File lines keep their real printing cost.
3. **Duplicate file** (same name and same size already in the list): skipped, with a note that points to Copies. No "Add again?" question.
4. **Backend additions: yes.** Both are additive. No existing field is renamed or removed.
   - a. `POST /user/print/quote` also accepts `jobs: [{ jobId, pageRange, copies, sides }]` and returns the order-level quote with per-file `lines`. It reuses the existing order pricing function, so apps never add up prices themselves. The existing single-`jobId` request keeps working unchanged for old app versions.
   - b. `GET /user/print/config` also returns the per-order limits: `maxFilesPerOrder` (10) and `maxPrintedSidesPerOrder` (500).
5. **Keeping the file list after the app is closed and reopened** (spec section 2.6): NOT built. See "Follow-ups (not built)".
6. **Order of apps: Android first**, then iOS and web.

## 4. Where the spec disagrees with the decisions
The spec stays as written. The decisions win. These parts were skipped or changed:
- Spec section 0 says "no server change is needed" and section 12 calls the order-level quote "recommended". Decision 4 makes it required. Apps must not use the "sum each file's quote on the phone" fallback.
- Spec section 2.5 says the 10-file limit is hard-coded. The apps now read it from `GET /user/print/config`. They use 10 only as a fallback if the field is missing (old backend).
- Spec section 2.6 and the "Restore notice" row in section 7 ("We kept 3 files...", "Start fresh") are NOT built. Also skip the "App killed and reopened" row logic in 2.5. After a restart the screen shows the empty state.
- Spec section 13 question 4 recommends saving drafts. The owner said no for now.
- Spec section 14 lists "client sum or order-level quote" for price. Only the order-level quote is allowed.
- Spec sections 11 and 14 mention swipe-to-remove, drag-and-drop, and a cash-limit hint on the list. All deferred.

---
## 5. Phases

### [x] Phase 0 — Plan and architecture note
- [x] This plan file. Done: file exists and the owner has seen it.
- [x] `haper-misc/arch-print-multi-file-client.md` — done (file list state model, 2-at-a-time upload queue, how the Android build was sliced).

### [x] Phase 1 — Backend (repo `haper-backend`)
- [x] Order-level quote: `POST /user/print/quote` also accepts `jobs[]` and returns the order-level quote with per-file lines (`lines[].jobId`, `lines[].subtotal`, `printSubtotal`, `minimumTopUp`). Pricing errors name the file. The single-`jobId` request is unchanged.
- [x] Config limits: `GET /user/print/config` returns `maxFilesPerOrder` and `maxPrintedSidesPerOrder`; old fields unchanged.
- [x] Reference doc: `haper-backend/docs/reference/print-order-quote.md`.
- [x] Evidence: code-reviewed twice, security-audited once (pass). Six print test files passed together (215 tests) before the last three small additions; the two files those touched pass (75 tests). **The full backend suite was NOT run.**
- **Deploy order: backend first, before any new app build is released.** Old apps keep working.

### [x] Phase 2 — Android (repo `haper-android`)
- [x] Built: upload queue, file list, shared and per-file settings, order-level prices, review and ordering, order placed / order detail lists, sign-out clean-up.
- [x] Evidence: code-reviewed in four rounds, security-audited twice (pass). Full unit suite 1,105 tests passed and `assembleDebug` succeeded at the last full run.
- [ ] Two small later fixes were NOT reviewed: an order refused because a file is already in another order now returns to the files; a "forbidden" reply only clears the list when the server says print is unavailable. They passed the print tests (369).

### [x] Phase 3 — iOS (repo `haper-ios`)
- [x] Same scope as Android — built. Code-reviewed in three rounds, security-audited twice (pass). Full suite 635 tests passed at the last full run.
- [ ] A last small round (keep the list on "Open that order", stronger payment-guard tests) was in progress when this file was updated. Check `git status` and the iOS test guide.
- Never trigger the iOS pipeline. Pushes go to `dev` only. No pull request for iOS.

### [x] Phase 4 — Web (repo `haper-web`)
- [x] Same scope — built. Code-reviewed three times, security-audited twice (pass). `tsc --noEmit` clean, 260 unit tests pass, `vite build` succeeds. This repo has no working eslint, so a "clean lint" proves nothing.
- The last eight small items came after the final review (tests only).

### [ ] Phase 5 — Test guides (repo `haper-misc`)
- [x] Updated with several-files sections: `test-print-customer-android.md`, `test-print-customer-ios.md`, `test-print-customer-web.md`, `test-print-checkout.md`.
- [ ] STILL TO DO: `test-print-upload.md` was not updated.
- [ ] STILL TO DO: `client-followups.md` has no rows for this work yet (not needed if all three apps ship together).

---
## 6. Acceptance criteria
Each item is covered by unit tests on every app, but none has been walked through on a device, simulator or browser yet — that manual pass (the test guides above) is the next step before release.

- [ ] Pick several files at once in one picker action. Example: pick 3 files, 3 rows appear in the order picked.
- [ ] Up to 10 files. The 11th is refused with the notice. Example: 9 in the list, pick 3, 1 is added and the notice says "We added 1 of the 3 you picked."
- [ ] Two uploads at a time. Each row shows its own status (Waiting, Uploading, Checking, Ready).
- [ ] One failed file never blocks the others. Example: a damaged file shows Failed with Retry and Remove; the other rows still become Ready.
- [ ] Partial order only after the sheet. "Continue with 2 files" opens "1 file won't be printed"; "Continue without it" removes the failed row; "Go back" changes nothing.
- [ ] Shared settings change copies and sides for all files; page range is always per file. Example: set 2 copies, both sides: every row says so; set pages 3-12 on one file: other rows still say "All pages".
- [ ] Totals always come from the server quote. The app never adds prices up. Check: change copies and watch the quote request go out before the total changes.
- [ ] Minimum top-up is its own row. Example: one file costs ₹6.00, minimum is ₹20.00: the file line shows ₹6.00 and a row "Minimum order top-up" shows ₹14.00.
- [ ] Delivery is charged once, however many files.
- [ ] Over the cash limit, the cash choice is hidden and the note reads: "Cash on delivery is available up to ₹300. This order is ₹340. Remove a file or pay online." with an "Edit files" action.
- [ ] More than 500 printed sides in total shows the "too big" error and Continue is disabled.
- [ ] One order with N files is created, and its detail screen lists all N.
- [ ] An old single-file app version still works against the new backend (quote, order, config).
- [ ] A customer cannot quote or order someone else's file (and not a file from another store). The server refuses it.
- [ ] Not expected: file list kept after app restart. Reopening Print shows the empty state.

## 7. Decisions made during the build
- **Money:** the apps never add prices up. Every amount shown is the server's. An order can only be placed for exactly the files and settings the server last priced. Totals are compared in paise.
- With several files the sides option reads "One side" / "Both sides" everywhere. The single-file screen keeps its old labels.
- A file with one page (or an image) never has a custom page range once there are several files.
- A file with Custom pages ticked and nothing typed shows "Pages: not set" and "Enter the pages to print."
- A file that cannot be read from the device shows "We couldn't read this file. Remove it and pick it again."
- Order detail and the order-placed screen show NO per-file amounts for an order with several files (the stored first line includes the minimum top-up). The order total still shows.
- The note-to-store field stays visible with several files.
- A file the server says must be added again is deleted from the server. So are uploaded files on sign-out, on a store change and when print is switched off.
- No upload starts while the consent box is unticked. On iOS the consent box now shows on the empty several-files screen.
- "Open that order" keeps the other uploaded files (all three apps).
- Web: money shows in the app's existing format ("₹24"). "Includes GST (18%)" is a label with no amount.
- The apps switch to several-files mode only when the server sends `maxFilesPerOrder`. Against an older server they behave as before.

## 8. Follow-ups (not built)
- **Product:** keep the file list after the app is closed and reopened; reorder files; web drag-and-drop; iOS swipe-to-remove; a "close to the cash limit" hint on the list; a list-my-drafts endpoint; undo on remove.
- **Backend:**
  - A rate limit on `POST /user/print/quote`.
  - Do not count "server busy" replies against the upload limit (automatic retries can otherwise use up the 20-an-hour allowance).
  - A dedicated error code for "too many printed sides" (the apps currently recognise it by its English message).
  - Optionally a shorter purge time for files released from an unpaid order.
- **Web:** react to login/logout in another browser tab app-wide (the print page already guards itself).
- **Android:**
  - The single-file screen still clears its file on any "forbidden" reply while pricing (pre-existing).
  - Logout can take up to about 9 seconds to clear the login, so a very fast re-login can be signed out again (pre-existing race, slightly wider).
  - The token-refresh resend can use a newer session's token (pre-existing).
- **iOS:** make the token refresh ignore a result that arrives after sign-out (also closes the existing push-token clean-up race).
- **All apps:** a manual pass with the test guides on real devices and browsers; then a full-suite run on the backend before release.

## 9. Risks and notes
- Pricing must stay on the server. If an app starts adding prices, totals will drift from what the order charges.
- The quote endpoint checks that every job belongs to the caller and to the current store.
- Upload rate limits (20 an hour, 60 a day) mean retries are not free. Do not auto-retry a rate-limited file.
- The 20-draft cap can be hit by files the screen cannot list (earlier visits, reinstall). Drafts expire after 24 hours. There is no list-my-drafts endpoint.
- **Deploy order:** backend first (old app versions keep working); then the apps in any order. Never the other way round. Nothing is committed yet.
- Work lands straight on `dev`; stage files by path; check `git status` first because other work is often uncommitted nearby.

## 10. How to resume
1. Read this file.
2. Read `design-print-multi-file.md`, `arch-print-multi-file-client.md` and `haper-backend/docs/reference/print-order-quote.md`.
3. Run `git status` in haper-backend, haper-android, haper-ios, haper-web and haper-misc — all the work is uncommitted on `dev`.
4. The next steps are: the owner's commit approval, then the manual test pass.
