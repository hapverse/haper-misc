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
the item. The value is the item's `location` field (edited via the item form's
"Shelf Location" input, e.g. `A3-B05`). Read-only column; the admin list API already
returns `location` (admin projection strips only `__v`/`createdAt`).

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

