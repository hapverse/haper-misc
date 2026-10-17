# Verify Bill — search by invoice, barcode or item name

Backend: `GET /admin/procurement/receipt/list?q=...` (same `q` param as before, no new param).
`q` (trimmed, case-insensitive, literal text) matches the invoice number OR the barcode (sku) OR the
item name of any line on the bill, in the selected warehouse. Item name/barcode need 2+ characters;
invoice match works at any length. `q` is max 100 characters (101+ returns 400). Item lookup is capped at 200 matching SKUs (sorted by barcode); when the cap is hit the response carries `data.itemSearchTruncated: true` (field absent otherwise) so the UI can say "too many items match, refine your search".

Deploy: backend first, then admin (old admin keeps working; it just only types invoice numbers).

## Steps
1. Verify Bill, pick a warehouse. Type a full barcode of an item on a known bill. ✅ That bill (and every other bill with it) is listed, newest first.
2. Type part of an item name in lowercase / odd case ("sUNflow"). ✅ Same bills as the uppercase search.
3. Open a matched bill. ✅ Lines / units / cost shown are for the WHOLE bill, not just the searched item.
4. Type an invoice number (partial). ✅ Works as before.
5. Type something that exists nowhere ("zzzz"). ✅ Empty list, no error.
6. Type `.*`, `(`, `[a-z]+`. ✅ Treated as plain text, no error, no match-all.
7. Switch Aggregated / Individual with a search active. ✅ Aggregated = one row per bill; Individual = only the receive-calls that contain the item.
8. Page 2 with a search active. ✅ Continues the matched list; total is the matched count.
9. Payment tiles (pending / paid / total) with a search active. ✅ They cover the searched bills (whole-bill amounts), same as the invoice search does.
10. Search an item that was only received in another warehouse. ❌ Must NOT show here.

## Edge cases
- Search an overly broad word (200+ items match, e.g. one letter pair common to many names): `itemSearchTruncated: true` appears; invoice matches still work.
- Individual view + item search: a bill received in two calls shows only the call(s) containing the item, but the payment tiles still count the whole bill.
- One search word matching an invoice number on one bill AND an item name on another bill lists both bills.
- 1-character search: only invoice numbers match (item lookup needs 2+ chars).
- Item name comes from the warehouse stock record (current name), so a renamed item is found by its new name.
- Sorting / date range / payment filters combine with the search as before.

## Admin UI steps
11. Search box placeholder reads "Invoice, barcode or item name". ✅
12. Scan a barcode (fast typing + Enter). ✅ List filters immediately on Enter (no 350ms wait).
13. Type a single letter. ✅ Small hint "Type 2+ characters to search items" shows; it disappears at 2+ chars.
14. Search "zzzz". ✅ Message: No bills match "zzzz" in <warehouse>.
15. Clear the box. ✅ Full newest-first list returns.
16. Search a broad word that matches 200+ items (`itemSearchTruncated: true`). ✅ Small notice under the search box: "Many items match — type more of the barcode or name to narrow the bills." ❌ Notice must NOT show for a normal search, or after clearing the box.
