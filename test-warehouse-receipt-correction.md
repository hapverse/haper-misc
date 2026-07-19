# Test: Correct a PAST warehouse goods-receipt (admin panel)

**Area:** Admin panel → Warehouses → a warehouse → a stock row (Stock detail)
**Backend:** `POST /admin/procurement/receipt/correct` (`packages/admin/src/routes/procurement/*`)
**Permission:** `warehouse.manage` — a **warehouse manager** or **super admin** only. Warehouse
**staff** have `receive_goods` but NOT `manage`, so they can receive goods but can never rewrite a
past receipt (**403**).
**Deploy needed:** backend **redeploy** (new endpoint) + admin **web deploy**. **No DB migration.**
**Tests (green):** `packages/admin/__tests__/warehouse-receipt-correction.test.js` (backend),
`src/utils/money.test.ts` (admin, the 2dp helper).

---

## What this is (real example)

You accepted a delivery and keyed it in wrong — say **100 units of Amul milk** arrived but the
box really held **90**. Before, the only fix was to fake a write-off of 10 and re-receive, which
littered the ledger. Now a manager **opens the lot and corrects the past receipt directly**: set
**Received qty** to `90`, pick reason **Count correction**, Apply. On-hand drops by 10 and one
clean audit row explains why.

A correction can change any of: **received quantity** (up OR down), **expiry date**, **batch code**
(rename), and **cost / piece**. It is anchored on the **batch LOT** — the tuple
`(warehouseId, sku, batchNo)` — **not** a single invoice line. One lot can pool several deliveries
of the same batch, so you are always correcting **the whole lot total**, not one delivery.

**What the backend does (the honesty rules):**

1. The original **`PURCHASE_IN`** movement is **never** touched — the ledger is append-only.
2. A **quantity change** writes **exactly ONE** signed **`RECEIPT_CORRECTION`** movement.
   `100 → 90` writes **−10** (balanceAfter 90); `90 → 110` writes **+20**.
3. A **field-only edit** (cost / expiry / batch rename, with **no** qty change) writes **NO** ledger
   row. Instead it writes an **audit-log** record (`warehouse.receipt.correct`) **atomically inside
   the same DB transaction** — so a money edit can never commit without a trace (a failed audit
   write rolls the whole edit back).
4. **Cost is a PROSPECTIVE revaluation:** editing cost re-prices only the units **still in the lot**.
   Units already sold or transferred keep their booked cost — **no COGS restatement**.

**Request body:**
```json
{
  "warehouseId": "<optional; taken from the manager's own warehouse if omitted>",
  "sku": "PB001",
  "batchNo": "LOT-A",
  "corrections": {
    "receivedQty": 90,          // ABSOLUTE corrected total (int 0…1,000,000)
    "costPrice": 60,            // > 0, ≤ 10,000,000
    "expiresAt": "2026-12-31",  // ISO date, or null to clear
    "newBatchNo": "LOT-A2"      // rename (batch warehouses only)
  },
  "reason": "COUNT",            // COUNT | DATA_ENTRY | DAMAGE | OTHER
  "note": "recount at dock"     // optional, ≤ 500 chars
}
```
`corrections` must carry **at least one** field. `receivedQty` is the **absolute** corrected total
(not a delta). On a **legacy** (non-batch) warehouse send `batchNo: "LEGACY"`; only
`receivedQty / costPrice / expiresAt` apply (`newBatchNo` is ignored — legacy stock has no batch to
rename).

---

## Where it lives in the UI

Warehouses → pick a warehouse → **click a stock row** to open the **Stock detail** modal.

- **BATCH warehouses** (batch tracking ON): the **Batches (lots)** table gets a **Correct** button
  on each row. It opens the **Correct-receipt** modal prefilled from that lot.
- **LEGACY warehouses** (batch tracking OFF, no Batches table): a **"Correct receipt…"** button
  sits inside the write-off / adjust panel.

The **Correct** action (and the batch table's Actions column) is shown **only** to holders of
`warehouse.manage` — the manager and super admin. Store admins and warehouse staff never see it.

**Modal fields:** Received qty · Expiry · **Batch code** (batch mode only) · **Cost / piece (₹)** ·
**Reason** · Note. Reason labels map exactly to the four backend values:

| Label in the dropdown | Backend `reason` |
|---|---|
| Count correction | `COUNT` |
| Data-entry fix | `DATA_ENTRY` |
| Damage | `DAMAGE` |
| Other | `OTHER` |

The modal only sends the fields you **actually edited** (an untouched cost is never re-blended).
Apply pops a **confirm** dialog first; on success a toast reads
`Receipt corrected — on-hand now 90 (Δ -10).` and the detail + parent stock list refresh in place.
On any backend error the modal **stays open with your input intact**.

---

## Set-up

Use the **inventory** end-to-end guide (`test-inventory.md`) to stand up a warehouse with batch
tracking ON, then **Receive goods** for one SKU so there is a lot to correct — e.g. SKU `PB001`,
batch `LOT-A`, qty `100`, cost `₹50`. Log in as a **warehouse manager** (or super admin).

---

## Walkthrough (batch warehouse)

### 1. Happy path — raise the quantity
- ✅ Open the `PB001` / `LOT-A` lot → **Correct** → set **Received qty** `120` → reason
  **Count correction** → Apply → confirm.
- ✅ The lot's **Qty left** and the SKU's warehouse **Available** both rise by **20**.
- ✅ **Stock Ledger** (and Movement history) shows **one** `RECEIPT_CORRECTION` row of **+20** on
  batch `LOT-A`. The old `PURCHASE_IN` row is unchanged.

### 2. Happy path — lower the quantity (the Amul-milk case)
- ✅ Set **Received qty** `90` (from 100) → reason **Count correction** → Apply.
- ✅ Qty left and Available both **drop by 10**; one `RECEIPT_CORRECTION` row of **−10** appears
  (balanceAfter `90`). Toast: `on-hand now 90 (Δ -10)`.

### 3. Cost-only edit — no ledger row, audit written
- ✅ Edit only **Cost / piece** `50 → 60` (leave qty as-is) → Apply.
- ✅ The lot cost and the SKU's weighted-average roll-up cost update.
- ✅ **No** new ledger row is written (qty did not move).
- ✅ An **audit** record (`warehouse.receipt.correct`) captures the before/after cost. This write is
  **atomic** with the edit — a money change can never land untraced.

### 4. Expiry / batch-rename edit — field-only, audit-only
- ✅ Change **Expiry** to a new date and/or rename **Batch code** `LOT-A → LOT-A2` → Apply.
- ✅ The lot updates; the roll-up expiry re-derives (earliest open lot wins). **No** ledger row —
  captured in the audit log only.

### 5. Negative block — can't un-ship what already left
- ❌ First **dispatch or sell** part of the lot (say 30 units leave). Now try **Received qty** `20`
  (below the 30 already consumed) → **400**:
  *"Cannot lower received qty below 30 — 30 unit(s) have already left this lot."*
  The message **names the lowest allowed quantity**. Nothing is mutated.

### 6. Reserved block — can't strand a pending transfer
- ❌ Create a transfer that **reserves** some units of the lot (units committed, not yet dispatched).
  Try to lower **Received qty** so Available would fall **below** the reserved count → **400**:
  *"Cannot lower received qty — N unit(s) are reserved for pending transfers. Release them first."*
  The whole correction rolls back; stock untouched.

### 7. Rename collision — no silent merge
- ❌ Rename `LOT-A` to a **batch code that already exists** for that SKU → **400**:
  *"A batch with that number already exists for this SKU — pick a different batch number."*
  The two lots are **not** merged; the original lot is unchanged.

### 8. LEGACY-sentinel rename is rejected
- ❌ Rename a real lot **to** `LEGACY`, or rename **from** `LEGACY` to a real batch → **400**:
  *"Cannot rename to or from the LEGACY batch."* (The `LEGACY` sentinel holds pre-batch stock —
  renaming into or out of it would orphan or shadow real lots.)

### 9. Fully-consumed lot (Qty left = 0)
- ✅ On a lot with **0 remaining** (everything sold/transferred), a **cost / expiry edit** is
  **allowed** as a record-only fix — the closed lot's roll-up is unchanged (nothing left to
  revalue).
- ✅ A **qty-up** on a consumed lot **re-opens** it: received `50 → 60` ⇒ remaining `0 → 10`, one
  `RECEIPT_CORRECTION` row of **+10**.
- ❌ A **qty-down below the consumed count** is still blocked (**400**, negative block from step 5).

### 10. Permission — warehouse staff cannot correct
- ❌ Log in as a **warehouse staff** account. The **Correct** button does **not** appear.
- ❌ Call `POST /admin/procurement/receipt/correct` directly as staff → **403** (role passes the
  router gate, but staff lack the `warehouse.manage` permission).

### 11. Not-found and validation
- ❌ An unknown SKU / batch → **404**: *"No receipt lot found for SKU "…" (batch "…")."*
- ❌ Empty `corrections` (no field sent) → **400** (the modal blocks this first with
  *"Change at least one field to correct."*).
- ❌ `receivedQty` over **1,000,000** or `costPrice` over **10,000,000** → **400**, nothing mutated.

### 12. UI cues — pooled-lot warning + cost-revaluation note
- ✅ **Pooled-lot warning:** if the lot merged **more than one** receive, a yellow banner shows
  *"⚠ This lot pooled N deliveries — you are correcting the whole lot total, not one delivery."*
  (To see it: receive the **same** SKU + batch twice, then open Correct.)
- ✅ **Cost-revaluation note:** when you edit **Cost / piece** on a lot that has already shipped
  some units, a note appears under the field:
  *"X unit(s) already left this lot at the old cost; only Y remaining unit(s) are revalued."*
  This is the prospective-revaluation rule made visible — booked COGS on the sold units is never
  restated.

---

## Walkthrough (LEGACY / non-batch warehouse)

For a warehouse with **batch tracking OFF** there is no Batches table — stock is one flat total per
SKU. The **"Correct receipt…"** button lives in the write-off / adjust panel of the Stock detail.

- ✅ Correct the flat **received qty** (up or down), **cost**, or **expiry** for the SKU → the
  on-hand and cost update; a qty change still writes one `RECEIPT_CORRECTION` row.
- ✅ There is **no batch rename** field (legacy stock has no batch code).
- ❌ The same **reserved** guard applies: lowering below units reserved for a pending transfer →
  **400**, nothing mutated.

---

## Reading it back

- **Stock Ledger** page (`Warehouse → Stock Ledger`): the movement-type filter now includes
  **`RECEIPT_CORRECTION`** — pick it to list only corrections (with the batch, signed qty, and the
  running balance).
- **Audit log** (`warehouse.receipt.correct`): the durable trail for **field-only** edits (cost /
  expiry / rename) that leave no ledger row. Metadata carries the `reason`, `note`, `qtyDelta`, and
  the before/after of each changed field.

---

## 2-decimal cost precision (shipped in the same change)

Weighted-average cost is blended by division, so it used to store long float tails like
`7.30999999999180999`. Cost is now **rounded to 2 decimals (paise) at WRITE time, going forward** —
**no retroactive migration**. Existing rows **self-heal** the next time their lot is recomputed
(a receive, correction, sale, or transfer). Rounding happens on all **three** write paths:

1. **Warehouse roll-up** — `warehouse-stocks.costPrice` (in `recomputeRollup`).
2. **Warehouse batch merge** — `warehouse-batches.costPrice` (in `stockIn`).
3. **Store side** — `items.costPrice` / `store-batches.costPrice` (store `recomputeRollup` + `stockIn`
   merge).

The admin UI also **displays** all warehouse cost/pc at exactly 2 decimals via a shared
`formatMoney` helper (`src/utils/money.ts`) — e.g. `₹7.31`, not `₹7.30999999999…`; a missing/zero
cost renders as `—`.

> **Not affected:** the cost snapshot stored at sale time (`orders.items.costPrice`) that feeds
> COGS / profit reports is a **separate** value and this rounding does **not** touch it.

**Checklist** — receive the **same** SKU twice at costs whose weighted-average lands on a repeating
decimal (a blend that would produce e.g. `7.3099…`), then:
- ✅ **Stock table** (Stock detail header / list) → **Cost / piece** shows exactly **2 decimals**
  (e.g. `₹7.31`).
- ✅ **Batch rows** (Batches table) → each lot's **Cost / piece** shows 2 decimals.
- ✅ **Item Lookup** page → the item's cost / avg-cost shows 2 decimals.
- ✅ (Optional, dev DB read-only) `warehouse-stocks.costPrice` for that SKU is stored as `7.31`, not
  a long float.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `POST /admin/procurement/receipt/correct` 404s | Backend not redeployed — the endpoint is new this release |
| No **Correct** button on batch rows / no "Correct receipt…" on legacy | Logged in without `warehouse.manage` (store admin or warehouse **staff**), or admin web not deployed |
| Correct button present but API returns **403** | Warehouse **staff** account — `receive_goods` ≠ `manage`; only manager / super admin can correct |
| Cost still shows a long float tail | Admin web build behind (missing `formatMoney`), **or** that lot hasn't been recomputed since the fix (it self-heals on the next movement) |
| "Cannot lower received qty below N" on a qty-down | N units already left this lot (sold/transferred) — you cannot un-ship them; the message names the floor |
| Correction blocked by "…reserved for pending transfers" | Units are committed to a pending transfer — cancel/release it, then correct |
