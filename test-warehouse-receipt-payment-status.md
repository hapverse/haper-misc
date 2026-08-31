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
  "paidAt": "2026-08-20T10:30:00.000Z"    // optional ISO timestamp
}
```
Returns `{ msg, data: { warehouseId, supplierId, invoiceNumber, status, transactionId, paidAt,
markedPaidBy, markedPaidAt } }`. **Idempotent** — calling it twice (double-click, or two managers at
once) updates the same row; it never creates a second one and never errors.

`404` if that invoice + supplier was never received at this warehouse (stops a typo creating a
payment record no list will ever show). `400` if `supplierId` is missing — a bare invoice number is
not a bill key.

### `POST /admin/procurement/receipt/unmark-paid`
Body = the three key fields only. Returns `status: "NOT_PAID"`. A bill that was never marked is a
**no-op 200**, not a 404 (no row already MEANS not paid).

### `GET /admin/procurement/receipt/list` — 5 new fields per row
`paymentStatus` (`"NOT_PAID"` | `"PAID"`), `transactionId`, `paidAt`, `markedPaidBy`, `markedPaidAt`.
All nullable and **additive** — every field the page used before is unchanged, and an unmarked bill
reports `"NOT_PAID"` with nulls without any row existing.

---

## Walkthrough

### ✅ Happy path — mark a bill paid
1. Log in as **super admin** (or a warehouse manager). Warehouses → **Verify Bill**.
2. Pick any received bill. Badge reads a neutral **Not Paid**.
3. Click **Mark paid** → modal opens with **Transaction ID** and **Paid on** both **blank**.
4. Type `UTR12345`, pick yesterday 10:30, **Mark as Paid**.
5. ✅ Badge turns green **Paid**. Reload the page — it is still Paid.
6. Click the green badge → popover shows the transaction ID, the paid-on time, and who marked it.

### ✅ Both optional boxes left blank
1. Mark a different bill paid **without** typing anything.
2. ✅ The button is **not disabled**; the mark succeeds; badge goes green.
3. ✅ The popover shows **no** transaction ID and **no** paid-on time — the server must NOT have
   filled in "now". (❌ If paid-on shows today's date/time you never typed, that's the bug.)

### ✅ One bill, two deliveries → one badge
1. Receive invoice `MULTI-1` from supplier A. Receive it **again** (confirm the duplicate warning).
2. Mark `MULTI-1` paid once.
3. ✅ In the default (aggregated) list the single row is Paid.
4. ✅ Switch to the **individual** view — **both** receive-actions show **Paid**, same transaction ID.

### ✅ Unmark preserves history
1. On a Paid bill click the badge → **Unmark** → confirm.
2. ✅ Badge returns to **Not Paid**.
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

## Deferred (NOT in this build)
- A **Paid / Not Paid list filter**.
- Any **amount / payable value** field — status only, deliberately: a second number for "what we owe"
  would compete with the bill itself as the source of truth.
