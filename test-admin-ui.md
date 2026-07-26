# Admin panel — cross-cutting UI behaviours (Test Guide)

Small, app-wide admin UI fixes that aren't tied to one feature area. Test against
**dev** (`damin.haper.in`) with any admin build that has the change deployed.
Each item says **what to do** and **what to expect** (✅ good / ❌ should not happen).

---

## Issue 7 — Mouse wheel must not change number-input values

> **Why:** a `<input type="number">` can have its value changed accidentally two
> ways: (a) the mouse **wheel** while focused (browser default), and (b) clicking
> the tiny **up/down spinner arrows**. Both nudge the value silently — e.g. an
> Item Quantity of `50` becoming `47`. Fixed globally, app-wide:
> - **Wheel:** a single document-level guard blurs the focused number input the
>   instant a wheel scroll starts, so the wheel only scrolls the page
>   (`haper-admin/src/utils/numberInputScrollGuard.ts`, installed in `main.tsx`).
> - **Spinner arrows:** hidden via global CSS (`index.css`, `appearance: textfield`
>   + `::-webkit-*-spin-button { -webkit-appearance: none }`) — there are no arrows
>   to click, and it also stops the spinner clipping narrow fields (e.g. Receive
>   Goods → Cost / piece). Typing + keyboard still work normally.

Test on **any** numeric field. Good coverage spots:
- **Items → Add/Edit item → Quantity** (the reported field).
- **Products → Assign to store → price / selling price / low-qty**.
- **Stores → Store modal → Minimum order value / Delivery charges / lat-long**.
- **Config → Settings** numeric fields.
- **Delivery Boys → Cash reconcile → amount**.

Steps:
1. Open a form with a number field. Type a value (e.g. Quantity `50`).
2. Leave the cursor **focused** in that field. Scroll the mouse wheel up/down.
3. ✅ The value **stays `50`** — it does not increment/decrement.
4. ✅ The **page still scrolls** normally (the field just loses focus on the first
   scroll notch). Click back into it to keep editing.
5. ✅ There are **no up/down arrows** on the field anymore — nothing to click that
   would change the value.
6. ✅ **Typing and keyboard** still work normally — only wheel + spinner are gone.
7. ✅ Text fields, dropdowns, and date fields are unaffected (they never had this).
8. ❌ At no point does scrolling over — or clicking within — a focused number field
   change its value on its own.

> Regression check: this is a passive, blur-only guard — it never calls
> `preventDefault`, so it can't block page scrolling anywhere. Covered by
> `src/utils/numberInputScrollGuard.test.ts` (vitest).

---

## Issue 8 — Shelf (location) column in Items list

**Where:** Items → Items Management table (`src/pages/Items/ItemsList.tsx`).
**Why:** pickers need each item's shelf location visible at a glance without opening
the item. The value is the item's `location` field (also editable via the item form's
"Shelf Location" input, e.g. `A3-B05`). The admin list API already returns `location`
(admin projection strips only `__v`/`createdAt`).

> **Updated:** this column is **no longer read-only**. Anyone with `items.edit` can now
> click the shelf value and change it right there in the row — see
> **[Issue 11](#issue-11--shelf-column-is-click-to-edit-in-the-items-list)** for those
> steps. The display checks below are unchanged and still apply.

Steps:
1. Open **Items**. The table columns are now: Item · Price · **Shelf** · Stock ·
   Status · Stock Value · Actions (Shelf sits directly after Price).
2. ✅ An item with a shelf set (e.g. `A3-B05`) shows it in monospace under **Shelf**.
3. ✅ An item with **no** shelf shows a muted `—` (never blank/`undefined`).
4. ✅ Editing an item's **Shelf Location** in the form and saving updates the value
   shown in this column after refresh.
5. ✅ Column counts line up — no header/cell misalignment (7 headers, 7 cells).
6. ❌ It must not show `null`/`undefined` or shift other columns.

---

## Issue 9 — Search items by iId + shelf (and product-master by iId)

**Where:** Items → search box; Product Master → search box.
Backend: `packages/shared/repositories/item.repository.js` (both search `$or` blocks) +
`product.repository.js` (already had iId).
**Why:** staff need to find a row by product identity (`iId`, e.g. `BI692052`) or shelf
code (`location`, e.g. `A3-B05`), not just name/brand/barcode. Both item search blocks now
include `iId` and `location`; barcode/name/brand/tags/category still match.

Steps:
1. ✅ **Items** — a full or partial **iId** (`BI692052`, `692052`) returns that item.
2. ✅ **Items** — a **shelf** code (`A3-B05`, `F1`) returns items on that shelf.
3. ✅ **Items** — barcode / name / brand still work (unchanged).
4. ✅ **Product Master** — an **iId** returns that master (already worked; placeholder now says so).
5. ✅ Placeholders: Items → "name, brand, barcode, iId, or shelf"; Products → "name, brand, barcode or iId".
6. ❌ Regression: empty search still returns the full list; existing name/barcode searches
   return the same rows (the change only *adds* `$or` branches).

## Issue 10 — Store "View details" (read-only, incl. _id)

**Where:** Stores Management (`/stores`) → each row's **Actions** → the new **eye** button.
Frontend only: `haper-admin/src/pages/Stores/StoreDetailsModal.tsx` (new) +
`StoresList.tsx` (the eye action + modal wiring). No backend change — uses the store object
already in the list.
**Why:** super-admin needs to see every stored field for a store at a glance — especially the
Mongo **`_id`** and other reference ids (`servingWarehouseId`, `ownerId`) for support/DB lookups —
without opening the edit form and risking an accidental change.

Steps:
1. ✅ Click the **eye** (View Details) icon on any store row → a read-only modal opens with the
   store name + ACTIVE/INACTIVE pill in the header.
2. ✅ **Identity** section shows the **Store ID** (`_id`) in monospace with a **copy** button →
   clicking it copies the id and toasts "Copied".
3. ✅ All fields render grouped: Identity, Contact (email/GSTIN copyable, map link opens in a new
   tab), Location & delivery area (coordinates as `lat, lng`, service-area, radius), Order & charges,
   Delivery incentives, Supply layer (serving-warehouse / owner ids, copyable), Villages (chips),
   Business hours (per day), and Image (thumbnail) — each shows **"—"** when empty.
4. ✅ It's **read-only** — no inputs, no save; **Close** (or the ✕) dismisses it. Edit/Delete
   actions are unchanged and still work.
5. ❌ Regression: opening details must not mutate the store; the list is unchanged after closing.

---

## Issue 11 — Shelf column is click-to-edit in the Items list

**Where:** Items (`/items`) → the **Shelf** column of the Items Management table.
Frontend only: `haper-admin/src/pages/Items/ShelfCell.tsx` (new cell),
`src/pages/Items/shelfEdit.ts` (the rules), wired into `ItemsList.tsx`.
**Why:** re-shelving an item used to mean opening the item's edit modal, changing
**Shelf Location**, saving, and losing your scroll position / search / page. Now you
click the shelf value in the row, type the new code, press **Enter** — done, without
leaving the list. The column is still backed by the item's **`location`** field.

**What deploy this needs**
- **`haper-admin` front-end only** — needs an admin build deployed to `damin.haper.in`
  (**user-manual** deploy, as always).
- **ZERO backend changes.** It reuses the existing `PUT /admin/item/:itemId` with a
  one-field body (`{ "location": "A3" }`). **No migration, no schema change, no new
  env var**, no new endpoint.

> **The one rule to remember.** Moving an item off a **real** shelf (e.g. `FRIDGE6`)
> asks you to confirm first. Moving it off **`DefaultShelf1`** (the "unassigned"
> placeholder) or off a **blank** shelf saves straight away — plenty of items sit
> there and nagging about them would be noise.

**Setup:** log in to `damin.haper.in` as someone with the **`items.edit`** permission
(super admin, store admin, or a manager), pick a store, open **Items**.

### ✅ A. Edit a shelf with no confirmation (placeholder or blank)
1. Find an item whose **Shelf** shows `DefaultShelf1` (or `—`, i.e. blank).
2. Hover the value — it turns into a link-ish underline with a small **pencil**.
3. Click it. The cell becomes a **text input** right in the row (no modal, no page
   change), with the old text pre-selected.
4. Type `A3` and press **Enter**.
5. ✅ It saves immediately — **no dialog** — a green toast says **"Shelf updated."**
   and the cell now reads `A3`.

### ✅ B. Edit a shelf that is REAL → it asks first
1. Find an item on a real shelf, e.g. **Amul Butter 500g** on `FRIDGE6`.
2. Click the value, type `A3`, press **Enter**.
3. ✅ A dialog titled **"Change shelf?"** appears, spelling out the actual move:
   *"Amul Butter 500g" is currently on shelf **FRIDGE6**. Move it to **A3**?*
4. Click **Cancel** → ✅ nothing is saved, the cell still shows `FRIDGE6`, and the
   **editor stays open with `A3` still typed** so you can retry or Escape out.
5. Press **Enter** again, then click **Change shelf** → ✅ saved, toast
   **"Shelf updated."**, cell reads `A3`.

### ✅ C. `default shelf` (with a space) counts as a REAL shelf
1. Put an item on the shelf literally spelled **`default shelf`** (a space in the
   middle). It saves and displays as `DEFAULT SHELF`.
2. Now change it to `A3` and press **Enter**.
3. ✅ You **DO** get the **"Change shelf?"** dialog. Only **`DefaultShelf1`**
   (no space) is the system placeholder; `default shelf` is treated as a normal,
   uniqueness-enforced shelf. This mirrors the backend exactly — do not "fix" it.

### ✅ D. Clearing a shelf is allowed
1. Click the shelf of an item on `A3`, **delete all the text**, press **Enter**.
2. ✅ The dialog reads *"…is currently on shelf **A3**. **Clear its shelf?**"*.
3. Click **Change shelf** → ✅ the cell now shows a muted **`—`**.
4. Doing the same on an item already on `DefaultShelf1`/blank → ✅ no dialog at all.

### ✅ E. Shelf codes are stored UPPERCASE
1. Click a shelf, type `a3` (lower case), press **Enter**.
2. ✅ The input itself uppercases as you type, and the saved/displayed value is `A3`.
3. **No-op case:** on a row that still shows legacy lower-case `a3`, type `A3` and
   press **Enter** → ✅ the editor just **closes**: no dialog, no toast, and **no
   network request at all** (the same letters = the same shelf). Same if you change
   nothing and press Enter.

### ✅ F. A shelf already in use is rejected (409)
1. Note an occupied shelf, e.g. `A3` currently holds **Amul Butter**.
2. On a **different** item, inline-edit its shelf to `A3` and confirm.
3. ✅ A red toast shows the **backend's own message**, word for word:
   *Shelf "A3" is already assigned to "Amul Butter". Each shelf can hold only one item.*
4. ✅ The cell **reverts to its old value** and the editor closes. Nothing was saved.
5. This is the **same rule** as the item edit form — see
   [`test-inventory.md` §14 Shelf (location) uniqueness](./test-inventory.md).

### ✅ G. Saving does NOT reload the list (this is deliberate)
1. Search for something, scroll down, go to page 2 — then inline-edit a shelf there.
2. ✅ After saving, your **search text, filters, page number and scroll position are
   all exactly where you left them**. Only that one cell changes.
3. ✅ **Expected, not a bug:** if you searched `FRIDGE` and then move that item to
   `A3`, the row **stays on screen** showing `A3` — it does not disappear under your
   cursor. It drops out of the results the next time you refresh or re-search.
4. Note the difference from the other row actions on this page — **delete**,
   **status toggle** and **popular toggle** DO refresh the list. Only the shelf edit
   keeps your place.

### ✅ H. Keyboard behaviour
1. **Enter** = save. **Escape** = cancel and revert (nothing sent).
2. ✅ **Clicking away does NOT save.** If you typed something and click elsewhere, the
   editor **stays open** with your text. (An untouched editor closes itself.)
3. ✅ When the editor closes — saved, cancelled or failed — focus goes back to **that
   row's shelf button**, so you can Tab/Enter your way down the list shelf by shelf.

### ✅ I. While a save is in flight
1. Confirm a shelf change and watch the cell.
2. ✅ The input is **disabled** and shows **"Saving…"** — you cannot type or
   double-submit by hitting Enter again.
3. ✅ You cannot open **another row's** shelf editor until this save finishes.
4. ✅ Once you have clicked **Change shelf**, the dialog's **Cancel / ✕ / Escape /
   click-outside stop working** until it finishes. That is on purpose: the write is
   already on its way, so the dialog will not pretend to cancel it.

### ❌ J. No `items.edit` permission → nothing to click
1. Log in as an account **without** `items.edit` (e.g. a support user) and open **Items**.
2. ❌ The Shelf column must look **exactly like the old read-only column**: plain
   monospace text, **no hover underline, no pencil icon, no cursor change**, and
   clicking it does nothing.

### ✅ K. Store scope
1. As **super admin** on **"All Stores"**, inline-edit a shelf → ✅ it still saves; the
   request carries that row's own store id.
2. As a **store admin**, you are hard-bound to your own store by the backend — you
   cannot reach another store's item at all.

> Covered by `src/pages/Items/shelfEdit.test.ts` (22) and
> `src/pages/Items/ShelfCell.test.tsx` (13), both vitest.

