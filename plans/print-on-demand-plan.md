# Print on Demand — Feasibility + Implementation Plan

**Status:** Planning approved; no code written yet.
**Author:** shavinder (planner)
**Date:** 2026-10-11 (approved 2026-10-12)
**Scope of v1:** black & white, plain A4, PDF + JPG/PNG, single or double sided, copies, page range,
prepaid, printed at the store on its existing office printer, delivered by the normal rider flow.

---

## APPROVED DECISIONS (2026-10-12)

The product owner approved the points below. They override any part of this document that says
something different. Items marked **OPEN** are still undecided (see §7).

1. **Pilot store:** Bheldi only. On/off per store with `config.print.enabled`. More stores can be
   added later with no code change.
2. **Separate order:** print is its own order, separate from groceries, in v1.
   Endpoint `POST /user/print/order`, `orderType: "print"`. No combined cart.
3. **Payment:** prepaid only (Razorpay + wallet) in v1. Cash on delivery (COD) comes later; the
   design must leave room for it.
4. **Prices** (all admin-configurable per store):
   - B&W A4, single-sided: ₹2 per side.
   - B&W A4, double-sided: ₹1.50 per side.
   - Minimum print order: ₹20. The delivery charge is added on top.
   - Print delivery charge: a separate setting. Amount **OPEN**. Default is a flat charge that the
     admin can edit.
   - GST 18% and SAC 998912 are **placeholders**. The accountant must confirm. Web research was
     medium-low confidence.
   - Printing cost for profit reports: ₹0.80 per side (placeholder).
   - The server always recomputes the price. The app's number is never trusted.
5. **Files:** PDF, JPG, PNG only. No Word, Excel, or PowerPoint in v1. Limits: 20 MB and 200 pages.
   The server checks the real file type (magic bytes). Every file is rebuilt as a clean A4 PDF.
6. **Preview:** the customer sees a preview of the processed pages **before paying**.
7. **Content declaration:** a required checkbox at upload: "I own this content and it is lawful."
   It is stored with a timestamp.
8. **Rejection:** staff can reject a job with a reason. The refund is automatic.
9. **Retention:**
   - Files are deleted 24 hours after delivery.
   - Uploads that were never ordered are deleted after 24 hours.
   - An S3 lifecycle rule is the backstop.
   - The bucket is private. The user creates it by hand.
   - Staff download through links that last 5 minutes. Every download is logged.
   - After deletion, a reprint needs a fresh upload.
10. **Complaints after delivery:** the existing refund process. The super admin decides.
11. **Entry points:** a home-screen tile AND a tile inside the Stationery category. Both open the
    same print flow.
12. **Store fulfilment (v1):** Print Queue page in haper-admin → browser print dialog → "Mark
    printed" → order becomes PACKED → existing rider flow. An auto-print agent comes later, only if
    volume grows.
13. **Excluded:** print orders do not count for coupons, referral rewards, or free gifts.
14. **Scale:** under 50 print orders per day at Bheldi in month 1.
15. **Deploy order:** backend → admin → mobile apps. The haper-web `OrderDetail` crash fix (L352)
    ships first, together with the backend.
16. **Known bugs the build must handle:**
    - `supersedeUnpaidOrders` must skip print orders.
    - haper-web `OrderDetail` crashes on `item.itemId.images[0]` when `itemId` is null.
    - The picker app and the pick-task-reconcile cron must skip print orders.
    - Admin `consolidateItems` and per-product reports must skip or block print orders.
    - Old app versions need a backend-filled name and icon for print lines.

---

## 0. Verdict (read this first)

**Feasible, and cheaper than it looks — IF v1 is a "print-only order" (prints are not mixed into a
grocery cart).** The order pipeline after checkout (payment webhook, unpaid-order release, rider
assignment, delivery OTP, invoice, refunds, profit) already tolerates an order line that has **no
inventory item** — `restockOrderLine` no-ops when `itemId` is missing, the invoice prints the
snapshot `name`, profit reads the line's own `costPrice`. What does NOT tolerate it is the
**checkout + cart + picker** half (Redis cart, `sellFEFO`, discounts, coupons, gifts, pick tasks).
A separate print checkout skips that whole half instead of special-casing it.

Plain example: Ravi uploads `marksheet.pdf` (3 pages), asks for 2 copies, single sided. That is 6 sides × ₹2 = ₹12,
which is below the ₹20 minimum, so he pays ₹20 for printing + the print delivery charge. Store staff see it in a new **Print Queue** page in
haper-admin, click Download, print on the shop printer, click **Mark printed** → the order becomes
PACKED → a rider is assigned exactly like a grocery order.

Rough effort: **backend ~9 d, admin ~4 d, Android ~5 d, iOS ~5 d, web ~3 d, picker 0, delivery 0
(verify only)**. Plus one small AWS change the user does by hand (a private bucket).

---

## 1. What exists today that we reuse

| Need | Existing code (reuse) | Notes |
|---|---|---|
| S3 client + upload helper | `haper-backend/packages/shared/utils/s3.utils.js` (`uploadToS3`, `docUpload` multer: jpeg/png/webp/pdf, `maxDocUploadFileSizeMb: 8` in `shared/config/index.js`) | **Cannot be reused as-is for customer documents**: it returns a PUBLIC URL (`${baseImagePath}/${key}`) on the catalogue bucket. Reuse the S3 client + multer pattern, not the public URL. |
| Libraries already installed (root `haper-backend/package.json`) | `@aws-sdk/client-s3`, `multer`, `sharp`, `pdfkit`, `razorpay`, `uuid`, `ioredis`, `express-rate-limit`, `joi` | `sharp` = image normalise; `pdfkit` = invoices. **Missing:** a PDF reader (page count / merge) and the S3 presigner. |
| Order model | `shared/models/orders.schema.js` — `items[]` lines with frozen `name`, `salePrice`, `costPrice`, `gstRate`; `itemId` is **not** `required` | A print line fits as a line with `itemId: null` + new nullable fields. |
| Pricing/charges | `user/src/routes/order/controller.js` `calculatePricing` (L199) + charges block (L1198+: `store.config.minimumOrderValue/deliveryCharges/platformCharges`) | Print checkout calls the same `calculatePricing` → delivery/platform/wallet maths identical. |
| Razorpay prepaid flow | `shared/utils/razorpay.utils.js`, `shared/utils/razorpay-capture.utils.js` (webhook → OPEN), `user/src/routes/order` `/:orderId/payment-status`, cron `payment-initiated-orders.js`, `shared/utils/unpaid-order-release.utils.js` | Reused unchanged except two guards (§5). |
| Cancel (60-second window for OPEN) | `user/src/routes/order/controller.js` ~L2341 | Works as-is for print orders. |
| Rider assignment gate | `admin/src/routes/order/controller.js` ~L1729-1739 (picking stores need PACKED, others OPEN) | "Mark printed" moves the order to PACKED, so this gate needs **no change**. |
| Invoice | `shared/utils/invoice.utils.js` (uses `item.name` snapshot first, L167) | Prints "Print – B&W A4 – 24 pages" with zero change. |
| Profit / COGS | reads `orders.items.costPrice` snapshot (invariant) | Snapshot cost-per-page × pages on the line → profit correct, no report change. |
| Refunds | `orders.refunds[]` + `shared/utils/refund.utils.js` | Wrong print → admin partial/full refund to wallet, existing UI. |
| Order audit trail | `shared/repositories/order-audit.repository.js` + admin "Order Activity" | Log `print.downloaded`, `print.printed`, `print.rejected`. |
| Per-store config pattern | `shared/models/stores.schema.js` `config.*` (e.g. `giftWithPurchaseEnabled`, `discountsEnabled`, default false) + admin `pages/Stores`, `pages/Config/ConfigSettings.tsx` | New `config.print` block, default OFF. |
| Cron framework | `cron/src/scheduler.js`, jobs in `cron/src/jobs/` (e.g. `account-purge.js`) | New `print-file-purge.js`. |
| Admin permission mirror | BE `shared/constants/permission.constant.js` ↔ FE `haper-admin/src/.../permissions.ts` | New `print_jobs.view/manage` in BOTH. |
| Rate limiting | `express-rate-limit` already in `user/index.js` | Add a tighter per-route limiter on upload. |

**Client nullability today (checked):**
- Android `OrderModels.kt` L432: `OrderItem.itemId: OrderItemInfo? = null` — renders "Item" with no image. Safe.
- iOS `Models/OrderModels.swift` L304: `let itemId: OrderItemInfo?` — safe.
- Delivery app `OrderModels.kt` L115: `itemId: DeliveryItem? = null` — safe.
- **haper-web `pages/OrderDetail.tsx` L352: `item.itemId.images[0]` — CRASHES on a null itemId.** Must be fixed before the first print order exists (web ships with backend, so this is easy).
- Picker `data/model/Models.kt` L77: `itemId: String` non-null — print lines must **never** enter a pick task (they won't in v1; see §3.6).

---

## 2. Architecture options

### Option A — "Print line inside the normal cart/checkout"
Print job becomes a cart line in Redis next to groceries; `placeOrder` special-cases it.
- Good: one order, one delivery fee, customer can add a pen + prints together.
- Bad: touches the riskiest code in the repo — `placeOrder` (2,900-line controller), `prepareOrderItemsAndInventory` (`sellFEFO` per line), discount engine, coupon allocation, gift tiers, cart limits, Redis cart (`cart.repository.js` populates every line from `ItemModel`), **and both** `placeOrder` and `placeScheduledOrder`. Every one of those needs an "unless print" branch. High regression risk.

### Option B — "Fake inventory item" (a hidden per-store SKU "B&W print, per page")
Print = qty N of a hidden item; everything "just works" in old clients.
- Good: old apps show a real name/image.
- Bad: stock decrement (`sellFEFO`) and restock must be bypassed; the item shows up in low-stock reports, inventory evaluator, replenishment, search index, Stock-In, profit-by-item; per-store auto-provisioning. The file/options still need their own home anyway. This is the "placeholder row" trap — big hidden blast radius.

### Option C (RECOMMENDED) — "Separate `print-jobs` collection + print-only order"
- A `print-jobs` document owns the file, options, page count, price quote, print status, retention.
- Checkout for prints is its **own endpoint** that creates a normal `orders` document whose
  `items[]` holds one line per print job (`lineType: "print"`, `itemId: null`, `printJobId`).
- From payment onward the order is an ordinary order (same statuses, rider, OTP, invoice, refunds).
- Good: zero changes to cart, `placeOrder`, discounts, coupons, gifts, FEFO. The order pipeline
  already handles item-less lines. File privacy/retention lives in one place.
- Bad: a customer who wants groceries + prints pays two delivery fees (mitigation: product
  decided: print has its own delivery charge setting (Q2); Phase 2 may merge prints into the grocery cart).
- Why not just store the file on the order line? Files exist BEFORE an order (upload → quote →
  pay) and must be purged on their own timetable; a separate collection keeps the order document
  small and keeps purge logic off the order.

---

## 3. Recommended design (Option C)

### 3.1 Data model (all new fields nullable/defaulted; no migration)

**New collection `print-jobs`** (`shared/models/print-jobs.schema.js` + repository):

```
userId, storeId                         ObjectId (required)
status            "UPLOADED" | "ORDERED" | "PRINTED" | "REJECTED" | "CANCELLED" | "EXPIRED"
orderId           ObjectId|null         set atomically at checkout
orderDisplayId    String|null           "HP…"
file: { originalName, mimeType, sizeBytes, sha256,
        sourceKey, printKey,             S3 keys in the PRIVATE bucket (never URLs)
        pageCount }                      pages of the normalised A4 PDF
options: { colour: "BW", paper: "A4_PLAIN", sides: "SINGLE"|"DOUBLE",
           copies (1 to config.maxCopies), pageRange: "1-3,7" | null }
quote:   { selectedPages, billableSides, sheets, pricePerSide,
           amount, costPerSide, gstRate, configVersion }   server-computed, frozen at checkout
printedAt, printedBy{adminId,email}, downloadCount
reprints: [{ at, by, reason }]
rejection: { code, note, by, at }       e.g. ILLEGIBLE / PROHIBITED_CONTENT / FILE_CORRUPT
filesPurgedAt     Date|null
purgeAfter        Date                   draft = +24 h; ordered = deliveredOn + 24 h (approved)
```

Indexes (aabha-dba to confirm): `{storeId:1,status:1,createdAt:-1}` (print queue),
`{orderId:1}`, `{userId:1,createdAt:-1}`, `{purgeAfter:1}` partial on `filesPurgedAt: null`
(purge cron). No TTL index on the document itself — the order history needs the metadata; only
the **files** are deleted.

**`orders` — new optional fields** (old docs simply lack them):
- `orderType: { type: String, default: null }` — `"print"` for print orders; absent/null = today's
  orders. Queries must use the **positive** test (`orderType: "print"`) or `{$ne: "print"}`;
  never `orderType: "grocery"` (old docs have no field and `.lean()` skips defaults).
- line-level: `lineType: { type: String, default: null }`, `printJobId: ObjectId|null`,
  `print: { fileName, pages, copies, sides, pageRange } | null` (display snapshot).

**`stores.config.print`** (default OFF, like `discountsEnabled`; Bheldi is the only store switched on):
```
enabled: false                 per-store on/off switch (config.print.enabled)
pricePerSideSingle: 2          ₹ per printed side, single-sided (approved)
pricePerSideDouble: 1.5        ₹ per printed side, double-sided (approved)
minimumOrderAmount: 20         ₹ — print order minimum; delivery charge added on top (approved)
printDeliveryCharge: OPEN      ₹ flat; amount not decided; admin editable (default flat)
costPerSide: 0.8               ₹ paper + toner, for profit (COGS); placeholder
maxPagesPerJob: 200, maxCopies: 20, maxBillableSidesPerOrder: 500
gstRate: 18                    placeholder; OPEN (Q5) — accountant must confirm
sacCode: "998912"              placeholder; OPEN (Q5) — accountant must confirm
```
Example: 10-page PDF, 2 copies, double sided → 20 sides × ₹1.5 = ₹30, 10 sheets of paper.
Single sided → 20 × ₹2 = ₹40. A 2-page single copy → 2 × ₹2 = ₹4 → raised to the ₹20 minimum.

### 3.2 Storage (privacy)
- **New PRIVATE S3 bucket** (or a private prefix with Block-Public-Access on a bucket that is not
  behind the public CDN). The current bucket is served publicly via `BASE_IMAGE_PATH`; a customer's
  Aadhaar scan must never get a guessable public URL. → **user does this in AWS by hand** (I do not
  touch AWS). Server-side encryption (SSE-S3) on, plus an S3 **lifecycle rule** deleting
  `print/` objects after a backstop period as a safety net behind the app's own 24-hour purge.
  Backstop length: **15 days** (decided 2026-10-12, security audit M3): longer than the app's 14-day ceiling for ordered files, so the rule never deletes a file the app still needs.
- Downloads: short-lived presigned GET (5 min) generated per click, only for staff of that store
  (or super-admin), audited. New dep `@aws-sdk/s3-request-presigner` pinned to the same 3.x line as
  `@aws-sdk/client-s3` (CJS, verified).

### 3.3 Upload + processing flow
Boring choice for v1: **multipart upload through the backend** (same `multer.memoryStorage` pattern
as `docUpload`), because the backend must read every byte anyway to count pages.
Presigned direct-to-S3 is a Phase 2 optimisation if files get big.

1. `POST /user/print/jobs` (multipart, field `file`, max **20 MB**, PDF/JPEG/PNG; one file per call).
2. Sniff the **magic bytes** (not the client's mimetype): `%PDF-`, JPEG `FF D8 FF`, PNG
   `89 50 4E 47`. Anything else → 415.
3. Normalise to an **A4 print PDF** with `pdf-lib` (fork `@cantoo/pdf-lib` 2.x — maintained, CJS;
   original `pdf-lib` 1.17.1 untouched since 2022): copy each page into a fresh A4 document,
   scaled to fit. This (a) makes "what the customer counted" = "what prints", (b) drops
   document-level JavaScript/attachments/auto-actions, so staff opening it is safer.
   Images → `sharp` (rotate by EXIF, greyscale optional) → one A4 page each.
4. Encrypted/password PDFs, 0-page or > `maxPagesPerJob` → 422 with a plain message.
5. Store original + print PDF under `print/<storeId>/<jobId>/…`, save the job as `UPLOADED`,
   return `{ jobId, pageCount, fileName }`.
6. Processing is synchronous for v1 (a 50-page PDF is sub-second); add a CPU/time guard
   (reject > 200 pages) so one upload cannot stall the user service.

DOCX/Word: **not in v1.** Converting Word faithfully needs LibreOffice or a paid conversion API.
App copy: "Upload PDF or photos. For Word files, use Save as PDF." (Q4.)

Preview (approved): the customer sees the **processed** pages (the clean A4 PDF) **before paying**.
The earlier idea of previewing only the local file is dropped, because it does not show what will
actually print. Method **OPEN** (Phase 0 decides): (a) the client renders the processed PDF from a
short-lived signed link (Android `PdfRenderer`, iOS `PDFKit`, web `<iframe>`), or (b) the server
makes page images.

### 3.4 API contract (all under user service, `jwtUtils.authenticate`)

| Method + path | Request | Response |
|---|---|---|
| `GET /user/print/config` | — (store from `req.storeId`) | `{ enabled, pricePerSideSingle, pricePerSideDouble, minimumOrderAmount, printDeliveryCharge, maxPagesPerJob, maxCopies, acceptedTypes, maxFileMb }` |
| `POST /user/print/jobs` | multipart `file` | `{ jobId, fileName, pageCount }` |
| `PATCH /user/print/jobs/:jobId` | `{ sides, copies, pageRange }` | `{ job, quote }` |
| `DELETE /user/print/jobs/:jobId` | — | only when `UPLOADED`; deletes files |
| `POST /user/print/quote` | `{ jobIds[], addressId, redeemWallet }` | `{ lines[], itemsTotal, charges{delivery,platform}, walletUsed, payable }` |
| `POST /user/print/order` | `{ jobIds[], addressId, paymentMethod: RAZORPAY, redeemWallet, idempotencyKey }` | **same shape as `/user/order/place`** (order + razorpay order id + payment window) so the existing payment sheet/polling code is reused on clients |

Admin service (permission `print_jobs.view` / `print_jobs.manage`, store-scoped like orders):

| Method + path | Purpose |
|---|---|
| `GET /admin/print/jobs?status=&storeId=` | print queue (paid = `ORDERED` on OPEN orders first, oldest first) |
| `GET /admin/print/jobs/:id/download` | 302/JSON presigned URL (5 min), audit `print.downloaded`, `downloadCount++` |
| `POST /admin/print/jobs/:id/printed` | mark job printed; when **all** jobs of the order are printed → order OPEN→PACKED (conditional update) |
| `POST /admin/print/jobs/:id/reprint` | log reprint (wrong/torn print); no customer charge |
| `POST /admin/print/jobs/:id/reject` | reject with reason → cancel order + full refund via existing refund path |
| `PUT /admin/store/:id/config/print` | edit `stores.config.print` (plan default: super-admin only, because it is a money knob. The approval says "admin-configurable" — **OPEN**, confirm who may edit prices) |

### 3.5 Checkout + payment flow
1. Load jobs: must be `UPLOADED`, same `userId`, same `storeId`, options set.
2. Re-compute every quote **server-side** from the job + current `store.config.print` (never trust
   the client number).
3. Same guards as grocery checkout, reused: address-ownership guard, maintenance guard,
   serviceability guard (copy the calls, not the 2,900-line function).
4. One transaction: create order (`orderType: "print"`, `status: PAYMENT_INITIATED`,
   `paymentMethod: RAZORPAY`, lines with `itemId: null`, `salePrice = amount`, `quantity = 1`,
   `costPrice = billableSides × costPerSide`, `gstRate`, snapshot `name`
   "B&W print · marksheet.pdf · 6 sides"), apply wallet via existing `applyWallet`, and
   **claim the jobs** with a conditional update
   `{_id:{$in:jobIds}, userId, status:"UPLOADED", orderId:null} → {status:"ORDERED", orderId}`;
   if `modifiedCount !== jobIds.length` abort (double-tap / two tabs = 409, nothing charged).
   `quantity: 1` per job keeps every `quantity × salePrice` sum in the codebase correct.
5. After commit: `razorPayUtils.create` exactly like `placeOrder`; on failure compensate (release
   jobs back to `UPLOADED`, refund wallet, mark `PAYMENT_CANCELLED`).
6. Webhook/capture → OPEN through the **existing** `razorpay-capture.utils.js` path. Unpaid
   expiry → existing cron; its restock is a no-op for item-less lines; **add** a hook that releases
   the print jobs back to `UPLOADED` so the customer can retry.
7. Notify store admins ("New print order HP123 — 2 files, 24 sides") via the existing
   `notificationUtils.sendAdminStoreNotification`.

**v1 = prepaid only (Razorpay + wallet).** COD is risky: paper is spent before the customer pays
and can refuse at the door (Q3).

### 3.6 Store fulfilment (the printer question)
Options evaluated for "one shop, one office printer":

| Option | Verdict |
|---|---|
| (b) **Print Queue page in haper-admin** — Download → browser print dialog → Mark printed | **v1.** Works with any printer the shop PC already uses. Zero hardware/vendor risk. |
| (a) Task in the picker app (phone) | Not v1. Printing from a phone to an office printer is unreliable; picker `itemId` is non-null so lines would need a model change + app release. Phase 2: show a read-only "collect print HP123 from the desk" line for mixed orders. |
| (c) Auto-print agent (PrintNode-style SaaS, or a small CUPS/IPP agent on the shop PC) | Phase 3, only if volume justifies it. Google Cloud Print is dead (2020). Adds a monthly fee or a desktop agent to support. |

Flow: order goes OPEN → staff opens Print Queue → Download → prints (A4, B&W, "actual size",
duplex if double) → **Mark printed** → order becomes **PACKED** → existing rider assignment (both
picking and non-picking stores accept PACKED). The pick-task system never sees print orders.

### 3.7 Delivery
No change. Rider app shows the snapshot name. Delivery OTP, UN_DELIVERED, CLOSED all unchanged.
Packing guidance for staff (Q8): envelope / folder so paper is not crumpled.

### 3.8 Cancel, refund, reprint
- Customer cancel: existing 60-second window on OPEN applies; after that, store-only.
- Store rejects (unreadable, prohibited content): reject endpoint → existing admin-cancel + full
  refund path. The refund is **automatic** (no manual step). Job `REJECTED` with reason; customer notified.
- Complaints after delivery (wrong or poor print): existing refund process. The **super admin decides**.
  The refund is amount-based, not item-based.
- Reprint before dispatch: staff "reprint" — logged for cost tracking, no customer impact.

### 3.9 Retention
- `UPLOADED` drafts never ordered: purge files after 24 h.
- Ordered jobs: purge files **24 hours after delivery** (approved). For orders cancelled before
  delivery: 24 hours after cancel (proposed; **OPEN**, confirm). Keep the metadata row (file name, pages, price) for history/accounting.
- Account deletion (`cron/src/jobs/account-purge.js`): purge that user's print files immediately.
- New cron `cron/src/jobs/print-file-purge.js` (hourly, bounded batch, idempotent: sets
  `filesPurgedAt`, S3 delete of a missing key is a success). S3 lifecycle rule is the backstop.

---

## 4. Per-repo change list + effort

### Backend (~9 days)
1. `shared/models/print-jobs.schema.js`, `shared/repositories/print-job.repository.js`, `shared/constants/print.constant.js` (statuses, limits) — 1 d
2. `orders.schema.js` nullable fields; `stores.schema.js` `config.print` (default enabled:false) — 0.5 d
3. `shared/utils/print-storage.utils.js` (private-bucket put/delete/presign) + `print-document.utils.js` (sniff, normalise to A4, count pages, price quote — pure, unit-testable) — 2 d
4. `user/src/routes/print/{router,controller,validator}.js` + mount in `user/src/routes/index.js`; per-route rate limit — 2 d
5. Print checkout + payment compensation + unpaid-release hook releasing jobs — 1.5 d
6. `admin/src/routes/print/*` queue/download/printed/reprint/reject + permissions + audit — 1.5 d
7. Guards in shared code (§5 items 1-5) + `cron/src/jobs/print-file-purge.js` — 1 d
8. Customer response shim: in `sanitizeOrderForCustomer` fill `itemId` stub for print lines
   (`{ _id: printJobId, name, images: [printIconUrl] }`) so already-shipped apps show a sensible
   name + icon instead of "Item" — 0.5 d (see §5 item 6 for the caveat)

### haper-admin (~4 days)
- New `pages/PrintQueue/` (list, download, mark printed, reprint, reject w/ reason) — 2.5 d
- Store config section "Print service" (enable + prices) in the store settings page — 0.5 d
- `OrderDetailsModal.tsx`: print badge + job details on print lines; hide edit-items for print orders — 0.5 d
- `permissions.ts` mirror + sidebar entry — 0.5 d

### Android (~5 days) / iOS (~5 days) — needs app-store release
- Entry points (approved): **home tile "Print documents"** AND a tile inside the Stationery category.
  Both open the same flow. Shown only when `GET /user/print/config` says enabled.
- Screens: pick files (Android SAF `OpenDocument` / iOS `UIDocumentPicker` + photo picker), local
  preview, per-file options (sides, copies, page range), quote, address, pay (reuse existing
  Razorpay sheet + payment-status polling).
- Order detail: render `lineType == "print"` lines (icon, "24 sides · 2 copies · double").
  New fields **nullable** (Gson ignores Kotlin defaults; Swift must list them in `CodingKeys`).

### haper-web (~3 days)
- **First, independent of the feature:** fix `pages/OrderDetail.tsx` L352 null `itemId` crash.
- Same flow as apps with `<input type=file accept=".pdf,image/jpeg,image/png">`.

### haper-picker — 0 days in v1 (print orders never create pick tasks).
### haper-delivery — 0 days (verify on a print order: `itemId` null renders by name).

### Product roadmap after v1 (not the build phases in §9)
- **MVP (above):** B&W, plain A4, PDF/JPG/PNG, single/double, copies, page range, prepaid, admin print queue.
- **Phase 2:** prints in the grocery cart (one delivery fee) — the risky Option-A work, done once
  v1 proves demand; DOCX via a conversion service; presigned direct upload; picker "collect from
  print desk" line; store-pickup of prints.
- **Phase 3:** colour (per-side colour price; needs colour-page detection or customer declares),
  photo paper / A3 / legal sizes (`options.paper` enum is already there), stapling/spiral binding
  as priced add-ons, auto-print agent.

---

## 5. What could break, and how we prevent it

| # | Existing behaviour at risk | Why | Guard |
|---|---|---|---|
| 1 | Grocery checkout **cancels an unpaid print order** | `supersedeUnpaidOrders` (`user/src/routes/order/controller.js` L966) cancels ANY `PAYMENT_INITIATED` order of the same user+store older than 60 s | Add `orderType: {$ne: "print"}` there; print checkout supersedes only print orders. Test both directions. |
| 2 | Pick-task reconcile cron churns on print orders | `cron/src/jobs/pick-task-reconcile.js` finds OPEN orders on picking stores without a task every minute | Exclude `orderType: "print"` in its query; also make `pick-task.utils.js` `buildLines` skip `lineType:"print"` (defence in depth; picker `itemId` is non-null). |
| 3 | Admin order edit merges/destroys print lines | `order-edit.utils.consolidateItems` groups by `itemId`; all null itemIds would merge into one | Reject item edits on `orderType:"print"` (BE 400 + hide button in admin). |
| 4 | Item-level reports get a "null" product row | any aggregation grouping `items.itemId` (top sellers, product upload controller) | Add `lineType: {$ne:"print"}` filter where grouping by item; profit totals stay unfiltered (cost is correct). Grep list owned by backend dev. |
| 5 | Referral reward credited on a print order | `referralCredited` on first delivered order | Decided: print orders do NOT count as the qualifying order. Print orders are also excluded from coupons and free gifts. |
| 6 | Old apps show "Item" with no picture for print lines | `itemId` null | The response stub (backend task 8). Caveat: any client code that uses `itemId._id` to open a product page would 404 — Android has no reorder (checked); verify iOS tap handlers before enabling the stub. |
| 7 | Web order detail crashes | `item.itemId.images[0]` | Fix before launch (one line, optional chaining). |
| 8 | Dashboards SLA board shows print orders "late" in OPEN | SLA thresholds tuned for picking | Acceptable v1; label print orders in the board. |
| 9 | Existing public upload helper reused by mistake | `uploadToS3` returns a public URL | Separate `print-storage.utils.js`; code review checklist item. |

Rollback: feature is OFF per store (`config.print.enabled=false`) — flip it off and the entry
point disappears; existing print orders still render and deliver. All schema changes are additive.
Hard-to-reverse step: **none** except the AWS bucket (cheap to keep).

Security/abuse:
- Rate limit uploads (e.g. 20/hour/user), max 10 open drafts per user, 20 MB, 200 pages.
- Content: checkbox "I own this content / it is legal" stored on the job (time-stamped); staff can
  reject with reason; refuse obvious ID-forgery/currency/exam-paper-leak material (Q10 policy text).
- Privacy: private bucket, SSE, 5-min links, store-scoped access, every download audited, auto-purge.
  Do not log file names in plain server logs beyond the job id.
- Malicious PDFs: magic-byte sniff, encrypted-PDF reject, rebuild into a fresh PDF (strips JS/actions).
  Antivirus scanning (ClamAV) is not in v1 (would need a hosted service; no Docker) — flagged.

---

## 6. Test approach (in-memory Mongo only, per package `NODE_ENV=test npx jest`)
- **Unit (pure):** quote maths (sides, double-sided sheets, page ranges like "1-3,7", minimum
  charge, rounding), page-range parser, magic-byte sniffer, A4 normaliser on fixture PDFs
  (tiny 1-page, 3-page, landscape, encrypted → reject, JS-bearing → stripped), image→PDF.
- **Integration (user pkg):** upload → patch → quote → order happy path; double-submit same jobs → one
  order, one 409; jobs of another user → 404; Razorpay create failure → jobs back to UPLOADED,
  wallet refunded; unpaid expiry releases jobs; **supersede does not cancel the other order type**.
  S3 is mocked (`jest.spyOn` like `procurement-receive-append.test.js` does for `s3Utils`).
- **Integration (admin pkg):** queue is store-scoped; download audited; printed → PACKED only when
  all jobs printed; reject → cancel + refund; item-edit blocked on print orders; rider assign works.
- **Cron:** purge picks only due rows, idempotent on re-run, missing S3 key = success.
- **Regression:** existing grocery checkout, supersede, pick-task-reconcile and profit suites green.
- Clients: admin `tsc -b` + eslint (no new errors) + Vitest baseline; Android `assembleDebug`;
  web `tsc --noEmit` + `vite build`. New guide `haper-misc/test-print-on-demand.md`.

---

## 7. Open questions — resolved and still open

### 7a. Resolved (2026-10-12)

| # | Question | Answer |
|---|---|---|
| 1 | Launch stores? | Bheldi only. On/off per store with `config.print.enabled`. More stores later, no code change. |
| 2 | Separate order or inside grocery cart? | Separate order in v1 (`orderType: "print"`). Print has its own delivery charge setting (amount still OPEN, see 7b). |
| 3 | Payment | Prepaid only (Razorpay + wallet). No COD in v1. Design leaves room for COD later. |
| 4 | File types | PDF, JPG, PNG. Max 20 MB and 200 pages. No Word, Excel, or PowerPoint in v1. |
| 6 | Retention | Files deleted 24 h after delivery. Uploads never ordered are deleted after 24 h. S3 lifecycle rule as backstop. |
| 7 | Entry point | Home-screen tile AND tile inside Stationery. Both open the same flow. |
| 8 | Prices | ₹2/side single, ₹1.50/side double, ₹20 minimum, cost ₹0.80/side (placeholder). All admin-configurable per store. |
| 9 | Referral, coupons, free gifts | Excluded. Print orders count for none of them. |
| 10 | Who rejects, and how is the money returned? | Store staff reject with a reason. The refund is automatic. |
| 11 | Complaints after delivery | Existing refund process. The super admin decides. |
| — | Payment method for prints | Razorpay + wallet only (see #3). |
| — | Fulfilment | Print Queue in haper-admin → browser print → "Mark printed" → PACKED → rider flow. Auto-print agent later, only if volume grows. |
| — | Scale | Under 50 print orders/day at Bheldi in month 1. |

### 7b. Still OPEN (each needs an owner before the phase named)

| # | Open item | Plan default until decided | Needed by |
|---|---|---|---|
| 2b | Print delivery charge amount | Flat charge, admin editable. Amount not chosen. | Phase 0 |
| 5 | GST 18% and SAC 998912 — placeholders | Use placeholders. Accountant must confirm before the first real order. | Phase 0 (before first real order) |
| 10b | Content policy wording (what is refused, e.g. ID forgery, currency, exam-paper leaks) | Draft text in Phase 0; product owner signs off. | Phase 0 |
| 12 | Who may edit print prices | Super admin only (plan default). Approval says "admin-configurable". | Phase 0 |
| 13 | Preview method (signed-link render vs server page images) | Client renders from signed link. | Phase 0 |
| 14 | S3 backstop lifecycle length | 15 days (decided, longer than the 14-day ordered-file ceiling). | Done |
| 15 | Purge for orders cancelled before delivery | 24 h after cancel proposed. | Phase 0 |
| 16 | Real printer test at Bheldi (paper size, duplex, margins) | Test with a small batch before enabling for customers. | Phase 4 |

---

## 8. Who builds what (after approval)
- **chanchal-designer:** customer flow (file pick → options → quote → pay) and admin Print Queue mockups — first, before client work.
- **aabha-dba:** `print-jobs` schema/indexes, purge query, `orderType` filters on hot queries.
- **Backend engineer:** §4 backend tasks 1-8.
- **hemant-payments:** review print checkout compensation, unpaid-release hook, supersede guard, reject→refund.
- **Admin/web engineer:** haper-admin Print Queue + config; haper-web flow + the L352 fix.
- **Android / iOS engineers:** client flows after designs.
- stas-realtime, deepanshu-data, rohit-ai: not needed in v1.
- **User (manual):** create private S3 bucket + lifecycle rule + IAM permission for the backend role.

---

## 9. Phases & acceptance criteria

Order: Phase 0 → 1 → 2 → 3 → 4. Deploy order (approved): backend → admin → mobile apps. The
haper-web `OrderDetail` fix (L352) ships with the backend.

### Phase 0 — Design + DBA
**Work:** customer flow and Print Queue mockups (chanchal-designer); `print-jobs` schema and indexes
(aabha-dba); decide every item in §7b; accountant confirms GST/SAC; user creates the private bucket.
**Done when:**
- Mockups signed off by the product owner.
- DBA signs off the indexes.
- Every §7b item is either decided or has an owner and a date.
- The user confirms the private S3 bucket exists and public access is blocked.

### Phase 1 — Backend
**Work:** §4 backend tasks 1–8. Print model, upload + A4 normalise + quote, print order endpoint,
payment compensation, unpaid-release hook, admin queue endpoints, purge cron, and the guards in §5
(items 1–4 and 6).
**Done when:**
- In-memory Mongo jest suites pass for print unit, user integration, admin integration, and cron tests.
- Regression suites pass: grocery checkout, supersede, pick-task-reconcile, profit.
- Supersede test passes in both directions (print does not cancel grocery; grocery does not cancel print).
- No print line ever creates a pick task.
- With `config.print.enabled=false`, print endpoints refuse the request.
- Payment-compensation code reviewed by hemant-payments.
- Dev smoke run passes: upload → preview → quote → pay → webhook → OPEN → Mark printed → PACKED.

### Phase 2 — Admin (Print Queue, store config, web fix)
**Work:** `PrintQueue` page; "Print service" section in store settings; print badge on
`OrderDetailsModal` and hidden edit-items for print orders; `print_jobs.view` / `print_jobs.manage`
in both BE and FE permission files; haper-web `OrderDetail` L352 null-`itemId` fix (one line).
**Done when:**
- Queue shows only the signed-in staff member's store.
- Download link expires after 5 minutes and the download is logged.
- Mark printed moves the order to PACKED only when all its jobs are printed.
- Reject cancels the order and refunds it automatically.
- Editing items on a print order is refused by the backend and hidden in the UI.
- FE permission list matches BE permission list.
- `tsc -b` and eslint show no new errors. Vitest stays at the known baseline (5 known failures in `OrderDetailsModal`, no new ones).
- haper-web: `tsc --noEmit` and `vite build` pass. The L352 fix is in the build.

### Phase 3 — Customer apps (Android, iOS, web)
**Work:** file pick → preview → per-file options → quote → address → pay (reuse Razorpay sheet and
payment-status polling). Order detail shows print lines. Two entry points, visibility from config.
**Done when:**
- A test customer on dev can finish upload → preview → pay → see the order.
- Home tile and Stationery tile both open the same flow.
- Both tiles are hidden when `config.print.enabled` is false.
- Print lines show name and icon in the order detail.
- Android `./gradlew assembleDebug` passes. Web `tsc --noEmit` and `vite build` pass.
- iOS build is started by the user, not by an agent (per project rule).
- Old app versions still show a sensible name and icon for print lines (backend stub).

### Phase 4 — Test, security review, docs
**Work:** write `haper-misc/test-print-on-demand.md`; security review; regression pass; update the
CLAUDE.md Project map; changelog entry.
**Done when:**
- The test guide has ✅/❌ steps, including a small real-printer batch at Bheldi (short and long
  pages, double-sided, one last-page job).
- Security check passes: magic-byte check, encrypted PDF refused, JS stripped by rebuild, presigned
  links are 5 minutes, bucket is private, file names are not in plain logs.
- Purge cron verified on dev: deletes due files, is safe to re-run, treats a missing S3 key as success.
- S3 lifecycle rule is set: 15 days on `print/` (7b #14).
- Docs and Project map updated.
- Then the user enables `config.print.enabled` for Bheldi only.

Status: Planning approved; no code written yet.
