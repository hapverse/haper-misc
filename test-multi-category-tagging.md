# Test: multi-category tagging — Phase 2 (admin-FE UI)

**Area:** Admin-only. haper-admin: `src/components/CategoryTaxonomyField.tsx` (new),
`src/components/categoryTaxonomy.ts` (new), `src/pages/Items/ItemModal.tsx`,
`src/pages/Products/ProductModal.tsx`.
haper-backend (already reviewed/tested, see `test-multi-category-items.md` — not
re-covered here): `packages/admin/src/middleware/taxonomy-input.js`,
`packages/admin/src/routes/items/*`, `packages/admin/src/routes/product/*`.
**PR/deploy:** haper-admin + haper-backend → `dev` (`damin.haper.in` / `dapi.haper.in`).
**Read first:** `test-multi-category-items.md` in this repo — it covers the `taxonomy`
field, the normaliser, and the admin API's validation/error contract in full. This doc
does **not** repeat that content; it only covers the new admin-FE UI built on top of it.

## What this is (and isn't)

An item or product master can now be tagged with up to 5 (category, sub-category) pairs
instead of exactly one, edited through a real UI in the item/product edit form. Row 1 is
always the **primary** — it's what the customer app, search and category tiles use today.

**Admin-only, still invisible to customers.** No customer-facing page reads the extra
pairs yet — that's Phase 3, not built. This UI only changes how an admin *tags* a
product; nothing about how a shopper *finds* one changes yet.

## Prerequisites

1. Dev admin (`damin.haper.in`) and dev API (`dapi.haper.in`) both on builds that
   include this change.
2. A super-admin login (item/product category editing is master-owned — see
   `test-multi-category-items.md` "Notes" — a store-admin needs a materialized/locked
   item for the last scenario below).
3. At least two active categories, each with at least two active sub-categories, to
   build non-duplicate pairs.

## Manual test steps (dev, admin UI)

### ✅ A. Add a second category
1. Open an existing item (or product master) for edit. It opens with exactly **one**
   row, labelled "Primary".
2. Click **"+ Add category"** → a second row appears, with a **"↑ Make primary"** link
   and a **×** remove button; the primary row has neither.
3. Pick a category + sub-category for row 2 (different pair from row 1).
4. Save → **200**. Re-open the item → both pairs are present, row 1 unchanged. ✅
   ❌ Fail if row 2 silently reuses row 1's category, or if saving drops it.

### ✅ B. Remove a category
1. On an item with 2+ pairs, click **×** on row 2 (or any non-primary row).
2. The row disappears immediately (no confirm dialog) and the row count/helper text
   updates.
3. Save → the removed pair is gone on re-open, the remaining pairs unchanged. ✅
   ❌ Fail if removing a row shifts the wrong row's error state — removing row 2 of 3
   must not carry row 3's inline error onto the new row 2 (this is index-shifting logic
   in the component, worth a specific look if it ever regresses).

### ✅ C. Promote row 2 to primary
1. On an item with 2+ pairs, click **"↑ Make primary"** under row 2.
2. Row 1 and row 2 **swap** — the old row 2's category/sub-category now show in the
   "Primary"-pilled row 1, and vice versa. Rows 3+ (if any) don't move.
3. Save → the item's `category`/`subCategory` (legacy single fields, still used
   elsewhere in admin/app) now show the promoted pair. ✅
   ❌ Fail if promotion duplicates the pair instead of swapping, or if a 3-pair item
   loses its 3rd pair on promotion.

### ✅ D. The 5-pair cap
1. Add rows until there are 5.
2. **"+ Add category"** is now disabled, and the helper text reads
   **"Maximum of 5 categories reached"** (it read "Up to 5 categories · N/5 used"
   below the cap). ✅
   ❌ Fail if a 6th row can still be added client-side — even if the server would also
   reject it, the button must be disabled at 5.

### ✅ E. Duplicate-pair inline error (client-side)
1. On an item with 2 rows, set row 2 to the **exact same** category **and**
   sub-category as row 1.
2. An inline error appears under row 2: *"This category + sub-category is already
   added in row 1."* The **Save** button is disabled while this error is showing.
3. Change row 2's sub-category to a **different** one under the **same** category
   (e.g. row 1 = Snacks/Chips, row 2 = Snacks/Namkeen) → the error clears and Save is
   enabled again. ✅ This is explicitly **allowed**, not a duplicate.
   ❌ Fail if same-category-different-sub-category is flagged as a duplicate, or if
   Save stays enabled while the true duplicate error is showing.

### ✅ F. Server-side validation error lands on the correct row — including row 0
This is the case that broke once during review: the backend puts the specific error
code in `reason`, not `errorType` (`errorType` is always the fixed literal
`"TAXONOMY_INVALID"`). If the FE ever reads `errorType` for the specific code instead
of `reason`, every row-mapped error silently falls back to a generic toast.
1. Pick a sub-category in a **non-primary** row (say row 2) that does **not** belong to
   its selected category — easiest way: pick category A, sub-category B in that row via
   the browser network tab / a raw API call bypassing the FE's own subcategory list (or
   coordinate with the backend suite's "Haldiram's Soanpapdi" fixture), OR simpler:
   deactivate a category that's currently selected in an item's sub-category slot and
   re-save unrelated fields — same server rejection.
2. Save. **Expect**: an inline error appears **under row 2**, worded as
   *"This sub-category doesn't belong to the selected category."* — **not** a top toast.
3. Repeat the same server-side condition on **row 1, the primary row**. Save.
   **Expect**: the inline error appears **under row 1**, not swallowed, not shown as a
   generic toast, and not confused with "no error". This is the specific regression to
   watch for — `details.index: 0` is a real, falsy-looking value and a `if (index)`
   check anywhere in the chain would silently drop row 0's error. ✅
   ❌ Fail if a row-0 server error shows nothing, or shows as a generic top-of-form
   toast instead of under row 1.
4. As a control, trigger a taxonomy error with **no row index** in the response (the
   over-5-pairs case, `TAXONOMY_TOO_MANY_PAIRS`, sent with `rowIndex: null`) →
   **expect a top-of-form toast**, "Only 5 categories allowed per product.", not an
   inline row error. ✅

### ✅ G. Backward compatibility — an admin who never touches the new UI
1. Open an existing single-category item. It opens showing **exactly one row** —
   no extra empty rows, no "+" fanfare, nothing visually different from before this
   shipped.
2. Change an unrelated field only (e.g. price) and Save, without touching the category
   row at all.
3. **Expect 200**, and the item's category/sub-category are unchanged. ✅
   ❌ Fail if an unrelated save silently drops a secondary pair the item already had
   (regression covered on the backend side too — see `test-multi-category-items.md`
   Phase 1 "Unrelated edit leaves taxonomy alone" — this step re-proves it end-to-end
   through the real form, not just the API).

### ✅ H. Store-admin locked/read-only view
1. Log in as a **store-admin** and open a **materialized item** (an item whose product
   master exists — the item form already shows this as "locked" for the legacy
   category fields).
2. The taxonomy field renders **read-only**: no "+ Add category" button, no "↑ Make
   primary" link, no **×** remove buttons on any row, and every category/sub-category
   dropdown in the field is disabled. ✅
   ❌ Fail if a store-admin can add, remove, or promote a row on a locked item — that
   would let a per-store edit silently diverge from the master, exactly the failure
   mode the existing locked-category behaviour already guards against.

## Edge cases worth checking

| Case | Expected |
|---|---|
| 74 items / 37 products with a pre-existing orphan (category, sub-category) pair — see `test-multi-category-items.md` "Notes / deliberate limits" | Still fully editable for **unrelated** fields (price, name, stock…) without touching that row. Re-saving the form re-sends the stored orphan pair verbatim — the backend exempts pairs identical to what's already stored, so this must save with **200**, not 400. ❌ Fail if opening/saving one of these items now throws a taxonomy 400 it never used to. |
| Editing an orphan-pair item's taxonomy row itself (changing that specific row to a *different*, still-invalid pair) | **400**, inline error under that row — the exemption only covers re-sending the SAME stored pair, not any further edit to it. |
| Product master with a materialized item on every store | A taxonomy change (add/remove/promote) on the master fans out to every store's item copy, same as the existing category fan-out. Spot-check one other store's item after saving the master. |
| Closing the modal without saving after adding/removing rows | No partial save — reopening the item shows the last **saved** state, not the mid-edit state. |
| Sub-category dropdown while its category's sub-categories are still loading | Shows "Loading…" and is disabled, not an empty/broken select — each row fetches its own category's sub-categories independently and caches by category id, so re-picking a category another row already used doesn't re-fetch. |

## Notes / deliberate limits

- **No customer-facing change.** Category tiles, drill-down, search — all still read
  the legacy single `category`/`subCategory` fields, unchanged. This is Phase 3.
- **The admin API contract (error codes, validation rules, exemption logic) is fully
  documented in `test-multi-category-items.md` Phase 2** and is not repeated here —
  this doc is scoped to the FE component and its wiring into the two edit forms.
- **`taxonomy` present in a save ⇒ authoritative**, same as the API contract: the FE
  always sends the full current row list (via `toTaxonomyPayload`), never a partial
  diff, so a save from this UI always replaces the whole array server-side.
