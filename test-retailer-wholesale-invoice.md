# Test: Retailer (wholesale) program — GST (B2B) invoice + store wholesale switch

**Plan:** `haper-backend/docs/plans/retailer-wholesale.md` (rev 2, §3.7, §3.9, §6 step 24, §10 hemant S9 / rajit S5 + S8).
**Backend files:** `packages/shared/utils/invoice.utils.js` (`buildInvoiceModel` + `renderInvoicePdf`),
`packages/shared/repositories/order.repository.js` (`getInvoiceData` now also loads the store address),
`packages/admin/src/routes/store/{controller,validator}.js` (`wholesaleEnabled` switch).
**Branch:** `dev` (direct-to-dev). **Needs:** backend deploy (user + admin services). No client change: the download URLs are the same. No migration.
**Related guides:** `test-retailer-wholesale-orderlines.md` (where `gstRate` / `hsn` / `packOf` on lines come from), `test-invoice-download-toggle.md`.

## What this is (a real example)

A retailer (a shop owner with a GST number, called a GSTIN) buys stock to resell. To claim back the GST they paid ("input tax credit"), they need a **tax invoice that shows both GSTINs and the tax split per line**. An ordinary customer's invoice does not need this, and it stays exactly as it is today.

Example: a line of 12 noodles at ₹14 = ₹168, GST 18%. Prices already include GST, so we work backwards:
- Same state (shop and store both in Bihar): CGST ₹12.81 + SGST ₹12.81 (always equal), taxable ₹142.38. Total still ₹168.00.
- Different state (shop in Jharkhand): one IGST figure ₹25.63, taxable ₹142.37.

"CGST/SGST" = central + state share of GST, used when buyer and seller are in the same state. "IGST" = one combined GST, used across states. "HSN" = the product's tax code (noodles `1902`). "Place of supply" = the buyer's state.

Rules the invoice follows:
- All tax maths in whole paise. CGST == SGST on every line; the odd paisa stays in the taxable value.
- Delivery fee and platform fee are their own lines, taxed at **18%, already inside the fee** (working assumption until the CA confirms).
- A coupon is already inside the item prices, so it is not taken off twice. It is mentioned in a note.
- Wallet coins are shown as a payment ("Paid by wallet coins"); they do not lower the taxable value.
- Amount payable == the order's total (`price`) exactly. A "Round off" line only ever appears for less than ₹1.
- An item without an HSN prints `-` and a note says so.
- A pack line reads "Maggi 70g (Pack of 12) = 24 pcs".

## Setup (dev)

1. A store with batch tracking ON and a valid GSTIN, e.g. a Bihar GSTIN starting `10`.
2. Retailer A approved with GSTIN in the same state (`10…`). Retailer B approved with a GSTIN from another state (e.g. `20…`). Customer C = ordinary customer.
3. Items with GST rates 0%, 5%, 18%; one with HSN set, one without; one pack ("Pack of 12").

## Steps

### Store switch (admin → Store settings, super admin)
- [ ] ✅ Turn **wholesale ON** on a store with batch tracking ON + valid GSTIN → saved; an audit row `store.config.wholesaleEnabled` appears.
- [ ] ❌ Turn wholesale ON while batch tracking is OFF → 409 "Turn on batch tracking for this store before enabling wholesale."
- [ ] ❌ Turn wholesale ON with no GSTIN, or a GSTIN with a typo (wrong check letter) → 409 "Add a valid store GSTIN…".
- [ ] ✅ One save that turns batch tracking ON + sets the GSTIN + turns wholesale ON → saved.
- [ ] ❌ While wholesale is ON, turn batch tracking OFF → 409 "Turn off wholesale for this store before turning off batch tracking."
- [ ] ❌ While wholesale is ON, clear the GSTIN or type an invalid one → 409.
- [ ] ✅ Turn wholesale OFF and batch tracking OFF in the same save → saved.
- [ ] ❌ Store admin (not super admin) tries to flip wholesale → 403 "Only a super admin…". A store admin saving other settings (the form re-sends the unchanged flag) still works.
- [ ] ✅ After turning wholesale OFF, retailers stop seeing wholesale within a moment (cache is dropped on save).

### B2B invoice (deliver each order, then download from the app and from admin → Order → Invoice)
- [ ] ✅ Retailer A, same state: header "TAX INVOICE / Original for recipient"; store name, address, GSTIN, state; buyer legal name, trade name, address, GSTIN, state; place of supply = Bihar (10); "Reverse Charge: No".
- [ ] ✅ Table columns: HSN, Qty, Value, Taxable, GST %, CGST, SGST. CGST equals SGST on every row.
- [ ] ✅ Retailer B, other state: CGST/SGST columns replaced by one IGST column; place of supply = B's state.
- [ ] ✅ Tax summary lists one row per GST rate (0%, 5%, 18%…), and rows add up to the totals.
- [ ] ✅ Delivery ₹30 + platform ₹5: two fee lines at 18% (₹30.00 → taxable ₹25.42 + 2.29 + 2.29).
- [ ] ✅ Order with ₹25 wallet coins: "Paid by wallet coins −25.00", Amount payable = order total; taxable value same as without coins.
- [ ] ✅ Order with a coupon: item values already reduced; note "Coupon CODE (₹X off) is already deducted"; not taken off again.
- [ ] ✅ Item without HSN shows `-` + footnote.
- [ ] ✅ 2 × "Pack of 12" shows "(Pack of 12) = 24 pcs".
- [ ] ✅ Free gift on a retailer order: ₹0.00, no tax.
- [ ] ✅ Prepaid (online) retailer order with coins that a picker edited (item out of stock): invoice opens; label "Grand total" and a line "of which paid by wallet coins".
- [ ] ❌ Retailer order on a store whose GSTIN was removed outside the app: download answers 409 "This store has no GSTIN set…" (no invalid invoice printed).

### Ordinary customer (must be unchanged)
- [ ] ✅ Customer C's invoice looks exactly like before (same layout, "GST is included in item prices." footer, no HSN/CGST columns). Automated: the PDF is byte-identical to the pre-change output for 5 fixed orders.

## Edge cases / known limits
- **Credit note not built** (plan §3.7 "Not in P1"). A refund after delivery on a retailer order needs one; until then the admin cancel/refund of a delivered retailer order is blocked except by super admin (Owner D, `markOrderAdmin`).
- **One invoice-number series** for all stores. Fine for one GSTIN; wrong once stores in two states share it (plan §3.7).
- **Cached PDFs:** an invoice already downloaded is served from cache (S3 + 24 h Redis key). A retailer order downloaded BEFORE this deploy keeps its old B2C-style PDF until that key expires.
- Fee HSN/SAC prints `-` (CA to confirm the code and the 18% rate).
- E-invoice / IRN not built (only needed above ₹5 crore turnover, plan Q4).

## Automated tests
- `packages/user/__tests__/invoice-model.test.js` — B2C golden (trace + bytes), tax split, B2B intra/inter, multi-rate, fees, wallet, edited prepaid, coupon (not double-counted / spread when only in price), round-off bound, missing HSN, pack label, 200 random carts, download endpoint.
- `packages/admin/__tests__/store-wholesale-gate.test.js` — both directions, GSTIN checksum, roles, echo, audit, cache reset.

## Update 2026-10-31: invoices are no longer public (security audit H1, M2, L6)

**Needs:** backend deploy (user + admin), then the user-run AWS step U5 in `runbook-wholesale-rollout.md` (CloudFront deny on `invoices/*` + delete the old objects). Same endpoints, no client change.

How it works now (example: order `6532…`) — **no redirect any more, the API always sends the PDF itself**:
1. First download: the API builds the PDF and sends it (200). In the background it saves it in the **private** bucket (`PRINT_S3_BUCKET`) at `print/invoices/v3/6532….pdf` and remembers that key in Redis for 24 h.
2. Next download within 24 h (app, web or admin panel — all the same): the API reads that saved PDF from the private bucket and sends it (200). It does not build it again or upload it again.
3. If the bucket read fails (object expired, S3 hiccup): the API builds the PDF again, sends it, and saves it again.
4. If `PRINT_S3_BUCKET` is not set on that API: always 200 with a freshly built PDF (nothing is stored).
5. Every answer has `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<invoice no.>-invoice.pdf"` and `Cache-Control: private, no-store`. No S3 link is ever sent to a phone or browser.
6. Old public links (`…/invoices/<orderId>.pdf` on the CDN) and older cache entries (v2) are never used again. They stay readable until U5 is done.
7. When an admin changes the order's status (mark-status, reopen, convert-to-COD) or edits its items, the saved copy is forgotten, so a re-delivered order gets a fresh invoice. If Redis is down this is skipped silently — the status change still succeeds.

Why no redirect: installed iOS builds forward the login header when they follow a redirect, and S3 refuses that with 400 "Only one auth mechanism allowed". Streaming works for every app version already in customers' hands.

Steps:
- [ ] ✅ App (Android + an already-installed iOS build): download twice → both are 200 with the PDF, no redirect; the PDF opens and both copies are identical.
- [ ] ✅ Web and admin panel: download works every time (200, filename from `Content-Disposition`).
- [ ] ✅ Response headers include `Cache-Control: private, no-store`.
- [ ] ❌ Customer B asks for customer A's invoice (`/user/order/<A's id>/invoice`) → 404, nothing read from S3.
- [ ] ❌ Store admin of store B downloads an invoice of store A's order (admin → `/admin/order/<id>/invoice`) → 404. ✅ Super admin can download any store's invoice.
- [ ] ✅ Super admin moves a delivered order to Undelivered, reopens, edits, re-delivers → the next download shows the new items/total, not the old PDF.
- [ ] ✅ Approved retailer in a store with wholesale OFF: normal (B2C) invoice downloads fine (no 409), because such orders no longer carry a retailer snapshot.

Notes:
- The objects sit under `print/`, so the existing CloudFront deny, IAM grant (B7) and the 15-day lifecycle rule cover them; the cron print-file purge deletes only keys recorded on print jobs, so it never touches them. An expired object is simply rebuilt on the next download (the Redis key lives 24 h, far less than 15 days). The API now reads the object itself (S3 GetObject on `print/invoices/*`). No IAM change: the signed links it used to hand out only worked because the API's own role already had that read permission.
- iOS/Android: the clients' "drop the login header when a redirect goes to another host" fix stays in place as defence in depth (the API no longer redirects, but nothing breaks if a redirect ever comes back).

## Update 2026-10-31: admin invoice search is per store

**Needs:** backend deploy (admin). No admin-panel change.

- [ ] ✅ Store admin of store A searches "INV-" on the Invoices page → only store A's invoices; the table still shows invoice no., order id, customer name + phone, amount, payment, delivered on, PDF button.
- [ ] ✅ Super admin searches → every store's invoices (each row also carries the store name).
- [ ] ❌ `GET /admin/order/invoices/search?query=INV&limit=1000` → at most 50 rows come back.
- [ ] ❌ The search answer no longer contains the retailer's GST details, the delivery address or payment internals (check in the browser's network tab).
