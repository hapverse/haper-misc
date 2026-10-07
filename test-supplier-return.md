# Return to Supplier - backend (API) test guide

Sending warehouse stock back to the supplier it came from, and tracking the money (refund / credit) the supplier owes for it.
Example: 12 packets of atta from lot `A-1` arrive damaged; the warehouse sends them back to "Sharma Traders" against bill `INV-0042`; the supplier owes 12 x ₹18 = ₹216 and later pays it in two parts.

UI steps: `test-supplier-return-ui.md` (admin web). All names and amounts below are made-up examples.

## Deploy needed
- **Admin API (haper-backend `packages/admin`) must deploy FIRST**, then the admin web. The web screens call `/admin/supplier-returns`; on an old API they get 404.
- No migration, no backfill, no new env var. New collection `supplier-returns` starts empty; its two unique indexes are built at API boot (watch the boot log: a `[supplier-returns] CRITICAL` line means an index is missing).
- No mobile app / picker / delivery / user API change.

## Who can do what
| Login | Read (list, detail, lots, bill context) | Write (create, refund, undo, no-credit, reopen, cancel) |
|---|---|---|
| Super admin | ✅ any warehouse | ✅ |
| Warehouse manager | ✅ own warehouse only | ✅ own warehouse only |
| Warehouse staff | ✅ own warehouse only | ❌ 403 |
| Store admin / manager / support | ❌ 403 | ❌ 403 |

## Create (POST /admin/supplier-returns)
Batch-tracked warehouse (lots on):
- ✅ Return 3 from lot A-1 and 2 from lot A-2 of the same product plus 4 of another product in one return. Lots drop by exactly those numbers, `qtyReceived` stays, Stock Ledger shows one **SUPPLIER_RETURN_OUT** row per lot (negative qty, return no. `SR000001` as reference, lot cost, supplier, reason).
- ✅ Credit per unit defaults to the lot cost; an explicit credit price (e.g. ₹21 instead of ₹22) is used for the expected credit.
- ✅ A lot on HOLD or RECALL can be returned; the sellable stock number (availableQty) does not change.
- ✅ A HOLD lot can be returned even when the product is already short of what is promised to stores.
- ❌ More than the lot holds -> 400 `INSUFFICIENT_LOT`, nothing moves (also earlier lines of the same request).
- ❌ Lot id from another warehouse / product -> 400 `LOT_NOT_FOUND`.
- ❌ Returning units that are promised to stores (on hand 16, promised 12, return 5) -> 400 `RESERVED` with available/reserved/free. Returning 4 works.
- ❌ Lot whose goods receipts were from other suppliers -> 400 `SUPPLIER_MISMATCH` (lists the lot's suppliers). A lot merged from two suppliers can go to either. A lot with no supplier on record can go to anyone. After a "correct supplier" on the receipt, the corrected supplier is the one that matches.
- ❌ Same product+lot twice -> 400 `DUPLICATE_LINE` (points at the 2nd line).
- ❌ Reason Other without a note -> 400 `VALIDATION` with `details.lineIndex`. A line with no reason at all -> same, nothing moves.
- ❌ Blank reason on cancel / refund undo, blank note on "No credit expected" -> 400 `VALIDATION`, nothing changes.
- ❌ Credit price below the lot cost (e.g. ₹15 for a ₹20 lot) or ₹0 without a note -> 400 `CREDIT_OVERRIDE_NOTE_REQUIRED` with `details.lineIndex`, nothing moves. ✅ Same with `creditOverrideNote` ("supplier pays ₹15 for dented tins") -> created; the note shows on the return and in the audit log (with each line's cost and credit price).
- ✅ No note needed when the credit price is left blank (uses the lot cost) or is at/above cost.
- ✅ Credit ₹0 (e.g. excess stock, credit price 0, with a note) -> created as "No credit expected".
- ❌ A lot with NO cost price (cost ₹0, e.g. old pre-lot stock) and no credit price typed -> 400 `CREDIT_PRICE_REQUIRED` (`details.lineIndex`, `sku`), nothing moves. ✅ Type a credit price (e.g. ₹7.50 -> credit ₹15 for 2) -> "Credit pending". ✅ Or leave it blank with a note -> created as "No credit expected". Same for warehouses without lots.
- ❌ A note made only of invisible characters (zero-width space copied from a chat) counts as blank everywhere a note/reason is required: Other reason note, below-cost note, settle note, undo/cancel reason, "No credit expected" note -> 400 like a blank one. Invisible characters around real text are removed (zero-width + "dented" + zero-width is saved as "dented").

Warehouse without lots (flag off):
- ✅ One line per product, taken from the stock total; cost = stock cost.
- ❌ Lot id sent -> 400 `VALIDATION`. More than on hand -> `INSUFFICIENT_STOCK`. Units promised to stores -> `RESERVED`.

Lot-tracking flag:
- ❌ Flag switched between opening the form and submitting -> 409 `BATCH_MODE_CHANGED`, nothing moves. Holds even in the first few seconds after the switch (the flag is re-read inside the save).

From a bill (invoiceNumber sent):
- ✅ `GET /bill-context?supplierId&invoiceNumber` shows per product billed / already returned / still returnable, the bill's unit cost and lot numbers. Invoice number is matched ignoring case and spaces.
- ❌ Product not on the bill -> `SKU_NOT_ON_BILL`. More than billed minus already returned -> `EXCEEDS_BILL` (billed, alreadyReturned, returnable). A cancelled return does not count.
- ❌ Lot that came in on a DIFFERENT bill (bill INV-A brought lot LA, you pick lot LB from INV-B) -> 400 `LOT_NOT_ON_BILL` (lists the bill's lot numbers; the message says "the bill brought lot LA" and to record the return without the bill if the lot was renamed). A `LEGACY` lot (stock from before lot tracking) is accepted only for bills received before lot tracking was switched on.
- ✅ Receipt corrections count: bill INV-A received 10, corrected to 4 -> bill context says billed 4, returning 5 -> `EXCEEDS_BILL` (billed 4), returning 4 works (credit 4 × cost). A correction made BEFORE the bill was received does not count against it. Same for warehouses without lots.
- ❌ Corrections UP never raise a bill's limit: bills INV-SA (10) and INV-SB (5) both went into lot SH; lot corrected to 25 -> INV-SA still billed 10 (returning 20 -> `EXCEEDS_BILL`, 10 works, credit 10 × cost), INV-SB still 5. Without lots: bill of 10, stock count corrected to 40 -> returning 35 or 11 against the bill -> `EXCEEDS_BILL` (billed 10).
- Known gap: a lot renamed through "Correct receipt" no longer matches its bill (`LOT_NOT_ON_BILL`) -> return it without picking the bill.
- Known gap: the bill limit is per product, not per lot — a bill with two lots of one product caps their total, not each lot (stock checks still apply).
- ❌ Two people returning against the same bill at the same moment, together over the bill -> exactly one succeeds.
- ❌ Unknown bill for that supplier -> 404 `BILL_NOT_FOUND`.

Double submit:
- ✅ Same request sent twice (double-click, retry after a network drop) -> ONE return; the second answer is 200 with `replayed: true`. Still a replay even if stock or the flag changed in between.
- ✅ Two identical requests at the same time -> one return.
- ❌ Same request id with a different body -> 422 `IDEMPOTENCY_KEY_REUSED`.
- ✅ Two different admins never collide (the id is per admin).

## Refunds and credit (all writes send `expectedRev`)
- ✅ ₹100 of ₹216 -> still "Credit pending" (shown as part received), shortfall ₹116. Second refund ₹116 -> "Credit received".
- ✅ Bank transfer / Credit note adjusted need a reference; cash does not. Date is required, never filled in by the server, not before 2020-01-01 and not after today (IST).
- ❌ More than owed (₹2,160 typed for ₹216) -> 400 `OVER_REFUND`. Allowed only with "supplier paid more" + a note (e.g. GST credited on top).
- ✅ "Close as settled" when short needs a note -> "Received", ₹X short shown.
- ✅ Undo a refund (reason required): entry stays, greyed as VOIDED; totals and status recomputed; undoing after a settle-short goes back to pending and the settle note is cleared.
- ❌ Warehouse manager undoing a refund recorded by someone else -> 403 `VOID_NEEDS_SUPER_ADMIN`. Same for their OWN cash refund recorded more than 24 hours ago. ✅ Their own recent refund, or an old bank / credit-note one, works; super admin can undo any.
- ✅ List filter `voidedRefunds=true` shows only returns that have an undone refund (for checking undo activity).
- ❌ "No credit expected" while a refund is active -> 409 `HAS_REFUNDS`; allowed after undoing it.
- ✅ Reopen: from "No credit expected" or from "settled short" -> pending. A fully received return is reopened by undoing a refund instead (reopen -> 409 `INVALID_STATE`).
- ❌ Old `expectedRev` (someone else saved first) -> 409 `STALE` with the current rev. Double-click "Save refund" -> exactly one refund.
- ✅ Warehouse without lots: several returns / cancels of the same product at the same moment all go through (no raw "Write conflict" 400); a loser that truly doesn't fit gets `INSUFFICIENT_STOCK` / `RESERVED`, a second cancel of the same return gets `STALE`.
- ❌ 21st refund entry (undone ones count) -> 409 `REFUND_LIMIT`.

## Cancel (POST /:id/cancel, reason required)
- ✅ Units go back into the SAME lots (even if a lot was renamed since), lot status kept (a HOLD lot stays HOLD), ledger shows **SUPPLIER_RETURN_REVERSAL** rows, stock totals match the lots.
- ❌ With an active refund -> 409 `HAS_REFUNDS`; allowed after undoing it. Allowed when "No credit expected".
- ❌ Twice -> `STALE` / `INVALID_STATE`; stock moves once.
- ❌ Lot-tracking flag switched since the return -> 409 `BATCH_MODE_CHANGED`, nothing moves (switch the flag back to cancel).
- ❌ The lot's received qty was corrected down so the units no longer fit -> 409 `LOT_RESTORE_CONFLICT`, nothing moves.

## Other screens touched
- ❌ Verify Bill -> change supplier on a bill that has live returns -> 409 `BILL_HAS_SUPPLIER_RETURNS` naming the SR numbers. ✅ Works again after those returns are cancelled; bills without returns unchanged.
- ✅ Verify Bill list (`/procurement/receipt/list`) rows carry `returnedUnits`, `returnCreditExpected` (no-credit-expected returns count 0), `returnCreditReceived`; all 0 when the bill has no live returns. Existing fields unchanged.
- ✅ A bill shown on two rows ("Individual" view, or old rows like `inv-1` / `INV-1`) shows its return totals on the FIRST row only; the other row shows 0 (so adding rows never double counts).
- ✅ If the return-totals read fails, the Verify Bill list still loads (totals 0, error logged on the server).
- ✅ Product barcode change moves the return lines to the new code; cancel afterwards still restores the right lot.
- ✅ Nightly warehouse reconcile shows no drift after create and after cancel.

## Edge cases / known gaps
- Return numbers can skip (e.g. SR000004 then SR000006) when a create fails after the number was taken. Cosmetic.
- A return created at the very moment someone changes that bill's supplier is not serialised against it (both sides only read). Very rare; fix by cancelling and re-creating the return.
- Error bodies: `{ code, error, message, errorType: "SUPPLIER_RETURN", reason, details }`; the web keys off `reason` + `details.lineIndex`. A database failure shows a fixed sentence (e.g. "Couldn't load supplier returns."), never the raw database message. On a save (create, refund, undo, no-credit, reopen, cancel) it is 500 `WRITE_FAILED` ("Couldn't create the return / save this change, please try again."); brief database hiccups are retried automatically first.
- Verify Bill list: a bill split across two list pages shows its return totals on its first row of EACH page (follow-up).

## Automated tests
`cd haper-backend/packages/admin && NODE_ENV=test npx jest --coverage=false __tests__/supplier-return-` (in-memory Mongo only).
