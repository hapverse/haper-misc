# Test: Warehouse goods-receipt payment status (Paid / Not Paid)

**Area:** Admin panel → Warehouses → **Verify Bill** page (receipts list)
**Backend:** `POST /admin/procurement/receipt/mark-paid`, `POST /admin/procurement/receipt/unmark-paid`,
plus 5 new fields on the existing `GET /admin/procurement/receipt/list`
(`packages/admin/src/routes/procurement/*`, `packages/shared/models/receipt-payments.schema.js`)
**Permission:** WRITE = `warehouse.manage` **AND** role `super_admin` / `warehouse_manager` (double gate).
READ = `warehouse.receive_goods` (unchanged) — warehouse **staff** SEE the badge but can never change it.
**Deploy needed:** backend **redeploy** (new collection + endpoints) + admin **web deploy**.
**No DB migration** — the collection and its indexes are created at boot.
**Tests (green):** `packages/admin/__tests__/procurement-receipt-payment.test.js` (20),
`packages/admin/__tests__/receipt-payment-index-registration.test.js` (4).

---

## What this is (real example)

A supplier delivers against **bill TS6826**. You receive the goods today, and the rest of the same
bill arrives four days later. The stock is in — but did anyone actually **pay** the supplier?

Every bill on the Verify Bill page now carries a payment badge. It starts as a neutral
**"Not Paid"** (that's the normal state, not an alarm). A **warehouse manager** or **super admin**
can hit **Mark paid**, optionally typing a **transaction ID** (the UTR/reference) and **when** the
money moved. The badge turns green **Paid**, and everyone — including floor staff — can see it.

### The one thing to understand: the badge belongs to the BILL, not the delivery

The payment record is keyed on **`warehouseId + supplierId + invoiceNumber`**. It is **NOT** keyed
on a date/time. Real example from prod: invoice `6834` arrived in **16 separate receive-actions
over two weeks** from one supplier. That is still **one bill and one payment**. So:

- Mark bill TS6826 paid once → **every** receive-action for TS6826 shows "Paid".
- There is never more than **one** payment row per bill (a unique DB index enforces it).

`INV-1`, `inv-1` and `  INV-1  ` are the **same bill** — the invoice number is stored trimmed +
UPPERCASE, exactly like the receive path already stores it.

### Two different times, deliberately

| Field | Means |
|---|---|
| `paidAt` | When the admin says **the money actually moved**. Blank unless they typed it — the server **never** fills it with "now". |
| `markedPaidAt` | When the **mark/unmark click** happened. Always set. |

### Un-marking never deletes

**Unmark** flips the status back to `NOT_PAID` on the same row. The transaction ID, paid-on time and
who marked it stay on the record — the history of a mistaken mark survives.

---

## API

### `POST /admin/procurement/receipt/mark-paid`
```json
{
  "warehouseId": "<optional; taken from the manager's own warehouse if omitted>",
  "supplierId": "<required ObjectId>",
  "invoiceNumber": "TS6826",
  "transactionId": "UTR12345",            // optional, ≤ 120 chars
  "paidAt": "2026-08-20T10:30:00.000Z",   // optional ISO timestamp
  "mode": "CASH"                          // optional: "CASH" | "ONLINE" | "OWNER"
}
```
Returns `{ msg, data: { warehouseId, supplierId, invoiceNumber, status, transactionId, paidAt,
mode, markedPaidBy, markedPaidAt } }`. **Idempotent** — calling it twice (double-click, or two managers at
once) updates the same row; it never creates a second one and never errors.

`404` if that invoice + supplier was never received at this warehouse (stops a typo creating a
payment record no list will ever show). `400` if `supplierId` is missing — a bare invoice number is
not a bill key, or if `mode` is anything other than the three allowed values (e.g. `"CHEQUE"`).

**`mode` is optional, like the other two detail fields.** Blank/omitted stays `null` — "the manager
didn't say how it was paid", never a guess. `OWNER` means the business owner paid it personally
rather than from a company account.

### `POST /admin/procurement/receipt/unmark-paid`
Body = the three key fields only. Returns `status: "NOT_PAID"`. A bill that was never marked is a
**no-op 200**, not a 404 (no row already MEANS not paid).

### `GET /admin/procurement/receipt/list` — 6 new fields per row
`paymentStatus` (`"NOT_PAID"` | `"PAID"`), `transactionId`, `paidAt`, `mode`, `markedPaidBy`,
`markedPaidAt`. All nullable and **additive** — every field the page used before is unchanged, and an
unmarked bill reports `"NOT_PAID"` with nulls without any row existing.

`transactionId`, `paidAt`, `mode` and `markedPaidBy` are returned as `null` whenever the current
status is not `PAID`, even though the DB row keeps them as history after an unmark.

---

## Walkthrough

### ✅ Happy path — mark a bill paid
1. Log in as **super admin** (or a warehouse manager). Warehouses → **Verify Bill**.
2. Pick any received bill. Badge reads a neutral **Not Paid**.
3. Click **Mark paid** → modal opens with **Transaction ID**, **Paid on** and **Mode** all **blank**.
4. Type `UTR12345`, pick yesterday 10:30, choose Mode **Online**, **Mark as Paid**.
5. ✅ Badge turns green **Paid**. Reload the page — it is still Paid.
6. Click the green badge → popover shows the transaction ID, the paid-on time, the mode, and who
   marked it.

### ✅ All optional boxes left blank
1. Mark a different bill paid **without** typing or choosing anything.
2. ✅ The button is **not disabled**; the mark succeeds; badge goes green.
3. ✅ The popover shows **no** transaction ID, **no** paid-on time and **no** mode — the server must
   NOT have filled in "now" or picked a mode. (❌ If paid-on shows today's date/time you never typed,
   or the mode reads "Cash" you never chose, that's the bug.)

### ✅ Payment mode round-trip
1. Mark three different bills paid with mode **Cash**, **Online** and **Owner**.
2. ✅ Each badge popover / list row reports back the mode you picked, unchanged, after a reload.
3. Re-mark the Cash one as **Online** → ✅ the mode is overwritten, still one record for that bill.
4. ❌ `POST /receipt/mark-paid` with `"mode": "CHEQUE"` (curl/Postman) must return **400** and write
   nothing.

### ✅ One bill, two deliveries → one badge
1. Receive invoice `MULTI-1` from supplier A. Receive it **again** (confirm the duplicate warning).
2. Mark `MULTI-1` paid once.
3. ✅ In the default (aggregated) list the single row is Paid.
4. ✅ Switch to the **individual** view — **both** receive-actions show **Paid**, same transaction ID.

### ✅ Unmark preserves history
1. On a Paid bill click the badge → **Unmark** → confirm.
2. ✅ Badge returns to **Not Paid**, and the transaction ID / paid-on / mode disappear from the API
   response (the DB row still keeps them as history).
3. ✅ Mark it paid again — it still works, and there is still only one record for that bill.

### ✅ Idempotent double-click
1. Double-click **Mark as Paid** fast (or have two managers do it at once).
2. ✅ No error, no duplicate row, badge is Paid.

### ❌ Warehouse staff cannot mark
1. Log in as a **warehouse staff** account.
2. ✅ Verify Bill still lists bills and shows the Paid / Not Paid badge (read-only).
3. ✅ No **Mark paid** button.
4. ❌ Calling `POST /receipt/mark-paid` directly (curl/Postman with the staff token) must return
   **403** — the UI hiding the button is not the protection.

### ❌ store_admin cannot mark
`store_admin` bypasses the permission system everywhere else in this codebase, so it is checked
explicitly: `POST /receipt/mark-paid` with a store-admin token must return **403**.

---

## Edge cases

- **Casing/whitespace:** marking `  ts6826  ` paid marks the same bill as `TS6826` — one row.
- **Unknown invoice:** marking an invoice number that was never received → **404**, nothing written.
- **Same invoice number, different supplier or warehouse:** genuinely different bills → separate
  payment records, separate badges.
- **Bills with no invoice number** never appear on the Verify Bill list, so they cannot be marked.
- **Supplier correction:** `PATCH /receipt/supplier` moves a receipt to a different supplier. The
  payment record is keyed on the supplier, so a corrected bill reads **Not Paid** again under its new
  supplier and has to be re-marked. Known follow-up, not handled in this build.
- **Old data:** every bill received before this feature reads **Not Paid** — no backfill needed.

---

## Follow-up (2026-09-01): Payment-status FILTER + list sort

`GET /admin/procurement/receipt/list` now accepts three more **optional** query params. Sending none
of them behaves exactly as before (all bills, newest activity first), so nothing that already calls
this endpoint changes.

| Param | Values | Meaning |
| --- | --- | --- |
| `paymentStatus` | `PAID` \| `NOT_PAID` | Show only bills in that state. Omit = all bills. |
| `sortBy` | `date` \| `amount` \| `paymentStatus` | `date` = last receive activity (default), `amount` = the row's **billed cost** (`totalCost`), `paymentStatus` = the badge. |
| `sortOrder` | `asc` \| `desc` | Default `desc`. On `paymentStatus`: `asc` = Not Paid first, `desc` = Paid first. |

Anything else in those three params is a **400** (e.g. `paymentStatus=PARTIAL`).

**Tests (green):** `packages/admin/__tests__/procurement-receipt-list-filter-sort.test.js` (11).

### ✅ How to check it by hand (curl / Postman, manager or staff token)
1. Receive two bills, mark ONE of them paid.
2. `GET …/receipt/list?paymentStatus=PAID` → ✅ only the paid bill, and `total` is **1** (not 2).
   ❌ If `total` still says 2, the count is being taken before the filter — that's the bug.
3. `…?paymentStatus=NOT_PAID` → ✅ the bill that was never marked (a bill with **no** payment row at
   all still counts as Not Paid).
4. `…?paymentStatus=PAID&limit=1&page=2` → ✅ empty page, `total` still 1.
5. `…?sortBy=amount&sortOrder=asc` → ✅ cheapest bill first; `desc` → dearest first.
6. `…?sortBy=paymentStatus&sortOrder=asc` → ✅ all the Not Paid bills first.
7. A bill received **twice** (same invoice, `confirmDuplicate`) and marked paid: filtering by `PAID`
   returns **one** row in the default view and **both** receive-events in `view=individual` — ✅ never
   one of the two.
8. `…` with none of the three params → ✅ identical to the pre-change list.

**Deploy needed:** backend redeploy + admin web deploy. Admin UI **built 2026-09-02** — see
"Admin UI for filters / sort / summary / mode" below.

---

## Follow-up (2026-09-02): DATE RANGE + payment SUMMARY

Same endpoint, two more additions. Both optional; a call that sends neither is byte-identical to
before **except** that the response now always carries an extra `stats` object (purely additive —
existing callers ignore it).

### Date range

| Param | Format | Meaning |
| --- | --- | --- |
| `fromDate` | `2026-08-01` (ISO date) | From **00:00 IST** of that day, inclusive. |
| `toDate` | `2026-08-31` (ISO date) | Up to **23:59:59.999 IST** of that day, inclusive. |

Either side may be omitted (open-ended). `fromDate` after `toDate` is a **400**
(`"fromDate must be on or before toDate"`), not an empty list. A malformed date is a 400 too.

Supplier filtering already existed (`supplierId`) and is unchanged.

A bill received across **several days** (same invoice, `confirmDuplicate`) is matched when **any** of
its receive-calls falls inside the range, and it is always returned with its **full** amount — the
range never slices a bill into a partial total.

### Payment summary (`stats`)

```json
"data": {
  "receipts": [ … ],
  "total": 12,
  "page": 1,
  "limit": 20,
  "stats": { "pendingAmount": 200, "paidAmount": 400, "totalAmount": 600 }
}
```

- `pendingAmount` — total **billed cost** of the **Not Paid** bills
- `paidAmount` — total **billed cost** of the **Paid** bills
- `totalAmount` — always exactly `pendingAmount + paidAmount`

**Billed cost, not MRP (changed 2026-09-02).** All three numbers — and `sortBy=amount` — are
`costPrice × quantity`, i.e. what is actually owed to / was paid the supplier. MRP is the retail
price the customer pays and has nothing to do with settling a bill; using it made "Pending ₹3,000"
mean nothing anybody could pay. Same formula and same null handling as the "Total cost (billed)"
figure the Verify Bill page already shows on a single receipt: a line with **no** cost price adds
**0** and is reported separately as `missingCostLines` on the row — never guessed from MRP.

Each list row now carries `totalCost` (billed) and `missingCostLines` **alongside** the existing
`totalMrp`, which is unchanged for any caller still reading it.

Example: 10 units bought at ₹50 and sold at ₹60 = **₹500** pending, not ₹600.

**The one rule that matters:** the stats follow every active filter (warehouse, supplier, search
`q`, date range) **except `paymentStatus`**. So when the admin filters the list to "Not Paid", the
list shows only unpaid bills but the three numbers still show pending **and** paid — otherwise the
paid figure would always read ₹0 the moment you filter, which defeats the point of showing them.

Amounts are always summed **per BILL**, never per ledger row, in both `view=aggregated` and
`view=individual` — one invoice received in three deliveries is counted **once**.

**Tests (green):** `packages/admin/__tests__/procurement-receipt-list-daterange-stats.test.js` (14)
and `packages/admin/__tests__/procurement-receipt-list-cost-basis.test.js` (11 — the cost-vs-MRP
proof, validator leniency and the whole-bill stats scope).

### ✅ How to check it by hand (curl / Postman, manager or staff token)
1. Receive a bill on the 31st of a month (late evening) and `…?toDate=<the 31st>` → ✅ the bill is
   **in** the list. ❌ If it's missing, the end-of-day is being cut at midnight — that's the classic bug.
2. `…?toDate=<the 30th>` → ✅ that bill is gone.
3. `…?fromDate=<the 31st>&toDate=<the 1st>` → ✅ **400**, not an empty list.
4. Two bills — one PAID with 10 units at **cost ₹50** (MRP ₹60), one UNPAID with 10 units at
   **cost ₹20** (MRP ₹300) → ✅ `stats` = `{ pending: 200, paid: 500, total: 700 }`.
   ❌ `{ pending: 3000, paid: 600 }` means the tiles are back on MRP — that's the bug.
5. Same call **plus** `paymentStatus=NOT_PAID` → ✅ list has 1 row, `total` is 1, but `stats` is
   **unchanged** (paid still 500). ❌ `paidAmount: 0` means the status filter leaked into the stats.
6. Add a date range that excludes the paid bill → ✅ `paidAmount` drops to 0 (dates **do** apply).
7. One invoice received twice (`confirmDuplicate`), ₹100 of cost each → ✅ `totalAmount` is **200**,
   not 400, in both `view=aggregated` and `view=individual`.
8. Change `page` / `limit` / `sortBy` → ✅ `stats` never changes.
9. `…?sortBy=amount&sortOrder=desc` on the two bills from step 4 → ✅ the **₹500 cost** bill is first,
   even though the other one has the bigger MRP. The row amounts must add up to the `totalAmount`
   tile — one basis, not two.
10. Same bill received in **August and September**, called with `view=individual&fromDate=<Aug 1>&
   toDate=<Aug 31>` → ✅ the row shows only the August event's amount while `stats` shows the
   **whole bill**. This is deliberate (a bill is owed as one invoice; the tiles must not change
   between the two views), not a bug.
11. Add a junk query param (`&_t=12345`) or send a cleared filter as an empty value
   (`&paymentStatus=&sortBy=&fromDate=`) → ✅ **200**, treated as "not sent". Only a non-empty junk
   value (`paymentStatus=PARTIAL`) is a 400.
12. `mark-paid` with `mode=CHEQUE` → ✅ 400 reading exactly `mode must be CASH, ONLINE or OWNER`
   (no `[CASH, ONLINE, OWNER, , null]` internals in the toast).

**Deploy needed:** backend redeploy + admin web deploy. Admin UI **built 2026-09-02** — see below.

---

## Follow-up (2026-09-02): ADMIN UI for filters / sort / summary / mode

All on **Warehouses → Verify Bill** (`haper-admin/src/pages/Warehouse/VerifyBillPage.tsx`,
`MarkAsPaidModal.tsx`). Nothing new on the backend — this is the UI for everything above.

The filter bar now reads: **Warehouse · Supplier · Payment · Received from · Received to ·
Search · Sort · View**. Three summary tiles (**Pending / Paid / Total**) sit between the filter
bar and the table.

### ✅ Payment filter
1. Set **Payment** to **Paid only** → ✅ only green-badged bills; the "Showing 1–n of N" count
   drops to the filtered N.
2. **Not Paid only** → ✅ only neutral-badged bills.
3. Back to **— Any status —** → ✅ everything returns.
4. ❌ If a filter change keeps you on page 3 of the old list, that's the bug — it must jump to
   page 1 (same as changing supplier or the search box).

### ✅ Date range
1. Pick **Received from** = the 1st and **Received to** = today → ✅ only bills received in
   that window (end date is inclusive to 23:59 IST — a bill received at 11pm on the To date
   must still be listed).
2. Leave one side blank → ✅ open-ended on that side.
3. Type a **From** date AFTER the **To** date → ✅ a red inline message appears under the
   filter bar (`fromDate must be on or before toDate — …`) and **no request is sent**; the
   list you were looking at stays on screen. Fix either date → ✅ the list reloads by itself.

### ✅ Sort
Options: **Newest first** (default) · Oldest first · Amount high-low · Amount low-high ·
Not Paid first · Paid first. Same "Sort: …" wording as the Orders and Items lists.
1. Amount high-low → ✅ the dearest bill is row 1.
2. Not Paid first → ✅ every neutral badge sits above the green ones.
3. Change sort → ✅ back to page 1.

### ✅ Summary tiles — the one rule that matters
1. With one ₹400 paid bill and one ₹200 unpaid: ✅ Pending **₹200.00**, Paid **₹400.00**,
   Total **₹600.00**.
2. Now set **Payment = Not Paid only** → ✅ the list shows 1 row, but the tiles are
   **unchanged** (Paid still ₹400.00).
   ❌ Paid dropping to ₹0.00 means the UI is adding up the visible rows instead of reading the
   server's `stats` — that's the bug.
3. Narrow the **date range** so the paid bill falls outside → ✅ Paid **does** drop to ₹0.00
   (dates apply to the tiles; only the payment filter is exempt).
4. Go to page 2 → ✅ tiles don't move.
5. Mark an unpaid ₹200 bill as paid → ✅ Expect: **Pending** drops by ₹200 and **Paid** increases
   by ₹200 immediately, with **no page reload needed**. ❌ If the tiles stay frozen at the old
   numbers until you reload or change a filter, that's a regression of the stats-refresh fix.

### ✅ Payment mode
1. **Mark paid** → the modal now has a third field, **Mode (optional)**, defaulting to
   **— Not stated —**. Choose **Online** → save → click the green badge → ✅ the popover shows
   a **Mode: Online** line.
2. Mark another bill with the mode left at **— Not stated —** → ✅ the popover shows **no**
   Mode line at all (not "Mode: —", and never a guessed "Cash").
3. Click a paid badge → **Edit** → ✅ the Mode dropdown is pre-filled with what was saved.
   Change it to **Owner** → save → ✅ the popover reports Owner.
4. **Unmark** a paid bill → ✅ confirm text says txn ID, paid-on time **and mode** will be
   cleared; after confirming the mode disappears with the rest.

### Notes / known gaps
- The tiles are **hidden entirely** (not shown as ₹0.00) if the backend hasn't been redeployed
  yet — an older build returns no `stats` object, and inventing ₹0.00 would be a lie.
- "Marked by" still shows the raw admin ObjectId (pre-existing gap, backend name-join pending).

## Deferred (NOT in this build)
