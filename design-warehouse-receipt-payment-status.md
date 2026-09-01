# Design spec — "Payment status" badge + "Mark as paid" on Verify Bill (warehouse goods-receipts)

Status: ready for build (needs backend field/API first — see "Backend dependency" below)
Owner: Chanchal (design) → build: tanmoy-web
Scope: small, focused addition to an existing page. No new screens, no new design tokens.

## 1. User flow

1. Warehouse manager/super admin opens **Warehouse → Verify Bill** (`VerifyBillPage.tsx`), sees the receipt list as today.
2. Every row shows a payment-status badge: **Not Paid** (default, all existing + all new receipts) or **Paid**.
3. **Not Paid → Paid**: manager clicks "Mark as paid" next to the badge → modal opens → optionally fills Transaction ID and/or Paid-on date/time → clicks "Mark as Paid" → modal closes, badge flips to Paid, toast confirms. No confirm-dialog interstitial needed (this is non-destructive, easily reversible, low-risk — unlike `CorrectReceiptModal`'s `window.confirm`, which guards an audited stock/ledger rewrite).
4. **Viewing a Paid receipt's details**: manager clicks the Paid badge → small popover shows recorded Transaction ID (or "—"), Paid-on time (or "—"), and who marked it paid + when (`markedPaidBy` / `markedPaidAt`, always recorded server-side regardless of what the manager typed). Manager/super-admin sees an "Edit" and "Unmark as paid" affordance inside the popover; staff (RECEIVE_GOODS-only, not MANAGE) sees the same popover read-only, no Edit/Unmark.
5. **Edit**: reopens the same modal pre-filled with the current Transaction ID / Paid-on, still both optional, saves over the existing record.
6. **Unmark as paid**: single click + native `window.confirm` (same pattern as `CorrectReceiptModal`'s destructive-ish action) — "Unmark this receipt as paid? Transaction ID and paid-on time will be cleared." → reverts to Not Paid, clears txnId/paidAt.
7. **Staff (no MANAGE permission)**: sees the badge (Not Paid or Paid) on every row, no "Mark as paid" button, and clicking a Paid badge shows the read-only popover only (no click affordance at all on a Not Paid badge — nothing to show).
8. Exits: success = badge + toast; failure = toast error, modal stays open with input intact (same pattern as `CorrectReceiptModal`/`ChangeSupplierModal`).

## 2. Layout

### Row placement (desktop table, `VerifyBillPage.tsx` main list)
The existing row has columns: Invoice # | (Supplier) | Received | Items | Units | Bill | Expand-chevron.
Add the badge to the **Bill** column area, or — cleaner — as a new column between **Bill** and the expand chevron, since Bill is already a click-target (`View` button) and shouldn't get crowded.

```
| Invoice # | Supplier | Received | Items | Units | Bill        | Payment    | ▾ |
|-----------|----------|----------|-------|-------|-------------|------------|---|
| TS6826    | Acme     | 21 Aug…  |  4    |  120  | [📎 View]   | ● Not Paid | ▸ |
| TS6827    | Acme     | 20 Aug…  |  6    |  340  | [📎 View]   | ✓ Paid     | ▸ |
```

New `th`: `Payment` (col count `colCount` bumps from 7/6 → 8/7 — update `colSpan` on the expand-detail `<td>` and the empty-state note if it references column count).

Cell content:
- **Not Paid, staff view**: just the badge, no button (badge is not clickable — nothing to see).
- **Not Paid, manager view**: badge + a small "Mark paid" text-button beside it, stacked or inline depending on width:
  ```
  ● Not Paid
  [Mark paid]
  ```
  Inline if the column has room (`display:flex, gap:0.35rem, alignItems:center, flexWrap:wrap`) — matches this page's existing flex-wrap convention for compact cells.
- **Paid, any viewer**: the badge itself is the clickable trigger (`✓ Paid`, `cursor:pointer`) — opens the read-only/edit popover.

Both `onClick` handlers must `e.stopPropagation()` — the row itself has `onClick={() => toggleRow(r)}` (expand-on-click), same guard already used by the Bill "View" button and the expand-chevron button in this file.

### Popover (Paid badge click)
Not a full modal — a small anchored popover (like `InfoTooltip` but interactive, or a lightweight custom popover since `InfoTooltip` is hover-only and won't hold buttons). Positioned below the badge, dismissible by clicking elsewhere or an X.

```
┌─────────────────────────────┐
│ Paid                      ✕ │
│ Txn ID:     TXN-88213       │
│ Paid on:    21 Aug, 3:40 PM │
│ Marked by:  Priya S. · today│
│                              │
│ [Edit]         [Unmark paid]│  ← manager/super-admin only
└─────────────────────────────┘
```
- Staff view: same box, no button row.
- Blank txnId/paidAt: render "—" for each, never hide the row — a manager who marked paid with zero details still needs to see that clearly (not "loading"/broken-looking).

### Mobile / narrow viewport
`VerifyBillPage` doesn't have a documented mobile-card breakpoint in the code read — it's a `table-scroll` (horizontally scrollable table), so no bespoke mobile layout is required for v1; the new column scrolls with the rest of the table like Items/Units/Bill already do. Do not invent a card layout — stay consistent with how this page already handles narrow screens.

## 3. Design tokens (reuse only — no new tokens)

- **Not Paid badge**: neutral/muted, NOT a warning color. Use the same visual recipe as `ExpiryCell`'s badge/`StatusPill` but with `var(--text-secondary)` as the color instead of a status hex:
  ```
  color: var(--text-secondary)
  border: 1px solid var(--border-color)
  background: var(--bg-primary, #0f1115)
  padding: 0.15rem 0.5rem
  border-radius: 999px
  font-size: 0.7rem
  font-weight: 600
  ```
  This deliberately does NOT reuse the `#eab308` (amber/warning) used elsewhere on this page (pooled-lot warning, CREATED/PENDING statuses) — Not Paid is the normal default state for a receipt that may legitimately sit unpaid for days/weeks, not an alert.

- **Paid badge**: reuse `#22c55e` (the success green already standardized in `statusMeta.ts` for AVAILABLE/RECEIVED/FULFILLED/dispatched-received states, and used ad hoc as `#16a34a` for the Barcode copy-confirm tick). Use `#22c55e` for consistency with `statusMeta.ts`:
  ```
  color: #22c55e
  border: 1px solid #22c55e55
  background: #22c55e1a
  padding: 0.15rem 0.5rem
  border-radius: 999px
  font-size: 0.7rem
  font-weight: 600
  cursor: pointer   /* only the Paid badge is a click target */
  ```
  Same `color/border/background` recipe `StatusPill` already uses (`${color}55` border, `${color}1a` background) — just spec'd inline since this isn't a `statusMeta.ts` status enum (it's a boolean + optional metadata, not a state machine with transitions to legend).

- **"Mark paid" button**: `btn('ghost')` from `ui.tsx`, `padding: 0.25rem 0.6rem, fontSize: 0.72rem` — matches the "Change supplier" ghost button's compact sizing on this same page.
- **Modal**: `Modal` from `ui.tsx`, default width (460px, not `wide`) — this form is shorter than `CorrectReceiptModal`'s.
- **Popover surface**: reuse `card` token (`var(--bg-secondary)`, `1px solid var(--border-color)`, `var(--radius-md)`) at a smaller padding (`0.6rem 0.7rem`), positioned `position: fixed` or `absolute` near the badge, `box-shadow` for elevation (check if `card` already has one — if not, add a light `boxShadow: '0 4px 12px rgba(0,0,0,0.3)'` inline, since this is the first floating/anchored (non-modal) popover on this page and needs to visually separate from the table beneath it).
- **"Unmark paid" button**: `btn('danger')` — same red (`#ef4444`) already used for destructive/error styling elsewhere in `ui.tsx`.
- **Primary "Mark as Paid" button**: `btn()` (primary, `var(--accent-primary)`) — same as `CorrectReceiptModal`'s "Apply correction".

## 4. Component inventory

New:
- `PaymentStatusBadge` — small component in `VerifyBillPage.tsx` or a new `PaymentStatusBadge.tsx` in `Warehouse/`, props: `{ paid: boolean; onClick?: () => void }`. Renders the Not Paid / Paid pill per tokens above.
- `MarkAsPaidModal.tsx` — new file, sibling to `CorrectReceiptModal.tsx`/`ChangeSupplierModal.tsx`, same structural pattern (props: `receipt` identity, `existing?: { txnId, paidAt }` for edit mode, `onClose`, `onDone`).
- `PaymentDetailsPopover` — new small component, anchored popover, props: `{ txnId, paidAt, markedByName, markedAt, canManage, onEdit, onUnmark, onClose }`.

Reused as-is, no changes needed:
- `Modal`, `btn`, `input`, `card`, `errMsg` from `ui.tsx`.
- `fmtDateTime` from `utils/date.ts` for Paid-on / Marked-at display.
- `usePermission` + `PERMISSIONS.WAREHOUSE.MANAGE` (same gate `CorrectReceiptModal`/`ChangeSupplierModal` use — `canManage` is already computed in `VerifyBillPage`, pass straight through).
- Toast pattern (`toast.success` / `toast.error`) exactly as the two existing modals do.

Modified:
- `VerifyBillPage.tsx` — add `Payment` column to both the `<thead>` and each row's `<td>`s; bump `colCount`; wire up `markAsPaidFor` / `paymentPopoverFor` state (same pattern as existing `changeSupplierFor`); after a successful mark/edit/unmark, refresh just that row's payment fields (avoid a full `fetchList()` re-fetch if the payment fields can be patched into `listData` locally — cheaper and avoids a full-page "Updating…" flash for a one-field change; fall back to `fetchList()` if patching in place isn't straightforward given the current `listData` shape).
- `types/warehouse.ts` — extend `ReceiptListRow` with the new fields (see Backend dependency below).

## 5. States

- **Loading (list)**: unaffected — existing "Loading bills…" covers the whole row including the new column; no per-badge skeleton needed since the badge data arrives with the same list payload.
- **Empty**: N/A at row level (every receipt always has a payment status, defaulting Not Paid) — no separate empty state needed.
- **Modal loading**: "Mark as Paid" button → `saving` state, label flips to "Saving…", disabled, same as `CorrectReceiptModal`/`ChangeSupplierModal`. Cancel/X stays enabled? No — disable Cancel/X too while saving, matching `CorrectReceiptModal`'s `disabled={saving}` on its Cancel button (prevents a race where closing mid-save leaves the row indeterminate).
- **Error**: `toast.error(errMsg(e))`, modal stays open, input preserved — same as both existing modals. Popover: if Unmark fails, close the confirm, keep the popover open, toast the error, badge stays Paid.
- **Success**: toast (`"Marked as paid."` / `"Payment details updated."` / `"Unmarked as paid."`), badge flips instantly (optimistic-safe since it's driven by the server response, not assumed), popover/modal closes.
- **Disabled**: "Mark as Paid" button is never disabled by blank fields (both optional, per requirement) — only disabled while `saving`. "Unmark paid" / "Edit" are simply absent (not disabled) for non-MANAGE viewers — an absent action reads cleaner than a disabled one with no tooltip explaining why, consistent with how the "Change supplier" button is either shown or replaced by the read-only caption today (never rendered-but-disabled).

## 6. Interaction details

- **Popover open/close**: click badge → open; click the X inside it, click elsewhere (backdrop-less — this is a lightweight anchored popover, not a modal, so a standard "click outside" listener is fine and does NOT conflict with the site-wide backdrop-click-to-close removal, which was specifically about dark full-screen modal backdrops). Press `Escape` also closes it.
- **Modal (Mark as Paid / Edit)**: — IMPORTANT — follows the site's current modal convention: closes ONLY via the X button or the Cancel button. Do NOT wire a backdrop-click handler to close it (the project removed backdrop-click-to-close from all admin modals project-wide, same day as this spec — `Modal` in `ui.tsx` already has no `onClick` on its backdrop `<div>`, only `stopPropagation` on the inner card, so building this on top of `Modal` gets this right for free as long as no new backdrop `onClick` is added).
- **Hover/press feedback**: "Mark paid" ghost button and Paid badge both need `cursor: pointer`; no custom hover style needed beyond what `btn('ghost')` already implies elsewhere on the page (this codebase doesn't appear to hand-roll `:hover` inline — leave as-is, consistent with the rest of the file).
- **Transitions**: popover fade/scale-in over ~120ms is a nice-to-have, not required — this page's only existing transition is the "Updating…" opacity fade (180ms ease); if adding one, match that duration/easing for consistency, but a plain instant show/hide is acceptable for v1.
- **Optimistic updates**: none — wait for the server response before flipping the badge (same as `CorrectReceiptModal`/`ChangeSupplierModal`, both of which call `onDone()` only after a successful API response). This is a low-frequency action; the round-trip is not worth the complexity of an optimistic-then-rollback pattern.
- **Confirmation pattern**: "Mark as Paid" → no confirm needed (safe, reversible, no downstream ledger/stock effect — contrast with `CorrectReceiptModal`'s `window.confirm`, which guards an actual stock rewrite). "Unmark as paid" → DOES need a `window.confirm`, since it destroys the recorded txnId/paidAt/who/when — same lightweight pattern already used in this codebase (`window.confirm(...)`, not a custom dialog), matching `CorrectReceiptModal`'s existing confirm call.
- **Paid-on field default**: leave BLANK until touched, do not prefill "now". Rationale: prefilling silently makes "Mark as Paid" with zero manual input record a paid-on timestamp that looks deliberately entered but wasn't — worse than recording nothing. If the field is left blank, the backend's `markedPaidAt` server-timestamp (see below) already captures "when this was flagged," so nothing is lost by leaving the user-facing "Paid on" field genuinely empty. Placeholder text: `"Optional — leave blank to just flag as paid"`.

## 7. Accessibility

- Badge: not just color — always paired with the text label ("Not Paid" / "Paid"), not a bare dot, so it doesn't rely on color alone (WCAG 1.4.1). Green `#22c55e` on the page's dark background and the neutral `text-secondary` badge both need to be checked against `--bg-primary`/`--bg-secondary` for the page's actual dark theme — `#22c55e` is already used elsewhere on dark surfaces in this codebase (`statusMeta.ts`) so treat as pre-cleared; re-verify in light mode if/when this page ships one (no evidence in the files read that this page currently renders in light mode — confirm before build).
- Clickable Paid badge: needs `role="button"`, `tabIndex={0}`, `aria-label="Payment details for invoice {invoiceNumber} — paid"`, and Enter/Space activation (it's a `<span>`-shaped pill, not a native `<button>`, styled to blend with the Not Paid pill — but must still be a real `<button>` element under the hood, exactly like `ExpiryCell`'s badge is a `<span>` because it's non-interactive; this one is interactive so use `<button>`, not `<span onClick>`).
- "Mark paid" button and modal buttons: standard `<button type="button">`, same as every other action in this file — no special ARIA needed beyond existing `aria-label` conventions already used (`aria-label={\`Correct the lot for ${l.name}\`}` style) — apply the same to `aria-label="Mark invoice {invoiceNumber} as paid"`.
- Popover: `role="dialog"` or `role="menu"`-adjacent isn't necessary for a read-only info box, but if it contains Edit/Unmark buttons, wrap it as `role="dialog"` `aria-label="Payment details"` and move focus to it on open, return focus to the badge on close (basic focus-trap not required since it's dismissible by Escape/outside-click, but focus should land inside on open).
- Touch targets: badge/button minimum 24×24px hit area (matches `Barcode`'s copy button convention in `ui.tsx`, which explicitly sets `minWidth: 24, minHeight: 24`) — pad the pill/button so this holds even though the visual pill is smaller.
- Modal inputs: label text-inputs directly above the field (matches `CorrectReceiptModal`'s `labelStyle` wrapping pattern), not placeholder-as-label.

## 8. List/filter — recommendation: DEFER to a follow-up, not v1

`VerifyBillPage.tsx` already has three filters (Warehouse, Supplier, Search) plus a View toggle (Aggregated/Individual) — it's a reasonably busy filter bar already (`flex-wrap` on narrow screens). Adding a Paid/Not Paid filter now is:
- Not blocking for the core ask (flag + record payment) — a manager can already see status per-row without filtering.
- Better designed once real usage data exists (e.g. is there ever a workflow of "show me only unpaid bills from Supplier X this month" vs. just eyeballing a page of ~20 rows?).
- Easy to add later as a same-pattern toggle/dropdown next to the existing "View" group — no architectural risk in deferring.

If/when it's added: a simple 3-state toggle (`All` / `Not Paid` / `Paid`) styled exactly like the existing Aggregated/Individual `role="group"` toggle, placed in the same filter-bar row.

## Backend dependency (must land first)

This spec assumes `ReceiptListRow` and the receipt lookup/detail response gain (nullable/optional, per this project's backward-compat rule):
```ts
paymentStatus: 'NOT_PAID' | 'PAID';   // or a boolean `paid: boolean` — either works, pick one and keep it consistent across list + detail + write endpoints
txnId?: string | null;
paidAt?: string | null;               // ISO datetime, user-entered, optional
markedPaidBy?: string | null;         // admin user id/name, server-set
markedPaidAt?: string | null;         // server timestamp of the mark action itself, always set when paid=true
```
Plus a write endpoint (e.g. `POST /admin/warehouse/receipt/mark-paid` and `.../unmark-paid`), identified the same way `ChangeSupplierModal`'s `correctReceiptSupplier` call is — by `warehouseId + invoiceNumber + receivedAt` (the same disambiguating key `rowKey()` already uses client-side), NOT by a receipt document `_id` if one doesn't already exist as a stable identifier — confirm with backend which key is authoritative before wiring the API client.

New receipts default to `NOT_PAID` server-side at creation; existing historical receipts backfill to `NOT_PAID` (nullable/defaulted per this project's no-regressions rule — old rows with the field simply absent must render as Not Paid on the client, never crash or show "undefined").

---

STATUS: done
OUTPUT: spec produced for haper-admin Warehouse → Verify Bill (`VerifyBillPage.tsx`) — new Payment column/badge + Mark-as-paid modal + read-only/edit popover — written to `/Users/office/Documents/haper/haper-misc/design-warehouse-receipt-payment-status.md`
NEXT: tanmoy-web — build once the backend field/API described in "Backend dependency" lands (paymentStatus/txnId/paidAt/markedPaidBy/markedPaidAt on ReceiptListRow + a mark-paid/unmark-paid endpoint keyed by warehouseId+invoiceNumber+receivedAt); full spec above verbatim
