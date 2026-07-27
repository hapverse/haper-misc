# Test: Print Shelf Labels — barcode price labels (admin panel)

**Area:** Admin panel → **Catalog → Shelf Labels**, route **`/shelf-labels`** (`damin.haper.in` on dev)
**Who can see it:** **super admin** and **store admin** (store admin is **NEW** — it used to be
super-admin only). Everyone else has no menu entry and gets bounced off the route. 🚫 A
**warehouse manager is deliberately excluded** (decided **2026-07-26**) — see
[Who can open this page](#who-can-open-this-page-roles) below.
**Backend:** none new — reuses `GET /admin/item/catalog` and `GET /admin/item/catalog-summary`
(both need the `items.view` permission)
**Printer:** SEZNIK **Josh** 2-inch Bluetooth direct-thermal — **50 × 30 mm** label roll (the
default) **or 50 × 25 mm** label roll (**NEW**, see **50 × 25 mm thermal format** below). The two
rolls are **different physical stock** — never interchangeable.

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
   when the item has no `location` **or its location is the `Default Shelf` placeholder** (any
   case) — then the row is just MRP · SP. Applies to **both thermal labels** (50 × 30 mm and
   50 × 25 mm), the A4 sheet, and the Excel/CSV export alike.

There are **two ways** to get labels onto the printer, both on this one page, both working on the
**same selected set of items**:

- **Print path (rendered):** on-screen preview cards + a **Print** button. Print opens the browser's
  print dialog with **one label per page** at the **selected size** and real barcodes. From that
  dialog you either (a) pick the **SEZNIK printer** directly, or (b) choose **Save as PDF** and
  open that PDF in the SEZNIK app. **No extra PDF software needed** — the browser's Save-as-PDF does
  it.
- **Export path (Excel / CSV):** **Download .xlsx** and **Download .csv** buttons. One row per
  item, columns **Name · Shelf · Barcode · MRP · SP**. You import this into the SEZNIK app's
  **"Excel File Print"** feature, map the columns onto the label template, and print at whichever
  size the roll is. The export is **plain data — it carries no size at all** (see §T).

There are **four print formats** to choose from (**2. Review & print → Print format**): two thermal
roll sizes and two A4 densities.

| Print format | What it is | Media |
|---|---|---|
| **Individual — 50 × 30 mm** | One label per page, the original | SEZNIK Josh thermal roll, 50 × 30 stock — **the default** |
| **Individual — 50 × 25 mm** | One label per page, 5 mm shorter (**NEW**) | SEZNIK Josh thermal roll, 50 × 25 stock |
| **A4 sheet — 48/page** | 4 × 12 tiled, label 50 × 23.92 mm | A4 sticker/plain sheet |
| **A4 sheet — 44/page** | 4 × 11 tiled, a true 50 × 25 mm label | A4 sticker/plain sheet |

**Real example.** Super-admin picks the store **Haper Mart**, chooses **Active only**, sees
*"320 will print / export, 12 skipped (no barcode)"*, hits **`Print 320 labels — 50 × 30 mm`** (the
Print button spells out the size it will use), chooses **Save as PDF**, and opens the PDF in the
SEZNIK app to print the roll.

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
- **Latest change (format buttons lock while a run is building, 2026-07-27):** while **any** run
  is in flight (**Print**, **Download .xlsx**, **Download .csv**) all **four** Print-format buttons
  are **disabled**, and each run **pins the format that was selected when it was clicked** — so the
  screen can never advertise a format the running job is not building. The chooser stays **usable
  while the pre-flight counts load** (that builds nothing and risks no media). **Front-end only,
  `haper-admin`** (`ShelfLabelsPage.tsx`). **No backend change, no migration, no new env var, no
  new dependency.** On **`dev`** and **NOT deployed yet** — needs an admin build deployed to
  `damin.haper.in` (**user-manual** deploy) before you can test it. See **§V**.
- **Previous change (new 50 × 25 mm thermal format, 2026-07-26):** a **fourth** print format was
  added — **Individual — 50 × 25 mm**, a second thermal-roll size. **Front-end only, `haper-admin`**
  (`shelfLabelPrint.ts` + `ShelfLabelsPage.tsx`). **No backend change, no migration, no new env var,
  no new dependency.** Needs an admin build deployed to `damin.haper.in` (**user-manual** deploy)
  before you can test it. See **50 × 25 mm thermal format** below.
- **Earlier change (role opening):** the page was opened up from super-admin-only to
  **super admin + store admin**. A **warehouse manager** was briefly included and then
  **deliberately removed on 2026-07-26** — see
  [Who can open this page](#who-can-open-this-page-roles). **Front-end only, `haper-admin`** — two
  gates changed (the sidebar entry and the route guard). **No backend change, no migration, no new
  env var.** Needs an admin build deployed to `damin.haper.in` (**user-manual** deploy) before you
  can test it.

Source (for reference):
- Page: `haper-admin/src/pages/ShelfLabels/ShelfLabelsPage.tsx`.
- Print (Code 128 + print window): `haper-admin/src/utils/shelfLabelPrint.ts` — **one builder per
  format**, deliberately not shared: `buildShelfLabelsHtml` (50 × 30 mm),
  `buildShelfLabels50x25Html` (50 × 25 mm), `buildShelfLabelsA4Html` (48- / 44-up).
- Export (.xlsx / .csv): `haper-admin/src/utils/shelfLabelExport.ts`.
- Route guard: `haper-admin/src/App.tsx` — `/shelf-labels` now sits in its own
  `requireRole={['super_admin', 'store_admin']}` block (it used to be inside the super-admin-only
  block).
- Menu entry: `haper-admin/src/hooks/useMenu.ts` — Catalog section,
  `requireAnyRole: ['super_admin', 'store_admin']` (it used to be `superAdminOnly`).

---

## Who can open this page (roles)

The page used to be **super-admin only**. It is now also offered to **store admin** — and to a
store admin **only**. A **warehouse manager is deliberately kept out** (see the decision box
below). Two front-end gates control this — the **sidebar entry** (`src/hooks/useMenu.ts`) and the
**route guard** (`src/App.tsx`). Nothing changed on the API.

**Real example.** The Haper Mart store admin can now print her own shelf stickers herself,
instead of asking the super admin to do a label run for her store.

| Role | Sees the menu item | Can open `/shelf-labels` | Does the API actually serve them | Net result |
|---|---|---|---|---|
| `super_admin` | Yes | Yes | Yes — all stores, or one via the store switcher | **Fully works** (unchanged) |
| `store_admin` | **Yes (NEW)** | **Yes (NEW)** | Yes — **their own store only**. The backend pins them to their `storeId` and **403s** any request naming another store | **Fully works**, correctly scoped |
| `warehouse_manager` | **No** ❌ | **No** ❌ — bounces to `/` | **No — 403 anyway.** `items.view` is not in the warehouse-manager permission preset | **No access — on purpose** (decided 2026-07-26, see the box below) |
| `warehouse_staff` | No | No — bounces to `/` | No (403) | No access |
| `manager` | No | No — bounces to `/` | *Would* serve (it has `items.view`, scoped to its store) | No access — deliberately gated out in the UI |
| `support` | No | No — bounces to `/` | *Would* serve (it has `items.view`, scoped to its store) | No access — deliberately gated out in the UI |

### 🚫 DELIBERATE DECISION — `warehouse_manager` is excluded on purpose (2026-07-26)

> **Read this before you "fix" anything.** A warehouse manager was briefly given this page. On
> **2026-07-26** the role was **removed from both front-end gates**. This is a **considered
> product decision — NOT an oversight and NOT a bug**.
>
> **Why we took it out.** A warehouse account has **no store attached to it**. In the backend,
> "**no store selected**" means "**all stores**" for the item-catalog query. So the only way to
> make this page actually work for a warehouse manager would be to grant warehouse roles the
> **`items.view`** permission — and that would let them **list, print and export every store's
> catalog**, not just one store's. The backend says the same thing in its own code comment
> (`haper-backend/packages/admin/src/routes/warehouse/controller.js`): *"The store catalog
> endpoint is store-gated (items.view) and would leak other stores."* That risk is not worth
> taking for a page the role could not use anyway.
>
> **Real example.** Give the Chapra warehouse manager `items.view` and open the page: instead of
> one store's shelf list, the export would contain **Haper Mart's items and every other store's
> items too** — full names, barcodes, MRP and selling prices, downloadable as one .xlsx.
>
> **Hard rules until the real fix exists:**
> - ❌ **Do NOT re-add `warehouse_manager`** to this page's menu gate (`useMenu.ts`) or route
>   guard (`App.tsx`).
> - ❌ **Do NOT grant `items.view`** to `warehouse_manager` or `warehouse_staff`.
>
> **The real fix, for whoever picks this up later.** This is a **backend job, not a front-end
> one**: give warehouse roles a proper **server-validated store-selection context** — the
> warehouse user picks one store the warehouse actually serves, the **server checks** that choice
> and scopes the catalog to that single store. Once that exists, this decision can be revisited
> and the page reopened to warehouse roles safely.

### ✅ R1. Store admin — the new happy path
1. Log in to `damin.haper.in` as a **store admin**.
2. ✅ **Catalog → Shelf Labels** is now in the sidebar.
3. Click it → ✅ the page opens on **their own store** (a store admin has no "All Stores" option,
   so the store is already chosen) and the counts load.
4. ✅ Print + **Download .xlsx / .csv** work exactly as for a super admin, with **only their own
   store's** items, prices and barcodes.
5. ❌ They must never see another store's items — the backend rejects a request naming any other
   store with **403**.

### ❌ R2. Warehouse manager — must NOT get in
1. Log in to `damin.haper.in` as a **warehouse manager**.
2. ❌ There is **no Shelf Labels entry** under **Catalog** in the sidebar. (Their other pages —
   e.g. **Catalog → Product Master** — are still there, so you know the login itself is fine.)
3. ❌ Type `damin.haper.in/shelf-labels` in the address bar → you are **bounced straight back to
   the dashboard (`/`)**. The page must **not render even for a moment**.
4. This is **expected and deliberate** — see the decision box above. Do not raise it as a bug.

### ❌ R3. Roles that must still be locked out
Log in as each of **warehouse staff**, **manager**, **support**:
1. ❌ No **Shelf Labels** entry in the sidebar.
2. ❌ Typing `damin.haper.in/shelf-labels` in the address bar **bounces straight back to the
   dashboard (`/`)** — the page must not render even for a moment.

### ❌ R4. Regression — the five super-admin-only pages are STILL super-admin-only
`/shelf-labels` was **moved out of** the super-admin-only route block. The five routes left in that
block must be unaffected. **Log in as a store admin** and try each address by hand:

| Address to type | Expected |
|---|---|
| `damin.haper.in/profits` | ❌ bounced to `/` |
| `damin.haper.in/stores` | ❌ bounced to `/` |
| `damin.haper.in/store-admins` | ❌ bounced to `/` |
| `damin.haper.in/audit-log` | ❌ bounced to `/` |
| `damin.haper.in/maintenance` | ❌ bounced to `/` |

1. ❌ None of those five may render, and none may appear in the store admin's sidebar.
2. ✅ Log back in as **super admin** → all five still open normally.

> Covered by `haper-admin/src/hooks/useMenu.test.ts` (vitest) for the menu gate — including an
> explicit test that a **`warehouse_manager` does NOT see** the Shelf Labels entry.

---

## 0. Prerequisites (read once)

1. **Log in to `damin.haper.in`** as a **super admin** (or a **store admin** — see
   [Who can open this page](#who-can-open-this-page-roles)). The steps below are written for a
   super admin; a store admin sees the same page limited to their own store.
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
   print**, and a **Preview** grid. On a fresh load the preview heading reads **"Preview
   (50 × 30 mm)"** — the heading **names the selected format** and changes if you pick
   50 × 25 mm (see §O).

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
   Items page** to include them. (Super-admins / warehouse-managers can **auto-generate** an internal
   barcode for these from **Product Master** — a **different page**, which a warehouse manager *can*
   open — see **test-barcode-generation.md**.)
3. For **All / Active** scope the list shows the **first 100** skipped items (a footnote says so);
   for **Selected** scope it shows exactly the selected items that have no barcode.

### ✅ F. Preview matches what will print
1. Look at the **Preview** grid — WYSIWYG label cards at true size. The heading names the size you
   picked: **"Preview (50 × 30 mm)"** by default, **"Preview (50 × 25 mm)"** after you pick the
   25 mm format, and the cards themselves get 5 mm shorter.
2. **Expect** each card shows (all centered): name on top, a **full-width barcode** with the digits
   underneath, and the bottom row **<shelf> · MRP · SP** (shelf value before MRP, omitted when unset).
3. The preview shows the **first 50** labels only; if the run is bigger you'll see *"Showing first
   50 of 320 labels. Print / export includes all of them."* — the buttons still cover **all** items,
   the preview is just capped for speed.

### ✅ G. Print path → one 50 × 30 mm label per page
1. Click the **Print** button. Its text **names the size it will print** — e.g.
   **`Print 128 labels — 50 × 30 mm`** (it reads `Print labels — 50 × 30 mm` while the counts are
   still loading). Read that size before you click: it is your last check that the format matches
   the roll actually loaded in the printer.
2. **Expect:** a print window opens and the browser print dialog appears, with **one 50 × 30 mm
   label per page** and **real Code 128 bars** (matching the preview).
3. From the dialog either **pick the SEZNIK printer** or choose **Save as PDF** and open that PDF in
   the SEZNIK app. The printed label should **match the on-screen preview**.
> **Format:** the **Individual (50 × 30 mm)** format described here is the **default**. For the
> shorter thermal roll see **50 × 25 mm thermal format** below; to tile many labels on one **A4**
> page instead, see **A4 sheet format** below. There is only **one Print button** — it runs
> whichever of the four formats is selected.

### ✅ H. Export path → .xlsx and .csv for the SEZNIK "Excel File Print"
1. Click **Download .xlsx** (and **Download .csv**). Files download named like
   `shelf-labels-haper-mart-20260718.xlsx`.
2. Open the file and **Expect:** columns **Name · Shelf · Barcode · MRP · SP**, **one row per
   item**, and **skipped (no-barcode) items are absent**.
3. Shelf reads like **"A3"** (blank when the item has no `location`).
4. Import into the SEZNIK app's **Excel File Print**, map the columns onto the label template
   (name / shelf / barcode / MRP / SP), and print at whatever size your roll is — **50 × 30 mm** or
   **50 × 25 mm**.
5. The export is **the same file whatever Print format is selected** — it is data only, with no size
   in it. Switching format changes **only the Print button text and the preview** (see §T).

### ❌ I. Buttons are disabled when there's nothing to do
- While counts are still **loading**, or when **Will print / export = 0**, the **Print / Download**
  buttons are **disabled**. Selecting a scope with zero barcoded items (e.g. Selected mode with
  nothing ticked) leaves them disabled — expected, not a bug.

---

## A4 sheet format (tile many labels on one A4 page)

Besides the two one-label-per-page thermal rolls, you can print **many labels tiled on a normal A4 sheet**
— handy when you only have an office inkjet/laser printer and a sheet of sticker paper (or plain
paper you cut by hand). You pick this with the **Print format** control in **2. Review & print**; it
changes **only how the same labels are laid out**, not which items print.

**Real example.** Super-admin picks **Haper Mart**, **Active only** (say **90** barcoded items), sets
**Print format** to **A4 sheet — 48/page**, hits **`Print 90 labels — A4 48/page`**, and gets a
**2-page A4 print**:
page 1 has **48** labels (4 across × 12 down), page 2 has the remaining **42** labels filling from the
top-left, with **no blank page** after them.

### ✅ J. Picking the print format
1. In **2. Review & print**, find the **Print format** control (a small segmented control near the
   numbers). It has **four** choices, in this order — the two **thermal roll** sizes first, then the
   two **A4** densities:
   - **Individual · 50 × 30 mm** — the original one-label-per-page thermal format. **This is the
     default** and is **unchanged**.
   - **Individual · 50 × 25 mm** — the second thermal roll size (**NEW**) — see **50 × 25 mm
     thermal format** below.
   - **A4 sheet · 48 / page** — 4 columns × 12 rows = **48** labels per A4 page (label 50 × 23.92 mm).
   - **A4 sheet · 44 / page** — 4 columns × 11 rows = **44** labels per A4 page (a **true** 50 × 25 mm
     label, with tidier top/bottom margins).
2. Both thermal cards are titled **"Individual"** on screen; the small line under the title
   (**50 × 30 mm** / **50 × 25 mm**) is what tells them apart. The **selected card is highlighted**
   and the **Print button repeats the size** you picked.
3. Pick a format, then hit the **same Print button** — there is still **only one** Print button; it
   runs whichever format is selected.

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
1. Set **Print format** to **A4 sheet — 48/page**, hit the **Print** button (it now reads
   `Print <N> labels — A4 48/page`).
2. **Expect** the print preview to show a full A4 page with **48 labels** (4 across, 12 down) and
   **real scannable bars** with the **digits visible under each**.
3. Switch to **A4 sheet — 44/page** and print again: now **44 labels** (4 × 11) at a true 50 × 25 mm.
4. With more items than one sheet holds (e.g. **90** items at 48/page), you get **multiple A4 pages**;
   the **last page fills from the top-left** and there is **no trailing blank page** after it.
5. **Empty-barcode items are still skipped** here too — they never appear on any sheet and stay in
   the **Skipped (no barcode)** count.
6. The on-screen **Preview** grid still shows **50 × 30 mm cards** even when an A4 format is
   selected (heading: *"Preview (50 × 30 mm)"*) — the preview is a per-label WYSIWYG, **not** an A4
   page mock-up. That's **expected**. Only the **50 × 25 mm thermal** format changes the preview
   card.

### ❌ N. The individual 50 × 30 mm format is unchanged
- Leaving **Print format** on **Individual · 50 × 30 mm** (the default) prints **exactly as before**
  — one 50 × 30 mm label per page for the SEZNIK thermal roll. The A4 options and the new
  **50 × 25 mm** option are **purely additive**; they do **not** affect the 50 × 30 mm output, its
  preview card, or the .xlsx / .csv exports. Confirm this on paper with **§R**.

---

## 50 × 25 mm thermal format (the second roll size)

This whole section is **NEW** (2026-07-26). Some rolls on the market are **50 × 25 mm** instead of
50 × 30 mm. This format prints the **same label design on the shorter roll** — one label per page,
same SEZNIK Josh printer. It is a **second thermal option, not a replacement**: 50 × 30 mm stays the
default.

**Real example.** The Chapra store buys a box of **50 × 25 mm** rolls because that is what the local
supplier had. The store admin opens **Catalog → Shelf Labels**, picks **Active only**, sets
**Print format** to **Individual · 50 × 25 mm**, sees the button change to
**`Print 128 labels — 50 × 25 mm`**, and prints the run on the shorter roll — same names, same
barcodes, same prices.

**What is different on a 25 mm label (plain language).** The label is **5 mm shorter**, and almost
all of that came out of the **barcode height: 15 mm → 10.8 mm** (about 4.2 mm shorter bars).
**Everything else is the same** — product name, the digits under the bars, the shelf code, MRP, SP,
and every text size. 10.8 mm is still comfortably tall enough to scan; it is the **exact bar height
the A4 44-per-page format already prints today**, so it is not a new, untested size.

### ✅ O. Pick the 50 × 25 mm format
1. Open **Catalog → Shelf Labels** on `damin.haper.in`, pick a **specific store**.
2. In **2. Review & print → Print format**, the **second** card is **Individual** with
   **50 × 25 mm** underneath it. (Order is: Individual 50 × 30, Individual 50 × 25, A4 48/page,
   A4 44/page — **the two thermal sizes sit together**, then the two A4 ones.)
3. Click it. **Expect three things to change immediately:**
   - the card is **highlighted** as selected,
   - the **Print button now reads `Print <N> labels — 50 × 25 mm`** (e.g.
     `Print 128 labels — 50 × 25 mm`),
   - the **preview heading becomes "Preview (50 × 25 mm)"** and the preview cards get **visibly
     shorter**, with **shorter bars**.
4. ❌ Nothing else on the page may move: the **Will print / export** and **Skipped (no barcode)**
   numbers, the **View skipped** list, the scope picker and both **Download** buttons stay exactly
   as they were (see §T).

### ✅ P. What the 50 × 25 mm label shows
Same design, top to bottom, everything centered:
1. **Item name** — e.g. `Aashirvaad Atta`.
2. A **full-width barcode** with the **human-readable digits right under the bars** — e.g.
   `0801000012511`. The bars are **10.8 mm** tall here (15 mm on the 50 × 30 label).
3. The bottom row **<shelf> · MRP · SP** above a thin rule — e.g. `A3 · MRP ₹120 · SP ₹99`, MRP
   struck through only on a real discount, shelf cell omitted when the item has no `location` or it
   is the `Default Shelf` placeholder.

### ✅ Q. PRINT AND SCAN A REAL LABEL — do this before anyone uses this format

> **This step cannot be skipped and cannot be done on screen.** A screen preview cannot tell you
> that the ink really lands on the sticker, that nothing is cut off at the edge, or that the store's
> scanner reads shorter bars. **Print physical labels and scan them.** Everything below is a normal
> check, not a sign that anything is broken.

1. **Load 50 × 25 mm roll stock in the SEZNIK Josh** — and confirm it with your eyes, not from
   memory. This format needs the **shorter roll**. If your store only has 50 × 30 mm rolls, this
   format still prints, but it wastes ~5 mm of every label — use 50 × 30 mm instead.
2. **Check the printer driver's paper/stock size is 50 × 25.** Some thermal drivers **ignore** the
   page size the browser asks for and use their own loaded-media setting. If the driver is still set
   to 50 × 30, you get a **50 × 25 layout printed onto 50 × 30 stock with a blank strip** at the
   bottom — the browser will not warn you. Set the stock size in the driver / SEZNIK app first.
3. **Print a small batch first — 2 or 3 labels, never a full run.** Use **1. Choose what to print →
   Selected specific items** and tick just a couple of items.
4. **Put both a short and a long barcode in that test batch.** Pick one item with a **short code
   (e.g. 6 digits, `123456`)** and one with a **long 13-digit EAN (e.g. `8901030812345`)**. The
   **short code is the riskier one** — fewer bars stretched across the same width — so it must be in
   the test.
5. **Scan every test label with the store's actual handheld scanner** (the one the picker/POS uses —
   not a phone app):
   - **straight on**, then at a **slight angle**,
   - from a **few different distances** (close, normal, arm's length).
   - ❌ **Any single label that fails to read = do not roll this format out.** Report it before
     anyone prints a real run.
6. **Check the bottom rule is not clipped.** Look at the thin line above **MRP · SP** and at the
   price text under it — the **whole row must be on the label**, not running off the bottom edge.
   There is only about **0.7 mm of spare height** on a 25 mm label, so this is the first thing that
   goes wrong.
7. **Then print a longer run (30+ labels) and check the LAST label, not the first.** Thermal feed
   drift builds up as the roll unspools, so the first label can look perfect while label 30 has
   crept up or down. ✅ The last label must sit in the same place on its sticker as the first one.
8. ✅ Only after all of the above: use the format for a real shelf run.

### ✅ R. Regression — the 50 × 30 mm output has NOT changed
The 50 × 30 mm format is the one every store uses today, so this is the check people would most
regret skipping.
1. Set **Print format** back to **Individual · 50 × 30 mm** (or reload the page — it is the default).
2. **Print one label** on **50 × 30 mm roll stock**.
3. ✅ **Expect it to look exactly like the labels you printed before this change** — same name row,
   same bar height, same digits, same price row in the same place. Hold it next to an older label
   off the shelf and compare.
4. ✅ **Scan it** with the handheld — it must read exactly as it always did.

### ✅ S. The default is 50 × 30 mm and is NOT remembered between visits
1. Open the page fresh → ✅ **Print format is on Individual · 50 × 30 mm**, and the Print button says
   `— 50 × 30 mm`.
2. Switch to **Individual · 50 × 25 mm**, then **reload the page** (F5) → ✅ it is back on
   **50 × 30 mm**. Log out and back in → ✅ still 50 × 30 mm.
3. Same when you leave the page and come back (e.g. go to **Catalog → Items**, then back to
   **Shelf Labels**) → ✅ **50 × 30 mm**.

#### 🚫 DELIBERATE DECISION — the format choice is not remembered on purpose (2026-07-26)

> **Read this before you "fix" anything.** Not saving the last-used format is a **considered
> product decision — NOT an oversight and NOT a bug**.
>
> **Why.** Printing on a roll is **irreversible** — a wrong-size run wastes the stickers and the
> operator's time. Stores keep **50 × 30 mm** stock loaded. If the page remembered "50 × 25 mm" from
> someone else's session (or from your own experiment last week), the next person would load the
> page, glance at the counts, hit Print and quietly burn a 50 × 30 mm roll with 25 mm labels.
> Starting on 50 × 30 mm every single time means the **safe, common case needs no thought**, and the
> **Print button always spells out the size** for the one person who did choose something else.
>
> **Real example.** The store admin prints a 25 mm test batch on Monday. On Friday a different
> staff member opens the page to print 400 shelf labels on the normal 50 × 30 mm roll. Because the
> page always starts on 50 × 30 mm, she gets the right labels without knowing Monday happened.
>
> **Hard rules:**
> - ❌ **Do NOT persist the format** to `localStorage` / `sessionStorage`, a user preference or a
>   store setting.
> - ❌ **Do NOT change the default** away from **Individual · 50 × 30 mm**.
> - ❌ **Do NOT remove the size from the Print button text** — it is the last check before an
>   irreversible print.

### ✅ T. Format changes NOTHING except the button text and the preview
1. Note the two numbers — e.g. *"Will print / export **128**, Skipped (no barcode) **12**"*.
2. Click through **all four** formats (50 × 30, 50 × 25, A4 48/page, A4 44/page). ✅ **Both numbers
   stay identical** in every one, and **View skipped** lists the same items.
3. Download **.xlsx** and **.csv** on **50 × 30 mm**, then switch to **50 × 25 mm** and download
   them again. ✅ **The files are the same** — same filename pattern
   (`shelf-labels-haper-mart-20260726.xlsx`), same columns **Name · Shelf · Barcode · MRP · SP**,
   same rows. The export is **data only and carries no label size**; you choose the size later, in
   the SEZNIK app.

### ❌ U. The two "Individual" cards must be easy to tell apart
Both thermal cards are visibly titled **"Individual"**, so the size line is what distinguishes them.
1. ✅ On screen, the sub-label under each title reads **50 × 30 mm** and **50 × 25 mm**.
2. ❌ With a **screen reader** (VoiceOver on macOS: **Cmd + F5**, then Tab through the **Print
   format** group), the two buttons must be announced with **distinct names** —
   **"Individual (50×30 mm)"** and **"Individual (50×25 mm)"** — never as two identical
   "Individual" buttons. The group itself announces as **"Print format"**.
3. ❌ The selected one must announce as **pressed / selected**, so a non-sighted operator can tell
   which size is armed before printing.

### ❌ V. You cannot switch format while a run is already building (2026-07-27)

Clicking **Print** does not print straight away — the page first fetches the **whole catalog**,
100 items at a time, which on a big store takes **several seconds**. Until this fix the four
format cards stayed **clickable during that wait**, so an impatient operator could change the
format **after** the job had already started. The screen then showed one format while a
**different** one was actually being built.

**Real example of the old bug.** A **50 × 25 mm** roll is loaded. The operator picks
**Individual · 50 × 25 mm**, clicks **Print**, sees nothing happen for four seconds, so she clicks
**A4 sheet · 48/page**. The screen switches to A4 — the highlight moves and the button now reads
`Print 1,390 labels — A4 48/page` — but the run already in flight is still building the
**50 × 25 mm** job. She walks over to the A4 printer and the thermal job lands on the roll
instead. Roll stock and paper both wasted.

1. Pick a store with a **big catalog**, so the fetch genuinely takes a few seconds — e.g.
   **Haper Mart**, ≈**1,390** items. **This matters:** on a small store the run finishes before
   you can click anything and the test proves nothing.
2. Set **1. Choose what to print** to **All items** (the biggest, slowest set).
3. Set **Print format** to **Individual · 50 × 25 mm** and click **Print** — the button reads
   `Print 1,390 labels — 50 × 25 mm` and then shows a **spinner**.
4. **While the spinner is still turning**, try to click each of the other three cards —
   **Individual · 50 × 30 mm**, **A4 sheet · 48/page**, **A4 sheet · 44/page**.
5. ✅ **Expect all four cards to be visibly greyed out (dimmed)**, to show a **"not-allowed"
   cursor** on hover, and **clicking them to do nothing at all**:
   - the **highlight stays on Individual · 50 × 25 mm**,
   - the **Print button text does not change** — still `— 50 × 25 mm`,
   - the job that opens in the print window is the **50 × 25 mm** one you picked **before** you
     clicked Print.
6. ✅ The moment the run finishes (the print window and the browser print dialog appear), the four
   cards go **back to full colour and are clickable again**.
7. ❌ **Must NOT happen:** a mid-run click **switches the whole UI** — the highlight moves and the
   button becomes `Print 1,390 labels — A4 48/page` — while the run in flight keeps building the
   **50 × 25 mm thermal** job. The screen saying **A4** while a **roll** job prints is exactly what
   this step exists to catch.

**Same lock on the two exports — test these too.** Repeat steps 3–6 with **Download .xlsx**, then
again with **Download .csv**. ✅ The four format cards must grey out during those runs as well: the
lock is on **any** run in flight, not on Print only.

**The cards must come back even when the run ends badly.** ✅ Start a Print on the big store and
kill the network mid-fetch (**DevTools → Network → Offline**) → the toast reads *"Something went
wrong building the labels. Please try again."* and the **four cards must be clickable again**
immediately. Same if a run ends with nothing to print (toast *"No items with a barcode in this
selection."*). ❌ They must **never stay stuck greyed** — that would leave the operator unable to
change format without reloading the page.

**✅ The opposite case — while the counts are still "…", the chooser MUST still work.** Open the
page (or switch store / scope) so **Will print / export** and **Skipped (no barcode)** still read
**"…"**. ✅ In that moment the four format cards are **fully usable** — click **Individual ·
50 × 25 mm** and the highlight moves and the preview card changes, even though **Print** and both
**Download** buttons are greyed (that is §I, and it is correct). This is **deliberate**: loading
the counts builds **nothing** and risks **no media**, so the operator can line the format up with
the roll that is already in the printer while she waits. ❌ Format cards greyed out **while only
the counts are loading** **is** a bug — report it.

**Why this matters:** printing an **A4 sheet layout onto a 50 × 25 mm thermal roll wastes the
roll** (and a thermal job sent to the A4 printer wastes the sheet), so the format shown on screen
must always be the format actually being built.

> Covered by `haper-admin/src/pages/ShelfLabels/ShelfLabelsPage.test.tsx` (vitest) — the
> **"format chooser during an in-flight run"** block asserts that a run prints the format picked
> at click time, that all four buttons are disabled during a **Print** and during a **.csv** run,
> and that the chooser **stays usable** while the pre-flight counts are loading.

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
- The warning is about how **narrow** the bars get across the 50 mm width, so it is **the same on
  all four formats** — the 50 × 25 mm label has **shorter** bars, not thinner ones. It is also
  **the same count** whichever format is selected.

### ✅ Very large "All items" run → many pages, expect a short wait
- Selecting **All items** in a big store produces **many pages** (one label per page). The print
  window may take **a moment** to lay everything out before the dialog appears. Give it a few
  seconds; don't double-click Print.

### ❌ Pop-ups blocked → a toast tells you to allow them
- If the browser **blocks the print pop-up**, the Print button shows a toast: **"Allow pop-ups to
  print labels."** Allow pop-ups for `damin.haper.in` and click the **Print** button again. Same
  toast on every format.

### ✅ CSV-injection safety (name starting with `=`, `+`, `-`, or `@`)
- If an item name starts with `=`, `+`, `-`, or `@` (e.g. a promo name like `=SPECIAL`), the CSV
  export **prefixes it** so Excel opens it as **plain text**, not a live formula. The **.xlsx path
  is already safe** (values are written as data, not formulas). Numeric MRP / SP stay numbers.

---

## Backend / data notes (spot checks)

| Thing | Detail |
|---|---|
| **Endpoints used** | `GET /admin/item/catalog` (the item list, paginated, `limit` max **100**) and `GET /admin/item/catalog-summary` (the `totalItems` / `activeItems` counts). Both are **read-only** and existed before this feature. |
| **Permission** | Both endpoints require **`items.view`**. The **menu entry + route** are additionally gated to **super admin / store admin** (roles, not permissions). Warehouse roles have **no `items.view`** and are kept off the page on purpose — with no store attached, the catalog query would return **every** store: see [Who can open this page](#who-can-open-this-page-roles). |
| **Store scope** | The catalog + summary are scoped to the **active store** (the selector's store), so prices/barcodes/counts are that store's. |
| **Skipped count** | Comes from `catalog?missingBarcode=true` (`total`) for the chosen scope; **Will print = total − skipped**. |
| **Full set for print/export** | Pages the catalog **100 at a time** until exhausted, then filters out empty-barcode items — so a Print/Export always covers **every** matching item, not just the 50 previewed. |
| **Everything client-side** | Barcode rendering, PDF-via-browser, and the .xlsx / .csv are all built **in the browser** — no new server call for the labels themselves. |
| **Print format is UI-only** | The chosen format lives in **page state only** — it is never sent to the API, never saved to the user/store, and **never written to `localStorage`**. That is why every visit starts on **50 × 30 mm** (see §S). Each of the four formats has its **own builder** in `shelfLabelPrint.ts`; they share only the value helpers (barcode SVG, shelf, price formatting), so a change to one size **cannot** move another. |

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| **No "Shelf Labels" menu** at all | Your role isn't **super admin** or **store admin**. A **warehouse manager** is excluded **on purpose** — that is not a bug, see [Who can open this page](#who-can-open-this-page-roles). Otherwise the `haper-admin` build on `damin.haper.in` is behind (the role opening isn't deployed yet — a store admin used to be excluded). |
| Page shows **"Select a specific store first"** | The store selector is on **"All Stores"** — pick a specific store. (Only a **super admin** has an "All Stores" option; a store admin is always pinned to their own store, so they should never see this card.) |
| **Print / Download** buttons are greyed out | Counts still loading, or **Will print / export = 0** (nothing selected / nothing has a barcode in this scope). |
| The **four Print format cards** are greyed out and won't respond | A **Print / .xlsx / .csv run is still building** — by design, so the screen can't show one format while another prints. They come back the moment the run ends (including when it fails). If they are greyed while **only the counts** are still **"…"**, that **is** a bug — see §V. |
| Nothing happens on **Print** + a toast **"Allow pop-ups…"** | The browser blocked the print pop-up — allow pop-ups for `damin.haper.in` and retry. |
| Barcode **lost its leading zero** in Excel | You opened a plain CSV without the text-formula handling, or edited/re-saved the cell as a number. Use the provided **.xlsx**, or the **.csv** as exported (it wraps the barcode as text). |
| An item **isn't on any label** | It has **no barcode** — it's in the **Skipped** count and the **View skipped** list. Add a barcode on the **Items** page. |
| Label shows the **wrong shelf**, or no shelf at all | The shelf on the label is the item's `location`. Fix it on the **Items** page — the **Shelf** column is now **click-to-edit** (click the value, type e.g. `A3`, press Enter): see [`test-admin-ui.md` → Issue 11](./test-admin-ui.md). A `DefaultShelf1` / `Default Shelf` value prints as **no shelf** by design. |
| **"…too dense to scan reliably"** warning | The barcode value is long; bars are tight at 50 mm. Expected — **test-scan** one before a full run, or shorten the barcode. This is about bar **width**, so it reads the same on all four formats. |
| Printed 50 × 25 mm labels have a **blank strip** at the bottom, or the design sits high on the sticker | Either **50 × 30 mm roll stock is loaded**, or the **printer driver's stock size is still 50 × 30** and it ignored the page size the browser asked for. Load the 50 × 25 roll and set **50 × 25** in the driver / SEZNIK app — see §Q steps 1–2. |
| The **bottom price / shelf row is cut off** on a 50 × 25 mm label | A 25 mm label has only ~**0.7 mm** of spare height, so a driver margin or a wrong stock size eats it. Check the driver stock size (§Q step 2) and print with **margins = none / 0**. |
| **First labels are fine, later ones creep up or down** the sticker | Normal thermal **feed drift** on a roll — check the **last** label of a 30+ run, not the first (§Q step 7). If it drifts, re-seat the roll / re-run the printer's label calibration. |
| The **handheld won't read** a 50 × 25 mm label | Test straight-on and at a slight angle, at a few distances (§Q step 5). Try a **short** code (e.g. 6-digit) too — that is the harder case. If any label fails, **don't roll the format out**; report it. |
| I picked **50 × 25 mm**, came back later and it is on **50 × 30 mm** again | **By design** — the format is deliberately not remembered, so nobody prints the wrong size onto a loaded roll. See the decision box in §S. Not a bug. |
| Preview heading still says **(50 × 30 mm)** after I picked an **A4** format | **Expected.** The preview is a per-label WYSIWYG, not an A4 page mock-up; only the **50 × 25 mm thermal** format changes the preview card. See §M step 6. |
| I can't tell the **two "Individual" cards** apart | They are both titled "Individual" on purpose; the size line under the title (**50 × 30 mm** / **50 × 25 mm**) distinguishes them, and the **Print button repeats the selected size** (e.g. `Print 128 labels — 50 × 25 mm`). |
| **"Couldn't load the counts for this store"** + Retry | The catalog / summary endpoint didn't respond. Click **Retry**; if it persists, the API box is unreachable or a build behind. |
