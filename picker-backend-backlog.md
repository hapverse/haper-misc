# Picker — backend backlog (specs, not yet built)

Written 2026-06-28. These are the picker improvements that need **backend** work
(the client-only wins — scan-gate, OOS reasons, in-app scanner, scan-anything,
torch, scanner polish, IA rename, Products-Without-Scan, order-urgency-timer —
already shipped via haper-picker PR #1 and haper-backend PR #95).

Status: **specs only.** Do not build backend without the user's go-ahead.

---

## 1. Partial pick (pick fewer than required)

**Problem.** Today a line is all-or-nothing: `Pick N` (full qty) or `Out of stock`
(whole line). When only some units are on the shelf ("order says 5, only 3
here") the picker must wrongly OOS the entire line. The backend *enforces* this:
`pick` rejects `pickedQty !== line.requiredQty`
(`packages/picking/src/routes/task/controller.js:206`, comment: "short picks use
the out-of-stock action").

**Goal.** Let the picker pick `1..requiredQty`; the shortfall is refunded and the
order line quantity reduced — same money/stock semantics as OOS, just partial.

### Backend
- **Endpoint**: reuse `POST /picking/task/:id/line/:itemId/pick`.
  - Validator (`validator.js`): allow `1 <= pickedQty <= requiredQty` (currently
    must equal). Keep `pickedQty >= 1` (0 → use OOS).
- **Controller `pick`** (`controller.js:190`):
  - If `pickedQty === requiredQty` → unchanged (full pick).
  - If `pickedQty < requiredQty` → it's a partial. In ONE transaction (mirror the
    `markOutOfStock` pattern at `controller.js:249`):
    1. Reduce the order line quantity by the shortfall `(requiredQty - pickedQty)`
       and **refund the shortfall** via the shared `orderEditUtils` core (the
       same path OOS uses — do NOT hand-roll refund math, or COD vs prepaid will
       diverge).
    2. Stock: the picked units leave stock normally; the short units are treated
       as unavailable for this order (decide: leave stock as-is, or clamp like
       OOS `restock:false`). Default: don't restock the shortfall.
    3. Mark the line `PICKED` with `pickedQty` (the partial amount). The line is
       resolved. `requiredQty - pickedQty` is the implicit short.
    4. Post-commit: notify customer + store admin of the short (reuse the OOS
       notification, reworded "partially fulfilled").
- **Schema**: no new field strictly needed (`pickedQty < requiredQty` encodes the
  short). Optional: add `shortQty` for clarity/reporting.
- **`ensurePickTaskForOrder`**: unaffected.

### Client (haper-picker)
- In `LineCard` (revealed + actionable), show a stepper `[-] qty [+]` defaulting
  to `requiredQty`, clamped `1..requiredQty`; button reads `Pick {qty}`.
- Wire `onPick(itemId, manualOverride, pickedQty)` (today it's
  `onPick(itemId, manualOverride)` and the qty is looked up = requiredQty in
  `PickerApp.kt`). Send `pickedQty` from the stepper.
- Chip: show `Picked 3/5` when `pickedQty < requiredQty`.
- Only show the stepper when `requiredQty > 1`.

### Edge cases / decisions to confirm
- Refund timing for prepaid (Razorpay) partial — same async refund flow as OOS.
- Does a partial count toward the "all resolved → Complete" gate? Yes (resolved).
- Reporting: should partials show in an admin report? (separate ask.)

**Effort:** medium. The refund/stock/transaction reuse is the careful part.

---

## 2. Undo / reset a line (fix a mis-tap)

**Problem.** If a picker taps `Pick` or `Out of stock` on the wrong line, the line
locks (`lineStatus !== PENDING` → not actionable) with no way back. There is no
reset endpoint today (`router.js` has claim/verify/pick/oos/complete only).

**Goal.** Let the picker undo a resolution back to `PENDING` while the task is
still `IN_PROGRESS` — clearing the picked/OOS state and **reversing any money/
stock side effects**.

### Reversibility is the catch
- **Undo a PICKED line (full, scan-verified or override)** — EASY. Picking moves
  no money. Just reset the line: `lineStatus=PENDING`, clear `pickedQty`,
  `scanVerified`, `manualOverride`, `overrideReason`, `pickedAt`.
- **Undo an OOS line** — HARD. OOS already (a) removed the item from the order,
  (b) **refunded** the customer, (c) forced stock to 0. Undo must re-add the item,
  **reverse the refund**, and restore stock. For prepaid (Razorpay) a refund that
  has already been processed generally **cannot be un-refunded** — you'd need a
  re-charge, which is not a thing mid-pick. For COD the "refund" only reduced the
  amount due, so undo is feasible.
- **Undo a partial pick** — same refund-reversal problem as OOS (for the short
  portion).

### Recommended phasing
- **Phase 1 (ship first): undo PICKED lines only.** Covers the common "fat-finger
  picked the wrong item" case with zero money risk.
  - **Endpoint**: `POST /picking/task/:id/line/:itemId/reset`.
    - Guards: task must be `IN_PROGRESS` and owned by the caller (`loadOwnedTask`);
      line must be `PICKED`; **reject if the line was OOS** (Phase 2) and reject if
      task `COMPLETED`.
    - Action: reset the line fields above → `PENDING`. No order/refund/stock
      changes (full pick changed none).
  - **Client**: an `Undo` text button on a `PICKED` line card while
    `task.status == IN_PROGRESS`; calls reset → reload detail.
- **Phase 2 (later): undo OOS / partial.** Only where the refund is reversible
  (COD, or prepaid before the refund settles). Requires reversing
  `orderEditUtils` refund + re-adding the order line + restoring stock, all in one
  transaction, plus a clear "can't undo — refund already issued" error for the
  prepaid-settled case. Confirm product rules before building.

### Backend touch points
- `packages/picking/src/routes/task/router.js` — add the `reset` route.
- `.../validator.js` — params only (no body for Phase 1).
- `.../controller.js` — `reset` handler using `loadOwnedTask` + a new
  `PickTaskRepository.updateLine` reset, mirroring `pick`'s structure.
- `packages/shared/repositories/pick-task.repository.js` — if a dedicated reset
  helper is cleaner than reusing `updateLine`.

**Effort:** Phase 1 = small. Phase 2 = medium-large (refund reversal).

---

## Already done (for reference — no backend work)
- **Order urgency timer** — haper-picker e55605f. Shows "⏱ Waiting 7m" on the
  Available queue from the pick task's `createdAt` (already returned by the API);
  turns red past 10 min. Client-only.
