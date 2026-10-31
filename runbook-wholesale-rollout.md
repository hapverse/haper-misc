# Runbook: retailer/wholesale + print-COD rollout

You run every step yourself. Nothing here was run for you. Dev first; prod is your own decision, step by step.
Sources: `haper-backend/docs/plans/retailer-wholesale.md` (§7.4, §7.5, §12), `haper-backend/docs/plans/print-cod.md` (§7), `haper-misc/runbook-print-s3-bucket.md`, `haper-backend/scripts/migrations/README.md`.

Scope: wholesale P1 (retailer profiles, pack items, wholesale browse/checkout) and print COD.
**Credit is NOT in this release.** It stays disabled. Its gates (P2): rider-app version check (`minRiderVersionCredit`) and the navjot-security audit. Do not turn on `creditEnabled` for anyone.

Placeholders you fill in once:

| Placeholder | Meaning | Yours |
|---|---|---|
| `<db name>` | target Mongo database name (dev or prod) | |
| `<id>` | AWS account id (used only in your own policy edits) | |
| Retailer-applications switch | env var `RETAILER_APPLICATIONS_ENABLED` on the USER API (default OFF) | `RETAILER_APPLICATIONS_ENABLED` |
| `<user api>` | pm2 app name of the user API | |

Bucket: `bheldi-static` (private, CloudFront-only reads). Prefixes: `print/` (print files), `retailer/` (shop documents), `invoices/`.

---

## Rules that apply to the whole rollout

- The "retailer applications" switch is the env var `RETAILER_APPLICATIONS_ENABLED` on the user API. Default OFF; only `true`, `1` or `on` (any case) turn it on. It is read on every request, but the pm2 restart with `--update-env` is needed to load a changed `.env`. It stays OFF until steps 1-4 (U1-U4) are done and verified (and step 5 once the invoice code is live).
- While OFF: a new application gets `503 PROGRAM_DISABLED` and the apps hide the entry. Existing applicants can still see their status and withdraw.
- `wholesaleEnabled` is per store. Do not turn it on for a store until the picker build is on every picker device of that store (step 12).
- Any database query on prod needs your own explicit decision. The snippets below are marked DEV first.
- Each step: who, what, how to verify, how to roll back.

---

## Checklist

### Part A. AWS / infra (before the new code runs anywhere)

- [ ] **1. U1: block CloudFront from `retailer/*`** (who: you, AWS console, S3 > `bheldi-static` > Permissions > Bucket policy)
  - Why: shop documents (GST certificates etc.) must never be readable through the CDN.
  - Do: add `arn:aws:s3:::bheldi-static/retailer/*` to the `NoCdnForPrint` Deny. Example (adapt to the real statement; keep your existing principals and conditions as they are, only add the Resource line):
    ```json
    {
      "Sid": "NoCdnForPrint",
      "Effect": "Deny",
      "Principal": "<keep the existing CloudFront principals (OAI + service principal) as they are today>",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::bheldi-static/print/*",
        "arn:aws:s3:::bheldi-static/retailer/*"
      ]
    }
    ```
  - Verify: `curl -s -o /dev/null -w "%{http_code}\n" https://<your CDN domain>/retailer/test.txt` returns 403 (a missing object also 403/404; the point is it is never 200 for a real upload). After step 4 you can re-test with a real uploaded file.
  - Rollback: remove the added Resource line (only if you also stop the feature; do not leave documents CDN-readable).
  - Must be done BEFORE deploying this code to dev or prod.

- [ ] **2. U2: let the API write `retailer/*`** (who: you, IAM)
  - Why: the B7 policy (`haper-print-s3-access`) only allows `print/*`. Without this, document uploads fail with a 500 (it fails closed, nothing leaks).
  - Do: if B7 is attached to the API's AWS identity, add a statement (example, adapt):
    ```json
    {
      "Sid": "RetailerObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::bheldi-static/retailer/*"
    }
    ```
    (Or change the existing `PrintObjects` Resource into a list of both prefixes.) If the API uses a different identity or an instance role, put the statement there instead.
    The **cron** service's identity also needs `s3:DeleteObject` on `arn:aws:s3:::bheldi-static/retailer/*` (account purge and the nightly retailer-document-sweep delete deleted accounts' documents). Same statement shape, `Action: ["s3:DeleteObject"]`.
  - Verify: after step 9, upload a test shop document from the app; it succeeds. A 500 on upload means this step is missing.
  - Rollback: remove the statement (uploads then fail closed).

- [ ] **3. U3: `PRINT_S3_BUCKET` on the ADMIN API and the CRON service** (who: you, server `.env` + pm2)
  - Why (admin): without it, document links come back null in admin.
  - Why (cron): account purge and the nightly retailer-document-sweep (2:20 AM IST) delete retailer documents. Without the bucket (or without `s3:DeleteObject` on `retailer/*`, step 2) the account is still wiped, but the documents stay in the bucket; after 3 days the sweep raises the `retailer.document_purge_overdue` alert in the daily alert digest.
  - Do: set `PRINT_S3_BUCKET=bheldi-static` in the admin API `.env` AND the cron service `.env` (the user API already needs it too), then restart each pm2 app with `--update-env` (`pm2 restart <admin app name> --update-env`, same for cron).
  - Verify: in admin, open a retailer application that has a document; the link is not null and opens (short-lived signed link). For cron: confirm the variable is set in its `.env` and the process was restarted with `--update-env`; the nightly log line `[retailer-document-sweep] candidates=... failed=0` and no `PRINT_S3_BUCKET is not set` line.
  - Rollback: remove the variable and restart (admin links go back to null; deleted accounts' documents pile up for the sweep and alert after 3 days).

- [ ] **4. U4: lifecycle and retention for `retailer/`** (who: you, S3 > Management)
  - Do: confirm no lifecycle rule covers `retailer/`. The existing `print-expire` rule is scoped to `print/` only (15 days) and must stay that way. Then decide how long shop documents are kept (your decision, e.g. while the account is active plus a legal retention period) and write it down. If you want an automatic expiry, add a separate rule with prefix `retailer/`.
  - Verify: S3 > Management lists no rule whose prefix is empty or `retailer/` unless you added it on purpose. An empty-prefix rule would delete shop documents.
  - Rollback: delete the rule you added.

- [ ] **5. U5: invoices stop being public** (who: you, in two parts, after the invoice code fix is in the build)
  - 5a. Add a CloudFront deny for `invoices/*`. Same shape as step 1 (example, adapt; use the same principals as `NoCdnForPrint`):
    ```json
    {
      "Sid": "NoCdnForInvoices",
      "Effect": "Deny",
      "Principal": "<same CloudFront principals as NoCdnForPrint>",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::bheldi-static/invoices/*"
    }
    ```
  - 5b. Delete the existing public invoice objects under `invoices/` (S3 console, prefix `invoices/`). Take a copy first if you need to keep them. Old invoices regenerate on demand once the new code is live.
  - 5c. Bump the invoice cache version. This is a CODE change (engineer does it in the build; you only confirm it is in the release). Reason: old cache entries (which held public links) must not be reused. The new private key is `print/invoices/v3/<orderId>.pdf`, remembered in the cache for 24 h.
  - Verify: `curl` an old invoice CDN URL returns 403; the app still downloads a fresh invoice (the download answers 200 with the PDF itself; no redirect).
  - Rollback: remove the `NoCdnForInvoices` statement (not recommended; invoices would be public again).
  - Order: do 5a/5b only after the new code is on the target environment (otherwise the OLD code serves broken invoice links). Do 5c in the build.
  - New invoice flow: invoices are no longer served from a public CDN URL; the invoice code fix ships in this same release. Verify an invoice download still works (200 with the PDF; no redirect, no link) BEFORE deleting the old objects in 5b.
  - [ ] **5v. Invoice check done** before 5b: download one invoice on the target environment; it returns 200 with the PDF (headers `application/pdf`, attachment filename, `Cache-Control: private, no-store`) and the PDF opens. Rollback if it fails: do not delete anything; fix or revert the code first.

### Part B. Database (BEFORE the backend deploy)

- [ ] **6. U6: build the pack indexes, then deploy** (who: you, run from a checkout of the NEW code, DEV first)
  - Why first: an index on a field no document has yet builds instantly and old code ignores it. If the backend goes out first, every checkout line scans the store's whole item list (about 2,100 docs per line) and the nightly reconcile does about 4.4M reads. Do NOT deploy the backend to an environment where this step has not passed.
  - Dry run (DEV first):
    ```
    node scripts/migrations/build-wholesale-indexes.js
    ```
    It prints the DB host and name first. Check it is the DB you mean.
  - Build:
    ```
    node scripts/migrations/build-wholesale-indexes.js --apply
    ```
    Prod only if you decide to, and the script aborts on prod-looking hosts without the confirm flag:
    ```
    node scripts/migrations/build-wholesale-indexes.js --apply --confirm-db=<db name>
    ```
  - Verify: output says `idx_items_pack_base` and `idx_products_pack_base` OK; re-run is a no-op. MongoDB must be 6.0 or newer (the retailer partial index uses `$in`; check the cluster version in Atlas).
  - Rollback (zero data impact): `db.items.dropIndex("idx_items_pack_base"); db.products.dropIndex("idx_products_pack_base")` (DEV first; user decides on prod).

### Part C. Backend, admin, picker, customer apps (wholesale P1)

- [ ] **7. Permission U7 (decide before admin goes live)** (who: you + admin FE engineer)
  - Grant `retailers.verify` only to named managers (not whole roles). Mirror the same roles in the admin frontend `permissions.ts` (the FE and BE permission checks must list the same roles, or the UI shows the wrong buttons).
  - Verify: a manager without the permission gets 403 on verify and sees no Verify button; a named manager can verify.
  - Rollback: remove the grant on both sides.

- [ ] **8. Confirm batch tracking is ON** for each store you will enable (who: you, admin). Wholesale is refused otherwise. Verify in the store config.

- [ ] **9. Backend deploy, all flags OFF** (who: you, your normal manual deploy)
  - Verify: API boots; boot logs show `uniq_rp_user` and `uniq_rp_gstin_live` were built (retailer profile indexes). If a log line says the build failed (often an old MongoDB version), stop and fix before going on. Normal customers see no change.
  - Rollback: before any pack row exists, a code revert is safe (every new key is optional). After pack rows exist, see "Rollback" section first.

- [ ] **10. Admin deploy** (who: you). Verify: retailer and pack screens load; no console errors on existing screens.

- [ ] **11. Customer apps (Android / iOS / web)** (who: you ship; iOS pipeline is yours, never automated). Verify: normal retail browse and checkout unchanged.

- [ ] **12. P1 GATE: picker app on every picker device of the store** (who: picker engineer ships, you confirm per device)
  - Why: an old picker app cannot tell a pack line from a singles line and would mis-verify orders.
  - Verify: version installed on each device of that store (ask each picker or check the device list). Keep the list.
  - Do not go to step 14 until every device is done.

- [ ] **13. One-time banner check** (who: you, READ-ONLY, **run on DEV first; any prod query needs your own explicit decision**)
  - Why: a banner that points at an item that later becomes wholesale leads customers to a dead-end tap. Check before turning wholesale on. State which database you are connected to before running.
  - mongo shell (read-only, changes nothing):
    ```js
    // DEV only unless you decide otherwise. Lists item banners and whether their target is a pack row.
    db.banners.find({ actionType: "item", status: 1 }).forEach(b => {
      const it = db.items.findOne(
        { storeId: b.storeId, $or: [{ iId: b.actionValue }, { barcode: b.actionValue }] },
        { name: 1, iId: 1, packOf: 1, status: 1 }
      );
      print(b._id, b.title, "->", it ? (it.packOf ? "PACK/WHOLESALE " : "") + it.name : "TARGET NOT FOUND");
    });
    ```
    If `actionValue` stores a Mongo `_id` instead, change the lookup to `{ _id: ObjectId(b.actionValue) }`.
  - Act: re-point or remove any banner that targets a pack item or an item you plan to make wholesale-only.

- [ ] **14. Enable `wholesaleEnabled` on ONE dev store** (who: you, admin store config; needs steps 8 and 12 done)
  - Verify using the test guides in `haper-misc/` (`test-retailer-wholesale.md` and the `-admin`, `-packs`, `-cart`, `-checkout`, `-invoice`, `-android`, `-ios`, `-web` guides). A normal customer must see no wholesale items; an approved retailer sees them. Wholesale vanishes within about 5 seconds when the flag is switched off.
  - Rollback: set `wholesaleEnabled` to false for the store.

- [ ] **15. Retailer applications switch ON** (who: you; env var `RETAILER_APPLICATIONS_ENABLED` on the USER API; default OFF)
  - Only after U1-U4 (steps 1-4) are done and verified, and step 5 once the invoice code is live.
  - Do: set `RETAILER_APPLICATIONS_ENABLED=true` in the user API `.env` (documented in `haper-backend/.env.example`), then `pm2 restart <user api> --update-env`.
  - Verify: a test application with a document upload works (no 500, link not null, CDN URL 403). Before this step, a new application returns `503 PROGRAM_DISABLED` and the apps hide the entry.
  - Rollback: set it to `false` (or remove it) and `pm2 restart <user api> --update-env`. New applications get 503 again; existing applicants can still see status and withdraw.

- [ ] **15b. Support path for a squatted GSTIN** (who: support/ops, know this before step 15)
  - New reject reason `GSTIN_NOT_OWNED`: used when someone applied with a GSTIN that is not theirs.
  - A PENDING squatter: reject the application with `GSTIN_NOT_OWNED`; this blocks them and frees the GSTIN for the real owner.
  - An APPROVED or SUSPENDED squatter, or one holding several accounts: not fixable from the reject button. Hand to support/ops for manual handling.
  - A wrong `GSTIN_NOT_OWNED` pick (the real owner got blocked): a **super admin** lifts it from the retailer detail page (Blocked GSTINs → Unblock, reason required; API `POST /admin/retailer/:id/unblock-gstin` with `{ rev, gstin, reason }` in the body). Store admins cannot. The owner can then resubmit.
  - Verify: reject a test PENDING application with `GSTIN_NOT_OWNED` on dev; the reason shows in admin and the applicant is blocked.
  - Rollback: not applicable (a reject is a review decision, not a deploy).

### Part D. Print COD (separate from wholesale, same window is fine)

Order: backend, then admin, then apps. COD is OFF for every store until a super admin turns it on.

- [ ] **16. Backend** (who: you). Must be deployed BEFORE any app, because apps use the `COD_OFF` reason and the new config fields from the backend. Verify: `GET /user/print/config` still returns `enabled` as before; the new COD fields are present and COD shows unavailable.
- [ ] **17. Admin** (who: you). Verify: Config > Print service shows the "Cash on delivery" section (editable by super admin only); the print queue shows an amber "Cash" chip for COD orders.
- [ ] **18. Apps** (Android, iOS, web; who: you ship). Verify: with COD OFF the apps show no COD choice; with an old app, behaviour is unchanged.
- [ ] **19. Enable COD per store** (who: super admin, Config > Print service > Cash on delivery). Set the max amount. Verify with the print test guides (`test-print-checkout.md`, `test-print-admin.md`): a COD order is placed without payment; rejecting a COD order refunds nothing. Rollback: switch COD off for the store.

---

## Rollback

Level 1 (instant, no code change): `wholesaleEnabled` = false per store; `RETAILER_APPLICATIONS_ENABLED` = false (then `pm2 restart <user api> --update-env`); COD off per store. Retailer profiles stay. Sold packs restock correctly.

Level 2, code revert, only BEFORE any pack row exists: safe.

Level 3, code revert AFTER pack rows exist: NOT safe. Old code has no audience filter, so pack rows would show to every customer at wholesale price, and old stock seeding would create phantom stock for packs. First run this (user-run, **DEV first; user decides on prod**), then revert:
```js
db.items.updateMany({ "packOf.baseIId": { $exists: true } }, { $set: { status: 0 } })   // 0 = INACTIVE
```
Restore later with `status: 1`. Never run `seedStore` while rolled back.

Indexes: dropping them is safe and has zero data impact (commands in step 6).

Credit: not part of this release, nothing to roll back.

## Risks

- Skipping U1 or U5a leaves customer documents or invoices CDN-readable. Highest risk.
- Skipping step 6 before the backend deploy causes slow checkouts (not data loss).
- Step 12 skipped means wrong picking on mixed orders.
- Cost: no new AWS resources; negligible S3 storage.

STATUS: done
OUTPUT: /Users/office/Documents/haper/haper-misc/runbook-wholesale-rollout.md written (documentation only; nothing run, no AWS/DB/.env access). User runs all steps by hand.
NEXT: USER (follow the checklist) then kiran-git to commit the runbook when you approve
