# Test: Retailer (wholesale) program — part 1: application + verification

**Plan:** `haper-backend/docs/plans/retailer-wholesale.md` (rev 2, Phase 1A steps 5-7). Design: `haper-misc/design-retailer-wholesale.md` §1-§3, §7-§9.
**Backend:** customer `packages/user/src/routes/retailer/*`, admin `packages/admin/src/routes/retailer/*`,
state machine `packages/shared/repositories/retailer-profile.repository.js`, documents `packages/shared/utils/retailer-document.utils.js`.
**New admin permission:** `retailers.verify` (approve / reject). haper-admin's `permissions.ts` must mirror it (FE/BE mirror rule) when the Retailers page is built.
**Branch:** `dev` (direct-to-dev workflow).
**Later parts of this guide:** wholesale visibility, packs, COD switch at checkout, B2B invoice (other lanes add their sections below).

## What this is (a real example)

Ravi owns "Sharma Kirana" in Chapra and wants to buy Maggi by the box. In the app he taps **Become a retailer**, fills in shop name, legal name, owner name, business type, his GSTIN (the 15-character GST number of a business, e.g. `10ABCDE1234F1ZF`, fictional), the shop address with a map pin, and a photo of his shop. The application goes to **Under review** (PENDING).

An ops person opens **Admin → Retailers**, looks at the photo through a link that works for 5 minutes, checks the GSTIN by hand on the government GST portal, ticks "I checked the GST portal", and clicks **Approve**. Or **Reject** with a reason ("Shop photo is unclear") so Ravi can fix it and resubmit (at most 5 submissions in 30 days).

Only a super admin can later **Suspend** / **Reinstate** Ravi, or turn on **cash on delivery for wholesale orders** for him. "Pay later" (credit) is refused by the server until the credit phase.

All names, numbers and GSTINs in this guide are fictional. Test GSTINs that pass the checksum: `10ABCDE1234F1ZF` (Bihar), `29AAAAA0000A1ZY` (Karnataka). A bad checksum example: `10ABCDE1234F1ZG`.

## Deploy order / what is needed

1. **Backend first** (user + admin services). Nothing changes for any customer until a client build uses the new endpoints.
2. The private document bucket must be set: `PRINT_S3_BUCKET` on the **user** and **admin** services (same bucket print uses; documents go under `retailer/<userId>/`). Without it, applying answers 503 and admin shows no photo.
   - If that bucket has a lifecycle expiry rule, it must be scoped to the `print/` prefix only, or retailer KYC photos will be deleted too.
   - **USER-RUN in AWS (not done by agents — agents never touch AWS):**
     a. **U1 (do this FIRST, before step 5):** add a **Deny on `retailer/*`** to the shared bucket's policy for the CloudFront distribution (same shape as today's deny on `print/*`). KYC documents (shop photo, GST certificate) must never be readable through the CDN; today only `print/*` is denied.
     b. Confirm the **user API** and **admin API** IAM identities can `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `retailer/*` in that bucket, and the **cron** identity can `s3:DeleteObject` on `retailer/*` (account purge + the nightly retailer-document-sweep delete documents of deleted accounts). If a policy is scoped to `print/*` only, every application fails with 500 when the photo is stored (user/admin), or deleted accounts' documents are never removed (cron: the sweep raises the `retailer.document_purge_overdue` alert after 3 days). Also re-check that any lifecycle expiry rule is scoped to `print/` only (see above).
3. On boot, both services check the two unique indexes (`uniq_rp_user`, `uniq_rp_gstin_live`). If the log says `[retailer-profiles] CRITICAL: index(es) missing`, applying and approving answer 503 until the index exists. No restart needed: the check re-runs by itself at most once a minute on the next apply/approve.
4. Admin FE (Retailers page) and customer apps (apply/status screens) come after; until then test with curl/Postman.
5. **Turn applications on (USER-RUN, only after U1 is done and checked).** Applications are **OFF by default**: `POST /user/retailer/application` answers 503 `PROGRAM_DISABLED` and `GET /user/retailer/me` says `programEnabled: false` everywhere. To open them, set `RETAILER_APPLICATIONS_ENABLED=true` on the **user API** (Parameter Store / pm2 env, same place as `PRINT_S3_BUCKET`), then `pm2 restart Haper_Dev_User --update-env` (prod: the prod user API name). `1` and `on` also work; anything else (unset, `false`, `yes`) means OFF. To close applications again, set it to `false` and restart the same way; existing applicants can still see their status and withdraw.
   - Why the order matters: a shop photo or GST certificate is KYC data. Until the CDN is denied `retailer/*`, anyone who once saw an admin's 5-minute document link (it contains the storage key) could fetch the same file through the CDN for ever.
6. The **cron** service needs `PRINT_S3_BUCKET` too (already set for print) and `s3:DeleteObject` on `retailer/*` (step 4b): the account-purge job deletes a deleted user's shop photo / GST certificate. If it cannot delete one, the account is still wiped; the key stays on the anonymised profile and the nightly retailer-document-sweep (2:20 AM IST) retries it. Still failing 3 days after the purge → `retailer.document_purge_overdue` alert in the daily alert digest.

Applying does **not** require the store's `wholesaleEnabled` flag, but it does need the global switch (step 5) and an **active** store in `x-store-id`. `programEnabled` in `GET /user/retailer/me` = switch ON **and** the store's `wholesaleEnabled`; it only tells the app whether to show the entry point.

## Endpoints

| Method + path | Who | Notes |
|---|---|---|
| `GET /user/retailer/me` | logged-in customer, `x-store-id` | `{status: NONE/PENDING/APPROVED/REJECTED/SUSPENDED, programEnabled, resubmitsLeft, application?, rejection?, suspension?, settings?}` |
| `POST /user/retailer/application` | customer, multipart | fields `shopName, legalName, ownerName, businessType, gstin, address` + files `shopPhoto` (required first time), `gstCertificate` (optional, image or PDF). `address` = JSON string `{line1, line2, landmark, village, city, district, state, pin, latitude, longitude}` or bracket fields `address[line1]`... |
| `DELETE /user/retailer/application` | customer | withdraw while PENDING |
| `GET /admin/retailer?status=&storeId=&q=&page=&limit=` | `retailers.verify` | store admin / staff: own store only |
| `GET /admin/retailer/:id` | `retailers.verify` | profile + 5-minute document links + GST checks + history |
| `POST /admin/retailer/:id/approve` | `retailers.verify` | `{rev, gstChecked: true}` |
| `POST /admin/retailer/:id/reject` | `retailers.verify` | `{rev, reasonCode, note?}` (note required for `OTHER`) |
| `POST /admin/retailer/:id/suspend` | super admin only | `{rev, reason}` |
| `POST /admin/retailer/:id/reinstate` | super admin only | `{rev, reason?}` |
| `PATCH /admin/retailer/:id/settings` | super admin only | `{rev, codEnabled}`; `creditEnabled` → 400 `SETTING_UNAVAILABLE` |

`rev` is the profile's version number from the last read. If someone else changed the profile since, the server answers 409 `STALE` ("updated by someone else, refresh").

---

## ✅ A. Customer applies

1. ✅ `GET /user/retailer/me` for a new customer → `status: "NONE"`, `resubmitsLeft: 5`, `programEnabled` = switch ON and the store's wholesale flag.
2. ✅ Submit a full application with a shop photo → **201** `{status: "PENDING"}`.
3. ✅ `GET /me` → `PENDING`, `application` shows the shop name, GSTIN, address with latitude/longitude, `hasShopPhoto: true`. No storage key or bucket path appears anywhere in the response.
4. ✅ The photo in the bucket is a re-encoded JPEG under `retailer/<userId>/shop-<uuid>.jpg`, longest side at most 1600 px, no EXIF/GPS.
5. ✅ A PDF GST certificate is stored as a rebuilt PDF (`gst-<uuid>.pdf`); an image certificate as JPEG.
6. ✅ Address sent as bracket fields (`address[line1]=...`) works the same as a JSON string.

## ❌ B. Customer apply errors (each must store NO new object unless noted)

1. ❌ GSTIN with a wrong last character (`10ABCDE1234F1ZG`) → 400 `GSTIN_INVALID`. The error message never repeats the GSTIN.
2. ❌ PIN `84130` (5 digits) → 400 `FIELD_INVALID` with the message `PIN must be 6 digits` (the PIN itself is not repeated in the response or the server log).
3. ❌ No shop photo on the first application → 400 `FIELD_INVALID`.
4. ❌ A text file renamed `.png` → 415 `UNSUPPORTED_FILE`. A file over 10 MB → 413 `FILE_TOO_LARGE`.
5. ❌ GSTIN already held by another PENDING/APPROVED/SUSPENDED retailer → 409 `GSTIN_TAKEN` ("already registered, contact support"). The photo uploaded for this attempt is deleted again.
6. ❌ Applying again while PENDING or APPROVED → 409 `ALREADY_APPLIED` (refused before the file is even read).
7. ❌ 6th submission within 30 days → 429 `RESUBMIT_LIMIT` (refused before the file is read). `GET /me` shows `resubmitsLeft: 0`.
8. ❌ Private bucket not configured → 503 `UPLOAD_UNAVAILABLE`.
9. ❌ Unique index missing at boot → 503 `RETAILER_INDEX_MISSING`. After the index is rebuilt, applying works again within about a minute without a restart.
10. ❌ More than 10 `POST /user/retailer/application` calls by one customer within an hour → 429 `TOO_MANY_ATTEMPTS` ("Too many attempts. Please try again later."), refused before any file is read. Failed attempts count too (a bad GSTIN, a 409 `GSTIN_TAKEN`), so nobody can test many GSTINs to find out which are registered. Another customer is not affected. Example: Ravi types 10 wrong GSTINs in a row; the 11th try, even with a correct GSTIN, gets 429 until the hour since his first try has passed.
11. ✅ If Redis is down, applying still works (the 5-per-30-days limit still holds).
12. ❌ An audit-log write failure during apply → 500 "Could not submit the retailer application" (never the raw database text); the uploaded photo is deleted. A brief database hiccup on that write is retried automatically and the apply succeeds.

## ✅ C. Withdraw

1. ✅ While PENDING: `DELETE /user/retailer/application` → 200 `{status: "NONE"}`.
2. ✅ `GET /me` → `NONE`, and `resubmitsLeft` is still reduced (withdraw does not reset the 5-per-30-days limit).
3. ✅ The profile is kept as `WITHDRAWN` with its history (`submit`, `withdraw`); the GSTIN is free for someone else.
4. ✅ Applying again reuses the same profile and counts as a new submission.
5. ❌ Nothing pending → 404. An APPROVED retailer cannot withdraw → 409 `INVALID_TRANSITION`.

## ✅ D. Admin list and detail

1. ✅ Super admin `GET /admin/retailer?status=PENDING` → oldest first (waiting longest); other tabs newest first. `counts` gives per-status numbers for the store scope (badges ignore the search box).
2. ✅ `?q=` finds by shop / owner / legal name, by GSTIN in any case with spaces (`" 10abcde 1234f1zf "`), and by the applicant's phone digits.
3. ✅ Super admin `?storeId=` filters one store. A store admin sees only their own store; `?storeId=<other store>` → 403.
4. ✅ Detail shows `documents.photoUrl` / `certUrl` valid for 5 minutes (`X-Amz-Expires=300`), `gstCheck` (valid, state from the GSTIN vs address state, earlier profiles with the same GSTIN, how many other profiles share the PAN part). A **store admin / staff** sees same-GSTIN profiles of their own store only in `gstCheck.sameGstin`; other stores' ones are only counted in `gstCheck.sameGstinOtherStores` (no shop names or statuses). A super admin sees all of them and `sameGstinOtherStores: 0`, user name/phone, store, and the full history (oldest first). Response is `Cache-Control: no-store`.
5. ✅ If the bucket is missing, detail still loads with `photoUrl: null`; the server log shows only the last 4 GSTIN characters.
6. ❌ Store admin of another store opening the detail → 403. Manager/support without `retailers.verify` → 403. A warehouse role (no store) → 403 even if granted the permission.

## ✅ E. Approve / reject

1. ❌ Approve without `gstChecked: true` → 400 `GST_CHECK_REQUIRED`. Without `rev` → 400 `REV_REQUIRED`. `gstChecked: "true"` (a string, not a JSON boolean) → 400 `FIELD_INVALID`, nothing changes. Same for `codEnabled: "true"` on settings.
2. ✅ Approve with `{rev, gstChecked: true}` → `APPROVED`, `gstCheckedBy/At` and `approvedBy/At` stamped, a history row and an admin audit row `retailer.approve`.
3. ✅ The customer sees wholesale within 60 s at most (the cache key `rtl_<userId>` is cleared right after approve; another server process may hold it up to its 60 s TTL).
4. ✅ Reject with a reason code → `REJECTED`; the customer's `GET /me` shows `rejection.code`, `label` and `note`. `OTHER` without a note → 400.
5. ✅ Resubmit after reject: must change something (else 400 `APPLICATION_UNCHANGED`); the photo already on file is kept if no new one is sent; a new photo replaces it and the old object is deleted only after the save has committed. Which photo/certificate is "on file" is read inside the save itself, so two quick resubmits never delete a photo the saved profile still uses.
6. ❌ GSTIN taken by someone else between the reject and the resubmit → 409 `GSTIN_TAKEN`; the profile stays REJECTED and the newly uploaded photo is deleted.
7. ❌ Two admins act on the same application at once (approve + reject with the same `rev`) → exactly one succeeds, the other gets 409 `STALE` with `details: {status: <winner's status>, rev: 1}`; nothing is overwritten.
   - ❌ Same idea when the status did not change: an admin opened a PENDING application (rev 0), it was then rejected and resubmitted (PENDING again, rev 2); approving with rev 0 → 409 `STALE`, nothing changes. Two super admins flipping `codEnabled` at the same `rev` → one wins, the other 409 `STALE`.
8. ✅ Store admin approves their own store's applicant. ❌ Another store's applicant → 403 and the profile is unchanged.
9. ✅ Manager/support granted `retailers.verify` can approve/reject. ❌ Without it → 403 `requiredPermission: "retailers.verify"`.
10. ❌ An application submitted with no store can only be acted on by a super admin.

## ✅ F. Suspend / reinstate / payment switch (super admin only)

1. ❌ Store admin or a manager with `retailers.verify` → 403 on suspend, reinstate and settings.
2. ✅ Suspend `{rev, reason}` → `SUSPENDED`; the customer's `GET /me` shows `suspension.reason`; wholesale disappears within 60 s. A missing reason → 400.
3. ✅ Reinstate → `APPROVED` again; the suspension stays in the history.
4. ✅ `PATCH settings {rev, codEnabled: true}` → saved, history row `settings`. Takes effect at the retailer's next checkout (checkout lane).
5. ❌ `creditEnabled` in the body (alone or with `codEnabled`) → 400 `SETTING_UNAVAILABLE`; nothing changes. Turned on only at the credit phase gate (one constant: `RetailerConstants.EDITABLE_SETTINGS_KEYS`).
6. ❌ A stale `rev` → 409 `STALE`.

## Edge cases

- A customer with no `x-store-id` gets the usual "Could not find a store" 400 from the geo middleware (same as other store-bound routes).
- Approval is global: approved in one store's queue, the retailer sees wholesale in every store where the flag is ON.
- Resubmitting from another store moves the application into that store's queue (its `storeId` is updated).
- Old app builds never call these endpoints; nothing changes for them.

## Automated tests

- `cd packages/user && NODE_ENV=test npx jest __tests__/retailer-application.test.js`
- `cd packages/admin && NODE_ENV=test npx jest __tests__/retailer-verify.test.js`
- State machine: `packages/admin/__tests__/retailer-profile-repository.test.js`; viewer cache: `packages/user/__tests__/retailer-viewer.test.js`.

---

# Part 2: wholesale visibility (who can see wholesale items)

**Plan:** Phase 1B steps 8-10 (§3.3, V1-V10 + V12b). **Backend:** `shared/utils/item-visibility.utils.js` + `taxonomy.utils.js` (one shared "customer can see this" rule), `shared/repositories/{item,category,sub-category,category-search}.repository.js`, `user/src/routes/{home,item}/controller.js`, presenters `user/src/utils/present-items.js` + `shared/utils/variant-present.utils.js`.
**Deploy:** user service only. No migration, no index. Nothing changes for anyone while every store has `wholesaleEnabled` off (today: all stores).
**How to get a wholesale item before Phase 1C:** there is no admin screen yet. The item must carry `wholesaleOnly: true` (and, for a pack, `packOf: {baseIId, units}`). Phase 1C adds the admin pack flow; until then the user sets the key on one dev item by hand. Agents never write to a database.

## What this is (a real example)

The store sells "Premium Sugar 500g" for ₹28 and also a wholesale "Premium Sugar 500g - Pack of 20" for ₹520. Ravi is an APPROVED retailer and the store has wholesale ON, so he sees the pack everywhere (home, aisle, size sheet, search, item page). His neighbour, a normal customer, sees exactly what she saw before: no pack, no "Bulk Packs" category tile, and the Staples tile still says "3 items, from ₹25" (the pack is not counted).

Who sees wholesale = store flag ON **and** viewer is APPROVED. Everyone else (no profile, PENDING, REJECTED, SUSPENDED, or any viewer while the flag is OFF) gets today's response, byte for byte.

## ✅ G. Approved retailer, store flag ON

1. ✅ `GET /user/home/items?page=1` (old and new app) lists the pack.
2. ✅ Aisle `GET /user/home/items/<staples>/<sugar>/1` lists it; with `x-client-features: variants-v1` the pack is a row in the sugar card's size sheet (`variants`), not a separate card.
3. ✅ The pack row / item has `wholesale: {units: 20, perUnitPrice: 26, baseLabel: "500 g"}`. A wholesale item that is not a pack has `wholesale: {units: null, perUnitPrice: null, baseLabel: null}`.
4. ✅ The card's `fromPrice` stays the cheapest RETAIL size (₹28), never the pack. If only the pack is in stock, `fromPrice` is the pack price. `optionCount` includes the pack.
5. ✅ `GET /user/item/<pack id>`, `/user/item/SUG-500-P20` (iId) and `/user/item/<pack barcode>` return the pack.
6. ✅ Search "sugar" lists it; search "bulk" shows a "Bulk Packs" chip if a category holds only wholesale items.
7. ✅ `GET /user/home/category` shows the wholesale-only category tile; counts and cheapest price include wholesale items. `GET /user/home/sub-category/<staples>` shows the wholesale-only sub-category.
8. ✅ No response anywhere carries the raw keys `wholesaleOnly`, `packOf` or `hsn`.

## ❌ H. Everyone else sees nothing wholesale

For each viewer: no retailer profile, PENDING, REJECTED, SUSPENDED, and an APPROVED retailer while the store flag is OFF:
1. ❌ None of the calls in G list the pack or the wholesale-only item, in any app version.
2. ❌ Item page by `_id`, iId or barcode → `{item: null}` exactly like an out-of-stock item.
3. ❌ No wholesale-only category or sub-category tile; Staples counts and cheapest price ignore wholesale items.
4. ❌ Search "bulk" → no chip; falls back to "you might like these" (retail items only).
5. ✅ Suspend an approved retailer → wholesale disappears from browse within 60 s (viewer cache TTL).

## Edge cases

- Approval is global: the same retailer sees wholesale in every store whose flag is ON, nothing in stores where it is OFF.
- Any Redis/DB error while checking the viewer → served as a normal customer (wholesale hidden), never the other way round.
- Cart and wishlist lines (V11/V12) and checkout (V13) are later parts of this phase; until then a just-suspended retailer may still have a pack in their cart.

## Automated tests (part 2)

- `cd packages/user && NODE_ENV=test npx jest __tests__/wholesale-visibility.test.js` (tenancy matrix, repository defaults, Atlas pipeline order, golden-fixture equality for normal customers)
- `cd packages/user && NODE_ENV=test npx jest __tests__/customer-item-predicate-gate.test.js` (fails if a customer repository re-inlines its own visibility filter)

---

# Security hardening (audit batch 1)

**Backend:** `user/src/routes/retailer/controller.js`, `shared/repositories/retailer-profile.repository.js`, `shared/utils/retailer-document.utils.js` + `print-normalise.utils.js` (shared processing slots), `cron/src/jobs/account-purge.js` + `cron/src/jobs/retailer-document-sweep.js` (new, scheduled 2:20 AM IST) + `cron/src/lib/payment-alert-codes.js`, `admin/src/routes/retailer/*` (unblock GSTIN), `shared/repositories/order.repository.js` + `delivery/src/routes/order/controller.js`.
**Deploy:** user API, admin API (new reject code + unblock route), cron (new sweep job; needs `PRINT_S3_BUCKET` + `s3:DeleteObject` on `retailer/*`), delivery API. No migration, no new index. New profile keys (`blockedGstins`, `anonymisedAt`) are absent on old profiles and never sent to the customer app.

## ❌ S1. Applications are closed until the switch is on (deploy step 5)

1. ❌ Switch unset / `false` / `yes` → `POST /user/retailer/application` 503 `PROGRAM_DISABLED` "Retailer applications are not open yet. Please try again later." Nothing is uploaded and the attempt counter does not move.
2. ✅ `RETAILER_APPLICATIONS_ENABLED=true` (or `1`, ` ON `) → applying works as in section A.
3. ❌ Switch off, store has `wholesaleEnabled: true` → `GET /me` says `programEnabled: false` (apps hide "Become a retailer"). Switch on → `true`.
4. ✅ Switch off: a customer who already applied still sees their status and can withdraw.

## ❌ S2. The store in `x-store-id` must be real and active

Example: someone sends `x-store-id` of a closed store to get reviewed by its (absent) staff.
1. ❌ Store with status Inactive (0) or Onboarding (2) → 400 `STORE_UNAVAILABLE`, nothing uploaded.
2. ❌ Unknown or malformed store id → 400 `STORE_UNAVAILABLE`.
3. ✅ An old store document with no `status` field counts as active.

## ❌ S3. Upload limits

1. ❌ Same customer sends a second application while the first is still uploading → 429 `UPLOAD_IN_PROGRESS` ("Your application is still uploading..."). Another customer is not affected. When the first finishes (success or error, including a 413), the customer can send again straight away; if the server loses the release, the hold expires by itself after 2 minutes.
   - ❌ The app (or a script) cancels the request after the upload reached the server and retries at once → still 429 until the server has finished the first one (photo processing, storage, save). Cancelling does not skip the queue.
   - ✅ The app cancels while the file is still being sent, or during the early checks → the hold is given back at once; the next try works.
2. ✅ Redis down → the one-at-a-time hold is skipped (applying still works), like the attempt counter.
3. ❌ Server busy: photo re-encoding now shares the print service's processing slots (`PRINT_NORMALISE_CONCURRENCY`, default 2; `PRINT_NORMALISE_QUEUE`, default 2 waiting). When all are taken and the queue is full → 503 `PROCESSING_BUSY` ("We are processing many files right now..."), nothing stored. A photo and a certificate in the same request are processed one after the other, so one request never blocks itself.

## ❌ S4. Someone holds another shop's GSTIN (squatting) — support path

GSTINs are public, so anyone can type another shop's number. Example: Mohan applies with Ravi's GSTIN `10ABCDE1234F1ZF` (fictional). When Ravi applies he gets 409 `GSTIN_TAKEN` "already registered, contact support".
Support path:
1. Ravi contacts support. Ops checks he owns the GSTIN (GST certificate in his name, legal name matches the GST portal "Search Taxpayer").
2. In **Admin → Retailers**, ops opens Mohan's PENDING application and **rejects it with reason `GSTIN_NOT_OWNED`** ("This GSTIN belongs to another business"). Store admins and staff with `retailers.verify` can do this.
3. ✅ The GSTIN is free at once: Ravi applies and gets 201.
4. ❌ Mohan resubmits with Ravi's GSTIN (any case or spacing) → 409 `GSTIN_BLOCKED` "This GSTIN cannot be used with your account. Please contact support." before any file is read. The block is per account and per GSTIN and never expires.
5. ✅ Mohan can still apply with a GSTIN of his own.
6. ✅ Other reject codes (`PHOTO_UNCLEAR`, `GSTIN_NAME_MISMATCH`, `DUPLICATE`, ...) block nothing. `DUPLICATE` is left out on purpose: the real owner could be the one rejected as a duplicate.
7. Undo a wrong block (super admin only). Example: a store admin picked `GSTIN_NOT_OWNED` by mistake on Ravi's own application; Ravi now gets 409 `GSTIN_BLOCKED` and contacts support. Support checks he owns the GSTIN (as in step 1), then a **super admin** opens the profile in **Admin → Retailers → Blocked GSTINs** and clicks Unblock with a reason.
   - ✅ The GSTIN leaves `blockedGstins`; Ravi can resubmit it (the normal 5-per-30-days limit still applies). A history row `unblock_gstin` (note = masked GSTIN + reason) and an admin-audit row `retailer.unblock_gstin` (`metadata.gstin` masked) are written; the viewer cache is cleared.
   - ❌ Store admin / staff with `retailers.verify` → 403. Old `rev` → 409 `STALE`. A GSTIN that is not blocked on that profile → 409 `GSTIN_NOT_BLOCKED`. Unknown id → 404. Missing reason → 400 `FIELD_INVALID` (`field: reason`). Not 15 letters/digits → 400 `FIELD_INVALID` (`field: gstin`), the value is never echoed. Missing rev → 400 `REV_REQUIRED`.
- Limits: a squatter with several accounts needs one reject per account. An APPROVED or SUSPENDED profile keeps its GSTIN (only a PENDING one can be rejected); that case is not covered here.
- Admin FE: `GSTIN_NOT_OWNED` is in the reject reason picker (built; see `test-retailer-wholesale-admin.md`).
- Admin FE: the "Blocked GSTINs" section on the retailer detail page is built (`test-retailer-wholesale-admin.md` section 9). API shape:
  - `GET /admin/retailer/:id` and every transition response: `data.profile.blockedGstins` is always an array (empty when none) of `{ masked: "***********F1ZF" }` for store-scoped roles, and `{ masked, gstin: "10ABCDE1234F1ZF" }` for a super admin. Show `masked`; show the Unblock button to super admins only.
  - `POST /admin/retailer/:id/unblock-gstin`, super admin only, body `{ "rev": <profile.rev>, "gstin": "<entry.gstin>", "reason": "<required, max 500>" }`. The GSTIN goes in the body only (never the URL). 200 → `{ msg: "GSTIN unblocked", data: { profile } }` (same shape as the other transitions, `rev` + 1). Errors as in step 7 above; on 409 `STALE` reload the profile.

## ✅ S5. Account deletion removes retailer personal data

Example: Ravi deletes his account; 30 days later the daily account-purge cron runs.
1. ✅ His shop photo and GST certificate are deleted from the private bucket.
2. ✅ His retailer profile keeps only the audit trail: status `WITHDRAWN`, shop name / legal name / owner name / GSTIN / address and map pin set to empty, free-text notes in history, the rejection note and the suspension reason emptied. History rows stay (with a new `purge` row by `system`). `anonymisedAt` is set.
3. ✅ The GSTIN is free: the real owner (or Ravi with a new account) can apply with it.
4. ✅ Wholesale access ends at once (viewer cache cleared).
5. ✅ If one document cannot be deleted (S3 error, missing `PRINT_S3_BUCKET` on cron, cron IAM without `retailer/*`), the other is still deleted, the profile is still emptied, and the account is still wiped the same night (phone/name/email cleared, addresses deleted, phone free for a new signup). The failed key stays on the anonymised profile.
6. ✅ The nightly retailer-document-sweep (2:20 AM IST) retries each leftover key on its own and clears the key once deleted; re-runs are harmless and add no second `purge` row. Leftovers still there 3 days after the purge → one `retailer.document_purge_overdue` alert (daily digest, count only) per night until fixed.
7. ✅ One `retailer.purge` admin-audit row (`target.displayName` empty, actor = system) per purged profile. The profile's blocked GSTIN list is dropped.
8. ✅ Logs never contain the GSTIN, names, user ids of the swept profiles or storage keys.
9. ✅ While a failed key is still kept on a purged profile, the admin retailer detail shows no document: `documents.photoUrl`/`certUrl`/`certType` are null, `hasShopPhoto`/`hasGstCertificate` are false and no signed link is made. Live profiles are unchanged.
10. ✅ The purge cron reads users in `_id` pages (50 per page, at most 100 pages per run): users that fail every night no longer block later users, and the run always ends.
- Not changed: the GSTIN stays on old orders' `retailerSnapshot` (GST law keeps invoices). Earlier admin audit rows (`retailer.submit/approve/reject/...`) still carry the shop name in `target.displayName` (accepted; follow-up).

## ❌ S6. Riders never see the buyer's GST details

An APPROVED retailer's order at a wholesale-ON store (or with a wholesale line) carries `retailerSnapshot` (GSTIN, legal name, billing address) for the invoice.
1. ❌ Rider app: order list, order detail, accept, reject and mark-status responses contain no `retailerSnapshot`, no GSTIN, no legal name.
2. ✅ The customer's own order detail, the invoice (customer and admin) and the admin order detail still have it.
3. Picker app: picking endpoints return pick tasks only (item lines), never the order, so there is nothing to hide. `packOf`/units stay on the pick line (needed to pick a pack); `items.hsn` reaching the rider is intentional (a public tax code, no buyer data).

## Automated tests (security hardening)

- `cd packages/user && NODE_ENV=test npx jest __tests__/retailer-application.test.js` ("security hardening" block: switch, store check, upload hold incl. client hang-ups, processing slot, GSTIN block)
- `cd packages/admin && NODE_ENV=test npx jest __tests__/retailer-verify.test.js __tests__/retailer-profile-repository.test.js` (`GSTIN_NOT_OWNED` reject, unblock GSTIN, `anonymiseForDeletedUser`)
- `cd packages/cron && NODE_ENV=test npx jest __tests__/account-purge.test.js` (purge + retailer document sweep + overdue alert)
- `cd packages/delivery && NODE_ENV=test npx jest __tests__/order-retailer-snapshot-privacy.test.js`
