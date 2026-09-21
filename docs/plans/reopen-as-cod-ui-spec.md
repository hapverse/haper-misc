# Switch to Cash on Delivery — admin UI spec (order details modal)

Status: **DESIGN SPEC — ready for tanmoy-web** · Author: Chanchal (designer) · Date: 2026-09-21
Parent plan: `haper-misc/docs/plans/reopen-as-cod.md` (§1, §3.2, §3.3, §5.1, §6 Phase 3, §9 — all defaults approved).
Repo / surface: `haper-admin` → `src/pages/Orders/OrderDetailsModal.tsx` only. **No** Order Board, rider-app or customer-app UI in v1 (Q12 default).
Spec only. No new dependencies. Everything below reuses existing tokens, `ConfirmDialog`, `toast`, `apiErrorMessage/Code/Status`, `lucide-react` (`Banknote`, `AlertTriangle`, `Loader2` — all already installed/used).

---

## 0. What I read in the code (facts the spec depends on)

| Fact | Where | Consequence |
|---|---|---|
| Manage Status column = status `<select>` + "CURRENT" chip + saved-reason box + cancel-reason `<select>` + **Update Status** (`btnStyles`, accent fill) | `OrderDetailsModal.tsx` L467-531 | New action goes in this column, below Update Status. |
| The modal overlay is `zIndex: 400`; **`ConfirmDialog` overlay is `zIndex: 60`** | modal L430 vs `ConfirmDialog.tsx` L146 | Used as-is, the confirm dialog would render **behind** the order modal. Needs a `zIndex` prop (§4.3). |
| Existing confirmations inside this modal are `window.confirm` (cancel-paid, save-items). `ConfirmDialog` is the newer standard ("replaces `window.confirm`"), has Esc/Tab-trap/focus-return, `tone="warning"` | `ConfirmDialog.tsx` | New action uses `ConfirmDialog`. Do not add a 3rd `window.confirm`. |
| Refund reasons: `<select>` with `-- … (required) --` placeholder, last option `Other (note required)`, note `<input>` appears only for OTHER | modal L68-74, L1090-1104 | Mirror exactly for the COD reason picker. |
| Modal does **not** use `hasPermission`; it only reads `isSuperAdmin` from `useAuthStore` | modal L35 | Gate with `hasPermission(user, PERMISSIONS.ORDERS.CONVERT_TO_COD)` (`utils/permissions.ts`) + reuse `isSuperAdmin`. |
| `normalizeOrder` spreads the raw order, so `order.codConversion`, `order.price`, `order.refundedAmount`, `order.stockRestored`, `order.meta` survive. `order.walletUsed` = `meta.walletUsed`. `order.totalAmount` = `totalAmount ?? price ?? …` | `utils/orders.ts` L163-195 | **Cash to collect must be read from raw `order.price`** (server-net of wallet, plan §2.2), never `totalAmount`, never `price - walletUsed`. |
| Payment badge today: `PAYMENT: {order.paymentStatus}` — for COD the backend value is `cod_pending`, which prints raw | modal L798-802 | Converted orders need a friendly label (§5.3). |
| Amber text used in the app today is `#eab308` — **1.92:1 on white** (fails AA in light theme). `ConfirmDialog tone="warning"` fill `#d97706` + white text = **3.19:1** (fails AA) | measured | New amber tokens (§3.1); do not copy `#eab308` for text. |
| `--bg-panel` == `--bg-secondary` == `#ffffff` in light theme | `index.css` L55-56 | In light theme the Manage Status panel and its inputs are the same white — separate the new block with **borders/dividers, not fills**. |
| Toaster: 4 s auto-dismiss, `zIndex 9999`, **no `aria-live`** | `toastStore.ts`, `Toaster.tsx` | Errors that need reading/acting are shown inline, never toast-only; success is confirmed by the UI change itself (live-region), toast is supplementary. |
| `fetchOrderDetails()` sets `isLoading` → the whole scroll body is replaced by a spinner and remounted | modal L92-131 | Dialog state must live **outside** that branch; success refresh must be **silent** (§6.4). |

---

## 1. User flow

**Entry:** admin (store_admin / super_admin, or a manager explicitly granted `orders.convert_to_cod`) opens an order from Orders list / Live Board → order details modal. Customer has phoned: "payment didn't go through, deliver it, I'll pay cash."

1. Modal loads → Manage Status panel shows a **Payment** block under "Update Status". For a convertible order it shows the current payment state + the **Switch to Cash on Delivery** button (§2).
2. Admin clicks the button → **confirm dialog** opens (above the modal), focus lands on the Reason select.
3. Admin reads the sentence + cash box (exact amount), picks a **Reason**, optionally types a **Note** (required for Other).
4. Admin clicks **Switch to Cash on Delivery** (confirm). Button → "Working…", fields lock, Esc/Cancel/X locked. No optimistic update (money action; wait for the server, typically <1.5 s).
5. **Success exit:** dialog closes → toast → panel replaced by the "Switched to COD" line, Payment card shows the badge + persistent note, Order Activity gets the new row, list behind refreshes (`onUpdate()`).
6. **Recoverable failure exit** (wallet short, stock out, slot full, unclaimed refund, network/5xx): dialog stays open with an inline error + next step; admin fixes the cause and retries, or clicks Go back.
7. **Stale-state failure exit** (payment captured meanwhile, order moved on, over limit, permission/store): dialog closes, order silently refetches, a persistent notice sits under the button explaining what changed and what to do (§7).
8. **Cancel exit:** Go back / Esc / X → dialog closes, focus returns to the trigger, nothing sent, form discarded.

---

## 2. Where it lives, and how it looks

### 2.1 Placement (Manage Status column)

```
┌ Manage Status ────────────────────────────┐
│ [ OPEN                              ▾ ]   │  existing select
│ (CURRENT: ASSIGNED)                       │  existing chip
│ Reason: …            (existing, if any)   │
│ [ ▣ Update Status ]                       │  existing PRIMARY (accent fill)
│ ─────────────────────────────────────────  │  1px var(--border-color), margin-top 1rem
│ PAYMENT                                   │  label: 0.75rem / 600 / uppercase / 0.04em / text-secondary
│ Online (Razorpay) — not paid              │  0.85rem / 500 / text-primary
│ [ ₹ Switch to Cash on Delivery ]          │  SECONDARY amber-outline button, full width
│ helper / blocked reason (0.75rem)         │  text-secondary
└───────────────────────────────────────────┘
```

- New wrapper `<div>` (flex column, gap `0.5rem`) after the Update Status button, with `marginTop: 1rem; paddingTop: 1rem; borderTop: 1px solid var(--border-color)`.
- Right column ("Assign Delivery Boy") is untouched. The `auto-fit minmax(240px,1fr)` grid is unchanged; on phones the block simply stacks with its column.
- The block is **not** part of the status `<select>`: this is a payment change, not a status. Adding a pseudo-option would also break the existing "current status always in options" invariant.

### 2.2 Visual weight — decision and justification

**Trigger button = secondary, amber outline. Confirm button in the dialog = amber fill (`tone="warning"`). Not red. Not the accent fill.**

- *Not the accent-fill primary:* "Update Status" is the panel's primary; two filled buttons in one 280 px column make the next action ambiguous, and an accent fill signals "routine save" — this moves money expectations.
- *Not red/destructive:* red in this app means cancel / delete / failed / loss. Nothing is destroyed and the customer is not harmed; using red would train admins to fear a legitimate recovery tool, and would collide with "Cancel order" semantics.
- *Amber:* matches the rider app's own "cash to collect" palette (plan §2.4 — amber `PaymentCash`) and the app's existing "payment pending" amber, and matches `ConfirmDialog`'s stated purpose for `warning`: "a considered-risk checkpoint that is NOT a destructive delete".
- The **weight is carried by the confirm step** (exact amount, reason, "cannot be undone"), not by shouting on the trigger. Three deliberate steps: click → choose reason → confirm.

Trigger button style (base = existing `btnStyles`, overridden): `background: transparent; color: var(--warning-text); border: 1px solid var(--warning-text); font-weight: 600; min-height: 40px;` icon `Banknote size={16}`. Label: **`Switch to Cash on Delivery`**.

> Terminology decision: user-facing verb is **"Switch to Cash on Delivery"** everywhere (button, dialog, toast, audit). The plan/permission say "convert"; that stays internal. This matches the approved confirm sentence ("Switch order … to Cash on Delivery?"). The persistent note therefore reads "Switched to Cash on Delivery by …" instead of the plan's "Converted to COD by …" — same data, consistent verb.

### 2.3 Visibility matrix (client helper mirrors server §3.3; server is the authority)

Helper lives in a new pure module `src/pages/Orders/convertToCod.ts` (mirrors `cancelReasons.ts`), returning one of four kinds. `order` = normalized order; `status` strings are the normalized ones (`ORDER_STATUS_MAP`).

| # | Condition (evaluated top-down, first match wins) | Result | What the admin sees |
|---|---|---|---|
| 1 | No `orders.convert_to_cod` permission | **hidden** | Whole Payment block absent (block would only be a dead end). |
| 2 | `order.codConversion` present **or** `paymentMethod === 'COD'` with `codConversion` | **converted** | State line instead of a button (§5.2). |
| 3 | `paymentMethod !== 'RAZORPAY'` (plain COD, WALLET, STORE_PICKUP_*), or `channel === 'pos'` | **hidden** | Nothing to switch; block absent. |
| 4 | Razorpay payment captured (`meta.payment.status === 'captured'` or `paymentStatus === 'PAID'`) | **hidden** | This is the normal state of most Razorpay orders — a disabled button on all of them is noise. The Payment card already says PAID. |
| 5 | `status === 'PAYMENT_INITIATED'` | **hidden** | Existing amber "Payment pending" note at the top of the panel already explains; do not duplicate. |
| 6 | `status` in `CLOSED, CANCELED, ADMIN_CANCELED, UN_DELIVERED, FAILED, REFUND_*, DELETED` | **hidden** | Order is finished; the action never applies. (`FAILED` here is a non-payment failure; `PAYMENT_FAILED` is convertible, see 9.) |
| 7 | `status === 'OUT_FOR_DELIVERY'` | **blocked** (visible, `aria-disabled`) | Helper: *"The rider is already on the way, so the payment method can't be changed now."* |
| 8 | `price > 5000` and **not** super admin | **blocked** | Helper: *"Orders above ₹5,000 must be switched to Cash on Delivery by a super admin."* |
| 9 | Mode B status (`OPEN, PICKING, PACKED, PROCESSING, ASSIGNED`) **and** `refundedAmount > 0 && stockRestored === true` (unclawed refund) | **blocked** | Helper: *"A refund was already issued on this order, so it can't be switched to cash. Cancel the order instead."* |
| 10 | Otherwise, `status` in `PAYMENT_CANCELLED, PAYMENT_FAILED` (**Mode A**) or `OPEN, PICKING, PACKED, PROCESSING, ASSIGNED` (**Mode B**) | **available** | Button enabled. |
| 11 | Anything else (unknown status) | **hidden** | Fail closed. |

Row 7 gives one sentence and no invented remedy — the plan defines none for v1 (rationale: plan §3.2, a flip mid-handoff is how "he said online, she said cash" happens).

Additional **transient** disabled conditions (button `aria-disabled`, helper unchanged, no new text unless noted):
- `isSaving` (another action in flight).
- `status !== order.status` (admin has an unsaved status change in the select): helper *"Save or undo the status change above first."* — prevents "picked Cancel, then clicked Switch" contradictions.

**Disabled implementation rule (accessibility):** blocked/transient buttons use `aria-disabled="true"` (not the `disabled` attribute) so they stay keyboard-focusable and readable; the click handler is a no-op; the visible **helper text is always rendered** under the button (`id="cod-helper"`, referenced by `aria-describedby`); also set `title={helperText}` for mouse users. Touch users have no hover, so **never rely on the tooltip alone** — this deliberately upgrades the brief's "tooltip" to always-visible helper text (same 0.72-0.75rem secondary-text style the modal already uses under the rider select).
Blocked style: `opacity: 0.65; cursor: not-allowed;` (existing disabled idiom is `0.5`; 0.65 is used here so the button label stays legible — WCAG exempts inactive controls from contrast minimums, but the reason must remain readable, and the reason lives in the always-visible helper, not the button). Border/text keep the amber hue; no grey-out to a different colour.

### 2.4 Available-state helper text (Mode-specific, always shown under the button)

| Mode | Helper (0.75rem, text-secondary) |
|---|---|
| A — `PAYMENT_CANCELLED` / `PAYMENT_FAILED` | *"Payment was not completed. This also reopens the order."* |
| B — `OPEN … ASSIGNED` | *"Payment is still pending online. The customer will pay cash to the rider."* |

Current-payment line above the button (0.85rem/500, text-primary): **`Online (Razorpay) — not paid`** for both modes (the order never got a captured payment; convertibility already guarantees this).

---

## 3. Design tokens

### 3.1 New tokens (justified) — add to `src/index.css`, both theme blocks

There is no `--warning` token; amber is hard-coded in ~10 places and the text variant (`#eab308`) fails AA on white. This feature needs amber for a button, two note strips and a badge in **both** themes, so four tokens are justified. Existing hard-coded amber sites are **not** touched.

| Token | Dark | Light | Used for | Contrast (measured) |
|---|---|---|---|---|
| `--warning-fill` | `#b45309` | `#b45309` | confirm-button fill | white text **5.02:1** both themes |
| `--warning-text` | `#fbbf24` | `#92400e` | trigger text/border/icon, badge text | dark on `#242424` 9.3 / on `#1a1a1a` 8.9; light on `#fff` **7.09**, on tint 6.2 |
| `--warning-soft` | `rgba(217,119,6,0.14)` | `rgba(180,83,9,0.10)` | strip / badge / hover backgrounds | body copy on it stays `--text-primary` (light 15.5:1, dark 12.8:1) |
| `--warning-border` | `rgba(251,191,36,0.40)` | `rgba(180,83,9,0.35)` | strip borders | decorative |

Rule: **amber only for icon, label and border; running copy in strips stays `--text-primary`/`--text-secondary`** (avoids every tinted-background contrast trap).

### 3.2 Existing tokens reused

`--bg-panel`, `--bg-secondary`, `--border-color`, `--text-primary`, `--text-secondary`, `--danger` (error banner icon/border tint only), `--success` (CLOSED badge), `--radius-md`, `--radius-lg`, `--accent-primary` (focus of nothing here — only Update Status). Inputs = existing `inputStyles` (0.875rem, `0.625rem 1rem`, `--bg-panel`, 1px `--border-color`, `--radius-md`).

### 3.3 Type & spacing scale (all existing values)

| Element | Size / weight | Notes |
|---|---|---|
| Dialog title | 1.1rem (ConfirmDialog) | as-is |
| Sentence | 0.95rem / 400, line-height 1.5; order id + amount `600` | |
| Cash-box amount | 1.5rem / 700, `font-variant-numeric: tabular-nums` | numbers right-aligned |
| Cash-box label | 0.85rem / 500, text-secondary | |
| Field label | 0.8rem / 600, text-primary | above control, gap 0.35rem |
| Helper / counter / error | 0.75rem / 400 | counter right-aligned |
| Block label "PAYMENT" | 0.75rem / 600 / uppercase / 0.04em | |
| Spacing | 0.25 / 0.5 / 0.75 / 1 / 1.5 rem | dialog body gap 1.1rem (ConfirmDialog) |
| Radius | `--radius-md` (8px) everywhere; pill `999px` for badges | no shadows added |
| Currency | `₹` + `toLocaleString('en-IN', {maximumFractionDigits: 2})` | ₹2,124 · ₹2,124.5 → "₹2,124.5"; never "₹2124.00" |
| Date/time | `toLocaleString('en-IN', {dateStyle:'medium', timeStyle:'short'})` | same as Rider Activity ("21 Sept 2026, 3:42 pm") |

---

## 4. Component inventory

### 4.1 Reused as-is
`ConfirmDialog` (with additions below), `toast`, `apiErrorMessage/apiErrorCode/apiErrorStatus`, `inputStyles`, `cardStyles`, `cardHeaderStyle`, `btnStyles` (spread + override), `useAuthStore`, `hasPermission`, `PERMISSIONS`, existing `.spin` class (`Loader2`).

### 4.2 New
| Item | Type | Notes |
|---|---|---|
| `src/pages/Orders/convertToCod.ts` | pure module (+ `convertToCod.test.ts`) | `COD_CONVERSION_MAX_VALUE = 5000`; `COD_REASON_OPTIONS` (§4.4); `COD_NOTE_MAX = 300`; `getCodConversionState(order, {isSuperAdmin, canConvert, hasUnsavedStatusChange, isSaving})` → `{kind:'hidden'} \| {kind:'available', mode:'reopen_and_convert'\|'convert_only', cashToCollect, walletUsed, walletReDeduct} \| {kind:'blocked', code, message} \| {kind:'converted'}`; `validateCodSubmission({reasonCode, note})` → `{ok:false, field, error} \| {ok:true, value:{reasonCode, note?}}`; `mapCodError(err)` → `{scope:'inline'\|'stale', message, detail?}` (§7); `codPaymentBadge(order)` (§5.3); `formatInr()`. Mirrors `cancelReasons.ts`: no React, no side effects. |
| `<CodPaymentBlock />` (in-file component inside `OrderDetailsModal.tsx`, or sibling file) | presentational | props: `state`, `onOpen`, `helperId`, `convertedLineRef`. Renders §2. |
| `<CodConfirmBody />` | presentational, children of `ConfirmDialog` | props: `orderId`, `state`(available), `reasonCode`, `note`, `error`(field), `bannerError`, `busy`, `onReason`, `onNote`, `reasonRef`, `noteRef`. |
| `<CodConversionNote />` | presentational | Payment-card strip (§5.3). |

### 4.3 Additions to shared `ConfirmDialog` (all optional props, **defaults preserve today's behaviour byte-for-byte** for its 8 existing callers)

| Prop | Default | Why |
|---|---|---|
| `zIndex?: number` | `60` | Order modal is `400`; pass **`410`**. Without it the dialog is hidden behind the modal. |
| `initialFocusRef?: RefObject<HTMLElement>` | Cancel button | This dialog's job is collecting a reason — land on the Reason select (Esc/Enter can't confirm by accident, so the "safe default = Cancel" rationale doesn't apply). Effect already runs once on mount; child refs are attached by then. |
| `describedById?: string` | none | Sets `aria-describedby` so screen readers read the money sentence after the title. |
| `lockWhileBusy?: boolean` | `false` | When `true` and `isBusy`: Cancel and X become `disabled`, Esc is ignored. Prevents closing mid-request. (Parent's `onClose` must also no-op while busy — belt and braces.) |

Also change (contrast fix, tiny): in `ConfirmDialog`, `tone="warning"` fill/header/ack colours from hard-coded `#d97706` / `rgba(217,119,6,…)` to `var(--warning-fill)` / `var(--warning-soft)` / `var(--warning-border)`. **Blast radius: `BelowCostConfirmModal` (the only other `tone="warning"` user)** gets a slightly darker button (`#b45309` vs `#d97706`) — it fixes its 3.19:1 white-on-fill AA failure. Reviewer: check that screen visually in both themes. If this is rejected, ship without it and accept the confirm button at 3.19:1 (not recommended).

### 4.4 Reason options (mirror `REFUND_REASON_OPTIONS` shape; order = expected frequency)

| value (sent as `reasonCode`) | Label in `<select>` | Label in audit/note (short) |
|---|---|---|
| `PAYMENT_FAILED_CUSTOMER_WILL_PAY_CASH` | Payment failed — customer will pay cash | Payment failed, customer pays cash |
| `CUSTOMER_REQUEST` | Customer asked to pay cash | Customer request |
| `STORE_DECISION` | Store decision | Store decision |
| `OTHER` | Other (note required) | Other |

Placeholder option (value `""`): `-- Select a reason (required) --`. **No preselection** even for `PAYMENT_CANCELLED` orders — forced choice keeps the data clean (same rationale as `cancelReasons.ts`).

### 4.5 Permission mirror (known drift trap — **required in the same PR**)

1. `src/constants/permissions.ts` → in `PERMISSIONS.ORDERS` add `CONVERT_TO_COD: "orders.convert_to_cod",` (after `CREATE_POS`). `PermissionString` widens automatically.
2. `src/components/PermissionGrid.tsx` → Orders `columns` add `{ key: 'convert_to_cod', perm: PERMISSIONS.ORDERS.CONVERT_TO_COD, label: 'Switch to COD' }` so a store admin can grant it to a manager on the Team page (plan §4.3: grantable, in no preset).
3. `src/pages/Team/TeamMemberModal.tsx` `MANAGER_PRESET` / `SUPPORT_PRESET` — **do NOT add** (backend presets deliberately exclude it; these local copies must stay identical).
4. `src/utils/permissions.ts` — no change (super_admin / store_admin bypass, manager/support check the list). Backend file to mirror: `packages/shared/constants/permission.constant.js` (`ORDERS.CONVERT_TO_COD`).
5. Test: `hasPermission({roles:['manager'], permissions:[]}, 'orders.convert_to_cod') === false`; with the string in `permissions` → `true`; store_admin → `true`.

---

## 5. Confirm dialog, success and persistent note

### 5.1 The confirm dialog

`ConfirmDialog` props: `title="Switch to Cash on Delivery?"`, `tone="warning"`, `confirmLabel="Switch to Cash on Delivery"`, `cancelLabel="Go back"`, `isBusy`, `lockWhileBusy`, `zIndex={410}`, `initialFocusRef={reasonRef}`, `describedById="cod-sentence"`, **no `acknowledgeLabel`** (three deliberate steps + reason + exact amount is enough; a checkbox would train click-through on a task admins do a few times a week). Mount conditionally (`{open && …}`) so fields reset each open, and **render it as a sibling of the modal panel, outside the `isLoading ? … : !order ? … : …` branch** — otherwise any background refetch (SSE event, `isLoading`) unmounts the dialog and loses what the admin typed.

Layout (max-width 520px, ConfirmDialog default; body `display:grid; gap:1.1rem`):

```
┌ ⚠ Switch to Cash on Delivery?                            ✕ ┐  amber-tinted header (warning tone)
│                                                            │
│ Switch order #HP581915100 to Cash on Delivery? The rider   │  #cod-sentence  (0.95rem)
│ will collect ₹2,124 at the door. This cannot be undone     │  bold: order id, amount
│ from here.                                                 │
│                                                            │
│ ┌────────────────────────────────────────────────────────┐ │  cash box: --warning-soft bg,
│ │ Cash to collect                              ₹2,124    │ │  1px --warning-border, radius-md, pad 0.9rem
│ │ Wallet coins already paid            ₹200  (only if >0)│ │
│ └────────────────────────────────────────────────────────┘ │
│ What happens                                               │  0.8rem/600 label, then bullet list 0.85rem
│  • …mode-specific bullets (§5.1.2)…                        │
│                                                            │
│ Reason *                                                   │
│ [ -- Select a reason (required) --                    ▾ ]  │
│ Note (required for Other)                          0/300   │
│ [ e.g. Customer called, will pay cash at the door       ]  │  textarea, 3 rows, maxLength 300
│ ⓘ inline error banner / field errors (role=alert)          │
├────────────────────────────────────────────────────────────┤
│                        [ Go back ] [ Switch to Cash on Delivery ] │  confirm = --warning-fill, white text
└────────────────────────────────────────────────────────────┘
```

#### 5.1.1 Exact strings

- Sentence (verbatim from brief; `#cod-sentence`): **"Switch order #HP581915100 to Cash on Delivery? The rider will collect ₹2,124 at the door. This cannot be undone from here."** — order id = `order.orderId || order._id.substring(0,8)` (same as modal header); amount = `formatInr(order.price)`.
- Cash box:
  - Row 1 label `Cash to collect`, value `₹2,124` (1.5rem/700, right-aligned).
  - Row 2 (only when `order.walletUsed > 0`): Mode B label **`Already paid from wallet`**, value `₹200`; Mode A label **`Wallet coins to be taken again`**, value `₹200` (value = `order.refundedAmount`, i.e. what the abandonment cron refunded and reopen will re-debit). Both in `--text-secondary`, 0.85rem.
  - **Never** show a computed "order total" — the box shows only `price` and the wallet figure, so there is no arithmetic that could disagree with the server.
  - Screen-reader text of the box: *"Cash to collect ₹800. ₹200 already paid from wallet."* (single sentence via `aria-label` on the box `role="group"`; the visual rows are `aria-hidden`).
  - Example, wallet order (price 800, walletUsed 200): sentence says "…will collect **₹800** at the door…", box: Cash to collect ₹800 / Already paid from wallet ₹200.
- **"What happens" bullets** (`<ul>`, 0.85rem, text-secondary; only the lines that apply):

  | Mode / condition | Bullets |
  |---|---|
  | A (`PAYMENT_CANCELLED` / `PAYMENT_FAILED`) | • The order is reopened as Open. • The items are reserved from stock again. • *(if `refundedAmount > 0`)* ₹200 is taken from the customer's wallet again — it was refunded when the payment was cancelled. • *(if `order.slot`)* The delivery slot is booked again if it is still available. • The customer is told to keep ₹2,124 cash ready. |
  | B (`OPEN…ASSIGNED`) | • The order keeps its status, items and rider. • *(if `ASSIGNED`)* The rider is told to collect cash. • The customer is told to keep ₹2,124 cash ready. |

  (The two notifications are the approved Q11 defaults; if backend ships without them, delete the bullet — do not promise what doesn't happen.)
- Field labels: **`Reason`** (the word "required" is in the label text — never a colour-only asterisk); **`Note`** with suffix `(required for Other)` when `reasonCode === 'OTHER'`, else `(optional)`.
- Note placeholder: **`e.g. Customer called, will pay cash at the door`**. Counter: `{n}/300` (0.75rem, right); at ≥ 280 chars the counter turns `--warning-text` and gets `aria-live="polite"` announcement "20 characters left" (announce only at 280 and 300, not per keystroke).
- Buttons: Cancel **`Go back`** · Confirm **`Switch to Cash on Delivery`** · busy label = ConfirmDialog default **`Working…`**.

#### 5.1.2 Validation (mirror `resolveCancelSubmission`)
Run in the confirm handler, **not** by disabling the confirm button (a disabled button with no explanation is a dead end; Confirm is enabled unless busy):

| Case | Message (inline under the field, `role="alert"`, 0.75rem, `--danger` **icon + text in `--text-primary`**) | Focus |
|---|---|---|
| No reason | `Please select a reason.` | Reason select |
| `OTHER` and note blank after trim | `Please add a note explaining "Other".` | Note textarea |
| Note > 300 | prevented by `maxLength` (paste truncated) — no message needed | — |

Set `aria-invalid="true"` + `aria-describedby` on the field. Note is trimmed; blank → omitted from the payload. Payload: `POST /admin/order/${orderId}/convert-to-cod` `{ reasonCode, note? }` via the shared `api` instance.

### 5.2 Success

1. **Toast** (`toast.success`, 4 s):
   - Mode A: **`Order #HP581915100 reopened and switched to Cash on Delivery. Rider will collect ₹2,124.`**
   - Mode B: **`Order #HP581915100 is now Cash on Delivery. Rider will collect ₹2,124.`**
   - amount = response `data.cashToCollect` (fallback `order.price`); mode from response `data.mode`.
2. **Idempotent repeat** (200 with `alreadyConverted: true`, e.g. a double-click or a second admin): close the dialog, refetch, `toast.info("This order is already Cash on Delivery.")`. Not an error.
3. Close dialog → `onUpdate()` (refreshes the list behind) → **silent** `fetchOrderDetails` (§6.4) → audit trail re-fetched (the existing `/audit` call).
4. **Manage Status block** becomes the *converted* line (no button, so it cannot be double-fired):
   `▣ Banknote` + **`Switched to Cash on Delivery. The rider collects ₹2,124.`** (0.85rem/500 text-primary, icon `--warning-text`). `tabIndex={-1}` + ref; **focus moves here** after success (the trigger button no longer exists, so ConfirmDialog's focus-return would land on `<body>`). Wrapper `role="status"`.
5. **Status** chip/select unchanged in Mode B; in Mode A the modal shows `CURRENT: OPEN` after the silent refetch.

### 5.3 Payment card + persistent note (`order.codConversion`)

Payment card header already renders `Payment ({order.paymentMethod})` → automatically **`Payment (COD)`** after refetch. No header change.

**Badge** (replaces the `PAYMENT: {paymentStatus}` chip **only when `order.codConversion` is present**; all other orders render exactly as today — plain-COD `cod_pending` raw text is a pre-existing wart, deliberately not changed here):

| State | Label | Colours |
|---|---|---|
| converted, status ≠ `CLOSED` and not cancelled/un-delivered | `CASH TO COLLECT ₹2,124` | text `--warning-text`, bg `--warning-soft`; keep the existing badge shape: `4px` radius, `0.75rem/600`, padding `0.25rem 0.5rem` |
| converted, status = `CLOSED` | `CASH COLLECTED` | text `--success`, bg `rgba(34,197,94,0.1)` (existing PAID style) |
| converted, status cancelled / un-delivered | `CASH NOT COLLECTED` | text `--text-secondary`, bg `--bg-secondary`, 1px border |

**Persistent note** (`<CodConversionNote/>`), rendered inside the Payment card **below the badge**, `marginTop: 0.75rem`:

```
┌─────────────────────────────────────────────────────────┐  bg --warning-soft, 1px --warning-border, radius-md, pad 0.6rem 0.75rem
│ ▣  Switched to Cash on Delivery by ops@store.in          │  icon --warning-text; text 0.8rem --text-primary; email 600
│    on 21 Sept 2026, 3:42 pm — Payment failed, customer   │  date; " — " + short reason label (§4.4)
│    pays cash                                             │
│    "Customer called, will pay cash at the door"          │  note in quotes, --text-secondary, only if present
└─────────────────────────────────────────────────────────┘
```
- Data: `codConversion.by.email` (fallback `by.roles[0]` → "an admin"), `convertedAt`, `reasonCode` → short label (unknown code → the raw code), `note`. `overflow-wrap: anywhere` on the note line (300 chars of free text).
- **Late-capture strip** — only if `codConversion.lateCaptureAt` is set (plan §3.5), second strip under the first, same style: icon `AlertTriangle`, text **`The customer also paid online after this switch. That payment was refunded to their wallet (see Wallet refunds below). Still collect ₹2,124 in cash.`** This prevents an admin/rider being confused by a "Wallet refunds" card on a COD order.
- The strip is not dismissible and not conditional on scroll position — it is a record, not a notification.
- Optional (nice, skip if time-boxed): on the render right after a successful conversion, the note background flashes `--warning-soft` at 2× alpha → normal over 1.2 s `ease-out`; **omitted entirely under `prefers-reduced-motion`**.

### 5.4 Order row (Orders list) and Live Board
- **List** (`OrdersList.tsx` payment cell, L690-691): after `onUpdate()` the cell shows `COD` + the backend `paymentStatus` — no code needed for correctness. **Optional, only if the list payload carries `codConversion`** (plan §4.4 — check when building; do not block on it): a third line `Switched from online` (0.72rem, `--warning-text`) under the status text. If the projection lacks the field, skip it.
- **Live Order Board:** **no change in v1** (Q12). It already reflects the change through the existing `ORDER_STATUS_UPDATED` SSE event; the modal's `useOrderEvents` refetch will also fire once after our own action — harmless.

---

## 6. States

### 6.1 Payment block (in Manage Status)

| State | Trigger | UI |
|---|---|---|
| **Loading** | modal `isLoading` | Block not rendered (whole body is the existing spinner). |
| **Hidden / empty** | rows 1, 3-6, 11 of §2.3 | Block absent entirely; no divider, no label (the panel looks exactly as today). |
| **Available** | row 10 | Label, payment line, amber-outline button, mode helper. |
| **Blocked** | rows 7-9 | Same, button `aria-disabled`, `opacity 0.6`, reason helper text visible + `title`. |
| **Transient-disabled** | `isSaving` or unsaved status change | Same as blocked; the unsaved-change case shows its helper. |
| **Success / converted** | `codConversion` present | Converted line (§5.2 #4), no button. |
| **Error (stale)** | §7 stale errors | Persistent notice under the (now hidden/blocked) block: `role="status"`, bg `--warning-soft`, border `--warning-border`, icon `AlertTriangle` `--warning-text`, copy from §7; cleared when the order id changes or the next successful refetch shows a *different* convertibility. Also fires `toast.error` with the short version. |

### 6.2 Confirm dialog

| State | UI |
|---|---|
| **Default** | Fields empty, Confirm enabled (label as §5.1.1). Focus on Reason select. |
| **Validation error** | Inline field message + `aria-invalid`; focus to the field; nothing sent. |
| **Busy** | Confirm shows `Working…` (ConfirmDialog, `opacity .55`, `not-allowed`); select/textarea `disabled`; Go back/X disabled, Esc ignored (`lockWhileBusy`). Pressed feedback ≤100 ms (state flips synchronously on click). |
| **Inline error** | Banner above the footer (§7), fields re-enabled, focus stays on Confirm, banner `role="alert"`. |
| **Success** | Dialog unmounts (§5.2). |
| **Disabled** | Only while busy (above). There is no other disabled-confirm state by design. |

### 6.3 Empty / "nothing to show" states
There is no list in this feature. The relevant empties: no `codConversion` → no note strip (Payment card unchanged); `by.email` missing → "an admin"; `note` absent → note line omitted; wallet 0 → wallet row omitted.

### 6.4 Refresh behaviour (avoid the spinner-remount trap)
`fetchOrderDetails` currently toggles `isLoading`, which replaces the scroll body with a spinner (resets scroll, unmounts refs). For this feature add a `silent` option: when an order is already loaded, **skip `setIsLoading(true)`** and swap data in place. Use it for the post-success refresh and the network-uncertain refresh (§7). (Recommended for the SSE path too, but that's a separate cleanup — out of scope, flag only.)

---

## 7. Error mapping (API → UI)

Read the machine code with `apiErrorCode(err)` and HTTP status with `apiErrorStatus(err)`; **branch on `code`, never on message text**. Server `msg` is appended as a "detail" line only where it carries specifics (item name, balance). `scope: inline` = dialog stays open, banner shown; `scope: stale` = dialog closes, silent refetch, persistent notice (§6.1) + `toast.error(short)`.

| HTTP / code | Scope | Headline (banner or notice) | What the admin does next (2nd line) |
|---|---|---|---|
| network error / timeout (no response) | inline | **`Couldn't confirm the result.`** Silently refetch the order first: if `codConversion` now exists → treat as **success** (§5.2). Otherwise show: | `Nothing was changed. Check your connection and try again.` |
| 5xx / no code | inline | **`Something went wrong on our side. Nothing was changed.`** | `Try again in a minute. If it keeps happening, contact tech support with order #HP581915100.` |
| 400 `INVALID_REASON` / `NOTE_REQUIRED` | inline (map to field) | Field error per §5.1.2 (should be unreachable — client validates) | Fix the field. |
| 400 `WALLET_SHORT` | inline | **`The customer's wallet no longer has enough balance to take the ₹200 back.`** + server detail | `Ask the customer to add money to their wallet, then try again. Or leave the order cancelled.` |
| 400 `OUT_OF_STOCK` | inline | **`Some items are out of stock, so the order can't be reopened.`** + server detail (item names) | `Restock the item(s), then try again. Or leave the order cancelled.` |
| 422 `SLOT_UNAVAILABLE` | inline | **`The delivery slot for this order is now full.`** | `Ask the customer for a new slot, or leave the order cancelled.` (Slot re-booking is not part of this action.) |
| 400 `UNCLAWED_REFUND` | stale | **`A refund was already issued on this order, so it can't be switched to cash.`** | `Cancel the order instead.` |
| 409 `PAYMENT_ALREADY_CAPTURED` | stale | **`The customer just paid online — this order is now paid, so it stays as it is.`** | `Do not collect cash. The order will go ahead as a paid order.` |
| 409 `STATUS_NOT_CONVERTIBLE` | stale | **`This order can no longer be switched to cash — its status changed.`** (append current status from the refetch: `It is now OUT_FOR_DELIVERY.`) | `Check the order status and act from there.` |
| 409 `ORDER_CHANGED` | stale | **`This order changed while you were working on it.`** | `The details on screen are refreshed. Review them and try again if it still applies.` |
| 200 `alreadyConverted` | success | see §5.2 #2 | — |
| 403 `APPROVAL_REQUIRED` | stale | **`Orders above ₹5,000 must be switched to Cash on Delivery by a super admin.`** | `Ask a super admin to do it.` (the refetch leaves the button in the blocked state with the same helper) |
| 403 `STORE_CONTEXT_REQUIRED` / `FORBIDDEN_STORE` | stale | **`This order belongs to a different store.`** | `Switch to that store from the top bar, or ask a super admin.` |
| 403 (no code — permission revoked) | stale | **`You don't have permission to switch orders to Cash on Delivery.`** | `Ask your store admin to grant "Switch to COD" on the Team page.` |
| 404 `ORDER_NOT_FOUND` | stale | **`This order no longer exists.`** | `Close this window and refresh the orders list.` |
| any other 4xx | inline | server `msg` via `apiErrorMessage(err, 'Couldn\'t switch this order to Cash on Delivery.')` | — |

Error banner style (inline): row `display:flex; gap:0.55rem`, `AlertTriangle` 16px `--danger` (icon only), bg `rgba(239,68,68,0.1)`, border `1px solid rgba(239,68,68,0.3)` (same values as ConfirmDialog's danger tints), radius-md, padding `0.75rem 0.9rem`; headline `0.85rem/600 --text-primary`, next-step `0.8rem --text-secondary`. **Stale** notices use the amber strip instead (they are informational: the world changed, not the admin's mistake). `role="alert"` for inline banners; `role="status"` for the panel notice.
Never auto-dismiss an error in a place the admin has to read; the 4 s toast is a duplicate short pointer only (`toast.error(headline)`).

---

## 8. Interaction details

- **Feedback:** button press → dialog open ≤100 ms (no request needed). Confirm click → `Working…` in the same frame. **No optimistic update** for the payment method (money + server-side stock/wallet transaction that can legitimately fail); the block only changes after the server answers.
- **Hover / press / focus (trigger):** hover `background: var(--warning-soft)`; active `background: rgba(217,119,6,0.22)` no transform; `:focus-visible` `outline: 2px solid var(--warning-text); outline-offset: 2px`. Inline styles can't express `:hover/:focus-visible`, so use a **scoped `<style>`** block in the modal (`.cod-switch-btn`, precedent: page-grid scoped styles) with `transition: background-color 120ms ease-out;` and `@media (prefers-reduced-motion: reduce){ .cod-switch-btn{ transition:none } }`.
- **Confirm button:** `--warning-fill`, hover `#92400e`, same focus ring style as ConfirmDialog buttons, disabled-look only while busy.
- **Dialog motion:** none added (ConfirmDialog has none; keep — nothing to gate under reduced motion). The optional note flash (§5.3) is the only animation and is off under `prefers-reduced-motion`.
- **Destructive-confirmation pattern:** this is a *considered-risk* action, so: explicit exact amount, forced reason, "cannot be undone from here", and the `tone="warning"` header — no typed-confirmation, no checkbox (§5.1).
- **Re-entrancy:** `isSaving` also covers this action, so Update Status / Assign / Edit Items are disabled while the request is in flight, and vice-versa the trigger is `aria-disabled` while they run. A double-click can't double-submit (dialog busy + server idempotency).
- **Stale-while-open:** if the SSE refetch changes the order while the dialog is open, the dialog stays (state is outside the loading branch). The server's conditional write is the guard; a resulting 409 lands in §7.
- **Keyboard:** Tab order inside dialog = (ConfirmDialog trap) Close X → Reason → Note → Go back → Confirm, wraps. Focus starts on Reason. Esc = Go back (blocked while busy). Enter on the select opens it (native); Enter in the textarea = newline; Confirm is reached by Tab (deliberate: no accidental Enter-submit on a money action). Focus returns to the trigger on cancel; on success moves to the converted line (§5.2 #4).

---

## 9. Accessibility

- **Contrast (WCAG 2.2 AA, measured):** confirm white on `#b45309` 5.02:1 (both themes); trigger text `#92400e` on white 7.09:1 (light), `#fbbf24` on `#1a1a1a` 8.9:1 / `#242424` 9.3:1 (dark); strip copy uses `--text-primary` (≥12.8:1 on the soft tint); helper `--text-secondary` on white 4.83:1 (light) / 5.94:1 on `#242424` (dark) — do not go lighter/smaller than 0.72rem. Error text is `--text-primary` beside a red icon, so it never depends on red-on-tint contrast. Meaning is never colour-only: every state has words ("Cash to collect", "not paid", "required").
- **Targets:** trigger `min-height: 40px`, full column width (≥ 24×24 per 2.5.8; ≥ 40 for a money action on touch). Dialog buttons ConfirmDialog default (`0.7rem` padding ≈ 40px). Select/textarea use `inputStyles` (≈ 40px).
- **Dialog semantics:** ConfirmDialog already gives `role="dialog"`, `aria-modal="true"`, `aria-label={title}`, Esc, focus trap, focus return. Add `aria-describedby` (`describedById`) so the money sentence is read on open. Note: the outer order modal has no dialog role/trap — pre-existing, out of scope; the inner trap covers this flow.
- **Labels:** `<label htmlFor>` for Reason and Note (visible), the `required`/`optional` text is inside the label. Counter is `aria-hidden` except the 280/300 announcements. Icons are decorative (`aria-hidden`); the trigger's accessible name is its visible text (label-in-name satisfied — do **not** override with a longer `aria-label`). Cash box has the single-sentence `aria-label` in §5.1.1.
- **Blocked state:** `aria-disabled="true"` + `aria-describedby="cod-helper"` (helper always in the DOM and visible) — screen-reader and keyboard users get the reason without hover.
- **Live regions:** inline banner `role="alert"`; converted line and stale notice `role="status"`. The toast is supplementary (Toaster has no live region — optional separate fix: add `role="status" aria-live="polite"` to its container; not required by this spec).
- **Focus order in the panel:** status select → (reason inputs) → Update Status → **Switch to Cash on Delivery** → Assign rider column. Natural DOM order, no `tabindex > 0`.
- **Reduced motion:** no essential motion; hover transition and the optional flash are disabled under `prefers-reduced-motion: reduce`. The busy state uses text ("Working…"), not a spinner, so nothing rotates.
- **Theming:** all colours via CSS variables (§3.1) → correct in `data-theme="dark"` and `"light"`; the light theme's white-on-white panel/inputs are separated by 1px `--border-color` borders (not fills).

---

## 10. Responsive

| Viewport | Behaviour |
|---|---|
| ≥ 900 px (modal at max 900) | Manage Status is the left half of the auto-fit grid (~ 380-400px wide): block as §2.1. Dialog 520px centred. |
| 481-768 px | Grid `auto-fit minmax(240px,1fr)` stacks Manage Status over Assign Rider; block full width; dialog `width:100%` up to 520, overlay padding 1.5rem. |
| ≤ 480 px | Existing global rules apply (`.page-content` forms max-width 100%, flex rows wrap). Dialog body ~264px text width: the cash box amount row uses `flex-wrap: wrap; justify-content: space-between` so a long label never truncates the amount; the sentence wraps naturally; the dialog footer already wraps (`flex-wrap`) → **Go back** stacks above **Switch to Cash on Delivery** (primary action lowest, in thumb reach); buttons `flex: 1 1 100%` under 480 px via the scoped `<style>` (ConfirmDialog footer is shared — add the class only through a wrapper if it must not affect other dialogs; otherwise leave the default wrap, which is acceptable). Textarea `rows=3`, `resize: vertical`, `max-width:100%`. Dialog body scrolls (`overflowY:auto`, `maxHeight:90vh` already) so the footer stays reachable with the on-screen keyboard open. |

Platform note: web-admin only. No Android/iOS change (rider app unchanged per plan §2.4).

---

## 11. Audit-trail labels (`src/utils/orderAudit.ts`)

Add to `AUDIT_ACTION_LABELS` (style = short sentence-case noun phrase, same as "Order reopened"):

| Action | Label |
|---|---|
| `order.convert_to_cod` | `Switched to Cash on Delivery` |
| `order.cod.late_capture_refunded` | `Online payment refunded (after COD switch)` |

Detail column (`auditActionDetail`) additions — needs backend to write these `metadata` keys (**dependency: tell sumit-backend/hemant-payments**): `reasonCode`, `note`, `mode`, `cashToCollect`, `originalStatus`; the late-capture row already fits the existing `refundAmount` → `₹X to wallet` rule.

- `order.convert_to_cod` → `{short reason label} · ₹{cashToCollect} cash to collect{ · "{note}"}` — e.g. `Payment failed, customer pays cash · ₹2,124 cash to collect · "Customer called, will pay cash at the door"`. Unknown/absent `reasonCode` → omit that segment; if nothing available → existing `—`.
- `order.cod.late_capture_refunded` → existing generic output (`₹2,124 to wallet`).
- Actor column: existing `auditActor` (email) — no change. Mode A writes both `order.reopen` ("Order reopened") **and** `order.convert_to_cod`; show both, do not dedupe (accurate history).
- The `order-activity` page uses the same helpers, so both surfaces update from this one file. Update the empty-trail copy? No (it already says "…cancels, refunds…"; leave).

---

## 12. Final copy sheet (all user-visible strings)

| Where | String |
|---|---|
| Block label | `PAYMENT` |
| Payment line | `Online (Razorpay) — not paid` |
| Trigger button | `Switch to Cash on Delivery` |
| Helper, Mode A | `Payment was not completed. This also reopens the order.` |
| Helper, Mode B | `Payment is still pending online. The customer will pay cash to the rider.` |
| Blocked — out for delivery | `The rider is already on the way, so the payment method can't be changed now.` |
| Blocked — over limit | `Orders above ₹5,000 must be switched to Cash on Delivery by a super admin.` |
| Blocked — refund issued | `A refund was already issued on this order, so it can't be switched to cash. Cancel the order instead.` |
| Blocked — unsaved status | `Save or undo the status change above first.` |
| Converted line | `Switched to Cash on Delivery. The rider collects ₹2,124.` |
| Dialog title | `Switch to Cash on Delivery?` |
| Dialog sentence | `Switch order #HP581915100 to Cash on Delivery? The rider will collect ₹2,124 at the door. This cannot be undone from here.` |
| Cash box | `Cash to collect` · `Already paid from wallet` (B) · `Wallet coins to be taken again` (A) |
| Section label | `What happens` |
| Bullets | see §5.1.1 table |
| Reason label / placeholder | `Reason (required)` / `-- Select a reason (required) --` |
| Reason options | `Payment failed — customer will pay cash` · `Customer asked to pay cash` · `Store decision` · `Other (note required)` |
| Note label / placeholder | `Note (optional)` / `Note (required for Other)` · `e.g. Customer called, will pay cash at the door` |
| Validation | `Please select a reason.` · `Please add a note explaining "Other".` |
| Buttons | `Go back` · `Switch to Cash on Delivery` · `Working…` |
| Toast A | `Order #HP581915100 reopened and switched to Cash on Delivery. Rider will collect ₹2,124.` |
| Toast B | `Order #HP581915100 is now Cash on Delivery. Rider will collect ₹2,124.` |
| Toast repeat | `This order is already Cash on Delivery.` |
| Badge | `CASH TO COLLECT ₹2,124` · `CASH COLLECTED` · `CASH NOT COLLECTED` |
| Persistent note | `Switched to Cash on Delivery by {email} on {date} — {reason}` + optional `"{note}"` |
| Late-capture strip | `The customer also paid online after this switch. That payment was refunded to their wallet (see Wallet refunds below). Still collect ₹2,124 in cash.` |
| Errors | §7 table (headline + next step) |
| Audit labels | `Switched to Cash on Delivery` · `Online payment refunded (after COD switch)` |
| Permission grid column | `Switch to COD` |

---

## 13. Build notes / test hooks for tanmoy-web

- **Files touched:** `OrderDetailsModal.tsx` (block, dialog wiring, Payment-card badge + note, silent refetch), new `convertToCod.ts` + test, `ConfirmDialog.tsx` (4 optional props + warning tokens), `index.css` (4 tokens × 2 themes), `orderAudit.ts`, `constants/permissions.ts`, `PermissionGrid.tsx`. Optional: `OrdersList.tsx` payment-cell line.
- **Callers to grep before merging the `ConfirmDialog` change (project no-regression rule):** `ProductsList.tsx` (×2), `GiftTiersPanel.tsx`, `DiscountsPage.tsx`, `BelowCostConfirmModal.tsx`, `CouponsPage.tsx`, `SlotSettingsPage.tsx`, `MaintenanceFields.tsx`, `ImageEditorModal.tsx`, plus `ProductsList.test.tsx`. New props are optional; only `tone="warning"` visuals change (BelowCost).
- **Unit tests (`convertToCod.test.ts`):** the §2.3 matrix — one case per row incl. each Mode A/B status, `price` exactly `5000` (allowed) vs `5000.01` (blocked for store_admin, allowed for super_admin), wallet order (`price 800`, `walletUsed 200` → cash 800, never 600), unclawed-refund gate, unsaved-status gate; `validateCodSubmission`; `mapCodError` for every row of §7; `formatInr`.
- **Component tests (`OrderDetailsModal.test.tsx`):** note the 5 known-failing router-context tests in that file are the baseline — add new tests without depending on `Link`-rendering paths or mock `react-router-dom` for them. Suggested `data-testid`s: `cod-payment-block`, `cod-switch-btn`, `cod-helper`, `cod-converted-line`, `cod-confirm-dialog`, `cod-reason`, `cod-note`, `cod-error`, `cod-conversion-note`.
- **Manual QA on dev (both themes, ≤480px and desktop):** abandoned Razorpay order → Mode A incl. wallet coins; already-ASSIGNED order (the HP581915100 shape) → Mode B; ₹6,000 order as store_admin (blocked) and super_admin (allowed); out-for-delivery (blocked); double-click; concurrent capture (409 path); keyboard-only run; screen-reader run of the dialog open + error.
- **Open dependencies on backend (flag to rahul):** (1) audit `metadata` keys in §11; (2) response fields `mode`, `cashToCollect`, `alreadyConverted`, and `codConversion` on the order returned by `GET /admin/order/:id` (plan §4.4 projection check); (3) error `code`s exactly as in plan §5.1 (FE branches on them); (4) the customer/rider notification bullets in §5.1.1 only if actually shipped.
