# Admin panel — cross-cutting UI behaviours (Test Guide)

Small, app-wide admin UI fixes that aren't tied to one feature area. Test against
**dev** (`damin.haper.in`) with any admin build that has the change deployed.
Each item says **what to do** and **what to expect** (✅ good / ❌ should not happen).

---

## Issue 7 — Mouse wheel must not change number-input values

> **Why:** a focused `<input type="number">` treats the mouse wheel as an
> increment/decrement control (browser default). So if you typed a value, left
> the cursor in the field, and scrolled the page, the number silently changed —
> e.g. an Item Quantity of `50` becoming `47` after a scroll, unnoticed. Fixed
> globally: a single document-level wheel guard blurs the focused number input
> the instant a wheel scroll starts, so the wheel only scrolls the page.
> (`haper-admin/src/utils/numberInputScrollGuard.ts`, installed once in `main.tsx`.)

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
5. ✅ **Typing, arrow keys, and the field's own up/down spinners still work** — only
   the *wheel* is disabled, nothing else.
6. ✅ Text fields, dropdowns, and date fields are unaffected (they never had this).
7. ❌ At no point does scrolling over/inside a focused number field change its value.

> Regression check: this is a passive, blur-only guard — it never calls
> `preventDefault`, so it can't block page scrolling anywhere. Covered by
> `src/utils/numberInputScrollGuard.test.ts` (vitest).
