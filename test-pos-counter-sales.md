# Test: POS counter sales — walk-in cash sale (admin panel)

**Area:** Admin panel → POS counter (a store admin ringing up a walk-in customer)
**Backend:** `POST /admin/pos/sale`, `GET /admin/pos/customer-search` (`packages/admin/src/routes/pos/*`)
**Permission:** `orders.create_pos` (both endpoints)
**Phase:** A — **cash only**. The order is created **CLOSED + paid** on the spot.

## What this is (real example)

POS = "point of sale". A customer walks into the store, picks up 3 packets of atta, and
pays cash at the counter. The store admin opens the admin panel, adds those 3 packets,
**must type the customer's phone (now required)**, and taps **Record sale**. The backend:

1. Resolves the customer (see below).
2. Decrements stock **atomically** (oldest-expiry-first when batches are on — FEFO).
3. Writes **one** `SALE` row to the stock ledger (`refType: "pos_order"`).
4. Creates the order as **CLOSED** (handed over), `paymentMethod: COD` (cash), `channel: "pos"`.
5. Mints a **GST invoice number** like `INV-2607-N02106`.
6. Returns **HTTP 201** with `{ order, invoiceNumber }`.

**Customer resolution:**
- **Phone is now REQUIRED** (2026-08-10 change): a valid 10-digit Indian mobile matching
  `/^[6-9]\d{9}$/`. The request is **rejected with 400** before it reaches the controller if
  the phone is missing or malformed — no order is created, nothing is decremented.
- Given a valid phone → find-or-create a user keyed exactly like the app OTP login
  (`{ sType: PHONE, phone }`), so if that customer later logs into the app they land on
  the same account and see this purchase.
- **Legacy note:** there used to be a "no phone → shared Walk-in Customer" fallback
  (sentinel phone `POS-GUEST`, non-numeric so a real OTP login can never match it). That
  code path (`resolveCustomer`'s guest branch in `controller.js`) is now **unreachable** via
  the API — the validator rejects phone-less requests first — but is left in place as
  dead-but-harmless code. The `POS-GUEST` account and its **historical** orders still exist
  in prod, untouched; no data migration happened, only the new-sale path changed.

---

## The bug this documents (production-blocking, now fixed)

**Symptom:** a store admin could **not** complete a cash sale. It failed with:

```
E11000 duplicate key error collection: haper-prod.orders
index: invoiceNumber_1 dup key: { invoiceNumber: "INV-2607-N02105" }
```

**Why, in plain words.** An invoice number looks like `INV-2607-N02105`. The number at
the end (`02105`) is a **running counter** — every order gets the next one up. The problem
was **two different counters** handing out numbers for the **same** series:

- **App orders** (the normal path, when an order is CLOSED) take their next number from
  **Redis** — the fast, always up-to-date counter. Redis only copies that number back into
  the database's `sequences` record **once every 100 orders**, so the database copy is
  always a bit behind.
- **POS counter sales** were reading their next number **straight from the database
  `sequences` record** — the copy that is behind by up to 100. So POS kept picking numbers
  Redis had **already** given to app orders.

**Concrete example.** Redis has already handed out up to `N02105` to app orders, but the
database record still says `N02005`. POS reads the **database**, picks `N02006` — but an app
order already owns `N02006`. The `invoiceNumber_1` unique index rejects it → **E11000** →
the sale fails at the counter.

**The fix** (in `packages/admin/src/routes/pos/controller.js`):
1. **One shared source.** POS now mints its invoice number from the **same Redis counter**
   the app uses (`OrderModel.getNextSeq("invoiceNumber")`). Both paths draw from one
   monotonic counter, so their numbers can never overlap. The invoice **format is
   byte-for-byte identical** — nothing downstream changes.
2. **Safety net (defense in depth).** If a duplicate invoice number ever still happens
   (e.g. two mints racing), the sale **re-generates a fresh number and retries the whole
   transaction** — up to **5 attempts** — instead of failing. Because each attempt runs in
   one transaction that rolls back on failure, **stock is only ever decremented once**.

---

## Thermal receipt print — paper waste fix

**Symptom:** After switching to a new thermal printer, printing cash sale receipts wastes paper — the printer feeds and ejects a long blank tail after the receipt content completes.

**Why, in plain words.** The receipt-print CSS used `@page { size: 58mm auto; }` to specify 58mm width and auto-adjusting height based on content. The new printer's driver ignored the `auto` height and defaulted to a full fixed page length (typically 8.5 inches / A4 size), causing the printer to feed far more paper than the receipt actually needed.

**The fix** (in `haper-admin/src/utils/thermalPrint.ts` and `src/pages/POS/NewSalePage.tsx`):
1. **Measure content height exactly.** The receipt-print function now calculates the actual rendered height of the receipt DOM and applies an explicit `@page` height in the CSS, replacing the unreliable `auto` setting. This ensures printers receive correct dimensions and feed only the paper required.
2. **Paper-width selector (58mm / 80mm).** A new dropdown "Paper: 58mm / 80mm" appears in the POS page header (visible before any sale is rung up) and is persisted to `localStorage`. Both the POS "Print receipt" button and the Order Details Modal's thermal-print flow read this same shared setting, so users configure it once and it applies everywhere.
3. **Thermal prints only.** This fix affects only the "Print receipt" (browser thermal print) path in `thermalPrint.ts`. It does **not** affect "Print invoice" or "Download invoice" (which generate a backend PDF via a separate code path).

---

## What deploy this needs

- **Thermal receipt print fix:** Frontend only (`haper-admin` build). The receipt now measures content height and applies exact `@page` dimensions. The paper-width selector (58mm/80mm) is persisted to `localStorage` and shared across POS and Order Details thermal prints. **No backend deploy needed.**
- **Invoice sequence fix (from earlier):** Backend redeploy only (dev: `dapi.haper.in`). The fix is entirely in `packages/admin/src/routes/pos/controller.js`. **No DB migration, no schema change, no API-shape change.** After the backend is deployed, POS and app orders **share the Redis counter** and the E11000 error stops.

Source (for reference):
- Endpoint: `packages/admin/src/routes/pos/{router,controller,validator}.js`.
- Shared counter: `OrderModel.getNextSeq` in `packages/shared/models/orders.schema.js`
  (Redis-primary via `distributedCacheUtils.incr`/`seedIfNeeded` in
  `packages/shared/utils/distributed-cache.utils.js`).
- Tests: `packages/admin/__tests__/pos-invoice-sequence.test.js` (the regression) and
  `packages/admin/__tests__/pos-sale.test.js` (the existing happy-path suite).

---

## Prerequisites (read once)

1. **Log in to `damin.haper.in`** as an admin/super-admin who has the **`orders.create_pos`**
   permission. Without it, both POS endpoints return **403**.
2. **A store context.** The request needs the `x-store-id` header (the admin panel sends it
   when a store is selected). No store → **400 "Store context required."**
3. **An item with stock** in that store (so the sale can actually decrement it).

> Quick backend check (optional): as a logged-in admin with a store selected, hit
> `POST /admin/pos/sale` with one in-stock item → **201** and a
> `data.invoiceNumber` that starts with `INV-`.

---

## Manual test steps (confirm the fix on dev)

### ✅ A. A cash sale succeeds while app orders are being closed (the core fix)
1. Have some **app-order traffic** going (or close a few app orders yourself so the Redis
   invoice counter is climbing).
2. In the admin panel, add one in-stock item and record a **cash** POS sale.
3. **Expect:**
   - **HTTP 201**, `data.invoiceNumber` is a **unique** `INV-YYMM-Nnnnnn`.
   - The item's stock **dropped by the quantity sold** (exactly once).
   - **One** `SALE` ledger row for that item (`refType: "pos_order"`,
     `refLabel` = the invoice number, `quantityDelta` = `-qty`).
   - **No E11000.**

### ✅ B. Rapid interleaved sales stay unique and increasing
1. Rapidly record several POS sales, **interleaved** with closing app orders.
2. **Expect:** every invoice number is **unique** and forms **one strictly-increasing**
   sequence across both paths. No duplicate, no E11000.

### ✅ C. Customer linking
1. **With phone:** record a sale with a customer phone (e.g. `9990001111`). **Expect:** the
   order links to the `{ sType: PHONE, phone: 9990001111 }` user — creating it if new,
   reusing it if that app user already exists (no duplicate account).
2. **Customer search:** `GET /admin/pos/customer-search?q=<3+ digits>` finds a user **by
   phone globally** — even one who has never ordered at this store (useful for a brand-new
   store). Fewer than 3 characters returns an empty list.

### ❌ C2. Phone is mandatory (2026-08-10) — missing/malformed phone is rejected
1. On the admin **New Sale** page, add an item to the cart but leave the customer phone
   field empty. **Expect:** the **"Complete sale"** button stays **disabled**, and the phone
   field shows a red border + inline hint ("Enter a valid 10-digit phone number") once you've
   typed something invalid.
2. Type a malformed phone (too short, e.g. `12345`, or starting with a digit outside `6-9`,
   e.g. `0123456789`). **Expect:** same disabled-button + red-hint state — the sale cannot be
   submitted from the UI.
3. Type a valid 10-digit phone (e.g. `9876543210`). **Expect:** the red hint clears and
   "Complete sale" becomes enabled.
4. **Direct API check (optional):** `POST /admin/pos/sale` with `customerPhone` omitted, or
   set to `"12345"` / `"0123456789"`. **Expect: HTTP 400**, validation error mentioning phone,
   and **no order created** (nothing decremented, no ledger row).

### ✅ D. Insufficient stock is rejected cleanly
1. Try to sell more units than are in stock.
2. **Expect:** **400 "Insufficient stock…"**, **no order created**, stock **untouched**
   (the transaction rolls back).

### ✅ E. Thermal receipt print — short page (no paper waste)
1. Go to POS counter sales on `damin.haper.in`.
2. Add one in-stock item to a sale and click **Record sale** → the sale closes.
3. Click **Print receipt** (thermal print).
4. In the browser print preview (e.g., Chrome's print dialog), observe the page dimensions.
5. **Expect:**
   - The preview shows a **single short page** sized to the receipt content (e.g., ~150mm tall
     for a typical receipt).
   - **No long blank space** at the bottom (which was the symptom of the old `auto` height bug).
   - If you print to an actual 58mm thermal printer, it feeds only the receipt, no blank tail.

### ✅ F. Paper-width selector persists to localStorage
1. Before starting a sale, locate the **"Paper: 58mm / 80mm"** dropdown in the POS page header.
2. Select **80mm** from the dropdown.
3. Refresh the page (or navigate away and back to POS).
4. **Expect:** the dropdown still shows **80mm** — the choice is persisted to `localStorage`.
5. Now start a sale, add an item, click **Record sale**, and then **Print receipt**.
6. In the browser print preview, **Expect:** the page width corresponds to 80mm (wider than 58mm).
7. Switch back to **58mm** in the dropdown and repeat step 5 — the preview should narrow to 58mm.

### ✅ G. Order Details Modal thermal print honors paper-width setting
1. From an existing closed order (e.g., the one from step E), open the **Order Details Modal**.
2. In the modal header, confirm the **"Paper: 58mm / 80mm"** dropdown shows the value from step F (it is the same setting shared across POS and order details).
3. Click the thermal print or **"Print receipt"** button in the modal.
4. In the browser print preview, **Expect:**
   - The page width matches the selected paper width (58mm or 80mm from step F).
   - The page height is short, sized to content (no blank tail).

### ❌ H. Thermal print scope — does not affect PDF invoice
1. Go to the same order and click **Print invoice** (or **Download invoice**).
2. **Expect:** the PDF-based invoice download/preview is **unaffected** by the "Paper: 58mm / 80mm" selector.
   - The PDF invoice is generated server-side and does not use the `thermalPrint.ts` logic.
   - Changing the paper-width selector does not change the invoice PDF dimensions.

### ❌ I. The regression this prevents (invoice number duplicate)
- A POS cash sale fails with `E11000 … invoiceNumber_1 dup key`. This must **not** happen
  after the fix — if you see it, the backend box is a build behind (redeploy needed), or
  see the prod reconcile fallback below.

---

## Edge cases to verify

- **Duplicate invoice on insert → retry, not failure.** Even if a duplicate invoice number
  somehow lands on the first insert, the sale **re-mints and retries** (up to 5 times) and
  still returns **201** with a **different** invoice number. Stock is decremented **exactly
  once** (the failed attempt's transaction rolls back before the retry).
- **Only cash is accepted.** `paymentMode` other than `"cash"` → **400 "Only cash sales are
  supported here (online is Phase B)."**
- **FEFO when batches are on.** The sale consumes **oldest-expiry-first** and records the
  real per-lot cost; with batches off it uses the item's cost snapshot. Either way stock
  drops by the exact quantity.
- **Order shape stays stable.** POS orders are always `channel: "pos"`, `status: CLOSED`,
  `paymentMethod: COD`, `addressId: null`, `deliveredOn` set, `meta.id = "pos_<invoice>"`.
  Reports and other apps that read orders must keep working (backward compatible).
- **Thermal print paper-width scope.** The "Paper: 58mm / 80mm" selector applies only to
  browser thermal prints (POS "Print receipt" and Order Details Modal thermal print). It does
  **not** affect backend-generated PDFs like "Print invoice" / "Download invoice" (which are
  separate server-side PDF flows).

---

## Automated coverage (in-memory Mongo only)

Backend tests run against **in-memory Mongo — never the real DB**. Run from the package dir
so the per-package in-memory setup fires:

```
cd packages/admin && NODE_ENV=test npx jest pos-invoice-sequence pos-sale
```

- **`packages/admin/__tests__/pos-invoice-sequence.test.js`** (the regression for this bug):
  1. **Cross-path no-collision** — interleaves app-order closes with POS sales; asserts every
     invoice number is unique and strictly increasing across both paths.
  2. **Regenerate-and-retry** — pre-seeds an order that already holds the number POS will mint
     first, then asserts the POS sale still returns 201 with a *different* number, and that
     stock decremented **exactly once** (one `SALE` ledger row, one POS order).
  - It **spies Redis** (`distributedCacheUtils.incr`/`seedIfNeeded`) to simulate the
    Redis-ahead / Mongo-lagging split, because the in-memory env has no real Redis (without
    the spy both counters would agree and the bug wouldn't reproduce).
- **`packages/admin/__tests__/pos-sale.test.js`** (existing happy-path suite, updated
  2026-08-10 for mandatory phone): cash sale + stock decrement + `SALE` ledger row +
  customer-by-phone linking, existing-user reuse, insufficient-stock rejection, and
  `orders.create_pos` permission gating on both endpoints. Now also covers:
  - **Missing phone → 400**, no order created (replaces the old "shared walk-in customer"
    success case, which is no longer reachable).
  - **Malformed phone → 400** (e.g. `"12345"`, `"0123456789"`), no order created.

---

## Prod reconcile runbook — USER-RUN ONLY — PROD — DO NOT EXECUTE FROM HERE

> **This is almost certainly NOT needed.** Redis is already the high-water counter. Once POS
> also draws from Redis, it simply continues **above** every number already issued, so the
> **code fix alone stops the error**. Keep this only as a **fallback** if duplicate-key errors
> somehow persist after deploy — e.g. Redis was flushed and reseeded from the lagging Mongo
> record.
>
> **The commands below are for the USER to run, against PROD, by their own decision.** We do
> not run them from here. Confirm the connection target first.
>
> **Assumption:** the current invoice format is `INV-YYMM-Nnnnnn` (e.g. `INV-2607-N02105`,
> zero-padded to 5 digits). The read query below depends on that shape — re-check it if the
> format ever changes.

**Step 1 — READ (safe, read-only): find the current max invoice sequence in `orders`** (mongosh):

```
db.orders.aggregate([
  { $match: { invoiceNumber: { $regex: /^INV-\d{4}-N\d+$/ } } },
  { $project: { seq: { $toInt: { $arrayElemAt: [ { $split: [ "$invoiceNumber", "-N" ] }, 1 ] } } } },
  { $group: { _id: null, maxSeq: { $max: "$seq" } } }
])
```

**Step 2 — choose a safe target.** `target = maxSeq + a margin` (e.g. `+ 1000`), so the next
mint is safely above anything already issued.

**Step 3 — WRITE (PROD, user-run): bump BOTH counters above the max.**

Redis is the live counter. `seedIfNeeded` **only seeds when the key is ABSENT**, so an
existing `seq:invoiceNumber` key must be **SET explicitly** (seeding won't overwrite it):

```
# Redis (the live counter):
SET seq:invoiceNumber <target>
```

```
# Mongo `sequences` doc (so a future Redis flush reseeds from a safe value):
db.sequences.updateOne(
  { _id: "invoiceNumber" },
  { $set: { seq: <target> } },
  { upsert: true }
)
```

**Note on off-by-one.** `getNextSeq` returns the **post-increment** value. After
`SET seq:invoiceNumber <target>`, the **next** invoice minted is `<target> + 1`. Choose
`<target>` accordingly.

> **CAUTION — never run write commands against prod unless the user explicitly decides to.**
> Confirm the connection target before any write. This section is **user-driven only**; the
> code fix is expected to be sufficient on its own.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| POS sale returns **403** | The admin account lacks `orders.create_pos`. |
| POS sale returns **400 "Store context required."** | No `x-store-id` header / no store selected. |
| POS sale returns **400 "Customer phone is required (10-digit mobile number)"** | Phone was omitted or doesn't match `/^[6-9]\d{9}$/` (mandatory since 2026-08-10). On the admin UI this shows as a disabled "Complete sale" button, not a toast. |
| POS sale returns **400 "Only cash sales…"** | `paymentMode` was not `"cash"` (online is Phase B). |
| POS sale returns **400 "Insufficient stock…"** | Not enough on-hand for a line; nothing is decremented (transaction rolled back). |
| POS sale fails with **E11000 … invoiceNumber_1** | The fix is not deployed on this box (redeploy the backend). If it persists **after** deploy, use the prod reconcile fallback above (user-run). |
