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
