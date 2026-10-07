# Return to Supplier — Design Spec (haper-admin)

Status: DESIGN SPEC, aligned to `supplier-return-final-spec.md` (authoritative; §8 design deltas applied here). Author: Chanchal. Date: 2026-10-05.
Target: web only (`haper-admin`). No Android / iOS surface. Fictional example data only.
Implementers: tanmoy-web (FE). Where this file and the final spec disagree, the final spec wins. Former backend mismatches (old §13) are resolved in section 13 below.

Rule of the whole design: **a manager returning 12 crushed packs should finish in about 4 clicks, and never have to read instructions.**

---

## 0. What exists today (checked in code, 2026-10-05)

| Thing | Fact | Consequence |
|---|---|---|
| `pages/Warehouse/ui.tsx` | exports `card, btn(primary/ghost/danger), input, th, td, StatusPill, StatusLegend, Modal(title,onClose,wide?,width?), PageHeader, errMsg, Barcode, IdentityCell` | Reuse all. **Do not edit `Modal`** (app-wide in Warehouse). Additive exports elsewhere are not needed. |
| `Modal` | fixed overlay, NO backdrop-click close (good for forms), no `role="dialog"`, no Escape, no focus trap, widths 460 / 720 / custom `width` | New modals add their own Escape handler + focus handling inside their own component (section 11). Do not patch Modal. |
| Theme | CSS vars in `src/index.css`: `--bg-primary, --bg-secondary, --bg-panel, --text-primary, --text-secondary, --border-color, --accent-primary/-hover/-text/-soft/-border/-on, --danger, --success, --radius-md/-lg`, and `--warning-fill/-text/-soft/-border` (amber, AA-safe, exists in both themes) | **No new tokens.** Dark + light both work automatically via vars. |
| Money/date | `fmtTotal` (en-IN, 2dp, local to VerifyBillPage — "₹0.00" stays "₹0.00"), `fmtDate`, `fmtDateTime` in `utils/date.ts` | Money always `₹1,234.50`; never collapse zero to a dash. Dates `5 Oct 2026` / with time `5 Oct 2026, 4:30 pm` via the existing helpers. |
| Toasts | `toast.success / toast.error` from `stores/toastStore`; `errMsg(e)` extracts server message | Use for transient confirms. Errors that block work stay inline (never toast-only). |
| Statuses | `statusMeta.ts` flat map keyed by raw value; `PENDING`, `RECEIVED`, `CANCELLED` already used by replenishment/transfers | **Do not add credit statuses to `ALL_STATUSES`/`StatusPill`** (key collision would change existing pills' help text). New dedicated chip, section 4. |
| Verify Bill | filter bar card, StatTile ×3, table with expandable row, `canManage = can(PERMISSIONS.WAREHOUSE.MANAGE)`, Prev/Next + PageJump pager, "Loading bills…" card, empty + error cards with "Try again" | Mirror structure and copy tone on the new list page. |
| Menu | `hooks/useMenu.ts` section "Inventory & Warehouse"; items carry `keywords`; `MenuSearch.tsx` builds its palette FROM `useMenu().visibleItems` | **No separate MenuSearch registration** — adding the menu item (with keywords) is enough. |
| Routes | `App.tsx`: role-gated group `requireRole={['super_admin','warehouse_manager','warehouse_staff']}` hosts `/warehouse/verify-bill` etc. | New route goes in that same group. |

---

## 1. Users and jobs

- **Warehouse manager / super admin** (writers): "Part of a delivery is bad. Send it back, and make sure the supplier pays us." Often standing at the dock with the supplier's driver, on a laptop or tablet.
- **Warehouse staff** (read-only): "Did the Tuesday return go through? Is that lot still here?" No write buttons anywhere.

---

## 2. User flow

### 2.1 Create (primary)
Entry A — Verify Bill: bill row -> **Return** -> modal opens with warehouse/supplier/bill filled, every bill line listed unticked.
Entry B — Recall page: lot row (HOLD/RECALL, qty > 0) -> **Return to supplier** -> modal opens with warehouse, supplier (the lot's supplier), product, lot, full qty and reason "Recall" filled.
Entry C — Supplier Returns page -> **New return** -> empty modal.

1. Modal opens on **step 1 "Details"** (one scrolling form, no wizard tabs).
2. (C only) Warehouse auto-set if the user has one; else pick. Pick **Supplier** (required).
3. (Optional) Pick **Bill**. Bill chosen -> its items appear as a tick-list; otherwise use **Add item** search.
4. Per item: confirm **Lot** (auto-picked when there is only one or when it matches the bill), set **Qty**, choose **Reason** (or use "Reason for all items"), adjust **Credit per unit** if needed.
5. Click **Review return** (inline validation runs on click; first problem is scrolled to and focused).
6. **Step 2 "Review"** (same modal, read-only summary): supplier, bill, lines, totals, "stock leaves immediately" notice. Buttons: Back / **Confirm return**.
7. Confirm -> button locks ("Returning…") -> success pane inside the modal: "Return SR000007 recorded" with **View return** and **Done**.
8. Failure exits: any server error returns the user to step 1 with the problem shown on the offending line (section 8); nothing was saved. Network error: stays on review with "Try again" (same `clientRequestId`, so it cannot double-submit).
9. Abandon: ✕ with items entered -> inline "Discard this return? Nothing has been saved." [Keep editing] [Discard].

Click count, bill case with one reason for all: Return (1) -> tick items (n) -> reason for all (1, select) -> Review (1) -> Confirm (1). Free case: New return, supplier, search+pick item, reason, Review, Confirm.

### 2.2 Record a refund (a return can have several)
List row **Record refund** (or Detail -> **Record refund**) -> modal. Amount is prefilled with the REMAINING amount (expected - already received). The user must still pick the date (blank, required) and the mode (none preselected), and for Bank transfer / Credit note adjusted type the reference. Minimum: list row -> Record refund (1) -> date (1-2) -> mode (1) -> reference (type) -> Save (1). The two "must state" fields are deliberate: the date and mode are facts only the human knows, so we never guess them.
1. Supplier pays part now: enter/keep the amount, date, mode, Save. The return stays "Part received ₹X"; the same button is still there for the next refund.
2. Supplier pays the rest later: the amount prefills with what is left.
3. Supplier will never pay the rest: tick **Close this return - supplier will not pay the rest** (shown only when the amount is short) and add a note. The return becomes Received, "₹X short". **Reopen** brings it back to pending.
4. Supplier pays more than expected (for example GST added): the form shows an amber line; the user must tick **Yes, supplier paid more than expected** and add a note before Save is enabled.
5. Wrong entry: Detail -> **Undo** on that refund -> short reason -> done. The refund stays in the list, greyed, as VOIDED. It is never deleted.
6. Supplier will not give any credit: second radio **Supplier won't give credit** (only while no refund exists) -> note -> Mark as no credit. **Reopen** undoes it.

### 2.3 Cancel
Detail -> **Cancel return** -> confirm modal (reason required) -> done. Cancel is available only while there is no ACTIVE refund (also when "No credit expected"). If a refund exists the button is disabled with visible text "To cancel, first undo the recorded refunds." Undo each refund first (Detail -> Undo, reason), then cancel.

---

## 3. Information architecture

- **Sidebar**: section "Inventory & Warehouse", directly **after Verify Bill** (same job family: bills in, goods back out). Label `Supplier Returns`, path `/warehouse/supplier-returns`, icon `Undo2` (lucide; not used elsewhere in the menu — `PackageX`/`PackagePlus` are taken). `requireAnyRole: ['super_admin','warehouse_manager','warehouse_staff']` (read gate per plan Q7; keep the list character-for-character in sync with the route in App.tsx, as the other entries do). Keywords: `supplier return, return to supplier, send back, vendor return, return stock, credit note, supplier credit, refund, damaged, expired return, recall return, debit note`. This single entry also registers it in MenuSearch (no extra work). Add a case to `useMenu.test.ts` (visible to the three roles, hidden to store roles).
- **Route**: `/warehouse/supplier-returns` inside the existing role-gated group. Optional query `?q=<invoice or SR id>&credit=PENDING` so Verify Bill badges can deep-link.
- **Write gate in UI**: `canWrite = can.role('super_admin','warehouse_manager') && can(PERMISSIONS.WAREHOUSE.MANAGE)` (mirrors the server exactly; staff get read-only; the role check matters because store admins bypass permission checks). Staff never see: New return, Record refund, Cancel, Undo, Reopen, Return (Verify Bill), Return to supplier (Recall).

---

## 4. Design tokens (all existing)

**Spacing** (rem, as the rest of Warehouse): 0.25 · 0.35 · 0.5 · 0.6 · 0.75 · 1. Card padding 1; gap between cards/filters 0.75; section gap in modals 0.9; line-card inner gap 0.6.
**Type**: page title 1.4rem; modal title 1.05rem (Modal's own); body 0.85rem; field label 0.78rem `--text-secondary`; table header 0.72rem uppercase 0.04em (`th`); helper/caption 0.72–0.76rem; chip 0.7rem/600; tile figure 1.05rem/600; SR ids and batch numbers `monospace`. Numbers: right-aligned, `font-variant-numeric: tabular-nums`.
**Radius**: `--radius-md` (inputs, buttons, cards); chips 999.
**Surfaces**: modal/cards `--bg-secondary` + `--border-color`; nested/inset blocks (line cards inside modal, expanded lot list, credit block) `--bg-primary` + `--border-color`. NOTE: in light theme `--bg-secondary` == `--bg-panel`, so separation relies on the border, never the fill alone.
**Buttons**: `btn('primary')` for the single next action, `btn('ghost')` for everything else, `btn('danger')` only for "Yes, cancel return". Pre-existing issue (not introduced here): white on `#ef4444` is 3.76:1; keep for consistency and raise a separate ticket for a global fix.
**Control size (new feature only, inline)**: inputs/selects/stepper buttons min-height 40px (at <=640px: 44px). Existing 36px inputs stay elsewhere.

**Chips** — new `SupplierReturnChip` (see section 5). All text colours pass AA in both themes because TEXT uses `--text-primary`/`--text-secondary`/`--accent-text`/`--warning-text`; the colour meaning is carried by an icon + tinted fill + border, and by the label itself (never colour alone).

| Chip label | Used for | Fill | Border | Text | Icon (14px) |
|---|---|---|---|---|---|
| Credit pending | creditStatus PENDING, receivedAmount 0 | `--warning-soft` | `--warning-border` | `--warning-text` | Clock |
| Part received ₹80.00 | creditStatus PENDING and receivedAmount > 0 (display label only, not a stored state) | `--warning-soft` | `--warning-border` | `--warning-text` | Clock |
| Credit received | RECEIVED, received >= expected (if more, the detail says "₹10.00 more than expected") | `color-mix(in srgb, var(--success) 14%, transparent)` | `color-mix(in srgb, var(--success) 40%, transparent)` | `--text-primary` | Check, stroke `--success` |
| Received · ₹16.00 short | RECEIVED, received < expected (closed short) | `--warning-soft` | `--warning-border` | `--warning-text` | AlertTriangle |
| No credit expected | NOT_EXPECTED | transparent | `--border-color` | `--text-secondary` | MinusCircle |
| Cancelled | status CANCELLED | transparent | `--border-color` | `--text-secondary`, label has `text-decoration: line-through` NOT used (keep readable) | Ban |
| Returned | status RETURNED (detail header only) | `--accent-soft` | `--accent-border` | `--accent-text` | Undo2 |

Why not the shared `StatusPill`: its raw-value lookup collides (PENDING/RECEIVED/CANCELLED already mean replenishment/transfer states) and its coloured text fails light-theme AA (e.g. `#eab308`). Lot status in the lot picker DOES reuse `StatusPill` (AVAILABLE/HOLD/RECALL) — that is the existing convention on Recall and Item Lookup.
List-row rule (two statuses, one channel each): the list has ONE "Status" column — shows the credit chip normally, and the Cancelled chip when the return was cancelled (credit is meaningless then). The detail header shows both (Returned + credit chip, or Cancelled).

`statusMeta.ts` additions (new exports only, NOT appended to `ALL_STATUSES`): `SUPPLIER_RETURN_REASONS` (value/label/description), `SUPPLIER_CREDIT_STATUSES` (for the list's `StatusLegend`), `SUPPLIER_CREDIT_MODES` (3 modes above).

**Reasons** (fixed order; value -> label -> one-line help shown in the select's `title` and legend):
DAMAGED "Damaged" · EXPIRED "Expired" · RECALL "Recall" · WRONG_ITEM "Wrong item" · QUALITY "Quality issue" · EXCESS "Excess (ordered too much)" · OTHER "Other (add a note)".

**Credit modes** (UI label -> API value, final spec D12): "Cash" -> `CASH` · "Bank transfer" -> `BANK` · "Credit note adjusted" -> `CREDIT_NOTE_ADJUSTED`. Do not reuse the receipt-payments label map; it is a different vocabulary on purpose.
**Refund status** (per refund entry): ACTIVE (normal) · VOIDED (greyed, text "Undone", never counted).

---

## 5. Component inventory

| Component | New/Reuse | Props / variants |
|---|---|---|
| `Modal`, `PageHeader`, `card`, `btn`, `input`, `th`, `td`, `StatusPill` (lots only), `StatusLegend`, `Barcode`, `IdentityCell`, `errMsg`, `WarehousePicker` | Reuse as-is | — |
| `SupplierReturnsPage.tsx` | New | route component; state: warehouseId, supplierId, creditFilter (`'' | PENDING | RECEIVED | NOT_EXPECTED | CANCELLED`; CANCELLED maps to API `status`, the others to `creditStatus`), q, fromDate, toDate, page |
| `NewSupplierReturnModal.tsx` | New | `{ warehouseId?, prefill?: { supplierId?, invoiceNumber?, lines?: {sku,batchNo?,qty?,reason?}[] }, onClose, onDone(return) }`; internal steps `'details' | 'review' | 'done'` |
| internal: `BillPicker`, `ProductSearch`, `ReturnLineCard`, `LotList` | New (private to the modal file(s)) | `ReturnLineCard`: `{ line, mode: 'bill'|'free', batchMode, onChange, onRemove, error }` |
| `SupplierReturnDetailModal.tsx` | New | `{ returnId, canManage, onClose, onChanged }`, `wide` |
| `RecordRefundModal.tsx` | New (replaces the earlier MarkCreditModal; model on `MarkAsPaidModal`) | `{ ret, onClose, onDone }`; reads `ret.rev` and sends it as `expectedRev` |
| `CancelReturnModal` (inside detail file) | New | `{ ret, onClose, onDone }`, width 460 |
| internal (detail file): `RefundRow`, `UndoRefundInline`, `ReopenInline` | New (private) | `RefundRow`: `{ refund, canWrite, onUndo }` — voided variant greyed |
| `SupplierReturnChip.tsx` | New | `{ kind: 'credit'|'status', status, receivedAmount?, expectedAmount? }`; derives "Part received" when PENDING and received > 0 |
| `src/utils/apiError.ts` | Additive | `apiErrorReason(e)`, `apiErrorDetails(e)`; the form maps errors by `reason` + `details.lineIndex`, never by message text or numeric `code` |
| `StatTile` | Duplicate locally (copy of the small VerifyBillPage function) | `{ label, value, sub?, color? }` — do not touch VerifyBillPage/ui.tsx; arijit-frontend-arch may extract later |
| `supplierReturn.ts` (+test) | New | pure helpers (plan Phase 2): round2 credit maths, shortfall, line validation, reason helpers |
| `statusMeta.ts` | Additive | reasons + credit meta |
| Verify Bill, Recall, `useMenu.ts`, `App.tsx`, `LedgerPage.tsx` | Small additive edits | section 10 |

Align with arijit-frontend-arch notes if they exist at build time; this spec only fixes look and flow.

---

## 6. Screens

### 6.1 Supplier Returns list — `/warehouse/supplier-returns`

```
Supplier Returns                                              [ + New return ]   <- manager/super only
Goods you sent back to suppliers, and the credit they owe you.   (staff: "View only")

┌ filter card ────────────────────────────────────────────────────────────────┐
│ Warehouse*        Supplier           Return no. or bill no.   From      To   │
│ [Main DC  ▾]      [Any supplier ▾]   [🔍 SR0000… / INV-…  ]   [date]   [date]│
│ [All] [Credit pending] [Credit received] [No credit expected] [Cancelled]   │  <- chip row (single-select)
└─────────────────────────────────────────────────────────────────────────────┘
┌ CREDIT PENDING ─┐ ┌ CREDIT RECEIVED ┐
│ ₹4,820.00       │ │ ₹12,300.00      │                         [▸ What do these mean?]
│ 6 returns       │ │ 14 returns      │
└─────────────────┘ └─────────────────┘
┌ table ──────────────────────────────────────────────────────────────────────┐
│RETURN NO.  DATE        SUPPLIER        BILL      REASON   UNITS  EXPECTED  STATUS            │
│SR000007   5 Oct 2026  Sample Foods    INV-0042  Damaged     12  ₹216.00  (⏱ Credit pending) [Record refund] ▸│
│SR000006   2 Oct 2026  Demo Dairy      —         Mixed (3)   40  ₹1,040.00 (⏱ Part received ₹400.00) [Record refund] ▸│
│SR000008   3 Oct 2026  Demo Dairy      INV-0033  Damaged      9  ₹120.00  (✓ Credit received)        ▸│
│SR000005   28 Sep 2026 Sample Foods    INV-0039  Expired      6  ₹90.00   (⚠ Received · ₹10.00 short) ▸│
│SR000004   20 Sep 2026 Demo Dairy      INV-0031  Wrong item   3  ₹54.00   (Cancelled)  (row text muted)  │
└─────────────────────────────────────────────────────────────────────────────┘
                                              ‹ Prev   Page 1 of 3   Next ›
```

- **Defaults**: warehouse = the user's only/first warehouse (WarehousePicker, same as Verify Bill); chip = All; sort newest first (server default). Credit-pending is the one chip people live in, so it is the second chip.
- **Filters** apply instantly (search debounced 300ms); changing any filter resets to page 1 (same render-phase reset as Verify Bill).
- **Tiles**: "Credit pending" (amount still owed = sum of expected minus received over pending returns, sub "N returns") and "Credit received" (amount actually received, sub "N returns"). Computed server-side (`stats`), NOT narrowed by the status chips (same rule as Verify Bill), but they DO follow warehouse/supplier/search/date — put a one-line caption under the tiles only when a chip is active: "Totals ignore the status filter above." Pending amount uses `--warning-text`; received uses `--text-primary` (no green text — contrast). Cancelled returns are excluded.
- **Table columns / alignment**: Return no. (mono, left) · Date (left, `fmtDate`) · Supplier (left; hidden when a supplier filter is set, like Verify Bill) · Bill (mono; "—" if none) · Reason (single reason label, or "Mixed (n)" with the full list in `title`) · Units (right) · Expected credit (right) · Status (chip) · action cell.
- **Row**: whole row clickable -> Detail; `cursor: pointer`; hover `background: var(--accent-soft)`; also keyboard-reachable through the trailing ▸ button (`aria-label="Open return SR000007"`), same as Verify Bill's expander. `Record refund` ghost button (writers only, creditStatus PENDING, status RETURNED) stops propagation and opens RecordRefundModal directly — this is the short path. It stays visible on "Part received" rows so the second refund is just as quick. Rows closed as RECEIVED or NOT_EXPECTED have no row button (open Detail to Reopen).
- **Cancelled rows**: all cell text `--text-secondary`; chip "Cancelled"; no Record refund.
- **Pager**: reuse the Prev / page-jump / Next pattern from Verify Bill (copy the small `PageJump` if not exported; do not edit VerifyBillPage).
- **Legend**: `StatusLegend` below the tiles: "What do these mean?" -> Credit pending: "Goods have gone back; the supplier has not paid us back yet." Part received: "The supplier has paid some of it; the rest is still owed." Credit received: "The supplier has given the money or credit." Received · short: "The supplier paid less than we expected." No credit expected: "The supplier will not pay for these (a note says why)." Cancelled: "Recorded by mistake; the stock went back into the warehouse."

**States**
- Loading (first load): `aria-busy` card with 5 skeleton rows (bars filled with `var(--border-color)` at 50% opacity — visible in both themes; pulse 1.2s ease-in-out, disabled under `prefers-reduced-motion`), plus SR text "Loading supplier returns…". Refetch on filter change: keep old rows, show the existing 20px right-aligned "Updating…" line with 180ms fade (as Verify Bill) — no skeleton flash.
- Empty (never any return in this warehouse): card, centered: heading "No supplier returns yet", body "When you send goods back to a supplier, record it here so the stock is correct and you can track the money owed to you.", primary **New return** (writers) — staff see only the text.
- Empty (filters match nothing): "No returns match these filters." + ghost **Clear filters**. If a date range is set add: "Try a wider date range."
- Error: card, `role="alert"`: "Couldn't load supplier returns. Check your connection and try again." + ghost **Try again** (refetches; never claims "no returns").
- Success: new row appears at top after create (when the user came from this page) with a 2s `--accent-soft` flash, no motion under reduced-motion.
- Disabled: **New return** hidden for staff (not disabled); if no warehouse selected: disabled with caption "Choose a warehouse first".
- Responsive: filters `flex-wrap` (each field `flex: 0 1 <w>; min-width`), chips wrap; tiles wrap; table in `overflowX:auto` wrapper with `minWidth: 880px`; at <=640px the action cell stays visible by making Return no. column `position: sticky; left: 0; background: var(--bg-secondary)` with a right border (per-cell borders, since `border-collapse` + sticky needs separate-border handling — use `borderCollapse: 'separate'`, `borderSpacing: 0`, cell-level `borderBottom`). Check haper-admin's mobile stylesheet does not string-match on the inline styles you add.

### 6.2 New return modal — `Modal width={880}`, title "New return to supplier"

Step 1 "Details". Body is a single scroll area; a **sticky footer** (position: sticky; bottom: 0; `--bg-secondary`; top border `--border-color`; padding 0.75rem 1rem) holds the running total and the next action — implemented inside the children, Modal untouched.

```
New return to supplier                                                    ✕
┌ Where is it going? ───────────────────────────────────────────────────────┐
│ Warehouse*  [Main DC ▾]      Supplier*  [Sample Foods ▾]                  │
│ Bill (optional)  [🔍 Type bill number…            ]   Linking a bill fills │
│                                                        in the items below. │
└───────────────────────────────────────────────────────────────────────────┘
Items going back                         Reason for all items [Choose… ▾]
┌ ☑ Biscuits Cream 120g   8901234500012 ─────────────────────── on bill: 30 ┐
│                                       returned already: 10 · can return: 20│
│  Lot            [B-0412 · exp 12 Jan 2027 · 40 left · ₹18.00 · Available ▾]│
│  How many  [−][ 12 ][+]   Reason* [Damaged ▾]                              │
│  Credit expected  ₹ [18.00] per unit  =  ₹216.00                           │
└────────────────────────────────────────────────────────────────────────────┘
┌ ☐ Cola 500ml   8901234500029 ─────────────────── on bill: 24 · can return: 24 ┐   (unticked = collapsed)
└────────────────────────────────────────────────────────────────────────────┘
 [🔍 Add another item — type name or scan barcode]   (hidden while a bill is linked)
Note for this return (optional)  [ e.g. picked up by driver Sample Driver      ]
──────────────────────────────────────────────────────────────────────────────
 2 items · 12 units · Expected credit ₹216.00        [Cancel]  [Review return]
```

**Field order and defaults**
1. Warehouse — `WarehousePicker`; pre-selected when the user has one warehouse (always for warehouse roles); locked (read-only text) when opened from Verify Bill/Recall.
2. Supplier* — `<select>` of active+inactive suppliers (inactive suffixed " (inactive)"); required. Locked-prefilled from entry A/B but changeable via a small "Change" link (changing it clears items after a one-line confirm "This clears the items you added.").
3. Bill (optional) — combobox of THIS supplier's bills in this warehouse (existing receipts list endpoint, `q` = typed invoice text, 300ms debounce). Each option: invoice no. (mono) · date · "N units". Selecting fills the items as a tick-list (below). A "Remove bill link" text button appears next to it; removing keeps ticked items as free items. Disabled until a supplier is chosen (helper: "Choose a supplier first").
4. Items — see below. Disabled with helper "Choose a supplier to add items" until supplier set.
5. Note (optional, 300 chars, single line). Used for the return-level note.

**Items — bill mode (bill linked)**: every bill product is a collapsed row with a checkbox, name+barcode, and "on bill N · returned M · can return K". **Select all** link above the list. Ticking expands the line card (150ms height ease). Qty default = min(K, lot qty left); K = `returnableQty` from `/bill-context`, lot auto-picked = the lot named on the bill's receipt row when found, else the only eligible lot, else the user must choose. Products with K = 0 are shown disabled with "Already fully returned" (no checkbox). Search box hidden; below the list: "Not on this bill? Remove the bill link to add other items." (this prevents `SKU_NOT_ON_BILL` by construction).
**Items — free mode (no bill)**: ProductSearch (name or barcode, min 1 char, 300ms) against the selected warehouse's stock; results list (max 8): name, barcode, "N in stock"; products with 0 stock are shown disabled "None in stock". Scanner-friendly: an exact barcode match + Enter adds the item directly. Added item appears as a line card at the top of the list, lot auto-picked, qty = 1 (selected on focus), focus moves to Qty. Already-added product: search result shows "Added" and Enter focuses the existing card (no duplicate sku+lot lines; adding a second LOT of the same product is done inside the card via "+ Return from another lot", which creates a second line card for the same product).

**Line card** (`ReturnLineCard`) — grid, `display:flex; flex-wrap:wrap; gap:0.6rem`, field min-widths so it reflows at every width:
- Header: `IdentityCell` (name clamp 2 lines + full barcode), ✕ remove (free mode, `aria-label="Remove Biscuits Cream 120g"`; no confirm, line is not saved yet).
- **Lot** (batch-on warehouses; data from `GET /admin/supplier-returns/lots?warehouseId&sku&supplierId` — one call per product, not the old stock batches endpoint): a button styled as a select showing the chosen lot summary "B-0412 · exp 12 Jan 2027 · 40 left · ₹18.00 · [Available]"; click toggles an **inline expanded list** under the field (not a popover, so the modal's scroll container can't clip it): radio rows with columns Batch (mono) · Expiry · Left (right) · Cost (right) · Status (`StatusPill`). Rules: sorted by expiry ascending; expired lots show an "Expired" amber chip beside the date (`--warning-*`); the server decides what is returnable: lots with `returnable: false` (nothing left, or `supplierMatch: "OTHER"`) are hidden with the captions "{n} empty lots hidden" / "Lots from other suppliers aren't shown"; lots with `supplierMatch: "UNKNOWN"` ARE shown and labelled "supplier not recorded"; lots with `supplierMatch: "MATCH"` show no extra label. A lot that was merged from several suppliers' receipts matches any of them. The FE never recomputes the supplier rule. Caption always under the list: "Hold and Recall lots can be returned." When there is exactly one eligible lot it renders as plain text (no control). Selecting a row collapses the list and moves focus back to the Lot button.
  Flag-off warehouse (`batchMode: false` in the `/lots` response, `lots: []`): no Lot field; instead plain text "Stock on hand: 40 (cost ₹18.00 each)" from `stock`. The request then sends no `batchId`. The `batchMode` the FE believed is sent with the return; a mismatch comes back as `BATCH_MODE_CHANGED`. The selected lot is sent as `batchId` (never batch number).
- **How many** (Qty): stepper `[−] [input] [+]`, `inputmode="numeric"`, integer >= 1, max = min(lot left, bill can-return). Typing above max does not clamp silently — the field shows the inline error (section 8) and the stepper "+" stops at max. Helper below when capped: "Max 40 (all that's left in this lot)" or "Max 20 (the rest of this bill)".
- **Reason*** `<select>` — mandatory on EVERY line (`lines[].reason`): placeholder "Choose a reason". When reason = Other a required text input "What happened?" (`lines[].reasonNote`, 1-200 chars, not blank) appears directly under; focus moves into it. For other reasons the note is optional and hidden. There is no return-level reason; the return-level "Note" is optional.
- **Credit expected**: "₹ [ 18.00 ] per unit = ₹216.00". Default = lot cost (flag-off: stock cost). Editable, >= 0, 2dp, right-aligned. If it differs from the lot cost by more than 20% show the (non-blocking) amber helper: "That's different from what you paid (₹18.00 a unit). That's fine if the supplier agreed this price." If cost is unknown (0 / legacy): default 0.00 and helper "No cost was recorded for this lot. Enter the credit you expect."
- When a bill is linked, if the bill's own unit price (`billUnitCost` from `GET /bill-context`) is known and differs from the lot cost, show one muted line: "On bill INV-0042 this was ₹20.00 a unit." (hint only; never auto-applied). The lot auto-pick uses the bill line's `batchNos`: exactly one returnable lot matches -> picked; otherwise the user chooses.
- Reserved-stock hint (from `stock.reservedQty` / `freeQty` in the `/lots` response): muted line "5 of this product are promised to stores, so only 35 can go back." Qty max is NOT lowered by this (the server decides; returning a Hold/Recall lot works even when stock is promised); it is only a heads-up.

**Reason for all items**: a select in the section header. Choosing a value sets the reason on ALL current lines (lines already holding a different reason are overwritten, because the user explicitly asked for "all"); lines added later start empty but take the "all" value if it is set and still equal to every line. Per-line selects remain editable. A first-time user who picks a reason on line 1 and leaves others blank sees an inline chip under the section header: "Use 'Damaged' for the other 2 items" (one click applies it to empty lines only). Recall entry pre-sets Recall.

**Running total** (sticky footer, `aria-live="polite"`, updates on change, announced at most once per 800ms): "{n} items · {units} units · Expected credit ₹{sum}". Zero items: "Nothing added yet".

**Review return** button: disabled only when there are 0 ticked/added items (caption "Add at least one item" replaces the totals) or the modal is submitting. In all other cases it is clickable; on click, validation runs, errors render inline, the first invalid field is scrolled into view and focused, and a banner at the top reads "Fix {n} thing(s) to continue" (`role="alert"`, with a "Jump to first" button).

Step 2 "Review" (same modal; title becomes "Review return"):

```
Review return                                                             ✕
Sending back to  Sample Foods   ·   from Main DC   ·   Bill INV-0042
┌ ITEM                    LOT            QTY  REASON     CREDIT ───────────┐
│ Biscuits Cream 120g     B-0412          12  Damaged    ₹216.00           │
│ Cola 500ml              B-0398           4  Expired    ₹60.00            │
└──────────────────────────────────────────────────────  Total 16 units · ₹276.00 ┘
(i) Stock leaves the warehouse as soon as you confirm. If you recorded this
    by mistake, you can cancel it as long as no refund has been recorded.
                                         [‹ Back]   [Confirm return]
```
- Read-only table (`th`/`td`; qty and credit right-aligned; each line's own reason as plain text; "Other: {reasonNote}" inline).
- Note line if provided. Info box uses `LegacyReceiptNote`'s look (inset `--bg-primary`, Info icon, 0.76rem secondary text).
- **Confirm return** is `btn('primary')`, focus lands on it when the step opens. On click: immediately disabled + label "Returning…", Back and ✕ disabled; the button stays locked until the response. Double-click/Enter-repeat are swallowed by an `in-flight` ref in addition to the disabled attribute; one `clientRequestId` (UUID) is created when the modal opens and reused for any retry of this submit. Reopening the modal makes a new id.
- Network failure or timeout (no response): stay on review, banner "We couldn't confirm whether this went through. Press Try again — it won't be recorded twice." with button **Try again** (same id). If the server answers `replayed: true` (HTTP 200), treat as success and show the normal success pane. The key is only replayed for the same admin, so nothing leaks between users.

Step 3 "Done":
```
              ✓  Return SR000007 recorded
   16 units are out of the warehouse. Expected credit: ₹276.00.
   Next: when Sample Foods pays or sends a credit note, open the return and record the refund.
                         [Done]   [View return]
```
Success icon: `Check` in a 40px circle, ring `--success`, fill 14% success mix; announced via `role="status"`. Primary = **View return** (opens Detail, one more click to Record refund); **Done** closes. From the Supplier Returns page the list refreshes underneath; from Verify Bill/Recall the host list refetches (bill badge / lot qty update).

**Modal states**
- Loading: supplier/warehouse lists load -> fields show "Loading…" disabled. Lot list per line: 2 skeleton bars inside the Lot field; failure -> inline in the field "Couldn't load lots. **Try again**" (Try again refetches only that product). Bill list loading: "Searching bills…" row in the dropdown.
- Empty: no bills for supplier -> dropdown "No bills from Sample Foods in Main DC."; no returnable lot -> in the Lot field "No lots of this product can be returned to Sample Foods. Lots from other suppliers aren't shown." and the card cannot be included (Review shows the error); search with no match -> "No products match “{q}”."; bill fully returned -> "Everything on this bill has already been returned."
- Error: section 8. Success: step 3. Disabled: locked supplier/warehouse when launched with context; all inputs disabled while submitting.
- Discard guard on ✕ / Escape when any item exists (section 2.1 step 9).

### 6.3 Return detail — `Modal wide` (720), title "Return SR000007" + chips

```
Return SR000007                  (↩ Returned) (⏱ Part received ₹80.00)    ✕
┌ summary (2-col, label 0.72rem secondary / value 0.85rem) ────────────────┐
│ Supplier  Sample Foods          Warehouse  Main DC                        │
│ Bill      INV-0042              Recorded   5 Oct 2026, 4:30 pm by Demo Manager │
│ Note      Picked up by driver Sample Driver                               │
└───────────────────────────────────────────────────────────────────────────┘
┌ REFUNDS ──────────────────────────────────────────────────────────────────┐
│ Expected ₹216.00 · Received ₹80.00 · Still owed ₹136.00                   │
│ ₹50.00  Bank transfer · Ref TXN-5521 · 6 Oct 2026            [Undo]       │
│ ₹30.00  Cash · 7 Oct 2026                                    [Undo]       │
│ ₹20.00  Cash · 7 Oct 2026   UNDONE (greyed)  Undone by Demo Manager,      │
│         8 Oct 2026: "Typed the wrong amount"                              │
│ [Record refund]  [Supplier won't give credit]  (second hidden once a      │
│                   refund exists)                                          │
└───────────────────────────────────────────────────────────────────────────┘
ITEMS
 ITEM                 LOT      EXPIRY       QTY  REASON    CREDIT/UNIT  CREDIT
 Biscuits Cream 120g  B-0412   12 Jan 2027   12  Damaged   ₹18.00       ₹216.00
                                                          Total  12 units  ₹216.00
HISTORY
 5 Oct 2026, 4:30 pm  Return recorded by Demo Manager (stock ledger ref SR000007)
 6 Oct 2026           Refund ₹50.00 recorded (Bank transfer) by Demo Manager
 7 Oct 2026           Refund ₹30.00 recorded (Cash) by Demo Manager
 8 Oct 2026, 9:10 am  Refund ₹20.00 undone by Demo Manager: "Typed the wrong amount"
──────────────────────────────────────────────────────────────────────────
[Cancel return]  (left, ghost)  To cancel, first undo the recorded refunds.   [Close]
```
- **Refunds block** variants (every refund the return has ever had is listed, oldest first):
  - Pending, no refund: "Expected ₹216.00. Waiting for Sample Foods." + **Record refund** and **Supplier won't give credit** (writers). Staff: "Waiting for the supplier." and no buttons.
  - Part received: the summary line above plus **Record refund** (prefilled with the remainder). **Supplier won't give credit** is hidden while any ACTIVE refund exists (the server's `HAS_REFUNDS` is the safety net).
  - Received in full: all refunds listed; per-refund **Undo** (voiding one drops the return back to pending / part received).
  - Received but short (closed short): amber line "₹16.00 short of the ₹216.00 expected (closed on 8 Oct 2026 by Demo Manager: {note})" with icon + text, and a **Reopen** ghost button. Refunds stay listed with their own **Undo**.
  - Received for more than expected: neutral accent line "₹10.00 more than expected. Note: {note}". No Reopen (nothing is owed); use Undo on the refund if it was a mistake.
  - Not expected: "No credit expected — {note}" + **Reopen** ghost button.
  - Cancelled return: block replaced by "This return was cancelled on {date} by {name}. Reason: {reason}. The units went back into the same lots." Any refunds shown below as read-only history (they were all voided before the cancel was allowed).
  - **Voided refund row**: text `--text-secondary`, amount with `text-decoration: line-through` NOT used (keep it readable); an "Undone" tag (icon `Undo2` + word) and "Undone by {name}, {date}: {reason}". Never deleted, never counted in the totals.
- **Undo (per refund)**: in-place, inline under that row (no modal, fully logged): "Undo this ₹30.00 refund? Why? [short reason input, required, 1-500] **Yes, undo** · Keep". Yes is disabled until a reason is typed. After success the row greys and the return status is recomputed by the server (a void always drops a "closed short" state).
- **Reopen**: shown only for closed-short or no-credit-expected returns. One-click inline "Reopen this return? Add a note (optional) **Yes, reopen** · Keep". A return that was received IN FULL has no Reopen: undo a refund instead (this keeps "pending" meaning "still owed money").
- **Cancel return**: footer left, ghost. **Enabled whenever there is no ACTIVE refund** (including when "No credit expected" — cancelling does not touch the credit state). If any ACTIVE refund exists it is shown but disabled with VISIBLE text beside/under it (not tooltip-only): "To cancel, first undo the recorded refunds." The reason: the supplier has already paid for those goods, so putting them back in stock would leave the money and the stock out of step.
- **History** lists in time order, built from the return's created/cancelled stamps, `refunds[]` (recorded and voided entries) and the credit-status stamp (closed short / marked no credit / reopened). The ledger reference is plain text, "Stock ledger ref: SR000007".
- **Lines table** wrapped in `overflowX:auto`; each line shows its own reason (and the "Other" note under it); lot status at the time of return is a small `StatusPill` under the lot number ONLY when it was HOLD/RECALL.
- Loading: header shows "Return …" with skeleton blocks. Error: "Couldn't load this return." + **Try again**.
- **Staleness**: every write sends `expectedRev` from the loaded return. On `STALE` or `INVALID_STATE` (409) show the banner "This return was just updated by someone else. Showing the latest." and refetch; the user's typed text is kept where the form is still valid.

### 6.4 Record refund — `Modal` (460)

Title: `Record refund — SR000007`.

```
Expected from Sample Foods ₹216.00 · already received ₹80.00 · still owed ₹136.00
( ● ) Supplier paid us          (   ) Supplier won't give credit      <- second hidden once a refund exists
Amount*          ₹ [ 136.00 ]       ⚠ ₹16.00 short of what is still owed
Date received*   [ dd/mm/yyyy ]                                      (blank, required)
How was it paid* [Cash] [Bank transfer] [Credit note adjusted]      (none pre-selected)
Reference*       [ Transaction ID ]                                  (required for Bank / Credit note)
Note             [                                    ]
  [ ] Close this return — supplier will not pay the rest             (only when short)
  [ ] Yes, supplier paid more than expected                          (only when over)
                                          [Cancel]  [Save refund]
```
- Choice at the top is a radiogroup of two cards (default "Supplier paid us"). The "won't give credit" card is not rendered when the return already has any ACTIVE refund.
- **Amount**: prefilled with the REMAINING amount (expected - received, never below 0.01; when the return is already fully received the field is blank). `inputmode="decimal"`, right-aligned, max 2dp, > 0, up to ₹1,00,00,000. Live feedback line (always rendered, `aria-live="polite"`, one of): equal to remaining -> "Matches what is still owed (₹136.00)." (neutral); less -> "₹16.00 short of the ₹136.00 still owed." (amber icon + text `--warning-text`); more -> "₹10.00 more than expected." (accent icon, `--text-primary`).
- **Short**: allowed with no extra step (the return simply stays "Part received", ready for the next refund). Only when the user wants to stop waiting, the checkbox **Close this return - supplier will not pay the rest** appears (only while short). Ticking it reveals a REQUIRED note ("Why is the rest not coming? e.g. Supplier agreed to ₹16.00 off for the dents."); button stays disabled until filled. The return then shows as "Received · ₹16.00 short".
- **Over**: when amount takes the total above expected, an amber line explains "This is ₹10.00 more than expected. Check the amount." and the checkbox **Yes, supplier paid more than expected** appears. Save stays disabled until it is ticked AND the note is filled ("What is the extra for? e.g. GST added by supplier"). Without the tick the server refuses with `OVER_REFUND`; the inline guard exists so a typo like ₹2,160 for ₹216 never reaches it.
- **Date**: `type="date"`, required, min 2020-01-01, max today (IST). **NOT prefilled** (final spec D13; this overrides the earlier "prefill today"; same rule as MarkAsPaidModal). Empty helper under it: "When did the money arrive? Choose the date."
- **How**: three radio pills (role `radiogroup`, 40px high), none selected by default and not clearable once chosen (it is required). Reference label adapts: Cash -> "Receipt no. (optional)" · Bank transfer -> "Transaction ID" · Credit note adjusted -> "Credit note no.". Required for Bank transfer and Credit note adjusted (1-100 chars); optional for Cash.
- **"Supplier won't give credit"** (A8): hides amount/date/mode/reference; shows required Note "Why won't Sample Foods give credit?" (1-500; placeholder "e.g. They said the damage was after delivery"); button label becomes **Mark as no credit**.
- **Buttons**: **Save refund** is disabled while saving ("Saving…") and until all required fields are valid; each missing field shows its helper text in plain words (see section 7). Not optimistic: wait for the server (money), then toast "Refund recorded: ₹136.00." / "Refund recorded: ₹120.00. Marked as closed, ₹16.00 short." / "Marked as no credit expected." and close; list/detail refresh. Double-click safe: in-flight ref plus disabled; the server also rejects a second write with the same `expectedRev` (`STALE`), so exactly one refund is saved.
- Errors: inline banner at the top of the modal, input kept; mapped by `reason` (section 7). 409 `STALE`/`INVALID_STATE` as in 6.3.
- Over-limit: when the return already has 20 refund entries (voided count too) the form shows `REFUND_LIMIT` copy and Save is disabled.

### 6.5 Cancel confirm — `Modal` (460)

Title: `Cancel return SR000007?`

> **The 12 units will go back into the same lots they came from**, and this return will be marked Cancelled. Use this only if you recorded the return by mistake. If the goods really went back to the supplier, don't cancel — record the refund instead.
>
> Goes back: Biscuits Cream 120g — lot B-0412 — 12 units (list up to 5 lines, then "and 2 more")
>
> Why are you cancelling?* [textarea, 1–500 chars, counter "0/500"]
>
> [Keep return] (ghost, initial focus)  [Yes, cancel return] (danger, disabled until reason entered)

After success: toast "Return cancelled. 12 units are back in stock." and the detail refreshes into the cancelled view. The credit state is not changed by cancelling. Errors by `reason`: `HAS_REFUNDS` -> "A refund was just recorded for this return. Undo the refunds first, then cancel."; `BATCH_MODE_CHANGED` -> "Lot tracking for this warehouse was switched after this return. Switch it back to cancel, or ask a super admin."; `LOT_RESTORE_CONFLICT` -> "Lot {batchNo} can't take these units back (it was changed after the return). Ask a super admin to fix the stock."; shown on the line named by `details.lineIndex`.
This modal only opens from an enabled Cancel button (no ACTIVE refund).

---

## 7. Copy deck (all user-visible strings)

**Navigation/titles**: Supplier Returns · "Goods you sent back to suppliers, and the credit they owe you." · New return · New return to supplier · Review return · Return SR000007.
**Labels**: Refunds · Still owed · Received · Close this return — supplier will not pay the rest · Yes, supplier paid more than expected · Warehouse · Supplier · Bill (optional) · Items going back · Add another item · Lot · How many · Reason · Reason for all items · Credit expected · per unit · Note for this return (optional) · Return no. · Date · Bill · Reason · Units · Expected credit · Status · Expected · Amount · Date received · How was it paid? · Reference · Note · History.
**Placeholders**: "Type bill number…" · "Type name or scan barcode" · "Choose a reason" · "Choose a supplier" · "e.g. picked up by driver Sample Driver" · "What happened?".
**Buttons**: New return · Review return · Back · Confirm return · Returning… · Try again · Done · View return · Record refund · Supplier won't give credit · Save refund · Saving… · Mark as no credit · Undo · Yes, undo · Reopen · Yes, reopen · Keep · Cancel return · Keep return · Yes, cancel return · Select all · Remove bill link · Clear filters · Keep editing · Discard.
**Helpers**: "Linking a bill fills in the items below." · "Choose a supplier first." · "Hold and Recall lots can be returned." · "Lots from other suppliers aren't shown." · "{n} empty lots hidden" · "Max {n} (all that's left in this lot)" · "Max {n} (the rest of this bill)" · "Not on this bill? Remove the bill link to add other items." · "Stock leaves the warehouse as soon as you confirm. If you recorded this by mistake, you can cancel it until the supplier's credit is recorded."

**Validation / error messages** (inline, next to the field, plain words, with the fix). The FE picks the message from the server's machine `reason` (plus `details`), never from the server's message text or the numeric `code`. Line-level reasons render on `details.lineIndex` (fallback: match `details.sku`); if neither identifies a line, show in the top banner.

Client-side checks (before the request):

| Trigger | Message |
|---|---|
| No supplier | "Choose the supplier these items are going back to." |
| No lot chosen | "Choose which lot this came from." |
| Qty blank/0/not whole | "Enter how many are going back (1 or more)." |
| Qty > lot left or bill allowance | the `INSUFFICIENT_LOT` / `EXCEEDS_BILL` wording below, using the numbers the FE already has |
| No reason on a line | "Choose why it's going back." |
| Reason Other, note blank | "Tell us what happened (a few words is fine)." |
| Credit per unit blank/negative | "Enter the credit you expect (0 or more)." |
| Refund: amount blank / 0 | "Enter the amount you received." |
| Refund: date blank | "Choose the date the money arrived." |
| Refund: date in the future | "The date can't be in the future." |
| Refund: mode not chosen | "Choose how it was paid." |
| Refund: reference blank (Bank transfer) | "Enter the transaction ID." |
| Refund: reference blank (Credit note adjusted) | "Enter the credit note number." |
| Refund: closing short, note blank | "Add a short note on why the rest isn't coming." |
| Refund: over expected, box not ticked / note blank | "Tick the box to confirm the supplier paid more, and say why." |
| No-credit note blank | "Add a short note so others know why." |
| Undo refund: reason blank | "Tell us why you're undoing this refund." |
| Cancel: reason blank | "Tell us why you're cancelling." |

Server `reason` -> message (every reason in final spec §2.3; `{…}` come from `details`, never parsed from prose):

| `reason` | Where | Message |
|---|---|---|
| `VALIDATION` | line (`details.lineIndex`) or field (`details.field`) | "Check this {field name in plain words}." If it names a line, shown on that line; otherwise in the banner. The FE should normally catch this first. |
| `DUPLICATE_LINE` | line `lineIndex` | "This item and lot appear twice. Combine them into one line." |
| `WAREHOUSE_NOT_FOUND` | banner | "We couldn't find that warehouse. Reload the page and pick it again." |
| `SUPPLIER_NOT_FOUND` | banner | "We couldn't find that supplier. Choose the supplier again." |
| `BILL_NOT_FOUND` | Bill field | "We couldn't find that bill for this supplier. Check the bill number." |
| `NOT_FOUND` | banner | "We couldn't find this return. It may have been removed. Go back to the list." |
| `REFUND_NOT_FOUND` | refund row | "That refund no longer exists. Showing the latest." (refetch) |
| `BATCH_MODE_CHANGED` | banner | create: "Lot tracking was just switched for this warehouse. Reload the lots to continue." + **Reload lots** (keeps products, clears lot/qty choices). Cancel: see 6.5. |
| `SKU_NOT_ON_BILL` | line | "This item isn't on bill {invoice}. Remove the bill link to return it anyway." |
| `EXCEEDS_BILL` | line | "Bill {invoice} had {billed} of this and {alreadyReturned} already went back, so only {returnable} more can be returned." |
| `LOT_NOT_FOUND` | line | "That lot is no longer available. Pick the lot again." (reloads that product's lots) |
| `SUPPLIER_MISMATCH` | line | "Lot {batchNo} was received from {lotSupplierNames}, not {supplier}. Choose a different lot or supplier." |
| `INSUFFICIENT_LOT` | line | "Only {available} left in lot {batchNo}. Lower the quantity or choose another lot." |
| `INSUFFICIENT_STOCK` | line | "Only {available} of this product are in stock. Lower the quantity." |
| `RESERVED` | line | "Only {free} of {product} can go back right now — {reserved} are promised to stores. Return fewer, or wait until the stores' orders are shipped." |
| `IDEMPOTENCY_KEY_REUSED` | banner | "Something went wrong and nothing was saved. Close this window and start again." |
| `STALE` | banner | "This return was just updated by someone else. Showing the latest." (refetch, keep typed text) |
| `INVALID_STATE` | banner | same wording as `STALE` (refetch) |
| `HAS_REFUNDS` | cancel / no-credit modal | "This return has refunds recorded. Undo them first, then try again." |
| `OVER_REFUND` | amount field | "That's more than the ₹{maxWithoutConfirm} still owed. If the supplier really paid more, tick the box and say why." (reveals the over checkbox) |
| `REFUND_LIMIT` | modal banner | "This return already has {max} refund entries, the most we can keep. Undo a wrong one or ask a super admin." |
| `LOT_RESTORE_CONFLICT` | line (cancel) | "Lot {batchNo} can't take these units back (it was changed after the return). Ask a super admin to fix the stock." |
| `BILL_HAS_SUPPLIER_RETURNS` | Verify Bill supplier-change error (outside this screen, shown by that page) | "This bill has supplier returns ({returnIds}). Cancel them before changing the supplier." |
| any 403 | banner | "You don't have permission to do this. Ask a warehouse manager." |
| network / unknown reason | banner | `errMsg(e)` else "Couldn't save. Check your connection and try again." |

Error presentation: message line under the field, 0.78rem, `--text-primary` text with a leading `AlertCircle` icon stroked `--danger`, field border `--danger`, `aria-invalid="true"`, `aria-describedby` -> message id. (Plain `--danger` TEXT is 3.76:1 on the light theme, below AA for small text; do not use it as the text colour.) A top banner (`role="alert"`, inset surface, `--danger` left border 3px) summarises "Fix {n} thing(s) to continue". Server errors that name a line are mapped onto that line using `details.lineIndex` (fallback `details.sku`); if the server cannot name it, show it in the banner.

---

## 8. Interaction details

- Acknowledge every click within ~100ms: buttons switch label/disabled immediately; no spinner-only states (labels "Saving…" / "Returning…").
- Transitions: line-card expand/collapse and lot list open: `height/opacity 150ms ease`; chip/tint flashes 2s fade; all wrapped in `@media (prefers-reduced-motion: reduce) { transition: none; animation: none }` via a scoped `<style>` (inline styles cannot express media queries — same approach as other Warehouse pages).
- Hover: clickable rows `--accent-soft`; ghost buttons keep existing hover (none) + `cursor:pointer`; focus-visible 2px `--accent-primary` outline, 2px offset (verify the global `:focus-visible` rule; add scoped style if inline buttons lose it).
- No optimistic updates for anything that moves stock or money. List refetch after every write; "Updating…" indicator, rows stay.
- Destructive/hard-to-reverse: Confirm return (review step is the confirmation; stock-moving), Cancel return (explicit confirm modal with reason), Undo a refund (inline confirm with a required reason), Reopen (inline confirm). Nothing is deleted anywhere; history is append-only.
- Unsaved work: Escape/✕ with items -> discard guard; Escape on step 2 goes Back, not close; Escape in sub-modals closes only them.
- Concurrency: every post-create write (refund, undo, no-credit, reopen, cancel) sends `expectedRev`; `STALE`/`INVALID_STATE` -> banner + refetch (section 7). Refund/void/reopen are never optimistic.
- Double-submit: single `clientRequestId` per modal open; `in-flight` ref; disabled button; credit/cancel buttons also lock while saving.
- Searches debounce 300ms; stale responses ignored (latest-wins), as the other Warehouse searches do.
- Persisted preferences: none (each return is deliberate). Warehouse selection reuses whatever the other Warehouse pages persist, if anything.

---

## 9. Responsive behaviour (mobile-first)

| Width | Behaviour |
|---|---|
| < 640px | Modals use full available width (overlay already pads 1rem; pass `width={880}` — `maxWidth:100%` clamps it). Line card fields stack one per row; stepper and inputs 44px high; sticky footer stacks: totals above, buttons full-width side by side (Review return gets the larger share). List: filters stacked full width; chip row scrolls horizontally (`overflow-x:auto`, no wrap); tiles 2-up/1-up; table scrolls horizontally with Return no. sticky-left. |
| 640–1024px | Line card: Lot full row; Qty + Reason + Credit wrap in a 2-per-row flow (`flex: 1 1 200px`). Filters wrap to two lines. |
| >= 1024px | Line card: Lot + Qty on the first row, Reason + Credit on the second (each `flex: 1 1 200px`; Lot `flex: 2 1 320px`). Filters on one line. List table fits without scrolling. |

Use `flex-wrap` with `flex-basis` (never `auto-fit` grids, never viewport `md:` classes — the admin uses inline styles; if a true media query is needed, use a scoped `<style>` block).

---

## 10. Entry-point edits (Phase 3 — spec only)

1. **Verify Bill** (`VerifyBillPage.tsx`):
   - New column "Actions" (right of Payment, left of the expander) with a ghost button, icon `Undo2` + text **Return**, `aria-label="Return items from invoice INV-0042 to supplier"`; `title`: "Return items from this bill". Visible only when `canManage` AND the row has a `supplierId` (bills without a supplier cannot be returned — nothing to return them to). `stopPropagation` like the neighbouring buttons. Opens `NewSupplierReturnModal` with `prefill {supplierId, invoiceNumber}` (bill mode, all lines listed unticked). Update `colCount` accordingly (this is the one place the table grows: keep the button compact — icon + "Return", `padding 0.25rem 0.6rem`, `fontSize 0.72rem` like "Mark paid").
   - In the expanded bill detail (where Correct / Change supplier live) add the same action with the longer label **Return from this bill**.
   - Badge (needs the Phase 3 `returnedUnits / returnCreditExpected / returnCreditReceived` fields, default 0): when `returnedUnits > 0`, a muted second line in the Invoice cell: "↩ Returned 12 · ₹216.00 pending" (or "· received", or "· ₹16.00 short") as a link button to `/warehouse/supplier-returns?q=INV-0042`. Text uses `--text-secondary`; amber `--warning-text` only for pending/short. Never changes the bill's Paid/Not paid pill. In the expanded detail show "Net payable if credit is received: bill total − ₹216.00" as display only (plan Q6).
2. **Recall page** (`RecallPage.tsx`): in the warehouse lot rows' Actions cell, after the Hold/Recall/Available buttons, add ghost **Return to supplier** (same padding as neighbours) shown when `canManage && row.qtyRemaining > 0 && row.status in {HOLD, RECALL}`. Opens the modal prefilled (warehouse, supplier = lot supplier if known else empty required field with helper "We don't know who supplied this lot. Choose the supplier.", sku, lot, qty = qty left, reason Recall). Landing state is step 1 with everything valid so the next click is Review. Store lots do not get this button; their row shows nothing extra (they must come back to the warehouse first — do not add explanatory clutter here; the empty-state/help text on the New return modal covers it: "Stock in a store? First send it back to the warehouse with 'Return to warehouse' on the Transfers page.").
3. **Write-off modal** (`WarehousesPage.tsx`): one muted line under the reason field: "Sending it back to the supplier? Use **Supplier Returns** so you can track the credit." with a link to `/warehouse/supplier-returns`. Additive only.
4. **Ledger page** (`LedgerPage.tsx`): `TYPES` gains `SUPPLIER_RETURN_OUT` "Returned to supplier", `SUPPLIER_RETURN_REVERSAL` "Supplier return cancelled" (and the already-missing `RETURN_OUT`, `RETURN_IN`).
5. **Menu / route**: section 3. App.tsx route element `<SupplierReturnsPage />` in the role-gated group; `useMenu.ts` entry; `useMenu.test.ts` case.

---

## 11. Accessibility (WCAG 2.2 AA)

- **Contrast**: body text `--text-primary` on `--bg-secondary`/`--bg-primary` (both themes >= 12:1). `--text-secondary` on `--bg-secondary` (#a0a0a0 on #1a1a1a ~7:1; #6b7280 on #fff 4.8:1) is the floor for labels; do not use it below 0.72rem. Chip text uses only tokens listed in section 4 (all >= 4.5:1). Error and success meaning never rely on colour: icon + words. Primary button `--accent-primary` + `--accent-on` white is >= 4.5:1. Known exception (pre-existing): `btn('danger')` 3.76:1.
- **Focus**: visible on every control (2px accent outline). On open, focus -> first empty required field (Supplier) or, when prefilled, the first line's Qty/Reason; step 2 -> Confirm return; step 3 -> View return; sub-modals -> their primary field or (cancel confirm) the safe button "Keep return". On close, focus returns to the element that opened it (the row button / New return button). Tab order follows visual order: Warehouse, Supplier, Bill, Reason for all, each card (checkbox, Lot, Qty − / input / +, Reason, Other note, Credit), Add item, Note, Cancel, Review.
- **Modal limitations** (shared `Modal` has no `role="dialog"`/`aria-modal`/focus trap/Escape and must not be edited here): the dialog role cannot be added from outside because the Modal root and title are not ours. So: (a) the new components add a document `keydown` Escape listener (with the discard guard); (b) a Tab-wrap handler on a ref'd content wrapper (first/last focusable) keeps focus inside; (c) title is passed as `<span id=…>` so inputs can reference it; (d) raise to arijit-frontend-arch/user: a separate, approved change to give `Modal` dialog semantics for the whole Warehouse area. Until then document this as a known gap in the test guide.
- **Touch targets**: >= 40px (44px on touch widths) for every new interactive control; icon-only buttons (✕ remove, ▸ open) min 32×32 hit area with 24px visible minimum per WCAG 2.2 target-size. Chip-row buttons 36px min height.
- **Labels**: every input has a visible `<label>` (wrapping `label` like `MarkAsPaidModal`); icon-only buttons have `aria-label` with the product/return name; reason select labelled "Reason for {product}"; Qty stepper buttons "Decrease quantity of {product}" / "Increase …"; lot radios grouped in `role="radiogroup"` labelled "Lot for {product}", each radio's accessible name = "Lot B-0412, expires 12 Jan 2027, 40 left, cost ₹18.00, Available"; credit-mode pills `role="radiogroup"` labelled "How was it paid?"; each refund row's Undo button is labelled "Undo the ₹30.00 refund of 7 Oct 2026"; voided rows carry the visible word "Undone" (not colour alone); the over/short checkboxes are real labelled checkboxes that appear in an `aria-live="polite"` region; chips are text, not images; the line checkbox is labelled "Include {product} in this return".
- **Live regions**: running total (`aria-live="polite"`), amount-difference feedback (polite), validation banner (`role="alert"`), save/success pane (`role="status"`), list "Updating…" line (polite), loading skeleton wrapper `aria-busy="true"`.
- **Tables**: `scope="col"`, numeric columns right-aligned and `tabular-nums`; row-open buttons expose the action; sortable headers none (server order).
- **Motion**: all animation off under `prefers-reduced-motion`.
- **Zoom/reflow**: layout reflows at 320px / 400% zoom with no two-dimensional scroll except the data tables, which scroll horizontally inside their wrapper.

---

## 12. Platform notes

Web only. No Android/iOS screens, no Material/HIG adaptation needed. Tablets in the warehouse are the realistic touch case — covered by the 44px/stack rules above.

---

## 13. Former backend mismatches — all RESOLVED by `supplier-return-final-spec.md`

| # | Earlier mismatch | Resolution (this design now follows it) |
|---|---|---|
| 1 | Reason per line vs per return | Per LINE: `lines[].reason` (required enum) + `lines[].reasonNote` (required when OTHER); return-level `note` optional (D14). Summary exposes `reasons[]` (distinct) for the list column. |
| 2 | Credit mode enum | `CASH \| BANK \| CREDIT_NOTE_ADJUSTED`, labels Cash / Bank transfer / Credit note adjusted (D12). Old `CREDIT_NOTE/ONLINE/ADJUSTED_ON_BILL` void. |
| 3 | Refund date prefill | Date is required, never defaulted, by server and FE (D13). This design's earlier "prefill today" is withdrawn (6.4). |
| 4 | Lot supplier in lot list | Solved by the new `GET /admin/supplier-returns/lots` which returns `supplierMatch` (MATCH / UNKNOWN / OTHER) and `returnable`, computed server-side with the same function create uses (D9, D17). The old stock/batches endpoint is not changed. |
| 5 | Bill context | `GET /bill-context` returns per sku `billedQty, alreadyReturnedQty, returnableQty, billUnitCost, batchNos`. The Bill combobox reuses the existing receipts list. |
| 6 | Reserved hint | `/lots` returns `stock { availableQty, reservedQty, freeQty, costPrice }`. |
| 7 | Staff read gate | Read: warehouse_staff/manager/super; write: manager/super + `warehouse.manage`. UI mirrors it (section 3). |
| 8 | Detail payload | `Detail` has supplier/warehouse/created/cancelled/creditStatus names, per-line `lotStatusAtReturn`, `refunds[]` with `recordedByName`/`voidedByName`, `voidReason`, `cancelReason`. History is built from these (6.3); there is no `creditHistory`. |
| 9 | List summary | `returnId, createdAt, supplierName, invoiceNumber, reasons[], totalUnits, expectedCreditAmount, receivedAmount, shortfallAmount, creditStatus, status, liveRefundCount, rev`. |
| 10 | Error identifiers | House envelope `{ code, error, message, errorType: "SUPPLIER_RETURN", reason, details }`. FE keys off `reason` + `details.lineIndex` (D15); copy per reason in section 7. |

## 14. Open items for the user (none block the build)
- Q10 (final spec, open): if suppliers commonly add GST on top of the credit, the over-refund tick-box is the intended path. Confirm that is acceptable rather than auto-allowing over-refunds.
- Global fixes noticed but out of scope: `Modal` dialog semantics/Escape/focus trap; `btn('danger')` and `StatusPill` colour contrast in light theme.

## 15. Sign-off checklist for the build
- [ ] No edits to `ui.tsx` `Modal`, `StatusPill`, `statusMeta` ALL_STATUSES composition.
- [ ] Both themes checked (chips incl. "Part received", voided refund rows, error rows, skeleton visible in light).
- [ ] Staff login: list visible, zero write controls (no New return / Record refund / Undo / Reopen / Cancel).
- [ ] Double-click Confirm sends one request; Try again reuses the id. Double-click Save refund records one refund.
- [ ] Record refund: date blank, mode unselected, reference required for Bank/Credit note, over-refund blocked until ticked + note, short + close needs a note.
- [ ] Undo refund needs a reason; voided row stays visible and greyed; totals ignore it.
- [ ] Cancel disabled with visible explanation while an ACTIVE refund exists; enabled after undoing it and when "No credit expected".
- [ ] Reopen only on closed-short and no-credit-expected returns.
- [ ] Every `reason` in section 7 reproduced inline on the right line (via `details.lineIndex`).
- [ ] Lots come from `GET /lots`; `returnable:false` hidden; UNKNOWN labelled "supplier not recorded".
- [ ] 320px, 768px, 1280px screenshots of create (details + review), list, detail (with refunds), refund modal.
- [ ] Test guide `haper-misc/test-supplier-return.md` includes the Modal-accessibility known gap.
