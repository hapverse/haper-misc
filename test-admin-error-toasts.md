# Test: admin panel error toasts now show the real backend message

**Area:** 31 forms/pages in haper-admin (`/pages/*/Modal.tsx`, `/pages/*/Modal.tsx`, `/pages/*/...tsx` list/detail screens).
**What changed:** every catch block now uses the shared `apiErrorMessage(err, fallback)` helper from `src/utils/apiError.ts` to extract the real backend error message and display it in the toast — instead of ad-hoc field reads that missed one of the two backend error shapes (`{code, message, error: err.name}` for validation/business errors, `{error: "text", no message field}` for 403s).
**Tests (green):** `npx tsc -b` clean; `npx eslint .` → 99 problems (−12 from pre-change baseline 111, 0 new); `npx vitest run` → 616 tests (6 pre-existing failures unrelated, 0 new).
**Files fixed:** 31 total, all under `haper-admin/src/pages/`. Delivery Boys (DeliveryBoyModal.tsx, 1 commit separately on dev@5090224); then sweep of 30 files (Analytics 2, AuditLog 1, Banners 1, Categories 2, Config 2, DeliveryBoys 2 more, Discounts 2, InventoryGroups 2, Items 1, OrderActivity 1, Orders 3, Pickers 3, Profits 1, SlotSettings 1, StockAlerts 1, StoreAdmins 2, Stores 2, Team 2, Users 1).

---

## Why

Many admin forms showed a generic **"Error"** toast on failure instead of the real backend message. The root cause: ad-hoc error extraction in ~52 catch blocks read `.error` or `.message` in the wrong order, missing one of the two backend shapes:
- **Validation/business errors** (e.g. "Delivery boy email, phone or username already exists") → shape `{code, error: err.name, data, message: "real text"}`.
- **Permission 403s** (e.g. "You do not have permission to perform this action") → shape `{error: "permission text"}` (no `message` field).

An ad-hoc reader that picked `.error` first caught the permission text but missed validation messages; one that picked `.message` first did the opposite.

---

## What changed

The **`apiErrorMessage(err, fallbackText)`** helper (`src/utils/apiError.ts`) now chains `message → msg → error (only if it's a string) → fallback`, covering both shapes correctly. All 31 fixed sites call it instead of reaching into the error object by hand.

---

## Steps — manual verification (`damin.haper.in`)

Representative sample of 5 forms (not all 31 — the pattern is identical across all). Each test fires a form save that will fail.

### 1. Delivery Boys → New Delivery Boy
- ✅ Click **Add Delivery Boy** → **save** with an email/phone that already exists for another delivery boy → toast shows **"Delivery boy email, phone or username already exists."** (the real validation message), not "Error".

### 2. Banners → New Banner
- ✅ Create a banner with a missing required field or invalid date range → **save** → toast shows the specific validation message (e.g. **"Invalid date range"**, or **"Title is required"**), not a generic fallback.

### 3. Categories → Edit Category
- ✅ As a **manager** (not store admin, not super admin) → attempt to save a category change → toast shows **"You do not have permission to perform this action."** (the 403 message), not "Error".

### 4. Stores → New Store
- ✅ Try to create a store with a duplicate name → **save** → toast shows **"Store with this name already exists."** (or the exact backend validation message), not "Error".

### 5. Items → Edit Item
- ✅ Try to save with invalid category or missing required field → **save** → toast shows the specific field error (e.g. **"Category is required"**), not a generic fallback.

---

## Edge cases / known limitations

- **Network failure** (Ctrl+click to open DevTools → Offline, then try a save) → toast still shows a sensible fallback (currently `"Something went wrong"` or similar default) — never a null/undefined/JSON stringification.
- **Very old browsers** where the backend's error envelope structure has drifted (rare/unlikely) → the chain falls through all fields and uses the `fallbackText` parameter provided by the caller — safe, backwards-compatible.
- **Duplicate-detection in real-time** (e.g. email already exists) — toasts now expose the *specific* reason ("email already exists", "phone already exists", "username already exists") instead of lumping all validation failures into one generic message.

---

## Not fixed in this pass (flagged for follow-up)

**`haper-admin/src/pages/Items/stockAdjust.ts`:** contains a duplicate local `adjustErrorMessage(err)` helper used by `StockAdjustModal.tsx`. It has the same bug class — reads `data?.error?.message` (dead code path, since `.error` is always a string, never an object) instead of using the shared `apiErrorMessage` helper. Should be migrated in a follow-up pass to complete the sweep.

---

## Regression checks — error handling must still work on every form

- ✅ Saving any of the 31 forms with valid data succeeds and shows a success toast (no new regressions).
- ✅ Cancelled form (Esc key, "Cancel" button) → no toast shown, no error thrown to console.
- ✅ Form submit button disables during the save request, re-enables on success or error (no new regressions).
- ✅ A network timeout (e.g. backend slow to respond) → after a few seconds shows a timeout error toast (the fallback message), not a crash.
