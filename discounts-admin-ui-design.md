# Design Spec — Discounts Admin UI

Author: Chanchal (designer) · Date: 2026-08-11
Status: Spec for Phase 1 build. Feeds directly from `haper-misc/discounts-promotions-plan.md`
(read that first — data model, API contract, stacking/margin-guard rules are authoritative there;
this doc does not repeat rule semantics, only how the admin interacts with them).

Audience: tanmoy-web (implements in `haper-admin`, React/TypeScript, no build-time CSS framework —
inline `CSSProperties` objects + a `scopedCss` `<style>` block for anything needing a media query,
matching `Config/ConfigSettings.tsx` / `GiftTiersPanel.tsx` / `GiftTierFormModal.tsx` conventions).

Precedent read before writing this spec: `pages/Config/GiftTierFormModal.tsx`,
`pages/Config/GiftTiersPanel.tsx`, `pages/Config/configTime.ts`, `pages/Config/ConfigSettings.tsx`,
`pages/Categories/CategoriesList.tsx`, `pages/Orders/OrdersList.tsx`,
`components/common/Switch.tsx`, `components/common/ConfirmDialog.tsx`, `index.css` tokens,
`hooks/useMenu.ts`, `constants/permissions.ts`.

---

## 0. Where this lives — page, not a Config card

Gift tiers live inside `/config` as a per-store card because they're single-store-scoped by
definition. Discounts are **not**: a rule can be global or span multiple stores, the list can grow
large, and it needs its own filters (store / enabled / active-now) — that's list-page shape, not
config-card shape. So this is a **new top-level page**, mirroring `CategoriesList` / `OrdersList`
in structure (page header + filter bar + table + row actions + a modal for create/edit), not a
card bolted onto `ConfigSettings.tsx`.

- **Route:** `/discounts`
- **Nav entry** (`hooks/useMenu.ts`, alongside `Stores` / `Profits` / `Audit Log` in the same
  super-admin-only cluster near the bottom of the sidebar):
  ```
  { icon: BadgePercent, label: 'Discounts', path: '/discounts',
    keywords: ['discount', 'promo', 'promotion', 'offer', 'sale', 'happy hour', 'coupon'],
    superAdminOnly: true }
  ```
  `superAdminOnly` mirrors the plan's Phase 1 auth (`requireRole(SUPER_ADMIN)` on every
  `/admin/discount-rule` route) — no permission-gated variant needed yet since only super_admin
  can reach it at all. If `PERMISSIONS.DISCOUNTS.VIEW` is wired up later, swap to
  `requirePermission` instead of `superAdminOnly`, matching how `STORE_CONFIG.VIEW` works today —
  don't block Phase 1 on that.
- **Files:** `pages/Discounts/DiscountsPage.tsx` (list + filters + page shell),
  `pages/Discounts/DiscountRuleFormModal.tsx` (create/edit, mirrors `GiftTierFormModal.tsx`),
  `pages/Discounts/BelowCostConfirmModal.tsx` (the below-cost gate, built on `ConfirmDialog`),
  `api/discountRules.ts` (mirrors `api/giftTiers.ts`).

---

## 1. User flow

1. Super admin opens **Discounts** from the sidebar → `DiscountsPage` loads, `GET /admin/discount-rule`
   with no filters (all rules, all stores).
2. Admin optionally filters by store / enabled / active-now — list re-fetches.
3. **Create:** clicks "New discount" → `DiscountRuleFormModal` opens empty → fills Name, Scope,
   Targets, Discount, Schedule, Stacking → optionally clicks **Preview** to see affected-item count
   and sample before/after prices before committing → clicks **Save**.
   - 3a. **Happy path:** API returns the created rule, no `belowCostItems` → toast "Discount rule
     created" → modal closes → list re-fetches → new row appears.
   - 3b. **Below-cost path:** API returns `belowCostItems[]` (either as a 200 "blocked" response or
     the error shape per the plan's contract) → `DiscountRuleFormModal` stays open, hands off to
     `BelowCostConfirmModal` (stacked on top) → admin reviews the list, ticks "I understand this
     may sell below cost", clicks **Confirm and save** → resubmits the exact same body with
     `?acknowledgeBelowCost=true` → success toast, closes both modals, list re-fetches.
     Admin can instead click **Go back and edit** → returns to the form with all fields intact
     (e.g. to lower the discount value or add a cap) → no data lost.
4. **Edit:** clicks a row (or its Edit icon) → same modal, pre-filled, `PUT` instead of `POST` →
   same below-cost gate can fire again (a value increase could newly cross cost).
5. **Toggle enabled/disabled:** inline `Switch` in the row → `PATCH .../toggle` → optimistic flip,
   revert + toast on failure. No confirmation needed (reversible, one click, not destructive).
6. **Delete:** row's Trash icon → `ConfirmDialog` (danger tone, no acknowledge checkbox needed —
   soft-disable is the backend's preferred delete per the plan, so wording says "disabled", not
   "deleted", to set the right expectation) → confirms → row updates to disabled state or drops
   from an "enabled only" filter view.
7. **Exit / failure paths:** network error at any step → toast with retry-safe message, modal stays
   open with the admin's input intact (never lose typed data on a failed submit — same pattern as
   `GiftTierFormModal`'s catch block).

---

## 2. List page (`DiscountsPage`)

### 2.1 Layout (desktop, ≥1024px)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Discounts                                                [+ New discount] │
│  Create and manage promotional pricing rules.                              │
├───────────────────────────────────────────────────────────────────────────┤
│  [Store: All ▾]  [Status: All ▾]  [● Active now]           12 rules        │
├───────────────────────────────────────────────────────────────────────────┤
│ ● │ Name              │ Scope        │ Targets     │ Discount   │ Schedule │ Stacking │ On │ ⋯ │
│───┼───────────────────┼──────────────┼─────────────┼────────────┼──────────┼──────────┼────┼───│
│ ● │ Happy Hour 20%    │ This store   │ All items   │ 20% off,   │ Fri      │ Exclusive │[On]│⋯ │
│   │                   │ Bhagwan Baz. │             │ cap ₹100   │ 6–9pm    │           │    │   │
│───┼───────────────────┼──────────────┼─────────────┼────────────┼──────────┼──────────┼────┼───│
│ ○ │ Diwali Snacks     │ Global       │ 2 categories│ ₹50 off    │ 8–15 Oct │ Stackable │[On]│⋯ │
│   │                   │              │ +14 SKUs    │            │ 2026     │           │    │   │
└───────────────────────────────────────────────────────────────────────────┘
```

- Follows `CategoriesList` / `OrdersList` conventions: page title `<h1>` + subtitle, filter bar row
  directly under it, table below in a `border: 1px solid var(--border-color); border-radius:
  var(--radius-md)` wrapper (same shell as `TiersTable` in `GiftTiersPanel.tsx`), `.table-scroll`
  for horizontal overflow on narrow viewports.
- **Leading column `●`/`○`** = active-now indicator, NOT the enabled toggle (that's a separate
  rightmost column). Green filled dot (`var(--success)`) = live *right now* per schedule; grey
  outline dot = enabled but not currently in its active window (scheduled or between recurring
  windows); the dot is entirely absent (renders as a plain empty cell) when the rule is disabled —
  don't show a red dot for "disabled", the toggle column already communicates that unambiguously
  and a third dot color would be one status signal too many for a glance-able list (see memory:
  dense-tool tables need each fact on its own channel).
- **Name column**: rule name, bold, `var(--text-primary)`. If `description` is set, truncate it as
  a second line in `var(--text-secondary)`, `0.72rem` (same two-line pattern as the gift-tier row's
  name/secondary).
- **Scope column**: "Global" (plain text) or "This store" / "N stores" with the store name(s) as a
  tooltip/title attr when >1 (don't render 5 store chips inline — it breaks row height consistency
  across a table that's otherwise one line per row).
- **Targets column**: "All items" / "N categories" / "N SKUs" / combined "N categories + N SKUs" —
  exactly the plan's summary shape. Never spell out every category/SKU name inline; on hover/title
  attr, list them (cap the tooltip at ~10 with "+N more").
- **Discount column**: "20% off, capped at ₹100" or "₹50 off" (no cap = no "capped at" clause at
  all, not "capped at ₹0" — that would misleadingly imply unlimited discount rounds down to zero).
- **Schedule column**: absolute range formatted `en-IN`, `Asia/Kolkata` (same `fmtDate` pattern as
  `GiftTiersPanel.tsx`). If recurrence is set, append a second line: `"Fri 6:00–9:00 pm"` (join
  multiple days as `"Mon, Wed, Fri 6–9pm"` if the day list is short; `"Weekdays 6–9pm"` only if it's
  exactly Mon–Fri — don't over-engineer beyond that one special case for Phase 1, a plain
  comma-joined day list is fine otherwise).
- **Stacking column**: a small pill — "Exclusive" (amber `#d97706`, same hardcoded amber convention
  as `GiftTiersPanel`'s Expired status — there's no `--warning` token) or "Stackable" (neutral
  `var(--text-secondary)` outline pill). Priority number is NOT shown in the list — it only matters
  relative to other matching rules at evaluation time, which isn't a glanceable per-row fact; put
  it in the row's tooltip/detail instead ("Priority 10") so the table stays uncluttered.
- **On column**: the enabled `Switch`, same component as `GiftTiersPanel`. This is the durable
  enabled/disabled state (persists across restarts); the leading dot above is the *derived,
  real-time* "is it live right this second" state. Keeping both listed side by side, not merged
  into one, is deliberate — an admin needs to distinguish "I turned this off" from "it's scheduled
  for next week."
- **⋯ column**: Edit (pencil) + Delete (trash) icon buttons, same `ghostIconBtn` pattern as
  `GiftTiersPanel`'s table actions. 8px padding for the ≥44px combined touch target per the row's
  existing spacing convention.
- Numbers (discount %, ₹ caps) are not a dedicated right-aligned numeric column here — they're
  embedded in a summary sentence, so standard left alignment is correct; don't force right-align
  where the cell isn't a pure number.

### 2.2 Filter bar

Three controls, left-aligned, `controlStyle` (same `<select>` styling as `OrdersList` filters) +
a rule count on the right:

- **Store**: `<select>` — "All stores" default, then each store by name. Filters rules whose scope
  is Global OR whose `scope.storeIds` includes the selected store (client mental model: "show me
  everything that could affect this store"). Maps to `?storeId=`.
- **Status**: `<select>` — "All" / "Enabled" / "Disabled". Maps to `?enabled=`.
- **Active now**: a toggle-style filter chip (not a checkbox in a form sense — same visual language
  as `OrdersList`'s tab-style filters), off by default. Maps to `?activeNow=true`.

Filters compose (AND). Changing any filter resets to page 1 if pagination is added later; Phase 1
rule volume is expected to be small (tens, not thousands) so a single unpaginated fetch is fine —
no pagination UI needed at launch, but don't hardcode an unbounded page size either; mirror
`CategoriesList`'s `DEFAULT_LIMIT = 100` pattern as a sane ceiling and add a "showing first 100 of
N — narrow your filters" hint if `total > rules.length`.

### 2.3 States

- **Loading**: skeleton rows (`skeleton-bar` spans), same shape as `GiftTiersPanel`'s
  `SkeletonRows` — 3 placeholder rows matching the table's real column layout, not a spinner.
- **Empty (zero rules ever created)**: teaching empty state, same visual pattern as
  `GiftTiersPanel`'s "No gift tiers yet" block — dashed border, accent icon circle, one-line
  explainer ("Create a discount rule to run a promotion — a percentage or flat markdown on all
  items, a category, or specific SKUs."), primary CTA "Create your first discount" inline.
- **Empty (filtered to zero)**: distinct from the above — plain text row, no big dashed card, no
  CTA: "No discount rules match these filters." + a "Clear filters" link. Don't show the "create
  your first" teaching copy here — it's misleading when rules DO exist, just not matching the
  filter.
- **Error** (list fetch failed): same `errorCardStyle` pattern as `GiftTiersPanel` — icon + "Couldn't
  load discount rules" + "Check your connection and try again." + Retry button. This is
  indistinguishable-from-empty risk territory (see design memory) — never render the friendly empty
  state on a fetch failure; always route failures through this distinct error card.
- **Zero-matching-items edge case** (a rule whose category later became empty): not a separate
  page-level state — surfaced per-row. The Targets cell shows the normal summary ("1 category") but
  gets a small warning glyph (AlertTriangle, `var(--text-secondary)`, not alarming red — this is
  informational, not broken) with a tooltip: "This category currently has no matching items — the
  rule has no effect until items are added." No page-level banner; this is a targeted, low-severity
  per-row note, not a page-wide degraded state.
- **Store-flag-off warning**: see §5.

---

## 3. Create/Edit form (`DiscountRuleFormModal`)

Modal, not a dedicated page — matches `GiftTierFormModal`'s complexity level and the plan's own
build-order note ("modelled on `Config/GiftTiersPanel.tsx` + `GiftTierFormModal.tsx`"). The form has
more fields than the gift tier modal, so it's wider (`maxWidth: 640px` vs gift tier's 460px) and
scrolls internally (`bodyStyle: overflowY: auto`, header/footer pinned) rather than growing
unbounded — same `panelStyle` shell, same `overlayStyle`, same `role="dialog"` / focus-trap /
Escape-to-close pattern as `GiftTierFormModal`.

### 3.1 Section order (single scroll, not a wizard/tabs)

A linear single-scroll form, not tabs — Phase 1 field count is comparable to a rich settings form,
not so large it needs progressive disclosure, and a non-technical admin benefits from seeing the
whole shape of what they're configuring rather than hunting across tabs. Sections, in order:

1. **Name + description**
2. **Scope**
3. **Targets**
4. **Discount**
5. **Schedule**
6. **Stacking**
7. **Preview** (inline, always-visible summary strip — see §3.7)

Each section is visually separated the way `GiftTierFormModal` separates fields — a `label` +
control + `hintStyle` helper text underneath, `1.05rem` gap between blocks. Sections with several
sub-fields (Scope, Targets, Schedule) get a subtle `cfg-inner`-style bordered sub-panel (reuse the
`.cfg-inner` class already defined in `ConfigSettings.tsx`'s `scopedCss`) so the eye can chunk the
form into "Name" / "Who this affects" / "How much off" / "When" / "How it combines" rather than one
undifferentiated list of 15 inputs.

### 3.2 Name + description

- **Name** — required text input, same `inputStyle` as gift tier's fields. Placeholder: "e.g. Happy
  Hour 20% Off". Validation: non-empty, same inline-error pattern (`fieldErrStyle` below the field,
  shown only after `touched`).
- **Description** — optional `<textarea>`, 2 rows, placeholder "Optional note for your team — not
  shown to customers."

### 3.3 Scope

Radio-style two-option toggle (reuse the visual language of a segmented control — two buttons in
one bordered row, active one filled `var(--accent-primary)`, same shape as `OrdersList`'s tab
buttons at line ~308-327):

```
Scope
┌─────────────┬─────────────┐
│   Global    │   Specific store(s)   │
└─────────────┴─────────────┘
```

- **Global** (default): no further control shown. Hint: "Applies to every store."
- **Specific store(s)**: reveals a multi-select store picker directly below — a checkbox list in a
  bordered scrollable box (max-height ~180px) of all stores, same row shape as a combobox option
  row (`optionStyle`/`thumbStyle` pattern minus the item thumbnail — just store name + city). At
  least one store must be checked before Save is enabled when this mode is active. When toggling
  back to Global, the store selection is retained in local state but hidden/ignored, not discarded —
  so an admin who taps Global by accident and switches back doesn't lose their picks.
- Validation: Specific-store mode with zero stores checked blocks Save with an inline error under
  the store list: "Select at least one store."

### 3.4 Targets — NOT mutually exclusive (this is the trickiest field group after the below-cost
gate)

The plan is explicit: a rule can combine "All items" OR a mix of categories + SKUs. The UI must
make combining feel intentional, not like a bug where multiple radio-like options got left checked.
Design as **independent toggles that gate their own picker**, not radio buttons:

```
Targets
┌───────────────────────────────────────────────────────────┐
│ ☐ All items                                                │
│   Applies to everything in scope, with no category/SKU     │
│   narrowing.                                                │
│                                                              │
│ ☑ Specific categories                    [4 selected ▾]     │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ [x] Snacks   [x] Beverages   [x] Dairy   [x] Bakery  │  │
│   │ + Add category...                                     │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                              │
│ ☑ Specific SKUs                          [14 selected ▾]    │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ 🔍 Search items to add...                             │  │
│   │ [item chip] [item chip] [item chip] ...               │  │
│   └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

- Three checkboxes: **All items**, **Specific categories**, **Specific SKUs**. Any combination of
  the two "Specific" ones may be checked together (their matched item sets union). **"All items"
  is mutually exclusive with the other two** at the UI level — checking it clears and disables the
  other two (with a one-line inline note: "All items already covers everything — category/SKU
  selection is cleared."), because combining "All items" with a category selection is functionally
  redundant and would only confuse future editors of the rule. This is the one place a "not
  mutually exclusive" instruction gets a deliberate, explained exception — call this out to
  tanmoy-web explicitly since it could otherwise read as contradicting the brief.
- **Specific categories**: multi-select via chip/tag UI — selected categories render as removable
  chips (× on each), "+ Add category" opens a simple checklist dropdown (categories are a bounded,
  known list per the plan — no search needed, a scrollable checklist like the Scope store-picker is
  enough).
- **Specific SKUs**: reuse the exact combobox pattern from `GiftTierFormModal.tsx` (search-as-you-
  type, debounced 300ms, `giftTierApi.searchItems`-equivalent — a new `discountRuleApi.searchItems`
  hitting the same store-item-search endpoint), but **multi-select**: each successful pick adds a
  removable chip below the search box instead of collapsing to a single selected value. Reuse the
  out-of-stock dim-and-block-selection treatment from that same file — an OOS item can still be
  *targeted* by a discount rule (stock changes are transient, a rule is a scheduled setup — same
  reasoning `GiftTierFormModal.tsx` already documents for the seeded-OOS gift item case) — so
  **don't block OOS items from SKU targeting** the way the gift-item picker blocks picking an OOS
  gift; drop that particular guard for this reuse and just show the stock label for information.
- At least one of {All items, ≥1 category, ≥1 SKU} must be set before Save — inline error under the
  whole Targets block: "Choose what this discount applies to."
- SKU search scope: when Scope = Specific store(s), the item search should be scoped to those
  store(s) (reuse the store-scoped search endpoint pattern); when Scope = Global, search across all
  stores by `iId` product identity (per the plan, `targets.iIds` targets the cross-store `iId`, not
  a per-store `itemId`) — flag this scoping requirement to tanmoy-web, it's a real API-shape detail
  not just UI polish.

### 3.5 Discount

```
Discount
┌──────────┬──────────┐        ┌─────────────────────┐
│ Percent  │ Flat ₹   │  Value │ [ 20        ] %      │
└──────────┴──────────┘        └─────────────────────┘
☐ No cap        Max discount per unit  ₹ [ 100        ]
```

- **Type toggle**: same segmented-control visual as the Scope toggle. Percent (default) / Flat ₹.
- **Value input**: numeric, suffix `%` or prefix `₹` depending on type (mirror the gift tier form's
  `₹` prefix treatment in `prefixStyle`). Validation per the plan: percent 1–100, flat > 0. Inline
  error uses the plan's own wording style: "Enter a percentage between 1 and 100" / "Enter an
  amount above ₹0".
- **Cap**: a checkbox "No cap" (checked = `maxDiscountAmount: null`) paired with a ₹ input that's
  disabled/greyed when "No cap" is checked, enabled otherwise, required to be > 0 when active. Only
  make sense for Percent type in practice (a flat discount is already a fixed number, capping it is
  a no-op) — still show it for Flat too rather than conditionally hiding the field (simpler mental
  model, and the plan's schema doesn't distinguish), but the hint text under it clarifies: "For
  Percent, caps the ₹ value of the discount per unit. Leave 'No cap' checked for an uncapped
  percentage off."
- Explicit note in this section, since flat discount is a common admin mistake per the plan's own
  callout: hint text under the Flat ₹ value input reads "Applied per unit, not per line or per
  cart." — this prevents an admin fat-fingering a cart-level number.

### 3.6 Schedule — the trickiest layout after below-cost; two clearly separated sub-blocks

Non-technical admins conflate "when this rule exists" with "recurring happy-hour windows." Keep
them visually and conceptually separate with a clear hierarchy: **absolute range is required and
primary; recurrence is optional and secondary**, introduced only once the admin opts in.

```
Schedule

Active from                              Active until
[ 01 Aug 2026    ] [ 09:00 AM ]         [ 31 Aug 2026    ] [ 11:59 PM ]
Times are India Standard Time (IST).

──────────────────────────────────────────────────────────────

☐ Also limit to specific days & a time window (e.g. "Fridays 6–9pm")

  (revealed when checked)
  Days                Time window
  [Mo][Tu][We][Th]     From [ 06:00 PM ]  to  [ 09:00 PM ]
  [Fr][Sa][Su]
  (Fr, Sa selected — filled pill; others outline)

  Only one time window is supported per rule right now — if you need a
  second window (e.g. a lunch AND a dinner special), create a second rule.

  Discount is only active when BOTH the date range above AND this
  day/time window match.
```

- **Absolute range**: two labeled groups (Active from / Active until), each a date input + time
  input pair — reuse `configTime.ts`'s `istInputToUtcIso` / `utcIsoToISTInput` conversion exactly
  as `GiftTierFormModal` does, but note the gift tier form only handles **calendar dates** (no
  time-of-day); Discounts needs full date **+ time** because the plan's `startAt`/`endAt` are exact
  UTC instants, not day boundaries. Use a single `<input type="datetime-local">` per side (not
  separate date+time inputs) — that's the native control `configTime.ts`'s doc comment already
  anticipates ("`<input type="datetime-local">` is inherently browser-local, so we convert both
  ways with a fixed offset"). Reuse `istInputToUtcIso`/`utcIsoToISTInput` as-is; no new time-math
  needed. A persistent hint line under the pair: "Times are India Standard Time (IST)."
  Validation: `endAt >= startAt` (Save-blocking, inline error same as gift tier's date-order check),
  worded "End must be after start."
- **Recurrence opt-in checkbox**: unchecked by default (most rules are plain date-range promos, per
  the plan's own primary use case). Checking it reveals the day/window sub-block with a light
  top border to visually detach it from the always-on range above.
- **Days**: seven toggle pills, Mon-first (matches how the admin's own week reads, even though the
  schema is `0=Sunday`-indexed — do the Sun↔Mon reindex in the FE, never surface Sunday=0 to the
  admin). Multi-select, at least one required once recurrence is opted in.
- **Time window**: two time inputs, "From" / "to", IST wall-clock, minute-granularity, converted to
  `startMinute`/`endMinute` from IST midnight for the API. **Explicitly single window** — this is
  called out as UI copy directly under the inputs ("Only one time window is supported per rule
  right now...") rather than left implicit, exactly per the brief's instruction to make the Phase 1
  constraint a stated fact, not a discovered limitation. Validation: `endMinute > startMinute`
  (Phase 1 has no midnight-crossing support per the plan) — inline error "End time must be after
  start time (can't cross midnight yet)."
- The closing sentence ("Discount is only active when BOTH...") is a deliberate, permanent hint
  (not a tooltip that disappears) — this AND relationship between the two blocks is the single most
  likely point of confusion for a non-technical admin, and plain static copy is more reliable here
  than a tooltip a first-time user might never hover.

### 3.7 Stacking

```
Stacking
┌──────────────┬──────────────┐
│  Exclusive   │  Stackable   │
└──────────────┴──────────────┘
Exclusive: only this rule applies if it wins — no other discount combines with it.
Stackable: can combine with other stackable rules on the same item.

Priority (ⓘ)                    [ 0        ]
```

- Same segmented-toggle visual as Scope/Discount type. Default **Exclusive** — matches the schema
  default `stackable:false`, and is the safer default for a super admin who hasn't thought through
  stacking interactions yet (an accidental double-stack is a bigger financial surprise than an
  accidental non-stack).
- **Priority**: a plain number input, but de-emphasized — smaller label, an (ⓘ) info icon with a
  tooltip on hover/focus: "Used to break ties when multiple rules could apply to the same item.
  Higher number = considered first. Leave at 0 if you're not sure — it only matters when rules
  overlap." Per the brief's instruction to hide-or-tooltip rather than presenting it as an equally
  weighted field — this treatment (small label + info icon, not a full section) is the "consider
  hiding" resolved as "explain, don't hide," since Priority is still occasionally decisive and
  hiding it entirely would strand an admin who needs it with no way to find it.

### 3.8 Preview

Not a separate modal step — an **inline, collapsible strip** pinned near the bottom of the form
(above the footer buttons), because the brief allows either inline-as-they-fill or a button; inline
wins here because the affected-item count is exactly the kind of "am I about to do something huge
or something tiny" sanity check an admin wants before ever reaching Save, not after.

```
┌───────────────────────────────────────────────────────────┐
│  👁  Preview                                    [Refresh]  │
│  This would affect ~142 items across 2 stores.              │
│  Sample:  Parle-G 200g   ₹20 → ₹16      Maggi 70g  ₹14 → ₹11.20 │
│  [ Show more samples ]                                      │
└───────────────────────────────────────────────────────────┘
```

- Debounced (600ms after the last relevant field change — Scope/Targets/Discount, NOT Name/
  Description/Stacking, which don't affect the affected-item set) `POST /admin/discount-rule/preview`
  call, quietly loading (`Loader2` spin next to "Preview", same as the search spinner pattern) — no
  jarring reflow.
- Renders `affectedItemCount` as the headline sentence, then up to 3 sample rows inline (name,
  original → discounted price, strikethrough on the original), with a "Show more samples" expand
  for the rest of the returned 10.
- **Empty preview** (0 affected items, e.g. a category with no items, or targets not yet chosen):
  "Nothing matches yet — check your Targets above." — informational tone, not an error; this is not
  Save-blocking (the plan says create-time validation prevents an empty-target *rule*, i.e. no
  targets picked at all — a category that's currently empty is legal to save, matching the "zero-
  matching-items edge case" already called out in the list-page states).
- **Preview also surfaces `belowCostItems` early** as a non-blocking amber inline note right in this
  strip if the preview response includes any: "⚠ 3 items would sell below cost at this discount —
  you'll be asked to confirm this when you save." This is intentionally a *preview* of the Save-time
  gate (§4), not a substitute for it — the real gate always re-fires at Save since the preview can
  go stale as the admin keeps editing.
- **Preview fetch failure**: silently degrade — hide the strip's content, show "Preview
  unavailable right now" in muted text with a manual "Retry" — never block Save on a broken preview
  call; preview is advisory only, consistent with the plan's stance that preview and checkout must
  never diverge in *behavior* but a broken preview call must never diverge in *availability* of the
  Save action itself.

### 3.9 Footer

`Cancel` (ghost, left of Save... actually right-aligned pair, same as gift tier form: Cancel then
Save, Cancel is the visually lighter of the two) / `Save discount rule` (or `Save changes` in edit
mode) — primary accent button, disabled + `not-allowed` cursor while any blocking validation error
exists or while saving, spinner + "Saving…" while in flight, exactly the `GiftTierFormModal`
pattern (`isSaving || blocked`).

---

## 4. Below-cost confirmation flow (the trickiest UX moment)

This must read as a considered business-risk checkpoint, not a scary blocking wall, and not a
dismissible toast. Build it on the existing `ConfirmDialog` component, which already has exactly
the right primitive: `acknowledgeLabel` (renders a required checkbox; confirm stays disabled until
ticked). Reuse that component, don't build a new one from scratch — this is precisely what it was
designed for.

### 4.1 Trigger

`DiscountRuleFormModal`'s Save handler calls `POST`/`PUT` with the form body (no
`acknowledgeBelowCost` yet). If the response contains a non-empty `belowCostItems[]` (whether
shaped as the "blocked" error response or a 200-with-`belowCostItems`, per the plan's contract —
tanmoy-web should treat both the same in the FE: presence of a non-empty `belowCostItems` array
always means "don't treat this as saved, show the gate"), the form does **not** close and does
**not** show a success toast. Instead it opens `BelowCostConfirmModal` **stacked on top** of the
still-open form modal (the form's values stay intact underneath, visible as a dimmed backdrop
through the overlay — same nested-modal precedent as `GiftTiersPanel`'s delete `ConfirmDialog`
sitting over the panel).

### 4.2 Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠  This discount would sell some items below cost             │
├──────────────────────────────────────────────────────────────┤
│  At this discount, the items below would be sold for less      │
│  than what they cost you. This can still be the right call for │
│  a loss-leader promo — just make sure it's intentional.        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Item              Would sell at    Costs you            │   │
│  │ Amul Butter 500g   ₹185            ₹210                 │   │
│  │ Tata Salt 1kg       ₹18             ₹22                 │   │
│  │ Maggi 70g            ₹9             ₹11                 │   │
│  │ ... + 6 more                                             │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ☐ I understand this may sell below cost                       │
│                                                                  │
│                              [ Go back and edit ]  [ Confirm and save ] │
└──────────────────────────────────────────────────────────────┘
```

- **Header**: amber warning icon (`AlertTriangle`, amber `#d97706` — NOT red/`--danger`; this is a
  caution, not a destructive-action error, deliberately distinct from `ConfirmDialog`'s `danger`
  tone which is reserved for irreversible deletes elsewhere in the app). Title states the fact
  plainly: "This discount would sell some items below cost."
- **Body copy** explicitly validates that this can be a legitimate choice ("This can still be the
  right call for a loss-leader promo") — this is the single most important line in the whole flow
  for hitting the brief's "serious but not scary" bar. Don't lecture, don't use "WARNING" in caps,
  don't red-flood the modal.
- **Item table**: `itemId`/name, would-be price, cost price — cost price rendered in
  `var(--text-secondary)`, would-be price in `var(--text-primary)` with no red styling on the
  number itself (the whole modal's context already establishes the concern; don't also paint every
  price red, which reads as alarming and makes genuinely-fine numbers next to it look suspicious
  too). Cap the rendered list at ~8-10 rows with "+ N more" text (the API already caps
  `belowCostItems`/samples similarly per the plan's preview contract — mirror that cap here for
  consistency, and if the create/update response returns more than the preview's 10-sample cap,
  just show what's returned).
- **Checkbox** (`acknowledgeLabel` prop on `ConfirmDialog`): "I understand this may sell below
  cost" — plain, first-person, no jargon. This is the actual `acknowledgeBelowCost: true` gate.
- **Two actions**: `Go back and edit` (secondary/ghost — returns to the form, no data lost, no
  resubmit) and `Confirm and save` (primary, but NOT red/danger-colored — amber-bordered per the
  header's amber theme, disabled until the checkbox is ticked, exactly `ConfirmDialog`'s existing
  disabled-until-ack behavior). No default-focused destructive button — `ConfirmDialog` already
  focuses the safe/cancel option on open; here that means "Go back and edit" gets initial focus,
  not "Confirm and save", even though this isn't a delete — the same why applies: never let an
  Enter-key double-tap accidentally confirm a real-money decision.
- On **Confirm and save**: resubmit the exact same body the form already built, with
  `acknowledgeBelowCost: true` appended to the query. Success → close both modals, toast "Discount
  rule created" (or "updated"), list re-fetches. Failure on this resubmit (e.g. network drop) →
  keep `BelowCostConfirmModal` open, toast the error, let the admin retry Confirm and save without
  re-reviewing the list again (the ack stays ticked).
- This is audit-logged server-side per the plan (`createdBy`/`updatedBy` plus the plan's explicit
  "audit-logged" note on below-cost acknowledgement) — no additional FE work needed for that beyond
  sending the flag; just don't let the FE silently retry with `acknowledgeBelowCost:true` on a
  plain validation failure unrelated to below-cost (only send it after the explicit human tick).

### 4.3 Edit-mode re-trigger

Editing an existing rule can newly cross the cost line (e.g. raising the percentage). The exact same
gate fires on `PUT`, worded identically — no special-casing "this rule already existed" language,
since the check is evaluated fresh against current cost prices every time regardless of create vs.
edit.

---

## 5. Store-flag-off warning (`discountsEnabled`)

**Recommendation: a persistent, non-blocking banner, not a hard block.** A super admin managing
discounts globally shouldn't be prevented from authoring rules for a store that hasn't flipped the
flag yet — that's a normal sequencing order (build promos first, flip the switch when ready), and
blocking Save on it would be presumptuous about intent. But leaving it silently invisible risks the
"why isn't this discount showing to customers" support ticket. So:

- On `DiscountsPage`, **fetch each store's `config.discountsEnabled`** alongside the store list
  (reuse whatever store-list-with-config endpoint already exists for the Stores page; if none
  returns the flag today, flag this as a backend dependency to confirm with sumit-backend/tanmoy-web
  rather than guessing at a new endpoint here).
- **Row-level, not global**: a row whose scope includes at least one store with
  `discountsEnabled: false` gets a small inline note under the Scope cell (not a full-row highlight
  — keep the table calm): "Discounts are off for {store name} — this rule won't apply there yet."
  If scope is Global and *some* stores have it off, phrase it as "Off for 2 of 5 stores."
- **In the create/edit form**, once a store is chosen in Scope (or on load in edit mode), show the
  same non-blocking amber note directly under the Scope section if the selected store(s) have the
  flag off: "Heads up — discounts are currently turned off for {store}. This rule will be saved but
  won't show to customers until the store admin enables discounts in Config." with a `Link` to that
  store's `/config` page (reuse the existing cross-page `Link` pattern already used in
  `ConfigSettings.tsx`'s imports) so the fix is one click away, not a separate hunt.
- This mirrors the tone of the "zero-matching-items" per-row note in §2.3 — informational amber,
  never a blocking red, because both are "this rule is technically fine but currently inert for a
  reason the admin should know about" states, not errors.

---

## 6. Design tokens (reused, none new)

| Purpose | Token |
|---|---|
| Panel/card surfaces | `var(--bg-panel)`, `var(--bg-secondary)` |
| Borders | `var(--border-color)`, radius `var(--radius-md)` / `var(--radius-lg)` |
| Primary text / secondary text | `var(--text-primary)` / `var(--text-secondary)` |
| Accent (primary buttons, active toggle state) | `var(--accent-primary)` |
| Success (active-now dot, "Enabled") | `var(--success)` |
| Danger (delete, blocking field errors) | `var(--danger)` |
| Warning (below-cost gate, store-flag-off note, "Expired"/"Exclusive" pills) | `#d97706` hardcoded
  — confirmed app-wide convention, there is **no** `--warning` token (see `GiftTierFormModal.tsx`
  and `GiftTiersPanel.tsx` comments); do not invent one for this feature, stay consistent |
| Info (scheduled-state pill, if needed for schedule status) | `#6366f1` hardcoded, same reasoning
  as above (`GiftTiersPanel.tsx`'s Scheduled status) |
| Spacing | Follow existing scale already in use: `0.35rem`/`0.5rem`/`0.6rem`/`0.75rem`/`0.85rem`/
  `1.05rem`/`1.35rem` as seen across `GiftTierFormModal.tsx` — no new spacing values introduced |
| Type | Labels `0.85rem` / 500 weight; hints `0.72–0.75rem` / `var(--text-secondary)`; field errors
  `0.75rem` / 500 / `var(--danger)`; table body `0.85rem`; header `1.05rem` for modal title,
  page `<h1>` size matches other list pages (check `CategoriesList.tsx`'s page header for the exact
  class/size and reuse verbatim rather than re-guessing it) |

No new tokens are introduced. The only "new" color usage is the two already-established hardcoded
hex values (`#d97706` amber, `#6366f1` indigo) reused verbatim from the gift-tier precedent — this
is deliberate consistency, not a design decision to relitigate.

---

## 7. Component inventory

| Component | Status | Notes |
|---|---|---|
| `Switch` | Reuse as-is | Enabled toggle in rows, form toggles use segmented-buttons instead (see below) |
| `ConfirmDialog` | Reuse as-is | Delete-rule confirm; base for `BelowCostConfirmModal` (uses its existing `acknowledgeLabel` prop — no new prop needed) |
| Segmented two-option toggle (Scope, Discount type, Stacking) | **New, but trivial** — a small shared `SegmentedToggle` component (2-3 buttons, active = filled accent) is worth extracting since this pattern repeats 3x in this form alone; flag to tanmoy-web as a good shared-component candidate rather than copy-pasting the `OrdersList` tab-button styles three times inline |
| Store multi-select checklist (Scope) | New | Simple bordered scrollable checkbox list; no existing precedent to reuse verbatim, but visually matches the SKU-search dropdown's row shape |
| Category multi-select chips | New | Chip removal UI; category list is short/bounded so no search needed |
| SKU search-multi-select combobox | Reuse pattern, extend | Base logic lifted from `GiftTierFormModal.tsx`'s combobox (debounce, keyboard nav, OOS labelling) but changed from single-select-collapse to multi-select-chips, and OOS must NOT block selection (differs from the gift-item picker — call this out explicitly in code review since it inverts an existing guard) |
| `datetime-local` + IST conversion | Reuse utils, new inputs | `configTime.ts`'s `istInputToUtcIso`/`utcIsoToISTInput` reused as-is; the gift tier form only used `<input type="date">`, this needs `<input type="datetime-local">` — same conversion math, different input type |
| Day-of-week pill selector | New | 7 toggle pills, Mon-first display order, reindex to schema's `0=Sunday` at the API boundary only |
| Time-of-day range inputs | New | Two `<input type="time">`, IST wall-clock, minute math to `startMinute`/`endMinute` |
| `BelowCostConfirmModal` | New, built on `ConfirmDialog` | Adds the item comparison table as `children`; everything else (ack checkbox, button gating, focus trap) comes free from `ConfirmDialog` |
| Preview strip | New | Debounced fetch + collapsible sample list |
| `DiscountsPage` list/table | New | Structurally copies `GiftTiersPanel`'s `TiersTable` + `SkeletonRows` + empty/error state shapes, adapted to the richer column set |

---

## 8. Interaction details

- **Hover/press**: icon buttons (`ghostIconBtn`) get a subtle `background-color:
  var(--bg-secondary)` on hover (already the established pattern in row action buttons elsewhere —
  verify against the exact hover treatment used in `CategoriesList.tsx`'s row actions and match it,
  don't invent a new one).
- **Transitions**: `Switch` toggle 150ms ease (existing, unchanged). Segmented-toggle active state
  swap: 120ms ease background/color transition, matching the snappy-but-not-jarring feel of the
  rest of the admin (no spring/bounce easing anywhere in this codebase's existing components —
  don't introduce one here).
- **Optimistic updates**: the row-level enabled `Switch` flips immediately on click, `PATCH` fires
  in background, reverts + toasts on failure — same posture as any other inline toggle in this app.
  List-level filters and the Save button are NOT optimistic (they wait for the real response) —
  those are multi-field mutations where an optimistic guess would be wrong often enough to cause
  visible flicker-and-revert, unlike a single boolean flip.
- **Destructive-action confirmation**: Delete uses `ConfirmDialog` with `tone="danger"`, no
  acknowledge checkbox (soft-disable is low-risk and reversible by re-enabling, unlike the
  below-cost financial decision which genuinely needs a considered tick).
- **Toasts**: reuse `toast.success`/`toast.error` from `stores/toastStore` exactly as
  `GiftTierFormModal`/`GiftTiersPanel` do — "Discount rule created" / "Discount rule updated" /
  "Discount rule removed" / "Couldn't save the discount rule" (+ server message if present, same
  error-extraction chain already used: `response.data.message` → `response.data.msg` → fallback).

---

## 9. Accessibility

- Modal: `role="dialog"` `aria-modal="true"` `aria-label` set to the mode ("Create discount rule" /
  "Edit discount rule"), focus lands on the Name field on open, Escape closes (unless a nested
  combobox/listbox is open, matching `GiftTierFormModal`'s existing Escape-priority logic), focus
  returns to the trigger button on close.
- `BelowCostConfirmModal`: same dialog semantics via `ConfirmDialog`; focus lands on the safe
  "Go back and edit" action, not "Confirm and save" (see §4.2).
- Segmented toggles: implement as a `role="radiogroup"` of `role="radio"` buttons (or a native
  fieldset of radios styled as segments) — NOT plain unlabelled `<button>`s — so screen readers
  announce "Percent, selected, 1 of 2" correctly; this matters more here than in `OrdersList`'s
  tabs because these toggles carry real save-blocking semantic meaning (Scope, Discount type,
  Stacking), not just view filtering.
- Day-of-week pills: `aria-pressed` per pill, group wrapped in a `fieldset`/`legend` "Active days."
- All icon-only buttons (Edit/Delete/Close/Clear) keep explicit `aria-label`s, matching every
  existing precedent file's convention — no exceptions.
- Color is never the only signal: the active-now dot is paired with the `Switch`'s own state and
  the Schedule column's dates (so a colorblind admin can still read status from text/position, not
  hue alone); the below-cost gate's amber icon is paired with explicit text, never color-only.
- Touch targets: icon buttons keep the existing 8px-padding → ~44px convention (per `GiftTiersPanel`
  comment); segmented-toggle buttons and day pills sized to a minimum 36px height (slightly under
  the 44px ideal is acceptable here per existing precedent in this codebase's compact admin density,
  but never below ~32px, and the row must have adequate surrounding gap so mis-taps don't hit a
  neighbor).
- Contrast: text/background pairs reuse existing tokens already verified for both themes in this
  codebase (per this designer's own prior light-theme-contrast memory) — no new color combinations
  are introduced that would need fresh contrast verification, EXCEPT the amber-on-`--bg-panel`
  below-cost header icon/text, which should be spot-checked in light theme specifically (amber
  `#d97706` on white background) since it's a slightly less common pairing than on the dark
  `--bg-panel` (#242424) — confirmed the hex value itself already passes AA on both surfaces in
  practice via the existing `GiftTiersPanel` "Expired" pill precedent, so no new risk, just flagging
  the reuse context for QA.

---

## 10. Open items for build (not blocking, flag to tanmoy-web)

1. Confirm whether a stores-list-with-`discountsEnabled` endpoint already exists for the §5 banner,
   or whether it needs a small BE addition (`GET /admin/store` likely already returns `config`, but
   confirm the discounts flag rides along without a dedicated flag param).
2. Confirm exact HTTP shape (200-with-`belowCostItems` vs. error-status-with-`belowCostItems`) once
   sumit-backend implements — the plan shows both a "success" and "blocked" response with the same
   `belowCostItems` field, so the FE fetch wrapper should handle both without assuming a status code.
3. `SegmentedToggle` extraction (§7) is a nice-to-have factor-out, not a hard requirement — fine to
   inline three times if timeline is tight, but it will look and behave more consistently if shared.

---

**End of spec.**
