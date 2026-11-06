# Admin: Retail / Wholesale view switch (Product master + Items)

Rule from the business owner: wholesale (B2B) and retail (B2C) products are never mixed in one list. Backend param: `wholesale=exclude` (default) or `wholesale=only`.

## 1. The control: two-option segmented switch
A segmented switch, not a checkbox chip. A checkbox says "filter on/off", so a mixed list still feels possible. A two-segment switch says "you are in one world or the other" and always shows which one.

- Labels (exact): `Retail` | `Wholesale`. Default: Retail.
- Sits as the FIRST control of the filter bar, left of search, on both screens. Same height as the other filter controls.
  - Products: first item in the flex row at ~line 177 (before the search box).
  - Items: first row of the Toolbar block (~line 574), on the same line as search (search keeps its 400px max width). It is NOT inside the 6-column select grid.
- Look: one rounded group (`--radius-md`, 1px `--border-color`, `--bg-secondary` track). Each segment: `0.55rem 0.9rem` padding, `0.82rem` weight 600 (same as the "Missing barcode only" chip).
  - Inactive: `--text-secondary` text, transparent.
  - Active Retail: `--accent-primary` border and text (same as the active chip pattern).
  - Active Wholesale: solid plum fill `#6B3FA6`, white text (7.27:1 in both themes, so the fill does not change with theme). Plum is the existing Haper Business colour; no new token, reuse the value already in the wholesale design.
  - Hover (inactive): text becomes `--text-primary`, 150ms.
  - Focus: 2px outline `--accent-primary`, 2px offset (use plum outline on the Wholesale segment).
  - Disabled (while the very first load is running): 50% opacity, `cursor: not-allowed`. Not disabled during refetches, only a pending state on the list.
- Keyboard and aria: container `role="radiogroup"` `aria-label="Product type"`; each segment `role="radio"` `aria-checked`. Roving tabindex: Tab enters the group once, Left/Right arrows move and select, Home/End jump. Each segment is at least 36px tall.
- A visible line under the page title also shows the view (see 3), so the state is not colour-only.

## 2. What happens on switch
- Page resets to 1. Scroll to top of the list (deferred, not built: the switch sits at the top of the list).
- Persist: search text, status, category, sub-category, sort, stock. Shelf does not persist: it switches to "All" in Wholesale view (pack and newly assigned wholesale rows have no shelf) and back to "With shelf" in Retail view and on Reset.
- Reset (to default): every toggle mode that does not apply.
  - Products "Missing barcode only": stays available in Wholesale view (the backend already drops packs from the missing-barcode query); it is turned off on switch.
  - Items toggle modes (expiring / low stock / missing cost / missing barcode / missing selling price / popular): keep them working in both views, including "missing barcode". Switching view turns all active modes off, so the user never lands on an empty list because of a leftover mode.
- Items `summary` header (the stat cards): it must follow the switch. Pass the same `wholesale` param to `catalog-summary`. If the backend cannot filter it at launch, do NOT show retail numbers under Wholesale: in Wholesale view replace the card grid with a single line `Totals are shown for Retail only.` (`--text-secondary`, 0.85rem). Never show unfiltered totals above a filtered list.
- Reset button on Items: resets the view back to Retail too (it is a full reset).

## 3. Row cue, title, empty states
- No per-row tag. The list is never mixed, so a tag adds noise.
- Page subtitle (Products, under "Product Master"): add a second short line after the existing sentence only in Wholesale view: `Showing wholesale products only.` Items: a small plum text line `Showing wholesale items only.` above the toolbar. Retail view shows no extra line.
- Empty states (when there are no filters or search active):
  - Products, Retail: `No products yet.`
  - Products, Wholesale: `No wholesale products yet. Add a pack from a product's size group or tick Wholesale-only on a product.`
  - Items, Retail: `No items found` / `Try adjusting your search query or add a new item.` (unchanged)
  - Items, Wholesale: `No wholesale items yet` / `Assign a wholesale product to this store from Product master to see it here.`
- Empty states with filters or search: keep the existing "match the filters" copy.

## 4. Remembered choice
Remember per screen, for the browser session only (`sessionStorage`, keys `products.view` and `items.view`). A new session always starts in Retail, so nobody lands on wholesale by accident. Page, search and other filters are not remembered (as today).

## 5. Search hints
Shown under the empty-result message, only when search text is present:
- Retail view: `Looking for a wholesale product? Switch to Wholesale.`
- Wholesale view: `Looking for a retail product? Switch to Retail.`
The word "Wholesale" / "Retail" in the hint is a text button (`--accent-primary`, underline on hover/focus) that does the switch and KEEPS the search text. It is announced with `role="status"` inside the empty state.

## 6. Responsive
- Products filter bar already wraps (`flex-wrap`): the switch is first, takes its natural width (~200px) and wraps to its own line on phones. Search stays `flex: 1; min-width: 220px`.
- Items: the 6-column grid is not changed. The switch + search row uses `flex-wrap`; below ~600px the switch goes on its own full-width line and each segment gets `flex: 1`.
- Segment labels never wrap (`white-space: nowrap`).

## 7. Notes for the engineer (do not redesign)
- Products Wholesale view: "Generate" barcode button and the "Barcode" column will show blank/dash for packs. Hide "Generate" for packs (barcode is blank by design), keep the column.
- Products: the "Size group" badge may be shown on pack rows; fine, leave it.
- Products: "Assign" must still work for packs. Check "Discontinue"/"Delete" copy does not say "retail".
- Items Wholesale view: low-stock / out-of-stock thresholds and the CP/SP margin cards were tuned for single units; check that "Pack of N" prices do not look like errors.
- Items: the "Popular" mode and "Sort: Popular" are based on customer orders; they may be empty for wholesale. That is fine; the empty state above covers it.
- Switching view must not clear the loaded `categories` list (do not refetch it).
- Any other place in these two screens that opens a product picker (assign dialogs) should also pass `wholesale=exclude` unless it is clearly a wholesale flow. Check callers before shipping.

## Test checklist
1. Open Products: Retail active, no pack or Wholesale-only product in the list.
2. Switch to Wholesale: page 1, only wholesale rows, "Missing barcode only" still there but unticked.
3. Reload tab: still Wholesale. Open in a new session: Retail.
4. Search a wholesale product name in Retail: empty + hint; click the link: lands in Wholesale with the search kept.
5. Items: same checks; summary cards follow the switch (or show the "Retail only" line).
6. Keyboard only: Tab to the switch, arrows change view, focus ring visible in dark and light.
