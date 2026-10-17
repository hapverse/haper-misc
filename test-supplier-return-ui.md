# Return to Supplier - admin UI test guide

UI steps for `haper-admin`. API-level steps live in `test-supplier-return.md` (backend). Merge this section into that file when it lands. All names/amounts below are made-up examples.

Needs: admin deployed from this change AND the supplier-returns API on the same environment (dev).
Logins: a warehouse manager, a warehouse staff, a store admin.

## Menu and access
- [ ] Manager and staff see **Supplier Returns** in the sidebar right after **Verify Bill**. Top-bar search "send back" / "credit note" finds it.
- [ ] Store admin login: no menu item; opening `/warehouse/supplier-returns` directly is bounced.
- [ ] Staff: list opens, rows open the detail, but NO New return / Record refund / Undo / Reopen / Cancel / Verify Bill "Return" / Recall "Return to supplier" anywhere.

## List
- [ ] First load shows skeleton rows, then rows. Tiles show Credit pending / Credit received for the warehouse (they do not change when you click a status chip; a caption says so).
- [ ] Chips: Credit pending, Credit received, No credit expected, Cancelled each narrow the table. Search by `SR000007` or a bill number (300 ms debounce). Changing any filter returns to page 1.
- [ ] Empty (new warehouse): "No supplier returns yet". Filtered to nothing: "No returns match these filters." + Clear filters.
- [ ] Turn off the network and reload: error card with Try again (never "no returns").
- [ ] Narrow window (320 px): table scrolls sideways inside its card, Return no. stays visible.

## New return
- [ ] Verify Bill row **Return**: form opens with warehouse, supplier and bill filled; bill items listed unticked. Tick one, pick a reason, **Review return**, **Confirm return**: success pane shows the new SR number.
- [ ] Recall page, a HOLD or RECALL warehouse lot with stock: **Return to supplier** opens the form with the lot, full qty and reason Recall. If the lot was received from exactly one supplier it is picked for you; otherwise pick the supplier. Then Review.
- [ ] List **New return**: pick supplier, type a product name or scan a barcode, item is added with the lot pre-picked, qty 1, credit = lot cost.
- [ ] Review with no reason: error next to the line, banner "Fix 1 thing to continue", **Jump to first** focuses it. Reason Other without a note is refused.
- [ ] Qty above the lot balance or the bill allowance is refused inline with the real numbers.
- [ ] Double-click **Confirm return**: only ONE return and one stock movement. Stop the network, confirm, then **Try again** after reconnecting: still one return.
- [ ] Open the form, change the warehouse lot-tracking flag in another tab, confirm: banner with **Reload lots**.
- [ ] Reserved stock: line shows "N of this product are promised to stores..." as a hint; the server decides.
- [ ] Close with items entered: "Discard this return? Nothing has been saved."
- [ ] After success: Stock Ledger shows **Returned to supplier** rows for the lots.

- [ ] Lost response: stop the network, **Confirm return**: the banner offers only **Try again** and **Close** (no **Back**). After reconnecting, Try again records it once. A 5xx/502 on confirm behaves the same.
- [ ] If the first attempt actually saved and a retry is refused (same key): the pane says "Return SRxxxxxx was already recorded. Your later changes were not saved.", the list refreshes behind it, and **View return** opens it. It must never say "nothing was saved".
- [ ] Set a credit per unit below the lot cost (or 0): amber line on the item, a required "Why is the credit lower than cost?" box appears; **Review return** is blocked until filled (max 500); the review pane repeats the reason. At or above cost: no box.
- [ ] Bill with more than 100 returnable items: **Select all** picks the first 100 and says why; more than 100 ticked individually is refused with how many to remove.
- [ ] Lost create response, then **Close** or Escape: the list behind refreshes, and the banner says "If you close, check the list before recording it again." Reopening **New return** after that must not be used to re-enter it before checking.
- [ ] On the "was already recorded" pane, Escape and the header X close the form (no hidden discard prompt).
- [ ] If the server rejects with "credit is lower than what we paid" although the form showed no reason box (lot cost changed since it loaded): the lot reloads, the "Why is the credit lower than cost?" box appears, and the retry sends the reason.
- [ ] Lot with no recorded cost: the credit price starts blank with "No cost was recorded...". Review is blocked until a price is typed. Typing 0 shows the box "You expect no credit — say why". The server error for a missing credit price reads "Enter the credit price for this item, or say why no credit is expected." (needs the backend CREDIT_PRICE_REQUIRED rule). A 500 "WRITE_FAILED" is treated like a lost response.
- [ ] A lot with no recorded cost shows a dash, never 0.00; a missing supplier name reads "the supplier", never "null".
- [ ] Recall prefill, then pick a supplier whose lot match is "other": the stale lot is dropped (auto-picked if only one lot remains, otherwise you choose).
- [ ] Verify Bill **Return** and Recall **Return to supplier** are hidden for roles other than super admin / warehouse manager, even with warehouse.manage.

## Refunds
- [ ] Row **Record refund** (or Detail): amount prefilled with what is still owed; date blank; no payment mode selected; **Save refund** disabled until date + mode (+ reference for Bank transfer / Credit note adjusted).
- [ ] Less than owed: return shows "Part received ₹X", button still available. Tick "Close this return" needs a note; return shows "Received · ₹X short" and **Reopen** appears.
- [ ] More than owed (typo 2160 for 216): amber line, Save stays disabled until the "supplier paid more" box is ticked and a note typed.
- [ ] Detail -> **Undo** on a refund needs a reason; the row greys with "Undone"; totals drop it.
- [ ] "Supplier won't give credit" only before any refund; **Reopen** undoes it.
- [ ] Network drops while saving a refund: the amount is cleared and the banner says "Your refund may already be recorded. Check the list above before saving again." A following "just updated" (stale) response keeps that warning and the amount empty, so the same money cannot be recorded twice.
- [ ] After that lost save, close the refund form and look at the return/list: it has reloaded and shows any refund that did go through. Reopen the form and save the same amount: if the server says "just updated", the amount is cleared and the banner asks you to check the recorded refunds first (no second Save is possible until you type the amount again).
- [ ] **Undo** on a refund recorded by someone else (or older than 24 hours) as a non-super-admin: "Only a super admin can undo this refund (recorded by someone else or older than 24 hours)."
- [ ] Return detail: the header X and Close do nothing while a save is in progress (same as Escape).
- [ ] Two admins on the same return: the second save shows "just updated by someone else. Showing the latest." and the latest figures load.

## Cancel
- [ ] With an active refund: **Cancel return** is disabled and the text "To cancel, first undo the recorded refunds." is visible.
- [ ] After undoing the refund (or when "No credit expected"): Cancel needs a reason; stock returns to the same lots; ledger shows "Supplier return cancelled".
- [ ] Wrong lot-tracking mode on cancel: clear message, nothing moved.

## Both themes
- [ ] Light and dark: chips (incl. Part received), greyed undone refund, error rows and skeletons are all readable.

## Known gap
- The shared `Modal` has no dialog role, Escape or focus trap. The new screens add Escape, Tab wrap and focus return themselves, but screen readers still do not get a dialog announcement. Fix needs an approved change to `Modal` for the whole Warehouse area.
- Verify Bill supplier-return badge and the "net payable" line are not built yet (needs the backend list fields).

## Deploy
- Admin web only (needs the supplier-returns backend live first). No mobile app involved.
