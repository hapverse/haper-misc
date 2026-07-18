# Test: Print Shelf Labels — barcode price labels (admin panel, super-admin only)

**Area:** Admin panel → **Catalog → Shelf Labels**, route **`/shelf-labels`** (`damin.haper.in` on dev)
**Who can see it:** **super-admin only** (the menu entry is `superAdminOnly`; a store admin never sees it)
**Backend:** none new — reuses `GET /admin/item/catalog` and `GET /admin/item/catalog-summary`
(both need the `items.view` permission)
**Printer:** SEZNIK **Josh** 2-inch Bluetooth direct-thermal, **50 × 30 mm** label roll

## What this is (real example)

A shopkeeper needs a **barcode price sticker** for every shelf so the picker/POS can scan an item
and so the customer can read MRP and the selling price. This page turns catalog items into those
stickers.

Each label looks like this (top to bottom, **everything centered**):
1. **Item name**, centered — e.g. `Aashirvaad Atta`. (Pack size is **not** shown on the label.)
2. A **full-width Code 128 barcode** (the big middle element), with the **human-readable digits
   under the bars** — e.g. `0801000012511`.
3. A **bottom row**: the **shelf code** (the item's `location`, shown as **just the value, no label**)
   **before** MRP, then **MRP** (the item's `price`), then **SP** (the item's `sellingPrice`) — so
   the row reads **<shelf> · MRP · SP** (e.g. `A3 · MRP ₹120 · SP ₹99`). The shelf cell is omitted
   when the item has no `location` (then the row is just MRP · SP).

There are **two ways** to get labels onto the printer, both on this one page, both working on the
**same selected set of items**:

- **Print path (rendered):** on-screen 50 × 30 mm preview cards + a **Print labels** button. Print
  opens the browser's print dialog with **one 50 × 30 mm label per page** and real barcodes. From
  that dialog you either (a) pick the **SEZNIK printer** directly, or (b) choose **Save as PDF** and
  open that PDF in the SEZNIK app. **No extra PDF software needed** — the browser's Save-as-PDF does
  it.
- **Export path (Excel / CSV):** **Download .xlsx** and **Download .csv** buttons. One row per
  item, columns **Name · Shelf · Barcode · MRP · SP**. You import this into the SEZNIK app's
  **"Excel File Print"** feature, map the columns onto the label template, and print at 50 × 30 mm.

**Real example.** Super-admin picks the store **Haper Mart**, chooses **Active only**, sees
*"320 will print / export, 12 skipped (no barcode)"*, hits **Print labels**, chooses **Save as PDF**,
and opens the PDF in the SEZNIK app to print the roll.

---

## What deploy this needs

- **Frontend-only change in `haper-admin`.** It deploys to **`damin.haper.in`** (dev admin) when
  the admin app is built + deployed.
- **ZERO backend changes.** It reuses the existing catalog endpoints — nothing to deploy on the API,
  no DB migration, no schema change.
- **New FE dependencies:** `jsbarcode` (Code 128 rendering) and `xlsx` / SheetJS (Excel export) —
  both already in `haper-admin/package.json`.
- **SEZNIK side:** for the **Excel-import** path, the label layout (name on top, big barcode,
  MRP | SP cells) is arranged **once, inside the SEZNIK app**, then reused for every import. The
  **browser Print path already renders the full label** — nothing to set up there.
- **Session status:** the code is **ready for review — NOT committed/pushed yet**. It ships only
  after it lands on `dev` and the `haper-admin` build is deployed to `damin.haper.in`.

Source (for reference):
- Page: `haper-admin/src/pages/ShelfLabels/ShelfLabelsPage.tsx`.
- Print (Code 128 + print window): `haper-admin/src/utils/shelfLabelPrint.ts`.
- Export (.xlsx / .csv): `haper-admin/src/utils/shelfLabelExport.ts`.
- Route + menu: `haper-admin/src/App.tsx` (`/shelf-labels`), `haper-admin/src/hooks/useMenu.ts`
  (Catalog section, `superAdminOnly`).

---

## 0. Prerequisites (read once)

1. **Log in to `damin.haper.in` as a super-admin.** A store admin does **not** see the **Shelf
   Labels** menu at all (it's `superAdminOnly`).
2. **Pick a specific store** in the store selector at the top. Prices and barcodes are **per-store**,
   so a label run always applies to one store. On **"All Stores"** the page is **blocked** (see §A).
3. **Have some items with barcodes** in that store (so there's something to print). Items with no
   barcode are always skipped — useful for testing the skipped path, but you need at least a few
   *with* barcodes for the happy path.

---

## The walkthrough

### ✅ A. No store selected → the page blocks with a clear message
1. As super-admin, set the top store selector to **"All Stores"** and open **Catalog → Shelf Labels**.
2. **Expect:** a blocked card reading **"Select a specific store first"** with a hint that prices and
   barcodes are per-store.
3. There are **no Print / Export buttons** in this state — you can't accidentally run a label job
   with no store.

### ✅ B. Pick a store → the page works
1. Switch the selector to a **specific store** (e.g. **Haper Mart**).
2. **Expect:** the page loads with three sections — **1. Choose what to print**, **2. Review &
   print**, and a **Preview (50 × 30 mm)** grid.

### ✅ C. Scope picker has four modes
Under **1. Choose what to print**:
1. **All items** — every catalog item in this store.
2. **Active only** — only items with status **ACTIVE**. (This is the **default** on load.)
3. **In stock** — only items that are **ACTIVE _and_ have stock** (`quantity > 0`). An active item
   sitting at **0 stock is excluded**, and an inactive item with stock is excluded too. (Backed by
   the catalog filter `status=ACTIVE&stockState=instock`.)
4. **Selected specific items** — a **search-and-multi-select** picker: type in the search box, tick
   one or many items on the left; they collect in the **Selected** list on the right (remove with
   the trash icon, or **Clear all**).
- **Expect:** switching mode re-computes the counts and preview for that mode.

### ✅ D. Pre-flight summary (counts before you print)
1. In **2. Review & print**, look at the two numbers:
   - **Will print / export** — how many labels this run produces (green).
   - **Skipped (no barcode)** — how many items are being left out (red when > 0).
2. **Example:** *"Will print / export **40**, Skipped (no barcode) **12**"*.
3. When **Skipped > 0**, a **View skipped** button appears.

### ✅ E. "View skipped" lists exactly which items were left out
1. Click **View skipped**.
2. **Expect:** a modal **"Skipped — no barcode (N)"** listing each item (name + brand + pack size),
   with the note that they're **never printed or exported** and you should **add a barcode on the
   Items page** to include them.
3. For **All / Active** scope the list shows the **first 100** skipped items (a footnote says so);
   for **Selected** scope it shows exactly the selected items that have no barcode.

### ✅ F. Preview matches what will print
1. Look at the **Preview (50 × 30 mm)** grid — WYSIWYG label cards at true size.
2. **Expect** each card shows (all centered): name on top, a **full-width barcode** with the digits
   underneath, and the bottom row **<shelf> · MRP · SP** (shelf value before MRP, omitted when unset).
3. The preview shows the **first 50** labels only; if the run is bigger you'll see *"Showing first
   50 of 320 labels. Print / export includes all of them."* — the buttons still cover **all** items,
   the preview is just capped for speed.

### ✅ G. Print path → one 50 × 30 mm label per page
1. Click **Print labels**.
2. **Expect:** a print window opens and the browser print dialog appears, with **one 50 × 30 mm
   label per page** and **real Code 128 bars** (matching the preview).
3. From the dialog either **pick the SEZNIK printer** or choose **Save as PDF** and open that PDF in
   the SEZNIK app. The printed label should **match the on-screen preview**.
> **Format:** the **Individual (50 × 30 mm)** format described here is the **default**. To tile many
> labels on one **A4** page instead, use the **Print format** control — see **A4 sheet format** below.

### ✅ H. Export path → .xlsx and .csv for the SEZNIK "Excel File Print"
1. Click **Download .xlsx** (and **Download .csv**). Files download named like
   `shelf-labels-haper-mart-20260718.xlsx`.
2. Open the file and **Expect:** columns **Name · Shelf · Barcode · MRP · SP**, **one row per
   item**, and **skipped (no-barcode) items are absent**.
3. Shelf reads like **"A3"** (blank when the item has no `location`).
4. Import into the SEZNIK app's **Excel File Print**, map the columns onto the label template
   (name / shelf / barcode / MRP / SP), and print at 50 × 30 mm.

### ❌ I. Buttons are disabled when there's nothing to do
- While counts are still **loading**, or when **Will print / export = 0**, the **Print / Download**
  buttons are **disabled**. Selecting a scope with zero barcoded items (e.g. Selected mode with
  nothing ticked) leaves them disabled — expected, not a bug.

---

## A4 sheet format (tile many labels on one A4 page)

Besides the one-label-per-page thermal roll, you can print **many labels tiled on a normal A4 sheet**
— handy when you only have an office inkjet/laser printer and a sheet of sticker paper (or plain
paper you cut by hand). You pick this with the **Print format** control in **2. Review & print**; it
changes **only how the same labels are laid out**, not which items print.

**Real example.** Super-admin picks **Haper Mart**, **Active only** (say **90** barcoded items), sets
**Print format** to **A4 sheet — 48/page**, hits **Print labels**, and gets a **2-page A4 print**:
page 1 has **48** labels (4 across × 12 down), page 2 has the remaining **42** labels filling from the
top-left, with **no blank page** after them.

### ✅ J. Picking the print format
1. In **2. Review & print**, find the **Print format** control (a small segmented control near the
   numbers). It has three choices:
   - **Individual (50 × 30 mm)** — the original one-label-per-page thermal format. **This is the
     default** and is **unchanged**.
   - **A4 sheet — 48/page** — 4 columns × 12 rows = **48** labels per A4 page (label 50 × 23.92 mm).
   - **A4 sheet — 44/page** — 4 columns × 11 rows = **44** labels per A4 page (a **true** 50 × 25 mm
     label, with tidier top/bottom margins).
2. Pick a format, then hit the **same Print labels button** — there is still **only one** Print
   button; it runs whichever format is selected.

### ✅ K. 48 vs 44 — which to choose
- **48/page** packs more labels per sheet, but each is squeezed a hair under 25 mm tall
  (**50 × 23.92 mm**) so all 12 rows fit inside A4's 297 mm height (top/bottom margin ~5 mm).
- **44/page** gives a **true 50 × 25 mm** label with a clean ~**11 mm** top/bottom margin — fewer
  labels per sheet but exact size and neater edges.
- Both keep **4 columns × 50 mm = 200 mm across, with 5 mm on each side** and **no gap** between
  labels.

### ✅ L. What an A4 label shows (same design as the thermal label)
Each tiled label is the **same design** as the 50 × 30 mm one:
1. **Item name** on top, centered.
2. A **real full-width Code 128 barcode** (not a placeholder), with the **human-readable digits on
   their own line right under the bars** — e.g. `8901030812345`.
3. The bottom row **<shelf> · MRP · SP** — shelf value first (omitted when the item has no
   `location`), **MRP struck through only on a real discount**, and **SP** the big bold number.

### ✅ M. Verifying an A4 print
1. Set **Print format** to **A4 sheet — 48/page**, hit **Print labels**.
2. **Expect** the print preview to show a full A4 page with **48 labels** (4 across, 12 down) and
   **real scannable bars** with the **digits visible under each**.
3. Switch to **A4 sheet — 44/page** and print again: now **44 labels** (4 × 11) at a true 50 × 25 mm.
4. With more items than one sheet holds (e.g. **90** items at 48/page), you get **multiple A4 pages**;
   the **last page fills from the top-left** and there is **no trailing blank page** after it.
5. **Empty-barcode items are still skipped** here too — they never appear on any sheet and stay in
   the **Skipped (no barcode)** count.
6. The on-screen **Preview** grid still shows **50 × 30 mm cards** even when an A4 format is
   selected — the preview is a per-label WYSIWYG, **not** an A4 page mock-up. That's **expected**.

### ❌ N. The individual format is unchanged
- Leaving **Print format** on **Individual (50 × 30 mm)** (the default) prints **exactly as before**
  — one 50 × 30 mm label per page for the SEZNIK thermal roll. The A4 option is **purely additive**;
  it does **not** affect the thermal path, the preview grid, or the .xlsx / .csv exports.

---

## Edge cases to verify

### ✅ MRP vs SP — strike-through only on a real discount
- **`price > sellingPrice` (a discount):** the **MRP is shown struck-through**, and the **SP is the
  big bold number**. Example: MRP ~~₹120~~, SP **₹99**.
- **`price === sellingPrice` (no discount):** **both cells still render**, **no strike-through** —
  the row never collapses to a single price. Example: MRP ₹99, SP ₹99, neither struck out.

### ✅ Item with no barcode → excluded everywhere, counted as skipped
- A label with no barcode can't be scanned, so such items are **never printed or exported**. They:
  - are **counted** in the **Skipped (no barcode)** number,
  - appear in the **View skipped** list, and
  - are **absent** from the .xlsx / .csv rows.
- There is **no fallback** to any internal/SKU code — no barcode means no label.

### ✅ Leading-zero barcode is preserved as TEXT (does NOT become a number)
- Barcode **`0801000012511`** must stay **13 digits** in the export — it must **not** turn into the
  number `801000012511` (dropping the leading zero).
- **.xlsx:** the Barcode column is written as **text cells**, so Excel keeps the zero.
- **.csv:** each barcode is wrapped as an Excel **text-formula** (`="0801000012511"`) and the file
  has a **UTF-8 BOM**, so Excel opens it as text (and the ₹ sign / item names render correctly).
- **Check:** open both files, confirm the barcode column still shows the full string with its
  leading zero.

### ✅ Very long / dense barcode → still prints, but a warning shows
- A barcode with many characters **still renders**, but the bars may be **too dense to scan
  reliably** at 50 mm. The preview shows a small amber warning like *"N barcodes may be too dense to
  scan reliably at 50mm. They still print — test-scan one before a full run."*
- This is **expected behaviour**, not a bug. The rough safe limit is **~24 numeric / ~12
  alphanumeric** characters; beyond that you get the warning. **Test-scan one label** before a big run.

### ✅ Very large "All items" run → many pages, expect a short wait
- Selecting **All items** in a big store produces **many pages** (one label per page). The print
  window may take **a moment** to lay everything out before the dialog appears. Give it a few
  seconds; don't double-click Print.

### ❌ Pop-ups blocked → a toast tells you to allow them
- If the browser **blocks the print pop-up**, the Print button shows a toast: **"Allow pop-ups to
  print labels."** Allow pop-ups for `damin.haper.in` and click **Print labels** again.

### ✅ CSV-injection safety (name starting with `=`, `+`, `-`, or `@`)
- If an item name starts with `=`, `+`, `-`, or `@` (e.g. a promo name like `=SPECIAL`), the CSV
  export **prefixes it** so Excel opens it as **plain text**, not a live formula. The **.xlsx path
  is already safe** (values are written as data, not formulas). Numeric MRP / SP stay numbers.

---

## Backend / data notes (spot checks)

| Thing | Detail |
|---|---|
| **Endpoints used** | `GET /admin/item/catalog` (the item list, paginated, `limit` max **100**) and `GET /admin/item/catalog-summary` (the `totalItems` / `activeItems` counts). Both are **read-only** and existed before this feature. |
| **Permission** | Both endpoints require **`items.view`**. The **menu entry** is additionally gated to **super-admin**. |
| **Store scope** | The catalog + summary are scoped to the **active store** (the selector's store), so prices/barcodes/counts are that store's. |
| **Skipped count** | Comes from `catalog?missingBarcode=true` (`total`) for the chosen scope; **Will print = total − skipped**. |
| **Full set for print/export** | Pages the catalog **100 at a time** until exhausted, then filters out empty-barcode items — so a Print/Export always covers **every** matching item, not just the 50 previewed. |
| **Everything client-side** | Barcode rendering, PDF-via-browser, and the .xlsx / .csv are all built **in the browser** — no new server call for the labels themselves. |

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| **No "Shelf Labels" menu** at all | Your account is **not super-admin** (the entry is `superAdminOnly`), **or** the `haper-admin` build on `damin.haper.in` is behind (not deployed yet). |
| Page shows **"Select a specific store first"** | The store selector is on **"All Stores"** — pick a specific store. |
| **Print / Download** buttons are greyed out | Counts still loading, or **Will print / export = 0** (nothing selected / nothing has a barcode in this scope). |
| Nothing happens on **Print** + a toast **"Allow pop-ups…"** | The browser blocked the print pop-up — allow pop-ups for `damin.haper.in` and retry. |
| Barcode **lost its leading zero** in Excel | You opened a plain CSV without the text-formula handling, or edited/re-saved the cell as a number. Use the provided **.xlsx**, or the **.csv** as exported (it wraps the barcode as text). |
| An item **isn't on any label** | It has **no barcode** — it's in the **Skipped** count and the **View skipped** list. Add a barcode on the **Items** page. |
| **"…too dense to scan reliably"** warning | The barcode value is long; bars are tight at 50 mm. Expected — **test-scan** one before a full run, or shorten the barcode. |
| **"Couldn't load the counts for this store"** + Retry | The catalog / summary endpoint didn't respond. Click **Retry**; if it persists, the API box is unreachable or a build behind. |
