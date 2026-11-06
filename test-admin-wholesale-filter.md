# Test guide: Retail / Wholesale switch (Product master + Items)

Rule: retail (B2C) and wholesale (B2B) products are never shown mixed. Both screens have a "Retail | Wholesale" switch, default Retail. Test on dev: `damin.haper.in`. All names below are made up.

Example data: retail product "Sample Rice 1kg", its pack "Sample Rice 1kg - Pack of 10", and a wholesale-only product "Sample Oil 15L Tin".

## Product master
- ✅ Open Product master: "Retail" is selected. The list shows Sample Rice 1kg; it does NOT show the pack or Sample Oil 15L Tin.
- ✅ Click "Wholesale": page goes to 1; the list shows the pack and Sample Oil 15L Tin only; the line "Showing wholesale products only." appears; "Missing barcode only" is still there (unticked) and works.
- ✅ In Wholesale, a pack row has no "Generate" button. Edit / Barcode / Assign / Discontinue / Delete still work.
- ✅ Type "rice" in search, then switch view: the text "rice" stays and the status filter stays.
- ✅ Tick "Missing barcode only" in Retail, switch to Wholesale and back: the box is unticked again.
- ✅ Search "Sample Oil" in Retail: empty list plus "Looking for a wholesale product? Switch to Wholesale." Click "Wholesale": view changes, "Sample Oil" is still in the search box and the product shows.
- ✅ Same in Wholesale with "Sample Rice 1kg": hint says to switch to Retail.
- ✅ Empty wholesale list with no search: "No wholesale products yet. Add a pack from a product's size group or tick Wholesale-only on a product."
- ✅ Choose Wholesale, reload the tab: still Wholesale. Close the browser and open a new session: Retail.
- ✅ Keyboard: Tab to the switch (one stop), Left/Right arrows change view, Home/End jump, focus ring is visible.
- ❌ Any pack or wholesale-only product visible while Retail is selected is a bug. Any retail product visible in Wholesale is a bug.

## Items
- ✅ Retail by default: no pack or wholesale-only item in the list.
- ✅ Header totals (total items, low stock, CP/SP...) follow the switch: Wholesale totals match only the wholesale rows, never the retail numbers.
- ✅ Wholesale: line "Showing wholesale items only." shows above the toolbar; "Missing Barcode" button is still there and lists wholesale items without a barcode (packs are not listed); the Shelf filter switches to "All" (back to "With shelf" in Retail and on Reset); opening the tab already in Wholesale also starts with Shelf "All".
- ✅ Switch to Wholesale and back quickly while the list is loading: the final list always matches the selected view (no retail rows under Wholesale).
- ✅ Turn on "Low Stock" or "Popular", then switch view: the mode is off after the switch; search text stays.
- ✅ "Reset" returns to Retail and clears everything.
- ✅ Empty Wholesale list with default filters (Active, Shelf All, no search/category/stock/alert mode): "No wholesale items yet" / "Assign a wholesale product to this store from Product master to see it here."
- ✅ Same empty list with any narrowing filter (status Inactive, Shelf With/Without, category, search, an alert mode): the generic "No items found" copy shows instead, never "No wholesale items yet".
- ✅ Search hint and remembered choice work as on Product master (key is separate per screen: choosing Wholesale on Items does not change Product master).
- ✅ Look at pack prices and stock numbers in Wholesale: "Pack of 10" prices and the low-stock colouring should not look like errors (known open question, report anything odd).
- ✅ Phone width: the switch is on its own line and both buttons stretch.

## Other screens must not change
- ✅ Size group > add pack form still finds an existing pack by its product id (it calls the product list without the new option).
- ✅ POS new sale, warehouse item search, shelf labels, categories and inventory-group pickers behave as before.

## API checks (dev)
- ✅ `GET /admin/product?wholesale=exclude` has no wholesale-only products or packs; `?wholesale=only` has only those.
- ✅ Same for `GET /admin/item/catalog` and `GET /admin/item/catalog-summary` (the summary counts follow the same filter).
- ✅ No `wholesale` param returns everything (unchanged).
- ✅ `GET /admin/product?wholesale=banana` ignores the unknown value and returns everything (no validator on this endpoint).
- ✅ `GET /admin/item/catalog?wholesale=only&wholesale=exclude` (repeated param) returns 200 with the retail-only list. The server keeps the LAST value (`exclude`); the list is never mixed.
- ❌ `GET /admin/item/catalog` and `/admin/item/catalog-summary` with a junk or wrong-case value (`wholesale=yes`, `wholesale=Only`) or an empty value (`wholesale=`) are rejected with HTTP 403 and a message naming `wholesale`. Junk / wrong case: `"wholesale" must be one of [only, exclude]`. Empty: `"wholesale" is not allowed to be empty`. They are not ignored.
- ❌ The admin screens must never send a request without the param; check the network tab on both screens.

## Deploy needed
1. Backend first (the `wholesale` filter on the three endpoints).
2. Then haper-admin. Admin deployed before backend breaks the Items list: the old strict validator rejects the unknown `wholesale` key (403), so both the catalog and summary calls fail. Product master would only show mixed rows (no validator there).
No migration, no new env var, no mobile app change.
